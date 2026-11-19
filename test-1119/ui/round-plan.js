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
  var SPLASH_DIV = 2, CRIT_X = 2, CRIT_X_MAX = 3, CRIT_XS = [2, 2.5, 3]; // 用户 2026-11-15 弓手加强: Lv1–2 ×2 · Lv3 ×2.5 · Lv4 ×3
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
    if (t.refund) return null;
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
        r.exact = !!t.refund; // 葛蕾「回本」: the overflow itself is the number, nothing to reproduce
        var sh = t.shieldAmt || 0;
        s = { start: (t.amount || 0) + (t.blocked || 0) + (t.tough || 0), tough: t.tough || 0, shield: sh, block: Math.max(0, (t.blocked || 0) - sh), minOne: false, over: false, saved: false, from: {} };
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
  var api = { autoContMs: autoContMs, AIM_AUTO_MS: AIM_AUTO_MS, aimMarks: aimMarks, aimStart: aimStart, aimToggle: aimToggle, canAimKeys: canAimKeys, RELEASE: RELEASE, hasRelease: hasRelease, pipMs: pipMs, multTier: multTier, holdMs: holdMs, chargePips: chargePips, releaseSteps: releaseSteps, foeChained: foeChained, chainGroups: chainGroups, chainWaves: chainWaves, isChargeEv: isChargeEv, hasCharge: hasCharge, PIP_MS: PIP_MS, PIP_TOTAL: PIP_TOTAL, TOGETHER: TOGETHER, explainAction: explainAction, battleReport: battleReport, howCalc: howCalc, SPLASH_DIV: SPLASH_DIV, blockStart: blockStart, hitBlocks: hitBlocks, eventBlocks: eventBlocks, beatExtras: beatExtras, chargeStart: chargeStart, actionBeats: actionBeats, RISE: RISE, riseTiming: riseTiming, hitNum: hitNum, planRound: planRound, chainEnd: chainEnd, phaseActs: phaseActs, foeLane: foeLane, afterRound: afterRound, dimContent: dimContent, debtsContent: debtsContent, shouldDim: shouldDim };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
