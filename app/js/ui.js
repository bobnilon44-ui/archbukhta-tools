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

  AB.ui = { esc: esc, $: $, $$: $$, download: download, stamp: stamp, qrSvg: qrSvg, registerSW: registerSW };
})(window);
