// 修复 2026-11-13「落选者小队不攻击」: how one battle round's events are cut into playback steps (pure, node-tested).
// app.js playRound plays each step: 'chain' = an ally action + its chain / follow-ups (playChain), 'one' = playOne.
// The bug: an ally group swallowed everything up to the next action — the enemy 「第 N 回合 · 敌方行动」 phase marker
// included — so it played inside playChain without its `acts` flag and the enemy turn had no banner. A phase marker
// (or anything that opens a new beat) now always ends the group.
(function (root) {
  'use strict';
  var STOP = { phase: 1, enemyEnter: 1, summon: 1, wave: 1, end: 1, frenzy: 1, reckoning: 1, debts: 1, memory: 1 };
  // end (exclusive) of the chain group that starts at evs[i] (2026-11-15: either side — an enemy 加成 groups like ours)
  function chainEnd(evs, i) {
    var e = evs[i], j = i + 1;
    while (j < evs.length) {
      var f = evs[j];
      if (f.kind === 'action' && (!f.chainDepth || f.side !== e.side || (e.chainId != null && f.chainId != null && f.chainId !== e.chainId))) break;
      if (STOP[f.kind]) break;
      j++;
      if (f.kind === 'chainEnd') break;
    }
    return j;
  }
  // does the side announced by the phase marker at evs[i] really act before the next phase / end?
  function phaseActs(evs, i) {
    var e = evs[i];
    for (var k = i + 1; k < evs.length && evs[k].kind !== 'phase' && evs[k].kind !== 'end'; k++) {
      if (evs[k].kind === 'action' && (evs[k].side || e.side) === e.side) return true;
    }
    return false;
  }
  // 2026-11-15「对方的加成也要一起走」: an enemy attack that pulled followers in (敌方加成, same chainId, chainDepth ≥ 1) is a
  // chain group like ours (played by playChain: rise together, charge together, strike together). A lone enemy action stays 'one'.
  function foeChained(evs, i) {
    var j = chainEnd(evs, i);
    for (var k = i + 1; k < j; k++) if (evs[k].kind === 'action' || evs[k].kind === 'charge') return true; // 充能: her charge plays with her rise
    return false;
  }
  // the steps, in order: { type: 'chain', group } | { type: 'debts', debts, memories } | { type: 'one', e, acts? }
  function planRound(evs) {
    var out = [], i = 0;
    while (i < evs.length) {
      var e = evs[i];
      if (e.kind === 'debts') { var mems = [], j0 = i + 1; while (j0 < evs.length && evs[j0].kind === 'memory') mems.push(evs[j0++]); out.push({ type: 'debts', debts: e, memories: mems, i: i }); i = j0; continue; }
      if (e.kind === 'memory') { var ms = [], j1 = i; while (j1 < evs.length && evs[j1].kind === 'memory') ms.push(evs[j1++]); out.push({ type: 'debts', debts: { id: e.id, debts: [] }, memories: ms, i: i }); i = j1; continue; }
      if (e.kind === 'action' && !e.chainDepth && (e.side === 'ally' || foeChained(evs, i))) { var j = chainEnd(evs, i); out.push({ type: 'chain', group: evs.slice(i, j), i: i, side: e.side === 'ally' ? 'ally' : 'enemy' }); i = j; continue; }
      var st = { type: 'one', e: e, i: i };
      if (e.kind === 'phase') st.acts = phaseActs(evs, i);
      out.push(st); i++;
    }
    return out;
  }
  // 2026-11-20 GROUP_FX「群体效果一起播」: consecutive round-level events of one group effect — 列阵 / 退伍老兵 / 铁壁 / a boss
  // 阵型 (block events with the same skill source, side and round), the round-start / round-end 威力 changes ('pow', same
  // round) — play as ONE beat: every card at once, one cue, one wait. Block events without a source (a single unit's own
  // armor) never group. fxKey(e) → the group key or null; groupEvents(list) → arrays (runs of the same key, singles alone);
  // groupFx(steps) folds planRound's 'one' steps the same way into { type: 'fx', key, evs, i, last }.
  function fxKey(e) {
    if (!e) return null;
    if (e.kind === 'block' && e.source) return 'block|' + (e.round || 0) + '|' + (e.side || '') + '|' + e.source;
    if (e.kind === 'pow') return 'pow|' + (e.round || 0);
    return null;
  }
  function groupEvents(list) {
    var out = [], cur = null, ck = null;
    (list || []).forEach(function (e) {
      var k = fxKey(e);
      if (k && cur && k === ck) { cur.push(e); return; }
      cur = [e]; ck = k; out.push(cur);
    });
    return out;
  }
  function groupFx(steps) {
    var out = [];
    for (var i = 0; i < (steps || []).length; i++) {
      var st = steps[i], k = st.type === 'one' ? fxKey(st.e) : null;
      if (!k) { out.push(st); continue; }
      var j = i + 1, evs = [st.e];
      while (j < steps.length && steps[j].type === 'one' && fxKey(steps[j].e) === k) evs.push(steps[j++].e);
      if (evs.length < 2) { out.push(st); continue; }
      out.push({ type: 'fx', key: k, kind: st.e.kind, evs: evs, i: st.i, last: steps[j - 1].i });
      i = j - 1;
    }
    return out;
  }
  // 复查 2026-11-14 第 11 关第二阶段: the foe lane is the engine's B.enemies order, untouched — 「最左侧」 in the engine is
  // enemies[0], so the leftmost card on screen must be that unit. (It used to move the fairy to the right end, which hid
  // a wave that had her at index 0: everyone visibly struck the rightmost card.) `extras` = girls who turned this round
  // (already in b.allies) and still stand on the foe side until the turncoat animation; they go before a wave boss
  // standing at the right end, otherwise at the end. Never reorders `enemies` themselves.
  function foeLane(enemies, extras) {
    var out = (enemies || []).slice(), add = extras || [];
    if (!add.length) return out;
    var last = out[out.length - 1], k = last && last.waveBoss ? out.length - 1 : out.length;
    return out.slice(0, k).concat(add, out.slice(k));
  }
  // 修复 2026-11-14「多波战斗」: what the battle screen does once a round has played. A cleared wave with another one
  // pending is NOT a pause: a short 「第 N 波！」 card, then the next wave starts by itself (no 继续 click). Only the real
  // end of the battle shows the result panel; an ordinary round end shows the pause bar.
  // 2026-11-16 自动继续 at a pause (prefs.autoCont): the opening pause before round 1 (battle.opening) never goes on by itself
  // (it is there to choose: items / advisor / move / the hunters' aim); a pause where a hunter can aim waits AIM_AUTO_MS at
  // least; any other pause the old 900 ms (÷ speed). null = no auto-continue.
  var AIM_AUTO_MS = 2000;
  function autoContMs(battle, speed) {
    if (!battle || battle.opening) return null;
    var ms = 900 / (speed || 1), aim = battle.pause && battle.pause.canAim;
    return aim && aim.length ? Math.max(ms, AIM_AUTO_MS) : ms;
  }
  function afterRound(v) {
    if (!v) return 'other';
    if (v.phase === 'battle') return v.battle && v.battle.nextWave ? 'nextWave' : 'pause';
    if (v.phase === 'battleResult') return 'result';
    return 'other';
  }
  // 修复 2026-11-14「战斗里空着变暗又恢复」: a beat may darken the stage only together with something to show on the dark.
  // The engine sends darkTransition('return') at EVERY wave start with a returned girl in it — also when her reckoning
  // already happened (L11 wave 2 at round 3: darkTransition → phase → action, nothing on the dark), and the UI played a
  // bare 3.8 s vignette. The dark is now the reckoning's own screen; a darkTransition never dims by itself in battle.
  // dimContent(evs, i) = what the dark at evs[i] would show ('reckoning' | 'debts' | 'turn' | 'waveCard'), or null = don't dim.
  var DIM_STOP = { phase: 1, action: 1, end: 1, wave: 1, enemyEnter: 1, darkTransition: 1 };
  function hasText(l) { return !!(l && String(l.text == null ? '' : l.text).trim()); }
  function memHasTargets(m) { return !!(m && ((m.allies && m.allies.length) || m.ally)); }
  function debtsContent(debts, mems) { // the debt cards, or a memory whose dots land on someone
    return ((debts && debts.debts) || []).length > 0 || (mems || []).some(memHasTargets) ? 'debts' : null;
  }
  function dimContent(evs, i) {
    var e = evs && evs[i]; if (!e) return null;
    if (e.kind === 'reckoning') return (e.lines || []).some(hasText) ? 'reckoning' : null;
    if (e.kind === 'darkTransition') { // only as the lead-in of a reckoning that really speaks (its screen is the dark)
      for (var j = i + 1; j < evs.length; j++) { var f = evs[j]; if (f.kind === 'reckoning') return dimContent(evs, j); if (DIM_STOP[f.kind]) break; }
      return null;
    }
    if (e.kind === 'debts' || e.kind === 'memory') { var ms = [], k = e.kind === 'debts' ? i + 1 : i; while (k < evs.length && evs[k].kind === 'memory') ms.push(evs[k++]); return debtsContent(e.kind === 'debts' ? e : null, ms); }
    if (e.kind === 'wave') return e.advBoss ? 'waveCard' : null; // the plain 「第 N 波」 banner doesn't darken
    if (e.kind === 'phase') return e.round && phaseActs(evs, i) ? 'turn' : null;
    return null;
  }
  // does this planned step put a dark layer up? (darkTransition: never on its own — it only rides on the reckoning)
  function shouldDim(step, evs) {
    if (!step) return false;
    if (step.type === 'debts') return !!debtsContent(step.debts, step.memories);
    if (step.type !== 'one' || step.e.kind === 'darkTransition') return false;
    return !!dimContent(evs, step.i);
  }
  // 2026-11-14 伤害数字「先飞后结算」: ONE number per hit. It leaves the attacker as the attack's full amount (hp damage + what
  // the block took, 伊芙's included) and on arrival turns into what really reached the hp. absorbed > 0 → it visibly changes
  // (5 → 2, the badge cracks); fully absorbed → 0, a shield clank, no red number. A heal just pops (+n). A miss / capped → null.
  function hitNum(t) {
    if (!t || t.miss || t.capped) return null;
    var dealt = Math.max(0, t.amount || 0);
    if (t.kind === 'heal') return { heal: true, full: dealt, dealt: dealt, absorbed: 0, from: '+' + dealt, to: '+' + dealt, changes: false, clank: false };
    var absorbed = Math.max(0, t.blocked || 0), full = dealt + absorbed;
    if (full <= 0) return null; // 2026-11-16 用户「-0 不要显示」: a hit that did nothing at all shows no number
    return { heal: false, full: full, dealt: dealt, absorbed: absorbed, from: '−' + full, to: dealt > 0 ? '−' + dealt : '0', changes: absorbed > 0, clank: absorbed > 0 && dealt === 0 };
  }
  // v36 (试玩者 1)「连携数字分开、卡片轮流上移」: a chain is played actor by actor. Each beat = one action: her card rises, her own
  // charge (base + bonuses) is built over her card, her own numbers fly to EVERY target of that action (the mage's splash
  // targets included — they used to be merged into one orb over the initiator and only the main target showed), resolve
  // there (hitNum), then she settles and the next chained actor rises. A plain (non-chain) action is a one-beat chain.
  // actionBeats(group) → [{ k, act, actor, depth, from (who brought her in, or null), heal, total, targets: [{ uid, t, splash,
  // miss, soft, capped, heal, num }], series (true = a 连击: one beat per hit, A.comboBeats) }]
  function actionBeats(group) {
    var g = group || [], acts = g.filter(function (e) { return e && e.kind === 'action'; });
    return acts.map(function (a, k) {
      var ch = k > 0 ? g.filter(function (c) { return c && c.kind === 'chain' && !c.missed && c.to === a.actor; })[0] : null;
      var ts = (a.targets || []).map(function (t) {
        return { uid: t.uid, t: t, splash: !!t.splash, miss: !!t.miss, soft: !!t.soft, capped: !!t.capped, heal: t.kind === 'heal', num: hitNum(t) };
      });
      var series = ts.filter(function (x) { return x.t.of > 1 && !x.miss && !x.capped && !x.heal; }).length > 1;
      var total = (a.base || 0) + (a.bonuses || []).reduce(function (s, b) { return s + (b.noEffect || b.hit ? 0 : b.amount || 0); }, 0); // a per-hit entry (`hit`) is not in the opening number
      return { k: k, act: a, actor: a.actor, depth: a.chainDepth || 0, from: ch ? ch.from : null, heal: ts.length > 0 && ts.every(function (x) { return x.heal; }), total: total, targets: ts, series: series };
    });
  }
  // the rise / settle of the acting card (ms at speed ×1 before the speed factor). riseTiming: what a beat really waits —
  // divided by the speed factor (×1 0.7 / ×2 1 / ×3 2), and nothing at all when skipped or with reduced motion (instant results).
  var RISE = { up: 200, hold: 220, down: 180 };
  function riseTiming(o) {
    o = o || {}; if (o.skip || o.reduced) return { up: 0, hold: 0, down: 0 };
    var s = o.spd > 0 ? o.spd : 1;
    return { up: Math.round(RISE.up / s), hold: Math.round(RISE.hold / s), down: Math.round(RISE.down / s) };
  }

  // v38 (试玩 v37「玛尔塔掉血了，护甲角标还挂着数字」): the 护甲 badge follows the engine event by event. Pure parts:
  // blockStart(evs, units) = every unit's block at the START of the round (units = the round's end-state views; walks back
  // through hits / gains / clears). hitBlocks(t, field) = the badge updates one hit target brings: 伊芙's shield owner −shieldAmt,
  // then the target's own blockAfter; a hit that took hp and that the block took no part of means her block was already 0.
  // eventBlocks(e) = the updates of a 'block' (gain → its total) / 'blockClear' (→ to) event. beatExtras(group) = for each
  // action of a chain group, the block events that follow it (before the next action): played right after THAT beat, not
  // after the whole chain (they used to wait for the end of the chain and then set a stale total over later hits).
  function blockStart(evs, units) {
    var blk = {};
    (units || []).forEach(function (u) { blk[u.uid] = u.block || 0; });
    for (var i = (evs || []).length - 1; i >= 0; i--) {
      var e = evs[i];
      if (e.kind === 'action') for (var j = (e.targets || []).length - 1; j >= 0; j--) {
        var t = e.targets[j]; if (t.miss || t.capped) continue;
        if (t.blockAfter != null) blk[t.uid] = t.blockAfter + (t.blocked || 0) - (t.shieldAmt || 0);
        if (t.shieldBy) blk[t.shieldBy] = (blk[t.shieldBy] || 0) + (t.shieldAmt || 0);
      }
      if (e.kind === 'quake') (e.targets || []).forEach(function (t) { if (t && t.blockAfter != null) blk[t.uid] = t.blockAfter + (t.blocked || 0); }); // 地震 takes 护甲 first (2026-11-16: our clear is at the round's END now, so the walk back must undo it)
      if (e.kind === 'block') blk[e.uid] = Math.max(0, (blk[e.uid] || 0) - (e.amount || 0));
      if (e.kind === 'blockClear') (e.units || []).forEach(function (x) { blk[x.uid] = x.from; });
    }
    Object.keys(blk).forEach(function (k) { blk[k] = Math.max(0, blk[k] || 0); });
    return blk;
  }
  function hitBlocks(t, field) {
    var out = [];
    if (!t || t.miss || t.capped || t.kind === 'heal') return out;
    if (t.shieldBy) { var f = field && field[t.shieldBy]; out.push([t.shieldBy, Math.max(0, ((f && f.block) || 0) - (t.shieldAmt || 0))]); }
    if (t.blockAfter != null) out.push([t.uid, t.blockAfter]);
    else if ((t.amount || 0) > 0 && !t.tough) out.push([t.uid, 0]); // the hp took it: nothing of her block was left
    else if (t.hpAfter != null && t.hpAfter <= 0) out.push([t.uid, 0]);
    return out;
  }
  function eventBlocks(e) {
    if (!e) return [];
    if (e.kind === 'block') return [[e.uid, e.total || 0]];
    if (e.kind === 'blockClear') return (e.units || []).map(function (x) { return [x.uid, x.to || 0]; });
    return [];
  }
  function beatExtras(group) {
    var out = [], k = -1;
    (group || []).forEach(function (e) {
      if (!e) return;
      if (e.kind === 'action') { k++; out[k] = []; return; }
      if (k >= 0 && (e.kind === 'block' || e.kind === 'blockClear' || e.kind === 'charge' || (e.kind === 'chain' && e.charge))) out[k].push(e); // 充能: the pips land with the beat that gave them
    });
    return out;
  }
  // DESIGN-2026-11-15-charge: every unit's 充能 at the START of the round (units = end-state views with .charge), walking
  // back through 'charge' (→ before) and the spend of a full bar ('chain' with charge: left + full)
  function chargeStart(evs, units, full) {
    var c = {}, F = full || 10;
    (units || []).forEach(function (u) { c[u.uid] = u.charge || 0; });
    for (var i = (evs || []).length - 1; i >= 0; i--) {
      var e = evs[i];
      if (e.kind === 'charge') c[e.to] = e.before || 0;
      if (e.kind === 'chain' && e.charge && e.left != null) c[e.to] = Math.round((e.left + F) * 100) / 100;
      if (e.kind === 'raise' && e.left != null) c[e.to] = Math.round((e.left + F) * 100) / 100; // 先蓄后放: a raise spent 10
    }
    return c;
  }
  // v39「结算看得懂」: one action of the battle log, explained in plain words. Every number comes from the log entry
  // ({base, bonuses, targets[{amount, hpAfter, blocked, blockAfter, shieldBy, shieldAmt, tough, crit, splash, miss}]}).
  // The crit ×2 / ×2.5 / ×3 (the log's critX when present) and the mage splash ⌈威力÷2⌉ (÷3 before 2026-11-16) (min 1, as the engine's sparkSplash) are only SHOWN when they reproduce the logged number exactly;
  // otherwise the line falls back to the plain 「打出 N → 护甲挡 → 掉血」 read straight from the hit (never a wrong formula).
  // explainAction(e, units, o) → { actor, total, formula, head, targets: [{ uid, name, kind, start, tough, shield, block,
  // dealt, hpAfter, down, minOne, over, saved, exact, text }], lines: [head, formula, ...target lines] }
  // units: { uid: { name } } (or an array of { uid, name }); o.t = the text lookup (T / E.t). Lines use {i:name} glyph tokens.
  var SPLASH_DIV = 2, CRIT_X = 2, CRIT_X_MAX = 3, CRIT_XS = [2, 2.25, 2.5, 2.75, 3]; // 2026-11-20 猎人 ×2/2.25/2.5/2.75 (was [2, 2.5, 3]) · // 用户 2026-11-15 弓手加强: Lv1–2 ×2 · Lv3 ×2.5 · Lv4 ×3
  function unitName(units, uid) {
    if (!units) return String(uid);
    if (Array.isArray(units)) { for (var i = 0; i < units.length; i++) if (units[i] && (units[i].uid === uid || (units[i].uid == null && units[i].id === uid))) return units[i].name || String(uid); return String(uid); }
    var u = units[uid]; return (u && (u.name || (typeof u === 'string' ? u : null))) || String(uid);
  }
  function lookup(o) {
    var t = (o && o.t) || (typeof root !== 'undefined' && root.T) || null;
    return function (k, v) { return t ? t('ui.settle.' + k, v) : k; };
  }
  function bonusSum(e) { return (e.bonuses || []).reduce(function (s, b) { return s + (b.noEffect ? 0 : b.amount || 0); }, 0); }
  // what this hit started as, before 坚韧 / 伊芙 / 护甲 — from the formula when it reproduces the log, else from the log itself
  function hitStart(e, t, pre, mult) {
    var ally = e.side !== 'enemy', cands = [];
    if (t.refund || t.priestStrike) return null; // 2026-11-20 PRIEST_STRIKE: ⌈威力/2⌉, the log's number as is
    if (t.splash && e.skillKind === 'spark' && ally) { var fl = Math.ceil(pre / SPLASH_DIV); cands.push({ v: Math.max(1, fl) * mult, splash: { n: pre, d: SPLASH_DIV, min: fl < 1 } }); /* 2026-11-15 fix: the engine rounds the splash UP (sparkSplash) */ }
    else if (t.crit) (t.critX ? [t.critX] : [e.skillLv >= 4 ? CRIT_X_MAX : CRIT_X].concat(CRIT_XS)).forEach(function (x) { cands.push({ v: Math.floor(pre * x) * mult, crit: { n: pre, x: x } }); });
    else { cands.push({ v: pre * mult }); if (!ally && e.skillKind === 'spark') cands.push({ v: (e.base || 0) * mult }); } // an enemy spark (the bell): one flat number on everyone
    for (var i = 0; i < cands.length; i++) { var r = settleHit(cands[i].v, t); if (r) { r.from = cands[i]; return r; } }
    return null;
  }
  // replay the engine's order on a start value: 坚韧 −n → 伊芙挺身 → her own 护甲 → 「至少 1」 (only if no block took part)
  // → capped by her hp. Returns the pieces when the end equals the logged amount, else null.
  function settleHit(v, t) {
    var d = v, tough = 0, shield = t.shieldAmt || 0, blocked = t.blocked || 0, own = Math.max(0, blocked - shield), minOne = false, over = false, saved = false;
    if (t.tough) { tough = Math.min(d, t.tough); d = Math.max(0, d - t.tough); }
    if (blocked > d) return null;
    d -= blocked;
    if (!blocked && v > 0 && d < 1) { d = 1; minOne = true; }
    var amt = t.amount || 0;
    if (d !== amt) {
      if (d > amt && t.hpAfter === 0) over = true; // she had fewer hp left than the hit
      else if (d > amt && t.hpAfter >= 1) saved = true; // 旧公会徽章 / 附加条款: left on 1
      else return null;
    }
    return { start: v, tough: tough, shield: shield, block: own, minOne: minOne, over: over, saved: saved };
  }
  function explainAction(e, units, o) {
    var L = lookup(o), name = function (uid) { return unitName(units, uid); };
    if (!e || e.kind !== 'action') return null;
    // 狂热 (frenzy) multiplies the whole hit: shown as its own step (the engine's 「狂热 ×2 +n」 share leaves out per-hit 特点)
    var mult = e.mult > 1 ? e.mult : 1, isFz = function (b) { return mult > 1 && b.from === 'frenzy'; };
    // a bonus with `hit` (e.g. 夜鸦「收账」 +1 on the last hit) belongs to that hit only — not to the action's opening number
    var own = (e.bonuses || []).filter(function (b) { return !isFz(b) && !b.hit; }), fz = (e.bonuses || []).filter(isFz)[0];
    var pre = (e.base || 0) + bonusSum({ bonuses: own }), total = pre * mult, ts = e.targets || [];
    var parts = [];
    if (e.skillLv) parts.push(L('metaLv', { lv: e.skillLv }));
    if (e.skillKind === 'spark' && ts.length > 1) parts.push(L('metaTargets', { n: ts.length }));
    if (e.hits > 1) parts.push(L('metaHits', { n: e.hits }));
    var head = L('head', { actor: name(e.actor), skill: e.skill || '' }) + (parts.length ? L('meta', { parts: parts.join(L('sep')) }) : '');
    var formula = L(e.skillKind === 'backstab' ? 'baseEach' : e.skillKind === 'spark' && e.side === 'enemy' ? 'baseAll' : 'base', { n: e.base || 0 });
    own.forEach(function (b) {
      if (b.noEffect) formula += L('note', { label: b.label || '' });
      else formula += L((b.amount || 0) < 0 ? 'minus' : 'plus', { label: b.label || '', n: Math.abs(b.amount || 0) });
    });
    if (own.some(function (b) { return !b.noEffect; })) formula += L('equals', { n: pre });
    if (mult > 1) formula += L('frenzy', { label: (fz && fz.label) || '×' + mult, n: total });
    var out = ts.map(function (t, k) {
      var r = { uid: t.uid, name: name(t.uid), kind: t.kind === 'heal' ? 'heal' : 'damage', splash: !!t.splash, crit: !!t.crit, hit: t.hit || null, dealt: t.amount || 0, hpAfter: t.hpAfter, blocked: t.blocked || 0, down: t.kind !== 'heal' && t.hpAfter === 0, exact: true };
      var tags = (t.splash ? L('tagSplash') : '') + (t.hit && t.of > 1 ? L('tagHit', { i: t.hit }) : '') + (t.refund ? L('tagRefund') : '');
      var to = L('to', { name: r.name, tags: tags });
      if (t.miss) { r.kind = t.soft ? 'soft' : 'miss'; r.text = to + L(t.soft ? 'soft' : 'miss'); return r; }
      if (t.capped) { r.kind = 'capped'; r.text = to + L('capped'); return r; }
      if (t.kind === 'heal') { r.text = to + L('heal', { n: t.amount || 0, hp: t.hpAfter }); return r; }
      // per-hit bonuses (夜鸦「收账」 +1 on her last hit, 刺客「连击递减」 −k on hit k+1) start this hit from its own number
      var ph = t.hit ? (e.bonuses || []).filter(function (b) { return b.hit === t.hit && !b.noEffect; }) : [];
      var preT = pre + bonusSum({ bonuses: ph });
      var s = hitStart(e, t, preT, mult);
      if (!s) { // the formula does not reproduce this hit (a per-hit 特点, a second bolt, …): read it straight from the log
        r.exact = !!(t.refund || t.priestStrike); // 葛蕾「回本」: the overflow itself is the number, nothing to reproduce
        var sh = t.shieldAmt || 0;
        var ok = t.overkill > 0 ? t.overkill : 0; // 2026-11-19 试玩修 界面: the engine's tr.overkill — the hit was bigger than her last hp (was: start = amount, a crit read 「打出 4」)
        s = { start: (t.amount || 0) + ok + (t.blocked || 0) + (t.tough || 0), tough: t.tough || 0, shield: sh, block: Math.max(0, (t.blocked || 0) - sh), minOne: false, over: ok > 0, saved: false, from: {} };
      }
      r.start = s.start; r.tough = s.tough; r.shield = s.shield; r.block = s.block; r.minOne = s.minOne; r.over = s.over; r.saved = s.saved;
      var bits = [];
      var f = s.from || {};
      if (f.crit) bits.push(L('crit', { n: f.crit.n, x: f.crit.x, v: s.start }));
      else if (f.splash) bits.push(L(f.splash.min ? 'splashMin' : 'splash', { n: f.splash.n, d: f.splash.d, v: s.start }));
      else if (ph.length && r.exact) bits.push(String(pre) + ph.map(function (b) { return L((b.amount || 0) < 0 ? 'minus' : 'plus', { label: b.label || '', n: Math.abs(b.amount || 0) }); }).join('') + L('equals', { n: s.start }));
      else bits.push(L(r.exact ? 'start' : 'startOdd', { n: s.start }));
      if (t.pierce) bits.push(L('pierce')); // 用户 2026-11-15: a crit 穿甲 — no 护甲 step
      if (s.tough) bits.push(L('tough', { n: s.tough }));
      if (s.shield) bits.push(L('shield', { name: name(t.shieldBy), n: s.shield }));
      if (s.block) bits.push(L('block', { n: s.block }));
      if (s.minOne) bits.push(L('minOne'));
      if (s.over) bits.push(L('over', { n: r.dealt }));
      else if (s.saved) bits.push(L('saved', { n: r.dealt, hp: t.hpAfter }));
      else bits.push(L(r.down ? 'down' : 'dmg', { n: r.dealt, hp: t.hpAfter }));
      r.text = to + bits.join(L('sep'));
      return r;
    });
    return { actor: e.actor, side: e.side, round: e.round, total: total, head: head, formula: formula, targets: out, lines: [head, formula].concat(out.map(function (r) { return r.text; })) };
  }
  // the 战报: every action of the battle, newest first, grouped by round; block gains ride under the action they follow
  // → [{ round, items: [{ ex (explainAction), extra: [block event texts] }] }]
  function battleReport(log, units, o) {
    var items = [], cur = null;
    (log || []).forEach(function (e) {
      if (!e) return;
      if (e.kind === 'action') { cur = { round: e.round || 0, ex: explainAction(e, units, o), extra: [] }; items.push(cur); return; }
      if (e.kind === 'block' && cur && e.text) { cur.extra.push(e.text); return; }
      if (e.kind === 'phase' || e.kind === 'end' || e.kind === 'wave') cur = null;
    });
    var rounds = [];
    for (var i = items.length - 1; i >= 0; i--) {
      var it = items[i], g = rounds[rounds.length - 1];
      if (!g || g.round !== it.round) { g = { round: it.round, items: [] }; rounds.push(g); }
      g.items.push(it);
    }
    return rounds;
  }
  // 角色面板「怎么算」: her current numbers in one short line, read off her own skill line (the engine's actionText with
  // her real numbers) — so it never re-derives a rule. kind = skill kind; text = her actionText. null when unsure.
  function howCalc(kind, text, o) {
    var L = lookup(o);
    if (!text) return null;
    var s = String(text), over = s.indexOf('{i:block}') >= 0;
    s = s.replace(/\{i:level\}\**\d+\**/g, '').replace(/\{i:\w+\}/g, '');
    var n = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    switch (kind) {
      case 'spark': return n.length >= 3 ? L('how.spark', { p: n[1], s: n[2] }) : n.length === 2 ? L('how.spark', { p: n[0], s: n[1] }) : n.length === 1 ? L('how.sparkOne', { p: n[0] }) : null;
      case 'heal': return n.length >= 2 ? L(over ? 'how.healOver' : 'how.heal', { n: n[0], h: n[1] }) : null;
      case 'guard': return n.length >= 4 ? L('how.guardCover', { d: n[0], b: n[1], c: n[2], g: n[3] }) : n.length >= 2 ? L('how.guard', { d: n[0], b: n[1] }) : null;
      case 'aim': { var ax = { d: n[0], c: n[2], x: CRIT_XS.filter(function (x) { return Math.floor(n[0] * x) === n[2]; })[0] || CRIT_X }; /* 3 级起暴击穿甲 */
        if (n.length >= 3) return /\u7a7f\u7532/.test(s) ? L('how.aimPierce', ax) : L('how.aim', ax); }
        return n.length === 1 ? L('how.aimMax', { c: n[0], x: CRIT_X_MAX }) : null;
      case 'backstab': return n.length >= 2 ? L('how.backstab', { n: n[0], d: n[1] }) : null;
      default: return n.length ? L('how.default', { d: n[0] }) : null;
    }
  }
  // 2026-11-15「一起蓄力，一起出手」: a chain (加成 / 连携) is no longer played one girl per beat. Everyone the chain pulled in
  // (same chainId) rises at once, each builds her own number over her own head at the same time, they all fly together, and
  // the hits resolve on the targets in the ENGINE's order, a short stagger apart (TOGETHER.resolveGap), so hp bars and 护甲
  // badges step exactly as the log says. Pure parts:
  // chainGroups(log) → [{ chainId, side, actors: [uid…], actions: [action events…] }] — consecutive actions sharing a chainId
  // (an action without one is its own group). chainWaves(beats) → [[beat…]…] — the beats that rise together: a chain splits
  // only where a girl would act a second time (one charge bubble per head). A plain action = one wave of one beat.
  function chainGroups(log) {
    var out = [], cur = null;
    (log || []).forEach(function (e) {
      if (!e || e.kind !== 'action') return;
      if (cur && e.chainDepth && e.chainId != null && e.chainId === cur.chainId && e.side === cur.side) { cur.actions.push(e); if (cur.actors.indexOf(e.actor) < 0) cur.actors.push(e.actor); return; }
      cur = { chainId: e.chainId == null ? null : e.chainId, side: e.side, actors: [e.actor], actions: [e] }; out.push(cur);
      if (e.chainId == null) cur = null;
    });
    return out;
  }
  function chainWaves(beats) {
    var out = [], w = null;
    (beats || []).forEach(function (bt) {
      if (!w || w.some(function (x) { return x.actor === bt.actor; })) { w = []; out.push(w); }
      w.push(bt);
    });
    return out;
  }
  // 充能 (用户 2026-11-15) playback: rise + charge out at once → whoever is full rises → every number over every head → the hits.
  // isChargeEv(e) = a fill ('charge') or a spend ('chain' with charge); hasCharge(group) = the group plays that way.
  // A fill runs pip by pip, PIP_MS each, PIP_TOTAL at most.
  var PIP_MS = 70, PIP_TOTAL = 560;
  function isChargeEv(e) { return !!e && (e.kind === 'charge' || (e.kind === 'chain' && !!e.charge)); }
  function hasCharge(group) { return (group || []).some(isChargeEv); }
  // timing of a together wave (ms at ×1 before the speed factor): each girl's charge starts `chargeGap` after the one who
  // pulled her in (the cascade stays readable), all release together, the hits land `resolveGap` apart in engine order
  var TOGETHER = { chargeGap: 140, resolveGap: 100 };
  // CONTRACT-2026-11-16 充能「先蓄后放」 playback. 用户 2026-11-16 晚「准备攻击 → 充能 → 激发 → 抬起 → 加成 → 所有加成者同时一下子
  // 打出去」: a chain group with 'raise' / 'release' events is played as steps:
  //   windup — the opener (the group's first plain action, before any charge) rises and builds her own number over her
  //            head; nothing flies, nothing lands yet (the engine logged her hit first — we HOLD it for the volley)
  //   charge — her bar fills pip by pip: pips = [value after each pip], ms = one pip (later cycles faster: 40 → 32 → 24 → 16)
  //   raise  — her card rises and stays up, her bar drops to `left`, the plate over her head shows ×(stack + 1) (tier = colour)
  //   release— a short breath (hold ms, grows with the total hits, capped), then:
  //   volley — EVERYONE fires at once: items = the held opener + every burst, in the log's order (= the landing order);
  //            each item: { e, uid, opener, i, n, last, mult, land (0, 1, 2 …), extras: [block / blockClear after it] }
  //            all numbers leave together (a hit's i-th of her own n starts (i-1)·volleyStagger later), they land
  //            volleyLand apart in the log's order (hp / 护甲 stay right), plates burst, everyone settles together
  //   act    — (no raise in the group, or an action we cannot hold) a plain beat, as before
  //   extra  — a block / blockClear right after a plain act
  // Anything else (down, lines, chainEnd, an old 'chain') is left to playChain's tail, as before.
  var RELEASE = { pipFirst: 40, pipStep: 8, pipMin: 16, chargeGap: 80, chargeGapFaint: 40, raise: 280, holdBase: 160, holdPer: 30, holdMax: 340, burstGap: 160, drop: 200, volleyStagger: 70, volleyLand: 50 };
  function hasRelease(group) { return (group || []).some(function (e) { return !!e && (e.kind === 'raise' || e.kind === 'release'); }); }
  function pipMs(cycle) { return Math.max(RELEASE.pipMin, RELEASE.pipFirst - Math.max(0, cycle || 0) * RELEASE.pipStep); }
  function multTier(mult) { return Math.max(1, Math.min(5, (mult || 2) - 1)); } // ×2 金 · ×3 橙 · ×4 朱红 · ×5 玫红 · ×6+ 白热 (COMBO-BUILDUP §3.3)
  function holdMs(total) { return Math.min(RELEASE.holdMax, RELEASE.holdBase + RELEASE.holdPer * Math.max(0, total || 0)); }
  function chargePips(e) {
    var b = +e.before || 0, a = +e.after || 0, n = Math.max(1, Math.round(a - b)), out = [];
    for (var p = 1; p <= n; p++) out.push(p === n ? a : Math.min(a, b + p));
    return out;
  }
  function releaseSteps(group) {
    var out = [], raises = 0, mult = {}, last = null, stored = hasRelease(group), held = [], volley = null, opened = false, cascade = false;
    function closeVolley() { volley = null; }
    function item(e, opener) {
      var b = e.burst, it = { e: e, uid: e.actor, opener: !!opener, i: b ? b.i : 1, n: b ? b.n : 1, last: b ? b.i >= b.n : true, mult: b ? (mult[e.actor] || (b.n + 1)) : 1, extras: [] };
      return it;
    }
    function addItem(it) { it.land = volley.items.length; volley.items.push(it); last = it; }
    (group || []).forEach(function (e) {
      if (!e) return;
      switch (e.kind) {
        case 'action':
          if (!stored) { last = e.burst ? { type: 'burst', e: e, uid: e.actor, i: e.burst.i, n: e.burst.n, last: e.burst.i >= e.burst.n, mult: mult[e.actor] || (e.burst.n + 1) } : { type: 'act', e: e }; out.push(last); break; }
          if (volley) { addItem(item(e, false)); break; }
          if (!opened && !cascade && !e.burst) { opened = true; var w = item(e, true); held.push(w); last = w; out.push({ type: 'windup', e: e, uid: e.actor }); break; }
          var h = item(e, false); held.push(h); last = h; break; // a burst with no release before it (a cut log): held for the volley too
        case 'charge': cascade = true; closeVolley(); out.push({ type: 'charge', e: e, uid: e.to, self: !!e.self || e.from === e.to, pips: chargePips(e), ms: pipMs(raises) }); break;
        case 'raise': cascade = true; closeVolley(); raises++; mult[e.to] = (e.stack || 1) + 1; out.push({ type: 'raise', e: e, uid: e.to, mult: mult[e.to], tier: multTier(mult[e.to]), left: e.left || 0 }); break;
        case 'release': {
          cascade = true;
          var order = (e.order || []).map(function (o) { return { uid: o.to, n: o.n || 0 }; }), total = order.reduce(function (s, o) { return s + o.n; }, 0);
          out.push({ type: 'release', e: e, order: order, total: total, hold: holdMs(total) });
          volley = { type: 'volley', items: [] }; out.push(volley);
          held.forEach(function (x) { if (x.e.burst) x.mult = mult[x.uid] || x.mult; addItem(x); }); held = [];
          break;
        }
        case 'block': case 'blockClear':
          if (stored && last && last.extras) last.extras.push(e);
          else if (last) out.push({ type: 'extra', e: e });
          break;
        default: break;
      }
    });
    if (held.length) { volley = { type: 'volley', items: [] }; out.push(volley); held.forEach(addItem); } // a raise without its release (cut off): still fire what was held
    return out;
  }
  // 2026-11-16 猎人锁定 (setAim): who each hunter has locked, for the 准星 over the foe's card. aimMarks(allies) = the view's
  // end state { hunterKey: foeUid } (hunterKey = her uid, else id; no entry when aim is null — the default 最左边 needs no mark).
  // aimStart(evs, allies) = the marks at the START of the round: walks back through 'aim' events — an auto move (her target
  // fell) came from the foe whose 'down' was the latest before it; a set by hand came from nothing we know (no mark).
  // aimToggle(cur, clicked) = the target a click on a foe sends: the locked one again → null (取消), else that foe.
  function hunterKey(u) { return u.uid != null ? u.uid : u.id; }
  function aimMarks(allies) {
    var m = {};
    (allies || []).forEach(function (u) { if (u && u.aim != null) m[hunterKey(u)] = u.aim; });
    return m;
  }
  function aimStart(evs, allies) {
    var m = aimMarks(allies), ids = {}; (allies || []).forEach(function (u) { if (u) ids[u.id] = hunterKey(u); });
    evs = evs || [];
    for (var i = evs.length - 1; i >= 0; i--) {
      var e = evs[i]; if (!e || e.kind !== 'aim') continue;
      var k = ids[e.id] != null ? ids[e.id] : e.id, was = null;
      if (e.auto) for (var j = i - 1; j >= 0; j--) if (evs[j] && evs[j].kind === 'down' && evs[j].side !== 'ally') { was = evs[j].uid; break; }
      if (was != null) m[k] = was; else delete m[k];
    }
    return m;
  }
  function aimToggle(cur, clicked) { return clicked == null || clicked === cur ? null : clicked; }
  function canAimKeys(allies, canAim) { // the hunters the pause may lock for: canAim ids → their card keys
    var c = canAim || [];
    return (allies || []).filter(function (u) { return u && (c.indexOf(u.id) >= 0 || c.indexOf(u.uid) >= 0); }).map(function (u) { return { key: hunterKey(u), id: u.id, aim: u.aim == null ? null : u.aim }; });
  }

  // ===== 2026-11-19 意图预告 (docs/SPEC-damage-spread.md §4): whom each enemy hits this round, pure, node-tested =====
  // Engine contract (branch spread-engine): in view.battle each living enemy has intent { kind, targets: [ally uid…], all },
  // pre-rolled for the coming round; each ally has aimedBy (a number). Round 1 also exists before the battle (preIntent, its
  // place is not fixed yet: intentSource below is the one spot to repoint). Missing fields → an empty result, never a throw.
  var INTENT_KINDS = { front2: 1, backWeighted: 1, rightmost: 1, all: 1, lowest: 1, strongest: 1, heal: 1, other: 1, mark: 1 }; // 2026-11-19 小铃强 玩偶弱: mark = her knell on a marked slot (portrait, like the others)
  var INTENT_SLOT_KINDS = { front2: 1, rightmost: 1, other: 1 }; // re-picked by position when the line-up changes (§2); the rest keep their roll
  function intentNorm(it) {
    if (!it || typeof it !== 'object') return null;
    var kind = INTENT_KINDS[it.kind] ? it.kind : 'other', all = !!it.all || kind === 'all';
    var targets = (Array.isArray(it.targets) ? it.targets : it.target != null ? [it.target] : []).filter(function (t) { return t != null; }).map(String);
    return { kind: kind, targets: targets, all: all };
  }
  // where the pre-battle (round 1) intents live: view.battle.preIntent, then view.prep.preIntent, then view.preIntent
  function intentSource(view) {
    var v = view || {}, b = v.battle || null;
    return (b && b.preIntent) || (v.prep && v.prep.preIntent) || v.preIntent || null;
  }
  // a preIntent in any of these shapes: [{ uid|id, name, kind, targets, all }] | { enemyKey: intent } | { enemies: [...] }
  // 2026-11-19 spread: connect — the engine's real shape is { round, wave, waveCount, enemies: [{ uid, id, name, targetRule, intent }],
  // allies: [{ id, uid, aimedBy }] }: targets are ally uids; preIntent.allies maps them to member ids (the formation's keys);
  // an enemy whose intent is null (none this round) is skipped.
  function intentPreList(pre) {
    if (!pre) return [];
    var uidToId = {};
    if (!Array.isArray(pre) && Array.isArray(pre.allies)) pre.allies.forEach(function (a) { if (a && a.uid != null) uidToId[String(a.uid)] = String(a.id != null ? a.id : a.uid); });
    var arr = Array.isArray(pre) ? pre : Array.isArray(pre.enemies) ? pre.enemies : Object.keys(pre).map(function (k) { var o = pre[k]; return o && typeof o === 'object' ? Object.assign({ uid: k }, o) : null; });
    return arr.map(function (e) {
      if (!e) return null;
      var n = intentNorm('intent' in e ? e.intent : e); if (!n) return null;
      n.targets = n.targets.map(function (t) { return uidToId[t] || t; });
      n.key = String(e.uid != null ? e.uid : e.id != null ? e.id : ''); n.id = e.id != null ? String(e.id) : n.key; n.name = e.name || '';
      if (e.targetRule) n.rule = String(e.targetRule);
      return n;
    }).filter(Boolean);
  }
  function intentAimed(list, allies) { // ally key → how many enemies aim at her (an 'all' counts for everyone; a heal counts for nobody)
    var m = {};
    (list || []).forEach(function (it) {
      if (it.kind === 'heal') return;
      var keys = it.all ? (allies || []) : it.targets, seen = {};
      keys.forEach(function (k) { if (seen[k]) return; seen[k] = 1; m[k] = (m[k] || 0) + 1; });
    });
    return m;
  }
  // intentOf(view) → { src: 'battle' | 'pre' | null, list: [{ key, id, name, kind, targets, all, rule? }], aimed: { allyKey: n } }
  // battle: view.battle.enemies[i].intent { kind, targets: [ally uid], all } + allies[i].aimedBy (+ battle.intentRound)
  // pre: view.preIntent (engine), also battle.preIntent / prep.preIntent (older fakes)
  function intentOf(view) {
    var v = view || {}, b = v.battle || null, list = [], aimed = {}, allyKeys = [];
    if (b && Array.isArray(b.enemies)) {
      (b.allies || []).forEach(function (u) { if (u && u.hp > 0) allyKeys.push(String(u.uid != null ? u.uid : u.id)); });
      b.enemies.forEach(function (u) {
        if (!u || !(u.hp > 0) || !u.intent) return;
        var n = intentNorm(u.intent); if (!n) return;
        n.key = String(u.uid != null ? u.uid : u.id); n.id = u.id != null ? String(u.id) : n.key; n.name = u.name || '';
        if (u.targetRule) n.rule = String(u.targetRule);
        list.push(n);
      });
      var hasAimed = false;
      (b.allies || []).forEach(function (u) { if (u && typeof u.aimedBy === 'number') { hasAimed = true; if (u.aimedBy > 0 && u.hp > 0) aimed[String(u.uid != null ? u.uid : u.id)] = u.aimedBy; } });
      if (list.length) return { src: 'battle', list: list, aimed: hasAimed ? aimed : intentAimed(list, allyKeys), round: b.intentRound != null ? b.intentRound : null };
    }
    var pre = intentSource(v);
    list = intentPreList(pre);
    if (!list.length) return { src: null, list: [], aimed: {} };
    allyKeys = (v.party || []).map(function (m) { return String(m.uid != null ? m.uid : m.id); });
    if (pre && !Array.isArray(pre) && Array.isArray(pre.allies) && pre.allies.some(function (a) { return a && typeof a.aimedBy === 'number'; })) {
      pre.allies.forEach(function (a) { if (a && a.aimedBy > 0) aimed[String(a.id != null ? a.id : a.uid)] = a.aimedBy; });
      return { src: 'pre', list: list, aimed: aimed, round: pre.round || 1 };
    }
    return { src: 'pre', list: list, aimed: intentAimed(list, allyKeys) };
  }
  // the formation screen: the player re-orders locally (uiOrder) before the engine hears of it. front2 / other (the first two)
  // follow the slot from the left, rightmost the slot from the right; the other kinds keep the girl the engine rolled.
  function intentRemap(I, engineOrder, uiOrder) {
    var eo = (engineOrder || []).map(String), uo = (uiOrder || []).map(String);
    var list = ((I && I.list) || []).map(function (it) {
      var o = { key: it.key, id: it.id, name: it.name, kind: it.kind, all: it.all, targets: it.targets.slice() };
      if (it.rule) o.rule = it.rule;
      if (INTENT_SLOT_KINDS[it.kind] && uo.length && !it.all) {
        o.targets = it.targets.map(function (t) {
          var s = eo.indexOf(t); if (s < 0) return t;
          if (it.kind === 'rightmost') { var r = eo.length - 1 - s; return r >= 0 && r < uo.length ? uo[uo.length - 1 - r] : t; }
          return s < uo.length ? uo[s] : t;
        });
      }
      return o;
    });
    return { src: I && I.src, list: list, aimed: intentAimed(list, uo.length ? uo : eo) };
  }

  // 2026-11-20 BONUS_STACK (mockup ui/dev/mockup-bonus-v5.html, user-approved): an action's bonuses pop up as rows over the
  // attacker (enemies: below, red) — row 1 after STACK.first ms, each next gap ×STACK.decay, never under STACK.min; at most
  // STACK.maxRows rows: multiplier rows (暴击 / 好运一击 / 连发 ×n) always keep their own row, extra additive rows fold into one
  // 「其他 +N」 row. 2+ rows → the last one lands and holds STACK.hold ms, then all merge into one number that flies.
  // A row: { op: '+' | '×', v, label (engine text, or null), key (UI text key: crit / jackpot / lucky / other / burst / chain),
  // ic (icon key) }. Nothing here changes a number: the hits still land with the engine's own amounts.
  var STACK = { first: 320, decay: 0.75, min: 90, maxRows: 5, hold: 500, grow: 1.15, heavyRatio: 6 };
  function stackGap(i) { return Math.max(STACK.min, Math.round(STACK.first * Math.pow(STACK.decay, i || 0))); } // i = 0 → the 1st row
  function collapseRows(rows, maxRows) {
    var max = maxRows || STACK.maxRows, muls = [], adds = [];
    (rows || []).forEach(function (r) { (r.op === '×' ? muls : adds).push(r); });
    var slots = Math.max(1, max - muls.length);
    if (adds.length > slots) {
      var rest = adds.slice(slots - 1);
      adds = adds.slice(0, slots - 1).concat([{ op: '+', v: rest.reduce(function (s, r) { return s + r.v; }, 0), label: null, key: 'other', ic: 'other', parts: rest }]);
    }
    return adds.concat(muls);
  }
  // the rows of one action (n = how many of her actions this one stack stands for: 连发 ×n is added last)
  function stackRows(a, n) {
    if (!a) return [];
    var rows = [];
    (a.bonuses || []).forEach(function (b) {
      if (!b || b.hit || b.noEffect || !b.amount) return; // a per-hit entry belongs to that hit, never to the opening number
      var chain = b.ic === 'chain';
      rows.push({ op: '+', v: b.amount, label: chain ? null : b.label || '', key: chain ? 'chain' : null, ic: b.ic || (b.amount < 0 ? 'weak' : 'plus') });
    });
    var ts = (a.targets || []).filter(function (t) { return t && !t.miss && !t.capped && t.kind !== 'heal'; });
    var cr = ts.filter(function (t) { return t.crit; })[0];
    if (cr) rows.push({ op: '×', v: cr.critX || 2, label: null, key: cr.jackpot ? 'jackpot' : 'crit', ic: 'crit' });
    var lk = ts.filter(function (t) { return t.lucky; })[0];
    if (lk || (a.lucky && ts.length)) rows.push({ op: '×', v: (lk && lk.luckX) || 2, label: null, key: 'lucky', ic: 'lucky' });
    var nn = n || 1, out = collapseRows(rows, nn > 1 ? STACK.maxRows - 1 : STACK.maxRows);
    if (nn > 1) out.push({ op: '×', v: nn, label: null, key: 'burst', ic: 'burst', burst: true });
    return out;
  }
  function stackTotals(base, rows) {
    var t = base || 0, out = [t];
    (rows || []).forEach(function (r) { t = r.op === '×' ? Math.floor(t * r.v) : t + r.v; out.push(t); }); // 2026-11-20 用户「暴击伤害有小数，所有伤害必须取整」: each × step rounds down, as the engine's Math.floor(amount × crit)
    return out;
  }
  function stackFont(ratio) { return Math.round(64 * Math.min(2.4, 1 + 0.35 * Math.log2(Math.max(1, ratio || 1)))); } // the merged number grows with final / base
  function stackRowFont(i, base0) { return +((base0 || 18) * Math.pow(STACK.grow, i || 0)).toFixed(1); } // each row +15%
  // her hits summed per target (a girl's n actions / a 连击 → one number per target): [{ uid, ts: [t …], full }]
  // num(t) = what one hit shows (RoundPlan.hitNum by default) — misses / capped / zero hits are left out
  function sumHits(acts, num) {
    var f = num || hitNum, out = [], by = {};
    (acts || []).forEach(function (a) {
      ((a && a.targets) || []).forEach(function (t) {
        var n = f(t); if (!n || n.heal) return;
        var g = by[t.uid]; if (!g) { g = by[t.uid] = { uid: t.uid, ts: [], full: 0 }; out.push(g); }
        g.ts.push(t); g.full += n.full;
      });
    });
    return out;
  }
  // a chain's volley as shots: the volley items (releaseSteps) grouped by girl, in first-appearance order —
  // [{ uid, acts: [e …], n, opener }]: her n actions play as ONE stack (连发 ×n), the opener (n = 1, no 连锁 row) included
  function volleyShots(items) {
    var out = [], by = {};
    (items || []).forEach(function (it) {
      if (!it || !it.e) return;
      var s = by[it.uid]; if (!s) { s = by[it.uid] = { uid: it.uid, acts: [], n: 0, opener: !!it.opener }; out.push(s); }
      s.acts.push(it.e); s.n = s.acts.length;
    });
    return out;
  }
  // 2026-11-20 BONUS_STACK_V7 (?stack=v7, user-approved ui/dev/mockup-bonus-v7.html): the plate is WORDS — every row 「source
  // effect」 (「高昂　威力 +1」「暴击　×2」「连发 2 次　×2」), the base row 「基础威力　5」, a folded row 「其他　威力 +4」 with its parts
  // on a second line. A 连击 adds an info row 「连击 3 下　每下 N」 (it does not multiply: her hits still land one by one).
  // tr(key, vars) = the UI text lookup (battle.stack.*). Nothing here changes a number: the hits land with the engine's amounts.
  function plateHits(a) {
    var n = 0; ((a && a.targets) || []).forEach(function (t) { if (t && t.of > n && t.kind !== 'heal') n = t.of; });
    return Math.max(n, (a && a.hits > 1 && n > 1) ? a.hits : 0);
  }
  function plateWords(a, n, tr) {
    var rows = stackRows(a, n), base = (a && a.base) || 0, tot = stackTotals(base, rows), fin = tot[tot.length - 1];
    var eff = function (r) { return r.op === '×' ? '×' + r.v : tr(r.v < 0 ? 'battle.stack.sub' : 'battle.stack.add', { n: Math.abs(r.v) }); };
    var name = function (r) { return r.burst ? tr('battle.stack.burstRow', { n: r.v }) : r.label || tr('battle.stack.' + (r.key || 'other')); };
    var out = [{ k: tr('battle.stack.baseRow'), e: String(base), cls: 'base' }].concat(rows.map(function (r) {
      return { k: name(r), e: eff(r), cls: r.op === '×' ? (r.burst ? 'burst' : 'mul') : '', sub: r.parts ? r.parts.map(function (p) { return (p.label || tr('battle.stack.' + (p.key || 'other'))) + ' ' + (p.v < 0 ? '−' + (-p.v) : '+' + p.v); }).join(tr('battle.stack.sep')) : '' };
    }));
    // 2026-11-20 用户「合计 6 很蠢」: no explanation row, no caption — the merged result is ONE number, or 「A × B」 when her B hits /
    // targets all hit for the same A (the engine's real per-hit amounts); different amounts → their sum
    var hits = plateHits(a), live = ((a && a.targets) || []).filter(function (t) { return t && !t.miss && !t.capped && t.kind !== 'heal'; });
    var vals = live.map(function (t) { var h = hitNum(t); return h ? h.full : 0; }).filter(function (v) { return v > 0; });
    var result = String(fin);
    if ((n || 1) <= 1 && vals.length > 1) result = vals.every(function (v) { return v === vals[0]; }) ? vals[0] + ' × ' + vals.length : String(vals.reduce(function (x, y) { return x + y; }, 0));
    var cap = '';
    return { base: base, rows: out, steps: rows.length, totals: tot, final: fin, cap: cap, result: result, hits: hits, bonus: rows.length > 0 };
  }
  // can this action play as a stack? damage only (no heal), something to show, at least one live target
  // 2026-11-20 用户「怎么有些时候还有很小的字飞上去的加成？不是都换成向上列表了吗」(STACK_ALL): a heal, or an action whose hits all
  // missed / were dodged, used to fall back to the old flying bonus words — now they get the plate too. false = the old rule.
  var STACK_ALL = true;
  function stackable(a) {
    if (!a) return false;
    if (STACK_ALL) return (a.targets || []).some(function (t) { return t && !t.capped; });
    if (a.heal) return false;
    return (a.targets || []).some(function (t) { return t && !t.miss && !t.capped && t.kind !== 'heal'; });
  }

  // ===== 2026-11-20 阵容同步: 画面按【开始阵容】起画（engine battle.roundStart），每播到一个改阵容的事件才改阵容 =====
  // lineup = { allies: [unit…], enemies: [unit…] }（unit = 引擎的 unitView，多一个 down 标记）。只管阵容：谁在场、顺序、
  // 谁倒下、谁被移走、谁顶进谁的位置。数值（血量 / 护甲 / 充能）不归这里管。
  // lineupStep(L, e) → 新的 lineup（不改 L）；applyLineup(start, events) → 播完整回合后的阵容。
  // 每一种改阵容的事件：
  //   enemyEnter { unit, out? }     新一波入场（out = 上一波被移走的 uid，引擎 loadWave 补的字段）；排在敌方最右
  //   summon { units, slots, split, brood, uid } 召唤 / 分裂 / 母体吐小史莱姆：slots 里的顶替倒下者的位置；
  //                                 其余：分裂的排在本体右边，母体吐的、露西安召唤的排在施放者左边
  //   lineupOut { side, uids }       倒下的被移走（引擎 pruneBrood / 旧召唤规则补的事件）
  //   devour { eaten }               被吞掉的移走
  //   switchSide { uid, unit, index } 换边：从敌方拿走，进我方第 index 位
  //   down { uid }                   倒下（还在场，变灰）
  //   move                           换位在暂停时已生效（开始阵容就是换过的），这里不动
  function lcopy(u, down) { var o = {}; for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) o[k] = u[k]; o.down = down != null ? !!down : !!(u.down || u.hp <= 0); return o; }
  function lineupFrom(start) {
    return { allies: ((start && start.allies) || []).map(function (u) { return lcopy(u); }), enemies: ((start && start.enemies) || []).map(function (u) { return lcopy(u); }) };
  }
  function lidx(arr, uid) { for (var i = 0; i < arr.length; i++) if (String(arr[i].uid) === String(uid)) return i; return -1; }
  function lineupStep(L, e) {
    if (!e || e.replay) return L;
    var k = e.kind, A0 = L.allies, F0 = L.enemies;
    if (k !== 'enemyEnter' && k !== 'summon' && k !== 'lineupOut' && k !== 'devour' && k !== 'switchSide' && k !== 'down') return L;
    var al = A0.slice(), en = F0.slice();
    var drop = function (arr, uids) { var m = {}; (uids || []).forEach(function (x) { m[String(x)] = 1; }); return arr.filter(function (u) { return !m[String(u.uid)]; }); };
    if (k === 'enemyEnter') {
      if (e.out && e.out.length) en = drop(en, e.out);
      var u0 = e.unit || { uid: e.uid, id: e.id };
      if (lidx(en, u0.uid) < 0) en.push(lcopy(u0, false));
    } else if (k === 'summon') {
      var slot = {}; (e.slots || []).forEach(function (s) { slot[String(s.uid)] = s.was; });
      var after = e.split ? e.uid : null, at = null;
      (e.units || []).forEach(function (u) {
        if (lidx(en, u.uid) >= 0) return;
        var c = lcopy(u, false), was = slot[String(u.uid)], wi = was != null ? lidx(en, was) : -1;
        if (wi >= 0) { en[wi] = c; return; }
        if (after != null) { var pi = lidx(en, after); en.splice(pi < 0 ? en.length : pi + 1, 0, c); after = c.uid; return; }
        var bi = lidx(en, e.uid); en.splice(bi < 0 ? en.length : bi, 0, c);
      });
    } else if (k === 'lineupOut') {
      if (e.side === 'ally') al = drop(al, e.uids); else en = drop(en, e.uids);
    } else if (k === 'devour') {
      en = drop(en, e.eaten);
    } else if (k === 'switchSide') {
      var si = lidx(en, e.uid), u1 = si >= 0 ? en[si] : null;
      en = drop(en, [e.uid]);
      if (lidx(al, e.uid) < 0) { var c1 = lcopy(e.unit || u1 || { uid: e.uid, id: e.id }, false); c1.side = 'ally'; al.splice(e.index != null ? Math.min(e.index, al.length) : al.length, 0, c1); }
    } else if (k === 'down') {
      var arr = e.side === 'ally' ? al : en, di = lidx(arr, e.uid);
      if (di < 0) { arr = e.side === 'ally' ? en : al; di = lidx(arr, e.uid); }
      if (di >= 0) arr[di] = lcopy(arr[di], true);
    }
    return { allies: al, enemies: en };
  }
  function applyLineup(start, events) {
    var L = lineupFrom(start);
    (events || []).forEach(function (e) { L = lineupStep(L, e); });
    return L;
  }
  // 两份阵容是否一样（只比顺序和 uid；withDown = 也比谁倒下）。不一样时返回第一处差别的文字，一样返回 ''
  function lineupDiff(a, b, withDown) {
    var sides = ['allies', 'enemies'];
    for (var s = 0; s < 2; s++) {
      var x = (a && a[sides[s]]) || [], y = (b && b[sides[s]]) || [];
      var xs = x.map(function (u) { return String(u.uid); }).join(','), ys = y.map(function (u) { return String(u.uid); }).join(',');
      if (xs !== ys) return sides[s] + ': [' + xs + '] vs [' + ys + ']';
      if (withDown) for (var i = 0; i < x.length; i++) { var dx = x[i].down != null ? !!x[i].down : x[i].hp <= 0, dy = y[i].down != null ? !!y[i].down : y[i].hp <= 0; if (dx !== dy) return sides[s] + ': ' + x[i].uid + ' down ' + dx + ' vs ' + dy; }
    }
    return '';
  }
  var api = { intentOf: intentOf, intentSource: intentSource, intentNorm: intentNorm, intentRemap: intentRemap, intentAimed: intentAimed, autoContMs: autoContMs, AIM_AUTO_MS: AIM_AUTO_MS, aimMarks: aimMarks, aimStart: aimStart, aimToggle: aimToggle, canAimKeys: canAimKeys, RELEASE: RELEASE, hasRelease: hasRelease, pipMs: pipMs, multTier: multTier, holdMs: holdMs, chargePips: chargePips, releaseSteps: releaseSteps, foeChained: foeChained, chainGroups: chainGroups, chainWaves: chainWaves, isChargeEv: isChargeEv, hasCharge: hasCharge, PIP_MS: PIP_MS, PIP_TOTAL: PIP_TOTAL, TOGETHER: TOGETHER, explainAction: explainAction, battleReport: battleReport, howCalc: howCalc, SPLASH_DIV: SPLASH_DIV, blockStart: blockStart, hitBlocks: hitBlocks, eventBlocks: eventBlocks, beatExtras: beatExtras, chargeStart: chargeStart, actionBeats: actionBeats, RISE: RISE, riseTiming: riseTiming, hitNum: hitNum, planRound: planRound, fxKey: fxKey, groupEvents: groupEvents, groupFx: groupFx, chainEnd: chainEnd, phaseActs: phaseActs, foeLane: foeLane, afterRound: afterRound, dimContent: dimContent, debtsContent: debtsContent, shouldDim: shouldDim, STACK: STACK, stackGap: stackGap, collapseRows: collapseRows, stackRows: stackRows, stackTotals: stackTotals, stackFont: stackFont, stackRowFont: stackRowFont, sumHits: sumHits, volleyShots: volleyShots, stackable: stackable, plateHits: plateHits, plateWords: plateWords, lineupFrom: lineupFrom, lineupStep: lineupStep, applyLineup: applyLineup, lineupDiff: lineupDiff };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
