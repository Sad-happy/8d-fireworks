/* 8d-fireworks renderer — full-screen canvas show driven by feeder events.
 *
 * Data: polls state.json next to this page (served by the host plugin from
 * ~/.dsh/fireworks/state.json). Events carry monotonic ids and are consumed
 * exactly once. Physics steps are fixed at 30 Hz; rendering runs on
 * requestAnimationFrame.
 *
 * The canvas is fully cleared and redrawn every frame (same lesson as the
 * tkinter original: no item churn, no z-order burial). Background stays
 * transparent so the DSH app content above the iframe shows through.
 *
 * Show content (2026-11 rewrite):
 *   - ten shell types: peony / chrysanthemum / willow / ring / heart /
 *     crossette / palm / glitter / spiral / double, plus a multi-break
 *     "grand" finale and delayed secondary bursts;
 *   - a real lunar phase: the moon is drawn from the current date
 *     (synodic month + a 2000-01-06 new-moon epoch) with an exact
 *     terminator ellipse, warm glow, rim and craters;
 *   - a layered star field (170 stars, milky-way band, twinkle, cross
 *     flares) and occasional shooting stars;
 *   - additive ("lighter") spark rendering with glow halos and trails.
 *
 * Colors are kept saturated at mid lightness so the show reads both on the
 * light glass theme (white translucent shell) and on the dark one.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // probe: gold dot = this external script is executing at all
  try {
    var _mk = document.getElementById('mk');
    if (_mk) { _mk.style.background = '#ffd76a'; _mk.style.boxShadow = '0 0 6px #ffd76a'; }
  } catch (e) { /* standalone debugging */ }

  // ---------- setup ----------
  var cv = document.getElementById('sky');
  var hint = document.getElementById('hint');
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1, S = 1;

  function params() {
    try { return new URLSearchParams(location.search); }
    catch (e) { return new URLSearchParams(); }
  }
  var density = 100;                     // percent, 50..150
  var d = params().get('density');
  if (d) { var v = Number(d); if (Number.isFinite(v)) density = Math.min(150, Math.max(50, v)); }
  // debug: ?moon=0.25 freezes the phase (0=new, .5=full) to eyeball the terminator
  var phaseOverride = null;
  var moonOverride = null;               // set by the settings panel; null = follow the real date
  var mo = params().get('moon');
  if (mo !== null && mo !== '') {
    var mv = Number(mo);
    if (Number.isFinite(mv)) phaseOverride = ((mv % 1) + 1) % 1;
  }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (!m || m.type !== 'fw-set') return;
    if (Number.isFinite(Number(m.density))) {
      density = Math.min(150, Math.max(50, Number(m.density)));
    }
    if (m.moon === null || m.moon === undefined || m.moon === '') {
      moonOverride = null;               // panel switch: auto (track the sky)
    } else if (Number.isFinite(Number(m.moon))) {
      moonOverride = ((Number(m.moon) % 1) + 1) % 1;
    }
    if (typeof m.show === 'boolean') show = m.show;
  });

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(2.4, Math.max(1, H / 340));   // scale physics with height
  }
  window.addEventListener('resize', resize);
  resize();

  // deterministic RNG like the tkinter show
  // one function, two forms: rnd() -> raw sample; rnd(a, b) -> range sample.
  // (Two same-name declarations would shadow each other and recurse forever.)
  var seed = 20261102;
  function rnd(a, b) {
    if (a === undefined) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    return a + (b - a) * rnd();
  }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // ---------- palette ----------
  // Hue-family groups; bursts pick one family and stay inside it so a show
  // feels composed instead of rainbow soup.
  var PALETTES = [
    [0.015, 0.045, 0.085],      // ember red / orange
    [0.095, 0.12, 0.145],       // gold / amber
    [0.50, 0.53, 0.56],         // ice blue
    [0.58, 0.62, 0.665],        // blue / indigo
    [0.74, 0.79, 0.845],        // violet / magenta
    [0.90, 0.945, 0.975],       // rose / pink
    [0.30, 0.335, 0.375],       // jade / teal
    [0.13, 0.955, 0.58]         // warm + rose duet
  ];
  function hueSet() { return pick(PALETTES); }

  function col(hue, sat, light, alpha) {
    var h = (((hue % 1) + 1) % 1) * 360;
    var s = Math.round(clamp(sat, 0, 1) * 100);
    var l = Math.round(clamp(light, 0, 1) * 100);
    var a = (alpha === undefined ? 1 : clamp(alpha, 0, 1)).toFixed(3);
    return 'hsla(' + h.toFixed(1) + ',' + s + '%,' + l + '%,' + a + ')';
  }

  // ---------- star field ----------
  var STARS = [];
  (function buildStars() {
    for (var i = 0; i < 170; i++) {
      var inBand = rnd() < 0.42;          // milky-way band, top-left -> mid-right
      var x, y;
      if (inBand) {
        var t = rnd();
        x = 0.02 + 0.96 * t + rnd(-0.07, 0.07);
        y = 0.02 + 0.52 * t + rnd(-0.06, 0.06);
      } else {
        x = rnd(0.01, 0.99);
        y = rnd(0.01, 0.62);
      }
      var b = Math.pow(rnd(), 1.6) * 0.9 + 0.10;   // most stars dim, few bright
      var warm = rnd() < 0.22;
      STARS.push({
        x: clamp(x, 0.005, 0.995),
        y: clamp(y, 0.005, 0.66),
        b: b,
        size: 0.7 + b * 2.3,
        sp: rnd(0.4, 2.1),
        ph: rnd(0, TAU),
        hue: warm ? rnd(0.05, 0.14) : rnd(0.56, 0.64),
        sat: warm ? 0.55 : 0.38,
        flare: b > 0.62 && rnd() < 0.62
      });
    }
  })();

  // ---------- moon ----------
  var MOON_X = 0.425;                    // fraction of viewport (top-centre)
  var MOON_Y = 0.078;
  var SYNODIC = 29.530588853;            // days
  var NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);
  var CRATERS = [];
  (function buildCraters() {
    for (var i = 0; i < 10; i++) {
      var a = rnd(0, TAU), r = Math.sqrt(rnd()) * 0.68;
      CRATERS.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        r: rnd(0.06, 0.19),
        a: rnd(0.05, 0.13)
      });
    }
  })();

  function lunarPhase(ms) {
    var age = (ms - NEW_MOON_EPOCH) / 86400000;
    return ((age % SYNODIC) + SYNODIC) % SYNODIC / SYNODIC;   // 0=new, .5=full
  }

  // ---------- show state ----------
  var parts = [];       // sparks
  var rockets = [];
  var flashes = [];     // burst ring + core flash
  var delayed = [];     // secondary bursts (multi-break shells)
  var show = true;      // false = starry-sky-only mode (panel / voice ctl)
  var shooters = [];    // shooting stars
  var MAX_PARTS = 1400;
  var tick = 0;
  var nextShoot = 5000 + rnd(0, 6000);
  var lastDemo = 0;

  // burst spread calibration: 1600x900 viewports looked sparse with the raw
  // physics speeds, so sparks travel ~28% slower and read as a tighter bloom.
  var V_SPREAD = 0.62;

  function addPart(x, y, vx, vy, hue, life, opt) {
    opt = opt || {};
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push({
      x: x, y: y, vx: vx * V_SPREAD, vy: vy * V_SPREAD, hue: hue,
      age: 0, life: life,
      grav: opt.grav === undefined ? 0.05 : opt.grav,
      drag: opt.drag === undefined ? 0.986 : opt.drag,
      size: opt.size || 1.6,
      trail: opt.trail || 3,
      spark: !!opt.spark,
      light: opt.light || 0.62,
      sat: opt.sat === undefined ? 1 : opt.sat,
      split: !!opt.split,
      splitDone: false,
      splitHue: opt.splitHue,
      hist: []
    });
  }

  function chooseType(s) {
    if (s >= 0.84) {
      return pick(['grand', 'heart', 'chrysanthemum', 'crossette', 'double', 'willow', 'peony', 'pistil']);
    }
    if (s >= 0.55) {
      return pick(['peony', 'chrysanthemum', 'ring', 'crossette', 'spiral', 'palm', 'glitter', 'willow', 'pistil', 'strobe']);
    }
    return pick(['peony', 'ring', 'glitter', 'strobe']);
  }

  // ---------- shell types ----------
  function burst(x, y, s, hue, forceType) {
    var type = forceType || chooseType(s);
    var set = hueSet();
    var h1 = hue === undefined ? pick(set) : hue;
    var h2 = pick(set);
    var dens = (density / 100) * 2.0;   // spark-count headroom for a fuller bloom
    var n = 0, sp = 0, k, ang, spd;

    switch (type) {
      case 'heart': {
        n = Math.round((54 + 40 * s) * dens);
        sp = (1.7 + 1.7 * s) * S;
        var hh = rnd() < 0.6 ? 0.955 : 0.02;
        for (k = 0; k < n; k++) {
          var ht = rnd(0, TAU);
          var hx = 16 * Math.pow(Math.sin(ht), 3);
          var hy = 13 * Math.cos(ht) - 5 * Math.cos(2 * ht) - 2 * Math.cos(3 * ht) - Math.cos(4 * ht);
          addPart(x, y, hx / 16 * sp + rnd(-0.25, 0.25), -hy / 16 * sp + rnd(-0.25, 0.25),
                  hh + rnd(-0.012, 0.012), Math.round(46 + 22 * s + rnd(0, 10)),
                  { grav: 0.045, drag: 0.986, trail: 4, size: 1.5 + rnd(0, 0.6), light: 0.63 });
        }
        break;
      }
      case 'chrysanthemum': {
        n = Math.round((44 + 50 * s) * dens);
        sp = (2.0 + 2.8 * s) * S;
        var gold = rnd() < 0.55;
        var ch = gold ? rnd(0.10, 0.14) : h1;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.78, 1.05);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  ch + rnd(-0.012, 0.012), Math.round(78 + 38 * s + rnd(0, 16)),
                  { grav: 0.055, drag: 0.988, trail: 7, size: 1.4 + rnd(0, 0.5), light: 0.64 });
        }
        break;
      }
      case 'willow': {
        n = Math.round((30 + 26 * s) * dens);
        sp = (1.5 + 1.5 * s) * S;
        var wh = rnd(0.09, 0.14);
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.5, 1.0);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  wh + rnd(-0.008, 0.008), Math.round(110 + 50 * s + rnd(0, 30)),
                  { grav: 0.10, drag: 0.992, trail: 9, size: 1.4 + rnd(0, 0.5), light: 0.60 });
        }
        break;
      }
      case 'ring': {
        var two = rnd() < 0.42;
        n = Math.max(36, Math.round((52 + 18 * s) * dens));
        sp = (3.9 + 3.0 * s) * S;
        var tilt = rnd(0.32, 0.72);
        var rot = rnd(0, TAU);
        for (k = 0; k < n; k++) {
          ang = rot + (k / n) * TAU;
          spd = sp * rnd(0.96, 1.04);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd * tilt,
                  h1 + rnd(-0.01, 0.01), Math.round(48 + 20 * s + rnd(0, 6)),
                  { grav: 0.045, drag: 0.987, trail: 5, size: 1.2, light: 0.62, spark: true });
          if (two && k % 2 === 0) {
            spd = sp * 0.62 * rnd(0.96, 1.04);
            addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd * tilt,
                    h2 + rnd(-0.01, 0.01), Math.round(40 + 18 * s),
                    { grav: 0.045, drag: 0.987, trail: 4, size: 1.1, light: 0.6, spark: true });
          }
        }
        break;
      }
      case 'crossette': {
        n = Math.round((26 + 12 * s) * dens);
        sp = (2.1 + 2.2 * s) * S;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          var split = rnd() < 0.45;
          addPart(x, y, Math.cos(ang) * sp * rnd(0.9, 1.05), Math.sin(ang) * sp * rnd(0.9, 1.05),
                  h1 + rnd(-0.012, 0.012), Math.round(54 + 20 * s),
                  { grav: 0.05, drag: 0.986, trail: 4, size: 1.5, split: split, splitHue: h2 });
        }
        break;
      }
      case 'palm': {
        n = Math.round((12 + 8 * s) * dens) + 6;
        sp = (2.6 + 2.6 * s) * S;
        var ph2 = rnd() < 0.5 ? rnd(0.09, 0.13) : h1;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.85, 1.05);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  ph2 + rnd(-0.008, 0.008), Math.round(66 + 24 * s),
                  { grav: 0.09, drag: 0.994, trail: 10, size: 2.1 + rnd(0, 0.6), light: 0.63 });
        }
        break;
      }
      case 'glitter': {
        n = Math.round((70 + 40 * s) * dens);
        sp = (1.1 + 2.2 * s) * S;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.4, 1.0);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  (rnd() < 0.6 ? rnd(0.10, 0.16) : h1) + rnd(-0.01, 0.01),
                  Math.round(42 + 18 * s + rnd(0, 10)),
                  { grav: 0.025, drag: 0.972, trail: 1, size: 1.0 + rnd(0, 0.5), spark: true, light: 0.70 });
        }
        break;
      }
      case 'spiral': {
        var arms = 3;
        n = Math.round((60 + 30 * s) * dens);
        for (k = 0; k < n; k++) {
          var st = k / n;
          ang = st * TAU * 2.2 + (k % arms) * TAU / arms;
          spd = (0.6 + 2.2 * st) * S * (1 + 0.55 * s);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  h1 + rnd(-0.01, 0.01), Math.round(50 + 24 * s),
                  { grav: 0.04, drag: 0.986, trail: 5, size: 1.4, light: 0.62 });
        }
        break;
      }
      case 'double': {
        var n2 = Math.round((40 + 30 * s) * dens);
        sp = (2.2 + 2.6 * s) * S;
        for (k = 0; k < n2; k++) {
          ang = rnd(0, TAU);
          addPart(x, y, Math.cos(ang) * sp * rnd(0.95, 1.05), Math.sin(ang) * sp * rnd(0.95, 1.05),
                  h1 + rnd(-0.01, 0.01), Math.round(54 + 20 * s),
                  { grav: 0.05, drag: 0.987, trail: 4, size: 1.5, light: 0.62 });
        }
        for (k = 0; k < Math.round(n2 * 0.6); k++) {
          ang = rnd(0, TAU);
          addPart(x, y, Math.cos(ang) * sp * 0.55, Math.sin(ang) * sp * 0.55,
                  h2 + rnd(-0.01, 0.01), Math.round(46 + 18 * s),
                  { grav: 0.045, drag: 0.985, trail: 3, size: 1.4, light: 0.6 });
        }
        break;
      }
      case 'grand': {
        n = Math.round((72 + 48 * s) * dens);
        sp = (2.6 + 3.0 * s) * S;
        var hues = [h1, h2, pick(hueSet())];
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.8, 1.12);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  hues[k % 3] + rnd(-0.012, 0.012), Math.round(58 + 28 * s),
                  { grav: 0.05, drag: 0.988, trail: 6, size: 1.6 + rnd(0, 0.6), light: 0.64 });
        }
        for (k = 0; k < Math.round(44 * dens); k++) {
          ang = rnd(0, TAU);
          addPart(x, y, Math.cos(ang) * sp * 0.45, Math.sin(ang) * sp * 0.45,
                  rnd(0.10, 0.16), Math.round(64 + rnd(0, 20)),
                  { grav: 0.02, drag: 0.972, trail: 1, size: 1.1, spark: true, light: 0.72 });
        }
        delayed.push({ at: tick + 16, x: x + rnd(-26, 26), y: y + rnd(-18, 18), s: s * 0.45, hue: h2, type: 'peony' });
        break;
      }
      case 'pistil': {
        n = Math.round((44 + 48 * s) * dens);
        sp = (2.4 + 2.7 * s) * S;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.86, 1.06);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  h1 + rnd(-0.012, 0.012), Math.round(46 + 26 * s + rnd(0, 12)),
                  { grav: 0.05, drag: 0.986, trail: 4, size: 1.7 + rnd(0, 0.6), light: 0.60 });
        }
        var np = Math.round((22 + 18 * s) * dens);
        for (k = 0; k < np; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.18, 0.38);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  h2 + rnd(-0.01, 0.01), Math.round(58 + 22 * s + rnd(0, 14)),
                  { grav: 0.03, drag: 0.99, trail: 2, size: 2.0 + rnd(0, 0.6), spark: true, light: 0.72 });
        }
        break;
      }
      case 'strobe': {
        n = Math.round((46 + 32 * s) * dens);
        sp = (1.5 + 2.0 * s) * S;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.55, 1.05);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  rnd(0.56, 0.63), Math.round(40 + 16 * s + rnd(0, 10)),
                  { grav: 0.02, drag: 0.972, trail: 2, size: 1.2 + rnd(0, 0.4), spark: true, light: 0.94, sat: 0.16 });
        }
        break;
      }
      case 'peony':
      default: {
        n = Math.round((46 + 62 * s) * dens);
        sp = (2.3 + 3.0 * s) * S;
        var bi = rnd() < 0.35;
        for (k = 0; k < n; k++) {
          ang = rnd(0, TAU);
          spd = sp * rnd(0.86, 1.1);
          addPart(x, y, Math.cos(ang) * spd, Math.sin(ang) * spd,
                  (bi && (k & 1) ? h2 : h1) + rnd(-0.012, 0.012),
                  Math.round(40 + 30 * s + rnd(0, 12)),
                  { grav: 0.048, drag: 0.985, trail: 3, size: 1.5 + rnd(0, 0.6), light: 0.62 });
        }
        break;
      }
    }
    flashes.push({ x: x, y: y, r: (12 + 24 * s) * S, hue: h1, age: 0 });
  }

  function launch(strength) {
    var set = hueSet();
    rockets.push({
      x: rnd(W * 0.18, W * 0.82), y: H + 4,
      vx: rnd(-0.35, 0.35),
      vy: -(3.4 + 3.6 * strength) * S,
      ty: H * (0.14 + 0.30 * (1.0 - strength)),
      hue: pick(set), s: strength, hist: []
    });
  }

  function crackle(strength) {
    var cx = rnd(W * 0.12, W * 0.88), cy = rnd(H * 0.06, H * 0.40);
    var n = Math.round((16 + 26 * strength) * density / 100) + 8;
    for (var k = 0; k < n; k++) {
      var ang = rnd(0, TAU), sp = rnd(0.4, 1.6) * S;
      addPart(cx, cy, Math.cos(ang) * sp, Math.sin(ang) * sp,
              rnd(0.09, 0.16), Math.round(rnd(12, 26)),
              { grav: 0.03, drag: 0.97, trail: 2, size: 1.1, spark: true, light: 0.70 });
    }
    flashes.push({ x: cx, y: cy, r: 8 * S, hue: 0.12, age: 0 });
  }

  // ---------- feeder polling ----------
  var lastEventId = 0;
  var lastBoot = 0;        // feeder process start epoch (meta.boot)
  var lastTs = 0;          // feeder clock
  var online = false;      // feeder fresh?
  var lastLaunch = 0;      // performance.now() ms, for quiet-sky fallback
  var pollBusy = false;
  var eventsSeen = 0;      // consumed-event counter (status badge)
  // ?demo=1 — ignore the feeder and fire a shell every ~2 s
  var demo = params().get('demo') === '1';

  function poll() {
    if (pollBusy) return;
    pollBusy = true;
    var stateUrl;
    try { stateUrl = new URL('state.json', location.href).href; }
    catch (e) { stateUrl = 'state.json'; }
    fetch(stateUrl, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        pollBusy = false;
        if (!data) { online = false; return; }
        lastTs = data.ts || 0;
        online = !data.stale;
        // feeder restarted?  its event ids start over, so a long-lived page
        // would drop every new event as "already seen" — detect and reset.
        var boot = (data.meta && data.meta.boot) || 0;
        if (boot && boot !== lastBoot) { lastBoot = boot; lastEventId = 0; }
        var events = data.events || [];
        for (var k = 0; k < events.length; k++) {
          var e = events[k];
          if (e.id > lastEventId) {
            lastEventId = e.id;
            eventsSeen++;
            if (online && show) {
              if (e.type === 'kick') launch(e.s);
              else if (e.type === 'crackle') crackle(e.s);
            }
          }
        }
      })
      .catch(function () { pollBusy = false; online = false; });
  }
  setInterval(poll, 33);

  // ---------- physics (fixed 30 Hz steps) ----------
  var STEP = 1000 / 30;

  function stepPhysics(nowMs) {
    tick++;

    // scheduled secondary bursts (multi-break shells)
    for (var di = delayed.length - 1; di >= 0; di--) {
      if (delayed[di].at <= tick) {
        var db = delayed.splice(di, 1)[0];
        burst(db.x, db.y, db.s, db.hue, db.type);
      }
    }

    // quiet-sky fallback: keep the show alive when music pauses
    if (show && online && nowMs - lastLaunch > 4500 && rockets.length < 6 * density / 100) {
      launch(0.30);
      lastLaunch = nowMs;
    }
    if (!online) lastLaunch = nowMs;
    if (demo && nowMs - lastDemo > 2000) { launch(0.85); lastDemo = nowMs; }

    var i, r, q, j;
    for (i = rockets.length - 1; i >= 0; i--) {
      r = rockets[i];
      r.hist.push([r.x, r.y]); if (r.hist.length > 6) r.hist.shift();
      r.x += r.vx; r.y += r.vy; r.vy += 0.020 * S;
      if (r.y <= r.ty || r.vy > -0.8 * S) {
        rockets.splice(i, 1);
        burst(r.x, r.y, r.s, r.hue);
        lastLaunch = nowMs;
      }
    }

    for (i = parts.length - 1; i >= 0; i--) {
      q = parts[i];
      q.hist.push([q.x, q.y]);
      if (q.hist.length > q.trail) q.hist.shift();
      q.vy += q.grav * S;
      q.vx *= q.drag; q.vy *= q.drag;
      q.x += q.vx; q.y += q.vy;
      q.age += 1;

      if (q.split && !q.splitDone && q.age > q.life * 0.55) {
        q.splitDone = true;
        for (j = 0; j < 4; j++) {
          var aa = rnd(0, TAU), ss = rnd(0.5, 1.1) * S;
          addPart(q.x, q.y, Math.cos(aa) * ss, Math.sin(aa) * ss,
                  q.splitHue || q.hue, Math.round(rnd(16, 26)),
                  { grav: 0.05, drag: 0.97, trail: 2, size: 1.2, spark: true, light: 0.72 });
        }
      }

      if (q.age >= q.life || q.y > H + 30) parts.splice(i, 1);
    }

    for (i = flashes.length - 1; i >= 0; i--) {
      flashes[i].age += 1;
      if (flashes[i].age > 7) flashes.splice(i, 1);
    }

    for (i = shooters.length - 1; i >= 0; i--) {
      var sh = shooters[i];
      sh.x += sh.vx; sh.y += sh.vy; sh.age += 1;
      if (sh.age >= sh.life) shooters.splice(i, 1);
    }

    if (nowMs > nextShoot) {
      shooters.push({
        x: rnd(W * 0.30, W * 0.95), y: rnd(H * 0.02, H * 0.16),
        vx: -rnd(11, 17), vy: rnd(3.5, 6.0), age: 0, life: 40,
        hue: rnd(0.55, 0.64)
      });
      nextShoot = nowMs + 8000 + rnd(0, 10000);
    }
  }

  // ---------- render ----------

  function drawStars(now) {
    ctx.globalCompositeOperation = 'lighter';
    var tw = now * 2.1;
    for (var k = 0; k < STARS.length; k++) {
      var st = STARS[k];
      var b = st.b * (0.68 + 0.32 * Math.sin(tw * st.sp + st.ph));
      var base = 0.28 + 0.36 * b;                 // 0.28..0.63
      var alpha = 0.42 + 0.58 * b;
      var x = st.x * W, y = st.y * H;

      ctx.fillStyle = col(st.hue, st.sat, base + 0.05, alpha * 0.12);
      dot(x, y, st.size * 2.5);
      ctx.fillStyle = col(st.hue, st.sat * 0.8, Math.min(0.82, base + 0.12), alpha);
      dot(x, y, st.size);

      if (st.flare) {
        var fl = st.size * (5.5 + 5 * b);
        ctx.strokeStyle = col(st.hue, st.sat * 0.5, Math.min(0.86, base + 0.20), alpha * 0.55);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x - fl, y); ctx.lineTo(x + fl, y);
        ctx.moveTo(x, y - fl); ctx.lineTo(x, y + fl);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawMoon() {
    var mx = W * MOON_X;
    var my = Math.max(H * MOON_Y, 10);
    var mr = Math.min(34, 18 * S);

    var phase = phaseOverride !== null ? phaseOverride
      : (moonOverride !== null ? moonOverride : lunarPhase(Date.now()));

    // wide warm halo
    var glow = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.8);
    glow.addColorStop(0, 'rgba(255,231,178,0.26)');
    glow.addColorStop(0.4, 'rgba(255,219,158,0.10)');
    glow.addColorStop(1, 'rgba(255,210,140,0)');
    ctx.fillStyle = glow;
    dot(mx, my, mr * 3.8);

    // unlit disc: cool earthshine with a soft falloff (readable on white)
    var dark = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    dark.addColorStop(0, 'rgba(88,96,118,0.48)');
    dark.addColorStop(0.7, 'rgba(56,62,80,0.42)');
    dark.addColorStop(1, 'rgba(32,37,52,0.36)');
    ctx.fillStyle = dark;
    circle(mx, my, mr);

    // lit part: right half + exact terminator ellipse; mirrored when waning.
    var cph = Math.cos(TAU * phase);
    ctx.save();
    ctx.translate(mx, my);
    if (phase > 0.5) ctx.scale(-1, 1);
    ctx.beginPath();
    ctx.arc(0, 0, mr, -Math.PI / 2, Math.PI / 2, false);
    if (cph >= 0) {
      ctx.ellipse(0, 0, Math.max(0.001, mr * cph), mr, 0, Math.PI / 2, -Math.PI / 2, true);
    } else {
      ctx.ellipse(0, 0, Math.max(0.001, -mr * cph), mr, 0, Math.PI / 2, Math.PI * 1.5, false);
    }
    ctx.closePath();
    var lit = ctx.createRadialGradient(-mr * 0.30, -mr * 0.32, mr * 0.05, 0, 0, mr * 1.05);
    lit.addColorStop(0, 'rgba(255,243,206,0.98)');
    lit.addColorStop(0.45, 'rgba(250,222,160,0.96)');
    lit.addColorStop(0.85, 'rgba(233,190,118,0.95)');
    lit.addColorStop(1, 'rgba(214,166,96,0.92)');
    ctx.fillStyle = lit;
    ctx.fill();
    ctx.restore();

    // craters: pit + sunlit rim, clipped to the disc
    ctx.save();
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.clip();
    for (var k = 0; k < CRATERS.length; k++) {
      var cr = CRATERS[k];
      var cx = mx + cr.x * mr, cy = my + cr.y * mr, crr = cr.r * mr;
      ctx.fillStyle = 'rgba(120,92,58,' + Math.min(0.6, cr.a * 1.15) + ')';
      dot(cx, cy, crr);
      ctx.fillStyle = 'rgba(255,240,200,' + (cr.a * 0.55) + ')';
      dot(cx - crr * 0.18, cy - crr * 0.22, crr * 0.62);
    }
    ctx.restore();

    // crisp limb + soft outer rim
    ctx.strokeStyle = 'rgba(255,247,222,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mx, my, mr - 0.5, 0, TAU); ctx.stroke();
    var rim = ctx.createRadialGradient(mx, my, mr * 0.94, mx, my, mr * 1.18);
    rim.addColorStop(0, 'rgba(255,236,190,0.16)');
    rim.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = rim;
    dot(mx, my, mr * 1.18);
  }

  function drawShooters() {
    ctx.globalCompositeOperation = 'lighter';
    for (var k = 0; k < shooters.length; k++) {
      var sh = shooters[k];
      var t = 1 - sh.age / sh.life;
      var tail = 7;
      var tx = sh.x - sh.vx * tail, ty = sh.y - sh.vy * tail;
      var g = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
      g.addColorStop(0, col(sh.hue, 0.35, 0.85, 0.85 * t));
      g.addColorStop(1, col(sh.hue, 0.4, 0.7, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = col(sh.hue, 0.25, 0.95, 0.9 * t);
      dot(sh.x, sh.y, 1.8);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRockets() {
    for (var k = 0; k < rockets.length; k++) {
      var r = rockets[k];
      for (var j = 0; j < r.hist.length; j++) {
        var t = (j + 1) / (r.hist.length + 1);
        ctx.fillStyle = col(r.hue, 0.45, 0.34 + 0.34 * t, 0.16 + 0.38 * t);
        dot(r.hist[j][0], r.hist[j][1], 0.7 + 1.4 * t);
      }
      ctx.fillStyle = col(0.10, 0.65, 0.72, 0.22);
      dot(r.x, r.y, 8);
      ctx.fillStyle = col(r.hue, 0.5, 0.92, 0.92);
      dot(r.x, r.y, 2.0);
    }
  }

  // Soft radial sprites, cached per hue bucket (72 buckets ≈ 5° apart).
  // Drawing a pre-rendered glow is far smoother — and cheaper — than stacking
  // filled circles, which read as flat "bubbles" on the light theme.
  var _spriteCache = {};
  function spriteFor(q) {
    var silver = q.sat < 0.35;
    var key = silver ? 'w' : String(Math.round((((q.hue % 1) + 1) % 1) * 72) % 72);
    var c = _spriteCache[key];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    var hue = silver ? 0 : Number(key) * 5;
    var sat = silver ? 0 : 100;
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'hsla(' + hue + ',' + sat + '%,50%,1)');
    grd.addColorStop(0.24, 'hsla(' + hue + ',' + sat + '%,46%,0.94)');
    grd.addColorStop(0.55, 'hsla(' + hue + ',' + sat + '%,44%,0.36)');
    grd.addColorStop(1, 'hsla(' + hue + ',' + sat + '%,48%,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    _spriteCache[key] = c;
    return c;
  }

  function drawParts(now) {
    ctx.lineCap = 'round';
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i];
      var fade = 1 - q.age / q.life;
      if (fade <= 0) continue;
      var flick = q.spark ? (0.35 + 0.65 * Math.abs(Math.sin(now * 40 + q.x * 0.09 + q.y * 0.06))) : 1;
      var alpha = Math.min(1, fade * 1.35) * flick;
      var size = q.size * 1.35 * (0.85 + 0.3 * fade);

      // comet tail: oldest sample -> head, thin at the tail, bright at the head
      if (q.hist.length > 1) {
        for (var j = 1; j < q.hist.length; j++) {
          var t = j / q.hist.length;             // 0 old -> 1 new
          ctx.strokeStyle = col(q.hue, q.sat * 0.95, q.light * 0.70, alpha * 0.20 * t * t);
          ctx.lineWidth = Math.max(0.5, size * (0.12 + 0.85 * t));
          ctx.beginPath();
          ctx.moveTo(q.hist[j - 1][0], q.hist[j - 1][1]);
          ctx.lineTo(q.hist[j][0], q.hist[j][1]);
          ctx.stroke();
        }
        ctx.strokeStyle = col(q.hue, q.sat * 0.95, q.light * 0.70, alpha * 0.42);
        ctx.lineWidth = Math.max(0.5, size * 0.85);
        ctx.beginPath();
        ctx.moveTo(q.hist[q.hist.length - 1][0], q.hist[q.hist.length - 1][1]);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      var spr = spriteFor(q);
      // wide, faint bloom
      ctx.globalAlpha = Math.min(1, alpha * 0.34);
      ctx.drawImage(spr, q.x - size * 4.5, q.y - size * 4.5, size * 9.0, size * 9.0);
      // saturated body
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(spr, q.x - size * 2.1, q.y - size * 2.1, size * 4.2, size * 4.2);
      // tiny white-hot ignition point (small enough not to hollow the spark)
      if (q.size > 1.05 && !q.spark) {
        ctx.globalAlpha = Math.min(1, alpha * 0.60);
        ctx.fillStyle = col(q.hue, q.sat * 0.3, 0.95, 1);
        dot(q.x, q.y, Math.max(0.4, size * 0.30));
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawFlashes() {
    for (var k = 0; k < flashes.length; k++) {
      var f = flashes[k];
      var t = 1 - f.age / 7;
      if (t <= 0) continue;
      // soft ignition bloom only — a stroked expanding ring read as a soap
      // bubble on the light theme, so the shockwave is a filled flare instead
      var rr = f.r * (0.85 + f.age * 0.10);
      var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr);
      g.addColorStop(0, col(f.hue, 0.85, 0.80, 0.55 * t));
      g.addColorStop(0.4, col(f.hue, 1.0, 0.62, 0.22 * t));
      g.addColorStop(1, col(f.hue, 1.0, 0.55, 0));
      ctx.fillStyle = g;
      dot(f.x, f.y, rr);
    }
  }

  function drawBadge() {
    // status pill: consumed-event counter (bottom-right, clear of the hint).
    // Always drawn so a quick look tells renderer(loaded?) / events(flowing?).
    var bw = 86, bx = W - bw - 12, by = H - 28;
    ctx.fillStyle = 'rgba(8,10,16,0.72)';
    ctx.beginPath();
    roundRect(ctx, bx, by, bw, 18, 9);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffd76a';
    ctx.font = '11px monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('FX ' + eventsSeen + (online ? '' : ' offline') + (show ? '' : ' - bg'), bx + 8, by + 9);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var nowMs = performance.now();
    var now = nowMs / 1000;

    drawStars(now);
    drawMoon();
    drawShooters();

    ctx.globalCompositeOperation = 'lighter';
    drawRockets();
    drawParts(now);
    drawFlashes();
    ctx.globalCompositeOperation = 'source-over';

    hint.classList.toggle('show', !online);
    drawBadge();
  }

  function roundRect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function dot(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // ---------- main loop ----------
  var last = performance.now();
  var acc = 0;
  function frame(nowMs) {
    // reschedule FIRST: a throw inside the body must never kill the show
    // (a dead loop + a canvas cleared by resize = permanent blank sky)
    requestAnimationFrame(frame);
    try {
      acc += nowMs - last; last = nowMs;
      if (acc > 250) acc = 250;            // tab was hidden; don't spiral
      while (acc >= STEP) { stepPhysics(nowMs); acc -= STEP; }
      draw();
    } catch (e) {
      var hEl = document.getElementById('hint');
      var msg = 'ERR: ' + (e && e.message || e);
      if (hEl && hEl.textContent !== msg) {
        hEl.textContent = msg;
        hEl.classList.add('show');
      }
    }
  }
  requestAnimationFrame(frame);
})();
