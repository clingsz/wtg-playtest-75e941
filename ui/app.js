// 《欢迎加入冒险者公会！》 v2 browser UI — a thin renderer over ChooserEngine (docs/archive/V2-CONTRACT.md).
// Rule: every decision is `run = E.act(DATA, run, action)` then render `E.view(DATA, run)`. No game rules here.
// Principles (docs/archive/V2-PLAN.md): one choice per screen, little text; dialogue and scenes minimal but atmospheric.
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
  // 2026-11-15 快速模式 ?quick=1 (UI only, the engine is untouched): no story talk at all — every say() is passed over like
  // 跳过剧情, battle lines / barks are dropped, the one-page recruit, 芙洛's shop and the ending result come up directly
  var QUICK = Q.get('quick') === '1';
  // 2026-11-19 路线图: the party marker walks the route map before each new campfire; the map button sits by ☰ at the campfire.
  // false = the old behaviour (no move, no button). ?routemap=0 / =1 overrides it for one page load.
  var ROUTE_MAP = Q.get('routemap') ? Q.get('routemap') === '1' : true;
  // 2026-11-19 路线图 v2: ink path + glowing new place + one tap (no marker, no walk). false (or ?routev2=0) → the v1 walk below, kept as backup
  var ROUTE_MAP_V2 = Q.get('routev2') ? Q.get('routev2') === '1' : true;
  // 2026-11-20 用户亲测 流程 (FEEDBACK-2026-11-20 流程): 战利品 → 篝火（「篝火营地」地点卡）→ 出发 → 路线图（第一次：顾问讲前路）→ 打开进新地点
  // → 地点卡（如「沙地竞技场」）→ 场景介绍（顾问的开战前那句也在这里，engine FLOW_DEPART_ROUTE）→ 开战. The map now plays on the way
  // OUT of the campfire (before the scene intro), from L1 on. false (or ?flow=old) = the old order (the map before each new campfire).
  var FLOW_DEPART_ROUTE = Q.get('flow') ? Q.get('flow') !== 'old' : true;
  // 2026-11-20b 用户: after the map, ONE card only — the level's own title card (in levelIntro), then the talk, then battle.
  // true = no place card on arrival (the 「篝火营地」 card at the campfire stays). false (or ?arrivecard=1) = the 2026-11-20 place card + level card, kept as backup
  var ARRIVE_ONE_CARD = Q.get('arrivecard') ? Q.get('arrivecard') !== '1' : true;
  // 2026-11-19 意图预告: each enemy card shows whom it hits this round (faces / a group-hit shape / a heal shape, no letters);
  // each ally card a red 准星 corner when aimed (a numeral when more than one); the formation shows round 1. false (or ?intent=0) = none
  var INTENT_UI = Q.get('intent') ? Q.get('intent') === '1' : true;
  // 2026-11-19 用户亲测 界面: 开战前不能知道谁在瞄准 — the formation draws nothing of round 1 (the engine's v.preIntent is kept,
  // just not rendered). true = the old faces on the 「?」 cards + 准星 on our formation cards
  var PRE_INTENT_UI = false;
  // 2026-11-19 用户亲测 界面: 我方被瞄准的准星太乱 → hidden (aimedHtml draws nothing; code kept). true = the old red corner
  var AIMED_MARK_UI = false;
  // 2026-11-19 用户亲测 界面: 升级 = its own page (portrait, Lv a → b, what changed, her line, a sound), one page per level-up,
  // a tap → the next. false = the old inline 「升级！」 text in the result table / the stat bubbles
  var LEVELUP_PAGE = true;
  // 2026-11-19 用户亲测 界面: the battle result is one row per member (face + name, 伤害 / 治疗 / 承伤 / 击倒, 经验 + bar, 「升级」).
  // false = the old table (resultTable)
  var RESULT_ROWS = true;
  // 2026-11-19 用户亲测 界面: our battle cards show 威力 small (the power glyph + number). false = none (the old card)
  var CARD_POWER = true;
  // 2026-11-20 用户亲测 界面 (docs/FEEDBACK-2026-11-20-user.md). Each flag false = the 2026-11-19 behaviour, kept as backup.
  // 「条款生效」 lines: a normal-size text plate that stays ~3 s (old: the 128px effect word, gone after 1.4 s)
  var CLAUSE_BANNER_SMALL = true;
  // 威力 (glyph + number) in the top-right of every battle card's art, ours and the enemies'; our mood face leaves the battle card
  // (the portrait's expression + the info panel still show it). Old: mood face top right, 威力 small in our name strip only
  var CARD_POWER_TOP = true;
  // 「第 N 回合」: a slim band placed in the gap between the enemy lane and ours (measured), never over a card or its marks.
  // Old: a tall band at a fixed y = 612 that covered the top of our cards (the hunter's 准星)
  var TURN_BANNER_GAP = true;
  // 锻炼选人: no 「这次锻炼会升级 / 选对锻炼就能升级」 ribbon, only Lv + the X/Y 经验 bar. Old: the ribbon
  var TRAIN_NO_RIBBON = true;
  // a hit = one number (a crit: bigger, its own colour, no separate overkill float); the hunter's shot = a fast streak + a hard
  // shake / flash on the target. Old: the 「溢出」 overkill float beside the hit, the soft float
  var ONE_HIT_NUMBER = true;
  // 2026-11-20b 用户: the hunter's own 准星 button sat on her top-right 威力 — it moves to the top-centre of her card (above the portrait).
  // false = the 2026-11-20 top-right button (style.css .aim-btn), kept as backup
  var AIM_BTN_TOP_MID = true;
  // 2026-11-20 牧师治疗 (engine HEAL_PICK): a 十字 button on each priest's card at a pause → tap allies in order (badges 1/2/3); false = hidden
  var HEAL_PICK_UI = true;
  // 2026-11-20b 用户: the loot screen shows what this battle paid — coin + 「+N」 + 本战所得 under the heading, then the purse. false = no line (backup)
  var WIN_GOLD_LINE = true;
  // 2026-11-20c 用户「本战所得 太靠上被切、右上钱袋已经有数」: the loot screen gets one reward block under the cards — big coin + 「获得 N 金币」
  // + 「领取」; 领取 = coins burst and fly into the top-bar purse, which counts up old → new with a bump + a coin cue. Until then the
  // purse shows the old total (presentation only — the engine already added it). Picking a card / leaving first = a quick auto-claim.
  // false = the WIN_GOLD_LINE line above (backup)
  var GOLD_CLAIM = true;
  // 2026-11-20b 用户「第一回合 威力 +2，卡上数字不变」: the top-right 威力 = the engine's live u.pow (buffs in, 虚弱 out), it follows each
  // 'pow' event as it plays with a 「威力 +2」 float; gold tint above her base, red below. false = the bare u.atk as before (backup)
  var POWER_LIVE_UI = true;
  var GROUP_FX = true; // 2026-11-20 群体效果一起播: 列阵 / 退伍老兵 / 铁壁 / 威力 changes land on every card at once (one cue, one wait); false = the old one card at a time
  // 2026-11-20 小铃 / 钟楼: every bell effect floats what it gave on each card it touched (staggered pulse). false = nothing per card
  var BELL_FX = true;
  // 2026-11-20 BONUS_STACK (user-approved ui/dev/mockup-bonus-v5.html): an action with bonuses builds a stack of rows over the
  // attacker (enemies: below, red), faster / bigger / higher each row, ×-rows jump and flash, the last row lands and holds,
  // then one big number flies; a 先蓄后放 chain raises together and fires ONE volley. false = exactly the old playback.
  // 2026-11-20 BONUS_STACK_V7: the v7 word plate (ui/dev/mockup-bonus-v7.html) — ONLY with ?stack=v7 in the page URL; without it
  // the battle plays exactly as before (BONUS_STACK stays false too). Code: v7Plates / v7On below stackPlay.
  var BONUS_STACK_V7 = Q.get('stack') === 'v7';
  // 2026-11-20 BONUS_STACK_B1 (user picked B1 in ui/dev/bonus-lab.html): ONLY with ?stack=b1. Same hooks as v7 (v7On / v7Plates /
  // v7Drop), different look: her skill name over her head (the old band), the gold hit number above it counting up, the bonus rows
  // (plain words, no box) above the number. Then her blow lands exactly as today (release / comboSeq / flyNum / HitFX untouched).
  // 2026-11-20 用户「改成默认打开」: on unless the URL names another (?stack=old = the plain old orb, ?stack=v7 = the v7 plate)
  var BONUS_STACK_B1 = Q.get('stack') ? Q.get('stack') === 'b1' : true;
  var BONUS_STACK = false; // 2026-11-20 用户「加成效果完全不行」「刺客的连击攻击效果也被改坏了」: off until the v6 (words) design is approved — true = the 11-20 stack playback
  // 2026-11-20 POW_SOURCE: a 威力 float names its source(s) (engine 'pow' parts): 「高昂 威力 +1」, never a bare number
  var POW_SOURCE = true;
  // 芙洛 always stands on the left (her shop page has her there too). false = she took the next free side, left or right
  var FLUO_LEFT = false; // 2026-11-20 用户「芙洛跟团长重复了…改到右边」: was true (left = the leader's side)
  var FLUO_RIGHT = true; // 2026-11-20: 芙洛 always on the right
  var route = { busy: false }; // 路线图 state (render() waits while the move plays)
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
  function pl(fn) { try { if (PL && PL[fn]) PL[fn].apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { /* the play log must never break the game */ } } // 2026-11-20: every argument (was a, b, c)
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
  var PRE = window.CHOOSER_PRELOAD || null; // 2026-11-19 预加载: ui/preload.js (tiers of art warmed in the background; ?nopreload=1 = off)
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
  // 2026-11-14 手机端 (方案 B, docs/archive/SPEC-2026-11-13-batch6.md): on a touch screen the page is pinned (body.mb: fixed, no
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
  // 2026-11-19 战报 XP 栏 (用户「+XP 在战报里显示，不要刚结束、还没出战报就冒泡升级」): true = the battle's +XP / level-ups are a
  // column in the result table and the 'battle:xp' stat bubbles are not played; false = the old bubbles, no column.
  var XP_IN_REPORT = true;
  var SAC_SPIN = true; // 2026-11-19 交给规则·老虎机: the frame cycles the cards before the engine's pick is revealed (false = the old instant reveal)
  var prefs = lsGet(PKEY, { speed: 2, auto: false });
  // 2026-11-20 用户「x2 现在是默认，再给 x0.5 和 x1.5（旧的 x1 x3）」: the three speeds keep their real pace (SPD 0.7 / 1 / 2);
  // they are now called ×0.5 / ×1 / ×1.5 and the middle one (old ×2) is the default — once, for saves made before this
  if (prefs.speedV !== 2) { prefs.speedV = 2; prefs.speed = 2; lsSet(PKEY, prefs); }
  var SPD_NAME = { 1: '0.5', 2: '1', 3: '1.5' };
  function spdName(n) { return '×' + (SPD_NAME[n] || n); }
  // v2.4 [15]: auto-continue is a fresh opt-in (prefs.autoCont, default off); an old saved prefs.auto no longer applies
  if (prefs.autoCont == null) prefs.autoCont = false;

  // ---------- audio (ui/audio.js, owned by the audio worker; may be missing → every call is guarded) ----------
  var MUTE_Q = Q.get('mute') === '1'; // ?mute=1: tests and screenshot runs never make sound
  function au(fn, a, b) { try { var X = window.CHOOSER_AUDIO; if (X && typeof X[fn] === 'function') return X[fn](a, b); } catch (e) { /* audio must never break the game */ } return undefined; }
  // UI-CLEAN §3: the sound controls (mute, music, sfx) live in the ☰ menu (menuHtml)
  var cueLast = {};
  // every cue is throttled per name (default 60 ms) so nothing can fire in a tight loop
  function cue(name, detail, ms) { if (vn && vn.skipping) return; /* 跳过剧情: skipped lines and effects make no sound */ var t = Date.now(), gap = ms == null ? 60 : ms; if (cueLast[name] && t - cueLast[name] < gap) return; cueLast[name] = t; au('cue', name, detail); }
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
  function chainWords(s) { return String(s == null ? '' : s).replace(OLD_CHAIN(), T('ui.terms.chainWord')); } // SPEC-11-13 F: the teammate-chain word is 加成 (连击 = one blow, many hits)
  function fixWords(s) { return A.kwLabel(chainWords(s)); } // 2026-11-19: plain text shows a {k:term} keyword as its label
  function escHtml(s) { return s.replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function esc(s) { return escHtml(fixWords(s)); }
  function richText(s, vars) { return A.skillMarkup(escHtml(chainWords(s)), vars); } // **右侧** → bold; batch6 H2-17: **2** / {n} → bold accent number; {k:term} → keyword with its own tip
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
    if (A.isMerchant && A.isMerchant(id)) return T('ui.name.fluo'); // 2026-11-14 芙洛
    var m = member(id); if (m) return m.name;
    var u = bUnits().filter(function (x) { return x.id === id || x.uid === id; })[0]; if (u) return u.name;
    var c = cand(id); if (c) return c.name;
    var a = advData(id); if (a) return a.name;
    var e = (DATA.enemies || []).filter(function (x) { return x.id === id; })[0]; return e ? e.name : /^[\x00-\x7f]*$/.test(String(id)) ? '' : String(id);
  }
  function moodExpr(m) { return m == null ? 'calm' : m <= -2 ? 'sad' : m < 0 ? 'upset' : m > 0 ? 'happy' : 'calm'; }
  // 2026-11-20 用户「团长不是也有心情——怎么有些地方不显示了」: her face follows her mood like the girls' (she has no 'upset' art → sad);
  // calm keeps the old pick (determined from act 3). LEADER_MOOD_FACE false = the old fixed face
  var LEADER_MOOD_FACE = true;
  function leaderExpr(calmPick) { var m = LEADER_MOOD_FACE ? (member('leader') || {}).mood : null; return m == null || m === 0 ? calmPick : m < 0 ? 'sad' : 'happy'; }
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
  function corruptUnit(id) { return bUnits().filter(function (u) { return u.side !== 'ally' && (u.id === id || u.advisorId === id) && u.corruption && !u.mirror; })[0]; } // 2026-11-19: a mirror doll shares her id with our own girl — her lines keep her own face
  // batch6 H2-12 / H2-15: from L10 on (she has walked over to the other side: the fight, her death, the endings) the advisor wears her enemy clothes
  // 2026-11-20 用户「奥德丽还没叛变时的立绘是叛变之后的」: the L10 walk out (EXIT_FLOW) reaches level 10 before she turns — trust the engine's
  // advisor.turned when the view carries it (A.advisorTurned = level ≥ 10, kept for old saves / views without it)
  function advisorTurnedNow(v) { return !!v && (v.advisor && v.advisor.turned != null ? !!v.advisor.turned : A.advisorTurned(v)); }
  function advisorIsBoss() { return !!view && (view.storyId === 'finalReveal' || advisorTurnedNow(view) || bUnits().some(function (u) { return u.id === 'advisor-boss' || u.advisorId; })); }
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
    if (A.isCandidate(id) || A.isAdvisor(id) || A.isFairy(id) || (A.isMerchant && A.isMerchant(id))) return A.face(id, expr || 'calm', { variant: variant });
    return A.enemy(id);
  }
  function standList(id, variant) { return A.portrait(id, { variant: variant === 'flash' ? 'base' : variant }); }
  function isTurned(u) { return !!u && !u.woke && (u.turned || (u.side === 'ally' && !!u.corruption)); } // 2026-11-21 用户「反水过来的莉珂怎么没有威力标志」: a woken girl (view.woke) is a normal card
  // battle / prep card art for a unit or member
  function unitArt(u) {
    if (isLeader(u) && u.side === 'enemy' && u.corruption) return { list: A.face('leader', 'calm', { variant: 'possessed' }), fb: crestHtml() }; // 2026-11-19 小铃战: the leader's doll (魔化 = 玩偶)
    if (isLeader(u)) return { list: A.face('leader', u.side === 'enemy' ? 'calm' : leaderExpr(actNo() >= 3 ? 'determined' : 'calm'), { variant: actNo() >= 3 ? 'worn' : 'base' }), fb: crestHtml() };
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
  var ST_BAD = { 'swap-skip': 1, /* 2026-11-19 换位/暂停连做 */ 'slow-start': 1, 'mood-low': 1, debuffed: 1, smoke: 1, clause: 1, burn: 1, sear: 1 }; // 2026-11-19 文字修: + sear (焚痕) // 2026-11-16 灼烧 = bad, 祝福 = good (ST_GOOD)
  var ST_LABEL = lazy(function () { var o = {}; ['slow-start', 'formation', 'clause', 'luck', 'overtime', 'luckUp', 'smoke', 'drum', 'mood-low', 'debuffed', 'burn', 'sear', 'bless'].forEach(function (k) { o[k] = T('ui.status.label.' + k); }); return o; }); // 2026-11-19 文字修: + sear (焚痕)
  var ST_GOOD = { overtime: 1, luckUp: 1, /* 2026-11-20 BOSS_NEW_SKILLS: the L10 boss's buffs on her side */ ward: 1, bless: 1, tough: 1, shell: 1, ambush: 1, assist: 1, charge: 1, store: 1, escort: 1, doubleCut: 1, twinShot: 1, 'foe-lv2': 1, 'foe-lv3': 1, 'foe-lv4': 1 }; // 2026-11-15 enemy traits / skill levels: shown as strengths
  function kwStatus(id) { var K = DATA.keywords && DATA.keywords.status; return (K && K[id]) || null; } // 2026-11-14 发呆 (daze): keywords.json status label / tip
  function stObj(s) { if (typeof s !== 'string') return s; var k = kwStatus(s); return { id: s, label: ST_LABEL()[s] || (k && k.label) || s, tip: k && k.tip }; }
  function isBadStatus(s) { var o = stObj(s); return !!(o.dark || o.bad || ST_BAD[o.id] || (!ST_LABEL()[o.id] && !ST_HIDE[o.id] && o.id && !ST_GOOD[o.id])); }
  function hasBad(list) { return (list || []).some(function (s) { return !ST_HIDE[stObj(s).id] && isBadStatus(s); }); }
  var ST_OURS = { burn: 1, sear: 1, weak: 1 }; // 2026-11-24: statuses OUR side puts on a foe (shown on her card)
  function statusChips(list, side) {
    return (list || []).map(stObj).filter(function (o) { return !ST_HIDE[o.id] && !(side === 'enemy' && ST_BAD[o.id] && !ST_OURS[o.id]) ; }) /* 2026-11-24 用户「我放对方的灼烧、焚痕没显示」: what we put on a foe always shows */.map(function (o) {
      return '<span class="chip' + (isBadStatus(o) ? ' bad' : ' buff') + '" data-tip="' + esc(o.tip || o.text || T(isBadStatus(o) ? 'ui.status.badTip' : 'ui.status.goodTip', { name: o.label || o.name || o.id })) + '">' + esc(o.label || o.name || o.id) + '</span>';
    }).join('');
  }
  // §E6 every badge says what it does
  function MOOD_TIP(v) { return T(v >= 2 ? 'ui.mood.tip.high' : v <= -2 ? 'ui.mood.tip.low' : 'ui.mood.tip.normal'); }
  function moodFace(m, id) {
    if (!m || m.mood == null) return ''; // 2026-11-20 团长心情: the leader shows hers too (null = she has none)
    return '<span class="mood-face" data-mood-of="' + esc(id || m.id) + '" data-tip="' + esc(T('ui.mood.faceTip', { word: m.moodLabel || moodWord(m.mood), tip: MOOD_TIP(m.mood) })) + '"><img src="' + esc(A.moodIcon(m.mood)) + '" alt=""></span>';
  }
  function bondMark(m) {
    if (!m || !m.bond) return '';
    return m.bond === 'high' ? '<span class="bond hi" data-tip="' + T('ui.bond.trustTip') + '">♥</span>' : '<span class="bond lo" data-tip="' + T('ui.bond.knotTip') + '">♡</span>';
  }
  function plate(text, cls) { return '<div class="plate ' + (cls || '') + '"><span class="plate-in"><span class="plate-t">' + text + '</span></span></div>'; }
  // 2026-11-21 用户「开始之前是出口，开战之后都是第十关」: a hideNo level (L10) shows no number until the advisor turns (view.levelNoHidden)
  var LEVEL_HIDE_NO = true; // false = old: 「第 10 关」 everywhere
  function lvCfgUi(lv) { var L = (DATA && DATA.scenario && DATA.scenario.levels) || []; for (var i = 0; i < L.length; i++) if (L[i].level === lv) return L[i]; return null; }
  function lvNoHidden(lv) { var c = lvCfgUi(lv); return LEVEL_HIDE_NO && !!(c && c.hideNo) && !(view && view.level === lv && !view.levelNoHidden); }
  function lvNo(lv) { return lvNoHidden(lv) ? '' : T('ui.level.no', { n: esc(lv) }); }
  function levelText(v) {
    if (v.level && lvNoHidden(v.level)) return esc(v.levelTitle || routeTitle(v.level));
    return v.level ? T('ui.level.no', { n: esc(v.level) }) + (v.levelTitle ? '<small>' + esc(v.levelTitle) + '</small>' : '') : T('ui.level.guild');
  }
  function heading(title, sub, cls) { return '<div class="heading ' + (cls || '') + '"><h2><span class="hd-t">' + esc(title) + '</span></h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>'; }
  // 2026-11-25 用户「道具 和 遗物/铃铛 分开」(TOPBAR_SPLIT; false = old: bells inside the bag chip, guild relics as name pills):
  //  relics + bells line up from the left right after the level plate (never over it; too many → the strip clips), like StS;
  //  items sit on the right in BAG_SLOTS fixed slots (empty ones drawn as empty sockets).
  var TOPBAR_SPLIT = true, BAG_SLOTS = 5;
  function relicStrip(relics, guild) {
    var bells = (relics || []).map(function (r) { var o = typeof r === 'string' ? { id: r } : r || {}, R = ((DATA.linesV2 || {}).relics || {})[o.id] || {}, name = o.name || R.name || T('ui.relic.unnamed');
      return '<span class="rs-it" tabindex="0" data-rk="' + esc(relicKey(o)) + '" aria-label="' + esc(name) + '" data-tip="' + esc(T('ui.relic.tip', { name: name, text: o.text || R.text || T('ui.relic.unknownText') })) + '">' + pic(A.relicIcon(o.id, o.key), 'rs-ic', name, '<i class="key-g kg-bell"></i>') + '</span>'; });
    var gr = (guild || []).map(function (r) { return '<span class="rs-it" tabindex="0" data-rk="g:' + esc(r.id) + '" aria-label="' + esc(r.name) + '" data-tip="' + esc(T('ui.guildRelic.tip', { name: r.name, text: fixWords(r.text || '') })) + '">' + pic(A.relicIcon(r.id), 'rs-ic', r.name, '<span class="rs-name">' + esc(r.name) + '</span>') + '</span>'; });
    var all = gr.concat(bells);
    return all.length ? '<span class="relic-strip">' + all.join('') + '</span>' : '';
  }
  // 2026-11-25 用户「获得铃铛 遗物 要出现这个物品的介绍 然后图标飞到遗物栏」(RELIC_GAIN_FX): any relic / bell / team card that is new
  // after an action → a card in the middle (picture, name, what it does; click or wait) → on the next screen its picture flies
  // from the middle into its place in the relic strip (that slot stays hidden until it lands). No strip on that screen → it waits.
  var RELIC_GAIN_FX = true, relicFlyQ = [], relicHeld = [];
  function relicKey(o) { return o.id === 'bell' ? 'bell:' + (o.key || 'bell') : 'r:' + o.id; }
  function relicsOf(v) {
    var out = [];
    ((v && (v.relics || (v.run && v.run.relics))) || []).forEach(function (r) { var o = typeof r === 'string' ? { id: r } : r || {}, R = ((DATA.linesV2 || {}).relics || {})[o.id] || {};
      out.push({ k: relicKey(o), icon: A.relicIcon(o.id, o.key), name: o.name || R.name || T('ui.relic.unnamed'), text: o.text || R.text || '' }); });
    ((v && v.guildRelics) || []).forEach(function (r) { out.push({ k: 'g:' + r.id, icon: A.relicIcon(r.id), name: r.name, text: fixWords(r.text || '') }); });
    return out;
  }
  function newRelics(a, b) { var had = {}; relicsOf(a).forEach(function (r) { had[r.k] = 1; }); return relicsOf(b).filter(function (r) { return !had[r.k]; }); }
  function relicGainFx(r) {
    return stages([
      [function () { cue('item', null, 0); cine('relicget', '<div class="rg-card"><small class="rg-got">' + T('ui.relic.gained') + '</small>' + pic(r.icon, 'rg-ic', r.name, '') + '<b class="rg-name">' + esc(r.name) + '</b>' + (r.text ? '<p class="rg-text">' + richText(r.text) + '</p>' : '') + '<small class="rg-tap">' + T('ui.relic.gainedTap') + '</small></div>'); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 4200],
      [function () { relicFlyQ.push(r); cineEl.classList.add('out'); }, 450],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; }, 10]
    ]);
  }
  function flyRelics() {
    var strip = app.querySelector('.topbar .relic-strip'); if (!strip || !relicFlyQ.length) return;
    var q = relicFlyQ; relicFlyQ = [];
    q.forEach(function (r, i) {
      var slot = strip.querySelector('[data-rk="' + r.k + '"]'); if (!slot) return;
      slot.style.visibility = 'hidden';
      setTimeout(function () {
        var to = stagePt(slot, 0.5, 0.5), d = document.createElement('div'); d.className = 'item-fly relic-fly'; d.innerHTML = pic(r.icon, '', '', '');
        d.style.left = '960px'; d.style.top = '480px'; stageEl.appendChild(d);
        var dx = to.x - 960, dy = to.y - 480, done = function () { d.remove(); slot.style.visibility = ''; pulse(slot, 'bag-pulse', 900); };
        if (!d.animate || REDUCED) { done(); return; }
        d.animate([{ transform: 'translate(-50%,-50%) scale(2.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) translate(' + (dx * 0.5) + 'px,' + (dy * 0.5 - 120) + 'px) scale(1.4)', opacity: 1, offset: 0.5 },
          { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(.5)', opacity: 0.95 }], { duration: 1000, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' }).finished.then(done, done);
      }, 200 + i * 350);
    });
  }
  function bagSlots(items) {
    var list = items || [], out = [];
    for (var i = 0; i < Math.max(BAG_SLOTS, list.length); i++) {
      var it = list[i];
      out.push(it ? '<span class="bs-slot"><img class="' + rarCls(it).trim() + '" src="' + esc(A.itemIcon(it.itemId)) + '" alt="' + esc(it.name) + '" data-tip="' + esc(it.name + '：' + it.text) + '"></span>' : '<span class="bs-slot bs-empty" aria-hidden="true"></span>');
    }
    return '<span class="bag-chip bag-slots" data-tip="' + T('ui.bag.tip', { n: BAG_SLOTS }) + '">' + out.join('') + '</span>';
  }
  function bagChip(items, relics) {
    // §E14 relics (the bell) sit in the bag area but use no slot
    var rl = (relics || []).map(function (r) { var o = typeof r === 'string' ? { id: r } : r || {}, R = ((DATA.linesV2 || {}).relics || {})[o.id] || {};
      return '<span class="relic" data-tip="' + esc(T('ui.relic.tip', { name: o.name || R.name || T('ui.relic.unnamed'), text: o.text || R.text || T('ui.relic.unknownText') })) + '">' + pic(A.relicIcon(o.id, o.key), '', '', '<i class="key-g kg-bell"></i>') + '</span>'; }).join('');
    if ((!items || !items.length) && !rl) return '';
    return '<span class="bag-chip" data-tip="' + T('ui.bag.tip', { n: BAG_SLOTS }) + '">' + (items || []).map(function (it) { return '<img class="' + rarCls(it).trim() + '" src="' + esc(A.itemIcon(it.itemId)) + '" alt="" data-tip="' + esc(it.name + '：' + it.text) + '">'; }).join('') + rl + '</span>';
  }
  // 2026-11-22 遗物 (engine view.guildRelics): the guild's team-wide relics — one small pill each, the effect in its tip
  function guildRelicChip(list) {
    if (!list || !list.length) return '';
    return '<span class="grelic-chip">' + list.map(function (r) { return '<span class="grelic grelic-pic" tabindex="0" aria-label="' + esc(r.name) + '" data-tip="' + esc(T('ui.guildRelic.tip', { name: r.name, text: fixWords(r.text || '') })) + '">' + pic(A.relicIcon(r.id), 'grelic-ic', r.name, esc(r.name)) + '</span>'; } /* 2026-11-25: the relic's picture, name in the tip (no picture → the name, as before) */).join('') + '</span>';
  }
  function advisorChip(a) { // UI-CLEAN §2.1: only her face in the top bar; name, state and skill live in the tip
    if (!a) return '';
    var gone = !a.present, tip = T(gone ? 'ui.advisor.chipTipGone' : a.combat ? 'ui.advisor.chipTip' : 'ui.advisor.chipTipPlain', { name: a.name, skill: a.combat ? a.combat.name : '', text: a.combat ? a.combat.text : '' });
    var turned = gone && !!a.turned; // 2026-11-19 试玩修 界面: after the betrayal she is the boss — the chip says so (no 顾问 / skill text), red ring
    if (turned) tip = T('ui.advisor.chipTipTurned', { name: a.name });
    return '<span class="adv-chip' + (gone ? ' gone' : '') + (turned ? ' turned' : '') + '" tabindex="0" data-tip="' + esc(tip) + '"><span class="ac-face">' + pic(A.face(a.id, gone ? 'sad' : 'calm'), '', a.name, initialHtml(a.name)) + '</span></span>';
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
  var vn = { q: [], cur: null, eff: null, typing: false, t: null, busy: false, cls: '', skipping: false, carry: 0 }; /* skipping: 跳过剧情 is draining the queue; carry: until when a talk queued right after it is skipped too */ // vn.cls: screen-wide box placement (camp, epi-vn …)
  function normLine(l) {
    if (l == null) return null;
    if (typeof l === 'string') return l ? { speaker: 'narrator', text: l } : null;
    if (!l.text) return null;
    var o = {}; Object.keys(l).forEach(function (k) { o[k] = l[k]; }); return o;
  }
  function say(lines, done) { (lines || []).forEach(function (l) { var n = normLine(l); if (n) vn.q.push(n); }); if (done) vn.q.push({ marker: done }); if (QUICK) { vn.skipping = true; setTimeout(kick, 0); return; } if (!vn.skipping && vn.carry > Date.now() && vn.q.length) vn.skipping = true; kick(); }
  // 2026-11-20 用户「快速模式应该只跳过对话，现在把献祭选了谁、加血加了多少、锻炼的效果等级提升都跳过去了」: keep = a RESULT effect
  // (献祭 / 休息回血 / 锻炼 / 升级 / 心情) — 快速模式 plays it in full; only lines and story effects (title cards, fades …) are skipped.
  // The 跳过剧情 button (vn.userSkip) still skips everything. QUICK_KEEP_RESULTS false = the old quick mode (results skipped too)
  var QUICK_KEEP_RESULTS = true;
  function sayFx(fn, keep) { vn.q.push({ effect: fn, keep: !!keep }); if (QUICK) setTimeout(kick, 0); else kick(); } /* 快速模式: a talk queued in the same tick skips it too */
  function sayP(lines) { return new Promise(function (r) { say(lines, r); }); }
  function kick() { if (!vn.cur && !vn.eff && !vn.busy) vnNext(); }
  function vnActive() { return !!(vn.cur || vn.eff || vn.q.length); }
  function vnClear() { vn.skipping = false; vn.userSkip = false; vn.carry = 0; clearInterval(vn.t); vn.q = []; vn.cur = null; vn.eff = null; vn.typing = false; vnEl.hidden = true; vnEl.innerHTML = ''; vn.cls = ''; document.body.classList.remove('vn-on'); cineEl.innerHTML = ''; cineEl.className = 'cine'; syncSkip(); }
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
        if (vn.skipping && !it.effect) continue; /* 跳过剧情: the line is passed over unseen (no onShow, no stand change, no sound) */
        if (it.effect) {
          vn.cur = null; vn.eff = it; vnEl.hidden = true; document.body.classList.remove('vn-on');
          var self = it; vn.busy = false;
          it.effect(function () { if (vn.eff !== self) return; vn.eff = null; vnNext(); }, it);
          syncSkip(); if (vn.skipping && !(QUICK && QUICK_KEEP_RESULTS && it.keep && !vn.userSkip)) skipEffect(self); /* 跳过剧情: a blocking effect is clicked through (never a choice: those are screens) */
          return;
        }
        break;
      }
    } finally { vn.busy = false; }
    vn.cur = it || null;
    if (!vn.cur && vn.skipping) { vn.skipping = false; vn.userSkip = false; vn.carry = Date.now() + 500; } /* 跳过剧情 stops where the talk runs out (the next choice) */
    if (!vn.cur) { syncSkip(); vnEl.hidden = true; vnEl.innerHTML = ''; document.body.classList.remove('vn-on'); if (ui.onSpeak) ui.onSpeak(null); return; }
    showLine(vn.cur);
  }
  // §E7 masked-noble gallery speaker: a stand portrait (noble-a/b/c, picked by the line) above the box; a dark silhouette until delivered
  function nobleStand(l) {
    var t = String(l.text || ''), h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    var x = l.noble || ['a', 'b', 'c'][h % 3];
    return '<div class="noble-stand n-' + x + '" aria-hidden="true">' + pic(A.noble(x), 'stand-img', '', '<span class="noble-sil"><i class="ns-mask"></i><i class="ns-grin"></i></span>') + '</div>';
  }
  // 2026-11-15 跳过剧情 ⏭: ONE button (top right) whenever a talk or story plays. A click drains the whole dialogue queue — lines
  // passed over silently, markers (end callbacks) run in order, blocking effects clicked through — and a talk the markers queue
  // right after (camp → 芙洛, bell lines) goes too; it stops at the next screen that asks. A screen with its own sequence
  // (the opening, the epilogue) sets storyHook { on(), skip() } instead.
  var storyHook = null, skipBtn = null;
  var BIG_TELL_SIDE = true; // 2026-11-19 试玩修 界面: false = the old place (the 「翻倍」 warning in the middle box, over our cards)
  function skipOn() { return !!(storyHook && storyHook.on()) || !!(vn.cur || vn.eff) && !vn.skipping; }
  function syncSkip() {
    if (!skipBtn) { skipBtn = document.createElement('button'); skipBtn.type = 'button'; skipBtn.id = 'storySkip'; skipBtn.className = 'story-skip vn-pass'; skipBtn.textContent = T('ui.dialog.skipStory'); skipBtn.hidden = true; stageEl.appendChild(skipBtn); }
    if (QUICK && !$('quickTag')) { var qt = document.createElement('div'); qt.id = 'quickTag'; qt.className = 'quick-tag'; qt.textContent = T('ui.dialog.quickMode'); stageEl.appendChild(qt); } /* 快速模式 corner tag */
    if (storyHook && !storyHook.on()) storyHook = null;
    skipBtn.hidden = !skipOn() || !modalEl.hidden;
  }
  function storySkip() {
    if (view && view.phase === 'battle') ui.rivalSkip = view.level; // 2026-11-20: 跳过剧情 in a fight → her whole segment is skipped for this level
    if (!skipOn() || !modalEl.hidden) return;
    if (storyHook) { pl('event', 'storySkip', { kind: storyHook.kind }); storyHook.skip(); syncSkip(); return; }
    pl('event', 'storySkip', { phase: view && view.phase });
    vn.skipping = true; vn.userSkip = true; clearInterval(vn.t); vn.typing = false; vnEl.classList.remove('typing');
    if (vn.eff) skipEffect(vn.eff); else { vn.cur = null; vnNext(); }
    syncSkip();
  }
  function skipEffect(it) { /* stages() skip synchronously; a 'noskip' stage is waited out (then vnNext goes on skipping) */
    for (var n = 0; n < 20 && vn.eff === it && it.skip; n++) it.skip();
    if (vn.eff !== it) return;
    var k = 0, h = setInterval(function () { if (vn.eff !== it || !vn.skipping || ++k > 60) { clearInterval(h); return; } if (it.skip) it.skip(); }, 120);
  }
  setInterval(syncSkip, 300); /* the hooks (opening, epilogue) and the ☰ menu change without a vn call */
  function showLine(l) {
    var sid = speakerId(l), gallery = l.speaker === 'gallery', variant = sid ? variantFor(sid, l) : null;
    var name = l.name || (sid ? nameOf(sid) : gallery ? T('ui.dialog.galleryVoice') : '');
    if (NO_NAME[name]) name = ''; // 2026-11-14 结局去英文: never a 「narrator」 plate (a player's own Latin leader name stays)
    var face = sid ? '<div class="vn-face v-' + variant + '">' + pic(faceList(sid, l.expr, variant), '', name, sid === 'leader' ? crestHtml() : initialHtml(name)) + '</div>' : '';
    vnEl.innerHTML = '<div class="vn-box' + (sid ? ' has-face' : gallery ? ' gallery' : ' narration') + (l.kind === 'flashback' ? ' flashback' : '') + (variant && variant !== 'base' ? ' v-' + variant : '') + (l.tone ? ' tone-' + l.tone : '') + (l.mad ? ' tone-mad' : '') + (l.bellGot ? ' bell-got' : '') /* 2026-11-20 用户「三个铃铛获得时字要加粗」 */ + '">' + face +
      '<div class="vn-body">' + (name ? '<div class="nameplate">' + esc(name) + (l.tag ? '<small>' + esc(l.tag) + '</small>' : '') + '</div>' : '') +
      '<div class="vn-text" id="vnText"></div><span class="vn-next" aria-hidden="true">▼</span></div></div>' + (gallery ? nobleStand(l) : '');
    vnEl.className = 'vn' + (l.vnClass ? ' ' + l.vnClass : vn.cls ? ' ' + vn.cls : '');
    vnEl.hidden = false; document.body.classList.add('vn-on'); syncSkip();
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
    if (e.target.closest && e.target.closest('.story-skip')) { e.preventDefault(); e.stopPropagation(); cue('advance'); storySkip(); return; } /* 2026-11-15 跳过剧情 */
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
    var ch = (ev.changes || []).filter(function (c) { return !(c.stat === 'mood' && lead && c.to == null); }); // 2026-11-20 团长心情: her mood rows show in the training card too (was: always hidden)
    var label = (tr && tr.label) || T('ui.train.defaultLabel'), stand = pic(A.portrait(lead ? 'leader' : id, { variant: lead && actNo() >= 3 ? 'worn' : 'base' }), 'stand-img', who, lead ? crestHtml() : initialHtml(who));
    var html = '<div class="tr-band"></div><div class="tr-stand">' + stand + '</div><div class="tr-text"><small class="tr-k">' + T(tr && tr.special ? 'ui.train.specialDone' : 'ui.train.done') + '</small>' +
      '<b class="tr-name">' + esc(label) + '</b><span class="tr-who">' + esc(who) + '</span><div class="tr-rows">' + ch.map(statRow).join('') + '</div></div>';
    return stages([[function () { cue('moodUp'); cine('train', html); requestAnimationFrame(function () { cineEl.classList.add('on'); }); }, 2000], [function () { cineOff(); }, 300]]);
  }
  function moodFx(list0) { // [{id, delta, mood}]
    // feedback-1112 [26]: one face per girl: her changes are summed, the last mood wins; a net zero shows nothing
    var by = {}, list = [], whys = []; // whys: 2026-11-24 MOOD_WHY — the reason lines, under the faces (a net zero still shows its line)
    list0.forEach(function (m) { var o = by[m.id]; if (!o) { o = by[m.id] = { id: m.id, name: m.name, delta: 0, mood: m.mood }; list.push(o); } o.delta += +m.delta || 0; if (m.mood != null) o.mood = m.mood; if (m.whyText) whys.push(m.whyText); });
    list = list.filter(function (m) { return m.delta !== 0; });
    if (!list.length && !whys.length) return function (done) { done(); };
    var html = list.map(function (m) {
      var who = member(m.id) || { name: m.name || nameOf(m.id) };
      return '<div class="md-one' + (m.delta < 0 ? ' down' : ' up') + '"><span class="md-face">' + pic(A.face(m.id, m.delta < 0 ? 'sad' : 'happy'), '', who.name, initialHtml(who.name)) + '</span>' +
        '<b>' + esc(who.name) + '</b><span class="md-icon"><img src="' + esc(A.moodIcon(m.mood != null ? m.mood : 0)) + '" alt=""></span><span class="md-arrow">' + (m.delta < 0 ? '↓' : '↑') + '</span></div>';
    }).join('');
    var down = list.some(function (m) { return m.delta < 0; });
    var whyHtml = whys.length ? '<div class="md-why">' + whys.map(function (w) { return '<div>' + richText(w) + '</div>'; }).join('') + '</div>' : '';
    return stages([[function () { if (list.length) cue(down ? 'moodDown' : 'moodUp'); cine('mood', (list.length ? '<div class="md-row">' + html + '</div>' : '') + whyHtml); }, whys.length ? 2600 : 1900], [function () { cineOff(); }, 300]]);
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
  // 2026-11-19 交给规则·老虎机: the highlight frame jumps over the sacrifice cards (A.spinPlan: fast → slow) and stops on the card the
  // engine already took (the result is decided; this is presentation only), pulses once, holds, then the old sacrifice scene runs.
  // A click / tap during the spin lands it at once.
  function sacSpinFx(targetId) {
    return function (done, it) {
      var rows = [].slice.call(app.querySelectorAll('.sac-list .sac-row')), ids = rows.map(function (r) { return r.dataset.id; }), ti = ids.indexOf(targetId);
      if (ti < 0 || rows.length < 2) { done(); return; }
      var plan = A.spinPlan(rows.length, ti, REDUCED), k = -1, t = null, over = false;
      app.classList.add('sac-spinning'); rows.forEach(function (r) { r.classList.remove('sel'); });
      function light(i) { rows.forEach(function (r, j) { r.classList.toggle('spin-on', j === i); }); }
      function finish() { if (over) return; over = true; clearTimeout(t); app.classList.remove('sac-spinning'); rows.forEach(function (r) { r.classList.remove('spin-on', 'spin-lock'); }); done(); }
      function land() {
        clearTimeout(t); k = plan.length; light(ti); rows[ti].classList.add('spin-lock'); cue('pick', null, 0);
        it.skip = finish; t = setTimeout(finish, A.SAC_SPIN_LOCK);
      }
      function step() { k++; if (k >= plan.length) { land(); return; } light(plan[k].index); cue('chargeTick', { n: 2 }, 20); if (k === plan.length - 1) { land(); return; } t = setTimeout(step, plan[k + 1].delayMs); }
      it.skip = land;
      t = setTimeout(step, plan[0].delayMs);
    };
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
  var STAT_NAME = lazy(function () { return { atk: T('ui.stat.atk'), maxHp: T('ui.stat.maxHp'), hp: T('ui.stat.hp'), mood: T('ui.stat.mood'), skillLv: T('ui.stat.skillLv'), skillPower: T('ui.stat.skillLv'), xp: T('ui.stat.xp'), luck: T('ui.stat.luck') /* 2026-11-22 厄运 / 幸运 previews */, charge: T('ui.stat.charge') /* 2026-11-23 面具印记 */ }; }); // 2026-11-16 经验
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
  // 2026-11-19 试玩修 界面: a crit that ran past her last hp (engine tr.overkill) floats 「−4」 with 「暴击 16（溢出）」, so it does
  // not read as a failed crit. null = not a crit / nothing cut off (then the old 「暴击！」 tag)
  function critOverTag(t) { return !ONE_HIT_NUMBER && t && t.crit && t.overkill > 0 && t.kind !== 'heal' ? T('ui.battle.critOver', { n: (t.amount || 0) + t.overkill }) : null; }
  // 2026-11-20 ONE_HIT_NUMBER (用户: 「-3 15 暴击溢出」 为什么是 -3？): a crit that ran past her last hp shows ONE number — the
  // whole crit (hp lost + overkill), big, in the crit style. Old: −(hp lost) with 「暴击 N（溢出）」 over it
  function critFull(t) { return ONE_HIT_NUMBER && t && t.crit && t.overkill > 0 && t.kind !== 'heal' ? Object.assign({}, t, { amount: (t.amount || 0) + t.overkill }) : t; }
  var STAT_GLYPH = { atk: 'power', maxHp: 'maxhp', hp: 'hp', mood: 'mood', skillLv: 'level', skillPower: 'level', luck: 'luck' /* 2026-11-20 幸运 */ };
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
  // 2026-11-16 经验条 (用户「锻炼的时候看不出经验」): x = the engine's { xp, lv, xpLvStart, xpNext, maxed }; g = an xpGain preview
  // ({ gain, to, up, atk, maxHp, skill }) → the bar shows where the xp lands in a second colour, plus 「经验 +3」 / 「升级！Lv3 → Lv4」
  function xpBarHtml(x, g) {
    if (!x || x.lv == null || x.xp == null) return '';
    var over = x.maxed && x.overStart != null; // 2026-11-16 满级加成: the bar keeps going — every 6 经验 威力 +1, 生命上限 +2
    var st = over ? x.overStart : x.xpLvStart, nx = over ? x.overNext : x.xpNext;
    var span = x.maxed && !over ? 1 : Math.max(1, nx - st), pct = x.maxed && !over ? 100 : Math.max(0, Math.min(100, Math.round((x.xp - st) * 100 / span)));
    var add = 0, gain = g && g.gain > 0 ? g : null, lifts = gain ? (gain.up > 0 || gain.over > 0) : false;
    if (gain && (!x.maxed || over)) add = lifts ? 100 - pct : Math.max(0, Math.min(100 - pct, Math.round((gain.to.xp - st) * 100 / span) - pct));
    var txt = over ? T('ui.xp.maxedOver', { lv: x.lv, n: x.xp - st, step: nx - st }) : x.maxed ? T('ui.xp.maxed', { lv: x.lv }) : T('ui.xp.bar', { lv: x.lv, xp: x.xp, next: x.xpNext });
    var h = '<span class="xp-bar' + (x.maxed ? ' maxed' : '') + (gain ? ' has-gain' : '') + '" data-tip="' + esc(T('ui.xp.barTip')) + '"><span class="xp-track"><i class="xp-fill" style="width:' + pct + '%"></i>' +
      (add > 0 ? '<i class="xp-add" style="left:' + pct + '%;width:' + add + '%"></i>' : '') + '</span><span class="xp-txt">' + esc(txt) + '</span></span>';
    if (!gain) return h;
    var left = !lifts && nx != null ? nx - gain.to.xp : null;
    h += '<span class="xp-gain">' + esc(T(x.maxed ? 'ui.xp.gainMaxed' : 'ui.xp.gain', { n: gain.gain })) + (left != null ? '<small class="xp-left">' + esc(T(over ? 'ui.xp.toOver' : 'ui.xp.toNext', { n: left })) + '</small>' : '') + '</span>';
    if (gain.up > 0 || gain.over > 0) {
      h += '<span class="xp-up"><b>' + esc(gain.up > 0 ? T('ui.xp.levelUp', { from: x.lv, to: gain.to.lv }) : T('ui.xp.overUp')) + '</b>' +
        (gain.atk ? '<span>' + esc(T('ui.xp.upAtk', { n: gain.atk })) + '</span>' : '') + (gain.maxHp ? '<span>' + esc(T('ui.xp.upMaxHp', { n: gain.maxHp })) + '</span>' : '') +
        (gain.up > 0 && gain.skill ? '<span class="xp-sk">' + (gain.skill.from && gain.skill.to ? richText(T('ui.xp.upSkill', { from: gain.skill.from, to: gain.skill.to })) : esc(T('ui.xp.upSkillLv', { from: gain.skill.fromLv, to: gain.skill.toLv }))) + '</span>' : '') + '</span>';
    }
    return h;
  }
  // the stat rows a level-up already says in the 经验 block (xp / Lv / skill; and atk / maxHp / hp when she levels)
  function previewMinusXp(list, g) {
    if (!g || !(g.gain > 0)) return list;
    var skip = { xp: 1, skillLv: 1, skill: 1 }; if (g.up > 0) { skip.atk = 1; skip.maxHp = 1; skip.hp = 1; }
    return (list || []).filter(function (c) { return !skip[c.stat]; });
  }
  // 2026-11-19: a training card says each effect once — its line already reads 「经验 +2　☺+1」, so the preview drops that stat
  var TRAIN_ONE_LINE = true; // false: the old extra line + the full preview
  function previewMinusExtra(list, b) {
    var e = TRAIN_ONE_LINE && b && b.extra; if (!e) return list;
    var st = e.type === 'mood' ? 'mood' : e.type === 'stat' ? e.stat : null; if (!st) return list;
    return (list || []).filter(function (c) { return c.stat !== st; });
  }
  function previewHtml(list) { list = A.statRows(list); return list.length ? '<span class="stat-prev">' + list.map(statRow).join('') + '</span>' : ''; }
  function statToast(ev) {
    var ch = A.statRows((ev.changes || []).filter(function (c) { return !(c.stat === 'mood' && ev.id === 'leader' && c.to == null); })); if (!ch.length) return; // 2026-11-20 团长心情: her mood rows show too (was: never the leader's)
    var who = isLeader(ev.id) ? T('ui.name.you') : (member(ev.id) || {}).name || nameOf(ev.id);
    var d = document.createElement('div'); d.className = 'stat-toast';
    d.innerHTML = '<b class="st-who">' + esc(who) + '</b>' + ch.map(statRow).join('');
    var host = stageEl.querySelector('.toast-stack') || (function () { var h = document.createElement('div'); h.className = 'toast-stack'; stageEl.appendChild(h); return h; })();
    host.appendChild(d); setTimeout(function () { d.classList.add('out'); }, 2600); setTimeout(function () { d.remove(); }, 3200);
  }
  // ===== 2026-11-19 用户亲测 界面: 升级页 (「不要那个冒泡。升级时弹出一个升级页面 + 音效，列出升级后的变化」) =====
  // One page per level-up: her portrait, Lv a → b, the rows that changed (威力 +1 / 生命上限 +N / 技能 old → new), and her line
  // 「我感觉自己的训练有了效果！」. It is a blocking effect in the dialogue queue: a tap / Enter / Space = the next page; 跳过剧情
  // and 快速模式 pass it. Items: lvUpFromGain (the engine's xpGainFor of a battle) / lvUpFromEvent (a statChange with a level).
  function lvUpName(id) { return isLeader(id) ? T('ui.name.you') : (member(id) || {}).name || nameOf(id); }
  function lvUpFromGain(id, g) {
    if (!g || !(g.up > 0 || g.over > 0)) return null;
    var up = g.up > 0, sk = up && g.skill && g.skill.from && g.skill.to ? { from: g.skill.from, to: g.skill.to } : null;
    return { id: id, name: lvUpName(id), from: g.from.lv, to: g.to.lv, over: !up, atk: g.atk || 0, maxHp: g.maxHp || 0, skill: sk };
  }
  function lvUpFromEvent(ev) {
    var by = {}; (ev && ev.changes || []).forEach(function (c) { by[c.stat] = c; });
    var lv = by.skillLv; if (!lv || !(lv.to > lv.from)) return null;
    var m = member(ev.id) || {}, kind = m.skill && m.skill.kind, sk = null;
    if (kind && typeof E.skillLvLine === 'function') { try { var a = E.skillLvLine(kind, lv.from), b = E.skillLvLine(kind, lv.to); if (a && b && a !== b) sk = { from: a, to: b }; } catch (e) { sk = null; } }
    return { id: ev.id, name: lvUpName(ev.id), from: lv.from, to: lv.to, over: false, atk: by.atk ? by.atk.to - by.atk.from : 0, maxHp: by.maxHp ? by.maxHp.to - by.maxHp.from : 0, skill: sk };
  }
  function lvUpPageHtml(it, i, n) {
    var lead = isLeader(it.id), stand = pic(A.portrait(lead ? 'leader' : it.id, { variant: lead && actNo() >= 3 ? 'worn' : 'base' }), 'stand-img', it.name, lead ? crestHtml() : initialHtml(it.name));
    var row = function (g, k, v, cls) { return '<li class="lu-row' + (cls ? ' ' + cls : '') + '"><span class="lu-ic">' + A.glyph(g, false) + '</span><span class="lu-k">' + esc(T(k)) + '</span><span class="lu-v">' + v + '</span></li>'; };
    var rows = (it.atk ? row('power', 'ui.lvup.atk', '<b>+' + esc(it.atk) + '</b>') : '') + (it.maxHp ? row('maxhp', 'ui.lvup.maxHp', '<b>+' + esc(it.maxHp) + '</b>') : '') +
      (it.skill ? row('level', 'ui.lvup.skill', '<span class="lu-old">' + richText(it.skill.from) + '</span><i class="lu-arrow" aria-hidden="true"></i><span class="lu-new">' + richText(it.skill.to) + '</span>', 'lu-skill') : '');
    var lv = it.over ? '<span class="lu-lv one">Lv' + esc(it.to) + '</span>' : '<span class="lu-lv"><span class="lu-from">Lv' + esc(it.from) + '</span><i class="lu-arrow" aria-hidden="true"></i><span class="lu-to">Lv' + esc(it.to) + '</span></span>';
    var dots = n > 1 ? '<span class="lu-dots" aria-hidden="true">' + Array.apply(null, { length: n }).map(function (x, j) { return '<i' + (j === i ? ' class="on"' : '') + '></i>'; }).join('') + '</span>' : '';
    return '<div class="lu-page paper" data-id="' + esc(it.id) + '"><div class="lu-art">' + stand + '</div><div class="lu-body">' +
      '<small class="lu-k0">' + esc(T(it.over ? 'ui.lvup.kickerOver' : 'ui.lvup.kicker')) + '</small><b class="lu-name">' + esc(it.name) + '</b>' + lv +
      (rows ? '<ul class="lu-list">' + rows + '</ul>' : '') + '<q class="lu-say">' + esc(T('ui.lvup.say')) + '</q></div>' +
      '<div class="lu-foot">' + dots + '<span class="lu-next">' + esc(T('ui.lvup.next')) + '</span></div></div>';
  }
  function lvUpCue() { var X = window.CHOOSER_AUDIO, has = !!(X && X.CUES && X.CUES.indexOf('levelUp') >= 0); cue(has ? 'levelUp' : 'reward', null, 0); } // an audio.js without the cue: the reward chime
  function lvUpFx(list) {
    list = (list || []).filter(Boolean);
    return function (done, it) {
      if (!list.length) { done(); return; }
      var i = -1, at = 0, ov = document.createElement('div'); ov.className = 'lvup-ov'; stageEl.appendChild(ov);
      function close() { ov.classList.add('out'); setTimeout(function () { ov.remove(); }, REDUCED ? 0 : 320); done(); }
      function next() {
        if (++i >= list.length) { close(); return; }
        ov.innerHTML = lvUpPageHtml(list[i], i, list.length); at = Date.now();
        ov.classList.remove('in'); void ov.offsetWidth; ov.classList.add('in'); lvUpCue();
      }
      it.skip = function () { if (!vn.skipping && Date.now() - at < 350) return; next(); }; // a tap carried over from the last screen does not turn the page
      next();
    };
  }
  function showLevelUps(list) { list = (list || []).filter(Boolean); if (LEVELUP_PAGE && list.length) sayFx(lvUpFx(list), true); }
  // the stat rows a level-up page already says (a bubble / the training card does not repeat them)
  var LV_ROWS = { skillLv: 1, skill: 1, atk: 1, maxHp: 1, hp: 1, xp: 1 };
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
  var DISROBE_LINE = false; // see advisorLeaves (true = the old extra 「她解开公会的旧外套…」 line)
  var SILENT = { card: 1, sacrifice: 1, pleased: 1, displeased: 1, phase: 1, chain: 1, end: 1 };
  function eventsToQueue(evs, nextView, opts) {
    var moods = [], skipDark = opts && opts.skipDark, trainEv = null, ups = []; // ups: 2026-11-19 用户亲测 界面 升级页 (shown after the batch)
    function flushMood() { if (moods.length) { sayFx(moodFx(moods), true); moods = []; } }
    (evs || []).forEach(function (ev) {
      if (!ev) return;
      if (ev.kind === 'mood') { moods.push(ev); return; } // 2026-11-20 团长心情: the leader's mood moves too (was: skipped)
      if (ev.kind === 'farewellEnd') { say([], function () { app.querySelectorAll('.fw-busts').forEach(function (x) { x.classList.add('gone'); }); }); return; } // feedback-1112 #15: her goodbye is over; the others react after
      if (SILENT[ev.kind] || ev.kind === 'cheat') return; // feedback-1112 [26]: a silent event doesn't split one mood screen into two
      if (ev.kind === 'train') { flushMood(); trainEv = ev; return; } // feedback-1112 [20]: shown by the full-screen training card
      if (ev.kind === 'statChange' && /^train:/.test(ev.source || '')) {
        var tlu = LEVELUP_PAGE ? lvUpFromEvent(ev) : null; // 2026-11-19 用户亲测 界面: a level from training → its page right after the training card
        sayFx(trainFx(tlu ? { id: ev.id, name: ev.name, source: ev.source, changes: (ev.changes || []).filter(function (c) { return c.stat !== 'skillLv'; }) } : ev, trainEv), true); trainEv = null; flushMood();
        if (tlu) showLevelUps([tlu]); return;
      }
      flushMood();
      if (trainEv) { var te0 = trainEv; trainEv = null; say([{ speaker: 'narrator', text: te0.text }]); } // no stat moved: the plain line
      if (ev.kind === 'statChange' && ev.source === 'rest') return; // 2026-11-13 休息回血提示: the rest summary below shows it
      if (ev.kind === 'rest') { sayFx(restFx(ev), true); return; }
      if (ev.kind === 'advisorLeaves' && ev.turn) { // batch6 H2-12: she walks over — the line, then her clothes cross-fade to the enemy outfit with a glow, and a line says so
        var tl = normLine({ speaker: 'narrator', text: ev.text }); if (tl) say([tl]);
        sayFx(advisorTurnFx()); if (DISROBE_LINE) say([{ speaker: 'narrator', speakerId: 'narrator', name: '', text: T('ui.story.advisorDisrobe') }]); return; // 2026-11-24 用户「露西安开战前又多了一句旧外套」: the throne story already has its costume line → DISROBE_LINE false
      }
      if (ev.kind === 'sideEffect') return; // batch6 H2-3: no toast bubble over their heads after 认同 (the effect is already on the quote and on her panel).
      if (ev.kind === 'statChange' && ev.source === 'battle:xp' && XP_IN_REPORT) return;
      if (ev.kind === 'statChange' && ev.source === 'blessing') { var blu = LEVELUP_PAGE ? lvUpFromEvent(ev) : null; if (blu) ups.push(blu); return; } // 2026-11-19 用户亲测 界面: a level from the blessing → its page // 2026-11-19 流程修 M5: the blessing card already says 「全队 +X」 — no 5–6 bubbles before bellBlessingAfter // 2026-11-19 战报 XP 栏: shown in the result table
      if (ev.kind === 'statChange') {
        var glu = LEVELUP_PAGE ? lvUpFromEvent(ev) : null; // 2026-11-19 用户亲测 界面: no level-up bubble — the page says it; the bubble keeps the other rows
        if (glu) { ups.push(glu); var rest = (ev.changes || []).filter(function (c) { return !LV_ROWS[c.stat]; }); if (rest.length) { var ev2 = { id: ev.id, name: ev.name, source: ev.source, changes: rest }; say([], function () { statToast(ev2); }); } return; }
        say([], function () { statToast(ev); }); return;
      } // v2.3 §E5
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
    showLevelUps(ups);
  }

  // ---------- persistence + telemetry ----------
  var devSavedLv = null; // 2026-11-20 本地自动存 playlog: one dev-server save per level change and at the run's end
  // 2026-11-20 用户「你把我档给我刷了」: before anything replaces a saved run (新游戏 here, every jump-page write), the old run is
  // pushed to SAVE_BACKUP_KEY (newest SAVE_BACKUP_MAX kept); ui/dev/jump.html lists them under 「恢复存档」
  var SAVE_BACKUP_KEY = 'chooser.saveBackups.v1', SAVE_BACKUP_MAX = 15;
  function backupSave(old, reason) {
    try {
      if (!old || old.seed == null || old.phase === 'title') return;
      var list = lsGet(SAVE_BACKUP_KEY, []) || [], v = null; try { v = E.view(DATA, old); } catch (e) { /* */ }
      list.push({ t: Date.now(), reason: reason || '', profile: PROFILE || '', level: old.level || 0, phase: old.phase, seed: old.seed,
        party: v && v.party ? v.party.map(function (m) { return m.name; }) : [], run: old });
      list = list.slice(-SAVE_BACKUP_MAX);
      if (!lsSet(SAVE_BACKUP_KEY, list)) lsSet(SAVE_BACKUP_KEY, list.slice(-5));
    } catch (e) { /* never break the game */ }
  }
  function save() {
    if (!lsSet(KEY, run)) notice(T('ui.notice.saveFailed'));
    try { var lvTag = run ? (run.outcome ? 'end-' + run.outcome : 'L' + (run.level || 0)) : null; if (lvTag && lvTag !== devSavedLv) { devSavedLv = lvTag; pl('devSave', lvTag, run, PROFILE); } } catch (e) { /* */ }
  }
  function loadSave() { return lsGet(KEY, null); }
  function loadMeta() { var m = lsGet(MKEY, null); return m && typeof m === 'object' ? m : null; }
  // 2026-11-14 玩偶总账: the run being replaced (abandoned) books its dolls too — E.metaDolls is keyed by seed, so a run whose
  // ending was already booked (metaOnEnd) or a reload changes nothing. Writes MKEY only (one key per ?profile=).
  function dollsOnAbandon() {
    if (typeof E.metaDolls !== 'function') return;
    try { var old = run || loadSave(); if (!old || old.seed == null) return; var m = loadMeta() || {}; if (m.dollsSeed === old.seed) return; lsSet(MKEY, E.metaDolls(m, old)); } catch (e) { /* bookkeeping must never block a new run */ }
  }
  function newGame(opts) {
    backupSave(run || loadSave(), 'newGame');
    dollsOnAbandon();
    if (PL) { try { var ab = run || loadSave(); if (ab && ab.seed != null) pl('abandon', ab.seed, E.view(DATA, ab)); } catch (e) { /* */ } } // 游玩记录: an unfinished run replaced = 放弃
    var seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, meta = loadMeta(); vnClear(); replayed = {};
    var nameIn = $('leaderName'), nm = String((nameIn && nameIn.value) || prefs.leaderName || '').trim().slice(0, 8);
    if (!nm) nm = randName(); prefs.leaderName = nm; lsSet(PKEY, prefs); // v2.4 [4]
    var co = { seed: seed, leaderName: nm, pickDifficulty: true }; if (meta) co.meta = meta;
    { var asc = +(new URLSearchParams(location.search).get('asc') || 0); if (asc > 0) co.ascension = asc; } // 2026-11-24 进阶: ?asc=N (new games only) // v2.5: the fairy asks for a tier
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
  // 2026-11-20 用户「给我保留一套每关阵容记录，下次玩到一关有问题，可以用同样阵容、该难度重打」(LINEUP_LOG): every 出发 keeps a copy
  // of the run as it stands (formation set, before the fight) in localStorage 'chooser.lineups.v1' — the newest 3 per level, 30 in all.
  // ui/dev/jump.html lists them (「按记录重打」) and loads one into the jump save. Never touches the game state; a full storage just skips.
  var LINEUP_LOG = true, LINEUP_KEY = 'chooser.lineups.v1';
  function saveLineup(r) {
    if (!LINEUP_LOG || !r || r.phase !== 'prep') return;
    try {
      var v = E.view(DATA, r), list = lsGet(LINEUP_KEY, []) || [];
      var item = { t: Date.now(), level: v.level, title: v.levelTitle || '', diff: (v.difficulty && (v.difficulty.name || v.difficulty.id)) || '', profile: PROFILE || '',
        party: (v.party || []).map(function (m) { return m.name + (m.lv ? ' Lv' + m.lv : ''); }), seed: r.seed, run: r };
      list.push(item);
      var per = {}; list = list.slice().reverse().filter(function (x) { per[x.level] = (per[x.level] || 0) + 1; return per[x.level] <= 3; }).reverse().slice(-30); // ~75 KB each → ≤ ~2.3 MB
      if (!lsSet(LINEUP_KEY, list)) lsSet(LINEUP_KEY, list.slice(-10));
    } catch (e) { /* never break the game */ }
  }
  function doAct(action, decision, extraMeta, opts) {
    if (action && action.type === 'fight') { saveLineup(run); pl('devSave', 'go-L' + (run.level || 0), run, PROFILE); } // 2026-11-21: 出发 → the team as it leaves, in logs/playlog too
    var ACT_CUE = { move: 'move', useItem: 'item', advisorSkill: 'advisorSkill' }; if (ACT_CUE[action.type]) cue(ACT_CUE[action.type], null, 0);
    if (decision) { action.meta = tracker.finish(); Object.keys(extraMeta || {}).forEach(function (k) { action.meta[k] = extraMeta[k]; }); }
    var prev = run, prevView = view;
    try { run = E.act(DATA, run, action); } catch (e) { pl('actFail', action, prevView, e && e.message, e && e.stack, (function () { try { return JSON.stringify(run); } catch (x) { return null; } })()); pl('devSave', 'err-' + action.type); /* 2026-11-20: a rejected action saves the playlog at once */ notice(T('ui.notice.actRejected', { error: e && e.message })); ui.acted = 0; return false; } // 2026-11-16: a rejected action must not lock the pause (ui.acted stayed 1 → every button dead)
    if (decision) recordTelemetry(action, prev);
    save();
    var nv = null; try { nv = E.view(DATA, run); } catch (e) { pl('act', action, prevView, null); render(); return true; }
    pl('act', action, prevView, nv); // 游玩记录: the action + key moments read from the new view (pure bookkeeping)
    if (prevView && prevView.phase === 'battle' && nv.phase !== 'battle') pl('devSave', 'battle-L' + (nv.level || 0), run, PROFILE); // 2026-11-20 用户「战报之后马上存档，playlog 也要存」 (the run itself is saved above)
    // battle rounds animate on the battle screen itself (their events ride along in battle.lastRound)
    if (nv.battle && nv.battle.lastRound && (nv.phase === 'battle' || nv.phase === 'battleResult' || prevView.phase === 'battle' || prevView.phase === 'prep')) {
      if ((prevView.phase === 'prep' || prevView.phase === 'story') && nv.phase !== prevView.phase) fadeThen(render, false, true); else render(); // §E3 camp / scene intro → battle: fades to the battle scene (試玩 #5: not black)
      return true;
    }
    app.classList.add('stale'); hideTip();
    var pre = opts && opts.pre ? opts.pre(prevView, nv) : null;
    if (pre) sayFx(pre, true); // pre = the 献祭 reveal (a result)
    view = nv; // speakers resolve against the new state (new members, the advisor) …
    eventsToQueue(nv.events, nv, { skipDark: pre ? (opts.skipDark || ['sacrifice', 'taken']) : null });
    view = prevView; // … but the old screen stays up until the queue is done
    var post = opts && opts.post ? opts.post(prevView, nv) : null; if (post) sayFx(post); // v2.4: an exit that plays after the action's lines
    if (RELIC_GAIN_FX) { // 2026-11-25 获得遗物 / 铃铛: its card, then the fly — but a story that tells it (「你获得了反抗之铃」) plays first:
      relicHeld = relicHeld.concat(newRelics(prevView, nv)); // while the next screen is a story, the card waits until the story is over
      if (nv.phase !== 'story') { relicHeld.forEach(function (r) { sayFx(relicGainFx(r)); }); relicHeld = []; }
    }
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
    sceneAudio({ phase: ph, act: act, level: v ? v.level || 0 : 0, storyId: ph !== 'gameOver' && v && v.storyId || null, battle: ph === 'battle' || ph === 'battleResult', outcome: ph === 'gameOver' ? 'defeat' : out || null, scene: v ? A.sceneFor(v) : 'title-fairy', mirror: !!(v && v.mirrorFight), exitWalk: !!(v && v.levelNoHidden) && !(ui.costumeMusic && v.storyId === 'throneAdvisor'), blessing: !!(v && v.phase === 'reward' && v.blessing) }); // mirror: 2026-11-19 小铃战 → guild-dark · blessing: 2026-11-19 流程修 H4
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
    if (route.busy) return; // 路线图: the move plays over the stage; it renders the campfire itself when it is done
    clearTimers(); anim.token++; anim.skip = false; flushWaits(); fxLayer.innerHTML = ''; hideTip(); njPending = false;
    if (!run) { view = null; vnClear(); applyTheme(null); app.innerHTML = setupOpen ? setupHtml() : titleHtml(); pl('screen', setupOpen ? 'setup' : 'title', null); return; }
    try { view = E.view(DATA, run); } catch (e) { view = null; vnClear(); app.innerHTML = brokenHtml(e); pl('event', 'broken', { msg: String(e && e.message).slice(0, 300) }); return; }
    if (PRE) PRE.level(view.level | 0, view.act); // 2026-11-19 预加载: this level + the next go to the front of tier 2
    metaOnEnd(view);
    var key = (run.history || []).length + ':' + view.phase + ':' + (view.leaderStep || view.interviewStep || ''), entering = key !== screenKey;
    if (entering) { screenKey = key; ui = {}; tracker.reset(); }
    if (entering && PL) { var plS = PLM.snap(view); pl('screen', view.phase + (plS.st ? ':' + plS.st : ''), view); var plO = PLM.outcomeOf(view); if (plO) pl('runEnd', plO, view); } // 游玩记录: time per screen + the ending
    var sm = view.summary; // the whiteout / true-ending cinematic sets the music itself: don't start the stats track under it
    if (entering && view.phase === 'ending' && sm && (sm.outcome === 'true' || sm.whiteout) && !replayed['end:' + run.seed]) ui.audioHold = true;
    applyTheme(view);
    if (FLOW_DEPART_ROUTE) { // 2026-11-20 流程: the map after 「出发」 (before the scene intro); the campfire opens on its place card
      if (entering && view.phase === 'story' && view.storyId === 'levelIntro' && routeMaybe(view)) return;
      if (entering && view.phase === 'prep' && placeMaybe(view)) return;
    } else if (entering && view.phase === 'prep' && routeMaybe(view)) return; // old order (kept 2026-11-20): 路线图: walk to the next node first, then this campfire
    document.body.classList.toggle('tv-on', view.phase === 'story' && view.storyId === 'sacrificeIntro'); // feedback-1112 #12: old-TV broadcast, chrome hidden
    var name = view.phase;
    // a battle that just ended still owes its last round's animation
    if (name !== 'battle' && name !== 'battleResult' && shownPhase === 'battle' && view.battle && view.battle.lastRound && view.battle.lastRound.length && !replayed[(run.history || []).length]) name = 'battle';
    shownPhase = name;
    var s = SCREENS[name];
    app.className = 'screen-host phase-' + name;
    app.innerHTML = '<main class="screen screen-' + esc(name) + '">' + (s ? s.html(view) : '<div class="panel">' + T('ui.screen.unknownPhase', { phase: esc(view.phase) }) + '</div>') + '</main>' + topbar(view, s && s.plate ? s.plate(view) : null, s && s.topExtra ? s.topExtra(view) : '');
    if (s && s.after) s.after(view);
    if (GOLD_CLAIM) goldClaimAuto(); // a gold block left unclaimed → its quick claim
    if (entering && s && s.enter) s.enter(view);
    blackOffSoon(); // §E3: the new screen is up under the black → fade back in
    if (flyQ.length) flyItems();
    if (relicFlyQ.length) flyRelics();
  }
  // UI-CLEAN §2.0 (user: 方案 A): the top bar is only ☰; the item group (team / bag / advisor face / keys) only where it is used.
  // TOPBAR_PLATE = true switches to 方案 B (the level plate top-left, the difficulty in its tip).
  var TOPBAR_PLATE = false;
  var PREP_LEVEL_PLATE = true; // 2026-11-19 user: the camp / prep night shows the next level top-left (「第 6 关 · …」); false: no plate there
  function showItems(v) { return !!v && (v.phase === 'battle' || v.phase === 'reward' || v.phase === 'debuff' || (v.phase === 'prep' && !v.bell)); }
  function topbar(v, custom, extra) {
    var items = showItems(v), pl8 = '';
    // 2026-11-15 user: in battle the level plate is back top-left
    if (TOPBAR_PLATE || (v && (v.phase === 'battle' || (PREP_LEVEL_PLATE && v.phase === 'prep' && v.nextLevel)))) pl8 = '<span class="tb-plate"' + (v.difficulty ? ' data-tip="' + esc(T('ui.topbar.difficultyTip') + ' ' + T('ui.topbar.difficulty', { name: v.difficulty.name })) + '"' : '') + '>' + (custom != null ? custom : plate(levelText(v))) + '</span>';
    return '<header class="topbar">' + pl8 + ((items || v.bell) && TOPBAR_SPLIT ? relicStrip(v.relics || (v.run && v.run.relics), v.guildRelics) : '') + '<span class="spacer"></span>' +
      (items && TOPBAR_SPLIT ? teamBtn(v) + bagSlots(v.items) + goldChip(v) + advisorChip(v.advisor) : items ? teamBtn(v) + bagChip(v.items, v.relics || (v.run && v.run.relics)) + guildRelicChip(v.guildRelics) + goldChip(v) + advisorChip(v.advisor) : '') + (TOPBAR_SPLIT ? '' : items || v.bell ? keysChip(v.keys) : '') + /* 2026-11-25 用户「既然有铃铛了 就不需要骰子那些了」: the bells in the relic strip are the keys */
      (extra || '') + menuBtn() + '</header>';
  }
  // ---------- ☰ menu (UI-CLEAN §3): one button in the same top-right spot on every screen, one panel in #modal ----------
  function menuBtn(cls) { return '<button class="btn-icon menu-btn vn-pass' + (cls ? ' ' + cls : '') + '" data-act="menu" aria-label="' + T('ui.menu.label') + '">☰</button>'; }
  var menuTab = ''; // ☰: which group tab is open, by its text key (kept while the page lives; the tab list differs title vs run, so not an index)
  function mnGroup(key, body, cls) { return body ? '<section class="mn-group' + (cls ? ' ' + cls : '') + '"><h3>' + T(key) + '</h3><div class="mn-body">' + body + '</div></section>' : ''; }
  function menuHtml() {
    var v = run ? view : null, m = !!au('isMuted'), vol = au('getVolume') || { music: 0.35, sfx: 0.5 }, rk = rankText(loadMeta());
    var head = v ? '<div class="mn-head"><span class="mn-chip">' + (v.level ? (lvNo(v.level) || esc(v.levelTitle || '')) : T('ui.level.guild')) + '</span>' +
      (v.difficulty ? '<span class="mn-chip">' + T('ui.topbar.difficulty', { name: esc(v.difficulty.name) }) + '</span>' : '') +
      (rk ? '<span class="mn-chip">' + T('ui.title.rank') + ' <b>' + esc(rk) + '</b></span>' : '') + (TOPBAR_SPLIT ? relicStrip((v.relics || []).filter(function (r) { return r && r.id === 'bell'; }), null) : keysChip(v.keys)) + '</div>' : '';
    var team = v && (v.party || []).length ? '<button class="btn btn-secondary" data-act="viewTeam">' + T('ui.team.view') + '</button>' : '';
    var sound = '<label class="mn-row"><input type="checkbox" data-snd="mute"' + (m ? ' checked' : '') + '> ' + T('ui.sound.mute') + '</label>' +
      '<label class="mn-row"><span class="mn-k">' + T('ui.sound.music') + '</span><input type="range" min="0" max="100" value="' + Math.round(vol.music * 100) + '" data-snd="music"></label>' +
      '<label class="mn-row"><span class="mn-k">' + T('ui.sound.sfx') + '</span><input type="range" min="0" max="100" value="' + Math.round(vol.sfx * 100) + '" data-snd="sfx"></label>';
    var game = '<div class="mn-row"><span class="mn-k">' + T('ui.menu.speed') + '</span>' + [1, 2, 3].map(function (n) { return '<button class="pill-btn' + (prefs.speed === n ? ' on' : '') + '" data-act="speed" data-s="' + n + '">' + spdName(n) + '</button>'; }).join('') + '</div>' +
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
    var cFull = ally ? ((p.member && p.member.chargeFull) || (p.u && p.u.chargeFull) || null) : null; // 2026-11-24 用户「充能满格数只显示在人物详细介绍版里」
    var stats = stat(A.glyph('hp'), 'ui.unit.hp', M.hp != null && M.maxHp != null ? M.hp + ' / ' + M.maxHp : M.maxHp != null ? M.maxHp : '?') + stat(IC.atk, 'ui.unit.power', M.atk != null ? M.atk : '?') +
      (cFull ? '<span class="up-stat" data-tip="' + esc(T('ui.card.chargeFullTip', { n: cFull })) + '">' + A.glyph('charge', false) + '<span class="up-k">' + T('ui.unit.chargeFull') + '</span><b>' + esc(cFull) + '</b></span>' : '') +
      (M.block > 0 ? stat(A.glyph('block'), 'ui.unit.block', M.block) : '') + (M.openBlock > 0 ? stat(A.glyph('block'), 'ui.unit.openBlock', M.openBlock) : '') +
      (ally && M.mood != null ? '<span class="up-stat" data-tip="' + esc(MOOD_TIP(M.mood)) + '"><img class="up-mood" src="' + esc(A.moodIcon(M.mood)) + '" alt=""><span class="up-k">' + T('ui.unit.mood') + '</span><b>' + esc(M.moodLabel || moodWord(M.mood)) + '</b></span>' : '');
    var sec = function (k, body, cls) { return '<div class="up-sec' + (cls ? ' ' + cls : '') + '"><h3>' + T(k) + '</h3>' + body + '</div>'; };
    var skill = sec(ally ? 'ui.unit.skill' : 'ui.unit.pattern', '<p class="up-line"><b class="up-sk">' + esc(M.skillName || '—') + '</b>' + (M.skillLv ? '<span class="up-lv">' + A.glyph('level') + 'Lv' + esc(M.skillLv) + '</span>' : '') + '</p>' +
      (M.skillText ? '<p class="up-txt">' + richText(M.skillText) + '</p>' : '') + howLine(M, ally) + (M.perkText ? '<p class="up-txt up-perk">' + richText(M.perkText) + '</p>' : ''));
    var combo = ally || M.comboText ? sec('ui.unit.combo', M.comboText ? '<p class="up-line">' + (M.comboName ? '<b class="up-sk">' + esc(M.comboName) + '</b>' : '') + '</p><p class="up-txt">' + richText(M.comboText) + '</p>' : '<p class="up-txt dim">' + T('ui.common.none') + '</p>') : '';
    var keeps = ally ? sec('ui.unit.keepsakes', M.keepsakes.length ? M.keepsakes.map(function (k) { return '<p class="up-txt up-keep">' + (k.icon ? pic([k.icon], 'up-keep-ic', '') : '') + '<b class="up-sk">' + esc(k.name) + '</b>' + (k.text ? '：' + richText(k.text) : '') + '</p>'; }).join('') : '<p class="up-txt dim">' + T('ui.common.none') + '</p>') : '';
    var trs = !ally && p.u && p.u.traitLines && p.u.traitLines.length ? sec('ui.unit.traits', p.u.traitLines.map(function (t) { return '<p class="up-txt">' + richText(t) + '</p>'; }).join('')) : ''; // 2026-11-20 敌人特性（闪避、记仇…）
    var st = statusChips(M.statuses, M.side); // an enemy's hidden debuffs stay hidden (same filter as her card)
    var sts = sec('ui.unit.statuses', st ? '<div class="chips">' + st + '</div>' : '<p class="up-txt dim">' + T('ui.common.none') + '</p>');
    // 2026-11-15 user: the panel scrolled → two columns (left: face, name, numbers · right: skill / combo / keepsakes / statuses)
    return '<div class="up-cols"><div class="up-left"><div class="up-head"><div class="up-face">' + pic(art.list, 'up-img', name, art.fb) + '</div><div class="up-id"><h2>' + esc(name) + '</h2>' +
      '<div class="up-role">' + (M.role ? roleBadge(M.role, 'up-rb') + '<span>' + esc(ROLE_NAME()[M.role] || M.role) + '</span>' : '<span>' + T(M.boss ? 'ui.unit.boss' : 'ui.unit.foe') + '</span>') + '</div>' +
      '<div class="up-stats">' + stats + '</div>' + (ally && p.member && p.member.lv != null ? '<div class="up-xp">' + xpBarHtml(p.member) + '</div>' : '') + '</div></div></div>' + // 2026-11-16 经验条
      '<div class="up-right"><div class="up-body">' + skill + trs + combo + keeps + sts + '</div></div></div>' +
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
      '<div class="title-menu"><div class="menu">' + btns.join('') + '</div></div>' + preBarHtml() + (BUILD_V ? '<div class="title-ver">' + esc(BUILD_V) + '</div>' : '') + '</div>';
  }
  // 2026-11-19 预加载: a thin bar under the title menu while tier 1 (title, UI, the opening) loads; it never blocks a button,
  // fades when tier 1 is in, and gives up after 3s (the rest keeps loading in the background either way)
  var preBarGone = false;
  function preBarHtml() {
    var p = PRE && PRE.progress(); if (!p || !p.on || p.t1Done || preBarGone || !p.total) return '';
    return '<div class="pre-bar" id="preBar" role="progressbar" aria-valuemin="0" aria-valuemax="' + p.total + '" aria-valuenow="' + p.done + '"><i style="width:' + Math.round(100 * p.done / p.total) + '%"></i><span>' + T('ui.preload.loading') + '</span></div>';
  }
  function preBarSync(p) {
    var el = $('preBar'); if (!el) return; var i = el.querySelector('i');
    if (i) i.style.width = Math.round(100 * p.done / Math.max(1, p.total)) + '%'; el.setAttribute('aria-valuenow', p.done);
    if (p.t1Done || preBarGone) { el.classList.add('done'); setTimeout(function () { if (el.parentNode) el.remove(); }, 400); }
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
    if (quickNoArt() && id && A.isCandidate(id) && !member(id)) { el.querySelectorAll('.stand').forEach(function (s) { s.classList.add('dim'); }); return; } // 2026-11-20 快速模式: a rejected girl never gets her big stand
    if (!id || (!A.isCandidate(id) && !A.isAdvisor(id) && !A.isFairy(id) && !(A.isMerchant && A.isMerchant(id)) && id !== 'leader')) { el.querySelectorAll('.stand').forEach(function (s) { s.classList.add('dim'); }); return; }
    var variant = variantFor(id, l), k = id + ':' + (variant === 'flash' ? 'base' : variant), cur = el.querySelector('.stand[data-k="' + k + '"]');
    var tf = !!(l && l.fx === 'transform'); // §6 the fairy turns: the old stand burns out white while the demon fades in
    el.querySelectorAll('.stand').forEach(function (s) { if (s !== cur) { s.classList.add(tf ? 'to-demon' : 'gone'); setTimeout(function () { s.remove(); }, tf ? 1700 : 500); } });
    var slip = A.isFairy(id) && l && l.expr === 'special';
    var sadE = A.isFairy(id) && !!l && l.expr === 'sad'; // 2026-11-25 小铃 伤心脸层 (CSS .stand.e-sad)
    if (cur) { cur.classList.remove('dim'); cur.classList.toggle('slip', slip); cur.classList.toggle('e-sad', sadE); return; }
    var side = id === 'leader' ? 'left' : FLUO_RIGHT && A.isMerchant && A.isMerchant(id) ? 'right' : FLUO_LEFT && A.isMerchant && A.isMerchant(id) ? 'left' : A.isFairy(id) ? 'fairy' : A.isAdvisor(id) ? 'right' : (ui.standSide = ui.standSide === 'right' ? 'left' : 'right');
    var d = document.createElement('div'); d.className = 'stand at-' + side + ' v-' + variant + (A.isFairy(id) ? ' fairy-stand ' + id : '') + (tf ? ' transform-in' : '') + (slip ? ' slip' : '') + (sadE ? ' e-sad' : ''); d.dataset.k = k;
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
    if (v.storyId === 'levelIntro' && !v.noCard && !ls.some(function (l) { return l && l.kind === 'levelCard'; })) ls.push({ kind: 'levelCard', level: v.level, title: v.levelTitle });
    if (STORY_AT) { // dev ?storyAt=last|N: the first story shown starts at that line (jump.html l10mine: 第 9 关最后一幕)
      if (storyAtId === null) storyAtId = v.storyId;
      if (v.storyId === storyAtId) { var k = STORY_AT === 'last' ? ls.length - 1 : +STORY_AT || 0; if (k > 0) ls = ls.slice(Math.min(k, ls.length - 1)); } else STORY_AT = null;
    }
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
  // 2026-11-21 用户「一幕纯立绘，背景变灰，人物身上有粒子效果，逐渐从旧的立绘转换新的立绘，然后标签飞出人物的真实身份，然后继续对话；此时背景音乐转换」
  var COSTUME_FX = true; // false = old: the costume line is a plain narration line
  function costumeFx(v, text) {
    var id = (v.advisor && v.advisor.id) || '', ad = advData(id) || {}, who = (ad.boss && ad.boss.name) || ad.name || '';
    var dots = ''; for (var i = 0; i < 46; i++) dots += '<i style="--x:' + (8 + Math.random() * 84).toFixed(1) + '%;--y:' + (18 + Math.random() * 70).toFixed(1) + '%;--d:' + (Math.random() * 1.8).toFixed(2) + 's;--s:' + (3 + Math.random() * 6).toFixed(1) + 'px"></i>';
    return stages([
      [function () { standsOut(); stageEl.classList.add('cs-grey');
        cine('costume on', '<div class="cs-fig">' + pic(A.portrait(id), 'cs-old', '', '') + pic(A.portrait(id, { variant: 'boss' }), 'cs-new', '', '') + '<div class="cs-dots">' + dots + '</div></div>' +
          '<p class="cs-cap">' + esc(text || '') + '</p><div class="cs-tag"><b>' + esc(who) + '</b></div>'); }, 1500],
      [function () { cineEl.classList.add('morph'); cue('transform', null, 0); ui.costumeMusic = true; if (sceneCtx) sceneAudio(Object.assign({}, sceneCtx, { exitWalk: false })); }, 2600, 'noskip'],
      [function () { cineEl.classList.add('tag'); cue('bigHit', null, 0); }, 2400],
      [function () { cineEl.classList.add('fade'); stageEl.classList.remove('cs-grey'); }, 1000],
      [function () { cineEl.className = 'cine'; cineEl.innerHTML = ''; stageEl.classList.remove('cs-grey'); }, 10]
    ]);
  }
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
  // 2026-11-20 铃之门 (engine BELL_DOOR → view.bellDoor): the door always stops. Three slots, each the bronze bell (the relic-bell
  // icon, no text); a slot the run holds is lit. Hover / focus / tap a slot → its bell's name + how it is earned (the line under
  // the door, and the tip). 「铜铃 n / 3」. Not all three → 【那就算了吧】 (continue: the normal route); all three → 【进去看看】 (openDoor).
  function bellSlotTip(s) { return T(s.got ? 'ui.door.bell.got' : 'ui.door.bell.missing', { name: s.name || '', hint: s.hint || '' }); }
  function bellDoorHtml(v) {
    var d = v.bellDoor;
    return '<div class="side-door bell-door' + (d.open ? ' sd-open' : ' sd-plain') + '" id="sideDoor" aria-label="' + esc(T('ui.door.label')) + '"><div class="sd-frame"><div class="sd-slots">' +
      (d.slots || []).map(function (s, i) {
        var tip = esc(bellSlotTip(s));
        return '<span class="sd-slot bd-slot' + (s.got ? ' got' : ' missing') + '" style="--i:' + i + '" tabindex="0" role="img" aria-label="' + tip + '" data-tip="' + tip + '" data-info="' + tip + '">' + pic(A.relicIcon('bell', s.key), 'bd-bell', '', A.doorGlyph('bell')) + '</span>';
      }).join('') + '</div><i class="sd-ring" aria-hidden="true"></i></div>' +
      '<div class="bd-count">' + esc(T('ui.door.bell.count', { n: d.have, total: d.total })) + '</div><p class="bd-info" id="bellDoorInfo" aria-live="polite"></p>' +
      '<div class="sd-go" id="sideDoorGo" hidden><button class="btn btn-primary btn-lg" data-act="' + (d.open ? 'openDoor' : 'passDoor') + '">' + esc(T(d.open ? 'ui.door.enter' : 'ui.door.pass')) + '</button>' +
      (d.open && DOOR_SKIP ? '<button class="btn btn-secondary btn-lg" data-act="skipDoor">' + esc(T('ui.door.skip')) + '</button>' : '') + '</div></div>'; // 2026-11-21 用户「门可以进也可以不进，两个选项都提供」
  }
  var DOOR_SKIP = true; // false = the open door has only 【进去看看】
  function bellDoorReady(v) { // lit slots on, the hover / tap info line wired, then the one button
    var d = $('sideDoor'); if (!d) return;
    d.classList.add('lit');
    var info = $('bellDoorInfo');
    var show = function (e) { var s = e.target && e.target.closest && e.target.closest('.bd-slot'); if (s && info) info.textContent = s.getAttribute('data-info') || ''; };
    d.addEventListener('mouseover', show); d.addEventListener('focusin', show); d.addEventListener('click', show);
    later(function () { var g = $('sideDoorGo'); if (g) { g.hidden = false; var b = g.querySelector('button'); if (b) b.focus({ preventScroll: true }); } }, REDUCED ? 0 : v.bellDoor.open ? 2000 : 600);
  }
  function sideDoorHtml(v) {
    if (v.bellDoor) return bellDoorHtml(v); // 2026-11-20 铃之门
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
        if (l.fx === 'costume' && COSTUME_FX) { sayFx(costumeFx(v, l.text)); return; } // 2026-11-21 her true self: its own scene, the line as its caption
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
      if (v.bellDoor) { say(tail, function () { bellDoorReady(v); }); return; } // 2026-11-20 铃之门: always stops, one button
      if (v.door && v.door.open) { say(tail, sideDoorLight); return; } // 2026-11-15 小门: the button opens it (act openDoor)
      if (v.door) { var sd = $('sideDoor'); if (sd) sd.classList.add('lit'); } // an ordinary door: what she holds glows faintly, then on past
      say(tail, function () { if (v.storyId === 'levelIntro') standsOut(); doAct({ type: 'continue' }); }); // G1 #4: no stand left over on the way into the level
    }
  };
  function storyLine(l, v) {
    var o = normLine(l); if (!o) return null;
    if (o.fx === 'transform') o.onShow = function (x) { cue('transform', null, 0); flashWhite(1500); if (!$('stand') || !$('stand').querySelector('.stand.fairy-demon')) standShow('fairy-demon', x); };
    if (o.fx === 'shatter') o.onShow = function () { flashWhite(900, 'cut'); cue('turncoat', null, 0); setScene('noble-chamber-broken'); }; // 2026-11-24 用户「玩偶柜被打碎、碎了一地、大家都恢复的那张图从没出现过」: the l11After line cuts to the broken chamber
    if (o.fx === 'curse') o.onShow = function () { // feedback-1112 #7: the noble's curse — a dark-red flash, the stage shakes, the leader's hp halves
      cue('bigHit', null, 0); flashWhite(1100, 'curse'); stageEl.classList.add('quake'); setTimeout(function () { stageEl.classList.remove('quake'); }, 900);
      if (v.curse && v.curse.hpFrom != null) statToast({ id: 'leader', changes: [{ stat: 'hp', from: v.curse.hpFrom, to: v.curse.hpTo }] });
    };
    if (o.bellGot) { o.tone = 'brave'; o.onShow = function () { cue('bell', { act: actNo() }, 0); }; } // 2026-11-20 铃之门: 「你获得了xx之铃」
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
  // 2026-11-20 招人花钱 (engine RECRUIT_PRICE): her price as coin + number (c.price absent = the old flow, nothing shown)
  function ivPrice(c, cls) { return c.price != null ? '<span class="iv-price num' + (cls ? ' ' + cls : '') + (c.afford === false ? ' poor' : '') + '" data-tip="' + esc(T('ui.interview.priceTip')) + '">' + A.glyph('coin', false) + '<b>' + esc(c.price) + '</b></span>' : ''; }
  // the purse in the top bar (by ☰): what is left; on the one-page list it already counts the picks made so far
  function ivPurse(v) {
    if (!v || !v.recruitPrice || v.gold == null || ivAskOn(v)) return '';
    var spent = 0, qp = ui.qp || {};
    if (quickOn(v)) v.quick.rows.forEach(function (r) { r.pair.forEach(function (c) { if (qp[r.round] === c.id && c.price != null) spent += c.price; }); });
    return goldHtml(v.gold - spent, 'iv-purse');
  }
  function ivSide(c, i, v) {
    return '<div class="iv-side iv-' + (i ? 'right' : 'left') + '" data-c="' + esc(c.id) + '"><div class="iv-stand">' + pic(A.portrait(c.id), 'stand-img', c.name, initialHtml(c.name)) + '</div>' +
      '<div class="iv-tag panel"><div class="it-h">' + roleBadge(c.role) + '<b>' + esc(c.name) + '</b><span class="it-stats num"><span>' + IC.hp + ' ' + esc(c.hp) + '</span><span>' + IC.atk + ' ' + esc(c.atk) + '</span>' + (c.luck ? '<span>' + A.glyph('luck') + ' ' + T('ui.stat.luck') + ' ' + (c.luck > 0 ? '+' : '−') + Math.abs(c.luck) + '</span>' : '') /* 2026-11-22g 试玩7 #7 */ + '</span>' + ivPrice(c) + '</div>' +
      (v.interviewStep === 'hire' && v.sided === c.id ? '<span class="iv-sided" data-tip="' + T('ui.interview.sidedTip') + '">' + T('ui.interview.sided') + '</span>' : '') + rowsHtml(c) + '</div></div>';
  }
  // 2026-11-15 一页招完人: every remaining interview pair on one page (engine view.quick), one tap per row (= side with her +
  // hire her; the other one is rejected as usual), then 「确定」 → act quickRecruit { picks }.
  // Designer feedback (same day): before the first interview the advisor ASKS 「一个个面试」(first run: primary + 第一次推荐)
  // or 「直接写名单」 (the one-page list). The answer is kept per run (localStorage, keyed by seed) so a refresh / resume never
  // asks again; 「一页招完 ▶▶」 / 「一个个面试」 still switch later. Like 芙洛's shop ask: the line first, the buttons after it.
  var IVM_KEY = 'chooser.ivMode.v1' + (STUB ? '.stub' : '') + PSUF;
  var ivMode = lsGet(IVM_KEY, null) || { seed: null, mode: null };
  function ivModeNow() { return ivMode && ivMode.seed === (run && run.seed) ? ivMode.mode : null; }
  function setIvMode(m) { ivMode = { seed: run && run.seed, mode: m }; lsSet(IVM_KEY, ivMode); }
  function quickRowsOn(v) { return !!(v && v.quick && v.quick.rows && v.quick.rows.length); }
  function quickOn(v) { return quickRowsOn(v) && ivModeNow() === 'quick'; }
  function ivAskOn(v) { return quickRowsOn(v) && !ivModeNow(); }
  function ivAskWho(v) { var a = v && v.advisor && v.advisor.present !== false ? v.advisor : null; return a ? { id: a.id, name: a.name } : { id: 'leader', name: nameOf('leader') }; }
  function ivAskHtml(v) {
    var first = !(+(loadMeta() || {}).runs >= 1), shown = ui.ivAsk === 'ask', w = ivAskWho(v);
    var stand = shown && w.id !== 'leader' ? '<div class="stand at-right v-base" data-k="' + esc(w.id) + ':base">' + pic(standList(w.id, 'base'), 'stand-img', '', '') + '</div>' : ''; // a re-render while she asks keeps her on screen
    return '<div class="camp-wrap iv-ask-wrap" id="ivAskWrap"><div class="stand-layer" id="stand">' + stand + '</div>' +
      '<div class="bell-choices iv-ask" id="ivAsk"' + (shown ? '' : ' hidden') + '>' +
      '<button class="bigchoice btn ' + (first ? 'btn-primary' : 'btn-secondary') + '" data-act="ivAskNormal" data-opt="ivask:normal"><span>' + T('ui.interview.ask.oneByOne') + '</span><small class="ia-hint">' + T('ui.interview.ask.firstHint') + '</small></button>' +
      '<button class="bigchoice btn ' + (first ? 'btn-secondary' : 'btn-primary') + '" data-act="ivAskList" data-opt="ivask:list"><span>' + T('ui.interview.ask.list') + '</span></button></div></div>';
  }
  function ivAskShow(v) {
    // never draw the buttons over the subtitle: wait until the dialogue box is really gone
    if (vnActive() || !vnEl.hidden) { setTimeout(function () { if (view && ivAskOn(view) && ui.ivAsk === 'play') ivAskShow(view); }, 120); return; }
    ui.ivAsk = 'ask';
    var c = $('ivAsk'); if (!c) { render(); return; }
    c.hidden = false; var b = c.querySelector('.btn-primary'); if (b) b.focus({ preventScroll: true });
  }
  function ivAskMaybe(v) { // called from SCREENS.interview.after while the ask is up
    if (ui.ivAsk === 'play' && !vnActive()) { ivAskShow(v); return; } // the queue was cleared under it (menu…): straight to the buttons
    if (ui.ivAsk) return;
    ui.ivAsk = 'play'; vn.cls = 'camp';
    var w = ivAskWho(v);
    ui.onSpeak = function (id, l) { if (id !== undefined) standShow(id, l); };
    say([{ speaker: w.id === 'leader' ? 'leader' : 'advisor', speakerId: w.id, name: w.name, expr: 'calm', vnClass: 'camp', text: w.id === 'leader' ? T('ui.interview.ask.self') : T('ui.interview.ask.line') }],
      function () { ui.onSpeak = null; vn.cls = ''; if (view && ivAskOn(view) && ui.ivAsk === 'play') ivAskShow(view); });
  }
  function quickHtml(v) {
    var picks = ui.qp || (ui.qp = {}), rows = v.quick.rows, left = rows.filter(function (r) { return !picks[r.round]; }).length;
    var body = rows.map(function (r, i) {
      return '<div class="qr-row" data-r="' + esc(r.round) + '"><div class="qr-lab">' + roleBadge(r.role) + '<span>' + T('ui.interview.quick.row', { round: esc(i + 1), role: esc(ROLE_NAME()[r.role] || '') }) + '</span></div>' +
        r.pair.map(function (c) {
          return '<button class="qr-card' + (picks[r.round] === c.id ? ' sel' : picks[r.round] ? ' off' : '') + '" data-act="qPick" data-r="' + esc(r.round) + '" data-id="' + esc(c.id) + '" data-opt="quick:' + esc(c.id) + '">' +
            '<span class="qr-face">' + pic(A.face(c.id, 'happy'), '', c.name, initialHtml(c.name)) + '</span>' +
            '<span class="qr-info"><b class="qr-name">' + esc(c.name) + '</b><span class="qr-stats num"><span data-tip="' + esc(T('ui.unit.power')) + '">' + IC.atk + ' ' + esc(c.atk) + '</span><span>' + IC.hp + ' ' + esc(c.hp) + '</span></span></span>' +
            roleBadge(c.role, 'qr-role') + ivPrice(c, 'qr-price') +
            /* 2026-11-20 用户「快速选择的时候也要有信息按钮，可以看人物完整介绍」: the same profile as the one-by-one interview (herPanel) */
            '<span class="qr-more" role="button" tabindex="0" data-act="viewHer" data-id="' + esc(c.id) + '" aria-label="' + esc(T('ui.unit.info')) + '" data-tip="' + esc(T('ui.unit.infoTip')) + '">i</span></button>';
        }).join('') + '</div>';
    }).join('');
    return heading(T('ui.interview.quick.heading'), T('ui.interview.quick.sub'), 'qr-head') + '<div class="qr-rows">' + body + '</div>' +
      '<div class="qr-bar"><button class="btn-ghost" data-act="ivNormal">' + T('ui.interview.quick.oneByOne') + '</button>' +
      '<button class="btn btn-primary btn-lg" data-act="quickGo" id="qrGo"' + (left ? ' disabled' : '') + '>' + (left ? T('ui.interview.quick.left', { n: left }) : T('ui.interview.quick.confirm')) + '</button></div>';
  }
  SCREENS.interview = {
    // UI-CLEAN §2.5a: 「跳过剧情」 left of ☰ while the intros / topic talk play (not her reaction: that carries the mood fx)
    // 2026-11-15: a returning player who chose 「一个个面试」 can go back to the one-page pick (一页招完 ▶▶)
    topExtra: function (v) { return ivPurse(v) /* 2026-11-20 招人花钱 */ + (quickRowsOn(v) && ivModeNow() === 'normal' ? '<button class="btn-ghost iv-skip iv-quick vn-pass" data-act="ivQuick">' + T('ui.interview.quick.open') + '</button>' : ''); },
    plate: function (v) { if (quickOn(v)) return plate(T('ui.interview.quick.plate')); var role = v.pair[0] && v.pair[0].role; return plate(T('ui.interview.plate') + '<small>' + (v.roundTotal ? T('ui.interview.roundOfTotal', { round: esc(v.round), total: esc(v.roundTotal), role: esc(ROLE_NAME()[role] || '') }) : T('ui.interview.round', { round: esc(v.round), role: esc(ROLE_NAME()[role] || '') })) + '</small>'); },
    html: function (v) {
      if (QUICK && ivAskOn(v)) setIvMode('quick'); /* 快速模式: no ask, straight to 直接写名单 */
      if (ivAskOn(v)) return ivAskHtml(v);
      if (quickOn(v)) return quickHtml(v);
      var side = v.interviewStep === 'side' && v.conflict, opts = side ? v.conflict.options : v.pair.map(function (c) { return { id: c.id, price: c.price, afford: c.afford }; });
      var btns = opts.map(function (o, i) {
        var n = nameOf(o.id);
        // v2.4 [7] the side step: parchment speech bubbles beside each speaker; the hire step: big portrait buttons
        return side ? '<button class="iv-quote iq-' + (i ? 'right' : 'left') + '" data-act="side" data-id="' + esc(o.id) + '" data-opt="side:' + esc(o.id) + '"><span class="iq-who">' + esc(n) + '：</span><q>' + esc(o.label || '……') + '</q>' + (o.effect ? '<span class="iq-eff">' + esc(o.effect) + '</span>' : '') + (o.against ? '<span class="iq-eff iq-against">' + esc(o.against) + '</span>' : '') + '<span class="iq-pick">' + T('ui.interview.agree') + '</span></button>'
          : '<button class="bigchoice hire-btn ' + (i ? 'btn btn-secondary' : 'btn btn-primary') + '" data-act="hire" data-id="' + esc(o.id) + '" data-opt="hire:' + esc(o.id) + '"' + (o.afford === false ? ' disabled data-tip="' + esc(T('ui.interview.poor')) + '"' : '') + '><span class="hb-face">' + pic(A.face(o.id, 'happy'), '', n, initialHtml(n)) + '</span><span>' + T('ui.interview.invite', { name: esc(n) }) + '</span>' + ivPrice(o, 'hb-price') + '</button>';
      }).join('');
      if (side) btns = '<div class="iq-head"><span>' + T('ui.interview.whoAgree') + '</span></div>' + btns;
      // feedback-1113 #4: while the two talk, no topic title and no status panels; once it is time to choose, hovering one shows her panel
      return (side ? '<div class="iv-title" id="ivTitle"' + (ui.ivReady ? '' : ' hidden') + '><span>「' + esc(v.conflict.title) + '」</span></div>' : '') +
        '<div class="iv-stage' + (ui.ivReady ? ' ready' : '') + '" id="ivStage">' + v.pair.map(function (c, i) { return ivSide(c, i, v); }).join('') + '</div>' +
        '<div class="iv-choices' + (side ? ' iv-quotes' : ' iv-hire') + '" id="ivChoices"' + (ui.ivReady ? '' : ' hidden') + '>' + btns + '</div>' +
        (side ? '<div class="iv-under" id="ivUnder"' + (ui.ivReady ? '' : ' hidden') + '><button class="btn-ghost" data-act="ivReplay">' + T('ui.interview.replay') + '</button></div>' : '');
    },
    enter: function (v) {
      if (ivAskOn(v)) return; // the ask plays from after()
      ui.onSpeak = function (id) {
        if (id) { var st = $('ivStage'), ti = $('ivTitle'); if (st) st.classList.remove('ready'); if (ti) ti.hidden = true; } // feedback-1113 #4: talking again (her reaction) → hide title / panels
        app.querySelectorAll('.iv-side').forEach(function (el) {
          if (id) el.classList.remove('peek');
          el.classList.toggle('speaking', !!id && el.dataset.c === id); el.classList.toggle('dim', !!id && el.dataset.c !== id && (id === v.pair[0].id || id === v.pair[1].id));
        });
      };
      if (quickOn(v)) return; // 一页招完人: no talk, just the rows
      ivTalk(v);
    },
    after: function (v) { // feedback-1113 #4: hover / focus a candidate (her portrait or her choice) to peek at her status
      if (v && $('ivAsk')) { ivAskMaybe(v); return; } // 2026-11-15 the 一个个面试 / 直接写名单 ask
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
    say(lines, function () { ui.ivReady = true; var c = $('ivChoices'), u = $('ivUnder'), st = $('ivStage'), ti = $('ivTitle'); if (c) c.hidden = false; if (u) u.hidden = false; if (st) st.classList.add('ready'); if (ti) ti.hidden = false; });
  }

  // ---------- prep = the campfire rest: a small talk around the fire, then the formation and 出发 ----------
  function memberCard(m, i, n, opts) {
    var o = opts || {}, art = unitArt({ id: m.id, side: 'ally', mood: m.mood, isLeader: m.isLeader });
    return '<div class="ucard ally p-slot' + (isLeader(m) ? ' is-leader' : '') + (o.sel ? ' sel' : '') + (hasBad(m.statuses) ? ' cursed' : '') + '" data-id="' + esc(m.id) + '"' + (o.drag ? ' draggable="true"' : '') + (o.act ? ' data-act="' + o.act + '"' : '') +
      ' data-opt="o:' + esc(m.id) + '" data-rich="' + esc(unitTip(m, 'ally')) + '">' +
      '<div class="uc-art">' + pic(art.list, 'uc-img', m.name, art.fb) + roleBadge(m.role, 'uc-role') + infoBtn(null, m.id) + '<span class="uc-slot" data-tip="' + T('ui.card.slotTip', { n: i + 1 }) + '"><b>' + (i + 1) + '</b></span>' + moodFace(m) + bondMark(m) + '</div>' +
      '<div class="uc-body"><div class="uc-name">' + esc(isLeader(m) ? (m.name && m.name !== T('ui.name.leader') ? m.name : T('ui.name.you')) : m.name) + '</div>' + (o.lvFocus ? lvFocusHtml(o.lvFocus.x || m, o.lvFocus.up) : '') + '<div class="uc-stats"><span data-tip="' + T('ui.card.hpTip') + '">' + IC.hp + ' ' + esc(m.hp != null && m.hp !== m.maxHp ? m.hp + '/' + m.maxHp : m.maxHp) + '</span><span>' + IC.atk + ' ' + esc(m.atk) + '</span>' + '</div>' + /* 2026-11-24b 用户「排版错乱了——充能只显示在人物详细介绍版里」: no 充能满格 on the small card (unitPanelHtml has it) */
      (o.xp && !o.lvFocus ? '<div class="uc-xp">' + xpBarHtml(o.xp === true ? m : o.xp) + '</div>' : '') + // 2026-11-16 经验条 (营火锻炼选人)
      '<div class="uc-chips">' + (o.wounded ? '<span class="chip bad wound" data-tip="' + T('ui.card.woundTip') + '">' + T('ui.card.wound') + '</span>' : '') + statusChips(m.statuses) + '</div></div>' +
      (o.orderNo ? '<span class="order-no" aria-hidden="true" data-tip="' + T('ui.card.slotTip', { n: i + 1 }) + '">' + (i + 1) + '</span>' : '') +
      (o.moves ? '<div class="uc-moves"><button data-act="move" data-i="' + i + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' data-tip="' + T('ui.card.moveLeftTip') + '">◀</button><button data-act="move" data-i="' + i + '" data-d="1"' + (i === n - 1 ? ' disabled' : '') + ' data-tip="' + T('ui.card.moveRightTip') + '">▶</button></div>' : '') + (o.moves && typeof comboTab === 'function' ? comboTab(m) : '') + (o.aimed ? aimedHtml(o.aimed) : '') + '</div>';
  }
  // 2026-11-19 用户亲测 界面 (锻炼选人): 「最重要的信息最显眼」 — her level, how far to the next one, and whether this training levels
  // her up lead the pick card; 生命 / 威力 / chips stay below, smaller. x = the engine's xpInfo; up = 'all' | 'some' | null (v.camp.train.up)
  var TRAIN_PICK_LV = true;
  function lvFocusHtml(x, up) {
    if (!x || x.lv == null) return '';
    var over = !!x.maxed && x.overStart != null, sp = A.xpSpan(x, 0) || { pct: 0 };
    var left = x.maxed ? (over ? x.overNext - x.xp : null) : (x.xpNext != null ? x.xpNext - x.xp : null);
    var txt = left == null ? T('ui.train.maxed') : T(over ? 'ui.xp.toOver' : 'ui.xp.toNext', { n: left });
    if (TRAIN_NO_RIBBON) { // 2026-11-20: 「你不知道会不会升级」 — no ribbon, no up-glow; the 经验 as X / Y (numbers only)
      up = null; if (left != null) txt = over ? (x.xp - x.overStart) + ' / ' + (x.overNext - x.overStart) : x.xp + ' / ' + x.xpNext;
    }
    return '<div class="uc-lvf' + (up ? ' up up-' + esc(up) : '') + '" data-tip="' + esc(T('ui.train.lvTip')) + '"><span class="lvf-top"><span class="lvf-lv">' + A.glyph('level', false) + '<b>Lv' + esc(x.lv) + '</b></span><span class="lvf-left">' + esc(txt) + '</span></span>' +
      '<span class="lvf-bar"><i style="width:' + sp.pct + '%"></i></span>' +
      (up ? '<span class="lvf-up"><i class="lvf-arrow" aria-hidden="true"></i>' + esc(T(up === 'all' ? 'ui.train.lvUpAll' : 'ui.train.lvUpSome')) + '</span>' : '') + '</div>';
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
        return '<button class="choice camp-card item' + rarCls(it) + '" data-act="campExplore" data-id="' + esc(id) + '" data-opt="explore:' + esc(id) + '"><span class="ch-head"><img src="' + esc(A.itemIcon(id)) + '" alt=""></span>' +
          '<b class="ch-name">' + esc(it.name || id) + '</b><span class="ch-rule"></span>' + cardFaceHtml(it) + pv + '</button>';
      }).join('') + '</div>';
    }
    if (cs === 'train-pick') {
      var ids = campList(c, ['candidates', 'members', 'targets']).map(function (x) { return typeof x === 'string' ? x : x.id; });
      if (!ids.length) ids = party().filter(function (m) { return !isLeader(m); }).map(function (m) { return m.id; });
      var tUp = (c.train && c.train.up) || {}; // 2026-11-19 用户亲测 界面: the level block leads each card (TRAIN_PICK_LV false: the old small xp line)
      return heading(T('ui.train.whoHeading'), T('ui.train.whoSub')) + '<div class="lane camp-pick' + (TRAIN_PICK_LV ? ' lv-focus' : '') + '">' + ids.map(function (id, i) { var m = member(id), x = (c.train && c.train.xp && c.train.xp[id]) || null; return m ? memberCard(m, i, ids.length, TRAIN_PICK_LV ? { act: 'campTrainPick', lvFocus: { x: x, up: tUp[id] || null } } : { act: 'campTrainPick', xp: x || true }) : ''; }).join('') + '</div>';
    }
    if (cs === 'train-bonus') {
      var who = c.member || c.id || c.target, m2 = member(who) || { id: who, name: nameOf(who) };
      var bs = campList(c, ['bonuses', 'options']);
      return '<div class="train-stand">' + pic(A.portrait(who), 'stand-img', m2.name, initialHtml(m2.name)) + '</div>' +
        '<div class="train-side' + (ui.trainTalk ? ' hidden-till-talk' : '') + '" id="trainSide">' + heading(isLeader(who) ? T('ui.train.selfHeading') : T('ui.train.withHeading', { name: m2.name }), T('ui.train.pickOf3')) + '<div class="camp-cards n3">' + bs.map(function (b) {
          var sp = b.special || !!b.downside, pv = b.preview ? (b.preview[who] || b.preview[Object.keys(b.preview)[0]]) : null;
          return '<button class="choice camp-card bonus' + (sp ? ' special' : '') + '" data-act="campTrainBonus" data-id="' + esc(b.id) + '" data-opt="bonus:' + esc(b.id) + '">' + (sp ? '<span class="cc-tag">' + T('ui.train.special') + '</span>' : '') +
            '<b class="ch-name">' + esc(b.label || b.name || b.id) + '</b><span class="ch-rule"></span>' + cardFaceHtml(b) +
            (!TRAIN_ONE_LINE && b.extra && effIcon(b.extra) ? '<span class="ch-eff ch-extra">' + richText(effIcon(b.extra)) + '</span>' : '') + // 2026-11-14 锻炼卡 extra: the second gain, its own line
            (sp && b.downside ? '<span class="cc-down">' + T('ui.train.cost', { text: b.downsideText || b.downside.text ? esc(b.downsideText || b.downside.text) : richText(effIcon(b.downside)) }) + '</span>' : '') +
            (b.deadText ? '<span class="ch-eff ch-extra">' + esc(b.deadText) + '</span>' : '') +
            (b.crashText ? '<span class="cc-down">（' + esc(b.crashText) + '）</span>' : '') + // 2026-11-22 试玩4 #11: 低落 → 崩溃 warned // 2026-11-22 round-3 #11: a dead extra (full hp / mood) says what it became
            (b.xpGain ? '<span class="cc-xp">' + xpBarHtml((c.train && c.train.xp) || b.xpGain.from || m2, b.xpGain) + '</span>' : '') + previewHtml(previewMinusExtra(previewMinusXp(pv, b.xpGain), b)) + '</button>'; // 2026-11-16 经验条
        }).join('') + '</div></div>';
    }
    return '';
  }
  // 2026-11-13 休息回血提示: the engine's restPreview / rest-event heals [{ id, name, amount, hp, maxHp, full }]; no math here
  function restFace(id, name) { return isLeader(id) ? pic(A.face('leader', leaderExpr('calm'), { variant: actNo() >= 3 ? 'worn' : 'base' }), '', name, crestHtml(true)) : pic(A.face(id, 'calm'), '', name, initialHtml(name)); }
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
  // 布阵教学 (docs/archive/DESIGN-2026-11-14-formation-guide.md, ui/formation-guide.js): the advisor offers to explain the formation the
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
  // 2026-11-20 用户「既然第一回合可以选择，这个就不需要了」: the opening pause before round 1 covers it. true = the old button
  var ARM_BTN = false;
  function armBtn(v) {
    if (!ARM_BTN) return '';
    var a = v.advisor; if (!a || a.present === false || !a.combat) return '';
    return '<button class="btn btn-secondary arm-skill' + (v.skillArmed ? ' on' : '') + '" data-act="armSkill" aria-pressed="' + (v.skillArmed ? 'true' : 'false') + '" data-tip="' + esc(T('ui.formation.armTip', { name: a.combat.name, text: a.combat.text })) + '">' +
      '<span class="pb-ic face">' + pic(A.face(a.id, 'calm'), '', '', '') + '</span>' + T(v.skillArmed ? 'ui.formation.armOn' : 'ui.formation.armOff', { name: a.combat.name }) + '</button>';
  }
  // ---------- 2026-11-14 金币 + 提灯货郎·芙洛的店 (engine view.shop / view.gold; docs/archive/DESIGN-2026-11-14-gold-and-shop.md 实施记录) ----------
  // The shop is a step of the night: while view.shop.open the prep screen is her shop (the campfire talk plays first; the camp
  // choice waits untouched). Gold shows only where items do (formation / reward / shop), never in battle.
  function goldHtml(n, cls) { return '<span class="gold-chip' + (cls ? ' ' + cls : '') + '" tabindex="0" data-tip="' + esc(T('ui.shop.goldTip')) + '">' + A.glyph('coin', false) + '<b class="gc-n">' + esc(n) + '</b></span>'; }
  function goldChip(v) { return v && v.gold != null && v.phase !== 'battle' && v.phase !== 'battleResult' ? goldHtml(gcPending(v) ? v.gold - v.winGold : v.gold) : ''; } // GOLD_CLAIM: the old total until 领取
  function shopIcon(o) { var e = o.effect || {}; return A.icon(A.cardIcon({ id: o.id, effect: e.type === 'relic' || e.type === 'guildRelic' ? { type: 'token' } : e })); } // 2026-11-22 遗物: the keepsake icon // id first (2026-11-20 ICON_BY_ID in assets.js)
  function shopSay(S) { // 2026-11-15: her intro plays as a VN beat before the shop; the side box only says her latest reply (or a short idle line)
    var l = S.line || { speaker: 'fluo', name: T('ui.name.fluo'), expr: 'calm', text: T('ui.shop.idle') };
    return '<div class="shop-say panel">' +
      '<span class="ss-face">' + pic(A.face('fluo', l.expr || 'calm'), '', l.name || '', '') + '</span><span class="ss-body"><b>' + esc(l.name || T('ui.name.fluo')) + '</b><q>' + esc(l.text) + '</q></span></div>';
  }
  function shopPrice(o) { return '<span class="sc-price">' + A.glyph('coin', false) + '<b>' + esc(o.price) + '</b>' + (o.varies ? '<small>' + T('ui.shop.from') + '</small>' : '') + '</span>'; }
  function shopCard(o, small) {
    var off = o.sold || !o.affordable, why = o.sold ? T('ui.shop.soldOut') : o.reason ? T('engine.shop.why.' + o.reason) : '';
    return '<button class="choice shop-card k-' + esc(o.kind || 'x') + rarCls(o) + (o.sold ? ' sold' : '') + (off ? ' off' : '') + (small ? ' small' : '') + '" data-act="' + (small ? 'shopBack' : 'shopPick') + '" data-id="' + esc(o.id) + '" data-opt="shop:' + esc(o.id) + '"' + // 2026-11-15 user: the picked card itself takes you back (换一件)
      (off && !small ? ' aria-disabled="true"' : '') + ' data-tip="' + esc(small ? T('ui.shop.back') : (o.flavor || '') + (why ? ' ' + why : '')) + '">' +
      '<span class="ch-head"><img src="' + esc(shopIcon(o)) + '" alt=""></span><b class="ch-name">' + esc(o.name) + '</b>' + cardFaceHtml({ text: o.text }) + /* the effect line (bold numbers) */
      (o.sold ? '<span class="sc-sold">' + T('ui.shop.soldOut') + '</span>' : shopPrice(o)) + '</button>';
  }
  // 2026-11-15 user: the shop night opens with a lantern-bell jingle (叮玲玲), then 芙洛 steps in as a story beat: her stand
  // enters like any speaker, her intro lines (view.shop.lines) play one click each in the dialogue box, then 「看看货」/「不用了」.
  // UI state only (module-level, keyed by seed + level, survives the re-render after each purchase; a reload plays it again):
  // fluoIntro[k] = 'play' (lines queued) → 'ask' (the two buttons) → 'shop' (her shop screen). Never blocks shopLeave.
  var fluoIntro = {};
  function shopKey(v) { return (run && run.seed) + ':' + (v && v.shop && v.shop.level); }
  function shopRing(v) { var k = 'ring:' + shopKey(v); if (fluoIntro[k]) return; fluoIntro[k] = 1; cue('shopBell', null, 0); }
  function shopIntroLines(v) {
    var ls = ((v.shop && v.shop.lines) || []).map(function (l) { var o = normLine(l); if (o) { o.speakerId = o.speakerId || 'fluo'; o.name = o.name || T('ui.name.fluo'); o.vnClass = 'camp'; } return o; }).filter(Boolean);
    var last = ls[ls.length - 1];
    if (!last || !/[？?]\s*$/.test(last.text)) ls.push({ speaker: 'fluo', speakerId: 'fluo', name: T('ui.name.fluo'), expr: 'happy', text: T('ui.shop.ask'), vnClass: 'camp' }); // she ends on the question the buttons answer
    return ls;
  }
  function shopIntroHtml(v) {
    var ask = fluoIntro[shopKey(v)] === 'ask';
    var stand = ask ? '<div class="stand at-' + (FLUO_LEFT && !FLUO_RIGHT ? 'left' : 'right') + ' v-base" data-k="fluo:base">' + pic(standList('fluo', 'base'), 'stand-img', '', '') + '</div>' : ''; // a re-render while she asks keeps her on screen
    return '<div class="camp-wrap shop-intro" id="campWrap"><div class="stand-layer" id="stand">' + stand + '</div>' +
      '<div class="bell-choices shop-ask" id="shopAsk"' + (ask ? '' : ' hidden') + '>' +
      '<button class="bigchoice btn btn-secondary" data-act="shopLeave" data-opt="shop:no"><span>' + T('ui.shop.askNo') + '</span></button>' +
      '<button class="bigchoice btn btn-primary" data-act="shopLook" data-opt="shop:look"><span>' + T('ui.shop.askLook') + '</span></button></div></div>';
  }
  function shopIntroShowAsk(v) {
    // 2026-11-15 user: the buttons came up while her last line was still on screen — wait until the dialogue box is really gone
    if (vnActive() || !vnEl.hidden) { setTimeout(function () { if (view && view.shop && view.shop.open && fluoIntro[shopKey(view)] === 'play') shopIntroShowAsk(view); }, 120); return; }
    fluoIntro[shopKey(v)] = 'ask';
    var c = $('shopAsk'); if (!c) { render(); return; }
    c.hidden = false; var b = c.querySelector('.btn-primary'); if (b) b.focus({ preventScroll: true });
  }
  function shopIntroMaybe(v) { // called from SCREENS.prep.after while the intro screen is up
    var k = shopKey(v), st = fluoIntro[k];
    if (st === 'play' && !vnActive()) { shopIntroShowAsk(v); return; } // the queue was cleared under it (menu, home…): straight to the buttons
    if (st) return;
    fluoIntro[k] = 'play'; vn.cls = 'camp';
    ui.onSpeak = function (id, l) { if (id !== undefined) standShow(id, l); };
    sayFx(stages([[function () { shopRing(v); }, 900]])); // 叮玲玲 first (a click skips the wait)
    say(shopIntroLines(v), function () { ui.onSpeak = null; vn.cls = ''; if (view && view.shop && view.shop.open && fluoIntro[k] === 'play') shopIntroShowAsk(view); });
  }
  function shopHtml(v) {
    var S = v.shop, offers = S.offers || [], c = ui.shopPick ? offers.filter(function (o) { return o.id === ui.shopPick && !o.sold; })[0] : null, main;
    if (!c) main = '<div class="shop-offers' + (offers.length > 8 ? ' shop-n4 shop-dense' : offers.length > 6 ? ' shop-n4' : offers.length > 3 ? ' shop-n3' : '') /* 2026-11-24 用户「把屏幕用起来，尽可能不要 scroll」: 7–8 → 4 a row; 9+ → 4 a row, 3 rows, smaller cards */ + '">' + offers.map(function (o) { return shopCard(o); }).join('') + '</div>';
    else { // 「给谁？」: a head per member with HER price; greyed heads say why
      var heads = (c.targets || []).map(function (t) {
        var m = member(t.id) || { id: t.id, name: t.name }, art = unitArt({ id: t.id, side: 'ally', isLeader: isLeader(m) }), sel = ui.shopWho === t.id;
        var why = t.ok ? '' : T('engine.shop.why.' + t.reason);
        return '<button class="who-head shop-who' + (sel ? ' on' : '') + (t.ok ? '' : ' has') + '" data-act="shopWho" data-id="' + esc(t.id) + '" data-opt="sw:' + esc(t.id) + '"' + (t.ok ? '' : ' aria-disabled="true" data-tip="' + esc(why) + '"') + '>' +
          '<span class="wh-face">' + pic(art.list, '', m.name, art.fb) + '</span><b>' + esc(whoNameOf(m, false)) + '</b>' +
          (m.atk != null ? '<span class="sw-stat num">' + IC.atk + esc(m.atk) + (m.skillLv ? '<span class="sw-lv">' + A.glyph('level', false) + 'Lv' + esc(m.skillLv) + '</span>' : '') + '</span>' : '') + /* 2026-11-15 user: show her current 威力 / Lv while choosing */
          (t.xpGain ? xpBarHtml(t) : '') + /* 2026-11-16 经验条 (经验类商品) */ '<span class="sw-price">' + A.glyph('coin', false) + esc(t.price) + '</span>' + (t.ok ? '' : '<small class="sw-why">' + esc(why) + '</small>') + '</button>';
      }).join('');
      var t0 = (c.targets || []).filter(function (t) { return t.id === ui.shopWho && t.ok; })[0], detail;
      if (!t0) detail = '<div class="who-detail panel wd-empty"><div class="wd-body"><b class="wd-name">' + T('ui.reward.pickWhoPrompt') + '</b><button class="btn btn-primary wd-ok" disabled aria-disabled="true">' + T('ui.shop.buy') + '</button></div></div>';
      else {
        var m0 = member(t0.id) || { id: t0.id, name: t0.name }, a0 = unitArt({ id: t0.id, side: 'ally', isLeader: isLeader(m0) });
        detail = '<div class="who-detail panel"><span class="wd-face">' + pic(a0.list, '', m0.name, a0.fb) + '</span><div class="wd-body"><b class="wd-name">' + esc(whoNameOf(m0, false)) + '</b>' +
          (t0.xpGain ? '<span class="wd-xp">' + xpBarHtml(t0, t0.xpGain) + '</span>' : '') + // 2026-11-16 经验条
          (t0.preview && t0.preview.length ? previewHtml(previewMinusXp(t0.preview, t0.xpGain)) : t0.xpGain ? '' : '<span class="wd-none">' + T('ui.reward.noChange') + '</span>') +
          '<button class="btn btn-primary wd-ok" data-act="shopBuy" data-id="' + esc(c.id) + '" data-who="' + esc(t0.id) + '" data-opt="buy:' + esc(c.id) + '">' + T('ui.shop.buy') + ' ' + A.glyph('coin', false) + esc(t0.price) + '</button></div></div>';
      }
      main = heading(T('ui.shop.forWhom'), c.varies ? T('ui.shop.forWhomSub') : '') + '<div class="picked">' + shopCard(c, true) + '<button class="btn-ghost back" data-act="shopBack">' + T('ui.shop.back') + '</button></div>' +
        '<div class="whos"><div class="who-heads">' + heads + '</div>' + detail + '</div>';
    }
    return '<div class="shop-wrap" id="shopWrap"><div class="shop-fluo" aria-hidden="true">' + pic(A.portrait('fluo'), 'stand-img', '', '') + '</div>' +
      '<div class="shop-side"><h2 class="shop-title">' + T('ui.shop.title') + '</h2>' + shopSay(S) + '</div>' +
      '<div class="shop-main">' + main + '</div>' +
      '<div class="shop-foot">' + (TOPBAR_SPLIT ? bagSlots(v.items) : bagChip(v.items, null)) + /* 2026-11-25: the same 5 slots as the top bar */ goldHtml(S.gold, 'big') + '<button class="btn btn-primary btn-lg" data-act="shopLeave">' + T('ui.shop.leave') + '</button></div></div>';
  }
  var SHOP_H = {
    shopLook: function () { if (!view || !view.shop || !view.shop.open) return; fluoIntro[shopKey(view)] = 'shop'; render(); }, // 「看看货」
    shopPick: function (d, t) {
      var o = ((view && view.shop && view.shop.offers) || []).filter(function (x) { return x.id === d.id; })[0];
      if (!o || ui.acted) return;
      if (o.sold || !o.affordable) { pulse(t, 'nope', 400); return; } // greyed: a small shake, the tip says why
      if (o.needsTarget) { ui.shopPick = o.id; ui.shopWho = null; render(); return; }
      ui.acted = 1; cue('reward', null, 0); if (!doAct({ type: 'shopBuy', itemId: o.id }, true)) ui.acted = 0;
    },
    shopWho: function (d, t) { if (t && t.classList.contains('has')) { pulse(t, 'nope', 400); return; } ui.shopWho = d.id; render(); },
    shopBack: function () { ui.shopPick = null; ui.shopWho = null; render(); },
    shopBuy: function (d) {
      if (!d.id || !d.who || ui.acted) return;
      var o = ((view && view.shop && view.shop.offers) || []).filter(function (x) { return x.id === d.id; })[0];
      if (ringAsk(o && o.effect, d.who, d.side, function (side) { SHOP_H.shopBuy({ id: d.id, who: d.who, side: side }); })) return; // 2026-11-21 转向指环
      ui.acted = 1; cue('reward', null, 0); if (!doAct({ type: 'shopBuy', itemId: d.id, target: d.who, side: d.side }, true)) ui.acted = 0;
    },
    shopLeave: function () { if (ui.acted) return; ui.acted = 1; if (!doAct({ type: 'shopLeave' }, true)) ui.acted = 0; }
  };

  // 2026-11-15 user: on the bell night the team's talk, 芙洛 (if her shop is open) and the bell each play on their own, in that order.
  // The lines come from the night's first view only (v.events), so they are kept here across re-renders and shop actions.
  var nightQ = {};
  function nightKey() { return 'n:' + (run && run.seed) + ':' + (run && run.level); }
  function nightState(v) {
    var k = nightKey(), st = nightQ[k];
    if (!st) {
      var cl = campLines(v).map(function (l) { var o = normLine(l); if (o) o.vnClass = 'camp'; return o; }).filter(Boolean);
      var bl = bellLines(v).map(function (l) { var o = normLine(l); if (o) o.vnClass = 'camp'; return o; }).filter(Boolean);
      st = nightQ[k] = { cl: cl, bl: bl, team: !cl.length, bell: !bl.length && !cl.length, playing: null };
    }
    return st;
  }
  function nightTeamDone(v) { var st = nightQ[nightKey()]; return !!(st && st.team); }
  function nightBellDone(v) { var st = nightQ[nightKey()]; return !!(st && st.bell); }
  function nightStep(v) {
    var st = nightState(v);
    if (st.playing && !vnActive()) st.playing = null; /* the queue was cleared under it (menu, home…) */
    if (st.playing) return;
    if (!st.team) {
      st.playing = 'team'; vn.cls = 'camp';
      say(st.cl, function () { vn.cls = ''; st.team = true; st.playing = null; render(); });
      return;
    }
    if (v.shop && v.shop.open) { if ($('shopAsk')) shopIntroMaybe(v); return; } /* html shows her once the team is done */
    if (!st.bell) {
      st.playing = 'bell'; vn.cls = 'camp'; ringBell();
      var bl = st.bl.slice(); if (bl.length) bl[0].onShow = function () { ringBell(); };
      say(bl, function () { vn.cls = ''; st.bell = true; st.playing = null; ui.bellHeard = true; var c = $('bellChoices'); if (c) c.hidden = false; else render(); later(ringBell, 1800); });
      return;
    }
    ui.bellHeard = true; var c = $('bellChoices'); if (c && c.hidden) c.hidden = false;
  }
  SCREENS.prep = {
    topExtra: function () { return routeBtn(); }, // 路线图: the map button by ☰ (touch-sized), any time at the campfire
    plate: function (v) { if (PREP_LEVEL_PLATE && v.nextLevel) return plate(T(v.nextLevel.title ? 'ui.camp.nextLevel' : 'ui.camp.nextLevelNoTitle', { n: esc(v.nextLevel.n), title: esc(v.nextLevel.title) })); return plate(T(campStep(v) === 'done' ? 'ui.camp.plateDone' : 'ui.camp.plate')); }, // 2026-11-19 user: the night shows the coming level (PREP_LEVEL_PLATE false: 叙事节奏 2026-11-13: the night never names the next level; the scene intro comes after 「出发」
    html: function (v) {
      if (!ui.order) { ui.order = v.party.map(function (m) { return m.id; }); ui.moves = 0; }
      if (v.bell && !campHasBell(v)) { // §6 the bell campfire (engines without the v2.3 four-card camp): no talk, a bell nobody else hears, two big choices
        return '<div class="camp-wrap bell-camp">' + standHtml() + bellRing() + '<div class="bell-choices" id="bellChoices"' + (ui.bellHeard || nightBellDone(v) ? '' : ' hidden') + '>' +
          '<button class="bigchoice btn btn-secondary bell-follow" data-act="followBell" data-opt="bell:follow"><span>' + T('ui.camp.bell.follow') + '</span><q>' + T(v.bellWound === false ? 'ui.camp.bell.noWoundDown' : 'ui.camp.bell.down') + '</q></button>' +
          '<button class="bigchoice btn btn-primary" data-act="stayFire" data-opt="bell:stay"><span>' + T('ui.camp.bell.stay') + '</span><q>' + T('ui.camp.bell.stayDown') + '</q></button></div></div>';
      }
      if (ui.talking == null) ui.talking = !v.bell && campLines(v).length > 0 && !replayed['camp:' + (run.history || []).length]; // G2 #12: the bell night plays its own talk (enter) — talking mode here hid #bellChoices for good
      if (QUICK && v.shop && v.shop.open) fluoIntro[shopKey(v)] = 'shop'; /* 快速模式: no intro talk, the shop itself */
      if (!ui.talking && v.shop && v.shop.open && !(v.bell && !nightTeamDone(v))) return fluoIntro[shopKey(v)] === 'shop' ? shopHtml(v) : shopIntroHtml(v); // 2026-11-14 芙洛的店: after the talk, before the camp choice (2026-11-15: her VN intro + ask first)
      var PI = intentPrep(v); // 2026-11-19 意图预告: round 1 before the battle (null = the engine gives none yet)
      var wd = woundedNow(v), n = ui.order.length, cards = ui.order.map(function (id, i) { return memberCard(member(id), i, n, withAimed({ drag: true, moves: true, wounded: wd, orderNo: true }, PI, id)); }).join('');
      var foes = ''; for (var i = 0; i < Math.min(Math.max(v.enemyCount || 0, PI ? PI.list.length : 0), 7); i++) { var ih = PI && PI.list[i] ? intentHtml(PI.list[i]) : ''; foes += '<span class="foe-ghost' + (ih ? ' has-intent' : '') + '">' + (ih ? '<i class="fg-q">?</i>' + ih : '?') + '</span>'; }
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
      if (v.bell) { nightState(v); return; } /* 2026-11-15 user: the bell night plays 队员 → 芙洛 → 铃铛 one after another (nightStep in prep.after) */
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
    after: function (v) {
      if (v && v.bell) nightStep(v); /* 2026-11-15 bell night: 队员 → 芙洛 → 铃铛 */
      else if (v && $('shopAsk')) shopIntroMaybe(v); // 2026-11-15 芙洛's intro beat
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

  // ---------- 2026-11-19 路线图 (route map): the move before each new campfire + the map at the campfire ----------
  // Pure parts (node spots, which nodes show, the move plan, the marker point) live in assets.js (A.route*). The picture has no
  // text; labels come from the text tables (ui.level.*) and the level titles of data/scenario.json. ROUTE_MAP = false → none of it.
  var ROUTE_KEY = 'chooser.route.v1' + (STUB ? '.stub' : '') + PSUF; // { seed, level, h }: the last move shown for this run (h = its history length)
  var ROUTE_ICON = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.4" opacity=".7"/></svg>';
  function routeBtn() { return ROUTE_MAP && run ? '<button class="btn-icon route-btn vn-pass" data-act="routeMap" aria-label="' + T('ui.route.open') + '" data-tip="' + T('ui.route.open') + '">' + ROUTE_ICON + '</button>' : ''; }
  function routeTitle(lv) { var c = lvCfgUi(lv); if (!c) return ''; if (c.cardTitle && view && view.level === lv && view.levelTitle === c.cardTitle) return c.cardTitle; return c.title || ''; } // 2026-11-21: 出口 → 王座 once she turned
  function routeCps() { return A.routeCheckpoints(DATA && DATA.scenario); }
  // the board: picture + path + nodes (+ fog over the still-hidden ones) + the party marker at node `at`
  function routeBoardHtml(at, o) {
    o = o || {}; var nodes = A.routeNodes(at, { checkpoints: routeCps() }), fog = o.fog || A.routeFogged(at), art = live(A.routeArt())[0];
    var pc = function (n) { return 'left:' + (n.x * 100).toFixed(2) + '%;top:' + (n.y * 100).toFixed(2) + '%'; }, segs = '';
    for (var i = 1; i < nodes.length; i++) {
      var a = nodes[i - 1], b = nodes[i];
      segs += '<line class="rm-seg' + (b.level <= at ? ' done' : '') + (o.reveal && o.reveal.indexOf(b.key) >= 0 ? ' rv' : '') + '" x1="' + (a.x * 1920).toFixed(1) + '" y1="' + (a.y * 1080).toFixed(1) + '" x2="' + (b.x * 1920).toFixed(1) + '" y2="' + (b.y * 1080).toFixed(1) + '"/>';
    }
    var dots = nodes.map(function (n) {
      var name = n.level ? routeTitle(n.level) : '', no = n.level ? lvNo(n.level) : T('ui.level.guild');
      return '<div class="rm-node st-' + n.state + (n.cp ? ' cp' : '') + (o.reveal && o.reveal.indexOf(n.key) >= 0 ? ' rv' : '') + '" data-lv="' + n.level + '" style="' + pc(n) + '"' + (n.cp ? ' data-tip="' + esc(T('ui.route.checkpoint')) + '"' : '') + '>' +
        '<i class="rm-dot"></i><span class="rm-label"><small>' + esc(no) + '</small>' + (name ? '<b>' + esc(name) + '</b>' : '') + '</span></div>';
    }).join('');
    var fogs = A.ROUTE_NODES.filter(function (n) { return fog.indexOf(n.key) >= 0; }).map(function (n) { return '<div class="rm-fog" data-k="' + esc(n.key) + '" style="' + pc(n) + '"></div>'; }).join('');
    var here = nodes.filter(function (n) { return n.level === (o.markAt != null ? o.markAt : at); })[0] || nodes[0];
    return '<div class="rm-board"' + (art ? ' style="background-image:url(&quot;' + esc(splitCand(art).src) + '&quot;)"' : '') + '>' +
      '<svg class="rm-path" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true">' + segs + '</svg>' + fogs + dots +
      '<div class="rm-party" id="rmParty" style="' + pc(here) + '" aria-label="' + esc(T('ui.route.here')) + '">' + pic([A.leaderBadge()], 'rm-badge', '', '') + '</div></div>';
  }
  // the map at the campfire (any time): opens in #modal, × / Esc / a tap outside the board closes it
  function routeOpen(waited) {
    if (ROUTE_MAP_V2) return routeOpen2(); // 2026-11-19 路线图 v2: the clean map (v1 below kept as backup); v2 decodes its own picture, so the 预加载 wait below is v1 only
    if (!ROUTE_MAP || !run || !view) return;
    // 2026-11-19 预加载: wait (at most 1.5s) for the map picture, so the paths never paint over black
    if (!waited && PRE && !PRE.isReady(A.routeArt())) { if (!route.wait) { route.wait = true; PRE.ready(A.routeArt(), 1500).then(function () { route.wait = false; routeOpen(true); }); } return; }
    hideTip(); modalEl.innerHTML = '<div class="route-ov static">' + routeBoardHtml(view.level | 0) +
      '<button class="btn-icon rm-close" data-act="routeClose" aria-label="' + T('ui.route.close') + '">×</button></div>';
    modalEl.hidden = false; modalEl.classList.add('route-open', 'vn-pass');
    var ov = modalEl.querySelector('.route-ov'); if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
  }
  // entering a new campfire: play the move from the last node first? (true = it is playing; it renders the campfire after)
  function routeMaybe(v) {
    if (!ROUTE_MAP || !run || QUICK) return false; // 快速模式: no move
    var lv = v.level | 0, h = (run.history || []).length, rec = lsGet(ROUTE_KEY, null);
    var last = rec && rec.seed === run.seed && (rec.h | 0) <= h ? rec.level : null; // a record from later in the same seed (dev jumps) does not count
    if (last == null || last < lv) lsSet(ROUTE_KEY, { seed: run.seed, level: lv, h: h });
    // 2026-11-20 流程: on the way out of the first formation too (公会 → 第 1 关)
    if (!A.routeWants(lv, last) && !(FLOW_DEPART_ROUTE && lv === 1 && (last == null || last < 1))) return false;
    // 2026-11-20 流程: after the map opens into the new place, its place card (the map fades off it), then the scene intro
    // 2026-11-20b (ARRIVE_ONE_CARD): no place card here — the scene intro's level card is the one title
    var arrive = FLOW_DEPART_ROUTE && !ARRIVE_ONE_CARD ? function () { route.busy = true; placeCard(placeName(lv), function () { route.busy = false; render(); }); } : function () { render(); };
    if (ROUTE_MAP_V2) { // 2026-11-19 路线图 v2: the ink reveal + one tap instead of the walk
      var plan2 = A.routeRevealPlan(lv - 1, lv, { reduced: REDUCED, seen: last }); if (!plan2) return false;
      vnClear(); app.innerHTML = ''; screenKey = null;
      routePlay2(plan2, arrive, FLOW_DEPART_ROUTE ? routeTalkOnce() : null);
      blackOffSoon();
      return true;
    }
    var plan = A.routeAnimPlan(lv - 1, lv, { reduced: REDUCED, seen: last }); if (!plan) return false;
    vnClear(); app.innerHTML = ''; screenKey = null; // the campfire enters fresh once the move is over
    routePlay(plan, arrive);
    blackOffSoon();
    return true;
  }
  function routePlay(plan, done) {
    route.busy = true;
    var ov = document.createElement('div'); ov.className = 'route-ov anim';
    ov.innerHTML = routeBoardHtml(plan.to, { fog: plan.fog, reveal: plan.reveal, markAt: plan.from }) + '<p class="rm-skip">' + T('ui.route.skip') + '</p>';
    stageEl.appendChild(ov);
    var m = ov.querySelector('#rmParty'), fin = false, raf = 0, t0 = 0, lifted = false;
    var place = function (t) { var p = A.routePointAt(plan.pts, t); if (m && p) { m.style.left = (p.x * 100).toFixed(2) + '%'; m.style.top = (p.y * 100).toFixed(2) + '%'; } };
    var lift = function () { if (lifted) return; lifted = true; ov.classList.add('revealed'); };
    function end() {
      if (fin) return; fin = true; cancelAnimationFrame(raf); place(1); lift();
      route.busy = false; done();
      ov.classList.add('out'); setTimeout(function () { ov.remove(); }, REDUCED ? 0 : 400);
    }
    ov.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); end(); });
    cue('move', null, 0);
    if (plan.jump) { place(1); lift(); ov.classList.add('on'); setTimeout(end, 900); return; } // reduced motion: the marker is already there; a short look, then on
    function tick(now) {
      if (fin) return; if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / plan.ms); place(t); if (plan.reveal.length && t >= 0.55) lift();
      if (t < 1) raf = requestAnimationFrame(tick); else setTimeout(end, 450);
    }
    raf = requestAnimationFrame(function (now) { place(0); ov.classList.add('on'); tick(now); });
  }

  // ---------- 2026-11-19 路线图 v2 (user: 「路线动画好难看…不要用这些奇怪粗糙的ui连线 以及白方块贴图」) ----------
  // No party marker, no walk. Frame by frame: (dark until the picture is decoded) → the map fades in → [secret / throne: its fog
  // clears] → the ink path from the last place to the new one draws itself → the new place glows, its name fades in → the hint
  // (its name + 「点击进入」) → a tap / Enter / Space anywhere → the campfire. The v1 walk (routeBoardHtml / routePlay) stays above.
  var ROUTE_UP_W = 1080, ROUTE_UP_H = 1920, ROUTE_UP_BW = Math.round(ROUTE_UP_H * 16 / 9); // 2026-11-19 路线图 v2: portrait sizes (stage px)
  // 2026-11-19 路线图 v2 polish: off — the map turns with the stage like every other screen (the campfire is sideways too)
  var ROUTE_V2_UPRIGHT = false;
  // 2026-11-19 用户亲测 界面: 「后面还没解锁的关不显示名字，只显示一个标记点」 — a place not reached yet is a dot only (false: 第 N 关 + its name)
  var ROUTE_V2_HIDE_AHEAD = true;
  // 2026-11-19 用户亲测 界面: 「点击进入时要有打开 / 渐入的切换效果」 — the tap opens into the new place (the map grows toward it and
  // fades while the campfire fades in under it). false = the old plain fade-out
  var ROUTE_V2_ENTER_OPEN = true, ROUTE_ENTER_MS = 760;
  function routeUpright() { return ROUTE_V2_UPRIGHT && !!(stageEl && stageEl.classList.contains('st-rot')); } // 2026-11-19 路线图 v2: the stage is turned → draw the map upright
  // 2026-11-19 路线图 v2: the board: picture + calm ink trail of the visited legs (+ the leg being drawn) + nodes + fog
  function routeBoard2(at, o) {
    o = o || {}; var nodes = A.routeNodes(at, { checkpoints: routeCps() }), fog = o.fog || A.routeFogged(at), rv = o.reveal || [], art = live(A.routeArt())[0];
    var pc = function (n) { return 'left:' + (n.x * 100).toFixed(2) + '%;top:' + (n.y * 100).toFixed(2) + '%'; }, trail = '', drawn = '';
    var leg = function (d) { return '<path class="rm2-halo" d="' + d + '" filter="url(#rm2Soft)"/><path class="rm2-ink" d="' + d + '"/>'; };
    for (var i = 1; i < nodes.length; i++) {
      var a = nodes[i - 1], b = nodes[i]; if (b.level > at) break;
      if (o.draw && o.draw.to === b.level) continue; // the new leg is drawn on its own, under the pen mask
      trail += '<g class="rm2-trail" data-from="' + a.level + '" data-to="' + b.level + '">' + leg(A.routeInkPath(a, b)) + '</g>';
    }
    if (o.draw) {
      drawn = '<mask id="rm2Pen" maskUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080"><path class="rm2-pen" d="' + o.draw.d + '" pathLength="1" stroke-dasharray="1 1"' +
        (o.drawMs ? ' style="transition-duration:' + o.drawMs + 'ms"' : '') + '/></mask>';
      drawn = { defs: drawn, g: '<g class="rm2-draw" data-from="' + o.draw.from + '" data-to="' + o.draw.to + '" mask="url(#rm2Pen)">' + leg(o.draw.d) + '</g>' };
    }
    var dots = nodes.map(function (n) {
      var name = n.level ? routeTitle(n.level) : '', no = n.level ? lvNo(n.level) : T('ui.level.guild');
      var lab = ROUTE_V2_HIDE_AHEAD && n.state === 'upcoming' ? '' : '<span class="rm2-label"><small>' + esc(no) + '</small>' + (name ? '<b>' + esc(name) + '</b>' : '') + '</span>'; // 2026-11-19 用户亲测 界面: ahead = a dot only
      return '<div class="rm2-node st-' + n.state + (n.cp ? ' cp' : '') + (rv.indexOf(n.key) >= 0 ? ' rv' : '') + (o.newLv === n.level ? ' new' : '') + '" data-lv="' + n.level + '" data-k="' + esc(n.key) + '" style="' + pc(n) + '"' +
        (n.cp ? ' data-tip="' + esc(T('ui.route.checkpoint')) + '"' : '') + '><i class="rm2-glow"></i><i class="rm2-dot"></i>' + lab + '</div>';
    }).join('');
    var fogs = A.ROUTE_NODES.filter(function (n) { return fog.indexOf(n.key) >= 0; }).map(function (n) { return '<div class="rm2-fog' + (rv.indexOf(n.key) >= 0 ? ' rv' : '') + '" data-k="' + esc(n.key) + '" style="' + pc(n) + '"></div>'; }).join('');
    var shift = o.upright ? A.routeShift(o.focus != null ? o.focus : 0.5, ROUTE_UP_W, ROUTE_UP_BW) : 0;
    return '<div class="rm2-board"' + ' style="' + (art ? 'background-image:url(&quot;' + esc(splitCand(art).src) + '&quot;);' : '') + (shift ? 'left:' + shift + 'px;' : '') + '">' +
      '<svg class="rm2-path" viewBox="0 0 1920 1080" preserveAspectRatio="none" aria-hidden="true"><defs><filter id="rm2Soft" filterUnits="userSpaceOnUse" x="0" y="0" width="1920" height="1080"><feGaussianBlur stdDeviation="5"/></filter>' +
      (drawn ? drawn.defs : '') + '</defs>' + trail + (drawn ? drawn.g : '') + '</svg>' + fogs + dots + '</div>';
  }
  // 2026-11-19 路线图 v2: the map picture decoded before anything shows (img.decode / onload, short fallback). Not ready → bad()
  function routeArtReady(ok, bad, ms) {
    var art = live(A.routeArt())[0], src = art && splitCand(art).src, fired = false, tm = 0;
    var once = function (f) { return function () { if (fired) return; fired = true; clearTimeout(tm); f(); }; }, good = once(ok), fail = once(bad);
    if (!src || typeof Image !== 'function') return fail();
    tm = setTimeout(fail, ms);
    try {
      var im = new Image();
      im.onload = function () { if (im.decode) im.decode().then(good, good); else good(); };
      im.onerror = fail; im.src = src;
      if (im.decode) im.decode().then(good, function () { /* still loading or broken: onload / onerror decide */ });
    } catch (e) { fail(); }
  }
  // 2026-11-19 路线图 v2: the reveal before a new campfire (plan = A.routeRevealPlan); done() renders the campfire
  function routePlay2(plan, done, talk) {
    route.busy = true;
    var up = routeUpright(), ov = document.createElement('div'), fin = false, ready = false, shownAt = 0, ts = [], t = plan.t;
    var talkAt = talk && talk.lines.length ? 0 : -1; // 2026-11-20 流程: the first map — the advisor's lines first (one tap each), then 「点击进入」
    ov.className = 'route-ov v2 anim' + (up ? ' upright' : '') + (plan.reveal.length ? ' has-rv' : '');
    var nm = routeTitle(plan.to), no = lvNo(plan.to);
    ov.innerHTML = routeBoard2(plan.to, { fog: plan.fog, reveal: plan.reveal, draw: plan.seg, drawMs: t.drawMs, newLv: plan.to, focus: plan.focusX, upright: up }) +
      '<div class="rm2-hint" aria-live="polite"><small>' + esc(no) + '</small><b>' + esc(nm || no) + '</b><span class="rm2-go">' + esc(T('ui.route.enter')) + '</span></div>' +
      (talkAt >= 0 ? '<div class="rm2-talk" aria-live="polite"><b class="rm2-who">' + esc(talk.name) + '</b><p class="rm2-say"></p><small>' + esc(T('ui.route.talk.tap')) + '</small></div>' : '');
    stageEl.appendChild(ov);
    var sayEl = ov.querySelector('.rm2-say');
    function talkStep() { // true = a line was taken (the tap does not enter yet)
      if (talkAt < 0) return false;
      if (talkAt >= talk.lines.length) { talkAt = -1; ov.classList.remove('talking'); shownAt = Date.now(); return true; }
      if (sayEl) sayEl.textContent = talk.lines[talkAt]; talkAt++; ov.classList.add('talking'); shownAt = Date.now(); return true;
    }
    var later = function (fn, ms) { ts.push(setTimeout(fn, ms)); };
    function end() {
      if (fin) return; fin = true; ts.forEach(clearTimeout); document.removeEventListener('keydown', onKey, true);
      route.busy = false; done();
      if (!ready) { ov.remove(); return; } // the picture never came: nothing was shown, straight to the campfire
      if (ROUTE_V2_ENTER_OPEN && !REDUCED) { routeEnterOpen(ov, plan.to); return; } // 2026-11-19 用户亲测 界面
      ov.classList.add('out'); setTimeout(function () { ov.remove(); }, REDUCED ? 0 : 420);
    }
    var canGo = function () { return ready && Date.now() - shownAt >= 250; }; // a tap carried over from the last screen does not count
    function onKey(e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopImmediatePropagation(); if (canGo() && !talkStep()) end();
    }
    ov.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (canGo() && !talkStep()) end(); });
    document.addEventListener('keydown', onKey, true);
    function go() {
      if (fin || ready) return; ready = true; shownAt = Date.now(); cue('move', null, 0);
      if (plan.reduced) { ov.classList.add('on', 'fog-clear', 'draw', 'lit', 'ready'); talkStep(); return; } // reduced motion: the final picture at once, still one tap
      requestAnimationFrame(function () {
        ov.classList.add('on'); if (plan.reveal.length) ov.classList.add('fog-clear'); // the fog clears first (secret / throne) …
        later(function () { ov.classList.add('draw'); }, t.drawAt); // … then the pen draws the leg
        later(function () { ov.classList.add('lit'); }, t.glowAt); // the new place glows, its name fades in
        later(function () { ov.classList.add('ready'); talkStep(); }, t.hintAt); // the hint (2026-11-20: or the advisor's first line)
      });
    }
    routeArtReady(go, end, 1200);
  }
  // 2026-11-20 流程: the first time the map opens (this player, any run) the advisor explains the road ahead — 3 short lines in her
  // voice (text ui.route.talk.<advisor>.1–3, default set when she is someone else / gone). null = already heard (or no advisor).
  var ROUTE_TALK_KEY = 'chooser.routeTalk.v1' + (STUB ? '.stub' : '') + PSUF, ROUTE_TALK_ADV = { audrey: 1, lucienne: 1, nicota: 1 };
  function routeTalkOnce() {
    if (lsGet(ROUTE_TALK_KEY, null) || !run || !view || !view.advisor || view.advisor.present === false) return null;
    lsSet(ROUTE_TALK_KEY, 1);
    var id = ROUTE_TALK_ADV[run.advisor] ? run.advisor : 'default';
    return { name: view.advisor.name || '', lines: [1, 2, 3].map(function (i) { return T('ui.route.talk.' + id + '.' + i); }) };
  }
  // 2026-11-20 流程: the place card — a full-screen title (the place's name only; text from ui.place.*, never in the art) on the
  // way into a new place: 「篝火营地」 when a night opens, the level's place after the map. Under the map overlay when one is
  // fading out (the map opens onto it). A tap skips; done() renders the place under it as it fades.
  var PLACE_CARD_MS = 1500, PLACE_KEY = 'chooser.place.v1' + (STUB ? '.stub' : '') + PSUF;
  function placeName(lv) { var n = A.ROUTE_NODES.filter(function (x) { return x.level === lv; })[0]; return n ? T('ui.place.' + n.key) : routeTitle(lv); }
  function placeCard(name, done) {
    var el = document.createElement('div'), fin = false, tm = 0;
    el.className = 'place-card'; el.innerHTML = '<div class="pc-in"><i class="pc-rule"></i><b class="pc-name">' + esc(name) + '</b><i class="pc-rule"></i></div>';
    var under = stageEl.querySelector('.route-ov.v2.anim, .route-ov.anim');
    if (under) stageEl.insertBefore(el, under); else stageEl.appendChild(el);
    function end() { if (fin) return; fin = true; clearTimeout(tm); done(); el.classList.add('out'); setTimeout(function () { el.remove(); }, REDUCED ? 0 : 520); }
    el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); end(); });
    requestAnimationFrame(function () { el.classList.add('on'); });
    tm = setTimeout(end, REDUCED ? 900 : PLACE_CARD_MS + (under ? ROUTE_ENTER_MS : 0));
  }
  // a night opens (not the first formation at the guild, not 快速模式): 「篝火营地」 once per level, then the campfire
  function placeMaybe(v) {
    if (!run || QUICK || !run.camp || run.camp.first || run.camp.march) return false;
    var lv = v.level | 0, rec = lsGet(PLACE_KEY, null);
    if (rec && rec.seed === run.seed && (rec.level | 0) >= lv) return false;
    lsSet(PLACE_KEY, { seed: run.seed, level: lv });
    vnClear(); app.innerHTML = ''; screenKey = null; route.busy = true;
    placeCard(T('ui.place.camp'), function () { route.busy = false; render(); });
    blackOffSoon();
    return true;
  }
  // 2026-11-19 用户亲测 界面: the tap opens into the new place — the board grows from that place (transform-origin = the node) and
  // fades, the hint goes first, the campfire (already rendered under it) fades in. CSS: .route-ov.v2.enter
  function routeEnterOpen(ov, lv) {
    var b = ov.querySelector('.rm2-board'), n = A.ROUTE_NODES.filter(function (x) { return x.level === lv; })[0];
    if (b && n) b.style.transformOrigin = (n.x * 100).toFixed(2) + '% ' + (n.y * 100).toFixed(2) + '%';
    ov.classList.add('enter'); app.classList.add('scene-in');
    setTimeout(function () { app.classList.remove('scene-in'); }, ROUTE_ENTER_MS + 100);
    setTimeout(function () { ov.remove(); }, ROUTE_ENTER_MS);
  }
  // 2026-11-19 路线图 v2: the map at the campfire (☰ side button): visited places in calm ink, the current one glowing, no marker
  function routeOpen2() {
    if (!ROUTE_MAP || !run || !view) return;
    var at = view.level | 0, here = A.ROUTE_NODES.filter(function (n) { return n.level === at; })[0], up = routeUpright();
    hideTip(); modalEl.innerHTML = '<div class="route-ov v2 static' + (up ? ' upright' : '') + '">' + routeBoard2(at, { focus: here ? here.x : 0.5, upright: up }) +
      '<button class="rm2-close" data-act="routeClose" aria-label="' + T('ui.route.close') + '"></button></div>';
    modalEl.hidden = false; modalEl.classList.add('route-open', 'vn-pass');
    var ov = modalEl.querySelector('.route-ov'); if (!ov) return;
    ov.addEventListener('click', function (e) { if (e.target === ov || (e.target.closest && e.target.closest('.rm2-board'))) closeModal(); }); // a tap anywhere closes it
    routeArtReady(function () { if (ov.isConnected) requestAnimationFrame(function () { ov.classList.add('on'); }); }, function () { if (ov.isConnected) closeModal(); }, 1200);
  }

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
  // 2026-11-20 幸运 (engine LUCK_STAT): the clover + the number on the card, only when > 0; the words live in the tip (i18n)
  var LUCK_UI = true;
  function luckBadge(n) { if (!LUCK_UI || !(n > 0)) return ''; return '<span class="luck-badge" data-tip="' + esc(T('ui.glyph.tip.luck', { n: n, tip: termTip('luck') })) + '">' + A.glyph('luck', false) + '<b class="luck-n">' + esc(n) + '</b></span>'; }
  // a lucky action (engine entry.lucky): the clover pops over her card with 「好运一击！」 and a twinkle — once per action
  function powText(e) {
    var sg = function (n) { return (n > 0 ? '+' : '') + n; }, ps = POW_SOURCE && e.parts ? e.parts.filter(function (p) { return p && p.amount; }) : [];
    if (!ps.length) return T('ui.battle.powFloat', { d: sg(e.delta) });
    var rest = e.delta - ps.reduce(function (s, p) { return s + p.amount; }, 0);
    // 2026-11-20 用户「怀表第二轮不是威力 −2，应该是怀表效果消失」(全部都改): a bonus that ended says so instead of a minus
    return ps.map(function (p) { return (p.label ? p.label + ' ' : '') + (p.gone ? T('ui.battle.powGone') : T('ui.battle.powFloat', { d: sg(p.amount) })); }).concat(rest ? [T('ui.battle.powFloat', { d: sg(rest) })] : []).join('\n'); // 2026-11-20 用户「高昂 / 怀表不要横着一排，竖着列表」: one source a line (was ' · ')
  }
  function luckyMark(a) {
    if (!LUCK_UI || !a || !a.lucky || a._luckShown || anim.skip) return; a._luckShown = true;
    var el = cardEl(a.actor) || cardById(a.actorId); if (!el) return;
    var p = stagePt(el, 0.5, 0.3), d = fxDiv('float lucky-fx', '<small>' + esc(T('ui.battle.lucky')) + '</small>' + A.glyph('luck', false), p.x, p.y);
    cue('giggle', null, 0); pulse(el, 'lucky', 700);
    setTimeout(function () { d.remove(); }, 1600 / Math.min(1, spd()));
  }
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
  function battleCard(u, hp, hidden, blk, chg) {
    var art = unitArt(u), m = u.side === 'ally' ? member(u.id) : null, pct = u.maxHp ? Math.max(0, Math.round(100 * hp / u.maxHp)) : 100;
    var turned = u.side === 'ally' && isTurned(u);
    var cls = 'ucard bcard ' + (u.side === 'ally' ? 'ally' : 'foe') + (isLeader(u) ? ' is-leader' : '') + (u.boss ? ' is-boss' : '') + (u.ward && hp > 0 ? ' warded' : '') + (u.grazeOn && hp > 0 ? ' graze-on' : '') /* 2026-11-23 用户「灵体状态要带蓝边」 */ + (A.isFairy(u.id) ? ' is-fairy' : '') + (turned ? ' turned' : u.corruption ? ' corrupt-' + u.corruption : '') +
      (hp <= 0 ? ' down' : '') + (hidden ? ' pre-enter' : '') + (u.side === 'ally' && hasBad(u.statuses) ? ' cursed' : '');
    return '<div class="' + cls + '" data-u="' + esc(u.uid) + '" data-id="' + esc(u.id) + '" data-rich="' + esc(unitTip(u, u.side)) + '">' +
      '<div class="uc-art">' + pic(art.list, 'uc-img', u.name, art.fb) + (u.role ? roleBadge(u.role, 'uc-role') : '') + luckBadge(u.luck) + (m ? (CARD_POWER_TOP ? '' : moodFace(m)) + bondMark(m) : '') + (CARD_POWER_TOP && !turned ? powChip(cardPow(u, m), 'top', POWER_LIVE_UI ? u.powBase : null, POWER_LIVE_UI ? u.powParts : null) /* 2026-11-24 用户「战斗中移到威力上还是旧的 tooltip」: the source lines always ride along */ : '') + (u.corruption && !turned ? '<span class="corrupt-mark"></span>' : '') + (u.side === 'ally' ? debtDots(u.id) : '') + infoBtn(u.uid, u.id) + '</div>' +
      '<div class="uc-body">' + (u.side === 'ally' && !turned && !CARD_POWER_TOP ? powChip(u.atk != null ? u.atk : (m || {}).atk) : '') + '<div class="uc-name">' + esc(u.name || T('ui.name.you')) + '</div><div class="hpn">' + Math.max(0, hp) + ' / ' + esc(u.maxHp) + '</div>' +
      '<div class="hpwrap"><div class="hpbar' + (blk > 0 ? ' has-block' : '') + '"><div class="lag" style="width:' + pct + '%"></div><div class="fill" style="width:' + pct + '%"></div></div>' + blockBadge(blk) + '</div>' + chargeBar(u, chg) +
      '<div class="uc-chips st-row">' + statusIcons(u.statuses, u.side) + '</div></div>' + comboTab(u) + '</div>';
  }
  // 2026-11-19 用户亲测 界面: 威力 on our battle card — the power glyph + the number, small, top right of the name strip (tip = what it is)
  // 2026-11-20b POWER_LIVE_UI: what the chip shows — the round's start value (ui.powStart, walked back from this round's 'pow' events), else u.pow
  function cardPow(u, m) {
    if (POWER_LIVE_UI && u.pow != null) return ui.powStart && ui.powStart[u.uid] != null ? ui.powStart[u.uid] : u.pow;
    return u.atk != null ? u.atk : (m || {}).atk;
  }
  function powTone(n, base) { return base == null || n == null || n === base ? '' : n > base ? ' pow-up' : ' pow-down'; }
  // 2026-11-24 用户「威力被调高变绿、调低变红；移过去要一行一个写出是哪些东西让它增加 / 减少」: the chip's rich tip
  function powRich(n, base, parts) { // 2026-11-24b 用户「不需要总体计算，只要威力 +/− 的明细，一行一个」: the usual sentence, then one line per source
    if (!parts || !parts.length) return '';
    return '<div>' + esc(T('ui.card.powerTip', { n: n })) + '</div>' +
      parts.map(function (p) { return '<div class="sp-row ' + (p.amount > 0 ? 'up' : 'down') + '">' + (p.amount > 0 ? '+' : '−') + Math.abs(p.amount) + ' ' + esc(p.label) + '</div>'; }).join('');
  }
  function setPow(uid, n, base, bump, parts) {
    var el = cardEl(uid), c = el && el.querySelector('.uc-pow-top'); if (!c || n == null) return;
    var b = c.querySelector('b'); if (b) b.textContent = n;
    c.classList.remove('pow-up', 'pow-down'); var tn = powTone(n, base); if (tn) c.classList.add(tn.trim());
    c.dataset.tip = T('ui.card.powerTip', { n: n });
    if (parts) { var rh = powRich(n, base, parts); if (rh) c.dataset.rich = rh; else delete c.dataset.rich; }
    if (bump && !REDUCED) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  }
  function powChip(n, top, base, parts) { if (!CARD_POWER || n == null) return ''; var rh = powRich(n, base, parts); return '<span class="uc-pow' + (top ? ' uc-pow-top' : '') + powTone(n, base) + '" data-tip="' + esc(T('ui.card.powerTip', { n: n })) + '"' + (rh ? ' data-rich="' + esc(rh) + '"' : '') + '>' + A.glyph('power', false) + '<b>' + esc(n) + '</b></span>'; }
  // ===== v2.3 battle §D1: statuses as small icons, ×N when stacked; hover = name + effect =====
  var ST_GLYPH = lazy(function () { var o = {}; ['formation', 'clause', 'luck', 'overtime', 'luckUp', 'smoke', 'drum', 'slow-start', 'mood-low', 'debuffed', 'burn', 'sear', 'bless'].forEach(function (k) { o[k] = T('ui.status.glyph.' + k); }); return o; }); // 2026-11-19 文字修: + sear (焚痕)
  var ST_SVG = { overtime: 'charge', luckUp: 'luck', /* 2026-11-20 BOSS_NEW_SKILLS: reuse the 充能 / 幸运 glyphs */ 'swap-skip': 'daze', /* 2026-11-19 换位/暂停连做: the 发呆 glyph, no letters; the name + tip come from keywords.status */ ward: 'cover', weak: 'weak', tough: 'tough', shell: 'block', 'slow-start': 'daze', daze: 'daze', ambush: 'bonus', assist: 'bonus', charge: 'charge', store: 'store', escort: 'cover', doubleCut: 'bonus', twinShot: 'power', 'foe-lv2': 'level', 'foe-lv3': 'level', 'foe-lv4': 'level' }; // 2026-11-14: code-drawn glyphs (no art file)
  var ST_FILE = { 'mood-low': 'mood-down', 'mood-high': 'mood-up', 'vengeful-high': 'vengeful', 'vengeful-low': 'vengeful', wound: 'wounded', sear: 'burn' }; // 2026-11-19 文字修: 焚痕 reuses the 灼烧 art
  // 2026-11-16 灼烧 / 祝福 names come from ST_LABEL() above (a second `var ST_LABEL = {…}` here once replaced that lazy
  // function for the whole file → isBadStatus threw 「ST_LABEL is not a function」 on every battle render = the L10 hang)
  // 2026-11-20 用户「所有的标记状态 symbol，禁止使用汉字」: a status with no art / glyph falls back to a plain dot, never her name's first character
  function stNoHan(c) { return /[\u3400-\u9fff]/.test(c || '') ? '•' : c; }
  // 2026-11-20 铜钟倒数 (tollIn): a bell drawn in shapes + the rounds left as a digit ('!' = this round)
  var BELL_SVG = '<svg class="st-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-3.6 0-6 2.8-6 6.4v4.4L4 17h16l-2-3.2V9.4C18 5.8 15.6 3 12 3z" fill="#e8b860" stroke="#5a3a10" stroke-width="1.3"/><circle cx="12" cy="19.6" r="2" fill="#e8b860" stroke="#5a3a10" stroke-width="1.1"/></svg>';
  // 2026-11-20 分裂史莱姆: the new pieces were display:none (no room taken) — now they take their place and every other card in
  // the lane slides from where it stood to its new spot (FLIP), at the split beat and not before. SPLIT_NO_ROOM false = old
  var SPLIT_NO_ROOM = true;
  var FOE_CARD_SHRINK = false; // 2026-11-20 用户「单位变多时卡片宽度变化——要保持宽度，这个不能变」: enemy cards keep their width however many (true = the old 6+ / 8+ shrink)
  function splitSlide(units, olds) { // olds: uids of fallen cards the new ones replace in place (BROOD_REPLACE) — removed at this beat
    var cs = units.map(function (u) { return cardEl(u.uid); }).filter(Boolean); if (!cs.length) return;
    var lane = cs[0].parentNode; if (!lane) return;
    var gone = (olds || []).map(function (id) { return cardEl(id); }).filter(Boolean);
    var sibs = Array.prototype.filter.call(lane.children, function (x) { return cs.indexOf(x) < 0 && gone.indexOf(x) < 0 && !x.classList.contains('pre-split'); });
    var before = sibs.map(function (x) { return stagePt(x, 0, 0).x; }); // stage px (the stage is scaled)
    gone.forEach(function (g) { g.remove(); });
    cs.forEach(function (c) { c.classList.remove('pre-split'); });
    if (REDUCED || anim.skip) return;
    sibs.forEach(function (x, i) {
      var dx = before[i] - stagePt(x, 0, 0).x; if (!dx || !x.animate) return;
      x.animate([{ transform: 'translateX(' + dx.toFixed(1) + 'px)' }, { transform: 'none' }], { duration: dur(420), easing: 'cubic-bezier(.3,0,.2,1)' });
    });
  }
  function statusIcons(list, side) {
    var seen = {}, order = [];
    (list || []).map(stObj).forEach(function (o) {
      if (!o || ST_HIDE[o.id] || (side === 'enemy' && ST_BAD[o.id] && !ST_OURS[o.id])) return; // 2026-11-24 用户「灼烧还是没显示在对方的状态栏里」: the card icons skipped ST_OURS (only the tip had it)
      var n = +(o.stacks || o.n || o.count || 1);
      if (seen[o.id]) seen[o.id].n += n; else { seen[o.id] = { o: o, n: n }; order.push(o.id); }
    });
    return order.map(function (id) {
      var s = seen[id], o = s.o, name = o.label || o.name || ST_LABEL()[id] || id, bad = isBadStatus(o);
      var tip = name + (s.n > 1 ? ' ×' + s.n : '') + (o.tip || o.text ? '：' + (o.tip || o.text) : '');
      return '<span class="st-ic ' + (bad ? 'bad' : 'buff') + '" data-st="' + esc(id) + '" data-tip="' + esc(tip) + '">' +
        (id === 'tollIn' ? BELL_SVG : ST_SVG[id] ? A.glyph(ST_SVG[id], false) : pic([A.ver('../art/cells/status/' + (ST_FILE[id] || id) + '.png')], 'st-img', '', '<i class="st-g">' + esc(ST_GLYPH()[id] || stNoHan(name.slice(0, 1))) + '</i>')) +
        (o.num != null ? '<b class="st-n">' + (o.num > 0 ? esc(o.num) : '!') + '</b>' : o.plus > 0 ? '<b class="st-n st-plus">+' + o.plus + '</b>' : s.n > 1 ? '<b class="st-n">×' + s.n + '</b>' : '') + '</span>'; // 充能 / 蓄能: the icon + its number
    }).join('');
  }
  // ===== v2.3 battle §D2: combo arrow tab on the side of the neighbour her bonus reaches =====
  // comboDir(u|member) → 'prev' (left) | 'next' (right) | 'both' | null. comboTab(u) returns the tab HTML; ui-screens may call
  // comboTab(member) on prep cards too (the card needs position:relative; the tab sits on its left / right edge).
  function comboDir(u) {
    if (!u) return null;
    var mm = u.side === 'ally' || !u.side ? member(u.id) || {} : {}, c = u.combo || mm.combo, d = u.chargeDir || mm.chargeDir || (c && c.direction); // 2026-11-24 用户「莉珂戴了转向指环，布阵 / 战斗页左右都显示 +4」: chargeDir (after the ring) before the raw combo
    if (d === 'prev' || d === 'next' || d === 'both') return d;
    var t = u.bonusText || ''; var has = function (k) { return new RegExp(T(k)).test(t); }; return has('ui.combo.dirBothRe') ? 'both' : has('ui.combo.dirPrevRe') ? 'prev' : has('ui.combo.dirNextRe') ? 'next' : null;
  }
  function termTip(id) { var t = RD && RD.keywords && RD.keywords.terms && RD.keywords.terms[id]; return (t && t.tip) || ''; } // SPEC-11-13 F: 加成 / 连击 / 击杀播报
  function comboTab(u) {
    var d = comboDir(u); if (!d) return '';
    var tip = T(u.comboName ? (u.bonusText ? 'ui.combo.tipNamedText' : 'ui.combo.tipNamed') : (u.bonusText ? 'ui.combo.tipText' : 'ui.combo.tip'), { name: u.comboName, text: u.bonusText ? A.stripIcons(u.bonusText) : u.bonusText }); /* 2026-11-20: plain tip, {k:bonus} → 充能 */ // SPEC-11-13 F
    // v2.4 [12]: bigger tabs with the chance; the left tab sits high, the right one low, so a 'both' pair never lines up
    var pc = comboK(u), pt = pc != null ? '<b class="ct-p">+' + pc + '</b>' : '';
    return (d !== 'next' ? '<span class="combo-tab ct-l" data-tip="' + esc(tip) + '"><i class="ct-a">◀</i>' + pt + '</span>' : '') + (d !== 'prev' ? '<span class="combo-tab ct-r" data-tip="' + esc(tip) + '"><i class="ct-a">▶</i>' + pt + '</span>' : '');
  }
  function comboK(u) { // 充能 k per action (the engine folds in bond / mood / 战鼓 / 好运); else read it off the text
    if (u.k != null) return u.k;
    var c = u.combo || (u.side === 'ally' || !u.side ? (member(u.id) || {}).combo : null);
    return c && c.charge != null ? c.charge : null;
  }
  // DESIGN-2026-11-15-charge §4: a 10-segment 充能 bar under her hp (a part-filled segment for the fraction). Ours always;
  // an enemy only when she gives charge (a returned girl with a combo). Its tip says the exact k, the direction and the decay.
  function chargeBar(u, chg) {
    if (u.chargeFull == null || (u.side !== 'ally' && !u.chargeDir)) return '';
    var full = u.chargeFull, c = Math.max(0, chg != null ? chg : u.charge || 0), segs = '';
    for (var i = 0; i < full; i++) segs += '<i class="chg-seg"><b style="width:' + Math.round(Math.max(0, Math.min(1, c - i)) * 100) + '%"></b></i>';
    var tip = T('ui.battle.chargeTip', { n: Math.floor(c), full: full }) + (u.bonusText ? T('ui.battle.chargeTipGive', { text: A.stripIcons(u.bonusText) }) : u.k > 0 ? T(u.chargeDir === 'all' ? 'ui.battle.chargeTipAll' : 'ui.battle.chargeTipBoth', { k: u.k }) : '') + (u.store > 0 ? T('ui.battle.chargeTipStore', { n: u.store }) : '');
    return '<div class="chg-bar' + (c >= full ? ' full' : '') + '" data-tip="' + esc(tip) + '" data-full="' + full + '">' + segs + '</div>';
  }
  function setCharge(uid, val) {
    var el = cardEl(uid), f = ui.field && ui.field[uid]; if (f) f.charge = Math.max(0, val);
    var bar = el && el.querySelector('.chg-bar'); if (!bar) return;
    var full = +bar.dataset.full || 10, bs = bar.querySelectorAll('.chg-seg b');
    for (var i = 0; i < bs.length; i++) bs[i].style.width = Math.round(Math.max(0, Math.min(1, val - i)) * 100) + '%';
    bar.classList.toggle('full', val >= full);
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
  // 2026-11-24 用户「加护甲飘出来的 +3 和名字偏左很远、数字没居中——要从人物卡片上放」: from the card's own top centre (was 70px left); .float text-align centre
  function blkAnchor(el) { return el; }
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
    battleLog().forEach(function (e) { if (e && e.kind === 'enemyEnter' && e.unit) m[e.unit.uid || e.uid] = { name: e.unit.name }; if (e && e.kind === 'summon') (e.units || []).forEach(function (u) { m[u.uid] = { name: u.name }; }); });
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
  var ACTING_TIP = false; // 2026-11-24 用户「出手时卡片上挂的『怎么算』提示（威力 6 ＋ 心情高昂 1 ＝ 7）删掉」 (true = the v39 breakdown tip)
  function actingTip(el, a) { var h = tagSettle(a); if (!ACTING_TIP) return; if (!el || !h) return; if (el.dataset.richOwn == null) el.dataset.richOwn = el.dataset.rich || ''; el.dataset.rich = h; }
  function actingTipOff(el) { if (!el || el.dataset.richOwn == null) return; el.dataset.rich = el.dataset.richOwn; delete el.dataset.richOwn; if (tipFor === el) hideTip(); }
  function battleLogHtml() {
    var rounds = RoundPlan.battleReport(battleLog(), settleUnits());
    var body = rounds.length ? rounds.map(function (g) {
      return '<section class="sl-round"><h3>' + (g.round > 0 ? T('ui.settle.round', { n: esc(g.round) }) : T('ui.settle.roundOpen')) /* 2026-11-19 试玩修 界面: no 「第 0 回合」 — what happens before round 1 is 「开场」 */ + '</h3>' + g.items.map(function (it) {
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
  var SKILL_TAG_ON_CARD = false; // 2026-11-20: tried on the card; user wants the name just above her head, numbers stacked above the name (SKILL_UNDER_NUMBERS)
  var SKILL_UNDER_NUMBERS = true;
  function skillTag(el, name) {
    if (!el || !name) return; var foe = el.classList.contains('foe'), p = SKILL_TAG_ON_CARD ? stagePt(el, 0.5, 0.58) : stagePt(el, 0.5, foe ? 1 : 0);
    // 2026-11-20 用户「招式名挡住了原来的数字和分解」: the name sits ON her card (over the portrait), the space above stays for the numbers. false = old spot
    var d = fxDiv('skill-tag' + (foe ? ' foe' : '') + (SKILL_TAG_ON_CARD ? ' on-card' : ''), '「' + esc(name) + '」', p.x, SKILL_TAG_ON_CARD ? p.y : SKILL_UNDER_NUMBERS ? (foe ? p.y + 30 : p.y - 30) : foe ? p.y + 34 : p.y - 150); d.style.left = A.clampX(p.x, d.offsetWidth, STAGE_W, 12) + 'px'; // batch6 fix: the edge cards' skill name stays on the stage
    setTimeout(function () { d.remove(); }, dur(1500));
  }
  // a damage / heal number flies from a point to the target's top edge, then rises and fades there
  // 2026-11-14 伤害数字「先飞后结算」: with t (an engine hit), the number that flies is the attack's FULL amount and it resolves
  // on the target into the hp damage (RoundPlan.hitNum): 5 → 2 with a crack on the 护甲 badge, or 0 + a shield clank (no red).
  // A heal just pops on the target. Speed (dur) / skip / REDUCED: the flight and the swap shorten or happen at once.
  function flyNum(from, el, text, cls, tag, ox, t) {
    if (!el) return Promise.resolve();
    var n = t ? RoundPlan.hitNum(critFull(t)) : null, shot = ONE_HIT_NUMBER && /\bshot\b/.test(cls || '');
    if (t && !n && !text) return Promise.resolve(); // 2026-11-16: a hit that did nothing flies no 「−0」 / empty number
    var rich = t && t.exRich;
    if (n && n.heal) { floatAt(el, n.to, cls, tag, ox, rich); return Promise.resolve(); }
    var to = stagePt(el, 0.5, 0); to = { x: to.x + (ox || 0), y: to.y + (/\b(crit|multi)\b/.test(cls || '') ? 60 : -26) };
    var d = fxDiv('flynum hitnum ' + (cls || ''), esc(n ? n.from : text), from.x, from.y); tipNum(d, rich);
    // 2026-11-20 the hunter's shot: the number rides the arrow — straight and fast — then pops on the target
    return flyTo(d, from, to, shot ? 170 : 420, shot ? 0 : (to.x > from.x ? 1 : -1) * 90).then(function () {
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
      if (bd) pulse(bd, 'crack', 420);
      if (n.clank) { cue('guard', null, 0); d.remove(); return; } // 2026-11-15 user: all on 护甲, no hp lost → no 「0」 / 「−0」, just the shield cracking + clank
      var rv = d.querySelector('.rv'); if (rv) rv.textContent = n.to;
      d.classList.add('resolved');
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
      var bFull = critFull(b.t); if (bFull && bFull !== b.t) b.amount = bFull.amount; // 2026-11-20 ONE_HIT_NUMBER: a crit's whole number
      if (b.amount > 0) floatAt(el, '−' + b.amount, 'dmg multi' /* 2026-11-15 user: a hit that only hit 护甲 shows no 「−0」 — the shield cracks instead */ + (b.crit ? ' crit' : ''), b.crit ? (b.t && b.t.jackpot ? T('ui.battle.jackpot') : critOverTag(b.t) || (b.t && b.t.pierce ? T('ui.battle.critPierce') : T('ui.battle.crit'))) : T('ui.battle.hitNo', { n: i + 1 }), 0, b.t && b.t.exRich);
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
  // 2026-11-20 用户「三杀四杀五杀从未出现过——一次行动死了这么多（不一定是一个人打的）」(KILLCALL_CHAIN): one banner for the whole
  // chain / volley — every foe our side downed in it, whoever did it; the happy line is the one who downed the most. false = per action
  var KILLCALL_CHAIN = true, KC_WORD = { 2: 'engine.battle.killCall.2', 3: 'engine.battle.killCall.3', 4: 'engine.battle.killCall.4', 5: 'engine.battle.killCall.5' };
  async function killCalls(acts, lines, tok) {
    if (KILLCALL_CHAIN) {
      var downed = {}, best = null, bestN = 0;
      acts.forEach(function (a) {
        if (!a || a.side !== 'ally') return;
        var mine = 0;
        (a.targets || []).forEach(function (t) { if (t && t.kind === 'damage' && !t.miss && t.hpAfter <= 0 && (t.amount > 0 || t.graze) && !downed[t.uid]) { downed[t.uid] = 1; mine++; } });
        if (mine > bestN) { bestN = mine; best = a; }
      });
      var n = Object.keys(downed).length; if (n < 2) return;
      pl('event', 'killCall', { n: n, chain: acts.length, skip: !!anim.skip });
      cue('combo', { depth: Math.min(4, n + 1) }, 0);
      var d0 = fxDiv('banner killcall lv-' + Math.min(n, 5), '<span class="fx-word">' + esc(T(KC_WORD[Math.min(n, 5)])) + '</span>', 960, 470);
      setTimeout(function () { d0.remove(); }, REDUCED ? 900 : 1700);
      if (n >= 3) pulse(app.querySelector('.battle'), 'quake', 500);
      await wait(900, tok);
      var ln0 = best && lines.filter(function (l) { return l.uid === best.actor; })[0];
      if (ln0 && !QUICK) await playOne(ln0, tok);
      return;
    }
    for (var i = 0; i < acts.length; i++) {
      var kc = acts[i].killCall; if (!kc) continue;
      pl('event', 'killCall', { n: kc.n, actor: acts[i].actor, round: acts[i].round, skip: !!anim.skip }); // 2026-11-20 用户「双杀三杀从来没出现过」: did the banner get here?
      cue('combo', { depth: Math.min(4, kc.n + 1) }, 0);
      var d = fxDiv('banner killcall lv-' + Math.min(kc.n, 5), '<span class="fx-word">' + esc(kc.word) + '</span>' + (kc.sub ? '<small>' + esc(kc.sub) + '</small>' : ''), 960, 470);
      setTimeout(function (x) { return function () { x.remove(); }; }(d), REDUCED ? 900 : 1700);
      if (kc.n >= 3) pulse(app.querySelector('.battle'), 'quake', 500);
      await wait(900, tok);
      var ln = lines.filter(function (l) { return l.uid === acts[i].actor; })[0];
      if (ln && !QUICK) await playOne(ln, tok);
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
  function softMark(actorEl, targetEl) { if (actorEl) { pulse(actorEl, 'soft', 1600); floatAt(actorEl, T('ui.battle.softHeart'), 'soft'); } if (targetEl) floatAt(targetEl, T('ui.battle.softHeart'), 'miss'); /* 2026-11-22g 试玩7 #12: was ui.battle.miss 「落空」 — a 心软 hit is not a miss rule */ cue('miss'); }
  // v36 (试玩者 1)「连携数字分开、卡片轮流上移」: one beat per actor (RoundPlan.actionBeats). Her card rises, her own charge is built
  // over HER card (base, then each bonus flies in — the chain's 「加成」 from the girl who brought her in), the charge bursts and her
  // numbers fly to every target of her action (splash targets too, with a small 「波及」 tag), resolve there (先飞后结算), the hits
  // land, she settles, then the next chained girl rises. ×2 / ×3 shorten every wait; skip / reduced motion = instant results.
  async function settleCard(el, tok) { await wait(RoundPlan.RISE.hold, tok); if (el) el.classList.remove('acting'); await wait(RoundPlan.RISE.down, tok); } // v36: the actor settles back
  // ===== 2026-11-20 BONUS_STACK: the bonus stack (rows → hold → merge → one number flies), from ui/dev/mockup-bonus-v5.html =====
  // Pure timing / rows / grouping live in RoundPlan (stackGap, stackRows, collapseRows, stackTotals, sumHits, volleyShots);
  // here only the drawing. The hits themselves still land through impacts() with the engine's own amounts and hp.
  // Icons are pure shapes (no letters).
  var BS_ICON = {
    moodHigh: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.4-9.3C1.2 8.2 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.8 3.7 4.4 7.2C19.5 16.4 12 21 12 21z" fill="#ff7a9a" stroke="#5a1020" stroke-width="1.2"/></svg>',
    pocketWatch: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="#f1d79a" stroke="#5a3a10" stroke-width="1.4"/><path d="M12 13V8.5M12 13l3 2" stroke="#3b2a1c" stroke-width="1.8" stroke-linecap="round"/><path d="M10 3h4" stroke="#c9a46a" stroke-width="2.4" stroke-linecap="round"/></svg>',
    holySpring: '<svg viewBox="0 0 24 24"><path d="M12 2c4 6 7 9 7 13a7 7 0 0 1-14 0c0-4 3-7 7-13z" fill="#6ab0ff" stroke="#1a3a6a" stroke-width="1.2"/><path d="M9 15a3 3 0 0 0 3 3" stroke="#e0f0ff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
    warHorn: '<svg viewBox="0 0 24 24"><path d="M3 10v4l3 1 12 5V4L6 9z" fill="#c9a46a" stroke="#5a3a10" stroke-width="1.2" stroke-linejoin="round"/><path d="M18 4c2 2 3 5 3 8s-1 6-3 8" fill="none" stroke="#5a3a10" stroke-width="1.4"/></svg>', // 2026-11-22 遗物 号角
    hunterMark: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#e05a4a" stroke-width="2.2"/><circle cx="12" cy="12" r="3" fill="#e05a4a"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#5a1a10" stroke-width="1.6"/></svg>', // 2026-11-22 遗物 猎人记号
    hawkEye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="#fff" stroke="#2a4a6a" stroke-width="1.4"/><circle cx="12" cy="12" r="3.6" fill="#3a8ad8"/><circle cx="12" cy="12" r="1.5" fill="#0a1a2a"/></svg>',
    bladeStorm: '<svg viewBox="0 0 24 24" fill="none" stroke="#9ad8ff" stroke-width="2.2" stroke-linecap="round"><path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 18h7"/></svg>',
    shieldWall: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#6a8ac8" stroke="#1a2a4a" stroke-width="1.2"/><path d="M12 5v14" stroke="#c8d8ff" stroke-width="1.6"/></svg>',
    crisisLeader: '<svg viewBox="0 0 24 24"><path d="M5 22V3" stroke="#c9a46a" stroke-width="2.2" stroke-linecap="round"/><path d="M6 4h12l-3 4 3 4H6z" fill="#cf4f66" stroke="#5a1020" stroke-width="1"/></svg>',
    oldMaster: '<svg viewBox="0 0 24 24"><path d="M4 20l3-3m-1.5-1.5L14 7l3-3 3 0 0 3-3 3-8.5 8.5z" fill="#e8dcc8" stroke="#3b2a1c" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 15l4 4" stroke="#c9a46a" stroke-width="2.4" stroke-linecap="round"/></svg>',
    bless: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffe08a" stroke="#8a6a10"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2" stroke="#ffe08a" stroke-width="2" stroke-linecap="round"/></svg>',
    formation: '<svg viewBox="0 0 24 24" fill="#c8b0a0" stroke="#3a2a1c" stroke-width="1"><path d="M3 7l3-3 3 3v12H3z"/><path d="M10.5 7l3-3 3 3v12h-6z"/><path d="M18 7l3-3 0 0v15h-3z"/></svg>',
    ramp: '<svg viewBox="0 0 24 24"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" fill="#ff6a2a" stroke="#6a1a00" stroke-width="1"/><path d="M12 13c1 1.5 2.5 2.5 2.5 4.5a2.5 2.5 0 0 1-5 0c0-1.5 1-2.5 2.5-4.5z" fill="#ffd24a"/></svg>',
    vigil: '<svg viewBox="0 0 24 24"><path d="M8 6h8l1 3H7z" fill="#c9a46a" stroke="#5a3a10"/><path d="M7 9h10v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" fill="#ffe08a" stroke="#5a3a10"/><circle cx="12" cy="14" r="2.4" fill="#ff9a3a"/></svg>',
    chain: '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round"><rect x="2" y="8" width="11" height="8" rx="4" stroke="#c8b0ff" stroke-width="2.4"/><rect x="11" y="8" width="11" height="8" rx="4" stroke="#e0d0ff" stroke-width="2.4"/></svg>',
    crit: '<svg viewBox="0 0 24 24"><path d="M12 1l2.6 7.2L22 7l-5.2 5.4L21 19l-7-2.4L12 23l-2-6.4L3 19l4.2-6.6L2 7l7.4 1.2z" fill="#ffcf4a" stroke="#8a3a00" stroke-width="1"/></svg>',
    lucky: '<svg viewBox="0 0 24 24"><g fill="#6fe08a" stroke="#14501f" stroke-width="1"><circle cx="12" cy="7" r="4.2"/><circle cx="7" cy="12" r="4.2"/><circle cx="17" cy="12" r="4.2"/><circle cx="12" cy="17" r="4.2"/></g><circle cx="12" cy="12" r="2" fill="#c8ffd0"/></svg>',
    burst: '<svg viewBox="0 0 24 24" fill="#e0d0ff" stroke="#3e2470" stroke-width="1" stroke-linejoin="round"><path d="M2 6l7 6-7 6z"/><path d="M9 6l7 6-7 6z"/><path d="M16 6l7 6-7 6z"/></svg>',
    other: '<svg viewBox="0 0 24 24"><g fill="#f1d79a" stroke="#5a3a10" stroke-width=".8"><circle cx="5" cy="12" r="2.8"/><circle cx="12" cy="12" r="2.8"/><circle cx="19" cy="12" r="2.8"/></g></svg>',
    base: '<svg viewBox="0 0 24 24"><path d="M4 12l8-8 2 2-4 4h10v4H10l4 4-2 2z" fill="#f1d79a" stroke="#5a3a10" stroke-width="1"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" fill="#f1d79a" stroke="#5a3a10" stroke-width="1"/></svg>',
    weak: '<svg viewBox="0 0 24 24" fill="none" stroke="#9aa8c8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m-6-6l6 6 6-6"/></svg>'
  };
  BS_ICON.burn = BS_ICON.frenzy = BS_ICON.ramp;
  function bsIcon(k) { return '<span class="bs-ic">' + (BS_ICON[k] || BS_ICON.plus) + '</span>'; }
  function bsLabel(r) { return r.key ? T('ui.battle.stack.' + r.key) : (r.label || ''); }
  function bsOn() { return BONUS_STACK && !anim.skip && !REDUCED; }
  function bsTR(dx, dy, s) { return 'translate(-50%,-50%) translate(' + (dx || 0) + 'px,' + (dy || 0) + 'px) scale(' + (s == null ? 1 : s) + ')'; }
  function bsAnim(el, frames, ms, opt) {
    if (!el || !el.animate) return Promise.resolve();
    var o = Object.assign({ duration: dur(ms), easing: 'ease-out', fill: 'forwards' }, opt || {}); if (o.delay) o.delay = dur(o.delay);
    return el.animate(frames, o).finished.catch(function () { /* cut off */ });
  }
  function bsPop(el, ms, over) { return bsAnim(el, [{ transform: bsTR(0, 0, 0.3), opacity: 0 }, { transform: bsTR(0, 0, over || 1.18), opacity: 1, offset: 0.6 }, { transform: bsTR(0, 0, 1), opacity: 1 }], ms || 220); }
  function bsShake(el, a, ms, delay) { return bsAnim(el, [{ transform: bsTR(0, 0, 1) }, { transform: bsTR(a, -a * 0.4, 1) }, { transform: bsTR(-a, a * 0.3, 1) }, { transform: bsTR(a * 0.5, 0, 1) }, { transform: bsTR(0, 0, 1) }], ms || 160, { easing: 'linear', delay: delay || 0 }); }
  function bsJolt(el, a, ms) { if (el && el.animate) el.animate([{ translate: '0 0' }, { translate: a + 'px ' + (-a * 0.5) + 'px' }, { translate: (-a) + 'px ' + (a * 0.4) + 'px' }, { translate: (a * 0.5) + 'px 0' }, { translate: '0 0' }], { duration: dur(ms || 180), easing: 'linear' }); }
  function bsRing(x, y, color, size) {
    var r = fxDiv('bs-ring', '', x, y); if (color) { r.style.borderColor = color; r.style.boxShadow = '0 0 30px ' + color; }
    bsAnim(r, [{ transform: bsTR(0, 0, 0.4), opacity: 1 }, { transform: bsTR(0, 0, size || 5), opacity: 0 }], 420, { easing: 'cubic-bezier(.2,.7,.3,1)' }).then(function () { r.remove(); });
  }
  function bsHitNum(t) { return RoundPlan.hitNum(critFull(t)); }
  // a shot = one girl's stack: { el, foe, base, rows, hits: RoundPlan.sumHits(...) }
  function bsShot(acts, el, foe, n) {
    var a = acts[0];
    return { el: el, foe: foe, base: a.base || 0, rows: RoundPlan.stackRows(a, n || 1), hits: RoundPlan.sumHits(acts, bsHitNum) };
  }
  // every shot builds its stack at the same time (rows end-aligned: the last rows land on one beat), holds, merges, and all
  // the numbers fly at once and hit together (one impact: the caller lands the engine's results right after this resolves)
  async function stackPlay(shots, tok) {
    var SK = RoundPlan.STACK, slim = shots.length > 1, fs0 = slim ? 22 : 25;
    var S = shots.filter(function (o) { return o && o.el; }).map(function (o) {
      var p = stagePt(o.el, 0.5, o.foe ? 1 : 0), tot = RoundPlan.stackTotals(o.base, o.rows);
      return { o: o, tot: tot, final: tot[tot.length - 1], x: p.x, y0: p.y + (o.foe ? 26 : -18), y: p.y + (o.foe ? 26 : -18), dir: o.foe ? 1 : -1, chips: [] };
    });
    if (!S.length) return;
    function chip(s, r, i) {
      var isBase = i === 0, mul = !isBase && r.op === '×', cls = 'bs-chip' + (s.o.foe ? ' foe' : '') + (isBase ? ' base' : '') + (mul ? ' mul' : '') + (r && r.burst ? ' burst' : '') + (slim ? ' slim' : '');
      var html = isBase ? bsIcon('base') + '<span class="v">' + s.o.base + '</span><span class="l">' + esc(T('ui.battle.stack.base')) + '</span>'
        : bsIcon(r.ic) + '<span class="v">' + (r.op === '×' ? '×' + r.v : (r.v < 0 ? '−' + (-r.v) : '+' + r.v)) + '</span><span class="l">' + esc(bsLabel(r)) + '</span>';
      var c = fxDiv(cls, html, s.x, 0);
      c.style.fontSize = RoundPlan.stackRowFont(i, fs0) + 'px'; c.style.opacity = 0;
      var h = c.offsetHeight || 30; c.style.top = (s.y + s.dir * h / 2) + 'px'; s.y += s.dir * (h + 4);
      s.chips.push(c); return c;
    }
    try {
      S.forEach(function (s) { bsPop(chip(s, null, 0), 200); });
      cue('stackRow', { i: 0 }, 0);
      var L = Math.max.apply(null, S.map(function (s) { return s.o.rows.length; })), hold = L >= 2;
      for (var i = 1; i <= L; i++) {
        await wait(RoundPlan.stackGap(i - 1), tok);
        var anyMul = false;
        S.forEach(function (s) {
          var r = i - (L - s.o.rows.length); if (r < 1) return; // end-aligned
          var b = s.o.rows[r - 1], c = chip(s, b, r), mul = b.op === '×', a = 1.5 + r * 1.6, cy = parseFloat(c.style.top), d = s.dir;
          if (mul) anyMul = true;
          if (hold && i === L) { // the last row drops in with weight and settles; the rows under it give a little
            bsAnim(c, [{ transform: bsTR(0, d * 26, 1.3), opacity: 0, filter: 'brightness(2.6)' }, { transform: bsTR(0, -d * 8, 0.9), opacity: 1, filter: 'brightness(1.8)', offset: 0.4 },
              { transform: bsTR(0, d * 3, 1.05), opacity: 1, filter: 'brightness(1.2)', offset: 0.68 }, { transform: bsTR(0, -d, 0.99), opacity: 1, offset: 0.85 }, { transform: bsTR(0, 0, 1), opacity: 1, filter: 'none' }], 380, { easing: 'cubic-bezier(.3,0,.4,1)' });
            s.chips.forEach(function (u) { if (u !== c) bsAnim(u, [{ transform: bsTR(0, 0, 1) }, { transform: bsTR(0, -d * 5, 0.97), offset: 0.4 }, { transform: bsTR(0, d * 1.5, 1.01), offset: 0.7 }, { transform: bsTR(0, 0, 1) }], 300, { delay: 140 }); });
            setTimeout(function () { bsRing(s.x, cy, mul ? (s.o.foe ? '#ff4a3a' : '#ff9a4a') : '#f1d79a', mul ? 4.5 : 3); bsJolt(s.o.el, a * 1.5, 240); }, dur(150));
          } else if (mul) { // a multiplier jumps, flashes, shakes harder
            bsAnim(c, [{ transform: bsTR(0, 0, 0.3), opacity: 0, filter: 'brightness(3)' }, { transform: bsTR(0, d * 26, 1.35), opacity: 1, filter: 'brightness(2.4)', offset: 0.45 },
              { transform: bsTR(0, -d * 4, 0.95), opacity: 1, filter: 'brightness(1.3)', offset: 0.75 }, { transform: bsTR(0, 0, 1), opacity: 1, filter: 'none' }], 260);
            bsShake(c, a * 1.4, 180, 260);
            bsRing(s.x, cy, b.burst ? '#b9a0ff' : s.o.foe ? '#ff4a3a' : '#ff9a4a', slim ? 3 : 4); bsJolt(s.o.el, a * 1.2, 200);
          } else { bsPop(c, 200, 1.18 + r * 0.04); bsShake(c, a, 150, 200); bsJolt(s.o.el, a * 0.7, 160); }
        });
        cue(anyMul ? 'stackMul' : 'stackRow', { i: i }, 0); // one sound per beat, not one per girl
        if (hold && i === L) setTimeout(function () { cue('stackLand', null, 0); }, dur(130));
      }
      await wait(hold ? SK.hold : 140, tok);
      // merge (~0.3 s): the rows fall into one number that counts up and grows with final / base
      cue('stackMerge', { i: L }, 0);
      await Promise.all(S.map(function (s) {
        var my = (s.y0 + s.y) / 2, num = fxDiv('bs-big' + (s.o.foe ? ' foe' : ''), '' + s.o.base, s.x, my); s.num = num; s.my = my;
        num.style.fontSize = Math.round(RoundPlan.stackFont(1) * 1.25) + 'px';
        s.chips.forEach(function (c, j) {
          var cy = parseFloat(c.style.top); c.getAnimations().forEach(function (an) { an.cancel(); }); c.style.opacity = 1;
          bsAnim(c, [{ transform: bsTR(0, 0, 1), opacity: 1 }, { transform: bsTR(0, my - cy, 0.3), opacity: 0 }], 190, { delay: j * 14, easing: 'cubic-bezier(.6,0,.9,.5)' }).then(function () { c.remove(); });
        });
        var step = 210 / s.tot.length;
        return (async function () {
          for (var k = 0; k < s.tot.length; k++) { num.textContent = s.tot[k]; num.style.fontSize = Math.round(RoundPlan.stackFont(s.tot[k] / Math.max(1, s.o.base)) * 1.25) + 'px'; await wait(step, tok); }
          await bsAnim(num, [{ transform: bsTR(0, 0, 1.45) }, { transform: bsTR(0, 0, 1) }], 90);
        })();
      }));
      // fly (~0.27 s): one number per target (her hits on one target summed), every girl's at once
      var flies = [];
      S.forEach(function (s) {
        var gs = s.o.hits.length ? s.o.hits : [];
        if (!gs.length) { s.num.remove(); return; }
        pulse(s.o.el, 'burst-hit', 260);
        gs.forEach(function (g, j) {
          var te = cardEl(g.uid); if (!te) return;
          var el = j === 0 ? s.num : fxDiv(s.num.className, '', s.x, s.my);
          el.textContent = g.full; el.style.fontSize = Math.round(RoundPlan.stackFont(g.full / Math.max(1, s.o.base)) * 1.25) + 'px';
          var to = stagePt(te, 0.5, 0.45), dx = to.x - s.x, dy = to.y - s.my, arc = (j - (gs.length - 1) / 2) * 50 + (s.o.foe ? -30 : 30);
          flies.push({ el: el, ratio: g.full / Math.max(1, s.o.base), x: to.x, y: to.y, p: bsAnim(el, [{ transform: bsTR(0, 0, 1) }, { transform: bsTR(dx / 2 + arc, dy / 2, 1.06), offset: 0.5 }, { transform: bsTR(dx, dy, 0.9) }], 270, { easing: 'cubic-bezier(.5,0,.75,.4)' }) });
        });
        if (!s.o.hits.length || !cardEl(s.o.hits[0].uid)) s.num.remove();
      });
      await Promise.all(flies.map(function (f) { return f.p; })); chk(tok);
      // one impact: the numbers bump, one sound (×6 and up: screen shake + heavy hit)
      var heavy = flies.some(function (f) { return f.ratio >= SK.heavyRatio; });
      flies.forEach(function (f) {
        f.el.getAnimations().forEach(function (an) { an.cancel(); }); f.el.style.left = f.x + 'px'; f.el.style.top = f.y + 'px';
        bsAnim(f.el, [{ transform: bsTR(0, 0, f.ratio >= SK.heavyRatio ? 2.1 : 1.5) }, { transform: bsTR(0, 0, 0.88), offset: 0.35 }, { transform: bsTR(0, 0, 1.1), offset: 0.65 }, { transform: bsTR(0, 0, 1) }], f.ratio >= SK.heavyRatio ? 340 : 220)
          .then(function () { return bsAnim(f.el, [{ transform: bsTR(0, 0, 1), opacity: 1 }, { transform: bsTR(0, 0, 0.95), opacity: 0 }], 420, { delay: 200, easing: 'ease-in' }); }).then(function () { f.el.remove(); });
      });
      if (heavy) { cue('stackHeavy', null, 0); var sh = app.querySelector('.battle'); if (sh) pulse(sh, 'quake', 500); }
    } finally { S.forEach(function (s) { s.chips.forEach(function (c) { if (c.isConnected) c.remove(); }); }); }
  }
  // ===== 2026-11-20 BONUS_STACK_V7 (?stack=v7 only; user-approved ui/dev/mockup-bonus-v7.html) =====
  // The plate replaces ONLY the number build-up over her card (chargeUp's orb): a dark plate of WORDS grows from her card
  // (ours upward, enemies downward in red) — 「基础威力 N」, then one row per bonus, faster each row, the last row lands and holds
  // 0.5 s, the plate folds into one big number with 「合计 N」 under it. After that her attack plays EXACTLY as today (release →
  // flyNum per target with the engine's own amount, a 连击 hit by hit through comboSeq, the mage on every target, heals untouched).
  // Several plates at once (a chain, a together wave): same plate as a single attack, end-aligned so every last row lands on the
  // same beat, they hold, fold and fire together. Returns per shot an st = { at, bubble } that release() takes like chargeUp's.
  function v7On() { return (BONUS_STACK_V7 || BONUS_STACK_B1) && !anim.skip && !REDUCED; }
  function v7Tr(k, v) { return T('ui.' + k, v); }
  function v7Able(a, chain) { return !!a && RoundPlan.stackable(a) && (chain || RoundPlan.plateWords(a, 1, v7Tr).bonus); }
  var V7 = { fs: 26, min: 22, grow: 1.06, gap: 12, edge: 14, hold: 1000, show: 800 }; // hold: last row → merge; show: the merged 「合计」 before it flies
  function v7Plate(shot, fs) {
    var W = shot.W, foe = shot.foe, pl = document.createElement('div');
    pl.className = 'v7-plate' + (foe ? ' foe' : ''); pl.innerHTML = '<i class="v7-tail"></i>';
    var rows = W.rows.map(function (r, i) {
      var d = document.createElement('div'); d.className = 'v7-rw' + (r.cls ? ' ' + r.cls : '');
      d.innerHTML = '<span class="k">' + esc(r.k) + (r.sub ? '<span class="sub">（' + esc(r.sub) + '）</span>' : '') + '</span><span class="e">' + esc(r.e) + '</span>';
      d.style.fontSize = (fs * Math.pow(V7.grow, i)).toFixed(1) + 'px'; pl.appendChild(d); return d;
    });
    fxLayer.appendChild(pl);
    var w = pl.offsetWidth || 260, h = pl.offsetHeight || rows.length * 40 + 20;
    pl.style.width = w + 'px';
    rows.forEach(function (d) { d.style.display = 'none'; }); pl.style.opacity = 0;
    return { el: pl, rows: rows, w: w, h: h };
  }
  function v7Place(s, x, lift) {
    var P = s.P; P.x = x; P.el.style.left = (x - P.w / 2) + 'px';
    if (s.foe) P.el.style.top = (s.edgeY + V7.edge + (lift || 0)) + 'px';
    else { P.el.style.top = 'auto'; P.el.style.bottom = (STAGE_H - s.edgeY + V7.edge + (lift || 0)) + 'px'; }
    var tl = P.el.querySelector('.v7-tail'); if (tl) { tl.style.left = Math.max(18, Math.min(P.w - 18, s.x - (x - P.w / 2))) + 'px'; tl.style.display = lift ? 'none' : ''; }
  }
  // side by side over their own cards; neighbours that would touch fan out (the tail still points at her card); too wide for the
  // stage → all at one smaller size (never under 22 px); still too wide → every second plate climbs a level
  function v7Layout(S) {
    var m = 10, fs = V7.fs;
    function make() { S.forEach(function (s) { if (s.P) s.P.el.remove(); s.P = v7Plate(s, fs); }); }
    function width(L) { return L.reduce(function (t, s) { return t + s.P.w; }, 0) + V7.gap * Math.max(0, L.length - 1); }
    make();
    [false, true].forEach(function (foe) {
      var L = S.filter(function (s) { return s.foe === foe; }).sort(function (a, b) { return a.x - b.x; }); if (!L.length) return;
      for (var k = 0; k < 3 && width(L) > STAGE_W - 2 * m && fs > V7.min; k++) {
        fs = Math.max(V7.min, fs * (STAGE_W - 2 * m - V7.gap * (L.length - 1)) / (width(L) - V7.gap * (L.length - 1)));
        L.forEach(function (s) { s.P.el.remove(); s.P = v7Plate(s, fs); });
      }
      if (width(L) <= STAGE_W - 2 * m) {
        var left = L.map(function (s) { return s.x - s.P.w / 2; }), i, j;
        for (i = 0; i < L.length; i++) left[i] = Math.max(left[i], i ? left[i - 1] + L[i - 1].P.w + V7.gap : m);
        for (j = L.length - 1; j >= 0; j--) left[j] = Math.min(left[j], j < L.length - 1 ? left[j + 1] - V7.gap - L[j].P.w : STAGE_W - m - L[j].P.w);
        L.forEach(function (s, q) { v7Place(s, left[q] + s.P.w / 2, 0); });
      } else {
        var lowH = Math.max.apply(null, L.filter(function (s, q) { return q % 2 === 0; }).map(function (s) { return s.P.h; }));
        L.forEach(function (s, q) { v7Place(s, Math.max(m + s.P.w / 2, Math.min(STAGE_W - m - s.P.w / 2, s.x)), q % 2 ? lowH + 10 : 0); });
      }
    });
  }
  function v7PlateTime(n) { var t = 0; for (var k = 0; k < n; k++) t += RoundPlan.stackGap(k); return t; }
  function v7Show(s, i) { var r = s.P.rows[i]; if (!r) return null; r.style.display = ''; if (i === 0) s.P.el.style.opacity = 1; return r; }
  function v7RowPt(r) { var p = stagePt(r, 0.5, 0.5); return p; }
  async function v7Build(s, tok, quiet) {
    var n = s.W.rows.length - 1, hold = n >= 2, d = s.foe ? 1 : -1;
    var r0 = v7Show(s, 0); bsAnim(r0, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.08)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], 200);
    if (!quiet) cue('stackRow', { i: 0 }, 0);
    for (var i = 1; i <= n; i++) {
      await wait(RoundPlan.stackGap(i - 1), tok);
      var r = v7Show(s, i), mul = /\b(mul|burst)\b/.test(r.className), a = 1 + i * 0.8;
      if (hold && i === n) { // the last row drops in with weight, presses into the plate and settles
        if (!quiet) { cue(mul ? 'stackMul' : 'stackRow', { i: i }, 0); setTimeout(function () { cue('stackLand', null, 0); }, dur(130)); }
        bsAnim(r, [{ transform: 'translateY(' + d * 24 + 'px) scale(1.25)', opacity: 0, filter: 'brightness(2.6)' }, { transform: 'translateY(' + -d * 6 + 'px) scale(.94)', opacity: 1, filter: 'brightness(1.8)', offset: 0.4 },
          { transform: 'translateY(' + d * 2 + 'px) scale(1.03)', opacity: 1, filter: 'brightness(1.2)', offset: 0.68 }, { transform: 'none', opacity: 1, filter: 'none' }], 380, { easing: 'cubic-bezier(.3,0,.4,1)' });
        bsAnim(s.P.el, [{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(' + -d * 4 + 'px) scale(.98)', offset: 0.4 }, { transform: 'translateY(' + d + 'px) scale(1.005)', offset: 0.7 }, { transform: 'none' }], 300, { delay: 140, fill: 'none' });
        (function (r, mul, a) { setTimeout(function () { var p = v7RowPt(r); bsRing(p.x, p.y, mul ? (s.foe ? '#ff4a3a' : '#ff9a4a') : '#f1d79a', mul ? 4.5 : 3); bsJolt(s.el, a * 1.5, 240); }, dur(150)); })(r, mul, a);
      } else if (mul) {
        if (!quiet) cue('stackMul', { i: i }, 0);
        bsAnim(r, [{ transform: 'scale(.5)', opacity: 0, filter: 'brightness(3)' }, { transform: 'translateY(' + d * 8 + 'px) scale(1.16)', opacity: 1, filter: 'brightness(2.2)', offset: 0.45 },
          { transform: 'scale(.97)', opacity: 1, filter: 'brightness(1.3)', offset: 0.75 }, { transform: 'none', opacity: 1, filter: 'none' }], 260);
        var p = v7RowPt(r); bsRing(p.x, p.y, /burst/.test(r.className) ? '#b9a0ff' : s.foe ? '#ff4a3a' : '#ff9a4a', 4); bsJolt(s.el, a * 1.2, 200);
      } else {
        if (!quiet) cue('stackRow', { i: i }, 0);
        bsAnim(r, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(' + (1.08 + i * 0.02) + ')', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], 200);
        bsJolt(s.el, a * 0.7, 160);
      }
    }
  }
  // the plate folds into its centre; the big number counts up through the running totals, 「合计 N」 under it
  async function v7Merge(s, tok) {
    var c = stagePt(s.P.el, 0.5, 0.5), base = Math.max(1, s.W.base), tot = s.W.totals;
    if (!s.P.el.offsetWidth) c = { x: s.P.x, y: s.foe ? s.edgeY + V7.edge + s.P.h / 2 : s.edgeY - V7.edge - s.P.h / 2 }; // no layout (tests)
    var box = fxDiv('v7-merged' + (s.foe ? ' foe' : ''), '<b class="v7-big">' + s.W.base + '</b><span class="v7-cap">' + esc(s.W.cap) + '</span>', c.x, c.y);
    var num = box.querySelector('.v7-big'), cap = box.querySelector('.v7-cap'); cap.style.opacity = 0;
    s.P.el.getAnimations && s.P.el.getAnimations().forEach(function (an) { an.cancel(); });
    bsAnim(s.P.el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.4)', opacity: 0 }], 200, { easing: 'cubic-bezier(.6,0,.9,.5)' }).then(function () { s.P.el.remove(); });
    var step = 210 / tot.length;
    for (var k = 0; k < tot.length; k++) { num.textContent = tot[k]; num.style.fontSize = RoundPlan.stackFont(tot[k] / base) + 'px'; await wait(step, tok); }
    num.textContent = s.W.result; cap.remove(); // 2026-11-20 V7: one number or 「A × B」, no caption
    await bsAnim(num, [{ transform: 'scale(1.45)' }, { transform: 'none' }], 90);
    s.P.el.remove();
    return { at: { x: c.x, y: c.y + 46 }, bubble: box, v7: true }; // release() flies her numbers from at.y − 46 = the merged number
  }
  // shots: [{ el, foe, a, n, chain }] → the same list of st (null where nothing was drawn)
  async function v7Plates(shots, tok) {
    if (BONUS_STACK_B1) return b1Plates(shots, tok);
    var S = shots.map(function (o) {
      if (!o || !o.el || !o.a) return null;
      var p = stagePt(o.el, 0.5, o.foe ? 1 : 0);
      return { el: o.el, foe: !!o.foe, x: p.x, edgeY: p.y, W: RoundPlan.plateWords(o.a, o.n || 1, v7Tr) };
    });
    var L = S.filter(Boolean); if (!L.length) return shots.map(function () { return null; });
    // 2026-11-20 用户「连锁里提前出来的数字盖住了字」: while plates are up, no other float / number shows (CSS #fx.v7-live hides
    // them: charge 「+N」, 威力 floats …); the ×n raise badge sits small on the card corner (#stage.v7-mode). Hits fly after the merge.
    v7Live(1);
    try {
      v7Layout(L);
      var T0 = L.map(function (s) { return v7PlateTime(s.W.rows.length - 1); }), Tmax = Math.max.apply(null, T0), lead = T0.indexOf(Tmax);
      await Promise.all(L.map(function (s, k) { return wait(Tmax - T0[k], tok).then(function () { return v7Build(s, tok, k !== lead); }); }));
      // 2026-11-20 用户「合计前停顿太短，根本看不到」: the last row lands, then every plate holds V7.hold together (speed setting scales it)
      if (L.some(function (s) { return s.W.rows.length > 1; })) await wait(V7.hold, tok);
      else await wait(Math.max(60, Math.min(160, 1000 - Tmax)), tok);
      cue('stackMerge', { i: Math.max.apply(null, L.map(function (s) { return s.W.rows.length - 1; })) }, 0);
      var sts = await Promise.all(L.map(function (s) { return v7Merge(s, tok); }));
      L.forEach(function (s, k) { s.st = sts[k]; });
      await wait(V7.show, tok); // the 「合计 N」 number stays up before it flies
      v7Live(-1);
      return S.map(function (s) { return s ? s.st : null; });
    } catch (e) {
      v7Live(-1);
      L.forEach(function (s) { if (s.P && s.P.el.isConnected) s.P.el.remove(); if (s.st && s.st.bubble.isConnected) s.st.bubble.remove(); });
      throw e;
    }
  }
  var v7LiveN = 0;
  function v7Live(d) {
    v7LiveN = Math.max(0, v7LiveN + d);
    if (fxLayer) fxLayer.classList.toggle('v7-live', v7LiveN > 0);
    if (stageEl && (BONUS_STACK_V7 || BONUS_STACK_B1)) stageEl.classList.add('v7-mode');
  }
  function v7Drop(st) {
    if (!st || !st.bubble) return; var b = st.bubble; b.classList.add('release');
    if (st.b1) { if (st.num) st.num.style.visibility = 'hidden'; setTimeout(function () { b.remove(); }, dur(800)); return; } // B1: the number leaves as her hits, the name fades a beat later
    setTimeout(function () { b.remove(); }, 300);
  }
  // ===== 2026-11-20 BONUS_STACK_B1 (?stack=b1 only; ui/dev/bonus-lab.html B1) =====
  // One column per shot over her card (an enemy's hangs under hers): 「skill name」 (the old band) → her hit number → the bonus
  // rows, one by one, each row bumping the number to its running total (a × row turns it orange). The last row lands, holds,
  // the rows fade; the number is where her hits fly from (st.at, like v7 — release() takes at.y − 46).
  // Several at once (chain / wave / volley): end-aligned like v7; columns that would touch slide sideways, still too wide → every
  // second column climbs one floor. Nothing shrinks.
  var B1 = { gap: 14, hold: 500, fade: 200 };
  function b1Col(s) {
    var col = document.createElement('div'); col.className = 'b1-col' + (s.foe ? ' foe' : '');
    col.innerHTML = '<div class="b1-name">「' + esc(s.name) + '」</div><b class="b1-num">' + s.W.base + '</b><div class="b1-rows"></div>';
    var box = col.querySelector('.b1-rows');
    var rows = s.W.rows.map(function (r, i) {
      var d = document.createElement('div'); d.className = 'b1-rw' + (r.cls ? ' ' + r.cls : '');
      if (i === 0) d.style.display = 'none'; // the base row is never shown (b1Build) — and not measured
      d.innerHTML = esc(r.k) + (r.sub ? '<span class="sub">（' + esc(r.sub) + '）</span>' : '') + '<span class="e">' + esc(r.e) + '</span>';
      box.appendChild(d); return d;
    });
    fxLayer.appendChild(col);
    var nm = col.querySelector('.b1-name');
    var w = Math.max((nm.offsetWidth || 240) - 60, box.offsetWidth || 200) + 8, h = col.offsetHeight || rows.length * 40 + 140;
    rows.forEach(function (d) { d.style.display = 'none'; });
    return { el: col, num: col.querySelector('.b1-num'), rows: rows, w: w, h: h };
  }
  function b1Place(s, x, lift) {
    var C = s.C; C.x = x; C.lift = lift || 0; C.el.style.left = x + 'px';
    if (s.foe) C.el.style.top = (s.edgeY + C.lift) + 'px';
    else { C.el.style.top = 'auto'; C.el.style.bottom = (STAGE_H - s.edgeY + C.lift) + 'px'; }
  }
  function b1Layout(S) {
    var m = 10;
    [false, true].forEach(function (foe) {
      var L = S.filter(function (s) { return s.foe === foe; }).sort(function (a, b) { return a.x - b.x; }); if (!L.length) return;
      var total = L.reduce(function (t, s) { return t + s.C.w; }, 0) + B1.gap * (L.length - 1);
      if (total <= STAGE_W - 2 * m) {
        var left = L.map(function (s) { return s.x - s.C.w / 2; }), i, j;
        for (i = 0; i < L.length; i++) left[i] = Math.max(left[i], i ? left[i - 1] + L[i - 1].C.w + B1.gap : m);
        for (j = L.length - 1; j >= 0; j--) left[j] = Math.min(left[j], j < L.length - 1 ? left[j + 1] - B1.gap - L[j].C.w : STAGE_W - m - L[j].C.w);
        L.forEach(function (s, q) { b1Place(s, left[q] + s.C.w / 2, 0); });
      } else {
        var lowH = Math.max.apply(null, L.filter(function (s, q) { return q % 2 === 0; }).map(function (s) { return s.C.h; }));
        L.forEach(function (s, q) { b1Place(s, Math.max(m + s.C.w / 2, Math.min(STAGE_W - m - s.C.w / 2, s.x)), q % 2 ? lowH : 0); });
      }
    });
  }
  async function b1Build(s, tok, quiet) {
    var C = s.C, n = s.W.rows.length - 1;
    C.el.style.opacity = 1;
    bsAnim(C.el.querySelector('.b1-name'), [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'scale(1.05)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], 240);
    // 2026-11-20 用户「基础就没必要显示了，招式名上面的数字就是基础」: the 「基础 N」 row (rows[0]) stays hidden; the number starts at the base
    if (!quiet) cue('stackRow', { i: 0 }, 0);
    for (var i = 1; i <= n; i++) {
      await wait(RoundPlan.stackGap(i - 1), tok);
      var r = C.rows[i], mul = /\b(mul|burst)\b/.test(r.className);
      r.style.display = '';
      bsAnim(r, [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(' + (mul ? 1.3 : 1.12) + ')', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], 200);
      C.num.textContent = s.W.totals[i]; C.num.classList.toggle('mul', mul);
      bsAnim(C.num, [{ transform: 'scale(1)' }, { transform: 'scale(' + (mul ? 1.7 : 1.35) + ')', offset: 0.5 }, { transform: 'none' }], 240);
      if (!quiet) cue(mul ? 'stackMul' : 'stackRow', { i: i }, 0);
      if (mul) bsJolt(s.el, 2, 200);
    }
  }
  async function b1Plates(shots, tok) {
    var S = shots.map(function (o) {
      if (!o || !o.el || !o.a) return null;
      var p = stagePt(o.el, 0.5, o.foe ? 1 : 0);
      return { el: o.el, foe: !!o.foe, x: p.x, edgeY: p.y, name: o.a.skill || o.a.skillName || '', W: RoundPlan.plateWords(o.a, o.n || 1, v7Tr) };
    });
    var L = S.filter(Boolean); if (!L.length) return shots.map(function () { return null; });
    v7Live(1);
    try {
      L.forEach(function (s) { s.C = b1Col(s); s.C.el.style.opacity = 0; });
      b1Layout(L);
      var T0 = L.map(function (s) { return v7PlateTime(s.W.rows.length - 1); }), Tmax = Math.max.apply(null, T0), lead = T0.indexOf(Tmax);
      await Promise.all(L.map(function (s, k) { return wait(Tmax - T0[k], tok).then(function () { return b1Build(s, tok, k !== lead); }); }));
      await wait(B1.hold, tok);
      L.forEach(function (s) { bsAnim(s.C.el.querySelector('.b1-rows'), [{ opacity: 1 }, { opacity: 0 }], B1.fade); });
      L.forEach(function (s) {
        var c = stagePt(s.C.num, 0.5, 0.5);
        if (!s.C.num.offsetWidth) c = { x: s.C.x, y: s.foe ? s.edgeY + s.C.lift + 110 : s.edgeY - s.C.lift - 110 }; // no layout (tests)
        s.st = { at: { x: c.x, y: c.y + 46 }, bubble: s.C.el, num: s.C.num, b1: true };
      });
      v7Live(-1);
      return S.map(function (s) { return s ? s.st : null; });
    } catch (e) {
      v7Live(-1);
      L.forEach(function (s) { if (s.C && s.C.el.isConnected) s.C.el.remove(); });
      throw e;
    }
  }
  // one enemy action on its own (a lone attack, or one link of an enemy chain whose wave is a single girl): she rises, lunges,
  // her numbers fly and land (连击 hit by hit), she settles. o.quiet: the chain already sounded its enemyAttack cue.
  // 2026-11-20 用户「灰羽首领的攻击能有穿透动画效果，并且一个一个掉血」(FOE_PIERCE_LINE): targets carrying tr.line (the engine's 狂暴
  // 穿透) — a red beam runs from her card through each of ours in order, each card takes its hit as the beam reaches it
  var FOE_PIERCE_LINE = true;
  function isPierceLine(e) { return FOE_PIERCE_LINE && (e.targets || []).some(function (t) { return t && t.line != null; }); }
  function beam(p0, p1, ms) {
    if (!fxLayer || anim.skip || REDUCED) return;
    var dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy), b = document.createElement('div');
    b.className = 'pierce-beam'; b.style.left = p0.x + 'px'; b.style.top = p0.y + 'px'; b.style.width = len.toFixed(1) + 'px';
    b.style.transform = 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)'; b.style.animationDuration = dur(ms || 360) + 'ms';
    fxLayer.appendChild(b); setTimeout(function () { b.remove(); }, dur((ms || 360) + 60));
  }
  async function pierceLine(e, el, tok) {
    var ts = (e.targets || []).filter(function (t) { return t && t.line != null; }).sort(function (a, b) { return a.line - b.line; });
    var prev = el ? stagePt(el, 0.5, 0.6) : { x: 1300, y: 520 };
    cue('bigHit', null, 0);
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i], te = tEl(t); if (!te) continue;
      var p = stagePt(te, 0.5, 0.45); beam(prev, p, 300); prev = p;
      await wait(90, tok);
      if (t.miss) { hitCue(t); floatAt(te, T(t.dodge ? 'ui.battle.dodge' : 'ui.battle.miss'), 'miss'); }
      else { await impacts([{ el: te, uid: te.dataset.u, t: t, kind: 'strike', from: el, dir: -1, scale: 0.8 }], tok); if (t.amount > 0) floatAt(te, '−' + t.amount, 'dmg foe-hit'); }
      await wait(110, tok);
    }
  }
  async function foeStrike(e, tok, o) {
    o = o || {};
    var el = aEl(e); if (!o.quiet) cue('enemyAttack'); tagSettle(e);
    actingTip(el, e); // v39: while she is up, her card's tip = this action's breakdown
    if (el) { el.classList.add('acting'); await wait(RoundPlan.RISE.up, tok); } // v36: every actor rises before acting (same as ours)
    if ((e.bonuses || []).some(function (b) { return b.amount < 0; })) cue('guard');
    var v7st = el && !bsOn() && v7On() && v7Able(e) ? (await v7Plates([{ el: el, foe: true, a: e, n: 1 }], tok))[0] : null; // 2026-11-20 BONUS_STACK_V7: her red plate grows down, folds into one number
    if (!v7st) skillTag(el, e.skill || e.skillName);
    if (el && bsOn() && RoundPlan.stackable(e) && RoundPlan.stackRows(e, 1).length) { // 2026-11-20 BONUS_STACK: her bonuses stack below her card, one red number flies
      await stackPlay([bsShot([e], el, true, 1)], tok);
      if (isPierceLine(e)) { await pierceLine(e, el, tok); await wait(160, tok); await settleCard(el, tok); actingTipOff(el); return; } // 2026-11-20 狂暴穿透
      (e.targets || []).forEach(function (t) { var te = tEl(t); if (te && t.miss) { hitCue(t); floatAt(te, T(t.dodge ? 'ui.battle.dodge' : 'ui.battle.miss'), 'miss'); } });
      await impacts((e.targets || []).filter(function (t) { return !t.miss && tEl(t); }).map(function (t) { var te = tEl(t); return { el: te, uid: te.dataset.u, t: t, kind: t.kind === 'heal' ? 'heal' : e.skillKind, from: el, dir: -1, scale: 0.8 }; }), tok);
      await wait(160, tok); await settleCard(el, tok); actingTipOff(el); return;
    }
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
    var from = v7st ? { x: v7st.at.x, y: v7st.at.y - 46 } : el ? stagePt(el, 0.5, 1) : { x: 1300, y: 520 };
    if (isPierceLine(e)) { v7Drop(v7st); await pierceLine(e, el, tok); await wait(160, tok); await settleCard(el, tok); actingTipOff(el); return; } // 2026-11-20 狂暴穿透
    v7Drop(v7st); // V7: the merged number turns into her hits (they fly from where it stood)
    var eBeats = A.comboBeats(e.targets, function (t) { var x = tEl(t); return x ? x.dataset.u : null; });
    if (eBeats.length > 1) { // batch6 H2-7: an enemy 连击 — every hit its own beat (flash, shake, cue, number, hp step)
      await comboSeq(eBeats, el, e.skillKind, tok); chk(tok);
      var eRest = (e.targets || []).filter(function (t) { return !t.miss && !t.capped && !eBeats.some(function (sb) { return sb.t === t; }) && tEl(t); }); // v38: a target outside the 连击 still lands
      if (eRest.length) await impacts(eRest.map(function (t) { var te = tEl(t); return { el: te, uid: te.dataset.u, t: t, kind: t.kind === 'heal' ? 'heal' : e.skillKind, from: el, dir: -1, scale: 0.8 }; }), tok);
      (e.targets || []).forEach(function (t) { var te = tEl(t); if (te && t.miss) { hitCue(t); floatAt(te, T(t.dodge ? 'ui.battle.dodge' : 'ui.battle.miss'), 'miss'); } });
      await wait(160, tok); await settleCard(el, tok); actingTipOff(el); return;
    }
    var seen = {};
    await Promise.all((e.targets || []).map(function (t, i) {
      var te = tEl(t); if (!te || t.miss || t.capped) return null;
      var nth = seen[t.uid] = (seen[t.uid] || 0) + 1, delay = (nth - 1) * 190; // DESIGN-skill-level: an enemy 连击 hits the same card again a beat later
      return new Promise(function (r) { setTimeout(r, anim.skip ? 0 : dur(delay)); }).then(function () {
        return flyNum(from, te, '', t.kind === 'heal' ? 'heal' : 'dmg foe-hit' + (t.hit ? ' multi' : ''), '', nth > 1 ? (nth - 1) * 62 : 0, t); // 先飞后结算
      });
    }).filter(Boolean)); chk(tok);
    (e.targets || []).forEach(function (t) { var te = tEl(t); if (te && t.miss) { hitCue(t); floatAt(te, T(t.dodge ? 'ui.battle.dodge' : 'ui.battle.miss'), 'miss'); } });
    await impacts((e.targets || []).filter(function (t) { return !t.miss && tEl(t); }).map(function (t) { var te = tEl(t); return { el: te, uid: te.dataset.u, t: t, kind: t.kind === 'heal' ? 'heal' : e.skillKind, from: el, dir: -1, scale: 0.8 }; }), tok);
    await wait(160, tok); await settleCard(el, tok); actingTipOff(el); return;
  }
  // 2026-11-15「一起蓄力，一起出手」: the girls one chain pulled in (RoundPlan.chainWaves) rise TOGETHER, each builds her own
  // number over her own head at the same time (each starts TOGETHER.chargeGap after the one who pulled her in, so the 「加成」
  // cascade still reads A → B → C), they all release together (each a resolveGap after the previous), and the hits land on
  // the targets one action after another in the engine's order — hp bars / 护甲 badges step exactly as the log says, each
  // action's block gains right after it. A wave of one (a plain action) is the old single rise (playBeat).
  async function playChain(group, tok) {
    var beats = RoundPlan.actionBeats(group), acts = beats.map(function (b) { return b.act; }), first = acts[0], extras = RoundPlan.beatExtras(group), waves = RoundPlan.chainWaves(beats);
    var charged = RoundPlan.hasCharge(group); // 充能 (用户 2026-11-15): rise + charge out → the full ones rise → every number → the hits
    // 2026-11-15「对方的加成也要一起走」: an enemy chain (敌方加成, RoundPlan.planRound groups it too) plays the same waves; only the
    // looks differ — enemy cues / number colour / hit direction, a guard cue for a weakened foe, and a wave of one is foeStrike
    var foe = !!first && first.side !== 'ally';
    if (foe && !aEl(first)) { for (var g0 = 0; g0 < group.length; g0++) await playOne(group[g0], tok); return; } // no card to rise: the old one-by-one path
    if (!first || !aEl(first)) return;
    cue(foe ? 'enemyAttack' : 'allyAttack');
    var ctag = null, RS = RoundPlan.RISE, TG = RoundPlan.TOGETHER, stored = RoundPlan.hasRelease(group), plates = {}; // plates: uid → her ×n plate (先蓄后放)
    if (stored) await playStored(tok); // CONTRACT-2026-11-16 先蓄后放: opener winds up → fill pip by pip → raise (×n plate) → breath → everyone fires at once
    for (var w = 0; !stored && w < waves.length; w++) {
      if (waves[w].length > 1 || charged) { await playWave(waves[w], tok); continue; } // charge together, strike together
      var k = waves[w][0].k;
      if (foe) { var ce = chainEvOf(beats[k]); if (ce) await playOne(ce, tok); await foeStrike(beats[k].act, tok, { quiet: true }); } // a lone enemy link: her 「加成」 tag, then the old enemy strike
      else await playBeat(beats[k], k, tok);
      for (var xb = 0; xb < (extras[k] || []).length; xb++) await playOne(extras[k][xb], tok); // v38: a block gain lands with its own beat
    }
    if (ctag) { var ct = ctag; ct.classList.add('out'); setTimeout(function () { ct.remove(); }, 400); }
    await wait(200, tok);
    // 先蓄后放 (用户 2026-11-16 晚「准备攻击 → 充能 → 激发 → 抬起 → 加成 → 所有加成者同时一下子打出去」), steps from
    // RoundPlan.releaseSteps: 'windup' = the opener rises, shakes, glows and builds her own number over her head — she does NOT
    // fire yet (her hit is held for the volley); each 'charge' fills a bar pip by pip; a 'raise' lifts that card with a ×n
    // plate; 'release' = a short breath (the field dims); 'volley' = the opener + every raised girl fire AT ONCE (all numbers
    // leave together; her 2nd, 3rd … hit a volleyStagger later), the plates burst, the hits land volleyLand apart in the log's
    // order (hp / 护甲 stay right, a block gain right after its hit), then everyone settles together.
    // Reduced motion / skip: wait() and dur() are instant, CSS drops the lift / shake.
    async function playStored(tok) {
      var steps = RoundPlan.releaseSteps(group), RL = RoundPlan.RELEASE, raised = [], sh = app.querySelector('.battle') || app, wound = {}, bsRaise = {}; // wound: opener action → { el, st (her number) }
      function plateOf(uid, mult, tier) {
        var el = cardEl(uid); if (!el) return null;
        var p = plates[uid] || el.querySelector('.mult-plate');
        if (!p) { p = document.createElement('div'); el.appendChild(p); }
        plates[uid] = p; p.className = 'mult-plate lv-' + tier + (foe ? ' foe' : ''); p.innerHTML = '<b>' + T('ui.battle.raiseMult', { n: mult }) + '</b>';
        p.dataset.tip = T('ui.battle.raiseTip', { n: mult - 1 }); void p.offsetWidth; p.classList.add('pop');
        return p;
      }
      function dropPlate(uid) { var p = plates[uid]; delete plates[uid]; if (!p) return; p.classList.add('out'); setTimeout(function () { p.remove(); }, REDUCED || anim.skip ? 0 : dur(RL.drop + 200)); }
      function beatOf(e) { return beats.filter(function (b) { return b.act === e; })[0]; }
      try {
        for (var s = 0; s < steps.length; s++) {
          var st = steps[s], e = st.e, el;
          if (st.type === 'act') { var bt0 = beatOf(e); if (!bt0) continue; if (foe) await foeStrike(e, tok, { quiet: true }); else await playBeat(bt0, bt0.k, tok); }
          else if (st.type === 'extra') await playOne(e, tok);
          else if (st.type === 'windup') { // 准备攻击: she rises and gathers; nothing leaves her yet
            var bw = beatOf(e); el = aEl(e); if (!bw || !el) continue;
            tagSettle(e); actingTip(el, e); el.classList.add('acting', 'windup');
            await wait(RS.up, tok);
            if (bsOn()) { skillTag(el, e.skill || e.skillName); wound[bw.k] = { el: el, st: null }; continue; } // 2026-11-20 BONUS_STACK: she builds her stack with the volley
            if (v7On() && v7Able(e, true)) { wound[bw.k] = { el: el, st: null, v7: true }; continue; } // 2026-11-20 V7: her plate grows with the released girls' at the volley
            wound[bw.k] = { el: el, st: await chargeUp(bw, bw.k, el, false, tok) };
            await wait(120, tok);
          } else if (st.type === 'charge') {
            var gt = cardEl(st.uid); if (!st.self) comboFire(cardEl(e.from), gt);
            var gb = gt && gt.querySelector('.chg-bar'); if (gb && !anim.skip) floatAt(gb, '+' + e.amount, 'chg' + (e.gen >= 2 ? ' faint' : '') + (st.self ? ' self' : ''));
            for (var pp = 0; pp < st.pips.length; pp++) { setCharge(st.uid, st.pips[pp]); if (gb) pulse(gb, 'tick', 120); cue('chargeTick', { n: Math.min(12, Math.ceil(st.pips[pp])) }, 30); await wait(st.ms, tok); }
            await wait(e.gen >= 2 ? RL.chargeGapFaint : RL.chargeGap, tok);
          } else if (st.type === 'raise' && bsOn()) { // 2026-11-20 BONUS_STACK: the bar spends now; the plates pop in ONE shared beat at 'release'
            setCharge(st.uid, st.left); bsRaise[st.uid] = st;
          } else if (st.type === 'raise') {
            el = cardEl(st.uid);
            if (el) { var bar = el.querySelector('.chg-bar'); if (bar) pulse(bar, 'flash', 500); el.classList.add('raised'); if (raised.indexOf(el) < 0) raised.push(el); }
            setCharge(st.uid, st.left); plateOf(st.uid, st.mult, st.tier);
            cue('combo', { depth: Math.min(4, st.mult - 1) }, 0);
            await wait(RL.raise, tok);
          } else if (st.type === 'release') {
            var bsU = Object.keys(bsRaise);
            if (bsU.length) { // the shared raise beat: every raised card and the opener glow and gather at once, the ×n plates pop together
              bsU.forEach(function (uid) { var r = bsRaise[uid], ce = cardEl(uid); if (ce) { var bar = ce.querySelector('.chg-bar'); if (bar) pulse(bar, 'flash', 500); ce.classList.add('raised'); if (raised.indexOf(ce) < 0) raised.push(ce); var p = stagePt(ce, 0.5, 0.42); bsRing(p.x, p.y, foe ? '#ff6a6a' : '#b9a0ff', 3.2); } plateOf(uid, r.mult, r.tier); });
              Object.keys(wound).forEach(function (k) { var p = stagePt(wound[k].el, 0.5, 0.42); bsRing(p.x, p.y, '#f1d79a', 3); bsJolt(wound[k].el, 5, 200); });
              cue('combo', { depth: Math.min(4, bsU.reduce(function (m, u) { return Math.max(m, bsRaise[u].mult - 1); }, 1)) }, 0); cue('chargeRelease');
              bsRaise = {};
              await wait(RL.raise, tok);
            }
            if (sh && sh.classList) sh.classList.add('release-hold'); // the rest of the field dims; the raised ones glow (CSS)
            raised.forEach(function (x) { pulse(x, 'hold', st.hold + 120); });
            Object.keys(wound).forEach(function (k) { pulse(wound[k].el, 'hold', st.hold + 120); });
            cue('chargeTick', { n: 12 }, 0);
            await wait(st.hold, tok);
            if (sh && sh.classList) sh.classList.remove('release-hold');
          } else if (st.type === 'volley') await playVolley(st, tok);
        }
      } finally {
        Object.keys(plates).forEach(dropPlate); raised.forEach(function (x) { x.classList.remove('raised'); }); // a cut-off raise: nobody stays up
        Object.keys(wound).forEach(function (k) { var w = wound[k]; w.el.classList.remove('acting', 'windup'); if (w.st && w.st.bubble) w.st.bubble.remove(); });
        if (sh && sh.classList) sh.classList.remove('release-hold');
      }
      await wait(RS.down, tok);
      // 2026-11-20 BONUS_STACK 齐射: the opener (no 连锁 row) and every raised girl (连锁 +1; n actions → one stack ending in
      // 连发 ×n, her hits summed per target) build their stacks at once, land together, hold, merge, ONE volley; then every
      // action's results land at that impact moment in the log's order (hp / 护甲 / blocks exactly as the engine says)
      async function stackVolley(v, tok) {
        var shots = RoundPlan.volleyShots(v.items), els = [];
        shots.forEach(function (s) { var el = cardEl(s.uid) || aEl(s.acts[0]); s.el = el; if (el && els.indexOf(el) < 0) els.push(el); if (el) { el.classList.add('acting'); actingTip(el, s.acts[0]); } s.acts.forEach(function (a) { tagSettle(a); luckyMark(a); }); });
        Object.keys(plates).forEach(function (uid) { var p = plates[uid]; if (p) pulse(p, 'bump', 260); });
        cue(foe ? 'enemyAttack' : 'allyAttack', null, 40);
        var drawn = shots.filter(function (s) { return s.el && s.acts.some(RoundPlan.stackable); }).map(function (s) { return bsShot(s.acts, s.el, foe, s.n); });
        var dropAll = function () { Object.keys(plates).forEach(function (uid) { var p = plates[uid]; delete plates[uid]; if (!p) return; p.classList.add('out'); setTimeout(function () { p.remove(); }, dur(RoundPlan.RELEASE.drop + 200)); }); };
        setTimeout(dropAll, dur(200)); // the plates burst as the stacks start
        await stackPlay(drawn, tok); dropAll();
        await landStack(v.items.map(function (it) { return beats.filter(function (b) { return b.act === it.e; })[0]; }).filter(Boolean), tok);
        for (var i = 0; i < v.items.length; i++) for (var x = 0; x < v.items[i].extras.length; x++) await playOne(v.items[i].extras[x], tok); // block gains after the hits
        await wait(RS.hold, tok);
        els.forEach(function (el) { el.classList.remove('raised', 'acting', 'windup'); actingTipOff(el); });
        raised = raised.filter(function (x) { return els.indexOf(x) < 0; });
        Object.keys(wound).forEach(function (k) { if (els.indexOf(wound[k].el) >= 0) delete wound[k]; });
      }
      // 齐射: launch every item at once, land them one after another in the log's order
      async function playVolley(v, tok) {
        if (!v.items.length) return;
        if (bsOn()) { await stackVolley(v, tok); return; }
        var v7s = {}; // 2026-11-20 BONUS_STACK_V7: uid → her merged plate (the opener's goes into wound[k].st)
        if (v7On()) {
          var vShots = RoundPlan.volleyShots(v.items).filter(function (s0) { var b0 = beatOf(s0.acts[0]); return b0 && aEl(s0.acts[0]) && v7Able(s0.acts[0], true) && !(wound[b0.k] && wound[b0.k].st); });
          // 2026-11-20 用户「第 4 人充能放出第 5 人之后，第 5 人正式出手时招式名和加成全没了，直接打，很急」: her windup was skipped (deferred
          // here, line above in playStored) and when nobody in the volley had a bonus (the other one a healer, say) the plates were
          // dropped → she fired as a bare quick number. A deferred opener (s0.opener) always keeps her column: name + number.
          if (!vShots.some(function (s0) { return s0.n > 1 || s0.opener || RoundPlan.plateWords(s0.acts[0], s0.n, v7Tr).bonus; })) vShots = []; // nothing to add up anywhere: the plain quick numbers
          vShots.forEach(function (s0) { var e0 = aEl(s0.acts[0]); e0.classList.add('acting'); });
          var vSt = await v7Plates(vShots.map(function (s0) { return { el: aEl(s0.acts[0]), foe: foe, a: s0.acts[0], n: s0.n }; }), tok);
          vShots.forEach(function (s0, q) { var b0 = beatOf(s0.acts[0]), w0 = wound[b0.k]; if (!vSt[q]) return; if (w0) w0.st = vSt[q]; else v7s[s0.uid] = vSt[q]; });
        }
        cue('chargeRelease'); if (!REDUCED && !anim.skip && v.items.length >= 3) pulse(sh, 'quake', 500);
        var seenN = {}, els = [];
        var flies = v.items.map(function (it) {
          var bt = beatOf(it.e); if (!bt) return null;
          var el = aEl(it.e), w = wound[bt.k], nth = seenN[it.uid] = (seenN[it.uid] || 0) + 1;
          if (el && els.indexOf(el) < 0) els.push(el);
          var pst = !w && v7s[it.uid]; // 2026-11-20 V7: a released girl fires from her merged plate number (her own animation after)
          var go = function () {
            if (w && w.st) { if (el) pulse(el, 'burst-hit', 260); return release(bt, w.st, true, tok).fly; } // the opener: her gathered number bursts
            if (pst) { tagSettle(it.e); if (el) { actingTip(el, it.e); pulse(el, 'burst-hit', 260); } cue(foe ? 'enemyAttack' : 'allyAttack', null, 40); return release(bt, pst, true, tok).fly; }
            return launchBurst(bt, el, tok);
          };
          var p = nth > 1 && !anim.skip && !REDUCED ? new Promise(function (r) { setTimeout(r, dur((nth - 1) * RL.volleyStagger)); }).then(go) : go();
          p.catch(function () { /* awaited below */ });
          return { it: it, bt: bt, el: el, fly: p, opener: !!(w && w.st) || !!pst }; // an opener without a gathered number lands like the rest (landBurst: her 连击 hit by hit)
        });
        Object.keys(plates).forEach(dropPlate); // the plates burst as everyone fires
        for (var i = 0; i < flies.length; i++) {
          var f = flies[i]; if (!f) continue;
          await f.fly; chk(tok);
          if (f.opener) await land(f.bt, f.el, tok); else await landBurst(f.bt, f.el, tok);
          for (var x = 0; x < f.it.extras.length; x++) await playOne(f.it.extras[x], tok); // a block gain right after its own hit
          if (i < flies.length - 1) await wait(RL.volleyLand, tok);
        }
        await wait(RS.hold, tok);
        els.forEach(function (el) { el.classList.remove('raised', 'acting', 'windup'); actingTipOff(el); }); // everyone lands back together
        raised = raised.filter(function (x) { return els.indexOf(x) < 0; });
        Object.keys(wound).forEach(function (k) { if (els.indexOf(wound[k].el) >= 0) delete wound[k]; });
      }
    }
    // one hit of the volley: her plate bumps, her card jolts, the numbers leave her card (a 连击 plays hit by hit when it lands)
    function launchBurst(bt, el, tok) {
      var a = bt.act; tagSettle(a); if (el) actingTip(el, a);
      if (plates[a.actor]) pulse(plates[a.actor], 'bump', 260);
      if (el) pulse(el, 'burst-hit', 260);
      cue(foe ? 'enemyAttack' : 'allyAttack', null, 40);
      if (bt.series) return Promise.resolve();
      var from = el ? stagePt(el, 0.5, 0) : { x: 960, y: foe ? 300 : 700 };
      return Promise.all(bt.targets.map(function (x) {
        var t = x.t, te = tEl(t); if (!te || t.miss || t.capped) return null;
        var tag = t.graze ? T('ui.battle.graze') /* 2026-11-22e 用户「不叫落空，叫 intangible（灵体）」 */ : t.jackpot ? T('ui.battle.jackpot') : x.splash ? T('ui.battle.splashTag') : critOverTag(t) || (t.pierce ? T('ui.battle.critPierce') : t.crit ? T('ui.battle.crit') : ''); // 2026-11-19 试玩修 界面: + 溢出
        if (t.kind !== 'heal' && t.crit) cue('crit', null, 0);
        return flyNum(from, te, '', t.kind === 'heal' ? 'heal' : 'dmg' + (foe ? ' foe-hit' : '') + (t.crit ? ' crit' : '') + (x.splash ? ' splash' : '') + (a.skillKind === 'aim' ? ' shot' : ''), tag, 0, t);
      }).filter(Boolean));
    }
    async function landBurst(bt, el, tok) {
      var a = bt.act;
      bt.targets.forEach(function (x) { if (x.miss) { floatAt(tEl(x.t), T('ui.battle.miss'), 'miss'); cue('miss'); } });
      if (bt.series) {
        var seq = A.comboBeats(a.targets, function (t) { var x = tEl(t); return x ? x.dataset.u : null; }); seq.forEach(function (sb) { sb.t.seqDone = true; });
        await comboSeq(seq, el, a.skillKind, tok); chk(tok);
      }
      await impacts(bt.targets.filter(function (x) { return !x.miss && !x.t.seqDone && tEl(x.t); }).map(function (x) { var te = tEl(x.t); return { el: te, uid: te.dataset.u, t: x.t, kind: x.heal ? 'heal' : a.skillKind, from: el, dir: foe ? -1 : 1, scale: foe ? 0.8 : x.splash ? 0.75 : 0.85 }; }), tok);
    }
    function chainEvOf(bt) { return bt.depth ? group.filter(function (c) { return c.kind === 'chain' && !c.missed && !c.charge && c.to === bt.actor; })[0] : null; } // a 充能 spend plays with the beat before (beatExtras)
    async function playBeat(bt, k, tok) {
      var a = bt.act, el = aEl(a); if (!el) return;
      el.classList.add('acting'); // the rise (.bcard.acting: up, gold glow); she stays up until her hits have landed
      actingTip(el, a); luckyMark(a); // v39: while she is up, her card's tip = this action's breakdown
      await wait(RS.up, tok);
      if (bsOn() && RoundPlan.stackable(a) && RoundPlan.stackRows(a, 1).length) { // 2026-11-20 BONUS_STACK: rows over her head → one number flies
        if (bt.from) comboFire(cardEl(bt.from), el);
        skillTag(el, a.skill || a.skillName);
        await stackPlay([bsShot([a], el, foe, 1)], tok);
        await landStack([bt], tok);
        await settleCard(el, tok); actingTipOff(el); return;
      }
      var st = await chargeUp(bt, k, el, false, tok);
      await wait(bt.depth ? 260 : 140, tok);
      var r = release(bt, st, false, tok);
      await r.fly; chk(tok);
      await land(bt, el, tok);
      await settleCard(el, tok); actingTipOff(el); // she settles back; the next girl in the chain rises
    }
    async function playWave(wv, tok) {
      var rise = function (bt) { var el = aEl(bt.act); tagSettle(bt.act); if (el) { el.classList.add('acting'); actingTip(el, bt.act); luckyMark(bt.act); } return el; };
      var els;
      if (charged) { // 充能: each one rises and her charge goes out at once (sparks, bars fill pip by pip); whoever is full rises next
        els = [];
        for (var c = 0; c < wv.length; c++) {
          els.push(rise(wv[c]));
          var cx = (extras[wv[c].k] || []).filter(RoundPlan.isChargeEv);
          for (var ci = 0; ci < cx.length; ci++) await playOne(cx[ci], tok);
        }
      } else els = wv.map(rise); // everyone rises at once
      await wait(RS.up, tok);
      if (bsOn() && wv.every(function (bt) { return RoundPlan.stackable(bt.act); }) && wv.some(function (bt) { return RoundPlan.stackRows(bt.act, 1).length; })) { // 2026-11-20 BONUS_STACK: every stack at once, one volley
        wv.forEach(function (bt, i) { if (bt.from && els[i]) comboFire(cardEl(bt.from), els[i]); });
        await stackPlay(wv.map(function (bt, i) { return els[i] ? bsShot([bt.act], els[i], foe, 1) : null; }).filter(Boolean), tok);
        await landStack(wv, tok);
        for (var bi = 0; bi < wv.length; bi++) { var bx = (extras[wv[bi].k] || []).filter(function (e) { return !charged || !RoundPlan.isChargeEv(e); }); for (var bj = 0; bj < bx.length; bj++) await playOne(bx[bj], tok); }
        await wait(RS.hold, tok); els.forEach(function (el) { if (el) el.classList.remove('acting'); }); await wait(RS.down, tok);
        els.forEach(actingTipOff); return;
      }
      var tg = wv.length > 1;
      if (v7On() && wv.some(function (bt) { return v7Able(bt.act); })) { // 2026-11-20 BONUS_STACK_V7: the wave's plates grow together, land on one beat
        wv.forEach(function (bt, i) { if (bt.from && els[i] && v7Able(bt.act)) comboFire(cardEl(bt.from), els[i]); });
        var vs = await v7Plates(wv.map(function (bt, i) { return els[i] && v7Able(bt.act) ? { el: els[i], foe: foe, a: bt.act, n: 1 } : null; }), tok);
        wv.forEach(function (bt, i) { if (vs[i]) bt.v7st = vs[i]; });
      }
      var sts = await Promise.all(wv.map(function (bt, i) { // every girl's own number builds over her own head, at the same time
        return els[i] ? wait(bt.v7st ? 0 : i * TG.chargeGap, tok).then(function () { return chargeUp(bt, bt.k, els[i], tg, tok); }) : Promise.resolve(null);
      }));
      await wait(260, tok);
      var flies = wv.map(function (bt, i) { // all release together (a resolveGap apart), then each lands in the engine's order
        if (!sts[i]) return Promise.resolve(null);
        var p = wait(i * TG.resolveGap, tok).then(function () { var r = release(bt, sts[i], tg, tok); return r.fly; });
        p.catch(function () { /* awaited below */ }); return p;
      });
      for (var i = 0; i < wv.length; i++) {
        await flies[i]; chk(tok);
        if (els[i] || foe) await land(wv[i], els[i], tok); // an enemy without a card still lands her hits (hp / 护甲 stay in sync)
        var xs = (extras[wv[i].k] || []).filter(function (e) { return !charged || !RoundPlan.isChargeEv(e); }); for (var xb = 0; xb < xs.length; xb++) await playOne(xs[xb], tok); // her block gain shows as her action resolves
      }
      await wait(RS.hold, tok); els.forEach(function (el) { if (el) el.classList.remove('acting'); }); await wait(RS.down, tok); // they all settle together
      els.forEach(actingTipOff);
    }
    // her charge over her card: base, then each bonus flies in (the chain's 「加成」 from the girl who brought her in)
    async function chargeUp(bt, k, el, together, tok) {
      var a = bt.act;
      if (bt.v7st) { var pre = bt.v7st; bt.v7st = null; return pre; } // 2026-11-20 V7: her plate was already built with the others (playWave)
      if (v7On() && v7Able(a)) { // 2026-11-20 BONUS_STACK_V7: the word plate stands in for the orb; no skill / 加成 / 连击 banners over the rows
        if (bt.from) comboFire(cardEl(bt.from), el);
        if (foe && (a.bonuses || []).some(function (b) { return b.amount < 0; })) cue('guard');
        return (await v7Plates([{ el: el, foe: foe, a: a, n: 1 }], tok))[0];
      }
      if (bt.from) comboFire(cardEl(bt.from), el);
      var at = stagePt(el, 0.5, 0), step = bt.depth, inStep = 0, val = 0, ticks = 0;
      if (SKILL_UNDER_NUMBERS && !foe) at = { x: at.x, y: at.y - 70 }; // 2026-11-20 用户「数字应该在招式名上面叠加」: the number + its breakdown sit above the skill name
      if (k > 0 && bt.depth && !together) chargeTag(at, bt.depth); // F round 2: 「加成 ×N」 beside her orb, while the bonus is being added
      skillTag(el, a.skill || a.skillName);
      if (foe && (a.bonuses || []).some(function (b) { return b.amount < 0; })) cue('guard'); // a weakened foe (same cue as her lone strike)
      var bubble = fxDiv('charge' + (bt.heal ? ' heal' : '') + (together ? ' together' : '') + (foe ? ' foe' : ''), '<b>0</b>', at.x, at.y - 46);
      if (together && k > 0 && bt.depth) { // together: her own small 「加成 ×N」 plate under her own orb (the big shared tag would cover a neighbour)
        var it = document.createElement('i'); it.className = 'ctag-in lv-' + Math.min(bt.depth, 4); it.textContent = T('ui.battle.chainDepth', { n: bt.depth }); bubble.appendChild(it);
        cue('combo', { depth: bt.depth }, 200);
      }
      function setVal(n, big) {
        val = n; var b = bubble.querySelector('b'); b.textContent = val;
        var sz = together ? Math.min(step, 2) : step; // side by side: the orbs grow less, so neighbours never cover each other
        var fs = CHARGE_FS[Math.min(sz, CHARGE_FS.length - 1)] + Math.min(8, inStep * 3), dm = Math.min(together ? 140 : 192, 92 + sz * 20 + Math.min(8, inStep * 3));
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
        if (a.bonuses[j].hit) continue; // 2026-11-15: a per-hit entry (刺客「连击递减」, 夜鸦「收账」) belongs to that one hit — never to the opening number
        var b = a.bonuses[j], src = bonusSource(b, el), sp = src ? stagePt(src, 0.5, 0.3) : { x: at.x, y: at.y };
        var bd = fxDiv('flynum bonus', (b.noEffect ? '' : (b.amount >= 0 ? '+' : '') + b.amount) + '<small>' + esc(b.label || '') + '</small>', sp.x, sp.y); // 虚弱 that did nothing: no 「+0」, just the words
        await flyTo(bd, sp, { x: at.x, y: at.y - 46 }, 380, 80); chk(tok); inStep++; setVal(val + b.amount);
      }
      return { at: at, bubble: bubble };
    }
    // release: her charge bursts; sparks and one number per target fly together (the mage's splash: every target its own number).
    // A 连击 (series) plays hit by hit: alone it starts with the flight; in a together wave it plays when her turn to land comes.
    function release(bt, st, together, tok) {
      var a = bt.act, el = aEl(a), at = st.at, bubble = st.bubble;
      if (st.b1) v7Drop(st); else { bubble.classList.add('release'); setTimeout(function () { bubble.remove(); }, 300); } cue('chargeRelease'); // 2026-11-20 B1: the number goes, the name fades a beat later
      if (isPierceLine(a)) return { fly: Promise.resolve() }; // 2026-11-20 狂暴穿透: no flying numbers — the beam lands them one by one (land → pierceLine)
      var src0 = { x: at.x, y: at.y - 46 }, live = bt.targets.filter(function (x) { return !x.miss && tEl(x.t); });
      var seq = bt.series ? A.comboBeats(a.targets, function (t) { var x = tEl(t); return x ? x.dataset.u : null; }) : [];
      seq.forEach(function (sb) { sb.t.seqDone = true; }); // batch6 H2-7: one beat per hit; impacts() leaves them alone
      bt.seq = seq;
      var tEls = live.map(function (x) { return tEl(x.t); }).filter(function (x, i, arr) { return arr.indexOf(x) === i; });
      var nums = (!together && seq.length ? [wait(260, tok).then(function () { return comboSeq(seq, el, a.skillKind, tok); })] : []).concat(live.map(function (x) {
        var t = x.t, te = tEl(t), uid = te.dataset.u; if (t.capped || t.seqDone) return null;
        var tag = t.graze ? T('ui.battle.graze') /* 2026-11-22e 用户「不叫落空，叫 intangible（灵体）」 */ : t.jackpot ? T('ui.battle.jackpot') : x.splash ? T('ui.battle.splashTag') : critOverTag(t) || (t.pierce ? T('ui.battle.critPierce') : t.crit ? T('ui.battle.crit') : ''); // 2026-11-19 试玩修 界面: + 溢出
        if (t.kind !== 'heal' && t.crit) cue('crit', null, 0);
        return flyNum(src0, te, '', t.kind === 'heal' ? 'heal' : 'dmg' + (foe ? ' foe-hit' : '') + (t.crit ? ' crit' : hitTier(uid, t) !== 'normal' ? ' huge' : '') + (x.splash ? ' splash' : '') + (a.skillKind === 'aim' ? ' shot' : ''), tag, 0, t); // 先飞后结算, per target
      })).filter(Boolean);
      if (together && seq.length) bt.seqLate = true;
      return { fly: tEls.length ? Promise.all([burst(src0, tEls, bt.heal ? 'heal' : 'gold', Math.min(18, 6 + Math.max(0, bt.total)))].concat(nums)) : Promise.resolve() };
    }
    // the hits land: misses, her 连击 if it still waits, then every other target (hp + 护甲 in the engine's order)
    async function land(bt, el, tok) {
      if (isPierceLine(bt.act)) { await pierceLine(bt.act, el, tok); return; } // 2026-11-20 狂暴穿透 inside a chain / charged wave
      var a = bt.act, live = bt.targets.filter(function (x) { return !x.miss && tEl(x.t); });
      bt.targets.forEach(function (x) { if (!x.miss) return; if (x.soft) softMark(el, tEl(x.t)); else { floatAt(tEl(x.t), T('ui.battle.miss'), 'miss'); cue('miss'); } });
      if (bt.seqLate) await comboSeq(bt.seq, el, a.skillKind, tok);
      await impacts(live.filter(function (x) { return !x.t.seqDone; }).map(function (x) { var te = tEl(x.t); return { el: te, uid: te.dataset.u, t: x.t, kind: x.heal ? 'heal' : (x.t.refund || x.t.priestStrike) ? 'strike' : a.skillKind, from: el, dir: foe ? -1 : 1, scale: foe ? 0.8 : x.splash ? 0.75 : undefined }; }), tok);
    }
    // 2026-11-20 BONUS_STACK: the stack's numbers have hit — every beat's results land at once (misses, then every hit in
    // the log's order through impacts: hp / 护甲 exactly as the engine says; two hits on one card: the later one wins)
    async function landStack(bts, tok) {
      var list = [];
      for (var pi = 0; pi < bts.length; pi++) if (isPierceLine(bts[pi].act)) await pierceLine(bts[pi].act, aEl(bts[pi].act), tok); // 2026-11-20 狂暴穿透
      bts = bts.filter(function (bt) { return !isPierceLine(bt.act); });
      bts.forEach(function (bt) {
        var a = bt.act, el = aEl(a);
        bt.targets.forEach(function (x) { if (!x.miss) return; if (x.soft) softMark(el, tEl(x.t)); else { floatAt(tEl(x.t), T('ui.battle.miss'), 'miss'); cue('miss'); } });
        bt.targets.forEach(function (x) { if (x.miss || !tEl(x.t)) return; x.t.seqDone = false; var te = tEl(x.t); list.push({ el: te, uid: te.dataset.u, t: x.t, kind: x.heal ? 'heal' : (x.t.refund || x.t.priestStrike) ? 'strike' : a.skillKind, from: el, dir: foe ? -1 : 1, scale: foe ? 0.8 : x.splash ? 0.75 : undefined }); });
      });
      await impacts(list, tok);
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
    for (var g = 0; g < group.length; g++) { if (group[g].kind !== 'action' && group[g].kind !== 'chainEnd' && group[g].kind !== 'block' && group[g].kind !== 'blockClear' && group[g].kind !== 'charge' && group[g].kind !== 'raise' && group[g].kind !== 'release' && !(group[g].kind === 'chain' && group[g].charge) && !(foe && group[g].kind === 'chain') && mkLines.indexOf(group[g]) < 0) await playOne(group[g], tok); } // an enemy 加成 tag already rode on her orb (or her lone strike)
    await killCalls(acts, mkLines, tok); // SPEC-11-13 F: after the foes fall; her happy line right after the banner
    if (depth >= 1 && !foe) { // the happy faces are ours only
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
  // 2026-11-20 用户「快速模式下，对手落选者的立绘大图就没必要出现——直接上负面效果」: quick-recruit runs skip her big portrait scenes
  // (revenge line, reckoning monologue, the debt cards); the debts land straight from her battle card. false = the old scenes
  var QUICK_NO_RIVAL_ART = true;
  var QUICK_SHOW_DEBTS = true; // see playDebts
  // 2026-11-20 用户「不管是快速模式还是跳过剧情——就跳过那一段直接开始战斗」「快速招募不代表快速模式」: 快速模式 (?quick=1) or 跳过剧情 pressed in this level's battle — NOT the one-page recruit
  function quickNoArt() { return QUICK_NO_RIVAL_ART && (QUICK || !!(vn && vn.skipping) || (ui.rivalSkip != null && view && ui.rivalSkip === view.level)); }
  async function playRevenge(e, tok) {
    if (quickNoArt()) return;
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
    if (quickNoArt()) return; // quick mode: no monologue screen
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
    // 2026-11-20 用户「对话类的快速模式都跳，但负面效果的图标也被跳过了，这个不行」(QUICK_SHOW_DEBTS): in quick mode her debt cards and
    // their dots still play — only her big stand stays out (and the cards hold shorter). false = the old silent quick mode
    var qd = quickNoArt();
    if (qd && !QUICK_SHOW_DEBTS) { // quick mode (用户「直接跳过到战斗」): nothing plays — her debts just take effect on the cards, silently
      for (var qi = 0; qi < mems.length; qi++) {
        var mq = mems[qi] || {}, tq = (mq.allies || (mq.ally ? [mq.ally] : [])).map(anyCard).filter(Boolean);
        tq.forEach(function (el) { if (mq.hpWas) debtLanded(el.dataset.u, mq); });
      }
      return;
    }
    cine('reck debts ' + cv, (qd ? '' : '<div class="rk-stand">' + pic(A.portrait(id, { variant: cv }), 'stand-img', '', '') + '</div>') + '<div class="debt-row">' + debts.map(function (d, i) {
      return '<div class="debt-card" data-i="' + i + '"><span class="dn">' + (i + 1) + '</span><span class="dl">' + esc(d.label) + '</span><span class="dt">' + esc(d.text || '') + '</span></div>';
    }).join('') + '</div>');
    clearAllies();
    document.body.classList.add('fx-top'); cue('debuff');
    await wait(qd ? 700 + 300 * debts.length : 1400 + 500 * debts.length, tok);
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
      case 'enemyEnter': el = cardEl(e.uid || (e.unit && e.unit.uid)); if (el) { el.classList.remove('pre-enter'); el.classList.add('enter'); setTimeout(function (c) { return function () { c.classList.remove('enter'); }; }(el), 700); } if (el && e.unit && e.unit.openBlock > 0 && !anim.skip) floatAt(el, '+' + e.unit.openBlock, 'blk gain', T('ui.battle.openBlock'), -70); /* 2026-11-15 方案 B: why the badge already shows a number */ cue('enemyEnter', null, 150); await wait(420, tok); break; // batch6 H2-6: drop 'enter' once played — left on, every later pulse (felled / hit) restarted it and a greyed-out foe slid back in · fix: this comment once swallowed the wait+break, so enemyEnter fell through into 'phase2' (「第二阶段」 on every entrance)
      case 'phase2': await playPhase2(e, tok); break;
      case 'block': el = cardEl(e.uid); RoundPlan.eventBlocks(e).forEach(function (x) { setBlock(x[0], x[1]); }); if (el && !anim.skip) { floatAt(blkAnchor(el), '+' + e.amount, 'blk gain', e.source ? T('ui.battle.blockFrom', { skill: e.source }) : '', 0); cue('guard', null, 0); await wait(e.source ? 420 : 260, tok); } break; // 2026-11-14 护甲 · 2026-11-15「说清楚是什么技能在加护甲」: 「退伍老兵 护甲 / +1」
      case 'blockClear': RoundPlan.eventBlocks(e).forEach(function (x) { setBlock(x[0], x[1]); }); break;
      case 'turncoat': await playTurncoat(e, tok); break;
      case 'switchSide': moveToAllies(e.uid); break;
      case 'wave': if (e.advBoss) { await playWaveCard(e, tok); break; }
        if (e.wave > 1 && view && view.level === 11) { app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); }); await wait(500, tok); break; }
        if (e.wave > 1) { banner(T('ui.battle.wave', { n: e.wave }), 'wave'); app.querySelectorAll('.bcard.foe.down').forEach(function (c) { c.classList.add('gone'); }); await wait(900, tok); } break;
      case 'luckUp': { // 2026-11-20 妮可塔「好运当头」: every ally 幸运 +n this round — a clover float on each card
        cue('moodUp', null, 0);
        (e.units || []).forEach(function (uid, i) { var ce = cardEl(uid); if (!ce) return; var p = stagePt(ce, 0.5, 0.3), d = fxDiv('float lucky-fx up', '<small>' + esc(T('ui.battle.luckUpFx', { n: e.n })) + '</small>' + A.glyph('luck', false), p.x, p.y); setTimeout(function () { d.remove(); }, 1500 / Math.min(1, spd())); var lb = ce.querySelector('.luck-n'); if (lb && e.luck) lb.textContent = e.luck[i]; });
        await wait(500, tok); break;
      }
      case 'pow': { // 2026-11-20b POWER_LIVE_UI: the card's 威力 follows; ours get a 「威力 +2」 float
        if (!POWER_LIVE_UI) break;
        if (ui.powStart) delete ui.powStart[e.uid];
        setPow(e.uid, e.to, e.base, !anim.skip, e.all || null);
        if (e.side === 'ally' && !anim.skip && e.delta) { el = cardEl(e.uid); if (el) { floatAt(el, powText(e), 'pow-float ' + (e.delta > 0 ? 'up' : 'down')); await wait(260, tok); } }
        break;
      }
      case 'frenzy': {
        var mult = e.mult || Math.pow(2, Math.max(1, (e.round || 4) - 3));
        cue('frenzy', { mult: mult }, 0); setFrenzy(mult);
        var fb = fxDiv('banner frenzy', '<span class="fx-word">' + T('ui.battle.frenzy', { n: mult }) + '</span><small>' + T('ui.battle.frenzySub') + '</small>', 960, 470);
        setTimeout(function () { fb.remove(); }, REDUCED ? 900 : 2000); await wait(1500, tok); break;
      }
      case 'action': {
        if (e.side === 'ally') { await playChain([e], tok); break; }
        luckyMark(e); await foeStrike(e, tok); break;
      }
      case 'down': {
        el = cardEl(e.uid) || cardById(e.id); var mine = e.side === 'ally' || (el && el.classList.contains('ally'));
        cue(mine ? 'allyDown' : 'kill');
        if (el) { el.classList.add('down'); pulse(el, 'felled', 700); if (!mine && window.HitFX && !anim.skip) HitFX.ko(el, fxLayer); } // v2.6: foes shatter; ours fall quietly
        await wait(mine ? 380 : 520, tok); break;
      }
      case 'charge': { // 充能: a spark from the giver, her bar fills, 「+n」 beside it (later generations: smaller, faster)
        var gf = cardEl(e.from), gt = cardEl(e.to); comboFire(gf, gt);
        var gb = gt && gt.querySelector('.chg-bar'); if (gb) { pulse(gb, 'gain', 600); floatAt(gb, '+' + e.amount, 'chg' + (e.gen >= 2 ? ' faint' : '')); }
        if (BELL_FX && gf && gt && gf !== gt && gf.dataset.id === 'fairy-demon' && e.amount > 0) bellFx([{ el: gt, text: T('ui.battle.fx.charge', { n: e.amount }) }]); // 2026-11-20 her bell charges a doll
        var pips = Math.max(1, Math.round((e.after || 0) - (e.before || 0))), pms = Math.min(RoundPlan.PIP_MS, Math.floor(RoundPlan.PIP_TOTAL / pips)); // pip by pip, quick
        for (var pp = 1; pp <= pips; pp++) { setCharge(e.to, Math.min(e.after, (e.before || 0) + pp)); await wait(pms, tok); }
        setCharge(e.to, e.after); await wait(e.gen >= 2 ? 80 : 160, tok); break;
      }
      case 'raise': setCharge(e.to, e.left || 0); el = cardEl(e.to); if (el) floatAt(el, T('ui.battle.raiseMult', { n: (e.stack || 1) + 1 }), 'chg raise-f'); await wait(200, tok); break; // 先蓄后放 without a card to rise (the plain path)
      case 'release': break;
      case 'aim': { // 2026-11-16 猎人锁定: her target fell → the 准星 slides to the next one on the right (auto); null = back to 最左边
        var hk0 = (bUnits().filter(function (u) { return u.id === e.id || u.uid === e.id; })[0] || {}), key0 = hk0.uid != null ? hk0.uid : e.id, nm = Object.assign({}, aimNow);
        if (e.target == null) delete nm[key0]; else nm[key0] = e.target;
        syncAim(nm, key0); await wait(e.auto ? 420 : 200, tok); break;
      }
      case 'bellCount': { // 2026-11-20 L5 铜钟: its own turn — 「还剩 N 回合」 pops over it like an attack's name, its badge counts down
        el = cardEl(e.uid); if (!el || anim.skip) break;
        el.classList.add('acting'); var bp = stagePt(el, 0.5, 1);
        var bc = fxDiv('skill-tag foe bell-count', esc(e.text), bp.x, bp.y + 34); bc.style.left = A.clampX(bp.x, bc.offsetWidth, STAGE_W, 12) + 'px';
        cue('click', null, 0); setTimeout(function () { bc.remove(); }, dur(1500));
        await wait(900, tok); el.classList.remove('acting'); break;
      }
      case 'quake': { // 2026-11-16 石门守卫「地震」: every one of ours shakes and takes a number
        var qs = app.querySelector('.battle') || app; if (!REDUCED && !anim.skip) pulse(qs, 'quake', 500);
        el = cardEl(e.from); if (el) pulse(el, 'strike', 520);
        cue('bigHit', null, 0); banner(e.chill ? T('ui.battle.chill') /* 2026-11-24 墓穴的寒气 */ : e.fire ? T('ui.battle.fireBottle') /* 2026-11-22 燃烧瓶 */ : e.chestnut ? T('ui.battle.chestnut') : e.toll ? T('ui.battle.toll') : T('ui.battle.quake'), CLAUSE_BANNER_SMALL ? '' : 'clause'); /* 2026-11-20: a one-word effect, not a clause plate */ // 2026-11-20 L5 钟楼守卫: the toll plays as a quake
        (e.targets || []).forEach(function (t) { var te = cardEl(t.uid); if (!te) return; if (t.maxHpAfter != null && ui.field && ui.field[t.uid]) ui.field[t.uid].maxHp = t.maxHpAfter; /* 2026-11-21 栗子: 生命上限 */ if (t.maxCut) floatAt(te, T('ui.battle.maxHpDown', { n: t.maxCut }), 'dmg foe-hit'); else if ((t.amount || 0) > 0) floatAt(te, '−' + t.amount, 'dmg foe-hit'); /* 2026-11-16: no 「−0」 (all on 护甲 → hitBlock shows it) */ pulse(te, 'hit', 520); if (t.hpAfter != null) setHp(t.uid, t.hpAfter); hitBlock(t, te); });
        await wait(700, tok); break;
      }
      case 'chain': { // 2026-11-14 敌方加成: the same 「加成！/ 加成 ×N」 tag as ours, in the enemy colour, over the follower
        if (e.charge) { // 充能 full: the bar flashes and spends 10 pips; she rises with her beat (playChain)
          var fb0 = cardEl(e.to), fbar = fb0 && fb0.querySelector('.chg-bar'); if (fbar) pulse(fbar, 'flash', 700);
          await wait(260, tok); setCharge(e.to, e.left); break;
        }
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
      case 'summon': { // 2026-11-16 露西安召唤: her roll call — the new cards pop in (fade + scale) on her left
        el = cardEl(e.uid); if (el) pulse(el, 'acting', 600);
        if (e.text) banner(e.text, e.short ? 'summon-note' : 'clause'); // 2026-11-18 #5: the short roll-call line, small
        if (el && !e.split && (e.units || []).length && !el.classList.contains('down')) el.classList.add('warded');
        if ((e.split || e.brood) && e.parent) { var pf = ui.field && ui.field[e.parent.uid]; if (pf) pf.maxHp = e.parent.maxHp; setHp(e.parent.uid, e.parent.hp); } // 2026-11-20 L7 分裂史莱姆: the parent keeps half // 2026-11-18 #2: 契约庇护 back on
        if ((e.split || e.brood) && !ui.lineup) splitSlide(e.units || [], (e.slots || []).filter(function (x) { return x.wasUnit; }).map(function (x) { return x.was; })); // 阵容同步开着时不用（lineupApply 已插好卡、让好位） // 2026-11-20 用户「分裂史莱姆的位置提前变了，要等分裂动画时再挪过去」
        (e.units || []).forEach(function (u) { var c = cardEl(u.uid); if (!c) return; c.classList.remove('pre-enter', 'pre-split'); c.classList.add('summon-in'); setTimeout(function () { c.classList.remove('summon-in'); }, 600); });
        cue('enemyEnter', null, 0); await wait((e.units || []).length ? 800 : 500, tok); break;
      }
      case 'clauseDaze': { // 2026-11-14 附加条款: the next round, 2 foes stand there dazed (their turn then brings a daze reason:'clause')
        var dz = (e.units || []).map(function (u) { return cardEl(typeof u === 'object' ? u.uid : u); }).filter(Boolean);
        if (e.text) banner(e.text, 'clause');
        dz.forEach(function (x) { pulse(x, 'dazed', 900); floatAt(x, T('ui.battle.dazed'), 'miss'); var row = x.querySelector('.st-row'); if (row && !row.querySelector('[data-st="daze"]')) row.insertAdjacentHTML('beforeend', statusIcons(['daze'], 'enemy')); });
        cue('advisorSkill', null, 0); await wait(dz.length ? 900 : 300, tok); break;
      }
      case 'daze': el = cardEl(e.actor || e.uid) || cardById(e.actorId || e.id); if (el) { pulse(el, 'dazed', 900); floatAt(el, T(e.reason === 'regret' ? 'ui.battle.regret' : 'ui.battle.dazed'), 'miss'); } await wait(e.reason === 'regret' ? 1100 : 700, tok); break; // 2026-11-14 L8: the leader freezes
      case 'mood': el = cardById(e.id); if (el) moodDrop(el, e); await wait(500, tok); break;
      case 'copyDebuff': if (BELL_FX && e.stat) { el = cardEl(e.to); if (el) { pulse(cardEl(e.actor), 'acting', 600); bellFx([{ el: el, text: fxStatText(e.stat, e.delta), bad: e.delta < 0 }]); await wait(700, tok); } } break; // 2026-11-20 her bell copies a debuff onto one of us
      case 'xlMark': if (BELL_FX) { el = cardEl(e.uid || e.target); if (el) { bellFx([{ el: el, text: T('ui.battle.fx.marked'), bad: true }]); await wait(500, tok); } } break; // 2026-11-20 her bell settles on one of us
      case 'line': case 'advisor': {
        if (QUICK) break; /* 快速模式: no barks, taunts or talk in battle */
        if (BELL_FX && e.bless && (e.bless.uids || []).length && e.bless.delta) bellFx(e.bless.uids.map(function (uid) { return { el: cardEl(uid), text: fxStatText(e.bless.stat, e.bless.delta) }; })); // 2026-11-20 the blessing she hands her side, on each card
        var key = e.key || '';
        if (key === 'bark') { await playBubble(e, tok, e.soft || e.bark === 'softHeart' ? 'soft' : null); break; }
        if (key === 'softHeart') { await playBubble(e, tok, 'soft'); break; }
        if (key === 'revenge') { await playRevenge(e, tok); break; }
        if (key === 'reveal' && e.advBossReveal) { await playBossReveal(e, tok); break; }
        if (key === 'enemyBark') { if (!anim.skip) await playBubble(e, tok, 'enemy'); break; }
        if (key === 'taunt' && ++tauntsThisRound > 3) break;
        if (talkKeys[key]) { await playTalk(e, tok); break; }
        if (BIG_TELL_SIDE && key === 'bigTell') { await sayP([Object.assign(normLine(e) || {}, { vnClass: 'side-right b-warn' })]); chk(tok); break; } // 2026-11-19 试玩修 界面: the 「下回合翻倍」 warning sits bottom-right, on top, clear of our cards
        await sayP([e]); chk(tok); break;
      }
      case 'relic': // v2.3 §A[26]: the bell rings at L11 and the fairy starts phase 1 hurt
        cue('bell', { act: actNo() }, 0); el = cardEl(e.uid);
        if (el) { pulse(el, 'hit', 520); floatAt(el, T('ui.battle.bell'), 'turn'); if (e.hpAfter != null) setHp(e.uid, e.hpAfter); }
        await wait(1200, tok); break;
      case 'badgeRevive': // 2026-11-20 旧公会徽章: the fallen holder stands up at the round's end
        el = cardEl(e.uid);
        if (el) { el.classList.remove('down'); setHp(e.uid, e.hpAfter != null ? e.hpAfter : 1); pulse(el, 'joy', 900); floatAt(el, T('ui.battle.badgeRevive'), 'heal'); }
        await wait(1100, tok); break;
      case 'cancel': el = aEl(e); if (el) { pulse(el, 'dazed', 900); floatAt(el, T('ui.battle.cancelled'), 'miss'); } await wait(700, tok); break;
      case 'memory': await playDebts({ id: e.id, debts: [] }, [e], tok); break;
      case 'reckoning': await playReckoning(e, tok); break;
      case 'debts': await playDebts(e, [], tok); break;
      case 'phase': { var rn = $('roundNo'); if (rn && e.round) rn.querySelector('.bp-k').textContent = T('ui.battle.round', { n: e.round });
        // feedback-1112 [9]: 「第 N 回合 · 我方 / 敌方行动」 before each side moves (only when that side really acts this round)
        if (e.acts && e.round && !anim.skip) {
          var ally = e.side === 'ally', tb = fxDiv('turn-banner ' + (ally ? 'tb-ally' : 'tb-foe'), '<span class="tb-r">' + T('ui.battle.round', { n: esc(e.round) }) + '</span><span class="tb-s">' + T(ally ? 'ui.battle.allyTurn' : 'ui.battle.foeTurn') + '</span>', 960, TURN_BANNER_GAP ? turnBannerY() : 612);
          if (TURN_BANNER_GAP) tb.classList.add('slim');
          cue('pause', null, 0); setTimeout(function () { tb.remove(); }, dur(1250)); await wait(950, tok);
        }
        break; }
      case 'advisorSkill': cue('advisorSkill', null, 0);
        if (e.enemy) { el = cardEl(e.uid); if (el) pulse(el, 'strike', 520); if (!anim.skip) { announce({ title: T('ui.battle.skillTitle', { name: e.name || T('ui.battle.advisorSkill') }), sub: String(e.text || '').replace(/^[^——]*——/, '') || T('ui.battle.thisRound'), face: A.face(e.advisorId, 'special') }); await wait(1300, tok); } break; } // feedback-1112 #36: the boss casts it on you, every round
        if (!ui.announced) { announce({ title: (e.name ? T('ui.battle.skillTitle', { name: e.name }) : T('ui.battle.advisorSkill')), sub: T(e.open ? 'ui.battle.thisRound' : 'ui.battle.nextRound'), face: A.face(e.advisorId || (view.advisor && view.advisor.id), 'special') }); await wait(1300, tok); } break;
      case 'item': cue('item', null, 0); if (!ui.announced && e.itemId) { announce({ title: e.name || e.text || T('ui.battle.item'), face: null }); await wait(1100, tok); }
        if (e.revived && e.target) { el = cardEl(e.target); if (el) { el.classList.remove('down'); setHp(e.target, e.hpAfter != null ? e.hpAfter : 1); pulse(el, 'joy', 900); } } // 2026-11-22 复活药: she stands up
        break;
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
  // 2026-11-20 反水 visual: a real 3D flip (perspective) and a white flash on her card as she lands in our row. false = the old flat flip
  var TURN_FLIP_FLASH = true, TURN_PERSP = TURN_FLIP_FLASH ? 'perspective(900px) ' : '';
  function moveToAllies(uid) {
    var el = cardEl(uid), lane = $('laneAlly'); if (!el || !lane || el.parentNode === lane) return null;
    var from = stagePt(el, 0.5, 0.5);
    el.classList.remove('foe', 'corrupt-possessed', 'corrupt-vengeful'); el.classList.add('ally', 'turned', 'flip-in');
    var cm = el.querySelector('.corrupt-mark'); if (cm) cm.remove();
    var img = el.querySelector('.uc-img'); if (img && A.isCandidate(el.dataset.id)) swapPic(img, A.face(el.dataset.id, 'calm'));
    lane.appendChild(el); var to = stagePt(el, 0.5, 0.5);
    if (el.animate && !REDUCED) el.animate([{ transform: TURN_PERSP + 'translate(' + (from.x - to.x) + 'px,' + (from.y - to.y) + 'px) rotateY(180deg) scale(.9)' }, { transform: TURN_PERSP + 'translate(' + ((from.x - to.x) / 2) + 'px,' + ((from.y - to.y) / 2 - 120) + 'px) rotateY(90deg) scale(1.15)', offset: 0.5 }, { transform: TURN_PERSP + 'rotateY(0deg)' }], { duration: dur(900), easing: 'cubic-bezier(.3,.7,.3,1)' });
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
    if (to) { var lb2 = fxDiv('light-burst small', '', to.x, to.y); setTimeout(function () { lb2.remove(); }, 1200); if (TURN_FLIP_FLASH) pulse(el, 'turn-flash', 800); }
    await wait(300, tok);
  }
  function moodDrop(cardElm, e) {
    var mf = cardElm.querySelector('.mood-face img'); if (mf && e.mood != null) mf.src = A.moodIcon(e.mood);
    cue(e.delta < 0 ? 'moodDown' : 'moodUp', null, 300);
    pulse(cardElm.querySelector('.mood-face'), e.delta < 0 ? 'mood-down' : 'mood-up', 1200); floatAt(cardElm, T(e.delta < 0 ? 'ui.battle.moodDown' : 'ui.battle.moodUp'), e.delta < 0 ? 'mood-dn' : 'mood-up');
  }
  // 2026-11-20 BELL_FX: what a bell effect gave, on each card it touched — a short text + a quick glow, ~120 ms apart.
  // items: [{ el, text, bad }]. Also bumps the 威力 chip when the text is a 威力 change (the number itself updates on re-render)
  function bellFx(items) {
    (items || []).filter(function (x) { return x && x.el; }).forEach(function (x, i) {
      var go = function () { pulse(x.el, 'bell-glow', 700); floatAt(x.el, x.text, 'bell-fx' + (x.bad ? ' bad' : '')); };
      if (i === 0 || anim.skip || REDUCED) go(); else setTimeout(go, dur(120 * i));
    });
  }
  function fxStatText(stat, delta) {
    var k = stat === 'atk' ? 'ui.battle.fx.atk' : stat === 'maxHp' ? 'ui.battle.fx.maxHp' : stat === 'fullAt' ? 'ui.battle.fx.fullAt' : null;
    var sign = delta < 0 ? '−' : '+', n = Math.abs(delta || 0);
    return k ? T(k, { sign: sign, n: n }) : T('ui.effect.statLine', { stat: STAT_NAME()[stat] || stat, sign: sign, n: n });
  }
  // 2026-11-20 TURN_BANNER_GAP: the middle of the gap between the lowest enemy card and the highest top of ours (their 准星
  // buttons / marks included), in stage px; the old fixed 612 when the lanes are not on screen
  function turnBannerY() {
    var foeB = -1, allyT = 1e9;
    app.querySelectorAll('.bcard.foe:not(.gone)').forEach(function (c) { var p = stagePt(c, 0.5, 1); if (p && p.y > foeB) foeB = p.y; });
    app.querySelectorAll('.bcard.ally:not(.gone), .bcard.ally .aim-btn, .bcard.ally .heal-btn').forEach(function (c) { var p = stagePt(c, 0.5, 0); if (p && p.y < allyT) allyT = p.y; });
    if (foeB < 0 || allyT >= 1e9 || allyT <= foeB) return 612;
    return Math.round((foeB + allyT) / 2);
  }
  function banner(text, cls) {
    // 2026-11-20 CLAUSE_BANNER_SMALL: a 「条款生效」 line is a sentence — a readable plate, held ~3 s (old: the effect word, 1.4 s)
    var plate = CLAUSE_BANNER_SMALL && /\bclause\b/.test(cls || '');
    var d = fxDiv('banner ' + (cls || '') + (plate ? ' plate' : ''), '<span class="fx-word">' + esc(text) + '</span>', 960, plate ? 470 : 420); setTimeout(function () { d.remove(); }, plate ? Math.max(2600, dur(3000)) : 1400);
  }
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
  // 2026-11-20 GROUP_FX: one group effect (RoundPlan.groupFx) — every card's float + badge at once, the skill caption once
  // (on the first card that shows), one cue, one wait (≈ the old single wait). Skip mode: badges / numbers only, no wait.
  async function playFxGroup(st, tok) {
    var evs = st.evs, shown = 0;
    if (st.kind === 'block') {
      evs.forEach(function (e) {
        RoundPlan.eventBlocks(e).forEach(function (x) { setBlock(x[0], x[1]); });
        var el = cardEl(e.uid); if (!el || anim.skip) return;
        floatAt(blkAnchor(el), '+' + e.amount, 'blk gain', !shown && e.source ? T('ui.battle.blockFrom', { skill: e.source }) : '', 0); shown++;
      });
      if (shown) { cue('guard', null, 0); await wait(420, tok); }
      return;
    }
    if (st.kind === 'pow') {
      if (!POWER_LIVE_UI) return;
      evs.forEach(function (e) {
        if (ui.powStart) delete ui.powStart[e.uid];
        setPow(e.uid, e.to, e.base, !anim.skip, e.all || null);
        if (e.side === 'ally' && !anim.skip && e.delta) { var el = cardEl(e.uid); if (el) { floatAt(el, powText(e), 'pow-float ' + (e.delta > 0 ? 'up' : 'down')); shown++; } }
      });
      if (shown) await wait(320, tok);
      return;
    }
    for (var k = 0; k < evs.length; k++) await playOne(evs[k], tok); // an unknown kind: the old way
  }
  async function playRound(evs, tok) {
    tauntsThisRound = 0; evs = orderAdvisorWave(evs);
    evs = evs.filter(function (e) { return !e.replay; });
    if (quickNoArt()) evs = evs.filter(function (e) { var sp = e.kind === 'line' || e.kind === 'revenge' || e.kind === 'reckoning' ? (e.speakerId || e.id || lineSpeaker(e)) : null; return !(sp && A.isCandidate(sp) && !member(sp)); }); // 2026-11-20 快速模式「直接跳过到战斗」: the rejected girls' lines don't play // 2026-11-20: pause actions (加班条款 充能, items, swaps) were shown at the pause — don't play them twice
    var steps = RoundPlan.planRound(evs); // 修复 2026-11-13: the cutting is pure (ui/round-plan.js, tests/round-plan.test.cjs)
    if (GROUP_FX) steps = RoundPlan.groupFx(steps); // 2026-11-20: a run of one group effect → one 'fx' step
    var lnDone = 0; // 2026-11-20 阵容同步: evs[0..lnDone) 的阵容变化已推到画面上（连击 / 群体效果里夹着的，到下一个单拍前补上）
    var lnTo = function (n) { for (; lnDone < n; lnDone++) { lineupEv(evs[lnDone], false); lineupEv(evs[lnDone], true); } };
    for (var s = 0; s < steps.length; s++) {
      var st = steps[s];
      if (st.e && st.e.kind === 'phase') st.e.acts = st.acts; // 2026-11-24 用户「回合开始没有『第 N 回合 · 我方/敌方行动』」: the lineup path played the phase step before this was set → no banner
      if (ui.lineup && st.type !== 'fx' && st.type !== 'debts' && st.type !== 'chain') { var si = evs.indexOf(st.e); if (si >= 0) { lnTo(si); lineupEv(st.e, false); await playOne(st.e, tok); lineupEv(st.e, true); lnDone = si + 1; continue; } }
      if (st.type === 'fx') { upcoming = evs.slice(st.last + 1, st.last + 6); await playFxGroup(st, tok); continue; }
      if (st.type === 'debts') { await playDebts(st.debts, st.memories, tok); continue; }
      if (st.type === 'chain') { await playChain(st.group, tok); continue; }
      upcoming = evs.slice(st.i + 1, st.i + 6);
      if (st.e.kind === 'phase') st.e.acts = st.acts;
      await playOne(st.e, tok);
    }
    if (ui.lineup) lnTo(evs.length);
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
  // 2026-11-20 阵容同步: 画面按【开始阵容】（engine battle.roundStart）起画，阵容变化（入场、召唤、分裂、母体吐小史莱姆、
  // 顶位、移走、换边）只在对应事件播到时才发生（RoundPlan.lineupStep），旁边的卡平滑让位。播完一回合拿画面阵容和引擎
  // 结束阵容比对，对不上记一条 playlog（lineupMismatch）并直接对齐。?lineup=old = 旧做法（按结束阵容画卡）。
  // 新做法下今天的两个临时补丁（splitIn / SPLIT_NO_ROOM 的 pre-split、召唤那拍的 splitSlide）不再走：卡本来就不在场，
  // 到那一拍才插进来。补丁代码留着，旧做法照旧用它们。
  var LINEUP_FROM_START = Q.get('lineup') !== 'old';
  var STORY_AT = Q.get('storyAt'), storyAtId = null; // dev: start the first story at line N / the last line (用户 2026-11-21「start from end of scene 9 (last shot)」)
  var LINEUP_NO_REAPPEND = true; // false = old: lineupApply re-appends every card on every lineup step
  function laneCards() { return ['laneFoe', 'laneAlly'].reduce(function (o, id) { var l = $(id); return l ? o.concat(Array.prototype.filter.call(l.children, function (x) { return x.classList.contains('bcard'); })) : o; }, []); }
  function laneUids(id) { var l = $(id); return l ? Array.prototype.filter.call(l.children, function (x) { return x.classList.contains('bcard'); }).map(function (x) { return x.getAttribute('data-u'); }) : []; }
  // 把画面上两条阵线摆成 L 的样子：缺的卡新建（先藏着，pre-enter，等事件自己的动画亮出来），多的卡拿走，其余按顺序排，
  // 挪了位置的卡从原地平滑滑过去（FLIP，坐标一律 stagePt）
  function lineupApply(L) {
    var fl = $('laneFoe'), al = $('laneAlly'); if (!fl || !al || !L) return;
    var olds = laneCards(), before = olds.map(function (x) { return stagePt(x, 0, 0).x; }), keep = {};
    [[L.enemies, fl], [L.allies, al]].forEach(function (p) {
      // 2026-11-20 用户「单位出场的卡片动画顺序跟以前不一样」(LINEUP_NO_REAPPEND): a lane whose cards are already in this order is left
      // alone — re-appending a card restarts its CSS enter animation, so every enemyEnter replayed the ones already shown
      if (LINEUP_NO_REAPPEND && laneUids(p[1].id).join(',') === p[0].map(function (u) { return String(u.uid); }).join(',')) { p[0].forEach(function (u) { keep[u.uid] = 1; }); return; }
      p[0].forEach(function (u) {
        var el = cardEl(u.uid);
        if (!el) {
          var f = ui.field && ui.field[u.uid];
          if (!f) { f = { hp: u.hp, maxHp: u.maxHp, block: u.block || 0, charge: u.charge || 0 }; if (ui.field) ui.field[u.uid] = f; }
          var tmp = document.createElement('div'); tmp.innerHTML = battleCard(u, f.hp, true, f.block, f.charge); el = tmp.firstElementChild; if (!el) return;
        }
        keep[u.uid] = 1; p[1].appendChild(el);
      });
    });
    olds.forEach(function (x, i) {
      if (!keep[x.getAttribute('data-u')]) { x.remove(); return; }
      if (REDUCED || anim.skip || !x.animate) return;
      var dx = before[i] - stagePt(x, 0, 0).x; if (Math.abs(dx) < 0.5) return;
      x.animate([{ transform: 'translateX(' + dx.toFixed(1) + 'px)' }, { transform: 'none' }], { duration: dur(420), easing: 'cubic-bezier(.3,0,.2,1)' });
    });
  }
  // 一个事件播之前（换边：播之后，让翻卡动画自己把卡带过去）推一步阵容
  function lineupEv(e, after) {
    if (!ui.lineup || !e) return;
    if ((e.kind === 'switchSide') !== !!after) return;
    var L = RoundPlan.lineupStep(ui.lineup, e); if (L === ui.lineup) return;
    ui.lineup = L; if (e.kind !== 'down') lineupApply(L);
  }
  // 播完一回合：画面阵容 vs 引擎结束阵容；对不上 → playlog 记一条，直接对齐
  function lineupCheck(v) {
    if (!ui.lineup) return;
    var b = v.battle, want = { allies: b.allies, enemies: b.enemies };
    var have = { allies: laneUids('laneAlly').map(function (x) { return { uid: x }; }), enemies: laneUids('laneFoe').map(function (x) { return { uid: x }; }) };
    var d = RoundPlan.lineupDiff(have, want, false);
    if (d) { pl('event', 'lineupMismatch', { level: v.level, round: b.round, wave: b.wave, diff: d.slice(0, 400) }); lineupApply(RoundPlan.lineupFrom(want)); }
    ui.lineup = null;
  }
  SCREENS.battle = {
    plate: function (v) { return plate(levelText(v)); },
    html: function (v) {
      var b = v.battle, evs = (b.lastRound || []).filter(function (e) { return !e.replay; }), splitIn = {}, wasOf = {}, entering = {}, hp = {}, mx0 = {}, blk = {}; // 2026-11-20 用户「加班条款 充能后回合开始又被清掉」: pause actions already on the cards — the rewind must not undo them
      b.allies.concat(b.enemies).forEach(function (u) { hp[u.uid] = u.hp; });
      var wasList = []; (b.lastRound || []).forEach(function (e) { if (e.kind === 'summon' && !e.replay) (e.slots || []).forEach(function (s) { if (s.wasUnit) { wasList.push(s.wasUnit); hp[s.wasUnit.uid] = s.wasUnit.hp; } }); }); // 2026-11-20 L7: a card a new one replaces at the END of this round is drawn until then
      blk = RoundPlan.blockStart(evs, b.allies.concat(b.enemies)); // v38: pure (ui/round-plan.js, tests/block-sync.test.cjs)
      var chg = RoundPlan.chargeStart(evs, b.allies.concat(b.enemies)); // 充能 bars start where the round started
      evs.forEach(function (e) { if (e.kind === 'enemyEnter') entering[e.uid || (e.unit && e.unit.uid)] = e.unit || true; if (e.kind === 'summon') (e.units || []).forEach(function (u) { entering[u.uid] = u; var sl = (e.slots || []).filter(function (s) { return s.uid === u.uid; })[0]; if (sl && sl.wasUnit) { wasOf[u.uid] = sl.wasUnit; splitIn[u.uid] = 1; } else if ((e.split || e.brood) && !sl) splitIn[u.uid] = 1; }); }); // splitIn: 2026-11-20 分裂史莱姆 — a split piece takes NO room until its split beat // 2026-11-16 露西安召唤: her new minions wait hidden for their 'summon' beat
      // §4.5 a girl who turned this round still starts the round on their side; the turncoat animation carries her over
      var sw = {}; if (!replayed[(run.history || []).length]) evs.forEach(function (e) { if (e.kind === 'switchSide' || e.kind === 'turncoat') sw[e.uid] = 1; });
      var fromStart = LINEUP_FROM_START && !!b.roundStart && !replayed[(run.history || []).length]; // 2026-11-20 阵容同步: 按开始阵容起画
      ui.lineup = fromStart ? RoundPlan.lineupFrom(b.roundStart) : null;
      // 复查 2026-11-14: lane = engine B.enemies order (「最左侧」 = enemies[0] = leftmost card); no fairy-to-the-right reorder here — the data puts her last
      var foes = RoundPlan.foeLane(b.enemies, b.allies.filter(function (u) { return sw[u.uid]; }).map(function (u) { var o = {}; Object.keys(u).forEach(function (k) { o[k] = u[k]; }); o.side = 'enemy'; o.turned = false; if (!o.corruption) o.corruption = 'possessed'; return o; }));
      var allies = b.allies.filter(function (u) { return !sw[u.uid]; });
      // 入场（enemyEnter）在回合最前面（prologue），先画上、藏着（pre-enter）占好位，跟旧的入场一样；其余变化等事件播到再改
      if (fromStart) { evs.forEach(function (e) { if (e.kind === 'enemyEnter') ui.lineup = RoundPlan.lineupStep(ui.lineup, e); }); foes = ui.lineup.enemies; allies = ui.lineup.allies; splitIn = {}; wasOf = {}; } // 旧做法的换边 / 分裂补丁在这里不用
      for (var i = evs.length - 1; i >= 0; i--) { // walk back to the state before this round
        var e = evs[i];
        if (e.kind === 'action') (e.targets || []).slice().reverse().forEach(function (t) { if (t.miss || t.capped) return; /* 2026-11-15 user: walk a 连击's hits backwards too, or the first hit stays on the card before the round plays */ var before = t.kind === 'heal' ? t.hpAfter - t.amount : t.hpAfter + t.amount; hp[t.uid] = before; });
        if (e.kind === 'relic' && e.uid != null && e.hpBefore != null) hp[e.uid] = e.hpBefore;
        if (e.kind === 'badgeRevive') hp[e.uid] = 0; // 2026-11-20 旧公会徽章: before she stood up she was down
        if (e.kind === 'summon' && e.parent && e.parent.hpBefore != null) hp[e.parent.uid] = e.parent.hpBefore; // 2026-11-20 L7 母体: her hp drops at the spit beat, not before
        if (e.kind !== 'action' && Array.isArray(e.targets)) e.targets.slice().reverse().forEach(function (t) { if (!t || t.uid == null || t.hpAfter == null || t.miss) return; hp[t.uid] = t.kind === 'heal' ? t.hpAfter - (t.amount || 0) : t.hpAfter + (t.amount || 0); }); // 2026-11-16 用户「回合开始没死就别变灰」: 地震 (quake) and other non-action hits are walked back too — a girl the quake fells this round still stands when the round starts
        if (e.kind === 'memory' && e.hpWas) e.hpWas.forEach(function (w) { hp[w.uid] = w.hp; mx0[w.uid] = w.maxHp; }); // batch6 H2-14: a debt's numbers change when its dots land
      }
      ui.powStart = {}; for (var pi = evs.length - 1; pi >= 0; pi--) if (evs[pi].kind === 'pow') ui.powStart[evs[pi].uid] = evs[pi].from; // 2026-11-20b POWER_LIVE_UI: the chip starts where the round started
      ui.field = {};
      if (fromStart) b.roundStart.allies.concat(b.roundStart.enemies).forEach(function (u) { ui.field[u.uid] = { hp: u.hp, maxHp: u.maxHp, block: Math.max(0, u.block || 0), charge: Math.max(0, u.charge || 0) }; }); // 回合中途被移走的单位（结束阵容里没有）用开始时的数
      if (fromStart) foes.forEach(function (u) { if (!ui.field[u.uid]) ui.field[u.uid] = { hp: u.hp, maxHp: u.maxHp, block: Math.max(0, u.block || 0), charge: Math.max(0, u.charge || 0) }; });
      b.allies.concat(b.enemies, wasList).forEach(function (u) { var mx = mx0[u.uid] != null ? mx0[u.uid] : u.maxHp; ui.field[u.uid] = { hp: hp[u.uid], maxHp: mx, block: Math.max(0, blk[u.uid] || 0), charge: Math.max(0, chg[u.uid] || 0) }; });
      Object.keys(ui.field).forEach(function (k) { var f = ui.field[k]; f.hp = Math.min(f.maxHp, f.hp); });
      var round = b.round || 1, fz = evs.some(function (x) { return x.kind === 'frenzy'; }) ? 1 : (b.mult || bmarks.frenzy || 1);
      if (fz > 1) bmarks.frenzy = fz;
      var lv = Math.max(1, Math.round(Math.log(fz) / Math.LN2));
      return '<div class="battle' + (v.level === 11 ? ' noble' : '') + (!FOE_CARD_SHRINK ? '' : foes.length >= 8 ? ' foes-crowd' : foes.length >= 6 ? ' foes-many' : '') + '"><div class="frenzy-edge' + (fz > 1 ? ' on' : '') + '" id="frenzyEdge" style="--fz:' + Math.min(lv, 5) + '"></div>' +
        '<div class="b-top"><span class="b-pill" id="roundNo"><span class="bp-k">' + T('ui.battle.round', { n: esc(round) }) + '</span>' + (b.waveCount > 1 ? '<span class="bp-sep"></span><span>' + T('ui.battle.waveOf', { n: esc(b.wave || 1), total: esc(b.waveCount) }) + '</span>' : '') +
        (fz > 1 ? '<span class="bp-sep"></span><span class="bp-fz">' + T('ui.battle.frenzy', { n: fz }) + '</span>' : '') + '</span></div>' +
        '<span class="b-ctl vn-pass"><button class="pill-btn speed-cycle" data-act="speedCycle" data-tip="' + T('ui.battle.speedTip') + '">' + spdName(prefs.speed || 2) + '</button>' + // UI-CLEAN §2.7: one button cycles ×1 → ×2 → ×3
        '<button class="pill-btn" data-act="skip" id="skipBtn">' + T('ui.battle.skip') + '</button></span>' +
        '<div class="b-foe"><div class="lane lane-foe" id="laneFoe">' + foes.map(function (u) { var w = wasOf[u.uid], h = battleCard(u, ui.field[u.uid].hp, !!entering[u.uid], ui.field[u.uid].block, ui.field[u.uid].charge); h = SPLIT_NO_ROOM && splitIn[u.uid] ? h.replace(' pre-enter', ' pre-enter pre-split') : h; return (w ? battleCard(w, ui.field[w.uid].hp, false, ui.field[w.uid].block, ui.field[w.uid].charge) : '') + h; }).join('') + '</div></div>' +
        '<div class="b-ally"><div class="lane lane-ally" id="laneAlly">' + allies.map(function (u) { return battleCard(mx0[u.uid] != null ? A.withMaxHp(u, mx0[u.uid]) : u, ui.field[u.uid].hp, false, ui.field[u.uid].block, ui.field[u.uid].charge); }).join('') + '</div></div>' +
        '<div id="pauseWrap" class="pause-wrap"></div><div id="resultWrap"></div></div>';
    },
    enter: function (v) { battleFlow(v); }
  };
  SCREENS.battleResult = SCREENS.battle;
  async function battleFlow(v) {
    var tok = anim.token, hk = (run.history || []).length;
    // 2026-11-16 猎人锁定: the 准星 as the round starts. A decoration: it must never stop the round from playing (anything
    // thrown here, outside the try below, used to leave the battle screen frozen), so it is guarded.
    try { syncAim(replayed[hk] ? RoundPlan.aimMarks(v.battle.allies) : RoundPlan.aimStart(v.battle.lastRound, v.battle.allies)); } catch (err) { console.error('aim marks failed', err); }
    try {
      if (pendingAnnounce) { var an = pendingAnnounce; pendingAnnounce = null; ui.announced = true; announce(an); await wait(1300, tok); }
      if (!replayed[hk]) {
        var first = (v.battle.lastRound || []).some(function (e) { return e.kind === 'enemyEnter' && (e.wave || 1) === 1; });
        if (first && !anim.skip && titleGate(v.level, 'battleIntro')) await playIntro(v, tok); // 叙事节奏 2026-11-13: the scene intro's level card is the opening card; 「战斗 · xx · 开始！」 only if it never showed (old saves)
        var evs1 = A.onceFilter(run, v.battle.lastRound || []); if ((v.battle.lastRound || []).some(function (e) { return e && e.once; })) save(); // 2026-11-14 第 11 关小铃登场: once per run, never on a reload
        try { await playRound(evs1, tok); } catch (err) { if (err === CANCEL) throw err; console.error('battle animation failed; showing the end state', err); document.body.classList.remove('fx-top'); }
        replayed[hk] = true; syncField(v); lineupCheck(v); // 2026-11-20 阵容同步: 画面阵容 = 引擎结束阵容？
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
    v.battle.allies.concat(v.battle.enemies).forEach(function (u) { var el = cardEl(u.uid); if (!el) return; el.classList.remove('pre-enter', 'pre-split', 'acting'); el.classList.toggle('down', u.hp <= 0); if (ui.field && ui.field[u.uid]) ui.field[u.uid].maxHp = u.maxHp; setHp(u.uid, u.hp); if (u.hp > 0) setBlock(u.uid, u.block || 0); if (POWER_LIVE_UI && u.pow != null) setPow(u.uid, u.pow, u.powBase, false, u.powParts || []); }); // batch6 H2-14: max hp too · v38: the 护甲 badge too (it used to keep a stale number next to the end-state hp) · 2026-11-20b: 威力 too
    v.battle.allies.concat(v.battle.enemies).forEach(function (u) { var el = cardEl(u.uid), row = el && el.querySelector('.st-row'); if (row) row.innerHTML = statusIcons(u.statuses, u.side); }); // 2026-11-24 用户「灼烧怎么又没显示——第 8 关」: the status row follows the round's end state (灼烧 / 焚痕 / 祝福 …)
    if (ui.powStart) ui.powStart = {};
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
  // ===== 2026-11-19 意图预告 (docs/SPEC-damage-spread.md §4): drawn only — no text on the icons; the words are in the tips =====
  // RoundPlan.intentOf(view) is the adapter (engine fields → { list, aimed }); intentRemap follows the formation's local order.
  var INTENT_ALL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"/><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".85"/><circle cx="12" cy="12" r="10.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2.4" opacity=".6"/></svg>';
  var INTENT_HEAL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" stroke="rgba(0,0,0,.45)" stroke-width="1"/></svg>';
  var INTENT_AIM_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  function intentUnit(key) { return bUnits().filter(function (x) { return String(x.uid) === String(key) || String(x.id) === String(key); })[0] || null; }
  function intentName(key) { var u = intentUnit(key), m = !u ? member(key) : null; if (isLeader(u || m || key)) return T('ui.name.you'); return (u && u.name) || (m && m.name) || nameOf(key); }
  function intentFace(key, foe) { // a small face of the girl (or, for a heal, the enemy) it aims at; no alt / letter fallback (names are in the tip)
    var u = intentUnit(key), id = u ? u.id : key;
    if (foe) return u ? '<span class="it-face foe">' + pic(unitArt(u).list, '', '', '') + '</span>' : '';
    var list = isLeader(u || id) ? A.face('leader', 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }) : A.face(id, 'calm');
    return '<span class="it-face">' + pic(list, '', '', '') + '</span>';
  }
  function intentTip(it) {
    var rule = T('ui.intent.rule.' + it.kind);
    if (it.kind === 'heal' && !it.targets.length) return rule; // 2026-11-19 spread: the engine's heal names nobody
    if (it.kind === 'heal') return T('ui.intent.tipHeal', { who: it.targets.map(intentName).join(T('ui.intent.sep')), rule: rule });
    if (it.all) return T('ui.intent.tipAll', { rule: rule });
    return T('ui.intent.tip', { who: it.targets.map(intentName).join(T('ui.intent.sep')), rule: rule });
  }
  function intentHtml(it) { // '' when there is nothing to draw
    if (!it) return '';
    var body = '';
    if (it.kind === 'heal') { body = '<span class="it-shape heal">' + INTENT_HEAL_SVG + '</span>' + it.targets.slice(0, 2).map(function (k) { return intentFace(k, true); }).join(''); }
    else if (it.all) body = '<span class="it-shape all">' + INTENT_ALL_SVG + '</span>';
    else if (it.targets.length) body = it.targets.slice(0, 3).map(function (k) { return intentFace(k, false); }).join('');
    if (!body) return '';
    return '<span class="intent-row ik-' + esc(it.kind) + '" data-tip="' + esc(intentTip(it)) + '">' + body + '</span>';
  }
  function aimedHtml(n) { if (!AIMED_MARK_UI) return ''; /* 2026-11-19 用户亲测 界面: hidden */ return n > 0 ? '<span class="aimed-mark" data-tip="' + esc(T(n > 1 ? 'ui.intent.aimedTipN' : 'ui.intent.aimedTip', { n: n })) + '">' + INTENT_AIM_SVG + (n > 1 ? '<b class="am-n">' + n + '</b>' : '') + '</span>' : ''; }
  function intentRows(it) { return '<div class="rows intent-rows"><div class="r intent"><span class="rk">' + T('ui.intent.row') + '</span><span class="rv">' + esc(intentTip(it)) + '</span></div></div>'; }
  // the battle pause: put the marks on the cards in place (the next render — the round playing — rebuilds the cards without them)
  function intentDecorate(v) {
    app.querySelectorAll('.intent-row, .aimed-mark').forEach(function (n) { n.remove(); });
    if (!INTENT_UI || !v || !v.battle) return;
    var I = RoundPlan.intentOf(v); if (I.src !== 'battle') return;
    I.list.forEach(function (it) {
      var card = cardEl(it.key) || cardById(it.id), art = card && card.querySelector('.uc-art'); if (!art || card.classList.contains('down')) return;
      var h = intentHtml(it); if (h) art.insertAdjacentHTML('beforeend', h);
      if (card.dataset.rich && card.dataset.rich.indexOf('intent-rows') < 0) card.dataset.rich += intentRows(it);
    });
    Object.keys(I.aimed).forEach(function (k) { var card = cardEl(k) || cardById(k); if (card && !card.classList.contains('down')) card.insertAdjacentHTML('beforeend', aimedHtml(I.aimed[k])); });
  }
  // the formation (出发前布阵): round 1, re-picked by the local order as the player moves her girls (render() on every move)
  function withAimed(o, PI, id) { o.aimed = PI ? PI.aimed[id] || 0 : 0; return o; } // the formation card's opts + its 准星 count
  function intentPrep(v) {
    if (!INTENT_UI || !PRE_INTENT_UI || !v) return null; // 2026-11-19 用户亲测 界面: no intent before the battle
    var I = RoundPlan.intentOf(v); if (I.src !== 'pre') return null;
    return RoundPlan.intentRemap(I, (v.party || []).map(function (m) { return m.id; }), ui.order || []);
  }
  // 2026-11-19 换位/暂停连做: again = the same pause after a pause action (PAUSE_MULTI): the bar is rebuilt (spent buttons
  // greyed), the marks redrawn, but no pause sound, no new 继续 guard and no auto-continue timer
  function showPause(v, again) {
    var p = v.battle.pause || {}, sk = p.advisorSkill, items = p.items || [], w = $('pauseWrap'); if (!w) return;
    ui.mode = null; if (!again) { cue('pause', null, 400); ui.pauseSeq = (ui.pauseSeq || 0) + 1; ui.pauseDid = 0; }
    w.innerHTML = '<div class="pausebar panel">' +
      '<button class="pbtn" data-act="pMove"' + (p.move === false ? ' disabled' : '') + ' data-tip="' + T(p.swapCost ? 'ui.pause.moveTipSwap' : 'ui.pause.moveTip') + '">' + '<span class="pb-ic">⇄</span><b>' + T('ui.pause.move') + '</b></button>' +
      (sk ? '<button class="pbtn' + (sk.used ? ' used' : '') + '" data-act="pSkill"' + (sk.available ? '' : ' disabled') + ' data-tip="' + esc((sk.name ? T('ui.battle.skillTitle', { name: sk.name }) : '') + (sk.text || '') + T(sk.used ? 'ui.pause.skillUsed' : 'ui.pause.skillOnce')) + '"><span class="pb-ic face">' + pic(A.face(v.advisor && v.advisor.id, 'calm'), '', '', '') + '</span><b>' + T('ui.pause.advisor') + '</b><small>' + esc(sk.name || '') + '</small></button>'
        : '<button class="pbtn" disabled data-tip="' + T('ui.pause.advisorGoneTip') + '"><span class="pb-ic">✦</span><b>' + T('ui.pause.advisor') + '</b><small>' + T('ui.common.none') + '</small></button>') +
      '<button class="pbtn" data-act="pItem"' + (items.length ? '' : ' disabled') + ' data-tip="' + T('ui.pause.itemTip') + '"><span class="pb-ic">✚</span><b>' + T('ui.pause.item') + '</b><small>' + items.length + ' / 3</small></button>' +
      // 2026-11-15 user: 战报 removed (「太奇怪了」) — the per-number hover tip and the panel's 「怎么算」 stay
      '<button class="pbtn go" data-act="pContinue"><span class="pb-ic">▶</span><b>' + T('ui.common.continue') + '</b></button>' +
      '</div><div class="pause-sub" id="pauseSub"></div>' + (v.battle.opening ? '<div class="pause-open">' + T('ui.pause.opening') + '</div>' : '') +
      (p.multi && p.acted ? '<div class="pause-open pause-more">' + T('ui.pause.moreHint') + '</div>' : ''); // 2026-11-19 换位/暂停连做 // 2026-11-16 开场暂停 · UI-CLEAN §2.8: 自动继续 is a ☰ 游戏组 switch now (prefs.autoCont)
    // v2.4 [15] root cause: the 继续 button used to take focus here, so the keyup of the Space / Enter that closed the round's
    // last line (or a key held through the animation) "clicked" it and the pause was skipped. Nothing takes focus now, and
    // 继续 ignores input that started before the bar was up (see pauseReady).
    try { aimButtons(v); syncAim(RoundPlan.aimMarks(v.battle.allies)); } catch (err) { console.error('aim buttons failed', err); } // never blocks the pause
    try { healButtons(v); syncHealMarks(v); } catch (err) { console.error('heal buttons failed', err); } // 2026-11-20 牧师治疗: never blocks the pause
    try { intentDecorate(v); } catch (err) { console.error('intent marks failed', err); } // 2026-11-19 意图预告: never blocks the pause
    var ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur();
    if (again) return;
    ui.pauseAt = nowMs(); ui.keysDown = {};
    // 2026-11-16: the opening pause (before round 1) never auto-continues; a pause where a hunter can aim waits 2 s (RoundPlan.autoContMs)
    var acMs = RoundPlan.autoContMs(v.battle, spd());
    var seq = ui.pauseSeq; // 2026-11-19 换位/暂停连做: never fires once the player did something at this pause (or in a later pause)
    if (prefs.autoCont && acMs != null) later(function () { if (!vnActive() && view && view.phase === 'battle' && !ui.mode && !ui.pauseDid && ui.pauseSeq === seq) autoContinue(); }, acMs);
  }
  // ===== 2026-11-19 换位/暂停连做 (PAUSE_MULTI, engine pause.multi): a pause action (item / advisor skill / the one swap) lands
  // without a round: like doAim the screen is updated in place (no render → the last round is never replayed): the ally lane is
  // rebuilt from the new view (order after a swap, hp / 护甲 / 充能 / statuses after an item), the bar and the marks are redrawn,
  // and the announcement is a toast right away. Only 继续 plays the round (its events come first in that round).
  function pauseMulti() { return !!(view && view.battle && view.battle.pause && view.battle.pause.multi); }
  function refreshAllyLane(v) {
    var lane = $('laneAlly'); if (!lane || !v.battle) return;
    var allies = v.battle.allies.filter(function (u) { return u.side !== 'enemy'; });
    ui.field = ui.field || {};
    allies.forEach(function (u) { ui.field[u.uid] = { hp: u.hp, maxHp: u.maxHp, block: Math.max(0, u.block || 0), charge: Math.max(0, u.charge || 0) }; });
    lane.innerHTML = allies.map(function (u) { return battleCard(u, u.hp, false, ui.field[u.uid].block, ui.field[u.uid].charge); }).join('');
    allies.forEach(function (u) { var el = cardEl(u.uid); if (el) el.classList.toggle('down', u.hp <= 0); });
  }
  function doPauseAct(action, an) {
    var ACT_CUE = { move: 'move', useItem: 'item', advisorSkill: 'advisorSkill' }; if (ACT_CUE[action.type]) cue(ACT_CUE[action.type], null, 0);
    action.meta = tracker.finish();
    var prev = run, prevView = view;
    try { run = E.act(DATA, run, action); } catch (e) { pl('actFail', action, prevView, e && e.message, e && e.stack, (function () { try { return JSON.stringify(run); } catch (x) { return null; } })()); pl('devSave', 'err-' + action.type); /* 2026-11-20: a rejected action saves the playlog at once */ notice(T('ui.notice.actRejected', { error: e && e.message })); ui.acted = 0; return false; }
    recordTelemetry(action, prev);
    save(); replayed[(run.history || []).length] = true; // the same pause: a later render never replays the old round
    try { view = E.view(DATA, run); } catch (e) { /* keep the old view */ }
    pl('act', action, prevView, view);
    if (prevView && prevView.phase === 'battle' && view && view.phase !== 'battle') pl('devSave', 'battle-L' + (view.level || 0), run, PROFILE); // 2026-11-20 战报后存 playlog
    ui.pauseDid = 1; ui.moveSel = null; ui.item = null; pendingAnnounce = null;
    pauseMode(null);
    if (view && view.battle) {
      try { refreshAllyLane(view); } catch (err) { console.error('ally lane refresh failed', err); }
      showPause(view, true);
    }
    if (an) announce(an);
    return true;
  }
  function nowMs() { return window.performance && performance.now ? performance.now() : Date.now(); } // the dev driver freezes Date.now
  function setSpeed(n) {
    prefs.speed = n; lsSet(PKEY, prefs);
    document.querySelectorAll('[data-act="speed"]').forEach(function (b) { b.classList.toggle('on', +b.dataset.s === prefs.speed); });
    document.querySelectorAll('[data-act="speedCycle"]').forEach(function (b) { b.textContent = spdName(prefs.speed); });
  }
  // 2026-11-22 试玩 (AUTO_POTION): with 战斗自动继续 on, a pause first gives a heal potion (回血药 / 大回血药) to the living ally lowest
  // under AUTO_POTION_AT of her 生命上限 (the big one when she is missing more than the small one heals). false = old: just 继续
  var AUTO_ARMOR = true; // 2026-11-22g 试玩7 #16 (see autoPotion); false = old (heal potions only)
  var AUTO_POTION = true, AUTO_POTION_AT = 0.3, AUTO_POTION_IDS = { potion: 10, 'potion-big': 25 };
  function autoPotion() {
    var b = view && view.battle, p = (b && b.pause) || {}; if (!b) return false;
    // 2026-11-22 试玩「全队倒光时复活药还在包里」: a fallen ally + a 复活药 in the bag → revive her first (the one with the biggest 生命上限)
    var rv = (p.items || []).filter(function (it) { return it.itemId === 'revive'; })[0], fallen = (b.allies || []).filter(function (u) { return u.side !== 'enemy' && !u.turned && u.hp <= 0; }).sort(function (x, y) { return y.maxHp - x.maxHp; })[0];
    if (rv && fallen) { var ra = { type: 'useItem', itemId: 'revive', target: fallen.uid != null ? fallen.uid : fallen.id }; if (pauseMulti()) return doPauseAct(ra, { title: rv.name, sub: fallen.name }) ? 'multi' : false; ui.acted = 1; pendingAnnounce = { title: rv.name, sub: fallen.name }; doAct(ra, true); return 'round'; }
    var pots = (p.items || []).filter(function (it) { return AUTO_POTION_IDS[it.itemId] && it.target !== 'enemy' && it.target !== 'fallen'; });
    // 2026-11-22g 试玩7 #16 AUTO_ARMOR: no heal potion in the bag → a 护甲药 goes to the low one instead (old ui menu.autoContNote: 「打开后战斗每回合自动继续（默认关闭）」)
    var armor = AUTO_ARMOR && !pots.length ? (p.items || []).filter(function (it) { return it.itemId === 'armor-potion'; })[0] : null;
    if (!pots.length && !armor) return false;
    var low = (b.allies || []).filter(function (u) { return u.side !== 'enemy' && !u.turned && u.hp > 0 && u.maxHp > 0 && u.hp < u.maxHp * AUTO_POTION_AT; })
      .sort(function (x, y) { return x.hp / x.maxHp - y.hp / y.maxHp; })[0];
    if (!low) return false;
    if (armor) { var aa = { type: 'useItem', itemId: armor.itemId, target: low.uid != null ? low.uid : low.id }; if (pauseMulti()) return doPauseAct(aa, { title: armor.name, sub: low.name }) ? 'multi' : false; ui.acted = 1; pendingAnnounce = { title: armor.name, sub: low.name }; doAct(aa, true); return 'round'; }
    var miss = low.maxHp - low.hp, big = pots.filter(function (it) { return it.itemId === 'potion-big'; })[0], small = pots.filter(function (it) { return it.itemId === 'potion'; })[0];
    var it = big && (miss > AUTO_POTION_IDS.potion || !small) ? big : small || big, act = { type: 'useItem', itemId: it.itemId, target: low.uid != null ? low.uid : low.id };
    if (pauseMulti()) return doPauseAct(act, { title: it.name, sub: low.name }) ? 'multi' : false;
    ui.acted = 1; pendingAnnounce = { title: it.name, sub: low.name }; doAct(act, true); return 'round'; // the old one-thing pause: the potion plays the round
  }
  function autoContinue() {
    if (ui.acted || ui.pauseDid) return;
    if (AUTO_POTION) { var pr = autoPotion(); if (pr === 'round') return; if (pr === 'multi') ui.pauseDid = 0; }
    ui.acted = 1; /* 2026-11-19 换位/暂停连做: never mid-sequence */ doAct({ type: 'continue' }, true);
  }
  // a real click / key counts only once the bar has been up a moment and the key was pressed after it appeared
  function pauseReady(e) { return !e || !e.isTrusted || (ui.pauseAt && nowMs() - ui.pauseAt > 450); }
  function pauseMode(mode, html) {
    ui.mode = mode; var s = $('pauseSub'), bar = app.querySelector('.pausebar');
    if (bar) bar.classList.toggle('moding', !!mode);
    app.querySelector('.battle').dataset.mode = mode || '';
    app.querySelector('.battle').dataset.itemAim = (mode === 'itemTarget' && ui.item && ui.item.target) || ''; // 2026-11-22 which cards glow: ally / enemy / fallen
    s.innerHTML = mode ? '<div class="psub panel">' + html + '<button class="btn-ghost" data-act="pCancel">' + T('ui.common.cancel') + '</button></div>' : '';
    // 2026-11-20 用户: pick → 取消 left her grey (.dragging from a native drag that never ended) and the next swap broke —
    // a mode change now clears every pick mark (sel / dragging) and the drag id, not only .sel
    app.querySelectorAll('.bcard.ally').forEach(function (c) { c.classList.remove('sel', 'dragging'); c.draggable = mode === 'move'; });
    ui.dragId = null; moveArrows(false); // 2026-11-24 SWAP_ANY_UI: a mode change takes the ⬇ buttons away
    if (mode !== 'move') ui.moveSel = null; // 2026-11-19 换位/暂停连做: leaving the move mode drops a half-made pick
    if (mode !== 'aim') { ui.aimBy = null; app.querySelectorAll('.aim-btn.on').forEach(function (b) { b.classList.remove('on'); }); }
    if (mode !== 'heal') { ui.healBy = null; app.querySelectorAll('.heal-btn.on').forEach(function (b) { b.classList.remove('on'); }); }
  }
  // ===== 2026-11-16 猎人锁定 (setAim, 用户「猎人默认打最左边；暂停里可以给她锁定一个敌人」) =====
  // In a pause each hunter in battle.pause.canAim gets a 准星 button on her card: tap it → every living foe shows a 准星 →
  // tap one = setAim (tap the locked one again, or 「取消锁定」 = target null, back to 最左边). Setting the aim is free (it does not
  // use up the pause), so the screen is not re-rendered (that would replay the round): run / view update in place and the marks
  // move. The locked foe carries a 准星 with the hunter's face in the corner; none when nothing is locked (最左边 needs no hint).
  var AIM_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="20" cy="20" r="3" fill="currentColor"/><path d="M20 2v9M20 29v9M2 20h9M29 20h9" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
  var aimNow = {}; // hunter key → foe uid, as shown
  function aimFace(key) { var u = bUnits().filter(function (x) { return x.uid === key || x.id === key; })[0]; return u ? (isLeader(u) ? A.face('leader', 'calm') : A.face(u.id, 'calm')) : null; }
  function syncAim(marks, slideKey) {
    marks = marks || {};
    var old = {}; app.querySelectorAll('.aim-mark').forEach(function (m) { old[m.dataset.by] = m.parentNode ? stagePt(m.parentNode, 0.5, 0) : null; m.remove(); });
    var per = {};
    Object.keys(marks).forEach(function (key) {
      var card = cardEl(marks[key]); if (!card || card.classList.contains('down')) return;
      var n = per[marks[key]] = (per[marks[key]] || 0) + 1, face = aimFace(key);
      var m = document.createElement('div'); m.className = 'aim-mark' + (n > 1 ? ' aim-2' : ''); m.dataset.by = key;
      m.dataset.tip = T('ui.battle.aimTip', { name: (bUnits().filter(function (x) { return x.uid === key || x.id === key; })[0] || {}).name || '' });
      m.innerHTML = '<span class="aim-x">' + AIM_SVG + '</span>' + (face ? '<span class="aim-face">' + pic(face, '', '', '') + '</span>' : '');
      card.appendChild(m);
      var from = old[key];
      if (from && key === slideKey && m.animate && !REDUCED && !anim.skip) { var to = stagePt(card, 0.5, 0); m.animate([{ transform: 'translate(calc(-50% + ' + (from.x - to.x) + 'px),' + (from.y - to.y) + 'px)' }, { transform: 'translate(-50%, 0)' }], { duration: dur(420), easing: 'cubic-bezier(.3,.7,.3,1)' }); }
      else if (!from && m.animate && !REDUCED && !anim.skip) m.animate([{ transform: 'translate(-50%, 0) scale(1.6)', opacity: 0 }, { transform: 'translate(-50%, 0)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
    });
    aimNow = marks;
  }
  function aimButtons(v) {
    app.querySelectorAll('.aim-btn').forEach(function (b) { b.remove(); });
    RoundPlan.canAimKeys(v.battle.allies, (v.battle.pause || {}).canAim).forEach(function (h) {
      var card = cardEl(h.key) || cardById(h.id); if (!card || card.classList.contains('down')) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'aim-btn' + (AIM_BTN_TOP_MID ? ' top-mid' : '') + (h.aim != null ? ' locked' : ''); b.dataset.act = 'aimPick'; b.dataset.key = h.key; b.dataset.id = h.id;
      b.dataset.tip = T(h.aim != null ? 'ui.pause.aimTipLocked' : 'ui.pause.aimTip'); b.innerHTML = AIM_SVG; card.appendChild(b);
    });
  }
  function doAim(hunterId, target) {
    var prevView = view, action = { type: 'setAim', id: hunterId, target: target == null ? null : target };
    try { run = E.act(DATA, run, action); } catch (e) { pl('actFail', action, prevView, e && e.message, e && e.stack, (function () { try { return JSON.stringify(run); } catch (x) { return null; } })()); pl('devSave', 'err-' + action.type); /* 2026-11-20: a rejected action saves the playlog at once */ notice(T('ui.notice.actRejected', { error: e && e.message })); ui.acted = 0; return false; } // 2026-11-16: a rejected action must not lock the pause (ui.acted stayed 1 → every button dead)
    save(); replayed[(run.history || []).length] = true; // the same round: never replayed by a later render
    try { view = E.view(DATA, run); } catch (e) { /* keep the old view */ }
    pl('act', action, prevView, view);
    cue('pick', null, 0); pauseMode(null);
    if (view && view.battle) { aimButtons(view); syncAim(RoundPlan.aimMarks(view.battle.allies), null); }
    return true;
  }
  function aimFoeClick(card) { // a foe card while picking: lock (or unlock the locked one)
    if (ui.mode !== 'aim' || !ui.aimBy || !card.classList.contains('foe') || card.classList.contains('down') || ui.acted) return false;
    var h = RoundPlan.canAimKeys(view.battle.allies, (view.battle.pause || {}).canAim).filter(function (x) { return x.key === ui.aimBy; })[0]; if (!h) return false;
    doAim(h.id, RoundPlan.aimToggle(h.aim, card.dataset.u)); return true;
  }
  // ===== 2026-11-20 牧师治疗 (setHealTargets, 用户批准): like the hunter's 准星 — a 十字 button on the priest's card at a pause;
  // tap it, then tap allies in order: each tap adds her to the list (tap a picked one again = take her out), up to n (her shares).
  // 「自动」 = no picks (the triage rule). Free, like setAim: run / view update in place. Picks show as small numbered badges.
  var HEAL_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M15 5h10v10h10v10H25v10H15V25H5V15h10z" fill="currentColor" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/></svg>';
  function healPriests(v) { var c = (v && v.battle && v.battle.pause && v.battle.pause.canHealPick) || []; return (v.battle.allies || []).filter(function (u) { return u && (c.indexOf(u.uid) >= 0 || c.indexOf(u.id) >= 0); }); }
  function healKey(u) { return u.uid != null ? u.uid : u.id; }
  function healButtons(v) {
    app.querySelectorAll('.heal-btn').forEach(function (b) { b.remove(); });
    if (!HEAL_PICK_UI) return;
    healPriests(v).forEach(function (u) {
      var card = cardEl(healKey(u)) || cardById(u.id); if (!card || card.classList.contains('down')) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'heal-btn' + ((u.healPick || []).length ? ' locked' : ''); b.dataset.act = 'healPick'; b.dataset.key = healKey(u);
      b.dataset.tip = u.healRule || ''; b.innerHTML = HEAL_SVG; card.appendChild(b);
    });
  }
  function syncHealMarks(v) {
    app.querySelectorAll('.heal-mark').forEach(function (m) { m.remove(); });
    if (!HEAL_PICK_UI || !v || !v.battle) return;
    var per = {};
    healPriests(v).forEach(function (u) {
      (u.healPick || []).forEach(function (id, i) {
        var card = cardEl(id); if (!card || card.classList.contains('down')) return;
        var k = per[id] = (per[id] || 0) + 1;
        var m = document.createElement('div'); m.className = 'heal-mark' + (k > 1 ? ' heal-2' : ''); m.dataset.by = healKey(u);
        m.innerHTML = HEAL_SVG + '<b>' + (i + 1) + '</b>'; card.appendChild(m);
      });
    });
  }
  function doHealPick(priestId, targets) {
    var prevView = view, action = { type: 'setHealTargets', id: priestId, targets: targets.slice() };
    try { run = E.act(DATA, run, action); } catch (e) { pl('actFail', action, prevView, e && e.message, e && e.stack, (function () { try { return JSON.stringify(run); } catch (x) { return null; } })()); pl('devSave', 'err-' + action.type); /* 2026-11-20: a rejected action saves the playlog at once */ notice(T('ui.notice.actRejected', { error: e && e.message })); ui.acted = 0; return false; }
    save(); replayed[(run.history || []).length] = true; // the same round: never replayed by a later render
    try { view = E.view(DATA, run); } catch (e) { /* keep the old view */ }
    pl('act', action, prevView, view);
    cue('pick', null, 0);
    if (view && view.battle) { healButtons(view); syncHealMarks(view); var b = app.querySelector('.heal-btn[data-key="' + sel(ui.healBy) + '"]'); if (b) b.classList.add('on'); }
    return true;
  }
  function healPriestNow() { return view && view.battle ? healPriests(view).filter(function (u) { return healKey(u) === ui.healBy; })[0] : null; }
  function healAllyClick(card) { // an ally card while picking: add her (or take her out)
    if (ui.mode !== 'heal' || !ui.healBy || !card.classList.contains('ally') || card.classList.contains('down') || ui.acted) return false;
    var u = healPriestNow(); if (!u) return false;
    var cur = (u.healPick || []).slice(), id = card.dataset.u, i = cur.indexOf(id), n = u.healN || 1;
    if (i >= 0) cur.splice(i, 1); else if (cur.length < n) cur.push(id); else if (n === 1) cur = [id]; /* 重点照顾: another tap moves it */ else return true;
    doHealPick(u.uid != null ? u.uid : u.id, cur);
    if (cur.length >= n && i < 0) pauseMode(null);
    return true;
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
    if (b.stats && b.stats.allies) { if (RESULT_ROWS) resultRows(v, w, win); else resultStats(v, w, win); resultLevelUps(v); return; } // 2026-11-19 用户亲测 界面
    if (b.maxChain == null) b.maxChain = (b.log || b.lastRound || []).reduce(function (m, e) { return e.kind === 'chainEnd' || (e.kind === 'chain' && !e.missed) ? Math.max(m, e.depth || 0) : m; }, 0);
    if (!b.mvp && b.dps) b.mvp = Object.keys(b.dps).filter(function (id) { return member(id); }).sort(function (x, y) { return (b.dps[y].damage || 0) - (b.dps[x].damage || 0); })[0];
    var mvp = b.mvp ? (member(b.mvp) || { id: b.mvp, name: nameOf(b.mvp) }) : null;
    w.innerHTML = '<div class="result-wrap"><div class="result paper">' + heading(T(win ? 'ui.result.win' : 'ui.result.lose'), (b.rounds || b.round) ? T('ui.result.rounds', { n: b.rounds || b.round }) : '', win ? 'laurel' : 'grim') +
      (b.maxChain ? '<p class="chain-sum">' + T('ui.result.maxChain') + ' <b>×' + esc(b.maxChain) + '</b></p>' : '') +
      (mvp ? '<div class="mvp"><span class="mvp-face">' + pic(isLeader(mvp) ? A.face('leader', 'happy') : A.face(mvp.id, 'happy'), '', mvp.name, isLeader(mvp) ? crestHtml(true) : initialHtml(mvp.name)) + '</span><img class="crown" src="' + esc(A.icon('dps-crown')) + '" alt=""><b>' + esc(isLeader(mvp) ? T('ui.name.you') : mvp.name) + '</b></div>' : '') +
      '<div class="actions"><button class="btn btn-primary btn-lg" data-act="battleContinue">' + (win ? T('ui.common.continue') : '……') + '</button></div></div></div>'; // UI-CLEAN §2.9: 改判胜利 is in ☰ 试玩作弊 · v39: 战报 beside 继续
    resultUp(w);
  }
  // ===== v2.3 battle §D8 [5]: one clean stats table (per ally: damage, healing, taken, kills, longest 加成; MVP crown; rounds) =====
  function resultStats(v, w, win) {
    var b = v.battle, s = b.stats, rows = (s.allies || []).slice();
    var mvpKey = s.mvp && typeof s.mvp === 'object' ? (s.mvp.uid || s.mvp.id) : s.mvp;
    if (mvpKey == null && !('mvp' in s) && rows.length) mvpKey = rows.slice().sort(function (x, y) { return ((y.damage || 0) + (y.healed || 0)) - ((x.damage || 0) + (x.healed || 0)); })[0].uid;
    var rounds = s.rounds || b.rounds || b.round, best = rows.reduce(function (m, r) { return Math.max(m, r.extra || 0); }, 0);
    var COLS = ['damage', 'healed', 'taken', 'kills', 'extra'].map(function (k) { return [k, T('ui.result.col.' + k)]; });
    var xpCol = XP_IN_REPORT && b.xp && typeof b.xp === 'object'; // 2026-11-19 战报 XP 栏 (older saves: no b.xp, no column)
    var body = rows.map(function (r) {
      var id = r.id, lead = isLeader(id), mvp = mvpKey != null && (r.uid === mvpKey || r.id === mvpKey), m = member(id) || {}, nm = lead ? T('ui.name.you') : (r.name || m.name || nameOf(id));
      var face = pic(lead ? A.face('leader', mvp ? 'happy' : 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }) : A.face(id, mvp ? 'happy' : 'calm'), '', nm, lead ? crestHtml(true) : initialHtml(nm));
      return '<tr class="' + (mvp ? 'is-mvp' : '') + '"><td><div class="rs-who"><span class="rs-face">' + face + '</span><b>' + esc(nm) + '</b>' +
        (mvp ? '<img class="rs-crown" src="' + esc(A.icon('dps-crown')) + '" alt="" data-tip="' + T('ui.result.mvpTip') + '">' : '') + '</div></td>' +
        COLS.map(function (c) { var n = r[c[0]] || 0; return '<td class="num' + (n === 0 ? ' zero' : '') + (c[0] === 'extra' && n && n === best ? ' best' : '') + '">' + esc(n) + '</td>'; }).join('') +
        (xpCol ? resultXpCell(b.xp[id]) : '') + '</tr>';
    }).join('');
    w.innerHTML = '<div class="result-wrap"><div class="result paper rs-panel">' + heading(T(win ? 'ui.result.win' : 'ui.result.lose'), rounds ? T('ui.result.roundsTotal', { n: rounds }) : '', win ? 'laurel' : 'grim') +
      '<table class="rs-table"><thead><tr><th></th>' + COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + (xpCol ? '<th class="rs-xp-h">' + T('ui.result.col.xp') + '</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="actions"><button class="btn btn-primary btn-lg" data-act="battleContinue">' + (win ? T('ui.common.continue') : '……') + '</button></div></div></div>'; // UI-CLEAN §2.9: 改判胜利 is in ☰ 试玩作弊 · v39: 战报 beside 继续
    resultUp(w);
  }
  // ===== 2026-11-19 用户亲测 界面: 战报 (「改成一行一行，每人一行，显示经验、升级；升级的人旁边有一个按钮」) =====
  // One row per member: face + name (+ MVP crown) · 伤害 / 治疗 / 承伤 / 击倒 under one header line (horizontal words, tips) ·
  // 经验 +N and a small bar (A.xpSpan) · 「升级」 when she leveled, opening her 升级页. The old table: resultStats (RESULT_ROWS false).
  var RR_COLS = ['damage', 'healed', 'taken', 'kills'];
  function resultMvpKey(s, rows) {
    var k = s.mvp && typeof s.mvp === 'object' ? (s.mvp.uid || s.mvp.id) : s.mvp;
    if (k == null && !('mvp' in s) && rows.length) k = rows.slice().sort(function (x, y) { return ((y.damage || 0) + (y.healed || 0)) - ((x.damage || 0) + (x.healed || 0)); })[0].uid;
    return k;
  }
  function resultRows(v, w, win) {
    var b = v.battle, s = b.stats, rows = (s.allies || []).slice(), mvpKey = resultMvpKey(s, rows), rounds = s.rounds || b.rounds || b.round;
    var xp = b.xp && typeof b.xp === 'object' ? b.xp : null;
    var head = '<div class="rr-row rr-head" aria-hidden="true"><span></span><span></span>' + RR_COLS.map(function (k) { return '<span class="rr-h" data-tip="' + esc(T('ui.result.col.' + k + 'Tip')) + '">' + esc(T('ui.result.col.' + k)) + '</span>'; }).join('') +
      (xp ? '<span class="rr-h rr-h-xp" data-tip="' + esc(T('ui.result.col.xpTip')) + '">' + esc(T('ui.result.col.xp')) + '</span><span></span>' : '') + '</div>';
    var body = rows.map(function (r) {
      var id = r.id, lead = isLeader(id), mvp = mvpKey != null && (r.uid === mvpKey || r.id === mvpKey), m = member(id) || {}, nm = lead ? T('ui.name.you') : (r.name || m.name || nameOf(id));
      var face = pic(lead ? A.face('leader', mvp ? 'happy' : 'calm', { variant: actNo() >= 3 ? 'worn' : 'base' }) : A.face(id, mvp ? 'happy' : 'calm'), '', nm, lead ? crestHtml(true) : initialHtml(nm));
      var g = xp ? xp[id] : null, up = !!(g && (g.up > 0 || g.over > 0));
      return '<div class="rr-row' + (mvp ? ' is-mvp' : '') + (up ? ' up' : '') + '" data-id="' + esc(id) + '"><span class="rr-face">' + face + '</span>' +
        '<span class="rr-who"><b>' + esc(nm) + '</b>' + (mvp ? '<img class="rr-crown" src="' + esc(A.icon('dps-crown')) + '" alt="" data-tip="' + esc(T('ui.result.mvpTip')) + '">' : '') + '</span>' +
        RR_COLS.map(function (k) { var n = r[k] || 0; return '<span class="rr-n' + (n === 0 ? ' zero' : '') + '">' + esc(n) + '</span>'; }).join('') +
        (xp ? resultXpHtml(g, m) + '<span class="rr-act">' + (up ? '<button class="rr-up" data-act="lvupShow" data-id="' + esc(id) + '" data-tip="' + esc(T('ui.lvup.btnTip')) + '">' + A.glyph('level', false) + '<span>' + esc(T('ui.lvup.btn')) + '</span></button>' : '') + '</span>' : '') + '</div>';
    }).join('');
    w.innerHTML = '<div class="result-wrap"><div class="result paper rr-panel' + (xp ? '' : ' no-xp') + '">' + heading(T(win ? 'ui.result.win' : 'ui.result.lose'), rounds ? T('ui.result.roundsTotal', { n: rounds }) : '', win ? 'laurel' : 'grim') +
      '<div class="rr-list">' + head + body + '</div>' +
      '<div class="actions"><button class="btn btn-primary btn-lg" data-act="battleContinue">' + (win ? T('ui.common.continue') : '……') + '</button></div></div></div>';
    resultUp(w);
  }
  // her 经验 cell: 「+N」 with Lv, and the bar (the part she had, the part just gained). No g = she fell: 「—」 and her bar as it is
  function resultXpHtml(g, m) {
    var x = g ? g.to : (m && m.xp != null ? m : null), sp = A.xpSpan(x, g ? g.gain : 0);
    var bar = sp ? '<span class="rr-bar"><i class="rr-fill" style="width:' + sp.pct + '%"></i>' + (sp.add > 0 ? '<i class="rr-add" style="left:' + sp.pct + '%;width:' + sp.add + '%"></i>' : '') + '</span>' : '';
    var lv = x && x.lv != null ? '<small class="rr-lv">Lv' + esc(x.lv) + '</small>' : '';
    if (!g || !(g.gain > 0)) return '<span class="rr-xp none" data-tip="' + esc(T('ui.result.noXp')) + '"><span class="rr-xp-t">' + lv + '<b>—</b></span>' + bar + '</span>';
    return '<span class="rr-xp" data-tip="' + esc(T('ui.result.col.xpTip')) + '"><span class="rr-xp-t">' + lv + '<b>' + esc(T('ui.result.xpGain', { n: g.gain })) + '</b></span>' + bar + '</span>';
  }
  // the level-up pages of this battle, once per result (a re-render does not replay them); the 「升级」 button opens one again
  var lvUpShown = {};
  function resultLevelUps(v) {
    var b = v.battle, xp = b && b.xp; if (!LEVELUP_PAGE || !xp || typeof xp !== 'object') return;
    var bid = battleId(v); if (lvUpShown[bid]) return; lvUpShown[bid] = true;
    var order = ((b.stats && b.stats.allies) || []).map(function (r) { return r.id; }).filter(function (id) { return xp[id]; });
    Object.keys(xp).forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    var list = order.map(function (id) { return lvUpFromGain(id, xp[id]); }).filter(Boolean);
    if (list.length) later(function () { if (view && view.phase === 'battleResult') showLevelUps(list); }, REDUCED ? 200 : 900);
  }
  // 2026-11-19 战报 XP 栏: g = the engine's xpGainFor(…) of this battle's +XP (none = she fell, no XP)
  function resultXpCell(g) {
    if (!g || !(g.gain > 0)) return '<td class="num zero rs-xp">0</td>';
    var h = '<span class="rs-xp-n">' + esc(T('ui.result.xpGain', { n: g.gain })) + '</span>';
    if (g.up > 0 || g.over > 0) {
      h += '<span class="rs-xp-up">' + esc(g.up > 0 ? T('ui.xp.levelUp', { from: g.from.lv, to: g.to.lv }) : T('ui.xp.overUp')) + '</span>' +
        '<small class="rs-xp-st">' + [g.atk ? T('ui.xp.upAtk', { n: g.atk }) : '', g.maxHp ? T('ui.xp.upMaxHp', { n: g.maxHp }) : '',
          g.up > 0 && g.skill && g.skill.from && g.skill.to ? A.stripIcons(T('ui.xp.upSkill', { from: g.skill.from, to: g.skill.to })).replace(/\*\*/g, '') : ''].filter(Boolean).map(esc).join(' · ') + '</small>'; // 2026-11-19 文字修 L8: + the skill change, like the camp / panel xp bar
    }
    return '<td class="rs-xp' + (g.up > 0 || g.over > 0 ? ' up' : '') + '">' + h + '</td>';
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
          return heading(T(heavy ? 'ui.reward.heavyHeading' : v.blessing ? 'ui.reward.blessHeading' : 'ui.reward.heading'), T(heavy ? 'ui.reward.heavySub' : v.blessing ? 'ui.reward.blessSub' : 'ui.reward.sub'), heavy ? 'grim' : 'laurel') + // feedback-1112 #11; 2026-11-19 小铃的祝福 has its own heading
            (GOLD_CLAIM ? goldClaimHtml(v, heavy) : winGoldHtml(v, heavy)) + (v.fortuneNote && !heavy ? '<div class="fortune-note">' + esc(v.fortuneNote) + '</div>' : '') /* 2026-11-23 妮可塔多翻一张 */ + '<div class="three">' + opts.map(function (o) { return bigCard(o, heavy, v); }).join('') + '</div>';
        }
        // 2026-11-14 (user): a row of round heads to pick who, ONE big preview box for the selected one, 「确定」 gives it
        // 试玩 #9: nobody is picked at first — the box asks, 「确定」 waits for a head
        var ids = v.targets || [], has = (c && c.has) || [], sel = ids.indexOf(ui.who) >= 0 && has.indexOf(ui.who) < 0 ? ui.who : null; // 2026-11-15: keepsake holders can't be picked
        ui.who = sel;
        var whoName = function (m) { return whoNameOf(m, heavy); };
        var heads = ids.map(function (id) {
          var m = member(id) || { id: id, name: nameOf(id) }, art = unitArt({ id: id, side: 'ally', isLeader: isLeader(m) });
          if (has.indexOf(id) >= 0) { var why = ((c && c.priestOnly) || []).indexOf(id) >= 0 ? T('ui.reward.priestOnly') : ((c && c.luckFloor) || []).indexOf(id) >= 0 ? T('ui.reward.luckFloor') /* 2026-11-22e LUCK_FLOOR_BLOCK */ : T('ui.reward.alreadyHas'); /* 2026-11-22 试玩4 #1 */ return '<button class="who-head has" disabled aria-disabled="true" data-tip="' + esc(why) + '" title="' + esc(why) + '"><span class="wh-face">' + pic(art.list, '', m.name, art.fb) + '</span><b>' + esc(whoName(m)) + '</b></button>'; }
          return '<button class="who-head' + (id === sel ? ' on' : '') + '" data-act="whoSel" data-id="' + esc(id) + '" data-opt="w:' + esc(id) + '" aria-pressed="' + (id === sel) + '"><span class="wh-face">' + pic(art.list, '', m.name, art.fb) + '</span><b>' + esc(whoName(m)) + '</b></button>';
        }).join('');
        var detail = whoDetailHtml(c, sel, heavy);
        return heading(T(heavy ? 'ui.reward.heavyWho' : 'ui.reward.who'), heavy ? T('ui.reward.heavyWhoSub') : '', heavy ? 'grim' : '') +
          '<div class="picked">' + bigCard(c, heavy, v, true) + '<button class="btn-ghost back" data-act="unpickCard">' + T('ui.reward.swap') + '</button></div><div class="whos"><div class="who-heads">' + heads + '</div>' + detail + '</div>';
      }
    };
  }
  // 2026-11-20b WIN_GOLD_LINE: coin + 「+N」 (this battle) + the label, then the purse chip (total)
  function winGoldHtml(v, heavy) {
    if (!WIN_GOLD_LINE || heavy || v.blessing || !(v.winGold > 0)) return '';
    return '<div class="win-gold"><span class="wg-won">' + A.glyph('coin', false) + '<b class="wg-n">+' + esc(v.winGold) + '</b><span class="wg-l">' + esc(T('ui.reward.goldWon')) + '</span></span>' + goldHtml(v.gold) + '</div>';
  }
  // 2026-11-20c GOLD_CLAIM: the reward block (absolute, under the cards) and its claim. gcDone = keys already claimed (this page load);
  // gcOpen = the block on screen now. Pure presentation: run.gold is never touched here.
  var gcDone = {}, gcOpen = null;
  function gcKey(v) { return (run && run.seed) + ':L' + v.level + ':' + v.winGold; } // not the history length: a pick inside the same loot screen must not bring the block back
  function gcShows(v, heavy) { return GOLD_CLAIM && !heavy && v && v.phase === 'reward' && !v.blessing && v.winGold > 0; }
  function gcPending(v) { return gcShows(v, false) && !gcDone[gcKey(v)]; }
  function goldClaimHtml(v, heavy) {
    if (!gcShows(v, heavy) || gcDone[gcKey(v)]) return '';
    gcOpen = { key: gcKey(v), seed: run && run.seed, n: v.winGold, total: v.gold };
    var parts = String(T('ui.reward.goldGain', { n: '#N#' })).split('#N#');
    return '<div class="gold-claim"><span class="gcl-coin">' + A.glyph('coin', false) + '</span><span class="gcl-t">' + esc(parts[0] || '') + '<b class="gcl-n">' + esc(v.winGold) + '</b>' + esc(parts[1] || '') + '</span>' +
      '<button class="btn btn-primary gcl-btn" data-act="goldClaim">' + T('ui.reward.goldClaim') + '</button></div>';
  }
  // after each render: a block that was up and is gone now (picked a card, left the screen) → claim it quickly
  function goldClaimAuto() {
    if (!gcOpen) return;
    if (!run || run.seed !== gcOpen.seed) { gcDone[gcOpen.key] = 1; gcOpen = null; return; }
    if (!app.querySelector('.gold-claim')) claimGold(true);
  }
  function claimGold(fast) {
    var g = gcOpen; if (!g) return; gcOpen = null; gcDone[g.key] = 1;
    var blk = app.querySelector('.gold-claim'), chip = app.querySelector('.topbar .gold-chip'), num = chip && chip.querySelector('.gc-n');
    cue('coin', null, 0);
    if (blk) { blk.classList.add('claimed'); var bt = blk.querySelector('.gcl-btn'); if (bt) bt.disabled = true; setTimeout(function () { blk.remove(); }, 450); }
    if (!chip || !num || REDUCED || !chip.animate) { if (num) num.textContent = g.total; if (chip) pulse(chip, 'gold-bump', 500); return; }
    var from0 = g.total - g.n; num.textContent = from0;
    var src = blk ? (blk.querySelector('.gcl-coin') || blk) : null, from = src ? stagePt(src, 0.5, 0.5) : { x: 960, y: 560 }, to = stagePt(chip.querySelector('.gi') || chip, 0.5, 0.5);
    var cnt = fast ? 6 : Math.max(8, Math.min(16, 6 + Math.round(g.n / 2))), dur = fast ? 560 : 950, gap = fast ? 25 : 45, landed = 0;
    for (var i = 0; i < cnt; i++) (function (i) {
      var d = document.createElement('div'); d.className = 'coin-fly'; d.innerHTML = A.glyph('coin', false);
      d.style.left = from.x + 'px'; d.style.top = from.y + 'px'; stageEl.appendChild(d);
      var a = (Math.PI * 2 * i) / cnt + Math.random() * 0.5, r = (fast ? 60 : 90) + Math.random() * (fast ? 50 : 90);
      var bx = Math.cos(a) * r, by = Math.sin(a) * r - (fast ? 20 : 40), dx = to.x - from.x, dy = to.y - from.y;
      var done = function () {
        d.remove(); landed++;
        if (landed === 1) countUp(num, from0, g.total, fast ? 320 : 600, chip);
        pulse(chip, 'gold-hit', 220);
      };
      d.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%,-50%) translate(' + bx + 'px,' + by + 'px) scale(1.1)', opacity: 1, offset: 0.32 },
        { transform: 'translate(-50%,-50%) translate(' + (bx * 0.5 + dx * 0.5) + 'px,' + (by * 0.5 + dy * 0.5 - 60) + 'px) scale(.9)', opacity: 1, offset: 0.65 },
        { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(.5)', opacity: 0.85 }
      ], { duration: dur, delay: i * gap, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'both' }).finished.then(done, done);
    })(i);
  }
  function countUp(el, a, b, ms, chip) {
    var t0 = nowMs(), step = function () {
      var k = Math.min(1, (nowMs() - t0) / ms); el.textContent = Math.round(a + (b - a) * k);
      if (k < 1) requestAnimationFrame(step); else { el.textContent = b; pulse(chip, 'gold-bump', 520); }
    };
    requestAnimationFrame(step);
  }
  // 2026-11-20 用户「给信物的时候状态栏写没有变化」: a keepsake / relic card gives a token, not a stat — show 「获得：<name>」 + its effect
  function tokenGainHtml(c) {
    var ef = c && c.effect; if (!ef || ef.type !== 'token') return '';
    var txt = String(c.text || '').replace(/^[^：:]*[：:]/, '');
    return '<span class="wd-token">' + esc(T('ui.reward.gainToken', { name: ef.tokenName || c.name })) + (txt ? '<i class="wd-token-t">' + richText(txt) + '</i>' : '') + '</span>';
  }
  function whoNameOf(m, heavy) { return isLeader(m) ? T(heavy ? 'ui.reward.heavySelf' : 'ui.reward.self') : m.name; }
  // the one preview box of the 「给谁」 screen. 试玩 #9: no head picked → a prompt and a disabled 「确定」 (same box, same place)
  function whoDetailHtml(c, sel, heavy) {
    if (!sel) return '<div class="who-detail panel wd-empty"><div class="wd-body"><b class="wd-name">' + T('ui.reward.pickWhoPrompt') + '</b>' +
      '<button class="btn btn-primary wd-ok" disabled aria-disabled="true">' + T('ui.reward.confirm') + '</button></div></div>';
    var m = member(sel) || { id: sel, name: nameOf(sel) }, art = unitArt({ id: sel, side: 'ally', isLeader: isLeader(m) }), pv = c.preview && c.preview[sel];
    return '<div class="who-detail panel"><span class="wd-face">' + pic(art.list, '', m.name, art.fb) + '</span><div class="wd-body"><b class="wd-name">' + esc(whoNameOf(m, heavy)) + '</b>' +
      '<span class="who-sub">' + moodFace(m) + A.glyph('maxhp') + esc(m.maxHp) + ' ' + IC.atk + esc(m.atk) + '</span>' +
      (pv && pv.length ? previewHtml(pv) : '') + tokenGainHtml(c) + ((pv && pv.length) || tokenGainHtml(c) ? '' : '<span class="wd-none">' + T('ui.reward.noChange') + '</span>') +
      (c.traitNotes && c.traitNotes[sel] ? '<span class="wd-trait">' + c.traitNotes[sel].map(esc).join('<br>') + '</span>' : '') + /* 2026-11-23 REWARD_TRAIT_NOTE: 「薇奥拉会嫉妒：心情 −1」 */
      '<button class="btn btn-primary wd-ok" data-act="pickTarget" data-id="' + esc(sel) + '" data-opt="t:' + esc(sel) + '">' + T('ui.reward.confirm') + '</button></div></div>';
  }
  // 修复「三选一卡效果行消失」: flavour + one effect line for every choice card (A.cardFace; numbers bold by the **数字** rule)
  // 2026-11-14: a 生命上限 effect carries the heart-container icon ({i:maxhp}) — A.effLine only knows {i:hp}
  function maxIcon(s, e) { return e && e.stat === 'maxHp' ? String(s || '').replace('{i:hp}', '{i:maxhp}') : s; }
  function effIcon(e) { return maxIcon(A.effLine(e), e); }
  function cardFaceHtml(o) { var f = A.cardFace(o); if (o && o.effect && o.effect.stat === 'maxHp' && f.eff) f.eff = String(f.eff).replace('{i:hp}', '{i:maxhp}'); return (f.flavor ? '<span class="ch-text">' + richText(f.flavor) + '</span>' : '') + (f.eff ? '<span class="ch-eff">' + richText(f.eff) + '</span>' : ''); }
  // 2026-11-20 用户「所有物品道具都加边框——白 / 蓝 / 紫 / 橙代表不同等级」(RARITY_FRAME): common / rare / epic / legendary → class
  // rar-<id> (style.css). The rarity is the card's own, else looked up by id in the reward / debuff cards and the shop; bag items = common
  var RARITY_FRAME = true, RAR_IDS = { common: 1, rare: 1, epic: 1, legendary: 1 }, RAR_OLD = { uncommon: 'rare', core: 'legendary' };
  function rarityOf(o) {
    if (!o) return 'common';
    var r = o.rarity, id = o.id || o.itemId;
    if (!r && id) {
      var C = DATA.cards || {}, sh = DATA.shop || {}, pool = (C.rewards || []).concat(C.debuffs || [], Array.isArray(sh) ? sh : sh.items || []);
      for (var i = 0; i < pool.length && !r; i++) if (pool[i] && pool[i].id === id) r = pool[i].rarity;
    }
    r = RAR_OLD[r] || r;
    return RAR_IDS[r] ? r : 'common';
  }
  function rarCls(o) { return RARITY_FRAME ? ' rar-' + rarityOf(o) : ''; }
  function bigCard(o, heavy, v, small) {
    var ic = A.cardIcon(o, heavy), item = o.effect && o.effect.type === 'item';
    return '<button class="choice big-card' + (heavy ? ' bad' : rarCls(o)) + (small ? ' small' : '') + '" data-act="pickCard" data-id="' + esc(o.id) + '" data-opt="card:' + esc(o.id) + '"' + (small ? ' disabled' : '') + '>' +
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
    if (s.earlyDefeat) return earlyDefeatHtml(v); // 2026-11-20 EARLY_DEFEAT_SIMPLE (engine): a wipe on L1–3 — the story said it all; no fate cards
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
  function earlyDefeatHtml(v) { // the run ended before it began: one quiet line + back to the title
    return heading(T('ui.ending.earlyHeading'), '', 'grim') +
      '<div class="ending-foot"><button class="btn btn-primary btn-lg" data-act="endHome">' + T('ui.ending.home') + '</button></div>';
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
    if (f.wokeAt) bits.push(T('ui.ending.bit.wokeAt', { level: f.wokeAt })); // 2026-11-24: she broke free there
    if (win && (f.fate === 'sacrificed' || f.fate === 'rejected')) bits.push(T('ui.ending.bit.toy')); // feedback-1112 #41: the same fate for both
    var list = f.fate === 'survived' ? A.face(f.id, 'happy') : A.face(f.id, f.fate === 'sacrificed' ? 'possessed-blank' : 'vengeful-tears', { variant: f.fate === 'sacrificed' ? 'possessed' : 'vengeful' });
    return '<div class="fcard fate-' + esc(f.fate) + '"><div class="fc-art">' + pic(list, 'fc-img', f.name, initialHtml(f.name)) + roleBadge(c.role, 'uc-role') + '<span class="fc-ribbon">' + (f.fate === 'sacrificed' && f.mode === 'random' ? T('ui.ending.fate.taken') /* 2026-11-24: the dice took her */ : FATE_LABEL()[f.fate][win ? 0 : 1]) + '</span></div>' +
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
      if (replayed[k] || QUICK) return; replayed[k] = true; /* 快速模式: no whiteout / epilogue / credits, the result board at once */
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
    var people = CR.cards(s, run, DATA), staff = CR.staff(DATA), closing = people.length && people[people.length - 1].closing ? people[people.length - 1] : null, segs = CR.plan(people.length, staff.rows.length, { reduced: REDUCED, closing: !!closing, leaderIdx: people.findIndex(function (c) { return c && (c.kind === 'leader' || (c.art && c.art.id === 'leader')); }) });
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
        if (ms) { segs = CR.plan(people.length, staff.rows.length, { reduced: REDUCED, songMs: ms, leaderIdx: people.findIndex(function (c) { return c && (c.kind === 'leader' || (c.art && c.art.id === 'leader')); }), closing: !!closing }); armDog(); }
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
    html: function (v) { return v.summary && v.summary.epilogue && !QUICK ? '' : endingHtml(v); }, // UI-CLEAN §2.12: 改判胜利 is in ☰
    after: function (v) { if (!(v.summary && v.summary.epilogue) || QUICK) bindQuestionnaire(); },
    enter: function (v) { if (v.summary && v.summary.epilogue && !QUICK) playEpilogue(v.summary.epilogue); }
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
    cine('epi' + (V ? ' epi-win' + (V === 'true' ? ' epi-true' : '') : ''), '<div class="ep-bg" style=\'background-image:' + bgs + '\'></div><div class="ep-stand" id="epStand"></div><div class="ep-name" id="epName"></div><div class="ep-black"></div>');
    storyHook = { kind: 'epilogue', on: function () { return t === epi.tok; }, skip: function () { if (epi.vdone) epiWinEnd(epi.tok); else epiBlack(epi.tok); } }; syncSkip();
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
        epiShow(A.portrait(ep.advisor.id, V || advisorTurnedNow(view) ? { variant: 'boss' } : {}), ep.advisor.name, T('ui.epilogue.advisor')); // batch6 H2-15: any ending after she turned (true ending too) → her enemy clothes
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
    cineEl.classList.add('black');
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
  function closeModal() { modalEl.hidden = true; modalEl.innerHTML = ''; modalEl.classList.remove('vn-pass', 'menu-open', 'unit-open', 'route-open'); }
  // batch6 H2-1: the game never uses alert/confirm/prompt — overwriting a save asks in a game-styled panel
  function askOverwrite(act) {
    modal('<h2>' + T('ui.newRun.confirmTitle') + '</h2><p>' + bold(T(run ? 'ui.newRun.confirmCurrent' : 'ui.newRun.confirmExisting')) + '</p><p class="small dim">' + T('ui.newRun.noUndo') + '</p>' +
      '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button><button class="btn btn-primary" data-act="' + act + '" data-ok="1">' + T('ui.newRun.confirmStart') + '</button></div>');
    var p = modalEl.querySelector('.panel'); if (p) p.classList.add('ask-modal');
  }

  // 2026-11-21 转向指环: giving the ring to a girl who charges both ways asks which side first (two buttons); anyone else → send at once
  // returns true when it opened the ask (send(side) runs on the button); false = go on as before
  function ringAsk(eff, who, side, send) {
    var m = member(who);
    if (side || !eff || eff.tokenId !== 'turnRing' || !m || m.chargeDir !== 'both') return false;
    ui.ringSend = send;
    modal('<h2>' + T('ui.ring.askTitle') + '</h2><p>' + T('ui.ring.ask') + '</p><div class="row center-row">' +
      '<button class="btn btn-primary" data-act="ringSide" data-side="prev">' + T('ui.ring.left') + '</button>' +
      '<button class="btn btn-primary" data-act="ringSide" data-side="next">' + T('ui.ring.right') + '</button></div>' +
      '<div class="row center-row"><button class="btn btn-secondary" data-act="modalCancel">' + T('ui.common.rethink') + '</button></div>');
    var p = modalEl.querySelector('.panel'); if (p) p.classList.add('ask-modal');
    return true;
  }
  function ringAskCard(d) { // the reward screen's 「确定」
    if (view.phase !== 'reward') return false;
    var o = (view.options || []).filter(function (x) { return x.id === ui.card; })[0];
    return ringAsk(o && o.effect, d.id, d.side, function (side) { H.pickTarget({ id: d.id, side: side }); });
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
    routeMap: function () { routeOpen(); },
    routeClose: function () { closeModal(); },
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
      var hc = view && view.pair ? view.pair.filter(function (c) { return c.id === d.id; })[0] : null;
      if (hc && hc.afford === false) { notice(T('ui.interview.poor')); return; } // 2026-11-20 招人花钱: can't afford her
      doAct(Object.assign({ type: 'hire', id: d.id, candidate: d.id }, hc && hc.price != null ? { price: hc.price } : {}), true, null, { post: function () { return stages([[function () { app.querySelectorAll('.iv-side').forEach(function (el) { if (el.dataset.c !== d.id) { el.classList.remove('dim', 'speaking'); el.classList.add('leaving'); } }); }, 1300, 'noskip']]); } });
    },
    // 2026-11-15 一页招完人
    qPick: function (d) { if (!view || !view.quick) return; ui.qp = ui.qp || {}; ui.qp[d.r] = d.id; render(); },
    quickGo: function () {
      if (!view || !view.quick) return; var qp = ui.qp || {}, picks = view.quick.rows.map(function (r) { return qp[r.round]; });
      if (picks.some(function (x) { return !x; })) return;
      var prices = view.quick.rows.map(function (r, i) { var c = r.pair.filter(function (x) { return x.id === picks[i]; })[0]; return c && c.price != null ? c.price : null; }); // 2026-11-20 招人花钱 (playlog)
      var qa = { type: 'quickRecruit', picks: picks }; if (prices.some(function (x) { return x != null; })) qa.prices = prices;
      pl('event', 'quickRecruit', qa.prices ? { picks: picks, prices: prices } : { picks: picks }); cue('confirm', null, 0); doAct(qa, true);
    },
    ivNormal: function () { setIvMode('normal'); pl('event', 'quickOff'); vnClear(); render(); SCREENS.interview.enter(view); },
    ivQuick: function (d, t, e) { if (e) e.stopPropagation(); setIvMode('quick'); pl('event', 'quickOn'); vnClear(); render(); },
    ivAskNormal: function () { setIvMode('normal'); pl('event', 'ivAsk', { mode: 'normal' }); vnClear(); render(); SCREENS.interview.enter(view); },
    ivAskList: function () { setIvMode('quick'); pl('event', 'ivAsk', { mode: 'quick' }); vnClear(); render(); },
    ivReplay: function () { $('ivChoices').hidden = true; $('ivUnder').hidden = true; ivTalk(view); },
    move: function (d) { var i = +d.i, j = i + +d.d, o = ui.order, t = o[i]; if (j < 0 || j >= o.length) return; o[i] = o[j]; o[j] = t; ui.moves++; render(); },
    // 2026-11-15 bug: toggling 「开场用…」 re-rendered from the engine's order and dropped the line-up the player had just dragged —
    // commit the dragged line-up first (setOrder, the same action 「出发」 sends), so the re-render keeps it
    armSkill: function () { if (ui.order && !doAct({ type: 'setOrder', order: ui.order.slice() }, true)) return; if (doAct({ type: 'armSkill', on: !view.skillArmed }, true)) render(); },
    fight: function () { tracker.switches = ui.moves || 0; if (doAct({ type: 'setOrder', order: ui.order.slice() }, true)) doAct({ type: 'fight' }); },
    speed: function (d) { setSpeed(+d.s); },
    speedCycle: function () { setSpeed((prefs.speed || 1) % 3 + 1); },
    skip: function () { anim.skip = true; flushWaits(); },
    pContinue: function (d, t, e) { if (ui.acted || !app.querySelector('.pausebar') || !pauseReady(e)) return; ui.acted = 1; doAct({ type: 'continue' }, true); },
    pSkill: function () {
      var sk = view.battle.pause.advisorSkill; if (!sk || !sk.available || ui.acted) return;
      var an = { title: view.advisor ? T('ui.pause.announceAdvisor', { advisor: view.advisor.name, name: sk.name }) : T('ui.battle.skillTitle', { name: sk.name }), sub: T('ui.battle.nextRound'), face: A.face(view.advisor.id, 'special') };
      if (pauseMulti()) { doPauseAct({ type: 'advisorSkill' }, an); return; } // 2026-11-19 换位/暂停连做
      ui.acted = 1; pendingAnnounce = an;
      doAct({ type: 'advisorSkill' }, true);
    },
    pMove: function () { pauseMode('move', bold(T(view.battle.pause.swapCost ? (SWAP_ANY_UI ? 'ui.pause.moveHintAny' : 'ui.pause.moveHintSwap') : 'ui.pause.moveHint'))); },
    pMoveTo: function (d) { if (!ui.moveSel || ui.acted || !view || !view.battle) return; var order = view.battle.allies.map(function (u) { return u.uid != null ? u.uid : u.id; }); pauseMove(ui.moveSel, +d.to, order); ui.moveSel = null; app.querySelectorAll('.bcard.ally.sel').forEach(function (c) { c.classList.remove('sel'); }); }, // 2026-11-24 SWAP_ANY_UI // 2026-11-19 换位/暂停连做: the swap rule in the hint
    pItem: function () {
      var items = view.battle.pause.items || [];
      pauseMode('item', '<b>' + T('ui.pause.item') + '</b>' + items.map(function (it, i) { return '<button class="item-btn" data-act="pickItem" data-i="' + i + '" data-tip="' + esc(it.text) + '"><img src="' + esc(A.itemIcon(it.itemId)) + '" alt="">' + esc(it.name) + '</button>'; }).join(''));
    },
    pickItem: function (d) {
      var it = view.battle.pause.items[+d.i]; if (!it || ui.acted) return;
      if (!it.needsTarget) { if (pauseMulti()) { doPauseAct({ type: 'useItem', itemId: it.itemId }, { title: it.name, sub: it.text }); return; } ui.acted = 1; pendingAnnounce = { title: it.name, sub: it.text }; doAct({ type: 'useItem', itemId: it.itemId }, true); return; } // 2026-11-19 换位/暂停连做
      // 2026-11-22 it.target: 'enemy' (烟雾弹: tap a foe) · 'fallen' (复活药: tap a fallen ally) · else a living ally
      if (it.target === 'fallen' && !(view.battle.allies || []).some(function (u) { return u.side !== 'enemy' && u.hp <= 0; })) { notice(T('ui.pause.noFallen')); return; }
      ui.item = it; pauseMode('itemTarget', T(it.target === 'enemy' ? 'ui.pause.itemTargetFoe' : it.target === 'fallen' ? 'ui.pause.itemTargetFallen' : 'ui.pause.itemTarget', { item: '<b>' + esc(it.name) + '</b>' }));
    },
    pCancel: function () { pauseMode(null); },
    aimPick: function (d, t) { // her 准星: start picking (tap again = stop picking)
      if (ui.acted || !app.querySelector('.pausebar')) return;
      if (ui.mode === 'aim' && ui.aimBy === d.key) { pauseMode(null); return; }
      var h = RoundPlan.canAimKeys(view.battle.allies, (view.battle.pause || {}).canAim).filter(function (x) { return x.key === d.key; })[0]; if (!h) return;
      var name = (bUnits().filter(function (x) { return x.uid === h.key || x.id === h.key; })[0] || {}).name || '';
      pauseMode('aim', bold(T('ui.pause.aimHint', { name: esc(name) })) + (h.aim != null ? '<button class="btn-ghost" data-act="aimClear">' + T('ui.pause.aimClear') + '</button>' : ''));
      ui.aimBy = h.key; t.classList.add('on');
    },
    healPick: function (d, t) { // her 十字: start picking (tap again = stop picking)
      if (ui.acted || !app.querySelector('.pausebar')) return;
      if (ui.mode === 'heal' && ui.healBy === d.key) { pauseMode(null); return; }
      ui.healBy = d.key; var u = healPriestNow(); if (!u) { ui.healBy = null; return; }
      pauseMode('heal', '<b>' + T('ui.pause.healTitle') + '</b>' + '<button class="btn-ghost' + ((u.healPick || []).length ? '' : ' on') + '" data-act="healAuto" data-tip="' + esc(u.healRule || '') + '">' + T('ui.pause.healAuto') + '</button>');
      ui.healBy = d.key; t.classList.add('on');
    },
    healAuto: function () { var u = healPriestNow(); if (u && !ui.acted) { doHealPick(u.uid != null ? u.uid : u.id, []); pauseMode(null); } },
    aimClear: function () { var h = RoundPlan.canAimKeys(view.battle.allies, (view.battle.pause || {}).canAim).filter(function (x) { return x.key === ui.aimBy; })[0]; if (h && !ui.acted) doAim(h.id, null); },
    pLog: function () { openBattleLog(); }, // v39 战报
    lvupShow: function (d) { var xp = view && view.battle && view.battle.xp, it = xp ? lvUpFromGain(d.id, xp[d.id]) : null; if (it && !vnActive()) sayFx(lvUpFx([it])); }, // 2026-11-19 用户亲测 界面: 「升级」 on the result row
    battleContinue: function (d, t, e) { if (ui.resActed || (e && e.isTrusted && ui.resultAt && nowMs() - ui.resultAt < 450)) return; ui.resActed = 1; if (!doAct({ type: 'continue' })) ui.resActed = 0; },
    pickCard: function (d) {
      ui.who = null;
      var o = (view.options || []).filter(function (x) { return x.id === d.id; })[0];
      if (o && (o.needsTarget === false || (o.needsTarget == null && o.effect && o.effect.type === 'item'))) { doAct({ type: 'pickReward', card: o.id }, true); return; }
      ui.card = d.id; render();
    },
    unpickCard: function () { ui.card = null; ui.who = null; render(); },
    goldClaim: function () { claimGold(false); }, // 2026-11-20c GOLD_CLAIM: 领取 → coins fly into the purse
    // 2026-11-14: switching heads = 换人. 试玩 #9: in place (the heads' ring + the one box), never a whole re-render — that
    // rebuilt the box (and its 「确定」) on every pick, which flickered
    whoSel: function (d) {
      if (ui.who === d.id || ui.acted) return; ui.who = d.id;
      var c = ui.card && (view.options || []).filter(function (o) { return o.id === ui.card; })[0], box = app.querySelector('.whos .who-detail');
      if (!c || !box) { render(); return; }
      app.querySelectorAll('.who-head').forEach(function (h) { var on = h.dataset.id === d.id; h.classList.toggle('on', on); h.setAttribute('aria-pressed', String(on)); });
      var t = document.createElement('template'); t.innerHTML = whoDetailHtml(c, d.id, view.phase === 'debuff'); box.replaceWith(t.content.firstChild);
    },
    pickTarget: function (d) { if (!d.id || ui.acted) return; ui.acted = 1; if (ringAskCard(d)) { ui.acted = 0; return; } cue(view.phase === 'reward' ? 'reward' : 'debuff', null, 0); if (!doAct({ type: view.phase === 'reward' ? 'pickReward' : 'pickDebuff', card: ui.card, target: d.id, side: d.side }, true)) ui.acted = 0; },
    ringSide: function (d) { var f = ui.ringSend; ui.ringSend = null; closeModal(); if (f && (d.side === 'prev' || d.side === 'next')) f(d.side); }, // 2026-11-21 转向指环
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
        var fx = withFarewell(sacrificeFx(gone, pv.party, true), gone);
        return SAC_SPIN && gone.length ? function (done, it) { sacSpinFx(gone[0])(function () { fx(done, it); }, it); } : fx;
      } });
    },
    sealPick: function (d) { // feedback-1112 #7: refuse (the noble's curse) / accept (two girls lose heart)
      if (ui.acted || (d.id !== 'refuse' && d.id !== 'accept')) return; ui.acted = 1;
      var c = $('sealChoice'); if (c) c.remove();
      if (!doAct({ type: 'sealChoice', choice: d.id }, true)) ui.acted = 0;
    },
    passDoor: function () { // 2026-11-20 铃之门: 【那就算了吧】 → a plain continue (the normal route)
      if (ui.acted) return; ui.acted = 1;
      var g = $('sideDoorGo'); if (g) g.remove();
      if (!doAct({ type: 'continue' }, true)) ui.acted = 0;
    },
    skipDoor: function () { // 2026-11-21 【不进去】 → the normal ending (engine act skipDoor)
      if (ui.acted) return; ui.acted = 1;
      var g = $('sideDoorGo'); if (g) g.remove();
      if (!doAct({ type: 'skipDoor' }, true)) ui.acted = 0;
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
    plCopy: function () { plExport(true); }
  };
  Object.keys(SHOP_H).forEach(function (k) { H[k] = SHOP_H[k]; }); // 2026-11-14 芙洛的店
  var CLICK_CUE = { goldClaim: 'none', shopPick: 'none', shopBuy: 'none', shopLeave: 'cancel', shopWho: 'click', shopBack: 'cancel', shopLook: 'confirm', fairyPoke: 'none', setupGo: 'confirm', setupBack: 'cancel', menu: 'click', confirmSelf: 'confirm', followBell: 'confirm', stayFire: 'confirm', modeSelf: 'pick', cheatKeys: 'click', newKeys: 'confirm', confirmAdvisor: 'confirm', confirmDifficulty: 'confirm', dfPick: 'none', confirmIdentity: 'confirm', confirmClass: 'confirm', fight: 'confirm', battleContinue: 'confirm', pContinue: 'confirm', confirmName: 'confirm',
    pCancel: 'cancel', fwBack: 'cancel', unpickCard: 'cancel', modalCancel: 'cancel', cheatNo: 'cancel', home: 'cancel',
    campChoose: 'none', unitInfo: 'click', campExplore: 'pick', campTrainPick: 'pick', campTrainBonus: 'confirm', viewHer: 'click', viewHerClose: 'cancel',
    pickAdvisor: 'pick', pick: 'pick', pickCard: 'pick', pickTarget: 'pick', whoSel: 'click', nameTarget: 'pick', pickItem: 'pick', side: 'side', hire: 'hire', pMove: 'click' };
  // 2026-11-19 换位/暂停连做: the move (the dragged / first-picked girl is the one who moves — and, with SWAP_COST, skips her
  // next action); SWAP_COST = a neighbour only (else a hint, nothing sent); PAUSE_MULTI = in place, the pause stays
  // 2026-11-24 用户「拖动不好——应该选一个人，然后点箭头按钮选她要去的位置」(SWAP_ANY_UI): once she is picked, every other ally card
  // shows a ⬇ button; tapping it puts her in that slot (the others step aside). Any slot (engine SWAP_ANY)
  var SWAP_ANY_UI = true;
  function moveArrows(on) {
    app.querySelectorAll('.mv-here').forEach(function (b) { b.remove(); });
    if (!on || !SWAP_ANY_UI || !view || !view.battle) return;
    var order = view.battle.allies.map(function (u) { return u.uid != null ? u.uid : u.id; });
    order.forEach(function (uid, i) {
      if (uid === ui.moveSel) return;
      var el = cardEl(uid); if (!el) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mv-here'; b.dataset.act = 'pMoveTo'; b.dataset.to = String(i);
      b.dataset.tip = T('ui.pause.moveHere', { n: i + 1 }); b.textContent = '⬇'; el.appendChild(b);
    });
  }
  function pauseMove(id, to, order) {
    moveArrows(false);
    var p = view.battle.pause || {}, from = order.indexOf(id);
    if (p.swapCost && !SWAP_ANY_UI && Math.abs(to - from) !== 1) { notice(T('ui.pause.notAdjacent')); ui.moveSel = null; app.querySelectorAll('.bcard.ally.sel').forEach(function (c) { c.classList.remove('sel'); }); return true; } // pick again
    if (p.multi) {
      var u = bUnits().filter(function (x) { return x.uid === id || x.id === id; })[0];
      var ok = doPauseAct({ type: 'move', id: id, to: to }, null);
      if (ok) { var ev = (run.lastEvents || []).filter(function (e) { return e.kind === 'move'; })[0]; announce({ title: T('ui.pause.move'), sub: ev ? ev.text : (u && u.name) || '' }); }
      return true;
    }
    ui.acted = 1; doAct({ type: 'move', id: id, to: to }, true); return true;
  }
  // 2026-11-22 烟雾弹 (SMOKE_DAZE): at the pause, tap the item, then a living foe card — she 发呆 the coming round
  function itemFoeClick(card) {
    if (ui.mode !== 'itemTarget' || !ui.item || ui.item.target !== 'enemy' || !view || view.phase !== 'battle' || !card.classList.contains('foe') || ui.acted) return false;
    var id = card.dataset.u || card.dataset.id, u = bUnits().filter(function (x) { return x.uid === id; })[0];
    if (card.classList.contains('down') || !u || u.hp <= 0) return true;
    if (pauseMulti()) { doPauseAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, { title: ui.item.name, sub: u.name }); return true; }
    ui.acted = 1; pendingAnnounce = { title: ui.item.name, sub: u.name }; doAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, true); return true;
  }
  // battle cards during a pause: pick-then-place, or the item's target
  function battleCardClick(card) {
    if (!view || view.phase !== 'battle' || !card.classList.contains('ally') || ui.acted) return false;
    // 2026-11-14: the engine's battle actions name a unit by its uid (a girl who switched sides has a uid ≠ her id)
    var id = card.dataset.u || card.dataset.id, uName = (bUnits().filter(function (u) { return u.uid === id; })[0] || {}).name || nameOf(card.dataset.id);
    if (ui.mode === 'itemTarget' && ui.item && ui.item.target === 'enemy') return true; /* 2026-11-22 烟雾弹 wants a foe (itemFoeClick) */
    if (ui.mode === 'itemTarget' && ui.item && ui.item.target === 'fallen') { if ((bUnits().filter(function (u) { return u.uid === id; })[0] || {}).hp > 0) return true; /* 2026-11-22 复活药: only a fallen girl */ if (pauseMulti()) { doPauseAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, { title: ui.item.name, sub: uName }); return true; } ui.acted = 1; pendingAnnounce = { title: ui.item.name, sub: uName }; doAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, true); return true; }
    if (ui.mode === 'itemTarget') { if (card.classList.contains('down') || (bUnits().filter(function (u) { return u.uid === id; })[0] || {}).hp <= 0) return true; /* 2026-11-16: a fallen girl is not a target (it used to throw and lock the pause) */ if (pauseMulti()) { doPauseAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, { title: ui.item.name, sub: uName }); return true; } /* 2026-11-19 换位/暂停连做 */ ui.acted = 1; pendingAnnounce = { title: ui.item.name, sub: uName }; doAct({ type: 'useItem', itemId: ui.item.itemId, target: id }, true); return true; }
    if (ui.mode === 'move') {
      if (!ui.moveSel) { ui.moveSel = id; card.classList.add('sel'); moveArrows(true); return true; }
      if (ui.moveSel === id) { ui.moveSel = null; card.classList.remove('sel'); moveArrows(false); return true; }
      var order = view.battle.allies.map(function (u) { return u.uid != null ? u.uid : u.id; });
      return pauseMove(ui.moveSel, order.indexOf(id), order);
    }
    return false;
  }
  // sound popover: toggle, sliders, mute
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'leaderName') { prefs.leaderName = String(e.target.value || '').trim().slice(0, 8); lsSet(PKEY, prefs); return; } // v2.4 [4]
    if (e.target && e.target.dataset && e.target.dataset.pref === 'autoCont') { // ☰ 游戏组: battle auto-continue (prefs.autoCont, default off)
      prefs.autoCont = !!e.target.checked; lsSet(PKEY, prefs);
      if (prefs.autoCont && !ui.mode) later(function () { if (!vnActive() && view && view.phase === 'battle' && app.querySelector('.pausebar') && !ui.pauseDid) autoContinue(); }, 500); // 2026-11-19 换位/暂停连做: not mid-sequence
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
    var card = e.target.closest && !e.target.closest('.uc-info') && !e.target.closest('.aim-btn') && !e.target.closest('.heal-btn') && !e.target.closest('.mv-here') && e.target.closest('.bcard'); if (card && (aimFoeClick(card) || itemFoeClick(card) || healAllyClick(card) || battleCardClick(card))) return; // v36: the ⓘ never targets an item
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
  // 2026-11-20: the drag names her by uid (as the engine's move does, like the tap path) and always ends clean (dragend)
  app.addEventListener('dragstart', function (e) { var c = e.target.closest && e.target.closest('.bcard.ally'); if (!c || ui.mode !== 'move') return; ui.dragId = c.dataset.u || c.dataset.id; c.classList.add('dragging'); try { e.dataTransfer.setData('text/plain', ui.dragId); } catch (x) { /* */ } });
  app.addEventListener('dragend', function (e) { var c = e.target.closest && e.target.closest('.bcard.ally'); if (c) c.classList.remove('dragging'); app.querySelectorAll('.bcard.ally.dragging').forEach(function (x) { x.classList.remove('dragging'); }); ui.dragId = null; });
  app.addEventListener('dragover', function (e) { if (ui.mode === 'move' && e.target.closest && e.target.closest('.bcard.ally')) e.preventDefault(); });
  app.addEventListener('drop', function (e) {
    var c = e.target.closest && e.target.closest('.bcard.ally'); if (!c || ui.mode !== 'move' || !ui.dragId) return; e.preventDefault();
    var did = ui.dragId, cid = c.dataset.u || c.dataset.id; ui.dragId = null; app.querySelectorAll('.bcard.ally.dragging').forEach(function (x) { x.classList.remove('dragging'); });
    if (cid === did || ui.acted) return; var order = view.battle.allies.map(function (u) { return u.uid != null ? u.uid : u.id; });
    pauseMove(did, order.indexOf(cid), order); // 2026-11-19 换位/暂停连做 · 2026-11-20: uids, like the tap path
  });
  function trackOpt(e) { var t = e.target.closest && e.target.closest('[data-opt]'); if (t) tracker.touch(t.dataset.opt); }
  app.addEventListener('mouseover', trackOpt); app.addEventListener('focusin', trackOpt);
  // 2026-11-15 跳过剧情: Ctrl = the 「跳过剧情 ⏭」 button
  document.addEventListener('keydown', function (e) { if (e.key === 'Control' && !e.repeat) storySkip(); });
  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (e.key === 'Escape') {
      if (!modalEl.hidden) { closeModal(); return; }
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
    if (Q.get('nologo') === '1' || QUICK || $('intro')) return;
    var fz = DATA.linesV2 && DATA.linesV2.fairy && DATA.linesV2.fairy.intro, txt = function (l) { return typeof l === 'string' ? l : (l && l.text) || ''; };
    var fairy = (fz && fz.lines && fz.lines.length ? fz.lines.map(txt) : INTRO_FAIRY()).concat([fz && fz.go ? txt(fz.go) : INTRO_GO()]);
    var first = replay || !prefs.introSeen, TS = REDUCED ? 0.25 : 1, done = false, tok = 0;
    var el = document.createElement('div'); el.id = 'intro'; el.className = 'intro';
    el.innerHTML = '<div class="in-logo"><img src="' + A.ver('../art/brand/alpico-logo.png') + '" alt="ALPICO PRESENTS"></div>';
    stageEl.appendChild(el); introHold = true;
    var wait = function (ms) { var my = tok; return new Promise(function (r) { setTimeout(function () { r(my === tok && !done); }, ms * TS); }); };
    var click = function () { return new Promise(function (r) { el.onclick = function (e) { el.onclick = null; r(!done); }; }); };
    function finish() { // whiteout → the title underneath, the music in under the white
      if (done) return; done = true; tok++; el.onclick = null; el.classList.add('white');
      if (first) { prefs.introSeen = true; lsSet(PKEY, prefs); }
      setTimeout(function () {
        el.classList.add('cleared'); introHold = false; if (auReady && sceneCtx) au('scene', sceneCtx);
        setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 1200); }, 500 * TS);
      }, 800 * TS);
    }
    storyHook = { kind: 'opening', on: function () { return !done && !!el.parentNode; }, skip: finish }; syncSkip();
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
  // 2026-11-19 预加载: start warming the art (tier 2 = the saved run's level on a resume, else level 1 + the opening)
  if (PRE) {
    try { var preS = loadSave(), preV = preS ? E.view(DATA, preS) : null; PRE.start({ A: A, data: DATA, level: preV ? preV.level | 0 : 0, act: preV ? preV.act : null }); } catch (e) { PRE.start({ A: A, data: DATA, level: 0 }); }
    PRE.onProgress(preBarSync); setTimeout(function () { preBarGone = true; var el = $('preBar'); if (el) preBarSync(PRE.progress()); }, 3000);
  }
  render();
  if (Q.get('resume') === '1' && loadSave()) H['continue'](); // dev: ui/dev/jump.html → straight into the saved run, skip the title
  playOpening(false);
})();
