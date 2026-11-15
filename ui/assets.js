// 《欢迎加入冒险者公会！》 — the asset depot (docs/V2-CONTRACT.md §6, docs/ASSET-DEPOT.md).
// Every slot returns an ORDERED CANDIDATE LIST of paths (relative to ui/index.html). app.js tries them in order and
// falls back on load error, so new art lights up just by being dropped into place — no flags, no code changes.
// A candidate may carry CSS classes after '#', e.g. '../art/portraits/eve.png#masked' (fade the square edges) or
// '#cfilter-possessed' (CSS corruption filter, used when no corrupted art exists yet). When every candidate fails the
// slot shows its fallback (CSS gradient for scenes, a crest for the leader, an initial for everyone else).
(function (root) {
  'use strict';
  var ART = '../art/', CELLS = ART + 'cells/', PORT = ART + 'portraits/', ALPHA = PORT + 'alpha/', CUT = '../godot/ext/cutouts/portraits/';

  var CANDIDATES = ['marta', 'eve', 'rico', 'awu', 'cecy', 'greta', 'viola', 'xiaoman', 'crow', 'kiki'];
  var ADVISORS = ['audrey', 'lucienne', 'nicota'];
  var FAIRIES = ['fairy', 'fairy-demon']; // v2.2 小铃: a small floating chibi (fills ~60% of her frame)
  // expressions the content may use that have no face of their own yet → the nearest drawn one
  var EXPR_NEAR = { determined: 'calm', hollow: 'sad', angry: 'upset', cry: 'sad', smile: 'happy', surprised: 'shock', 'vengeful-sneer': 'upset', 'vengeful-rage': 'upset',
    'vengeful-tears': 'sad', 'possessed-grin': 'special', 'possessed-blank': 'calm', 'possessed-flash': 'sad' };

  // enemy data id → art/cells/enemies/<file>.png
  var ENEMIES = {
    slime: 'slime', goblin: 'goblin-captain', 'goblin-boss': 'goblin-captain', skeleton: 'skeleton-soldier', 'skeleton-archer': 'skeleton-archer',
    ghoul: 'crypt-ghoul', 'gate-guardian': 'stone-gate-guardian', 'tomb-minion': 'masked-spectator-a', 'bandit-officer': 'magic-thieves-officer',
    'bandit-chief': 'magic-thieves-chief', 'mercenary-blade': 'masked-spectator-b', 'mercenary-archer': 'masked-spectator-a',
    'noble-guard': 'masked-spectator-b', 'masked-champion': 'blank-general',
    'mercenary-guard': 'masked-spectator-b', 'mercenary-priest': 'masked-spectator-a' // 2026-11-14: stand-ins until their own art (art brief: mercenary guard, mercenary priest)
  };
  var ROLE_ICON = { tank: 'shield', adc: 'bow', healer: 'chalice', mage: 'staff', rogue: 'dagger' };
  var MOOD_ICON = { '-2': 'mood-minus-2', '-1': 'mood-minus-1', '0': 'mood-neutral', '1': 'mood-plus-1', '2': 'mood-plus-2' };
  var ITEM_ICON = { potion: 'reward-heart', smoke: 'storm-cloud', drum: 'reward-ribbon', holywater: 'chalice' };

  // ---- scenes: v4 ids (art/discussion-v4-scenes.md §2) → old 512px cells as the second candidate ----
  var SCENES = ['title', 'guild-hall-day', 'guild-hall-night', 'guild-desk', 'interview-room', 'stage-01-mill', 'stage-02-forest', 'stage-03-tomb-gate',
    'stage-03-tomb-hall', 'sealing', 'stage-04-names', 'stage-05-gate', 'sacrifice-altar', 'sacrifice-altar-after', 'taken', 'camp-night', 'stage-06-corridor',
    'stage-07-corridor-deep', 'stage-08-arena', 'stage-09-tavern', 'advisor-gone', 'throne', 'throne-fallen', 'dawn-exit', 'game-over', 'camp-dusk', 'camp-cold',
    'title-fairy', 'noble-chamber', 'noble-chamber-broken', 'white-room', 'guild-dawn-full'];
  var OLD_SCENE = { title: 'guild-hall', 'guild-hall-day': 'guild-hall', 'guild-hall-night': 'guild-hall', 'guild-desk': 'guild-hall', 'interview-room': 'interview',
    'stage-01-mill': 'guild-hall', 'stage-02-forest': 'guild-hall', 'stage-03-tomb-gate': 'gate-seals', 'stage-03-tomb-hall': 'gate-seals', sealing: 'gate-seals',
    'stage-04-names': 'noble-gallery', 'stage-05-gate': 'gate-seals', 'sacrifice-altar': 'sacrifice', 'sacrifice-altar-after': 'sacrifice', taken: 'sacrifice',
    'camp-night': 'noble-gallery', 'camp-dusk': 'guild-hall', 'camp-cold': 'gate-seals', 'stage-06-corridor': 'noble-gallery', 'stage-07-corridor-deep': 'noble-gallery', 'stage-08-arena': 'general-emerges',
    'stage-09-tavern': 'advisor-leaves', 'advisor-gone': 'advisor-leaves', throne: 'final-throne', 'throne-fallen': 'final-throne', 'dawn-exit': 'guild-hall', 'game-over': 'gate-seals',
    'title-fairy': 'guild-hall', 'noble-chamber': 'noble-gallery', 'noble-chamber-broken': 'noble-gallery', 'white-room': 'guild-hall', 'guild-dawn-full': 'guild-hall' };
  var STORY_SCENE = {
    opening: 'guild-hall-day', advisorAsks: 'guild-desk', leaderPrompt: 'guild-desk', advisorPrompt: 'guild-hall-day', interviewIntro: 'interview-room',
    sealing: 'sealing', sealRefuse: 'sealing', sealAccept: 'sealing', /* batch6 H2-8 (user fix): after the gate slam (its own low-res cine, A.gateArt) → the original 1080p high-gallery scene scenes/sealing.png */ belowTomb: 'stage-06-corridor', /* feedback-1112 #7/#17 */ debuffIntro: 'stage-04-names', sacrificeIntro: 'sacrifice-altar', sacrificeRandomTaken: 'taken', sacrificeRandomTakenOne: 'taken', rejectedReturn: 'stage-06-corridor',
    firstReturn: 'stage-08-arena', secondSacrificeIntro: 'sacrifice-altar', aftermath: 'sacrifice-altar-after', fakeBoss: 'stage-09-tavern',
    advisorLeaves: 'advisor-gone', finalReveal: 'throne', victory: 'throne-fallen', gameOver: 'game-over',
    // v2.2
    fairyWelcome: 'guild-hall-day', sacrificeSelf: 'sacrifice-altar', firstReturnSelf: 'stage-08-arena', secondSacrificeIntroSelf: 'sacrifice-altar',
    bellEvent: 'camp-night', bellFollowed: 'stage-07-corridor-deep', trueDoor: 'throne-fallen', nobleChamber: 'noble-chamber', l11After: 'noble-chamber', trueEnding: 'noble-chamber-broken',
    normalEnding: 'throne-fallen',
    // feedback-1112 #35/#39: L9 → the door → the throne room; the white room is a scene of its own
    l9Freedom: 'stage-09-tavern', throneRoom: 'throne', throneAdvisor: 'throne', whiteRoom: 'white-room'
  };
  // the battlefield of each level (formats B)
  var LEVEL_SCENE = { 1: 'stage-01-mill', 2: 'stage-02-forest', 3: 'stage-03-tomb-hall', 4: 'stage-04-names', 5: 'stage-05-gate', 6: 'stage-06-corridor',
    7: 'stage-07-corridor-deep', 8: 'stage-08-arena', 9: 'stage-09-tavern', 10: 'throne', 11: 'noble-chamber' };
  // between levels (prep) is always a campfire rest, never the next battlefield: act 1 dusk, act 2 the cold crypt, act 3 night
  // 叙事节奏 2026-11-13: L11's night is a campfire too (the noble chamber shows from its scene intro on); march = old saves only
  function prepScene(v) { if (v.camp && v.camp.march) return LEVEL_SCENE[v.level] || 'throne'; /* feedback-1112 #35: no campfire before L10 */ var a = v.act || 1; return a >= 3 ? 'camp-night' : a === 2 ? 'camp-cold' : 'camp-dusk'; }
  // 修复 2026-11-13 第二幕首个篝火无背景: every campfire's chain stays campfire art (was: camp-night → the masked gallery cell);
  // the act-1 fire with a cold tint ('#cold', app.js setScene → .bg.cold) is the last campfire resort for the crypt / night camps
  var SCENE_FALLBACK = { 'camp-dusk': ['camp-night.png'], 'camp-cold': ['camp-night.png', 'camp-dusk.png#cold'], 'camp-night': ['camp-cold.png', 'camp-dusk.png#cold'],
    'title-fairy': 'title.png', 'guild-dawn-full': 'dawn-exit.png', 'noble-chamber-broken': 'noble-chamber.png' }; // only if the new art goes missing
  // the ending's own scene: the true ending at the guild at dawn, the plain victory in the white room
  function endingScene(s) { var o = s && s.outcome; return o === 'true' ? 'guild-dawn-full' : o === 'victory' ? (s.whiteout ? 'white-room' : 'dawn-exit') : 'game-over'; }
  function sceneFor(v) {
    if (!v) return 'title-fairy';
    switch (v.phase) {
      case 'story': return STORY_SCENE[v.storyId] || LEVEL_SCENE[v.level] || 'guild-hall-day';
      case 'difficulty': return STORY_SCENE.fairyWelcome || 'guild-hall-day';
      case 'advisor': return 'guild-hall-day';
      case 'leader': return 'guild-desk';
      case 'interview': return 'interview-room';
      case 'prep': return prepScene(v);
      case 'battle': case 'battleResult': return LEVEL_SCENE[v.level] || 'stage-01-mill';
      case 'reward': return LEVEL_SCENE[v.level] || 'guild-hall-day';
      case 'debuff': return 'stage-04-names';
      case 'sacrifice': return 'sacrifice-altar';
      case 'ending': return endingScene(v.summary);
      case 'gameOver': return 'game-over';
      default: return LEVEL_SCENE[v.level] || 'guild-hall-day';
    }
  }

  function isCand(id) { return CANDIDATES.indexOf(id) >= 0; }
  function isAdv(id) { return ADVISORS.indexOf(id) >= 0; }
  function isFairy(id) { return FAIRIES.indexOf(id) >= 0; }
  // the standing cut-out of anyone. opts.variant: 'base' | 'vengeful' | 'possessed' | 'boss' | 'worn'
  function portrait(id, opts) {
    var o = opts || {}, v = o.variant || 'base';
    if (id === 'leader') {
      var lw = v === 'worn' ? [ALPHA + 'leader-worn.png', PORT + 'leader-worn.png#masked'] : [];
      return lw.concat([ALPHA + 'leader.png', PORT + 'leader.png#masked']); // → crest placeholder
    }
    if (isFairy(id)) return [ALPHA + id + '.png', PORT + id + '.png#masked'];
    if (isAdv(id)) {
      if (v === 'boss') return [ALPHA + id + '-boss.png', CUT + id + '-boss.png', PORT + id + '-boss.png#masked', CELLS + 'advisors-v2/' + id + '-boss.png#masked'];
      return [ALPHA + id + '.png', CUT + id + '.png', PORT + id + '.png#masked', CELLS + 'advisors-v2/' + id + '-bright.png#masked'];
    }
    if (!isCand(id)) return [];
    var base = [ALPHA + id + '.png', CUT + id + '.png', PORT + id + '.png#masked', CELLS + 'cast-v2/' + id + '-bright.png#masked'];
    if (v === 'vengeful' || v === 'possessed') {
      return addCls([ALPHA + id + '-' + v + '.png', PORT + id + '-' + v + '.png#masked', CELLS + 'cast-v2/' + id + '-dark.png#masked cfilter-' + v]
        .concat(base.map(function (p) { return p + (p.indexOf('#') >= 0 ? ' ' : '#') + 'cfilter-' + v; })), STAND_SCALE[id]);
    }
    return addCls(base, STAND_SCALE[id]);
  }
  // feedback-1113 (3rd batch) #2: some new cut-outs fill their whole frame (Marta + her shield). A class per girl shrinks her
  // standing portrait everywhere (style.css `.pic.sc-<id>:not(.crop)`, bottom-anchored); round face crops ignore it.
  var STAND_SCALE = { marta: 'sc-marta' };
  function addCls(list, c) { return c ? list.map(function (p) { return p + (p.indexOf('#') >= 0 ? ' ' : '#') + c; }) : list; }
  // Which expressions are drawn for whom (art/cells/faces/<id>-<expr>.png). An expression outside the set goes straight to its
  // nearest drawn one, so the browser never asks for a file that cannot exist. When Codex draws a new expression, add it here.
  var BASE6 = ['calm', 'happy', 'upset', 'sad', 'shock', 'special'];
  var DARK6 = ['vengeful-sneer', 'vengeful-rage', 'vengeful-tears', 'possessed-grin', 'possessed-blank', 'possessed-flash'];
  var LEADER6 = ['calm', 'happy', 'determined', 'sad', 'shock', 'hollow'];
  var LEADER_NEAR = { upset: 'sad', special: 'determined', angry: 'determined', cry: 'sad', smile: 'happy', surprised: 'shock' };
  function drawn(id) { return id === 'leader' ? LEADER6 : isCand(id) ? BASE6.concat(DARK6) : isAdv(id) || isFairy(id) ? BASE6 : []; }
  function near(id, e) {
    var d = drawn(id); if (d.indexOf(e) >= 0) return e;
    var n = id === 'leader' ? LEADER_NEAR[e] : EXPR_NEAR[e];
    return n && d.indexOf(n) >= 0 ? n : 'calm';
  }
  function faceFile(id, e) { return CELLS + 'faces/' + id + '-' + e + '.png'; }
  // a round dialogue face. Corrupted expressions fall back to the corrupted portrait, never to the bright one.
  function face(id, expr, opts) {
    var o = opts || {}, e = expr || 'calm';
    if (o.variant === 'boss' && isAdv(id)) return crop(portrait(id, { variant: 'boss' })); // no boss faces drawn: the boss cut-out, cropped
    if (o.variant === 'flash') return [faceFile(id, near(id, e)), faceFile(id, 'possessed-flash'), faceFile(id, 'sad')].concat(crop(portrait(id)));
    var corrupt = /^(vengeful|possessed)/.exec(e), cv = o.variant === 'vengeful' || o.variant === 'possessed' ? o.variant : corrupt ? corrupt[1] : null;
    if (cv) {
      e = A.corruptExpr(cv, e); // G1 #7: sad → vengeful-tears, upset → vengeful-rage … (was: always the sneer)
      return (isCand(id) ? [faceFile(id, e)] : []).concat(crop(portrait(id, { variant: cv })));
    }
    var out = drawn(id).length ? [faceFile(id, near(id, e))] : [];
    if (out.length && near(id, e) !== 'calm') out.push(faceFile(id, 'calm'));
    return out.concat(crop(portrait(id, o.variant === 'worn' ? o : {})));
  }
  function crop(list) { // portrait → head crop for a round face: drop the edge mask, add .crop
    return list.map(function (p) {
      var i = p.indexOf('#'), cls = i < 0 ? [] : p.slice(i + 1).split(' ').filter(function (c) { return c && c !== 'masked'; });
      return (i < 0 ? p : p.slice(0, i)) + '#' + cls.concat('crop').join(' ');
    });
  }
  function enemy(enemyId) { return [CELLS + 'enemies/' + (ENEMIES[enemyId] || 'blank-general') + '.png', CELLS + 'enemies/blank-general.png']; }
  function scene(id) {
    if (id === 'noble-gallery') return [CELLS + 'moments-16x9/noble-gallery.png#lores', CELLS + 'key-moments/noble-gallery.png#lores', ART + 'scenes/stage-04-names.png']; // batch6 H2-8: 高台 (the only gallery art: low-res moment; the L4 hall with its high gallery as fallback)
    if (id === 'sealing') return [ART + 'scenes/sealing.png']; // batch6 user fix: the story scenes after the slam show the original 1080p high gallery; the slam itself uses A.gateArt (old low-res gate)
    var k = SCENES.indexOf(id) >= 0 ? id : 'guild-hall-day', out = [ART + 'scenes/' + k + '.png'];
    [].concat(SCENE_FALLBACK[k] || []).forEach(function (f) { out.push(ART + 'scenes/' + f); });
    return out.concat([CELLS + 'moments-16x9/' + (OLD_SCENE[k] || 'guild-hall') + '.png']);
  }
  function icon(name) { return CELLS + 'ui-icons/' + name + '.png'; }

  var A = {
    CANDIDATES: CANDIDATES, ADVISORS: ADVISORS, FAIRIES: FAIRIES, drawnFaces: drawn, isFairy: isFairy, endingScene: endingScene, SCENES: SCENES, STORY_SCENE: STORY_SCENE, LEVEL_SCENE: LEVEL_SCENE,
    isCandidate: isCand, isAdvisor: isAdv,
    portrait: portrait, face: face, enemy: enemy, scene: scene, sceneFor: sceneFor, icon: icon,
    roleIcon: function (role) { return ROLE_ICON[role] ? icon(ROLE_ICON[role]) : null; },
    moodIcon: function (mood) { return icon(MOOD_ICON[String(Math.max(-2, Math.min(2, mood | 0)))] || 'mood-neutral'); },
    itemIcon: function (id) { return icon(ITEM_ICON[id] || 'reward-skill'); },
    leaderBadge: function () { return icon('leader-badge'); },
    // v2.3 (art/discussion-v7.md): relic, camp-choice icons and the masked-noble gallery stands. Until Codex delivers them
    // the lists fall through to an existing icon or (nobles) to the caller's dark silhouette.
    relicIcon: function (id) { return [icon('relic-' + (id || 'bell'))]; },
    campIcon: function (choice) { return [icon('camp-' + choice), icon({ rest: 'candle', explore: 'key', train: 'reward-sword' }[choice] || 'reward-skill')]; },
    noble: function (x) { return [ALPHA + 'noble-' + x + '.png', PORT + 'noble-' + x + '.png#masked']; },
    nobleFace: function (x, expr) { return [CELLS + 'faces/noble-' + x + '-' + (expr || 'delight') + '.png', CELLS + 'faces/noble-' + x + '-smile.png'].concat(crop([ALPHA + 'noble-' + x + '.png'])); },
    crest: function (broken) { return icon(broken ? 'guild-crest-broken' : 'guild-crest'); },
    // reward / debuff card → icon
    cardIcon: function (card, heavy) {
      var e = (card && card.effect) || {}, neg = heavy || (e.delta != null && e.delta < 0);
      if (e.type === 'item') return ITEM_ICON[e.item] || 'reward-ribbon';
      if (e.type === 'stat' && e.stat === 'atk') return neg ? 'broken-sword' : 'reward-sword';
      if (e.type === 'stat' && (e.stat === 'maxHp' || e.stat === 'hp')) return neg ? 'cracked-heart' : 'reward-heart';
      if (e.type === 'skillUp') return 'reward-skill';
      if (e.type === 'mood') return neg ? 'storm-cloud' : 'reward-smile';
      if (e.type === 'token') return 'reward-ribbon';
      if (e.type === 'team-heal' || e.type === 'teamHeal') return 'reward-team-heal';
      if (e.type === 'status') return /slow/.test(e.status || e.id || '') ? 'hourglass' : 'chains';
      return neg ? 'black-feather' : 'reward-skill';
    }
  };
  // feedback-1113 (3rd batch) #4: every art URL carries ?v=ART_V. The dev server (python http.server) sends no Cache-Control,
  // so Chrome kept serving the old portraits from its heuristic cache after Codex replaced the files. Bump ART_V whenever
  // art is redrawn; the '#classes' suffix of a candidate stays after the query.
  var ART_V = '20261114w'; // w: resized WebP copies in art/web/ (tools/make-web-art.mjs) put in front of the originals
  // (was '20261113c': batch6 H2-8 高台 scene, H2-12/15 advisor enemy art)
  // (was '20261113b': v9 layered fairy animation, art/portraits/anim/)
  function ver(p) { if (typeof p !== 'string' || !/^\.\.\/(art|godot)\//.test(p) || p.indexOf('?') >= 0) return p; var i = p.indexOf('#'); return i < 0 ? p + '?v=' + ART_V : p.slice(0, i) + '?v=' + ART_V + p.slice(i); }
  // 2026-11-14 memory (iPhone Safari): tools/make-web-art.mjs writes resized WebP copies of the big art to art/web/<same path>.webp
  // and art/web/manifest.js (CHOOSER_WEBART.files = the originals that have one; ui/index.html loads it before this file).
  // Every candidate list then tries the web copy first and the original right after it (an <img> that fails moves on), so a
  // missing / stale copy only costs one failed request. ?fullart=1 in the page URL ignores the web copies (originals only).
  // Single-path slots (icons) and node (no manifest) keep the originals.
  var WEB_SET = null;
  (function () {
    var m = root.CHOOSER_WEBART, q = '';
    try { q = (root.location && root.location.search) || ''; } catch (e) { q = ''; }
    if (!m || !m.files || /[?&]fullart=1(&|$)/.test(q)) return;
    WEB_SET = {}; m.files.forEach(function (f) { WEB_SET[f] = 1; });
  })();
  function webOf(p) { // '../art/x/y.png#cls' → '../art/web/x/y.webp#cls' when listed, else null
    if (!WEB_SET || typeof p !== 'string' || p.indexOf(ART) !== 0) return null;
    var i = p.search(/[?#]/), file = i < 0 ? p : p.slice(0, i), rest = i < 0 ? '' : p.slice(i), rel = file.slice(ART.length);
    return WEB_SET[rel] ? ART + 'web/' + rel.replace(/\.png$/i, '.webp') + rest : null;
  }
  function withWeb(list) { var out = []; list.forEach(function (p) { var w = webOf(p); if (w) out.push(w); out.push(p); }); return out; }
  ['portrait', 'face', 'enemy', 'scene', 'icon', 'roleIcon', 'moodIcon', 'itemIcon', 'leaderBadge', 'relicIcon', 'campIcon', 'noble', 'nobleFace', 'crest'].forEach(function (k) {
    var f = A[k]; A[k] = function () { var r = f.apply(null, arguments); return Array.isArray(r) ? withWeb(r).map(ver) : ver(r); };
  });
  A.ART_V = ART_V; A.ver = ver; A.webOf = webOf; A.webArt = !!WEB_SET;
  // v9 B (art/discussion-v9-unify-fairy.md): 小铃 / 恶魔小铃 as layers — wings-NN → body → blink-NN, all on the same
  // 1086×1448 canvas (art/portraits/anim/<id>/README.md + animation.json). Pure parts here (node-tested: tests/fairy-anim.test.cjs);
  // app.js preloads every layer and only swaps the static portrait for the layers once all of them loaded — any failure keeps
  // (or puts back) the static fairy.png, so a wingless half-fairy never shows.
  var FAIRY_ANIM = {
    fairy: { durations: [70, 70, 70, 70, 70, 70] },               // 420ms a beat, light
    'fairy-demon': { durations: [140, 130, 130, 140, 130, 130] }  // 800ms, slow and heavy
  };
  function fairyAnim(id) {
    var f = FAIRY_ANIM[id]; if (!f) return null;
    var dir = PORT + 'anim/' + id + '/', n = function (i) { return (i < 10 ? '0' : '') + i; }, w = [], i;
    for (i = 1; i <= 6; i++) w.push(dir + 'wings-' + n(i) + '.png');
    var body = dir + 'body.png', blink = [dir + 'blink-01.png', dir + 'blink-02.png'];
    // the layers are one set (one canvas): all web copies, or all originals — never a mix of two scales
    var px = function (p) { return ver(useWeb ? webOf(p) : p); }, useWeb = w.concat([body], blink).every(function (p) { return !!webOf(p); });
    w = w.map(px); body = px(body); blink = blink.map(px);
    return { id: id, wings: w, body: body, blink: blink, durations: f.durations.slice(),
      cycle: f.durations.reduce(function (a, b) { return a + b; }, 0), all: w.concat([body], blink) };
  }
  // which wing frame (1..6) shows t ms into the loop
  function fairyFrameAt(id, t) {
    var f = FAIRY_ANIM[id]; if (!f) return 1;
    var cyc = f.durations.reduce(function (a, b) { return a + b; }, 0), x = ((t % cyc) + cyc) % cyc;
    for (var i = 0; i < f.durations.length; i++) { if (x < f.durations[i]) return i + 1; x -= f.durations[i]; }
    return 1;
  }
  // the blink, dt ms after it started: half (1) → shut (2) → half (1) → open (0, the blink is over). The demon's red flash uses the same beat.
  var BLINK_STEP = 60;
  function fairyBlinkAt(dt) { return dt < 0 ? 0 : dt < BLINK_STEP ? 1 : dt < 2 * BLINK_STEP ? 2 : dt < 3 * BLINK_STEP ? 1 : 0; }
  function fairyBlinkGap(rnd) { return 3000 + Math.floor((rnd == null ? Math.random() : rnd) * 2000); } // 3–5 s
  function escA(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // the layered stack. It takes over the static <img>'s role (class 'stand-img' etc.), so the stand's own size, object-position
  // and drop-shadow apply to the whole stack; the bob stays on the parent .fs-bob / .tf-bob.
  function fairyAnimHtml(id, cls, alt) {
    var a = fairyAnim(id); if (!a) return '';
    var img = function (src, c) { return '<img class="fa-l ' + c + '" src="' + escA(src) + '" alt="" draggable="false">'; };
    return '<span class="fanim ' + escA(cls || '') + '" data-fa="' + escA(id) + '" data-f="1" data-b="0" role="img" aria-label="' + escA(alt || '') + '">' +
      a.wings.map(function (s, i) { return img(s, 'fa-w fa-w' + (i + 1)); }).join('') + img(a.body, 'fa-body') +
      a.blink.map(function (s, i) { return img(s, 'fa-k fa-k' + (i + 1)); }).join('') + '</span>';
  }
  // state: undefined (not tried) / 'pending' / 'ok' (every layer loaded) / 'bad' (any layer failed) → layers only when 'ok'
  function fairyUseLayers(id, state) { return !!FAIRY_ANIM[id] && state === 'ok'; }
  A.FAIRY_ANIM = FAIRY_ANIM; A.fairyAnim = fairyAnim; A.fairyFrameAt = fairyFrameAt; A.fairyBlinkAt = fairyBlinkAt; A.fairyBlinkGap = fairyBlinkGap;
  A.fairyAnimHtml = fairyAnimHtml; A.fairyUseLayers = fairyUseLayers;
  // SPEC-11-13 F round 3: which story stands go / dim / show for the next line (pure, node-testable: tests/terms-f.test.cjs).
  // keys = the stands on screen now; sp = { gallery: a masked-noble line, standKey: the speaker's stand key or null }.
  // A noble takes the stage alone: every stand leaves. Other rules unchanged: a non-stand speaker (narrator …) dims them,
  // a stand speaker keeps only her own stand.
  A.standPlan = function (keys, sp) {
    keys = keys || []; sp = sp || {};
    if (sp.gallery) return { gone: keys.slice(), dim: [], show: null };
    if (!sp.standKey) return { gone: [], dim: keys.slice(), show: null };
    return { gone: keys.filter(function (k) { return k !== sp.standKey; }), dim: [], show: sp.standKey };
  };
  // 2026-11-13 主菜单小铃互动 (app.js title fairy; tests/title-fairy.test.cjs): drag vs tap, the annoyed tap counter, dust cap.
  // moved more than th (stage px, default 6) from the press point → a drag, not a poke
  A.tfIsDrag = function (dx, dy, th) { return Math.hypot(dx || 0, dy || 0) > (th == null ? 6 : th); };
  // keep the hit box (stage rect at zero offset: l t r b) inside the W×H stage after moving it by off {x, y}
  A.tfClamp = function (off, box, W, H) {
    var cl = function (v, lo, hi) { return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)); };
    return { x: cl(off.x, -box.l, W - box.r), y: cl(off.y, -box.t, H - box.b) };
  };
  // taps within `win` ms; the `n`th one → 'annoyed' (taps cleared), then `cool` ms of plain 'poke' (cooldown taps are not counted)
  A.tfTapper = function (o) {
    o = o || {}; var n = o.n || 5, win = o.win || 2500, cool = o.cool || 8000, taps = [], until = -Infinity;
    return { tap: function (now) {
      if (now < until) return 'poke';
      taps.push(now); while (taps.length && now - taps[0] > win) taps.shift();
      if (taps.length >= n) { taps = []; until = now + cool; return 'annoyed'; }
      return 'poke';
    } };
  };
  // how many of `want` new dust motes may spawn with `live` on screen, never more than `cap` (default 120) at once
  A.dustTake = function (live, want, cap) { return Math.max(0, Math.min(want | 0, (cap == null ? 120 : cap) - (live | 0))); };
  // 2026-11-13 主菜单小铃闲置行为 (app.js tfIdle*; tests/title-fairy-idle.test.cjs). Offsets are like tfOff: {x, y} added to
  // her hit box `box` (stage rect at zero offset: l t r b). All pure; rnd = a () → [0, 1) source.
  // may she start an idle act now? s: { last (ms of the last input), idle (ms, default 5000), cool (no act before this ms),
  // onTitle, dragging, demon, busy (an act or the demon flash is running), hidden (tab hidden), modal (a dialog is open) }
  A.tfIdleReady = function (now, s) {
    s = s || {}; var idle = s.idle == null ? 5000 : s.idle;
    if (!s.onTitle || s.dragging || s.demon || s.busy || s.hidden || s.modal) return false;
    return now - (s.last || 0) >= idle && now >= (s.cool || 0);
  };
  // which act: 'poke' (fly to the cursor) or 'roam' (a loop round the screen); no usable cursor → always 'roam'
  A.tfPickIdle = function (rnd, cursor, W, H) {
    var ok = cursor && cursor.x >= 0 && cursor.y >= 0 && cursor.x <= (W || 1920) && cursor.y <= (H || 1080);
    return ok && (rnd || Math.random)() < 0.5 ? 'poke' : 'roam';
  };
  var rectHit = function (a, b) { return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; };
  // a roam loop: start → n random waypoints → back to start. Each waypoint keeps the hit box `m` px inside the stage and
  // (when it can) off the `avoid` rect (the title menu), so she only ever crosses the menu on the way, never stops on it.
  A.tfRoamPath = function (start, box, W, H, rnd, o) {
    o = o || {}; rnd = rnd || Math.random; W = W || 1920; H = H || 1080;
    var n = o.n || 4, m = o.m == null ? 40 : o.m, av = o.avoid, bw = box.r - box.l, bh = box.b - box.t, pts = [{ x: start.x, y: start.y }];
    var inner = { l: box.l - m, t: box.t - m, r: box.r + m, b: box.b + m }; // the box grown by m, clamped → m px of margin
    for (var i = 0; i < n; i++) {
      var p = null;
      for (var k = 0; k < 12 && !p; k++) {
        var q = A.tfClamp({ x: m + rnd() * Math.max(0, W - 2 * m - bw) - box.l, y: m + rnd() * Math.max(0, H - 2 * m - bh) - box.t }, inner, W, H);
        var at = { l: box.l + q.x, t: box.t + q.y, r: box.r + q.x, b: box.b + q.y };
        if (!av || !rectHit(at, av)) p = q;
      }
      if (!p) { p = A.tfClamp({ x: (av ? av.r + m : W / 2) - box.l + rnd() * 40, y: H / 2 - bh / 2 - box.t }, inner, W, H); }
      pts.push(p);
    }
    pts.push({ x: start.x, y: start.y });
    return pts;
  };
  // a point on the smooth (Catmull-Rom) curve through pts, t in [0, 1]; passes through every point
  A.tfPathAt = function (pts, t) {
    var n = pts.length; if (!n) return { x: 0, y: 0 }; if (n === 1) return { x: pts[0].x, y: pts[0].y };
    t = Math.max(0, Math.min(1, t)); var f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)], u2 = u * u, u3 = u2 * u;
    var c = function (a, b, cc, d) { return 0.5 * (2 * b + (cc - a) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (3 * b - a - 3 * cc + d) * u3); };
    return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
  };
  // rough length of the curve (for a steady flying speed)
  A.tfPathLen = function (pts, steps) {
    steps = steps || 60; var L = 0, a = A.tfPathAt(pts, 0);
    for (var i = 1; i <= steps; i++) { var b = A.tfPathAt(pts, i / steps); L += Math.hypot(b.x - a.x, b.y - a.y); a = b; }
    return L;
  };
  // the poke: where to hover beside the cursor c (on the side she comes from, hit box `gap` px clear of it, centred on it
  // in y), and the little lunge `lunge` px towards it. Both clamped onto the stage. cur = her offset now.
  A.tfPokePlan = function (cur, box, c, W, H, o) {
    o = o || {}; var gap = o.gap == null ? 36 : o.gap, lunge = o.lunge == null ? 28 : o.lunge;
    var cx = (box.l + box.r) / 2 + cur.x, right = cx >= c.x, bh = box.b - box.t;
    var near = A.tfClamp({ x: right ? c.x + gap - box.l : c.x - gap - box.r, y: c.y - bh / 2 - box.t }, box, W || 1920, H || 1080);
    var hit = A.tfClamp({ x: near.x + (right ? -lunge : lunge), y: near.y }, box, W || 1920, H || 1080);
    return { near: near, hit: hit, side: right ? 1 : -1 };
  };
  A.tfEase = function (t) { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  // 2026-11-14 主菜单小铃闲聊 (app.js tfChat*; tests/title-fairy-chat.test.cjs). While she roams, now and then one small line.
  // s: { next (ms; null = not started: the first check only sets the clock), last (index of the last line said), until (bubble
  // ends) }. o: { flying (a roam is running), poking (a poke / other fairy bubble is up: never two bubbles), w (one weight per
  // line, from tfChatPool; or n = pool size, all equal), min / max (gap between checks, default 8000–15000 ms), p (chance to
  // talk at a check, default 0.6), first (ms to the first check, default 2500 + up to 2000), show (bubble ms, default 3600) }.
  // → { s: new state, say: line index or -1 }. Pure.
  A.tfChatInit = function () { return { next: null, last: -1, until: 0 }; };
  A.tfChatPick = function (w, last, rnd) { // weighted pick, never `last` (unless it is the only line)
    var n = w.length, tot = 0, i; if (!n) return -1;
    for (i = 0; i < n; i++) if (i !== last || n === 1) tot += Math.max(0, w[i] || 0);
    if (tot <= 0) return n === 1 ? 0 : (last + 1) % n;
    var r = rnd() * tot, pick = -1;
    for (i = 0; i < n; i++) { if (i === last && n > 1) continue; var x = Math.max(0, w[i] || 0); if (x <= 0) continue; pick = i; if (r < x) break; r -= x; }
    return pick;
  };
  A.tfChat = function (s, now, rnd, o) {
    s = s || A.tfChatInit(); o = o || {}; rnd = rnd || Math.random;
    var w = o.w || (function () { var a = []; for (var j = 0; j < (o.n | 0); j++) a.push(1); return a; })();
    var min = o.min == null ? 8000 : o.min, max = o.max == null ? 15000 : o.max;
    if (!o.flying || o.poking || !w.length) return { s: s, say: -1 };
    if (s.next == null) return { s: { next: now + (o.first == null ? 2500 + rnd() * 2000 : o.first), last: s.last, until: s.until }, say: -1 };
    if (now < s.next) return { s: s, say: -1 };
    var next = now + min + rnd() * Math.max(0, max - min);
    if (rnd() >= (o.p == null ? 0.6 : o.p)) return { s: { next: next, last: s.last, until: s.until }, say: -1 };
    var i = A.tfChatPick(w, s.last >= 0 && s.last < w.length ? s.last : -1, rnd);
    return { s: { next: next, last: i, until: now + (o.show == null ? 3600 : o.show) }, say: i };
  };
  // any input / leaving the title: the bubble goes and the clock restarts (the last line is kept so it still won't repeat)
  A.tfChatClear = function (s) { return { next: null, last: s ? s.last : -1, until: 0 }; };
  // the lines, mixed: fairy.idleChat.{cute, meta, scheme} (+ fairy.idleChatBack once the true ending was reached: meta.seenTrue
  // or any tierTrue). Group shares: cute 50 %, meta 25 %, scheme 25 % (back, when on, 25 % more), split evenly inside a group.
  // → { lines: [text], w: [weight], group: [name] }
  A.TF_CHAT_SHARE = { cute: 0.5, meta: 0.25, scheme: 0.25, back: 0.25, dolls: 0.18, grudge: 0.05 }; // dolls ≈ 15 % of the base pool (0.18 / 1.18)
  // 2026-11-14 玩偶总账: the meta counts (missing / bad → 0) and {n} filled in (the lines write it as **{n}**)
  A.dollsN = function (meta, k) { var n = meta ? Math.floor(+meta[k]) : 0; return Number.isFinite(n) && n > 0 ? n : 0; };
  A.dollsFill = function (t, n) { return String(t == null ? '' : t).replace(/\{n\}/g, String(n)); };
  // 开局: when the meta has dollsGiven > 0, ~30 % of the time (rnd() < p) one fairy.difficultyDolls line replaces the
  // difficulty ask; else null. Pure (rnd = the UI's Math.random).
  A.dfDollsLine = function (F, meta, rnd, p) {
    var n = A.dollsN(meta, 'dollsGiven'), L = ((F && F.difficultyDolls) || []).map(function (l) { return typeof l === 'string' ? l : l && l.text; }).filter(Boolean);
    rnd = rnd || Math.random;
    if (!n || !L.length || rnd() >= (p == null ? 0.3 : p)) return null;
    return A.dollsFill(L[Math.min(L.length - 1, Math.floor(rnd() * L.length))], n);
  };
  A.tfChatPool = function (F, meta) {
    var txt = function (l) { return typeof l === 'string' ? l : l && l.text; }, out = { lines: [], w: [], group: [] }, C = (F && F.idleChat) || {};
    if (Array.isArray(C)) C = { cute: C };
    var tt = meta && meta.tierTrue, back = !!(meta && (meta.seenTrue || (tt && typeof tt === 'object' && Object.keys(tt).some(function (k) { return tt[k]; }))));
    var given = A.dollsN(meta, 'dollsGiven'), saved = A.dollsN(meta, 'dollsSaved'), fill = { dolls: given, grudge: saved };
    var groups = { cute: C.cute, meta: C.meta, scheme: C.scheme, back: back ? F && F.idleChatBack : null,
      dolls: given ? F && F.idleChatDolls : null, grudge: saved ? F && F.idleChatGrudge : null }; // 玩偶总账: only with a count > 0
    Object.keys(groups).forEach(function (g) {
      var L = (groups[g] || []).map(txt).filter(function (t) { return !!t; }); if (!L.length) return;
      if (fill[g] != null) L = L.map(function (t) { return A.dollsFill(t, fill[g]); });
      L.forEach(function (t) { out.lines.push(t); out.w.push(A.TF_CHAT_SHARE[g] / L.length); out.group.push(g); });
    });
    return out;
  };
  // ===== 第五批反馈 G1 (docs/SPEC-2026-11-13-rules-and-terms.md「G1 完成记录」; tests/g1-ui.test.cjs) =====
  // a centred (translate -50%) box of width w at centre x, kept m px inside a W-wide stage
  A.clampX = function (x, w, W, m) { m = m == null ? 16 : m; W = W || 1920; var lo = m + w / 2, hi = W - m - w / 2; return lo > hi ? W / 2 : Math.min(hi, Math.max(lo, x)); };
  // G1 #2 the 「加成！ / 加成 ×N」 tag beside the charge orb: left of the orb (centre ax − 175) when it fits, else on the
  // right with its left edge 170 px from the orb's centre (orb radius ≤ 96 + the ×N plate's 40 px overhang + a 34 px margin),
  // then clamped inside the stage. w = the tag's measured width.
  A.chargeTagX = function (ax, w, W, m) {
    m = m == null ? 16 : m; W = W || 1920;
    var left = ax - 175, x = left - w / 2 >= m ? left : ax + 170 + w / 2;
    return A.clampX(x, w, W, m);
  };
  // batch6 fix「最右敌人气泡换行」: a speech bubble whose natural width is w, wanted centred on the speaker (cx).
  // The box keeps its own width (never squeezed by the stage edge) and slides left/right to stay m px inside the stage;
  // ax = where the tail sits inside the box (still pointing at the speaker, 22 px from either corner).
  A.bubbleBox = function (cx, w, W, m) {
    m = m == null ? 12 : m; W = W || 1920; w = Math.min(w, W - 2 * m);
    var left = Math.round(Math.min(W - m - w, Math.max(m, cx - w / 2)));
    return { left: left, width: w, ax: Math.round(Math.max(22, Math.min(w - 22, cx - left))) };
  };
  // the 「击倒」 stamp (centred, rotated −10°): its centre x kept inside the stage; pad covers the rotation's overhang
  A.stampX = function (x, w, W) { return A.clampX(x, w + 24, W, 16); };
  // G1 #3 the after-rest summary card: n people → face size, people per row, card width (stage px).
  // Each person is a fixed 176 px column (face, name, +N, 「生命 a / b」 all nowrap); up to 6 sit in one row, 7+ go to two rows.
  A.restLayout = function (n) {
    n = Math.max(1, n | 0);
    var face = n <= 4 ? 120 : 96, gap = n <= 4 ? 48 : 24, itemW = 176, perRow = n <= 6 ? n : Math.ceil(n / 2), rows = Math.ceil(n / perRow), pad = 64;
    var itemH = face + 4 + 38 + 4 + 44 + 4 + 38; // face, name (25px·1.5), +N (44px·1), 生命 (25px·1.5), gaps 4
    return { face: face, gap: gap, itemW: itemW, perRow: perRow, rows: rows,
      cardW: perRow * itemW + (perRow - 1) * gap + 2 * pad,
      cardH: 2 * 48 + 66 + 32 + rows * itemH + (rows - 1) * 24 + 32 + 64 }; // padding, title (44·1.5), gap, rows, gap, button
  };
  // batch6 H2-5 the rest card: one sentence instead of a row of faces — total HP this rest would restore
  A.restTotal = function (heals) {
    var total = (heals || []).reduce(function (t, h) { return t + (h && !h.full ? Math.max(0, h.amount | 0) : 0); }, 0);
    return { total: total, text: total > 0 ? A.t('ui.rest.totalHeal', { total: total }) : A.t('ui.rest.allFull') };
  };
  // batch6 H2-7 连击: one beat per engine hit record, in order, whichever card it lands on. A target record with of > 1 is part of
  // a 连击 (engine backstab); misses / capped / heals are not beats. uidOf(t) → the card's uid (null: no card, skipped).
  A.comboBeats = function (targets, uidOf) {
    var ts = (targets || []).filter(function (t) { return t && t.of > 1 && !t.miss && !t.capped && t.kind !== 'heal'; });
    if (ts.length < 2) return [];
    var out = ts.map(function (t) { return { uid: uidOf ? uidOf(t) : t.uid, amount: t.amount || 0, crit: !!t.crit, hpAfter: t.hpAfter, t: t }; }).filter(function (b) { return b.uid != null; });
    out.forEach(function (b, i) { b.last = i === out.length - 1; });
    return out.length > 1 ? out : [];
  };
  // batch6 H2-13 a one-time mark (a level's title card): true the first time a key is claimed, false ever after
  A.claimOnce = function (seen, key) { if (!seen || seen[key]) return false; seen[key] = 1; return true; };
  // 2026-11-13 第 2 关标题重复: THE one decision for every level title on screen (the level card, and the 「战斗 · xx · 开始！」 band
  // that stands in for it). The mark lives in the run itself (run.titleSeen, keyed by the run's seed + level), so it is saved with
  // the run: a reload / 读档 / home → 继续 never shows a level's title again. source: 'story' (levelIntro screen) | 'event' (a
  // levelCard event between screens) | 'battleIntro' (the band before round 1) | 'battleEvent' (a levelCard event that arrives
  // with the battle already up — always late, so it only claims, never shows: no title in the middle of a round).
  A.TITLE_SOURCES = ['story', 'event', 'battleIntro', 'battleEvent'];
  A.titleGate = function (run, level, source) {
    if (!run || level == null || level === '' || A.TITLE_SOURCES.indexOf(source) < 0) return false;
    var s = run.titleSeen; if (!s || typeof s !== 'object' || s.seed !== run.seed || !s.levels) s = run.titleSeen = { seed: run.seed, levels: {} };
    var k = String(level); if (s.levels[k]) return false;
    s.levels[k] = source; return source !== 'battleEvent';
  };
  // 2026-11-14 第 11 关小铃登场对话: a one-time scene inside a battle round (its events carry once: '<key>'). Same idea as
  // titleGate: the mark lives in the run (run.onceSeen, keyed by the run's seed), so it is saved with the run and a reload /
  // 读档 that replays the round's events never plays the scene again. onceFilter drops the tagged events already seen.
  A.onceGate = function (run, key) {
    if (!run || key == null || key === '') return false;
    var s = run.onceSeen; if (!s || typeof s !== 'object' || s.seed !== run.seed || !s.keys) s = run.onceSeen = { seed: run.seed, keys: {} };
    return A.claimOnce(s.keys, String(key));
  };
  A.onceFilter = function (run, evs) {
    var ok = {};
    return (evs || []).filter(function (e) {
      if (!e || !e.once) return true;
      if (!Object.prototype.hasOwnProperty.call(ok, e.once)) ok[e.once] = A.onceGate(run, e.once);
      return ok[e.once];
    });
  };
  // batch6 H2-12 / H2-15: has the advisor gone over to the other side? From L10 on (her fight, her death, the endings after it)
  A.advisorTurned = function (v) { return !!v && (+v.level || 0) >= 10; };
  // batch6 H2-14: a unit with another max hp (the value before a debt landed), without touching the view's object
  A.withMaxHp = function (u, mx) { var o = {}; for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) o[k] = u[k]; o.maxHp = mx; return o; };
  // batch6 H2-10 献祭 flow: pick (portrait + floating name / state, she says nothing) → 「写下 xx」 → she speaks + asks
  // 「团长，你确定是我了吗？」 → 确认 / 取消 (取消 = back to picking). state { step: 'pick'|'picked'|'speaking'|'ask'|'done', id }
  A.sacFlow = function (st, act, id) {
    st = st || { step: 'pick', id: null };
    switch (act) {
      case 'pick': return st.step === 'pick' || st.step === 'picked' ? { step: 'picked', id: id } : st;
      case 'write': return st.step === 'picked' ? { step: 'speaking', id: st.id } : st;
      case 'spoke': return st.step === 'speaking' && (id == null || id === st.id) ? { step: 'ask', id: st.id } : st;
      case 'cancel': return st.step === 'done' ? st : { step: 'pick', id: null };
      case 'confirm': return st.step === 'ask' ? { step: 'done', id: st.id } : st;
      default: return st;
    }
  };
  // batch6 H2-9: every option that gets you the bell carries a small bell mark (inline SVG, inherits currentColor)
  // (batch6 H2-9 r2, user: all three true-ending keys carry the same bell — seal 'refuse', sacrifice 'random', camp 'followBell')
  var KEY_OPTS = { seal: { refuse: 1 }, sacrifice: { random: 1 }, camp: { followBell: 1 } };
  A.grantsBell = function (o, kind) {
    if (!o) return false; var oid = typeof o === 'string' ? o : o.id;
    if (kind) return !!(KEY_OPTS[kind] && KEY_OPTS[kind][oid]);
    if (typeof o === 'string') return o === 'followBell';
    return o.id === 'followBell' || o.relic === 'bell' || o.itemId === 'bell' || (Array.isArray(o.grants) && o.grants.indexOf('bell') >= 0);
  };
  // 试玩 #10: every bell symbol has a tip on hover / long press (ui.json bell.tip — cryptic on purpose)
  A.bellTip = function () { return String(A.t('ui.bell.tip')).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  A.bellSvg = function (cls) {
    return '<svg class="bell-mark' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="28" height="28" aria-label="' + A.t('ui.bell.canGetLabel') + '" role="img" data-tip="' + A.bellTip() + '">' +
      '<path d="M12 2.5a1.4 1.4 0 0 1 1.4 1.4v.7a6.2 6.2 0 0 1 4.8 6.1v4.1l1.9 2.6a.8.8 0 0 1-.6 1.3H4.5a.8.8 0 0 1-.6-1.3l1.9-2.6v-4.1a6.2 6.2 0 0 1 4.8-6.1v-.7A1.4 1.4 0 0 1 12 2.5z" fill="currentColor"/>' +
      '<path d="M9.4 19.6a2.6 2.6 0 0 0 5.2 0z" fill="currentColor"/><path d="M8.2 9.4a4 4 0 0 1 2.4-2.6" stroke="#fff" stroke-opacity=".55" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>';
  };
  // batch6 H2-17: skill numbers that scale with the level are marked in the data (H1): 「**2**」 or a 「{n}」 placeholder.
  // html is ALREADY escaped. **x** → <b> (a number gets class sk-num: bold + accent colour); {key} → vars[key] in the same
  // bold, when vars has it (else left as written). Unmarked old text comes back unchanged.
  var NUMLIKE = /^[+\-−×x]?\s*\d/;
  // ---- 2026-11-14 icons instead of words (user): code-drawn inline SVG glyphs, no text inside, no emoji. Paths from
  // docs/mockups/icons.html. Style A / B / C is one class on <body> (icons-a | icons-b | icons-c, CSS .gi); the 威力 glyph is
  // POWER_GLYPH (burst · star · flame · bolt). Text may carry {i:name} tokens; A.skillMarkup turns them into a glyph that
  // keeps its keyword tip (data-tip, from keywords.json terms) — icons need no translation. Inner details (eyes, holes) are
  // styled through inherited custom properties (--fxc / --fxw / --holec / --holes), never class hooks: they keep working
  // if the glyphs ever move into <symbol> + <use> (a use shadow tree ignores outside class selectors).
  var GLYPH_PATHS = {
    hp: '<path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.9 1.3 5.4 3.2 1.5-1.9 3.2-3.2 5.4-3.2 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z"/>',
    // 2026-11-14 试玩 #6: 生命上限 = the heart container — the same heart with a plus cut out of it (current 生命 = the plain heart)
    maxhp: '<path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.1 3 4.5 6.6 4.5c2.2 0 3.9 1.3 5.4 3.2 1.5-1.9 3.2-3.2 5.4-3.2 3.6 0 5.7 3.6 4.2 7.1C19.5 16.4 12 21 12 21z"/><path style="fill:var(--holec);stroke:var(--holes,none)" d="M10.8 7.6h2.4v2.9h2.9v2.4h-2.9v2.9h-2.4v-2.9H7.9v-2.4h2.9z"/>',
    face: '<circle cx="12" cy="12" r="9.5"/><path style="fill:none;stroke:var(--fxc);stroke-width:var(--fxw,1.8);stroke-linecap:round" d="M8.2 10.2q1-1.4 2 0M13.8 10.2q1-1.4 2 0M7.8 13.6q4.2 4.6 8.4 0"/>',
    star: '<path d="M12 2.2l2.9 6.4 7 .7-5.3 4.7 1.6 6.9L12 17.3l-6.2 3.6 1.6-6.9L2.1 9.3l7-.7z"/>',
    burst: '<path d="M12 1.5l2 6.2 5.4-3.6-2.6 5.9 6.4.9-5.9 2.7 4 5.1-6.2-1.8L12 22.5l-1.1-5.6-6.2 1.8 4-5.1-5.9-2.7 6.4-.9-2.6-5.9L10 7.7z"/>',
    flame: '<path d="M12.2 2c.6 3.6 5.8 6.1 5.8 11.3A6 6 0 0 1 12 19.5a6 6 0 0 1-6-6.2c0-2.6 1.3-4.3 2.8-5.6.1 1.9.9 3.1 2.2 3.6-.6-3.4.3-6.6 1.2-9.3z"/><path style="fill:var(--holec);stroke:var(--holes,none)" d="M12 18.2a2.6 2.6 0 0 1-2.6-2.7c0-1.6 1.4-2.6 2.2-4 .5 1.8 3 2.4 3 4.2a2.6 2.6 0 0 1-2.6 2.5z"/>',
    bolt: '<path d="M13.6 1.8L4.2 13.6h6.4l-1.3 8.6 9.5-12.1h-6.5z"/>',
    block: '<path d="M12 2.2l8.2 3v6.2c0 5-3.6 9-8.2 10.9-4.6-1.9-8.2-5.9-8.2-10.9V5.2z"/>',
    weak: '<path d="M15.5 2.5l-.5 3.4-5.6 5.6-2-2 5.6-5.6zM4.6 10.3l4.2 4.2-1.2 1.2-1-.8-2 2a1.3 1.3 0 0 1-1.9-1.9l2-2-.8-1z"/><path d="M17.5 12.5v6.2h-2.6l3.9 4 3.9-4h-2.6v-6.2z"/>',
    tough: '<path d="M12 2.2l8.2 3v6.2c0 5-3.6 9-8.2 10.9-4.6-1.9-8.2-5.9-8.2-10.9V5.2z"/><path style="fill:var(--holec);stroke:var(--holes,none)" d="M10.6 7.5h2.8v3.2h3.2v2.8h-3.2v3.2h-2.8v-3.2H7.4v-2.8h3.2z"/>',
    bonus: '<path d="M9.3 16.9l-1.4 1.4a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2a3.4 3.4 0 0 1 4.8 0l.9.9-1.7 1.7-.9-.9a1 1 0 0 0-1.4 0l-3.2 3.2a1 1 0 0 0 1.4 1.4l1.4-1.4zM14.7 7.1l1.4-1.4a3.4 3.4 0 0 1 4.8 4.8l-3.2 3.2a3.4 3.4 0 0 1-4.8 0l-.9-.9 1.7-1.7.9.9a1 1 0 0 0 1.4 0l3.2-3.2a1 1 0 0 0-1.4-1.4l-1.4 1.4z"/><path d="M8.6 13.7l5.1-5.1 1.7 1.7-5.1 5.1z"/>',
    level: '<path d="M12 2.5l8 6v3.6l-8-6-8 6V8.5zM12 9.6l8 6v3.6l-8-6-8 6v-3.6z"/>',
    cover: '<circle cx="17.2" cy="6.2" r="2.8"/><path d="M12.6 21.5c0-4.2 2-7.3 4.6-7.3s4.6 3.1 4.6 7.3z"/><path d="M8.6 3.4l6.2 2.3v5.1c0 4.1-2.7 7.4-6.2 9-3.5-1.6-6.2-4.9-6.2-9V5.7z"/>',
    sun: '<circle cx="12" cy="12" r="4.6"/><path d="M12 1.8l1.3 3.4h-2.6zM12 22.2l-1.3-3.4h2.6zM1.8 12l3.4-1.3v2.6zM22.2 12l-3.4 1.3v-2.6zM4.8 4.8l3.3 1.5-1.8 1.8zM19.2 19.2l-3.3-1.5 1.8-1.8zM19.2 4.8l-1.5 3.3-1.8-1.8zM4.8 19.2l1.5-3.3 1.8 1.8z"/>',
    flower: '<path d="M12 2.5a3.4 3.4 0 0 1 3.2 4.6 3.4 3.4 0 0 1 4.4 5 3.4 3.4 0 0 1-2.5 5.8 3.4 3.4 0 0 1-5.1 3.6 3.4 3.4 0 0 1-5.1-3.6 3.4 3.4 0 0 1-2.5-5.8 3.4 3.4 0 0 1 4.4-5A3.4 3.4 0 0 1 12 2.5z"/><circle style="fill:var(--holec);stroke:var(--holes,none)" cx="12" cy="12.2" r="2.8"/>',
    note: '<path d="M9 4.5l11-2.2v12.6a3 3 0 1 1-2.2-2.9V7.2L11.2 8.5v8.6a3 3 0 1 1-2.2-2.9z"/>',
    bubble: '<path d="M12 3c5.2 0 9.2 3.4 9.2 7.6S17.2 18.2 12 18.2c-.9 0-1.8-.1-2.6-.3L4.6 21l1.3-4.4C4 15.2 2.8 13 2.8 10.6 2.8 6.4 6.8 3 12 3z"/><path style="fill:none;stroke:var(--fxc);stroke-width:var(--fxw,1.8);stroke-linecap:round" d="M8.3 10.6q3.7 3.8 7.4 0"/>',
    daze: '<circle cx="12" cy="12" r="9.5"/><path style="fill:none;stroke:var(--fxc);stroke-width:var(--fxw,1.8);stroke-linecap:round" d="M12 12.2c0-.9.7-1.4 1.4-1.2.9.2 1.3 1.2.9 2.1-.6 1.2-2.3 1.4-3.3.6-1.3-1-1.3-3-.1-4.2 1.5-1.5 4-1.3 5.3.3 1.5 1.8 1.1 4.6-.8 6"/>',
    coin: '<circle cx="12" cy="12" r="9.5"/><circle style="fill:none;stroke:var(--fxc);stroke-width:var(--fxw,1.8);stroke-linecap:round" cx="12" cy="12" r="6.3"/><path style="fill:none;stroke:var(--fxc);stroke-width:var(--fxw,1.8);stroke-linecap:round" d="M10 9.5l2-1.6 2 1.6M10 14.5l2 1.6 2-1.6"/>'
  };
  var POWER_GLYPH = 'bolt'; // 威力 (user 2026-11-14: bolt; also burst · star · flame) — not a sword: 威力 also sizes heals and 护甲
  var MOOD_GLYPH = 'face'; // 心情: still being chosen (face · sun · flower · note · bubble) — one switch
  // icon name → the keyword (keywords.json terms) whose tip it shows; every name here must have a glyph
  A.GLYPHS = { hp: 'hp', maxhp: 'hp', /* its own tip: ui.json glyph.tip.maxhp */ mood: 'mood', power: 'power', block: 'block', weak: 'weak', tough: 'tough', bonus: 'bonus', level: 'level', cover: 'cover', coin: 'coin', daze: 'daze' };
  var glyphPath = function (n) { return n === 'power' ? GLYPH_PATHS[POWER_GLYPH] : n === 'mood' ? GLYPH_PATHS[MOOD_GLYPH] : GLYPH_PATHS[n]; };
  // 2026-11-14 试玩 #6: 生命 / 生命上限 tell the two hearts apart in their tips (ui.json glyph.tip.*, before the keyword's own tip)
  var GLYPH_UI_TIP = { hp: 'ui.glyph.tip.hp', maxhp: 'ui.glyph.tip.maxhp' };
  var glyphTip = function (n) {
    if (GLYPH_UI_TIP[n]) { var u = A.t(GLYPH_UI_TIP[n]); if (u && u !== GLYPH_UI_TIP[n] && u !== GLYPH_UI_TIP[n].slice(3)) return u; }
    var K = root.CHOOSER_DATA && root.CHOOSER_DATA.keywords, t = K && K.terms && K.terms[A.GLYPHS[n]]; return (t && t.tip) || '';
  };
  // 2026-11-14 试玩 #6/#7: stat change rows, each once. A 生命上限 change already says where 生命 went: drop the 生命 rows then.
  A.statRows = function (list) {
    list = (list || []).filter(Boolean); var hasMax = list.some(function (c) { return c.stat === 'maxHp'; }), seen = {};
    return list.filter(function (c) {
      if (hasMax && c.stat === 'hp') return false;
      var k = c.stat + '|' + JSON.stringify(c.from) + '|' + JSON.stringify(c.to); if (seen[k]) return false; seen[k] = 1; return true;
    });
  };
  // a glyph: <span class="gi gi-power" data-tip="…"><svg>…</svg></span>; tip false = no tip (inside a box that has its own)
  A.glyph = function (name, tip) {
    var p = A.GLYPHS[name] ? glyphPath(name) : null;
    if (!p) return '';
    var t = tip === false ? '' : typeof tip === 'string' ? tip : glyphTip(name);
    return '<span class="gi gi-' + name + '"' + (t ? ' data-tip="' + String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '"' : '') + ' aria-hidden="true"><svg viewBox="0 0 24 24">' + p + '</svg></span>';
  };
  // 2026-11-15 小门: the three key slots on the side door (not in A.GLYPHS: they carry no keyword, the tip comes from ui.json
  // door.slot.*). refuse = a raised palm (no), rules = a die, bell = the bell. Same .gi box as A.glyph.
  var DOOR_PATHS = {
    refuse: '<path d="M8.2 11V4.6a1.4 1.4 0 0 1 2.8 0V10h.4V3.4a1.4 1.4 0 0 1 2.8 0V10h.4V4.4a1.4 1.4 0 0 1 2.8 0V11h.3V7.6a1.4 1.4 0 0 1 2.8 0v6.2c0 4.6-3.2 8-7.4 8-3 0-4.9-1.5-6.3-3.8L3.6 13.6a1.4 1.4 0 0 1 2.3-1.6L8.2 14z"/>',
    rules: '<rect x="3" y="3" width="18" height="18" rx="3.6"/><g style="fill:var(--holec);stroke:var(--holes,none)"><circle cx="8" cy="8" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="16" cy="16" r="1.8"/></g>',
    bell: '<path d="M12 2.5a1.4 1.4 0 0 1 1.4 1.4v.7a6.2 6.2 0 0 1 4.8 6.1v4.1l1.9 2.6a.8.8 0 0 1-.6 1.3H4.5a.8.8 0 0 1-.6-1.3l1.9-2.6v-4.1a6.2 6.2 0 0 1 4.8-6.1v-.7A1.4 1.4 0 0 1 12 2.5z"/><path d="M9.4 19.6a2.6 2.6 0 0 0 5.2 0z"/>'
  };
  A.DOOR_KEYS = ['refuse', 'rules', 'bell'];
  A.doorGlyph = function (key) {
    var p = DOOR_PATHS[key]; if (!p) return '';
    return '<span class="gi gi-door gi-door-' + key + '" aria-hidden="true"><svg viewBox="0 0 24 24">' + p + '</svg></span>';
  };
  A.ICON_TOKEN = /\{i:([a-z]+)\}/g;
  A.iconize = function (html) { return String(html == null ? '' : html).replace(A.ICON_TOKEN, function (m, n) { return A.GLYPHS[n] ? A.glyph(n) : m; }); };
  A.stripIcons = function (s) { return String(s == null ? '' : s).replace(A.ICON_TOKEN, ''); }; // plain-text contexts (tips, logs)
  A.skillMarkup = function (html, vars) {
    var s = A.iconize(html);
    s = s.replace(/\*\*(.+?)\*\*/g, function (_, x) { return NUMLIKE.test(x) ? '<b class="sk-num">' + x + '</b>' : '<b>' + x + '</b>'; });
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null && vars[k] !== '' ? '<b class="sk-num">' + String(vars[k]).replace(/[&<>"']/g, '') + '</b>' : m; });
    return s;
  };
  // 2026-11-13 修复「三选一卡效果行消失」: every choice card (reward / debuff / train bonus / explore item) carries one
  // effect line, worked out here from the card alone — never from the stat preview (that diff is empty when e.g. 心情 is
  // already at the top, which is how the line went missing). Returns { eff, flavor }: eff uses the **数字** rule (feed it
  // to richText / skillMarkup), flavor is the rest of the text. eff is never empty for a card with an effect or text.
  var EFF_STAT = { atk: 'ui.stat.atk', maxHp: 'ui.stat.maxHp', hp: 'ui.stat.hp', skillLv: 'ui.stat.skillLv', skillPower: 'ui.stat.skillLv' }; // text keys (looked up when used)
  var EFF_ICON = { atk: 'power', maxHp: 'hp', hp: 'hp', skillLv: 'level', skillPower: 'level' };
  A.effLine = function (e) {
    if (!e) return '';
    if (e.text) return String(e.text);
    if (e.type === 'skillUp') return A.t('ui.effect.iconLine', { icon: '{i:level}', sign: '+', n: 1 });
    var d = +e.delta || 0, ic = e.type === 'mood' ? 'mood' : EFF_ICON[e.stat];
    if (ic) return A.t('ui.effect.iconLine', { icon: '{i:' + ic + '}', sign: d < 0 ? '−' : '+', n: Math.abs(d) }); // 2026-11-14: icon + number, the word lives in the tip
    var n = EFF_STAT[e.stat] ? A.t(EFF_STAT[e.stat]) : e.stat || '';
    return n ? A.t('ui.effect.statLine', { stat: n, sign: d < 0 ? '−' : '+', n: Math.abs(d) }) : '';
  };
  function boldNums(s) { return /\*\*/.test(s) ? s : s.replace(/\d+(?:\.\d+)?%?/g, '**$&**'); }
  A.cardFace = function (card) {
    var c = card || {}, text = String(c.text || '').trim(), e = c.effect, eff = '', flavor = text;
    var leader = '', lm = text.match(new RegExp(A.t('ui.cardFace.leaderNoteRe'))); // 「（给团长：…）」 belongs to the effect line
    if (lm) { leader = lm[0].replace(/^[（(]|[）)]\s*$/g, ''); flavor = text.slice(0, lm.index).trim(); }
    var structured = e && (e.type === 'stat' || e.type === 'mood' || e.type === 'skillUp') ? A.effLine(e) : '';
    if (structured) { // the data text may open with the same effect: 「攻击 +1。铁匠铺…」 — drop that sentence from the flavour
      eff = structured;
      flavor = flavor.replace(new RegExp(A.t('ui.cardFace.statSentenceRe')), '');
    } else if (flavor) { // token / item / status / explore item: the first sentence is the effect
      var i = flavor.indexOf('。');
      eff = i < 0 ? flavor : flavor.slice(0, i); flavor = i < 0 ? '' : flavor.slice(i + 1).trim();
    }
    if (!eff && c.effectText) eff = String(c.effectText);
    if (leader) eff += '（' + leader + '）';
    return { eff: boldNums(eff), flavor: flavor };
  };
  // 修复「献祭浮字挡脸」(H2-10): the sacrifice screen's layout in px. .sac-left 1060×1040 at (60,40); .sac-bust at (120,30) 820×1090
  // inside it; her face is ~10–35% of the bust's height, 30–70% of its width. .mem-frags = .sac-left inset 40/40/120 (980×880).
  // The name / 生命 / 心情 floats sit in a plate right of her, below the face (CSS .sac-float: left 78%, top 40–52% of the bust).
  // A fragment is at most 260 px wide and 3 lines (line-clamp) at scale 1.25 → 132 px; it drifts ≤ 14 px sideways and 14 px up.
  var SAC = { left: { x: 60, y: 40, w: 1060, h: 1040 }, bust: { x: 120, y: 30, w: 820, h: 1090 }, frags: { x: 40, y: 40, w: 980, h: 880 }, fragW: 260, fragH: 132, drift: 14 };
  SAC.face = { x0: SAC.bust.x + SAC.bust.w * 0.30, x1: SAC.bust.x + SAC.bust.w * 0.70, y0: SAC.bust.y + SAC.bust.h * 0.10, y1: SAC.bust.y + SAC.bust.h * 0.35 };
  SAC.plate = { x0: SAC.bust.x + SAC.bust.w * 0.78, x1: SAC.left.w, y0: SAC.bust.y + SAC.bust.h * 0.40, y1: SAC.bust.y + SAC.bust.h * 0.62 };
  A.SAC_LAYOUT = SAC;
  var FRAG_SLOTS = [{ x: 14, y: 20 }, { x: 680, y: 20 }, { x: 680, y: 230 }, { x: 14, y: 220 }, { x: 14, y: 420 }, { x: 14, y: 600 }, { x: 300, y: 740 }, { x: 640, y: 720 }];
  A.sacFragSlots = function () { return FRAG_SLOTS.map(function (p) { return { x: p.x, y: p.y }; }); };
  A.sacFragDrift = function (i) { return (i % 2 ? 1 : -1) * (8 + (i % 4) * 2); }; // |bx| ≤ 14
  // 献祭「确认」演出 (H2-10 ③ r2). Hover: the button slowly grows 1 → 1.25 over growMs (smoothstep), sways a little, and the
  // view darkens 0 → darkMax; leaving rolls it back 2.5× faster. Click: everything else fades (fadeMs), the button holds alone
  // (holdMs), shatters (shatterMs), black (blackMs) — then the confirm action runs and the next screen fades in (fadeInMs).
  var SAC_CONFIRM = { growMs: 3600, scaleMax: 1.25, darkMax: 0.72, backRate: 2.5, swayDeg: 0.9, swayPeriod: 900 };
  A.SAC_CONFIRM = SAC_CONFIRM;
  A.sacHoverStep = function (ms, dt, dir) { var v = (+ms || 0) + (+dt || 0) * (dir > 0 ? 1 : -SAC_CONFIRM.backRate); return Math.max(0, Math.min(SAC_CONFIRM.growMs, v)); };
  A.sacHover = function (ms, now, reduced) {
    var t = Math.max(0, Math.min(1, (+ms || 0) / SAC_CONFIRM.growMs)), e = t * t * (3 - 2 * t);
    var scale = 1 + (reduced ? 0.04 : SAC_CONFIRM.scaleMax - 1) * e, rot = reduced ? 0 : Math.sin((+now || 0) / SAC_CONFIRM.swayPeriod) * SAC_CONFIRM.swayDeg * e;
    var dark = Math.round(SAC_CONFIRM.darkMax * e * 1000) / 1000;
    return { t: t, scale: scale, dark: dark, rot: rot, transform: 'scale(' + scale.toFixed(4) + ') rotate(' + rot.toFixed(3) + 'deg)' };
  };
  A.sacBreakPlan = function (reduced) {
    var p = reduced ? { fadeMs: 400, holdMs: 0, shatterMs: 0, blackMs: 100, fadeInMs: 400 } : { fadeMs: 450, holdMs: 250, shatterMs: 650, blackMs: 250, fadeInMs: 600 };
    p.at = { shatter: p.fadeMs + p.holdMs, black: p.fadeMs + p.holdMs + p.shatterMs };
    p.total = p.at.black + p.blackMs; // when the confirm action runs
    p.overall = p.total + p.fadeInMs;
    return p;
  };
  // ---------- 2026-11-14 手机端 (方案 B): stage fit + screen → stage coordinates ----------
  // stageFit(w, h, touch): the window (visualViewport on touch) → scale k, offset x/y (screen px) and rot. On a touch screen held
  // upright (h > w) the stage turns 90° clockwise and fills the portrait screen, so a phone with rotation lock on, held sideways,
  // shows the landscape game the right way up. Not touch: exactly the old fit (never turns). transform = the #stage style.
  A.stageFit = function (w, h, touch, W, H) {
    W = W || 1920; H = H || 1080; w = w || W; h = h || H;
    var rot = !!touch && h > w, k, x, y;
    if (rot) { k = Math.min(w / H, h / W); x = Math.round((w + H * k) / 2); y = Math.round((h - W * k) / 2); }
    else { k = Math.min(w / W, h / H); x = Math.round((w - W * k) / 2); y = Math.round((h - H * k) / 2); }
    return { k: k, x: x, y: y, rot: rot, transform: 'translate(' + x + 'px,' + y + 'px) ' + (rot ? 'rotate(90deg) ' : '') + 'scale(' + k + ')' };
  };
  // the fit read back from the stage's live bounding box (so a quake / tv-roll `translate` is included): turned, the box is
  // H·k wide and W·k tall, and the stage's own top-left corner sits at the box's top-RIGHT corner
  A.fitFromRect = function (s, rot, W) {
    W = W || 1920; s = s || {};
    var wd = s.width || 0, ht = s.height || 0, l = s.left || 0, t = s.top || 0;
    return rot ? { k: ht / W || 1, x: l + wd, y: t, rot: true } : { k: wd / W || 1, x: l, y: t, rot: false };
  };
  // a screen point (clientX / clientY) → stage px. Every pointer coordinate in the UI goes through this.
  A.toStage = function (px, py, f) {
    var k = f.k || 1;
    return f.rot ? { x: (py - f.y) / k, y: (f.x - px) / k } : { x: (px - f.x) / k, y: (py - f.y) / k };
  };
  // a screen rect (getBoundingClientRect) → the stage-px rect it covers (a 90° turn keeps boxes axis-aligned)
  A.rectToStage = function (r, f) {
    var l = r.left || 0, t = r.top || 0, rr = r.right != null ? r.right : l + (r.width || 0), b = r.bottom != null ? r.bottom : t + (r.height || 0);
    var p = A.toStage(l, t, f), q = A.toStage(rr, b, f), x0 = Math.min(p.x, q.x), y0 = Math.min(p.y, q.y), x1 = Math.max(p.x, q.x), y1 = Math.max(p.y, q.y);
    return { left: x0, top: y0, right: x1, bottom: y1, width: x1 - x0, height: y1 - y0 };
  };
  // browser helper: the live fit of #stage (turned when it has the st-rot class), and a point of an element in stage px
  A.liveFit = function (stage) {
    stage = stage || (typeof document !== 'undefined' && document.getElementById('stage'));
    if (!stage) return { k: 1, x: 0, y: 0, rot: false };
    return A.fitFromRect(stage.getBoundingClientRect(), stage.classList.contains('st-rot'));
  };
  A.elStagePt = function (el, ax, ay, stage) {
    var r = A.rectToStage(el.getBoundingClientRect(), A.liveFit(stage || el.ownerDocument.getElementById('stage')));
    return { x: r.left + r.width * (ax == null ? 0.5 : ax), y: r.top + r.height * (ay == null ? 0.5 : ay) };
  };
  // the confirm button's centre → the stage centre (rects from getBoundingClientRect; the stage may be scaled)
  A.sacCenterShift = function (b, st) {
    var k = st && st.width ? st.width / 1920 : 1;
    return { dx: Math.round(960 - (b.left - st.left + b.width / 2) / k), dy: Math.round(540 - (b.top - st.top + b.height / 2) / k) };
  };
  // 8 shards that tile the button (a 5×3 vertex grid, inner vertices jittered); each flies out from the centre and spins
  A.sacShards = function () {
    var xs = [0, 26, 49, 77, 100], ys = [0, 44, 100], J = [[0, 0, 0], [0, 9, 0], [0, -7, 0], [0, 11, 0], [0, 0, 0]], JX = [[0, 0, 0], [0, -5, 0], [0, 6, 0], [0, -4, 0], [0, 0, 0]];
    var V = xs.map(function (x, i) { return ys.map(function (y, j) { return [x + JX[i][j], y + J[i][j]]; }); }), out = [];
    for (var i = 0; i < 4; i++) for (var j = 0; j < 2; j++) {
      var pts = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]];
      var cx = pts.reduce(function (s, p) { return s + p[0]; }, 0) / 4, cy = pts.reduce(function (s, p) { return s + p[1]; }, 0) / 4;
      var vx = cx - 50, vy = (cy - 50) * 2.2, len = Math.sqrt(vx * vx + vy * vy) || 1, n = out.length, dist = 160 + (n * 37) % 110;
      out.push({ pts: pts, clip: 'polygon(' + pts.map(function (p) { return p[0] + '% ' + p[1] + '%'; }).join(', ') + ')',
        dx: Math.round(vx / len * dist), dy: Math.round(vy / len * dist + 40), rot: (n % 2 ? 1 : -1) * (24 + (n * 13) % 40) });
    }
    return out;
  };
  // G1 #5 刺客连击: the beat between two hits of one 连击 (ms at ×2 speed) — 250 for 2, 220 for 3, 180 for 4+
  A.comboGap = function (n) { return n <= 2 ? 250 : n === 3 ? 220 : 180; };
  // G1 #7 a corrupted girl whose line has a plain expression keeps her corrupted face: the nearest corrupted one
  var CORRUPT_NEAR = { vengeful: { sad: 'vengeful-tears', cry: 'vengeful-tears', upset: 'vengeful-rage', angry: 'vengeful-rage', shock: 'vengeful-rage' },
    possessed: { happy: 'possessed-grin', smile: 'possessed-grin', special: 'possessed-grin', shock: 'possessed-flash' } };
  A.corruptExpr = function (cv, e) { if (e && e.indexOf(cv) === 0) return e; return (CORRUPT_NEAR[cv] && CORRUPT_NEAR[cv][e]) || (cv === 'vengeful' ? 'vengeful-sneer' : 'possessed-blank'); };
  // G1 #6 the gate-slam screen: the old low-res 16:9 gate picture first (the 468×395 key-moment next), the 1080p scene last
  A.gateArt = function () { return withWeb([CELLS + 'moments-16x9/gate-seals.png', CELLS + 'key-moments/gate-seals.png', ART + 'scenes/sealing.png']).map(ver); };
  // 2026-11-13 真结局发光: the status pill on a difficulty tier — locked / true ending (glows) / cleared / last death / untried
  A.dfBadge = function (t) {
    t = t || {};
    if (t.locked) return { cls: 'lock', text: A.t('ui.difficulty.badge.locked') };
    if (t.trueEnd) return { cls: 'true', text: A.t('ui.difficulty.badge.trueEnd') };
    if (t.cleared) return { cls: 'ok', text: A.t('ui.difficulty.badge.cleared') };
    if (t.last) return { cls: '', text: A.t('ui.difficulty.badge.lastFell', { level: t.last }) };
    return { cls: '', text: A.t('ui.difficulty.badge.untried') };
  };
  // i18n (docs/I18N.md): the one lookup lives in the engine; A.t / T() only delegate (engine.js loads after this file)
  A.t = function (k, v) { var f = (root.ChooserEngine && root.ChooserEngine.t) || root.T || nodeT(); return f ? f(k, v) : k; }; // root.T: the real engine's, even under ?stub
  // node (tests / tools): no browser globals → the engine module itself (it reads data/text directly)
  function nodeT() { try { return typeof module === 'object' && typeof require === 'function' ? require('../engine/engine.js').t : null; } catch (e) { return null; } }
  root.CHOOSER_ASSETS = A;
})(typeof globalThis !== 'undefined' ? globalThis : this);
