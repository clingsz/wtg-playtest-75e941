// 修复 2026-11-13「落选者小队不攻击」: how one battle round's events are cut into playback steps (pure, node-tested).
// app.js playRound plays each step: 'chain' = an ally action + its chain / follow-ups (playChain), 'one' = playOne.
// The bug: an ally group swallowed everything up to the next action — the enemy 「第 N 回合 · 敌方行动」 phase marker
// included — so it played inside playChain without its `acts` flag and the enemy turn had no banner. A phase marker
// (or anything that opens a new beat) now always ends the group.
(function (root) {
  'use strict';
  var STOP = { phase: 1, enemyEnter: 1, wave: 1, end: 1, frenzy: 1, reckoning: 1, debts: 1, memory: 1 };
  // end (exclusive) of the ally group that starts at evs[i]
  function chainEnd(evs, i) {
    var e = evs[i], j = i + 1;
    while (j < evs.length) {
      var f = evs[j];
      if (f.kind === 'action' && (!f.chainDepth || f.side !== 'ally' || (e.chainId != null && f.chainId != null && f.chainId !== e.chainId))) break;
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
  // the steps, in order: { type: 'chain', group } | { type: 'debts', debts, memories } | { type: 'one', e, acts? }
  function planRound(evs) {
    var out = [], i = 0;
    while (i < evs.length) {
      var e = evs[i];
      if (e.kind === 'debts') { var mems = [], j0 = i + 1; while (j0 < evs.length && evs[j0].kind === 'memory') mems.push(evs[j0++]); out.push({ type: 'debts', debts: e, memories: mems, i: i }); i = j0; continue; }
      if (e.kind === 'memory') { var ms = [], j1 = i; while (j1 < evs.length && evs[j1].kind === 'memory') ms.push(evs[j1++]); out.push({ type: 'debts', debts: { id: e.id, debts: [] }, memories: ms, i: i }); i = j1; continue; }
      if (e.kind === 'action' && e.side === 'ally' && !e.chainDepth) { var j = chainEnd(evs, i); out.push({ type: 'chain', group: evs.slice(i, j), i: i }); i = j; continue; }
      var st = { type: 'one', e: e, i: i };
      if (e.kind === 'phase') st.acts = phaseActs(evs, i);
      out.push(st); i++;
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
      var total = (a.base || 0) + (a.bonuses || []).reduce(function (s, b) { return s + (b.noEffect ? 0 : b.amount || 0); }, 0);
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
  var api = { actionBeats: actionBeats, RISE: RISE, riseTiming: riseTiming, hitNum: hitNum, planRound: planRound, chainEnd: chainEnd, phaseActs: phaseActs, foeLane: foeLane, afterRound: afterRound, dimContent: dimContent, debtsContent: debtsContent, shouldDim: shouldDim };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
