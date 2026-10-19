/* Мелкие общие помощники интерфейса (киоск и админка). */
(function (root) {
  'use strict';
  var AB = (root.AB = root.AB || {});

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $$(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + '-' + p(d.getMinutes());
  }

  /** SVG-разметка QR-кода (генерация полностью офлайн, библиотека qrcode-generator). */
  function qrSvg(text, cellSize) {
    var qr = root.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: cellSize || 4, margin: 2, scalable: true });
  }

  function registerSW() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн-кэш не обязателен */ });
    }
  }

  /* ---------- знак и линейные иконки в стиле сайта АрхБухты ---------- */

  // Знак сайта: дом-«А» с прорезями-швами. Определяется один раз, дальше <use href="#ab-mark">.
  var MARK_DEFS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<mask id="ab-seams" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">' +
    '<rect width="100" height="100" fill="#fff"/>' +
    '<path d="M50 0V13M50 30V41M50 86V100M5 34V100M95 34V100M20 50L50 33M80 50L50 33" stroke="#000" stroke-width="1.3" fill="none"/></mask>' +
    '<symbol id="ab-mark" viewBox="0 0 100 100"><g mask="url(#ab-seams)" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="miter">' +
    '<path d="M4 100V31L50 5L96 31V100"/><path d="M19 51L50 33L81 51"/><path d="M4 64L50 89L96 64M50 89V100"/></g></symbol>' +
    '</defs></svg>';

  function injectMark() {
    if (document.getElementById('ab-mark')) return;
    var holder = document.createElement('div');
    holder.innerHTML = MARK_DEFS;
    document.body.insertBefore(holder.firstChild, document.body.firstChild);
  }

  function mark(cls) {
    return '<svg class="' + (cls || 'mark') + '" viewBox="0 0 100 100" aria-hidden="true"><use href="#ab-mark"/></svg>';
  }

  var ICON_PATHS = {
    badge: '<rect x="3" y="5" width="18" height="14"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M14 10h4.5M14 13h3"/>',
    wrench: '<path d="M14.5 4.2a4.5 4.5 0 0 0-5.3 5.9L3.6 15.7a1.8 1.8 0 0 0 2.6 2.6l5.6-5.6a4.5 4.5 0 0 0 5.9-5.3l-2.8 2.8-2.4-.6-.6-2.4z"/>',
    tool: '<path d="M3 7h11v6H3zM14 9h3l3-1v4l-3-1h-3M6 13l-1 7h4l1-7"/>',
    battery: '<rect x="6" y="4" width="12" height="17"/><path d="M10 4V2.5h4V4M12.8 8.5 10 13h4l-2.8 4.5"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9"/>',
    swap: '<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>',
    check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
    plug: '<path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3"/>',
    down: '<path d="M12 3v14M6 11l6 6 6-6M4 21h16"/>',
    alert: '<path d="M12 3 2.5 20h19zM12 10v5M12 17.5v.5"/>'
  };

  /** Линейная иконка (обводка currentColor, как в графике сайта). */
  function icon(name, cls) {
    return '<svg class="ico-svg ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linejoin="miter" stroke-linecap="square" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }

  /** Трещина-разделитель, как между секциями сайта. */
  function crack() {
    var d = 'M0 20', x = 0;
    while (x < 1000) { x += 20 + Math.random() * 50; d += ' L' + Math.min(x, 1000).toFixed(0) + ' ' + (20 + (Math.random() - 0.5) * 30).toFixed(0); }
    return '<svg class="crack" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  if (document.body) injectMark();
  else document.addEventListener('DOMContentLoaded', injectMark);

  AB.ui = {
    esc: esc, $: $, $$: $$, download: download, stamp: stamp, qrSvg: qrSvg, registerSW: registerSW,
    mark: mark, icon: icon, crack: crack
  };
})(window);
