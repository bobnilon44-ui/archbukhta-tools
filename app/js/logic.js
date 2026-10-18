/* Бизнес-логика: выдача, возврат, лимиты, расходники, справочники, отчёты.
 * Без DOM — тестируется в Node (см. tests/). */
(function (root) {
  'use strict';
  var AB = (root.AB = root.AB || {});
  var db = AB.db || (typeof require !== 'undefined' ? require('./db.js') : null);

  /* ---------- ошибки ---------- */

  function AppError(code, message, data) {
    var e = new Error(message);
    e.name = 'AppError';
    e.code = code;
    e.data = data || {};
    return e;
  }

  /* ---------- QR-коды ---------- */

  var PREFIX = { team: 'T', item: 'I', consumable: 'C' };
  var KIND_BY_PREFIX = { T: 'team', I: 'item', C: 'consumable' };

  function codeFor(kind, id) { return 'AB:' + PREFIX[kind] + ':' + id; }

  function parseCode(text) {
    if (!text) return null;
    var m = String(text).trim().toUpperCase().match(/^AB:([TIC]):([A-Z0-9_-]{1,40})$/);
    if (!m) return null;
    return { kind: KIND_BY_PREFIX[m[1]], id: m[2] };
  }

  /* ---------- идентификаторы ---------- */

  var TRANSLIT = {
    а: 'A', б: 'B', в: 'V', г: 'G', д: 'D', е: 'E', ё: 'E', ж: 'ZH', з: 'Z', и: 'I', й: 'Y', к: 'K',
    л: 'L', м: 'M', н: 'N', о: 'O', п: 'P', р: 'R', с: 'S', т: 'T', у: 'U', ф: 'F', х: 'H', ц: 'TS',
    ч: 'CH', ш: 'SH', щ: 'SCH', ъ: '', ы: 'Y', ь: '', э: 'E', ю: 'YU', я: 'YA'
  };

  function translit(s) {
    return String(s || '').toLowerCase().split('').map(function (ch) {
      if (Object.prototype.hasOwnProperty.call(TRANSLIT, ch)) return TRANSLIT[ch];
      return /[a-z0-9]/.test(ch) ? ch.toUpperCase() : ' ';
    }).join('');
  }

  /** «Циркулярная пила» → «TSIRPIL», «Аккумулятор 18V» → «AKKU18V». */
  function suggestTypeCode(name) {
    var words = translit(name).split(/\s+/).filter(Boolean);
    if (!words.length) return 'TYPE';
    var code = words.length === 1 ? words[0].slice(0, 6) : words.slice(0, 3).map(function (w, i) {
      return /^[0-9]/.test(w) ? w.slice(0, 4) : w.slice(0, i === 0 ? 4 : 3);
    }).join('');
    return code.slice(0, 10) || 'TYPE';
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  function nextNumbered(existingIds, prefix, width) {
    var max = 0;
    existingIds.forEach(function (id) {
      if (id.indexOf(prefix) !== 0) return;
      var n = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return function () { max += 1; return prefix + pad(max, width); };
  }

  /* ---------- лимиты ---------- */

  /** 0 или пусто = без лимита. */
  function effectiveLimit(type, settings) {
    var l = type && type.limit;
    if (l === undefined || l === null || l === '') l = settings ? settings.defaultLimit : 2;
    l = Number(l);
    return l > 0 ? l : Infinity;
  }

  function limitMessage(limit) {
    return 'Лимит для вашей команды: ' + limit + ' шт. Сначала верните один.';
  }

  /* ---------- журнал ---------- */

  function newOp(fields) {
    return Object.assign({
      ts: Date.now(),
      op: null,
      teamId: null, teamName: null,
      fromTeamId: null, fromTeamName: null,
      itemId: null, itemLabel: null,
      typeId: null, typeName: null,
      consumableId: null, consumableName: null,
      qty: null,
      note: '',
      batchId: null,
      synced: false
    }, fields);
  }

  function itemOpFields(item, type, team) {
    return {
      itemId: item.id, itemLabel: item.label,
      typeId: type ? type.id : item.typeId, typeName: type ? type.name : '',
      teamId: team ? team.id : null, teamName: team ? team.name : null
    };
  }

  /* ---------- выдача ---------- */

  async function getActiveTeam(tx, teamId) {
    var team = await db.get(tx, 'teams', teamId);
    if (!team) throw AppError('TEAM_NOT_FOUND', 'Команда не найдена. Отсканируйте бейдж ещё раз.');
    if (team.active === false) throw AppError('TEAM_INACTIVE', 'Команда «' + team.name + '» отключена. Обратитесь к организаторам.');
    return team;
  }

  /**
   * Проверяет, можно ли добавить itemId в корзину команды, учитывая то, что уже на руках и уже в корзине.
   * Возвращает { item, type, held, limit }.
   */
  async function checkCandidateTx(tx, settings, teamId, itemId, cartIds) {
    cartIds = cartIds || [];
    var item = await db.get(tx, 'items', itemId);
    if (!item) throw AppError('ITEM_NOT_FOUND', 'Неизвестный инструмент (' + itemId + '). Обратитесь к организаторам.');
    if (cartIds.indexOf(item.id) !== -1) throw AppError('IN_CART', '«' + item.label + '» уже в корзине.', { item: item });
    if (item.status === 'retired') throw AppError('ITEM_RETIRED', '«' + item.label + '» списан и не выдаётся.', { item: item });
    if (item.status === 'service') throw AppError('ITEM_SERVICE', '«' + item.label + '» на обслуживании. Взять нельзя.', { item: item });
    if (item.status === 'out') {
      if (item.holderTeamId === teamId) {
        throw AppError('ALREADY_YOURS', '«' + item.label + '» уже числится за вашей командой.', { item: item });
      }
      var holder = await db.get(tx, 'teams', item.holderTeamId);
      throw AppError('ALREADY_OUT',
        '«' + item.label + '» числится за командой «' + (holder ? holder.name : item.holderTeamId) +
        '». Её участник может передать его вам: скан инструмента → «Передать другой команде» → ваш бейдж.', { item: item });
    }
    var type = await db.get(tx, 'toolTypes', item.typeId);
    var limit = effectiveLimit(type, settings);
    var held = (await db.byIndex(tx, 'items', 'holderTeamId', teamId))
      .filter(function (i) { return i.status === 'out' && i.typeId === item.typeId; }).length;
    var inCart = 0;
    for (var k = 0; k < cartIds.length; k++) {
      var c = await db.get(tx, 'items', cartIds[k]);
      if (c && c.typeId === item.typeId) inCart++;
    }
    if (held + inCart + 1 > limit) {
      throw AppError('LIMIT', limitMessage(limit), {
        item: item, type: type, held: held, inCart: inCart, limit: limit
      });
    }
    return { item: item, type: type, held: held, inCart: inCart, limit: limit };
  }

  function checkCandidate(teamId, itemId, cartIds) {
    return db.run(['teams', 'toolTypes', 'items', 'settings'], 'readonly', async function (tx) {
      var settings = await db.readSettings(tx);
      await getActiveTeam(tx, teamId);
      return checkCandidateTx(tx, settings, teamId, itemId, cartIds);
    });
  }

  /** Проверка расходника перед добавлением в корзину (остаток с учётом уже набранного). */
  function checkConsumable(consumableId, qty, alreadyInCart) {
    return db.getOne('consumables', consumableId).then(function (c) {
      return validateConsumable(c, consumableId, qty, alreadyInCart || 0);
    });
  }

  function validateConsumable(c, consumableId, qty, alreadyInCart) {
    if (!c) throw AppError('CONSUMABLE_NOT_FOUND', 'Неизвестный расходник (' + consumableId + ').');
    qty = Number(qty);
    if (!(qty > 0) || Math.floor(qty) !== qty) throw AppError('BAD_QTY', 'Введите целое количество больше нуля.');
    if (qty + alreadyInCart > c.stock) {
      throw AppError('NOT_ENOUGH', 'Недостаточно: «' + c.name + '» осталось ' + c.stock + ' ' + (c.unit || 'шт') + '.', { consumable: c });
    }
    return c;
  }

  /**
   * Атомарная выдача: все проверки повторяются внутри одной транзакции.
   * consumables: [{ id, qty }]
   */
  function issue(teamId, itemIds, consumables) {
    itemIds = itemIds || [];
    consumables = (consumables || []).filter(function (c) { return Number(c.qty) > 0; });
    if (!itemIds.length && !consumables.length) {
      return Promise.reject(AppError('EMPTY_CART', 'Корзина пуста. Отсканируйте инструмент.'));
    }
    return db.run(['teams', 'toolTypes', 'items', 'consumables', 'operations', 'settings'], 'readwrite', async function (tx) {
      var settings = await db.readSettings(tx);
      var team = await getActiveTeam(tx, teamId);
      var now = Date.now();
      var batchId = 'B' + now.toString(36);
      var issued = [];
      for (var i = 0; i < itemIds.length; i++) {
        // проверяем каждый предмет против уже выданных + выданных в этой же партии
        var r = await checkCandidateTx(tx, settings, teamId, itemIds[i], []);
        r.item.status = 'out';
        r.item.holderTeamId = teamId;
        r.item.issuedAt = now;
        await db.put(tx, 'items', r.item);
        await db.add(tx, 'operations', newOp(Object.assign({ ts: now, op: 'issue', batchId: batchId }, itemOpFields(r.item, r.type, team))));
        issued.push({ item: r.item, type: r.type });
      }
      var taken = [];
      // суммируем одинаковые расходники, если их добавили несколько раз
      var merged = {};
      consumables.forEach(function (c) { merged[c.id] = (merged[c.id] || 0) + Number(c.qty); });
      for (var cid in merged) {
        if (!Object.prototype.hasOwnProperty.call(merged, cid)) continue;
        var cons = validateConsumable(await db.get(tx, 'consumables', cid), cid, merged[cid], 0);
        cons.stock -= merged[cid];
        await db.put(tx, 'consumables', cons);
        await db.add(tx, 'operations', newOp({
          ts: now, op: 'consume', batchId: batchId, teamId: team.id, teamName: team.name,
          consumableId: cons.id, consumableName: cons.name, qty: merged[cid]
        }));
        taken.push({ consumable: cons, qty: merged[cid] });
      }
      return { team: team, issued: issued, consumables: taken, batchId: batchId };
    });
  }

  /* ---------- возврат ---------- */

  function lookupForReturn(itemId) {
    return db.run(['teams', 'toolTypes', 'items'], 'readonly', async function (tx) {
      var item = await db.get(tx, 'items', itemId);
      if (!item) throw AppError('ITEM_NOT_FOUND', 'Неизвестный инструмент (' + itemId + ').');
      var type = await db.get(tx, 'toolTypes', item.typeId);
      var team = item.holderTeamId ? await db.get(tx, 'teams', item.holderTeamId) : null;
      return { item: item, type: type, team: team };
    });
  }

  function returnItem(itemId, opts) {
    opts = opts || {};
    return db.run(['teams', 'toolTypes', 'items', 'operations'], 'readwrite', async function (tx) {
      var item = await db.get(tx, 'items', itemId);
      if (!item) throw AppError('ITEM_NOT_FOUND', 'Неизвестный инструмент (' + itemId + ').');
      if (item.status !== 'out') {
        throw AppError('NOT_OUT', '«' + item.label + '» не числится выданным — возвращать нечего.', { item: item });
      }
      var type = await db.get(tx, 'toolTypes', item.typeId);
      var team = await db.get(tx, 'teams', item.holderTeamId);
      var heldMs = Date.now() - (item.issuedAt || Date.now());
      var teamId = item.holderTeamId;
      item.status = 'in';
      item.holderTeamId = null;
      item.issuedAt = null;
      await db.put(tx, 'items', item);
      var f = itemOpFields(item, type, team || { id: teamId, name: teamId });
      await db.add(tx, 'operations', newOp(Object.assign({ op: opts.override ? 'override' : 'return', note: opts.note || '' }, f)));
      return {
        item: item, type: type, team: team, heldMs: heldMs,
        chargeReminder: !!(type && type.kind === 'battery')
      };
    });
  }

  /* ---------- передача между командами ---------- */

  /**
   * Передача выданного инструмента другой команде без возврата на склад.
   * Ответственность переходит к получателю; лимит проверяется у получателя.
   */
  function transferItem(itemId, toTeamId) {
    return db.run(['teams', 'toolTypes', 'items', 'operations', 'settings'], 'readwrite', async function (tx) {
      var settings = await db.readSettings(tx);
      var item = await db.get(tx, 'items', itemId);
      if (!item) throw AppError('ITEM_NOT_FOUND', 'Неизвестный инструмент (' + itemId + ').');
      if (item.status !== 'out') {
        throw AppError('NOT_OUT', '«' + item.label + '» не числится выданным — передавать нечего.', { item: item });
      }
      var from = await db.get(tx, 'teams', item.holderTeamId);
      var fromName = from ? from.name : item.holderTeamId;
      if (item.holderTeamId === toTeamId) {
        throw AppError('SAME_TEAM', '«' + item.label + '» уже числится за командой «' + fromName + '». Отсканируйте бейдж другой команды.', { item: item });
      }
      var to = await getActiveTeam(tx, toTeamId);
      var type = await db.get(tx, 'toolTypes', item.typeId);
      var limit = effectiveLimit(type, settings);
      var held = (await db.byIndex(tx, 'items', 'holderTeamId', toTeamId))
        .filter(function (i) { return i.status === 'out' && i.typeId === item.typeId; }).length;
      if (held + 1 > limit) {
        throw AppError('LIMIT', limitMessage(limit), { item: item, type: type, held: held, limit: limit, team: to });
      }
      var now = Date.now();
      item.holderTeamId = to.id;
      item.issuedAt = now;
      await db.put(tx, 'items', item);
      await db.add(tx, 'operations', newOp(Object.assign({
        ts: now, op: 'transfer', fromTeamId: from ? from.id : null, fromTeamName: fromName,
        note: 'от «' + fromName + '»'
      }, itemOpFields(item, type, to))));
      return { item: item, type: type, from: from || { id: null, name: fromName }, to: to };
    });
  }

  /* ---------- справочники (админ) ---------- */

  function addTeams(names) {
    names = (names || []).map(function (n) { return String(n).trim(); }).filter(Boolean);
    return db.run(['teams', 'operations'], 'readwrite', async function (tx) {
      var existing = await db.all(tx, 'teams');
      var taken = {};
      existing.forEach(function (t) { taken[t.name.toLowerCase()] = true; });
      var next = nextNumbered(existing.map(function (t) { return t.id; }), 'T', 2);
      var created = [];
      for (var i = 0; i < names.length; i++) {
        if (taken[names[i].toLowerCase()]) continue;
        taken[names[i].toLowerCase()] = true;
        var team = { id: next(), name: names[i], active: true, createdAt: Date.now() };
        await db.add(tx, 'teams', team);
        created.push(team);
      }
      return created;
    });
  }

  function updateTeam(id, patch) {
    return db.run(['teams'], 'readwrite', async function (tx) {
      var t = await db.get(tx, 'teams', id);
      if (!t) throw AppError('TEAM_NOT_FOUND', 'Команда не найдена');
      if (patch.name !== undefined) t.name = String(patch.name).trim() || t.name;
      if (patch.active !== undefined) t.active = !!patch.active;
      await db.put(tx, 'teams', t);
      return t;
    });
  }

  function addToolType(data) {
    return db.run(['toolTypes', 'settings'], 'readwrite', async function (tx) {
      var settings = await db.readSettings(tx);
      var name = String(data.name || '').trim();
      if (!name) throw AppError('BAD_INPUT', 'Укажите название типа.');
      var kind = data.kind === 'battery' ? 'battery' : 'tool';
      var base = normalizeCode(data.code) || suggestTypeCode(name);
      var id = base, n = 2;
      while (await db.get(tx, 'toolTypes', id)) id = base + n++;
      var limit = data.limit === undefined || data.limit === '' || data.limit === null
        ? (kind === 'battery' ? settings.batteryLimit : settings.defaultLimit)
        : Math.max(0, parseInt(data.limit, 10) || 0);
      var type = { id: id, name: name, kind: kind, limit: limit, createdAt: Date.now() };
      await db.add(tx, 'toolTypes', type);
      return type;
    });
  }

  function updateToolType(id, patch) {
    return db.run(['toolTypes'], 'readwrite', async function (tx) {
      var t = await db.get(tx, 'toolTypes', id);
      if (!t) throw AppError('TYPE_NOT_FOUND', 'Тип не найден');
      if (patch.name !== undefined) t.name = String(patch.name).trim() || t.name;
      if (patch.kind !== undefined) t.kind = patch.kind === 'battery' ? 'battery' : 'tool';
      if (patch.limit !== undefined) t.limit = Math.max(0, parseInt(patch.limit, 10) || 0);
      await db.put(tx, 'toolTypes', t);
      return t;
    });
  }

  /** Добавить count единиц типа. ID и QR генерируются автоматически: TSIRPIL-01, TSIRPIL-02… */
  function addItems(typeId, count, opts) {
    opts = opts || {};
    count = parseInt(count, 10);
    if (!(count >= 1 && count <= 200)) return Promise.reject(AppError('BAD_QTY', 'Количество: от 1 до 200.'));
    return db.run(['toolTypes', 'items', 'operations'], 'readwrite', async function (tx) {
      var type = await db.get(tx, 'toolTypes', typeId);
      if (!type) throw AppError('TYPE_NOT_FOUND', 'Тип не найден');
      var existing = await db.byIndex(tx, 'items', 'typeId', typeId);
      var prefix = type.id + '-';
      var next = nextNumbered(existing.map(function (i) { return i.id; }), prefix, 2);
      var created = [];
      for (var i = 0; i < count; i++) {
        var id = next();
        while (await db.get(tx, 'items', id)) id = next();
        var num = id.slice(prefix.length);
        var item = {
          id: id, typeId: type.id,
          label: (opts.labelBase ? String(opts.labelBase).trim() : type.name) + ' №' + num.replace(/^0+(?=\d)/, ''),
          note: opts.note || '',
          status: 'in', holderTeamId: null, issuedAt: null, createdAt: Date.now()
        };
        await db.add(tx, 'items', item);
        await db.add(tx, 'operations', newOp(Object.assign({ op: 'register' }, itemOpFields(item, type, null))));
        created.push(item);
      }
      return created;
    });
  }

  function updateItem(id, patch) {
    return db.run(['items', 'toolTypes', 'operations'], 'readwrite', async function (tx) {
      var item = await db.get(tx, 'items', id);
      if (!item) throw AppError('ITEM_NOT_FOUND', 'Инструмент не найден');
      if (patch.label !== undefined) item.label = String(patch.label).trim() || item.label;
      if (patch.note !== undefined) item.note = String(patch.note);
      if (patch.status !== undefined && patch.status !== item.status) {
        if (item.status === 'out') throw AppError('ITEM_OUT', 'Инструмент на руках у команды. Сначала оформите возврат.');
        if (['in', 'service', 'retired'].indexOf(patch.status) === -1) throw AppError('BAD_INPUT', 'Неверный статус');
        item.status = patch.status;
        var type = await db.get(tx, 'toolTypes', item.typeId);
        await db.add(tx, 'operations', newOp(Object.assign({ op: 'status', note: patch.status }, itemOpFields(item, type, null))));
      }
      await db.put(tx, 'items', item);
      return item;
    });
  }

  function addConsumable(data) {
    return db.run(['consumables', 'operations'], 'readwrite', async function (tx) {
      var name = String(data.name || '').trim();
      if (!name) throw AppError('BAD_INPUT', 'Укажите название расходника.');
      var existing = await db.all(tx, 'consumables');
      var id = nextNumbered(existing.map(function (c) { return c.id; }), 'C', 2)();
      var stock = Math.max(0, parseInt(data.stock, 10) || 0);
      var c = {
        id: id, name: name, unit: String(data.unit || 'шт').trim() || 'шт',
        stock: stock, lowThreshold: Math.max(0, parseInt(data.lowThreshold, 10) || 0), createdAt: Date.now()
      };
      await db.add(tx, 'consumables', c);
      if (stock) {
        await db.add(tx, 'operations', newOp({ op: 'restock', consumableId: id, consumableName: name, qty: stock, note: 'начальный остаток' }));
      }
      return c;
    });
  }

  /** delta > 0 — пополнение; mode 'set' — инвентаризация (задать фактический остаток). */
  function changeStock(id, value, mode, note) {
    return db.run(['consumables', 'operations'], 'readwrite', async function (tx) {
      var c = await db.get(tx, 'consumables', id);
      if (!c) throw AppError('CONSUMABLE_NOT_FOUND', 'Расходник не найден');
      value = parseInt(value, 10);
      if (isNaN(value)) throw AppError('BAD_QTY', 'Введите число');
      var delta = mode === 'set' ? value - c.stock : value;
      if (c.stock + delta < 0) throw AppError('BAD_QTY', 'Остаток не может быть отрицательным');
      c.stock += delta;
      await db.put(tx, 'consumables', c);
      await db.add(tx, 'operations', newOp({
        op: mode === 'set' ? 'adjust' : 'restock', consumableId: c.id, consumableName: c.name, qty: delta, note: note || ''
      }));
      return c;
    });
  }

  function updateConsumable(id, patch) {
    return db.run(['consumables'], 'readwrite', async function (tx) {
      var c = await db.get(tx, 'consumables', id);
      if (!c) throw AppError('CONSUMABLE_NOT_FOUND', 'Расходник не найден');
      if (patch.name !== undefined) c.name = String(patch.name).trim() || c.name;
      if (patch.unit !== undefined) c.unit = String(patch.unit).trim() || c.unit;
      if (patch.lowThreshold !== undefined) c.lowThreshold = Math.max(0, parseInt(patch.lowThreshold, 10) || 0);
      await db.put(tx, 'consumables', c);
      return c;
    });
  }

  /* ---------- снимок и отчёты ---------- */

  function snapshot() {
    return db.run(db.ALL_STORES, 'readonly', async function (tx) {
      return {
        teams: await db.all(tx, 'teams'),
        types: await db.all(tx, 'toolTypes'),
        items: await db.all(tx, 'items'),
        consumables: await db.all(tx, 'consumables'),
        ops: await db.all(tx, 'operations'),
        settings: await db.readSettings(tx)
      };
    });
  }

  function indexBy(arr, key) {
    var m = {};
    arr.forEach(function (x) { m[x[key]] = x; });
    return m;
  }

  function byName(a, b) { return String(a.name).localeCompare(String(b.name), 'ru'); }

  /** Что сейчас на руках: одна строка на предмет. */
  function reportHoldings(s) {
    var teams = indexBy(s.teams, 'id'), types = indexBy(s.types, 'id');
    return s.items.filter(function (i) { return i.status === 'out'; }).map(function (i) {
      var t = types[i.typeId] || {}, team = teams[i.holderTeamId] || {};
      return {
        teamId: i.holderTeamId, teamName: team.name || i.holderTeamId,
        itemId: i.id, label: i.label, typeId: i.typeId, typeName: t.name || i.typeId,
        kind: t.kind || 'tool', issuedAt: i.issuedAt
      };
    }).sort(function (a, b) {
      return String(a.teamName).localeCompare(String(b.teamName), 'ru') || a.issuedAt - b.issuedAt;
    });
  }

  /** То же, что reportHoldings, но читает только нужные хранилища (для табло на кассе). */
  function holdingsNow() {
    return db.run(['teams', 'toolTypes', 'items'], 'readonly', async function (tx) {
      return reportHoldings({
        teams: await db.all(tx, 'teams'), types: await db.all(tx, 'toolTypes'), items: await db.all(tx, 'items')
      });
    });
  }

  /** Инвентарь по типам: сколько всего, в комнате, на руках (и у кого), на обслуживании. */
  function reportInventory(s) {
    var teams = indexBy(s.teams, 'id');
    return s.types.slice().sort(byName).map(function (t) {
      var items = s.items.filter(function (i) { return i.typeId === t.id; });
      var row = {
        typeId: t.id, name: t.name, kind: t.kind, limit: effectiveLimit(t, s.settings),
        total: 0, inRoom: 0, out: 0, service: 0, retired: 0, outByTeam: {}
      };
      items.forEach(function (i) {
        if (i.status === 'retired') { row.retired++; return; }
        row.total++;
        if (i.status === 'in') row.inRoom++;
        else if (i.status === 'service') row.service++;
        else if (i.status === 'out') {
          row.out++;
          var name = (teams[i.holderTeamId] || {}).name || i.holderTeamId;
          row.outByTeam[name] = (row.outByTeam[name] || 0) + 1;
        }
      });
      return row;
    });
  }

  /** Итоги по командам: что на руках сейчас, сколько раз что брали, сколько расходников взяли. */
  function reportTeams(s) {
    var types = indexBy(s.types, 'id');
    var rows = s.teams.slice().sort(byName).map(function (team) {
      return {
        teamId: team.id, teamName: team.name, active: team.active !== false,
        onHands: [], onHandsByType: {}, issuedByType: {}, issuedTotal: 0, returnedTotal: 0,
        transferredIn: 0, transferredOut: 0, consumables: {}
      };
    });
    var byId = indexBy(rows, 'teamId');
    s.items.forEach(function (i) {
      if (i.status !== 'out' || !byId[i.holderTeamId]) return;
      var r = byId[i.holderTeamId], tn = (types[i.typeId] || {}).name || i.typeId;
      r.onHands.push({ itemId: i.id, label: i.label, typeName: tn, issuedAt: i.issuedAt });
      r.onHandsByType[tn] = (r.onHandsByType[tn] || 0) + 1;
    });
    s.ops.forEach(function (o) {
      if (o.op === 'transfer' && byId[o.fromTeamId]) byId[o.fromTeamId].transferredOut++;
      var r = byId[o.teamId];
      if (!r) return;
      if (o.op === 'issue') {
        var tn = (types[o.typeId] || {}).name || o.typeName;
        r.issuedByType[tn] = (r.issuedByType[tn] || 0) + 1;
        r.issuedTotal++;
      } else if (o.op === 'return' || o.op === 'override') {
        r.returnedTotal++;
      } else if (o.op === 'transfer') {
        r.transferredIn++;
      } else if (o.op === 'consume') {
        var cn = o.consumableName || o.consumableId;
        r.consumables[cn] = (r.consumables[cn] || 0) + o.qty;
      }
    });
    return rows;
  }

  /** Расходники: остаток, сколько выдано всего и по командам. */
  function reportConsumables(s) {
    return s.consumables.slice().sort(byName).map(function (c) {
      var row = { id: c.id, name: c.name, unit: c.unit, stock: c.stock, lowThreshold: c.lowThreshold, consumed: 0, received: 0, byTeam: {} };
      s.ops.forEach(function (o) {
        if (o.consumableId !== c.id) return;
        if (o.op === 'consume') {
          row.consumed += o.qty;
          var tn = o.teamName || o.teamId;
          row.byTeam[tn] = (row.byTeam[tn] || 0) + o.qty;
        } else if (o.op === 'restock') {
          row.received += o.qty;
        }
      });
      row.low = c.stock <= c.lowThreshold;
      return row;
    });
  }

  /* ---------- CSV ---------- */

  // «;» и BOM — чтобы русский Excel открыл файл двойным кликом без мастера импорта.
  function toCSV(rows, columns) {
    function cell(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    var lines = [columns.map(function (c) { return cell(c.title); }).join(';')];
    rows.forEach(function (r) {
      lines.push(columns.map(function (c) { return cell(typeof c.value === 'function' ? c.value(r) : r[c.value]); }).join(';'));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function fmtTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return pad(d.getDate(), 2) + '.' + pad(d.getMonth() + 1, 2) + '.' + d.getFullYear() + ' ' +
      pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }

  function fmtDuration(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + ' мин';
    return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
  }

  function mapToText(m) {
    return Object.keys(m).sort(function (a, b) { return a.localeCompare(b, 'ru'); })
      .map(function (k) { return k + ': ' + m[k]; }).join(', ');
  }

  var OP_NAMES = {
    issue: 'Выдача', 'return': 'Возврат', override: 'Возврат (админ)', consume: 'Расходник',
    transfer: 'Передача', restock: 'Пополнение', adjust: 'Инвентаризация', register: 'Добавлен', status: 'Статус'
  };

  var CSV = {
    holdings: function (s) {
      return toCSV(reportHoldings(s), [
        { title: 'Команда', value: 'teamName' }, { title: 'Тип', value: 'typeName' },
        { title: 'Инструмент', value: 'label' }, { title: 'Код', value: 'itemId' },
        { title: 'Выдан', value: function (r) { return fmtTime(r.issuedAt); } }
      ]);
    },
    operations: function (s) {
      return toCSV(s.ops.slice().sort(function (a, b) { return a.ts - b.ts || a.id - b.id; }), [
        { title: '№', value: 'id' }, { title: 'Время', value: function (o) { return fmtTime(o.ts); } },
        { title: 'Операция', value: function (o) { return OP_NAMES[o.op] || o.op; } },
        { title: 'От команды', value: 'fromTeamName' },
        { title: 'Команда', value: 'teamName' }, { title: 'Тип', value: 'typeName' },
        { title: 'Инструмент', value: 'itemLabel' }, { title: 'Код', value: 'itemId' },
        { title: 'Расходник', value: 'consumableName' }, { title: 'Кол-во', value: 'qty' },
        { title: 'Примечание', value: 'note' }
      ]);
    },
    inventory: function (s) {
      return toCSV(reportInventory(s), [
        { title: 'Тип', value: 'name' }, { title: 'Код типа', value: 'typeId' },
        { title: 'Вид', value: function (r) { return r.kind === 'battery' ? 'аккумулятор' : 'инструмент'; } },
        { title: 'Лимит на команду', value: function (r) { return r.limit === Infinity ? 'без лимита' : r.limit; } },
        { title: 'Всего', value: 'total' }, { title: 'В комнате', value: 'inRoom' },
        { title: 'На руках', value: 'out' }, { title: 'Обслуживание', value: 'service' },
        { title: 'Списано', value: 'retired' },
        { title: 'У кого', value: function (r) { return mapToText(r.outByTeam); } }
      ]);
    },
    teams: function (s) {
      return toCSV(reportTeams(s), [
        { title: 'Команда', value: 'teamName' },
        { title: 'Сейчас на руках (шт)', value: function (r) { return r.onHands.length; } },
        { title: 'Сейчас на руках', value: function (r) { return r.onHands.map(function (h) { return h.label + ' [' + h.itemId + ']'; }).join(', '); } },
        { title: 'Всего выдач', value: 'issuedTotal' }, { title: 'Всего возвратов', value: 'returnedTotal' },
        { title: 'Получили передачей', value: 'transferredIn' }, { title: 'Передали другим', value: 'transferredOut' },
        { title: 'Брали (по типам, раз)', value: function (r) { return mapToText(r.issuedByType); } },
        { title: 'Расходники', value: function (r) { return mapToText(r.consumables); } }
      ]);
    },
    consumables: function (s) {
      return toCSV(reportConsumables(s), [
        { title: 'Расходник', value: 'name' }, { title: 'Ед.', value: 'unit' },
        { title: 'Поступило', value: 'received' }, { title: 'Выдано', value: 'consumed' },
        { title: 'Остаток', value: 'stock' }, { title: 'По командам', value: function (r) { return mapToText(r.byTeam); } }
      ]);
    }
  };

  /* ---------- резервная копия ---------- */

  function exportAll() {
    return db.run(db.ALL_STORES, 'readonly', async function (tx) {
      var data = {};
      for (var i = 0; i < db.ALL_STORES.length; i++) data[db.ALL_STORES[i]] = await db.all(tx, db.ALL_STORES[i]);
      return { app: 'archbukhta-tools', format: 1, exportedAt: Date.now(), data: data };
    });
  }

  function importAll(backup) {
    if (!backup || backup.app !== 'archbukhta-tools' || !backup.data) {
      return Promise.reject(AppError('BAD_BACKUP', 'Это не файл резервной копии АрхБухты.'));
    }
    return db.run(db.ALL_STORES, 'readwrite', async function (tx) {
      for (var i = 0; i < db.ALL_STORES.length; i++) {
        var name = db.ALL_STORES[i];
        await db.req(tx.objectStore(name).clear());
        var rows = backup.data[name] || [];
        for (var j = 0; j < rows.length; j++) await db.put(tx, name, rows[j]);
      }
    });
  }

  function wipeAll(keepSettings) {
    return db.run(db.ALL_STORES, 'readwrite', async function (tx) {
      for (var i = 0; i < db.ALL_STORES.length; i++) {
        if (keepSettings && db.ALL_STORES[i] === 'settings') continue;
        await db.req(tx.objectStore(db.ALL_STORES[i]).clear());
      }
    });
  }

  AB.logic = {
    AppError: AppError,
    codeFor: codeFor, parseCode: parseCode,
    suggestTypeCode: suggestTypeCode, translit: translit,
    effectiveLimit: effectiveLimit, limitMessage: limitMessage,
    checkCandidate: checkCandidate, checkConsumable: checkConsumable,
    issue: issue, lookupForReturn: lookupForReturn, returnItem: returnItem,
    transferItem: transferItem,
    addTeams: addTeams, updateTeam: updateTeam,
    addToolType: addToolType, updateToolType: updateToolType,
    addItems: addItems, updateItem: updateItem,
    addConsumable: addConsumable, changeStock: changeStock, updateConsumable: updateConsumable,
    snapshot: snapshot,
    reportHoldings: reportHoldings, holdingsNow: holdingsNow, reportInventory: reportInventory,
    reportTeams: reportTeams, reportConsumables: reportConsumables,
    CSV: CSV, toCSV: toCSV, OP_NAMES: OP_NAMES,
    fmtTime: fmtTime, fmtDuration: fmtDuration, mapToText: mapToText,
    exportAll: exportAll, importAll: importAll, wipeAll: wipeAll
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AB.logic;
})(typeof window !== 'undefined' ? window : globalThis);
