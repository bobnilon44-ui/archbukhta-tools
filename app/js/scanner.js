/* Сканер QR: камера ноутбука + jsQR (локально), плюс USB-сканер, который «печатает» код и жмёт Enter.
 * Антидребезг: один и тот же код игнорируется DEBOUNCE_MS после последнего срабатывания. */
(function (root) {
  'use strict';
  var AB = (root.AB = root.AB || {});

  var DEBOUNCE_MS = 2500;
  var SCAN_INTERVAL_MS = 120;
  var MAX_WIDTH = 640;

  function Scanner(video, onCode, onStatus) {
    this.video = video;
    this.onCode = onCode;
    this.onStatus = onStatus || function () {};
    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.timer = null;
    this.paused = false;
    this.last = { text: null, at: 0 };
    this.kbBuf = '';
    this.kbAt = 0;
    this._onKey = this._onKey.bind(this);
  }

  Scanner.prototype.start = async function () {
    document.addEventListener('keydown', this._onKey, true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus('error', 'Камера недоступна в этом браузере. Откройте приложение через start-скрипт (http://localhost).');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false
      });
    } catch (e) {
      this.onStatus('error', 'Нет доступа к камере: ' + (e.message || e.name) + '. Разрешите камеру в настройках браузера.');
      return;
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play().catch(function () {});
    this.onStatus('ok', 'Камера работает');
    var self = this;
    this.timer = setInterval(function () { self._tick(); }, SCAN_INTERVAL_MS);
  };

  Scanner.prototype.stop = function () {
    clearInterval(this.timer);
    document.removeEventListener('keydown', this._onKey, true);
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
  };

  Scanner.prototype.pause = function (v) { this.paused = !!v; };

  /** Сбросить антидребезг (например, после смены экрана — чтобы тот же код можно было отсканировать заново). */
  Scanner.prototype.resetDebounce = function () { this.last = { text: null, at: 0 }; };

  Scanner.prototype._emit = function (text) {
    if (this.paused || !text) return;
    var now = Date.now();
    if (text === this.last.text && now - this.last.at < DEBOUNCE_MS) {
      this.last.at = now; // пока код в кадре — продолжаем гасить
      return;
    }
    this.last = { text: text, at: now };
    this.onCode(text);
  };

  Scanner.prototype._tick = function () {
    var v = this.video;
    if (this.paused || v.readyState < 2 || !v.videoWidth) return;
    var scale = Math.min(1, MAX_WIDTH / v.videoWidth);
    var w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    if (this.canvas.width !== w) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx2d.drawImage(v, 0, 0, w, h);
    var img = this.ctx2d.getImageData(0, 0, w, h);
    // attemptBoth: бейдж может быть распечатан инверсно или отражён в камере
    var res = root.jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (res && res.data) this._emit(res.data.trim());
  };

  // USB/Bluetooth-сканеры работают как клавиатура: быстрый поток символов + Enter.
  Scanner.prototype._onKey = function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var now = Date.now();
    if (now - this.kbAt > 100) this.kbBuf = '';
    this.kbAt = now;
    if (e.key === 'Enter') {
      if (this.kbBuf.length >= 6) { this._emit(this.kbBuf.trim()); e.preventDefault(); }
      this.kbBuf = '';
    } else if (e.key.length === 1) {
      this.kbBuf += keyChar(e);
    }
  };

  // Символ по физической клавише: при русской раскладке сканер иначе «напечатает» ФИЖЕЖЕ01 вместо AB:T:T01.
  function keyChar(e) {
    if (/^[\x20-\x7e]$/.test(e.key)) return e.key;
    var c = e.code || '';
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return e.shiftKey ? e.key : c.slice(5);
    if (/^Numpad[0-9]$/.test(c)) return c.slice(6);
    if (c === 'Semicolon') return e.shiftKey ? ':' : ';';
    if (c === 'Minus' || c === 'NumpadSubtract') return e.shiftKey ? '_' : '-';
    return e.key;
  }

  AB.Scanner = Scanner;
})(window);
