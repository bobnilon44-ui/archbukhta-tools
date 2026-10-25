/* Звук и цветовая вспышка — обратная связь при скане. Звуки синтезируются WebAudio, файлы не нужны. */
(function (root) {
  'use strict';
  var AB = (root.AB = root.AB || {});
  var ctx = null;
  var enabled = true;

  function audio() {
    if (!ctx) {
      var C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type, vol) {
    var a = audio();
    if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    var t0 = a.currentTime + start;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  var SOUNDS = {
    ok: function () { tone(880, 0, 0.12); tone(1320, 0.12, 0.18); },
    done: function () { tone(660, 0, 0.12); tone(880, 0.12, 0.12); tone(1320, 0.24, 0.25); },
    error: function () { tone(220, 0, 0.22, 'sawtooth', 0.25); tone(180, 0.26, 0.3, 'sawtooth', 0.25); },
    warn: function () { tone(520, 0, 0.18, 'triangle', 0.35); tone(520, 0.3, 0.18, 'triangle', 0.35); }
  };

  function flash(kind) {
    var el = document.getElementById('flash');
    if (!el) return;
    el.className = '';
    void el.offsetWidth; // перезапуск анимации
    el.className = 'flash-' + kind;
  }

  function ping(kind) {
    var el = document.querySelector('.cam-box');
    if (!el) return flash(kind);
    el.classList.remove('ping-ok', 'ping-warn');
    void el.offsetWidth;
    el.classList.add('ping-' + kind);
  }

  AB.feedback = {
    setEnabled: function (v) { enabled = !!v; },
    /** Разблокировать звук: браузеры разрешают аудио только после жеста пользователя. */
    unlock: function () { audio(); },
    play: function (name) {
      if (!enabled || !SOUNDS[name]) return;
      try { SOUNDS[name](); } catch (e) { /* без звука — не критично */ }
    },
    // Звук и свет срабатывают в одном кадре и по итогу проверки, а не по факту скана.
    // Обычный удачный скан — подсветка рамки камеры, на весь экран — только итог выдачи и ошибки.
    ok: function () { this.play('ok'); ping('ok'); },
    done: function () { this.play('done'); flash('ok'); },
    error: function () { this.play('error'); flash('error'); },
    warn: function () { this.play('warn'); ping('warn'); }
  };
})(window);
