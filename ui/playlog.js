// 游玩记录 (play log) 2026-11-14 — a local-only record of what happened while a friend played (itch has no server and the
// page CSP is connect-src 'none', so nothing leaves the browser: the player exports a file and sends it back).
// Pure UI-side bookkeeping: never calls the engine's act(), never uses Math.random, never throws into the game.
// Read an exported file with: node tools/read-playlog.mjs <file>.
// Browser: loaded before engine.js so it can already catch load-time errors (window.ChooserPlaylog.early).
// Node: require('ui/playlog.js') → { create, observe, snap, outcomeOf, KEY, MAX_BYTES }.
(function (root) {
  'use strict';
  var KEY = 'chooser.playlog.v1', MAX_BYTES = 1500000, LOOSE_MAX = 300, ERR_MAX = 200, EV_MAX = 20000;

  function now0() { return Date.now(); }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : undefined; }
  function clip(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function clean(o) { var r = {}; for (var k in o) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; }

  // where the player is: phase / level / round / wave / step (from E.view)
  function snap(v) {
    if (!v) return { ph: 'title' };
    var b = v.battle;
    return clean({ ph: v.phase, lv: num(v.level), act: num(v.act), rd: b ? num(b.round) : undefined, wv: b && b.waveCount > 1 ? num(b.wave) : undefined,
      st: v.leaderStep || v.interviewStep || (v.camp && v.camp.step) || v.storyId || undefined });
  }
  // the action's parameters, without the UI's decision-timing meta
  function actionOf(a) {
    var r = {}; if (!a) return r;
    for (var k in a) if (k !== 'meta' && a[k] !== undefined) r[k] = a[k];
    return r;
  }
  function hpList(us) { return (us || []).map(function (u) { return clean({ id: u.id || u.uid, n: u.name, hp: num(u.hp), max: num(u.maxHp) }); }); }
  // ending kinds: true / normal (a clear) / defeat (game over); 'abandon' is set by the UI when a run is replaced
  function outcomeOf(v) {
    if (!v) return null;
    if (v.phase === 'gameOver') return 'defeat';
    if (v.phase !== 'ending') return null;
    var o = v.summary && v.summary.outcome;
    return o === 'true' ? 'true' : o === 'defeat' ? 'defeat' : 'normal';
  }

  // key moments readable straight from (view before, action, view after). Returns a list of small entries.
  function observe(pv, action, nv) {
    var out = [], ps = snap(pv), ns = snap(nv);
    if (!nv) return out;
    if (ps.lv && ns.lv != null && ns.lv > ps.lv) out.push({ k: 'levelEnd', lv: ps.lv });
    if (nv.level && nv.level !== (pv && pv.level)) out.push(clean({ k: 'levelStart', lv: nv.level, title: nv.levelTitle || undefined }));
    var evs = (nv.events || []).slice(), b = nv.battle;
    if (b && b.lastRound) evs = evs.concat(b.lastRound);
    evs.forEach(function (e) {
      if (!e || !e.kind) return;
      switch (e.kind) {
        case 'down': if (e.side === 'ally') out.push(clean({ k: 'down', side: e.side, id: e.id || e.uid, rd: num(e.round), text: e.text })); break; // 阵亡 (our side); the foes are in battleEnd
        case 'sacrifice': out.push(clean({ k: 'sacrifice', mode: e.mode, ids: e.ids, text: e.text })); break;
        case 'turncoat': case 'advisorLeaves': case 'backstab': case 'bell': case 'followBell': case 'reckoning':
          out.push(clean({ k: e.kind, id: e.id, text: e.text ? clip(e.text, 80) : undefined })); break;
        case 'mood':
          if (Math.abs(e.delta || 0) >= 2 || (e.mood != null && e.mood <= -2 && e.delta < 0)) out.push(clean({ k: 'mood', id: e.id, n: e.name, d: e.delta, to: e.mood })); break;
        case 'cheat': out.push({ k: 'cheat', what: e.cheat || '' }); break;
        default:
      }
    });
    var pk = (pv && pv.keys) || {}, nk = nv.keys || {};
    Object.keys(nk).forEach(function (k) { if (nk[k] && !pk[k]) out.push({ k: 'key', key: k }); });
    if (action && (action.type === 'sealChoice' || action.type === 'followBell')) out.push(clean({ k: 'keyChoice', what: action.type, choice: action.choice }));
    // a battle ends: the screen moves off 'battle' (result, game over, or straight on)
    var wasBattle = pv && pv.phase === 'battle', isOver = nv.phase !== 'battle' && b;
    if (wasBattle && isOver) {
      out.push(clean({ k: 'battleEnd', lv: num(nv.level), win: b.win != null ? !!b.win : nv.phase !== 'gameOver', rd: num(b.round), wv: num(b.wave),
        allies: hpList(b.allies), enemies: hpList(b.enemies) }));
    }
    var oc = outcomeOf(nv); if (oc && outcomeOf(pv) !== oc) out.push({ k: 'outcome', outcome: oc });
    return out;
  }

  function create(o) {
    o = o || {};
    var on = o.enabled !== false, st = o.storage || null, key = o.key || KEY, max = o.maxBytes || MAX_BYTES, now = o.now || now0;
    var setT = o.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null), flushMs = o.flushMs == null ? 2000 : o.flushMs;
    var log = null, cur = null, scr = null, timer = null, hidAt = null, stats = { writes: 0, fails: 0, trims: 0 };
    function fresh() { return { format: 'chooser-playlog', v: 1, created: now(), counters: { loads: 0, reloads: 0, resumes: 0 }, sessions: [], runs: [], loose: [], errors: [], dropped: 0 }; }
    function load() {
      var l = null;
      try { var s = st && st.getItem(key); l = s ? JSON.parse(s) : null; } catch (e) { l = null; }
      if (!l || l.format !== 'chooser-playlog' || !Array.isArray(l.runs)) l = fresh();
      ['sessions', 'runs', 'loose', 'errors'].forEach(function (k) { if (!Array.isArray(l[k])) l[k] = []; });
      l.counters = l.counters || { loads: 0, reloads: 0, resumes: 0 };
      return l;
    }
    if (on) log = load();

    function sid() { return log.sessions.length - 1; }
    function push(e) {
      if (!on) return;
      try {
        if (cur) { e.t = now() - cur.start; if (cur.ev.length < EV_MAX) cur.ev.push(e); else cur.evCut = (cur.evCut || 0) + 1; }
        else { e.at = now(); log.loose.push(e); if (log.loose.length > LOOSE_MAX) log.loose.splice(0, log.loose.length - LOOSE_MAX); }
        dirty();
      } catch (x) { /* never break the game */ }
    }
    function dirty() { if (!timer && setT && flushMs > 0) timer = setT(function () { timer = null; flush(); }, flushMs); }
    function size(x) { return JSON.stringify(x).length; }
    // keep the file under max: drop the oldest runs first (never the current one), then old loose entries, then the
    // current run's oldest ordinary entries (errors are kept)
    function trim(lim) {
      var s = JSON.stringify(log);
      while (s.length > lim) {
        var i = -1; for (var j = 0; j < log.runs.length; j++) if (log.runs[j] !== cur) { i = j; break; }
        if (i < 0) break;
        log.runs.splice(i, 1); log.dropped = (log.dropped || 0) + 1; stats.trims++; s = JSON.stringify(log);
      }
      if (s.length > lim && log.loose.length) { log.loose = log.loose.slice(-20); s = JSON.stringify(log); }
      if (s.length > lim && log.errors.length > 20) { log.errors = log.errors.slice(-20); s = JSON.stringify(log); }
      while (s.length > lim && cur && cur.ev.length > 10) {
        var n = Math.ceil(cur.ev.length / 4), kept = [], gone = 0;
        cur.ev.forEach(function (e, k) { if (k < n && e.k !== 'error') gone++; else kept.push(e); });
        if (!gone) break;
        cur.ev = kept; cur.evCut = (cur.evCut || 0) + gone; stats.trims++; s = JSON.stringify(log);
      }
      return s;
    }
    function flush() {
      if (!on || !st) return false;
      if (timer && o.clearTimeout) { try { o.clearTimeout(timer); } catch (e) { /* */ } }
      timer = null;
      try {
        var s = trim(max);
        try { st.setItem(key, s); stats.writes++; return true; } catch (e) {
          stats.fails++; // storage full: make room once, then give up quietly
          try { st.setItem(key, trim(Math.floor(max / 3))); stats.writes++; return true; } catch (e2) { stats.fails++; return false; }
        }
      } catch (e) { stats.fails++; return false; }
    }
    function findRun(seed) { for (var i = log.runs.length - 1; i >= 0; i--) if (log.runs[i].seed === seed) return log.runs[i]; return null; }
    function closeScreen(partial) {
      if (!scr) return;
      var t = now(), hid = scr.hid + (hidAt != null ? t - hidAt : 0);
      scr.e.ms = Math.max(0, t - scr.t0 - hid); if (partial) scr.e.open = 1;
      if (!partial) scr = null; else { scr.t0 = t; scr.hid = 0; }
    }

    var api = {
      enabled: on, key: key, maxBytes: max, stats: stats,
      data: function () { return log; },
      current: function () { return cur; },
      // one page load: environment + whether it was a reload
      session: function (env, nav) {
        if (!on) return;
        try {
          log.counters.loads++; if (nav === 'reload') log.counters.reloads++;
          log.sessions.push(clean({ at: now(), nav: nav || undefined, env: env || {} }));
          if (log.sessions.length > 60) log.sessions.splice(0, log.sessions.length - 60);
          dirty();
        } catch (e) { /* */ }
      },
      runStart: function (info) {
        if (!on) return;
        try {
          info = info || {};
          cur = clean({ seed: info.seed, start: now(), sid: sid(), diff: info.diff, keysCheat: info.keysCheat ? 1 : undefined, end: null, outcome: null, ev: [] });
          cur.end = null; cur.outcome = null;
          log.runs.push(cur); scr = null; dirty();
        } catch (e) { /* */ }
      },
      // 继续 / ?resume=1: the saved run is picked up again (after a reload, or from the title)
      resume: function (seed, v, how) {
        if (!on) return;
        try {
          log.counters.resumes++;
          cur = findRun(seed);
          if (!cur) { cur = { seed: seed, start: now(), sid: sid(), end: null, outcome: null, resumedOnly: 1, ev: [] }; log.runs.push(cur); }
          var s = snap(v); s.k = 'resume'; s.how = how || 'continue'; s.sid = sid(); push(s);
        } catch (e) { /* */ }
      },
      runEnd: function (outcome, v) {
        if (!on || !cur) return;
        try {
          if (cur.outcome) return;
          cur.outcome = outcome; cur.end = now(); cur.endAt = snap(v);
          var s = snap(v); s.k = 'end'; s.outcome = outcome; push(s); flush();
        } catch (e) { /* */ }
      },
      // a run that is about to be replaced (新的一局 over an unfinished save)
      abandon: function (seed, v) {
        if (!on) return;
        try {
          var r = seed != null ? findRun(seed) : cur; if (!r || r.outcome) return;
          var keep = cur; cur = r; api.runEnd('abandon', v); cur = keep;
        } catch (e) { /* */ }
      },
      act: function (action, pv, nv) {
        if (!on) return;
        try {
          var e = snap(pv); e.k = 'act'; e.a = actionOf(action);
          if (action && action.meta && action.meta.ms != null) e.dm = action.meta.ms;
          push(e);
          if (cur && nv && nv.difficulty && cur.diff == null) cur.diff = nv.difficulty.name != null ? nv.difficulty.name : nv.difficulty.id;
          observe(pv, action, nv).forEach(push);
        } catch (x) { /* */ }
      },
      actFail: function (action, pv, msg) { var e = snap(pv); e.k = 'actFail'; e.a = actionOf(action); e.msg = clip(msg, 300); push(e); },
      event: function (k, data) { var e = clean(data || {}); e.k = k; push(e); },
      // a new screen: closes the previous one with its time on screen (time with the tab hidden does not count)
      screen: function (name, v) {
        if (!on) return;
        try {
          closeScreen(false);
          var e = snap(v); e.k = 'screen'; e.s = name; push(e);
          scr = { e: e, t0: now(), hid: 0 };
        } catch (x) { /* */ }
      },
      hidden: function () { if (on && hidAt == null) hidAt = now(); },
      shown: function () { if (!on || hidAt == null) return; if (scr) scr.hid += now() - hidAt; hidAt = null; },
      // pagehide / reload: stamp where the player was and write now
      leave: function (v) { if (!on) return; try { closeScreen(true); var s = snap(v); s.k = 'leave'; push(s); flush(); } catch (e) { /* */ } },
      error: function (info) {
        if (!on) return;
        try {
          info = info || {};
          var e = clean({ k: 'error', src: info.src, msg: clip(info.msg, 500), stack: info.stack ? clip(info.stack, 3000) : undefined, file: info.file, line: info.line, col: info.col, at: info.at || now() });
          var w = info.where; if (w) { e.ph = w.ph; e.lv = w.lv; e.rd = w.rd; }
          if (cur) e.seed = cur.seed;
          log.errors.push(e); if (log.errors.length > ERR_MAX) log.errors.splice(0, log.errors.length - ERR_MAX);
          if (cur) push(clean({ k: 'error', msg: e.msg, src: e.src }));
          flush();
        } catch (x) { /* */ }
      },
      flush: flush,
      // the file the player sends back
      exportData: function (env) {
        return { format: 'chooser-playlog', v: 1, exportedAt: new Date(now()).toISOString(), key: key, env: env || null, log: log || fresh() };
      }
    };
    return api;
  }

  function fileName(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'chooser-playlog-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }

  var PL = { KEY: KEY, MAX_BYTES: MAX_BYTES, create: create, observe: observe, snap: snap, outcomeOf: outcomeOf, actionOf: actionOf, fileName: fileName, early: [] };

  // browser: catch errors from the very first script on; app.js drains PL.early into the log once it has one
  if (typeof window !== 'undefined' && window.addEventListener) {
    PL.sink = null;
    var take = function (info) { try { if (PL.sink) PL.sink(info); else if (PL.early.length < 50) PL.early.push(info); } catch (e) { /* */ } };
    window.addEventListener('error', function (ev) {
      if (!ev) return;
      var t = ev.target; // a failed <img>/<script> load: no message, just the element (images fall back on their own: skip them)
      if (t && t !== window && t.tagName) { if (t.tagName === 'SCRIPT') take({ src: 'load', msg: 'script failed: ' + (t.src || ''), at: Date.now() }); return; }
      take({ src: 'onerror', msg: ev.message || String(ev.error || ''), stack: ev.error && ev.error.stack, file: ev.filename, line: ev.lineno, col: ev.colno, at: Date.now() });
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason; take({ src: 'unhandledrejection', msg: r && r.message ? r.message : String(r), stack: r && r.stack, at: Date.now() });
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PL; else root.ChooserPlaylog = PL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
