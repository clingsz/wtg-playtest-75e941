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
      if (k >= 0 && (e.kind === 'block' || e.kind === 'blockClear')) out[k].push(e);
    });
    return out;
  }
  // v39「结算看得懂」: one action of the battle log, explained in plain words. Every number comes from the log entry
  // ({base, bonuses, targets[{amount, hpAfter, blocked, blockAfter, shieldBy, shieldAmt, tough, crit, splash, miss}]}).
  // The crit ×2 / ×2.5 and the mage splash ⌊威力÷3⌋ (min 1) are only SHOWN when they reproduce the logged number exactly;
  // otherwise the line falls back to the plain 「打出 N → 护甲挡 → 掉血」 read straight from the hit (never a wrong formula).
  // explainAction(e, units, o) → { actor, total, formula, head, targets: [{ uid, name, kind, start, tough, shield, block,
  // dealt, hpAfter, down, minOne, over, saved, exact, text }], lines: [head, formula, ...target lines] }
  // units: { uid: { name } } (or an array of { uid, name }); o.t = the text lookup (T / E.t). Lines use {i:name} glyph tokens.
  var SPLASH_DIV = 3, CRIT_X = 2, CRIT_X_MAX = 2.5;
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
    if (t.splash && e.skillKind === 'spark' && ally) { var fl = Math.floor(pre / SPLASH_DIV); cands.push({ v: Math.max(1, fl) * mult, splash: { n: pre, d: SPLASH_DIV, min: fl < 1 } }); }
    else if (t.crit) [e.skillLv >= 4 ? CRIT_X_MAX : CRIT_X, CRIT_X, CRIT_X_MAX].forEach(function (x) { cands.push({ v: Math.floor(pre * x) * mult, crit: { n: pre, x: x } }); });
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
      var s = hitStart(e, t, pre, mult);
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
      else bits.push(L(r.exact ? 'start' : 'startOdd', { n: s.start }));
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
      case 'aim': return n.length >= 3 ? L('how.aim', { d: n[0], c: n[2] }) : n.length === 1 ? L('how.aimMax', { c: n[0] }) : null;
      case 'backstab': return n.length >= 2 ? L('how.backstab', { n: n[0], d: n[1] }) : null;
      default: return n.length ? L('how.default', { d: n[0] }) : null;
    }
  }
  var api = { explainAction: explainAction, battleReport: battleReport, howCalc: howCalc, SPLASH_DIV: SPLASH_DIV, blockStart: blockStart, hitBlocks: hitBlocks, eventBlocks: eventBlocks, beatExtras: beatExtras, actionBeats: actionBeats, RISE: RISE, riseTiming: riseTiming, hitNum: hitNum, planRound: planRound, chainEnd: chainEnd, phaseActs: phaseActs, foeLane: foeLane, afterRound: afterRound, dimContent: dimContent, debtsContent: debtsContent, shouldDim: shouldDim };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoundPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
