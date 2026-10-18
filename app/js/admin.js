/* Админ-экран: на руках, итоги, журнал, инвентарь + QR, команды, расходники, настройки. */
(function (root) {
  'use strict';
  var AB = root.AB, L = AB.logic, ui = AB.ui, esc = ui.esc;

  var view = ui.$('#view');
  var current = 'holdings';
  var snap = null;
  var lastCreated = null; // { title, url } — ссылка на печать QR для только что добавленного
  var logFilter = { q: '', op: '' };
  var toastTimer = null;

  function toast(kind, text) {
    var el = ui.$('#toast');
    el.className = 'toast toast-' + kind + ' show';
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, kind === 'error' ? 5000 : 2500);
  }

  async function refresh() {
    snap = await L.snapshot();
    render();
  }

  function render() {
    ui.$$('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === current); });
    view.innerHTML = VIEWS[current]();
    if (current === 'log') {
      var q = ui.$('#log-q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
  }

  function csvButton(kind, title) {
    return '<button class="btn btn-ghost" data-act="csv" data-kind="' + kind + '">⬇ ' + esc(title) + '</button>';
  }

  function limitText(l) { return l === Infinity ? 'без лимита' : l + ' шт'; }

  function qrMini(kind, id) {
    return '<span class="qr-mini">' + ui.qrSvg(L.codeFor(kind, id), 2) + '</span>';
  }

  function labelsUrl(params) {
    return 'labels.html?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  }

  function backupWarning() {
    var last = snap.settings.lastBackupAt;
    var hasData = snap.ops.length > 0;
    if (!hasData) return '';
    if (!last || Date.now() - last > 3 * 3600 * 1000) {
      return '<div class="card debt">💾 Резервная копия ' + (last ? 'делалась ' + L.fmtTime(last) : 'ещё не делалась') +
        '. Данные хранятся только в этом браузере — <button class="btn btn-ghost btn-small" data-act="backup">скачать копию</button></div>';
    }
    return '';
  }

  /* ================= ВКЛАДКИ ================= */

  var VIEWS = {};

  VIEWS.holdings = function () {
    var rows = L.reportHoldings(snap);
    var inv = L.reportInventory(snap);
    var inRoom = inv.reduce(function (s, r) { return s + r.inRoom; }, 0);
    var teamsWith = {};
    rows.forEach(function (r) { teamsWith[r.teamId] = true; });
    var low = L.reportConsumables(snap).filter(function (c) { return c.low; });

    var html = backupWarning() +
      '<div class="stats">' +
      '<div class="stat"><span class="muted">На руках</span><b>' + rows.length + '</b></div>' +
      '<div class="stat"><span class="muted">Команд с инструментом</span><b>' + Object.keys(teamsWith).length + '</b></div>' +
      '<div class="stat"><span class="muted">В комнате</span><b>' + inRoom + '</b></div>' +
      '<div class="stat ' + (low.length ? 'warn' : '') + '"><span class="muted">Расходники на исходе</span><b>' + low.length + '</b></div>' +
      '</div>' +
      '<div class="toolbar"><h2 style="margin:0">Сейчас на руках</h2><span class="spacer"></span>' +
      '<button class="btn btn-ghost" data-act="refresh">↻ Обновить</button>' + csvButton('holdings', 'CSV') + '</div>';

    if (!rows.length) return html + '<div class="card clear">Всё в комнате — на руках ничего нет.</div>';

    html += '<table><thead><tr><th>Инструмент</th><th>Тип</th><th>Код</th><th>Выдан</th><th>На руках</th><th></th></tr></thead><tbody>';
    var lastTeam = null;
    rows.forEach(function (r) {
      if (r.teamId !== lastTeam) {
        var n = rows.filter(function (x) { return x.teamId === r.teamId; }).length;
        html += '<tr class="group"><td colspan="6">' + esc(r.teamName) + ' — ' + n + ' шт.</td></tr>';
        lastTeam = r.teamId;
      }
      html += '<tr><td>' + (r.kind === 'battery' ? '🔋 ' : '') + esc(r.label) + '</td><td>' + esc(r.typeName) + '</td>' +
        '<td><code>' + esc(r.itemId) + '</code></td><td>' + L.fmtTime(r.issuedAt) + '</td>' +
        '<td>' + L.fmtDuration(Date.now() - r.issuedAt) + '</td>' +
        '<td><button class="btn btn-ghost btn-small" data-act="force-return" data-id="' + esc(r.itemId) + '">Вернуть</button></td></tr>';
    });
    if (low.length) {
      html += '</tbody></table><h2 class="section">Расходники на исходе</h2><table><tbody>' +
        low.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class="num"><span class="pill low">' + c.stock + ' ' + esc(c.unit) + '</span></td></tr>'; }).join('');
    }
    return html + '</tbody></table>';
  };

  VIEWS.summary = function () {
    var inv = L.reportInventory(snap), teams = L.reportTeams(snap), cons = L.reportConsumables(snap);
    var sum = function (k) { return inv.reduce(function (s, r) { return s + r[k]; }, 0); };
    var debtors = teams.filter(function (t) { return t.onHands.length; });

    var html =
      '<div class="toolbar"><h2 style="margin:0">Итоги конкурса</h2><span class="spacer"></span>' +
      '<button class="btn btn-ghost" data-act="print">🖨 Печать / PDF</button>' +
      csvButton('teams', 'По командам') + csvButton('inventory', 'Инвентарь') +
      csvButton('consumables', 'Расходники') + csvButton('operations', 'Журнал') +
      '<button class="btn btn-go" data-act="csv-all">⬇ Скачать всё</button></div>' +
      '<p class="muted">Отчёт на ' + L.fmtTime(Date.now()) + '</p>' +
      '<div class="stats">' +
      '<div class="stat"><span class="muted">Всего единиц</span><b>' + sum('total') + '</b></div>' +
      '<div class="stat"><span class="muted">В комнате</span><b>' + sum('inRoom') + '</b></div>' +
      '<div class="stat ' + (sum('out') ? 'warn' : '') + '"><span class="muted">Не возвращено</span><b>' + sum('out') + '</b></div>' +
      '<div class="stat"><span class="muted">На обслуживании</span><b>' + sum('service') + '</b></div>' +
      '</div>';

    html += '<h2 class="section">Кто не вернул</h2>';
    html += debtors.length ? '<div class="cards">' + debtors.map(function (t) {
      return '<div class="card debt"><h3>' + esc(t.teamName) + ' — ' + t.onHands.length + ' шт.</h3><ul>' +
        t.onHands.map(function (h) { return '<li>' + esc(h.label) + ' <code>' + esc(h.itemId) + '</code> <span class="muted">с ' + L.fmtTime(h.issuedAt) + '</span></li>'; }).join('') +
        '</ul></div>';
    }).join('') + '</div>' : '<div class="card clear">✅ Все инструменты возвращены.</div>';

    html += '<h2 class="section">Инструмент по типам</h2><table><thead><tr><th>Тип</th><th class="num">Всего</th>' +
      '<th class="num">В комнате</th><th class="num">На руках</th><th>У кого</th><th class="num">Ремонт</th><th class="num">Списано</th></tr></thead><tbody>' +
      inv.map(function (r) {
        return '<tr><td>' + (r.kind === 'battery' ? '🔋 ' : '') + esc(r.name) + '</td><td class="num">' + r.total + '</td>' +
          '<td class="num">' + r.inRoom + '</td><td class="num">' + r.out + '</td><td>' + esc(L.mapToText(r.outByTeam)) + '</td>' +
          '<td class="num">' + r.service + '</td><td class="num">' + r.retired + '</td></tr>';
      }).join('') + '</tbody></table>';

    html += '<h2 class="section">По командам</h2><table><thead><tr><th>Команда</th><th class="num">На руках</th>' +
      '<th>Что брали (раз)</th><th class="num">Выдач</th><th class="num">Возвратов</th>' +
      '<th class="num">Получили передачей</th><th class="num">Передали</th><th>Расходники</th></tr></thead><tbody>' +
      teams.map(function (t) {
        return '<tr><td>' + esc(t.teamName) + '</td><td class="num">' + (t.onHands.length ? '<span class="pill out">' + t.onHands.length + '</span>' : '0') + '</td>' +
          '<td>' + esc(L.mapToText(t.issuedByType)) + '</td><td class="num">' + t.issuedTotal + '</td><td class="num">' + t.returnedTotal + '</td>' +
          '<td class="num">' + t.transferredIn + '</td><td class="num">' + t.transferredOut + '</td>' +
          '<td>' + esc(L.mapToText(t.consumables)) + '</td></tr>';
      }).join('') + '</tbody></table>';

    html += '<h2 class="section">Расходники</h2><table><thead><tr><th>Расходник</th><th class="num">Поступило</th>' +
      '<th class="num">Выдано</th><th class="num">Остаток</th><th>По командам</th></tr></thead><tbody>' +
      cons.map(function (c) {
        return '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.received + ' ' + esc(c.unit) + '</td>' +
          '<td class="num">' + c.consumed + '</td><td class="num">' + c.stock + '</td><td>' + esc(L.mapToText(c.byTeam)) + '</td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  };

  VIEWS.log = function () {
    var q = logFilter.q.toLowerCase();
    var ops = snap.ops.slice().sort(function (a, b) { return b.ts - a.ts || b.id - a.id; }).filter(function (o) {
      if (logFilter.op && o.op !== logFilter.op) return false;
      if (!q) return true;
      return [o.teamName, o.fromTeamName, o.itemLabel, o.itemId, o.typeName, o.consumableName, o.note].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    var shown = ops.slice(0, 1000);
    return '<div class="toolbar"><input id="log-q" placeholder="Поиск: команда, инструмент, код…" value="' + esc(logFilter.q) + '" style="min-width:300px">' +
      '<select id="log-op"><option value="">Все операции</option>' +
      Object.keys(L.OP_NAMES).map(function (k) { return '<option value="' + k + '"' + (logFilter.op === k ? ' selected' : '') + '>' + L.OP_NAMES[k] + '</option>'; }).join('') +
      '</select><span class="muted">' + ops.length + ' записей' + (ops.length > shown.length ? ' (показаны последние 1000)' : '') + '</span>' +
      '<span class="spacer"></span>' + csvButton('operations', 'CSV — весь журнал') + '</div>' +
      '<table><thead><tr><th>Время</th><th>Операция</th><th>Команда</th><th>Инструмент / расходник</th><th class="num">Кол-во</th><th>Примечание</th></tr></thead><tbody>' +
      shown.map(function (o) {
        return '<tr><td>' + L.fmtTime(o.ts) + '</td><td>' + esc(L.OP_NAMES[o.op] || o.op) + '</td><td>' +
          (o.op === 'transfer' ? esc(o.fromTeamName || '') + ' → <b>' + esc(o.teamName || '') + '</b>' : esc(o.teamName || '')) + '</td>' +
          '<td>' + esc(o.itemLabel || o.consumableName || '') + (o.itemId ? ' <code>' + esc(o.itemId) + '</code>' : '') + '</td>' +
          '<td class="num">' + (o.qty === null || o.qty === undefined ? '' : o.qty) + '</td><td>' + esc(o.note || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  };

  VIEWS.inventory = function () {
    var inv = L.reportInventory(snap);
    var html = '';
    if (lastCreated) {
      html += '<div class="card clear">✅ ' + esc(lastCreated.title) + ' <a class="btn btn-go" target="_blank" href="' + esc(lastCreated.url) + '">🖨 Печать QR для новых</a></div>';
    }
    html += '<div class="card"><h3>Добавить новый тип инструмента</h3>' +
      '<div class="form-row">' +
      '<label class="field">Название<input id="nt-name" placeholder="Циркулярная пила" style="min-width:240px"></label>' +
      '<label class="field">Вид<select id="nt-kind"><option value="tool">Инструмент</option><option value="battery">Аккумулятор (напомнить о зарядке)</option></select></label>' +
      '<label class="field">Код (необязательно)<input id="nt-code" placeholder="авто" style="width:130px"></label>' +
      '<label class="field">Лимит на команду<input id="nt-limit" type="number" min="0" placeholder="' + snap.settings.defaultLimit + '"></label>' +
      '<label class="field">Сколько штук<input id="nt-count" type="number" min="0" max="200" value="1"></label>' +
      '<button class="btn btn-go" data-act="add-type">Создать и сделать QR</button></div>' +
      '<p class="muted">QR-коды генерируются автоматически и офлайн. Лимит 0 — без лимита. Новую единицу существующего типа добавляйте кнопкой «+» в таблице.</p></div>';

    html += '<div class="toolbar"><h2 style="margin:0">Типы и единицы</h2><span class="spacer"></span>' +
      '<a class="btn btn-ghost" target="_blank" href="' + labelsUrl({ items: 'all' }) + '">🖨 QR всех инструментов</a>' +
      csvButton('inventory', 'CSV') + '</div>';

    if (!inv.length) return html + '<div class="card">Пока нет ни одного типа. Добавьте первый выше.</div>';

    html += '<table><thead><tr><th>Тип</th><th>Код</th><th>Вид</th><th>Лимит</th><th class="num">Всего</th><th class="num">В комнате</th><th class="num">На руках</th><th>Добавить</th><th></th></tr></thead><tbody>';
    inv.forEach(function (r) {
      var type = snap.types.filter(function (t) { return t.id === r.typeId; })[0];
      var items = snap.items.filter(function (i) { return i.typeId === r.typeId; }).sort(function (a, b) { return a.id.localeCompare(b.id); });
      html += '<tr><td><input class="inline-edit" data-edit="type-name" data-id="' + esc(r.typeId) + '" value="' + esc(r.name) + '">' +
        '<details class="type-items"><summary>' + items.length + ' шт. — показать</summary>' + itemsTable(items) + '</details></td>' +
        '<td><code>' + esc(r.typeId) + '</code></td>' +
        '<td><select data-edit="type-kind" data-id="' + esc(r.typeId) + '"><option value="tool"' + (type.kind !== 'battery' ? ' selected' : '') + '>инструмент</option>' +
        '<option value="battery"' + (type.kind === 'battery' ? ' selected' : '') + '>аккумулятор</option></select></td>' +
        '<td><input type="number" min="0" data-edit="type-limit" data-id="' + esc(r.typeId) + '" value="' + (type.limit || 0) + '" title="0 — без лимита"></td>' +
        '<td class="num">' + r.total + '</td><td class="num">' + r.inRoom + '</td><td class="num">' + r.out + '</td>' +
        '<td><input type="number" min="1" max="200" value="1" id="add-n-' + esc(r.typeId) + '"> <button class="btn btn-ghost btn-small" data-act="add-items" data-id="' + esc(r.typeId) + '">+</button></td>' +
        '<td><a class="btn btn-ghost btn-small" target="_blank" href="' + labelsUrl({ type: r.typeId }) + '">QR</a></td></tr>';
    });
    return html + '</tbody></table>';
  };

  var STATUS_NAMES = { 'in': 'в комнате', out: 'на руках', service: 'обслуживание', retired: 'списан' };

  function itemsTable(items) {
    var teams = {};
    snap.teams.forEach(function (t) { teams[t.id] = t.name; });
    return '<table><tbody>' + items.map(function (i) {
      var status = i.status === 'out'
        ? '<span class="pill out">у «' + esc(teams[i.holderTeamId] || i.holderTeamId) + '»</span>'
        : '<select data-edit="item-status" data-id="' + esc(i.id) + '">' + ['in', 'service', 'retired'].map(function (s) {
          return '<option value="' + s + '"' + (i.status === s ? ' selected' : '') + '>' + STATUS_NAMES[s] + '</option>';
        }).join('') + '</select>';
      return '<tr><td>' + qrMini('item', i.id) + '</td><td><code>' + esc(i.id) + '</code></td>' +
        '<td><input class="inline-edit" data-edit="item-label" data-id="' + esc(i.id) + '" value="' + esc(i.label) + '"></td>' +
        '<td>' + status + '</td>' +
        '<td><a class="btn btn-ghost btn-small" target="_blank" href="' + labelsUrl({ items: i.id }) + '">QR</a></td></tr>';
    }).join('') + '</tbody></table>';
  }

  VIEWS.teams = function () {
    var rep = {};
    L.reportTeams(snap).forEach(function (t) { rep[t.teamId] = t; });
    var teams = snap.teams.slice().sort(function (a, b) { return a.id.localeCompare(b.id); });
    var html = '';
    if (lastCreated && lastCreated.kind === 'teams') {
      html += '<div class="card clear">✅ ' + esc(lastCreated.title) + ' <a class="btn btn-go" target="_blank" href="' + esc(lastCreated.url) + '">🖨 Печать бейджей для новых</a></div>';
    }
    html += '<div class="card"><h3>Добавить команды</h3><p class="muted">Одна команда на строку. Повторы по названию пропускаются.</p>' +
      '<textarea id="new-teams" placeholder="Футурум&#10;Архистра"></textarea>' +
      '<div class="row"><button class="btn btn-go" data-act="add-teams">Добавить и сделать бейджи</button></div></div>' +
      '<div class="toolbar"><h2 style="margin:0">Команды (' + teams.length + ')</h2><span class="spacer"></span>' +
      '<a class="btn btn-ghost" target="_blank" href="' + labelsUrl({ teams: 'all' }) + '">🖨 Бейджи всех команд</a></div>';
    if (!teams.length) return html;
    html += '<table><thead><tr><th>QR</th><th>Код</th><th>Название</th><th>Активна</th><th class="num">На руках</th><th></th></tr></thead><tbody>' +
      teams.map(function (t) {
        var r = rep[t.id];
        return '<tr><td>' + qrMini('team', t.id) + '</td><td><code>' + esc(t.id) + '</code></td>' +
          '<td><input class="inline-edit" data-edit="team-name" data-id="' + esc(t.id) + '" value="' + esc(t.name) + '"></td>' +
          '<td><input type="checkbox" data-edit="team-active" data-id="' + esc(t.id) + '"' + (t.active !== false ? ' checked' : '') + '></td>' +
          '<td class="num">' + (r ? r.onHands.length : 0) + '</td>' +
          '<td><a class="btn btn-ghost btn-small" target="_blank" href="' + labelsUrl({ teams: t.id }) + '">Бейдж</a></td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  };

  VIEWS.consumables = function () {
    var rows = L.reportConsumables(snap);
    var html = '<div class="card"><h3>Добавить расходник</h3><div class="form-row">' +
      '<label class="field">Название<input id="nc-name" placeholder="Саморезы 4×40" style="min-width:240px"></label>' +
      '<label class="field">Ед.<input id="nc-unit" value="шт" style="width:80px"></label>' +
      '<label class="field">Остаток<input id="nc-stock" type="number" min="0" value="0"></label>' +
      '<label class="field">Предупредить при ≤<input id="nc-low" type="number" min="0" value="0"></label>' +
      '<button class="btn btn-go" data-act="add-consumable">Добавить</button></div>' +
      '<p class="muted">Лимит на расходники не действует. QR на коробку необязателен: на кассе расходники выбираются кнопками.</p></div>' +
      '<div class="toolbar"><h2 style="margin:0">Расходники</h2><span class="spacer"></span>' +
      '<a class="btn btn-ghost" target="_blank" href="' + labelsUrl({ consumables: 'all' }) + '">🖨 QR на коробки</a>' +
      csvButton('consumables', 'CSV') + '</div>';
    if (!rows.length) return html;
    html += '<table><thead><tr><th>Название</th><th>Ед.</th><th class="num">Остаток</th><th class="num">Выдано</th><th>Пополнить</th><th>Инвентаризация (факт)</th><th>Порог</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var id = esc(c.id);
        return '<tr><td><input class="inline-edit" data-edit="cons-name" data-id="' + id + '" value="' + esc(c.name) + '"></td>' +
          '<td><input class="inline-edit" style="width:70px;min-width:0" data-edit="cons-unit" data-id="' + id + '" value="' + esc(c.unit) + '"></td>' +
          '<td class="num">' + (c.low ? '<span class="pill low">' + c.stock + '</span>' : c.stock) + '</td>' +
          '<td class="num">' + c.consumed + '</td>' +
          '<td><input type="number" min="1" id="rs-' + id + '"> <button class="btn btn-ghost btn-small" data-act="restock" data-id="' + id + '">+ Пополнить</button></td>' +
          '<td><input type="number" min="0" id="adj-' + id + '"> <button class="btn btn-ghost btn-small" data-act="adjust" data-id="' + id + '">Задать</button></td>' +
          '<td><input type="number" min="0" data-edit="cons-low" data-id="' + id + '" value="' + c.lowThreshold + '"></td></tr>';
      }).join('') + '</tbody></table>';
    return html;
  };

  VIEWS.settings = function () {
    var s = snap.settings;
    return '<div class="card"><h3>Основные</h3>' +
      '<div class="form-row"><label class="field">Название мероприятия<input id="st-name" value="' + esc(s.eventName) + '"></label>' +
      '<label class="field">PIN админа<input id="st-pin" value="' + esc(s.adminPin) + '" style="width:120px"></label>' +
      '<label class="field">Сброс корзины без действий, сек<input id="st-timeout" type="number" min="15" value="' + s.cartTimeoutSec + '"></label>' +
      '<label class="field">Звук<select id="st-sound"><option value="1"' + (s.soundOn !== false ? ' selected' : '') + '>вкл</option><option value="0"' + (s.soundOn === false ? ' selected' : '') + '>выкл</option></select></label></div>' +
      '<div class="form-row"><label class="field">Лимит по умолчанию для новых инструментов<input id="st-limit" type="number" min="0" value="' + s.defaultLimit + '"></label>' +
      '<label class="field">Для новых аккумуляторов<input id="st-blimit" type="number" min="0" value="' + s.batteryLimit + '"></label>' +
      '<button class="btn btn-go" data-act="save-settings">Сохранить</button></div>' +
      '<p class="muted">Лимит для каждого существующего типа меняется на вкладке «Инвентарь». ' +
      '<button class="btn btn-ghost btn-small" data-act="apply-limit">Применить лимит по умолчанию ко всем инструментам</button></p></div>' +

      '<div class="card"><h3>Резервная копия и перенос</h3>' +
      '<p class="muted">Все данные хранятся в браузере этого ноутбука. Регулярно скачивайте копию (флешка, облако — когда есть интернет). ' +
      'Этим же файлом можно перенести базу: подготовить на другом компьютере и загрузить сюда.' +
      (s.lastBackupAt ? ' Последняя копия: ' + L.fmtTime(s.lastBackupAt) + '.' : '') + '</p>' +
      '<div class="row"><button class="btn btn-go" data-act="backup">⬇ Скачать копию (JSON)</button>' +
      '<label class="btn btn-ghost">⬆ Восстановить из файла<input type="file" id="restore-file" accept=".json,application/json" hidden></label></div></div>' +

      '<div class="card"><h3>Демо и очистка</h3>' +
      '<div class="row"><button class="btn btn-ghost" data-act="demo">Загрузить демо-данные</button>' +
      '<button class="btn btn-danger" data-act="wipe">Удалить все данные…</button></div></div>';
  };

  /* ================= ДЕЙСТВИЯ ================= */

  function val(id) { var el = ui.$('#' + id); return el ? el.value.trim() : ''; }

  function downloadCSV(kind) {
    var names = { holdings: 'na-rukah', operations: 'zhurnal', inventory: 'inventar', teams: 'itogi-komandy', consumables: 'rashodniki' };
    ui.download('archbukhta_' + names[kind] + '_' + ui.stamp() + '.csv', L.CSV[kind](snap), 'text/csv;charset=utf-8');
  }

  async function backup() {
    var data = await L.exportAll();
    ui.download('archbukhta_backup_' + ui.stamp() + '.json', JSON.stringify(data), 'application/json');
    await AB.db.setSettings({ lastBackupAt: Date.now() });
  }

  async function seedDemo() {
    await L.addTeams(['Футурум', 'Архистра', 'Бухта-1', 'Деревяшки']);
    var saw = await L.addToolType({ name: 'Циркулярная пила' });
    var drill = await L.addToolType({ name: 'Шуруповёрт' });
    var jig = await L.addToolType({ name: 'Лобзик' });
    var bat = await L.addToolType({ name: 'Аккумулятор 18V', kind: 'battery' });
    await L.addItems(saw.id, 4);
    await L.addItems(drill.id, 6);
    await L.addItems(jig.id, 3);
    await L.addItems(bat.id, 10);
    await L.addConsumable({ name: 'Саморезы 4×40', unit: 'уп', stock: 30, lowThreshold: 5 });
    await L.addConsumable({ name: 'Саморезы 5×70', unit: 'уп', stock: 20, lowThreshold: 4 });
    await L.addConsumable({ name: 'Пильный диск', unit: 'шт', stock: 6, lowThreshold: 2 });
  }

  var ACTIONS = {
    refresh: function () { return refresh(); },
    csv: function (b) { downloadCSV(b.dataset.kind); },
    'csv-all': function () {
      ['teams', 'inventory', 'consumables', 'operations', 'holdings'].forEach(function (k, i) {
        setTimeout(function () { downloadCSV(k); }, i * 400);
      });
    },
    print: function () { root.print(); },
    backup: async function () { await backup(); toast('ok', 'Копия скачана'); },

    'force-return': async function (b) {
      var item = snap.items.filter(function (i) { return i.id === b.dataset.id; })[0];
      var note = root.prompt('Вернуть «' + (item ? item.label : b.dataset.id) + '» без скана? Укажите причину (будет в журнале):', 'вернули без скана');
      if (note === null) return;
      await L.returnItem(b.dataset.id, { override: true, note: note });
      toast('ok', 'Возвращено');
    },

    'add-type': async function () {
      var name = val('nt-name');
      if (!name) throw new Error('Укажите название типа');
      var type = await L.addToolType({ name: name, kind: val('nt-kind'), code: val('nt-code'), limit: val('nt-limit') });
      var n = parseInt(val('nt-count'), 10) || 0;
      var items = n > 0 ? await L.addItems(type.id, n) : [];
      lastCreated = items.length
        ? { title: 'Тип «' + type.name + '» (' + type.id + '), добавлено ' + items.length + ' шт.', url: labelsUrl({ items: items.map(function (i) { return i.id; }).join(',') }) }
        : null;
      toast('ok', 'Тип создан: ' + type.id);
    },

    'add-items': async function (b) {
      var n = parseInt(ui.$('#add-n-' + b.dataset.id).value, 10) || 1;
      var items = await L.addItems(b.dataset.id, n);
      lastCreated = { title: 'Добавлено ' + items.length + ' шт.: ' + items.map(function (i) { return i.id; }).join(', '), url: labelsUrl({ items: items.map(function (i) { return i.id; }).join(',') }) };
      toast('ok', 'Добавлено ' + items.length + ' шт.');
    },

    'add-teams': async function () {
      var names = val('new-teams').split(/\r?\n/);
      var created = await L.addTeams(names);
      if (!created.length) throw new Error('Нет новых команд (пусто или такие уже есть)');
      lastCreated = { kind: 'teams', title: 'Добавлено команд: ' + created.length, url: labelsUrl({ teams: created.map(function (t) { return t.id; }).join(',') }) };
      toast('ok', 'Добавлено: ' + created.length);
    },

    'add-consumable': async function () {
      await L.addConsumable({ name: val('nc-name'), unit: val('nc-unit'), stock: val('nc-stock'), lowThreshold: val('nc-low') });
      toast('ok', 'Расходник добавлен');
    },
    restock: async function (b) {
      var v = parseInt(ui.$('#rs-' + b.dataset.id).value, 10);
      if (!(v > 0)) throw new Error('Введите, сколько пришло');
      await L.changeStock(b.dataset.id, v, 'add', 'пополнение');
      toast('ok', 'Пополнено');
    },
    adjust: async function (b) {
      var raw = ui.$('#adj-' + b.dataset.id).value;
      if (raw === '') throw new Error('Введите фактический остаток');
      await L.changeStock(b.dataset.id, raw, 'set', 'инвентаризация');
      toast('ok', 'Остаток обновлён');
    },

    'save-settings': async function () {
      var pin = val('st-pin');
      if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN — от 4 до 8 цифр');
      await AB.db.setSettings({
        eventName: val('st-name') || 'АрхБухта', adminPin: pin,
        cartTimeoutSec: Math.max(15, parseInt(val('st-timeout'), 10) || 60),
        soundOn: val('st-sound') === '1',
        defaultLimit: Math.max(0, parseInt(val('st-limit'), 10) || 0),
        batteryLimit: Math.max(0, parseInt(val('st-blimit'), 10) || 0)
      });
      toast('ok', 'Сохранено');
    },
    'apply-limit': async function () {
      var lim = snap.settings.defaultLimit;
      var tools = snap.types.filter(function (t) { return t.kind !== 'battery'; });
      if (!root.confirm('Поставить лимит ' + lim + ' шт. для всех ' + tools.length + ' типов инструментов (кроме аккумуляторов)?')) return;
      for (var i = 0; i < tools.length; i++) await L.updateToolType(tools[i].id, { limit: lim });
      toast('ok', 'Готово');
    },
    demo: async function () {
      if (snap.teams.length || snap.types.length) {
        if (!root.confirm('В базе уже есть данные. Демо-данные добавятся к ним. Продолжить?')) return;
      }
      await seedDemo();
      toast('ok', 'Демо-данные загружены');
    },
    wipe: async function () {
      var answer = root.prompt('Будут удалены ВСЕ команды, инструменты, расходники и журнал. Сначала скачайте копию!\nЧтобы подтвердить, напишите: УДАЛИТЬ');
      if (answer !== 'УДАЛИТЬ') return;
      await L.wipeAll(true);
      toast('ok', 'Данные удалены');
    }
  };

  var EDITS = {
    'type-name': function (id, v) { return L.updateToolType(id, { name: v }); },
    'type-kind': function (id, v) { return L.updateToolType(id, { kind: v }); },
    'type-limit': function (id, v) { return L.updateToolType(id, { limit: v }); },
    'item-label': function (id, v) { return L.updateItem(id, { label: v }); },
    'item-status': function (id, v) { return L.updateItem(id, { status: v }); },
    'team-name': function (id, v) { return L.updateTeam(id, { name: v }); },
    'team-active': function (id, v, el) { return L.updateTeam(id, { active: el.checked }); },
    'cons-name': function (id, v) { return L.updateConsumable(id, { name: v }); },
    'cons-unit': function (id, v) { return L.updateConsumable(id, { unit: v }); },
    'cons-low': function (id, v) { return L.updateConsumable(id, { lowThreshold: v }); }
  };

  view.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || !ACTIONS[b.dataset.act]) return;
    try {
      await ACTIONS[b.dataset.act](b);
      if (b.dataset.act !== 'csv' && b.dataset.act !== 'csv-all' && b.dataset.act !== 'print') await refresh();
    } catch (err) {
      console.error(err);
      toast('error', err.message || String(err));
    }
  });

  view.addEventListener('change', async function (e) {
    var el = e.target;
    if (el.id === 'restore-file') return restore(el.files[0]);
    if (el.id === 'log-op') { logFilter.op = el.value; return render(); }
    if (!el.dataset.edit || !EDITS[el.dataset.edit]) return;
    try {
      await EDITS[el.dataset.edit](el.dataset.id, el.value, el);
      toast('ok', 'Сохранено');
      // перерисовку делаем только там, где меняются производные данные, чтобы не терять фокус при вводе
      if (['type-limit', 'type-kind', 'item-status', 'team-active'].indexOf(el.dataset.edit) !== -1) await refresh();
      else snap = await L.snapshot();
    } catch (err) {
      toast('error', err.message || String(err));
      await refresh();
    }
  });

  view.addEventListener('input', function (e) {
    if (e.target.id === 'log-q') { logFilter.q = e.target.value; render(); }
  });

  async function restore(file) {
    if (!file) return;
    try {
      var data = JSON.parse(await file.text());
      var parts = Object.keys(L.BACKUP_PARTS).filter(function (k) { return data && data.data && k in data.data; });
      var kept = Object.keys(L.BACKUP_PARTS).filter(function (k) { return parts.indexOf(k) === -1; });
      if (!root.confirm('Загрузить «' + file.name + '»?\n\nБудут ЗАМЕНЕНЫ: ' + parts.map(function (k) { return L.BACKUP_PARTS[k]; }).join(', ') +
        (kept.length ? '\nОстанутся как есть: ' + kept.map(function (k) { return L.BACKUP_PARTS[k]; }).join(', ') : '') +
        '\n\nСначала скачайте копию текущей базы, если она нужна.')) return;
      await L.importAll(data);
      toast('ok', 'База восстановлена');
      await refresh();
    } catch (err) {
      toast('error', 'Не удалось восстановить: ' + (err.message || err));
    }
  }

  ui.$('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    current = b.dataset.tab;
    lastCreated = null;
    try { sessionStorage.setItem('ab-admin-tab', current); } catch (err) { /* не критично */ }
    refresh();
  });

  /* ================= ВХОД ПО PIN ================= */

  function unlocked() {
    try { return sessionStorage.getItem('ab-admin') === '1'; } catch (e) { return false; }
  }

  ui.$('#pin-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var s = await AB.db.getSettings();
    if (ui.$('#pin-input').value === String(s.adminPin)) {
      try { sessionStorage.setItem('ab-admin', '1'); } catch (err) { /* не критично */ }
      ui.$('#pin-gate').hidden = true;
      refresh();
    } else {
      ui.$('#pin-input').value = '';
      toast('error', 'Неверный PIN');
    }
  });

  ui.$('#btn-lock').addEventListener('click', function () {
    try { sessionStorage.removeItem('ab-admin'); } catch (err) { /* не критично */ }
    location.href = 'index.html';
  });

  ui.registerSW();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  try { current = sessionStorage.getItem('ab-admin-tab') || current; } catch (e) { /* не критично */ }
  if (unlocked()) {
    ui.$('#pin-gate').hidden = true;
    refresh();
  } else {
    ui.$('#pin-input').focus();
  }
  // данные меняются на кассе — обновляем «на руках», когда вкладка снова видна
  document.addEventListener('visibilitychange', function () { if (!document.hidden && unlocked()) refresh(); });
})(window);
