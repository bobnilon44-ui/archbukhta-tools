/* Печать QR-кодов. Параметры URL:
 *   ?teams=all | ?teams=T01,T02
 *   ?items=all | ?items=TSIRPIL-01,TSIRPIL-02 | ?type=TSIRPIL
 *   ?consumables=all
 * Генерация полностью офлайн (qrcode-generator), PDF — через «Печать → Сохранить как PDF». */
(function (root) {
  'use strict';
  var AB = root.AB, L = AB.logic, ui = AB.ui, esc = ui.esc;

  var params = new URLSearchParams(location.search);

  function pick(list, param, key) {
    var v = params.get(param);
    if (!v) return [];
    if (v === 'all') return list;
    var ids = v.split(',');
    return list.filter(function (x) { return ids.indexOf(x[key || 'id']) !== -1; });
  }

  async function build() {
    var s = await L.snapshot();
    var types = {};
    s.types.forEach(function (t) { types[t.id] = t; });
    var labels = [];

    pick(s.teams.filter(function (t) { return t.active !== false || params.get('teams') !== 'all'; }), 'teams')
      .sort(function (a, b) { return a.id.localeCompare(b.id); })
      .forEach(function (t) { labels.push({ code: L.codeFor('team', t.id), id: t.id, title: t.name, kind: 'Команда' }); });

    var items = pick(s.items.filter(function (i) { return i.status !== 'retired' || params.get('items') !== 'all'; }), 'items');
    if (params.get('type')) items = items.concat(s.items.filter(function (i) { return i.typeId === params.get('type') && i.status !== 'retired'; }));
    items.sort(function (a, b) { return a.id.localeCompare(b.id); }).forEach(function (i) {
      var t = types[i.typeId] || {};
      labels.push({ code: L.codeFor('item', i.id), id: i.id, title: i.label, kind: t.kind === 'battery' ? 'Аккумулятор' : 'Инструмент' });
    });

    pick(s.consumables, 'consumables').forEach(function (c) {
      labels.push({ code: L.codeFor('consumable', c.id), id: c.id, title: c.name, kind: 'Расходник' });
    });
    return { labels: labels, eventName: s.settings.eventName };
  }

  function defaultSize() {
    if (params.get('teams')) return 'badge';
    if (params.get('consumables')) return 'large';
    return 'medium';
  }

  async function render() {
    var sheet = ui.$('#sheet');
    var size = ui.$('#size').value;
    var data = await build();
    sheet.className = 'sheet size-' + size + (ui.$('#cut').checked ? ' cut' : '');
    ui.$('#count').textContent = data.labels.length + ' шт.';
    if (!data.labels.length) {
      sheet.innerHTML = '<div class="empty">Нечего печатать. Выберите набор выше или добавьте данные в админке.</div>';
      return;
    }
    sheet.innerHTML = data.labels.map(function (l) {
      var text = '<div class="text"><div class="kind">' + esc(data.eventName) + ' · ' + esc(l.kind) + '</div>' +
        '<div class="title">' + esc(l.title) + '</div><div class="code">' + esc(l.id) + '</div></div>';
      return '<div class="label">' + ui.qrSvg(l.code, 4) + text + '</div>';
    }).join('');
  }

  // выпадающий список «что печатать» отражает текущий URL
  var what = ui.$('#what');
  var q = location.search.replace(/^\?/, '');
  if (q && !Array.prototype.some.call(what.options, function (o) { return o.value === q; })) {
    var opt = document.createElement('option');
    opt.value = q;
    opt.textContent = 'Выбранные (' + decodeURIComponent(q).slice(0, 40) + ')';
    what.insertBefore(opt, what.firstChild);
  }
  what.value = q || what.options[0].value;
  if (!q) params = new URLSearchParams(what.value);
  ui.$('#size').value = defaultSize();

  what.addEventListener('change', function () {
    history.replaceState(null, '', '?' + what.value);
    params = new URLSearchParams(what.value);
    ui.$('#size').value = defaultSize();
    render();
  });
  ui.$('#size').addEventListener('change', render);
  ui.$('#cut').addEventListener('change', render);
  ui.$('#btn-print').addEventListener('click', function () { root.print(); });

  render();
})(window);
