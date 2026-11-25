/* ============================================================
   SOMNA — behaviour
   A normal marketing site that stops being normal.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var body = document.body;
  var T0 = Date.now();

  var state = {
    act: -1,
    p: 0,
    d: 0,
    y: 0,
    maxScroll: 1,
    descentTop: 0,
    descentSpan: 1,
    mouse: { x: window.innerWidth / 2, y: window.innerHeight / 2, nx: 0, ny: 0 },
    cur: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    moved: false,
    lastMove: Date.now(),
    idleFired: false,
    upAccum: 0,
    lastY: 0,
    lastToast: 0,
    sceneVisible: false,
    ending: false,
    climax: { on: false, k: 0, start: 0 },
    titleFlip: null
  };

  /* ---------------------------------------------------------
     small utilities
     --------------------------------------------------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); }
  function hhmmss(sec) { sec = Math.max(0, Math.floor(sec)); return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60); }
  function elapsed() { return (Date.now() - T0) / 1000; }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 3600);
  }

  /* ---------------------------------------------------------
     AUDIO — everything is synthesised, nothing is loaded
     --------------------------------------------------------- */
  var audio = {
    ctx: null, master: null, on: false, act: 0, hb: null, whisperT: null, breathT: null,

    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var c = this.ctx = new AC();
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);

      var len = Math.floor(c.sampleRate * 2);
      var buf = c.createBuffer(1, len, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;

      var dg = c.createGain(); dg.gain.value = 0.10;
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 1.6;
      lp.connect(dg); dg.connect(this.master);
      [55, 55.7, 82.4].forEach(function (f, i) {
        var o = c.createOscillator();
        o.type = i === 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = f;
        var g = c.createGain(); g.gain.value = i === 2 ? 0.22 : 0.45;
        o.connect(g); g.connect(lp); o.start();
      });
      var lfo = c.createOscillator(); lfo.frequency.value = 0.05;
      var lg = c.createGain(); lg.gain.value = 70;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      this.droneGain = dg;
      this.filter = lp;
    },

    start: function () {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.on = true;
      var c = this.ctx;
      this.master.gain.cancelScheduledValues(c.currentTime);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), c.currentTime);
      this.master.gain.linearRampToValueAtTime(0.30, c.currentTime + 3.5);
      this.setAct(this.act);
      this.scheduleWhisper();
    },

    stop: function () {
      if (!this.ctx) return;
      this.on = false;
      var c = this.ctx;
      this.master.gain.cancelScheduledValues(c.currentTime);
      this.master.gain.linearRampToValueAtTime(0.0001, c.currentTime + 1.2);
      clearInterval(this.hb); this.hb = null;
      clearTimeout(this.whisperT); clearTimeout(this.breathT);
    },

    setAct: function (n) {
      this.act = n;
      var bpm = n <= 2 ? 0 : n === 3 ? 50 : n === 4 ? 58 : n === 5 ? 74 : 96;
      clearInterval(this.hb); this.hb = null;
      this.scheduleWhisper();
      if (!this.on || !bpm) return;
      var self = this;
      this.hb = setInterval(function () { self.thump(); }, 60000 / bpm);
      if (this.filter) {
        var f = n >= 5 ? 260 : n === 4 ? 210 : 170;
        this.filter.frequency.linearRampToValueAtTime(f, this.ctx.currentTime + 2);
      }
    },

    kick: function (when, gain, f0, f1, dur) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + dur * 0.7);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(gain, when + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(this.master);
      o.start(when); o.stop(when + dur + 0.05);
    },

    thump: function () {
      if (!this.on) return;
      var t = this.ctx.currentTime + 0.02;
      this.kick(t, 0.5, 66, 30, 0.30);
      this.kick(t + 0.24, 0.28, 58, 26, 0.26);
    },

    noiseBurst: function (gain, dur, type, freq, q, when) {
      var c = this.ctx;
      var t = when || c.currentTime;
      var s = c.createBufferSource(); s.buffer = this.noise;
      var f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t); s.stop(t + dur + 0.1);
    },

    whisper: function () {
      if (!this.on || !this.ctx) return;
      var c = this.ctx, t = c.currentTime + 0.03;
      var s = c.createBufferSource(); s.buffer = this.noise;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
      bp.frequency.setValueAtTime(520 + Math.random() * 300, t);
      bp.frequency.linearRampToValueAtTime(1800 + Math.random() * 900, t + 1.4);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.085, t + 0.5);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.0);
      var pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; s.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.master); }
      else { s.connect(bp); bp.connect(g); g.connect(this.master); }
      s.start(t); s.stop(t + 2.1);
    },

    scheduleWhisper: function () {
      var self = this;
      clearTimeout(this.whisperT);
      if (!this.on || this.act < 4) return;
      this.whisperT = setTimeout(function () {
        self.whisper();
        self.scheduleWhisper();
      }, 6000 + Math.random() * 9000);
    },

    riser: function () {
      if (!this.on || !this.ctx) return;
      var c = this.ctx, t = c.currentTime;
      var o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(920, t + 1.15);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      o.connect(lp); lp.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.35);
      this.noiseBurst(0.16, 1.2, 'highpass', 1200, 0.7, t);
    },

    hit: function () {
      if (!this.on || !this.ctx) return;
      var c = this.ctx, t = c.currentTime;
      this.kick(t, 1.0, 110, 22, 1.6);
      this.noiseBurst(0.55, 0.75, 'highpass', 600, 0.6, t);
      var o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(2200, t);
      o.frequency.exponentialRampToValueAtTime(160, t + 0.9);
      var g = c.createGain();
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1.1);
    },

    breathe: function () {
      if (!this.on || !this.ctx) return;
      var self = this;
      var c = this.ctx, t = c.currentTime;
      var s = c.createBufferSource(); s.buffer = this.noise;
      var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 1.2;
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 1.1);
      g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t); s.stop(t + 2.5);
      this.breathT = setTimeout(function () { self.breathe(); }, 4200 + Math.random() * 900);
    }
  };

  /* ---------------------------------------------------------
     METRICS
     --------------------------------------------------------- */
  var descentEl = $('#descent');
  function measure() {
    var de = document.documentElement;
    state.maxScroll = Math.max(1, de.scrollHeight - window.innerHeight);
    state.descentTop = descentEl.offsetTop;
    state.descentSpan = Math.max(1, descentEl.offsetHeight - window.innerHeight);
    state.darkRanges = [];
    ['.product', '.foot'].forEach(function (sel) {
      var el = $(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      state.darkRanges.push({ top: r.top + window.scrollY, bottom: r.bottom + window.scrollY });
    });
    resizeCanvas();
  }
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', function () { setTimeout(measure, 250); });

  /* ---------------------------------------------------------
     ACTS
     --------------------------------------------------------- */
  function currentAct() {
    if (state.d > 0.955) return 7;
    if (state.d > 0.865) return 6;
    if (state.d > 0.60) return 5;
    if (state.d > 0.24) return 4;
    if (state.d > 0.003) return 3;
    if (state.p > 0.325) return 2;
    if (state.p > 0.155) return 1;
    return 0;
  }

  var TITLES = {
    0: 'SOMNA — 睡眠系统',
    1: 'SOMNA — 睡眠系统',
    2: 'SOMNA — 你还在看吗',
    3: 'SOMNA — 夜间模式',
    4: 'SOMNA — 你还在吗',
    5: '别回头',
    6: '它在你身后',
    7: '你还在吗'
  };

  var faviconLink = document.querySelector('link[rel="icon"]');
  function setFavicon(red) {
    if (!faviconLink) return;
    faviconLink.href = red
      ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23050404'/%3E%3Ccircle cx='16' cy='16' r='9' fill='%23b3232a'/%3E%3Ccircle cx='16' cy='16' r='3.4' fill='%23050404'/%3E%3C/svg%3E"
      : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%23191714'/%3E%3Cpath d='M5 18c3.5-5 7.5-7.5 11-7.5s7.5 2.5 11 7.5' fill='none' stroke='%23f2efe9' stroke-width='1.6'/%3E%3C/svg%3E";
  }

  function setAct(n) {
    if (n === state.act) return;
    var prev = state.act;
    state.act = n;
    for (var i = 0; i <= 7; i++) body.classList.remove('act-' + i);
    body.classList.add('act-' + n);
    body.setAttribute('data-act', n);
    if (document.title !== TITLES[n]) document.title = TITLES[n];
    if (n >= 2) setFavicon(true);
    if (n >= 2 && !$('#cursor').classList.contains('on')) body.classList.add('cursor-on');
    audio.setAct(n);
    actEffects(n, prev);
  }

  function actEffects(n, prev) {
    if (n >= 2) {
      $('#navCta').textContent = '别';
      $('#cursor').classList.add('hot');
      var navs = ['醒着', '听着', '看着', '立刻'];
      $$('.nav-links a').forEach(function (a, i) { if (a.textContent !== navs[i]) a.textContent = navs[i]; });
    }
    if (n >= 3) {
      $('#hudMode').textContent = 'SOMNA · 正在记录';
      var dlg = $('#dialog');
      if (dlg) dlg.classList.remove('show');
    }
    if (n >= 4) {
      $('#hudMode').textContent = 'SOMNA · 已连接';
      $('#hudHint').textContent = '不要停';
      $('#sLink').textContent = '它在你的床下';
      $('#footQuiet').textContent = '它还在这里。';
    }
    if (n >= 5) {
      $('#hudMode').textContent = '它已经醒了';
      $('#hudHint').textContent = '它看见你了';
      startTitleFlicker(true);
    }
    if (n >= 6) { $('#hudHint').textContent = '别回头'; }
    if (n === 7) {
      $('#hudHint').textContent = '';
      startTitleFlicker(true);
    }
    if (n < 5) startTitleFlicker(false);

    if (n === 2 && prev < 2) {
      // the session panel starts reporting honestly
      $('#sLink').textContent = '已连接';
      document.documentElement.style.setProperty('--act2', '1');
    }
    if (n === 3 && prev < 3) {
      toast('夜间模式已开启。', 2600);
    }
  }

  function startTitleFlicker(on) {
    if (on && !state.titleFlip) {
      state.titleFlip = setInterval(function () {
        if (state.act < 5 || document.hidden) return;
        document.title = Math.random() < 0.5 ? '别回头' : '它在你身后';
      }, 2600);
    } else if (!on && state.titleFlip) {
      clearInterval(state.titleFlip); state.titleFlip = null;
      if (TITLES[state.act]) document.title = TITLES[state.act];
    }
  }

  /* ---------------------------------------------------------
     MUTATIONS — text that gets infected
     --------------------------------------------------------- */
  var MUT = {
    1: [
      ['#feat2p', '每一夜，SOMNA 都在重建你的睡眠模型。到第四晚，它比你更了解你。'],
      ['#sysNote', 'SOMNA 不发光，也不发声。按设计，它不会让你察觉。']
    ],
    2: [
      ['#feat3p', '房间会在你醒来之前作出回应。你永远不会察觉到它发生过——它已经发生过了。'],
      ['#sciP', '你不需要做任何事。你只需要睡着。剩下的部分，它来处理。']
    ],
    3: [
      ['#copyName', '你'],
      ['#heroFine', '30 夜试用。你已经超过了。']
    ]
  };

  var applied = 0;
  function applyMutations(n) {
    if (n <= applied) return;
    for (var act = applied + 1; act <= n; act++) {
      var list = MUT[act] || [];
      for (var i = 0; i < list.length; i++) {
        var el = $(list[i][0]);
        if (!el) continue;
        el.textContent = list[i][1];
        el.classList.add('mut');
        if (act >= 2) {
          el.classList.add('glitch');
          (function (e) { setTimeout(function () { e.classList.remove('glitch'); }, 620); })(el);
        }
      }
    }
    applied = n;
  }

  function updateMutations() {
    applyMutations(mutationPhase());
  }

  function mutationPhase() {
    return state.p > 0.36 ? 3 : state.p > 0.24 ? 2 : state.p > 0.08 ? 1 : 0;
  }

  function lockStat(sel, val) {
    var el = $(sel);
    if (!el) return;
    el.dataset.locked = '1';
    el.classList.add('mut');
    el.textContent = val;
  }

  function glitchEl(el) {
    if (!el) return;
    el.classList.add('mut', 'glitch');
    setTimeout(function () { el.classList.remove('glitch'); }, 620);
  }

  /* each section betrays itself while you are looking at it */
  function mutateStats() {
    glitchEl($('#stat2')); glitchEl($('#stat3')); glitchEl($('#stat4'));
    lockStat('#stat2', '0');
    lockStat('#stat3', '0');
    lockStat('#stat4', '1');
    var labs = [['#stat1lab', '个夜晚正在被监测。包括这一个。'],
                ['#stat2lab', '的用户不再做梦'],
                ['#stat3lab', '分钟。你不需要入睡了'],
                ['#stat4lab', '个人正在看着你']];
    labs.forEach(function (l) { var e = $(l[0]); if (e) { e.textContent = l[1]; glitchEl(e); } });
    var small = $$('.stat')[3] && $$('.stat')[3].querySelector('small');
    if (small) small.textContent = '个';
  }

  function mutateVoices() {
    var maps = [['#q1', '“我记不清自己是什么时候买的它。”'],
                ['#q2', '“我睡着以后，一动也不动。”'],
                ['#q3', '“它是唯一一件会想起我的东西。”'],
                ['#q4', '“现在我不做梦了。我只是去某个地方。”']];
    maps.forEach(function (m, i) {
      var e = $(m[0]);
      if (!e) return;
      setTimeout(function () { e.textContent = m[1]; e.classList.add('mut'); glitchEl(e); }, i * 380);
    });
    var h = $('#voiceH2');
    if (h) { h.textContent = '他们现在睡在你家里。'; h.classList.add('mut'); }
  }

  function mutatePrices() {
    $$('.amt').forEach(function (el, i) {
      setTimeout(function () {
        el.dataset.locked = '1';
        el.textContent = '0';
        glitchEl(el);
      }, i * 260);
    });
    var n = $('#planNote');
    if (n) { n.textContent = '已经安装好了。不需要付款。'; glitchEl(n); }
  }

  function mutateFaq() {
    var q = $('#faqQ'), a = $('#faqA');
    if (q) { q.textContent = '为什么你会滚到这里？'; glitchEl(q); }
    if (a) { a.textContent = '因为它在等你。'; glitchEl(a); }
  }

  function mutateScience() {
    var end = $('#chartEnd'); if (end) end.textContent = '现在';
    var note = $('#chartNote'); if (note) note.classList.add('on');
    var ghost = $('#chartGhost');
    if (ghost) { ghost.style.opacity = '1'; ghost.style.transition = 'opacity 2.4s'; }
    var now = $('#chartNow');
    if (now) { now.style.opacity = '1'; now.style.transition = 'opacity 2.4s'; }
    var cp = $('#chartPath');
    if (cp) { cp.style.opacity = '.18'; cp.style.transition = 'opacity 2.4s'; }
    var dt = $('#chartDate');
    if (dt) { dt.textContent = '实时'; glitchEl(dt); }
    showDialog();
  }

  function whenVisible(sel, fn, delay, threshold) {
    var el = $(sel);
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setTimeout(fn, delay || 0); return; }
    var io = new IntersectionObserver(function (en) {
      en.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.disconnect();
        setTimeout(fn, delay || 0);
      });
    }, { threshold: threshold == null ? 0.3 : threshold });
    io.observe(el);
  }

  /* ---------------------------------------------------------
     CHART
     --------------------------------------------------------- */
  function buildChart() {
    var stages = [0, 0, 3, 3, 2, 2, 3, 3, 1, 2, 3, 2, 1, 2, 2, 3, 3, 1, 2, 3, 2, 1, 2, 2, 1, 0];
    var yFor = { 0: 30, 1: 90, 2: 150, 3: 210 };
    var n = stages.length, w = 1000 / n, d = '';
    for (var i = 0; i < n; i++) {
      var y = yFor[stages[i]], x = i * w;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y + 'L' + (x + w).toFixed(1) + ' ' + y;
    }
    var p = $('#chartPath');
    if (p) p.setAttribute('d', d);

    // the trace that belongs to whoever is reading
    var g = 'M0 210 L740 210 L760 150 L800 150 L820 210 L900 210 L940 30 L1000 30';
    var gp = $('#chartGhost');
    if (gp) gp.setAttribute('d', g);

    var date = new Date();
    var dt = $('#chartDate');
    if (dt) dt.textContent = pad(date.getDate()) + ' — ' + pad(date.getMonth() + 1) + ' — ' + date.getFullYear();
  }

  /* ---------------------------------------------------------
     SESSION PANEL — real things, reported back to you
     --------------------------------------------------------- */
  function initSession() {
    var tz = '--';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '--'; } catch (e) { }
    var ua = navigator.userAgent;
    var os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'Linux';
    var br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '浏览器';
    $('#sTz').textContent = tz;
    $('#sRes').textContent = (window.screen.width || 0) + ' × ' + (window.screen.height || 0);
    $('#sDev').textContent = os + ' · ' + br;
  }

  setInterval(function () {
    var e = elapsed();
    $('#sTime').textContent = mmss(e);
    $('#sClock').textContent = (function () {
      var d = new Date();
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    })();
    $('#hudTimer').textContent = hhmmss(e);
    $('#beatTimer').textContent = mmss(e);
  }, 500);

  /* ---------------------------------------------------------
     SCROLL LOOP
     --------------------------------------------------------- */
  var lastD = -1;
  function updateScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    state.y = y;
    var p = clamp(y / state.maxScroll, 0, 1);
    var d = clamp((y - state.descentTop) / state.descentSpan, 0, 1);
    state.p = p; state.d = d;

    if (y < state.lastY - 4 && state.act >= 2 && !state.ending) {
      state.upAccum += (state.lastY - y);
      if (state.upAccum > 320) {
        state.upAccum = 0;
        var now = Date.now();
        if (now - state.lastToast > 14000) {
          state.lastToast = now;
          toast(state.act >= 5 ? '不要往上看。' : '你身后什么都没有。', 3000);
        }
      }
    } else if (y > state.lastY + 4) {
      state.upAccum = Math.max(0, state.upAccum - 40);
    }
    state.lastY = y;

    var navY = y + 52, over = false, ranges = state.darkRanges || [];
    for (var di = 0; di < ranges.length; di++) {
      if (navY > ranges[di].top && navY < ranges[di].bottom) { over = true; break; }
    }
    body.classList.toggle('over-dark', over);

    setAct(currentAct());
    updateMutations();

    if (Math.abs(d - lastD) > 0.0004) {
      lastD = d;
      updateBeats(d);
    }
  }

  function updateBeats(d) {
    var beats = $$('.beat');
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      var a = parseFloat(b.dataset.in), z = parseFloat(b.dataset.out);
      b.classList.toggle('on', d >= a && d < z);
    }
    var lunge = state.climax.on || d > 0.862;
    var lt = $('#lungeTitle');
    if (lt) lt.classList.toggle('on', lunge && !state.ending);
    var st = $('.stage');
    if (st) st.classList.toggle('engaged', d > 0.002);
    if (d > 0.862 && !state.climax.on && !state.ending) climax();
  }

  /* progress bar in the marketing part */
  function updateBar() {
    var bar = $('#bar');
    if (!bar) return;
    bar.style.width = (state.p * 100).toFixed(2) + '%';
  }

  /* ---------------------------------------------------------
     CURSOR / ORB
     --------------------------------------------------------- */
  function updateCursor() {
    var c = $('#cursor');
    if (!c) return;
    state.cur.x = lerp(state.cur.x, state.mouse.x, reduced ? 1 : 0.22);
    state.cur.y = lerp(state.cur.y, state.mouse.y, reduced ? 1 : 0.22);
    c.style.transform = 'translate3d(' + (state.cur.x - 13) + 'px,' + (state.cur.y - 13) + 'px,0)';
  }

  var orb = $('#orb'), pupil = $('#orbPupil');
  function updateOrb(t) {
    if (!orb || !pupil) return;
    var r = orb.getBoundingClientRect();
    if (r.bottom < -200 || r.top > window.innerHeight + 200) return;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = state.mouse.x - cx, dy = state.mouse.y - cy;
    var dist = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (r.width * 1.1));
    var ang = Math.atan2(dy, dx);
    var max = r.width * 0.19;
    var px = Math.cos(ang) * max * dist;
    var py = Math.sin(ang) * max * dist;
    pupil.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
  }
  var blinkTimer = null;
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(function () {
      if (!orb) return;
      if (state.act >= 1 && state.act < 3) {
        orb.classList.add('blink');
        setTimeout(function () { orb.classList.remove('blink'); }, 520);
      }
      scheduleBlink();
    }, 5200 + Math.random() * 8000);
  }

  window.addEventListener('pointermove', function (e) {
    state.mouse.x = e.clientX; state.mouse.y = e.clientY;
    state.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouse.ny = (e.clientY / window.innerHeight) * 2 - 1;
    state.lastMove = Date.now();
    state.idleFired = false;
    if (!state.moved) {
      state.moved = true;
      $('#cursor').classList.add('on');
    }
  }, { passive: true });

  /* ---------------------------------------------------------
     CANVAS — the room at the end
     --------------------------------------------------------- */
  var canvas = $('#scene');
  var ctx = canvas ? canvas.getContext('2d') : null;
  var CW = 0, CH = 0, DPR = 1;

  function resizeCanvas() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 1.8);
    CW = Math.max(1, Math.round(r.width || window.innerWidth));
    CH = Math.max(1, Math.round(r.height || window.innerHeight));
    canvas.width = Math.round(CW * DPR);
    canvas.height = Math.round(CH * DPR);
  }

  function drawScene(t) {
    if (!ctx || !state.sceneVisible || state.ending) return;
    var w = CW, h = CH, d = state.d;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var camX = Math.sin(t * 0.17) * 0.04 + state.mouse.nx * 0.06;
    var camY = Math.sin(t * 0.23) * 0.016 + state.mouse.ny * 0.018;
    var f = h * 0.95;
    var cx = w * (w > 900 ? 0.615 : 0.5);
    var cy = h * 0.5 + h * 0.02;
    function sx(X, Z) { return cx + (X - camX) * f / Z; }
    function sy(Y, Z) { return cy + (Y - camY) * f / Z; }

    // room atmosphere
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
    bg.addColorStop(0, '#100d0b');
    bg.addColorStop(0.45, '#070605');
    bg.addColorStop(1, '#010101');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // corridor extent
    var z0 = 0.5, zN = 25, N = 34;
    var zs = [];
    for (var i = 0; i <= N; i++) zs.push(z0 * Math.pow(zN / z0, i / N));
    var half = 1.0, floorY = 1.0, ceilY = -1.0;

    // far wall, then the light at the end — which is an eye
    ctx.fillStyle = 'rgb(5,4,4)';
    ctx.fillRect(sx(-half, zN), sy(ceilY, zN), sx(half, zN) - sx(-half, zN), sy(floorY, zN) - sy(ceilY, zN));
    var EZ = 24.4;
    var openness = clamp((d - 0.08) / 0.34, 0, 1);
    drawEndEye(sx(0, EZ), sy(-0.05, EZ), (f / EZ) * 1.15, openness, t);

    var wallBase = [27, 25, 22], floorBase = [22, 19, 16], ceilBase = [15, 14, 13];
    var fogC = [5, 4, 4];
    for (var s = N - 1; s >= 0; s--) {
      var z1 = zs[s], z2 = zs[s + 1], mid = (z1 + z2) / 2;
      var fog = 1 - Math.exp(-mid * 0.105);
      var seam = s % 2 ? 1.0 : 0.93;
      var wc = mix(wallBase, fogC, fog * 0.96);
      var fc = mix(floorBase, fogC, fog * 0.94);
      var cc = mix(ceilBase, fogC, fog * 0.95);
      var wcol = rgb(wc[0] * seam, wc[1] * seam, wc[2] * seam);
      var fcol = rgb(fc[0], fc[1], fc[2]);
      var ccol = rgb(cc[0], cc[1], cc[2]);

      quad(sx(-half, z1), sy(ceilY, z1), sx(-half, z2), sy(ceilY, z2), sx(-half, z2), sy(floorY, z2), sx(-half, z1), sy(floorY, z1), wcol);
      quad(sx(half, z1), sy(ceilY, z1), sx(half, z2), sy(ceilY, z2), sx(half, z2), sy(floorY, z2), sx(half, z1), sy(floorY, z1), rgb(wc[0] * seam * 1.12, wc[1] * seam * 1.12, wc[2] * seam * 1.12));
      quad(sx(-half, z1), sy(floorY, z1), sx(-half, z2), sy(floorY, z2), sx(half, z2), sy(floorY, z2), sx(half, z1), sy(floorY, z1), fcol);
      quad(sx(-half, z1), sy(ceilY, z1), sx(-half, z2), sy(ceilY, z2), sx(half, z2), sy(ceilY, z2), sx(half, z1), sy(ceilY, z1), ccol);
    }

    // where the wall meets the floor
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(-half, z0), sy(floorY, z0));
    ctx.lineTo(sx(-half, zN), sy(floorY, zN));
    ctx.moveTo(sx(half, z0), sy(floorY, z0));
    ctx.lineTo(sx(half, zN), sy(floorY, zN));
    ctx.stroke();

    // the door from the copy
    (function () {
      var dz1 = 6.4, dz2 = 7.6;
      quad(sx(-half, dz1), sy(-0.34, dz1), sx(-half, dz2), sy(-0.34, dz2), sx(-half, dz2), sy(floorY, dz2), sx(-half, dz1), sy(floorY, dz1), '#080706');
      ctx.strokeStyle = 'rgba(126,112,94,.14)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sx(-half, dz1), sy(-0.34, dz1));
      ctx.lineTo(sx(-half, dz1), sy(floorY, dz1));
      ctx.moveTo(sx(-half, dz2), sy(-0.34, dz2));
      ctx.lineTo(sx(-half, dz2), sy(floorY, dz2));
      ctx.moveTo(sx(-half, dz1), sy(-0.34, dz1));
      ctx.lineTo(sx(-half, dz2), sy(-0.34, dz2));
      ctx.stroke();
    })();

    // ceiling lights, going out one at a time
    var lampZ = [4.6, 10.2, 16.5];
    for (var li = 0; li < 3; li++) {
      var lz2 = lampZ[li];
      var kill = 0.30 + li * 0.17;
      var on = 1;
      if (d > kill) {
        var fl = Math.sin(t * (8 + li * 4)) * Math.sin(t * 2.1 + li * 1.7);
        on = fl > 0.22 ? 0.45 : 0.05;
        if (d > kill + 0.055) on = 0.03;
      }
      drawCeilLight(sx(0, lz2), sy(ceilY, lz2), (f / lz2) * 0.42, on, sx(0, lz2), sy(floorY, lz2), (f / lz2) * 1.25);
    }

    // light spilling down the hall from the far end
    var ex0 = sx(0, EZ), ey0 = sy(-0.05, EZ);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var eg = ctx.createRadialGradient(ex0, ey0, 0, ex0, ey0, h * 0.6);
    eg.addColorStop(0, 'rgba(196,150,110,' + (0.16 * (0.35 + openness * 0.65)) + ')');
    eg.addColorStop(0.4, 'rgba(150,110,80,' + (0.06 * (0.35 + openness)) + ')');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    if (!state.climax.on) drawFigure(d, t, sx, sy, f, half, floorY);
    else if (state.climax.k > 0.22) drawEyes(state.climax.k, t);
    else drawFigure(1, t, sx, sy, f, half, floorY);

    // bloom / halation
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var halo = ctx.createRadialGradient(cx, cy - h * 0.04, 0, cx, cy, h * 0.7);
    halo.addColorStop(0, 'rgba(140,116,90,0.045)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function drawCeilLight(x, yTop, tubeR, on, fx, fy, floorR) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var glow = ctx.createRadialGradient(x, yTop, 0, x, yTop, tubeR * 3.4);
    glow.addColorStop(0, 'rgba(255,240,214,' + (0.5 * on) + ')');
    glow.addColorStop(0.28, 'rgba(255,224,188,' + (0.13 * on) + ')');
    glow.addColorStop(1, 'rgba(255,214,170,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x, yTop, tubeR * 3.4, tubeR * 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,246,228,' + (0.85 * on) + ')';
    ctx.beginPath();
    ctx.ellipse(x, yTop, tubeR, Math.max(1, tubeR * 0.11), 0, 0, Math.PI * 2);
    ctx.fill();

    var pool = ctx.createRadialGradient(fx, fy, 0, fx, fy, floorR);
    pool.addColorStop(0, 'rgba(198,174,142,' + (0.24 * on) + ')');
    pool.addColorStop(1, 'rgba(198,174,142,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(fx, fy, floorR, floorR * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgb(r, g, b) {
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }
  function quad(x1, y1, x2, y2, x3, y3, x4, y4, fill) {
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawEndEye(x, y, size, open, t) {
    var lit = 0.18 + 0.82 * open;
    var glow = ctx.createRadialGradient(x, y, 0, x, y, size * 7);
    glow.addColorStop(0, 'rgba(206,178,140,' + (0.22 * lit) + ')');
    glow.addColorStop(0.35, 'rgba(150,118,86,' + (0.09 * lit) + ')');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, size * 7, 0, Math.PI * 2); ctx.fill();

    var ew = size, eh = size * (0.08 + 0.42 * open);
    if (eh < 0.4) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - ew, y);
    ctx.quadraticCurveTo(x, y - eh * 1.55, x + ew, y);
    ctx.quadraticCurveTo(x, y + eh * 1.35, x - ew, y);
    ctx.closePath();
    ctx.clip();

    var sc = ctx.createRadialGradient(x, y - eh * 0.2, 0, x, y, ew);
    sc.addColorStop(0, 'rgba(232,220,200,' + (0.95 * lit) + ')');
    sc.addColorStop(0.7, 'rgba(176,160,136,' + (0.85 * lit) + ')');
    sc.addColorStop(1, 'rgba(96,86,72,' + (0.7 * lit) + ')');
    ctx.fillStyle = sc;
    ctx.fillRect(x - ew, y - eh * 2, ew * 2, eh * 4);

    var ir = size * 0.5;
    var ig = ctx.createRadialGradient(x, y, ir * 0.2, x, y, ir);
    ig.addColorStop(0, 'rgba(126,66,46,1)');
    ig.addColorStop(0.65, 'rgba(74,32,24,1)');
    ig.addColorStop(1, 'rgba(24,10,8,1)');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(x, y, ir, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#040202';
    ctx.beginPath(); ctx.arc(x, y, ir * 0.45, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(255,250,240,.7)';
    ctx.beginPath(); ctx.arc(x - ir * 0.3, y - ir * 0.34, ir * 0.12, 0, Math.PI * 2); ctx.fill();

    var lg = ctx.createLinearGradient(0, y - eh * 1.6, 0, y);
    lg.addColorStop(0, 'rgba(0,0,0,.98)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x - ew, y - eh * 1.7, ew * 2, eh * 1.5);

    var lg2 = ctx.createLinearGradient(0, y + eh * 1.4, 0, y);
    lg2.addColorStop(0, 'rgba(0,0,0,.95)');
    lg2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg2;
    ctx.fillRect(x - ew, y, ew * 2, eh * 1.5);
    ctx.restore();
  }

  function drawFigure(d, t, sx, sy, f, half, floorY) {
    var p = clamp((d - 0.30) / 0.575, 0, 1);
    if (p <= 0) return;
    var figZ = Math.max(1.55, 20 * Math.exp(-3.05 * Math.pow(p, 0.8)));
    var fx = sx(Math.sin(t * 0.5) * 0.012, figZ);
    var feet = sy(floorY, figZ);
    var head = sy(-0.74, figZ);
    var hgt = feet - head;
    if (hgt < 2) return;

    var alpha = clamp((20 - figZ) / 4, 0, 1);
    var headR = hgt * 0.075;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#010101';
    ctx.strokeStyle = 'rgba(150,138,120,.10)';
    ctx.lineWidth = Math.max(0.6, hgt * 0.0016);

    // legs
    ctx.beginPath();
    ctx.moveTo(fx - hgt * 0.075, feet);
    ctx.lineTo(fx - hgt * 0.055, feet - hgt * 0.47);
    ctx.lineTo(fx + hgt * 0.055, feet - hgt * 0.47);
    ctx.lineTo(fx + hgt * 0.075, feet);
    ctx.lineTo(fx + hgt * 0.028, feet);
    ctx.lineTo(fx + hgt * 0.01, feet - hgt * 0.44);
    ctx.lineTo(fx - hgt * 0.01, feet - hgt * 0.44);
    ctx.lineTo(fx - hgt * 0.028, feet);
    ctx.closePath();
    ctx.fill();

    // torso
    ctx.beginPath();
    ctx.moveTo(fx - hgt * 0.105, feet - hgt * 0.47);
    ctx.quadraticCurveTo(fx - hgt * 0.14, feet - hgt * 0.70, fx - hgt * 0.095, feet - hgt * 0.855);
    ctx.quadraticCurveTo(fx, feet - hgt * 0.90, fx + hgt * 0.095, feet - hgt * 0.855);
    ctx.quadraticCurveTo(fx + hgt * 0.14, feet - hgt * 0.70, fx + hgt * 0.105, feet - hgt * 0.47);
    ctx.closePath();
    ctx.fill();

    // arms — a little too long
    ctx.lineWidth = hgt * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(fx - hgt * 0.09, feet - hgt * 0.845);
    ctx.quadraticCurveTo(fx - hgt * 0.16, feet - hgt * 0.60, fx - hgt * 0.125, feet - hgt * 0.34);
    ctx.moveTo(fx + hgt * 0.09, feet - hgt * 0.845);
    ctx.quadraticCurveTo(fx + hgt * 0.16, feet - hgt * 0.60, fx + hgt * 0.125, feet - hgt * 0.34);
    ctx.strokeStyle = '#010101';
    ctx.stroke();

    // neck + head
    ctx.fillStyle = '#010101';
    ctx.fillRect(fx - hgt * 0.022, feet - hgt * 0.90, hgt * 0.044, hgt * 0.045);
    ctx.beginPath();
    ctx.ellipse(fx, feet - hgt * 0.935, headR * 0.86, headR, 0, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    if (hgt > 46) {
      var ey = feet - hgt * 0.945;
      var ex = headR * 0.36;
      var er = Math.max(1, hgt * 0.010);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (var i = -1; i <= 1; i += 2) {
        var g = ctx.createRadialGradient(fx + ex * i, ey, 0, fx + ex * i, ey, er * 4);
        g.addColorStop(0, 'rgba(220,205,180,.95)');
        g.addColorStop(0.35, 'rgba(160,60,50,.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(fx + ex * i, ey, er * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(238,228,210,.95)';
        ctx.beginPath(); ctx.arc(fx + ex * i, ey, er, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // up close: a mouth appears where a mouth should not be
    if (hgt > CH * 0.42) {
      var my = feet - hgt * 0.885;
      var mw = headR * 0.55, mh = headR * 0.22 * clamp((hgt - CH * 0.42) / (CH * 0.4), 0, 1);
      ctx.fillStyle = 'rgba(2,1,1,.9)';
      ctx.beginPath();
      ctx.ellipse(fx, my, mw, Math.max(1, mh), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEyes(k, t) {
    var w = CW, h = CH;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // the suggestion of something behind the eyes
    var g = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, h * 0.8);
    g.addColorStop(0, 'rgba(34,29,25,' + (0.8 * k) + ')');
    g.addColorStop(0.55, 'rgba(14,11,9,' + (0.85 * k) + ')');
    g.addColorStop(1, 'rgba(0,0,0,' + k + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // a blink, just before the light
    var blink = 1;
    if (k > 0.7) {
      var b = clamp((k - 0.7) / 0.12, 0, 1);
      blink = b < 0.5 ? 1 - b * 1.7 : 0.15 + (b - 0.5) * 1.7;
    }

    var s = 0.92 + k * 0.42;
    var drift = Math.sin(t * 0.55) * w * 0.004;
    ctx.save();
    ctx.translate(w / 2 + drift, h * 0.47);
    ctx.scale(s, s);
    var ex = w * 0.136, ew = w * 0.082, eh = h * 0.075 * blink;
    drawMacroEye(-ex, 2, ew * 0.97, eh * 0.97, k, t, -1);
    drawMacroEye(ex, -3, ew * 1.03, eh * 1.03, k, t, 1);
    ctx.restore();
  }

  function drawMacroEye(x, y, ew, eh, k, t, side) {
    // socket shadow around the eye
    var sg = ctx.createRadialGradient(x, y, ew * 0.2, x, y, ew * 2.3);
    sg.addColorStop(0, 'rgba(46,22,18,' + (0.5 * k) + ')');
    sg.addColorStop(0.55, 'rgba(22,12,10,' + (0.35 * k) + ')');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(x, y, ew * 2.3, eh * 2.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - ew, y);
    ctx.quadraticCurveTo(x, y - eh * 1.5, x + ew, y);
    ctx.quadraticCurveTo(x, y + eh * 1.3, x - ew, y);
    ctx.closePath();
    ctx.clip();

    var g = ctx.createRadialGradient(x - ew * 0.1, y - eh * 0.5, 0, x, y, ew * 1.1);
    g.addColorStop(0, 'rgba(206,201,188,' + (0.95 * k) + ')');
    g.addColorStop(0.5, 'rgba(152,146,132,' + (0.92 * k) + ')');
    g.addColorStop(1, 'rgba(54,50,42,' + (0.95 * k) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x - ew, y - eh * 2, ew * 2, eh * 4);

    // grain in the sclera
    for (var n = 0; n < 34; n++) {
      var rr = Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
      var rr2 = Math.abs(Math.sin(n * 78.233) * 12543.21) % 1;
      var nx = x + (rr - 0.5) * ew * 1.85;
      var ny = y + (rr2 - 0.5) * eh * 1.7;
      ctx.fillStyle = 'rgba(38,26,20,' + ((0.06 + rr * 0.1) * k) + ')';
      ctx.fillRect(nx, ny, 1 + rr2 * 2, 1 + rr * 2);
    }

    // blood
    ctx.strokeStyle = 'rgba(116,30,26,' + (0.42 * k) + ')';
    ctx.lineWidth = Math.max(1, ew * 0.006);
    for (var v = 0; v < 7; v++) {
      var a = -1.1 + v * 0.36;
      var sgn = v % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(x + sgn * ew * 0.98, y + Math.sin(a) * eh * 0.45);
      ctx.quadraticCurveTo(x + sgn * ew * 0.6, y + Math.sin(a + 1.4) * eh * 0.7, x + sgn * ew * 0.3, y + Math.sin(a) * eh * 0.16);
      ctx.stroke();
    }

    var ir = ew * 0.46;
    var ig = ctx.createRadialGradient(x, y, ir * 0.15, x, y, ir);
    ig.addColorStop(0, 'rgba(120,66,44,' + k + ')');
    ig.addColorStop(0.6, 'rgba(62,26,18,' + k + ')');
    ig.addColorStop(1, 'rgba(12,5,4,' + k + ')');
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(x, y, ir, ir * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();

    // iris fibres
    ctx.strokeStyle = 'rgba(160,96,60,' + (0.16 * k) + ')';
    ctx.lineWidth = Math.max(1, ew * 0.004);
    for (var f = 0; f < 18; f++) {
      var fa = (f / 18) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(fa) * ir * 0.55, y + Math.sin(fa) * ir * 0.55);
      ctx.lineTo(x + Math.cos(fa) * ir * 0.95, y + Math.sin(fa) * ir * 0.95);
      ctx.stroke();
    }

    var pr = ir * (0.40 + 0.28 * k);
    ctx.fillStyle = 'rgba(2,1,1,' + k + ')';
    ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(255,250,240,' + (0.6 * k) + ')';
    ctx.beginPath(); ctx.arc(x - pr * 0.5, y - pr * 0.55, pr * 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,' + (0.16 * k) + ')';
    ctx.beginPath(); ctx.arc(x + pr * 0.4, y + pr * 0.42, pr * 0.34, 0, Math.PI * 2); ctx.fill();

    // upper lid
    var lg = ctx.createLinearGradient(0, y - eh * 1.5, 0, y - eh * 0.15);
    lg.addColorStop(0, 'rgba(0,0,0,' + k + ')');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x - ew, y - eh * 1.6, ew * 2, eh * 1.5);

    // lower lid
    var lg2 = ctx.createLinearGradient(0, y + eh * 1.25, 0, y + eh * 0.5);
    lg2.addColorStop(0, 'rgba(0,0,0,' + (0.9 * k) + ')');
    lg2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg2;
    ctx.fillRect(x - ew, y + eh * 0.4, ew * 2, eh * 1.1);

    ctx.restore();
  }

  /* ---------------------------------------------------------
     CLIMAX
     --------------------------------------------------------- */
  function climax() {
    if (state.climax.on) return;
    state.climax.on = true;
    state.climax.start = performance.now();
    var stage = $('.stage');
    if (stage) stage.classList.add('shake', 'dying');
    $('#dialog').classList.remove('show');
    $('#toast').classList.remove('show');
    audio.riser();
    $('#lungeTitle').classList.add('on');

    requestAnimationFrame(function anim(now) {
      var k = clamp((now - state.climax.start) / 1300, 0, 1);
      state.climax.k = k;
      if (k < 1) requestAnimationFrame(anim);
    });

    setTimeout(function () {
      var fl = $('#flash');
      if (fl) {
        fl.style.transition = 'none';
        fl.style.opacity = '0.92';
        setTimeout(function () {
          fl.style.transition = 'opacity .5s ease';
          fl.style.opacity = '0';
        }, 90);
      }
      audio.hit();
    }, 1150);

    setTimeout(function () {
      if (stage) stage.classList.remove('shake');
      state.climax.k = 0;
      state.climax.on = false;
      state.ending = true;
      $('#lungeTitle').classList.remove('on');
      var af = $('#after');
      if (af) { af.classList.add('show'); af.setAttribute('aria-hidden', 'false'); }
      audio.stop();
      setTimeout(function () { if (audio.ctx) { audio.on = true; audio.master.gain.setValueAtTime(0.12, audio.ctx.currentTime); audio.breathe(); } }, 2600);
      revealAfter();
    }, 1900);
  }

  function revealAfter() {
    var lines = ['#al1', '#al2', '#al3'];
    lines.forEach(function (sel, i) {
      setTimeout(function () {
        var el = $(sel);
        if (el) el.classList.add('on');
      }, 700 + i * 1500);
    });
    setTimeout(function () {
      var e = elapsed();
      var meta = $('#al4');
      if (meta) {
        meta.textContent = '本次会话 · ' + mmss(e) + ' · 你在这里停留了 ' + Math.floor(e / 60) + ' 分 ' + pad(Math.floor(e % 60)) + ' 秒';
        meta.style.opacity = '0.6';
      }
    }, 5600);
    setTimeout(function () {
      var acts = $('.after-actions');
      if (acts) acts.classList.add('on');
    }, 6400);
  }

  /* ---------------------------------------------------------
     DIALOG
     --------------------------------------------------------- */
  var dialog = $('#dialog');
  var dialogShown = false;
  function showDialog() {
    if (dialogShown || !dialog) return;
    dialogShown = true;
    dialog.classList.add('show');
    setTimeout(function () {
      if (!dialog.classList.contains('connected')) dialog.classList.remove('show');
    }, 11000);
  }
  function dialogConnect(which) {
    var t = $('#dlgTitle'), p = $('#dlgText'), acts = $('#dlgActions');
    if (which === 'no') {
      dialog.classList.add('shake');
      setTimeout(function () { dialog.classList.remove('shake'); }, 420);
      if (t) t.textContent = '没有「稍后」这个选项。';
      if (p) p.innerHTML = '它已经连接了。<br>从第一晚开始。';
    } else {
      if (t) t.textContent = '已连接';
      if (p) p.innerHTML = '设备已在你的床下。<br>正在同步…';
    }
    dialog.classList.add('connected');
    audio.thump();
    setTimeout(function () {
      dialog.classList.remove('show');
      toast('同步完成。今晚见。', 3200);
    }, 2400);
  }

  /* ---------------------------------------------------------
     BEATS / INIT
     --------------------------------------------------------- */
  function bind() {
    // sound gate
    var gate = $('#gate');
    setTimeout(function () { if (gate) gate.classList.add('show'); }, 2600);
    setTimeout(function () {
      if (gate && !audio.on && !gate.classList.contains('hide')) gate.classList.add('hide');
    }, 32000);

    function enableSound() {
      audio.start();
      $('#soundBtn').setAttribute('aria-pressed', 'true');
      if (gate) gate.classList.add('hide');
      toast('声音已开启。', 2200);
    }
    $('#gateBtn').addEventListener('click', enableSound);
    $('#gateNo').addEventListener('click', function () {
      if (gate) gate.classList.add('hide');
    });
    $('#soundBtn').addEventListener('click', function () {
      if (audio.on) {
        audio.stop();
        this.setAttribute('aria-pressed', 'false');
        toast('静音。', 1800);
      } else {
        enableSound();
      }
    });

    // dialog
    $('#dlgOk').addEventListener('click', function () { dialogConnect('ok'); });
    $('#dlgNo').addEventListener('click', function () { dialogConnect('no'); });

    // buy
    $$('[data-buy]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        if (state.act >= 2) toast('它已经在路上了。', 3200);
        else toast('已加入。你的夜晚已排入队列。', 2800);
      });
    });

    // escape hatches
    function bail() {
      document.documentElement.style.scrollBehavior = 'auto';
      try { audio.stop(); } catch (e) { }
      state.ending = true;
      var af = $('#after'); if (af) af.classList.remove('show');
      window.scrollTo(0, 0);
      setTimeout(function () { location.reload(); }, 60);
    }
    $('#bail').addEventListener('click', bail);
    $('#wakeBtn').addEventListener('click', bail);
    $('#restartBtn').addEventListener('click', function () { location.reload(); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') bail();
    });

    // nav scroll state
    window.addEventListener('scroll', function () {
      var nav = $('#nav');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });

    // fake device dialog when the science section shows up
    whenVisible('.science', mutateScience, 1800, 0.3);
    whenVisible('.stats', mutateStats, 1100, 0.35);
    whenVisible('.voices', mutateVoices, 1500, 0.28);
    whenVisible('.pricing', mutatePrices, 1600, 0.22);
    whenVisible('.faq', mutateFaq, 1800, 0.3);

    // stat counters
    if ('IntersectionObserver' in window) {
      var sio = new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          if (!e.isIntersecting) return;
          var el = e.target;
          sio.unobserve(el);
          var to = parseInt(el.dataset.to || '0', 10);
          countTo(el, Math.round(to * 0.72), to, 1200);
        });
      }, { threshold: 0.5 });
      $$('.stat-num [data-to]').forEach(function (el) { sio.observe(el); });
    }

    // returning to the tab
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.act >= 4 && !state.ending) {
        toast('你回来了。它没有离开。', 3600);
      }
    });

    // idle
    setInterval(function () {
      if (state.act >= 5 && state.act < 6 && !state.ending && Date.now() - state.lastMove > 9000 && !state.idleFired) {
        state.idleFired = true;
        toast('它看见你了。', 2600);
        var st = $('.stage');
        if (st) { st.classList.add('shake'); setTimeout(function () { st.classList.remove('shake'); }, 700); }
      }
    }, 1200);

    // debug jump: ?d=0.62 or ?p=0.4
    var q = new URLSearchParams(location.search);
    var qd = q.get('d'), qp = q.get('p');
    if (qd !== null || qp !== null) {
      setTimeout(function () {
        document.documentElement.style.scrollBehavior = 'auto';
        var y;
        if (qd !== null) y = state.descentTop + parseFloat(qd) * state.descentSpan;
        else y = parseFloat(qp) * state.maxScroll;
        window.scrollTo(0, y);
      }, 120);
    }
  }

  var countTokens = {};
  function countTo(el, from, to, dur) {
    if (!el) return;
    var id = el.id || 'x';
    countTokens[id] = (countTokens[id] || 0) + 1;
    var token = countTokens[id];
    var start = performance.now();
    function step(now) {
      if (el.dataset.locked === '1' || countTokens[id] !== token) return;
      var t = clamp((now - start) / dur, 0, 1);
      var v = Math.round(from + (to - from) * easeOut(t));
      el.textContent = v;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------
     MAIN LOOP
     --------------------------------------------------------- */
  var lastFrame = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    updateScroll();
    updateBar();
    if (now - lastFrame > 12) {
      lastFrame = now;
      updateCursor();
      updateOrb(now / 1000);
    }
    drawScene(now / 1000);
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  function boot() {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    buildChart();
    initSession();
    measure();
    bind();
    scheduleBlink();
    resizeCanvas();

    var desc = $('#descent');
    if (desc && 'IntersectionObserver' in window) {
      var dio = new IntersectionObserver(function (en) {
        en.forEach(function (e) { state.sceneVisible = e.isIntersecting; });
      }, { threshold: 0 });
      dio.observe(desc);
    } else {
      state.sceneVisible = true;
    }

    state.lastY = window.scrollY || 0;
    updateScroll();
    requestAnimationFrame(loop);

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { measure(); });
    }
    setTimeout(measure, 800);
    setTimeout(measure, 2400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})();
