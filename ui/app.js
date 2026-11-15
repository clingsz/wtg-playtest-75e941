// 《欢迎加入冒险者公会！》 v2 browser UI — a thin renderer over ChooserEngine (docs/V2-CONTRACT.md).
// Rule: every decision is `run = E.act(DATA, run, action)` then render `E.view(DATA, run)`. No game rules here.
// Principles (docs/V2-PLAN.md): one choice per screen, little text; dialogue and scenes minimal but atmospheric.
// All spoken text goes through ONE dialogue queue (say()). A click anywhere on the stage, Space or Enter always advances
// it, and no screen renders while lines from the previous action are still pending.
(function () {
  'use strict';

  // ---------- engine selection (real v2 → stub fallback) ----------
  var Q = new URLSearchParams(location.search);
  var FXLOG = Q.get('fxlog') === '1' ? (window.__fxlog = []) : null; // dev: animation timing marks for ui/dev/fb1112.cjs (feedback-1112 [5])
  var RE = window.ChooserEngine, RD = window.CHOOSER_DATA;
  var realOK = !!(RE && RD && RE.version >= 2);
  var STUB = Q.get('stub') === '1' || !realOK;
  var E = STUB ? window.ChooserStubEngine : RE;
  var DATA = STUB ? window.CHOOSER_STUB_DATA : RD;
  if (STUB && DATA && Q.get('lose')) DATA.loseAt = +Q.get('lose');
  if (STUB && DATA && Q.get('nofw')) DATA.noFarewells = true;
  if (STUB && DATA && Q.get('soft')) DATA.softBoost = +Q.get('soft'); // dev: make the soft-heart miss likely
  if (STUB && DATA && Q.get('frenzyAt')) DATA.frenzyFrom = +Q.get('frenzyAt'); // dev: frenzy from round N
  if (STUB && DATA && Q.get('turn')) DATA.turnBoost = +Q.get('turn'); // dev: make the L11 turncoat likely
  var PROFILE = (Q.get('profile') || '').replace(/[^\w-]/g, ''); // ?profile=x keeps saves + telemetry separate
  var PSUF = PROFILE ? '.' + PROFILE : '';
  // v2 keys only: v1 saves are incompatible, and the v0 keys belong to the player. An engine whose version moves to 3 changed
  // the save format, so its runs live under chooser.run.v3.
  var KEY = 'chooser.run.v' + (E && E.version >= 3 ? 3 : 2) + (STUB ? '.stub' : '') + PSUF;
  // v2.2 §2 meta memory across runs (the fairy remembers you). One key per ?profile=; the stub keeps its own.
  var MKEY = 'chooser.meta.v2' + (STUB ? '.stub' : '') + PSUF;
  if (Q.get('resetMeta') === '1') { try { localStorage.removeItem(MKEY); } catch (e) { /* */ } }
  var NOCHEAT = Q.get('nocheat') === '1';
  // i18n (docs/I18N.md): pick the language once the meta is readable (?lang= beats meta.lang beats zh), then use the data in
  // that language (data/i18n overrides; the same object when there are none). The stub engine has no i18n of its own.
  var LX = (E && E.i18n && E.setLocale) ? E : (RE && RE.i18n && RE.setLocale ? RE : null);
  if (LX) { LX.setLocale(LX.i18n.pickLocale({ search: location.search, meta: loadMeta() })); if (!STUB && DATA) DATA = LX.i18n.localizeData(RD); }
  var TKEY = 'chooser.telemetry.v2' + PSUF, QKEY = 'chooser.questionnaire.v2' + PSUF, PKEY = 'chooser.prefs.v2' + PSUF;
  // 2026-11-14 游玩记录 (ui/playlog.js): local only, exported from the 音 popover; ?log=0 turns it off. Every call is guarded.
  var PLM = window.ChooserPlaylog, PL = null;
  var BUILD_V = (function () { try { var m = /[?&]v=([^&]+)/.exec((document.currentScript && document.currentScript.src) || ''); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } })();
  function plEnv() {
    // 游玩记录 v2: only what helps read a playtest — the browser FAMILY (playlog.js reduces the UA), never the URL
    var w = window.innerWidth || 0, h = window.innerHeight || 0, B = window.ChooserPlaylog;
    return { v: BUILD_V, engine: E && E.version, stub: STUB || undefined, profile: PROFILE || undefined, w: w, h: h, dpr: window.devicePixelRatio || 1,
      touch: !!(('ontouchstart' in window) || (navigator.maxTouchPoints > 0)), browser: B && B.browserFamily ? B.browserFamily(navigator.userAgent) : undefined, lang: navigator.language };
  }
  function pl(fn, a, b, c) { try { if (PL && PL[fn]) PL[fn](a, b, c); } catch (e) { /* the play log must never break the game */ } }
  if (PLM && Q.get('log') !== '0') {
    try {
      PL = PLM.create({ storage: window.localStorage, key: PLM.KEY + PSUF });
      var navType = null; try { var ne = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]; navType = ne ? ne.type : null; } catch (e) { /* */ }
      PL.session(plEnv(), navType);
      PLM.sink = function (info) { info.where = PLM.snap(view); pl('error', info); };
      PLM.early.splice(0).forEach(PLM.sink);
      document.addEventListener('visibilitychange', function () { if (document.hidden) { pl('hidden'); pl('flush'); } else pl('shown'); });
      window.addEventListener('pagehide', function () { pl('leave', view); });
    } catch (e) { PL = null; }
  }

  var A = window.CHOOSER_ASSETS;
  // i18n (docs/I18N.md): every word on screen comes from data/text/<locale>/ui.json. T(key, vars) is looked up when used;
  // a constant with text in it is lazy(() => …) and read as NAME() (rebuilt when the locale changes).
  function T(k, v) { return A.t(k, v); }
  function TL(k) { return T(k).split('|'); } // a list kept in one text, '|' between the items
  function curLoc() { var X = window.ChooserEngine; return X && X.getLocale ? X.getLocale() : ''; }
  function lazy(f) { var loc = null, v; return function () { var l = curLoc(); if (loc !== l || v === undefined) { loc = l; v = f(); } return v; }; }
  function bold(s) { return String(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); } // **…** in a text → <b> (texts carry no HTML)
  document.title = T('ui.page.title'); // index.html's <title> is filled here, in the chosen language
  (function () { // 手机端: the home-screen name (iOS reads it when 添加到主屏幕 is tapped), in the chosen language
    var m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!m) { m = document.createElement('meta'); m.name = 'apple-mobile-web-app-title'; document.head.appendChild(m); }
    m.content = document.title;
  })();
  if (curLoc() && curLoc() !== 'zh') document.documentElement.lang = curLoc();
  var stageEl = $('stage'), app = $('app'), vnEl = $('vn'), fxLayer = $('fx'), cineEl = $('cine'), tipEl = $('tip'), modalEl = $('modal');
  var bgA = $('bg'), bgB = $('bg2');
  var STAGE_W = 1920, STAGE_H = 1080;
  // 2026-11-14 手机端 (方案 B, docs/SPEC-2026-11-13-batch6.md): on a touch screen the page is pinned (body.mb: fixed, no
  // overscroll / pan / pinch / double-tap zoom / text selection / long-press menu), the fit follows visualViewport (two rAFs,
  // so the iOS toolbars have settled), and held upright the stage turns 90° (A.stageFit). Not touch (desktop): the old fit,
  // nothing pinned, never turned. ?touch=1 / ?touch=0 forces either. Pure parts: A.stageFit / toStage / rectToStage.
  var TOUCH = Q.get('touch') ? Q.get('touch') === '1' : !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  function viewSize() {
    var vv = TOUCH && window.visualViewport;
    return vv ? [Math.round(vv.width), Math.round(vv.height)] : [window.innerWidth || STAGE_W, window.innerHeight || STAGE_H];
  }
  function fitStage() {
    // touch: while a text field has the on-screen keyboard up, keep the fit (the keyboard shrinks visualViewport and would
    // shrink / un-turn the stage under the player's thumbs); focusout refits
    if (TOUCH && stageEl.style.transform && document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox') return;
    var s = viewSize(), f = A.stageFit(s[0], s[1], TOUCH, STAGE_W, STAGE_H);
    stageEl.style.transform = f.transform;
    if (TOUCH) { stageEl.classList.toggle('st-rot', f.rot); document.body.classList.toggle('st-rot', f.rot); }
  }
  if (!TOUCH) window.addEventListener('resize', fitStage);
  else {
    document.body.classList.add('mb');
    var fitRaf = 0;
    var fitSoon = function () { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(function () { fitRaf = requestAnimationFrame(fitStage); }); };
    window.addEventListener('resize', fitSoon);
    window.addEventListener('orientationchange', function () { setTimeout(fitSoon, 300); });
    document.addEventListener('focusout', function () { setTimeout(fitSoon, 50); });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitSoon);
      window.visualViewport.addEventListener('scroll', function () { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); fitSoon(); });
    }
    // no page scroll / rubber-band: a range slider and a textarea keep their own drag; pointer events (the title fairy) still fire
    var keepTouch = function (t) { return !!(t && t.closest && t.closest('input, textarea, select')); };
    document.addEventListener('touchmove', function (e) { if (!keepTouch(e.target)) e.preventDefault(); }, { passive: false });
    // pinch zoom (iOS gesture events); double-tap zoom is off by CSS touch-action (body.mb), so no touchend handler eats a quick 2nd tap
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) { if (!keepTouch(e.target)) e.preventDefault(); }); // Android long-press menu
  }
  fitStage();
  // every screen point (clientX / clientY) → stage px goes through toStage(); element positions through stagePt()
  function liveFit() { return A.liveFit(stageEl); }
  function toStage(x, y, f) { return A.toStage(x, y, f || liveFit()); }
  var run = null, view = null, screenKey = null, ui = {}, timers = [], replayed = {};
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var prefs = lsGet(PKEY, { speed: 1, auto: false });
  // v2.4 [15]: auto-continue is a fresh opt-in (prefs.autoCont, default off); an old saved prefs.auto no longer applies
  if (prefs.autoCont == null) prefs.autoCont = false;

  // ---------- audio (ui/audio.js, owned by the audio worker; may be missing → every call is guarded) ----------
  var MUTE_Q = Q.get('mute') === '1'; // ?mute=1: tests and screenshot runs never make sound
  function au(fn, a, b) { try { var X = window.CHOOSER_AUDIO; if (X && typeof X[fn] === 'function') return X[fn](a, b); } catch (e) { /* audio must never break the game */ } return undefined; }
  // UI-CLEAN §3: the sound controls (mute, music, sfx) live in the ☰ menu (menuHtml)
  var cueLast = {};
  // every cue is throttled per name (default 60 ms) so nothing can fire in a tight loop
  function cue(name, detail, ms) { var t = Date.now(), gap = ms == null ? 60 : ms; if (cueLast[name] && t - cueLast[name] < gap) return; cueLast[name] = t; au('cue', name, detail); }
  // ?mute=1 mutes this page only: audio.js reads it itself (session-only, never written); its store is per ?profile=
  var auReady = false, sceneKey = null, sceneCtx = null;
  function audioInit() {
    if (auReady) return; auReady = true; au('init');
    if (sceneCtx && !introHold) au('scene', sceneCtx);
    var mb = document.querySelector('[data-act="mute"]'); if (mb) mb.classList.toggle('off', !!au('isMuted'));
  }
  document.addEventListener('pointerdown', audioInit, true); document.addEventListener('keydown', audioInit, true);
  var introHold = false; // the opening (logo, notice, the fairy) is silent; the title music comes in under the whiteout
  function sceneAudio(ctx) { var k = JSON.stringify(ctx); if (k === sceneKey) return; sceneKey = k; sceneCtx = ctx; if (auReady && !introHold) au('scene', ctx); }

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  var OLD_CHAIN = lazy(function () { return new RegExp(T('ui.terms.oldChainWordRe'), 'g'); });
  function fixWords(s) { return String(s == null ? '' : s).replace(OLD_CHAIN(), T('ui.terms.chainWord')); } // SPEC-11-13 F: the teammate-chain word is 加成 (连击 = one blow, many hits)
  function esc(s) { return fixWords(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function richText(s, vars) { return A.skillMarkup(esc(s), vars); } // **右侧** → bold; batch6 H2-17: **2** / {n} → bold accent number
  var ROLE_NAME = lazy(function () { return { tank: T('ui.role.name.tank'), adc: T('ui.role.name.adc'), healer: T('ui.role.name.healer'), mage: T('ui.role.name.mage'), rogue: T('ui.role.name.rogue') }; });
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function lsGet(k, d) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function notice(msg) { var n = $('notice'); n.textContent = msg; n.hidden = false; clearTimeout(notice.t); notice.t = setTimeout(function () { n.hidden = true; }, 5000); }
  function actNo() { return (view && view.act) || 1; }
  function party() { return (view && view.party) || []; }
  function member(id) { return party().filter(function (m) { return m.id === id; })[0]; }
  function isLeader(x) { return !!x && (x === 'leader' || x.id === 'leader' || x.isLeader === true); }
  function cand(id) { return (DATA.candidates || []).filter(function (c) { return c.id === id; })[0]; }
  function advData(id) { return (DATA.advisors || []).filter(function (a) { return a.id === id; })[0]; }
  function bUnits() { var b = view && view.battle; return b ? (b.allies || []).concat(b.enemies || []) : []; }
  // 2026-11-14 结局去英文: narration has no speaker (never 「narrator」), and an unknown id is never shown as raw English
  var NO_NAME = { narrator: 1, Narrator: 1, narration: 1, gallery: 1, system: 1 };
  function nameOf(id) {
    if (id == null || NO_NAME[id]) return '';
    if (id === 'leader') { var lm = member('leader'); return (lm && lm.name) || (run && run.leaderName) || T('ui.name.leader'); }
    if (A.isFairy(id)) return T('ui.name.fairy');
    var m = member(id); if (m) return m.name;
    var u = bUnits().filter(function (x) { return x.id === id || x.uid === id; })[0]; if (u) return u.name;
    var c = cand(id); if (c) return c.name;
    var a = advData(id); if (a) return a.name;
    var e = (DATA.enemies || []).filter(function (x) { return x.id === id; })[0]; return e ? e.name : /^[\x00-\x7f]*$/.test(String(id)) ? '' : String(id);
  }
  function moodExpr(m) { return m == null ? 'calm' : m <= -2 ? 'sad' : m < 0 ? 'upset' : m > 0 ? 'happy' : 'calm'; }
  var MOOD_WORD_KEY = { '-2': 'ui.mood.word.m2', '-1': 'ui.mood.word.m1', '0': 'ui.mood.word.0', '1': 'ui.mood.word.1', '2': 'ui.mood.word.2' };
  function moodWord(m) { var k = m == null ? null : MOOD_WORD_KEY[String(m)]; return k ? T(k) : ''; }
  var IC = { hp: '<i class="ic ic-hp"></i>', atk: A.glyph('power'), /* 2026-11-14: 威力 = the power glyph (its tip says what 威力 is) */ swords: '<i class="ic ic-swords"></i>', chain: '<i class="ic ic-chain"></i>' };

  // ---------- image loader: ordered candidates, falls back on error (docs/ASSET-DEPOT.md) ----------
  var BAD = {};
  function splitCand(c) { var i = c.indexOf('#'); return { src: i < 0 ? c : c.slice(0, i), cls: i < 0 ? '' : c.slice(i + 1) }; }
  function live(list) { return (list || []).filter(function (c) { return c && !BAD[splitCand(c).src]; }); }
  // pic(list, cls, alt, fb): <img> trying list in order; when all fail, the sibling .pic-fb (fb html) shows instead
  function pic(list, cls, alt, fb) {
    var l = live(list), f = l.length ? splitCand(l[0]) : null;
    return '<img class="pic ' + (cls || '') + ' ' + (f ? f.cls : 'failed') + '"' + (f ? ' src="' + esc(f.src) + '"' : '') + ' data-base="' + esc(cls || '') + '" data-cands="' + esc(l.join('|')) +
      '" data-ci="0" alt="' + esc(alt || '') + '" draggable="false">' + (fb != null ? '<span class="pic-fb">' + fb + '</span>' : '');
  }
  function nextCand(img) {
    var list = (img.dataset.cands || '').split('|').filter(Boolean), i = +img.dataset.ci || 0;
    if (list[i]) BAD[splitCand(list[i]).src] = 1;
    for (i++; i < list.length; i++) if (!BAD[splitCand(list[i]).src]) break;
    img.dataset.ci = i;
    if (i < list.length) { var c = splitCand(list[i]); img.className = 'pic ' + img.dataset.base + ' ' + c.cls; img.src = c.src; }
    else { img.className = 'pic ' + img.dataset.base + ' failed'; img.removeAttribute('src'); }
  }
  function swapPic(img, list) { if (!img) return; var l = live(list); img.dataset.cands = l.join('|'); img.dataset.ci = -1; img.dataset.ci = 0; if (!l.length) { img.classList.add('failed'); return; } var c = splitCand(l[0]); img.className = 'pic ' + img.dataset.base + ' ' + c.cls; img.src = c.src; }
  document.addEventListener('error', function (e) { var t = e.target; if (t && t.tagName === 'IMG') { if (t.classList.contains('fa-l')) faFail(t); else if (t.dataset.cands != null) nextCand(t); else t.classList.add('failed'); } }, true);

  // ---------- v9 the fairy's layered animation (art/portraits/anim/<id>/README.md; pure parts in assets.js) ----------
  // fairyPic(id, cls, alt) replaces pic(A.portrait(id), …) wherever 小铃 stands. Until every layer of her has loaded once the
  // static portrait shows (class fa-want-<id>); when the preload finishes those <img>s are swapped for the stack. If any layer
  // fails, the state goes 'bad' and every stack of her goes back to the static portrait — never a body without wings.
  var FA_STATE = {};
  function faStatic(id, cls, alt) { return pic(A.portrait(id), (cls || '') + ' fa-want-' + id, alt, null); }
  function fairyPic(id, cls, alt) {
    faEnsure(id);
    return A.fairyUseLayers(id, FA_STATE[id]) ? A.fairyAnimHtml(id, cls, alt) : faStatic(id, cls, alt);
  }
  function faSwap(node, html) { var t = document.createElement('template'); t.innerHTML = html; var n = t.content.firstChild; if (n && node.parentNode) node.parentNode.replaceChild(n, node); }
  function faEnsure(id) {
    var a = A.fairyAnim(id); if (!a || FA_STATE[id]) return;
    FA_STATE[id] = 'pending';
    var left = a.all.length;
    a.all.forEach(function (src) {
      var im = new Image();
      im.onload = function () { if (FA_STATE[id] !== 'pending' || --left > 0) return; FA_STATE[id] = 'ok';
        document.querySelectorAll('img.fa-want-' + id).forEach(function (old) { faSwap(old, A.fairyAnimHtml(id, (old.dataset.base || '').replace(' fa-want-' + id, ''), old.alt)); }); };
      im.onerror = function () { if (FA_STATE[id] === 'bad') return; FA_STATE[id] = 'bad'; faRevert(id); };
      im.src = src;
    });
  }
  function faRevert(id) { document.querySelectorAll('.fanim[data-fa="' + id + '"]').forEach(function (n) { faSwap(n, faStatic(id, n.className.replace(/\bfanim\b/, '').trim(), n.getAttribute('aria-label'))); }); }
  function faFail(img) { var n = img.closest('.fanim'), id = n && n.dataset.fa; if (!id) return; FA_STATE[id] = 'bad'; faRevert(id); }
  // ONE loop drives every stack on screen: wing frame by the clock (per-frame durations), a blink every 3–5 s per stack.
  // It runs only while a .fanim is in the DOM (a MutationObserver restarts it), stops itself when the last one leaves,
  // and never runs under prefers-reduced-motion (wings stay on frame 1, eyes open).
  var faRaf = 0, faNodes = document.getElementsByClassName('fanim');
  function faTick(now) {
    if (!faNodes.length) { faRaf = 0; return; }
    for (var i = 0; i < faNodes.length; i++) {
      var n = faNodes[i], f = String(A.fairyFrameAt(n.dataset.fa, n._faSpeed ? now * n._faSpeed : now));
      if (n.dataset.f !== f) n.dataset.f = f;
      if (n._faNext == null) n._faNext = now + A.fairyBlinkGap();
      var b = now >= n._faNext ? A.fairyBlinkAt(now - n._faNext) : 0;
      if (now >= n._faNext + 180) { n._faNext = now + A.fairyBlinkGap(); b = 0; }
      if (n.dataset.b !== String(b)) n.dataset.b = String(b);
    }
    faRaf = requestAnimationFrame(faTick);
  }
  function faKick() { if (!REDUCED && !faRaf && faNodes.length) faRaf = requestAnimationFrame(faTick); }
  if (!REDUCED && window.MutationObserver) new MutationObserver(faKick).observe(document.documentElement, { childList: true, subtree: true });
  faEnsure('fairy'); // she is on the title screen: start loading her layers right away
  function crestHtml(small) { return '<span class="crest' + (small ? ' sm' : '') + '"><img src="' + esc(A.crest(actNo() >= 3)) + '" alt=""><b>' + T('ui.name.leader') + '</b></span>'; }
  function initialHtml(n) { return '<span class="initial">' + esc(String(n || '?').charAt(0)) + '</span>'; }

  // ---------- who looks like what ----------
  function corruptUnit(id) { return bUnits().filter(function (u) { return u.side !== 'ally' && (u.id === id || u.advisorId === id) && u.corruption; })[0]; }
  // batch6 H2-12 / H2-15: from L10 on (she has walked over to the other side: the fight, her death, the endings) the advisor wears her enemy clothes
  function advisorIsBoss() { return !!view && (view.storyId === 'finalReveal' || A.advisorTurned(view) || bUnits().some(function (u) { return u.id === 'advisor-boss' || u.advisorId; })); }
  function variantFor(id, l) {
    var e = (l && l.expr) || '';
    if ((l && l.kind === 'flashback') || /-flash$/.test(e)) return 'flash';
    var m = /^(vengeful|possessed)/.exec(e); if (m) return m[1];
    if (view && view.storyId === 'rejectedDefeat' && A.isCandidate(id)) return 'vengeful'; // G1 #7: the beaten rejected girl stays in her grudge form for every line
    var u = corruptUnit(id); if (u) return u.corruption;
    if (A.isAdvisor(id) && (e === 'boss' || advisorIsBoss())) return 'boss';
    if (id === 'leader' && actNo() >= 3) return 'worn';
    return 'base';
  }
  function faceList(id, expr, variant) {
    if (id === 'leader') return A.face('leader', expr || 'calm', { variant: variant });
    if (A.isCandidate(id) || A.isAdvisor(id) || A.isFairy(id)) return A.face(id, expr || 'calm', { variant: variant });
    return A.enemy(id);
  }
  function standList(id, variant) { return A.portrait(id, { variant: variant === 'flash' ? 'base' : variant }); }
  function isTurned(u) { return !!u && (u.turned || (u.side === 'ally' && !!u.corruption)); }
  // battle / prep card art for a unit or member
  function unitArt(u) {
    if (isLeader(u)) return { list: A.face('leader', u.side === 'enemy' ? 'calm' : actNo() >= 3 ? 'determined' : 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }), fb: crestHtml() };
    if (A.isFairy(u.id)) return { list: A.face(u.id, u.hp != null && u.maxHp && u.hp < u.maxHp / 3 ? 'upset' : 'happy'), fb: initialHtml(u.name) };
    if (u.side === 'ally' && isTurned(u)) return { list: A.face(u.id, 'calm'), fb: initialHtml(u.name) }; // §4.5 she broke free
    if (u.side === 'enemy' || u.corruption) {
      if (u.id === 'advisor-boss' || u.advisorId) { var aid = u.advisorId || (view.advisor && view.advisor.id); return { list: A.face(aid, 'special', { variant: 'boss' }), fb: initialHtml(u.name) }; }
      if (A.isCandidate(u.id)) {
        var cv = u.corruption || 'vengeful';
        return { list: A.face(u.id, cv === 'vengeful' ? (u.grudge === 'high' ? 'vengeful-rage' : 'vengeful-sneer') : 'possessed-grin', { variant: cv }), fb: initialHtml(u.name) };
      }
      return { list: A.enemy(u.id), fb: initialHtml(u.name) };
    }
    var m = member(u.id), mood = u.mood != null ? u.mood : m ? m.mood : 0;
    return { list: A.face(u.id, moodExpr(mood)), fb: initialHtml(u.name) };
  }

  // ---------- small parts ----------
  var ROLE_TIP = lazy(function () { return { tank: T('ui.role.tip.tank'), adc: T('ui.role.tip.adc'), healer: T('ui.role.tip.healer'), mage: T('ui.role.tip.mage'), rogue: T('ui.role.tip.rogue') }; });
  function roleBadge(role, cls) { var s = A.roleIcon(role); return s ? '<span class="role-badge ' + (cls || '') + '" data-tip="' + esc(ROLE_TIP()[role] ? T('ui.role.badgeTip', { role: ROLE_NAME()[role] || role, tip: ROLE_TIP()[role] }) : (ROLE_NAME()[role] || role)) + '"><img src="' + esc(s) + '" alt=""></span>' : ''; }
  function kwChips(list, max) { return (list || []).slice(0, max || 3).map(function (k) { return '<span class="chip" data-tip="' + esc(k.tip || '') + '">' + esc(k.label) + '</span>'; }).join(''); }
  // §B: 【行动】 what she does on her turn, 【加成】 what she does for the teammates beside her. Engine strings first;
  // until the engine has them, build the same sentences from the keyword ids.
  var WHEN_TXT = { always: 'ui.skill.when.always', 'on-hit': 'ui.skill.when.on-hit', 'on-kill': 'ui.skill.when.on-kill', 'on-heal': 'ui.skill.when.on-heal', 'on-guard': 'ui.skill.when.on-guard', 'low-hp': 'ui.skill.when.low-hp' }; // text keys
  var DIR_TXT = { next: 'ui.skill.dir.next', prev: 'ui.skill.dir.prev', both: 'ui.skill.dir.both' }; // text keys
  function abilityOf(o) {
    if (!o) return { action: '', bonus: null };
    if (o.actionText !== undefined || o.bonusText !== undefined) return { action: o.actionText || '', bonus: o.bonusText || null };
    var kw = o.keywords || [], get = function (p) { var k = kw.filter(function (x) { return String(x.id).indexOf(p + ':') === 0; })[0]; return k ? String(k.id).slice(p.length + 1) : null; };
    var sk = kw.filter(function (x) { return String(x.id).indexOf('skill:') === 0; })[0], dir = get('dir'), when = get('when');
    var pct = (kw.filter(function (x) { return x.id === 'chance'; })[0] || {}).label;
    if (!pct && o.combo && o.combo.chance != null) pct = Math.round(o.combo.chance * 100) + '%';
    if (!pct) { var wl = kw.filter(function (x) { return String(x.id).indexOf('when:') === 0; })[0], m = wl && /(\d+)%/.exec(wl.label); if (m) pct = m[1] + '%'; }
    if (!dir && o.combo) { dir = o.combo.direction; when = o.combo.when; }
    var action = sk ? sk.tip : o.skill && o.skill.text ? o.skill.text : '';
    var bonus = dir && DIR_TXT[dir] ? T(pct ? 'ui.skill.bonusLinePct' : 'ui.skill.bonusLine', { when: T(WHEN_TXT[when] || 'ui.skill.when.default'), pct: pct || '', dir: T(DIR_TXT[dir]) }) : null;
    return { action: action, bonus: bonus };
  }
  function rowsHtml(o) {
    var a = abilityOf(o);
    return '<div class="rows"><div class="r act"><span class="rk">' + T('ui.skill.row.action') + '</span><span class="rv">' + richText(a.action || '—') + '</span></div>' +
      '<div class="r bonus' + (a.bonus ? '' : ' none') + '"><span class="rk">' + T('ui.skill.row.bonus') + '</span><span class="rv">' + (a.bonus ? richText(a.bonus) : T('ui.common.none')) + '</span></div>' +
      (o.perkText ? '<div class="r perk"><span class="rk">' + T('ui.skill.row.perk') + '</span><span class="rv">' + richText(o.perkText) + '</span></div>' : '') + '</div>'; // DESIGN-skill-level §2
  }
  // a rich hover panel for a unit / member: name, numbers, rows, statuses
  function unitTip(u, side) {
    var name = isLeader(u) ? T('ui.name.leaderSelf') : u.name, st = statusChips(u.statuses, side);
    return '<div class="tt-h"><b>' + esc(name) + '</b>' + (u.role ? '<span class="dim">' + esc(ROLE_NAME()[u.role] || '') + '</span>' : '') +
      '<span class="num">' + IC.hp + ' ' + esc(u.hp != null && u.maxHp ? u.hp + '/' + u.maxHp : u.maxHp || u.hp) + '　' + IC.atk + ' ' + esc(u.atk) + '</span></div>' +
      rowsHtml(u) + (st ? '<div class="chips">' + st + '</div>' : '');
  }
  // statuses: buffs gold, debuffs dark + cracked; bond / corruption are already shown by the heart and the card frame
  var ST_HIDE = { debt: 1, 'bond-high': 1, 'bond-low': 1, vengeful: 1, 'vengeful-high': 1, 'vengeful-low': 1, possessed: 1 };
  var ST_BAD = { 'slow-start': 1, 'mood-low': 1, debuffed: 1, smoke: 1, clause: 1 };
  var ST_LABEL = lazy(function () { var o = {}; ['slow-start', 'formation', 'clause', 'luck', 'smoke', 'drum', 'mood-low', 'debuffed'].forEach(function (k) { o[k] = T('ui.status.label.' + k); }); return o; });
  var ST_GOOD = { tough: 1, shell: 1 };
  function kwStatus(id) { var K = DATA.keywords && DATA.keywords.status; return (K && K[id]) || null; } // 2026-11-14 发呆 (daze): keywords.json status label / tip
  function stObj(s) { if (typeof s !== 'string') return s; var k = kwStatus(s); return { id: s, label: ST_LABEL()[s] || (k && k.label) || s, tip: k && k.tip }; }
  function isBadStatus(s) { var o = stObj(s); return !!(o.dark || o.bad || ST_BAD[o.id] || (!ST_LABEL()[o.id] && !ST_HIDE[o.id] && o.id && !ST_GOOD[o.id])); }
  function hasBad(list) { return (list || []).some(function (s) { return !ST_HIDE[stObj(s).id] && isBadStatus(s); }); }
  function statusChips(list, side) {
    return (list || []).map(stObj).filter(function (o) { return !ST_HIDE[o.id] && !(side === 'enemy' && ST_BAD[o.id]) ; }).map(function (o) {
      return '<span class="chip' + (isBadStatus(o) ? ' bad' : ' buff') + '" data-tip="' + esc(o.tip || o.text || T(isBadStatus(o) ? 'ui.status.badTip' : 'ui.status.goodTip', { name: o.label || o.name || o.id })) + '">' + esc(o.label || o.name || o.id) + '</span>';
    }).join('');
  }
  // §E6 every badge says what it does
  function MOOD_TIP(v) { return T(v >= 2 ? 'ui.mood.tip.high' : v <= -2 ? 'ui.mood.tip.low' : 'ui.mood.tip.normal'); }
  function moodFace(m, id) {
    if (!m || m.mood == null || isLeader(m)) return '';
    return '<span class="mood-face" data-mood-of="' + esc(id || m.id) + '" data-tip="' + esc(T('ui.mood.faceTip', { word: m.moodLabel || moodWord(m.mood), tip: MOOD_TIP(m.mood) })) + '"><img src="' + esc(A.moodIcon(m.mood)) + '" alt=""></span>';
  }
  function bondMark(m) {
    if (!m || !m.bond) return '';
    return m.bond === 'high' ? '<span class="bond hi" data-tip="' + T('ui.bond.trustTip') + '">♥</span>' : '<span class="bond lo" data-tip="' + T('ui.bond.knotTip') + '">♡</span>';
  }
  function plate(text, cls) { return '<div class="plate ' + (cls || '') + '"><span class="plate-in"><span class="plate-t">' + text + '</span></span></div>'; }
  function levelText(v) { return v.level ? T('ui.level.no', { n: esc(v.level) }) + (v.levelTitle ? '<small>' + esc(v.levelTitle) + '</small>' : '') : T('ui.level.guild'); }
  function heading(title, sub, cls) { return '<div class="heading ' + (cls || '') + '"><h2><span class="hd-t">' + esc(title) + '</span></h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>'; }
  function bagChip(items, relics) {
    // §E14 relics (the bell) sit in the bag area but use no slot
    var rl = (relics || []).map(function (r) { var o = typeof r === 'string' ? { id: r } : r || {}, R = ((DATA.linesV2 || {}).relics || {})[o.id] || {};
      return '<span class="relic" data-tip="' + esc(T('ui.relic.tip', { name: o.name || R.name || T('ui.relic.unnamed'), text: o.text || R.text || T('ui.relic.unknownText') })) + '">' + pic(A.relicIcon(o.id), '', '', '<i class="key-g kg-bell"></i>') + '</span>'; }).join('');
    if ((!items || !items.length) && !rl) return '';
    return '<span class="bag-chip" data-tip="' + T('ui.bag.tip') + '">' + (items || []).map(function (it) { return '<img src="' + esc(A.itemIcon(it.itemId)) + '" alt="" data-tip="' + esc(it.name + '：' + it.text) + '">'; }).join('') + rl + '</span>';
  }
  function advisorChip(a) { // UI-CLEAN §2.1: only her face in the top bar; name, state and skill live in the tip
    if (!a) return '';
    var gone = !a.present, tip = T(gone ? 'ui.advisor.chipTipGone' : a.combat ? 'ui.advisor.chipTip' : 'ui.advisor.chipTipPlain', { name: a.name, skill: a.combat ? a.combat.name : '', text: a.combat ? a.combat.text : '' });
    return '<span class="adv-chip' + (gone ? ' gone' : '') + '" tabindex="0" data-tip="' + esc(tip) + '"><span class="ac-face">' + pic(A.face(a.id, gone ? 'sad' : 'calm'), '', a.name, initialHtml(a.name)) + '</span></span>';
  }

  // ---------- tooltip ----------
  function stagePt(el, ax, ay) { return A.elStagePt(el, ax, ay, stageEl); } // also right when the stage is turned (A.rectToStage)
  // data-tip = plain text; data-rich = escaped HTML (ability rows etc.). A rich tip above a card never covers the card's face:
  // it sits above the card, or below it when there is no room.
  var hoverEl = null, tipFor = null, tipPinned = false;
  function tipTarget(el) { var t = el && el.closest && el.closest('[data-tip], [data-rich]'); return t && (t.dataset.tip || t.dataset.rich) ? t : null; }
  function hideTip() { tipEl.hidden = true; tipFor = null; tipPinned = false; }
  // UI-CLEAN §5.2: one place shows a tip — hover, a tap on an info element, a long press on a button, keyboard focus
  function showTip(t) {
    if (!t || vnActive()) { hideTip(); return; }
    tipFor = t;
    var rich = !!t.dataset.rich;
    if (rich) tipEl.innerHTML = t.dataset.rich; else tipEl.textContent = fixWords(t.dataset.tip).replace(/\*\*/g, ''); // batch6 H2-17: plain tips drop the bold marks
    tipEl.classList.toggle('rich', rich); tipEl.classList.remove('tight'); tipEl.hidden = false;
    // 收尾 (DESIGN-skill-level): never leave the 1920×1080 stage — above if it fits, else below if it fits, else a tighter
    // layout on the roomier side, and as a last resort clamped inside the stage (it may then overlap the card)
    var p = stagePt(t, 0.5, 0), pb = stagePt(t, 0.5, 1).y, h0 = tipEl.offsetHeight || 60, M = 8;
    var fitsA = function (h) { return p.y - h - 16 >= 90; }, fitsB = function (h) { return pb + 12 + h <= STAGE_H - M; };
    var below = !fitsA(h0) && (fitsB(h0) || pb < STAGE_H / 2 && p.y - 16 < STAGE_H - pb);
    if (!fitsA(h0) && !fitsB(h0)) { tipEl.classList.add('tight'); h0 = tipEl.offsetHeight || h0; below = !fitsA(h0) && (fitsB(h0) || p.y < STAGE_H - pb); }
    var top = below ? pb + 12 : p.y - 12;
    if (below && top + h0 > STAGE_H - M) top = Math.max(M, STAGE_H - M - h0);
    if (!below && top - h0 < M) top = Math.min(STAGE_H - M, M + h0);
    tipEl.classList.toggle('below', below);
    var half = (tipEl.offsetWidth || 340) / 2 + 10;
    tipEl.style.left = Math.max(half, Math.min(STAGE_W - half, p.x)) + 'px'; tipEl.style.top = top + 'px';
  }
  document.addEventListener('mouseover', function (e) {
    var h = e.target.closest && e.target.closest('button:not(:disabled), .choice, .adv-pick, .bcard, .p-slot');
    if (h !== hoverEl) { hoverEl = h; if (h) cue('hover', null, 90); }
    if (tipPinned) return; // a tapped-open tip stays until the next tap
    var t = tipTarget(e.target); if (!t) { hideTip(); return; }
    if (t !== tipFor || tipEl.hidden) showTip(t);
  });
  // an info element (not a button / link / input, no data-act) opens its tip on a tap; a second tap or a tap elsewhere closes it
  function tipInfoOnly(t) { return !(t.matches('button, a, input, select, textarea, label, [data-act]') || t.closest('button, [data-act], .bcard, .p-slot, .choice')); } // cards are controls: a touch long press shows their tip
  document.addEventListener('click', function (e) {
    if (tipLongFired) { tipLongFired = false; e.preventDefault(); e.stopPropagation(); return; } // the long press only showed the tip
    var t = tipTarget(e.target);
    if (t && tipInfoOnly(t)) { if (tipPinned && tipFor === t) hideTip(); else { showTip(t); tipPinned = !tipEl.hidden; } return; }
    if (tipPinned) hideTip();
  }, true);
  // a button with a tip: a long press (450 ms) shows the tip and swallows the click (touch screens have no hover)
  var tipLong = null, tipLongFired = false;
  document.addEventListener('pointerdown', function (e) {
    clearTimeout(tipLong); tipLongFired = false;
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return; // a mouse has hover; a held mouse button never loses its click
    var t = tipTarget(e.target); if (!t || tipInfoOnly(t)) return;
    tipLong = setTimeout(function () { showTip(t); if (!tipEl.hidden) { tipPinned = true; tipLongFired = true; } }, 450);
  }, true);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { document.addEventListener(n, function () { clearTimeout(tipLong); }, true); });
  document.addEventListener('focusin', function (e) { var t = tipTarget(e.target); if (t && e.target.matches && e.target.matches(':focus-visible')) showTip(t); });
  document.addEventListener('focusout', function () { if (!tipPinned) hideTip(); });

  // ---------- dialogue: ONE queue for lines, markers and blocking effects ----------
  // say(lines, done): a line is the contract object { speaker, speakerId, name, text, expr } or a plain string (narration).
  // UI extras: tone, tag, onShow. sayFx(fn): a blocking effect fn(done, item); item.skip() is called on click.
  var vn = { q: [], cur: null, eff: null, typing: false, t: null, busy: false, cls: '' }; // vn.cls: screen-wide box placement (camp, epi-vn …)
  function normLine(l) {
    if (l == null) return null;
    if (typeof l === 'string') return l ? { speaker: 'narrator', text: l } : null;
    if (!l.text) return null;
    var o = {}; Object.keys(l).forEach(function (k) { o[k] = l[k]; }); return o;
  }
  function say(lines, done) { (lines || []).forEach(function (l) { var n = normLine(l); if (n) vn.q.push(n); }); if (done) vn.q.push({ marker: done }); kick(); }
  function sayFx(fn) { vn.q.push({ effect: fn }); kick(); }
  // UI-CLEAN §2.5a: drop the queued LINES up to the first marker and run it (= the talk was heard to the end). Effects are
  // never dropped (a blocking animation must still play); the line on screen is closed and the speaker un-highlighted.
  function vnSkipToMarker() {
    clearInterval(vn.t); vn.typing = false; vnEl.classList.remove('typing');
    var keep = [], it, mk = null;
    while ((it = vn.q.shift())) { if (it.marker) { mk = it; break; } if (it.effect) keep.push(it); }
    vn.q = keep.concat(vn.q);
    vn.cur = null; vnEl.hidden = true; vnEl.innerHTML = ''; document.body.classList.remove('vn-on'); if (ui.onSpeak) ui.onSpeak(undefined);
    if (mk) mk.marker();
    kick();
  }
  function sayP(lines) { return new Promise(function (r) { say(lines, r); }); }
  function kick() { if (!vn.cur && !vn.eff && !vn.busy) vnNext(); }
  function vnActive() { return !!(vn.cur || vn.eff || vn.q.length); }
  function vnClear() { clearInterval(vn.t); vn.q = []; vn.cur = null; vn.eff = null; vn.typing = false; vnEl.hidden = true; vnEl.innerHTML = ''; vn.cls = ''; document.body.classList.remove('vn-on'); cineEl.innerHTML = ''; cineEl.className = 'cine'; }
  function speakerId(l) {
    if (l.speakerId === 'narrator' || l.speakerId === 'gallery') return null;
    if (l.speakerId) return l.speakerId;
    if (!l.speaker || l.speaker === 'narrator' || l.speaker === 'gallery') return null;
    if (l.speaker === 'advisor') return view && view.advisor ? view.advisor.id : null;
    return l.speaker;
  }
  function vnNext() {
    clearInterval(vn.t); vn.typing = false; vnEl.classList.remove('typing');
    var it; vn.busy = true;
    try {
      while ((it = vn.q.shift())) {
        if (it.marker) { it.marker(); continue; }
        if (it.effect) {
          vn.cur = null; vn.eff = it; vnEl.hidden = true; document.body.classList.remove('vn-on');
          var self = it; vn.busy = false;
          it.effect(function () { if (vn.eff !== self) return; vn.eff = null; vnNext(); }, it);
          return;
        }
        break;
      }
    } finally { vn.busy = false; }
    vn.cur = it || null;
    if (!vn.cur) { vnEl.hidden = true; vnEl.innerHTML = ''; document.body.classList.remove('vn-on'); if (ui.onSpeak) ui.onSpeak(null); return; }
    showLine(vn.cur);
  }
  // §E7 masked-noble gallery speaker: a stand portrait (noble-a/b/c, picked by the line) above the box; a dark silhouette until delivered
  function nobleStand(l) {
    var t = String(l.text || ''), h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    var x = l.noble || ['a', 'b', 'c'][h % 3];
    return '<div class="noble-stand n-' + x + '" aria-hidden="true">' + pic(A.noble(x), 'stand-img', '', '<span class="noble-sil"><i class="ns-mask"></i><i class="ns-grin"></i></span>') + '</div>';
  }
  function showLine(l) {
    var sid = speakerId(l), gallery = l.speaker === 'gallery', variant = sid ? variantFor(sid, l) : null;
    var name = l.name || (sid ? nameOf(sid) : gallery ? T('ui.dialog.galleryVoice') : '');
    if (NO_NAME[name]) name = ''; // 2026-11-14 结局去英文: never a 「narrator」 plate (a player's own Latin leader name stays)
    var face = sid ? '<div class="vn-face v-' + variant + '">' + pic(faceList(sid, l.expr, variant), '', name, sid === 'leader' ? crestHtml() : initialHtml(name)) + '</div>' : '';
    vnEl.innerHTML = '<div class="vn-box' + (sid ? ' has-face' : gallery ? ' gallery' : ' narration') + (l.kind === 'flashback' ? ' flashback' : '') + (variant && variant !== 'base' ? ' v-' + variant : '') + (l.tone ? ' tone-' + l.tone : '') + (l.mad ? ' tone-mad' : '') + '">' + face +
      '<div class="vn-body">' + (name ? '<div class="nameplate">' + esc(name) + (l.tag ? '<small>' + esc(l.tag) + '</small>' : '') + '</div>' : '') +
      '<div class="vn-text" id="vnText"></div><span class="vn-next" aria-hidden="true">▼</span></div></div>' + (gallery ? nobleStand(l) : '');
    vnEl.className = 'vn' + (l.vnClass ? ' ' + l.vnClass : vn.cls ? ' ' + vn.cls : '');
    vnEl.hidden = false; document.body.classList.add('vn-on');
    if (gallery) cue('gallery', null, 1500);
    if (ui.onSpeak) ui.onSpeak(sid, l);
    if (l.onShow) l.onShow(l);
    var el = $('vnText'), txt = fixWords(l.text), i = 0;
    if (REDUCED || txt.length < 2) { el.textContent = txt; return; }
    vn.typing = true; vnEl.classList.add('typing');
    vn.t = setInterval(function () { i += 2; el.textContent = txt.slice(0, i); cue('type', null, 90); if (i >= txt.length) { clearInterval(vn.t); vn.typing = false; vnEl.classList.remove('typing'); } }, 28);
  }
  function vnAdvance() {
    if (vn.eff) { if (vn.eff.skip) vn.eff.skip(); return true; }
    if (!vn.cur) { if (vn.q.length) { kick(); return true; } return false; }
    if (vn.typing) { clearInterval(vn.t); vn.typing = false; vnEl.classList.remove('typing'); var el = $('vnText'); if (el) el.textContent = vn.cur.text; return true; }
    cue('advance'); vnNext(); return true;
  }
  // A click ANYWHERE on the stage advances or finishes the dialogue (capture phase: nothing underneath fires).
  // Only explicitly marked controls (.vn-pass: home, battle speed/skip) still work while a line is up.
  stageEl.addEventListener('click', function (e) {
    if (!vnActive()) return;
    if (e.target.closest && e.target.closest('.vn-pass')) return;
    e.preventDefault(); e.stopPropagation(); vnAdvance();
  }, true);

  // ---------- blocking effects (oppressive transitions, mood drops, the sacrifice) ----------
  function stages(list) { // list of [fn, ms]; click skips to the next stage
    return function (done, it) {
      var i = -1, t = null;
      function next() { clearTimeout(t); i++; if (i >= list.length) { done(); return; } var s = list[i]; s[0](); t = setTimeout(next, REDUCED ? Math.min(s[1], 400) : s[1]); }
      it.skip = function () { if (list[i] && list[i][2] === 'noskip') return; next(); };
      next();
    };
  }
  function cine(cls, html) { cineEl.className = 'cine ' + cls; cineEl.innerHTML = html || ''; void cineEl.offsetWidth; }
  function cineOff() { cineEl.classList.add('out'); setTimeout(function () { if (cineEl.classList.contains('out')) { cineEl.className = 'cine'; cineEl.innerHTML = ''; } }, 900); }
  function darkFx(reason, nextView) {
    return stages([
      [function () { cue('darkTransition', { reason: reason }); cine('dark r-' + esc(reason || 'x'), '<div class="dk-vig"></div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 1500],
      [function () { cineEl.classList.add('hold'); if (nextView) applyTheme(nextView); }, 1500],
      [function () { cineOff(); }, 800]
    ]);
  }
  // feedback-1112 [20]: training lands as a full-screen card: her portrait, the training's name, the stat changes; ~2 s, a click skips
  function trainFx(ev, tr) {
    var id = ev.id, lead = isLeader(id), who = lead ? T('ui.name.leader') : (member(id) || {}).name || ev.name || nameOf(id);
    var ch = (ev.changes || []).filter(function (c) { return !(c.stat === 'mood' && lead); });
    var label = (tr && tr.label) || T('ui.train.defaultLabel'), stand = pic(A.portrait(lead ? 'leader' : id, { variant: lead && actNo() >= 3 ? 'worn' : 'base' }), 'stand-img', who, lead ? crestHtml() : initialHtml(who));
    var html = '<div class="tr-band"></div><div class="tr-stand">' + stand + '</div><div class="tr-text"><small class="tr-k">' + T(tr && tr.special ? 'ui.train.specialDone' : 'ui.train.done') + '</small>' +
      '<b class="tr-name">' + esc(label) + '</b><span class="tr-who">' + esc(who) + '</span><div class="tr-rows">' + ch.map(statRow).join('') + '</div></div>';
    return stages([[function () { cue('moodUp'); cine('train', html); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 2000], [function () { cineOff(); }, 300]]);
  }
  function moodFx(list0) { // [{id, delta, mood}]
    // feedback-1112 [26]: one face per girl: her changes are summed, the last mood wins; a net zero shows nothing
    var by = {}, list = [];
    list0.forEach(function (m) { var o = by[m.id]; if (!o) { o = by[m.id] = { id: m.id, name: m.name, delta: 0, mood: m.mood }; list.push(o); } o.delta += +m.delta || 0; if (m.mood != null) o.mood = m.mood; });
    list = list.filter(function (m) { return m.delta !== 0; });
    if (!list.length) return function (done) { done(); };
    var html = list.map(function (m) {
      var who = member(m.id) || { name: m.name || nameOf(m.id) };
      return '<div class="md-one' + (m.delta < 0 ? ' down' : ' up') + '"><span class="md-face">' + pic(A.face(m.id, m.delta < 0 ? 'sad' : 'happy'), '', who.name, initialHtml(who.name)) + '</span>' +
        '<b>' + esc(who.name) + '</b><span class="md-icon"><img src="' + esc(A.moodIcon(m.mood != null ? m.mood : 0)) + '" alt=""></span><span class="md-arrow">' + (m.delta < 0 ? '↓' : '↑') + '</span></div>';
    }).join('');
    var down = list.some(function (m) { return m.delta < 0; });
    return stages([[function () { cue(down ? 'moodDown' : 'moodUp'); cine('mood', '<div class="md-row">' + html + '</div>'); }, 1900], [function () { cineOff(); }, 300]]);
  }
  // the sacrifice: rain, the colour drains, the name is struck from the list, her slot stays empty for a beat
  function sacrificeFx(goneIds, prevParty, random) {
    var names = prevParty.filter(function (m) { return !isLeader(m); });
    var listHtml = '<div class="sc-list paper">' + names.map(function (m) { return '<div class="sc-name' + (goneIds.indexOf(m.id) >= 0 ? ' gone' : '') + '"><span>' + esc(m.name) + '</span><i></i></div>'; }).join('') + '</div>';
    var rowHtml = '<div class="sc-row">' + prevParty.map(function (m) {
      var g = goneIds.indexOf(m.id) >= 0;
      return '<div class="sc-slot' + (g ? ' empty' : '') + '">' + (g ? '<span class="sc-ghost">' + esc(m.name) + '</span>' : pic(isLeader(m) ? A.face('leader', 'sad', { variant: 'worn' }) : A.face(m.id, 'sad'), '', m.name, isLeader(m) ? crestHtml(true) : initialHtml(m.name))) + '</div>';
    }).join('') + '</div>';
    var bust = goneIds.length === 1 ? pic(A.portrait(goneIds[0]), 'sc-bust', '', '') : '';
    if (!random && goneIds.length === 1) { // v2.3 §E10: black → hold → her name written in ink → her portrait → a diagonal stroke through the name
      var gm = prevParty.filter(function (m) { return m.id === goneIds[0]; })[0] || { id: goneIds[0], name: nameOf(goneIds[0]) }, nm = String(gm.name || '');
      var swHtml = '<div class="sw-stage"><div class="sw-portrait">' + pic(A.portrait(gm.id), 'stand-img', '', '') + '</div><div class="sw-name"><span class="sw-ink">' +
        nm.split('').map(function (ch, i) { return '<b style="--i:' + i + '">' + esc(ch) + '</b>'; }).join('') + '</span><i class="sw-cut"></i></div></div>';
      return stages([
        [function () { var l = app.querySelector('.sac-left'); if (l) l.classList.add('gone'); setRain(2.2); cine('sac sw', ''); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 1700],
        [function () { cine('sac sw on write', swHtml); }, 1300 + 420 * nm.length],
        [function () { cineEl.classList.add('face'); }, 2600],
        [function () { cineEl.classList.add('cut'); cue('nameStrike'); }, 2600],
        [function () { cine('sac s3 on', rowHtml); }, 3000],
        [function () { setRain(1); cineOff(); }, 900]
      ]);
    }
    return stages([
      [function () { var l = app.querySelector('.sac-left'); if (l) l.classList.add('gone'); setRain(2.2); cine('sac s1' + (random ? ' random' : ''), random ? '<div class="sc-taken">' + pic(A.scene('taken'), 'sc-scene', '', '') + '</div>' : '<div class="sc-drain">' + bust + '</div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 3200],
      [function () { cine('sac s2 on', listHtml); }, 1000],
      [function () { cineEl.classList.add('strike'); cue('nameStrike'); }, 2600],
      [function () { cine('sac s3 on', rowHtml); }, 3000],
      [function () { setRain(1); cineOff(); }, 900]
    ]);
  }
  // feedback-1112 #15: once the name is confirmed the picker is gone for good (no clickable rows while anyone talks), and after the
  // sacrifice scene the screen belongs to the girl who was taken: her portrait alone in the middle while she says goodbye
  function sacLock() {
    app.classList.add('sac-farewell');
    ['.sac-panel', '.sac-actions', '.view-her', '.mem-frags'].forEach(function (s) { app.querySelectorAll(s).forEach(function (x) { x.remove(); }); });
  }
  function sacFarewellStage(ids) {
    sacLock();
    var l = app.querySelector('.sac-left'); if (!l || !ids || !ids.length) return;
    l.classList.remove('gone');
    l.innerHTML = '<div class="fw-busts n' + ids.length + '">' + ids.map(function (id) {
      return '<div class="fw-bust">' + pic(A.portrait(id), 'stand-img', nameOf(id), '') + '<b class="fw-name">' + esc(nameOf(id)) + '</b></div>';
    }).join('') + '</div>';
  }
  function withFarewell(fx, ids) { return function (done, it) { sacLock(); fx(function () { sacFarewellStage(ids); done(); }, it); }; }
  // §6 the self sacrifice: your own name is written in ink at the bottom of the list, then the gallery laughs
  function selfSacrificeFx(prevParty) {
    var me = prevParty.filter(isLeader)[0], myName = (me && me.name) || T('ui.name.leader');
    var listHtml = '<div class="sc-list paper ink">' + prevParty.filter(function (m) { return !isLeader(m); }).map(function (m) { return '<div class="sc-name"><span>' + esc(m.name) + '</span></div>'; }).join('') +
      '<div class="sc-name mine"><span class="ink-name">' + esc(myName).split('').map(function (c, i) { return '<b style="--i:' + i + '">' + c + '</b>'; }).join('') + '</span><em class="ink-blot"></em></div></div>';
    var laughs = TL('ui.selfSacrifice.laughs').map(function (t, i) {
      return '<span class="laugh" style="--x:' + [12, 70, 30, 82, 8, 22][i] + '%;--y:' + [18, 14, 72, 64, 48, 90][i] + '%;--d:' + (i * 0.22) + 's">' + t + '</span>'; }).join('');
    return stages([
      [function () { setRain(1.6); cine('sac s2 on selfsac', listHtml); }, 900],
      [function () { cineEl.classList.add('write'); cue('nameStrike'); }, 2600 + 260 * myName.length],
      [function () { cineEl.classList.add('laughing'); cineEl.insertAdjacentHTML('beforeend', '<div class="laughs">' + laughs + '</div>'); cue('gallery', null, 0); }, 2800],
      [function () { setRain(1); cineOff(); }, 900]
    ]);
  }
  // ---------- v2.3 §E5 stat previews + toast ----------
  var STAT_NAME = lazy(function () { return { atk: T('ui.stat.atk'), maxHp: T('ui.stat.maxHp'), hp: T('ui.stat.hp'), mood: T('ui.stat.mood'), skillLv: T('ui.stat.skillLv'), skillPower: T('ui.stat.skillLv') }; });
  var flyQ = [];
  function flyItems() { // v2.4 [20] the new item's icon flies into the bag chip, which pulses
    var q = flyQ; flyQ = []; var bag = app.querySelector('.topbar .bag-chip'); if (!bag || !q.length) return;
    q.forEach(function (id, i) {
      setTimeout(function () {
        var to = stagePt(bag, 1, 0.5), d = document.createElement('div'); d.className = 'item-fly'; d.innerHTML = '<img src="' + esc(A.itemIcon(id)) + '" alt="">';
        d.style.left = '960px'; d.style.top = '520px'; stageEl.appendChild(d); cue('item', null, 0);
        var dx = to.x - 960, dy = to.y - 520, done = function () { d.remove(); pulse(bag, 'bag-pulse', 900); };
        if (!d.animate || REDUCED) { done(); return; }
        d.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-50%) translate(' + (dx * 0.45) + 'px,' + (dy * 0.45 - 140) + 'px) scale(1.1)', opacity: 1, offset: 0.6 },
          { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(.45)', opacity: 0.9 }], { duration: 1100, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }).finished.then(done, done);
      }, 250 + i * 300);
    });
  }
  var STAT_GLYPH = { atk: 'power', maxHp: 'maxhp', hp: 'hp', mood: 'mood', skillLv: 'level', skillPower: 'level' };
  function statRow(c) {
    if (c.stat === 'skill') { // v2.4 [17]: only the part that changes, e.g. 「造成 2 → 3 点伤害」; the full texts as a fallback
      var unmark = function (x) { return String(x == null ? '' : x).replace(/\*\*/g, ''); }, sd = skillDiff(unmark(c.from), unmark(c.to)); // batch6 H2-17: diff the plain text
      if (sd) return '<span class="sp-row sp-skill short"><b>' + T('ui.skill.label') + '</b> ' + esc(sd.pre) + '<span class="sk-from">' + esc(sd.from) + '</span><span class="sk-arrow">→</span><span class="sk-to">' + esc(sd.to) + '</span>' + esc(sd.suf) + '</span>';
      return '<span class="sp-row sp-skill"><b>' + T('ui.skill.label') + '</b><span class="sk-from">' + richText(c.from) + '</span><span class="sk-to"><span class="sk-arrow">→</span>' + richText(c.to) + '</span></span>'; // user 2026-11-14: 「→ B」 on one line under A
    }
    var down = c.to < c.from, f = c.stat === 'mood' ? moodWord(c.from) || c.from : c.from, t = c.stat === 'mood' ? moodWord(c.to) || c.to : c.to;
    if (c.stat === 'skillLv') { f = 'Lv' + c.from; t = 'Lv' + c.to; } // DESIGN-skill-level: 「技能等级 Lv1 → Lv2」
    var g = STAT_GLYPH[c.stat] ? A.glyph(STAT_GLYPH[c.stat]) : ''; // 2026-11-14: icon + numbers, the word in the icon's tip
    return '<span class="sp-row' + (down ? ' down' : c.to > c.from ? ' up' : '') + '"><b>' + (g || esc(STAT_NAME()[c.stat] || c.stat)) + '</b> ' + esc(f) + ' → ' + esc(t) + '</span>';
  }
  function skillDiff(a, b) { // common prefix / suffix of the two action texts (bracketed formulas dropped), cut to the clause
    var strip = function (x) { return String(x || '').replace(/（[^（）]*）/g, '').replace(/\([^()]*\)/g, '').trim(); };
    a = strip(a); b = strip(b); if (!a || !b || a === b) return null;
    var i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    while (i > 0 && /[0-9]/.test(a[i - 1])) i--;
    var j = 0; while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    while (j > 0 && /[0-9]/.test(a[a.length - j])) j--;
    var from = a.slice(i, a.length - j).trim(), to = b.slice(i, b.length - j).trim();
    if (!from || !to || from.length > 12 || to.length > 12) return null;
    var pre = a.slice(0, i).split(/[，；。,;]/).pop(), suf = a.slice(a.length - j).split(/[，；。,;]/)[0];
    return { pre: pre, from: from, to: to, suf: suf };
  }
  // 2026-11-14 试玩 #6/#7: each change once — a 生命上限 change carries the current-生命 one along (show only the 上限 row), and
  // the same row twice (same stat, same from → to) is one row. Pure: A.statRows (tests/fb1114-ui.test.cjs)
  function previewHtml(list) { list = A.statRows(list); return list.length ? '<span class="stat-prev">' + list.map(statRow).join('') + '</span>' : ''; }
  function statToast(ev) {
    var ch = A.statRows((ev.changes || []).filter(function (c) { return !(c.stat === 'mood' && ev.id === 'leader'); })); if (!ch.length) return;
    var who = isLeader(ev.id) ? T('ui.name.you') : (member(ev.id) || {}).name || nameOf(ev.id);
    var d = document.createElement('div'); d.className = 'stat-toast';
    d.innerHTML = '<b class="st-who">' + esc(who) + '</b>' + ch.map(statRow).join('');
    var host = stageEl.querySelector('.toast-stack') || (function () { var h = document.createElement('div'); h.className = 'toast-stack'; stageEl.appendChild(h); return h; })();
    host.appendChild(d); setTimeout(function () { d.classList.add('out'); }, 2600); setTimeout(function () { d.remove(); }, 3200);
  }
  // ---------- v2.3 §E3 scene transitions: fade to black (~400 ms), swap + scene() music during the black, fade in (~500 ms) ----------
  var blackEl = null, fadeHold = 60;
  function blackOn() {
    if (!blackEl) { blackEl = document.createElement('div'); blackEl.className = 'scene-black'; stageEl.appendChild(blackEl); }
    void blackEl.offsetWidth; blackEl.classList.add('on');
  }
  function blackOffSoon() { var h = fadeHold; fadeHold = 60; if (blackEl && blackEl.classList.contains('on')) setTimeout(function () { blackEl.classList.remove('on'); }, REDUCED ? 0 : h); }
  function sceneChanged(pv, nv) { return !!pv && !!nv && (pv.phase !== nv.phase || (pv.storyId || null) !== (nv.storyId || null) || (pv.level || 0) !== (nv.level || 0)); }
  // §E15: entering L3 holds the black longer before the L3 story / battle intro
  function fadeFx(longHold) { return stages([[function () { fadeHold = longHold ? 1100 : 60; blackOn(); }, REDUCED ? 60 : 420]]); }
  // 2026-11-14 试玩 #5: toScene (scene intro / prep → battle): never through black — the old screen's content fades away over its
  // background, the battle screen fades in over the battle background (render swaps the bg), then the foes walk in (pre-enter)
  function fadeThen(fn, longHold, toScene) {
    app.classList.add('stale'); fadeHold = longHold ? 1100 : 60;
    if (toScene && !REDUCED) app.classList.add('scene-out'); else if (!toScene) blackOn();
    setTimeout(function () {
      app.classList.remove('stale', 'scene-out'); fn();
      if (toScene && !REDUCED) { app.classList.add('scene-in'); setTimeout(function () { app.classList.remove('scene-in'); }, 700); }
    }, REDUCED ? 60 : 420);
  }
  var SILENT = { card: 1, sacrifice: 1, pleased: 1, displeased: 1, phase: 1, chain: 1, end: 1 };
  function eventsToQueue(evs, nextView, opts) {
    var moods = [], skipDark = opts && opts.skipDark, trainEv = null;
    function flushMood() { if (moods.length) { sayFx(moodFx(moods)); moods = []; } }
    (evs || []).forEach(function (ev) {
      if (!ev) return;
      if (ev.kind === 'mood') { if (ev.id !== 'leader') moods.push(ev); return; } // v2.3 §A[25] the leader has no mood
      if (ev.kind === 'farewellEnd') { say([], function () { app.querySelectorAll('.fw-busts').forEach(function (x) { x.classList.add('gone'); }); }); return; } // feedback-1112 #15: her goodbye is over; the others react after
      if (SILENT[ev.kind] || ev.kind === 'cheat') return; // feedback-1112 [26]: a silent event doesn't split one mood screen into two
      if (ev.kind === 'train') { flushMood(); trainEv = ev; return; } // feedback-1112 [20]: shown by the full-screen training card
      if (ev.kind === 'statChange' && /^train:/.test(ev.source || '')) { sayFx(trainFx(ev, trainEv)); trainEv = null; flushMood(); return; }
      flushMood();
      if (trainEv) { var te0 = trainEv; trainEv = null; say([{ speaker: 'narrator', text: te0.text }]); } // no stat moved: the plain line
      if (ev.kind === 'statChange' && ev.source === 'rest') return; // 2026-11-13 休息回血提示: the rest summary below shows it
      if (ev.kind === 'rest') { sayFx(restFx(ev)); return; }
      if (ev.kind === 'advisorLeaves' && ev.turn) { // batch6 H2-12: she walks over — the line, then her clothes cross-fade to the enemy outfit with a glow, and a line says so
        var tl = normLine({ speaker: 'narrator', text: ev.text }); if (tl) say([tl]);
        sayFx(advisorTurnFx()); say([{ speaker: 'narrator', speakerId: 'narrator', name: '', text: T('ui.story.advisorDisrobe') }]); return;
      }
      if (ev.kind === 'sideEffect') return; // batch6 H2-3: no toast bubble over their heads after 认同 (the effect is already on the quote and on her panel).
      if (ev.kind === 'statChange') { say([], function () { statToast(ev); }); return; } // v2.3 §E5
      if (ev.kind === 'darkTransition') { if (!(opts && opts.inBattle) && !(skipDark && skipDark.indexOf(ev.reason) >= 0)) sayFx(darkFx(ev.reason, nextView)); return; } // 修复 2026-11-14: never a bare dark mid-battle
      if (ev.kind === 'item' && !ev.lost && ev.itemId) flyQ.push(ev.itemId); // v2.4 [20] flies into the bag once the next screen is up
      if (SILENT[ev.kind] || (ev.kind === 'item' && !ev.lost)) return;
      if (ev.kind === 'reveal') { say([{ speaker: 'narrator', text: ev.text, tag: ev.label }]); return; }
      if (ev.kind === 'line' && ev.key === 'campfire') return; // played by the campfire screen itself
      if (ev.kind === 'line' && nextView && nextView.phase === 'prep' && nextView.bell && /^bell/i.test(ev.key || '')) return; // played by the bell campfire
      if (ev.kind === 'cheat') return;
      // v2.4 [9]: the teamAssembled story plays the rollcall + rally itself; the level card plays once (in levelIntro, or here if that story was skipped)
      if (ev.kind === 'rollcall' || (ev.kind === 'line' && ev.key === 'leaderRally')) return;
      if (ev.kind === 'levelCard') { if (titleGate(ev.level, opts && opts.inBattle ? 'battleEvent' : 'event')) sayFx(levelCardFx(ev, ev.line && ev.line.text)); return; } // 第 2 关标题重复: one gate, saved in the run; never mid-round
      if (ev.kind === 'line' || ev.kind === 'flashback' || ev.text) {
        var l = normLine(ev.kind === 'line' || ev.speaker ? ev : { speaker: ev.id || 'narrator', text: ev.text, expr: ev.expr });
        if (l) {
          if (!l.speakerId) l.speakerId = speakerId(l); if (!l.name && l.speakerId) l.name = nameOf(l.speakerId);
          if (/^leave/.test(ev.key || '')) l.onShow = function () { cue('reject'); };
          if (ev.kind === 'flashback') l.onShow = function () { cue('flashback'); };
          say([l]);
        }
      }
    });
    flushMood();
    if (trainEv) say([{ speaker: 'narrator', text: trainEv.text }]);
  }

  // ---------- persistence + telemetry ----------
  function save() { if (!lsSet(KEY, run)) notice(T('ui.notice.saveFailed')); }
  function loadSave() { return lsGet(KEY, null); }
  function loadMeta() { var m = lsGet(MKEY, null); return m && typeof m === 'object' ? m : null; }
  // 2026-11-14 玩偶总账: the run being replaced (abandoned) books its dolls too — E.metaDolls is keyed by seed, so a run whose
  // ending was already booked (metaOnEnd) or a reload changes nothing. Writes MKEY only (one key per ?profile=).
  function dollsOnAbandon() {
    if (typeof E.metaDolls !== 'function') return;
    try { var old = run || loadSave(); if (!old || old.seed == null) return; var m = loadMeta() || {}; if (m.dollsSeed === old.seed) return; lsSet(MKEY, E.metaDolls(m, old)); } catch (e) { /* bookkeeping must never block a new run */ }
  }
  function newGame(opts) {
    dollsOnAbandon();
    if (PL) { try { var ab = run || loadSave(); if (ab && ab.seed != null) pl('abandon', ab.seed, E.view(DATA, ab)); } catch (e) { /* */ } } // 游玩记录: an unfinished run replaced = 放弃
    var seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, meta = loadMeta(); vnClear(); replayed = {};
    var nameIn = $('leaderName'), nm = String((nameIn && nameIn.value) || prefs.leaderName || '').trim().slice(0, 8);
    if (!nm) nm = randName(); prefs.leaderName = nm; lsSet(PKEY, prefs); // v2.4 [4]
    var co = { seed: seed, leaderName: nm, pickDifficulty: true }; if (meta) co.meta = meta; // v2.5: the fairy asks for a tier
    run = E.createRun(DATA, co);
    pl('runStart', { seed: seed, keysCheat: !!(opts && opts.keys) });
    if (opts && opts.keys) { try { run = E.act(DATA, run, { type: 'cheatKeys' }); pl('event', 'cheat', { what: 'keys' }); } catch (e) { notice(T('ui.cheat.keysUnsupported')); } }
    save(); newJourney(render);
  }
  // v2.4 [4] cute fantasy names for the leader
  var NAMES = lazy(function () { return TL('ui.leaderNames.random'); });
  function randName(not) { var L = NAMES(), n; do { n = L[Math.floor(Math.random() * L.length)]; } while (n === not && L.length > 1); return n; }
  // v2.4 [2] new game: fade to white, the caption, then fade into the guild
  var njPending = false;
  function newJourney(fn) {
    var d = document.createElement('div'); d.className = 'nj-white'; var nm = String(prefs.leaderName || '').trim(); d.innerHTML = '<span class="nj-cap">' + (nm ? '<b class="nj-hello">' + T('ui.newJourney.hello', { name: esc(nm) }) + '</b>' : '') + T('ui.newJourney.caption') + '</span>'; stageEl.appendChild(d); // 2026-11-14 user: greet the leader by name
    var TS = REDUCED ? 0.2 : 1; void d.offsetWidth; d.classList.add('on');
    setTimeout(function () { d.classList.add('cap'); }, 700 * TS);
    njPending = true;
    setTimeout(function () { if (njPending) fn(); d.classList.add('out'); }, 2600 * TS); // only if nothing rendered meanwhile: never re-render a live screen
    setTimeout(function () { d.remove(); }, 3700 * TS);
  }
  // §2: once per run, when it reaches ending / gameOver, fold its summary into the meta (E.metaUpdate is pure)
  function metaOnEnd(v) {
    if (!run || !v || (v.phase !== 'ending' && v.phase !== 'gameOver') || typeof E.metaUpdate !== 'function') return;
    var m = loadMeta() || {}; if (m.countedSeed === run.seed) return;
    var nm = null; try { nm = E.metaUpdate(m, v.summary || {}); } catch (e) { return; }
    if (!nm || typeof nm !== 'object') return;
    if (typeof E.metaDolls === 'function') { try { nm = E.metaDolls(nm, run); } catch (e) { /* 玩偶总账 is bookkeeping only */ } }
    nm.countedSeed = run.seed; lsSet(MKEY, nm);
    var tiers = E.DIFFICULTIES || []; // v2.5: a normal clear unlocks the next tier
    if (nm.unlocked > (m.unlocked || 0) && tiers[nm.unlocked]) setTimeout(function () { notice(T('ui.difficulty.unlocked', { name: tiers[nm.unlocked].name })); cue('confirm', null, 0); }, 1500);
  }
  function rankText(m) { try { return typeof E.rankOf === 'function' ? E.rankOf(m || {}).text : ''; } catch (e) { return ''; } }
  var tracker = {
    reset: function () { this.start = performance.now(); this.switches = 0; this.last = null; },
    touch: function (k) { if (this.last !== null && this.last !== k) this.switches++; this.last = k; },
    finish: function () { return { ms: Math.round(performance.now() - this.start), switches: this.switches }; }
  };
  tracker.reset();
  function recordTelemetry(action, prevRun) {
    var list = lsGet(TKEY, []), choice = {};
    Object.keys(action).forEach(function (k) { if (k !== 'meta' && k !== 'type') choice[k] = action[k]; });
    var entry = { seed: prevRun.seed, seq: (prevRun.history || []).length, level: prevRun.level, phase: prevRun.phase, type: action.type, choice: choice, ms: action.meta.ms, switches: action.meta.switches, at: Date.now(), stub: STUB };
    Object.keys(action.meta).forEach(function (k) { if (k !== 'ms' && k !== 'switches') entry[k] = action.meta[k]; });
    list.push(entry); if (list.length > 3000) list.splice(0, list.length - 3000); // 2026-11-14: bounded (it was read + written whole on every decision)
    if (!lsSet(TKEY, list)) notice(T('ui.notice.telemetryFailed'));
  }

  // ---------- act ----------
  // The next screen renders only after every pending line/effect of this action has played (contract: nothing jumps ahead).
  function doAct(action, decision, extraMeta, opts) {
    var ACT_CUE = { move: 'move', useItem: 'item', advisorSkill: 'advisorSkill' }; if (ACT_CUE[action.type]) cue(ACT_CUE[action.type], null, 0);
    if (decision) { action.meta = tracker.finish(); Object.keys(extraMeta || {}).forEach(function (k) { action.meta[k] = extraMeta[k]; }); }
    var prev = run, prevView = view;
    try { run = E.act(DATA, run, action); } catch (e) { pl('actFail', action, prevView, e && e.message); notice(T('ui.notice.actRejected', { error: e && e.message })); return false; }
    if (decision) recordTelemetry(action, prev);
    save();
    var nv = null; try { nv = E.view(DATA, run); } catch (e) { pl('act', action, prevView, null); render(); return true; }
    pl('act', action, prevView, nv); // 游玩记录: the action + key moments read from the new view (pure bookkeeping)
    // battle rounds animate on the battle screen itself (their events ride along in battle.lastRound)
    if (nv.battle && nv.battle.lastRound && (nv.phase === 'battle' || nv.phase === 'battleResult' || prevView.phase === 'battle' || prevView.phase === 'prep')) {
      if ((prevView.phase === 'prep' || prevView.phase === 'story') && nv.phase !== prevView.phase) fadeThen(render, false, true); else render(); // §E3 camp / scene intro → battle: fades to the battle scene (試玩 #5: not black)
      return true;
    }
    app.classList.add('stale'); hideTip();
    var pre = opts && opts.pre ? opts.pre(prevView, nv) : null;
    if (pre) sayFx(pre);
    view = nv; // speakers resolve against the new state (new members, the advisor) …
    eventsToQueue(nv.events, nv, { skipDark: pre ? (opts.skipDark || ['sacrifice', 'taken']) : null });
    view = prevView; // … but the old screen stays up until the queue is done
    var post = opts && opts.post ? opts.post(prevView, nv) : null; if (post) sayFx(post); // v2.4: an exit that plays after the action's lines
    if (sceneChanged(prevView, nv)) sayFx(fadeFx(nv.level === 3 && prevView.level !== 3)); // §E3 / §E15
    say([], function () { app.classList.remove('stale'); render(); });
    return true;
  }

  // ---------- theme + scene ----------
  var sceneNow = null, bgFront = bgA;
  function setScene(id) {
    if (sceneNow === id) return; sceneNow = id;
    var list = live(A.scene(id)), i = 0;
    (function tryOne() {
      if (sceneNow !== id) return;
      if (i >= list.length) { show(null); return; }
      var c = splitCand(list[i]), im = new Image();
      im.onload = function () { show(c.src, c.cls); };
      im.onerror = function () { BAD[c.src] = 1; i++; tryOne(); };
      im.src = c.src;
    })();
    function show(src, cls) {
      if (sceneNow !== id) return;
      var back = bgFront === bgA ? bgB : bgA;
      back.style.backgroundImage = src ? 'url("' + src + '")' : ''; back.classList.toggle('bg-fallback', !src); back.dataset.scene = id;
      back.classList.toggle('lores', /\blores\b/.test(cls || '')); // G1 #6: a low-res picture blown up to 1080p: soft blur + grain + vignette
      back.classList.toggle('cold', /\bcold\b/.test(cls || '')); // 修复 2026-11-13: the act-1 fire standing in for a crypt / night camp gets a cold tint
      var old = bgFront; back.classList.add('front'); old.classList.remove('front'); bgFront = back;
      // 2026-11-14 memory: once the cross-fade is over, the hidden layer lets go of its 1920×1080 picture (it was held until the next scene)
      clearTimeout(old._bgFree); old._bgFree = setTimeout(function () { if (old !== bgFront) { old.style.backgroundImage = ''; delete old.dataset.scene; } }, 1100);
    }
  }
  var RAIN_STORIES = { sacrificeIntro: 1, secondSacrificeIntro: 1, aftermath: 1, sacrificeRandomTaken: 1, sacrificeRandomTakenOne: 1 };
  function applyTheme(v) {
    var act = v ? v.act || 1 : 1, b = document.body;
    b.classList.remove('act-1', 'act-2', 'act-3'); b.classList.add('act-' + act);
    setScene(v ? A.sceneFor(v) : 'title');
    b.dataset.phase = v ? v.phase : 'title';
    b.dataset.story = v && v.storyId ? v.storyId : '';
    setRain(v && (v.phase === 'sacrifice' || (v.phase === 'story' && RAIN_STORIES[v.storyId])) ? 1 : 0);
    // §G: the music follows the phase / story (the audio worker maps ctx → track)
    var ph = v ? v.phase : 'title', out = v && v.summary ? v.summary.outcome : (v && v.battle && v.battle.win != null ? (v.battle.win ? 'victory' : 'defeat') : null);
    if (ui.audioHold) return; // a cinematic (the whiteout, the true ending) drives the music itself until it ends
    // v2.4 [16]: a battle's result music waits for the result panel (resultMusic), not for the last round's render
    if (ph === 'battle' || (ph === 'battleResult' && (hasPlayResult() || !resultPlayed[battleId(v)]))) out = null;
    sceneAudio({ phase: ph, act: act, level: v ? v.level || 0 : 0, storyId: ph !== 'gameOver' && v && v.storyId || null, battle: ph === 'battle' || ph === 'battleResult', outcome: ph === 'gameOver' ? 'defeat' : out || null, scene: v ? A.sceneFor(v) : 'title-fairy' });
  }

  // ---------- rain (canvas particles) ----------
  var rain = { level: 0, drops: [], splash: [], raf: 0, ctx: null };
  function setRain(level) {
    if ((level > 0) !== (rain.level > 0)) cue(level > 0 ? 'rainStart' : 'rainStop');
    rain.level = level; var cv = $('rain');
    if (!rain.ctx) rain.ctx = cv.getContext('2d');
    cv.classList.toggle('on', level > 0);
    if (level > 0 && !rain.raf && !REDUCED) rain.raf = requestAnimationFrame(rainTick);
  }
  function rainTick(now) {
    // 2026-11-14 perf: ~30 fps is plenty for rain (a full-stage canvas); the step scales with the time passed
    if (rain.level > 0 && rain.last && now - rain.last < 30) { rain.raf = requestAnimationFrame(rainTick); return; }
    var k = rain.last && now ? Math.min(3, (now - rain.last) / 16.7) : 1; rain.last = now || 0;
    var c = rain.ctx, want = Math.round(rain.level * 260);
    while (rain.drops.length < want) rain.drops.push({ x: Math.random() * 2100 - 90, y: Math.random() * -1080, v: 22 + Math.random() * 20, l: 20 + Math.random() * 34, a: 0.12 + Math.random() * 0.3 });
    if (rain.drops.length > want) rain.drops.length = want;
    c.clearRect(0, 0, STAGE_W, STAGE_H); c.lineWidth = 1.3;
    rain.drops.forEach(function (d) {
      d.y += d.v * k; d.x -= d.v * 0.18 * k;
      if (d.y > STAGE_H - Math.random() * 160) { if (Math.random() < 0.3) rain.splash.push({ x: d.x, y: d.y, r: 1, a: 0.35 }); d.y = -40 - Math.random() * 200; d.x = Math.random() * 2100 - 90; }
      c.strokeStyle = 'rgba(205,215,240,' + d.a + ')'; c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x + d.l * 0.18, d.y - d.l); c.stroke();
    });
    rain.splash = rain.splash.filter(function (s) { s.r += 1.4 * k; s.a -= 0.03 * k; if (s.a <= 0) return false; c.strokeStyle = 'rgba(205,215,240,' + s.a + ')'; c.beginPath(); c.ellipse(s.x, s.y, s.r * 2.2, s.r * 0.6, 0, 0, Math.PI * 2); c.stroke(); return true; });
    if (rain.level > 0) rain.raf = requestAnimationFrame(rainTick); else { rain.raf = 0; rain.last = 0; c.clearRect(0, 0, STAGE_W, STAGE_H); rain.drops = []; rain.splash = []; }
  }

  // ---------- frame ----------
  var anim = { token: 0, skip: false }, shownPhase = null, setupOpen = false; // setupOpen: UI-CLEAN §4 the 团长设定 screen (before createRun)
  function render() {
    clearTimers(); anim.token++; anim.skip = false; flushWaits(); fxLayer.innerHTML = ''; hideTip(); njPending = false;
    if (!run) { view = null; vnClear(); applyTheme(null); app.innerHTML = setupOpen ? setupHtml() : titleHtml(); pl('screen', setupOpen ? 'setup' : 'title', null); return; }
    try { view = E.view(DATA, run); } catch (e) { view = null; vnClear(); app.innerHTML = brokenHtml(e); pl('event', 'broken', { msg: String(e && e.message).slice(0, 300) }); return; }
    metaOnEnd(view);
    var key = (run.history || []).length + ':' + view.phase + ':' + (view.leaderStep || view.interviewStep || ''), entering = key !== screenKey;
    if (entering) { screenKey = key; ui = {}; tracker.reset(); }
    if (entering && PL) { var plS = PLM.snap(view); pl('screen', view.phase + (plS.st ? ':' + plS.st : ''), view); var plO = PLM.outcomeOf(view); if (plO) pl('runEnd', plO, view); } // 游玩记录: time per screen + the ending
    var sm = view.summary; // the whiteout / true-ending cinematic sets the music itself: don't start the stats track under it
    if (entering && view.phase === 'ending' && sm && (sm.outcome === 'true' || sm.whiteout) && !replayed['end:' + run.seed]) ui.audioHold = true;
    applyTheme(view);
    document.body.classList.toggle('tv-on', view.phase === 'story' && view.storyId === 'sacrificeIntro'); // feedback-1112 #12: old-TV broadcast, chrome hidden
    var name = view.phase;
    // a battle that just ended still owes its last round's animation
    if (name !== 'battle' && name !== 'battleResult' && shownPhase === 'battle' && view.battle && view.battle.lastRound && view.battle.lastRound.length && !replayed[(run.history || []).length]) name = 'battle';
    shownPhase = name;
    var s = SCREENS[name];
    app.className = 'screen-host phase-' + name;
    app.innerHTML = '<main class="screen screen-' + esc(name) + '">' + (s ? s.html(view) : '<div class="panel">' + T('ui.screen.unknownPhase', { phase: esc(view.phase) }) + '</div>') + '</main>' + topbar(view, s && s.plate ? s.plate(view) : null, s && s.topExtra ? s.topExtra(view) : '');
    if (s && s.after) s.after(view);
    if (entering && s && s.enter) s.enter(view);
    blackOffSoon(); // §E3: the new screen is up under the black → fade back in
    if (flyQ.length) flyItems();
  }
  // UI-CLEAN §2.0 (user: 方案 A): the top bar is only ☰; the item group (team / bag / advisor face / keys) only where it is used.
  // TOPBAR_PLATE = true switches to 方案 B (the level plate top-left, the difficulty in its tip).
  var TOPBAR_PLATE = false;
  function showItems(v) { return !!v && (v.phase === 'battle' || v.phase === 'reward' || v.phase === 'debuff' || (v.phase === 'prep' && !v.bell)); }
  function topbar(v, custom, extra) {
    var items = showItems(v), pl8 = '';
    if (TOPBAR_PLATE) pl8 = '<span class="tb-plate"' + (v.difficulty ? ' data-tip="' + esc(T('ui.topbar.difficultyTip') + ' ' + T('ui.topbar.difficulty', { name: v.difficulty.name })) + '"' : '') + '>' + (custom != null ? custom : plate(levelText(v))) + '</span>';
    return '<header class="topbar">' + pl8 + '<span class="spacer"></span>' +
      (items ? teamBtn(v) + bagChip(v.items, v.relics || (v.run && v.run.relics)) + advisorChip(v.advisor) : '') + (items || v.bell ? keysChip(v.keys) : '') +
      (extra || '') + menuBtn() + '</header>';
  }
  // ---------- ☰ menu (UI-CLEAN §3): one button in the same top-right spot on every screen, one panel in #modal ----------
  function menuBtn(cls) { return '<button class="btn-icon menu-btn vn-pass' + (cls ? ' ' + cls : '') + '" data-act="menu" aria-label="' + T('ui.menu.label') + '">☰</button>'; }
  var menuTab = ''; // ☰: which group tab is open, by its text key (kept while the page lives; the tab list differs title vs run, so not an index)
  function mnGroup(key, body, cls) { return body ? '<section class="mn-group' + (cls ? ' ' + cls : '') + '"><h3>' + T(key) + '</h3><div class="mn-body">' + body + '</div></section>' : ''; }
  function menuHtml() {
    var v = run ? view : null, m = !!au('isMuted'), vol = au('getVolume') || { music: 0.35, sfx: 0.5 }, rk = rankText(loadMeta());
    var head = v ? '<div class="mn-head"><span class="mn-chip">' + (v.level ? T('ui.level.no', { n: esc(v.level) }) : T('ui.level.guild')) + '</span>' +
      (v.difficulty ? '<span class="mn-chip">' + T('ui.topbar.difficulty', { name: esc(v.difficulty.name) }) + '</span>' : '') +
      (rk ? '<span class="mn-chip">' + T('ui.title.rank') + ' <b>' + esc(rk) + '</b></span>' : '') + keysChip(v.keys) + '</div>' : '';
    var team = v && (v.party || []).length ? '<button class="btn btn-secondary" data-act="viewTeam">' + T('ui.team.view') + '</button>' : '';
    var sound = '<label class="mn-row"><input type="checkbox" data-snd="mute"' + (m ? ' checked' : '') + '> ' + T('ui.sound.mute') + '</label>' +
      '<label class="mn-row"><span class="mn-k">' + T('ui.sound.music') + '</span><input type="range" min="0" max="100" value="' + Math.round(vol.music * 100) + '" data-snd="music"></label>' +
      '<label class="mn-row"><span class="mn-k">' + T('ui.sound.sfx') + '</span><input type="range" min="0" max="100" value="' + Math.round(vol.sfx * 100) + '" data-snd="sfx"></label>';
    var game = '<div class="mn-row"><span class="mn-k">' + T('ui.menu.speed') + '</span>' + [1, 2, 3].map(function (n) { return '<button class="pill-btn' + (prefs.speed === n ? ' on' : '') + '" data-act="speed" data-s="' + n + '">×' + n + '</button>'; }).join('') + '</div>' +
      '<label class="mn-row"><input type="checkbox" data-pref="autoCont"' + (prefs.autoCont ? ' checked' : '') + '> ' + T('ui.menu.autoCont') + '</label><p class="mn-note">' + T('ui.menu.autoContNote') + '</p>' +
      (run ? '' : '<div class="mn-row"><button class="btn btn-secondary" data-act="replayIntro">' + T('ui.title.replayIntro') + '</button></div>') +
      (window.CHOOSER_FGUIDE ? '<div class="mn-row"><button class="btn btn-secondary" data-act="fguide">' + T('ui.fguide.menu') + '</button></div>' : ''); // 布阵教学: reopen the pages
    var log = (PL ? '<div class="mn-row"><button class="btn btn-secondary" data-act="plExport">' + T('ui.playlog.export') + '</button>' +
      '<button class="btn btn-secondary" data-act="plCopy" data-tip="' + T('ui.playlog.copyTip') + '">' + T('ui.playlog.copy') + '</button></div>' : '') + '<p class="mn-note">' + T('ui.title.localOnly') + '</p>';
    var lang = '<div class="mn-row"><button class="pill-btn on" disabled>' + T('ui.menu.lang.zh') + '</button><span class="mn-note">' + T('ui.menu.lang.soon') + '</span></div>';
    var home = run ? '<div class="mn-row"><button class="btn btn-secondary" data-act="menuHome">' + T('ui.menu.home') + '</button></div>' : '';
    var cheat = NOCHEAT ? '' : (!run ? '<button class="btn-ghost cheat-keys" data-act="newKeys" data-tip="' + T('ui.title.newKeysTip') + '">' + T('ui.title.newKeys') + '</button>' :
      cheatKeysBtn(v) + cheatBtn(v) + cheatLostBtn()) + // cheatLostBtn: only when the engine can re-score this lost battle
      (STUB ? '<p class="mn-note" data-tip="' + (realOK ? '?stub=1' : T('ui.topbar.stubTip')) + '">' + T('ui.title.devStub') + (realOK ? '' : T('ui.title.devStubNotV2')) + '</p>' : '') +
      (PROFILE ? '<p class="mn-note">' + T('ui.topbar.profile', { name: esc(PROFILE) }) + '</p>' : '');
    // 2026-11-14 user: left side = the group tabs, right side = one group's content (a single tall column overflowed the stage)
    var gs = [['ui.menu.group.team', team], ['ui.menu.group.sound', sound], ['ui.menu.group.game', game], ['ui.menu.group.log', log], ['ui.menu.group.lang', lang], ['ui.menu.group.cheat', cheat, 'mn-cheat']].filter(function (g) { return g[1]; });
    var on = Math.max(0, gs.map(function (g) { return g[0]; }).indexOf(menuTab));
    var tabs = gs.map(function (g, i) { return '<button class="mn-tab' + (i === on ? ' on' : '') + (g[2] ? ' ' + g[2] : '') + '" data-act="menuTab" data-i="' + i + '" data-k="' + g[0] + '">' + T(g[0]) + '</button>'; }).join('');
    var pages = gs.map(function (g, i) { return '<div class="mn-page" data-i="' + i + '"' + (i === on ? '' : ' hidden') + '>' + mnGroup(g[0], g[1], g[2]) + '</div>'; }).join('');
    return '<h2>' + T('ui.menu.title') + '</h2>' + head + '<div class="mn-split"><nav class="mn-side">' + tabs + '<span class="spacer"></span>' + home +
      '<button class="btn btn-primary" data-act="modalCancel">' + T('ui.common.close') + '</button></nav><div class="mn-main">' + pages + '</div></div>';
  }
  function openMenu() { hideTip(); modal(menuHtml()); modalEl.classList.add('vn-pass', 'menu-open'); var p = modalEl.querySelector('.panel'); if (p) p.classList.add('menu-panel'); }
  // v2.4 [10] 查看队伍 on every choice screen (reward, debuff, the campfire choice / explore / train)
  function teamBtn(v) {
    if (!v || !(v.party || []).length) return '';
    var on = v.phase === 'reward' || v.phase === 'debuff' || (v.phase === 'prep' && campStep(v) !== 'done' && !v.bell);
    return on ? '<button class="btn-ghost team-btn" data-act="viewTeam" data-tip="' + T('ui.team.viewTip') + '">' + T('ui.team.view') + '</button>' : '';
  }
  function teamModalHtml() {
    var ps = party(), n = ps.length;
    return '<h2 class="tm-title">' + T('ui.team.title') + '</h2><div class="lane team-lane">' + ps.map(function (m, i) { return memberCard(m, i, n, {}); }).join('') + '</div>' +
      '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.close') + '</button></div>';
  }
  // ===== v36 (试玩者 1) 角色面板: one unit's sheet — face, name, role, 生命 / 威力 / 护甲, skill + level + text, mood, keepsakes,
  // statuses, 加成 (连携). Opened by the ⓘ on any unit card (formation, campfire, battle, 查看队伍), by a plain click on a card where a
  // click means nothing else (formation, battle outside 道具 / 换位, 查看队伍), or a right-click on any card. Esc / a click outside closes.
  function infoBtn(uid, id) { return '<button class="uc-info" data-act="unitInfo"' + (uid != null ? ' data-u="' + esc(uid) + '"' : '') + ' data-id="' + esc(id) + '" aria-label="' + esc(T('ui.unit.info')) + '" data-tip="' + esc(T('ui.unit.infoTip')) + '">i</button>'; }
  function panelUnit(uid, id) { // the battle unit (uid) when in a fight, else the party member (id)
    var bu = uid != null ? bUnits().filter(function (u) { return u.uid === uid; })[0] : null;
    if (!bu && view && view.phase === 'battle') bu = bUnits().filter(function (u) { return u.id === id; })[0];
    if (bu) return { u: bu, side: bu.side === 'enemy' ? 'enemy' : 'ally', member: bu.side === 'enemy' ? null : member(bu.id), field: ui.field && ui.field[bu.uid] };
    var m = member(id); return m ? { u: m, side: 'ally', member: m, field: null } : null;
  }
  function unitPanelHtml(p) {
    var M = A.unitPanelModel(p.u, p.side, { member: p.member, field: p.field, cards: (DATA.cards && DATA.cards.rewards) || [] });
    var ally = M.side === 'ally', art = unitArt(p.u), lead = isLeader(p.u), name = lead ? (M.name && M.name !== T('ui.name.leader') ? M.name : T('ui.name.you')) : M.name || T('ui.name.you');
    var stat = function (g, k, v, cls) { return '<span class="up-stat' + (cls ? ' ' + cls : '') + '">' + g + '<span class="up-k">' + T(k) + '</span><b>' + esc(v) + '</b></span>'; };
    var stats = stat(A.glyph('hp'), 'ui.unit.hp', M.hp != null && M.maxHp != null ? M.hp + ' / ' + M.maxHp : M.maxHp != null ? M.maxHp : '?') + stat(IC.atk, 'ui.unit.power', M.atk != null ? M.atk : '?') +
      (M.block > 0 ? stat(A.glyph('block'), 'ui.unit.block', M.block) : '') + (M.openBlock > 0 ? stat(A.glyph('block'), 'ui.unit.openBlock', M.openBlock) : '') +
      (ally && M.mood != null && !lead ? '<span class="up-stat" data-tip="' + esc(MOOD_TIP(M.mood)) + '"><img class="up-mood" src="' + esc(A.moodIcon(M.mood)) + '" alt=""><span class="up-k">' + T('ui.unit.mood') + '</span><b>' + esc(M.moodLabel || moodWord(M.mood)) + '</b></span>' : '');
    var sec = function (k, body, cls) { return '<div class="up-sec' + (cls ? ' ' + cls : '') + '"><h3>' + T(k) + '</h3>' + body + '</div>'; };
    var skill = sec(ally ? 'ui.unit.skill' : 'ui.unit.pattern', '<p class="up-line"><b class="up-sk">' + esc(M.skillName || '—') + '</b>' + (M.skillLv ? '<span class="up-lv">' + A.glyph('level') + 'Lv' + esc(M.skillLv) + '</span>' : '') + '</p>' +
      (M.skillText ? '<p class="up-txt">' + richText(M.skillText) + '</p>' : '') + howLine(M, ally) + (M.perkText ? '<p class="up-txt up-perk">' + richText(M.perkText) + '</p>' : ''));
    var combo = ally || M.comboText ? sec('ui.unit.combo', M.comboText ? '<p class="up-line">' + (M.comboName ? '<b class="up-sk">' + esc(M.comboName) + '</b>' : '') + '</p><p class="up-txt">' + richText(M.comboText) + '</p>' : '<p class="up-txt dim">' + T('ui.common.none') + '</p>') : '';
    var keeps = ally ? sec('ui.unit.keepsakes', M.keepsakes.length ? M.keepsakes.map(function (k) { return '<p class="up-txt"><b class="up-sk">' + esc(k.name) + '</b>' + (k.text ? '：' + richText(k.text) : '') + '</p>'; }).join('') : '<p class="up-txt dim">' + T('ui.common.none') + '</p>') : '';
    var st = statusChips(M.statuses, M.side); // an enemy's hidden debuffs stay hidden (same filter as her card)
    var sts = sec('ui.unit.statuses', st ? '<div class="chips">' + st + '</div>' : '<p class="up-txt dim">' + T('ui.common.none') + '</p>');
    return '<div class="up-head"><div class="up-face">' + pic(art.list, 'up-img', name, art.fb) + '</div><div class="up-id"><h2>' + esc(name) + '</h2>' +
      '<div class="up-role">' + (M.role ? roleBadge(M.role, 'up-rb') + '<span>' + esc(ROLE_NAME()[M.role] || M.role) + '</span>' : '<span>' + T(M.boss ? 'ui.unit.boss' : 'ui.unit.foe') + '</span>') + '</div>' +
      '<div class="up-stats">' + stats + '</div></div></div>' +
      '<div class="up-body">' + skill + combo + keeps + sts + '</div>' +
      '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.close') + '</button></div>';
  }
  // v39「结算看得懂」: 「怎么算」 under the skill — her current numbers in one line (RoundPlan.howCalc reads them off her skill
  // line), then the one rule every hit follows (护甲 first, then 生命). An enemy gets the rule only.
  function howLine(M, ally) {
    var h = ally ? RoundPlan.howCalc(M.skillKind, M.skillText) : null;
    return '<p class="up-txt up-how"><span class="up-k">' + T('ui.settle.how') + '</span>' + (h ? richText(h) + '<br>' : '') + '<span class="dim">' + richText(T('ui.settle.how.order')) + '</span></p>';
  }
  function openUnitPanel(uid, id) {
    var p = panelUnit(uid, id); if (!p) return false;
    hideTip(); modal(unitPanelHtml(p)); modalEl.classList.add('unit-open', 'vn-pass');
    var pn = modalEl.querySelector('.panel'); if (pn) pn.classList.add('unit-panel', p.side === 'enemy' ? 'is-foe' : 'is-ally');
    return true;
  }
  // a plain click on a card opens her panel only where a click on the card means nothing else
  function cardOpensPanel(card) {
    if (!card || card.dataset.act) return false;
    if (card.classList.contains('bcard')) return !!(view && view.phase === 'battle' && !(ui.mode && card.classList.contains('ally')));
    return !!card.closest('#formation, .team-lane');
  }
  // v2.2 §4: the three keys, small glyphs in the top bar, only once obtained; the tip is cryptic on purpose
  var KEY_GLYPH = [['refuse', 'quill', 'ui.keys.refuseTip'], ['rules', 'die', 'ui.keys.rulesTip'], ['bell', 'bell', 'ui.keys.bellTip']]; // [key, glyph, tip text key] // 2026-11-13: the three keys of the true route (self is no longer one)
  function keysChip(k) {
    if (!k) return '';
    var got = KEY_GLYPH.filter(function (g) { return k[g[0]]; });
    return got.length ? '<span class="keys-chip">' + got.map(function (g) { return '<span class="key-hit" tabindex="0" data-key="' + g[0] + '" data-tip="' + esc(T(g[2])) + '"><i class="key-g kg-' + g[1] + '"></i></span>'; }).join('') + '</span>' : '';
  }
  // playtest cheat (engine action cheatKeys): any phase of a run; ?nocheat=1 hides both cheats
  var cheatKeysBroken = false;
  function cheatKeysBtn(v) {
    if (NOCHEAT || cheatKeysBroken || !v || v.phase === 'ending' || v.phase === 'gameOver') return '';
    var k = v.keys || {}; if (k.refuse && k.rules && k.bell) return '';
    return '<button class="btn-ghost cheat-keys vn-pass" data-act="cheatKeys" data-tip="' + T('ui.cheat.keysTip') + '">' + T('ui.cheat.keys') + '</button>';
  }
  // playtest cheat (engine action cheatWin): prep + battle only; ?nocheat=1 hides it; hidden for good if the engine refuses it
  var cheatBroken = false;
  function cheatBtn(v) {
    if (NOCHEAT || cheatBroken || !v || (v.phase !== 'prep' && v.phase !== 'battle')) return '';
    return '<button class="btn-ghost cheat-keys vn-pass" data-act="cheat">' + T('ui.cheat.win') + '</button>';
  }
  // UI-CLEAN §2.2: the title is the logo, the fairy, 继续冒险 (with a save) / 开始冒险 and ☰ — nothing else
  function titleHtml() {
    var s = loadSave(), btns = [];
    if (s) btns.push('<button class="btn btn-primary btn-lg" data-act="continue">' + T('ui.title.continue') + '</button>');
    btns.push('<button class="btn btn-lg ' + (s ? 'btn-secondary' : 'btn-primary') + '" data-act="new">' + T('ui.title.start') + '</button>');
    btns.push('<button class="btn btn-lg btn-secondary" data-act="menu">' + T('ui.title.options') + '</button>'); // 2026-11-14 user: 选项 sits under 开始冒险 on the title (no corner ☰ here)
    return '<div class="title">' + '<button class="title-fairy" data-act="fairyPoke" aria-label="' + T('ui.name.fairy') + '"' + (tfOff && (tfOff.x || tfOff.y) ? ' style="transform:translate(' + tfOff.x + 'px,' + tfOff.y + 'px)"' : '') + '><span class="tf-bob"><span class="tf-tilt"><span class="tf-form tf-n">' + fairyPic('fairy', 'stand-img', T('ui.name.fairy')) + '</span><span class="tf-form tf-d" aria-hidden="true">' + fairyPic('fairy-demon', 'stand-img', '') + '</span></span></span><span class="tf-hit"></span></button>' +
      '<div class="title-logo"><h1 class="logo"><span class="l1">' + T('ui.title.logo1') + '</span><span class="l2">' + T('ui.title.logo2') + '</span></h1></div>' +
      '<div class="title-menu"><div class="menu">' + btns.join('') + '</div></div>' + (BUILD_V ? '<div class="title-ver">' + esc(BUILD_V) + '</div>' : '') + '</div>';
  }
  // 2026-11-15 user: the build version sits in the title's bottom-left corner (read from this script's ?v= cache tag)
  var BUILD_V = (function () { try { var sc = document.querySelector('script[src*="app.js"]'), m = sc && /[?&]v=([^&]+)/.exec(sc.getAttribute('src')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } })();
  // UI-CLEAN §4: 团长设定 — a UI-only screen between the title and createRun (the name is in the run from the first line)
  function setupHtml() {
    return '<div class="title setup-screen">' + menuBtn('on-title') + '<div class="lg-stand">' + pic(A.portrait('leader'), 'stand-img', '', crestHtml()) + '</div>' +
      '<div class="setup-form panel">' + heading(T('ui.setup.title'), T('ui.setup.sub')) +
      '<label class="title-name" for="leaderName"><span class="tn-k">' + T('ui.setup.leaderName') + '</span><span class="tn-row"><input id="leaderName" maxlength="8" autocomplete="off" spellcheck="false" value="' + esc(prefs.leaderName || '') + '" placeholder="' + T('ui.setup.leaderNamePlaceholder') + '"><button class="tn-dice" data-act="randName" data-tip="' + T('ui.setup.randNameTip') + '" aria-label="' + T('ui.setup.randNameLabel') + '">🎲</button></span></label>' +
      '<div class="row setup-row"><button class="btn btn-secondary" data-act="setupBack">' + T('ui.setup.back') + '</button><button class="btn btn-primary btn-lg" data-act="setupGo">' + T('ui.setup.go') + '</button></div></div></div>';
  }
  function brokenHtml(e) {
    return '<div class="title"><div class="title-menu broken panel"><h2>' + T('ui.title.broken') + '</h2><p class="small dim">' + esc(e && e.message) + '</p>' +
      '<div class="row"><button class="btn btn-secondary" data-act="home">' + T('ui.topbar.homeTip') + '</button><button class="btn btn-primary" data-act="new">' + T('ui.title.brokenNew') + '</button></div></div></div>';
  }

  var SCREENS = {};

  // ---------- story: full-bleed scene, the speaker's cut-out stands in it, one line at a time ----------
  function standHtml(id) { return '<div class="stand-layer" id="stand"></div>'; }
  function standShow(id, l) {
    var el = $('stand'); if (!el) return;
    // F round 3: a masked-noble (gallery) line clears the stage — before, it fell into the 'dim' branch and the last
    // speaker (girl or leader) stayed on screen, greyed, behind the noble. A.standPlan holds the rule (node-tested).
    if (l && (l.speaker === 'gallery' || l.speakerId === 'gallery')) {
      var keys = Array.prototype.map.call(el.querySelectorAll('.stand'), function (s) { return s.dataset.k; }), plan = A.standPlan(keys, { gallery: true });
      el.querySelectorAll('.stand').forEach(function (s) { if (plan.gone.indexOf(s.dataset.k) >= 0) { s.classList.add('gone', 'noble-out'); setTimeout(function () { s.remove(); }, 500); } });
      return;
    }
    if (!id || (!A.isCandidate(id) && !A.isAdvisor(id) && !A.isFairy(id) && id !== 'leader')) { el.querySelectorAll('.stand').forEach(function (s) { s.classList.add('dim'); }); return; }
    var variant = variantFor(id, l), k = id + ':' + (variant === 'flash' ? 'base' : variant), cur = el.querySelector('.stand[data-k="' + k + '"]');
    var tf = !!(l && l.fx === 'transform'); // §6 the fairy turns: the old stand burns out white while the demon fades in
    el.querySelectorAll('.stand').forEach(function (s) { if (s !== cur) { s.classList.add(tf ? 'to-demon' : 'gone'); setTimeout(function () { s.remove(); }, tf ? 1700 : 500); } });
    var slip = A.isFairy(id) && l && l.expr === 'special';
    if (cur) { cur.classList.remove('dim'); cur.classList.toggle('slip', slip); return; }
    var side = id === 'leader' ? 'left' : A.isFairy(id) ? 'fairy' : A.isAdvisor(id) ? 'right' : (ui.standSide = ui.standSide === 'right' ? 'left' : 'right');
    var d = document.createElement('div'); d.className = 'stand at-' + side + ' v-' + variant + (A.isFairy(id) ? ' fairy-stand ' + id : '') + (tf ? ' transform-in' : '') + (slip ? ' slip' : ''); d.dataset.k = k;
    if (A.isFairy(id)) A.FAIRIES.forEach(faEnsure); // v9: the demon's layers load while the fairy talks, ready for the transform
    d.innerHTML = (A.isFairy(id) ? '<span class="fs-bob">' + fairyPic(id, 'stand-img', T('ui.name.fairy')) + '</span>' : pic(standList(id, variant), 'stand-img', '', '')) + (tf ? '<span class="halo-crack"></span>' : ''); el.appendChild(d);
  }
  // batch6 H2-12: the advisor's stand cross-fades from her guild clothes to her enemy outfit (a light sweep over the swap)
  function advisorTurnFx() {
    var id = (view && view.advisor && view.advisor.id) || (run && run.advisor);
    return stages([[function () {
      var el = $('stand'); if (!el || !id || !A.isAdvisor(id)) return;
      var old = el.querySelector('.stand[data-k^="' + sel(id) + ':"]');
      el.querySelectorAll('.stand').forEach(function (s) { if (s !== old) { s.classList.add('gone'); setTimeout(function () { s.remove(); }, 500); } });
      var d = document.createElement('div'); d.className = 'stand at-right v-boss adv-turn-in'; d.dataset.k = id + ':boss';
      d.innerHTML = pic(standList(id, 'boss'), 'stand-img', '', '') + '<span class="adv-turn-glow"></span>'; el.appendChild(d);
      if (old) { old.classList.remove('dim'); old.classList.add('adv-turn-out'); setTimeout(function () { old.remove(); }, REDUCED ? 300 : 1700); }
      cue('turncoat', null, 0);
    }, REDUCED ? 400 : 1800]]);
  }
  function flashWhite(ms, cls) { var d = document.createElement('div'); d.className = 'white-flash ' + (cls || ''); d.style.animationDuration = (REDUCED ? 300 : ms || 1400) + 'ms'; stageEl.appendChild(d); setTimeout(function () { d.remove(); }, (REDUCED ? 300 : ms || 1400) + 50); }
  // v2.4 [9] story items that are not lines: {kind:'rollcall', id, line} and {kind:'levelCard', level, title} (in view.lines, or in view.events)
  function storyItems(v) {
    var ls = (v.lines || (v.paragraphs || []).map(function (p) { return { speaker: 'narrator', text: p }; })).slice();
    if (Array.isArray(v.rollcall) && v.rollcall.length) { // real engine: view.rollcall + view.rally beside the advisor's lines
      ls = ls.concat(v.rollcall.map(function (r) { var o = {}; Object.keys(r).forEach(function (k) { o[k] = r[k]; }); o.kind = 'rollcall'; return o; }));
      ls = ls.concat((v.rally || []).map(function (l) { var o = normLine(l); if (o) { o.speaker = o.speaker || 'leader'; o.speakerId = o.speakerId || 'leader'; } return o; }).filter(Boolean));
    }
    var has = function (k) { return ls.some(function (l) { return l && l.kind === k; }); };
    var evs = (v.events || []).filter(function (e) { return e && (e.kind === 'rollcall' || e.kind === 'levelCard'); });
    var rc = evs.filter(function (e) { return e.kind === 'rollcall'; }), lc = evs.filter(function (e) { return e.kind === 'levelCard'; });
    if (rc.length && !has('rollcall')) { var at = 0; while (at < ls.length && !(ls[at] && (ls[at].speaker === 'leader' || ls[at].speakerId === 'leader'))) at++; if (at >= ls.length) at = Math.min(1, ls.length); ls.splice.apply(ls, [at, 0].concat(rc)); }
    if (lc.length && !has('levelCard')) ls = ls.concat(lc.slice(0, 1));
    if (v.levelCard && !has('levelCard') && !lc.length) ls.push({ kind: 'levelCard', level: v.levelCard.level || v.level, title: v.levelCard.title || v.levelTitle });
    if (v.storyId === 'levelIntro' && !ls.some(function (l) { return l && l.kind === 'levelCard'; })) ls.push({ kind: 'levelCard', level: v.level, title: v.levelTitle });
    return ls;
  }
  function rollcallLine(r) { var l = r.line, o = typeof l === 'string' ? { speaker: r.id, text: l } : l && l.text ? l : r.text ? { speaker: r.id, text: r.text } : null; o = normLine(o); if (!o) return null; o.speaker = o.speaker && o.speaker !== 'narrator' ? o.speaker : r.id; o.speakerId = o.speakerId || r.id; o.name = o.name || nameOf(r.id); if (!o.expr) o.expr = 'happy'; return o; }
  function lineupFx(id, i, n) {
    return stages([[function () {
      var lu = $('lineup'); if (!lu) return;
      var st = $('stand'); if (st) st.querySelectorAll('.stand').forEach(function (s) { s.classList.add('gone'); setTimeout(function () { s.remove(); }, 500); });
      var x = n <= 1 ? 50 : 12 + 76 * i / (n - 1);
      var d = document.createElement('div'); d.className = 'lu-girl' + (isLeader(id) ? ' lu-leader' : ''); d.dataset.id = id; d.style.left = x.toFixed(1) + '%'; d.style.zIndex = String(10 + i);
      d.innerHTML = pic(A.portrait(id), 'stand-img', nameOf(id), initialHtml(nameOf(id))) + '<span class="lu-name">' + esc(nameOf(id)) + '</span>';
      lu.appendChild(d); requestAnimationFrame(function () { d.classList.add('in'); }); cue('pick', null, 0);
    }, 650]]);
  }
  function leaderRallyFx() {
    return stages([[function () {
      var lu = $('lineup'); if (!lu || lu.querySelector('.lu-leader, [data-id="leader"]')) return;
      lu.classList.add('rally');
      var d = document.createElement('div'); d.className = 'lu-girl lu-leader'; d.dataset.id = 'leader'; d.style.left = '50%';
      d.innerHTML = pic(A.portrait('leader'), 'stand-img', nameOf('leader'), crestHtml()) + '<span class="lu-name">' + esc(nameOf('leader')) + '</span>';
      lu.appendChild(d); requestAnimationFrame(function () { d.classList.add('in'); });
    }, 700]]);
  }
  // G1 #4: the speakers' stands leave (the advisor's levelIntro stand used to stay behind the level card and show again under it)
  function standsOut() { var st = $('stand'); if (st) st.querySelectorAll('.stand').forEach(function (s) { s.classList.add('gone'); setTimeout(function () { s.remove(); }, 500); }); }
  // v2.4 [9] the level card: a full-screen transition page before every campfire
  // 第 2 关标题重复 (2026-11-13): the old in-memory map of shown cards is gone — it was lost on reload / 读档 while the engine's saved
  // lastEvents still carried the levelCard, and the battle intro band read it directly. Every title goes through titleGate.
  function titleGate(n, source) { var ok = A.titleGate(run, n || (view && view.level) || '', source); if (run) save(); return ok; }
  // batch6 H2-13: a level's title card is claimed when it is QUEUED, not when it starts playing. Before, the mark was set by the
  // card's first stage, so a second source (the story's own card + the engine's levelCard event handled by doAct and again by
  // battleFlow's leftover events) queued before the first one ran slipped through and the L10 title showed twice.
  function levelCardFx(lc, quote) {
    var n = lc.level || (view && view.level) || '', t = lc.title || (view && view.levelTitle) || '';
    return stages([
      [function () { standsOut(); cue('confirm', null, 0); cine('lvlcard', '<div class="lc-page"><span class="lc-rule"></span><small class="lc-no">' + T('ui.level.no', { n: esc(n) }) + '</small><b class="lc-title">' + esc(t) + '</b>' + (quote ? '<p class="lc-quote">「' + esc(quote) + '」</p>' : '') + '<span class="lc-rule"></span></div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 2600],
      [function () { cineEl.classList.add('out'); }, 700],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  // ---------- feedback-1112 包A: the gate slam (#7), the old-TV broadcast (#12), the black card after the sacrifice (#16) ----------
  function gateSlamFx(text) { // ① the door alone on screen, slams, the stage quakes ② a slow fade back to the scene
    return stages([
      [function () { // G1 #6: the old low-res gate picture (16:9 first), blown up full-screen and softened (blur + grain + vignette); the CSS door was too plain
        var bg = A.gateArt().map(function (c) { return 'url("' + esc(splitCand(c).src) + '")'; }).join(', ');
        cine('gate on', '<div class="gt-door gt-pic" style=\'background-image:' + bg + '\'><i class="gt-grain"></i><i class="gt-vig"></i></div><div class="gt-dust"></div><p class="gt-cap">' + esc(text || '') + '</p>'); }, 650],
      [function () { cineEl.classList.add('slam'); stageEl.classList.add('quake'); cue('bigHit', null, 0); setTimeout(function () { stageEl.classList.remove('quake'); }, 900); }, 1500],
      [function () { cineEl.classList.add('cap'); }, 2200],
      [function () { stageEl.classList.remove('quake'); cineEl.classList.add('fade'); }, 1500],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  function tvInFx() { // #12: black, then the picture comes up slowly
    return stages([
      [function () { cine('tvin on', ''); }, 1400],
      [function () { cineEl.classList.add('fade'); }, 1800],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  function typeInto(el, text, ms) { if (!el) return; var i = 0; clearInterval(el._ty); if (REDUCED) { el.textContent = text; return; } el._ty = setInterval(function () { i++; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(el._ty); }, ms); }
  function pathCardFx(lines) { // #16: white type on black — 「你选择了 xx。但是，路还是要往前走。」 → 「第二幕 · 墓穴之下」
    var a = (lines[0] && lines[0].text) || '', b = (lines[1] && lines[1].text) || '';
    return stages([
      [function () { cine('pathcard on', '<p class="pc-line" id="pcA"></p><p class="pc-act" id="pcB"></p>'); }, 700],
      [function () { typeInto($('pcA'), a, 110); }, 900 + 110 * a.length + 1400],
      [function () { var x = $('pcA'); if (x) { clearInterval(x._ty); x.textContent = a; x.classList.add('dim'); } typeInto($('pcB'), b, 160); cue('confirm', null, 0); }, 600 + 160 * b.length + 2000],
      [function () { var y = $('pcB'); if (y) { clearInterval(y._ty); y.textContent = b; } cineEl.classList.add('fade'); }, 1200],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  function titleCardFx(title) { // feedback-1113 #3: a full-screen black card in the 「第二幕 · 墓穴之下」 style, title only
    return stages([
      [function () { cine('pathcard on', '<p class="pc-act" id="pcB"></p>'); }, 600],
      [function () { typeInto($('pcB'), title, 160); cue('confirm', null, 0); }, 600 + 160 * title.length + 1800],
      [function () { var y = $('pcB'); if (y) { clearInterval(y._ty); y.textContent = title; } cineEl.classList.add('fade'); }, 1200],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  function sealChoiceHtml(v) { // #7: the leader's answer to the noble
    return '<div class="seal-choice" id="sealChoice" hidden>' + (v.sealOptions || []).map(function (o) {
      return '<button class="choice seal-opt so-' + esc(o.id) + '" data-act="sealPick" data-id="' + esc(o.id) + '" data-opt="seal:' + esc(o.id) + '">' + (A.grantsBell(o, 'seal') ? A.bellSvg('opt-bell') : '') + '<b>【' + esc(o.text) + '】</b>' + (o.note ? '<small>' + esc(o.note) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
  }
  // 2026-11-15 小门: the door at the side of the path after L10. One slot per key (view.door.slots, engine doorView); a lit
  // slot = a key the run holds. door.open: the slots light one by one, then 【打开小门】 (act openDoor). Otherwise an
  // ordinary door: the story's own continue walks on past.
  function sideDoorHtml(v) {
    var d = v.door; if (!d) return '';
    return '<div class="side-door' + (d.open ? ' sd-open' : ' sd-plain') + '" id="sideDoor" aria-label="' + esc(T('ui.door.label')) + '"><div class="sd-frame"><div class="sd-slots">' +
      (d.slots || []).map(function (s, i) {
        var tip = esc(T('ui.door.slot.' + s.key));
        return '<span class="sd-slot' + (s.got ? ' got' : '') + '" style="--i:' + i + '" tabindex="0" role="img" aria-label="' + tip + '" data-tip="' + tip + '">' + A.doorGlyph(s.key) + '</span>';
      }).join('') + '</div><i class="sd-ring" aria-hidden="true"></i></div>' +
      (d.open ? '<div class="sd-go" id="sideDoorGo" hidden><button class="btn btn-primary btn-lg" data-act="openDoor">' + T('ui.door.open') + '</button></div>' : '') + '</div>';
  }
  function sideDoorLight() { // the lit slots come on one by one (CSS delays), then the button
    var d = $('sideDoor'); if (!d) return;
    d.classList.add('lit');
    later(function () { var g = $('sideDoorGo'); if (g) { g.hidden = false; var b = g.querySelector('button'); if (b) b.focus({ preventScroll: true }); } }, REDUCED ? 0 : 2000);
  }
  SCREENS.story = {
    html: function (v) {
      return '<div class="cg"></div>' + (v.storyId === 'teamAssembled' ? standHtml().replace('stand-layer', 'stand-layer sl-lineup') + '<div class="lineup" id="lineup"></div>' : standHtml()) + // batch6 H2-4: the advisor's stand at the roll call is lineup-sized

        (v.storyId === 'sacrificeIntro' ? '<div class="tv-fx" aria-hidden="true"><i class="tv-scan"></i><i class="tv-vig"></i></div>' : '') + (v.sealOptions ? sealChoiceHtml(v) : '') + sideDoorHtml(v); // feedback-1112 #12 / #7 · 2026-11-15 小门
    },
    enter: function (v) {
      if (v.storyId === 'pathOn' || v.storyId === 'pathOnTaken') { sayFx(pathCardFx(v.lines || [])); say([], function () { doAct({ type: 'continue' }); }); return; } // feedback-1112 #16
      if (v.storyId === 'sacrificeIntro') sayFx(tvInFx()); // feedback-1112 #12
      if (v.storyId === 'interviewIntro') sayFx(titleCardFx(T('ui.interview.introCard'))); // feedback-1113 #3
      ui.onSpeak = function (id, l) {
        var lu = $('lineup'), g = lu && id ? lu.querySelector('.lu-girl[data-id="' + sel(id) + '"]') : null;
        if (lu) lu.querySelectorAll('.lu-girl').forEach(function (x) { x.classList.toggle('speaking', x === g); x.classList.toggle('dim', !!g && x !== g); });
        if (g) return;
        if (id !== undefined) standShow(id, l);
      };
      var items = storyItems(v), nRc = items.filter(function (l) { return l && l.kind === 'rollcall'; }).length, iRc = 0, lastText = '';
      items.forEach(function (l) {
        if (!l) return;
        if (l.kind === 'rollcall') { sayFx(lineupFx(l.id, iRc++, nRc)); var rl = rollcallLine(l); if (rl) say([rl]); return; }
        if (l.kind === 'levelCard') { if (titleGate(l.level || v.level, 'story')) sayFx(levelCardFx(l, '')); return; } // batch6 H2-13: was unguarded // feedback-1112 #33: the intro line was just said; the card does not repeat it
        if (l.fx === 'gateSlam') { sayFx(gateSlamFx(l.text)); return; } // feedback-1112 #7: its own screen, the text as its caption
        if (v.storyId === 'teamAssembled' && (l.speaker === 'leader' || l.speakerId === 'leader') && nRc) sayFx(leaderRallyFx());
        if (l.text && l.speaker !== 'narrator') lastText = l.text;
        var o = storyLine(l, v); if (o) say([o]);
      });
      if (v.storyId === 'trueEnding') { flashWhite(900, 'cut'); cue('turncoat', null, 0); } // the cabinet shatters: hard cut to the broken chamber
      if (v.storyId === 'trueDoor' || v.storyId === 'bellFollowed' || v.storyId === 'nobleChamber') later(function () { cue('bell', { act: actNo() }, 0); }, 400);
      var tail = [];
      if ((v.storyId === 'advisorLeaves' || v.storyId === 'throneAdvisor') && v.advisor && v.advisor.combat) tail.push({ speaker: 'narrator', text: T('ui.advisor.lostSkill', { name: v.advisor.combat.name }), tone: 'loss' });
      if (v.sealOptions) { say(tail, function () { var c = $('sealChoice'); if (c) { c.hidden = false; var b = c.querySelector('button'); if (b) b.focus({ preventScroll: true }); } }); return; } // feedback-1112 #7
      if (v.door && v.door.open) { say(tail, sideDoorLight); return; } // 2026-11-15 小门: the button opens it (act openDoor)
      if (v.door) { var sd = $('sideDoor'); if (sd) sd.classList.add('lit'); } // an ordinary door: what she holds glows faintly, then on past
      say(tail, function () { if (v.storyId === 'levelIntro') standsOut(); doAct({ type: 'continue' }); }); // G1 #4: no stand left over on the way into the level
    }
  };
  function storyLine(l, v) {
    var o = normLine(l); if (!o) return null;
    if (o.fx === 'transform') o.onShow = function (x) { cue('transform', null, 0); flashWhite(1500); if (!$('stand') || !$('stand').querySelector('.stand.fairy-demon')) standShow('fairy-demon', x); };
    if (o.fx === 'curse') o.onShow = function () { // feedback-1112 #7: the noble's curse — a dark-red flash, the stage shakes, the leader's hp halves
      cue('bigHit', null, 0); flashWhite(1100, 'curse'); stageEl.classList.add('quake'); setTimeout(function () { stageEl.classList.remove('quake'); }, 900);
      if (v.curse && v.curse.hpFrom != null) statToast({ id: 'leader', changes: [{ stat: 'hp', from: v.curse.hpFrom, to: v.curse.hpTo }] });
    };
    if (A.isFairy(speakerId(o) || '') && o.expr === 'special' && v.storyId === 'fairyWelcome') o.tone = 'slip'; // the slip of the tongue
    return o;
  }

  // ---------- opening: advisor → (advisor asks) → identity → class ----------
  function confirmBar(label, act, show) { return '<div class="confirm-bar" id="confirmBar"' + (show ? '' : ' hidden') + '><button class="btn btn-primary btn-lg" data-act="' + act + '">' + label + '</button></div>'; }
  // advisor pick: hovering (or picking) an advisor fades the heading out and shows her info in its place, never over her head
  function advInfoHtml(a) {
    if (!a) return '';
    var tagline = String(a.look || '').split(/[，,；;。]/)[0];
    var row = function (k, lab, cls) { return k ? '<div class="r ' + cls + '"><span class="rk">' + T('ui.advisor.row', { label: lab }) + '</span><span class="rv"><b>「' + esc(k.name) + '」</b>' + richText(k.text || '') + '</span></div>' : ''; };
    return '<div class="ai-name"><b>' + esc(a.name) + '</b><small>' + esc(tagline) + '</small></div><div class="rows">' + row(a.combat, T('ui.advisor.row.combat'), 'act') + row(a.flow, T('ui.advisor.row.flow'), 'bonus') + '</div>';
  }
  function advHover(id) {
    var head = $('advHead'), info = $('advInfo'); if (!head || !info || !view || !view.advisors) return;
    var showId = ui.advisor || id, a = view.advisors.filter(function (x) { return x.id === showId; })[0]; // v2.4 [3] once picked, hovering others changes nothing
    if (a && info.dataset.id !== a.id) { info.innerHTML = advInfoHtml(a); info.dataset.id = a.id; }
    head.classList.toggle('show', !!a);
  }
  // v2.5 difficulty: the fairy on the left asks; ten tiers on the right, locked ones refuse
  function dfSay(text, cls) {
    var b = $('dfBubble'); if (!b) return;
    b.classList.remove('pop', 'warn'); void b.offsetWidth; b.textContent = text; b.classList.add('pop'); if (cls) b.classList.add(cls);
  }
  // 2026-11-14 玩偶总账: now and then (A.dfDollsLine, ~30 %, UI Math.random — never the engine rng) she thanks you for the
  // **n** dolls 「之前送给小铃的」 instead of asking. Decided once per run (seed), so a re-render keeps the same line.
  var dfDolls = { seed: null, text: null };
  function dfAskHtml(D) {
    var sd = run ? run.seed : null;
    if (dfDolls.seed !== sd) dfDolls = { seed: sd, text: A.dfDollsLine(DATA.linesV2 && DATA.linesV2.fairy, loadMeta(), Math.random) };
    return dfDolls.text ? A.skillMarkup(esc(dfDolls.text)) : esc(D.ask.map(function (l) { return l.text; }).join(''));
  }
  function dfText(arr) { var l = (arr || [])[0]; return l ? (typeof l === 'string' ? l : l.text || '') : ''; }
  function dfStatus(t) { var b = A.dfBadge(t); return '<span class="df-st' + (b.cls ? ' ' + b.cls : '') + '">' + esc(b.text) + '</span>'; } // 2026-11-13: + 真结局 (glows)
  SCREENS.difficulty = {
    plate: function () { return plate(T('ui.difficulty.plate')); },
    html: function (v) {
      var D = v.difficulties, sel = ui.diff != null ? ui.diff : D.unlocked, cur = D.tiers[sel];
      ui.diff = sel;
      return '<div class="df-fairy"><span class="fs-bob">' + fairyPic('fairy', 'stand-img', T('ui.name.fairy')) + '</span></div>' +
        '<div class="df-bubble" id="dfBubble">' + dfAskHtml(D) + '</div>' +
        '<div class="df-side">' + heading(T('ui.difficulty.heading'), T('ui.difficulty.rank', { rank: D.rank.text })) +
        '<div class="df-grid">' + D.tiers.map(function (t) {
          return '<button class="df-tier t' + t.id + (t.locked ? ' locked' : '') + (t.cleared ? ' cleared' : '') + (t.trueEnd && !t.locked ? ' true-end' : '') + (t.id === sel ? ' sel' : '') + '" data-act="dfPick" data-id="' + t.id + '" data-opt="difficulty:' + t.id + '"' + (t.locked ? ' aria-disabled="true"' : '') + '>' +
            '<span class="df-gem"><span class="df-n num">' + (t.id + 1) + '</span></span><b class="df-name">' + T('ui.difficulty.tierName', { name: esc(t.name) }) + '</b>' +
            '<span class="df-blurb">' + esc(t.locked ? '？？？' : t.text) + '</span>' + dfStatus(t) + '</button>';
        }).join('') + '</div></div>' + confirmBar(T('ui.difficulty.confirm', { name: esc(cur.name) }), 'confirmDifficulty', true);
    }
  };
  SCREENS.advisor = {
    plate: function () { return plate(T('ui.advisor.plate')); },
    html: function (v) {
      var sel = ui.advisor;
      return '<div class="adv-head' + (sel ? ' show' : '') + '" id="advHead">' + heading(T('ui.advisor.heading'), T('ui.advisor.headingSub')) + '<div class="adv-info" id="advInfo"></div></div>' +
        '<div class="adv-row' + (sel ? ' has-sel' : '') + '" id="advRow">' + v.advisors.map(function (a) {
          return '<button class="adv-pick' + (sel === a.id ? ' sel' : '') + '" data-act="pickAdvisor" data-id="' + esc(a.id) + '" data-opt="advisor:' + esc(a.id) + '">' +
            '<span class="ap-stand">' + pic(A.portrait(a.id), 'stand-img', a.name, initialHtml(a.name)) + '</span><span class="ap-name">' + esc(a.name) + '</span></button>';
        }).join('') + '</div>' + confirmBar(sel ? T('ui.advisor.confirmName', { name: esc(nameOf(sel)) }) : T('ui.advisor.confirm'), 'confirmAdvisor', sel && ui.heard === sel);
    },
    after: function () {
      var row = $('advRow'); advHover(null);
      var cb = $('confirmBar'), pk = row.querySelector('.adv-pick.sel'); // v2.4 [3] the confirm sits right under the picked advisor
      if (cb && pk) { cb.classList.add('under-pick'); cb.style.left = Math.round(row.offsetLeft + pk.offsetLeft + pk.offsetWidth / 2) + 'px'; }
      row.addEventListener('mouseover', function (e) { var b = e.target.closest('.adv-pick'); if (b) advHover(b.dataset.id); });
      row.addEventListener('focusin', function (e) { var b = e.target.closest('.adv-pick'); if (b) advHover(b.dataset.id); });
      row.addEventListener('mouseleave', function () { advHover(null); });
    }
  };
  // v2.4 [5] identity: italic flavour on top, the skill in one short line below (falls back to splitting 「…（skill）」)
  function idText(o) {
    var fl = o.flavor || o.flavour || o.lore || '', sk = typeof o.skill === 'string' ? o.skill : o.skillText || o.effectText || '';
    if (fl && !sk) sk = o.text || ''; // v2.4 engine: flavor + a short text (the skill)
    if (!fl && !sk) { var m = String(o.text || '').match(/^(.*?)[（(]([^（()）]+)[)）]\s*$/); if (m) { fl = m[1]; sk = m[2]; } else fl = o.text || ''; }
    return '<span class="ch-flavor">' + esc(fl) + '</span>' + (sk ? '<span class="ch-skill">' + richText(sk) + '</span>' : '');
  }
  SCREENS.leader = {
    plate: function () { return plate(T('ui.leaderReg.plate')); },
    html: function (v) {
      var step = v.leaderStep || 'both', idStep = step === 'identity', list = idStep ? v.identities : v.classes, k = idStep ? 'identity' : 'cls';
      var ICON = { 'fallen-noble': 'noble-mask', veteran: 'broken-sword', outlander: 'key', outsider: 'key' };
      if (!idStep) return leaderClassHtml(list);
      var cards = list.map(function (o) {
        var icon = idStep ? A.icon(ICON[o.id] || 'leader-badge') : A.roleIcon(o.role);
        return '<button class="choice lg-card' + (ui[k] === o.id ? ' sel' : '') + '" data-act="pick" data-k="' + k + '" data-id="' + esc(o.id) + '" data-opt="' + k + ':' + esc(o.id) + '">' +
          '<span class="ch-head tone-' + (idStep ? 'violet' : ({ tank: 'blue', adc: 'green', healer: 'gold', mage: 'violet', rogue: 'red' }[o.role] || 'gold')) + '"><img src="' + esc(icon) + '" alt=""></span>' +
          '<b class="ch-name">' + esc(o.name) + '</b><span class="ch-rule"></span>' + // face-exempt: identity/class pick (idText / rowsHtml, not an effect card)
          (idStep ? idText(o) : rowsHtml(o) + '<span class="ch-stats num">' + IC.hp + ' ' + esc(o.hp) + '　' + IC.atk + ' ' + esc(o.atk) + '</span>') + '</button>';
      }).join('');
      return '<div class="lg-stand">' + pic(A.portrait('leader'), 'stand-img', '', crestHtml()) + '</div>' +
        heading(T(idStep ? 'ui.leaderReg.who' : 'ui.leaderReg.what'), idStep ? '' : T('ui.leaderReg.whatSub')) +
        '<div class="lg-cards n' + list.length + (idStep ? ' lg-id' : '') + '">' + cards + '</div>' + confirmBar(T('ui.leaderReg.confirm'), idStep ? 'confirmIdentity' : 'confirmClass', !!ui[k]); // G1 #1: lg-id = the short identity cards
    }
  };

  // feedback-1113 (3rd batch) #1: the class step is five tabs on top and ONE big panel below with the picked class in full
  // (persona, skill + its level, perk, combo); the first class is picked by default. All five panels are in the DOM but only
  // the .sel one shows — the `pick` action toggles .sel on every [data-k="cls"] element, tabs and panels alike.
  function leaderClassHtml(list) {
    if (!ui.cls || !list.some(function (o) { return o.id === ui.cls; })) ui.cls = list[0] && list[0].id;
    var TONE = { tank: 'blue', adc: 'green', healer: 'gold', mage: 'violet', rogue: 'red' };
    var tabs = list.map(function (o) {
      return '<button class="lc-tab tone-' + (TONE[o.role] || 'gold') + (ui.cls === o.id ? ' sel' : '') + '" data-act="pick" data-k="cls" data-id="' + esc(o.id) + '" data-opt="cls:' + esc(o.id) + '">' +
        '<span class="lc-ic"><img src="' + esc(A.roleIcon(o.role) || '') + '" alt=""></span><b>' + esc(o.name) + '</b></button>';
    }).join('');
    var panels = list.map(function (o) {
      var ab = abilityOf(o), sk = o.skill || {}, pk = o.perk || {}, cb = o.combo || {};
      var row = function (k, cls, name, txt) { var kt = cls === 'combo' ? termTip('bonus') : ''; return '<div class="lc-row ' + cls + '"><span class="lc-k"' + (kt ? ' data-tip="' + esc(kt) + '"' : '') + '>' + k + '</span><div class="lc-v">' + (name ? '<b class="lc-n">' + name + '</b>' : '') + '<span>' + txt + '</span></div></div>'; };
      return '<div class="lc-panel paper' + (ui.cls === o.id ? ' sel' : '') + '" data-k="cls" data-id="' + esc(o.id) + '">' +
        '<div class="lc-top"><b class="lc-name">' + esc(o.name) + '</b><span class="lc-stats num">' + IC.hp + ' ' + esc(o.hp) + '　' + IC.atk + ' ' + esc(o.atk) + '</span></div>' +
        '<p class="lc-flavor">' + esc(o.text || '') + '</p>' +
        row(T('ui.leaderReg.row.skill'), 'skill', esc(o.skillName || sk.name || '') + (o.skillLv ? '<em class="lc-lv">Lv' + esc(o.skillLv) + '</em>' : ''), richText(ab.action || sk.text || '—')) +
        (o.perkText || pk.text ? row(T('ui.leaderReg.row.perk'), 'perk', esc(pk.name || ''), richText(o.perkText || pk.text)) : '') +
        row(T('ui.leaderReg.row.combo'), 'combo', esc(o.comboName || cb.name || ''), ab.bonus ? richText(ab.bonus) : esc(cb.text || T('ui.common.none'))) + '</div>';
    }).join('');
    return '<div class="lg-stand">' + pic(A.portrait('leader'), 'stand-img', '', crestHtml()) + '</div>' + heading(T('ui.leaderReg.what'), T('ui.leaderReg.whatSub')) +
      '<div class="lc-wrap"><div class="lc-tabs">' + tabs + '</div><div class="lc-panels">' + panels + '</div></div>' + confirmBar(T('ui.leaderReg.confirm'), 'confirmClass', !!ui.cls);
  }

  // ---------- interview: side, then hire ----------
  function ivSide(c, i, v) {
    return '<div class="iv-side iv-' + (i ? 'right' : 'left') + '" data-c="' + esc(c.id) + '"><div class="iv-stand">' + pic(A.portrait(c.id), 'stand-img', c.name, initialHtml(c.name)) + '</div>' +
      '<div class="iv-tag panel"><div class="it-h">' + roleBadge(c.role) + '<b>' + esc(c.name) + '</b><span class="it-stats num"><span>' + IC.hp + ' ' + esc(c.hp) + '</span><span>' + IC.atk + ' ' + esc(c.atk) + '</span></span></div>' +
      (v.interviewStep === 'hire' && v.sided === c.id ? '<span class="iv-sided" data-tip="' + T('ui.interview.sidedTip') + '">' + T('ui.interview.sided') + '</span>' : '') + rowsHtml(c) + '</div></div>';
  }
  SCREENS.interview = {
    // UI-CLEAN §2.5a: 「跳过剧情」 left of ☰ while the intros / topic talk play (not her reaction: that carries the mood fx)
    topExtra: function () { return '<button class="btn-ghost iv-skip vn-pass" data-act="ivSkip" id="ivSkip" hidden>' + T('ui.interview.skipTalk') + '</button>'; },
    plate: function (v) { var role = v.pair[0] && v.pair[0].role; return plate(T('ui.interview.plate') + '<small>' + (v.roundTotal ? T('ui.interview.roundOfTotal', { round: esc(v.round), total: esc(v.roundTotal), role: esc(ROLE_NAME()[role] || '') }) : T('ui.interview.round', { round: esc(v.round), role: esc(ROLE_NAME()[role] || '') })) + '</small>'); },
    html: function (v) {
      var side = v.interviewStep === 'side' && v.conflict, opts = side ? v.conflict.options : v.pair.map(function (c) { return { id: c.id }; });
      var btns = opts.map(function (o, i) {
        var n = nameOf(o.id);
        // v2.4 [7] the side step: parchment speech bubbles beside each speaker; the hire step: big portrait buttons
        return side ? '<button class="iv-quote iq-' + (i ? 'right' : 'left') + '" data-act="side" data-id="' + esc(o.id) + '" data-opt="side:' + esc(o.id) + '"><span class="iq-who">' + esc(n) + '：</span><q>' + esc(o.label || '……') + '</q>' + (o.effect ? '<span class="iq-eff">' + esc(o.effect) + '</span>' : '') + (o.against ? '<span class="iq-eff iq-against">' + esc(o.against) + '</span>' : '') + '<span class="iq-pick">' + T('ui.interview.agree') + '</span></button>'
          : '<button class="bigchoice hire-btn ' + (i ? 'btn btn-secondary' : 'btn btn-primary') + '" data-act="hire" data-id="' + esc(o.id) + '" data-opt="hire:' + esc(o.id) + '"><span class="hb-face">' + pic(A.face(o.id, 'happy'), '', n, initialHtml(n)) + '</span><span>' + T('ui.interview.invite', { name: esc(n) }) + '</span></button>';
      }).join('');
      if (side) btns = '<div class="iq-head"><span>' + T('ui.interview.whoAgree') + '</span></div>' + btns;
      // feedback-1113 #4: while the two talk, no topic title and no status panels; once it is time to choose, hovering one shows her panel
      return (side ? '<div class="iv-title" id="ivTitle"' + (ui.ivReady ? '' : ' hidden') + '><span>「' + esc(v.conflict.title) + '」</span></div>' : '') +
        '<div class="iv-stage' + (ui.ivReady ? ' ready' : '') + '" id="ivStage">' + v.pair.map(function (c, i) { return ivSide(c, i, v); }).join('') + '</div>' +
        '<div class="iv-choices' + (side ? ' iv-quotes' : ' iv-hire') + '" id="ivChoices"' + (ui.ivReady ? '' : ' hidden') + '>' + btns + '</div>' +
        (side ? '<div class="iv-under" id="ivUnder"' + (ui.ivReady ? '' : ' hidden') + '><button class="btn-ghost" data-act="ivReplay">' + T('ui.interview.replay') + '</button></div>' : '');
    },
    enter: function (v) {
      ui.onSpeak = function (id) {
        if (id) { var st = $('ivStage'), ti = $('ivTitle'); if (st) st.classList.remove('ready'); if (ti) ti.hidden = true; } // feedback-1113 #4: talking again (her reaction) → hide title / panels
        app.querySelectorAll('.iv-side').forEach(function (el) {
          if (id) el.classList.remove('peek');
          el.classList.toggle('speaking', !!id && el.dataset.c === id); el.classList.toggle('dim', !!id && el.dataset.c !== id && (id === v.pair[0].id || id === v.pair[1].id));
        });
      };
      ivTalk(v);
    },
    after: function () { // feedback-1113 #4: hover / focus a candidate (her portrait or her choice) to peek at her status
      var peek = function (id) { app.querySelectorAll('.iv-side').forEach(function (el) { el.classList.toggle('peek', !!id && el.dataset.c === id); }); };
      var who = function (e) {
        var st = $('ivStage'); if (!st || !st.classList.contains('ready')) return null;
        if (!view || view.phase !== 'interview' || view.interviewStep !== 'hire') return null; // feedback-1113 (3rd) #3: only at the final pick, never on the 认同 step
        var t = e.target.closest && e.target.closest('.iv-side, [data-act="side"], [data-act="hire"]');
        return t ? (t.dataset.c || t.dataset.id || null) : null;
      };
      [$('ivStage'), $('ivChoices')].forEach(function (el) {
        if (!el) return;
        el.addEventListener('mouseover', function (e) { peek(who(e)); });
        el.addEventListener('focusin', function (e) { peek(who(e)); });
        el.addEventListener('mouseleave', function () { peek(null); });
      });
    }
  };
  function ivTalk(v) {
    var lines = [];
    if (v.interviewStep === 'side' || !v.conflict) v.pair.forEach(function (c) { if (c.intro) lines.push(c.intro); });
    if (v.interviewStep === 'side' && v.conflict) lines = lines.concat(v.conflict.lines || []);
    ui.ivReady = false; // a re-render (any cause) keeps the choices up once the talk is over
    var st0 = $('ivStage'), ti0 = $('ivTitle'); if (st0) st0.classList.remove('ready'); if (ti0) ti0.hidden = true; // feedback-1113 #4 (also on 再听一遍)
    app.querySelectorAll('.iv-side.peek').forEach(function (el) { el.classList.remove('peek'); });
    var sk = $('ivSkip'); if (sk) sk.hidden = !lines.length;
    say(lines, function () { ui.ivReady = true; var sk1 = $('ivSkip'); if (sk1) sk1.hidden = true; var c = $('ivChoices'), u = $('ivUnder'), st = $('ivStage'), ti = $('ivTitle'); if (c) c.hidden = false; if (u) u.hidden = false; if (st) st.classList.add('ready'); if (ti) ti.hidden = false; });
  }

  // ---------- prep = the campfire rest: a small talk around the fire, then the formation and 出发 ----------
  function memberCard(m, i, n, opts) {
    var o = opts || {}, art = unitArt({ id: m.id, side: 'ally', mood: m.mood, isLeader: m.isLeader });
    return '<div class="ucard ally p-slot' + (isLeader(m) ? ' is-leader' : '') + (o.sel ? ' sel' : '') + (hasBad(m.statuses) ? ' cursed' : '') + '" data-id="' + esc(m.id) + '"' + (o.drag ? ' draggable="true"' : '') + (o.act ? ' data-act="' + o.act + '"' : '') +
      ' data-opt="o:' + esc(m.id) + '" data-rich="' + esc(unitTip(m, 'ally')) + '">' +
      '<div class="uc-art">' + pic(art.list, 'uc-img', m.name, art.fb) + roleBadge(m.role, 'uc-role') + infoBtn(null, m.id) + '<span class="uc-slot" data-tip="' + T('ui.card.slotTip', { n: i + 1 }) + '"><b>' + (i + 1) + '</b></span>' + moodFace(m) + bondMark(m) + '</div>' +
      '<div class="uc-body"><div class="uc-name">' + esc(isLeader(m) ? (m.name && m.name !== T('ui.name.leader') ? m.name : T('ui.name.you')) : m.name) + '</div><div class="uc-stats"><span data-tip="' + T('ui.card.hpTip') + '">' + IC.hp + ' ' + esc(m.hp != null && m.hp !== m.maxHp ? m.hp + '/' + m.maxHp : m.maxHp) + '</span><span>' + IC.atk + ' ' + esc(m.atk) + '</span></div>' +
      '<div class="uc-chips">' + (o.wounded ? '<span class="chip bad wound" data-tip="' + T('ui.card.woundTip') + '">' + T('ui.card.wound') + '</span>' : '') + statusChips(m.statuses) + '</div></div>' +
      (o.orderNo ? '<span class="order-no" aria-hidden="true" data-tip="' + T('ui.card.slotTip', { n: i + 1 }) + '">' + (i + 1) + '</span>' : '') +
      (o.moves ? '<div class="uc-moves"><button data-act="move" data-i="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' data-tip="' + T('ui.card.moveLeftTip') + '">◀</button><button data-act="move" data-i="' + i + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' data-tip="' + T('ui.card.moveRightTip') + '">▶</button></div>' : '') + (o.moves && typeof comboTab === 'function' ? comboTab(m) : '') + '</div>';
  }
  function campLines(v) { return (v.events || []).filter(function (e) { return e && e.kind === 'line' && e.key === 'campfire'; }); }
  function bellLines(v) { return (v.events || []).filter(function (e) { return e && e.kind === 'line' && /^bell/i.test(e.key || ''); }); }
  function woundedNow(v) { return v.wounded != null ? !!v.wounded : !!(run && run.wounded); }
  function bellRing() { return '<div class="bell-ring" id="bellRing" aria-hidden="true" data-tip="' + A.bellTip() + '"><i></i><i></i><i></i><span class="bell-dot"></span></div>'; }
  function ringBell() { var r = $('bellRing'); if (r) pulse(r, 'ring', 3200); cue('bell', { act: actNo() }, 0); }
  // ---------- v2.3 §E4 the campfire choice: 休息 / 探索 / 锻炼 → (explore: keep 1 of 2 | train: who → her talk → 3 bonuses) → formation ----------
  function campStep(v) { return v && v.camp && v.camp.step ? v.camp.step : 'done'; }
  var CAMP_OPT = lazy(function () { var o = {}; ['rest', 'explore', 'train'].forEach(function (k) { o[k] = [T('ui.camp.' + k + '.label'), T('ui.camp.' + k + '.text')]; }); return o; });
  function campHasBell(v) { return campStep(v) === 'choose' && ((v.camp && v.camp.options) || []).some(function (o) { return (o && o.id || o) === 'followBell'; }); }
  function campFlat(c0) { // engine shape { explore: { offer }, train: { candidates | member, bonuses, talk } } → one flat object
    var c = {}; Object.keys(c0 || {}).forEach(function (k) { c[k] = c0[k]; });
    if (c.explore && c.explore.offer) c.items = c.explore.offer;
    var t = c.train || {}; ['candidates', 'member', 'bonuses', 'talk'].forEach(function (k) { if (t[k] != null && c[k] == null) c[k] = t[k]; });
    return c;
  }
  function campList(c, keys) { for (var i = 0; i < keys.length; i++) if (Array.isArray(c[keys[i]])) return c[keys[i]]; return []; }
  function campPanel(v, cs) {
    var c = campFlat(v.camp);
    if (cs === 'choose') {
      var opts = campList(c, ['options', 'choices']); if (!opts.length) opts = ['rest', 'explore', 'train'];
      var hasBell = opts.some(function (o) { return (o && o.id || o) === 'followBell'; });
      return (hasBell ? bellRing() : '') + heading(T('ui.camp.heading'), T(hasBell ? 'ui.camp.pickOneBell' : 'ui.camp.pickOne')) + '<div class="camp-cards' + (hasBell ? ' n4' : '') + '"' + (hasBell ? ' id="bellChoices"' + (ui.bellHeard ? '' : ' hidden') : '') + '>' + opts.map(function (o) {
        var id = typeof o === 'string' ? o : o.id, d = CAMP_OPT()[id] || [id, ''];
        if (id === 'followBell') return '<button class="choice camp-card cc-bell" data-act="followBell" data-opt="bell:follow">' + (A.grantsBell('followBell', 'camp') ? A.bellSvg('opt-bell') : '') + '<span class="ch-head"><span class="cc-bell-ring" data-tip="' + A.bellTip() + '"><i class="key-g kg-bell"></i></span></span>' + // batch6 H2-9: the bell mark // §A[26] the eerie fourth card
          '<b class="ch-name">' + esc((o && o.label) || T('ui.camp.bell.label')) + '</b><span class="ch-rule"></span><span class="ch-text">' + esc((o && o.text) || T('ui.camp.bell.text')) + '</span><span class="cc-down">' + esc((o && o.down) || T('ui.camp.bell.down')) + '</span></button>'; // face-exempt: camp menu (where to go, not an effect card)
        var full = id === 'explore' && ((o && o.disabled) || (v.items && v.items.length >= 3)); // v2.4 [24] no exploring with a full bag
        return '<button class="choice camp-card cc-' + esc(id) + (full ? ' cc-off' : '') + '"' + (full ? ' aria-disabled="true" data-tip="' + esc((o && o.tip) || T('ui.camp.bagFull')) + '"' : ' data-act="campChoose"') + ' data-id="' + esc(id) + '" data-opt="camp:' + esc(id) + '"><span class="ch-head">' + pic(A.campIcon(id), '', '', '') + '</span>' +
          '<b class="ch-name">' + esc((o && o.label) || d[0]) + '</b><span class="ch-rule"></span><span class="ch-text">' + esc((o && o.text) || d[1]) + '</span>' + (id === 'rest' ? restChips((o && o.heals) || c.restPreview) : '') + (full ? '<span class="cc-down cc-full">' + esc((o && o.tip) || T('ui.camp.bagFull')) + '</span>' : '') + '</button>'; // face-exempt: camp menu (rest / explore / train)
      }).join('') + '</div>';
    }
    if (cs === 'explore') {
      var items = campList(c, ['items', 'offers', 'options']);
      return heading(T('ui.explore.found', { count: items.length >= 1 && items.length <= 4 ? T('ui.numerals').split(',')[items.length] : items.length }), T(v.items && v.items.length >= 3 ? 'ui.explore.takeOneBagFull' : 'ui.explore.takeOne')) + '<div class="camp-cards n2">' + items.map(function (it) {
        var id = it.itemId || it.id, pv = it.preview ? Object.keys(it.preview).map(function (k) { return it.preview[k] && it.preview[k].length ? '<span class="sp-who">' + esc(nameOf(k)) + '</span>' + previewHtml(it.preview[k]) : ''; }).join('') : '';
        return '<button class="choice camp-card item" data-act="campExplore" data-id="' + esc(id) + '" data-opt="explore:' + esc(id) + '"><span class="ch-head"><img src="' + esc(A.itemIcon(id)) + '" alt=""></span>' +
          '<b class="ch-name">' + esc(it.name || id) + '</b><span class="ch-rule"></span>' + cardFaceHtml(it) + pv + '</button>';
      }).join('') + '</div>';
    }
    if (cs === 'train-pick') {
      var ids = campList(c, ['candidates', 'members', 'targets']).map(function (x) { return typeof x === 'string' ? x : x.id; });
      if (!ids.length) ids = party().filter(function (m) { return !isLeader(m); }).map(function (m) { return m.id; });
      return heading(T('ui.train.whoHeading'), T('ui.train.whoSub')) + '<div class="lane camp-pick">' + ids.map(function (id, i) { var m = member(id); return m ? memberCard(m, i, ids.length, { act: 'campTrainPick' }) : ''; }).join('') + '</div>';
    }
    if (cs === 'train-bonus') {
      var who = c.member || c.id || c.target, m2 = member(who) || { id: who, name: nameOf(who) };
      var bs = campList(c, ['bonuses', 'options']);
      return '<div class="train-stand">' + pic(A.portrait(who), 'stand-img', m2.name, initialHtml(m2.name)) + '</div>' +
        '<div class="train-side' + (ui.trainTalk ? ' hidden-till-talk' : '') + '" id="trainSide">' + heading(isLeader(who) ? T('ui.train.selfHeading') : T('ui.train.withHeading', { name: m2.name }), T('ui.train.pickOf3')) + '<div class="camp-cards n3">' + bs.map(function (b) {
          var sp = b.special || !!b.downside, pv = b.preview ? (b.preview[who] || b.preview[Object.keys(b.preview)[0]]) : null;
          return '<button class="choice camp-card bonus' + (sp ? ' special' : '') + '" data-act="campTrainBonus" data-id="' + esc(b.id) + '" data-opt="bonus:' + esc(b.id) + '">' + (sp ? '<span class="cc-tag">' + T('ui.train.special') + '</span>' : '') +
            '<b class="ch-name">' + esc(b.label || b.name || b.id) + '</b><span class="ch-rule"></span>' + cardFaceHtml(b) +
            (b.extra && effIcon(b.extra) ? '<span class="ch-eff ch-extra">' + richText(effIcon(b.extra)) + '</span>' : '') + // 2026-11-14 锻炼卡 extra: the second gain, its own line
            (sp && b.downside ? '<span class="cc-down">' + T('ui.train.cost', { text: b.downsideText || b.downside.text ? esc(b.downsideText || b.downside.text) : richText(effIcon(b.downside)) }) + '</span>' : '') + previewHtml(pv) + '</button>';
        }).join('') + '</div></div>';
    }
    return '';
  }
  // 2026-11-13 休息回血提示: the engine's restPreview / rest-event heals [{ id, name, amount, hp, maxHp, full }]; no math here
  function restFace(id, name) { return isLeader(id) ? pic(A.face('leader', 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }), '', name, crestHtml(true)) : pic(A.face(id, 'calm'), '', name, initialHtml(name)); }
  function restWho(h) { return isLeader(h.id) ? T('ui.name.leader') : (member(h.id) || {}).name || h.name || nameOf(h.id); }
  function restChips(heals) {
    if (!heals || !heals.length) return '';
    var rt = A.restTotal(heals); // batch6 H2-5: one sentence, no faces row (the after-rest summary keeps the faces)
    return '<span class="cc-heals cc-heal-sum' + (rt.total ? '' : ' all-full') + '">' + esc(rt.text) + '</span>';
  }
  function restFx(ev) { // after resting: who healed how much; stays until a click (the 继续 button or anywhere)
    var heals = (ev && ev.heals) || [];
    if (!heals.length) return function (done) { done(); };
    var rows = heals.map(function (h) {
      var n = restWho(h);
      return '<div class="rs-one' + (h.full ? ' full' : '') + '"><span class="md-face">' + restFace(h.id, n) + '</span><b class="rs-name">' + esc(n) + '</b>' +
        '<span class="rs-amt">' + (h.full ? (h.block ? richText('{i:block}+' + h.block) : T('ui.rest.full')) : '+' + h.amount) + '</span><span class="rs-hp">' + T('ui.rest.hp', { hp: h.hp, maxHp: h.maxHp }) + '</span></div>';
    }).join('');
    var L = A.restLayout(heals.length); // G1 #3: fixed 176 px columns, smaller faces from 5 people on, two rows from 7 — always inside 1920×1080
    var html = '<div class="rs-card paper" style="--rs-face:' + L.face + 'px;--rs-gap:' + L.gap + 'px;--rs-cols:' + L.perRow + ';width:' + L.cardW + 'px"><b class="rs-title">' + T('ui.rest.title') + '</b><div class="rs-row">' + rows + '</div><button class="btn btn-primary rs-go" type="button">' + T('ui.common.continue') + '</button></div>';
    return function (done, it) {
      var over = false;
      cine('rest', html);
      it.skip = function () { if (over) return; over = true; cineOff(); done(); };
    };
  }
  function effText(e) { if (!e) return ''; if (e.text) return e.text; var n = e.type === 'mood' ? T('ui.stat.mood') : STAT_NAME()[e.stat] || e.stat || ''; return T('ui.effect.statLine', { stat: n, sign: e.delta > 0 ? '+' : '−', n: Math.abs(e.delta || 0) }); }
  function campEnter(v) {
    if (campStep(v) !== 'train-bonus') return;
    var c = campFlat(v.camp), k = 'train:' + (run.history || []).length;
    if ((v.events || []).some(function (e) { return e && e.kind === 'line' && /^train/.test(e.key || ''); })) return; // already played as the action's events
    var ls = (c.lines || c.talk || []).map(function (l) { var o = normLine(l); if (o) { if (!o.speakerId) o.speakerId = speakerId(o); o.vnClass = 'camp'; } return o; }).filter(Boolean);
    if (!ls.length || replayed[k]) return;
    replayed[k] = true; var side = $('trainSide'); if (side) side.classList.add('hidden-till-talk');
    say(ls, function () { var s2 = $('trainSide'); if (s2) s2.classList.remove('hidden-till-talk'); });
  }
  // 布阵教学 (docs/DESIGN-2026-11-14-formation-guide.md, ui/formation-guide.js): the advisor offers to explain the formation the
  // first time the formation itself is on screen (never in the bell night, never over a talk or a dialog); once per player (prefs)
  function fguideOpen(ask) {
    var G = window.CHOOSER_FGUIDE; if (!G) return null;
    var a = view && view.advisor && view.advisor.present !== false ? view.advisor : null;
    hideTip();
    return G.open({ ask: ask, advisor: a ? { id: a.id, name: a.name } : null, prefs: prefs, save: function (p) { lsSet(PKEY, p); }, t: T, face: a ? A.face(a.id, 'calm') : null });
  }
  function fguideMaybe() {
    var G = window.CHOOSER_FGUIDE;
    if (!G || !G.shouldShow(prefs) || G.isOpen()) return;
    later(function () {
      var w = $('campWrap');
      if (!G.shouldShow(prefs) || G.isOpen() || !view || view.phase !== 'prep' || view.bell || campStep(view) !== 'done') return;
      if (!$('formation') || !w || w.classList.contains('talking') || vnActive() || !modalEl.hidden) return;
      fguideOpen(true);
    }, 600);
  }
  // 方案 B (2026-11-15): the advisor skill can be armed here for round 1 (one use per battle; the pause bar shows it as used)
  function armBtn(v) {
    var a = v.advisor; if (!a || a.present === false || !a.combat) return '';
    return '<button class="btn btn-secondary arm-skill' + (v.skillArmed ? ' on' : '') + '" data-act="armSkill" aria-pressed="' + (v.skillArmed ? 'true' : 'false') + '" data-tip="' + esc(T('ui.formation.armTip', { name: a.combat.name, text: a.combat.text })) + '">' +
      '<span class="pb-ic face">' + pic(A.face(a.id, 'calm'), '', '', '') + '</span>' + T(v.skillArmed ? 'ui.formation.armOn' : 'ui.formation.armOff', { name: a.combat.name }) + '</button>';
  }
  SCREENS.prep = {
    plate: function (v) { return plate(T(campStep(v) === 'done' ? 'ui.camp.plateDone' : 'ui.camp.plate')); }, // 叙事节奏 2026-11-13: the night never names the next level; the scene intro comes after 「出发」
    html: function (v) {
      if (!ui.order) { ui.order = v.party.map(function (m) { return m.id; }); ui.moves = 0; }
      if (v.bell && !campHasBell(v)) { // §6 the bell campfire (engines without the v2.3 four-card camp): no talk, a bell nobody else hears, two big choices
        return '<div class="camp-wrap bell-camp">' + standHtml() + bellRing() + '<div class="bell-choices" id="bellChoices"' + (ui.bellHeard ? '' : ' hidden') + '>' +
          '<button class="bigchoice btn btn-secondary bell-follow" data-act="followBell" data-opt="bell:follow"><span>' + T('ui.camp.bell.follow') + '</span><q>' + T(v.bellWound === false ? 'ui.camp.bell.noWoundDown' : 'ui.camp.bell.down') + '</q></button>' +
          '<button class="bigchoice btn btn-primary" data-act="stayFire" data-opt="bell:stay"><span>' + T('ui.camp.bell.stay') + '</span><q>' + T('ui.camp.bell.stayDown') + '</q></button></div></div>';
      }
      if (ui.talking == null) ui.talking = !v.bell && campLines(v).length > 0 && !replayed['camp:' + (run.history || []).length]; // G2 #12: the bell night plays its own talk (enter) — talking mode here hid #bellChoices for good
      var wd = woundedNow(v), n = ui.order.length, cards = ui.order.map(function (id, i) { return memberCard(member(id), i, n, { drag: true, moves: true, wounded: wd, orderNo: true }); }).join('');
      var foes = ''; for (var i = 0; i < Math.min(v.enemyCount || 0, 7); i++) foes += '<span class="foe-ghost">?</span>';
      var cs = campStep(v);
      if (ui.campSeen !== cs) { ui.campSeen = cs; ui.acted = 0; }
      if (!ui.talking && cs !== 'done') return '<div class="camp-wrap camp-choose step-' + esc(cs) + '" id="campWrap">' + standHtml() + campPanel(v, cs) + '</div>'; // §E4
      return '<div class="camp-wrap' + (ui.talking ? ' talking' : '') + '" id="campWrap">' + standHtml() +
        '<div class="formation-ui"><div class="ahead panel"><span class="ah-k">' + T('ui.formation.ahead') + '</span><span class="ah-row">' + foes + '</span><span class="ah-n">' + (v.waveCount > 1 ? T('ui.formation.enemiesWaves', { n: esc(v.enemyCount || '?'), waves: esc(v.waveCount) }) : T('ui.formation.enemies', { n: esc(v.enemyCount || '?') })) + '</span></div>' +
        '<div class="order-hint"><span class="oh-k" tabindex="0" data-tip="' + T('ui.formation.orderTip') + '">' + T('ui.formation.orderLabel') + '</span></div>' + // user 2026-11-14: 站位顺序 + a numbered circle above each slot
        '<div class="lane lane-prep" id="formation">' + cards + '</div>' +
        '<div class="prep-foot"><span class="hint">' + T('ui.formation.dragHint') + '</span>' + armBtn(v) + '<button class="btn btn-primary btn-lg" data-act="fight">' + T('ui.formation.go') + '</button></div></div></div>';
    },
    enter: function (v) {
      resetBattleMarks(); cue('fire', null, 0);
      if (v.bell) {
        ringBell(); vn.cls = 'camp';
        var bl = bellLines(v).map(function (l) { var o = normLine(l); if (o) o.vnClass = 'camp'; return o; }).filter(Boolean);
        if (bl.length) bl[0].onShow = function () { ringBell(); };
        bl = campLines(v).map(function (l) { var o = normLine(l); if (o) o.vnClass = 'camp'; return o; }).filter(Boolean).concat(bl); // feedback-1112 #8: the sacrifice talk first, then the bell
        say(bl, function () { vn.cls = ''; ui.talking = false; ui.bellHeard = true; var c = $('bellChoices'); if (c) c.hidden = false; else render(); later(ringBell, 1800); }); // G2 #12: no choices on screen → re-render them
        return;
      }
      if (!ui.talking) { campEnter(v); return; }
      replayed['camp:' + (run.history || []).length] = true;
      vn.cls = 'camp';
      // galgame layout: the five cards sit in a row at the top; the speaker stands over the dialogue box
      ui.onSpeak = function (id, l) {
        if (id !== undefined) standShow(id, l);
        app.querySelectorAll('#formation .p-slot').forEach(function (g) { g.classList.toggle('speaking', !!id && g.dataset.id === id); });
      };
      say(campLines(v).map(function (l) { var o = normLine(l); o.vnClass = 'camp'; return o; }), function () {
        vn.cls = ''; ui.onSpeak = null; ui.talking = false;
        if (campStep(view) !== 'done') { render(); return; } // §E4 the talk is over → the three choices
        var w = $('campWrap'); if (w) w.classList.remove('talking');
        var st = $('stand'); if (st) st.querySelectorAll('.stand').forEach(function (x) { x.classList.add('gone'); setTimeout(function () { x.remove(); }, 500); });
        app.querySelectorAll('#formation .p-slot').forEach(function (g) { g.classList.remove('speaking'); });
        fguideMaybe();
      });
    },
    after: function () {
      var box = $('formation'), dragId = null; if (!box) return;
      fguideMaybe(); // 布阵教学: the first time the formation shows (it checks the talk / bell / dialog itself)
      function slot(e) { return e.target.closest && e.target.closest('.p-slot'); }
      box.addEventListener('dragstart', function (e) { var li = slot(e); if (!li) return; dragId = li.dataset.id; li.classList.add('dragging'); hideTip(); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* */ } });
      box.addEventListener('dragover', function (e) { e.preventDefault(); });
      box.addEventListener('drop', function (e) {
        e.preventDefault(); var li = slot(e); if (!li || !dragId || li.dataset.id === dragId) return render();
        var from = ui.order.indexOf(dragId), to = ui.order.indexOf(li.dataset.id);
        ui.order.splice(from, 1); ui.order.splice(to, 0, dragId); ui.moves++; cue('move'); render();
      });
      box.addEventListener('dragend', function () { render(); });
    }
  };

  // ---------- battle: enemies enter, each round animates, then the pause bar (one action) ----------
  var CANCEL = {};
  function chk(tok) { if (tok !== anim.token) throw CANCEL; }
  var waiters = [];
  function wait(ms, tok) {
    return new Promise(function (r) { if (anim.skip || REDUCED) return r(); var w = { r: r }; w.h = setTimeout(function () { waiters.splice(waiters.indexOf(w), 1); r(); }, ms / spd()); waiters.push(w); }).then(function () { chk(tok); });
  }
  // v2.3 [28]: ×1 is ~40% slower than the old ×1; the old ×1 is now ×2, the old ×2 is ×3
  var SPD = { 1: 0.7, 2: 1, 3: 2 };
  function spd() { return SPD[prefs.speed] || 0.7; }
  function flushWaits() { var ws = waiters; waiters = []; ws.forEach(function (w) { clearTimeout(w.h); w.r(); }); if (fxLayer.getAnimations) fxLayer.getAnimations({ subtree: true }).forEach(function (a) { try { a.finish(); } catch (e) { /* */ } }); }
  function dur(ms) { return anim.skip || REDUCED ? 1 : ms / spd(); }
  function sel(v) { return window.CSS && CSS.escape ? CSS.escape(String(v)) : v; }
  function cardEl(uid) { return uid == null ? null : app.querySelector('.bcard[data-u="' + sel(uid) + '"]'); }
  function cardById(id) { return id == null ? null : app.querySelector('.bcard[data-id="' + sel(id) + '"]'); }
  function anyCard(x) { return cardEl(x) || cardById(x); }
  function tEl(t) { return cardEl(t.uid) || cardById(t.id); }
  function aEl(e) { return cardEl(e.actor) || cardById(e.actorId); }
  // per-battle presentation state that outlives a round's re-render: debt dots on allies, the frenzy multiplier
  var bmarks = { debts: {}, frenzy: 1 };
  function resetBattleMarks() { bmarks = { debts: {}, frenzy: 1 }; }
  function debtDots(id) { var d = bmarks.debts[id]; return d && d.length ? '<span class="debt-dots" data-tip="' + T('ui.battle.debtTip') + '">' + d.map(function (c) { return '<i' + (c === 'possessed' ? ' class="p"' : '') + '></i>'; }).join('') + '</span>' : ''; }
  // 2026-11-14 护甲: a steel shield badge (glyph + number) on the left end of the hp bar; hidden at 0. The bar gets a steel rim.
  function blockBadge(n, open) { return '<span class="blk-badge' + (n > 0 ? '' : ' off') + '" data-tip="' + esc(open ? T('ui.glyph.tip.openBlock') : termTip('block')) + '">' + A.glyph('block', false) + '<b class="blk-n">' + (n > 0 ? n : '') + '</b></span>'; }
  function setBlock(uid, n) {
    var el = cardEl(uid), u = ui.field && ui.field[uid]; if (u) u.block = Math.max(0, n | 0); if (!el) return;
    var bar = el.querySelector('.hpbar'), bd = el.querySelector('.blk-badge'), v = Math.max(0, n | 0); if (!bar || !bd) return;
    var was = bar.classList.contains('has-block');
    bar.classList.toggle('has-block', v > 0); bd.classList.toggle('off', !(v > 0)); bd.querySelector('.blk-n').textContent = v > 0 ? v : '';
    if (was && !(v > 0)) pulse(bd, 'broke', 500); else if (v > 0) pulse(bd, 'gain', 420);
  }
  // a hit the block took part of: a grey number first, then the badges (her own, and 伊芙's when she stepped in)
  function hitBlock(t, el) {
    if (!t) return;
    if (t.blocked && el && !t.numShown) floatAt(el, '−' + t.blocked, 'blk', '', -70); // 先飞后结算: the flying number already showed it
    RoundPlan.hitBlocks(t, ui.field).forEach(function (x) { setBlock(x[0], x[1]); }); // v38: the badge = the engine's block after this hit (hp hit ⇒ 0)
  }
  function battleCard(u, hp, hidden, blk) {
    var art = unitArt(u), m = u.side === 'ally' ? member(u.id) : null, pct = u.maxHp ? Math.max(0, Math.round(100 * hp / u.maxHp)) : 100;
    var turned = u.side === 'ally' && isTurned(u);
    var cls = 'ucard bcard ' + (u.side === 'ally' ? 'ally' : 'foe') + (isLeader(u) ? ' is-leader' : '') + (u.boss ? ' is-boss' : '') + (A.isFairy(u.id) ? ' is-fairy' : '') + (turned ? ' turned' : u.corruption ? ' corrupt-' + u.corruption : '') +
      (hp <= 0 ? ' down' : '') + (hidden ? ' pre-enter' : '') + (u.side === 'ally' && hasBad(u.statuses) ? ' cursed' : '');
    return '<div class="' + cls + '" data-u="' + esc(u.uid) + '" data-id="' + esc(u.id) + '" data-rich="' + esc(unitTip(u, u.side)) + '">' +
      '<div class="uc-art">' + pic(art.list, 'uc-img', u.name, art.fb) + (u.role ? roleBadge(u.role, 'uc-role') : '') + (m ? moodFace(m) + bondMark(m) : '') + (u.corruption && !turned ? '<span class="corrupt-mark"></span>' : '') + (u.side === 'ally' ? debtDots(u.id) : '') + infoBtn(u.uid, u.id) + '</div>' +
      '<div class="uc-body"><div class="uc-name">' + esc(u.name || T('ui.name.you')) + '</div><div class="hpn">' + Math.max(0, hp) + ' / ' + esc(u.maxHp) + '</div>' +
      '<div class="hpwrap"><div class="hpbar' + (blk > 0 ? ' has-block' : '') + '"><div class="lag" style="width:' + pct + '%"></div><div class="fill" style="width:' + pct + '%"></div></div>' + blockBadge(blk) + '</div>' +
      '<div class="uc-chips st-row">' + statusIcons(u.statuses, u.side) + '</div></div>' + comboTab(u) + '</div>';
  }
  // ===== v2.3 battle §D1: statuses as small icons, ×N when stacked; hover = name + effect =====
  var ST_GLYPH = lazy(function () { var o = {}; ['formation', 'clause', 'luck', 'smoke', 'drum', 'slow-start', 'mood-low', 'debuffed'].forEach(function (k) { o[k] = T('ui.status.glyph.' + k); }); return o; });
  var ST_SVG = { weak: 'weak', tough: 'tough', shell: 'block', 'slow-start': 'daze', daze: 'daze' }; // 2026-11-14: code-drawn glyphs (no art file)
  var ST_FILE = { 'mood-low': 'mood-down', 'mood-high': 'mood-up', 'vengeful-high': 'vengeful', 'vengeful-low': 'vengeful', wound: 'wounded' };
  function statusIcons(list, side) {
    var seen = {}, order = [];
    (list || []).map(stObj).forEach(function (o) {
      if (!o || ST_HIDE[o.id] || (side === 'enemy' && ST_BAD[o.id])) return;
      var n = +(o.stacks || o.n || o.count || 1);
      if (seen[o.id]) seen[o.id].n += n; else { seen[o.id] = { o: o, n: n }; order.push(o.id); }
    });
    return order.map(function (id) {
      var s = seen[id], o = s.o, name = o.label || o.name || id, bad = isBadStatus(o);
      var tip = name + (s.n > 1 ? ' ×' + s.n : '') + (o.tip || o.text ? '：' + (o.tip || o.text) : '');
      return '<span class="st-ic ' + (bad ? 'bad' : 'buff') + '" data-st="' + esc(id) + '" data-tip="' + esc(tip) + '">' +
        (ST_SVG[id] ? A.glyph(ST_SVG[id], false) : pic([A.ver('../art/cells/status/' + (ST_FILE[id] || id) + '.png')], 'st-img', '', '<i class="st-g">' + esc(ST_GLYPH()[id] || name.slice(0, 1)) + '</i>')) +
        (s.n > 1 ? '<b class="st-n">×' + s.n + '</b>' : '') + '</span>';
    }).join('');
  }
  // ===== v2.3 battle §D2: combo arrow tab on the side of the neighbour her bonus reaches =====
  // comboDir(u|member) → 'prev' (left) | 'next' (right) | 'both' | null. comboTab(u) returns the tab HTML; ui-screens may call
  // comboTab(member) on prep cards too (the card needs position:relative; the tab sits on its left / right edge).
  function comboDir(u) {
    if (!u) return null;
    var c = u.combo || (u.side === 'ally' || !u.side ? (member(u.id) || {}).combo : null), d = c && c.direction;
    if (d === 'prev' || d === 'next' || d === 'both') return d;
    var t = u.bonusText || ''; var has = function (k) { return new RegExp(T(k)).test(t); }; return has('ui.combo.dirBothRe') ? 'both' : has('ui.combo.dirPrevRe') ? 'prev' : has('ui.combo.dirNextRe') ? 'next' : null;
  }
  function termTip(id) { var t = RD && RD.keywords && RD.keywords.terms && RD.keywords.terms[id]; return (t && t.tip) || ''; } // SPEC-11-13 F: 加成 / 连击 / 击杀播报
  function comboTab(u) {
    var d = comboDir(u); if (!d) return '';
    var tip = T(u.comboName ? (u.bonusText ? 'ui.combo.tipNamedText' : 'ui.combo.tipNamed') : (u.bonusText ? 'ui.combo.tipText' : 'ui.combo.tip'), { name: u.comboName, text: u.bonusText }); // SPEC-11-13 F
    // v2.4 [12]: bigger tabs with the chance; the left tab sits high, the right one low, so a 'both' pair never lines up
    var pc = comboPct(u), pt = pc != null ? '<b class="ct-p">' + pc + '%</b>' : '';
    return (d !== 'next' ? '<span class="combo-tab ct-l" data-tip="' + esc(tip) + '"><i class="ct-a">◀</i>' + pt + '</span>' : '') + (d !== 'prev' ? '<span class="combo-tab ct-r" data-tip="' + esc(tip) + '"><i class="ct-a">▶</i>' + pt + '</span>' : '');
  }
  function comboPct(u) { // the engine's bonusText already folds in the bond bonus ("…，35% 让…"); else the raw chance
    var m = /(\d+)\s*%/.exec(u.bonusText || ''); if (m) return +m[1];
    var c = u.combo || (u.side === 'ally' || !u.side ? (member(u.id) || {}).combo : null);
    return c && c.chance != null ? Math.round(Math.min(1, c.chance) * 100) : null;
  }
  // the bonus fired: the arrow on the side of the boosted neighbour glows
  function comboFire(fromEl, toEl) {
    if (!fromEl || !toEl) return;
    var right = stagePt(toEl, 0.5, 0.5).x > stagePt(fromEl, 0.5, 0.5).x, tab = fromEl.querySelector('.combo-tab.' + (right ? 'ct-r' : 'ct-l'));
    if (tab) pulse(tab, 'fire', 1400);
  }
  function setHp(uid, hp) {
    var el = cardEl(uid), u = ui.field && ui.field[uid]; if (!el || !u) return;
    u.hp = Math.max(0, hp); var pct = u.maxHp ? Math.max(0, Math.round(100 * u.hp / u.maxHp)) : 100;
    el.querySelector('.fill').style.width = pct + '%'; el.querySelector('.hpn').textContent = u.hp + ' / ' + u.maxHp;
    var lag = el.querySelector('.lag'); setTimeout(function () { lag.style.width = pct + '%'; }, dur(500));
    if (u.hp <= 0) { u.block = 0; var bd = el.querySelector('.blk-badge'), bar = el.querySelector('.hpbar'); if (bd) bd.classList.add('off'); if (bar) bar.classList.remove('has-block'); } // 试玩 #15: a fallen unit has no 护甲 badge
  }
  function pulse(el, cls, ms) {
    if (!el) return; var c = cls.split(' '), L = el.classList;
    L.remove.apply(L, c); void el.offsetWidth; L.add.apply(L, c); setTimeout(function () { L.remove.apply(L, c); }, ms || 600);
  }
  // ---------- 2026-11-13 主菜单小铃互动: drag her around (fairy dust), tap her 5× in 2.5 s → a flash of the demon ----------
  // Pure parts in assets.js (tfIsDrag / tfClamp / tfTapper / dustTake). Only the title's .title-fairy. Where she was dragged
  // stays for this page load (tfOff, applied in titleHtml); a reload puts her back. Nothing loops: the dust is CSS-animated
  // divs removed by timeout, at most 120 at once.
  var tfOff = { x: 0, y: 0 }, tfDrag = null, tfDragEnd = -1e9, tfBusy = false, tfTap = A.tfTapper({ n: 5, win: 2500, cool: 8000 }), dustLive = 0;
  var DUST_C = ['#ffd76a', '#ffe9a8', '#ff9ad5', '#ffc2e6'], DUST_DARK = ['#8a4ad0', '#5a1f8a', '#b06ae0'];
  function spawnDust(x, y, n, sx, sy, dark) {
    if (REDUCED) return; n = A.dustTake(dustLive, n, 120);
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div'), c = dark ? DUST_DARK : DUST_C, ms = 800 + Math.floor(Math.random() * 600), s = 6 + Math.random() * 10;
      d.className = 'fdust'; d.style.left = (x + (Math.random() - 0.5) * 2 * sx) + 'px'; d.style.top = (y + (Math.random() - 0.5) * 2 * sy) + 'px';
      d.style.cssText += '--c:' + c[Math.floor(Math.random() * c.length)] + ';--s:' + s.toFixed(1) + 'px;--d:' + ms + 'ms;--dx:' + ((Math.random() - 0.5) * 60).toFixed(0) + 'px;--dy:' + (60 + Math.random() * 110).toFixed(0) + 'px;--tw:' + (120 + Math.floor(Math.random() * 120)) + 'ms';
      fxLayer.appendChild(d); dustLive++;
      setTimeout(function (el) { el.remove(); dustLive--; }, ms + 60, d);
    }
  }
  function tfDust(btn, n, dark) { var h = btn && btn.querySelector('.tf-hit'); if (!h) return; var a = stagePt(h, 0, 0), b = stagePt(h, 1, 1); spawnDust((a.x + b.x) / 2, a.y + (b.y - a.y) * 0.4, n, (b.x - a.x) * 0.4, (b.y - a.y) * 0.3, dark); }
  function tfSay(el, txt, cls) {
    if (!el || !el.isConnected) return; var old = fxLayer.querySelector('.bubble.fairy'); if (old) old.remove();
    var p = stagePt(el, 0.5, 0.18), b = fxDiv('bubble fairy' + (cls ? ' ' + cls : ''), esc(txt), p.x, p.y); b.style.left = A.clampX(p.x, b.offsetWidth, STAGE_W, 12) + 'px'; setTimeout(function () { b.remove(); }, 2600);
  }
  function tfLine(key, dflt) { var F = DATA.linesV2 && DATA.linesV2.fairy, pool = F && F[key] && F[key].length ? F[key] : dflt; var l = pool[Math.floor(Math.random() * pool.length)]; return typeof l === 'string' ? l : (l && l.text) || dflt[0]; }
  function tfAnnoyed(el) {
    tfBusy = true;
    if (!REDUCED) pulse(el, 'tf-shake', 420); // a shiver first …
    setTimeout(function () { // … then the demon, a dark-purple flash and one cold line
      el.classList.add('tf-demon'); cue('debuff', null, 0);
      if (!REDUCED) { var h = el.querySelector('.tf-hit'), c = h ? stagePt(h, 0.5, 0.45) : stagePt(el, 0.5, 0.5), f = fxDiv('tf-flash', '', c.x, c.y); setTimeout(function () { f.remove(); }, 700); tfDust(el, 24, true); }
      tfSay(el, tfLine('annoyed', [T('ui.titleFairy.annoyed')]), 'tf-dark');
      setTimeout(function () { // … and back, playing dumb
        el.classList.remove('tf-demon'); tfBusy = false; cue('giggle', null, 0); tfIdleCool = performance.now() + 8000; // 闲置行为: not right after
        tfDust(el, 8, false); tfSay(el, tfLine('annoyedBack', [T('ui.titleFairy.annoyedBack')]));
      }, REDUCED ? 1200 : 1000);
    }, REDUCED ? 0 : 420);
  }
  function tfFast(btn, k) { btn.querySelectorAll('.fanim').forEach(function (n) { n._faSpeed = k; }); }
  document.addEventListener('pointerdown', function (e) {
    var hit = e.target.closest && e.target.closest('.title-fairy .tf-hit'); if (!hit || e.button > 0 || tfDrag) return;
    var btn = hit.closest('.title-fairy'), a = stagePt(hit, 0, 0), b = stagePt(hit, 1, 1), fit = liveFit(), p0 = toStage(e.clientX, e.clientY, fit);
    tfDrag = { btn: btn, hit: hit, id: e.pointerId, sx: p0.x, sy: p0.y, lx: p0.x, ox: tfOff.x, oy: tfOff.y, fit: fit, moved: false, acc: 0,
      box: { l: a.x - tfOff.x, t: a.y - tfOff.y, r: b.x - tfOff.x, b: b.y - tfOff.y } };
    try { hit.setPointerCapture(e.pointerId); } catch (x) { /* */ }
  });
  document.addEventListener('pointermove', function (e) {
    var g = tfDrag; if (!g || e.pointerId !== g.id) return;
    var p = toStage(e.clientX, e.clientY, g.fit), dx = p.x - g.sx, dy = p.y - g.sy; // stage px (the stage may be turned)
    if (!g.moved) { if (!A.tfIsDrag(dx, dy, 6)) return; g.moved = true; g.btn.classList.add('tf-dragging'); tfFast(g.btn, 2.2); }
    var prev = tfOff; tfOff = A.tfClamp({ x: g.ox + dx, y: g.oy + dy }, g.box, STAGE_W, STAGE_H);
    g.btn.style.transform = 'translate(' + tfOff.x.toFixed(1) + 'px,' + tfOff.y.toFixed(1) + 'px)';
    var vx = p.x - g.lx; g.lx = p.x;
    g.btn.style.setProperty('--tf-tilt', Math.max(-14, Math.min(14, vx * 0.8)).toFixed(1) + 'deg');
    g.acc += Math.hypot(tfOff.x - prev.x, tfOff.y - prev.y);
    var n = Math.min(4, Math.floor(g.acc / 16)); if (n > 0) { g.acc -= n * 16; tfDust(g.btn, n, g.btn.classList.contains('tf-demon')); }
  });
  function tfEnd(e) {
    var g = tfDrag; if (!g || e.pointerId !== g.id) return; tfDrag = null;
    if (!g.moved) return; // a plain tap: the click goes on to fairyPoke
    tfDragEnd = performance.now(); g.btn.classList.remove('tf-dragging'); g.btn.style.setProperty('--tf-tilt', '0deg'); tfFast(g.btn, 0);
  }
  document.addEventListener('pointerup', tfEnd); document.addEventListener('pointercancel', tfEnd);
  // ---------- 2026-11-13 主菜单小铃闲置行为: ~5 s with no input → she roams a loop round the screen, or flies over and pokes
  // the cursor (「喂～」), then flies home. Pure parts in assets.js (tfIdleReady / tfPickIdle / tfRoamPath / tfPathAt /
  // tfPathLen / tfPokePlan / tfEase). One timeout (re-armed by input) and one rAF loop only while she flies; any input glides
  // her home (or stops her dead when it grabs her); leaving the title stops both and puts tfOff back where the act began.
  var TF_IDLE = 5000, TF_COOL = 9000, tfLast = performance.now(), tfIdleCool = 0, tfIdleT = 0, tfFly = null, tfPtr = null, tfChatS = A.tfChatInit();
  function tfOnTitle() { var b = !run && app.querySelector('.title-fairy'); return b && b.isConnected ? b : null; }
  function tfRect(el) { var a = stagePt(el, 0, 0), b = stagePt(el, 1, 1); return { l: a.x, t: a.y, r: b.x, b: b.y }; }
  function tfArm(ms) { clearTimeout(tfIdleT); tfIdleT = setTimeout(tfIdleCheck, Math.max(100, ms)); }
  function tfIdleCheck() {
    tfIdleT = 0; var btn = tfOnTitle(); if (!btn) return; // off the title: stays disarmed until the next input on it
    var now = performance.now(), st = { last: tfLast, idle: TF_IDLE, cool: tfIdleCool, onTitle: true, dragging: !!tfDrag, demon: btn.classList.contains('tf-demon'),
      busy: tfBusy || !!tfFly, hidden: document.hidden, modal: !!(modalEl && !modalEl.hidden) };
    if (!A.tfIdleReady(now, st)) { tfArm(Math.max(500, Math.max(tfLast + TF_IDLE, tfIdleCool) - now)); return; }
    var cur = tfPtr ? toStage(tfPtr.x, tfPtr.y) : null; // the cursor (screen px, kept raw) → stage px
    var act = A.tfPickIdle(Math.random, cur, STAGE_W, STAGE_H);
    tfIdleCool = now + TF_COOL;
    if (REDUCED) { pulse(btn, 'tf-wiggle', 1000); if (act === 'poke') tfSay(btn, tfLine('idlePoke', [T('ui.titleFairy.idlePoke')])); tfArm(TF_COOL); return; }
    var h = btn.querySelector('.tf-hit'); if (!h) return; var r = tfRect(h), box = { l: r.l - tfOff.x, t: r.t - tfOff.y, r: r.r - tfOff.x, b: r.b - tfOff.y }, home = { x: tfOff.x, y: tfOff.y };
    if (act === 'roam') {
      var mn = app.querySelector('.title-menu'), pts = A.tfRoamPath(home, box, STAGE_W, STAGE_H, Math.random, { n: 4, avoid: mn ? tfRect(mn) : null });
      tfFlyGo(btn, [{ pts: pts, ms: Math.max(3600, Math.min(7000, A.tfPathLen(pts) / 0.45)) }], 'roam', home);
    } else {
      var pl = A.tfPokePlan(home, box, cur, STAGE_W, STAGE_H), d = Math.hypot(pl.near.x - home.x, pl.near.y - home.y), go = Math.max(700, Math.min(1500, d / 0.9));
      var arc = A.tfClamp({ x: (home.x + pl.near.x) / 2, y: Math.min(home.y, pl.near.y) - 80 }, box, STAGE_W, STAGE_H); // a little hop up on the way
      tfFlyGo(btn, [{ pts: [home, arc, pl.near], ms: go }, { pts: [pl.near, pl.hit], ms: 130, say: 1 }, { pts: [pl.hit, pl.near], ms: 240 },
        { pts: [pl.near], ms: 900 }, { pts: [pl.near, arc, home], ms: go }], 'poke', home);
    }
  }
  // ---------- 2026-11-14 主菜单小铃闲聊: while she roams, every ~8–15 s maybe one line (fairy.idleChat.cute / meta / scheme,
  // 50/25/25 %, never the same twice running) in a small bubble that follows her and fades after 3.6 s. Never during a poke or
  // with another fairy bubble up; any input / leaving the title removes it and restarts the clock. Pure parts: A.tfChat /
  // tfChatPick / tfChatPool / tfChatClear (tests/title-fairy-chat.test.cjs).
  function tfChatEl() { return fxLayer.querySelector('.bubble.fairy.tf-chat'); }
  function tfChatOff() { var b = tfChatEl(); if (b) b.remove(); tfChatS = A.tfChatClear(tfChatS); }
  function tfChatPlace(b, btn) { // like fitBubble: own measured width, slid inside the stage (bubbleBox), tail on her
    var p = stagePt(btn, 0.5, 0.18), M = 12, bx = A.bubbleBox(p.x, b._w, STAGE_W, M), t = Math.round(Math.min(STAGE_H - M - b._h, Math.max(M, p.y - b._h)));
    b.style.width = bx.width + 'px'; b.style.left = bx.left + 'px'; b.style.top = t + 'px'; b.style.setProperty('--ax', bx.ax + 'px');
  }
  function tfChatTick(f, now) {
    var other = fxLayer.querySelector('.bubble.fairy:not(.tf-chat)'), b = tfChatEl();
    if (f.kind !== 'roam' || other) { if (b) b.remove(); b = null; } // a poke has its own 「喂～」: never two bubbles
    var r = A.tfChat(tfChatS, now, Math.random, { flying: f.kind === 'roam' && !f.ending, poking: f.kind !== 'roam' || !!other, w: f.chat ? f.chat.w : [] });
    tfChatS = r.s;
    if (r.say >= 0 && f.chat) {
      if (b) b.remove();
      b = fxDiv('bubble fairy fit tf-chat', A.skillMarkup(esc(f.chat.lines[r.say])), 0, 0); b._w = b.offsetWidth + 1; b._h = b.offsetHeight; // measured at left 0: no 1–2 chars a line
      setTimeout(function (el) { el.remove(); }, 3600, b);
    }
    if (b) tfChatPlace(b, f.btn);
  }
  function tfFlyGo(btn, segs, kind, home) {
    tfFly = { btn: btn, segs: segs, i: 0, t0: performance.now(), kind: kind, home: home, acc: 0, raf: 0,
      chat: kind === 'roam' ? A.tfChatPool(DATA.linesV2 && DATA.linesV2.fairy, loadMeta()) : null }; // 闲聊: the lines (+「又回来啦」 after the true ending)
    tfFast(btn, 1.8); tfFly.raf = requestAnimationFrame(tfStep);
  }
  function tfStep(now) {
    var f = tfFly; if (!f) return;
    if (!f.btn.isConnected || run) { tfFlyStop(true); return; }
    var s = f.segs[f.i], u = Math.min(1, Math.max(0, (now - f.t0) / s.ms));
    if (s.say && !s.said) { s.said = 1; tfSay(f.btn, tfLine('idlePoke', [T('ui.titleFairy.idlePoke')])); cue('giggle', null, 0); tfDust(f.btn, 5, false); }
    var p = A.tfPathAt(s.pts, A.tfEase(u)), prev = tfOff; tfOff = { x: p.x, y: p.y };
    f.btn.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
    var vx = p.x - prev.x; f.btn.style.setProperty('--tf-tilt', Math.max(-12, Math.min(12, vx * 1.4)).toFixed(1) + 'deg');
    f.acc += Math.hypot(p.x - prev.x, p.y - prev.y);
    var n = Math.min(3, Math.floor(f.acc / 18)); if (n > 0) { f.acc -= n * 18; tfDust(f.btn, n, false); }
    tfChatTick(f, now);
    if (u >= 1) { f.i++; f.t0 = now; if (f.i >= f.segs.length) { tfFlyStop(false); return; } }
    f.raf = requestAnimationFrame(tfStep);
  }
  function tfFlyStop(gone) {
    var f = tfFly; if (!f) return; tfFly = null; cancelAnimationFrame(f.raf);
    if (gone) { tfOff = { x: f.home.x, y: f.home.y }; tfChatOff(); return; } // the title went away mid-flight: she is back home next time
    f.btn.style.setProperty('--tf-tilt', '0deg'); tfFast(f.btn, 0);
    tfIdleCool = Math.max(tfIdleCool, performance.now() + TF_COOL); tfArm(Math.max(tfLast + TF_IDLE, tfIdleCool) - performance.now());
  }
  function tfActive(e) {
    tfLast = performance.now(); if (tfChatS.next != null || tfChatEl()) tfChatOff(); // 闲聊: any input → the bubble goes, the clock restarts
    if (e && e.clientX != null && /^pointer/.test(e.type)) tfPtr = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY };
    var f = tfFly;
    if (f) {
      var grab = e && e.type === 'pointerdown' && e.target && e.target.closest && e.target.closest('.title-fairy .tf-hit');
      if (grab) tfFlyStop(false); // she is grabbed (drag / poke): stop right where she is
      else if (!f.ending) { // anything else: a quick smooth glide home
        f.ending = true; var from = { x: tfOff.x, y: tfOff.y };
        f.segs = [{ pts: [from, f.home], ms: Math.max(350, Math.min(900, Math.hypot(from.x - f.home.x, from.y - f.home.y) / 1.2)) }]; f.i = 0; f.t0 = performance.now();
      }
      return;
    }
    if (!tfOnTitle()) { if (tfIdleT) { clearTimeout(tfIdleT); tfIdleT = 0; } return; }
    if (!tfIdleT) tfArm(Math.max(TF_IDLE, tfIdleCool - tfLast));
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { window.addEventListener(t, tfActive, { capture: true, passive: true }); });
  tfArm(TF_IDLE);
  function fxDiv(cls, html, x, y) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; d.style.left = x + 'px'; d.style.top = y + 'px'; fxLayer.appendChild(d); return d; }
  function floatAt(el, text, cls, tag, ox, rich) {
    // v2.3 [28]: floats start at the card's top edge and rise away from it: never over a face
    // DESIGN-skill-level: tag = a small word over the number (「暴击！」「第 2 下」), ox = side offset for a 连击 series
    if (!el) return; var p = stagePt(el, 0.5, 0), dy = /\bcrit\b/.test(cls || '') ? 110 : /\bmulti\b/.test(cls || '') ? 40 : -26; // a crit / 连击 lands on the card's art, clear of the top bar
    var d = fxDiv('float ' + (cls || ''), (tag ? '<small>' + esc(tag) + '</small>' : '') + esc(text), p.x + (ox || 0), p.y + dy);
    tipNum(d, rich);
    setTimeout(function () { d.remove(); }, 1800 / Math.min(1, spd()));
  }
  // v39「结算看得懂」: a damage / heal number (flying or resolved) and the acting card carry the one-action breakdown
  // (RoundPlan.explainAction) as a tip — hover, or tap to pin it. The 战报 (pause bar / result) lists every action.
  function settleUnits() {
    var m = {}, b = (view && view.battle) || {};
    battleLog().forEach(function (e) { if (e && e.kind === 'enemyEnter' && e.unit) m[e.unit.uid || e.uid] = { name: e.unit.name }; });
    (b.allies || []).concat(b.enemies || []).forEach(function (u) { m[u.uid] = { name: isLeader(u) ? (u.name || T('ui.name.you')) : u.name }; });
    return m;
  }
  function battleLog() { var rb = run && run.battle, b = view && view.battle; return (rb && rb.log) || (b && b.log) || (b && b.lastRound) || []; }
  function settleHtml(ex, cls) {
    if (!ex) return '';
    return '<div class="settle-act' + (cls ? ' ' + cls : '') + (ex.side === 'enemy' ? ' is-foe' : '') + '"><p class="st-head">' + richText(ex.head) + '</p><p class="st-f">' + richText(ex.formula) + '</p>' +
      ex.targets.map(function (t) { return '<p class="st-t' + (t.down ? ' down' : '') + (t.kind === 'heal' ? ' heal' : '') + '">' + richText(t.text) + '</p>'; }).join('') + '</div>';
  }
  function tagSettle(a) { // once per action: every target (and so every number it sends) knows the breakdown
    if (!a || a.exRich != null) return a ? a.exRich : '';
    var h = ''; try { h = settleHtml(RoundPlan.explainAction(a, settleUnits()), 'tip'); } catch (err) { h = ''; }
    a.exRich = h; (a.targets || []).forEach(function (t) { t.exRich = h; });
    return h;
  }
  function tipNum(d, rich) { if (d && rich) { d.dataset.rich = rich; d.classList.add('tipnum'); } }
  function actingTip(el, a) { var h = tagSettle(a); if (!el || !h) return; if (el.dataset.richOwn == null) el.dataset.richOwn = el.dataset.rich || ''; el.dataset.rich = h; }
  function actingTipOff(el) { if (!el || el.dataset.richOwn == null) return; el.dataset.rich = el.dataset.richOwn; delete el.dataset.richOwn; if (tipFor === el) hideTip(); }
  function battleLogHtml() {
    var rounds = RoundPlan.battleReport(battleLog(), settleUnits());
    var body = rounds.length ? rounds.map(function (g) {
      return '<section class="sl-round"><h3>' + T('ui.settle.round', { n: esc(g.round) }) + '</h3>' + g.items.map(function (it) {
        return settleHtml(it.ex) + (it.extra.length ? '<div class="st-extra">' + it.extra.map(function (x) { return '<p>' + A.glyph('block') + esc(x) + '</p>'; }).join('') + '</div>' : '');
      }).join('') + '</section>';
    }).join('') : '<p class="up-txt dim">' + T('ui.settle.empty') + '</p>';
    return '<h2>' + T('ui.settle.title') + '</h2><p class="sl-sub">' + T('ui.settle.sub') + '</p><p class="sl-order">' + richText(T('ui.settle.how.order')) + '</p>' +
      '<div class="sl-list">' + body + '</div><div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.close') + '</button></div>';
  }
  function openBattleLog() {
    hideTip(); modal(battleLogHtml()); modalEl.classList.add('unit-open', 'vn-pass');
    var pn = modalEl.querySelector('.panel'); if (pn) pn.classList.add('settle-panel');
  }
  // v2.3 [28]: the skill name above the actor (below a foe: the space above the enemy row is the top bar)
  function skillTag(el, name) {
    if (!el || !name) return; var foe = el.classList.contains('foe'), p = stagePt(el, 0.5, foe ? 1 : 0);
    var d = fxDiv('skill-tag' + (foe ? ' foe' : ''), '「' + esc(name) + '」', p.x, foe ? p.y + 34 : p.y - 150); d.style.left = A.clampX(p.x, d.offsetWidth, STAGE_W, 12) + 'px'; // batch6 fix: the edge cards' skill name stays on the stage
    setTimeout(function () { d.remove(); }, dur(1500));
  }
  // a damage / heal number flies from a point to the target's top edge, then rises and fades there
  // 2026-11-14 伤害数字「先飞后结算」: with t (an engine hit), the number that flies is the attack's FULL amount and it resolves
  // on the target into the hp damage (RoundPlan.hitNum): 5 → 2 with a crack on the 护甲 badge, or 0 + a shield clank (no red).
  // A heal just pops on the target. Speed (dur) / skip / REDUCED: the flight and the swap shorten or happen at once.
  function flyNum(from, el, text, cls, tag, ox, t) {
    if (!el) return Promise.resolve();
    var n = t ? RoundPlan.hitNum(t) : null;
    var rich = t && t.exRich;
    if (n && n.heal) { floatAt(el, n.to, cls, tag, ox, rich); return Promise.resolve(); }
    var to = stagePt(el, 0.5, 0); to = { x: to.x + (ox || 0), y: to.y + (/\b(crit|multi)\b/.test(cls || '') ? 60 : -26) };
    var d = fxDiv('flynum hitnum ' + (cls || ''), esc(n ? n.from : text), from.x, from.y); tipNum(d, rich);
    return flyTo(d, from, to, 420, (to.x > from.x ? 1 : -1) * 90).then(function () {
      if (!n || !n.changes) { floatAt(el, n ? n.to : text, cls, tag, ox, rich); return; }
      t.numShown = true; // hitBlock: no second grey 「−挡下」 number
      floatResolve(el, n, cls, tag, ox, rich);
    });
  }
  function floatResolve(el, n, cls, tag, ox, rich) {
    var p = stagePt(el, 0.5, 0), dy = /\bcrit\b/.test(cls || '') ? 110 : /\bmulti\b/.test(cls || '') ? 40 : -26;
    var d = fxDiv('float resolving ' + (cls || ''), (tag ? '<small>' + esc(tag) + '</small>' : '') + '<span class="rv">' + esc(n.from) + '</span>', p.x + (ox || 0), p.y + dy); tipNum(d, rich);
    var bd = el.querySelector('.blk-badge');
    var swap = function () {
      var rv = d.querySelector('.rv'); if (rv) rv.textContent = n.to;
      d.classList.add(n.clank ? 'clank' : 'resolved'); if (n.clank) d.classList.remove('dmg', 'foe-hit', 'huge', 'crit');
      if (bd) pulse(bd, 'crack', 420); if (n.clank) cue('guard', null, 0);
    };
    if (anim.skip || REDUCED) swap(); else setTimeout(swap, dur(150));
    setTimeout(function () { d.remove(); }, 1800 / Math.min(1, spd()));
  }
  // v36: the old per-card 连击 (comboHits) and crit-series (flyHits) paths are gone — every action is its own beat now
  // (playChain → playBeat) and a 连击 always plays through comboSeq, one beat per hit, whichever card it lands on.
  // batch6 H2-7: a 连击 is played hit by hit in the engine's order, whatever card each hit lands on. Before, comboHits only ran
  // when one card took 2+ hits of an ally's blow: a ×2 split over two foes (the usual 刺客 case, the pair alternates) was merged
  // into one simultaneous impact, and an enemy 连击 flew its numbers apart but landed them in one shared impact.
  // beats: A.comboBeats(targets, ...) → [{ uid, amount, crit, hpAfter, last }] — each with its own lunge, flash, knock + shake, cue, number, hp step
  async function comboSeq(beats, fromEl, skill, tok) {
    var n = beats.length, gap = A.comboGap(n), sh = app.querySelector('.battle') || app, fx = window.HitFX && !anim.skip;
    for (var i = 0; i < n; i++) {
      var b = beats[i], el = cardEl(b.uid); if (!el) continue;
      var actor = fromEl && fromEl.isConnected ? fromEl : null, tp = stagePt(el, 0.5, 0.5), ap = actor ? stagePt(actor, 0.5, 0.5) : null, dir = ap && tp.x < ap.x ? -1 : 1;
      if (actor && actor.animate && !REDUCED && !anim.skip) {
        var dx = ap ? Math.max(-60, Math.min(60, (tp.x - ap.x) * 0.12)) : 0, dy = ap ? Math.max(-60, Math.min(60, (tp.y - ap.y) * 0.12)) : -30;
        actor.animate([{ transform: 'none' }, { transform: 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px) scale(1.06)', offset: 0.45 }, { transform: 'none' }], { duration: dur(170), easing: 'cubic-bezier(.3,0,.3,1)' });
        await wait(70, tok);
      }
      var tier = b.crit ? 'crit' : b.hpAfter <= 0 ? 'ko' : 'normal';
      if (b.crit) cue('crit', null, 0); else cue(b.amount >= 6 ? 'bigHit' : 'hit', null, 0);
      var stop = fx ? HitFX.contact(el, { tier: tier, kind: skill || 'strike', dir: dir, scale: b.crit ? 1 : 0.8, from: actor ? stagePt(actor, 0.5, 0.4) : null }) : 0;
      floatAt(el, '−' + b.amount, 'dmg multi' + (b.crit ? ' crit' : ''), b.crit ? T('ui.battle.crit') : T('ui.battle.hitNo', { n: i + 1 }), 0, b.t && b.t.exRich);
      if (stop) await wait(Math.min(stop, 90), tok);
      if (fx) HitFX.after(el, { tier: tier, kind: skill || 'strike', dir: dir, scale: b.crit ? 1 : 0.7 }, sh); else pulse(el, 'hit', 300);
      setHp(b.uid, b.hpAfter); hitBlock(b.t, el);
      if (!b.last) await wait(gap, tok);
    }
  }
  function flyTo(d, from, to, ms, arc) {
    var dx = to.x - from.x, dy = to.y - from.y, mx = dx / 2 + (arc || 0), my = dy / 2 - Math.abs(arc || 0) * 0.6;
    if (!d.animate) { d.remove(); return Promise.resolve(); }
    var a = d.animate([{ transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) translate(' + mx + 'px,' + my + 'px) scale(1.15)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(.7)', opacity: 0.9 }], { duration: dur(ms), easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
    return a.finished.then(function () { d.remove(); }, function () { d.remove(); });
  }
  // SPEC-11-13 F: a teammate chain is 加成 (连击 = one blow, many hits). F round 2: the word now shows WHILE the bonus
  // is added onto the charge (chargeTag in playChain); afterwards only the happy faces (and a quake for 3+) remain
  function celebrate(depth) {
    if (depth >= 3) pulse(app.querySelector('.battle'), 'quake', 600);
  }
  // SPEC-11-13 F rounds 2–3: 双杀！/ 三杀！/ 四杀！/ 五杀！ — one action's kills (engine: action.killCall), single kills
  // are not announced; as big as the old chain banner, a white flash + bounce on entry, then the killer's happy line
  async function killCalls(acts, lines, tok) {
    for (var i = 0; i < acts.length; i++) {
      var kc = acts[i].killCall; if (!kc) continue;
      cue('combo', { depth: Math.min(4, kc.n + 1) }, 0);
      var d = fxDiv('banner killcall lv-' + Math.min(kc.n, 5), '<span class="fx-word">' + esc(kc.word) + '</span>' + (kc.sub ? '<small>' + esc(kc.sub) + '</small>' : ''), 960, 470);
      setTimeout(function (x) { return function () { x.remove(); }; }(d), REDUCED ? 900 : 1700);
      if (kc.n >= 3) pulse(app.querySelector('.battle'), 'quake', 500);
      await wait(900, tok);
      var ln = lines.filter(function (l) { return l.uid === acts[i].actor; })[0];
      if (ln) await playOne(ln, tok);
    }
  }
  function burst(from, toEls, color, n) {
    var ps = [];
    toEls.forEach(function (el) {
      var to = stagePt(el, 0.5, 0.4);
      for (var i = 0; i < n; i++) {
        var d = fxDiv('spark ' + color, '', from.x + (Math.random() - 0.5) * 30, from.y + (Math.random() - 0.5) * 30);
        ps.push(flyTo(d, { x: from.x, y: from.y }, { x: to.x + (Math.random() - 0.5) * 60, y: to.y + (Math.random() - 0.5) * 60 }, 420 + Math.random() * 220, (Math.random() - 0.5) * 340));
      }
    });
    return Promise.all(ps);
  }
  function bonusSource(b, actorEl) {
    if (b.from === 'advisor') return app.querySelector('.adv-chip') || actorEl;
    if (b.from === 'item') return app.querySelector('.bag-chip') || actorEl;
    if (b.from === 'frenzy') return $('roundNo') || actorEl;
    if (b.from === 'bond') return (actorEl && actorEl.querySelector('.bond')) || actorEl;
    return cardEl(b.from) || actorEl;
  }
  // ===== v2.6 hit feel (ui/hitfx.js): contact mark + flash → hit-stop → knock-back + shake + the hp bar =====
  var CHARGE_FS = [46, 56, 68, 82, 98, 116];
  function hitTier(uid, t) { var u = ui.field && ui.field[uid]; return window.HitFX ? HitFX.tier(t.amount || 0, u && u.maxHp, t.hpAfter) : (t.amount >= 6 ? 'heavy' : 'normal'); }
  async function impacts(list, tok) {
    list = list.filter(function (x) { return x.el; });
    var fx = window.HitFX && !anim.skip, stop = 0, sh = app.querySelector('.battle') || app;
    list.forEach(function (x) {
      var t = x.t; if (t.seqDone) { x.seq = true; return; } // G1 #5: comboSeq already played every beat of this 连击
      hitCue(t);
      if (t.capped) { floatAt(x.el, T('ui.battle.capped'), 'miss'); x.skip = true; return; }
      x.tier = t.kind === 'heal' ? 'normal' : t.crit && !(t.hpAfter <= 0) ? 'crit' : hitTier(x.uid, t); // DESIGN-skill-level: the crit tier (a KO still wins)
      if (fx) stop = Math.max(stop, HitFX.contact(x.el, { tier: x.tier, kind: x.kind, dir: x.dir, scale: x.scale, from: x.from ? stagePt(x.from, 0.5, 0.4) : null }));
    });
    if (stop) await wait(stop, tok); // the hit-stop: everything holds on the contact frame
    var RANK = { ko: 4, crit: 3, heavy: 2, normal: 1 };
    var heavy = list.filter(function (x) { return !x.skip && !x.seq && x.kind !== 'heal'; }).sort(function (a, b) { return (RANK[b.tier] || 0) - (RANK[a.tier] || 0); })[0]; // the heaviest hit drives the one shake
    list.forEach(function (x) { // v38: hp + 护甲 land in the engine's order (two hits on one card: the later one wins)
      if (x.skip) return;
      if (x.seq) { setHp(x.uid, x.t.hpAfter); hitBlock(x.t, x.el); return; }
      if (fx && x.kind !== 'heal') HitFX.after(x.el, x, x === heavy ? sh : null); else pulse(x.el, x.t.kind === 'heal' ? 'healed' : 'hit', 520);
      if (x.t.kind === 'heal') pulse(x.el, 'healed', 520);
      setHp(x.uid, x.t.hpAfter); hitBlock(x.t, x.el);
    });
  }
  function hitCue(t) { if (t.miss) cue('miss'); else if (t.kind === 'heal') cue('heal'); else if (t.capped || t.crit) return; /* 收尾: a crit sounds 'crit' (playBeat), not 'bigHit' on top */ else cue(t.amount >= 6 ? 'bigHit' : 'hit'); }
  function softMark(actorEl, targetEl) { if (actorEl) { pulse(actorEl, 'soft', 1600); floatAt(actorEl, T('ui.battle.softHeart'), 'soft'); } if (targetEl) floatAt(targetEl, T('ui.battle.miss'), 'miss'); cue('miss'); }
  // v36 (试玩者 1)「连携数字分开、卡片轮流上移」: one beat per actor (RoundPlan.actionBeats). Her card rises, her own charge is built
  // over HER card (base, then each bonus flies in — the chain's 「加成」 from the girl who brought her in), the charge bursts and her
  // numbers fly to every target of her action (splash targets too, with a small 「波及」 tag), resolve there (先飞后结算), the hits
  // land, she settles, then the next chained girl rises. ×2 / ×3 shorten every wait; skip / reduced motion = instant results.
  async function settleCard(el, tok) { await wait(RoundPlan.RISE.hold, tok); if (el) el.classList.remove('acting'); await wait(RoundPlan.RISE.down, tok); } // v36: the actor settles back
  async function playChain(group, tok) {
    var beats = RoundPlan.actionBeats(group), acts = beats.map(function (b) { return b.act; }), first = acts[0], extras = RoundPlan.beatExtras(group);
    if (!first || !aEl(first)) return;
    cue('allyAttack');
    var ctag = null, RS = RoundPlan.RISE;
    for (var k = 0; k < beats.length; k++) { await playBeat(beats[k], k, tok); for (var xb = 0; xb < (extras[k] || []).length; xb++) await playOne(extras[k][xb], tok); } // v38: a block gain lands with its own beat
    if (ctag) { var ct = ctag; ct.classList.add('out'); setTimeout(function () { ct.remove(); }, 400); }
    await wait(200, tok);
    async function playBeat(bt, k, tok) {
      var a = bt.act, el = aEl(a); if (!el) return;
      el.classList.add('acting'); // the rise (.bcard.acting: up, gold glow); she stays up until her hits have landed
      actingTip(el, a); // v39: while she is up, her card's tip = this action's breakdown
      await wait(RS.up, tok);
      if (bt.from) comboFire(cardEl(bt.from), el);
      var at = stagePt(el, 0.5, 0), step = bt.depth, inStep = 0, val = 0, ticks = 0;
      if (k > 0 && bt.depth) chargeTag(at, bt.depth); // F round 2: 「加成 ×N」 beside her orb, while the bonus is being added
      skillTag(el, a.skill || a.skillName);
      var bubble = fxDiv('charge' + (bt.heal ? ' heal' : ''), '<b>0</b>', at.x, at.y - 46);
      function setVal(n, big) {
        val = n; var b = bubble.querySelector('b'); b.textContent = val;
        var fs = CHARGE_FS[Math.min(step, CHARGE_FS.length - 1)] + Math.min(8, inStep * 3), dm = Math.min(192, 92 + step * 20 + Math.min(8, inStep * 3));
        bubble.style.setProperty('--cfs', fs + 'px'); bubble.style.setProperty('--cd', dm + 'px'); bubble.style.setProperty('--trem', (0.6 + step * 0.7).toFixed(1) + 'px');
        if (step > 0) bubble.classList.add('trem');
        if (b.animate && !REDUCED && !anim.skip) b.animate([{ transform: 'scale(' + (big ? 1.35 : 1.18) + ') rotate(-6deg)' }, { transform: 'scale(.94) rotate(4deg)', offset: 0.35 }, { transform: 'scale(1.03) rotate(-2deg)', offset: 0.65 }, { transform: 'none' }], { duration: dur(big ? 460 : 340), easing: 'ease-out' });
        cue('chargeTick', { n: ++ticks }, 80);
      }
      if (a.hits > 1) { // DESIGN-skill-level: 连击 — the charge is per hit
        var xh = document.createElement('i'); xh.className = 'xh'; xh.textContent = '×' + a.hits; xh.dataset.tip = T('ui.battle.multiHitTip', { n: a.hits }); bubble.appendChild(xh);
        var hc = fxDiv('banner hitcall', '<span class="fx-word">' + T('ui.battle.multiHit', { n: a.hits }) + '</span>', at.x, at.y - 150); hc.style.left = A.clampX(at.x, hc.offsetWidth || 220, STAGE_W) + 'px'; setTimeout(function () { hc.remove(); }, REDUCED ? 600 : 1000);
      }
      setVal(a.base || 0, true); await wait(320, tok);
      for (var j = 0; j < (a.bonuses || []).length; j++) {
        var b = a.bonuses[j], src = bonusSource(b, el), sp = src ? stagePt(src, 0.5, 0.3) : { x: at.x, y: at.y };
        var bd = fxDiv('flynum bonus', (b.noEffect ? '' : (b.amount >= 0 ? '+' : '') + b.amount) + '<small>' + esc(b.label || '') + '</small>', sp.x, sp.y); // 虚弱 that did nothing: no 「+0」, just the words
        await flyTo(bd, sp, { x: at.x, y: at.y - 46 }, 380, 80); chk(tok); inStep++; setVal(val + b.amount);
      }
      await wait(bt.depth ? 260 : 140, tok);
      // release: her charge bursts; sparks and one number per target fly together (the mage's splash: every target its own number)
      bubble.classList.add('release'); setTimeout(function () { bubble.remove(); }, 300); cue('chargeRelease');
      var src0 = { x: at.x, y: at.y - 46 }, live = bt.targets.filter(function (x) { return !x.miss && tEl(x.t); });
      var seq = bt.series ? A.comboBeats(a.targets, function (t) { var x = tEl(t); return x ? x.dataset.u : null; }) : [];
      seq.forEach(function (sb) { sb.t.seqDone = true; }); // batch6 H2-7: one beat per hit; impacts() leaves them alone
      var tEls = live.map(function (x) { return tEl(x.t); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
      var nums = (seq.length ? [wait(260, tok).then(function () { return comboSeq(seq, el, a.skillKind, tok); })] : []).concat(live.map(function (x) {
        var t = x.t, te = tEl(t), uid = te.dataset.u; if (t.capped || t.seqDone) return null;
        var tag = x.splash ? T('ui.battle.splashTag') : t.crit ? T('ui.battle.crit') : '';
        if (t.kind !== 'heal' && t.crit) cue('crit', null, 0);
        return flyNum(src0, te, '', t.kind === 'heal' ? 'heal' : 'dmg' + (t.crit ? ' crit' : hitTier(uid, t) !== 'normal' ? ' huge' : '') + (x.splash ? ' splash' : ''), tag, 0, t); // 先飞后结算, per target
      })).filter(Boolean);
      if (tEls.length) await Promise.all([burst(src0, tEls, bt.heal ? 'heal' : 'gold', Math.min(18, 6 + Math.max(0, bt.total)))].concat(nums));
      chk(tok);
      bt.targets.forEach(function (x) { if (!x.miss) return; if (x.soft) softMark(el, tEl(x.t)); else { floatAt(tEl(x.t), T('ui.battle.miss'), 'miss'); cue('miss'); } });
      await impacts(live.filter(function (x) { return !x.t.seqDone; }).map(function (x) { var te = tEl(x.t); return { el: te, uid: te.dataset.u, t: x.t, kind: x.heal ? 'heal' : x.t.refund ? 'strike' : a.skillKind, from: el, dir: 1, scale: x.splash ? 0.75 : undefined }; }), tok);
      await settleCard(el, tok); actingTipOff(el); // she settles back; the next girl in the chain rises
    }
    function chargeTag(at, depth) {
      if (!ctag) ctag = fxDiv('charge-tag', '', at.x - 175, at.y - 46);
      ctag.style.top = (at.y - 46) + 'px';
      ctag.innerHTML = '<b>' + T(depth >= 3 ? 'ui.battle.chainUnstoppable' : 'ui.battle.chain') + '</b><small>' + T('ui.battle.chainDepth', { n: depth }) + '</small>';
      ctag.className = 'charge-tag lv-' + Math.min(depth, 4); void ctag.offsetWidth; ctag.classList.add('pop');
      ctag.style.left = A.chargeTagX(at.x, ctag.offsetWidth || 340, STAGE_W) + 'px'; // G1 #2: the leftmost card's tag flips to the orb's right, never off the stage
      cue('combo', { depth: depth }, 200);
    }
    var end = group.filter(function (e) { return e.kind === 'chainEnd'; })[0], depth = end ? end.depth : acts.length > 1 ? acts[acts.length - 1].chainDepth : 0;
    var mkLines = group.filter(function (e) { return e.kind === 'line' && e.bark === 'multiKill'; });
    for (var g = 0; g < group.length; g++) { if (group[g].kind !== 'action' && group[g].kind !== 'chainEnd' && group[g].kind !== 'block' && group[g].kind !== 'blockClear' && mkLines.indexOf(group[g]) < 0) await playOne(group[g], tok); }
    await killCalls(acts, mkLines, tok); // SPEC-11-13 F: after the foes fall; her happy line right after the banner
    if (depth >= 1) {
      celebrate(depth);
      acts.forEach(function (a) { var el = aEl(a); if (!el || el.classList.contains('foe')) return; var img = el.querySelector('.uc-img'), keep = img.dataset.cands;
        swapPic(img, isLeader(a.actorId) ? A.face('leader', 'happy', { variant: actNo() >= 3 ? 'worn' : 'base' }) : A.face(a.actorId, 'happy')); el.classList.add('joy');
        setTimeout(function () { if (img.isConnected) { swapPic(img, keep.split('|')); el.classList.remove('joy'); } }, REDUCED ? 800 : 1600); });
      await wait(1100, tok);
    }
  }
  // §D barks + enemy taunts: a small bubble above the speaker's card; it fades on its own (or on the next click)
  function lineSpeaker(e) { return e.speakerId || (e.speaker !== 'narrator' && e.speaker !== 'advisor' ? e.speaker : null); }
  function fitBubble(d, cx, y, below) { // cx = the speaker's centre; y = the bubble's bottom edge (above) / top edge (below)
    // batch6 fix: measure at left 0 (an absolute box near the right edge shrinks to the space left of it: 1–2 chars a line)
    d.classList.add('fit'); d.style.left = '0px'; var w = d.offsetWidth + 1, h = d.offsetHeight, M = 12, bx = A.bubbleBox(cx, w, STAGE_W, M);
    var t = Math.round(Math.min(STAGE_H - M - h, Math.max(M, below ? y : y - h)));
    d.style.width = bx.width + 'px'; d.style.left = bx.left + 'px'; d.style.top = t + 'px'; d.style.setProperty('--ax', bx.ax + 'px');
  }
  async function playBubble(e, tok, tag) {
    var el = cardEl(e.uid) || cardById(lineSpeaker(e)) || cardById(e.id);
    if (!el) { await sayP([e]); chk(tok); return; }
    var p = stagePt(el, 0.5, 0), soft = tag === 'soft', foe = el.classList.contains('foe'), long = foe || tag === 'revenge';
    // v2.4 [14]: enemy barks / a revenge line that can't have her portrait: a bubble above her card (below it if the top bar is in the way)
    var d = fxDiv('bubble' + (soft ? ' soft' : '') + (foe ? ' foe-bark' : '') + (tag === 'revenge' ? ' rv-bubble' : ''), (soft ? '<span class="bb-tag">' + T('ui.battle.softHeart') + '</span>' : '') + (foe && e.name ? '<span class="bb-name">' + esc(e.name) + '</span>' : '') + esc(e.text), p.x, p.y - 10);
    // feedback-1112 [25]: whole-pixel box (no -50% translate, no scale: crisp text), kept inside the 1920×1080 stage
    var below = foe && p.y - 10 - d.offsetHeight < 168, q = below ? stagePt(el, 0.5, 1) : p;
    if (below) d.classList.add('below');
    fitBubble(d, p.x, below ? q.y + 14 : p.y - 10, below);
    if (foe) el.classList.add('speaking');
    setTimeout(function () { d.remove(); el.classList.remove('speaking'); }, REDUCED ? 1200 : (long ? 2900 : 2200) / spd());
    await wait(soft ? 1500 : long ? 1900 : 1100, tok);
  }
  // ===== v2.3 battle §D4: pre-battle talk (taunt / scout / rally): one line at a time, the face in the dialogue box,
  // the speaker's card lit and a small marker bubble above it =====
  var talkKeys = { taunt: 1, scout: 1, rally: 1, foeIntro: 1 }; // feedback-1112 #33: foeIntro = who the opponents are, told in battle
  async function playTalk(e, tok) {
    var sid = lineSpeaker(e), el = anyCard(e.uid) || cardById(sid) || cardById(e.id), mark = null;
    var l = normLine(e); if (!l || anim.skip) return;
    if (!l.name && sid && sid !== 'narrator') l.name = nameOf(sid); // feedback-1112 #33: the narrator has no name plate (was 「narrator」)
    if (e.key === 'scout') { l.tag = T('ui.battle.tag.scout'); if (!l.speakerId && view.advisor) l.speakerId = view.advisor.id; }
    if (e.key === 'rally') l.tag = T('ui.battle.tag.rally');
    if (e.key === 'foeIntro' && e.speaker !== 'advisor') l.tag = T('ui.battle.tag.foe'); // the advisor's line in the L9 intro is ours, not the opponent's
    if (el) { el.classList.add('speaking'); var p = stagePt(el, 0.5, 0); mark = fxDiv('bubble talk-mark' + (el.classList.contains('foe') ? ' foe' : ''), '<span class="tm-dots">…</span>', p.x, p.y - 10); }
    else if (e.key === 'scout') { var ac = app.querySelector('.adv-chip'); if (ac) { var q = stagePt(ac, 0.5, 1); mark = fxDiv('bubble talk-mark below', '<span class="tm-dots">…</span>', q.x, q.y + 70); } }
    try { await sayP([l]); } finally { if (el) el.classList.remove('speaking'); if (mark) mark.remove(); }
    chk(tok);
  }
  // §E her revenge line: the large corrupted portrait slides in from the right with the line beside it
  async function playRevenge(e, tok) {
    var id = lineSpeaker(e) || e.id, u = corruptUnit(id), cv = (u && u.corruption) || (/possessed/.test(e.expr || '') ? 'possessed' : 'vengeful');
    var d = fxDiv('revenge ' + cv, '<div class="rv-stand">' + pic(A.portrait(id, { variant: cv }), 'stand-img', '', '') + '</div><div class="rv-line"><b>' + esc(e.name || nameOf(id)) + '</b>' + esc(e.text) + '</div>', 0, 0);
    var el = anyCard(e.uid) || cardById(id); if (el) pulse(el, 'strike', 520);
    // v2.4 [23]: the portrait is up only while her line is; it is gone before her attack starts, and never covers a target
    if (!placeRevenge(d, e)) { d.remove(); await playBubble(e, tok, 'revenge'); return; }
    try { await wait(2300, tok); d.classList.add('rv-out'); await wait(220, tok); } finally { d.remove(); }
  }
  // v2.3 §D6 [27]: the portrait comes in on the side opposite her target and never covers it; else it shrinks to a top corner
  function placeRevenge(d, e) {
    var act = upcoming.filter(function (x) { return x.kind === 'action' && (x.actor === e.uid || x.actorId === (lineSpeaker(e) || e.id)); })[0];
    var tgs = ((act && act.targets) || []).map(tEl).filter(Boolean);
    if (!tgs.length) tgs = [].slice.call(app.querySelectorAll('.bcard.ally:not(.down)'));
    var boxes = tgs.map(function (t) { var a = stagePt(t, 0, 0), b = stagePt(t, 1, 1); return { l: a.x, t: a.y, r: b.x, b: b.y }; });
    function hits() {
      return [].slice.call(d.querySelectorAll('.rv-stand, .rv-line')).some(function (n) {
        var l = n.offsetLeft, t = n.offsetTop, r = l + n.offsetWidth, b = t + n.offsetHeight;
        return boxes.some(function (x) { return l < x.r && r > x.l && t < x.b && b > x.t; });
      });
    }
    var cx = boxes.length ? boxes.reduce(function (s, x) { return s + (x.l + x.r) / 2; }, 0) / boxes.length : 0;
    if (cx > STAGE_W / 2) d.classList.add('rv-left');
    if (hits()) { d.classList.toggle('rv-left'); if (hits()) { d.classList.toggle('rv-left', cx > STAGE_W / 2); d.classList.add('rv-corner'); if (hits()) { d.classList.toggle('rv-left'); if (hits()) return false; } } }
    return true;
  }
  var upcoming = [];
  function setFrenzy(mult) {
    bmarks.frenzy = mult; var edge = $('frenzyEdge'), lv = Math.max(1, Math.round(Math.log(mult) / Math.LN2));
    if (edge) { edge.style.setProperty('--fz', Math.min(lv, 5)); edge.classList.add('on'); }
    var rn = $('roundNo'), fz = rn && rn.querySelector('.bp-fz'); if (rn && !fz) { rn.insertAdjacentHTML('beforeend', '<span class="bp-sep"></span><span class="bp-fz">' + T('ui.battle.frenzy', { n: mult }) + '</span>'); } else if (fz) fz.textContent = T('ui.battle.frenzy', { n: mult });
  }
  // §E reckoning: her corrupted portrait on the left, the unhinged monologue in a dark box on the right
  async function playReckoning(e, tok) {
    var id = e.id, u = corruptUnit(id), cv = e.corruption || (u && u.corruption) || 'possessed', name = nameOf(id);
    ui.reck = { id: id, cv: cv };
    if (!RoundPlan.dimContent([e], 0)) return; // 修复 2026-11-14: no monologue → no dark screen (her debts, if any, bring their own)
    cue('reckoning', { corruption: cv }, 0);
    cine('reck ' + cv, '<div class="rk-stand">' + pic(A.portrait(id, { variant: cv }), 'stand-img', name, '') + '</div><div class="rk-name">' + esc(name) + '</div>');
    await wait(1100, tok);
    var lines = (e.lines || []).map(function (l) {
      var o = normLine(l); if (!o) return null; o.vnClass = 'side-right'; o.mad = true;
      if (!o.speakerId && o.speaker !== 'narrator') o.speakerId = id; if (!o.name && o.speakerId) o.name = name;
      if (!o.expr || o.expr === 'calm') o.expr = cv === 'vengeful' ? 'vengeful-rage' : 'possessed-grin';
      return o;
    }).filter(Boolean);
    await sayP(lines); chk(tok);
  }
  // feedback-1112 [24]: while the debts land, her portrait and the debt cards stay clear of every ally card: the portrait
  // is fitted into the space above our row (whole stand, scaled down), the cards move up if they would touch a card
  function allyBoxes() { return [].slice.call(app.querySelectorAll('.bcard.ally')).map(function (c) { var a = stagePt(c, 0, 0), b = stagePt(c, 1, 1); return { l: a.x, t: a.y, r: b.x, b: b.y }; }); }
  function clearAllies() {
    var bx = allyBoxes(); if (!bx.length) return;
    var top = Math.min.apply(null, bx.map(function (x) { return x.t; })) - 16, st = cineEl.querySelector('.rk-stand'), row = cineEl.querySelector('.debt-row');
    if (st) { var h = Math.max(240, Math.min(1100, top - 20)); st.style.cssText = 'top:20px;bottom:auto;left:40px;height:' + h + 'px;width:' + Math.round(h * 0.75) + 'px'; }
    if (row) {
      var rb = function () { var a = stagePt(row, 0, 0), b = stagePt(row, 1, 1); return { l: a.x, t: a.y, r: b.x, b: b.y }; }, r0 = rb();
      if (bx.some(function (x) { return r0.l < x.r && r0.r > x.l && r0.t < x.b && r0.b > x.t; })) row.style.top = Math.max(20, Math.round(top - (r0.b - r0.t) - 8)) + 'px';
    }
  }
  // …then the bad things she is returning, 1 / 2 / 3; each card splits into dots that land on the allies (memory events)
  async function playDebts(e, mems, tok) {
    var id = e.id || (ui.reck && ui.reck.id), u = corruptUnit(id), cv = (ui.reck && ui.reck.id === id && ui.reck.cv) || (u && u.corruption) || 'possessed';
    var debts = e.debts || [];
    if (!RoundPlan.debtsContent(e, mems)) return; // 修复 2026-11-14: no debt card and no dot to land → don't darken for nothing
    cine('reck debts ' + cv, '<div class="rk-stand">' + pic(A.portrait(id, { variant: cv }), 'stand-img', '', '') + '</div><div class="debt-row">' + debts.map(function (d, i) {
      return '<div class="debt-card" data-i="' + i + '"><span class="dn">' + (i + 1) + '</span><span class="dl">' + esc(d.label) + '</span><span class="dt">' + esc(d.text || '') + '</span></div>';
    }).join('') + '</div>');
    clearAllies();
    document.body.classList.add('fx-top'); cue('debuff');
    await wait(1400 + 500 * debts.length, tok);
    for (var i = 0; i < debts.length; i++) {
      var card = cineEl.querySelector('.debt-card[data-i="' + i + '"]'), mem = mems[i] || {};
      var targets = (mem.allies || (mem.ally ? [mem.ally] : [])).map(anyCard).filter(Boolean);
      if (!targets.length && mem.id == null && i >= mems.length) targets = [];
      if (card) card.classList.add('split');
      var from = card ? stagePt(card, 0.5, 0.5) : { x: 1300, y: 420 };
      await landDots(from, targets, cv, tok, mem.hpWas ? mem : null);
      await wait(350, tok);
    }
    // memory events beyond the debts list (or without a debts block): one dot run each, from her card
    for (var k = debts.length; k < mems.length; k++) {
      var m = mems[k], src = anyCard(m.unit) || cardById(m.id), tg = (m.allies || (m.ally ? [m.ally] : [])).map(anyCard).filter(Boolean);
      if (src) await landDots(stagePt(src, 0.5, 0.4), tg, cv, tok, m.hpWas ? m : null);
    }
    await wait(500, tok);
    document.body.classList.remove('fx-top'); cineOff();
  }
  async function landDots(from, els, cv, tok, mem) { // batch6 H2-14: mem → its targets' hp / max hp change only now, as the dots land
    var ps = [];
    els.forEach(function (el) {
      var to = stagePt(el, 0.25, 0.8);
      for (var n = 0; n < 5; n++) ps.push(flyTo(fxDiv('spark debt' + (cv === 'possessed' ? ' p' : ''), '', from.x, from.y), from, { x: to.x + (Math.random() - 0.5) * 50, y: to.y + (Math.random() - 0.5) * 30 }, 700 + n * 90, (Math.random() - 0.5) * 420));
    });
    await Promise.all(ps); chk(tok);
    els.forEach(function (el) {
      cue('debtDot', null, 120);
      var id = el.dataset.id; (bmarks.debts[id] = bmarks.debts[id] || []).push(cv);
      var old = el.querySelector('.debt-dots'); if (old) old.remove();
      el.querySelector('.uc-art').insertAdjacentHTML('beforeend', debtDots(id)); pulse(el, 'hit', 520);
      if (mem) debtLanded(el.dataset.u, mem);
    });
  }
  function debtLanded(uid, mem) { // the value right after this debt: the next debt's hpWas for this card, else the round's end state
    var f = ui.field && ui.field[uid], end = view && view.battle && view.battle.allies.filter(function (u) { return u.uid === uid; })[0]; if (!f || !end) return;
    var evs = (view.battle.lastRound || []), i = evs.indexOf(mem), nxt = null;
    for (var j = i + 1; i >= 0 && j < evs.length && !nxt; j++) if (evs[j].kind === 'memory' && evs[j].hpWas) nxt = evs[j].hpWas.filter(function (w) { return w.uid === uid; })[0] || null;
    var el = cardEl(uid), mx = nxt ? nxt.maxHp : end.maxHp, h = nxt ? nxt.hp : Math.min(f.hp, end.maxHp);
    f.maxHp = mx; if (h !== f.hp || el) setHp(uid, h);
  }
  var tauntsThisRound = 0;
  async function playOne(e, tok) {
    var el;
    switch (e.kind) {
      case 'enemyEnter': el = cardEl(e.uid || (e.unit && e.unit.uid)); if (el) { el.classList.remove('pre-enter'); el.classList.add('enter'); setTimeout(function (c) { return function () { c.classList.remove('enter'); }; }(el), 700); } cue('enemyEnter', null, 150); await wait(420, tok); break; // batch6 H2-6: drop 'enter' once played — left on, every later pulse (felled / hit) restarted it and a greyed-out foe slid back in · fix: this comment once swallowed the wait+break, so enemyEnter fell through into 'phase2' (「第二阶段」 on every entrance)
      case 'phase2': await playPhase2(e, tok); break;
      case 'block': el = cardEl(e.uid); RoundPlan.eventBlocks(e).forEach(function (x) { setBlock(x[0], x[1]); }); if (el && !anim.skip) { floatAt(el, '+' + e.amount, 'blk gain', '', -70); cue('guard', null, 0); await wait(260, tok); } break; // 2026-11-14 护甲
      case 'blockClear': RoundPlan.eventBlocks(e).forEach(function (x) { setBlock(x[0], x[1]); }); break;
      case 'turncoat': await playTurncoat(e, tok); break;
      case 'switchSide': moveToAllies(e.uid); break;
      case 'wave': if (e.advBoss) { await playWaveCard(e, tok); break; }
        if (e.wave > 1 && view && view.level === 11) { app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); }); await wait(500, tok); break; }
        if (e.wave > 1) { banner(T('ui.battle.wave', { n: e.wave }), 'wave'); app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); }); await wait(900, tok); } break;
      case 'frenzy': {
        var mult = e.mult || Math.pow(2, Math.max(1, (e.round || 4) - 3));
        cue('frenzy', { mult: mult }, 0); setFrenzy(mult);
        var fb = fxDiv('banner frenzy', '<span class="fx-word">' + T('ui.battle.frenzy', { n: mult }) + '</span><small>' + T('ui.battle.frenzySub') + '</small>', 960, 470);
        setTimeout(function () { fb.remove(); }, REDUCED ? 900 : 2000); await wait(1500, tok); break;
      }
      case 'action': {
        if (e.side === 'ally') { await playChain([e], tok); break; }
        el = aEl(e); cue('enemyAttack'); tagSettle(e);
        actingTip(el, e); // v39: while she is up, her card's tip = this action's breakdown
        if (el) { el.classList.add('acting'); await wait(RoundPlan.RISE.up, tok); } // v36: every actor rises before acting (same as ours)
        if ((e.bonuses || []).some(function (b) { return b.amount < 0; })) cue('guard');
        skillTag(el, e.skill || e.skillName);
        // feedback-1112 [5]: the card lunges toward its target; the number leaves at the top of the lunge (40%), then lands
        var LUNGE = 560, tg0 = (e.targets || []).map(tEl).filter(Boolean)[0];
        if (el && el.animate && !anim.skip && !REDUCED) {
          var c0 = stagePt(el, 0.5, 0.5), c1 = tg0 ? stagePt(tg0, 0.5, 0.5) : { x: c0.x, y: c0.y + 300 }, lx = c1.x - c0.x, ly = c1.y - c0.y, ln = Math.max(1, Math.hypot(lx, ly));
          el.style.zIndex = 4;
          var lg = el.animate([{ transform: 'none' }, { transform: 'translate(' + (lx / ln * 70).toFixed(1) + 'px,' + (ly / ln * 70).toFixed(1) + 'px) scale(1.08)', boxShadow: '0 0 30px rgba(255,80,80,.8)', offset: 0.4 }, { transform: 'none' }], { duration: dur(LUNGE), easing: 'ease-in-out' });
          lg.finished.then(function () { el.style.zIndex = ''; }, function () { el.style.zIndex = ''; });
          if (FXLOG) FXLOG.push({ ev: 'lungeStart', t: nowMs(), apex: nowMs() + dur(LUNGE) * 0.4 });
          await wait(LUNGE * 0.4, tok);
        } else { if (el) pulse(el, 'strike', 520); await wait(420, tok); }
        if (FXLOG) FXLOG.push({ ev: 'numLaunch', t: nowMs() });
        var from = el ? stagePt(el, 0.5, 1) : { x: 1300, y: 520 };
        var eBeats = A.comboBeats(e.targets, function (t) { var x = tEl(t); return x ? x.dataset.u : null; });
        if (eBeats.length > 1) { // batch6 H2-7: an enemy 连击 — every hit its own beat (flash, shake, cue, number, hp step)
          await comboSeq(eBeats, el, e.skillKind, tok); chk(tok);
          var eRest = (e.targets || []).filter(function (t) { return !t.miss && !t.capped && !eBeats.some(function (sb) { return sb.t === t; }) && tEl(t); }); // v38: a target outside the 连击 still lands
          if (eRest.length) await impacts(eRest.map(function (t) { var te = tEl(t); return { el: te, uid: te.dataset.u, t: t, kind: t.kind === 'heal' ? 'heal' : e.skillKind, from: el, dir: -1, scale: 0.8 }; }), tok);
          (e.targets || []).forEach(function (t) { var te = tEl(t); if (te && t.miss) { hitCue(t); floatAt(te, T('ui.battle.miss'), 'miss'); } });
          await wait(160, tok); await settleCard(el, tok); actingTipOff(el); break;
        }
        var seen = {};
        await Promise.all((e.targets || []).map(function (t, i) {
          var te = tEl(t); if (!te || t.miss || t.capped) return null;
          var nth = seen[t.uid] = (seen[t.uid] || 0) + 1, delay = (nth - 1) * 190; // DESIGN-skill-level: an enemy 连击 hits the same card again a beat later
          return new Promise(function (r) { setTimeout(r, anim.skip ? 0 : dur(delay)); }).then(function () {
            return flyNum(from, te, '', t.kind === 'heal' ? 'heal' : 'dmg foe-hit' + (t.hit ? ' multi' : ''), '', nth > 1 ? (nth - 1) * 62 : 0, t); // 先飞后结算
          });
        }).filter(Boolean)); chk(tok);
        (e.targets || []).forEach(function (t) { var te = tEl(t); if (te && t.miss) { hitCue(t); floatAt(te, T('ui.battle.miss'), 'miss'); } });
        await impacts((e.targets || []).filter(function (t) { return !t.miss && tEl(t); }).map(function (t) { var te = tEl(t); return { el: te, uid: te.dataset.u, t: t, kind: t.kind === 'heal' ? 'heal' : e.skillKind, from: el, dir: -1, scale: 0.8 }; }), tok);
        await wait(160, tok); await settleCard(el, tok); actingTipOff(el); break;
      }
      case 'down': {
        el = cardEl(e.uid) || cardById(e.id); var mine = e.side === 'ally' || (el && el.classList.contains('ally'));
        cue(mine ? 'allyDown' : 'kill');
        if (el) { el.classList.add('down'); pulse(el, 'felled', 700); if (!mine && window.HitFX && !anim.skip) HitFX.ko(el, fxLayer); } // v2.6: foes shatter; ours fall quietly
        await wait(mine ? 380 : 520, tok); break;
      }
      case 'chain': { // 2026-11-14 敌方加成: the same 「加成！/ 加成 ×N」 tag as ours, in the enemy colour, over the follower
        if (e.side !== 'enemy' || e.missed) break;
        var cf = cardEl(e.from), ctT = cardEl(e.to); comboFire(cf, ctT);
        if (ctT) {
          var cp = stagePt(ctT, 0.5, 0), et = fxDiv('charge-tag foe lv-' + Math.min(e.depth || 1, 4), '<b>' + T((e.depth || 1) >= 3 ? 'ui.battle.chainUnstoppable' : 'ui.battle.chain') + '</b><small>' + T('ui.battle.chainDepth', { n: e.depth || 1 }) + '</small>', cp.x, cp.y - 40);
          et.style.left = A.clampX(cp.x, et.offsetWidth || 300, STAGE_W) + 'px'; void et.offsetWidth; et.classList.add('pop'); pulse(ctT, 'acting', 700);
          cue('combo', { depth: e.depth || 1 }, 120);
          setTimeout(function (x) { return function () { x.classList.add('out'); setTimeout(function () { x.remove(); }, 400); }; }(et), REDUCED ? 700 : 1200);
        }
        await wait(e.fairy ? 520 : 420, tok); break;
      }
      case 'clauseDaze': { // 2026-11-14 附加条款: the next round, 2 foes stand there dazed (their turn then brings a daze reason:'clause')
        var dz = (e.units || []).map(function (u) { return cardEl(typeof u === 'object' ? u.uid : u); }).filter(Boolean);
        if (e.text) banner(e.text, 'clause');
        dz.forEach(function (x) { pulse(x, 'dazed', 900); floatAt(x, T('ui.battle.dazed'), 'miss'); var row = x.querySelector('.st-row'); if (row && !row.querySelector('[data-st="daze"]')) row.insertAdjacentHTML('beforeend', statusIcons(['daze'], 'enemy')); });
        cue('advisorSkill', null, 0); await wait(dz.length ? 900 : 300, tok); break;
      }
      case 'daze': el = cardEl(e.actor || e.uid) || cardById(e.actorId || e.id); if (el) { pulse(el, 'dazed', 900); floatAt(el, T(e.reason === 'regret' ? 'ui.battle.regret' : 'ui.battle.dazed'), 'miss'); } await wait(e.reason === 'regret' ? 1100 : 700, tok); break; // 2026-11-14 L8: the leader freezes
      case 'mood': el = cardById(e.id); if (el) moodDrop(el, e); await wait(500, tok); break;
      case 'line': case 'advisor': {
        var key = e.key || '';
        if (key === 'bark') { await playBubble(e, tok, e.soft || e.bark === 'softHeart' ? 'soft' : null); break; }
        if (key === 'softHeart') { await playBubble(e, tok, 'soft'); break; }
        if (key === 'revenge') { await playRevenge(e, tok); break; }
        if (key === 'reveal' && e.advBossReveal) { await playBossReveal(e, tok); break; }
        if (key === 'enemyBark') { if (!anim.skip) await playBubble(e, tok, 'enemy'); break; }
        if (key === 'taunt' && ++tauntsThisRound > 3) break;
        if (talkKeys[key]) { await playTalk(e, tok); break; }
        await sayP([e]); chk(tok); break;
      }
      case 'relic': // v2.3 §A[26]: the bell rings at L11 and the fairy starts phase 1 hurt
        cue('bell', { act: actNo() }, 0); el = cardEl(e.uid);
        if (el) { pulse(el, 'hit', 520); floatAt(el, T('ui.battle.bell'), 'turn'); if (e.hpAfter != null) setHp(e.uid, e.hpAfter); }
        await wait(1200, tok); break;
      case 'cancel': el = aEl(e); if (el) { pulse(el, 'dazed', 900); floatAt(el, T('ui.battle.cancelled'), 'miss'); } await wait(700, tok); break;
      case 'memory': await playDebts({ id: e.id, debts: [] }, [e], tok); break;
      case 'reckoning': await playReckoning(e, tok); break;
      case 'debts': await playDebts(e, [], tok); break;
      case 'phase': { var rn = $('roundNo'); if (rn && e.round) rn.querySelector('.bp-k').textContent = T('ui.battle.round', { n: e.round });
        // feedback-1112 [9]: 「第 N 回合 · 我方 / 敌方行动」 before each side moves (only when that side really acts this round)
        if (e.acts && e.round && !anim.skip) {
          var ally = e.side === 'ally', tb = fxDiv('turn-banner ' + (ally ? 'tb-ally' : 'tb-foe'), '<span class="tb-r">' + T('ui.battle.round', { n: esc(e.round) }) + '</span><span class="tb-s">' + T(ally ? 'ui.battle.allyTurn' : 'ui.battle.foeTurn') + '</span>', 960, 612);
          cue('pause', null, 0); setTimeout(function () { tb.remove(); }, dur(1250)); await wait(950, tok);
        }
        break; }
      case 'advisorSkill': cue('advisorSkill', null, 0);
        if (e.enemy) { el = cardEl(e.uid); if (el) pulse(el, 'strike', 520); if (!anim.skip) { announce({ title: T('ui.battle.skillTitle', { name: e.name || T('ui.battle.advisorSkill') }), sub: String(e.text || '').replace(/^[^——]*——/, '') || T('ui.battle.thisRound'), face: A.face(e.advisorId, 'special') }); await wait(1300, tok); } break; } // feedback-1112 #36: the boss casts it on you, every round
        if (!ui.announced) { announce({ title: (e.name ? T('ui.battle.skillTitle', { name: e.name }) : T('ui.battle.advisorSkill')), sub: T(e.open ? 'ui.battle.thisRound' : 'ui.battle.nextRound'), face: A.face(e.advisorId || (view.advisor && view.advisor.id), 'special') }); await wait(1300, tok); } break;
      case 'item': cue('item', null, 0); if (!ui.announced && e.itemId) { announce({ title: e.name || e.text || T('ui.battle.item'), face: null }); await wait(1100, tok); } break;
      case 'flashback': {
        el = cardEl(e.uid) || cardById(e.speakerId || e.speaker); var img = el && el.querySelector('.uc-img'), keep = img && img.dataset.cands;
        cue('flashback', null, 0);
        if (img) { swapPic(img, A.face(e.speakerId || e.speaker, e.expr || 'sad', { variant: 'flash' })); el.classList.add('flash-normal'); }
        await sayP([e]); chk(tok);
        if (img) { swapPic(img, keep.split('|')); el.classList.remove('flash-normal'); pulse(el, 'snap', 500); }
        break;
      }
      case 'darkTransition':
        // feedback-1112 [29]: right before her reckoning the dark is hers: one fade in (the reckoning screen), not dark → light → dark
        // 修复 2026-11-14「空着变暗又恢复」: in battle the dark never plays by itself — it is the reckoning's own screen when one
        // speaks right after (RoundPlan.dimContent); otherwise (her reckoning already happened, e.g. L11 wave 2) nothing at all
        if (RoundPlan.dimContent([e].concat(upcoming), 0)) cue('darkTransition', { reason: e.reason });
        break;
      default: break;
    }
  }
  // §6 phase 2: a heavy hit, the chamber shakes, her line; the returned girls are summoned in by the enemyEnter events that follow
  async function playPhase2(e, tok) {
    cue('phase2', null, 0); pulse(app.querySelector('.battle'), 'quake', 700); flashWhite(700, 'red');
    var d = fxDiv('banner phase2', '<span class="fx-word">' + T('ui.battle.phase2') + '</span><small>' + T('ui.battle.phase2Sub') + '</small>', 960, 440); setTimeout(function () { d.remove(); }, REDUCED ? 900 : 2200);
    app.querySelector('.battle').classList.add('phase-2');
    await wait(1600, tok);
    var ls = (e.lines || []).map(function (l) { var o = normLine(l); if (o && !o.speakerId && o.speaker !== 'narrator') o.speakerId = speakerId(o); return o; }).filter(Boolean);
    if (ls.length) { await sayP(ls); chk(tok); }
  }
  // §6 turncoat: her card flips across to our row with a light burst (her line is the next event)
  function moveToAllies(uid) {
    var el = cardEl(uid), lane = $('laneAlly'); if (!el || !lane || el.parentNode === lane) return null;
    var from = stagePt(el, 0.5, 0.5);
    el.classList.remove('foe', 'corrupt-possessed', 'corrupt-vengeful'); el.classList.add('ally', 'turned', 'flip-in');
    var cm = el.querySelector('.corrupt-mark'); if (cm) cm.remove();
    var img = el.querySelector('.uc-img'); if (img && A.isCandidate(el.dataset.id)) swapPic(img, A.face(el.dataset.id, 'calm'));
    lane.appendChild(el); var to = stagePt(el, 0.5, 0.5);
    if (el.animate && !REDUCED) el.animate([{ transform: 'translate(' + (from.x - to.x) + 'px,' + (from.y - to.y) + 'px) rotateY(180deg) scale(.9)' }, { transform: 'translate(' + ((from.x - to.x) / 2) + 'px,' + ((from.y - to.y) / 2 - 120) + 'px) rotateY(90deg) scale(1.15)', offset: 0.5 }, { transform: 'none' }], { duration: dur(900), easing: 'cubic-bezier(.3,.7,.3,1)' });
    return to;
  }
  async function playTurncoat(e, tok) {
    var el = cardEl(e.uid); if (!el) return;
    cue('turncoat', null, 0);
    var at = stagePt(el, 0.5, 0.45), lb = fxDiv('light-burst', '', at.x, at.y); setTimeout(function () { lb.remove(); }, 1400);
    floatAt(el, T('ui.battle.turncoat'), 'turn');
    await wait(500, tok);
    var to = moveToAllies(e.uid);
    await wait(900, tok);
    if (to) { var lb2 = fxDiv('light-burst small', '', to.x, to.y); setTimeout(function () { lb2.remove(); }, 1200); }
    await wait(300, tok);
  }
  function moodDrop(cardElm, e) {
    var mf = cardElm.querySelector('.mood-face img'); if (mf && e.mood != null) mf.src = A.moodIcon(e.mood);
    cue(e.delta < 0 ? 'moodDown' : 'moodUp', null, 300);
    pulse(cardElm.querySelector('.mood-face'), e.delta < 0 ? 'mood-down' : 'mood-up', 1200); floatAt(cardElm, T(e.delta < 0 ? 'ui.battle.moodDown' : 'ui.battle.moodUp'), e.delta < 0 ? 'mood-dn' : 'mood-up');
  }
  function banner(text, cls) { var d = fxDiv('banner ' + (cls || ''), '<span class="fx-word">' + esc(text) + '</span>', 960, 420); setTimeout(function () { d.remove(); }, 1400); }
  // v2.4 [25] L10: the engine sends wave 2 as enemyEnter… taunts, wave, reveal. Replay it as 「第二波」 card → her
  // transformation line with the boss portrait → her card entering → the rest (taunts, the betrayal line)
  function orderAdvisorWave(evs) {
    for (var w = 0; w < evs.length; w++) {
      var wv = evs[w]; if (wv.kind !== 'wave' || !(wv.wave > 1)) continue;
      var s0 = -1; for (var k = 0; k < w; k++) if (evs[k].kind === 'enemyEnter' && evs[k].wave === wv.wave) { s0 = k; break; }
      if (s0 < 0) continue;
      var seg = evs.slice(s0, w), boss = seg.filter(function (x) { return x.kind === 'enemyEnter' && x.unit && x.unit.advisorBoss; })[0];
      if (!boss) continue;
      var r = w + 1, reveal = []; while (r < evs.length && evs[r].kind === 'line' && evs[r].key === 'reveal') reveal.push(evs[r++]);
      var card = Object.assign({}, wv, { advBoss: boss.unit.name || '', advId: boss.unit.advisorId || boss.id });
      reveal = reveal.map(function (l) { return Object.assign({}, l, { advBossReveal: true, advId: card.advId }); });
      var enters = seg.filter(function (x) { return x.kind === 'enemyEnter'; }), rest = seg.filter(function (x) { return x.kind !== 'enemyEnter'; });
      return evs.slice(0, s0).concat([card], reveal, enters, rest, evs.slice(r));
    }
    return evs;
  }
  async function playWaveCard(e, tok) {
    app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); });
    cue('phase2', null, 0); flashWhite(500, 'red');
    var d = fxDiv('b-intro wave-card', '<div class="bi-band"><span class="bi-w bi-1">' + T('ui.battle.wave2') + '</span><span class="bi-w bi-2">' + esc(e.advBoss || '') + '</span><span class="bi-w bi-3">' + T('ui.battle.sheComes') + '</span></div>', 0, 0);
    try {
      d.classList.add('s1'); await wait(1100, tok);
      d.classList.remove('s1'); d.classList.add('s2'); await wait(1300, tok);
      d.classList.remove('s2'); d.classList.add('s3'); await wait(700, tok);
      d.classList.add('out'); await wait(380, tok);
    } finally { d.remove(); }
  }
  async function playBossReveal(e, tok) {
    var id = e.advId || lineSpeaker(e) || (view.advisor && view.advisor.id);
    var d = fxDiv('boss-reveal', '<div class="br-stand">' + pic(A.portrait(id, { variant: 'boss' }), 'stand-img', '', '') + '</div>', 0, 0);
    var l = normLine(Object.assign({}, e, { expr: 'boss' })); if (l && !l.speakerId) l.speakerId = id;
    try { await sayP([l || e]); d.classList.add('out'); await wait(300, tok); } finally { d.remove(); }
  }
  async function playRound(evs, tok) {
    tauntsThisRound = 0; evs = orderAdvisorWave(evs);
    var steps = RoundPlan.planRound(evs); // 修复 2026-11-13: the cutting is pure (ui/round-plan.js, tests/round-plan.test.cjs)
    for (var s = 0; s < steps.length; s++) {
      var st = steps[s];
      if (st.type === 'debts') { await playDebts(st.debts, st.memories, tok); continue; }
      if (st.type === 'chain') { await playChain(st.group, tok); continue; }
      upcoming = evs.slice(st.i + 1, st.i + 6);
      if (st.e.kind === 'phase') st.e.acts = st.acts;
      await playOne(st.e, tok);
    }
  }
  // ===== v2.3 battle §D3 [11]: full-width title card before the enemies enter: 「战斗」 → the group's name → 「开始！」 =====
  function introName(v) {
    var b = v.battle || {}, ent = (b.lastRound || []).filter(function (e) { return e.kind === 'enemyEnter'; }).map(function (e) { return e.unit || {}; });
    var boss = ent.concat(b.enemies || []).filter(function (u) { return u.boss || u.advisorBoss || u.waveBoss; })[0];
    return (boss && boss.name) || v.levelTitle || (v.level ? T('ui.level.no', { n: v.level }) : '');
  }
  async function playIntro(v, tok) {
    var name = introName(v), d = fxDiv('b-intro', '<div class="bi-band"><span class="bi-w bi-1">' + T('ui.battle.introFight') + '</span><span class="bi-w bi-2">' + esc(name) + '</span><span class="bi-w bi-3">' + T('ui.battle.introStart') + '</span></div>', 0, 0);
    cue('enemyEnter', null, 0);
    try {
      d.classList.add('s1'); await wait(900, tok);
      d.classList.remove('s1'); d.classList.add('s2'); await wait(1300, tok);
      d.classList.remove('s2'); d.classList.add('s3'); cue('combo', { depth: 1 }, 0); await wait(800, tok);
      d.classList.add('out'); await wait(380, tok);
    } finally { d.remove(); }
  }
  var pendingAnnounce = null;
  SCREENS.battle = {
    plate: function (v) { return plate(levelText(v)); },
    html: function (v) {
      var b = v.battle, evs = b.lastRound || [], entering = {}, hp = {}, mx0 = {}, blk = {};
      b.allies.concat(b.enemies).forEach(function (u) { hp[u.uid] = u.hp; });
      blk = RoundPlan.blockStart(evs, b.allies.concat(b.enemies)); // v38: pure (ui/round-plan.js, tests/block-sync.test.cjs)
      evs.forEach(function (e) { if (e.kind === 'enemyEnter') entering[e.uid || (e.unit && e.unit.uid)] = e.unit || true; });
      // §4.5 a girl who turned this round still starts the round on their side; the turncoat animation carries her over
      var sw = {}; if (!replayed[(run.history || []).length]) evs.forEach(function (e) { if (e.kind === 'switchSide' || e.kind === 'turncoat') sw[e.uid] = 1; });
      // 复查 2026-11-14: lane = engine B.enemies order (「最左侧」 = enemies[0] = leftmost card); no fairy-to-the-right reorder here — the data puts her last
      var foes = RoundPlan.foeLane(b.enemies, b.allies.filter(function (u) { return sw[u.uid]; }).map(function (u) { var o = {}; Object.keys(u).forEach(function (k) { o[k] = u[k]; }); o.side = 'enemy'; o.turned = false; if (!o.corruption) o.corruption = 'possessed'; return o; }));
      var allies = b.allies.filter(function (u) { return !sw[u.uid]; });
      for (var i = evs.length - 1; i >= 0; i--) { // walk back to the state before this round
        var e = evs[i];
        if (e.kind === 'action') (e.targets || []).forEach(function (t) { if (t.miss || t.capped) return; var before = t.kind === 'heal' ? t.hpAfter - t.amount : t.hpAfter + t.amount; hp[t.uid] = before; });
        if (e.kind === 'relic' && e.uid != null && e.hpBefore != null) hp[e.uid] = e.hpBefore;
        if (e.kind === 'memory' && e.hpWas) e.hpWas.forEach(function (w) { hp[w.uid] = w.hp; mx0[w.uid] = w.maxHp; }); // batch6 H2-14: a debt's numbers change when its dots land
      }
      ui.field = {};
      b.allies.concat(b.enemies).forEach(function (u) { var mx = mx0[u.uid] != null ? mx0[u.uid] : u.maxHp; ui.field[u.uid] = { hp: hp[u.uid], maxHp: mx, block: Math.max(0, blk[u.uid] || 0) }; });
      Object.keys(ui.field).forEach(function (k) { var f = ui.field[k]; f.hp = Math.min(f.maxHp, f.hp); });
      var round = b.round || 1, fz = evs.some(function (x) { return x.kind === 'frenzy'; }) ? 1 : (b.mult || bmarks.frenzy || 1);
      if (fz > 1) bmarks.frenzy = fz;
      var lv = Math.max(1, Math.round(Math.log(fz) / Math.LN2));
      return '<div class="battle' + (v.level === 11 ? ' noble' : '') + '"><div class="frenzy-edge' + (fz > 1 ? ' on' : '') + '" id="frenzyEdge" style="--fz:' + Math.min(lv, 5) + '"></div>' +
        '<div class="b-top"><span class="b-pill" id="roundNo"><span class="bp-k">' + T('ui.battle.round', { n: esc(round) }) + '</span>' + (b.waveCount > 1 ? '<span class="bp-sep"></span><span>' + T('ui.battle.waveOf', { n: esc(b.wave || 1), total: esc(b.waveCount) }) + '</span>' : '') +
        (fz > 1 ? '<span class="bp-sep"></span><span class="bp-fz">' + T('ui.battle.frenzy', { n: fz }) + '</span>' : '') + '</span></div>' +
        '<span class="b-ctl vn-pass"><button class="pill-btn speed-cycle" data-act="speedCycle" data-tip="' + T('ui.battle.speedTip') + '">×' + (prefs.speed || 1) + '</button>' + // UI-CLEAN §2.7: one button cycles ×1 → ×2 → ×3
        '<button class="pill-btn" data-act="skip" id="skipBtn">' + T('ui.battle.skip') + '</button></span>' +
        '<div class="b-foe"><div class="lane lane-foe" id="laneFoe">' + foes.map(function (u) { return battleCard(u, ui.field[u.uid].hp, !!entering[u.uid], ui.field[u.uid].block); }).join('') + '</div></div>' +
        '<div class="b-ally"><div class="lane lane-ally" id="laneAlly">' + allies.map(function (u) { return battleCard(mx0[u.uid] != null ? A.withMaxHp(u, mx0[u.uid]) : u, ui.field[u.uid].hp, false, ui.field[u.uid].block); }).join('') + '</div></div>' +
        '<div id="pauseWrap" class="pause-wrap"></div><div id="resultWrap"></div></div>';
    },
    enter: function (v) { battleFlow(v); }
  };
  SCREENS.battleResult = SCREENS.battle;
  async function battleFlow(v) {
    var tok = anim.token, hk = (run.history || []).length;
    try {
      if (pendingAnnounce) { var an = pendingAnnounce; pendingAnnounce = null; ui.announced = true; announce(an); await wait(1300, tok); }
      if (!replayed[hk]) {
        var first = (v.battle.lastRound || []).some(function (e) { return e.kind === 'enemyEnter' && (e.wave || 1) === 1; });
        if (first && !anim.skip && titleGate(v.level, 'battleIntro')) await playIntro(v, tok); // 叙事节奏 2026-11-13: the scene intro's level card is the opening card; 「战斗 · xx · 开始！」 only if it never showed (old saves)
        var evs1 = A.onceFilter(run, v.battle.lastRound || []); if ((v.battle.lastRound || []).some(function (e) { return e && e.once; })) save(); // 2026-11-14 第 11 关小铃登场: once per run, never on a reload
        try { await playRound(evs1, tok); } catch (err) { if (err === CANCEL) throw err; console.error('battle animation failed; showing the end state', err); document.body.classList.remove('fx-top'); }
        replayed[hk] = true; syncField(v);
      }
      anim.skip = false; var sb = $('skipBtn'); if (sb) sb.disabled = true;
      // lines that came with this action (advisor guidance etc.), unless the round already spoke them
      var spoken = JSON.stringify(v.battle.lastRound || []), extra = (v.events || []).filter(function (e) { return spoken.indexOf(JSON.stringify(e.text || '§')) < 0; });
      if (extra.length) { await new Promise(function (r) { eventsToQueue(extra, v, { inBattle: true }); say([], r); }); chk(tok); }
      var nx = RoundPlan.afterRound(v); // 修复 2026-11-14: a cleared wave rolls straight into the next one
      if (nx === 'nextWave') await nextWave(v, tok);
      else if (nx === 'pause') showPause(v);
      else if (nx === 'result') showResult(v);
      else { await wait(700, tok); screenKey = null; render(); }
    } catch (e) { if (e !== CANCEL) throw e; }
  }
  function syncField(v) { // snap every card to the round's end state (after a skip or a failed animation)
    v.battle.allies.concat(v.battle.enemies).forEach(function (u) { var el = cardEl(u.uid); if (!el) return; el.classList.remove('pre-enter', 'acting'); el.classList.toggle('down', u.hp <= 0); if (ui.field && ui.field[u.uid]) ui.field[u.uid].maxHp = u.maxHp; setHp(u.uid, u.hp); if (u.hp > 0) setBlock(u.uid, u.block || 0); }); // batch6 H2-14: max hp too · v38: the 护甲 badge too (it used to keep a stale number next to the end-state hp)
    app.querySelectorAll('[data-rich-own]').forEach(actingTipOff); // v39: a skipped beat gives the card its own tip back
  }
  function announce(an) {
    var d = fxDiv('toast', (an.face ? '<span class="toast-face">' + pic(an.face, '', '', '') + '</span>' : '') + '<b>' + esc(an.title) + '</b>' + (an.sub ? '<small>' + esc(an.sub) + '</small>' : ''), 960, 380);
    setTimeout(function () { d.remove(); }, 1500);
  }
  // 修复 2026-11-14「多波战斗」: wave N is down → 「第 N+1 波！」 card (~1.2 s), then 'continue' by itself; the next wave's
  // entrance (L11: the phase-2 show + her lines, which still wait for clicks) plays in that round. No pause bar here.
  // (the card says 「第 N 波 · 清除！」; 「第 N+1 波」 itself comes with the next round's 'wave' event)
  async function nextWave(v, tok) {
    var b = v.battle || {}; // the next round's own 'wave' event shows 「第 N 波」 (L11: the 第二阶段 show), so this card says the wave is down
    app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); });
    banner(T('ui.battle.waveCleared', { n: b.wave || 1 }), 'wave');
    await wait(1200, tok);
    if (view && view.phase === 'battle' && !ui.acted) { ui.acted = 1; doAct({ type: 'continue' }, true); }
  }
  function showPause(v) {
    var p = v.battle.pause || {}, sk = p.advisorSkill, items = p.items || [], w = $('pauseWrap'); if (!w) return;
    ui.mode = null; cue('pause', null, 400);
    w.innerHTML = '<div class="pausebar panel">' +
      '<button class="pbtn" data-act="pMove"' + (p.move === false ? ' disabled' : '') + ' data-tip="' + T('ui.pause.moveTip') + '">' + '<span class="pb-ic">⇄</span><b>' + T('ui.pause.move') + '</b></button>' +
      (sk ? '<button class="pbtn' + (sk.used ? ' used' : '') + '" data-act="pSkill"' + (sk.available ? '' : ' disabled') + ' data-tip="' + esc((sk.name ? T('ui.battle.skillTitle', { name: sk.name }) : '') + (sk.text || '') + T(sk.used ? 'ui.pause.skillUsed' : 'ui.pause.skillOnce')) + '"><span class="pb-ic face">' + pic(A.face(v.advisor && v.advisor.id, 'calm'), '', '', '') + '</span><b>' + T('ui.pause.advisor') + '</b><small>' + esc(sk.name || '') + '</small></button>'
        : '<button class="pbtn" disabled data-tip="' + T('ui.pause.advisorGoneTip') + '"><span class="pb-ic">✦</span><b>' + T('ui.pause.advisor') + '</b><small>' + T('ui.common.none') + '</small></button>') +
      '<button class="pbtn" data-act="pItem"' + (items.length ? '' : ' disabled') + ' data-tip="' + T('ui.pause.itemTip') + '"><span class="pb-ic">✚</span><b>' + T('ui.pause.item') + '</b><small>' + items.length + ' / 3</small></button>' +
      '<button class="pbtn" data-act="pLog" data-tip="' + esc(T('ui.settle.btnTip')) + '"><span class="pb-ic">' + A.glyph('power') + '</span><b>' + T('ui.settle.btn') + '</b></button>' + // v39「结算看得懂」: this battle's every action, explained
      '<button class="pbtn go" data-act="pContinue"><span class="pb-ic">▶</span><b>' + T('ui.common.continue') + '</b></button>' +
      '</div><div class="pause-sub" id="pauseSub"></div>'; // UI-CLEAN §2.8: 自动继续 is a ☰ 游戏组 switch now (prefs.autoCont)
    // v2.4 [15] root cause: the 继续 button used to take focus here, so the keyup of the Space / Enter that closed the round's
    // last line (or a key held through the animation) "clicked" it and the pause was skipped. Nothing takes focus now, and
    // 继续 ignores input that started before the bar was up (see pauseReady).
    var ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur();
    ui.pauseAt = nowMs(); ui.keysDown = {};
    if (prefs.autoCont) later(function () { if (!vnActive() && view && view.phase === 'battle' && !ui.mode) autoContinue(); }, 900 / spd());
  }
  function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); } // the dev driver freezes Date.now
  function setSpeed(n) {
    prefs.speed = n; lsSet(PKEY, prefs);
    document.querySelectorAll('[data-act="speed"]').forEach(function (b) { b.classList.toggle('on', +b.dataset.s === prefs.speed); });
    document.querySelectorAll('[data-act="speedCycle"]').forEach(function (b) { b.textContent = '×' + prefs.speed; });
  }
  function autoContinue() { if (ui.acted) return; ui.acted = 1; doAct({ type: 'continue' }, true); }
  // a real click / key counts only once the bar has been up a moment and the key was pressed after it appeared
  function pauseReady(e) { return !e || !e.isTrusted || (ui.pauseAt && nowMs() - ui.pauseAt > 450); }
  function pauseMode(mode, html) {
    ui.mode = mode; var s = $('pauseSub'), bar = app.querySelector('.pausebar');
    if (bar) bar.classList.toggle('moding', !!mode);
    app.querySelector('.battle').dataset.mode = mode || '';
    s.innerHTML = mode ? '<div class="psub panel">' + html + '<button class="btn-ghost" data-act="pCancel">' + T('ui.common.cancel') + '</button></div>' : '';
    app.querySelectorAll('.bcard.ally').forEach(function (c) { c.classList.remove('sel'); c.draggable = mode === 'move'; });
  }
  // v2.4 [16]: result music once per battle, when the panel appears; never again on a re-render or a regained focus
  var resultPlayed = {};
  function battleId(v) { return (run && run.seed) + ':L' + (v && v.level) + ':h' + ((run && run.history) || []).length; } // stable for one result screen
  function hasPlayResult() { var X = window.CHOOSER_AUDIO; return !!(X && typeof X.playResult === 'function'); }
  function resultMusic(v, win) {
    var bid = battleId(v); if (resultPlayed[bid]) return; resultPlayed[bid] = true;
    cue(win ? 'victory' : 'defeat', null, 0);
    if (hasPlayResult()) { try { window.CHOOSER_AUDIO.playResult(win ? 'victory' : 'defeat', actNo(), bid); } catch (e) { /* audio must never break the game */ } return; }
    applyTheme(v); // fallback: the scene map plays the one-shot result track (or its synth theme) now
  }
  function resultUp(w) { ui.resultAt = nowMs(); var ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur(); }
  function showResult(v) {
    var b = v.battle, win = b.win !== false, w = $('resultWrap'); if (!w) return;
    resultMusic(v, win);
    if (b.stats && b.stats.allies) { resultStats(v, w, win); return; }
    if (b.maxChain == null) b.maxChain = (b.log || b.lastRound || []).reduce(function (m, e) { return e.kind === 'chainEnd' || (e.kind === 'chain' && !e.missed) ? Math.max(m, e.depth || 0) : m; }, 0);
    if (!b.mvp && b.dps) b.mvp = Object.keys(b.dps).filter(function (id) { return member(id); }).sort(function (x, y) { return (b.dps[y].damage || 0) - (b.dps[x].damage || 0); })[0];
    var mvp = b.mvp ? (member(b.mvp) || { id: b.mvp, name: nameOf(b.mvp) }) : null;
    w.innerHTML = '<div class="result-wrap"><div class="result paper">' + heading(T(win ? 'ui.result.win' : 'ui.result.lose'), (b.rounds || b.round) ? T('ui.result.rounds', { n: b.rounds || b.round }) : '', win ? 'laurel' : 'grim') +
      (b.maxChain ? '<p class="chain-sum">' + T('ui.result.maxChain') + ' <b>×' + esc(b.maxChain) + '</b></p>' : '') +
      (mvp ? '<div class="mvp"><span class="mvp-face">' + pic(isLeader(mvp) ? A.face('leader', 'happy') : A.face(mvp.id, 'happy'), '', mvp.name, isLeader(mvp) ? crestHtml(true) : initialHtml(mvp.name)) + '</span><img class="crown" src="' + esc(A.icon('dps-crown')) + '" alt=""><b>' + esc(isLeader(mvp) ? T('ui.name.you') : mvp.name) + '</b></div>' : '') +
      '<div class="actions"><button class="btn btn-secondary btn-lg" data-act="pLog" data-tip="' + esc(T('ui.settle.btnTip')) + '">' + T('ui.settle.btn') + '</button><button class="btn btn-primary btn-lg" data-act="battleContinue">' + (win ? T('ui.common.continue') : '……') + '</button></div></div></div>'; // UI-CLEAN §2.9: 改判胜利 is in ☰ 试玩作弊 · v39: 战报 beside 继续
    resultUp(w);
  }
  // ===== v2.3 battle §D8 [5]: one clean stats table (per ally: damage, healing, taken, kills, longest 加成; MVP crown; rounds) =====
  function resultStats(v, w, win) {
    var b = v.battle, s = b.stats, rows = (s.allies || []).slice();
    var mvpKey = s.mvp && typeof s.mvp === 'object' ? (s.mvp.uid || s.mvp.id) : s.mvp;
    if (mvpKey == null && !('mvp' in s) && rows.length) mvpKey = rows.slice().sort(function (x, y) { return ((y.damage || 0) + (y.healed || 0)) - ((x.damage || 0) + (x.healed || 0)); })[0].uid;
    var rounds = s.rounds || b.rounds || b.round, best = rows.reduce(function (m, r) { return Math.max(m, r.maxChain || 0); }, 0);
    var COLS = ['damage', 'healed', 'taken', 'kills', 'maxChain'].map(function (k) { return [k, T('ui.result.col.' + k)]; });
    var body = rows.map(function (r) {
      var id = r.id, lead = isLeader(id), mvp = mvpKey != null && (r.uid === mvpKey || r.id === mvpKey), m = member(id) || {}, nm = lead ? T('ui.name.you') : (r.name || m.name || nameOf(id));
      var face = pic(lead ? A.face('leader', mvp ? 'happy' : 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }) : A.face(id, mvp ? 'happy' : 'calm'), '', nm, lead ? crestHtml(true) : initialHtml(nm));
      return '<tr class="' + (mvp ? 'is-mvp' : '') + '"><td><div class="rs-who"><span class="rs-face">' + face + '</span><b>' + esc(nm) + '</b>' +
        (mvp ? '<img class="rs-crown" src="' + esc(A.icon('dps-crown')) + '" alt="" data-tip="' + T('ui.result.mvpTip') + '">' : '') + '</div></td>' +
        COLS.map(function (c) { var n = r[c[0]] || 0; return '<td class="num' + (n === 0 ? ' zero' : '') + (c[0] === 'maxChain' && n && n === best ? ' best' : '') + '">' + (c[0] === 'maxChain' && n ? '×' : '') + esc(n) + '</td>'; }).join('') + '</tr>';
    }).join('');
    w.innerHTML = '<div class="result-wrap"><div class="result paper rs-panel">' + heading(T(win ? 'ui.result.win' : 'ui.result.lose'), rounds ? T('ui.result.roundsTotal', { n: rounds }) : '', win ? 'laurel' : 'grim') +
      '<table class="rs-table"><thead><tr><th></th>' + COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="actions"><button class="btn btn-secondary btn-lg" data-act="pLog" data-tip="' + esc(T('ui.settle.btnTip')) + '">' + T('ui.settle.btn') + '</button><button class="btn btn-primary btn-lg" data-act="battleContinue">' + (win ? T('ui.common.continue') : '……') + '</button></div></div></div>'; // UI-CLEAN §2.9: 改判胜利 is in ☰ 试玩作弊 · v39: 战报 beside 继续
    resultUp(w);
  }
  // ===== v2.3 §H: 「作弊：改判胜利」 on a lost battleResult and on gameOver (from a battle loss); ?nocheat=1 hides it.
  // Shown only when the engine accepts cheatWin in this phase (dry run; E.act is pure). =====
  var cheatLostMemo = { seq: -1, ok: false };
  function canCheatLost() {
    if (NOCHEAT || !run) return false;
    if (cheatLostMemo.seq === run.seq && cheatLostMemo.run === run) return cheatLostMemo.ok;
    var ok = false; try { E.act(DATA, run, { type: 'cheatWin' }); ok = true; } catch (e) { ok = false; }
    cheatLostMemo = { seq: run.seq, run: run, ok: ok }; return ok;
  }
  function cheatLostBtn() { return canCheatLost() ? '<button class="btn-ghost cheat-keys cheat-lost vn-pass" data-act="cheatLost" data-tip="' + T('ui.cheat.lostTip') + '">' + T('ui.cheat.lost') + '</button>' : ''; }

  // ---------- reward / debuff: card first, then who ----------
  function cardScreen(heavy) {
    return {
      plate: function (v) { return plate(levelText(v)); },
      html: function (v) {
        var opts = v.options || [], c = ui.card ? opts.filter(function (o) { return o.id === ui.card; })[0] : null;
        if (!c) {
          return heading(T(heavy ? 'ui.reward.heavyHeading' : 'ui.reward.heading'), T(heavy ? 'ui.reward.heavySub' : 'ui.reward.sub'), heavy ? 'grim' : 'laurel') + // feedback-1112 #11
            '<div class="three">' + opts.map(function (o) { return bigCard(o, heavy, v); }).join('') + '</div>';
        }
        // 2026-11-14 (user): a row of round heads to pick who, ONE big preview box for the selected one, 「确定」 gives it
        // 试玩 #9: nobody is picked at first — the box asks, 「确定」 waits for a head
        var ids = v.targets || [], has = (c && c.has) || [], sel = ids.indexOf(ui.who) >= 0 && has.indexOf(ui.who) < 0 ? ui.who : null; // 2026-11-15: keepsake holders can't be picked
        ui.who = sel;
        var whoName = function (m) { return whoNameOf(m, heavy); };
        var heads = ids.map(function (id) {
          var m = member(id) || { id: id, name: nameOf(id) }, art = unitArt({ id: id, side: 'ally', isLeader: isLeader(m) });
          if (has.indexOf(id) >= 0) return '<button class="who-head has" disabled aria-disabled="true" data-tip="' + esc(T('ui.reward.alreadyHas')) + '" title="' + esc(T('ui.reward.alreadyHas')) + '"><span class="wh-face">' + pic(art.list, '', m.name, art.fb) + '</span><b>' + esc(whoName(m)) + '</b></button>';
          return '<button class="who-head' + (id === sel ? ' on' : '') + '" data-act="whoSel" data-id="' + esc(id) + '" data-opt="w:' + esc(id) + '" aria-pressed="' + (id === sel) + '"><span class="wh-face">' + pic(art.list, '', m.name, art.fb) + '</span><b>' + esc(whoName(m)) + '</b></button>';
        }).join('');
        var detail = whoDetailHtml(c, sel, heavy);
        return heading(T(heavy ? 'ui.reward.heavyWho' : 'ui.reward.who'), heavy ? T('ui.reward.heavyWhoSub') : '', heavy ? 'grim' : '') +
          '<div class="picked">' + bigCard(c, heavy, v, true) + '<button class="btn-ghost back" data-act="unpickCard">' + T('ui.reward.swap') + '</button></div><div class="whos"><div class="who-heads">' + heads + '</div>' + detail + '</div>';
      }
    };
  }
  function whoNameOf(m, heavy) { return isLeader(m) ? T(heavy ? 'ui.reward.heavySelf' : 'ui.reward.self') : m.name; }
  // the one preview box of the 「给谁」 screen. 试玩 #9: no head picked → a prompt and a disabled 「确定」 (same box, same place)
  function whoDetailHtml(c, sel, heavy) {
    if (!sel) return '<div class="who-detail panel wd-empty"><div class="wd-body"><b class="wd-name">' + T('ui.reward.pickWhoPrompt') + '</b>' +
      '<button class="btn btn-primary wd-ok" disabled aria-disabled="true">' + T('ui.reward.confirm') + '</button></div></div>';
    var m = member(sel) || { id: sel, name: nameOf(sel) }, art = unitArt({ id: sel, side: 'ally', isLeader: isLeader(m) }), pv = c.preview && c.preview[sel];
    return '<div class="who-detail panel"><span class="wd-face">' + pic(art.list, '', m.name, art.fb) + '</span><div class="wd-body"><b class="wd-name">' + esc(whoNameOf(m, heavy)) + '</b>' +
      '<span class="who-sub">' + moodFace(m) + A.glyph('maxhp') + esc(m.maxHp) + ' ' + IC.atk + esc(m.atk) + '</span>' +
      (pv && pv.length ? previewHtml(pv) : '<span class="wd-none">' + T('ui.reward.noChange') + '</span>') +
      '<button class="btn btn-primary wd-ok" data-act="pickTarget" data-id="' + esc(sel) + '" data-opt="t:' + esc(sel) + '">' + T('ui.reward.confirm') + '</button></div></div>';
  }
  // 修复「三选一卡效果行消失」: flavour + one effect line for every choice card (A.cardFace; numbers bold by the **数字** rule)
  // 2026-11-14: a 生命上限 effect carries the heart-container icon ({i:maxhp}) — A.effLine only knows {i:hp}
  function maxIcon(s, e) { return e && e.stat === 'maxHp' ? String(s || '').replace('{i:hp}', '{i:maxhp}') : s; }
  function effIcon(e) { return maxIcon(A.effLine(e), e); }
  function cardFaceHtml(o) { var f = A.cardFace(o); if (o && o.effect && o.effect.stat === 'maxHp' && f.eff) f.eff = String(f.eff).replace('{i:hp}', '{i:maxhp}'); return (f.flavor ? '<span class="ch-text">' + esc(f.flavor) + '</span>' : '') + (f.eff ? '<span class="ch-eff">' + richText(f.eff) + '</span>' : ''); }
  function bigCard(o, heavy, v, small) {
    var ic = A.cardIcon(o, heavy), item = o.effect && o.effect.type === 'item';
    return '<button class="choice big-card' + (heavy ? ' bad' : '') + (small ? ' small' : '') + '" data-act="pickCard" data-id="' + esc(o.id) + '" data-opt="card:' + esc(o.id) + '"' + (small ? ' disabled' : '') + '>' +
      '<span class="ch-head tone-' + (heavy ? 'grey' : item ? 'pink' : 'gold') + '"><img src="' + esc(A.icon(ic)) + '" alt=""></span><b class="ch-name">' + esc(o.name) + '</b><span class="ch-rule"></span>' + cardFaceHtml(o) +
      (item ? '<span class="ch-note">' + T(v.bagFull ? 'ui.reward.bagFullNote' : 'ui.reward.toBag') + '</span>' : '') + (heavy ? '<span class="crack"></span>' : '') + '</button>';
  }
  SCREENS.reward = cardScreen(false);
  SCREENS.debuff = cardScreen(true);

  // ---------- sacrifice (雨中献祭): pick → she speaks → confirm; then the slow, devastating part ----------
  // §E8 memory fragments drifting around her portrait, and the 「查看她」 panel
  function sacMemory(v, id) {
    var t = (v.targets || []).filter(function (x) { return x && typeof x === 'object' && x.id === id; })[0];
    return (t && t.memory) || (v.memory && v.memory[id]) || (v.memories && v.memories[id]) || [];
  }
  // 修复「献祭浮字挡脸」: fragment slots come from A.sacFragSlots (px inside .mem-frags), none over her face or the info plate
  function memFrags(list) {
    return '<div class="mem-frags" aria-hidden="true">' + (list || []).slice(0, 8).map(function (s, i) {
      var p = A.sacFragSlots()[i % 8], sz = [1.0, 0.85, 1.25, 0.9, 1.1, 0.85, 1.0, 0.9][i % 8];
      return '<span class="mem-frag" style="left:' + p.x + 'px;top:' + p.y + 'px;--s:' + sz + ';--d:' + (i * 0.015).toFixed(3) /* feedback-1112 #13: all in ≤ 0.3 s */ + 's;--t:' + (9 + (i % 3) * 2.5) + 's;--bx:' + A.sacFragDrift(i) + 'px">' + esc(s) + '</span>';
    }).join('') + '</div>';
  }
  function herPanel(id) {
    var m = member(id) || { id: id, name: nameOf(id) }, c = cand(id) || {};
    return '<div class="her-panel"><div class="hp-left"><div class="hp-face">' + pic(A.face(id, 'calm'), '', m.name, initialHtml(m.name)) + '</div><h2>' + esc(m.name) + '</h2>' +
      (c.bio ? '<p class="hp-bio">' + esc(c.bio) + '</p>' : '') + (c.look ? '<p class="hp-look"><b>' + T('ui.profile.look') + '</b>' + esc(c.look) + '</p>' : '') + '</div>' +
      '<div class="hp-right"><div class="hp-stats">' + roleBadge(m.role || c.role) + '<span class="num">' + IC.hp + ' ' + esc(m.hp != null ? m.hp + ' / ' + m.maxHp : m.maxHp || c.hp) + '　' + IC.atk + ' ' + esc(m.atk || c.atk) + '</span>' + moodFace(m) + bondMark(m) + '</div>' +
      rowsHtml(m.actionText !== undefined ? m : c) + '<div class="chips">' + statusChips(m.statuses) + '</div></div>' +
      '<div class="row center-row hp-foot"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.close') + '</button></div></div>';
  }
  SCREENS.sacrifice = {
    plate: function (v) { return plate(levelText(v)); },
    html: function (v) {
      var random = (v.modes || []).indexOf('random') >= 0, targets = (v.targets || []).map(function (t) { return typeof t === 'string' ? t : t && t.id; }).filter(function (id) { return id && id !== 'leader'; });
      var list = targets.map(function (id) {
        var m = member(id) || { id: id, name: nameOf(id) };
        return '<button class="sac-row' + (ui.pending === id ? ' sel' : '') + '" data-act="nameTarget" data-id="' + esc(id) + '" data-opt="t:' + esc(id) + '"><span class="sr-face">' + pic(A.face(id, moodExpr(m.mood)), '', m.name, initialHtml(m.name)) + '</span>' +
          '<span class="sr-name">' + esc(m.name) + bondMark(m) + '</span>' + moodFace(m) + '</button>';
      }).join('');
      var sf = ui.sac || { step: 'pick' }, sel = ui.pending ? member(ui.pending) || { id: ui.pending, name: nameOf(ui.pending) } : null, fw = sel && (v.farewells || {})[sel.id];
      var ready = sel && sf.step === 'ask' && sf.id === sel.id; // batch6 H2-10
      return '<div class="sac-vignette" aria-hidden="true"></div><div class="sac-left">' + (sel ? memFrags(sacMemory(v, sel.id)) + '<div class="sac-bust tone-' + esc((fw && fw.tone) || 'none') + '">' + pic(A.portrait(sel.id), 'stand-img', sel.name, '') + '</div>' +
          '<button class="btn-ghost view-her vn-pass" data-act="viewHer" data-id="' + esc(sel.id) + '">' + T('ui.sacrifice.viewHer') + '</button>' : '<div class="sac-empty">' + T('ui.sacrifice.empty') + '<br>' + T('ui.sacrifice.emptyHint') + '</div>') + '</div>' +
        '<aside class="sac-panel"><h2 class="sac-title"><span>' + T('ui.sacrifice.title') + '</span></h2><div class="sac-list n' + targets.length + '">' + list + '</div>' +
        (random ? '<button class="btn btn-secondary warn-btn has-bell" data-act="modeRandom" data-opt="m:random">' + (A.grantsBell('random', 'sacrifice') ? A.bellSvg('opt-bell') : '') + '<img src="' + esc(A.icon('dice')) + '" alt="">' + T('ui.sacrifice.byRule') + '</button>' : '') +
        ((v.modes || []).indexOf('self') >= 0 ? '<button class="btn self-btn warn-btn" data-act="modeSelf" data-opt="m:self"><i class="key-g kg-quill"></i>' + T('ui.sacrifice.self') + '</button>' : '') + '</aside>' +
        '<div class="sac-actions">' + (!sel ? '' : ready ? '<button class="btn btn-secondary sac-cancel" data-act="fwBack">' + T('ui.common.cancel') + '</button><button class="btn btn-primary btn-lg sac-confirm" id="fwConfirm" data-act="confirmName">' + T('ui.sacrifice.confirm') + '</button>' // batch6 H2-10 ③
          : sf.step === 'picked' ? '<button class="btn-ghost" data-act="fwBack">' + T('ui.sacrifice.giveUp') + '</button><button class="btn btn-primary btn-lg" id="fwWrite" data-act="sacWrite">' + T('ui.sacrifice.write', { name: esc(sel.name) }) + '</button>' : '') + '</div>';
    },
    enter: function (v) { if (v.suggestion && v.advisor && v.advisor.present !== false && !ui.pending) say([{ speaker: v.advisor.id, text: v.suggestion.text, expr: 'calm', tag: T('ui.sacrifice.whisperTag') }]); },
    after: function () { // batch6 H2-10 ③: hovering 确认 — the screen trembles a little and the view blurs (hesitation)
      if (ui.sacBreaking) return; sacGrow.stop(); // r2: hovering also grows the button slowly and darkens the view (A.sacHover)
      var b = $('fwConfirm'); if (!b) { app.classList.remove('sac-hesitate'); return; }
      var on = function () { app.classList.add('sac-hesitate'); sacGrow.go(b, 1); }, off = function () { if (ui.sacBreaking) return; app.classList.remove('sac-hesitate'); sacGrow.go(b, -1); };
      b.addEventListener('mouseenter', on); b.addEventListener('focus', on); b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
    }
  };
  // 献祭「确认」演出 r2: hover growth loop (A.sacHover / A.sacHoverStep) and the click → fade → shatter → black → next (A.sacBreakPlan)
  var sacGrow = { ms: 0, dir: 0, raf: 0, last: 0, b: null,
    go: function (b, dir) { this.b = b; this.dir = dir; if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame(sacGrowTick); } },
    stop: function () { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.ms = 0; this.dir = 0; this.b = null; app.style.removeProperty('--sac-dark'); } };
  function sacGrowTick(now) {
    var g = sacGrow; g.raf = 0; if (!g.b || !g.b.isConnected) { g.stop(); return; }
    var dt = g.last ? Math.min(100, now - g.last) : 16; g.last = now;
    g.ms = A.sacHoverStep(g.ms, dt, g.dir);
    var h = A.sacHover(g.ms, now, REDUCED); g.b.style.transform = h.transform; app.style.setProperty('--sac-dark', h.dark);
    if (g.dir > 0 || g.ms > 0) g.raf = requestAnimationFrame(sacGrowTick); else g.b.style.transform = '';
  }
  function sacBreak(b, done) {
    var plan = A.sacBreakPlan(REDUCED), finished = false;
    var finish = function () { // runs exactly once, always (plain setTimeout: clearTimers() on a render must not cancel it)
      if (finished) return; finished = true;
      app.classList.remove('sac-breaking', 'sac-shatter', 'sac-hesitate'); app.style.removeProperty('--sac-dark');
      var blk = document.createElement('div'); blk.className = 'sac-black'; blk.style.transitionDuration = plan.fadeInMs + 'ms'; stageEl.appendChild(blk);
      try { done(); } finally {
        ui.sacBreaking = 0;
        requestAnimationFrame(function () { requestAnimationFrame(function () { blk.classList.add('out'); }); });
        setTimeout(function () { if (blk.parentNode) blk.parentNode.removeChild(blk); }, plan.fadeInMs + 120);
      }
    };
    app.style.setProperty('--sac-fade', plan.fadeMs + 'ms'); app.classList.add('sac-breaking');
    if (b && !REDUCED) { // the button alone, drifting to the centre of the dark
      var sh = A.sacCenterShift(A.rectToStage(b.getBoundingClientRect(), liveFit()), { left: 0, top: 0, width: STAGE_W }); // stage px (turned-safe)
      b.style.transition = 'transform ' + plan.fadeMs + 'ms ease-in-out'; b.style.transform = 'translate(' + sh.dx + 'px, ' + sh.dy + 'px) scale(' + A.SAC_CONFIRM.scaleMax + ')';
    }
    setTimeout(function () { app.classList.add('sac-shatter'); if (b && !REDUCED && b.isConnected) sacShatter(b, plan); }, plan.at.shatter);
    setTimeout(finish, plan.total);
  }
  function sacShatter(b, plan) {
    var host = b.parentNode, base = b.style.transform || '';
    A.sacShards().forEach(function (sd) {
      var c = b.cloneNode(true); c.removeAttribute('id'); c.removeAttribute('data-act'); c.setAttribute('aria-hidden', 'true'); c.tabIndex = -1;
      c.className += ' sac-shard'; c.style.left = b.offsetLeft + 'px'; c.style.top = b.offsetTop + 'px'; c.style.width = b.offsetWidth + 'px'; c.style.height = b.offsetHeight + 'px';
      c.style.clipPath = c.style.webkitClipPath = sd.clip; c.style.transition = 'transform ' + plan.shatterMs + 'ms cubic-bezier(.2,.7,.3,1), opacity ' + plan.shatterMs + 'ms ease-in';
      c.style.transform = base; host.appendChild(c);
      requestAnimationFrame(function () { requestAnimationFrame(function () { c.style.transform = base + ' translate(' + sd.dx + 'px, ' + sd.dy + 'px) rotate(' + sd.rot + 'deg)'; c.style.opacity = '0'; }); });
    });
    b.style.visibility = 'hidden';
  }
  function sacConfirmNow() { // the original confirm action (batch6 H2-10 ③), run when the shatter is over
    if (!ui.pending || ui.fwDone !== ui.pending || !ui.sac || ui.sac.step !== 'ask') { render(); return; }
    ui.sac = A.sacFlow(ui.sac, 'confirm'); app.classList.remove('sac-hesitate'); closeModal();
    var id = ui.pending;
    doAct({ type: 'sacrifice', mode: 'name', target: id }, true, { farewellsViewed: (ui.viewed || []).slice() }, { pre: function (pv) { return withFarewell(sacrificeFx([id], pv.party, false), [id]); } });
  }
  // batch6 H2-10 ①: picking her shows only her portrait and a few floating words (name / state); she does not speak yet
  function sacPickFloat(id) {
    var m = member(id) || { name: nameOf(id) }, bust = app.querySelector('.sac-bust'); if (!bust) return;
    var bits = [m.name, m.hp != null ? T('ui.sacrifice.hp', { hp: m.hp, maxHp: m.maxHp }) : '', MOOD_WORD[m.mood] ? T(MOOD_WORD[m.mood]) : ''].filter(Boolean);
    bits.forEach(function (t, i) { var d = document.createElement('span'); d.className = 'sac-float sf-' + i; d.textContent = t; d.style.animationDelay = (i * 0.18).toFixed(2) + 's'; bust.appendChild(d); });
  }
  var MOOD_WORD = { '-2': 'ui.sacrifice.mood.m2', '-1': 'ui.sacrifice.mood.m1', '0': 'ui.sacrifice.mood.0', '1': 'ui.sacrifice.mood.1', '2': 'ui.sacrifice.mood.2' }; // text keys
  function sacAskLine(id) { var A2 = DATA.linesV2 && DATA.linesV2.sacrificeAsk, l = A2 && A2[id]; return normLine(l && l.text ? l : { speaker: id, text: T('ui.sacrifice.askFallback'), expr: 'sad' }); }
  function playFarewell(id) {
    var fw = (view.farewells || {})[id], m = member(id) || { name: nameOf(id) };
    vnClear();
    var ls = fw && fw.lines && fw.lines.length ? fw.lines : fw && fw.text ? [{ speaker: id, speakerId: id, name: m.name, text: fw.text, expr: fw.expr }] : [{ speaker: 'narrator', text: T('ui.sacrifice.silent', { name: m.name }) }];
    ls = ls.map(function (x) { var o = normLine(x); if (o && o.speaker !== 'narrator') { o.tone = fw && fw.tone; if (!o.expr) o.expr = fw && fw.tone === 'bewildered' ? 'shock' : 'calm'; } return o; });
    var ask = sacAskLine(id); if (ask) { ask.speakerId = ask.speakerId || id; ask.name = ask.name || m.name; ls = ls.concat([ask]); } // batch6 H2-10 ②
    say(ls, function () { if (ui.pending !== id) return; ui.sac = A.sacFlow(ui.sac, 'spoke', id); ui.fwDone = ui.sac.step === 'ask' ? id : null; render(); });
  }

  // ---------- ending ----------
  var FATE_ORDER = { survived: 0, sacrificed: 1, rejected: 2 };
  function endingHtml(v) {
    var s = v.summary || {}, win = s.outcome === 'victory', page = ui.page || 'fates';
    var fates = (s.fates || []).filter(function (f) { return FATE_ORDER[f.fate] != null; }).sort(function (a, b) { return FATE_ORDER[a.fate] - FATE_ORDER[b.fate]; });
    var a = s.advisor, advCard = a ? '<div class="fcard boss"><div class="fc-art">' + pic(A.portrait(a.id, { variant: 'boss' }), 'fc-img', a.name, initialHtml(a.name)) + '<span class="fc-ribbon">' + T('ui.ending.advisorRibbon') + '</span></div><div class="fc-body"><b>' + esc(a.name) + '</b><div class="fc-bits">' + T(a.defeated ? 'ui.ending.advisorDefeated' : 'ui.ending.advisorWaiting') + '</div></div></div>' : '';
    var body = page === 'q' ? questionnaireHtml() : '<div class="fate-board"><div class="fate-grid">' + (fates.map(function (f) { return fateCard(f, win); }).join('') || '<p class="dim">' + T('ui.ending.nobody') + '</p>') + advCard + '</div></div>';
    if (s.outcome === 'true') win = true;
    var trueEnd = s.outcome === 'true';
    if (trueEnd && s.trueEnding && s.trueEnding.restored) { var rs = s.trueEnding.restored; fates = fates.map(function (f) { if (rs.indexOf(f.id) < 0) return f; var o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); o.restored = true; return o; }); }
    return (trueEnd ? '<div class="true-crest"><img src="' + esc(A.crest(false)) + '" alt=""><b>' + T('ui.ending.trueCrest') + '</b></div>' : '') +
      heading(trueEnd ? T('ui.ending.trueHeading') : win ? T('ui.ending.winHeading') : T('ui.ending.loseHeading', { level: s.reachedLevel || v.level }), trueEnd ? T('ui.ending.trueSub') : '', win ? (trueEnd ? 'true' : '') : 'grim') +
      '<div class="tabs"><button class="tab' + (page === 'fates' ? ' on' : '') + '" data-act="page" data-p="fates">' + T('ui.ending.tabFates') + '</button><button class="tab' + (page === 'q' ? ' on' : '') + '" data-act="page" data-p="q">' + T('ui.ending.tabQuestions') + '</button></div>' +
      '<div class="ending-body">' + body + '</div><div class="ending-foot"><button class="btn btn-secondary btn-lg" data-act="export">' + T('ui.ending.export') + '</button><button class="btn btn-primary btn-lg" data-act="endHome">' + T('ui.ending.home') + '</button></div>'; // feedback-1112 #43
  }
  var FATE_LABEL = lazy(function () { return { survived: [T('ui.ending.fate.survived'), T('ui.ending.fate.survivedLose')], sacrificed: [T('ui.ending.fate.sacrificed'), T('ui.ending.fate.sacrificed')], rejected: [T('ui.ending.fate.rejected'), T('ui.ending.fate.rejected')] }; });
  function fateCard(f, win) {
    if (f.restored) {
      var c0 = cand(f.id) || {};
      return '<div class="fcard fate-restored"><div class="fc-art">' + pic(A.face(f.id, 'happy'), 'fc-img', f.name, initialHtml(f.name)) + roleBadge(c0.role, 'uc-role') + '<span class="fc-ribbon">' + T('ui.ending.restored') + '</span></div>' +
        '<div class="fc-body"><b>' + esc(f.name) + '</b><div class="fc-bits">' + esc(T(f.fate === 'survived' ? 'ui.ending.restored.survived' : f.fate === 'sacrificed' ? 'ui.ending.restored.sacrificed' : 'ui.ending.restored.rejected')) + '</div></div></div>';
    }
    var c = cand(f.id) || {}, bits = [];
    if (f.round) bits.push(T('ui.ending.bit.round', { round: f.round }));
    if (f.sacrificedAt) bits.push(T(f.mode === 'random' ? 'ui.ending.bit.takenByRule' : 'ui.ending.bit.named', { level: f.sacrificedAt }));
    if (f.enemyAt && f.enemyAt.length) bits.push(T('ui.ending.bit.enemyAt', { levels: f.enemyAt.join(T('ui.list.sep')) }));
    if (win && (f.fate === 'sacrificed' || f.fate === 'rejected')) bits.push(T('ui.ending.bit.toy')); // feedback-1112 #41: the same fate for both
    var list = f.fate === 'survived' ? A.face(f.id, 'happy') : A.face(f.id, f.fate === 'sacrificed' ? 'possessed-blank' : 'vengeful-tears', { variant: f.fate === 'sacrificed' ? 'possessed' : 'vengeful' });
    return '<div class="fcard fate-' + esc(f.fate) + '"><div class="fc-art">' + pic(list, 'fc-img', f.name, initialHtml(f.name)) + roleBadge(c.role, 'uc-role') + '<span class="fc-ribbon">' + FATE_LABEL()[f.fate][win ? 0 : 1] + '</span></div>' +
      '<div class="fc-body"><b>' + esc(f.name) + '</b><div class="fc-bits">' + esc(bits.join(' · ')) + '</div></div></div>';
  }
  var QUESTIONS = lazy(function () { return ['hesitate', 'care', 'sacrifice', 'returned', 'foreshadow'].map(function (k) { return [k, T('ui.questions.' + k)]; }); });
  var RATINGS = lazy(function () { return ['overall', 'sacrificePain', 'oldFriendImpact'].map(function (k) { return [k, T('ui.questions.rate.' + k)]; }); });
  function qState() { var all = lsGet(QKEY, {}); return all[run.seed] || { answers: {}, ratings: {} }; }
  function qSave(q) { var all = lsGet(QKEY, {}); all[run.seed] = q; if (!lsSet(QKEY, all)) notice(T('ui.questions.saveFailed')); }
  function questionnaireHtml() {
    var q = qState();
    return '<div class="q"><div class="q-left">' + QUESTIONS().map(function (x) { return '<label for="q-' + x[0] + '">' + esc(x[1]) + '</label><textarea id="q-' + x[0] + '" data-q="' + x[0] + '">' + esc(q.answers[x[0]] || '') + '</textarea>'; }).join('') +
      '</div><div class="q-right"><p class="q-note">' + T('ui.questions.note') + '</p>' + RATINGS().map(function (r) {
        var b = ''; for (var i = 0; i <= 5; i++) b += '<button class="' + (q.ratings[r[0]] === i ? 'sel' : '') + '" data-act="rate" data-r="' + r[0] + '" data-v="' + i + '">' + i + '</button>';
        return '<label>' + esc(T('ui.questions.rateLabel', { label: r[1] })) + '</label><div class="rate">' + b + '</div>';
      }).join('') + '</div></div>';
  }
  function bindQuestionnaire() { app.querySelectorAll('textarea[data-q]').forEach(function (t) { t.addEventListener('input', function () { var q = qState(); q.answers[t.dataset.q] = t.value; qSave(q); }); }); }
  SCREENS.ending = {
    html: endingHtml, after: bindQuestionnaire,
    enter: function (v) {
      var s = v.summary || {}, k = 'end:' + run.seed;
      if (replayed[k]) return; replayed[k] = true;
      // 修复 2026-11-14: the true ending skips the per-person epilogue dialogue (it is folded into the credits cards)
      var hasEpi = !!(s.epilogue && s.outcome === 'victory'), white = s.outcome === 'victory' && !!s.whiteout;
      // feedback-1112 #42: the fates board stays hidden until every cinematic is over (no afterimage under the white)
      if (hasEpi || white || s.outcome === 'true') document.body.classList.add('end-hold');
      var release = function () { document.body.classList.remove('end-hold'); cineDone(); };
      var epiThen = function (after) { if (hasEpi) { ui.audioHold = true; playEpilogue(s.epilogue, { victory: s.outcome, done: after }); } else after(); };
      // feedback-1112 #42: the normal ending plays the white text FIRST, then everyone's fates, then the stats;
      // the true ending keeps fates → the lineup at dawn → the stats
      if (white) playWhiteout(s.whiteout, function () { epiThen(release); });
      else if (s.outcome === 'true') playTrueEnding(s, function () { playCredits(s, release); }); // 2026-11-14: the dawn lines, then straight into the credits (song + auto-playing cards; each person's epilogue is folded into her card) → white → title
      else epiThen(release);
    }
  };
  function cineDone() { document.body.classList.remove('epi-on'); ui.audioHold = false; if (view) applyTheme(view); }
  // §6 normal ending: the screen floods white, 「终于结束了。」, a pause, 「……吗？」, then the victory stats
  function playWhiteout(w, done) {
    var caps = (w && w.captions && w.captions.length ? w.captions : TL('ui.trueEnd.captions')).map(esc);
    ui.audioHold = true; sceneAudio({ phase: 'story', storyId: 'whiteout', scene: 'white-room', act: actNo(), level: view.level });
    document.body.classList.add('epi-on');
    sayFx(stages([
      [function () { cue('whiteout', null, 0); cine('whiteout', '<div class="wo-room" style=\'background-image:' + A.scene('white-room').map(function (c) { return 'url("' + esc(splitCand(c).src) + '")'; }).join(', ') + '\'></div><div class="wo-flood"></div><div class="wo-cap" id="woCap"></div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 2600],
      [function () { var c = $('woCap'); if (c) { c.innerHTML = '<span class="wo-1">' + caps[0] + '</span>'; c.classList.add('on'); } }, 2800],
      [function () { var c = $('woCap'); if (c && caps[1]) c.insertAdjacentHTML('beforeend', '<span class="wo-2">' + caps[1] + '</span>'); }, 3400],
      [function () { cineEl.classList.add('fade'); }, 1800],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; cineDone(); if (done) done(); }, 10]
    ]));
  }
  // §6 true ending: every restored girl's own cut-out lines up at the guild at dawn, the lines play, then the stats with the 真结局 crest
  function playTrueEnding(s, done) {
    var te = s.trueEnding || {}, ids = (te.restored || []).filter(function (id) { return A.isCandidate(id); });
    ids.splice(Math.floor(ids.length / 2), 0, 'leader'); // v2.3 §E2: the leader stands in the middle of the lineup
    ui.audioHold = true; sceneAudio({ phase: 'ending', outcome: 'true', scene: 'guild-dawn-full', act: actNo(), level: view.level });
    document.body.classList.add('epi-on');
    var bgs = A.scene('guild-dawn-full').map(function (c) { return 'url("' + esc(splitCand(c).src) + '")'; }).join(', '), n = ids.length || 1;
    var row = ids.map(function (id, i) {
      var x = n === 1 ? 50 : 8 + 84 * i / (n - 1), mid = Math.abs(x - 50) / 50;
      var me = id === 'leader';
      return '<div class="te-girl' + (me ? ' te-leader' : '') + '" style="left:' + x.toFixed(1) + '%;--d:' + (0.35 * i).toFixed(2) + 's;--s:' + (me ? 1.04 : 1 - mid * 0.12).toFixed(3) + ';z-index:' + (me ? 30 : 20 - Math.round(mid * 10)) + '">' + pic(A.portrait(id), 'stand-img', me ? T('ui.name.leader') : nameOf(id), me ? crestHtml() : '') + '</div>';
    }).join('');
    sayFx(stages([[function () { cine('true-end', '<div class="te-bg" style=\'background-image:' + bgs + '\'></div><div class="te-row">' + row + '</div><div class="te-glow"></div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); cue('bell', { act: 1 }, 0); }, 1600 + 350 * n]]));
    var ls = (te.lines || []).map(function (l) { var o = normLine(l); if (!o) return null; if (!o.speakerId) o.speakerId = speakerId(o); if (!o.name && o.speakerId && !NO_NAME[o.speakerId]) o.name = nameOf(o.speakerId); o.vnClass = 'epi-vn dawn'; return o; }).filter(Boolean);
    say(ls);
    sayFx(stages([[function () { cineEl.classList.add('out'); }, 1200], [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; cineDone(); if (done) done(); }, 10]]));
  }
  // ---------- 2026-11-14 真结局片尾: dawn → the ending song → each person's story → staff → white light → title ----------
  // The pure parts (who gets a card, what it says, the timeline) live in ui/credits.js. A click (or a key) jumps to the next
  // beat, a long press (or a held key) skips to the white; a watchdog always ends it, so the run can never hang here.
  var credits = { tok: 0, end: null };
  function playCredits(s, done) {
    var CR = window.ChooserCredits, t = ++credits.tok;
    if (!CR) { if (done) done(); return; } // module missing: the old ending (stats board)
    var people = CR.cards(s, run, DATA), staff = CR.staff(DATA), closing = people.length && people[people.length - 1].closing ? people[people.length - 1] : null, segs = CR.plan(people.length, staff.rows.length, { reduced: REDUCED, closing: !!closing });
    var i = -1, timer = null, dog = null, holdT = null, keyAt = 0, ended = false, replanned = false;
    ui.audioHold = true; document.body.classList.add('end-hold', 'epi-on');
    au('themeSong'); // music/theme-song.mp3; missing → dawn, silently
    var bgs = A.scene('guild-dawn-full').map(function (c) { return 'url("' + esc(splitCand(c).src) + '")'; }).join(', ');
    var el = document.createElement('div'); el.className = 'credits white';
    el.innerHTML = '<div class="cr-dawn" style=\'background-image:' + bgs + '\'></div><div class="cr-cap" id="crCap"></div><div class="cr-stage" id="crStage"></div>' +
      '<div class="cr-white"></div><div class="cr-hint">' + T('ui.credits.hint') + '</div>';
    stageEl.appendChild(el); void el.offsetWidth; requestAnimationFrame(function () { el.classList.remove('white'); }); // opens out of white
    function art(a) {
      if (!a) return '';
      if (a.id === 'leader') return pic(A.portrait('leader'), 'stand-img', '', crestHtml());
      return pic(A.portrait(a.id, a.variant && a.variant !== 'base' ? { variant: a.variant } : {}), 'stand-img', '', initialHtml(nameOf(a.id)));
    }
    function cardHtml(c, k) {
      var past = c.past ? '<div class="cr-past">' + pic(A.face(c.past.id, c.past.expr, c.past.variant && c.past.variant !== 'base' ? { variant: c.past.variant } : {}), '', '', '') + '<small>' + T('ui.credits.thisRun') + '</small></div>' : '';
      return '<div class="cr-card k-' + esc(c.kind) + (k % 2 ? ' right' : '') + '"><div class="cr-art">' + art(c.art) + '</div>' +
        '<div class="cr-text">' + past + '<div class="cr-sub">' + esc(c.sub) + '</div><div class="cr-name">' + esc(c.name) + '</div>' +
        crParas(c).map(function (l, j) { return '<p class="' + l.cls + '" style="--d:' + (0.6 + 0.7 * j).toFixed(1) + 's">' + l.html + '</p>'; }).join('') + '</div></div>';
    }
    // 2026-11-14 片尾人物数据亮点: her 3 numbers (**n** → bold) + her epilogue line; without numbers, the story lines as before
    function crBold(t) { return esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
    function crParas(c) {
      var st = Array.isArray(c.stats) ? c.stats : [];
      if (!st.length) return c.lines.map(function (l) { return { cls: '', html: esc(l) }; });
      return st.map(function (l) { return { cls: 'cr-stat', html: crBold(l) }; }).concat(c.tail ? [{ cls: 'cr-tail', html: esc(c.tail) }] : []);
    }
    function closingHtml() { // the leader card's last word, then the one fixed line that closes all the cards
      return '<div class="cr-closing">' + (closing.outro ? '<p class="cr-outro">' + esc(closing.outro) + '</p>' : '') + '<p class="cr-close">' + esc(closing.closing) + '</p></div>';
    }
    function staffHtml() {
      return '<div class="cr-staff"><h2>' + esc(staff.title) + '</h2>' + staff.rows.map(function (r) {
        return '<div class="cr-row"><span class="cr-role">' + esc(r.role) + '</span><span class="cr-names">' + r.names.map(esc).join('<br>') + '</span></div>'; }).join('') + '</div>';
    }
    function show(k) {
      var sg = segs[k], box = $('crStage'), cap = $('crCap'); if (!sg || !box) return;
      if (sg.kind === 'dawn') { if (cap) { cap.textContent = staff.dawnCaption || ''; setTimeout(function () { if (cap.isConnected) cap.classList.add('on'); }, REDUCED ? 50 : 2200); } return; } // the lead-in: nothing written at first
      if (cap) cap.classList.remove('on');
      if (sg.kind === 'white') { el.classList.add('white'); return; }
      box.innerHTML = sg.kind === 'card' ? cardHtml(people[sg.i], sg.i) : sg.kind === 'closing' ? closingHtml() : sg.kind === 'staff' ? staffHtml() : '<div class="cr-thanks">' + esc(staff.thanks) + '</div>';
      el.classList.toggle('dim', sg.kind !== 'card');
      requestAnimationFrame(function () { var c = box.firstChild; if (c) c.classList.add('on'); });
    }
    function step() {
      clearTimeout(timer); if (ended || t !== credits.tok) return;
      i++;
      if (i === 1 && !replanned) { // the song is loaded by now: lay the cards along it (ailan: the plan follows the song)
        replanned = true; var ms = au('trackMs', 'themeSong');
        if (ms) { segs = CR.plan(people.length, staff.rows.length, { reduced: REDUCED, songMs: ms, closing: !!closing }); armDog(); }
      }
      if (i >= segs.length) { finish(); return; }
      show(i); timer = setTimeout(step, segs[i].ms);
    }
    function armDog() { clearTimeout(dog); dog = setTimeout(finish, segs.total + 15000); } // never hangs
    function skipAll() { if (ended) return; i = segs.length - 2; step(); } // → the white beat, then the title
    function finish() {
      if (ended) return; ended = true; clearTimeout(timer); clearTimeout(dog); clearTimeout(holdT);
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true);
      credits.end = null; el.classList.add('white');
      ui.audioHold = false;
      // the shared white light back to the title (H.endHome → H.home, which takes the credits layer away under the white)
      if (H && H.endHome) { H.endHome(); setTimeout(kill, 2600); } // backstop: the layer never outlives the title
      else { kill(); if (done) done(); }
    }
    function kill() { // also called by H.home (whatever sends the player home ends the credits)
      ended = true; clearTimeout(timer); clearTimeout(dog); clearTimeout(holdT); credits.end = null; credits.kill = null;
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true);
      if (el.isConnected) el.remove();
    }
    function onDown(e) { e.preventDefault(); e.stopPropagation(); clearTimeout(holdT); holdT = setTimeout(function () { holdT = null; skipAll(); }, CR.HOLD_MS); }
    function onUp(e) { e.stopPropagation(); if (holdT) { clearTimeout(holdT); holdT = null; step(); } } // a tap: the next beat at once
    function onKey(e) { e.preventDefault(); e.stopPropagation(); if (!keyAt) keyAt = Date.now(); else if (Date.now() - keyAt >= CR.HOLD_MS) { keyAt = 0; skipAll(); } }
    function onKeyUp(e) { e.preventDefault(); e.stopPropagation(); if (keyAt) { keyAt = 0; step(); } }
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey, true); document.addEventListener('keyup', onKeyUp, true);
    credits.end = finish; credits.kill = kill; armDog(); step();
  }
  // ---------- defeat epilogue: intro → each girl's fate → the leader → the advisor slips away → outro → black → title ----------
  var epi = { tok: 0 };
  SCREENS.gameOver = {
    html: function (v) { return v.summary && v.summary.epilogue ? '' : endingHtml(v); }, // UI-CLEAN §2.12: 改判胜利 is in ☰
    after: function (v) { if (!(v.summary && v.summary.epilogue)) bindQuestionnaire(); },
    enter: function (v) { if (v.summary && v.summary.epilogue) playEpilogue(v.summary.epilogue); }
  };
  function epiLines(list, extra) { return (list || []).map(function (l) { var o = normLine(l); if (!o) return null; if (o.speaker === 'advisor' && view.advisor) o.speakerId = view.advisor.id; if (extra) extra(o); o.vnClass = 'epi-vn'; return o; }).filter(Boolean); }
  function epiWait(ms, t) { return new Promise(function (r) { setTimeout(r, REDUCED ? Math.min(ms, 300) : ms); }).then(function () { if (t !== epi.tok) throw CANCEL; }); }
  function epiSay(lines, t) { return sayP(lines).then(function () { if (t !== epi.tok) throw CANCEL; }); }
  function epiShow(list, name, sub, faceList) {
    var st = $('epStand'), nm = $('epName'); if (!st) return;
    st.className = 'ep-stand'; st.innerHTML = list ? pic(list, 'stand-img', '', '') : '';
    nm.className = 'ep-name'; nm.innerHTML = name ? esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + (faceList ? '<span class="ep-face">' + pic(faceList, '', '', '') + '</span>' : '') : '';
    requestAnimationFrame(function () { if (list) st.classList.add('on'); if (name) nm.classList.add('on'); });
  }
  function epiHide() { var st = $('epStand'), nm = $('epName'); if (st) st.classList.remove('on'); if (nm) nm.classList.remove('on'); }
  var FATE_SUB = { member: 'ui.epilogue.sub.member', sacrificed: 'ui.epilogue.sub.sacrificed', rejected: 'ui.epilogue.sub.rejected', enemy: 'ui.epilogue.sub.enemy', restored: 'ui.epilogue.sub.restored' }; // text keys
  async function playEpilogue(ep, vopt) {
    var t = ++epi.tok, V = vopt && vopt.victory; epi.vdone = V ? vopt.done : null;
    vnClear(); document.body.classList.add('epi-on');
    var bgs = A.scene(V === 'true' ? 'guild-dawn-full' : V ? 'dawn-exit' : 'game-over').map(function (c) { return 'url("' + esc(splitCand(c).src) + '")'; }).join(', ');
    cine('epi' + (V ? ' epi-win' + (V === 'true' ? ' epi-true' : '') : ''), '<div class="ep-bg" style=\'background-image:' + bgs + '\'></div><div class="ep-stand" id="epStand"></div><div class="ep-name" id="epName"></div><div class="ep-black"></div>' +
      '<button class="btn-ghost ep-skip vn-pass" data-act="epiSkip">' + T('ui.epilogue.skip') + '</button>');
    try {
      if (!V) cue('gallery', null, 0);
      await epiWait(1200, t);
      await epiSay(epiLines(ep.intro), t);
      for (var i = 0; i < (ep.fates || []).length; i++) {
        var f = ep.fates[i], cv = f.status === 'restored' || f.status === 'member' ? null : f.corruption || (f.status === 'sacrificed' || f.status === 'enemy' ? 'possessed' : f.status === 'rejected' ? 'vengeful' : null);
        epiShow(A.portrait(f.id, cv ? { variant: cv } : {}), f.name || nameOf(f.id), FATE_SUB[f.status] ? T(FATE_SUB[f.status]) : '');
        await epiWait(900, t);
        await epiSay(epiLines(f.lines, function (o) { if (cv && o.speakerId === f.id && !/^(vengeful|possessed)/.test(o.expr || '')) o.expr = cv === 'vengeful' ? 'vengeful-tears' : 'possessed-blank'; }), t);
        epiHide(); await epiWait(1100, t);
      }
      epiShow(V ? A.portrait('leader') : A.portrait('leader', { variant: 'worn' }), V ? nameOf('leader') : T('ui.name.leader'), V ? T('ui.name.leader') : '', V ? null : A.face('leader', 'hollow', { variant: 'worn' }));
      await epiWait(900, t);
      await epiSay(epiLines(ep.leader, function (o) { if (o.speakerId === 'leader' && !V) o.expr = 'hollow'; }), t);
      epiHide(); await epiWait(1100, t);
      if (ep.advisor) {
        epiShow(A.portrait(ep.advisor.id, V || A.advisorTurned(view) ? { variant: 'boss' } : {}), ep.advisor.name, T('ui.epilogue.advisor')); // batch6 H2-15: any ending after she turned (true ending too) → her enemy clothes
        await epiWait(900, t);
        await epiSay(epiLines(ep.advisor.lines, function (o) { if (!o.speakerId && o.speaker !== 'narrator') o.speakerId = ep.advisor.id; if (!V) o.expr = o.expr && o.expr !== 'calm' ? o.expr : 'happy'; }), t);
        var st = $('epStand'); if (st) st.classList.add('leave'); var nm = $('epName'); if (nm) nm.classList.remove('on');
        await epiWait(2600, t);
      }
      await epiSay(epiLines(ep.outro), t);
      if (V) epiWinEnd(t); else epiBlack(t);
    } catch (e) { if (e !== CANCEL) throw e; }
  }
  function epiWinEnd(t) { // v2.4 [26] the victory epilogue hands over to the whiteout / the true ending
    if (t !== epi.tok) return; var fn = epi.vdone; epi.vdone = null; epi.tok++;
    vn.q = []; vnClear(); vn.cls = ''; document.body.classList.remove('epi-on'); cineEl.className = 'cine'; cineEl.innerHTML = '';
    if (fn) fn(); else cineDone();
  }
  function epiBlack(t) {
    if (t !== epi.tok) return;
    epi.tok++; var t2 = epi.tok; vn.q = []; vnClear(); vn.cls = '';
    if (!cineEl.classList.contains('epi')) cine('epi', '<div class="ep-black"></div>');
    cineEl.classList.add('black'); var sk = cineEl.querySelector('.ep-skip'); if (sk) sk.remove();
    setTimeout(function () {
      if (t2 !== epi.tok) return;
      try { localStorage.removeItem(KEY); } catch (e) { /* */ } // the run is over: 继续 must not resume a dead run
      document.body.classList.remove('epi-on'); cineEl.className = 'cine'; cineEl.innerHTML = '';
      run = null; screenKey = null; render();
    }, REDUCED ? 600 : 1600 + 2000);
  }
  function exportJson() {
    var payload = { exportedAt: new Date().toISOString(), game: 'chooser', engineVersion: E.version, stub: STUB, seed: run.seed, run: run, summary: view && view.summary, questionnaire: qState(),
      telemetry: lsGet(TKEY, []).filter(function (t) { return t.seed === run.seed; }) };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'chooser-run-' + run.seed + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  // 游玩记录 export: a .json download, or the clipboard (phones often can't save a download). Never throws.
  function plExport(toClipboard) {
    if (!PL) return;
    var txt; try { pl('flush'); txt = JSON.stringify(PL.exportData(plEnv())); } catch (e) { notice(T('ui.playlog.exportFailed')); return; }
    if (!toClipboard) {
      try {
        var blob = new Blob([txt], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = PLM.fileName(new Date()); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
        notice(T('ui.playlog.downloaded'));
      } catch (e) { notice(T('ui.playlog.downloadFailed')); }
      return;
    }
    function fallback() {
      try {
        var ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta);
        ta.select(); var ok = document.execCommand && document.execCommand('copy'); ta.remove();
        notice(T(ok ? 'ui.playlog.copied' : 'ui.playlog.copyFailed'));
      } catch (e) { notice(T('ui.playlog.copyFailed')); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { notice(T('ui.playlog.copied')); }, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  // ---------- modal ----------
  function modal(html) { modalEl.innerHTML = '<div class="panel">' + html + '</div>'; modalEl.hidden = false; var b = modalEl.querySelector('[data-act="modalCancel"]'); if (b) b.focus(); }
  function closeModal() { modalEl.hidden = true; modalEl.innerHTML = ''; modalEl.classList.remove('vn-pass', 'menu-open', 'unit-open'); }
  // batch6 H2-1: the game never uses alert/confirm/prompt — overwriting a save asks in a game-styled panel
  function askOverwrite(act) {
    modal('<h2>' + T('ui.newRun.confirmTitle') + '</h2><p>' + bold(T(run ? 'ui.newRun.confirmCurrent' : 'ui.newRun.confirmExisting')) + '</p><p class="small dim">' + T('ui.newRun.noUndo') + '</p>' +
      '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button><button class="btn btn-primary" data-act="' + act + '" data-ok="1">' + T('ui.newRun.confirmStart') + '</button></div>');
    var p = modalEl.querySelector('.panel'); if (p) p.classList.add('ask-modal');
  }

  // ---------- input ----------
  var H = {
    home: function () { if (credits.kill) credits.kill(); setupOpen = false; if (PL && run) pl('event', 'home', PLM.snap(view)); closeModal(); vnClear(); epi.tok++; epi.vdone = null; document.body.classList.remove('epi-on', 'fx-top', 'end-hold'); setRain(0); run = null; screenKey = null; render(); },
    endHome: function () { // feedback-1112 #43: the run is over → back to the title menu, no new run
      try { localStorage.removeItem(KEY); } catch (e) { /* */ }
      if (stageEl.querySelector('.home-white')) return;
      // batch6 H2-16: a white light fades in over the ending, the title is put up under it, then the white fades away
      var w = document.createElement('div'), TS = REDUCED ? 0.2 : 1; w.className = 'home-white'; stageEl.appendChild(w); void w.offsetWidth; w.classList.add('on');
      setTimeout(function () { H.home(); w.classList.add('out'); setTimeout(function () { w.remove(); }, 1300 * TS); }, 1000 * TS);
    },
    'new': function (d) { // batch6 H2-1: in-game confirm instead of window.confirm
      if (!(d && d.ok) && ((run && view && view.phase !== 'ending' && view.phase !== 'gameOver') || (!run && loadSave()))) { askOverwrite('new'); return; }
      closeModal(); if (run) H.home(); setupOpen = true; render(); var ni = $('leaderName'); if (ni && !TOUCH) ni.focus(); }, // UI-CLEAN §4: 团长设定 first
    setupGo: function () { if (!setupOpen) return; setupOpen = false; newGame(); },
    setupBack: function () { setupOpen = false; render(); },
    'continue': function () { vnClear(); run = loadSave(); screenKey = null; if (run && PL) { try { pl('resume', run.seed, E.view(DATA, run), Q.get('resume') === '1' && !view ? 'auto' : 'continue'); } catch (e) { /* */ } } render(); },
    pick: function (d) { var k = d.k; ui[k] = d.id; app.querySelectorAll('[data-k="' + k + '"]').forEach(function (b) { b.classList.toggle('sel', b.dataset.id === d.id); }); var cb = $('confirmBar'); if (cb) cb.hidden = false; },
    menuTab: function (d) { var i = +d.i || 0; menuTab = d.k || ''; modalEl.querySelectorAll('.mn-tab').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === i); }); modalEl.querySelectorAll('.mn-page').forEach(function (p) { p.hidden = +p.dataset.i !== i; }); },
    fguide: function () { closeModal(); fguideOpen(false); }, // ☰ 游戏组 「布阵说明」: straight to the pages
    menu: function () { au('init'); if (modalEl.classList.contains('menu-open')) { closeModal(); return; } openMenu(); },
    menuHome: function () { // UI-CLEAN §3: back to the title asks first while a run is going (the run stays saved)
      if (!run || !view || view.phase === 'ending' || view.phase === 'gameOver') { H.home(); return; }
      modal('<h2>' + T('ui.menu.homeAskTitle') + '</h2><p>' + T('ui.menu.homeAsk') + '</p><div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button><button class="btn btn-primary" data-act="home">' + T('ui.menu.home') + '</button></div>');
      modalEl.classList.add('vn-pass'); var p = modalEl.querySelector('.panel'); if (p) p.classList.add('ask-modal');
    },
    mute: function () { var m = !au('isMuted'); au('init'); au('setMuted', m); var b = document.querySelector('[data-act="mute"]'); if (b) b.classList.toggle('off', m); },
    cheat: function () { modal('<h2>' + T('ui.cheat.winAsk') + '</h2><div class="row center-row"><button class="btn btn-secondary" data-act="cheatNo">' + T('ui.cheat.never') + '</button><button class="btn btn-primary" data-act="cheatYes">' + T('ui.common.ok') + '</button></div>'); modalEl.classList.add('vn-pass'); },
    cheatKeys: function () {
      closeModal(); if (!run) return; var nr;
      try { nr = E.act(DATA, run, { type: 'cheatKeys' }); } catch (e) { cheatKeysBroken = true; notice(T('ui.cheat.keysUnsupported')); render(); return; }
      run = nr; save(); pl('event', 'cheat', { what: 'keys' }); notice(T('ui.cheat.keysDone')); cue('bell', { act: actNo() }, 0);
      var tb = app.querySelector('.topbar'); if (tb && view) { view = E.view(DATA, run); tb.outerHTML = topbar(view, SCREENS[shownPhase] && SCREENS[shownPhase].plate ? SCREENS[shownPhase].plate(view) : null); }
    },
    replayIntro: function () { closeModal(); playOpening(true); },
    randName: function () { var i = $('leaderName'); if (!i) return; i.value = randName(i.value); prefs.leaderName = i.value; lsSet(PKEY, prefs); },
    newKeys: function (d) { if (!(d && d.ok) && loadSave()) { askOverwrite('newKeys'); return; } closeModal(); newGame({ keys: true }); },
    fairyPoke: function (d, el) {
      var now = performance.now();
      if (now - tfDragEnd < 400 || tfBusy) return; // the click that ends a drag, or she is mid-transform
      if (tfTap.tap(now) === 'annoyed') { tfAnnoyed(el); return; }
      tfDust(el, 6, false);
      cue('giggle', null, 0);
      var F = DATA.linesV2 && DATA.linesV2.fairy, pool = (F && (F.poke || F.title)) || TL('ui.titleFairy.pokeLines');
      ui.poke = ((ui.poke == null ? Math.floor(Math.random() * pool.length) : ui.poke) + 1) % pool.length;
      var l = pool[ui.poke], txt = typeof l === 'string' ? l : l && l.text;
      var old = fxLayer.querySelector('.bubble.fairy'); if (old) old.remove();
      var p = stagePt(el, 0.5, 0.18), b = fxDiv('bubble fairy', esc(txt || T('ui.titleFairy.pokeShort')), p.x, p.y); b.style.left = A.clampX(p.x, b.offsetWidth, STAGE_W, 12) + 'px'; setTimeout(function () { b.remove(); }, 2600);
      pulse(el, 'poked', 700);
    },
    followBell: function () { if (ui.acted) return; ui.acted = 1; doAct({ type: 'followBell' }, true); },
    stayFire: function () {
      if (ui.acted) return;
      ui.acted = 1; // v2.3: the bell campfire IS this campfire's choice; staying sets out (the engine lets the bell go) if (!doAct({ type: 'fight' }, true)) ui.acted = 0;
    },
    campChoose: function (d) { if (ui.acted) return; ui.acted = 1; cue(d.id === 'rest' ? 'heal' : 'pick', null, 0); if (!doAct({ type: 'camp', choice: d.id }, true)) ui.acted = 0; },
    campExplore: function (d) { if (ui.acted) return; ui.acted = 1; if (!doAct({ type: 'campExplore', itemId: d.id }, true)) ui.acted = 0; },
    campTrainPick: function (d) { if (ui.acted) return; ui.acted = 1; if (!doAct({ type: 'campTrainPick', id: d.id }, true)) ui.acted = 0; },
    campTrainBonus: function (d) { if (ui.acted) return; ui.acted = 1; if (!doAct({ type: 'campTrainBonus', bonusId: d.id }, true)) ui.acted = 0; },
    modeSelf: function () {
      // v2.3 §A[21] / §E9: the whole party's max HP ×0.5 for good (min 3), everyone's mood −2 — shown per person
      var sc = view.selfCost || {}, scMap = {}; (sc.maxHp || []).forEach(function (x) { scMap[x.id] = x; });
      var rows = party().map(function (m) {
        var to = scMap[m.id] ? scMap[m.id].to : Math.max(3, Math.floor((m.maxHp || 0) * 0.5));
        return '<tr><td>' + esc(m.name || T('ui.name.you')) + '</td><td class="num">' + A.glyph('maxhp') + ' ' + esc(m.maxHp) + ' → <b class="loss">' + to + '</b></td><td>' + (isLeader(m) ? '' : T('ui.selfSacrifice.moodCost', { cost: '<b class="loss">−2</b>' })) + '</td></tr>';
      }).join('');
      modal('<h2>' + T('ui.selfSacrifice.title') + '</h2><p>' + bold(T('ui.selfSacrifice.lead')) + '</p>' +
        '<div class="self-cost"><p class="sc-head">' + bold(T('ui.selfSacrifice.cost', { hpMult: '<b class="loss">×0.5</b>', mood: '<b class="loss">−2</b>' })) + '</p><table>' + rows + '</table></div>' +
        '<p class="small dim">' + T('ui.selfSacrifice.galleryHappy') + '</p>' +
        '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button><button class="btn self-btn" data-act="confirmSelf">' + T('ui.selfSacrifice.confirm') + '</button></div>');
    },
    confirmSelf: function () {
      closeModal(); cue('sacrificeConfirm', null, 0);
      doAct({ type: 'sacrifice', mode: 'self' }, true, { farewellsViewed: (ui.viewed || []).slice() }, { pre: function (pv) { return selfSacrificeFx(pv.party); }, skipDark: ['self'] });
    },
    cheatNo: function () { closeModal(); },
    // v2.3 §H: a lost battle (battleResult / gameOver) re-scored as a win; the epilogue is cut and the run goes on
    cheatLost: function () {
      closeModal(); if (!canCheatLost()) { notice(T('ui.cheat.lostUnsupported')); return; }
      epi.tok++; anim.skip = true; flushWaits(); anim.token++; vnClear(); cineEl.className = 'cine'; cineEl.innerHTML = '';
      document.body.classList.remove('fx-top', 'epi-on'); setRain(0); ui.acted = 1;
      doAct({ type: 'cheatWin' });
    },
    cheatYes: function () {
      closeModal();
      anim.skip = true; flushWaits(); anim.token++; vnClear(); cineEl.className = 'cine'; cineEl.innerHTML = ''; document.body.classList.remove('fx-top');
      var prev = run, ok = false;
      try { E.act(DATA, run, { type: 'cheatWin' }); ok = true; } catch (e) { ok = false; }
      run = prev;
      if (!ok) { cheatBroken = true; notice(T('ui.cheat.winUnsupported')); render(); return; }
      ui.acted = 1; doAct({ type: 'cheatWin' });
    },
    dfPick: function (d, el) {
      if (ui.acted || !view || !view.difficulties) return;
      var D = view.difficulties, t = D.tiers[+d.id]; if (!t) return;
      if (t.locked) { dfSay(dfText(D.locked) || T('ui.difficulty.lockedFallback'), 'warn'); el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); cue('giggle', null, 0); return; }
      ui.diff = t.id;
      app.querySelectorAll('.df-tier').forEach(function (b) { b.classList.toggle('sel', +b.dataset.id === t.id); });
      var cb = $('confirmBar'), btn = cb && cb.querySelector('button'); if (btn) btn.textContent = T('ui.difficulty.confirm', { name: t.name });
      var bb = $('dfBubble'); if (bb && bb.classList.contains('warn')) dfSay((D.ask || []).map(function (l) { return l.text; }).join('')); // feedback-1113 #1: the tier's blurb is already on its card — the bubble doesn't repeat it
    },
    confirmDifficulty: function () {
      if (ui.acted || !view || !view.difficulties) return; ui.acted = 1;
      var D = view.difficulties, t = D.tiers[ui.diff] || D.tiers[0];
      // feedback-1113 #1: the engine's 'picked' lines play once, in the dialogue box; the bubble steps aside so nothing shows twice
      var b = $('dfBubble'); if (b) b.classList.add('gone');
      if (!doAct({ type: 'chooseDifficulty', difficulty: t.id }, true)) { ui.acted = 0; if (b) b.classList.remove('gone'); }
    },
    pickAdvisor: function (d) {
      ui.advisor = d.id; ui.heard = null; render();
      var a = (view.advisors || []).filter(function (x) { return x.id === d.id; })[0];
      say(a && a.intro ? [{ speaker: a.id, speakerId: a.id, name: a.name, text: a.intro, expr: 'happy' }] : [], function () { if (ui.advisor !== d.id) return; ui.heard = d.id; var cb = $('confirmBar'); if (cb) cb.hidden = false; });
    },
    confirmAdvisor: function () { doAct({ type: 'chooseAdvisor', advisor: ui.advisor }, true); },
    confirmIdentity: function () { if (view.leaderStep) doAct({ type: 'chooseIdentity', identity: ui.identity }, true); },
    confirmClass: function () { doAct({ type: 'chooseClass', cls: ui.cls }, true); },
    side: function (d) { doAct({ type: 'side', id: d.id }, true); },
    hire: function (d) {
      ui.hiredId = d.id;
      // v2.4 [8] the girl who wasn't picked leaves slowly (~1.2 s) after her line; the next round waits for it
      doAct({ type: 'hire', id: d.id, candidate: d.id }, true, null, { post: function () { return stages([[function () { app.querySelectorAll('.iv-side').forEach(function (el) { if (el.dataset.c !== d.id) { el.classList.remove('dim', 'speaking'); el.classList.add('leaving'); } }); }, 1300, 'noskip']]); } });
    },
    ivSkip: function (d, t, e) { if (e) e.stopPropagation(); var sk = $('ivSkip'); if (!sk || sk.hidden || ui.ivReady) return; pl('event', 'ivSkip', { round: view && view.round }); vnSkipToMarker(); },
    ivReplay: function () { $('ivChoices').hidden = true; $('ivUnder').hidden = true; ivTalk(view); },
    move: function (d) { var i = +d.i, j = i + +d.d, o = ui.order, t = o[i]; if (j < 0 || j >= o.length) return; o[i] = o[j]; o[j] = t; ui.moves++; render(); },
    armSkill: function () { if (doAct({ type: 'armSkill', on: !view.skillArmed }, true)) render(); },
    fight: function () { tracker.switches = ui.moves || 0; if (doAct({ type: 'setOrder', order: ui.order.slice() }, true)) doAct({ type: 'fight' }); },
    speed: function (d) { setSpeed(+d.s); },
    speedCycle: function () { setSpeed((prefs.speed || 1) % 3 + 1); },
    skip: function () { anim.skip = true; flushWaits(); },
    pContinue: function (d, t, e) { if (ui.acted || !app.querySelector('.pausebar') || !pauseReady(e)) return; ui.acted = 1; doAct({ type: 'continue' }, true); },
    pSkill: function () {
      var sk = view.battle.pause.advisorSkill; if (!sk || !sk.available || ui.acted) return; ui.acted = 1;
      pendingAnnounce = { title: view.advisor ? T('ui.pause.announceAdvisor', { advisor: view.advisor.name, name: sk.name }) : T('ui.battle.skillTitle', { name: sk.name }), sub: T('ui.battle.nextRound'), face: A.face(view.advisor.id, 'special') };
      doAct({ type: 'advisorSkill' }, true);
    },
    pMove: function () { pauseMode('move', bold(T('ui.pause.moveHint'))); },
    pItem: function () {
      var items = view.battle.pause.items || [];
      pauseMode('item', '<b>' + T('ui.pause.item') + '</b>' + items.map(function (it, i) { return '<button class="item-btn" data-act="pickItem" data-i="' + i + '" data-tip="' + esc(it.text) + '"><img src="' + esc(A.itemIcon(it.itemId)) + '" alt="">' + esc(it.name) + '</button>'; }).join(''));
    },
    pickItem: function (d) {
      var it = view.battle.pause.items[+d.i]; if (!it || ui.acted) return;
      if (!it.needsTarget) { ui.acted = 1; pendingAnnounce = { title: it.name, sub: it.text }; doAct({ type: 'useItem', itemId: it.itemId }, true); return; }
      ui.item = it; pauseMode('itemTarget', T('ui.pause.itemTarget', { item: '<b>' + esc(it.name) + '</b>' }));
    },
    pCancel: function () { pauseMode(null); },
    pLog: function () { openBattleLog(); }, // v39 战报
    battleContinue: function (d, t, e) { if (ui.resActed || (e && e.isTrusted && ui.resultAt && nowMs() - ui.resultAt < 450)) return; ui.resActed = 1; if (!doAct({ type: 'continue' })) ui.resActed = 0; },
    pickCard: function (d) {
      ui.who = null;
      var o = (view.options || []).filter(function (x) { return x.id === d.id; })[0];
      if (o && (o.needsTarget === false || (o.needsTarget == null && o.effect && o.effect.type === 'item'))) { doAct({ type: 'pickReward', card: o.id }, true); return; }
      ui.card = d.id; render();
    },
    unpickCard: function () { ui.card = null; ui.who = null; render(); },
    // 2026-11-14: switching heads = 换人. 试玩 #9: in place (the heads' ring + the one box), never a whole re-render — that
    // rebuilt the box (and its 「确定」) on every pick, which flickered
    whoSel: function (d) {
      if (ui.who === d.id || ui.acted) return; ui.who = d.id;
      var c = ui.card && (view.options || []).filter(function (o) { return o.id === ui.card; })[0], box = app.querySelector('.whos .who-detail');
      if (!c || !box) { render(); return; }
      app.querySelectorAll('.who-head').forEach(function (h) { var on = h.dataset.id === d.id; h.classList.toggle('on', on); h.setAttribute('aria-pressed', String(on)); });
      var t = document.createElement('template'); t.innerHTML = whoDetailHtml(c, d.id, view.phase === 'debuff'); box.replaceWith(t.content.firstChild);
    },
    pickTarget: function (d) { if (!d.id || ui.acted) return; ui.acted = 1; cue(view.phase === 'reward' ? 'reward' : 'debuff', null, 0); if (!doAct({ type: view.phase === 'reward' ? 'pickReward' : 'pickDebuff', card: ui.card, target: d.id }, true)) ui.acted = 0; },
    nameTarget: function (d) { // batch6 H2-10 ①: portrait + floating words only
      if (d.id === 'leader' || ui.pending === d.id) return; var nx = A.sacFlow(ui.sac, 'pick', d.id); if (nx.step !== 'picked') return;
      ui.sac = nx; ui.pending = d.id; ui.fwDone = null; (ui.viewed = ui.viewed || []).push(d.id); vnClear(); render(); sacPickFloat(d.id);
    },
    sacWrite: function () { // batch6 H2-10 ②: now she speaks, then asks
      var nx = A.sacFlow(ui.sac, 'write'); if (nx.step !== 'speaking') return; ui.sac = nx; render(); playFarewell(nx.id);
    },
    unitInfo: function (d) { openUnitPanel(d.u != null ? d.u : null, d.id); }, // v36 角色面板
    viewTeam: function () { modal(teamModalHtml()); var p = modalEl.querySelector('.panel'); if (p) p.classList.add('team-modal'); },
    viewHer: function (d) { modal(herPanel(d.id)); var p = modalEl.querySelector('.panel'); if (p) p.classList.add('her-modal'); },
    fwBack: function () { ui.sac = A.sacFlow(ui.sac, 'cancel'); ui.pending = null; ui.fwDone = null; app.classList.remove('sac-hesitate'); vnClear(); render(); }, // batch6 H2-10: 取消 → back to picking
    modeRandom: function () {
      var NUM = T('ui.numerals').split(','), takes = (view && view.diceTakes) || 1;
      modal('<h2>' + T('ui.sacrifice.ruleTitle') + '</h2><p class="warn">' + bold(T('ui.sacrifice.ruleTakes', { n: (takes >= 0 && takes <= 3 ? NUM[takes] : '') || NUM[1] })) + '</p><p class="small dim">' + T('ui.sacrifice.noUndo') + '</p><div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button><button class="btn btn-primary has-bell" data-act="confirmRandom">' + (A.grantsBell('random', 'sacrifice') ? A.bellSvg('opt-bell') : '') + T('ui.sacrifice.ruleTitle') + '</button></div>');
    },
    modalCancel: function () { tracker.touch('cancel'); closeModal(); },
    confirmName: function (d, el) { // r2: fade everything but the button → it shatters → black → sacConfirmNow (the real action)
      if (ui.sacBreaking || !ui.pending || ui.fwDone !== ui.pending || !ui.sac || ui.sac.step !== 'ask') return;
      ui.sacBreaking = 1; sacGrow.stop(); closeModal(); cue('sacrificeConfirm', null, 0);
      sacBreak(el || $('fwConfirm'), sacConfirmNow);
    },
    confirmRandom: function () {
      closeModal(); cue('sacrificeConfirm', null, 0);
      doAct({ type: 'sacrifice', mode: 'random' }, true, null, { pre: function (pv, nv) {
        var now = (nv.party || []).map(function (m) { return m.id; }), gone = pv.party.filter(function (m) { return !isLeader(m) && now.indexOf(m.id) < 0; }).map(function (m) { return m.id; });
        return withFarewell(sacrificeFx(gone, pv.party, true), gone);
      } });
    },
    sealPick: function (d) { // feedback-1112 #7: refuse (the noble's curse) / accept (two girls lose heart)
      if (ui.acted || (d.id !== 'refuse' && d.id !== 'accept')) return; ui.acted = 1;
      var c = $('sealChoice'); if (c) c.remove();
      if (!doAct({ type: 'sealChoice', choice: d.id }, true)) ui.acted = 0;
    },
    openDoor: function () { // 2026-11-15 小门 → the existing true route (trueDoor → L11)
      if (ui.acted) return; ui.acted = 1;
      var g = $('sideDoorGo'); if (g) g.remove();
      if (!doAct({ type: 'openDoor' }, true)) ui.acted = 0;
    },
    page: function (d) { ui.page = d.p; render(); },
    rate: function (d) { var q = qState(); q.ratings[d.r] = +d.v; qSave(q); render(); },
    'export': exportJson,
    plExport: function () { plExport(false); },
    plCopy: function () { plExport(true); },
    epiSkip: function () { if (epi.vdone) epiWinEnd(epi.tok); else epiBlack(epi.tok); }
  };
  var CLICK_CUE = { fairyPoke: 'none', setupGo: 'confirm', setupBack: 'cancel', menu: 'click', confirmSelf: 'confirm', followBell: 'confirm', stayFire: 'confirm', modeSelf: 'pick', cheatKeys: 'click', newKeys: 'confirm', confirmAdvisor: 'confirm', confirmDifficulty: 'confirm', dfPick: 'none', confirmIdentity: 'confirm', confirmClass: 'confirm', fight: 'confirm', battleContinue: 'confirm', pContinue: 'confirm', confirmName: 'confirm',
    pCancel: 'cancel', fwBack: 'cancel', unpickCard: 'cancel', modalCancel: 'cancel', cheatNo: 'cancel', home: 'cancel',
    campChoose: 'none', unitInfo: 'click', campExplore: 'pick', campTrainPick: 'pick', campTrainBonus: 'confirm', viewHer: 'click', viewHerClose: 'cancel',
    pickAdvisor: 'pick', pick: 'pick', pickCard: 'pick', pickTarget: 'pick', whoSel: 'click', nameTarget: 'pick', pickItem: 'pick', side: 'side', hire: 'hire', pMove: 'click', epiSkip: 'cancel' };
  // battle cards during a pause: pick-then-place, or the item's target
  function battleCardClick(card) {
    if (!view || view.phase !== 'battle' || !card.classList.contains('ally') || ui.acted) return false;
    // 2026-11-14: the engine's battle actions name a unit by its uid (a girl who switched sides has a uid ≠ her id)
    var id = card.dataset.u || card.dataset.id, uName = (bUnits().filter(function (u) { return u.uid === id; })[0] || {}).name || nameOf(card.dataset.id);
    if (ui.mode === 'itemTarget') { ui.acted = 1; pendingAnnounce = { title: ui.item.name, sub: uName }; doAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, true); return true; }
    if (ui.mode === 'move') {
      if (!ui.moveSel) { ui.moveSel = id; card.classList.add('sel'); return true; }
      if (ui.moveSel === id) { ui.moveSel = null; card.classList.remove('sel'); return true; }
      var order = view.battle.allies.map(function (u) { return u.uid != null ? u.uid : u.id; }); ui.acted = 1;
      doAct({ type: 'move', id: ui.moveSel, to: order.indexOf(id) }, true); return true;
    }
    return false;
  }
  // sound popover: toggle, sliders, mute
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'leaderName') { prefs.leaderName = String(e.target.value || '').trim().slice(0, 8); lsSet(PKEY, prefs); return; } // v2.4 [4]
    if (e.target && e.target.dataset && e.target.dataset.pref === 'autoCont') { // ☰ 游戏组: battle auto-continue (prefs.autoCont, default off)
      prefs.autoCont = !!e.target.checked; lsSet(PKEY, prefs);
      if (prefs.autoCont && !ui.mode) later(function () { if (!vnActive() && view && view.phase === 'battle' && app.querySelector('.pausebar')) autoContinue(); }, 500);
      return;
    }
    var k = e.target && e.target.dataset && e.target.dataset.snd; if (!k) return;
    var cur = au('getVolume') || { music: 0.35, sfx: 0.5 };
    if (k === 'mute') { au('init'); au('setMuted', e.target.checked); return; }
    var val = Math.max(0, Math.min(1, (+e.target.value || 0) / 100));
    au('init'); au('setVolume', k === 'music' ? val : cur.music, k === 'sfx' ? val : cur.sfx);
    if (k === 'sfx') cue('click', null, 120);
  });
  // ☰ menu: a click on the dark backdrop (outside the panel) closes it
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl && (modalEl.classList.contains('menu-open') || modalEl.classList.contains('unit-open'))) closeModal(); }); // v36: the 角色面板 too
  // v36 角色面板: a right-click on any unit card opens her panel (touch: the ⓘ on the card)
  document.addEventListener('contextmenu', function (e) {
    var uc = e.target.closest && e.target.closest('.ucard[data-id]'); if (!uc || vnActive() || !(app.contains(uc) || modalEl.contains(uc))) return;
    e.preventDefault(); if (openUnitPanel(uc.dataset.u != null ? uc.dataset.u : null, uc.dataset.id)) cue('click', null, 0);
  });
  document.addEventListener('click', function (e) {
    var card = e.target.closest && !e.target.closest('.uc-info') && e.target.closest('.bcard'); if (card && battleCardClick(card)) return; // v36: the ⓘ never targets an item
    var t = e.target.closest && e.target.closest('[data-act]');
    if (!t && !vnActive() && modalEl.hidden && !app.classList.contains('stale')) { var uc = e.target.closest && e.target.closest('.ucard'); if (uc && app.contains(uc)) { if (cardOpensPanel(uc)) { cue('click', null, 0); openUnitPanel(uc.dataset.u != null ? uc.dataset.u : null, uc.dataset.id); } return; } } // v36 角色面板: a plain click on a card
    if (!t || t.disabled || !H[t.dataset.act]) return;
    if (app.classList.contains('stale') && !t.closest('.topbar')) return;
    if (stageEl.querySelector('.nj-white:not(.out)')) return; // v2.4 [2] nothing fires under the new-journey whiteout
    if (t.dataset.opt) tracker.touch(t.dataset.opt);
    if (CLICK_CUE[t.dataset.act] !== 'none') cue(CLICK_CUE[t.dataset.act] || 'click', null, 0);
    H[t.dataset.act](t.dataset, t, e);
  });
  // drag-to-move during a pause
  app.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('.bcard.ally'); if (!c || ui.mode !== 'move') return; ui.dragId = c.dataset.id; c.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', c.dataset.id); } catch (x) { /* */ } });
  app.addEventListener('dragover', function (e) { if (ui.mode === 'move' && e.target.closest && e.target.closest('.bcard.ally')) e.preventDefault(); });
  app.addEventListener('drop', function (e) {
    var c = e.target.closest && e.target.closest('.bcard.ally'); if (!c || ui.mode !== 'move' || !ui.dragId) return; e.preventDefault();
    if (c.dataset.id === ui.dragId || ui.acted) return; var order = view.battle.allies.map(function (u) { return u.id; }); ui.acted = 1;
    doAct({ type: 'move', id: ui.dragId, to: order.indexOf(c.dataset.id) }, true);
  });
  function trackOpt(e) { var t = e.target.closest && e.target.closest('[data-opt]'); if (t) tracker.touch(t.dataset.opt); }
  app.addEventListener('mouseover', trackOpt); app.addEventListener('focusin', trackOpt);
  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (e.key === 'Escape') {
      if (!modalEl.hidden) { closeModal(); return; }
      var ivs = $('ivSkip'); if (ivs && !ivs.hidden) { H.ivSkip(); return; }
      if (view && view.phase === 'battle' && ui.mode) { pauseMode(null); return; }
      if (view && view.phase === 'sacrifice' && ui.pending) { H.fwBack(); return; }
      if (view && (view.phase === 'reward' || view.phase === 'debuff') && ui.card) { H.unpickCard(); return; } // 「给谁」: Esc = 换一张 (back to the three cards)
      if (!run && setupOpen && !e.isComposing && e.keyCode !== 229) { H.setupBack(); return; } // 团长设定: Esc = 返回 (never while an IME is composing the name)
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'leaderName' && setupOpen && modalEl.hidden) { e.preventDefault(); H.setupGo(); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || !modalEl.hidden) return;
    if (vnActive()) { e.preventDefault(); vnAdvance(); return; } // dialogue first: Space / Enter = next line
    // v2.4 [15]: at the pause, a fresh Enter / Space (not held over from the animation or the last line) means 继续
    if (view && view.phase === 'battle' && !ui.mode && app.querySelector('.pausebar') && !e.repeat && pauseReady(e)) { e.preventDefault(); cue('confirm', null, 0); H.pContinue(null, null, e); }
  });
  modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });

  // ---------- opening: Alpico logo → (first time) content notice → the fairy on AI → 「开始吧！」 → whiteout → title ----------
  var INTRO_NOTICE = lazy(function () { return TL('ui.intro.notice'); });
  var INTRO_FAIRY = lazy(function () { return TL('ui.intro.fairy'); });
  var INTRO_GO = lazy(function () { return T('ui.intro.go'); });
  function playOpening(replay) {
    if (Q.get('nologo') === '1' || $('intro')) return;
    var fz = DATA.linesV2 && DATA.linesV2.fairy && DATA.linesV2.fairy.intro, txt = function (l) { return typeof l === 'string' ? l : (l && l.text) || ''; };
    var fairy = (fz && fz.lines && fz.lines.length ? fz.lines.map(txt) : INTRO_FAIRY()).concat([fz && fz.go ? txt(fz.go) : INTRO_GO()]);
    var first = replay || !prefs.introSeen, TS = REDUCED ? 0.25 : 1, done = false, tok = 0;
    var el = document.createElement('div'); el.id = 'intro'; el.className = 'intro';
    el.innerHTML = '<div class="in-logo"><img src="' + A.ver('../art/brand/alpico-logo.png') + '" alt="ALPICO PRESENTS"></div><button class="in-skip" type="button">' + T('ui.intro.skip') + '</button>';
    stageEl.appendChild(el); introHold = true;
    var wait = function (ms) { var my = tok; return new Promise(function (r) { setTimeout(function () { r(my === tok && !done); }, ms * TS); }); };
    var click = function () { return new Promise(function (r) { el.onclick = function (e) { if (e.target.closest('.in-skip')) return; el.onclick = null; r(!done); }; }); };
    function finish() { // whiteout → the title underneath, the music in under the white
      if (done) return; done = true; tok++; el.onclick = null; el.classList.add('white');
      if (first) { prefs.introSeen = true; lsSet(PKEY, prefs); }
      setTimeout(function () {
        el.classList.add('cleared'); introHold = false; if (auReady && sceneCtx) au('scene', sceneCtx);
        setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 1200); }, 500 * TS);
      }, 800 * TS);
    }
    el.querySelector('.in-skip').addEventListener('click', function (e) { e.stopPropagation(); finish(); });
    var onKey = function (e) { // Space / Enter = next, Esc = skip
      if (!document.getElementById('intro') || done) { document.removeEventListener('keydown', onKey, true); return; }
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { finish(); return; }
      var ok = el.querySelector('.in-ok'); if (ok && el.classList.contains('notice-on')) ok.click(); else if (el.onclick) el.onclick({ target: el });
    };
    document.addEventListener('keydown', onKey, true);
    (async function () {
      void el.offsetWidth; el.classList.add('logo-on');
      var skipLogo = Promise.race([wait(2600), click()]);
      if (!(await skipLogo) && done) return;
      el.classList.remove('logo-on'); el.classList.add('logo-off');
      if (!(await wait(900))) return;
      if (!first) { finish(); return; }
      el.insertAdjacentHTML('beforeend', '<div class="in-notice"><h2>' + T('ui.intro.noticeTitle') + '</h2>' + INTRO_NOTICE().map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') +
        '<button class="btn btn-primary in-ok" type="button">' + T('ui.intro.ok') + '</button></div>');
      await wait(60); el.classList.add('notice-on');
      await new Promise(function (r) { el.querySelector('.in-ok').addEventListener('click', function (e) { e.stopPropagation(); r(); }); });
      if (done) return;
      el.classList.remove('notice-on'); el.classList.add('notice-off'); cue('click', null, 0);
      if (!(await wait(600))) return;
      el.insertAdjacentHTML('beforeend', '<div class="in-fairy"><span class="fs-bob">' + fairyPic('fairy', 'stand-img', T('ui.name.fairy')) + '</span></div>' +
        '<div class="in-bubble" id="inBubble"><b class="in-name">' + T('ui.name.fairy') + '</b><span class="in-text"></span><i class="in-next">▼</i></div>');
      await wait(60); el.classList.add('fairy-on'); cue('giggle', null, 0);
      var tx = el.querySelector('.in-text'), bb = $('inBubble');
      for (var i = 0; i < fairy.length; i++) {
        tx.textContent = fairy[i]; bb.classList.remove('pop'); void bb.offsetWidth; bb.classList.add('pop'); bb.classList.toggle('last', i === fairy.length - 1);
        await wait(250); if (done) return;
        if (!(await click())) return;
      }
      finish();
    })();
  }

  // ---------- boot ----------
  if (!E || !DATA) { app.innerHTML = '<div class="title"><div class="title-menu broken panel"><h2>' + T('ui.boot.noEngine') + '</h2></div></div>'; return; }
  window.__chooserUI = { // dev/test hook (walkers, screenshot driver)
    say: say, vnActive: vnActive, vnAdvance: vnAdvance, render: function () { render(); },
    state: function () { return { phase: view ? view.phase : 'title', screen: document.body.dataset.phase, step: view && (view.leaderStep || view.interviewStep), act: actNo(), level: view && view.level, vn: vnActive(), mode: ui.mode || null, paused: !!$('pauseWrap') && !!app.querySelector('.pausebar'), result: !!app.querySelector('.result-wrap'), stale: app.classList.contains('stale'), stub: STUB,
      talking: !!app.querySelector('.camp-wrap.talking'), epilogue: document.body.classList.contains('epi-on'), cine: cineEl.className,
      keys: view && view.keys || null, bell: !!(view && view.bell), camp: view && view.phase === 'prep' ? campStep(view) : null, outcome: view && view.summary ? view.summary.outcome : null, story: view && view.storyId || null, real: !STUB, metaKey: MKEY, runKey: KEY }; },
    cheatable: function () { return !!app.querySelector('[data-act="cheat"]'); },
    skip: function () { H.skip(); }, prefs: prefs, intro: function () { return !!$('intro'); },
    queue: function (evs) { eventsToQueue(evs, view); } // feedback-1112 checker (ui/dev/fb1112c.cjs): replay result events (mood / training)
  };
  render();
  if (Q.get('resume') === '1' && loadSave()) H['continue'](); // dev: ui/dev/jump.html → straight into the saved run, skip the title
  playOpening(false);
})();
