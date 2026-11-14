// v2.6 hit feel (docs/research/HIT-FEEL.md, no crits yet): one canvas over the battle for slashes / streaks / rings / sparks,
// a damped screen shake on the battle, knock-back + flash on the struck card, and the KO shatter. window.HitFX.
// All coordinates are stage px (the fixed 1920×1080 frame; app.js stagePt()). Respects prefers-reduced-motion.
(function () {
  'use strict';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cv = null, ctx = null, fxs = [], parts = [], raf = 0, last = 0;
  var shake = { amp: 0, t0: 0, dur: 1, f: 24, p1: 0, p2: 0, dir: 1, el: null };
  // tiers (stage px / ms): hit-stop, shake, knock-back, squash, card flash, sparks, slash radius / width
  var T = {
    normal: { stop: 55, shake: 5, sdur: 240, knock: 16, squash: 0.03, flash: 90, sparks: 8, R: 120, W: 16 },
    heavy: { stop: 95, shake: 11, sdur: 380, knock: 32, squash: 0.06, flash: 130, sparks: 16, R: 150, W: 24 },
    ko: { stop: 170, shake: 14, sdur: 520, knock: 40, squash: 0.08, flash: 200, sparks: 24, R: 165, W: 28 },
    crit: { stop: 190, shake: 17, sdur: 560, knock: 48, squash: 0.09, flash: 220, sparks: 28, R: 200, W: 36 } // DESIGN-skill-level: 暴击 (hit-feel-demo)
  };
  function ensure() {
    if (cv && cv.isConnected) return true;
    var stage = document.getElementById('stage'), fx = document.getElementById('fx'); if (!stage) return false;
    cv = document.createElement('canvas'); cv.id = 'hitfx'; cv.className = 'hitfx'; cv.width = 1920; cv.height = 1080; cv.setAttribute('aria-hidden', 'true');
    stage.insertBefore(cv, fx || null); ctx = cv.getContext('2d'); return true;
  }
  function act3() { return document.body.classList.contains('act-3'); }
  function pal() { return act3() ? { core: '#fff0e0', glow: '#c0602a', spark: ['#e08050', '#c04030', '#f0c0a0'] } : { core: '#ffffff', glow: '#ffb040', spark: ['#ffd070', '#fff0b0', '#ff9a40'] }; }
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } }
  function loop(now) {
    var dt = Math.min(50, now - last); last = now;
    // shake: a push along the hit direction for the first ~8%, then a damped wobble
    var el = shake.el, ox = 0, oy = 0;
    if (shake.amp > 0) {
      var k = (now - shake.t0) / shake.dur;
      if (k >= 1) shake.amp = 0;
      else {
        var d = Math.pow(1 - k, 2), w = now / 1000 * 2 * Math.PI * shake.f, kk = k < 0.08 ? shake.dir * (1 - k / 0.08) : 0;
        ox = shake.amp * (d * (Math.sin(w + shake.p1) * 0.75 + Math.sin(w * 1.7 + shake.p2) * 0.35) + kk * 0.8);
        oy = shake.amp * d * 0.45 * Math.sin(w * 1.3 + shake.p2);
      }
    }
    if (el) el.style.transform = ox || oy ? 'translate(' + ox.toFixed(1) + 'px,' + oy.toFixed(1) + 'px)' : '';
    if (ctx) {
      ctx.clearRect(0, 0, 1920, 1080); ctx.globalCompositeOperation = 'lighter';
      for (var i = fxs.length - 1; i >= 0; i--) { var f = fxs[i]; f.t += dt; var p = Math.min(1, f.t / f.dur); f.draw(p); if (p >= 1) fxs.splice(i, 1); }
      for (var n = parts.length - 1; n >= 0; n--) {
        var q = parts[n]; q.age += dt; if (q.age >= q.life) { parts.splice(n, 1); continue; }
        var s = dt / 1000; q.vx *= Math.pow(q.drag, s * 60); q.vy = q.vy * Math.pow(q.drag, s * 60) + q.g * s; q.x += q.vx * s; q.y += q.vy * s;
        var a = 1 - q.age / q.life; ctx.strokeStyle = q.col; ctx.fillStyle = q.col; ctx.globalAlpha = a;
        if (q.kind === 'star') star(q.x, q.y, q.size * (0.5 + a * 0.5));
        else if (q.kind === 'shard') { ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.age / 80); ctx.fillRect(-q.size, -q.size / 3, q.size * 2, q.size * 0.66); ctx.restore(); }
        else { ctx.lineWidth = q.size; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke(); }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    if (shake.amp > 0 || fxs.length || parts.length) raf = requestAnimationFrame(loop);
    else { raf = 0; if (el) el.style.transform = ''; }
  }
  function star(x, y, r) { ctx.beginPath(); for (var i = 0; i < 8; i++) { var rr = i % 2 ? r * 0.3 : r, an = i * Math.PI / 4; ctx.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } ctx.closePath(); ctx.fill(); }
  function addFx(dur, draw) { if (!ensure()) return; fxs.push({ t: 0, dur: dur, draw: draw }); kick(); }
  function slash(at, o) { // a crescent: draws in over the first 30%, then fades; the width tapers at both ends
    var P = pal(), R = o.R || 140, W = o.W || 18, a0 = o.a0 != null ? o.a0 : -2.3, a1 = o.a1 != null ? o.a1 : 0.5, col = o.col || P.glow;
    addFx(o.dur || 300, function (p) {
      var head = Math.min(1, p / 0.3), fade = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7, tail = Math.max(0, head - 0.85), N = 24;
      for (var pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? P.core : col; ctx.globalAlpha = fade * (pass ? 1 : 0.55); ctx.lineCap = 'round';
        for (var i = 0; i < N; i++) {
          var u0 = tail + (head - tail) * i / N, u1 = tail + (head - tail) * (i + 1) / N, mid = (i + 0.5) / N;
          var w = W * Math.sin(Math.PI * mid) * (pass ? 0.45 : 1.6) * (0.4 + 0.6 * fade), g0 = a0 + (a1 - a0) * u0, g1 = a0 + (a1 - a0) * u1;
          ctx.lineWidth = Math.max(0.5, w); ctx.beginPath();
          ctx.moveTo(at.x + Math.cos(g0) * R, at.y + Math.sin(g0) * R * 0.75); ctx.lineTo(at.x + Math.cos(g1) * R, at.y + Math.sin(g1) * R * 0.75); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    });
  }
  function ring(at, o) {
    var P = pal(), col = o.col || P.glow;
    addFx(o.dur || 360, function (p) {
      var e = 1 - Math.pow(1 - p, 3), r = (o.r0 || 20) + ((o.r1 || 200) - (o.r0 || 20)) * e;
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = col; ctx.lineWidth = (o.w || 14) * (1 - p) + 1; ctx.beginPath(); ctx.ellipse(at.x, at.y, Math.max(0, r), Math.max(0, r * (o.flat || 0.8)), 0, 0, 7); /* feedback-1112: a negative radius threw */ ctx.stroke(); ctx.globalAlpha = 1;
    });
  }
  function streak(from, to, dur) { // an arrow: a bright head with a trail
    var P = pal();
    addFx(dur, function (p) {
      var hp = Math.min(1, p / 0.55), hx = from.x + (to.x - from.x) * hp, hy = from.y + (to.y - from.y) * hp - Math.sin(hp * Math.PI) * 30;
      var tl = Math.min(hp, 0.35), tx = from.x + (to.x - from.x) * (hp - tl), ty = from.y + (to.y - from.y) * (hp - tl);
      var g = ctx.createLinearGradient(tx, ty, hx, hy); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, P.core);
      ctx.globalAlpha = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45; ctx.strokeStyle = g; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke(); ctx.fillStyle = P.glow; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    });
  }
  function rays(at, n) { // crit: radial speed lines that shoot out and fade
    var P = pal();
    addFx(420, function (p) {
      var e = 1 - Math.pow(1 - p, 2); ctx.globalAlpha = 1 - p; ctx.strokeStyle = P.core; ctx.lineCap = 'round';
      for (var i = 0; i < n; i++) {
        var an = i / n * Math.PI * 2 + (i % 2) * 0.12, r0 = 60 + 120 * e, r1 = r0 + 140 * (1 - p) + 40;
        ctx.lineWidth = i % 2 ? 4 : 8; ctx.beginPath(); ctx.moveTo(at.x + Math.cos(an) * r0, at.y + Math.sin(an) * r0 * 0.8); ctx.lineTo(at.x + Math.cos(an) * r1, at.y + Math.sin(an) * r1 * 0.8); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }
  function shield(at) {
    addFx(520, function (p) {
      var a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      ctx.globalAlpha = a * 0.8; ctx.strokeStyle = '#bfe0ff'; ctx.lineWidth = 9; ctx.beginPath();
      for (var i = 0; i <= 6; i++) { var an = -Math.PI / 2 + i * Math.PI / 6, r = 150 + p * 10; ctx.lineTo(at.x + Math.cos(an) * r * 0.55, at.y + Math.sin(an) * r); } ctx.stroke();
      ctx.globalAlpha = a * 0.16; ctx.fillStyle = '#9ac8ff'; ctx.fill(); ctx.globalAlpha = 1;
    });
  }
  function sparks(at, n, o) {
    if (!ensure()) return; var P = pal(); o = o || {};
    for (var i = 0; i < n; i++) {
      var an = (o.dir || 0) + (Math.random() - 0.5) * (o.spread || 2.4), sp = (o.speed || 900) * (0.4 + Math.random() * 0.8);
      parts.push({ x: at.x, y: at.y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - (o.up || 0), g: o.g != null ? o.g : 1400, drag: o.drag || 0.9,
        life: (o.life || 380) * (0.6 + Math.random() * 0.6), age: 0, size: (o.size || 4) * (0.6 + Math.random() * 0.8), col: o.col || P.spark[i % 3], kind: o.kind || 'spark' });
    }
    kick();
  }
  function doShake(el, px, ms, dir) {
    if (REDUCED || !el || px <= 0) return;
    var now = performance.now(), left = shake.amp * Math.pow(Math.max(0, 1 - (now - shake.t0) / shake.dur), 2);
    if (px < left && shake.el === el) return; // never weaker than what is already shaking
    if (shake.el && shake.el !== el) shake.el.style.transform = '';
    shake = { amp: Math.min(px, 22), t0: now, dur: ms, f: 22 + Math.random() * 8, p1: Math.random() * 6, p2: Math.random() * 6, dir: dir || 1, el: el };
    kick();
  }
  function flashCard(card, ms) {
    var art = card && (card.querySelector('.uc-art') || card); if (!art || !art.animate) return;
    art.animate([{ filter: 'brightness(2.6) saturate(.4)' }, { filter: 'brightness(2.6) saturate(.4)', offset: 0.3 }, { filter: 'none' }], { duration: ms * (REDUCED ? 1.5 : 1), easing: 'ease-out' });
  }
  function knock(card, px, squash, dir) {
    if (!card || !card.animate || REDUCED) return;
    var s = squash || 0;
    card.animate([{ transform: 'none' },
      { transform: 'translateX(' + (dir * px) + 'px) rotate(' + (dir * px / 10) + 'deg) scale(' + (1 - s) + ',' + (1 + s * 0.6) + ')', offset: 0.18 },
      { transform: 'translateX(' + (-dir * px * 0.12) + 'px) scale(' + (1 + s * 0.3) + ',' + (1 - s * 0.2) + ')', offset: 0.6 },
      { transform: 'none' }], { duration: 340 + px * 3, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }
  function center(card, fy) {
    var r = card.getBoundingClientRect(), s = card.ownerDocument.getElementById('stage').getBoundingClientRect(), k = s.width / 1920 || 1;
    return { x: (r.left - s.left + r.width / 2) / k, y: (r.top - s.top + r.height * (fy == null ? 0.4 : fy)) / k };
  }
  // which tier a landed hit is: ko (she drops) > heavy (≥ 6 or ≥ 40% of her max hp) > normal
  function tier(amount, maxHp, hpAfter) {
    if (hpAfter != null && hpAfter <= 0) return 'ko';
    return amount >= Math.max(6, 0.4 * (maxHp || 0)) ? 'heavy' : 'normal';
  }
  // the contact frame: the skill's mark + the card flashes white; returns the hit-stop to hold (ms at 1×)
  function contact(card, o) {
    if (!card) return 0;
    var t = T[o.tier] || T.normal, dir = o.dir || 1, at = center(card, 0.38), sc = o.scale || 1, kind = o.kind || 'strike';
    if (kind === 'heal') { sparks(at, 10, { kind: 'star', spread: 6.3, speed: 260, up: 160, g: -200, life: 700, size: 9, col: '#c8ffc0' }); return 0; }
    if (kind === 'aim' && o.from) streak(o.from, at, 260);
    if (kind === 'spark') { ring(at, { r1: 190 * sc, w: 18 }); ring(at, { r0: 40, r1: 130 * sc, w: 8, col: '#fff', dur: 260 }); sparks(at, Math.round(t.sparks * sc), { spread: 6.3, speed: 600, g: 300, kind: 'star', size: 8 }); }
    else if (kind === 'backstab') { slash(at, { R: t.R * 0.9, W: t.W, a0: -2.5, a1: 0.4 }); slash({ x: at.x, y: at.y - 10 }, { R: t.R * 0.9, W: t.W, a0: 2.5, a1: -0.4, dur: 340 }); }
    else if (kind === 'aim') ring(at, { r1: 90, w: 7, flat: 1 });
    else slash(at, { R: t.R * sc, W: t.W * sc, a0: dir > 0 ? -2.4 : -0.7, a1: dir > 0 ? 0.6 : -3.7 });
    if (kind === 'guard') shield(center(card, 0.45));
    if (kind !== 'spark') sparks(at, Math.round(t.sparks * sc), { dir: dir > 0 ? 0 : Math.PI, spread: 1.8, speed: 700 + t.knock * 12 });
    if (o.tier === 'ko') ring(at, { r1: 230, w: 16 });
    if (o.tier === 'crit') { rays(at, 18); ring(at, { r1: 260, w: 18, col: '#ffdd55' }); sparks(at, 10, { kind: 'star', spread: 6.3, speed: 420, g: 200, life: 600, size: 10, col: '#fff4c0' }); }
    flashCard(card, t.flash);
    return REDUCED ? 0 : Math.round(t.stop * sc);
  }
  // after the hit-stop: the card is knocked back and the battle shakes
  function after(card, o, shakeEl) {
    if (!card) return; var t = T[o.tier] || T.normal, sc = o.scale || 1, dir = o.dir || 1;
    if (o.kind === 'heal') return;
    knock(card, t.knock * sc, t.squash, dir);
    if (shakeEl) doShake(shakeEl, t.shake * sc, t.sdur, dir);
  }
  // a foe drops: shards, a white ring and the 「击倒」 stamp (allies fall quietly: app.js keeps its own small fall)
  function ko(card, stampHost) {
    if (!card) return; var at = center(card, 0.4);
    sparks(at, 22, { kind: 'shard', spread: 6.3, speed: 560, up: 300, g: 1800, life: 700, size: 8, col: '#f4e8e0' });
    ring(at, { r1: 260, w: 20, col: '#ffffff' });
    if (stampHost) {
      var s = document.createElement('div'); s.className = 'ko-stamp'; s.textContent = window.CHOOSER_ASSETS.t('ui.battle.koStamp'); s.style.left = at.x + 'px'; s.style.top = (at.y + 30) + 'px'; stampHost.appendChild(s); var CA = window.CHOOSER_ASSETS; if (CA && CA.stampX) s.style.left = CA.stampX(at.x, s.offsetWidth, 1920) + 'px'; // batch6 fix: the rightmost foe's stamp slides left, never squeezed
      setTimeout(function () { s.remove(); }, 1500);
    }
  }
  window.HitFX = { tier: tier, contact: contact, after: after, ko: ko, shake: doShake, sparks: sparks, T: T };
})();
