/* dsh-fireworks renderer — full-screen canvas show driven by feeder events.
 *
 * Data: polls /dsh-fireworks/state.json (served by the host plugin from
 * ~/.dsh/fireworks/state.json). Events carry monotonic ids and are consumed
 * exactly once. Physics steps are fixed at 30 Hz (constants ported from the
 * tkinter show); rendering runs on requestAnimationFrame.
 *
 * The canvas is fully cleared and redrawn every frame (same lesson as the
 * tkinter original: no item churn, no z-order burial). Background stays
 * transparent so the DSH app content above the iframe shows through.
 */
(function () {
  'use strict';

  // ---------- setup ----------
  var cv = document.getElementById('sky');
  var hint = document.getElementById('hint');
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 1;

  function params() {
    try { return new URLSearchParams(location.search); }
    catch (e) { return new URLSearchParams(); }
  }
  var density = 100;                     // percent, 50..150
  var d = params().get('density');
  if (d) { var v = Number(d); if (Number.isFinite(v)) density = Math.min(150, Math.max(50, v)); }

  window.addEventListener('message', function (ev) {
    var m = ev.data;
    if (m && m.type === 'fw-set' && Number.isFinite(Number(m.density))) {
      density = Math.min(150, Math.max(50, Number(m.density)));
    }
  });

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(2.4, Math.max(1, H / 340));   // scale physics with height
  }
  var S = 1;
  window.addEventListener('resize', resize);
  resize();

  // deterministic RNG like the tkinter show
  var seed = 20261102;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function rnd(a, b) { return a + (b - a) * rnd(); }

  var PALETTE = [0.12, 0.12, 0.12, 0.12, 0.955, 0.955, 0.52, 0.52, 0.76, 0.15];

  function col(hue, sat, light) {
    return 'hsl(' + (((hue % 1) + 1) % 1 * 360).toFixed(1) + ',' +
      Math.round(sat * 100) + '%,' + Math.round(Math.min(1, Math.max(0, light)) * 100) + '%)';
  }

  // star field: fractions of the screen
  var STARS = [];
  for (var i = 0; i < 46; i++) {
    STARS.push({ x: rnd(0.01, 0.99), y: rnd(0.02, 0.60),
                 b: rnd(0.10, 0.38), sp: rnd(0.6, 1.8), ph: rnd(0, 6.3) });
  }

  // ---------- show state ----------
  var parts = [];      // sparks
  var rockets = [];
  var flashes = [];    // one-frame-ish burst rings
  var MAX_PARTS = 400;

  function spawn(x, y, vx, vy, hue, life) {
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push({ x: x, y: y, vx: vx, vy: vy, hue: hue, age: 0, life: life, hist: [] });
  }

  function explode(x, y, strength, hue) {
    var heart = strength > 0.82;
    var n = Math.round((40 + 66 * strength) * density / 100);
    var speed = (2.0 + 2.7 * strength) * S;
    for (var k = 0; k < n; k++) {
      var life = 42 + Math.round(26 * strength) + Math.round(rnd(0, 10));
      if (heart) {
        var t = rnd(0, 2 * Math.PI);
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        var s2 = speed * 0.62;
        spawn(x, y, hx / 16 * s2 + rnd(-0.3, 0.3), -hy / 16 * s2 + rnd(-0.3, 0.3),
              0.955 + rnd(-0.02, 0.02), life);
      } else {
        var ang = rnd(0, 2 * Math.PI);
        var sp = speed * (rnd() < 0.7 ? 1.0 : 0.55);
        spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp,
              hue + rnd(-0.015, 0.015), life);
      }
    }
    flashes.push({ x: x, y: y, r: (14 + 22 * strength) * S, hue: hue, age: 0 });
  }

  function launch(strength) {
    var hue = PALETTE[Math.floor(rnd() * PALETTE.length)];
    rockets.push({
      x: rnd(W * 0.12, W * 0.88), y: H + 4,
      vx: rnd(-0.5, 0.5),
      vy: -(3.4 + 3.8 * strength) * S,
      ty: H * (0.16 + 0.30 * (1.0 - strength)),
      hue: hue, s: strength, hist: []
    });
  }

  function crackle(strength) {
    var cx = rnd(W * 0.15, W * 0.85), cy = rnd(H * 0.08, H * 0.42);
    var n = Math.round((8 + 14 * strength) * density / 100) + 4;
    for (var k = 0; k < n; k++) {
      var ang = rnd(0, 2 * Math.PI), sp = rnd(0.5, 1.4) * S;
      spawn(cx, cy, Math.cos(ang) * sp, Math.sin(ang) * sp, 0.15,
            Math.round(rnd(10, 16)));
    }
  }

  // ---------- feeder polling ----------
  var lastEventId = 0;
  var lastBoot = 0;        // feeder process start epoch (meta.boot)
  var lastTs = 0;          // feeder clock
  var online = false;      // feeder fresh?
  var lastLaunch = 0;      // performance.now() ms, for quiet-sky fallback
  var pollBusy = false;

  function poll() {
    if (pollBusy) return;
    pollBusy = true;
    fetch('state.json', { cache: 'no-store' })
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
            if (online) {
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
    // quiet-sky fallback: keep the show alive when music pauses
    if (online && nowMs - lastLaunch > 4500 && rockets.length < 6 * density / 100) {
      launch(0.30);
      lastLaunch = nowMs;
    }
    if (!online) lastLaunch = nowMs;

    var i, r, q;
    for (i = rockets.length - 1; i >= 0; i--) {
      r = rockets[i];
      r.hist.push([r.x, r.y]); if (r.hist.length > 3) r.hist.shift();
      r.x += r.vx; r.y += r.vy; r.vy += 0.020 * S;
      if (r.y <= r.ty || r.vy > -0.8 * S) {
        rockets.splice(i, 1);
        explode(r.x, r.y, r.s, r.hue);
        lastLaunch = nowMs;
      }
    }
    for (i = parts.length - 1; i >= 0; i--) {
      q = parts[i];
      q.hist.push([q.x, q.y]); if (q.hist.length > 3) q.hist.shift();
      q.vy += 0.055 * S;
      q.vx *= 0.986; q.vy *= 0.986;
      q.x += q.vx; q.y += q.vy;
      q.age += 1;
      if (q.age >= q.life || q.y > H + 20) parts.splice(i, 1);
    }
    for (i = flashes.length - 1; i >= 0; i--) {
      flashes[i].age += 1;
      if (flashes[i].age > 6) flashes.splice(i, 1);
    }
  }

  // ---------- render ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var now = performance.now() / 1000;
    var k, x, y, j, h;

    // stars
    var tw = now * 2.2;
    for (k = 0; k < STARS.length; k++) {
      var st = STARS[k];
      var b = st.b * (0.72 + 0.28 * Math.sin(tw * st.sp + st.ph));
      ctx.fillStyle = col(0.60, 0.25, 0.16 + b * 0.5);
      dot(st.x * W, st.y * H, 0.9);
    }

    // crescent moon
    var mx = W * 0.06, my = H * 0.16, mr = Math.min(26, 16 * S);
    ctx.fillStyle = col(0.13, 0.18, 0.86);
    circle(mx, my, mr);
    ctx.clearRect(mx - mr * 2.2, my - mr * 2.2, mr * 2.2, mr * 2.2); // bite
    // re-draw stars near the bite lost to clearRect (cheap: skip — moon sits high-left, stars sparse)

    // rocket trails
    for (k = 0; k < rockets.length; k++) {
      r = rockets[k];
      for (j = 0; j < r.hist.length; j++) {
        ctx.fillStyle = col(r.hue, 0.3, 0.5 - 0.12 * j);
        dot(r.hist[j][0], r.hist[j][1], Math.max(0.6, 1.2 - 0.3 * j));
      }
      ctx.fillStyle = col(r.hue, 0.3, 0.9);
      dot(r.x, r.y, 1.8);
    }

    // sparks: ghost trail + head
    for (k = 0; k < parts.length; k++) {
      q = parts[k];
      var fade = 1.0 - q.age / q.life;
      var flick = 0.72 + 0.28 * rnd();
      var light = (0.80 * fade + 0.22) * flick;
      var sat2 = 0.25 + 0.65 * (1.0 - fade);
      for (j = 1; j < q.hist.length; j++) {
        ctx.fillStyle = col(q.hue, sat2, light * (0.55 - 0.18 * j));
        dot(q.hist[j][0], q.hist[j][1], Math.max(0.6, 1.6 - 0.4 * j));
      }
      ctx.fillStyle = col(q.hue, sat2, light);
      dot(q.x, q.y, 1.6);
    }

    // burst rings
    for (k = 0; k < flashes.length; k++) {
      var f = flashes[k];
      ctx.strokeStyle = col(f.hue, 0.35, 0.85 * (1 - f.age / 6));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1 + f.age * 0.12), 0, Math.PI * 2);
      ctx.stroke();
    }

    hint.classList.toggle('show', !online);
  }

  function dot(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- main loop ----------
  var last = performance.now();
  var acc = 0;
  function frame(nowMs) {
    acc += nowMs - last; last = nowMs;
    if (acc > 250) acc = 250;              // tab was hidden; don't spiral
    while (acc >= STEP) { stepPhysics(nowMs); acc -= STEP; }
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
