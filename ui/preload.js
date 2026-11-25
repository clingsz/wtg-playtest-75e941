// 2026-11-19 预加载: warm the art before the game asks for it (first visit on GitHub Pages / iPhone Safari: scenes, stands,
// enemy cells and the route map used to pop in late; the route paths painted over black before the map arrived).
// Every URL comes from ui/assets.js (CHOOSER_ASSETS: scene / portrait / face / enemy / icon / routeArt / fairyAnim), so the web
// copies (art/web, CHOOSER_WEBART) and ?v=ART_V are applied exactly as the game applies them. No second list to drift.
// A "slot" = one candidate list (the game shows the first one that loads); the loader tries the candidates in order too.
// Tiers: 1 = title + UI + (new game) the opening scenes and stands, during the logo / title;
//        2 = the current level and the next one (battlefield, campfire, story scenes, enemies, the route map);
//        3 = everything else, in the background, 4 at a time, started from requestIdleCallback when there is one.
// Off switch: ?nopreload=1. Never throws, never blocks: no Image → nothing happens and ready() resolves at once.
// Memory (iPhone Safari): only tiers 1–2 are decode()d; tier 3 only fills the HTTP cache (its Image is still kept).
(function (root) {
  'use strict';
  var NOOP_P = { then: function (f) { try { f(true); } catch (e) { /* */ } return NOOP_P; } }; // used only if Promise is missing

  // ---- pure: the slots of each tier (node-tested: tests/preload.test.cjs) ----
  function strip(c) { var i = String(c).indexOf('#'); return i < 0 ? String(c) : String(c).slice(0, i); } // '#classes' are for the <img>, not the URL
  function slotOf(list) { var out = []; [].concat(list || []).forEach(function (c) { if (c && typeof c === 'string') { var u = strip(c); if (out.indexOf(u) < 0) out.push(u); } }); return out; }
  function levelCfg(data, n) { var L = (data && data.scenario && data.scenario.levels) || []; for (var i = 0; i < L.length; i++) if (L[i].level === n) return L[i]; return null; }
  function levelIds(data) { return ((data && data.scenario && data.scenario.levels) || []).map(function (l) { return l.level; }).filter(function (n) { return n > 0; }); }
  // one level: its battlefield, the campfire before it, its story scenes, its after-battle scene, its enemies, the route map
  function levelSlots(A, data, n, act) {
    var out = [], cfg = levelCfg(data, n); if (!cfg) return out;
    out.push(A.scene(A.sceneFor({ phase: 'battle', level: n })));
    var acts = act ? [act] : [1, 2, 3]; // the campfire depends on the act; unknown → all three (small, and all get used)
    acts.forEach(function (a) { out.push(A.scene(A.sceneFor({ phase: 'prep', level: n, act: a }))); });
    [cfg.preStory, cfg.postStory].forEach(function (s) { if (s) out.push(A.scene(A.sceneFor({ phase: 'story', storyId: s, level: n }))); });
    var post = String(cfg.post || '');
    if (/sacrifice/i.test(post)) out.push(A.scene(A.sceneFor({ phase: 'sacrifice', level: n })));
    if (/debuff/i.test(post)) out.push(A.scene(A.sceneFor({ phase: 'debuff', level: n })));
    (cfg.waves || []).forEach(function (w) { (w || []).forEach(function (e) { if (e && e.enemy) out.push(A.enemy(e.enemy)); }); });
    if (A.routeArt) out.push(A.routeArt());
    return out;
  }
  // o: { A, data, level (0 / missing = no save: a new game), act }
  function tiers(o) {
    o = o || {}; var A = o.A, data = o.data, lv = o.level | 0, t1 = [], t2 = [], t3 = [];
    if (!A || !A.scene) return { t1: [], t2: [], t3: [] };
    // tier 1: the title and the UI the first screens use
    t1.push(A.scene(A.sceneFor(null)));
    var fa = A.fairyAnim && A.fairyAnim('fairy'); if (fa) fa.all.forEach(function (u) { t1.push([u]); });
    t1.push(A.portrait('fairy'));
    t1.push([A.leaderBadge()], [A.crest(false)]);
    for (var m = -2; m <= 2; m++) t1.push([A.moodIcon(m)]);
    ['tank', 'adc', 'healer', 'mage', 'rogue'].forEach(function (r) { var ic = A.roleIcon(r); if (ic) t1.push([ic]); });
    if (!lv) { // a new game: the opening's scenes and stands (setup → advisor → leader → interview)
      ['opening', 'fairyWelcome', 'advisorAsks', 'leaderPrompt', 'interviewIntro'].forEach(function (s) { t1.push(A.scene(A.sceneFor({ phase: 'story', storyId: s }))); });
      t1.push(A.portrait('leader'));
      (A.ADVISORS || []).forEach(function (id) { t1.push(A.portrait(id)); });
    }
    // tier 2: this level and the next (a new game: level 1 + the recruits of the interview)
    var cur = lv || 1;
    t2 = levelSlots(A, data, cur, o.act).concat(levelSlots(A, data, cur + 1, null));
    if (!lv) (A.CANDIDATES || []).forEach(function (id) { t2.push(A.portrait(id)); });
    // tier 3: the rest
    levelIds(data).forEach(function (n) { t3 = t3.concat(levelSlots(A, data, n, null)); });
    (A.SCENES || []).forEach(function (s) { t3.push(A.scene(s)); });
    Object.keys(A.STORY_SCENE || {}).forEach(function (k) { t3.push(A.scene(A.STORY_SCENE[k])); });
    t3.push(A.portrait('leader'), A.portrait('leader', { variant: 'worn' }));
    (A.ADVISORS || []).forEach(function (id) { t3.push(A.portrait(id), A.portrait(id, { variant: 'boss' })); });
    (A.CANDIDATES || []).forEach(function (id) { t3.push(A.portrait(id), A.portrait(id, { variant: 'vengeful' }), A.portrait(id, { variant: 'possessed' })); });
    (A.FAIRIES || []).concat(A.MERCHANTS || []).forEach(function (id) { t3.push(A.portrait(id)); });
    var fd = A.fairyAnim && A.fairyAnim('fairy-demon'); if (fd) fd.all.forEach(function (u) { t3.push([u]); });
    if (A.gateArt) t3.push(A.gateArt());
    ['leader'].concat(A.ADVISORS || [], A.CANDIDATES || [], A.FAIRIES || [], A.MERCHANTS || []).forEach(function (id) {
      (A.drawnFaces ? A.drawnFaces(id) : []).forEach(function (e) { t3.push(A.face(id, e)); });
    });
    // slots, deduplicated by their first URL; an earlier tier keeps it
    var seen = {}, pack = function (list) { var out = []; list.forEach(function (l) { var s = slotOf(l); if (s.length && !seen[s[0]]) { seen[s[0]] = 1; out.push(s); } }); return out; };
    return { t1: pack(t1), t2: pack(t2), t3: pack(t3) };
  }
  function off(search) { return /[?&]nopreload=1(&|$)/.test(String(search || '')); }

  // ---- the loader ----
  var P = { tiers: tiers, levelSlots: levelSlots, slotOf: slotOf, off: off };
  var CACHE = {};   // url → { img, state: 'loading' | 'ok' | 'bad' }  (the Image is kept so the browser keeps the bytes)
  var SLOTS = {};   // first url → { slot, pri, state: 'queued' | 'loading' | 'done', url (the one that loaded) , waiters }
  var queue = [], active = 0, started = false, enabled = false, t1 = { done: 0, total: 0 }, listeners = [], ctx = null;
  var LIMIT = { 0: 6, 1: 6, 2: 6, 3: 4 };
  function search() { try { return (root.location && root.location.search) || ''; } catch (e) { return ''; } }
  function hasImage() { return typeof root.Image === 'function'; }
  function later(fn) { // tier 3 starts on an idle moment
    try { if (typeof root.requestIdleCallback === 'function') { root.requestIdleCallback(fn, { timeout: 2000 }); return; } } catch (e) { /* */ }
    try { root.setTimeout(fn, 60); } catch (e) { fn(); }
  }
  function loadUrl(u, decode, cb) {
    var c = CACHE[u];
    if (c && c.state !== 'loading') { cb(c.state === 'ok'); return; }
    if (c) { c.cbs.push(cb); return; }
    var img; try { img = new root.Image(); } catch (e) { img = null; }
    if (!img) { cb(false); return; }
    c = CACHE[u] = { img: img, state: 'loading', cbs: [cb] };
    var fin = function (ok) { if (c.state !== 'loading') return; c.state = ok ? 'ok' : 'bad'; img.onload = img.onerror = null; var cbs = c.cbs; c.cbs = []; cbs.forEach(function (f) { try { f(ok); } catch (e) { /* */ } }); };
    try {
      img.onload = function () {
        // decode() keeps the first paint smooth; a decode refusal (Safari, very large pictures) still means it loaded
        if (decode && typeof img.decode === 'function') { try { img.decode().then(function () { fin(true); }, function () { fin(true); }); return; } catch (e) { /* */ } }
        fin(true);
      };
      img.onerror = function () { fin(false); };
      if ('decoding' in img) img.decoding = 'async';
      img.src = u;
    } catch (e) { fin(false); }
  }
  function settle(s) {
    s.state = 'done'; active = Math.max(0, active - 1);
    if (s.t1) { t1.done++; emit(); }
    var w = s.waiters; s.waiters = []; w.forEach(function (f) { try { f(); } catch (e) { /* */ } });
    pump();
  }
  function run(s) {
    s.state = 'loading'; active++;
    var i = 0;
    (function next() {
      if (i >= s.slot.length) { s.url = null; settle(s); return; }
      var u = s.slot[i++];
      loadUrl(u, s.pri <= 2, function (ok) { if (ok) { s.url = u; settle(s); } else next(); });
    })();
  }
  var pumping = false, idleWait = false;
  function pump() {
    if (!enabled || pumping) return; pumping = true;
    try {
      while (queue.length) {
        var s = queue[0]; if (active >= (LIMIT[s.pri] || 4)) break;
        if (s.pri >= 3) { if (!idleWait) { idleWait = true; later(function () { idleWait = false; while (queue.length && active < (LIMIT[queue[0].pri] || 4)) run(queue.shift()); pump(); }); } break; } // fill up to 4 per idle moment (Safari has no requestIdleCallback: a 60ms timer)
        queue.shift(); run(s);
      }
    } catch (e) { /* never break the game */ }
    pumping = false;
  }
  function sortQ() { queue.sort(function (a, b) { return a.pri - b.pri || a.seq - b.seq; }); }
  var seq = 0;
  function add(slot, pri, isT1) {
    if (!slot || !slot.length) return null;
    var k = slot[0], s = SLOTS[k];
    if (s) { if (s.state === 'queued' && pri < s.pri) { s.pri = pri; sortQ(); } return s; }
    s = SLOTS[k] = { slot: slot, pri: pri, state: 'queued', waiters: [], seq: ++seq, t1: !!isT1 };
    queue.push(s); return s;
  }
  function emit() { var p = P.progress(); listeners.forEach(function (f) { try { f(p); } catch (e) { /* */ } }); }

  // start({ A, data, level, act }): queue every tier. Safe to call more than once (the first call wins).
  P.start = function (o) {
    try {
      if (started) return P; started = true;
      enabled = !off(search()) && hasImage();
      if (!enabled) return P;
      o = o || {}; ctx = { A: o.A || root.CHOOSER_ASSETS, data: o.data || root.CHOOSER_DATA };
      var t = tiers({ A: ctx.A, data: ctx.data, level: o.level, act: o.act });
      t.t1.forEach(function (s) { if (add(s, 1, true)) t1.total++; });
      t.t2.forEach(function (s) { add(s, 2); });
      t.t3.forEach(function (s) { add(s, 3); });
      sortQ(); emit(); pump();
    } catch (e) { enabled = false; }
    return P;
  };
  // the run moved to level n (act a): its slots and the next level's go to the front of tier 2
  P.level = function (n, a) {
    try {
      if (!enabled || !ctx || !(n > 0)) return;
      if (P._lv === n + ':' + a) return; P._lv = n + ':' + a;
      levelSlots(ctx.A, ctx.data, n, a).concat(levelSlots(ctx.A, ctx.data, n + 1, null)).forEach(function (l) { add(slotOf(l), 2); });
      sortQ(); pump();
    } catch (e) { /* */ }
  };
  function slotsArg(list) { list = [].concat(list || []); return Array.isArray(list[0]) ? list.map(slotOf) : [slotOf(list)]; }
  // is this candidate list (or list of lists) settled — loaded, or every candidate failed?
  P.isReady = function (list) {
    if (!enabled) return true;
    return slotsArg(list).every(function (s) { var x = s.length ? SLOTS[s[0]] : null; return !s.length || (x && x.state === 'done'); });
  };
  // ready(list, ms = 1500) → Promise<boolean>: true once every slot is settled, false at the timeout. Never rejects. The
  // slots jump the queue. Disabled / no Image → resolves true at once.
  P.ready = function (list, ms) {
    if (typeof Promise !== 'function') return NOOP_P;
    return new Promise(function (resolve) {
      try {
        if (!enabled) { resolve(true); return; }
        var ss = slotsArg(list).filter(function (s) { return s.length; }).map(function (s) { return add(s, 0); }).filter(Boolean), left = 0, fin = false;
        var end = function (v) { if (!fin) { fin = true; resolve(v); } };
        ss.forEach(function (s) { if (s.state !== 'done') { left++; s.waiters.push(function () { if (--left <= 0) end(true); }); } });
        if (!left) { end(true); return; }
        sortQ(); pump();
        root.setTimeout(function () { end(false); }, ms == null ? 1500 : ms);
      } catch (e) { resolve(true); }
    });
  };
  // the URL a slot settled on (null: not loaded yet / every candidate failed)
  P.loaded = function (list) { var s = slotOf(list), x = s.length ? SLOTS[s[0]] : null; return x && x.state === 'done' ? x.url : null; };
  P.progress = function () { return { done: t1.done, total: t1.total, on: enabled, t1Done: !enabled || t1.done >= t1.total, queued: queue.length, active: active }; };
  P.onProgress = function (f) { if (typeof f === 'function') listeners.push(f); return P; };
  P.enabled = function () { return enabled; };
  root.CHOOSER_PRELOAD = P;
})(typeof globalThis !== 'undefined' ? globalThis : this);
