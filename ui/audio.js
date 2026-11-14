// 《欢迎加入冒险者公会！》 — audio (docs/V2.1-CONTRACT.md §G, docs/V2.2-CONTRACT.md §7, docs/MUSIC-PLAN.md).
// Classic script, no modules. Every public call is wrapped so it never throws: unknown cues, calls before init(),
// missing music files and browsers without WebAudio all degrade to silence.
//
//   CHOOSER_AUDIO.init()              call on the first user gesture (also auto-unlocks on any pointer/key gesture)
//   CHOOSER_AUDIO.scene(ctx, opts)    ctx = { phase, act, level, storyId, battle, outcome, scene } → changes BGM (loop) with
//                                     sequential fades (V2.4 [6]): old track out over 1.2 s, THEN new one in over 1.5 s, never
//                                     overlapping; a newer request while fading replaces the pending one; same track never restarts
//                                     opts.delay = ms to wait before the crossfade starts (values <= 10 are read as seconds);
//                                     a newer scene() call cancels a pending delayed one (docs/V2.3-CONTRACT.md §F)
//   CHOOSER_AUDIO.playResult(kind, act, battleId)  kind 'victory'|'defeat' → victory / victory-dark (act >= 2) / defeat, once;
//                                     a repeat call with the same battleId is ignored (V2.4 [16]). scene() never starts victory music.
//                                     result music (victory / victory-dark / defeat) plays once, not looped; a missing file
//                                     falls back silently to the synthesized cue('victoryTheme') / cue('defeatTheme')
//                                     (some scenes play their track quieter, e.g. the victory ending's dawn at 0.4×; see levelFor)
//   CHOOSER_AUDIO.cue(name, detail)   one-shot synthesized SFX (WebAudio), coloured by the act of the last scene()
//   CHOOSER_AUDIO.setMuted(b) / isMuted() / setVolume(music, sfx)   persisted in localStorage 'chooser.audio.v2'
//   Loops: rainStart/rainStop, fireStart (alias fire)/fireStop. They wait for the unlock if called early.
// guild-hall (V2.4 [1]) is the everyday in-game guild / act-1 story / act-1 camp track; title keeps guild-day. If its file is
// missing it falls back to camp-night (prep/rest/camp) or guild-day (elsewhere).
// Extras for tools/tests: trackFor(ctx), altFor(ctx), levelFor(ctx), play(trackId), stop(), setAct(n), state(), TRACKS, CUES.
(function (root) {
  'use strict';
  var STORE = 'chooser.audio.v2';
  var TRACKS = ['guild-day', 'guild-hall', 'interview', 'battle-light', 'dread', 'battle-dark', 'sacrifice', 'camp-night', 'throne', 'dawn',
    'victory', 'victory-dark', 'defeat', 'themeSong'];
  // 2026-11-14 真结局片尾: 'themeSong' = the ending song 《写下你的名字》 at music/theme-song.mp3 (docs/THEME-SONG.md). Until the
  // file exists it falls back silently to dawn (LOOP_FALLBACK below). Track ids whose file name differs from the id:
  var FILE = { themeSong: 'theme-song' };
  function fileOf(id) { return MUSIC_BASE + (FILE[id] || id) + '.mp3'; }
  // one-shot result tracks (V2.3 §F.3): not looped; synthesized sting if the file is missing
  var ONE_SHOT = { 'victory': 'victoryTheme', 'victory-dark': 'victoryTheme', 'defeat': 'defeatTheme' };
  var CUES = ['hover', 'click', 'confirm', 'cancel', 'pick', 'type', 'advance',
    'side', 'hire', 'reject',
    'enemyEnter', 'allyAttack', 'enemyAttack', 'hit', 'bigHit', 'crit', 'heal', 'miss', 'guard', 'chargeTick', 'chargeRelease', 'combo', 'kill',
    'allyDown', 'pause', 'move', 'advisorSkill', 'item', 'frenzy', 'victory', 'defeat',
    'reward', 'debuff', 'darkTransition', 'rainStart', 'rainStop', 'sacrificeConfirm', 'nameStrike', 'reckoning', 'debtDot', 'flashback',
    'moodDown', 'moodUp', 'gallery', 'fireStart', 'fireStop', 'fire',
    'bell', 'giggle', 'transform', 'whiteout', 'turncoat', 'phase2',
    'victoryTheme', 'defeatTheme'];
  // V2.4 [6] sequential fades: the old track fades out completely, and only then does the new one fade in. Never overlap.
  var FADE_OUT = 1.2, FADE_IN = 1.5;
  var MUSIC_DEFAULT = 0.35;
  var DEBUG = false;
  function noop() {}
  function warn(where, e) { if (DEBUG && root.console) root.console.warn('[audio]', where, e); }
  function safe(where, fn) {
    return function () { try { return fn.apply(null, arguments); } catch (e) { warn(where, e); } };
  }
  function clamp01(x, dflt) { x = +x; return isFinite(x) ? Math.max(0, Math.min(1, x)) : dflt; }

  // music lives in chooser/music/, i.e. ../music/ relative to this script (ui/audio.js) — works from ui/dev/ pages too
  var MUSIC_BASE = '../music/';
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && cs.src) MUSIC_BASE = new URL('../music/', cs.src).href;
  } catch (e) { /* keep relative */ }

  // ---------------- settings ----------------
  var S = { muted: false, music: MUSIC_DEFAULT, sfx: 0.5, v: 3 };
  function save() { try { root.localStorage && root.localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  try {
    var raw = root.localStorage && root.localStorage.getItem(STORE);
    if (raw) {
      var o = JSON.parse(raw) || {};
      S.muted = !!o.muted; S.music = clamp01(o.music, MUSIC_DEFAULT); S.sfx = clamp01(o.sfx, 0.5);
      // V2.3 §F.1 migration: the old default 0.6 becomes the new default 0.35 (once; `v` marks migrated settings)
      if (!(o.v >= 3)) { if (+o.music === 0.6) S.music = MUSIC_DEFAULT; save(); }
    }
  } catch (e) { /* private mode etc. */ }

  var act = 1;          // act of the last scene(); colours the SFX palette
  var unlocked = false; // a user gesture has happened

  function userActive() {
    try {
      var ua = root.navigator && root.navigator.userActivation;
      if (ua) return !!(ua.isActive || ua.hasBeenActive);
    } catch (e) { /* ignore */ }
    return unlocked;
  }

  // =====================================================================================================
  // MUSIC — HTMLAudio decks, equal-power crossfade driven by a small ticker
  // =====================================================================================================
  var decks = [];        // { id, el, g, target, lvl, lvlT, failed } — lvl = per-scene level (1 = normal, 0.4 = quiet)
  var current = null;    // requested track id (null = silence)
  var duckCur = 1, duckTarget = 1, duckTimer = null;
  var ticker = null, lastTick = 0;

  // result tracks may not exist yet: a HEAD request (where fetch works) tells us up front; the audio error event is the backstop
  var missing = {}; // id → true (missing) / false (present); unknown = undefined
  function probe(id) {
    if (missing[id] !== undefined || !root.fetch) return;
    missing[id] = undefined;
    try {
      root.fetch(fileOf(id), { method: 'HEAD', cache: 'no-cache' }).then(function (r) {
        missing[id] = !(r && r.ok);
        if (!missing[id]) return;
        for (var i = 0; i < decks.length; i++) if (decks[i].id === id) { decks[i].failed = true; decks[i].g = 0; }
        if (ONE_SHOT[id]) kick(); else loopMissing(id); // a result sting waits for its turn in tick()
      }, function () { /* file:// or offline: rely on the error event */ });
    } catch (e) { /* ignore */ }
  }
  function fallback(id) { // silently swap a missing one-shot track for its synthesized sting (once per request)
    if (current !== id || stungFor === reqSeq) return;
    stungFor = reqSeq;
    for (var i = 0; i < decks.length; i++) if (decks[i].id === id) decks[i].target = 0;
    kick();
    cue(ONE_SHOT[id], { act: act });
  }
  // a missing looped track with a fallback (V2.4 [1]: guild-hall → guild-day / camp-night) swaps to its fallback
  // value true → the ctx's alt (guild-day / camp-night); a string → that track (themeSong → dawn)
  var LOOP_FALLBACK = { 'guild-hall': true, themeSong: 'dawn' };
  function loopAlt(id) { return typeof LOOP_FALLBACK[id] === 'string' ? LOOP_FALLBACK[id] : 'guild-day'; }
  function loopMissing(id) {
    if (!LOOP_FALLBACK[id] || current !== id) return;
    var alt = loopAlt(id), lv = 1;
    for (var i = 0; i < decks.length; i++) if (decks[i].id === id) { alt = decks[i].alt || alt; lv = decks[i].lvlT; }
    playTrack(alt, lv);
  }
  var reqSeq = 0, stungFor = -1;
  function makeDeck(id, noSrc) {
    var el = new root.Audio(), once = !!ONE_SHOT[id];
    var d = { id: id, el: el, g: 0, target: 1, lvl: 1, lvlT: 1, failed: !!noSrc, once: once, done: false };
    el.loop = !once; el.preload = 'auto'; el.volume = 0; el.muted = S.muted;
    if (noSrc) return d;
    el.addEventListener('error', function () {
      if (d.killed) return;
      d.failed = true; d.g = 0;
      missing[id] = true;
      if (once) { if (gateOpen(d)) fallback(id); } // otherwise the sting waits for its turn (see tick)
      else loopMissing(id);
    });
    if (once) el.addEventListener('ended', function () { d.done = true; d.g = 0; });
    el.src = fileOf(id);
    return d;
  }
  // a deck may be heard only when no other deck is still audible (sequential fades, V2.4 [6])
  function gateOpen(d) {
    for (var i = 0; i < decks.length; i++) if (decks[i] !== d && decks[i].g > 0) return false;
    return true;
  }
  function tryPlay(d) {
    if (!d || d.failed || d.done || d.killed || !d.el.paused || !userActive() || !gateOpen(d)) return;
    try {
      var p = d.el.play();
      if (p && p.catch) p.catch(function (e) { warn('play ' + d.id, e); });
    } catch (e) { warn('play ' + d.id, e); }
  }
  function applyDeck(d) {
    var v = Math.sin(d.g * Math.PI / 2) * S.music * duckCur * d.lvl;
    try { d.el.volume = Math.max(0, Math.min(1, v)); d.el.muted = S.muted; } catch (e) { /* ignore */ }
  }
  function killDeck(d) {
    d.killed = true;
    try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); } catch (e) { /* ignore */ }
  }
  function tick() {
    var now = Date.now(), dt = Math.min(0.25, (now - lastTick) / 1000); lastTick = now;
    var busy = false, stepIn = dt / FADE_IN, stepOut = dt / FADE_OUT;
    if (duckCur !== duckTarget) {
      var ds = dt / 0.5;
      duckCur = duckCur < duckTarget ? Math.min(duckTarget, duckCur + ds) : Math.max(duckTarget, duckCur - ds);
      busy = true;
    }
    // pass 1: fade-outs (and drop decks that are silent and unwanted, including never-started pending ones)
    for (var i = decks.length - 1; i >= 0; i--) {
      var d = decks[i];
      if ((d.failed || d.done) && d.g > 0) d.g = 0; // a broken or finished deck is already silent
      if (d.target <= 0 && d.g > 0) { d.g = Math.max(0, d.g - stepOut); busy = true; }
      if (d.g <= 0 && d.target <= 0) { killDeck(d); decks.splice(i, 1); }
    }
    // pass 2: the wanted deck fades in only once everything else is silent
    for (var k = 0; k < decks.length; k++) {
      var w = decks[k];
      if (w.target <= 0) { applyDeck(w); continue; }
      if (!gateOpen(w)) { busy = true; applyDeck(w); continue; } // waiting its turn
      if (w.failed && w.once && !w.done) { w.done = true; fallback(w.id); continue; } // missing result track: sting now
      if (w.g < w.target) { w.g = Math.min(w.target, w.g + stepIn); busy = true; }
      if (w.lvl !== w.lvlT) {
        w.lvl = w.lvl < w.lvlT ? Math.min(w.lvlT, w.lvl + stepIn) : Math.max(w.lvlT, w.lvl - stepIn);
        busy = true;
      }
      if (w.el.paused && !w.failed && !w.done) tryPlay(w);
      applyDeck(w);
    }
    if (!busy && ticker) { clearInterval(ticker); ticker = null; }
  }
  function kick() { if (!ticker) { lastTick = Date.now(); ticker = setInterval(safe('tick', tick), 40); } }

  // alt = fallback track if `id` turns out to be missing (only used for LOOP_FALLBACK tracks)
  function playTrack(id, lvl, alt) {
    if (id && TRACKS.indexOf(id) < 0) id = null;
    if (id && LOOP_FALLBACK[id] && missing[id] === true) id = (typeof LOOP_FALLBACK[id] === 'string' ? LOOP_FALLBACK[id] : alt) || 'guild-day';
    lvl = clamp01(lvl, 1);
    if (id === current) { // same track: never restart, just make sure it is up and playing (and glide to the new level)
      for (var i = 0; i < decks.length; i++) if (decks[i].id === id) { decks[i].target = 1; decks[i].lvlT = lvl; if (alt) decks[i].alt = alt; tryPlay(decks[i]); }
      kick(); return;
    }
    current = id; reqSeq++;
    var found = false;
    if (id && ONE_SHOT[id]) {
      // a result track always starts from the top (any old copy fades out first, like every other track)
      decks.forEach(function (d) { if (d.id === id) { d.target = 0; d.id = id + '#old'; } });
    }
    // everything else fades out; a deck that never became audible (a pending request) is dropped at once (newer request wins)
    decks.forEach(function (d) {
      if (d.id === id && !found) { found = true; d.target = 1; d.lvlT = lvl; if (alt) d.alt = alt; } else d.target = 0;
    });
    if (id && !found) {
      var nd = makeDeck(id, ONE_SHOT[id] && missing[id] === true); // known-missing result track → placeholder, sting on its turn
      nd.lvl = nd.lvlT = lvl; nd.alt = alt || null; decks.push(nd);
    }
    prune();
    for (var k = 0; k < decks.length; k++) if (decks[k].target > 0) tryPlay(decks[k]);
    kick();
  }
  function prune() { // drop decks that are silent and unwanted (a pending request that never became audible goes at once)
    for (var i = decks.length - 1; i >= 0; i--) if (decks[i].g <= 0 && decks[i].target <= 0) { killDeck(decks[i]); decks.splice(i, 1); }
  }
  function duck(level, seconds) {
    duckTarget = level;
    if (duckTimer) clearTimeout(duckTimer);
    duckTimer = setTimeout(function () { duckTarget = 1; duckTimer = null; kick(); }, seconds * 1000);
    kick();
  }

  // ctx → track (docs/MUSIC-PLAN.md). Acts: 1 = L1–3 (warm), 2 = after the sealing, L4–5 (cold), 3 = after the sacrifice, L6–10 (dark)
  var STORY_TRACK = {
    // V2.4 [1]: in-game act-1 stories use the everyday guild-hall track (fallback guild-day); title + fairyWelcome keep guild-day
    opening: 'guild-hall', advisorAsks: 'guild-hall', leaderPrompt: 'guild-hall', advisorPrompt: 'guild-hall', interviewIntro: 'interview',
    sealing: 'dread', sealRefuse: 'dread', sealAccept: 'dread', belowTomb: 'dread', pathOn: 'sacrifice', pathOnTaken: 'sacrifice', /* feedback-1112 #7/#16/#17 */ debuffIntro: 'dread', rejectedReturn: 'dread', fakeBoss: 'dread', advisorLeaves: 'dread', gameOver: 'dread',
    sacrificeIntro: 'sacrifice', sacrificeRandomTaken: 'sacrifice', sacrificeRandomTakenOne: 'sacrifice', secondSacrificeIntro: 'sacrifice', aftermath: 'sacrifice',
    firstReturn: 'dread', finalReveal: 'throne', victory: 'dawn', // feedback-1112 #32: throne is kept for the advisor and the fairy
    // v2.2
    fairyWelcome: 'guild-hall', nobleChamber: 'throne', trueDoor: 'throne', trueEnding: 'dawn', l11After: 'camp-night', /* 2026-11-14: she is beaten → the dark-campfire track until the epilogue (trueEnding → dawn) */
    // feedback-1112 #35/#37/#39: L9 → the throne room; she is carried off to music; the white room is quiet but not silent
    l9Freedom: 'dread', /* batch6 H2-11: was guild-hall — after L9 the music stays dark (same track as throneRoom, no switch) */ throneRoom: 'dread', throneAdvisor: 'throne', rejectedSecond: 'dread', rejectedDefeat: 'dread', /* SPEC-2026-11-13 E3 */
    normalEnding: 'dread', whiteRoom: 'camp-night',
    whiteout: null // the whiteout cinematic: the music fades out to silence
  };
  var SCENE_TRACK = { 'noble-chamber': 'throne', 'noble-chamber-broken': 'throne', 'white-room': null }; // by background scene id
  function sceneId(c) { return c.scene || c.sceneId || c.bg || null; }
  function isTrue(c) { return c.outcome === 'true' || c.outcome === true || c.outcome === 'trueEnding'; }
  function isWin(c) { return c.outcome === 'victory' || c.outcome === 'win' || c.outcome === 'won'; }
  // per-scene music level: the plain victory ending plays dawn quietly (0.4×)
  function levelFor(c) {
    if (!c || typeof c !== 'object' || c.track !== undefined) return 1;
    var ph = c.phase;
    if ((ph === 'ending' || ph === 'gameOver' || ph === 'victory') && !isTrue(c) && isWin(c)) return 0.4;
    return 1;
  }
  // trackFor: the track to play, with guild-hall resolved to its fallback once the file is known to be missing.
  // altFor: what guild-hall would fall back to for this ctx (camp → camp-night, everything else → guild-day).
  function trackFor(c) {
    var t = rawTrack(c);
    return t === 'guild-hall' && missing['guild-hall'] === true ? altFor(c) : t;
  }
  function altFor(c) {
    var ph = c && typeof c === 'object' ? c.phase : null;
    return (ph === 'prep' || ph === 'rest' || ph === 'camp') ? 'camp-night' : 'guild-day';
  }
  function rawTrack(c) {
    if (typeof c === 'string') return TRACKS.indexOf(c) >= 0 ? c : null;
    c = c || {};
    if (c.track !== undefined) return TRACKS.indexOf(c.track) >= 0 ? c.track : null;
    var ph = c.phase || 'title', a = +c.act || 1, lv = +c.level || 0, sid = c.storyId, sc = sceneId(c);
    if (ph === 'ending' || ph === 'gameOver' || ph === 'victory') {
      if (isTrue(c) || isWin(c) || ph === 'victory') return 'dawn';
      return ph === 'gameOver' ? 'defeat' : 'dread'; // V2.3 §F.3: gameOver plays the one-shot defeat track in place of dread
    }
    if (ph === 'title') return 'guild-day';
    if (ph === 'story' && sid && Object.prototype.hasOwnProperty.call(STORY_TRACK, sid)) return STORY_TRACK[sid];
    if (sc && Object.prototype.hasOwnProperty.call(SCENE_TRACK, sc)) return SCENE_TRACK[sc];
    if (lv === 11 && ph !== 'prep') return 'throne'; // 叙事节奏 2026-11-13: the night before L11 is a campfire like any other
    if (ph === 'sacrifice') return 'sacrifice';
    // V2.4 [16]: a battle result no longer starts victory music here; only playResult() does (when the panel appears)
    // 叙事节奏 2026-11-13: the scene intro (after 「出发」) already plays the level's battle track
    if (c.battle || ph === 'battle' || ph === 'battleResult' || (ph === 'story' && sid === 'levelIntro')) {
      if (lv >= 10) return 'throne'; // feedback-1112 #32: only the advisor (L10) and the fairy (L11); L8 / L9 are ordinary dark battles
      if (lv >= 4 || (!lv && a >= 2)) return 'battle-dark';
      return 'battle-light';
    }
    if (ph === 'story') return a >= 2 ? 'dread' : 'guild-hall';
    if (ph === 'interview') return 'interview';
    if (ph === 'debuff') return 'dread';
    if (ph === 'prep' || ph === 'reward' || ph === 'rest' || ph === 'camp') {
      if (a >= 3 || lv >= 6) return 'camp-night';
      if (a >= 2 || lv >= 4) return 'dread';
      return 'guild-hall'; // act-1 camp / prep / reward (fallback: camp-night for camp, guild-day for reward)
    }
    if (ph === 'difficulty') return 'guild-hall'; // v2.5: still the fairy's welcome
    // advisor, leader, guild and anything unknown
    if (a >= 3) return 'camp-night';
    if (a >= 2) return 'dread';
    return 'guild-hall';
  }

  // =====================================================================================================
  // SFX — WebAudio synthesis. pre → tone lowpass (act colour) → bus (volume/mute) → compressor → out
  //                                pre → reverb send → convolver → bus
  // =====================================================================================================
  var ac = null, pre = null, toneLP = null, bus = null, wetSend = null, noiseBuf = null;
  var lastCue = {};
  // Keep it sparse: the same cue at most once per 80 ms (longer for some), and about 6 one-shots per second in total.
  // `type` is exempt from the global budget (its own 45 ms throttle, near-silent) so typing never starves real cues.
  var THROTTLE = { type: 45, hover: 120, debtDot: 90, move: 100 };
  var SAME_MIN = 80, BUDGET = 6, BUDGET_WINDOW = 1000, recent = [];
  var BUDGET_FREE = { chargeTick: 1, chargeRelease: 1, crit: 1 }; // DESIGN-skill-level 收尾: a crit always sounds
  var rain = null, rainWanted = false;
  var fire = null, fireWanted = false;

  function ensureCtx() {
    if (ac) return ac;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ac.destination);
    bus = ac.createGain(); bus.gain.value = S.muted ? 0 : S.sfx; bus.connect(comp);
    toneLP = ac.createBiquadFilter(); toneLP.type = 'lowpass'; toneLP.Q.value = 0.5; toneLP.frequency.value = 9000; toneLP.connect(bus);
    pre = ac.createGain(); pre.gain.value = 1; pre.connect(toneLP);
    // tiny generated room
    var len = Math.floor(ac.sampleRate * 1.4), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var dd = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    var conv = ac.createConvolver(); conv.buffer = ir;
    wetSend = ac.createGain(); wetSend.gain.value = 0.2;
    pre.connect(wetSend); wetSend.connect(conv); conv.connect(toneLP);
    var nlen = Math.floor(ac.sampleRate * 3); noiseBuf = ac.createBuffer(1, nlen, ac.sampleRate);
    var nd = noiseBuf.getChannelData(0); for (var j = 0; j < nlen; j++) nd[j] = Math.random() * 2 - 1;
    applyPalette();
    return ac;
  }
  function running() { return !!(ac && ac.state === 'running'); }

  // palette per act: root note, pentatonic-ish scale, brightness, room, decay scale
  function palette() {
    if (act >= 3) return { act: 3, root: 293.66, scale: [0, 1, 3, 7, 8], lp: 3000, wet: 0.06, dec: 0.7, wave: 'sine' };
    if (act === 2) return { act: 2, root: 440, scale: [0, 3, 5, 7, 10], lp: 6000, wet: 0.22, dec: 1, wave: 'triangle' };
    return { act: 1, root: 523.25, scale: [0, 2, 4, 7, 9], lp: 9000, wet: 0.2, dec: 1, wave: 'triangle' };
  }
  function applyPalette() {
    if (!ac) return;
    var P = palette(), t = ac.currentTime;
    toneLP.frequency.setTargetAtTime(P.lp, t, 0.2);
    wetSend.gain.setTargetAtTime(P.wet, t, 0.2);
  }
  function N(P, deg) { // scale degree → Hz (degrees may be negative)
    var n = P.scale.length, o = Math.floor(deg / n), k = ((deg % n) + n) % n;
    return P.root * Math.pow(2, (P.scale[k] + 12 * o) / 12);
  }

  // --- primitives (t = absolute ctx time) ---
  function env(g, t, a, peak, d) {
    peak = Math.max(0.00011, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, a) + Math.max(0.01, d));
  }
  // o: { f, f2, type, a, d, g, det, lp, dest }
  function osc(t, o) {
    var s = ac.createOscillator(), g = ac.createGain(), a = o.a || 0.003, d = o.d || 0.1;
    s.type = o.type || 'sine';
    s.frequency.setValueAtTime(Math.max(1, o.f), t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide || (a + d)));
    if (o.det) s.detune.value = o.det;
    env(g, t, a, o.g || 0.1, d);
    var head = s;
    if (o.lp) { var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; head.connect(f); head = f; }
    head.connect(g); g.connect(o.dest || pre);
    s.start(t); s.stop(t + a + d + 0.05);
  }
  // o: { a, d, g, ft (filter type), f, f2, q, dest, lin }
  function nz(t, o) {
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), a = o.a || 0.002, d = o.d || 0.05;
    s.buffer = noiseBuf;
    f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); f.Q.value = o.q == null ? 1 : o.q;
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    if (o.lin) { // linear swell then quick cut (reverse-ish)
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(o.g || 0.05, t + a); g.gain.linearRampToValueAtTime(0.0001, t + a + d);
    } else env(g, t, a, o.g || 0.05, d);
    s.connect(f); f.connect(g); g.connect(o.dest || pre);
    s.start(t, Math.random() * 2); s.stop(t + a + d + 0.05);
  }
  // --- instruments ---
  function pluck(P, t, f, g, d) {
    d = (d || 0.18) * P.dec;
    osc(t, { f: f, type: P.wave, a: 0.002, d: d, g: g });
    osc(t, { f: f * 2, type: 'sine', a: 0.002, d: d * 0.45, g: g * 0.3 });
    nz(t, { ft: 'highpass', f: 3500, d: 0.012, g: g * 0.15 });
  }
  function chime(P, t, f, g, d) {
    d = (d || 0.5) * P.dec;
    osc(t, { f: f, a: 0.003, d: d, g: g });
    osc(t, { f: f * 2.76, a: 0.002, d: d * 0.5, g: g * 0.3 });
    osc(t, { f: f * 5.4, a: 0.001, d: d * 0.25, g: g * 0.1 });
  }
  function bell(P, t, f, g, d) {
    var parts = [[0.5, 0.6, 1], [1, 1, 0.8], [1.19, 0.5, 0.6], [1.56, 0.35, 0.45], [2, 0.3, 0.4], [2.66, 0.18, 0.3], [3.0, 0.1, 0.2]];
    parts.forEach(function (p) { osc(t, { f: f * p[0], a: 0.004, d: d * p[2], g: g * p[1] }); });
  }
  function thump(t, f, g, d, f2) { osc(t, { f: f, f2: f2 || f * 0.4, a: 0.003, d: d, g: g, glide: d * 0.8 }); }
  function swish(t, f, f2, g, d, q) { nz(t, { f: f, f2: f2, g: g, a: d * 0.35, d: d * 0.65, q: q || 0.9 }); }
  // briefly open the act lowpass so a bright cue survives the dark act-3 palette, then settle back
  function openTone(t, secs) {
    toneLP.frequency.cancelScheduledValues(t);
    toneLP.frequency.setTargetAtTime(9000, t, 0.05);
    toneLP.frequency.setTargetAtTime(palette().lp, t + secs, 0.4);
  }
  var HOPE = { act: 1, root: 523.25, scale: [0, 2, 4, 7, 9], lp: 9000, wet: 0.2, dec: 1, wave: 'triangle' };
  function scratch(t, n, span, g) { for (var i = 0; i < n; i++) nz(t + (span * i / n) + Math.random() * 0.01, { f: 2600 + Math.random() * 2200, q: 3, d: 0.025 + Math.random() * 0.02, g: g }); }

  // --- cues: fn(t, P, detail) ---
  var C = {
    // ---- v2.2 (docs/V2.2-CONTRACT.md §7) ----
    bell: function (t, P) { // small clear guild bell; act 3: slightly detuned, beating, eerie
      var eerie = P.act === 3, f = eerie ? 830 : 880;
      [[1, 0.05, 1.1], [2.0, 0.025, 0.7], [2.76, 0.018, 0.5], [4.07, 0.01, 0.3], [5.4, 0.006, 0.2]].forEach(function (p, i) {
        osc(t, { f: f * p[0], det: eerie ? (i % 2 ? 22 : -17) : 0, a: 0.002, d: p[2] * (eerie ? 1.6 : 1), g: p[1] });
      });
      if (eerie) { osc(t, { f: f * 1.013, a: 0.01, d: 1.6, g: 0.025 }); osc(t + 0.05, { f: f / 2 * 0.985, a: 0.08, d: 1.5, g: 0.02 }); }
      nz(t, { ft: 'highpass', f: 5000, d: 0.01, g: 0.02 });
    },
    giggle: function (t, P) { // tiny sparkly chime: a quick ascending twinkle
      var base = 1568;
      [0, 4, 7, 12, 16].forEach(function (st, i) {
        var f = base * Math.pow(2, st / 12) * (0.995 + Math.random() * 0.01);
        osc(t + i * 0.045, { f: f, a: 0.001, d: 0.14, g: 0.022 }); osc(t + i * 0.045, { f: f * 2.76, a: 0.001, d: 0.05, g: 0.006 });
      });
      nz(t, { ft: 'highpass', f: 7000, a: 0.03, d: 0.25, g: 0.008 });
    },
    transform: function (t, P) { // the bell strikes, cracks, and falls into a dark swell
      [[1, 0.05, 0.5], [2.76, 0.02, 0.3], [5.4, 0.008, 0.15]].forEach(function (p) { osc(t, { f: 880 * p[0], a: 0.002, d: p[2], g: p[1] }); });
      var c = t + 0.22; // crack: a harsh noise snap, partials split and slide down
      nz(c, { f: 3200, q: 2.5, d: 0.08, g: 0.09 }); nz(c + 0.03, { ft: 'highpass', f: 2000, d: 0.12, g: 0.04 });
      osc(c, { f: 880, f2: 610, det: 30, a: 0.002, d: 0.9, g: 0.03, glide: 0.9 }); osc(c, { f: 932, f2: 590, det: -30, a: 0.002, d: 0.9, g: 0.025, glide: 0.9 });
      thump(c, 110, 0.18, 0.3, 45);
      var s = t + 0.5; // dark swell
      osc(s, { f: 55, type: 'sawtooth', lp: 260, a: 1.3, d: 2.2, g: 0.05 }); osc(s, { f: 58.3, type: 'sawtooth', lp: 260, a: 1.3, d: 2.2, g: 0.045 });
      osc(s, { f: 41, a: 1.2, d: 2.4, g: 0.1 });
      nz(s, { ft: 'lowpass', f: 180, f2: 500, a: 1.3, d: 1.6, g: 0.05, q: 0.7 });
    },
    whiteout: function (t, P) { // a rising high tone that thins into silence
      openTone(t, 4);
      osc(t, { f: 900, f2: 3400, a: 1.8, d: 1.8, g: 0.028, glide: 3.4 });
      osc(t, { f: 1350, f2: 5100, det: 6, a: 1.8, d: 1.4, g: 0.01, glide: 3.0 });
      nz(t, { ft: 'highpass', f: 4000, f2: 9000, a: 1.8, d: 1.2, g: 0.012, lin: true });
    },
    turncoat: function (t, P) { // a hopeful burst of light (always the warm palette)
      openTone(t, 2.5);
      swish(t, 900, 6000, 0.04, 0.3, 0.9);
      [0, 2, 4, 5, 7].forEach(function (deg, i) { chime(HOPE, t + 0.08 + i * 0.05, N(HOPE, deg), 0.035, 0.7); });
      osc(t + 0.1, { f: N(HOPE, 0) / 2, type: 'triangle', a: 0.15, d: 1.4, g: 0.04 }); osc(t + 0.1, { f: N(HOPE, 2) / 2, type: 'triangle', a: 0.15, d: 1.4, g: 0.03 });
      nz(t + 0.08, { ft: 'highpass', f: 6500, a: 0.1, d: 0.9, g: 0.014 });
    },
    phase2: function (t, P) { // a heavy, dissonant hit
      thump(t, 95, 0.45, 0.5, 32); nz(t, { ft: 'lowpass', f: 1800, d: 0.3, g: 0.16 });
      [110, 116.5, 155.6, 164.8].forEach(function (f) { osc(t, { f: f, type: 'sawtooth', lp: 900, a: 0.005, d: 1.3, g: 0.028 }); });
      [233, 329.6].forEach(function (f, i) { osc(t + 0.01, { f: f, det: i ? 18 : -14, a: 0.002, d: 0.9, g: 0.03 }); });
      thump(t + 0.09, 60, 0.2, 0.6, 30);
    },
    // ---- v2.3 §F.3: fallback stings for missing result tracks ----
    victoryTheme: function (t, P) { // short fanfare: rising arpeggio to a held chord; acts 2–3 are minor and darker
      var dark = P.act >= 2, Q = dark ? P : HOPE;
      if (!dark) openTone(t, 3);
      [0, 2, 4, 5].forEach(function (deg, i) { pluck(Q, t + i * 0.12, N(Q, deg), 0.09, 0.3); });
      var c = t + 0.55;
      [0, 2, 4].forEach(function (deg, i) { osc(c, { f: N(Q, deg), type: 'triangle', lp: dark ? 1800 : 4000, a: 0.04, d: 2.2, g: 0.045 - i * 0.008 }); });
      osc(c, { f: N(Q, 0) / 2, a: 0.08, d: 2.4, g: 0.06 });
      chime(Q, c, N(Q, 5), 0.05, 1.4); chime(Q, c + 0.18, N(Q, 7), 0.04, 1.6);
      if (dark) { bell(P, c + 0.1, N(P, 0) / 4, 0.03, 2.4); }
      else nz(c, { ft: 'highpass', f: 6500, a: 0.1, d: 1.0, g: 0.012 });
    },
    defeatTheme: function (t, P) { // slow descending minor line over a low drone, ending on a dull bell
      var Q = { act: 3, root: 293.66, scale: [0, 2, 3, 7, 8], lp: 2500, wet: 0.1, dec: 1, wave: 'triangle' };
      [4, 3, 1, 0].forEach(function (deg, i) { osc(t + i * 0.42, { f: N(Q, deg) / 2, type: 'triangle', lp: 1100, a: 0.03, d: 0.9 + i * 0.25, g: 0.06 }); });
      osc(t, { f: 55, a: 0.6, d: 3.2, g: 0.07 }); osc(t, { f: 55 * Math.pow(2, 1 / 12), type: 'sawtooth', lp: 220, a: 0.8, d: 2.6, g: 0.02 });
      nz(t, { ft: 'lowpass', f: 260, a: 0.8, d: 2, g: 0.03, q: 0.7 });
      bell(Q, t + 1.7, 73.4, 0.05, 2.6); thump(t + 1.7, 80, 0.16, 0.4, 40);
    },
    hover: function (t, P) { osc(t, { f: N(P, P.act === 3 ? 7 : 10), a: 0.004, d: 0.06, g: 0.02 }); },
    click: function (t, P) {
      if (P.act === 3) { osc(t, { f: N(P, -3), a: 0.001, d: 0.045, g: 0.12 }); nz(t, { f: 900, q: 2, d: 0.02, g: 0.05 }); return; }
      pluck(P, t, N(P, 4), 0.1, 0.09);
    },
    confirm: function (t, P) { pluck(P, t, N(P, 2), 0.1, 0.14); pluck(P, t + 0.07, N(P, 4), 0.1, 0.16); chime(P, t + 0.14, N(P, 7), 0.035, 0.35); },
    cancel: function (t, P) { pluck(P, t, N(P, 4), 0.08, 0.1); pluck(P, t + 0.07, N(P, 1), 0.07, 0.14); },
    pick: function (t, P) { swish(t, 1200, 3200, 0.04, 0.12, 1.2); pluck(P, t + 0.04, N(P, 5), 0.09, 0.14); },
    type: function (t, P) { nz(t, { ft: 'highpass', f: (P.act === 3 ? 2500 : 4000) + Math.random() * 2000, d: 0.01, g: 0.018 }); },
    advance: function (t, P) { swish(t, 600, 2400, 0.05, 0.22, 0.7); nz(t + 0.16, { f: 1800, q: 2, d: 0.02, g: 0.025 }); },
    side: function (t, P) { pluck(P, t, N(P, 3), 0.07, 0.1); pluck(P, t + 0.09, N(P, 5), 0.05, 0.12); },
    hire: function (t, P) {
      scratch(t, 6, 0.22, 0.03);
      thump(t + 0.28, 170, 0.22, 0.14, 70); nz(t + 0.28, { ft: 'lowpass', f: 1500, d: 0.05, g: 0.08 });
      chime(P, t + 0.36, N(P, 5), 0.05, 0.5); chime(P, t + 0.43, N(P, 7), 0.05, 0.5); chime(P, t + 0.5, N(P, 9), 0.05, 0.7);
    },
    reject: function (t, P) {
      swish(t, 2400, 700, 0.05, 0.25, 0.8);
      pluck(P, t + 0.06, N(P, 2) / 2, 0.08, 0.2); pluck(P, t + 0.16, N(P, 0) / 2, 0.07, 0.3);
    },
    enemyEnter: function (t, P) {
      osc(t, { f: 70, f2: P.act === 3 ? 52 : 92, a: 0.25, d: 0.5, g: 0.16 });
      nz(t, { ft: 'lowpass', f: 250, f2: 600, a: 0.25, d: 0.4, g: 0.07, q: 0.7 });
    },
    allyAttack: function (t, P) { swish(t, 1500, 5000, 0.08, 0.14, 1.2); osc(t + 0.02, { f: N(P, 7), a: 0.002, d: 0.06, g: 0.025 }); },
    enemyAttack: function (t, P) { swish(t, 500, 1600, 0.09, 0.18, 1.1); osc(t, { f: 110, f2: 80, type: 'triangle', a: 0.01, d: 0.15, g: 0.05 }); },
    hit: function (t, P) { thump(t, 160, 0.26, 0.16, 55); nz(t, { ft: 'lowpass', f: 1800, d: 0.07, g: 0.1 }); },
    bigHit: function (t, P) {
      thump(t, 120, 0.4, 0.35, 40); nz(t, { ft: 'lowpass', f: 2500, d: 0.2, g: 0.16 });
      nz(t, { f: 900, q: 1.5, d: 0.1, g: 0.08 }); thump(t + 0.06, 80, 0.15, 0.25, 35);
    },
    crit: function (t, P) { // DESIGN-skill-level 收尾: 暴击 — crisper and brighter than bigHit: a glassy crack + a high ping on a short body
      openTone(t, 0.5);
      nz(t, { ft: 'highpass', f: 4200, d: 0.03, g: 0.2 }); nz(t, { f: 7000, q: 2.5, d: 0.07, g: 0.1 });
      osc(t, { f: 2093, f2: 2637, type: 'square', a: 0.001, d: 0.05, g: 0.03, lp: 9000, glide: 0.03 });
      [[1, 0.07, 0.32], [2.76, 0.03, 0.18], [5.4, 0.015, 0.1]].forEach(function (p) { osc(t + 0.012, { f: 1568 * p[0], a: 0.001, d: p[2], g: p[1] }); });
      thump(t, 190, 0.22, 0.12, 70);
    },
    heal: function (t, P) {
      chime(P, t, N(P, 5), 0.05, 0.6); chime(P, t + 0.06, N(P, 7), 0.05, 0.6); chime(P, t + 0.12, N(P, 9), 0.05, 0.8);
      nz(t, { ft: 'highpass', f: 6000, a: 0.1, d: 0.3, g: 0.012 });
    },
    miss: function (t, P) { swish(t, 3000, 900, 0.045, 0.2, 0.8); },
    guard: function (t, P) {
      var f = P.act === 3 ? 380 : 520;
      [[1, 0.05, 0.25], [2.4, 0.03, 0.18], [3.9, 0.02, 0.12], [5.3, 0.012, 0.08]].forEach(function (p) { osc(t, { f: f * p[0], a: 0.001, d: p[2], g: p[1] }); });
      thump(t, 200, 0.14, 0.06, 120);
    },
    chargeTick: function (t, P, d) {
      var n = Math.max(0, Math.min(16, (d && +d.n) || 0)), f = (P.act === 3 ? 220 : 330) * Math.pow(2, n * 2 / 12);
      osc(t, { f: f, a: 0.002, d: 0.06, g: 0.05 }); osc(t, { f: f * 2, a: 0.001, d: 0.025, g: 0.012 });
    },
    chargeRelease: function (t, P) {
      osc(t, { f: 200, f2: 1200, type: 'sine', a: 0.01, d: 0.22, g: 0.06, glide: 0.2 });
      swish(t, 800, 6000, 0.06, 0.24, 1);
      thump(t + 0.2, 140, 0.3, 0.25, 45); nz(t + 0.2, { ft: 'lowpass', f: 2200, d: 0.12, g: 0.1 });
    },
    combo: function (t, P, d) {
      var depth = Math.max(1, Math.min(12, (d && +d.depth) || 1)), f = N(P, 3 + depth);
      pluck(P, t, f, 0.08, 0.16); chime(P, t + 0.01, f, 0.035, 0.35);
      if (depth >= 3) chime(P, t + 0.06, f * 2, 0.015 + 0.002 * depth, 0.3);
    },
    kill: function (t, P) {
      thump(t, 130, 0.26, 0.25, 45); nz(t + 0.02, { ft: 'lowpass', f: 1200, a: 0.02, d: 0.35, g: 0.06 });
      chime(P, t + 0.1, N(P, 7), 0.035, 0.3); chime(P, t + 0.18, N(P, 4), 0.03, 0.4);
    },
    allyDown: function (t, P) {
      thump(t, 90, 0.26, 0.4, 40);
      osc(t + 0.1, { f: N(P, 2) / 2, a: 0.02, d: 0.6, g: 0.06 }); osc(t + 0.38, { f: N(P, 0) / 2, a: 0.02, d: 0.9, g: 0.06 });
    },
    pause: function (t, P) { osc(t, { f: 300, f2: 220, a: 0.01, d: 0.18, g: 0.05 }); },
    move: function (t, P) { nz(t, { f: 900, q: 1.5, d: 0.05, g: 0.06 }); nz(t + 0.08, { f: 750, q: 1.5, d: 0.05, g: 0.05 }); },
    advisorSkill: function (t, P) {
      for (var i = 0; i < 6; i++) chime(P, t + i * 0.035, N(P, 5 + i), 0.028, 0.4);
      nz(t, { ft: 'highpass', f: 5000, a: 0.15, d: 0.4, g: 0.015 }); osc(t, { f: N(P, 0) / 2, a: 0.05, d: 0.6, g: 0.045 });
    },
    item: function (t, P) {
      osc(t, { f: 300, f2: 900, a: 0.002, d: 0.06, g: 0.1, glide: 0.05 });
      osc(t + 0.09, { f: 500, f2: 800, a: 0.005, d: 0.07, g: 0.04 }); osc(t + 0.17, { f: 560, f2: 880, a: 0.005, d: 0.07, g: 0.03 });
    },
    frenzy: function (t, P) {
      thump(t, 70, 0.36, 0.18, 45); thump(t + 0.22, 70, 0.28, 0.2, 45);
      osc(t, { f: 110, type: 'sawtooth', lp: 420, a: 0.3, d: 0.8, g: 0.035 }); osc(t, { f: 116.5, type: 'sawtooth', lp: 420, a: 0.3, d: 0.8, g: 0.035 });
    },
    victory: function (t, P) {
      [0, 2, 4, 5].forEach(function (deg, i) { pluck(P, t + i * 0.09, N(P, deg), 0.1, 0.25); });
      chime(P, t + 0.4, N(P, 7), 0.06, 1.0); osc(t + 0.4, { f: N(P, 0) / 2, a: 0.02, d: 0.9, g: 0.05 });
    },
    defeat: function (t, P) {
      [4, 2, 0].forEach(function (deg, i) { osc(t + i * 0.3, { f: N(P, deg) / 2, type: 'triangle', lp: 1200, a: 0.02, d: 0.8, g: 0.07 }); });
      osc(t, { f: 55, a: 0.3, d: 1.5, g: 0.07 });
    },
    reward: function (t, P) {
      chime(P, t, N(P, 7), 0.05, 0.5); chime(P, t + 0.08, N(P, 9), 0.05, 0.7);
      nz(t, { ft: 'highpass', f: 7000, a: 0.05, d: 0.3, g: 0.012 });
    },
    debuff: function (t, P) {
      var f = N(P, 0) / 2;
      osc(t, { f: f, type: 'triangle', lp: 900, a: 0.05, d: 0.6, g: 0.05 }); osc(t, { f: f * Math.pow(2, 1 / 12), type: 'triangle', lp: 900, a: 0.05, d: 0.6, g: 0.045 });
      thump(t, 80, 0.12, 0.2, 50);
    },
    darkTransition: function (t, P) {
      nz(t, { ft: 'lowpass', f: 200, f2: 1500, a: 1.6, d: 0.5, g: 0.06, q: 0.7 });
      osc(t, { f: 55, f2: 41, a: 1.2, d: 1.6, g: 0.16, glide: 2.6 });
      bell(P, t + 1.6, 98, 0.05, 2.2); thump(t + 1.6, 90, 0.2, 0.4, 40);
    },
    sacrificeConfirm: function (t, P) { bell(P, t, 110, 0.09, 3.2); osc(t, { f: 55, a: 0.05, d: 2.5, g: 0.09 }); duck(0.45, 3.5); },
    nameStrike: function (t, P) { nz(t, { f: 2000, f2: 4500, q: 3, a: 0.02, d: 0.16, g: 0.06 }); scratch(t + 0.02, 4, 0.14, 0.03); },
    reckoning: function (t, P) {
      osc(t, { f: 55, type: 'sawtooth', lp: 300, a: 0.8, d: 2.2, g: 0.045 }); osc(t, { f: 58.3, type: 'sawtooth', lp: 300, a: 0.8, d: 2.2, g: 0.04 });
      nz(t, { ft: 'lowpass', f: 300, a: 0.8, d: 1.6, g: 0.04 });
      bell(P, t + 0.6, 87, 0.07, 3);
      duck(0.45, 5);
    },
    debtDot: function (t, P) { var f = (P.act === 3 ? 420 : 520) * (0.94 + Math.random() * 0.12); osc(t, { f: f, f2: f / 2, a: 0.002, d: 0.07, g: 0.06 }); },
    flashback: function (t, P) {
      nz(t, { ft: 'highpass', f: 3000, a: 0.6, d: 0.08, g: 0.035, lin: true });
      osc(t, { f: N(P, 7), det: 12, a: 0.5, d: 0.6, g: 0.025 }); osc(t, { f: N(P, 9), det: -12, a: 0.5, d: 0.6, g: 0.02 });
    },
    moodDown: function (t, P) { osc(t, { f: N(P, 4), a: 0.005, d: 0.18, g: 0.05 }); osc(t + 0.1, { f: N(P, 2), a: 0.005, d: 0.25, g: 0.05 }); },
    moodUp: function (t, P) { osc(t, { f: N(P, 2), a: 0.005, d: 0.18, g: 0.05 }); osc(t + 0.1, { f: N(P, 4), a: 0.005, d: 0.25, g: 0.05 }); },
    gallery: function (t, P, d) {
      var kind = d && (d.kind || d.type);
      if (kind !== 'applause') { // murmur: vowel-ish formant bursts over a low bed
        nz(t, { ft: 'lowpass', f: 500, a: 0.3, d: 1.4, g: 0.02 });
        for (var i = 0; i < 18; i++) nz(t + Math.random() * 1.5, { f: 300 + Math.random() * 600, q: 5, a: 0.04, d: 0.12 + Math.random() * 0.2, g: 0.02 + Math.random() * 0.02 });
      }
      if (kind !== 'murmur') { // polite applause: sparse claps, thinning out
        var t0 = t + (kind === 'applause' ? 0 : 0.4);
        for (var k = 0; k < 36; k++) {
          var x = Math.pow(Math.random(), 1.6) * 1.4;
          nz(t0 + x, { f: 1200 + Math.random() * 1300, q: 1.2, d: 0.03 + Math.random() * 0.025, g: (0.02 + Math.random() * 0.03) * (1 - x / 1.6) });
        }
      }
    }
  };

  function rainOn() {
    rainWanted = true;
    if (!running()) return;
    var t = ac.currentTime;
    if (rain) { rain.g.gain.cancelScheduledValues(t); rain.g.gain.setValueAtTime(rain.g.gain.value, t); rain.g.gain.linearRampToValueAtTime(0.09, t + 2); return; }
    var P = palette(), g = ac.createGain(), hp = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 450; lp.type = 'lowpass'; lp.frequency.value = P.act === 3 ? 2200 : 3200;
    var s1 = ac.createBufferSource(); s1.buffer = noiseBuf; s1.loop = true;
    var s2 = ac.createBufferSource(); s2.buffer = noiseBuf; s2.loop = true; s2.playbackRate.value = 0.73;
    var bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
    var g2 = ac.createGain(); g2.gain.value = 0.5;
    var lfo = ac.createOscillator(), lfoG = ac.createGain(); lfo.frequency.value = 0.13; lfoG.gain.value = 500;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    s1.connect(hp); hp.connect(lp); lp.connect(g);
    s2.connect(bp); bp.connect(g2); g2.connect(g);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 2);
    g.connect(bus); // dry, straight to the bus
    s1.start(t, Math.random() * 2); s2.start(t, Math.random() * 2); lfo.start(t);
    rain = { g: g, srcs: [s1, s2, lfo] };
  }
  function rainOff() {
    rainWanted = false;
    if (!rain || !ac) { rain = null; return; }
    var r = rain, t = ac.currentTime; rain = null;
    try {
      r.g.gain.cancelScheduledValues(t); r.g.gain.setValueAtTime(r.g.gain.value, t); r.g.gain.linearRampToValueAtTime(0.0001, t + 2.5);
      r.srcs.forEach(function (s) { s.stop(t + 2.7); });
    } catch (e) { warn('rainOff', e); }
  }

  // campfire: soft low crackle bed + random pops/snaps scheduled ahead, quieter than the rain
  function fireOn() {
    fireWanted = true;
    if (!running()) return;
    var t = ac.currentTime;
    if (fire) { fire.g.gain.cancelScheduledValues(t); fire.g.gain.setValueAtTime(fire.g.gain.value, t); fire.g.gain.linearRampToValueAtTime(1, t + 1.5); return; }
    var g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + 1.5); g.connect(bus);
    var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = 0.6;
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.4;
    var bg = ac.createGain(); bg.gain.value = 0.035;
    var lfo = ac.createOscillator(), lfoG = ac.createGain(); lfo.frequency.value = 0.21; lfoG.gain.value = 0.012;
    lfo.connect(lfoG); lfoG.connect(bg.gain);
    s.connect(lp); lp.connect(bg); bg.connect(g);
    s.start(t, Math.random() * 2); lfo.start(t);
    var f = { g: g, srcs: [s, lfo], timer: null, next: t + 0.2 };
    function schedule() {
      if (fire !== f || !ac) return;
      var horizon = ac.currentTime + 0.6;
      while (f.next < horizon) {
        var big = Math.random() < 0.12;
        if (big) { // a snap: bright pop + tiny low knock
          nz(f.next, { ft: 'bandpass', f: 1800 + Math.random() * 2000, q: 1.5, d: 0.02 + Math.random() * 0.02, g: 0.03 + Math.random() * 0.025, dest: g });
          osc(f.next, { f: 140 + Math.random() * 60, f2: 70, a: 0.001, d: 0.04, g: 0.03, dest: g });
        } else { // a crackle: tiny dry tick
          nz(f.next, { ft: 'highpass', f: 2500 + Math.random() * 3000, d: 0.004 + Math.random() * 0.01, g: 0.008 + Math.random() * 0.016, dest: g });
        }
        f.next += Math.random() < 0.3 ? 0.02 + Math.random() * 0.05 : 0.08 + Math.random() * 0.35; // little clusters
      }
    }
    f.timer = setInterval(safe('fire', schedule), 200);
    fire = f; schedule();
  }
  function fireOff() {
    fireWanted = false;
    if (!fire || !ac) { fire = null; return; }
    var f = fire, t = ac.currentTime; fire = null;
    try {
      clearInterval(f.timer);
      f.g.gain.cancelScheduledValues(t); f.g.gain.setValueAtTime(f.g.gain.value, t); f.g.gain.linearRampToValueAtTime(0.0001, t + 1.8);
      f.srcs.forEach(function (s) { s.stop(t + 2); });
      setTimeout(function () { try { f.g.disconnect(); } catch (e) { /* ignore */ } }, 2600);
    } catch (e) { warn('fireOff', e); }
  }

  function cue(name, detail) {
    if (name === 'rainStart') { rainWanted = true; if (running()) rainOn(); return; }
    if (name === 'rainStop') { rainOff(); return; }
    if (name === 'fireStart' || name === 'fire') { fireWanted = true; if (running()) fireOn(); return; }
    if (name === 'fireStop') { fireOff(); return; }
    if (name === 'reckoning' || name === 'sacrificeConfirm') { /* duck even when sfx can't play */ duck(0.45, name === 'reckoning' ? 5 : 3.5); }
    if (name === 'transform') duck(0.3, 4.5);
    var fn = C[name];
    if (!fn || !running()) return;
    var now = Date.now(), th = THROTTLE[name] || SAME_MIN;
    if (lastCue[name] && now - lastCue[name] < th) return;
    if (name !== 'type' && !BUDGET_FREE[name]) { // v2.6: a long chain's ticks must all sound
      while (recent.length && now - recent[0] >= BUDGET_WINDOW) recent.shift();
      if (recent.length >= BUDGET) return;
      recent.push(now);
    }
    lastCue[name] = now;
    if (detail && detail.act) { var keep = act; act = +detail.act || act; fn(ac.currentTime + 0.005, palette(), detail); act = keep; return; }
    fn(ac.currentTime + 0.005, palette(), detail || null);
  }

  // =====================================================================================================
  // unlock / settings
  // =====================================================================================================
  var listening = false;
  var GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown'];
  function onRunning() {
    if (rainWanted && !rain) rainOn();
    if (fireWanted && !fire) fireOn();
    if (running()) removeListeners();
  }
  function unlock() {
    unlocked = true;
    var c = ensureCtx();
    if (c && c.state !== 'running') {
      try { var p = c.resume(); if (p && p.then) p.then(safe('resume', onRunning), noop); } catch (e) { warn('resume', e); }
    } else onRunning();
    decks.forEach(function (d) { if (d.target > 0) tryPlay(d); });
    kick();
  }
  var onGesture = safe('gesture', unlock);
  function addListeners() {
    if (listening || !root.document) return;
    listening = true;
    GESTURES.forEach(function (ev) { root.document.addEventListener(ev, onGesture, true); });
  }
  function removeListeners() {
    if (!listening || !root.document) return;
    listening = false;
    GESTURES.forEach(function (ev) { root.document.removeEventListener(ev, onGesture, true); });
  }

  function setMuted(b) {
    S.muted = !!b; save();
    decks.forEach(applyDeck);
    if (bus && ac) bus.gain.setTargetAtTime(S.muted ? 0 : S.sfx, ac.currentTime, 0.03);
  }
  function setVolume(music, sfx) {
    if (music != null) S.music = clamp01(music, S.music);
    if (sfx != null) S.sfx = clamp01(sfx, S.sfx);
    save();
    decks.forEach(applyDeck);
    if (bus && ac) bus.gain.setTargetAtTime(S.muted ? 0 : S.sfx, ac.currentTime, 0.03);
  }

  var sceneTimer = null;
  try { Object.keys(ONE_SHOT).concat(Object.keys(LOOP_FALLBACK)).forEach(probe); } catch (e) { /* ignore */ }

  // V2.4 [16] result music: played once per battle id, only when the UI shows the result panel
  var playedResults = {}, resultHold = false;
  function playResult(kind, a, battleId) {
    var key = battleId == null ? null : String(battleId);
    if (key !== null) { if (playedResults[key]) return false; playedResults[key] = true; }
    var id = kind === 'defeat' ? 'defeat' : kind === 'victory' ? ((+a || act) >= 2 ? 'victory-dark' : 'victory') : null;
    if (!id) return false;
    if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; } // a pending delayed scene must not cut the result music
    resultHold = true;
    playTrack(id, 1);
    return true;
  }

  var API = {
    TRACKS: TRACKS.slice(), CUES: CUES.slice(),
    init: safe('init', function () { addListeners(); if (userActive()) unlock(); return true; }),
    scene: safe('scene', function (c, opts) {
      if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
      var ms = opts && +opts.delay;
      ms = isFinite(ms) && ms > 0 ? (ms <= 10 ? ms * 1000 : ms) : 0;
      var run = safe('scene', function () {
        sceneTimer = null;
        if (c && typeof c === 'object' && c.act) { var na = +c.act || act; if (na !== act) { act = na; applyPalette(); } }
        // re-renders of the result screen keep the result music playing (never restart / replace it)
        if (resultHold && c && typeof c === 'object' && c.phase === 'battleResult') return;
        resultHold = false;
        playTrack(trackFor(c), levelFor(c), altFor(c));
      });
      if (ms) sceneTimer = setTimeout(run, ms); else run();
    }),
    playResult: safe('playResult', playResult),
    cue: safe('cue', cue),
    setMuted: safe('setMuted', setMuted),
    isMuted: function () { return !!S.muted; },
    setVolume: safe('setVolume', setVolume),
    getVolume: function () { return { music: S.music, sfx: S.sfx }; },
    // tools / tests
    trackFor: safe('trackFor', trackFor),
    levelFor: safe('levelFor', levelFor),
    play: safe('play', function (id) { playTrack(id); }),
    // 真结局片尾: the ending song (falls back to dawn when music/theme-song.mp3 is missing); length in ms once known, else null
    themeSong: safe('themeSong', function () { if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; } resultHold = false; playTrack('themeSong', 1, 'dawn'); return true; }),
    trackMs: safe('trackMs', function (id) { for (var i = 0; i < decks.length; i++) { var d = decks[i]; if (d.id === id && !d.failed && isFinite(d.el.duration) && d.el.duration > 0) return Math.round(d.el.duration * 1000); } return null; }),
    musicFile: function (id) { return fileOf(id); },
    stop: safe('stop', function () { if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; } resultHold = false; playTrack(null); rainOff(); fireOff(); }),
    altFor: safe('altFor', altFor),
    setAct: safe('setAct', function (n) { act = Math.max(1, Math.min(3, +n || 1)); applyPalette(); }),
    setDebug: function (b) { DEBUG = !!b; },
    state: function () {
      return {
        unlocked: unlocked, ctx: ac ? ac.state : 'none', missing: missing, pendingScene: !!sceneTimer, resultHold: resultHold, playedResults: Object.keys(playedResults), act: act, track: current, muted: S.muted, music: S.music, sfx: S.sfx, duck: duckCur, rain: !!rain, fire: !!fire, cuesLastSecond: recent.length,
        decks: decks.map(function (d) { return { id: d.id, g: +d.g.toFixed(2), target: d.target, lvl: +d.lvl.toFixed(2), failed: d.failed, once: d.once, done: d.done, paused: d.el.paused, src: d.el.currentSrc || d.el.src }; })
      };
    }
  };
  root.CHOOSER_AUDIO = API;
  try { addListeners(); } catch (e) { /* ignore */ }
})(typeof window !== 'undefined' ? window : this);
