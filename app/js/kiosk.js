/* Киоск самообслуживания: выдача и возврат. Экран — конечный автомат:
 *   idle → cart(команда) → consumables → done → idle
 *   idle → returnConfirm(предмет) → returned → idle
 */
(function (root) {
  'use strict';
  var AB = root.AB, L = AB.logic, ui = AB.ui, fb = AB.feedback, esc = ui.esc;

  var settings = AB.db.DEFAULT_SETTINGS;
  var state = { screen: 'idle' };
  var timers = { idle: null, tick: null, toast: null, back: null };
  var deadline = 0;
  var scanner = null;
  var busy = false;

  var screenEl = ui.$('#screen');

  /* ---------- общие помощники ---------- */

  function setScreen(next) {
    state = next;
    hideToast();
    render();
  }

  function hideToast() {
    clearTimeout(timers.toast);
    ui.$('#toast').classList.remove('show');
  }

  function goIdle() {
    clearTimeout(timers.back);
    deadline = 0;
    setScreen({ screen: 'idle' });
    closeModal();
    if (scanner) scanner.resetDebounce();
  }

  /** Через ms мс вернуться на стартовый экран (для экранов-результатов). */
  function backToIdleIn(ms) {
    clearTimeout(timers.back);
    timers.back = setTimeout(goIdle, ms);
  }

  function touch() {
    if (state.screen === 'cart' || state.screen === 'consumables') {
      deadline = Date.now() + settings.cartTimeoutSec * 1000;
    } else if (state.screen === 'returnConfirm') {
      deadline = Date.now() + 25000;
    } else {
      deadline = 0;
    }
    renderCountdown();
  }

  function renderCountdown() {
    var el = ui.$('#countdown');
    if (!el) return;
    if (!deadline) { el.textContent = ''; return; }
    var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = left <= 15 ? 'Отмена через ' + left + ' с — нажмите любую кнопку, чтобы продолжить' : '';
    el.classList.toggle('urgent', left <= 15);
  }

  function onTick() {
    if (deadline && Date.now() >= deadline) {
      toast('warn', 'Время вышло — операция отменена.');
      goIdle();
      return;
    }
    renderCountdown();
  }

  function toast(kind, text, ms) {
    var el = ui.$('#toast');
    el.className = 'toast toast-' + kind + ' show';
    el.innerHTML = esc(text);
    clearTimeout(timers.toast);
    timers.toast = setTimeout(function () { el.classList.remove('show'); }, ms || (kind === 'error' ? 5000 : 3000));
  }

  function fail(err) {
    console.warn(err);
    fb.error();
    toast('error', err && err.message ? err.message : String(err), err && err.code === 'LIMIT' ? 7000 : 5000);
  }

  /* ---------- обработка сканов ---------- */

  async function onScan(text) {
    if (busy) return;
    var code = L.parseCode(text);
    if (!code) {
      fail(new Error('Код не распознан: это не QR АрхБухты.'));
      return;
    }
    busy = true;
    fb.scan();
    try {
      if (code.kind === 'team') await scanTeam(code.id);
      else if (code.kind === 'item') await scanItem(code.id);
      else if (code.kind === 'consumable') await scanConsumable(code.id);
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      touch();
    }
  }

  async function scanTeam(teamId) {
    var team = await AB.db.getOne('teams', teamId);
    if (!team) throw new Error('Неизвестная команда (' + teamId + '). Обратитесь к организаторам.');
    if (team.active === false) throw new Error('Команда «' + team.name + '» отключена. Обратитесь к организаторам.');
    if (state.screen === 'cart' || state.screen === 'consumables') {
      if (state.team.id === teamId) { toast('info', 'Корзина команды «' + team.name + '» уже открыта.'); return; }
      if (state.cart.length || state.consumables.length) {
        throw new Error('Сейчас открыта корзина команды «' + state.team.name + '». Нажмите «Выдать» или «Отмена».');
      }
    }
    closeModal();
    clearTimeout(timers.back);
    fb.ok();
    await openCart(team);
  }

  async function openCart(team) {
    var held = L.reportHoldings(await L.snapshot()).filter(function (h) { return h.teamId === team.id; });
    setScreen({ screen: 'cart', team: team, cart: [], consumables: [], held: held });
  }

  async function scanItem(itemId) {
    if (state.screen === 'cart' || state.screen === 'consumables') {
      var cartIds = state.cart.map(function (c) { return c.item.id; });
      var r = await L.checkCandidate(state.team.id, itemId, cartIds);
      state.cart.push({ item: r.item, type: r.type });
      state.screen = 'cart';
      hideToast();
      fb.ok();
      render();
      return;
    }
    // вне корзины скан инструмента = возврат
    var info = await L.lookupForReturn(itemId);
    if (info.item.status !== 'out') {
      fb.warn();
      toast('warn', '«' + info.item.label + '» не выдан, он числится в комнате. Чтобы взять его, сначала отсканируйте бейдж команды.', 5000);
      return;
    }
    clearTimeout(timers.back);
    closeModal();
    fb.ok();
    setScreen({ screen: 'returnConfirm', item: info.item, type: info.type, team: info.team });
  }

  async function scanConsumable(consumableId) {
    if (state.screen !== 'cart' && state.screen !== 'consumables') {
      fb.warn();
      toast('warn', 'Чтобы взять расходники, сначала отсканируйте бейдж команды.');
      return;
    }
    var c = await AB.db.getOne('consumables', consumableId);
    if (!c) throw new Error('Неизвестный расходник (' + consumableId + ').');
    fb.ok();
    askQty(c);
  }

  /* ---------- действия ---------- */

  function removeFromCart(itemId) {
    state.cart = state.cart.filter(function (c) { return c.item.id !== itemId; });
    render();
  }

  function removeConsumable(id) {
    state.consumables = state.consumables.filter(function (c) { return c.consumable.id !== id; });
    render();
  }

  async function goNext() {
    var all = (await AB.db.getAll('consumables')).filter(function (c) { return c.stock > 0; });
    // шаг расходников показываем, только если на складе что-то есть
    if (state.screen === 'cart' && all.length) {
      state.screen = 'consumables';
      state.available = all;
      render();
      return;
    }
    await doIssue();
  }

  async function doIssue() {
    if (busy) return;
    if (!state.cart.length && !state.consumables.length) {
      fail(new Error('Корзина пуста. Отсканируйте инструмент или выберите расходники.'));
      return;
    }
    busy = true;
    try {
      var res = await L.issue(state.team.id,
        state.cart.map(function (c) { return c.item.id; }),
        state.consumables.map(function (c) { return { id: c.consumable.id, qty: c.qty }; }));
      fb.done();
      setScreen({ screen: 'done', result: res });
      backToIdleIn(6000);
    } catch (e) {
      fail(e);
      // состояние могло измениться (кто-то вернул/взял) — перечитываем «на руках»
      if (state.team) state.held = L.reportHoldings(await L.snapshot()).filter(function (h) { return h.teamId === state.team.id; });
      render();
    } finally {
      busy = false;
    }
  }

  async function doReturn() {
    if (busy) return;
    busy = true;
    try {
      var r = await L.returnItem(state.item.id);
      if (r.chargeReminder) fb.warn(); else fb.done();
      setScreen({ screen: 'returned', result: r });
      backToIdleIn(r.chargeReminder ? 10000 : 5000);
    } catch (e) {
      fail(e);
      goIdle();
    } finally {
      busy = false;
    }
  }

  /* ---------- модальные окна ---------- */

  function openModal(html, onMount) {
    var m = ui.$('#modal');
    m.innerHTML = '<div class="modal-box">' + html + '</div>';
    m.hidden = false;
    if (onMount) onMount(m);
  }

  function closeModal() {
    var m = ui.$('#modal');
    m.hidden = true;
    m.innerHTML = '';
  }

  function askQty(c) {
    var already = state.consumables.filter(function (x) { return x.consumable.id === c.id; })[0];
    var value = '';
    openModal(
      '<h2>' + esc(c.name) + '</h2>' +
      '<p class="muted">Осталось: <b>' + c.stock + ' ' + esc(c.unit) + '</b>' +
      (already ? ' · уже в корзине: ' + already.qty : '') + '</p>' +
      '<div class="qty-display" id="qty-val">0</div>' +
      '<div class="numpad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, '⌫'].map(function (k) {
        return '<button class="key" data-k="' + k + '">' + k + '</button>';
      }).join('') + '</div>' +
      '<div class="row">' +
      '<button class="btn btn-ghost" data-act="cancel">Отмена</button>' +
      '<button class="btn btn-go" data-act="ok">Добавить</button></div>',
      function (m) {
        var disp = ui.$('#qty-val', m);
        function upd() { disp.textContent = value || '0'; }
        function press(k) {
          if (k === 'C') value = '';
          else if (k === '⌫') value = value.slice(0, -1);
          else if (value.length < 4) value = (value + k).replace(/^0+/, '');
          upd();
          touch();
        }
        async function ok() {
          try {
            var qty = parseInt(value, 10) || 0;
            await L.checkConsumable(c.id, qty, already ? already.qty : 0);
            if (already) already.qty += qty;
            else state.consumables.push({ consumable: c, qty: qty });
            closeModal();
            fb.ok();
            render();
          } catch (e) { fail(e); }
        }
        m.onclick = function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.k !== undefined) press(b.dataset.k);
          else if (b.dataset.act === 'cancel') closeModal();
          else if (b.dataset.act === 'ok') ok();
        };
        m.onkeydown = function (e) {
          if (/^[0-9]$/.test(e.key)) press(e.key);
          else if (e.key === 'Backspace') press('⌫');
          else if (e.key === 'Enter') ok();
          else if (e.key === 'Escape') closeModal();
        };
        m.tabIndex = -1;
        m.focus();
      });
  }

  function askManual() {
    openModal(
      '<h2>Ввести код вручную</h2>' +
      '<p class="muted">Код написан под QR: например <b>T01</b>, <b>TSIRPIL-03</b>, <b>C02</b> или полностью <b>AB:I:TSIRPIL-03</b>.</p>' +
      '<input id="manual-code" class="input-big" autocomplete="off" spellcheck="false">' +
      '<div class="row"><button class="btn btn-ghost" data-act="cancel">Отмена</button>' +
      '<button class="btn btn-go" data-act="ok">OK</button></div>',
      function (m) {
        var inp = ui.$('#manual-code', m);
        inp.focus();
        async function ok() {
          var raw = inp.value.trim().toUpperCase();
          if (!raw) return;
          var text = raw;
          if (!L.parseCode(raw)) {
            // без префикса — ищем, что это за код
            if (await AB.db.getOne('items', raw)) text = L.codeFor('item', raw);
            else if (await AB.db.getOne('teams', raw)) text = L.codeFor('team', raw);
            else if (await AB.db.getOne('consumables', raw)) text = L.codeFor('consumable', raw);
          }
          closeModal();
          onScan(text);
        }
        m.onclick = function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.act === 'cancel') closeModal();
          else if (b.dataset.act === 'ok') ok();
        };
        inp.onkeydown = function (e) { if (e.key === 'Enter') ok(); if (e.key === 'Escape') closeModal(); };
      });
  }

  /* ---------- отрисовка ---------- */

  function cartTypeCounts() {
    var m = {};
    state.held.forEach(function (h) { m[h.typeId] = (m[h.typeId] || 0) + 1; });
    state.cart.forEach(function (c) { m[c.item.typeId] = (m[c.item.typeId] || 0) + 1; });
    return m;
  }

  function render() {
    var s = state, html = '';
    document.body.dataset.screen = s.screen;

    if (s.screen === 'idle') {
      html =
        '<div class="idle">' +
        '<div class="hint hint-take"><div class="hint-icon">🪪</div><div><h2>Взять инструмент</h2>' +
        '<p>Поднесите к камере <b>бейдж команды</b></p></div></div>' +
        '<div class="hint hint-return"><div class="hint-icon">🔧</div><div><h2>Вернуть инструмент</h2>' +
        '<p>Поднесите к камере <b>QR на инструменте или аккумуляторе</b></p></div></div>' +
        '<p class="muted center">Передавать инструмент другой команде из рук в руки нельзя: сначала верните его сюда.</p>' +
        '</div>';
    }

    else if (s.screen === 'cart') {
      var counts = cartTypeCounts();
      html =
        '<div class="panel panel-team">' +
        '<div class="team-head"><span class="muted">Корзина команды</span><h1>' + esc(s.team.name) + '</h1></div>' +
        '<p class="instr">Сканируйте QR на каждом инструменте и аккумуляторе, затем нажмите <b>«Далее»</b>.</p>' +
        '<ul class="cart-list">' +
        (s.cart.length ? s.cart.map(function (c) {
          var lim = L.effectiveLimit(c.type, settings);
          return '<li><span class="ico">' + (c.type && c.type.kind === 'battery' ? '🔋' : '🛠') + '</span>' +
            '<span class="name">' + esc(c.item.label) + '<small>' + esc(c.item.id) +
            (lim !== Infinity ? ' · будет на руках ' + counts[c.item.typeId] + ' из ' + lim : '') + '</small></span>' +
            '<button class="btn-x" data-remove="' + esc(c.item.id) + '" aria-label="Убрать">✕</button></li>';
        }).join('') : '<li class="empty">Пока пусто: поднесите инструмент к камере</li>') +
        s.consumables.map(function (c) {
          return '<li><span class="ico">📦</span><span class="name">' + esc(c.consumable.name) +
            '<small>' + c.qty + ' ' + esc(c.consumable.unit) + '</small></span>' +
            '<button class="btn-x" data-remove-c="' + esc(c.consumable.id) + '" aria-label="Убрать">✕</button></li>';
        }).join('') +
        '</ul>' +
        (s.held.length ? '<details class="held"><summary>Уже на руках у команды: ' + s.held.length + ' шт.</summary><ul>' +
          s.held.map(function (h) { return '<li>' + esc(h.label) + ' <small class="muted">с ' + L.fmtTime(h.issuedAt).slice(-5) + '</small></li>'; }).join('') +
          '</ul></details>' : '') +
        '<div class="actions">' +
        '<button class="btn btn-ghost" data-act="cancel">Отмена</button>' +
        '<button class="btn btn-go" data-act="next">Далее →</button>' +
        '</div><div id="countdown"></div></div>';
    }

    else if (s.screen === 'consumables') {
      html =
        '<div class="panel panel-team">' +
        '<div class="team-head"><span class="muted">Команда</span><h1>' + esc(s.team.name) + '</h1></div>' +
        '<h2>Берёте расходники?</h2><p class="instr">Нажмите на нужный и введите количество. Если не нужны — нажмите <b>«Выдать»</b>.</p>' +
        '<div class="cons-grid">' + s.available.map(function (c) {
          var inCart = s.consumables.filter(function (x) { return x.consumable.id === c.id; })[0];
          return '<button class="cons" data-cons="' + esc(c.id) + '"><b>' + esc(c.name) + '</b>' +
            '<small>есть ' + c.stock + ' ' + esc(c.unit) + '</small>' +
            (inCart ? '<span class="badge">+' + inCart.qty + '</span>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="summary">' + summaryText() + '</div>' +
        '<div class="actions">' +
        '<button class="btn btn-ghost" data-act="back">← Назад</button>' +
        '<button class="btn btn-go" data-act="issue">' + (s.consumables.length ? 'Выдать' : 'Без расходников — выдать') + '</button>' +
        '</div><div id="countdown"></div></div>';
    }

    else if (s.screen === 'done') {
      var r = s.result;
      html =
        '<div class="panel panel-ok"><div class="big-icon">✅</div>' +
        '<h1>Выдано команде «' + esc(r.team.name) + '»</h1><ul class="result-list">' +
        r.issued.map(function (x) { return '<li>' + esc(x.item.label) + '</li>'; }).join('') +
        r.consumables.map(function (x) { return '<li>' + esc(x.consumable.name) + ': ' + x.qty + ' ' + esc(x.consumable.unit) + '</li>'; }).join('') +
        '</ul><p>Инструмент числится за вашей командой, пока вы не вернёте его сюда.</p>' +
        '<button class="btn btn-ghost" data-act="home">Готово</button></div>';
    }

    else if (s.screen === 'returnConfirm') {
      var held = s.item.issuedAt ? L.fmtDuration(Date.now() - s.item.issuedAt) : '';
      html =
        '<div class="panel panel-return"><span class="muted">Возврат</span>' +
        '<h1>' + (s.type && s.type.kind === 'battery' ? '🔋 ' : '🛠 ') + esc(s.item.label) + '</h1>' +
        '<p class="big">Числится за командой <b>«' + esc(s.team ? s.team.name : s.item.holderTeamId) + '»</b>' +
        (held ? '<br><span class="muted">на руках ' + held + '</span>' : '') + '</p>' +
        '<div class="actions">' +
        '<button class="btn btn-ghost" data-act="cancel">Отмена</button>' +
        '<button class="btn btn-go" data-act="return">Вернуть</button>' +
        '</div><div id="countdown"></div></div>';
    }

    else if (s.screen === 'returned') {
      var rr = s.result;
      html =
        '<div class="panel ' + (rr.chargeReminder ? 'panel-warn' : 'panel-ok') + '">' +
        '<div class="big-icon">' + (rr.chargeReminder ? '🔌' : '✅') + '</div>' +
        '<h1>Возвращено: ' + esc(rr.item.label) + '</h1>' +
        '<p>Снято с команды «' + esc(rr.team ? rr.team.name : '') + '».</p>' +
        (rr.chargeReminder ? '<div class="charge">⚡ Поставьте аккумулятор на зарядку!</div>' : '<p>Положите инструмент на место.</p>') +
        '<button class="btn btn-ghost" data-act="home">' + (rr.chargeReminder ? 'Поставил(а) на зарядку' : 'Готово') + '</button></div>';
    }

    screenEl.innerHTML = html;
    renderCountdown();
  }

  function summaryText() {
    var parts = [];
    if (state.cart.length) parts.push('Инструменты: ' + state.cart.length + ' шт.');
    state.consumables.forEach(function (c) { parts.push(esc(c.consumable.name) + ': ' + c.qty + ' ' + esc(c.consumable.unit)); });
    return parts.length ? 'В корзине — ' + parts.join(' · ') : '';
  }

  /* ---------- события ---------- */

  screenEl.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    fb.unlock();
    touch();
    if (b.dataset.remove) return removeFromCart(b.dataset.remove);
    if (b.dataset.removeC) return removeConsumable(b.dataset.removeC);
    if (b.dataset.cons) {
      var c = state.available.filter(function (x) { return x.id === b.dataset.cons; })[0];
      return c && askQty(c);
    }
    switch (b.dataset.act) {
      case 'cancel': return goIdle();
      case 'home': return goIdle();
      case 'next': return goNext().catch(fail);
      case 'back': state.screen = 'cart'; return render();
      case 'issue': return doIssue();
      case 'return': return doReturn();
    }
  });

  document.addEventListener('pointerdown', function () { touch(); }, true);

  ui.$('#btn-manual').addEventListener('click', function () { fb.unlock(); askManual(); });

  ui.$('#btn-fullscreen').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(function () {});
  });

  ui.$('#start-overlay').addEventListener('click', function () {
    fb.unlock();
    fb.play('ok');
    ui.$('#start-overlay').hidden = true;
    document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(function () {});
  });

  function clock() {
    var d = new Date();
    ui.$('#clock').textContent = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  /* ---------- запуск ---------- */

  async function init() {
    ui.registerSW();
    // просим браузер не вычищать базу при нехватке места
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    try {
      settings = await AB.db.getSettings();
    } catch (e) {
      toast('error', 'База данных недоступна: ' + e.message, 60000);
      return;
    }
    fb.setEnabled(settings.soundOn !== false);
    ui.$('#brand-name').textContent = settings.eventName || 'АрхБухта';
    var snap = await L.snapshot();
    if (!snap.teams.length || !snap.items.length) {
      ui.$('#setup-hint').hidden = false;
    }
    render();
    clock();
    setInterval(clock, 10000);
    timers.tick = setInterval(onTick, 500);
    scanner = new AB.Scanner(ui.$('#video'), onScan, function (kind, msg) {
      var st = ui.$('#cam-status');
      st.textContent = msg;
      st.className = 'cam-status ' + kind;
    });
    scanner.start();
    // настройки могли поменяться в админке в соседней вкладке
    document.addEventListener('visibilitychange', async function () {
      if (!document.hidden) settings = await AB.db.getSettings();
    });
  }

  init();
})(window);
