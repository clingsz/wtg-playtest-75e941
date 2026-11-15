// 游玩记录 (play log) v2, 2026-11-14 晚 — a SMALL local-only record of a friend's playtest (itch has no server and the page CSP is
// connect-src 'none': the player exports a file from ☰ → 记录 and sends it back). Read it with: node tools/read-playlog.mjs <file>.
// Only decisions and outcomes: run start (tier, seed, leader name + class), every choice the player makes (no 'continue', no
// in-battle moves), one summary per battle (level, waves, rounds, win, who fell, final HP), key moments (keys, sacrifice),
// deduped errors, run end. No per-hit logs, no view / state snapshots, no text dumps, no decision timing (telemetry has it).
// Hard caps: ≤ 200 KB in storage, ≤ 10 runs, ≤ 400 events a run, ≤ 30 distinct errors; writes ≥ 2 s apart, one at a time.
// Pure UI-side bookkeeping: never calls the engine's act(), never uses Math.random, never throws into the game.
// Browser: loaded before engine.js so it can already catch load-time errors (window.ChooserPlaylog.early).
// Node: require('ui/playlog.js') → { create, observe, snap, outcomeOf, KEY, MAX_BYTES, … }.
(function (root) {
  'use strict';
  var KEY = 'chooser.playlog.v2', OLD_KEY = 'chooser.playlog.v1', MAX_BYTES = 200000, RUNS_MAX = 10, EV_MAX = 400, ERR_MAX = 30, SES_MAX = 10, LOOSE_MAX = 30,
    STR_MAX = 300, FLUSH_MIN = 2000;
  var SKIP_ACT = { 'continue': 1, move: 1 }; // not decisions: story advance, in-battle repositioning
  var EVENT_OK = { cheat: 1, home: 1, broken: 1 }; // the only free-form events app.js may add

  function now0() { return Date.now(); }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : undefined; }
  function clip(s, n) { s = String(s == null ? '' : s); n = n || STR_MAX; return s.length > n ? s.slice(0, n) + '…' : s; }
  function noQuery(s) { return String(s == null ? '' : s).replace(/\?[^\s:)'"]*/g, '').replace(/https?:\/\/[^/\s]+/g, ''); } // no URL params, no host
  function clean(o) { var r = {}; for (var k in o) if (o[k] !== undefined && o[k] !== null) r[k] = o[k]; return r; }
  // a value small and safe enough to keep: numbers, booleans, short strings, short lists of those (ids)
  function small(x) {
    if (typeof x === 'number') return num(x);
    if (typeof x === 'boolean') return x;
    if (typeof x === 'string') return clip(x, 40);
    if (Array.isArray(x)) { var a = x.slice(0, 12).map(small).filter(function (y) { return y !== undefined && typeof y !== 'object'; }); return a.length ? a : undefined; }
    return undefined;
  }
  function browserFamily(ua) {
    ua = String(ua || '');
    return /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' :
      /Safari\//.test(ua) ? 'Safari' : ua ? 'other' : undefined;
  }

  // where the player is: phase / level / round / wave
  function snap(v) {
    if (!v) return { ph: 'title' };
    var b = v.battle;
    return clean({ ph: v.phase, lv: num(v.level), rd: b ? num(b.round) : undefined, wv: b && b.waveCount > 1 ? num(b.wave) : undefined });
  }
  // the action's own small parameters (ids, indexes, choices); never the UI's meta
  function actionOf(a) {
    var r = {}; if (!a) return r;
    for (var k in a) if (k !== 'meta') { var s = small(a[k]); if (s !== undefined) r[k] = s; }
    return r;
  }
  function hpList(us) { return (us || []).slice(0, 8).map(function (u) { return clean({ id: small(u.id || u.uid), hp: num(u.hp), max: num(u.maxHp) }); }); }
  // ending kinds: true / normal (a clear) / defeat (game over); 'abandon' is set by the UI when a run is replaced
  function outcomeOf(v) {
    if (!v) return null;
    if (v.phase === 'gameOver') return 'defeat';
    if (v.phase !== 'ending') return null;
    var o = v.summary && v.summary.outcome;
    return o === 'true' ? 'true' : o === 'defeat' ? 'defeat' : 'normal';
  }

  // key moments readable straight from (view before, action, view after): level start, keys, the sacrifice, battle ends
  function observe(pv, action, nv) {
    var out = [];
    if (!nv) return out;
    if (nv.level && nv.level !== (pv && pv.level)) out.push({ k: 'levelStart', lv: nv.level });
    (nv.events || []).forEach(function (e) {
      if (e && e.kind === 'sacrifice') out.push(clean({ k: 'sacrifice', mode: small(e.mode), ids: small(e.ids) }));
    });
    var pk = (pv && pv.keys) || {}, nk = nv.keys || {};
    Object.keys(nk).forEach(function (k) { if (nk[k] && !pk[k]) out.push({ k: 'key', key: clip(k, 20) }); });
    // a battle ends: the screen moves off 'battle' (result, game over, or straight on — a fight can end in its first round)
    var b = nv.battle;
    var wasBattle = pv && (pv.phase === 'battle' || (pv.phase !== 'battleResult' && pv.phase !== 'gameOver' && (nv.phase === 'battleResult' || nv.phase === 'gameOver'))), isOver = nv.phase !== 'battle' && b;
    if (wasBattle && isOver) {
      var allies = b.allies || [];
      out.push(clean({ k: 'battleEnd', lv: num(nv.level), win: b.win != null ? !!b.win : nv.phase !== 'gameOver', rd: num(b.round), waves: num(b.waveCount),
        fell: small(allies.filter(function (u) { return !(u.hp > 0); }).map(function (u) { return u.id || u.uid; })), hp: hpList(allies) }));
    }
    return out;
  }
  function leaderOf(v) {
    var p = (v && v.party) || [];
    for (var i = 0; i < p.length; i++) if (p[i] && (p[i].id === 'leader' || p[i].isLeader)) return clean({ name: p[i].name ? clip(p[i].name, 16) : undefined, cls: small(p[i].role) });
    return null;
  }

  function create(o) {
    o = o || {};
    var on = o.enabled !== false, st = o.storage || null, key = o.key || KEY, max = Math.min(o.maxBytes || MAX_BYTES, MAX_BYTES), now = o.now || now0;
    var setT = o.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null), flushMs = o.flushMs == null ? FLUSH_MIN : o.flushMs > 0 ? Math.max(FLUSH_MIN, o.flushMs) : 0;
    var log = null, cur = null, timer = null, writing = false, lastWrite = -1e15, stats = { writes: 0, fails: 0, trims: 0, skipped: 0 };
    function fresh() { return { format: 'chooser-playlog', v: 2, created: now(), counters: { loads: 0, reloads: 0, resumes: 0 }, sessions: [], runs: [], loose: [], errors: [], dropped: 0 }; }
    function load() {
      var l = null;
      try { var s = st && st.getItem(key); l = s && s.length <= max * 2 ? JSON.parse(s) : null; } catch (e) { l = null; }
      if (!l || l.format !== 'chooser-playlog' || l.v !== 2 || !Array.isArray(l.runs)) l = fresh();
      ['sessions', 'runs', 'loose', 'errors'].forEach(function (k) { if (!Array.isArray(l[k])) l[k] = []; });
      l.counters = l.counters || { loads: 0, reloads: 0, resumes: 0 };
      return l;
    }
    if (on) {
      log = load();
      // the old v1 log (up to 1.5 MB) goes: v2 replaces it
      try { if (st && st.removeItem) st.removeItem(key.replace(KEY, OLD_KEY)); } catch (e) { /* */ }
    }

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
    // keep the file under max: drop the oldest runs first (never the current one), then old loose entries / errors, then the
    // current run's oldest ordinary entries
    function trim(lim) {
      if (log.runs.length > RUNS_MAX) { var cut = log.runs.length - RUNS_MAX; log.runs.splice(0, cut); log.dropped = (log.dropped || 0) + cut; }
      var s = JSON.stringify(log);
      while (s.length > lim) {
        var i = -1; for (var j = 0; j < log.runs.length; j++) if (log.runs[j] !== cur) { i = j; break; }
        if (i < 0) break;
        log.runs.splice(i, 1); log.dropped = (log.dropped || 0) + 1; stats.trims++; s = JSON.stringify(log);
      }
      if (s.length > lim && log.loose.length) { log.loose = log.loose.slice(-5); s = JSON.stringify(log); }
      if (s.length > lim && log.errors.length > 5) { log.errors = log.errors.slice(-5); s = JSON.stringify(log); }
      while (s.length > lim && cur && cur.ev.length > 10) {
        var n = Math.ceil(cur.ev.length / 4);
        cur.ev = cur.ev.slice(n); cur.evCut = (cur.evCut || 0) + n; stats.trims++; s = JSON.stringify(log);
      }
      return s;
    }
    function flush() {
      if (!on || !st || writing) { if (writing) stats.skipped++; return false; }
      if (timer && o.clearTimeout) { try { o.clearTimeout(timer); } catch (e) { /* */ } }
      timer = null; writing = true;
      try {
        var s = trim(max);
        try { st.setItem(key, s); stats.writes++; lastWrite = now(); return true; } catch (e) {
          stats.fails++; // storage full: make room once, then give up quietly
          try { st.setItem(key, trim(Math.floor(max / 3))); stats.writes++; lastWrite = now(); return true; } catch (e2) { stats.fails++; return false; }
        }
      } catch (e) { stats.fails++; return false; } finally { writing = false; }
    }
    // a write the page asks for itself (pagehide, run end): at once, unless one ran in the last 2 s — then the timer does it
    function flushSoon() { if (flushMs > 0 && now() - lastWrite < FLUSH_MIN) { dirty(); return false; } return flush(); }
    function findRun(seed) { for (var i = log.runs.length - 1; i >= 0; i--) if (log.runs[i].seed === seed) return log.runs[i]; return null; }
    function newRun(r) { log.runs.push(r); if (log.runs.length > RUNS_MAX) { var c = log.runs.length - RUNS_MAX; log.runs.splice(0, c); log.dropped = (log.dropped || 0) + c; } }
    function guard(fn) { return function (a, b, c) { if (!on) return undefined; try { return fn(a, b, c); } catch (e) { return undefined; } }; }

    var api = {
      enabled: on, key: key, maxBytes: max, stats: stats,
      data: function () { return log; },
      current: function () { return cur; },
      // one page load: build, window size, touch, language, browser family (never the full user agent, never the URL)
      session: guard(function (env, nav) {
        env = env || {};
        log.counters.loads++; if (nav === 'reload') log.counters.reloads++;
        var e = clean({ v: small(env.v), engine: small(env.engine), stub: env.stub ? 1 : undefined, profile: small(env.profile), w: num(env.w), h: num(env.h), dpr: num(env.dpr),
          touch: env.touch ? 1 : undefined, lang: small(env.lang), browser: env.browser ? small(env.browser) : browserFamily(env.ua) });
        log.sessions.push(clean({ at: now(), nav: small(nav), env: e }));
        if (log.sessions.length > SES_MAX) log.sessions.splice(0, log.sessions.length - SES_MAX);
        dirty();
      }),
      runStart: guard(function (info) {
        info = info || {};
        cur = clean({ seed: small(info.seed), start: now(), sid: sid(), keysCheat: info.keysCheat ? 1 : undefined, end: null, outcome: null, ev: [] });
        cur.end = null; cur.outcome = null;
        newRun(cur); dirty();
      }),
      // 继续 / ?resume=1: the saved run is picked up again (after a reload, or from the title)
      resume: guard(function (seed, v, how) {
        log.counters.resumes++;
        cur = findRun(seed);
        if (!cur) { cur = { seed: small(seed), start: now(), sid: sid(), end: null, outcome: null, resumedOnly: 1, ev: [] }; newRun(cur); }
        var s = snap(v); s.k = 'resume'; s.how = how === 'auto' ? 'auto' : 'continue'; push(s);
      }),
      runEnd: guard(function (outcome, v) {
        if (!cur || cur.outcome) return;
        cur.outcome = small(outcome); cur.end = now(); cur.endAt = snap(v);
        var s = snap(v); s.k = 'end'; s.outcome = small(outcome); push(s); flushSoon();
      }),
      // a run that is about to be replaced (新的一局 over an unfinished save)
      abandon: guard(function (seed, v) {
        var r = seed != null ? findRun(seed) : cur; if (!r || r.outcome) return;
        var keep = cur; cur = r; api.runEnd('abandon', v); cur = keep;
      }),
      // a decision (not 'continue' / in-battle moves) + what it led to
      act: guard(function (action, pv, nv) {
        if (cur && nv) {
          if (nv.difficulty && cur.diff == null) cur.diff = small(nv.difficulty.name != null ? nv.difficulty.name : nv.difficulty.id);
          var ld = leaderOf(nv); if (ld && (!cur.leader || cur.leader.name !== ld.name || cur.leader.cls !== ld.cls)) cur.leader = ld;
        }
        if (action && action.type && !SKIP_ACT[action.type]) { var e = snap(pv); delete e.rd; delete e.wv; e.k = 'act'; e.a = actionOf(action); push(e); }
        observe(pv, action, nv).forEach(push);
      }),
      actFail: guard(function (action, pv, msg) { var e = snap(pv); e.k = 'actFail'; e.a = actionOf(action); e.msg = clip(msg, 120); push(e); }),
      event: guard(function (k, data) {
        if (!EVENT_OK[k]) return;
        var e = {}, d = data || {}; for (var x in d) { var s = small(d[x]); if (s !== undefined) e[x] = s; }
        e.k = k; push(e);
      }),
      screen: function () { /* v2: no per-screen records */ },
      hidden: function () { /* v2 */ },
      shown: function () { /* v2 */ },
      // pagehide / reload: stamp where the player was and write (throttled)
      leave: guard(function (v) { var s = snap(v); s.k = 'leave'; push(s); flushSoon(); }),
      // errors: one entry per (source, message, place) with a count, first / last time; stack cut to 300 chars
      error: guard(function (info) {
        info = info || {};
        var msg = clip(noQuery(info.msg), STR_MAX), src = small(info.src), t = info.at || now();
        for (var i = 0; i < log.errors.length; i++) {
          var x = log.errors[i];
          if (x.msg === msg && x.src === src && x.line === num(info.line)) { x.n = (x.n || 1) + 1; x.last = t; dirty(); return; }
        }
        var w = info.where || {};
        log.errors.push(clean({ src: src, msg: msg, stack: info.stack ? clip(noQuery(info.stack), STR_MAX) : undefined, file: info.file ? clip(String(info.file).split(/[?#]/)[0].split('/').pop(), 60) : undefined,
          line: num(info.line), col: num(info.col), n: 1, first: t, last: t, seed: cur ? cur.seed : undefined, ph: small(w.ph), lv: num(w.lv) }));
        if (log.errors.length > ERR_MAX) log.errors.splice(0, log.errors.length - ERR_MAX);
        if (cur) push(clean({ k: 'error', msg: clip(msg, 80) }));
        flushSoon();
      }),
      flush: flush,
      // the file the player sends back
      exportData: function (env) {
        var e = null; try { e = env ? clean({ v: small(env.v), engine: small(env.engine), w: num(env.w), h: num(env.h), touch: env.touch ? 1 : undefined, lang: small(env.lang), browser: env.browser ? small(env.browser) : browserFamily(env.ua) }) : null; } catch (x) { e = null; }
        return { format: 'chooser-playlog', v: 2, exportedAt: new Date(now()).toISOString(), key: key, env: e, log: log || fresh() };
      }
    };
    return api;
  }

  function fileName(d) {
    d = d || new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'chooser-playlog-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }

  var PL = { KEY: KEY, MAX_BYTES: MAX_BYTES, RUNS_MAX: RUNS_MAX, EV_MAX: EV_MAX, ERR_MAX: ERR_MAX, create: create, observe: observe, snap: snap, outcomeOf: outcomeOf,
    actionOf: actionOf, browserFamily: browserFamily, fileName: fileName, early: [] };

  // browser: catch errors from the very first script on; app.js drains PL.early into the log once it has one
  if (typeof window !== 'undefined' && window.addEventListener) {
    PL.sink = null;
    var take = function (info) { try { if (PL.sink) PL.sink(info); else if (PL.early.length < 20) PL.early.push(info); } catch (e) { /* */ } };
    window.addEventListener('error', function (ev) {
      if (!ev) return;
      var t = ev.target; // a failed <img>/<script> load: no message, just the element (images fall back on their own: skip them)
      if (t && t !== window && t.tagName) { if (t.tagName === 'SCRIPT') take({ src: 'load', msg: 'script failed: ' + String(t.src || '').split(/[?#]/)[0].split('/').pop(), at: Date.now() }); return; }
      take({ src: 'onerror', msg: ev.message || String(ev.error || ''), stack: ev.error && ev.error.stack, file: ev.filename, line: ev.lineno, col: ev.colno, at: Date.now() });
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason; take({ src: 'unhandledrejection', msg: r && r.message ? r.message : String(r), stack: r && r.stack, at: Date.now() });
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PL; else root.ChooserPlaylog = PL;
})(typeof globalThis !== 'undefined' ? globalThis : this);
