// Chooser rules engine v3 (docs/archive/V2.2-CONTRACT.md on V2.1 / V2-CONTRACT.md on docs/archive/RULES-v1.md) — data shapes in data/schema.md.
// Classic script + CommonJS. No deps, no DOM, no Math.random, no Date. All randomness from run.rng.
// The run is plain JSON (including the live battle state in run.battle), so it can be saved/replayed anywhere.
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const clone = (o) => (o === undefined ? undefined : typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r2 = (n) => Math.round(n * 100) / 100;
  const fail = (msg) => { throw new Error('ChooserEngine: ' + msg); };

  // ---------- i18n (docs/I18N.md) ----------
  // Text lives in data/text/<locale>/<ns>.json; the full key is '<ns>.<key>' (engine text: TX('x.y') = t('engine.x.y')).
  // Table source: I18N.text if set (setText) → node: tools/load-text.cjs reads data/text from disk → browser: CHOOSER_DATA.text (ui/generated/data.js).
  // Lookup: current locale → zh → the key itself (recorded in I18N.missing). {name} is replaced only when vars has `name`.
  const I18N = { locale: 'zh', text: null, missing: [], strict: false, loading: true, loadCalls: 0 };
  function textTable() {
    if (I18N.text) return I18N.text;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return (I18N.text = require('../tools/load-text.cjs')()); } catch (e) { /* not in the repo layout: fall through */ }
    }
    const d = root.CHOOSER_DATA;
    return d && d.text ? d.text : null;
  }
  function t(key, vars) {
    if (I18N.loading) I18N.loadCalls++; // must stay 0: in the browser data.js loads after engine.js (tests/i18n.test.cjs)
    const tb = textTable() || {};
    let s = tb[I18N.locale] ? tb[I18N.locale][key] : undefined;
    if (s == null && I18N.locale !== 'zh' && tb.zh) s = tb.zh[key];
    if (s == null) {
      if (!I18N.missing.includes(key)) I18N.missing.push(key);
      if (I18N.strict) fail('missing text ' + key);
      return key;
    }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
  }
  const TX = (key, vars) => t('engine.' + key, vars);
  // a load-time constant with text in it: built on first use, rebuilt when the locale changes
  const lazy = (f) => { let loc = null, v; return () => (loc === I18N.locale ? v : ((loc = I18N.locale), (v = f()))); };
  // ?lang=en beats meta.lang beats 'zh'. search: location.search; meta: the UI's saved meta object.
  function pickLocale(o) {
    o = o || {};
    const okLoc = (x) => typeof x === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(x);
    const m = /[?&]lang=([^&#]*)/.exec(o.search || '');
    const q = m ? decodeURIComponent(m[1]) : null;
    if (okLoc(q)) return q;
    if (o.meta && okLoc(o.meta.lang)) return o.meta.lang;
    return 'zh';
  }
  function setLocale(loc) { I18N.locale = typeof loc === 'string' && loc ? loc : 'zh'; return I18N.locale; }
  // data/*.json in another language: build merges data/i18n/<locale>/*.json into CHOOSER_DATA.l10n[locale] (whole files)
  function localizeData(data, loc) {
    loc = loc || I18N.locale;
    const o = data && data.l10n && data.l10n[loc];
    return o ? Object.assign({}, data, o) : data;
  }
  if (root && root.location && typeof root.location.search === 'string') setLocale(pickLocale({ search: root.location.search }));

  function rngNext(run) { // mulberry32; state is a uint32 stored in run.rng
    let t = (run.rng = (run.rng + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rngInt = (run, n) => Math.floor(rngNext(run) * n);
  const rngPick = (run, arr) => arr[rngInt(run, arr.length)];
  function rngSample(run, arr, k) {
    const pool = arr.slice(), out = [];
    while (out.length < k && pool.length) out.push(pool.splice(rngInt(run, pool.length), 1)[0]);
    return out;
  }

  const TRAIT_LABELS = lazy(() => ({
    protective: TX('trait.protective'), selfless: TX('trait.selfless'), greedy: TX('trait.greedy'), 'late-bloomer': TX('trait.late-bloomer'), fragile: TX('trait.fragile'), calm: TX('trait.calm'),
    proud: TX('trait.proud'), 'crisis-leader': TX('trait.crisis-leader'), 'old-master': TX('trait.old-master'), loyal: TX('trait.loyal'), jealous: TX('trait.jealous'),
  }));
  const MOOD_EVENT_TEXT_OLD = false; // 2026-11-19 试玩修 数值文字 (see applyMoods)
  // 2026-11-19 试玩修 数值文字: what each mood level does ('' = nothing)
  const MOOD_EFFECTS = lazy(() => ({ '-2': TX('mood.effect.-2'), '-1': TX('mood.effect.-1'), 0: TX('mood.effect.0'), 1: TX('mood.effect.1'), 2: TX('mood.effect.2') }));
  const MOOD_EFFECT = (lv) => MOOD_EFFECTS()[lv] || '';
  // 2026-11-19 试玩修 数值文字: what each hidden trait does, appended to its reveal ({trait} = its name)
  const TRAIT_EFFECTS = ({
    protective: (v) => TX('trait.effect.protective', v), selfless: (v) => TX('trait.effect.selfless', v), greedy: (v) => TX('trait.effect.greedy', v), 'late-bloomer': (v) => TX('trait.effect.late-bloomer', v), fragile: (v) => TX('trait.effect.fragile', v), calm: (v) => TX('trait.effect.calm', v),
    proud: (v) => TX('trait.effect.proud', v), 'crisis-leader': (v) => TX('trait.effect.crisis-leader', v), 'old-master': (v) => TX('trait.effect.old-master', v), loyal: (v) => TX('trait.effect.loyal', v), jealous: (v) => TX('trait.effect.jealous', v),
  });
  // 2026-11-20 起作用时才说 (REVEAL_ON_EFFECT): what the trait just did, per trait / situation
  const TRAIT_FIRED = ({ 'calm': (v) => TX('trait.fired.calm', v), 'proud': (v) => TX('trait.fired.proud', v), 'proud-curse': (v) => TX('trait.fired.proud-curse', v), 'greedy': (v) => TX('trait.fired.greedy', v), 'jealous': (v) => TX('trait.fired.jealous', v), 'jealous-other': (v) => TX('trait.fired.jealous-other', v), 'protective': (v) => TX('trait.fired.protective', v), 'protective-sacrifice': (v) => TX('trait.fired.protective-sacrifice', v), 'fragile': (v) => TX('trait.fired.fragile', v), 'selfless': (v) => TX('trait.fired.selfless', v), 'selfless-victim': (v) => TX('trait.fired.selfless-victim', v), 'loyal': (v) => TX('trait.fired.loyal', v), 'late-bloomer': (v) => TX('trait.fired.late-bloomer', v), 'crisis-leader': (v) => TX('trait.fired.crisis-leader', v), 'old-master': (v) => TX('trait.fired.old-master', v) });
  const MOOD_LABELS = lazy(() => ({ '-2': TX('mood.level.-2'), '-1': TX('mood.level.-1'), 0: TX('mood.level.0'), 1: TX('mood.level.1'), 2: TX('mood.level.2') }));
  const ROLE_LABELS = lazy(() => ({ tank: TX('role.tank'), adc: TX('role.adc'), healer: TX('role.healer'), mage: TX('role.mage'), rogue: TX('role.rogue') }));
  const FACTION_LABELS = lazy(() => ({ monster: TX('faction.monster'), undead: TX('faction.undead'), bandit: TX('faction.bandit'), noble: TX('faction.noble'), fallen: TX('faction.fallen') }));
  const STATUS_LABELS = lazy(() => ({ // fallback when data/keywords.json has no status entry
    'slow-start': TX('status.slow-start'), weak: TX('status.weak'), tough: TX('status.tough'), shell: TX('status.shell'), formation: TX('status.formation'), clause: TX('status.clause'), luck: TX('status.luck'), overtime: TX('status.overtime'), luckUp: TX('status.luckUp'), smoke: TX('status.smoke'), drum: TX('status.drum'), daze: TX('status.daze'),
    'bond-high': TX('status.bond-high'), 'bond-low': TX('status.bond-low'), 'mood-low': TX('status.mood-low'), vengeful: TX('status.vengeful'), 'vengeful-high': TX('status.vengeful-high'), 'vengeful-low': TX('status.vengeful-low'),
    possessed: TX('status.possessed'), debuffed: TX('status.debuffed'), burn: TX('status.burn'), sear: TX('status.sear') /* 2026-11-19 文字修: 烈焰护符 stacks = 焚痕 */, bless: TX('status.bless'), ward: TX('status.ward'),
    escort: TX('status.escort'), doubleCut: TX('status.doubleCut'), twinShot: TX('status.twinShot'), ambush: TX('status.ambush'), sunder: TX('status.sunder'), 'foe-lv2': TX('status.foe-lv2'), 'foe-lv3': TX('status.foe-lv3'), 'foe-lv4': TX('status.foe-lv4'),
  }));
  const STATUS_TIPS = lazy(() => ({ weak: TX('status.tip.weak'), tough: TX('status.tip.tough'), shell: TX('status.tip.shell'), escort: TX('status.tip.escort'), doubleCut: TX('status.tip.doubleCut'), twinShot: TX('status.tip.twinShot'), ambush: TX('status.tip.ambush'), sunder: TX('status.tip.sunder'),
    'foe-lv2': TX('status.tip.foe-lv2'), 'foe-lv3': TX('status.tip.foe-lv3'), 'foe-lv4': TX('status.tip.foe-lv4'), ward: TX('status.tip.ward', { n: WARD_HP }) })); // fallback tips
  const FOE_TRAIT_CHIPS = ['ambush', 'escort', 'doubleCut', 'twinShot', 'sunder']; // 2026-11-18 cleanup: + 破甲 (sunder)
  // 用户 2026-11-15: enemy traits shown as chips (硬壳 has its own line)
  const CLOSE = { friend: true, 'ex-partner': true };
  const BOSS_REFS0 = { 'goblin-boss': 1, 'gate-guardian': 1, 'bandit-chief': 1 };
  const SUNDER_ON = true; // 2026-11-18 growth-flow: enemy trait sunder (破甲) on/off
  const BAG_MAX = 5; // 2026-11-18 growth-flow (用户定「道具：背包上限 5，以后可能减」): was 3
  // §2.5 built-in item definitions; data/items.json (array) overrides / extends them.
  const ITEM_DEFAULTS = lazy(() => ([
    { id: 'potion', name: TX('item.potion.name'), text: TX('item.potion.text'), needsTarget: true, effect: { type: 'healFull' } },
    { id: 'smoke', name: TX('item.smoke.name'), text: TX('item.smoke.text'), needsTarget: false, effect: { type: 'smoke' } },
    { id: 'drum', name: TX('item.drum.name'), text: TX('item.drum.text'), needsTarget: false, effect: { type: 'drum' } },
    { id: 'holywater', name: TX('item.holywater.name'), text: TX('item.holywater.text'), needsTarget: true, effect: { type: 'cleanse' } },
    // 2026-11-22 new items: 大回血药 / 护甲药 / 复活药
    { id: 'potion-big', name: TX('item.potion-big.name'), text: TX('item.potion-big.text'), needsTarget: true, effect: { type: 'healFull', n: 25 } },
    { id: 'armor-potion', name: TX('item.armor-potion.name'), text: TX('item.armor-potion.text'), needsTarget: true, effect: { type: 'armor', n: 12 } },
    { id: 'revive', name: TX('item.revive.name'), text: TX('item.revive.text'), needsTarget: true, targetFallen: true, effect: { type: 'revive' } },
    // 2026-11-22 second batch: 虚弱粉 / 易伤药水 / 燃烧瓶
    { id: 'weak-powder', name: TX('item.weak-powder.name'), text: TX('item.weak-powder.text'), needsTarget: false, effect: { type: 'weakAll', n: 2 } },
    { id: 'vuln-potion', name: TX('item.vuln-potion.name'), text: TX('item.vuln-potion.text'), needsTarget: true, targetEnemy: true, effect: { type: 'vuln' } },
    { id: 'fire-bottle', name: TX('item.fire-bottle.name'), text: TX('item.fire-bottle.text'), needsTarget: false, effect: { type: 'fire', n: 5 } },
  ]));

  // ---------- v2.2 constants ----------
  const FAIRY_NAME = lazy(() => (TX('names.fairy')));
  const KEYS0 = () => ({ self: false, rules: false, bell: false, refuse: false }); // 2026-11-13: the true route needs rules + bell + refuse (self is only recorded)
  const BELL_LEVELS = [6, 7, 9]; // §4.3 act-3 campfires (the prep before these levels)
  const WOUND_PCT = 0.7;
  const SELF_HP_PCT = 0.5, SELF_HP_MIN = 3, SELF_MOOD = -2; // v2.3 §A[21]: the whole party pays
  // ---------- v2.3 constants ----------
  const REST_HP = 5;
  // ---------- v2.5 difficulty tiers: 木头 (0) → 星辰 (9). Clearing a tier unlocks the next. ----------
  // hp: enemy max-hp multiplier · atk: enemy attack delta (min 1) · rest: campfire rest heal. null difficulty = the v2.4 numbers.
  // rejectedHp / rejectedAtk (optional): the rejected girls who come back as enemies (vengeful) use these instead of hp / atk
  // DESIGN-skill-level: tiers 1–9 enemy hp ×1.1 (rounded) to pay for 技能等级 + 个人特点; 木头 unchanged
  // 2026-11-22d 用户「木头级可以高一些，后面的级别越来越难凑（金钱 / 难度）」: chargeOdds = a 充能信物's chance to join a loot draw;
  // chargeShop = shop tiers added to them (5 = 星辰… from 档 5, cap tier 5). Read only when CHARGE_ODDS_BY_DIFF. 用户「到 50% 就可以了」: floor 0.5 (was down to 0.2)
  const DIFFICULTIES = lazy(() => ([
    { id: 0, name: TX('difficulty.name.0'), chargeOdds: 0.7, chargeShop: 0, hp: 0.6, atk: 0, nightHeal: 0 /* 2026-11-16 营火: every night +3 hp, 木头 only; 2026-11-19 user: off (was 3) */, /* 方案 B 开场护甲 2026-11-15: L11 2.55 → 2.2 (win rate back to before) */ rest: 7 /* 2026-11-19 调难度: 5 → 7 (rest_old_2026_11_19: 5) — a rest night is worth more than a 养伤 card, so a sensible player can rest 3 nights and still win */, rest_old_2026_11_19: 5, oneSacrifice: true, finalBossOnly: true, bellWound: false, diceTakes: 1, rejectedHp: 1.0, rejectedAtk: 2 /* 用户 2026-11-15 晚: 3 → 2 (L6 落选者法师一轮打全体) */, enemyCharge: 2, levelHp: { 4: 1.0, 5: 1.1, 6: 1.2, 7: 1.3, 8: 1.0, 9: 1.2, 10: 1.2, 11: 2.2 }, levelAtk: { 8: 1, 11: 1 } }, // 2026-11-15 木头放松: L8 levelHp 1.2 → 1.0 (有点用心 通关 ~20% → ~22%) · 用户 2026-11-15 第 4–7 关难度曲线: L4–L7 levelHp 1.0/1.1/1.2/1.3, L7 威力 −1 removed (was 4 .9 / 5 1.08 / 6 1.08 / 7 .96, atk 7:−1) · 试玩反馈 2026-11-15: levelHp L5–L10 ×1.2, L11 (小铃的玩偶) 1.7 → 2.55 = ×1.5 (用户 2026-11-15: 玩偶太弱，至少 ×1.5) (was 4 .9 / 5 .9 / 6 .9 / 7 .8 / 8–10 1 / 11 1.7) · // FEEDBACK-1112 #30: rejected girls 0.6 → 0.8 hp (sim 81% → ~77%) · SPEC-2026-11-13 E3: one girl per level L4–L7 → 1.0 hp, atk +3 (sim 83% → ~74%)
    { id: 1, name: TX('difficulty.name.1'), chargeOdds: 0.6, chargeShop: 0, hp: 0.66, atk: -1, rest: 5, diceTakes: 1, oneSacrifice: true, enemyCharge: 2 },
    { id: 2, name: TX('difficulty.name.2'), chargeOdds: 0.5, chargeShop: 0, hp: 0.83, atk: -1, rest: 5, diceTakes: 1, oneSacrifice: true, enemyCharge: 2 },
    { id: 3, name: TX('difficulty.name.3'), chargeOdds: 0.5, chargeShop: 0, hp: 0.88, atk: -1, rest: 5, diceTakes: 1, oneSacrifice: true, enemyCharge: 2 },
    { id: 4, name: TX('difficulty.name.4'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.4, chargeShop: 0, hp: 0.99, atk: -1, rest: 5, diceTakes: 1, oneSacrifice: true, enemyCharge: 2 },
    { id: 5, name: TX('difficulty.name.5'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.4, chargeShop: 1, hp: 0.77, atk: 0, rest: 5, diceTakes: 2, enemyCharge: 2, levelAtk: { 9: -1 }, levelHp: { 9: 0.75 } }, /* 2026-11-15 L9 伏击: 6 foes act twice in round 1 */
    { id: 6, name: TX('difficulty.name.6'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.3, chargeShop: 1, hp: 0.88, atk: 0, rest: 5, diceTakes: 2, enemyCharge: 2, levelAtk: { 9: -1 }, levelHp: { 9: 0.75 } }, /* 2026-11-15 L9 伏击: 6 foes act twice in round 1 */
    { id: 7, name: TX('difficulty.name.7'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.3, chargeShop: 1, hp: 0.99, atk: 0, rest: 5, diceTakes: 2, enemyCharge: 2, levelAtk: { 9: -1 }, levelHp: { 9: 0.75 } }, /* 2026-11-15 L9 伏击: 6 foes act twice in round 1 */
    { id: 8, name: TX('difficulty.name.8'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.2, chargeShop: 1, hp: 1.1, atk: 0, rest: 5, diceTakes: 2, enemyCharge: 2, levelAtk: { 9: -1 }, levelHp: { 9: 0.75 } }, /* 2026-11-15 L9 伏击: 6 foes act twice in round 1 */
    { id: 9, name: TX('difficulty.name.9'), chargeOdds: 0.5, chargeOdds_old_2026_11_22d: 0.2, chargeShop: 1, hp: 1.27, atk: 0, rest: 5, diceTakes: 2, enemyCharge: 2, levelAtk: { 9: -1 }, levelHp: { 9: 0.75 } }, /* 2026-11-15 L9 伏击: 6 foes act twice in round 1 */
  ]));
  // 2026-11-24 用户「仿照杀戮尖塔，每个级别只加一点点难度」(DIFF_LADDER): 青铜…星辰 are 木头 + the ASCENSION rows 1..id (one rule each,
  // stacked). The old per-tier numbers (hp ×0.66…×1.27, atk −1, rest 5, two sacrifices, dice ×2 …) stay in DIFFICULTIES_OLD (false = them)
  const DIFF_LADDER = true;
  const DIFFICULTIES_OLD = DIFFICULTIES;
  const DIFF_LADDERED = lazy(() => { const t = DIFFICULTIES_OLD(); return t.map((d, i) => (i === 0 ? d : Object.assign({}, t[0], { id: d.id, name: d.name }))); });
  const DIFF_BLURB = lazy(() => ([TX('difficulty.blurb.0'), TX('difficulty.blurb.1'), TX('difficulty.blurb.2'), TX('difficulty.blurb.3'), TX('difficulty.blurb.4'),
    TX('difficulty.blurb.5'), TX('difficulty.blurb.6'), TX('difficulty.blurb.7'), TX('difficulty.blurb.8'), TX('difficulty.blurb.9')]));
  // tier rules that reshape the scenario (read through levelCfg, which sees the current run's tier):
  //  oneSacrifice — L8's second sacrifice becomes a plain reward (第六批 H1-7: tiers 0–4; the second sacrifice only from 秘银 up) · finalBossOnly — 木头: the advisor boss +FINAL_BOSS_HP and no finalReveal (2026-11-14: L10 is the single advisor-boss wave on every tier now)
  let CUR_DIFF = null;
  const FINAL_BOSS_HP = 10; // feedback-1112 #36 (木头 only, before the tier hp multiplier)
  const ENEMY_HP_MUL = 1.1; // 2026-11-13: all enemies (monsters, rejected girls, returned, bosses) max hp ×1.1 rounded up, applied last in buildWaves
  const TWIN_SHOT_CUT = 2; // feedback-1112 #34: the 连弩 second bolt deals 2 less (min 1)
  const TIER_CFG = new Map();
  function tierCfg(c) {
    const d = CUR_DIFF != null ? (DIFF_LADDER ? DIFF_LADDERED() : DIFFICULTIES())[CUR_DIFF] : null; // 2026-11-25 用户「改」: 阶梯下 1–9 照木头（之前读旧表 → 秘银起多一次第 8 关献祭、青铜起没有 finalBossOnly）
    if (!c || !d || !(d.oneSacrifice || d.finalBossOnly)) return c;
    const key = c.level + ':' + d.id;
    if (TIER_CFG.has(key) && TIER_CFG.get(key).src === c) return TIER_CFG.get(key).cfg;
    let o = c;
    if (d.oneSacrifice && c.post === 'secondSacrifice') o = Object.assign({}, o, { post: 'reward' });
    if (d.finalBossOnly && c.post === 'finale' && c.waves.some((w) => w.some((e) => e.advisorBoss))) {
      // feedback-1112 #36: with no first wave to wear the party down, the lone advisor wave gets FINAL_BOSS_HP extra hp
      const boost = (e) => (e.advisorBoss ? Object.assign({}, e, { buff: { hp: ((e.buff && e.buff.hp) || 0) + FINAL_BOSS_HP, atk: (e.buff && e.buff.atk) || 0 } }) : e);
      o = Object.assign({}, o, { waves: c.waves.filter((w) => w.some((e) => e.advisorBoss)).map((w) => w.map(boost)), preStory: null });
    }
    TIER_CFG.set(key, { src: c, cfg: o });
    return o;
  }
  // diceTakes — how many the dice take (untiered default 2; 第六批 H1-7: tiers 0–4 take 1, only tier 5 秘银 and up take 2) · bellWound: false — following the bell costs only that night (no wounded start)
  // (2026-11-13: the true route needs the same three keys on every tier — refuse the rules at L3, let the dice choose, follow the bell)
  // 2026-11-22f 用户「下一战全员生命最多七成，不要这个，删掉」(BELL_NO_WOUND): following the bell never wounds, on every tier (the 木头 way). false = tiers 1–9 start wounded
  const BELL_NO_WOUND = true;
  const tierRule = (run, k) => { if (BELL_NO_WOUND && k === 'bellWound') return false; const d = diffOf(run); return d ? d[k] : undefined; };
  const diceN = (run) => tierRule(run, 'diceTakes') || 2;
  const NUM_CN = lazy(() => ([TX('num.0'), TX('num.1'), TX('num.2'), TX('num.3'), TX('num.4')]));
  const diffOf = (run) => (run && run.difficulty != null ? (DIFF_LADDER ? DIFF_LADDERED() : DIFFICULTIES())[run.difficulty] || null : null);
  const restHp = (run) => { const d = diffOf(run); return d ? d.rest : REST_HP; };
  const DIFF_TEXT = lazy(() => ({
    ask: [{ speaker: 'fairy', text: TX('difficulty.ask1') }, { speaker: 'fairy', text: TX('difficulty.ask2') }],
    locked: { speaker: 'fairy', expr: 'special', text: TX('difficulty.locked') },
    picked: [{ speaker: 'fairy', text: TX('difficulty.picked') }, { speaker: 'fairy', expr: 'happy', text: TX('difficulty.pickedNext') }], // 第六批 H1-2: before the advisor pick the fairy talks only about the tier
  }));
  // rank 「青铜 4」: the highest unlocked tier and where the last run on it ended (0 = not tried yet)
  function rankOf(meta) {
    const m = normMeta(meta);
    const t = m.unlocked, d = DIFFICULTIES()[t];
    const cleared = !!m.tierCleared[t];
    const level = cleared ? 0 : m.tierLast[t] || 0;
    return { tier: t, name: d.name, level, cleared, text: cleared ? TX('difficulty.rankCleared', { name: d.name }) : TX('difficulty.rankLevel', { name: d.name, level }) };
  }
  let OPEN_TIERS = 10; // 2026-11-24 用户「打完木头级，后面没有解锁」: the ladder (DIFF_LADDER) is in — every tier opens by clearing the one before (was 1)
  let OPEN_TIERS_old_2026_11_24 = 1; // eslint-disable-line no-unused-vars // 2026-11-14 playtest: only 木头 is open (the other tiers need a re-tune — BACKLOG); raise to open more (tests: E.setOpenTiers)
  function difficultyView(data, run) {
    const m = run.meta, fz = dig(linesV2(data), 'fairy', 'difficulty') || {};
    const get = (k) => (fz[k] != null ? fz[k] : DIFF_TEXT()[k]);
    return {
      tiers: DIFFICULTIES().map((d) => ({ id: d.id, name: d.name, locked: d.id > m.unlocked || d.id >= OPEN_TIERS, cleared: !!m.tierCleared[d.id], trueEnd: !!m.tierTrue[d.id], last: m.tierLast[d.id] || 0,
        text: DIFF_BLURB()[d.id] || '' })),
      unlocked: m.unlocked, rank: rankOf(m),
      ask: asList(get('ask')).map((r) => (typeof r === 'string' ? { speaker: 'fairy', text: r } : r)),
      locked: m.unlocked >= OPEN_TIERS ? [{ speaker: 'fairy', expr: 'special', text: TX('difficulty.lockedPlaytest') }]
        : asList(get('locked')).map((r) => (typeof r === 'string' ? { speaker: 'fairy', expr: 'special', text: r } : r)),
      picked: asList(get('picked')).map((r) => (typeof r === 'string' ? { speaker: 'fairy', text: r } : r)),
    };
  }
  // ---------- v2.4 constants ----------
  const MIN_DAMAGE = 1;
  // DESIGN-2026-11-14-block (用户拍板 第二轮): 护甲 sits on top of hp for one round — cleared when its owner's side starts its phase
  //  (unless kept), cleared between waves, 0 at the start of every battle. 虚弱 = the afflicted's 威力 −1 · 坚韧 = −1 per hit taken.
  const FLAWLESS_MOOD_CAP = 1, STEW_CARD = 'guild-stew';
  // 2026-11-22 用户「烟雾弹有点太强了，改成指定一个敌人下回合发呆」: true = pick one living enemy, she 发呆 (skips) the coming round
  // (bosses too — it is one round). false = the old smoke: every enemy hit misses SMOKE_MISS this round. run.tune.smokeDaze overrides.
  const SMOKE_DAZE = true;
  const smokeDaze = (run) => !!tuneOf(run, 'smokeDaze', SMOKE_DAZE);
  // 2026-11-22 batch 2: 虚弱粉 every enemy 威力 −WEAK_POWDER this round · 易伤药水 her damage ×VULN_X (rounded down, before 护甲) this round ·
  // 燃烧瓶 FIRE_BOTTLE to every living enemy at the start of the coming round (护甲 first) · 开场护盾 keepsake: 护甲 +OPEN_SHIELD in round 1
  const WEAK_POWDER = 2, VULN_X = 1.5, FIRE_BOTTLE = 5, OPEN_SHIELD = 8;
  // 2026-11-22 遗物 (guild relics): team-wide, held by the guild, not by a girl — run.guildRelics = [shop item id…] (slot guildRelic,
  // effect { type: 'guildRelic' }), the whole run (a sacrifice / a fall never takes one). One offer per shop, never one already owned.
  // Battles copy the list to B.guildRelics. Hooks: war-banner 充能 +RELIC_BANNER (battle start) · guild-crest 护甲 +RELIC_CREST
  // (round 1, the opening-armor path) · dice-cup 幸运 +RELIC_LUCK · war-horn 威力 +RELIC_HORN from round RELIC_HORN_FROM of each wave ·
  // hunter-mark +RELIC_MARK per hit on an enemy a hunter has locked (aimLock) · supply-cart 生命 +RELIC_CART after every win.
  // RELICS_ON false = not on the shelf and no effect (old saves untouched).
  const RELICS_ON = true;
  const RELIC_BANNER = 3, RELIC_CREST = 4, RELIC_LUCK = 1, RELIC_HORN = 1, RELIC_HORN_FROM = 3, RELIC_MARK = 2, RELIC_CART = 5;
  const guildHas = (run, id) => RELICS_ON && !!run && Array.isArray(run.guildRelics) && run.guildRelics.includes(id);
  const bRelic = (B, id) => RELICS_ON && !!B && Array.isArray(B.guildRelics) && B.guildRelics.includes(id);
  const hornOn = (B, u, r) => u.side === 'ally' && bRelic(B, 'war-horn') && (r || 1) - (B.waveStart || 1) + 1 >= RELIC_HORN_FROM;
  const ARMOR_POTION = 12, REVIVE_PCT = 0.3; // 2026-11-22 护甲药 护甲 +12 (normal 护甲 rules) · 复活药 stands up with 30% max hp (at least 1)
  const SMOKE_MISS = 0.4, CLAUSE_DAZE_N = 2; // 试玩反馈 2026-11-14 晚 #4 烟雾弹: each enemy hit misses 40% · #22 附加条款: two random enemies 发呆 this round
  const ESCORT_BLOCK = 2, DOUBLE_CUT_HITS = 2, ENEMY_CRIT_RATE = [0, 0.3, 0.6, 0.9]; // 用户 2026-11-15 第 4–7 关: 护队 / 连斩 / enemy archers' crit by Lv (Lv1 never)
  const VETERAN_BLOCK = 1, ENEMY_GUARD_BLOCK = 3, FORMATION_BLOCK = 2, BOSS_FORMATION_BLOCK = 3, SHELL_BLOCK = 6, REST_BLOCK = 1;
  // DESIGN-2026-11-15-initiative 方案 B (用户拍板, corrected 2026-11-15): 开场护甲 — only shield / elite types (and the returning girls) enter
  // their wave with block = max(OPEN_BLOCK_MIN, round(maxHp × share × OPEN_BLOCK_LEVEL[level])); small fodder (slime / goblin / plain
  // skeleton / blade / archer / priest) gets none, and L1–L3 none at all. An enemies.json entry may set its own share (openBlock).
  // It sits on top of hp for our round 1 and goes when the enemy phase starts (the usual block clear). Tiered runs only.
  const OPEN_BLOCK_SHARE = { fodder: 0, guard: 0.4, girl: 0.25, elite: 0.4 }, OPEN_BLOCK_MIN = 2;
  const OPEN_BLOCK_LEVEL = { 4: 0.5, 5: 0.5, 6: 0.75, 7: 0.75, 8: 1, 9: 1.5, 10: 0, 11: 1 }; // 2026-11-16 第 10 关: no 开场护甲 (was 10: 1.5 — 奥德丽 0.6 × hp)
  const openBlockKind = (u) => (isElite(u) ? 'elite' : u.candidate ? 'girl' : u.skill && u.skill.kind === 'guard' ? 'guard' : 'fodder');
  const POTION_HEAL = 10; // 回血药: 生命 +10, never above max
  // DESIGN-2026-11-15-charge §1 充能 (replaces the 加成 dice): every normal action gives her neighbour(s) k pips; 10 pips = one
  // extra action (her own skill, 威力 +1). Extra actions pass charge on too, ×CHARGE_KEEP per generation. k = combo.charge, else
  // 用户 2026-11-15 晚 白板: k = combo.charge (pips per neighbour); without it one way 4, both ways 2 each (CHARGE_BASE). combo.chance is no longer read.
  const fullOf = (u) => (u && u.fullAt > 0 ? u.fullAt : CHARGE_FULL) - (u && u.side === 'ally' && hasTok(u, 'shortString') ? SHORT_STRING : 0) - (BOND_FULL && u && u.side === 'ally' && u.bond === 'high' && !(u.turned && !u.wokeMember) ? 1 : 0); // 2026-11-22 BOND_FULL: 信赖 = full one sooner // 2026-11-21 短弦扣: full one sooner // 2026-11-18 小铃的祝福「充能 −1」: allies full at 9
  const CHARGE_FULL = 10, CHARGE_KEEP = 0.5, CHARGE_KEEP_CORD = 0.75, EXTRA_CAP = 6, OPEN_CHARGE = 0;
  const CHARGE_BASE = { one: 4, both: 2 };
  const DRUM_ADD = 2; // 战鼓: the moment it is used, every living ally +2 pips
  // 2026-11-20 review #7: a bag item's number lives in data/items.json effect.n (回血药 healFull n 10, 战鼓 drum n 2); POTION_HEAL /
  // DRUM_ADD are only the fallback when the data has none. false = always the constants (the old way). 烟雾弹 stays SMOKE_MISS (it is a
  // battle mod with no item at hit time).
  const ITEM_NUM_FROM_DATA = true;
  const itemNum = (it, dflt) => (ITEM_NUM_FROM_DATA && it && it.effect && Number.isFinite(it.effect.n) ? it.effect.n : dflt);
  const LUCK_ADD = 1; // nicota 好运 (old, NICOTA_LUCK_UP false) · lucienne 加班条款 (LUCIENNE_OVERTIME): the moment it is used, every living ally +1 pip
  // 2026-11-20 三个顾问 = 三种机制 + 幸运属性 (docs/BACKLOG.md):
  //  LUCK_STAT: every unit has 幸运 0..LUCK_MAX (allies: candidates.json luck, + keepsakes 幸运币 / 四叶草; enemies: their data's luck, default 0).
  //   Before each ACTION she rolls a d6 (hashRand, never the run rng); roll <= 幸运 → 「好运一击」: every damage hit of that action ×LUCK_X.
  //   Its own roll, apart from the crit — they stack (crit ×2 · luck ×2 → ×4). Heals / 护甲 are not doubled (damage hits only).
  //  LUCIENNE_OVERTIME: 露西安「加班条款」 = the old 好运 (every ally 充能 +LUCK_ADD on use); false = her old 附加条款 (combat_old_2026_11_20)
  //  NICOTA_LUCK_UP: 妮可塔「好运当头」 = the round it plays, every ally 幸运 +LUCK_UP_ADD; false (or LUCK_STAT false) = her old 好运 (充能 +1)
  //  The L10 advisor bosses: BOSS_NEW_SKILLS below (false = they keep their old skills, bossCombatOf).
  const EARLY_DEFEAT_SIMPLE = true; // 2026-11-20 用户: a wipe on L1–3 ends quietly (story earlyDefeat, no per-member epilogue / gallery); false = old
  const EARLY_DEFEAT_MAX_LEVEL = 3;
  // 2026-11-20 review #5: per-level special cases live in scenario.levels[] (bellNight / openBlockMul / earlyDefeat / leaderDownMood).
  // The constants BELL_LEVELS / OPEN_BLOCK_LEVEL / EARLY_DEFEAT_MAX_LEVEL / LEADER_DOWN_MOOD_LEVELS stay as the fallback: used when no
  // level in the scenario has that field (old saves' data, test fixtures). LEVEL_FIELDS false = always the constants (the old way).
  const LEVEL_FIELDS = true;
  const scenLevels = (data) => (data && data.scenario && Array.isArray(data.scenario.levels) ? data.scenario.levels : []);
  const levelsWith = (data, field, dflt) => { const ls = scenLevels(data); return LEVEL_FIELDS && ls.some((l) => l && l[field] !== undefined) ? ls.filter((l) => l && l[field] === true).map((l) => l.level) : dflt; };
  const levelNum = (data, lv, field, dflt) => { const ls = scenLevels(data); if (!LEVEL_FIELDS || !ls.some((l) => l && l[field] !== undefined)) return dflt; const l = ls.find((x) => x && x.level === lv); return l && Number.isFinite(l[field]) ? l[field] : 0; };
  const earlyDefeatAt = (data, lv) => levelsWith(data, 'earlyDefeat', null) ? levelsWith(data, 'earlyDefeat', []).includes(lv) : lv <= EARLY_DEFEAT_MAX_LEVEL;
  const ONEPAGE_SKIP_FOE_INTRO = false; // 2026-11-20: was true (keyed on the one-page recruit) — 用户「快速招募不代表快速模式」; the fast mode is UI-only, the UI skips her segment
  const PAUSE_REPLAY_MARK = true; // 2026-11-20: queued pause actions re-enter the round log marked replay (UI already showed them); false = old
  const LUCK_STAT = true, LUCK_MAX = 6, LUCK_X = 2, LUCK_UP_ADD = 2;
  // 2026-11-22 用户「引入厄运机制：幸运是负数的话，有概率攻击 /2」(DOOM_ON): 幸运 may go below 0 (down to −LUCK_MAX). Each action rolls the
  // same d6; roll <= −幸运 → 「倒霉一击」: this action's damage hits ×DOOM_X (halved, rounded down). false = the old floor at 0.
  const DOOM_ON = true, DOOM_X = 0.5, LUCK_MIN = DOOM_ON ? -LUCK_MAX : 0;
  // 2026-11-22f 用户「幸运 −6 可以继续减，效果是 −6，但要各种加幸运才能加回来」(LUCK_BELOW_MIN): the stored 幸运 has no floor;
  // combat still reads it clamped to LUCK_MIN. false = stored 幸运 stops at LUCK_MIN (and LUCK_FLOOR_BLOCK greys those at the floor)
  const LUCK_BELOW_MIN = true;
  const LUCK_STORE_MIN = LUCK_BELOW_MIN ? -99 : null;
  // 2026-11-20d 用户「所有的道具——禁止出现一个完全比另一个好的情况」(docs/AUDIT-2026-11-20-dominance.md):
  // CARD_SIDE_MOOD: a stat reward card may carry effect.mood (her mood moves too — 铁皮口粮 生命上限 +4 but 心情 −1);
  // LOOT_RETIRED: the loot pool skips cards marked retired: true (the shop already does)
  const CARD_SIDE_MOOD = true, LOOT_RETIRED = true;
  // 2026-11-22 用户「充能 + 输出还要能凑出来，但难度和概率小一些，前期代价高一些」(CHARGE_COST): a keepsake whose effect has hpCost
  // takes that much 生命上限 from the one who wears it (loot or shop). Odds (offerChance 0.5) + shop tier +1 are in the data. false = no cost
  const ADVISOR_SACRIFICE_HINT = false; // 2026-11-22h 用户「献祭时顾问不要推荐了」(推荐了输出最高的人，理由看不懂); true = she names the top girl
  const CHARGE_COST = false; // 2026-11-22e 用户「生命上限 −2 不必，出现概率有限就好」(was true)
  const CHARGE_ODDS_BY_DIFF = true; // 2026-11-22d: odds + shop price by difficulty (DIFFICULTIES chargeOdds / chargeShop); false = the card's offerChance, shop tier as data
  const offerChanceOf = (run, c) => (CHARGE_ODDS_BY_DIFF && c.charge && diffOf(run) && diffOf(run).chargeOdds != null ? diffOf(run).chargeOdds : c.offerChance);
  const hpCostEff = (eff) => (CHARGE_COST && eff && eff.hpCost > 0 ? { type: 'stat', stat: 'maxHp', delta: -eff.hpCost } : null);
  const LUCIENNE_OVERTIME = true, NICOTA_LUCK_UP = true;
  // 2026-11-21 用户「幸运 +2 太 bug 了…第一幕三人主动技都 +1，第二幕（献祭之后 6–10 关）变强 ×2」: the three advisor skills give
  // ADV_SKILL_N[0] before level ADV_SKILL_LV2, ADV_SKILL_N[1] from it on — 列阵 护甲 · 加班条款 充能 · 好运当头 幸运.
  // false = old: 护甲 +FORMATION_BLOCK (2) · 充能 +LUCK_ADD (1) · 幸运 +LUCK_UP_ADD (2) all game
  const ADV_SKILL_SCALE = true, ADV_SKILL_LV2 = 6, ADV_SKILL_N = [1, 2];
  const RETURNED_RING = true; // 2026-11-24: a returned girl wearing 转向指环 keeps its effect on her combo
  const ADVISOR_FOE_INTRO = true, ADV_INTRO_MAX = 3; // 2026-11-24: the advisor introduces each enemy kind the first time it shows up (lines-v2 foeIntro)
  const EXIT_HEAL_HP = 15; // 2026-11-23 试玩 15–21 每轮都说「第 9→10 关之间没休息、残血进最终战」: the patch-up before the exit heals a fixed 15 (0 = the camp rest's number, as before)
  const QUIET_WAVE_THORNS_RULE = true; // 2026-11-23: L11's quiet last wave still says 小铃's 反震 rule
  const FORTUNE_NOTE = true; // 2026-11-23: the loot screen says 妮可塔 turned one more card
  const ADV_GROWN_LINE = true; // 2026-11-23: one battle-log line the first fight her skill number grows (false = silent, as before)
  const ADV_SKILL_GROWN_NOTE = false; // 2026-11-22: off — 用户 2026-11-21「不需要说献祭后」 // 2026-11-22 试玩「加班条款一处 +1 一处 +2」: from act 2 the text adds 「（第二幕起变强）」 (false = no note)
  const ADV_SKILL_GROWS_NOTE = false; // 2026-11-21 用户「不需要说献祭后」 (true = the text adds 「（献祭之后变成 +n）」)
  const ADV_SKILL_N_KIND = { formation: [2, 5] }; // 2026-11-21 用户「奥德丽太弱了，护甲 +2 / +5 第一第二幕」
  const advSkillPair = (kind) => ADV_SKILL_N_KIND[kind] || ADV_SKILL_N;
  const advSkillN = (run, kind) => ((run && run.level) >= ADV_SKILL_LV2 ? advSkillPair(kind)[1] : advSkillPair(kind)[0]);
  const ADV_SKILL_OLD = { formation: () => FORMATION_BLOCK, overtime: () => LUCK_ADD, luck: () => LUCK_ADD, luckUp: () => LUCK_UP_ADD };
  const advSkillAmt = (run, kind) => (ADV_SKILL_SCALE && ADV_SKILL_OLD[kind] ? advSkillN(run, kind) : ADV_SKILL_OLD[kind] ? ADV_SKILL_OLD[kind]() : 0);
  function combatView(a, run) { // the skill as the player reads it: its number for this level (+ what it grows to)
    const cb = combatOf(a); if (!cb) return null;
    const c = clone(cb);
    if (ADV_SKILL_SCALE && ['formation', 'overtime', 'luckUp'].includes(cb.kind)) {
      const n = advSkillN(run, cb.kind), n2 = advSkillPair(cb.kind)[1];
      const T0 = { formation: () => TX('advisor.combat.formation', { n }), overtime: () => TX('advisor.combat.overtime', { n }), luckUp: () => TX('advisor.combat.luckUp', { n }) };
      c.text = T0[cb.kind]() + (ADV_SKILL_GROWS_NOTE && n < n2 ? TX('advisor.combat.grows', { n: n2 }) : '')
        + (ADV_SKILL_GROWN_NOTE && n === n2 && advSkillPair(cb.kind)[0] < n2 ? TX('advisor.combat.grown') : ''); // 2026-11-22 试玩: the number jumped — say why
      c.n = n;
    }
    return c;
  }
  // 2026-11-20 BOSS_NEW_SKILLS: the L10 advisor boss casts her NEW skill on us (bossCombatOf → combatOf) —
  //  露西安「加班条款」 (kind overtime) = the old boss 好运 rule: while she stands every enemy +STORE_BOSS on each charge, enemy girls +1 more
  //  (her 附加条款 save / most-charged void no longer play) · 妮可塔「好运当头」 (kind luckUp) = wave rounds CLAUSE_BOSS_FROM, +EVERY …
  //  every living enemy 幸运 +LUCK_UP_ADD for that round (B.luckUpEnemyRound); her 坐庄 pip bonus stops, the bigEvery jackpot stays.
  //  false = the old skills (combat_old_2026_11_20), exactly as before.
  const BOSS_NEW_SKILLS = true;
  const LUCK_SKIP_JACKPOT = true; // 2026-11-20 妮可塔 boss: no 幸运 +2 on her bigEvery 梭哈 round
  // 2026-11-22 用户「羁绊改成充能上限减一」(BOND_FULL): bond high = her charge is full at 9 (fullOf), no longer +1 per charge taken. false = the old 蓄能 +1
  const BOND_FULL = true;
  const STORE_BOND = BOND_FULL ? 0 : 1; // 蓄能: bond high — each time she takes charge (> 0) she gets 1 more
  const CORD_STORE = 1; // 2026-11-20 信物 母亲的发绳 (FEEDBACK-2026-11-20 #11): each time she receives charge she gets 1 more (stacks with 蓄能). 0 = the old cord (her extra actions pass on 3/4, CHARGE_KEEP_CORD)
  const STORE_BOSS = 1; // 蓄能: L10 妮可塔「坐庄」 — while she stands every enemy gets 1 more · her passive 好运 (enemyCombat 'luck'): enemy girls 1 more
  // 用户 2026-11-15 敌方也充能 (replaces the 敌方加成 dice): an ordinary enemy gives both neighbours ENEMY_CHARGE per action, the fairy
  // (小铃) gives every other living enemy FAIRY_CHARGE. A level / tier may override (enemyCharge / fairyCharge); untiered runs (old
  // tests, null difficulty) = off. Their side plays at most ENEMY_EXTRA_MAX extra actions per round in all.
  const ENEMY_CHARGE = 2, FAIRY_CHARGE = 1, ENEMY_EXTRA_MAX = 3;
  const SUMMON_CAP = 8; // 2026-11-16 露西安 L10 召唤: at most this many living enemies on her side (her included)
  // 2026-11-17 露西安 L10 召唤战 (用户): with boss.summon.every set — her minions only (not her) count against minions / minionsHard;
  // ward: while any minion of hers stands, each hit on her takes at most WARD_HP hp; devour: a full roll call eats DEVOUR_SHARE of them
  const WARD_HP = 1, DEVOUR_SHARE = 0.5, DEVOUR_DMG = 2;
  // 2026-11-18 试玩反馈 露西安战 #1: the boss's 附加条款. Old rule (flag true): every round our FIRST action is void (slot 1, the
  // guard, never acted). New rule: never in round 1; from round CLAUSE_BOSS_FROM every CLAUSE_BOSS_EVERY rounds of the wave it
  // voids the next action of the living ally with the MOST charge at round start (tie → leftmost).
  const CLAUSE_BOSS_EVERY_ROUND = false, CLAUSE_BOSS_FROM = 2, CLAUSE_BOSS_EVERY = 2;
  // 2026-11-18 #7: a new summon takes the slot of a fallen summoned card (grey cards no longer vanish, no position jump).
  // false = old: fallen summons leave the lane (to B.gone), the new ones go in on her left.
  const SUMMON_REPLACE_SLOT = true;
  const PET_WISH = { on: true, advisor: 'lucienne', maxLevel: 3, kinds: ['slime', 'goblin'] }; // 2026-11-18 #6 彩蛋 (see petWish)
  const SUMMON_TEXT_SHORT = true; // 2026-11-18 #5: 「名册翻开——骷髅兵 ×2 应召」 (false = old long line battle.summon)
  const baseK = (cb) => (!cb ? 0 : typeof cb.charge === 'number' ? cb.charge : cb.direction === 'both' ? CHARGE_BASE.both : CHARGE_BASE.one);
  const EXPLORE_N = 2, EXPLORE_N_OUTLANDER = 3;
  const REST_TEA_SPLIT = true; // 2026-11-19 试玩修 数值文字 (see the camp view)
  const TEA_HP = 1; // 第六批 H1-1 (用户已选): 露西安「热茶」 rest +1 hp each · 妮可塔「幸运星」 (flow fortune): reward picks 4 instead of 3
  const BAG_FULL_TIP = lazy(() => (TX('item.bagFull')));
  const ENEMY_BARK_P = { down: 0.5, hurt: 0.3, attack: 0.3 };
  const CAMP_OPTIONS = lazy(() => ({ rest: { id: 'rest', label: TX('camp.rest.label'), text: TX('camp.rest.text') },
    explore: { id: 'explore', label: TX('camp.explore.label'), text: TX('camp.explore.text') },
    train: { id: 'train', label: TX('camp.train.label'), text: TX('camp.train.text') },
    followBell: { id: 'followBell', label: TX('camp.followBell.label'), text: TX('camp.followBell.text') } }));
  const MARCH_L9 = false; // 2026-11-16: false = a campfire night between L9 and L10
  // 2026-11-19 用户亲测 流程: L3 is battle → reward → the gate slam (sealing) and the rules choice. true = the old order
  // (流程修 H3: sealing before the reward, with the bell draw deferred to the next startLevel)
  const SEALING_BEFORE_REWARD = false;
  // 2026-11-20 用户亲测 流程 (FEEDBACK-2026-11-20 #12/#15): 篝火 → 出发 → 路线图 → 到达新地点 → 场景介绍 → 开战. The advisor's
  // pre-fight line (guide.beforeFight, e.g. 「敌方人数已登记」) used to play when the night opened — right after the loot pick, before
  // the move. true: the night only marks it (run.guidePending) and 「出发」 adds it to the scene intro (levelIntro), after arrival.
  // false = the old order (the line in the campfire events). The UI's ui/app.js FLOW_DEPART_ROUTE moves the route map the same way.
  const FLOW_DEPART_ROUTE = true;
  // 2026-11-19 用户亲测 流程: refusing the rules — the option still says the price, but nothing is reported at the choice;
  // the leader's hp drops on the story beat where she is beaten down (the sealRefuse line with fx 'curse' carries
  // hp { id, from, to, text }); the hp is applied when that story is left. false = the old way (hp → 1 and the sealCurse
  // event at the choice)
  const SEAL_HP_AT_BEAT = true;
  // 2026-11-22i 用户「反抗：所有人 −5 血；不反抗没有代价」(SEAL_TEAM_HIT): refuse → every party member 生命 −SEAL_HIT (never below 1),
  // applied when the story is left (same beat as before); accept → no mood loss. false = refuse: leader → 1 hp · accept: 2 random girls 心情 −1
  const SEAL_TEAM_HIT = true, SEAL_HIT = 5;
  const FOE_RULES_AT_START = true; // 2026-11-22j: wave start says each enemy's special rules (toll, bell, 灵体, brood, thorns, trait lines); false = only her panel
  const FOE_RULE_SUMMARY = true; // false = old (each trait's own line)
  function foeRuleTexts(data, B, u, run) {
    const out = [], trim = (t) => String(t || '').replace(/^[。；，\s]+/, '');
    if (u.toll) out.push(trim(u.toll.noBell ? TX('skill.action.chargeSuffix', { every: u.toll.every || 3, n: u.toll.n || 4 }) : TX('skill.action.tollSuffix', { every: u.toll.every || 3, n: u.toll.n || 4 }))); // 2026-11-23 noBell = 奥德丽「全军突击」
    if (u.bell) { const g = (B.enemies || []).find((x) => x.toll); out.push(TX('skill.action.bellIdle', { every: (g && g.toll.every) || 2 })); }
    if (u.dodgeAura && !u.bell) { const pct = Math.round(u.dodgeAura * 100); out.push((B.enemies || []).some((x) => (x.traits || []).includes('enrageOnAmulet')) ? TX('skill.action.amuletIdleEnrage', { pct }) : TX('skill.action.amuletIdle', { pct })); } // 2026-11-23 试玩 16/17「该不该打护符？」: say both sides
    if (u.brood) out.push(trim(u.brood.atkEvery > 1 ? TX('skill.action.broodSuffixEvery', { n: u.brood.n, cost: u.brood.selfCost > 0 && u.brood.selfCost < 1 ? TX('skill.action.broodCostHalf') : TX('skill.action.broodCostFull'), cap: u.brood.cap, hpStep: u.brood.hpStep || 0, atkStep: u.brood.atkStep || 0, every: NUM_CN()[u.brood.atkEvery] || u.brood.atkEvery }) : TX('skill.action.broodSuffix', { n: u.brood.n, cost: u.brood.selfCost > 0 && u.brood.selfCost < 1 ? TX('skill.action.broodCostHalf') : TX('skill.action.broodCostFull'), cap: u.brood.cap, hpStep: u.brood.hpStep || 0, atkStep: u.brood.atkStep || 0 })));
    if (u.thorns > 0) out.push(TX('battle.foeRule.thorns', { n: u.thorns }));
    if (u.advisorBoss && B.summon && B.summon.ward) out.push(TX('status.tip.ward', { n: WARD_HP }));
    if (u.advisorBoss && B.summon && B.summon.calls > 0) out.push(TX('battle.foeRule.summonCalls', { n: B.summon.calls })); // 2026-11-23 SUMMON_CALLS
    if (u.candidate && u.corruption && run && run.members[u.ref] && !run.party.includes(u.ref)) out.push(TX('battle.foeRule.soft'));
    if (u.winOnDown) out.push(u.brood ? TX('battle.foeRule.winBrood') : trim(TX('skill.action.winOnDownSuffix', { name: u.name })));
    const def = (data.enemies || []).find((x) => x.id === u.ref), tt = (def && def.traitText) || {};
    if (FOE_RULE_SUMMARY && def && def.ruleSummary) out.push(def.ruleSummary); // 2026-11-23 试玩14「第 9 关规则太长」: one plain summary instead of every trait
    else for (const k of u.traits || []) if (tt[k]) out.push(tt[k]);
    return out;
  }
  const BROOD_NUMBERED = true; // 2026-11-22j 试玩: the small slimes are 史莱姆 1, 2, 3… (all were 「史莱姆」, hp looked like it jumped); false = one name
  const BELL_NIGHT_REST = false; // 2026-11-22j 用户「改回去」: the bell night costs the rest again (铃铛是给高手的) // 2026-11-22i: following the bell still rests (heal), only no training; false = the night is lost
  // 2026-11-19 用户亲测 流程: enemies stand by class — when a 盾 / 战士 (tank / melee) is in the wave, slot 1 is one of them;
  // named units (returning girls, champions, bosses) never stand ahead of their class floor (archers 2nd+, mages / healers 3rd+).
  // Runs after the charge formation, keepOrder levels included. false = the old placement (a 'next' giver at slot 1, e.g. L5 阿雾)
  const FOE_CLASS_GUARD = true;
  const FOE_FRONT_ROLES = { tank: 1, melee: 1 };
  // 2026-11-19 用户亲测 流程 (L11 last wave): a serious fight — one short line from her as it starts (fairy.mirror.final), then no
  // talk (barks, taunts, her wave / blessing lines, the leader's doll-down lines, the bell's narrator line, flashbacks) and no
  // mercy beats (soft heart 心软, keepsake / memory hesitation). Kept: her doll-ward rule line, her down line.
  // Only in the live mirror fight (mirrorOn); the pre-mirror L11 (no mirrorWaves) keeps its old talk. false = the old talkative last wave.
  const FINAL_WAVE_QUIET = true;
  // 2026-11-20 用户 bug (小铃战): a cleared wave → 'continue' brought the next wave in AND played its first round at once, so the
  // player never got the pause (items / advisor skill / swap / 继续) before wave 2. true: the next wave enters and the battle stops
  // at an opening pause (B.opening, like the battle's first pause); its round 1 plays on the next action. false = the old roll-through.
  const WAVE_OPEN_PAUSE = true;
  // a doll breaking free and turning on her stays (its line is dropped, the switch notice stays): without it the dev-save
  // auto-play wins the mirror fight 0/60 (with it 23/60) — a balance call for the user. true = no turncoat in the last wave
  const FINAL_NO_TURNCOAT = false;
  // 2026-11-20 反水 one line: a girl who turns says exactly ONE short line, picked from the real record (turncoatPick: sided with
  // her at the interview → a gift card / item she got → high bond → neutral), text in lines-v2 turncoatRecord (default + per-girl).
  // It is the one spoken line the quiet last wave keeps. false = the old per-girl turncoat lines (dropped in the quiet wave).
  const TURNCOAT_RECORD_LINE = true;
  const QUIET_KEEP = Object.assign({ 'l11.final': 1, 'l11.mirror.ward': 1, 'l11.wake': 1, 'l11.mirror.bless': 1 /* 2026-11-21 用户「小铃的另外两个祝福也没看她说话或用到」: the quiet last wave keeps her blessing line (and its fx) */, 'fairy.down': 1, traitFired: 1 }, TURNCOAT_RECORD_LINE ? { turncoat: 1 } : {});
  const FOE_NAMED_FLOOR = { tank: 0, melee: 0, rogue: 1, adc: 1, mage: 2, healer: 2 };
  const BELL_HP_CUT = 0.25; // §A[26]: the bell rings in L11, the fairy starts phase 1 at −25%
  const RELIC_FALLBACK = lazy(() => ({ bell: { name: TX('relic.bell.name'), text: TX('relic.bell.text'), ringLine: [TX('relic.bell.ring')] } }));
  const TRAINING_FALLBACK = lazy(() => ({
    normal: [
      // 2026-11-16 经验: every card only decides how much xp + mood (was 威力 / 生命上限 / 技能等级 each)
      { id: 'sharpen', label: TX('training.sharpen.label'), text: TX('training.sharpen.text'), effect: { type: 'xp', n: 3 } },
      { id: 'drill', label: TX('training.drill.label'), text: TX('training.drill.text'), effect: { type: 'xp', n: 3 } },
      { id: 'talk', label: TX('training.talk.label'), text: TX('training.talk.text'), effect: { type: 'xp', n: 3 }, extra: { type: 'mood', delta: 1 } },
      { id: 'form', label: TX('training.form.label'), text: TX('training.form.text'), effect: { type: 'xp', n: 3 } },
    ],
    special: [
      { id: 'allout', label: TX('training.allout.label'), text: TX('training.allout.text'), effect: { type: 'xp', n: 5 }, downside: { type: 'stat', stat: 'maxHp', delta: -3 }, downsideBack: { type: 'mood', delta: -1 } },
      { id: 'harsh', label: TX('training.harsh.label'), text: TX('training.harsh.text'), effect: { type: 'xp', n: 5 }, downside: { type: 'mood', delta: -1 } },
    ],
  }));
  const TRAIN_TALK_FALLBACK = lazy(() => ([{ speaker: '$0', text: TX('training.talkScene.memberAsks') }, { speaker: 'leader', text: TX('training.talkScene.leaderSays') }, { speaker: '$0', text: TX('training.talkScene.memberAgrees') }]));
  const TRAIN_LEADER_FALLBACK = lazy(() => ([{ speaker: 'leader', text: TX('training.leaderSelf') }])); // v2.4 [11]
  const STAT_KEYS = ['hp', 'maxHp', 'atk', 'skillLv', 'xp', 'mood', 'luck']; // 2026-11-20 + 幸运 // DESIGN-skill-level: 技能等级 (was skillPower) · 2026-11-16: 经验
  const WHITEOUT = lazy(() => ([TX('ending.whiteout.1'), TX('ending.whiteout.2')]));
  const TURN_BASE = 0.15, TURN_KIND = 0.25, TURN_GRUDGE = 0.10;
  const CHAMPION_DEFAULT = lazy(() => ({ id: 'masked-champion', name: TX('enemy.champion.name'), faction: 'noble', hp: 9, atk: 3, skill: { kind: 'strike', name: TX('enemy.champion.skillName'), text: TX('enemy.champion.skillText'), target: 'strongest' /* 2026-11-19 伤害分摊 */ } }));
  const F = (text, expr) => ({ speaker: 'fairy', text, expr: expr || 'happy' });
  const FD = (text, expr) => ({ speaker: 'fairy-demon', text, expr: expr || 'special' });
  const FAIRY_FALLBACK = lazy(() => ({
    first: [F(TX('fairy.greet.first'))],
    familiar: [F(TX('fairy.greet.familiar1'), 'shock'), F(TX('fairy.greet.familiar2'))],
    cleared: [F(TX('fairy.greet.cleared'), 'calm')],
    trueSeen: [F(TX('fairy.greet.trueSeen1'), 'calm'), F(TX('fairy.greet.trueSeen2'))],
    slip: [[F(TX('fairy.greet.slip'), 'special')]],
    tutorial: [F(TX('fairy.tutorial.1')), F(TX('fairy.tutorial.2')), F(TX('fairy.tutorial.3'))],
    recovery: F(TX('fairy.recovery')),
    battle: { taunt: [[FD(TX('fairy.battle.taunt'), 'happy')]], attack: [FD(TX('fairy.battle.attack'), 'happy')],
      phase2: [FD(TX('fairy.battle.phase2'))], down: [FD(TX('fairy.battle.down'), 'shock')], win: [FD(TX('fairy.battle.win'), 'happy')] },
  }));
  // generic text for v2.2 stories while content is missing (normalEnding falls back to the old victory first)
  const STORY_FALLBACK = lazy(() => ({
    sacrificeSelf: [TX('story.sacrificeSelf.1'), { speaker: 'gallery', text: TX('story.sacrificeSelf.gallery') }],
    firstReturnSelf: [TX('story.firstReturnSelf')],
    secondSacrificeIntroSelf: [TX('story.secondSacrificeIntroSelf.1'), { speaker: 'gallery', text: TX('story.secondSacrificeIntroSelf.gallery') }],
    bellEvent: [TX('story.bellEvent.1'), TX('story.bellEvent.2')],
    bellFollowed: [TX('story.bellFollowed.1'), TX('story.bellFollowed.2')],
    trueDoor: [TX('story.trueDoor.1'), TX('story.trueDoor.2')],
    sideDoor: [TX('story.sideDoor.1'), TX('story.sideDoor.2')], // 2026-11-15 小门 (text only in data/text/zh/engine.json)
    sideDoorPass: [TX('story.sideDoorPass.1'), TX('story.sideDoorPass.2'), TX('story.sideDoorPass.3')],
    nobleChamber: [TX('story.nobleChamber.1'), F(TX('story.nobleChamber.fairy')), { speaker: 'narrator', text: TX('story.nobleChamber.narrator'), fx: 'transform' }],
    trueEnding: [TX('story.trueEnding')], // 2026-11-14: the dolls turning back is told in l11After
    teamAssembled: [{ speaker: 'advisor', text: TX('story.teamAssembled') }], // v2.4 [9]
    normalEnding: [TX('story.normalEnding.1'), { speaker: 'gallery', text: TX('story.normalEnding.gallery') }, TX('story.normalEnding.2')],
  }));

  // RULES-v1 §8: the leader fights as party member id 'leader'. She is not a candidate: this stub keeps the
  // candidate helpers (name, traits, lines, relation) working; her combat stats live on run.members.leader.
  const LEADER_ID = 'leader';
  const LEADER_CAND = lazy(() => (Object.freeze({ id: LEADER_ID, name: TX('names.leaderTitle'), hiddenTraits: [], visibleTags: [], lines: {}, relation: null })));
  // v2.4 [4]: the player's name. The engine is synchronous, so every entry point (createRun / act / view / simulateBattle)
  // sets the current run's name here; cand('leader').name, {leader} and the leader's speaker name all read it.
  const LEADER_NAMES = lazy(() => ([TX('names.leader.1'), TX('names.leader.2'), TX('names.leader.3'), TX('names.leader.4'), TX('names.leader.5'), TX('names.leader.6'), TX('names.leader.7'), TX('names.leader.8'), TX('names.leader.9'), TX('names.leader.10'), TX('names.leader.11'), TX('names.leader.12')]));
  let CUR_LEADER = null;
  const defaultLeaderName = (seed) => LEADER_NAMES()[(seed >>> 0) % LEADER_NAMES().length];
  const normName = (x) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 12) : null);
  const useRun = (run) => { CUR_LEADER = run ? run.leaderName || TX('names.leaderTitle') : null; CUR_DIFF = run && run.difficulty != null ? run.difficulty : null; return run; };
  const leaderName = () => CUR_LEADER || TX('names.leaderTitle');
  const LEADER_DEFAULTS = lazy(() => ({ // used when data.leader.classes[] carry no role/hp/atk/skill/combo (test fixtures)
    tactician: { role: 'mage', hp: 7, atk: 3, skill: { kind: 'spark', name: TX('leader.tactician.skillName'), text: TX('leader.tactician.skillText') }, combo: { name: TX('leader.tactician.comboName'), text: TX('leader.tactician.comboText'), direction: 'both', when: 'always', chance: 0.25 } },
    guardian: { role: 'tank', hp: 12, atk: 2, skill: { kind: 'guard', name: TX('leader.guardian.skillName'), text: TX('leader.guardian.skillText') }, combo: { name: TX('leader.guardian.comboName'), text: TX('leader.guardian.comboText'), direction: 'next', when: 'on-guard', chance: 0.5 } },
    merchant: { role: 'rogue', hp: 8, atk: 3, skill: { kind: 'backstab', name: TX('leader.merchant.skillName'), text: TX('leader.merchant.skillText') }, combo: { name: TX('leader.merchant.comboName'), text: TX('leader.merchant.comboText'), direction: 'next', when: 'on-kill', chance: 0.5 } },
  }));
  const isLeader = (id) => id === LEADER_ID;
  const leaderCand = () => (CUR_LEADER ? Object.assign({}, LEADER_CAND(), { name: CUR_LEADER }) : LEADER_CAND());
  const cand = (data, id) => (isLeader(id) ? leaderCand() : data.candidates.find((c) => c.id === id) || fail('unknown candidate ' + id));
  const sacrificable = (run) => run.party.filter((id) => !isLeader(id));
  const advisorData = (data, run) => (run.advisor ? data.advisors.find((a) => a.id === run.advisor) : null);
  const levelCfg = (data, n) => tierCfg(data.scenario.levels.find((l) => l.level === n)); // v2.5 tier rules
  const hasTrait = (data, id, t) => { const c = isLeader(id) ? LEADER_CAND() : (data.candidates || []).find((x) => x.id === id); return !!c && (c.hiddenTraits || []).includes(t); }; // safe for non-candidate units (turncoats)
  const leaderHas = (run, eff) => (run.leaderEffects || []).includes(eff);
  // RULES-v1 §9: advisors carry flow{kind} (chestnut | reveal-trait | scout) and combat{kind} (formation | clause | luck).
  // Legacy `buff` is read only when flow/combat are missing: front-atk → combat formation; reveal-trait/scout → flow.
  const FLOW_KINDS = { chestnut: 1, 'reveal-trait': 1, scout: 1, ward: 1, lucky: 1, tea: 1, fortune: 1 }; // G2 #8: ward · lucky (in-battle, no advisor uses them since 第六批) · H1-1: tea (lucienne 热茶) · fortune (nicota 幸运星: 4 reward picks)
  const flowOf = (a) => (a.flow ? a.flow : a.buff && FLOW_KINDS[a.buff.kind] ? { kind: a.buff.kind, name: '', text: a.buff.text } : null);
  const OLD_COMBAT = { lucienne: () => !LUCIENNE_OVERTIME, nicota: () => !(NICOTA_LUCK_UP && LUCK_STAT) }; // 2026-11-20 flags → the old skill
  const combatOf = (a) => (a.combat_old_2026_11_20 && OLD_COMBAT[a.id] && OLD_COMBAT[a.id]() ? a.combat_old_2026_11_20 : a.combat ? a.combat : a.buff && a.buff.kind === 'front-atk' ? { kind: 'formation', name: TX('skill.formation'), text: a.buff.text } : null);
  const advisorFlow = (data, run) => { const a = advisorData(data, run); const f = a && run.advisorPresent ? flowOf(a) : null; return f ? f.kind : null; };
  const advisorSkillText = (a, run) => [flowOf(a), run ? combatView(a, run) : combatOf(a)].filter(Boolean).map((x) => (x.name ? TX('skill.named', { name: x.name, text: x.text }) : x.text)).join(TX('list.semi'));
  const nameOf = (data, id) => cand(data, id).name;
  const linesV2 = (data) => data.linesV2 || data['lines-v2'] || {};
  const dig = (o, ...ks) => { for (const k of ks) { if (o == null) return undefined; o = o[k]; } return o; };
  function itemDefs(data) {
    const list = Array.isArray(data.items) ? data.items : data.items && Array.isArray(data.items.items) ? data.items.items : [];
    const out = ITEM_DEFAULTS().filter((d) => !list.some((x) => x.id === d.id)).concat(list);
    return out;
  }
  const itemDef = (data, id) => itemDefs(data).find((x) => x.id === id) || null;
  const itemKind = (it) => (it.effect && it.effect.type) || ({ potion: 'healFull', smoke: 'smoke', drum: 'drum', holywater: 'cleanse', 'potion-big': 'healFull', 'armor-potion': 'armor', revive: 'revive', 'weak-powder': 'weakAll', 'vuln-potion': 'vuln', 'fire-bottle': 'fire' })[it.id];
  // 2026-11-22 who an item is aimed at: 'ally' (a living one) · 'enemy' (a living foe: 烟雾弹 when SMOKE_DAZE) · 'fallen' (an ally at 0 hp: 复活药) · null
  const itemAim = (run, it) => {
    const kind = itemKind(it);
    if (kind === 'smoke') return smokeDaze(run) ? 'enemy' : null;
    if (kind === 'revive' || it.targetFallen) return 'fallen';
    if (kind === 'vuln' || it.targetEnemy) return 'enemy';
    return it.needsTarget ? 'ally' : null;
  };

  function fill(text, ctx) {
    return String(text == null ? '' : text).replace(/\{(leader|advisor|name|token|card|level|rival|friend|memory|lost|lost2|target|enemy|levelTitle)\}/g, (m, k) => (ctx[k] != null ? ctx[k] : m));
  }
  function baseCtx(data, run) {
    const a = advisorData(data, run);
    return { leader: run && run.leaderName ? run.leaderName : leaderName(), advisor: a ? a.name : TX('names.advisor') };
  }

  // ---------- §1 dialogue lines ----------
  // raw: string (narration, or `def` speaker) | { speaker, text, expr } → { speaker, speakerId, name, text, expr }
  // 2026-11-19 试玩修 剧情: the party came from the 快速开局 page (picks only — no conflict scene, no stance said aloud)
  const quickRun = (run) => !!(run && run.flags && run.flags.quickRecruit);
  // 2026-11-19 伤害分摊 E3: the interview round of a girl (rejected: her own; hired: her rival's) — null when there is no record
  const interviewRoundOf = (run, id) => { const ri = run.rejectedInfo || {}; if (ri[id] && ri[id].round != null) return ri[id].round; const g = (run.memory || {})[id], rv = g && g.rival; return rv && ri[rv] && ri[rv].round != null ? ri[rv].round : null; };
  // did speaker sp sit in on enemy's interview? (the leader always did; a girl hired in that round or before did — never on a quick run)
  function sawInterview(run, sp, enemyId) {
    if (quickRun(run)) return false;
    const e = interviewRoundOf(run, enemyId);
    if (e == null) return false;
    if (sp === 'leader' || sp === LEADER_ID) return true;
    if (!(run.members || {})[sp]) return false;
    const r = interviewRoundOf(run, sp);
    return r != null && r <= e;
  }
  function resolveLine(data, run, raw, ctx, def) {
    let o = raw && typeof raw === 'object' ? raw : { text: raw };
    // 2026-11-19 试玩修 剧情: a line may carry a variant for runs whose record does not back it —
    // ifQuick (the 快速开局 page: she was picked, the stance line was never said) · noGift (ctx.gave === false: nothing was given)
    let alt = run && o.ifQuick && quickRun(run) ? o.ifQuick : ctx && ctx.gave === false && o.noGift ? o.noGift : null;
    // 2026-11-19 伤害分摊 E3: ifUnseen — the line says the speaker saw {enemy}'s interview; she did not (quick run, no record, or hired later)
    if (!alt && run && o.ifUnseen && ctx && ctx.enemyId && !sawInterview(run, o.speaker, ctx.enemyId)) alt = o.ifUnseen;
    if (alt) o = Object.assign({}, o, { text: alt });
    let sp = o.speaker || def || 'narrator';
    if (/^member\d$/.test(sp)) sp = (run ? sacrificable(run)[+sp.slice(6)] : null) || 'narrator'; // feedback-1112 #7: the n-th girl in the party
    let speakerId = sp, name = '';
    if (sp === 'advisor') { const a = advisorData(data, run); speakerId = a ? a.id : 'advisor'; name = a ? a.name : TX('names.advisor'); }
    else if (sp === 'leader') { name = (run && run.leaderName) || leaderName(); speakerId = LEADER_ID; }
    else if (sp === 'gallery') name = o.name || TX('names.gallery'); // feedback-1112 #7: {speaker:'gallery', name:'贵族'}
    else if (sp === 'fairy' || sp === 'fairy-demon') name = FAIRY_NAME();
    else if (sp !== 'narrator') {
      const c = (data.candidates || []).find((x) => x.id === sp) || (data.advisors || []).find((x) => x.id === sp);
      name = c ? c.name : sp;
    }
    const out = { speaker: sp, speakerId, name, text: fill(o.text, Object.assign(baseCtx(data, run), ctx || {})), expr: o.expr || null };
    if (o.fx) out.fx = o.fx; // v2.2: e.g. nobleChamber's {fx:'transform'}
    return out;
  }
  // 2026-11-20 反水 one line (TURNCOAT_RECORD_LINE): which record backs her line. Pure. → { branch, ctx, raw }
  function turncoatPick(data, run, id) {
    const h = (run.memory || {})[id] || {}, m = (run.members || {})[id] || null;
    const s = (run.sacrificed || []).find((x) => x.id === id), snap = (s && s.snapshot) || {};
    const cname = (cid) => { const cd = cardById(data, cid); return cd ? cd.name : null; };
    let gift = null;
    const rc = (h.cards || []).filter((c) => c.reward).map((c) => c.name || cname(c.card)).filter(Boolean);
    if (rc.length) gift = rc[rc.length - 1];
    else if ((h.items || []).length) gift = h.items[h.items.length - 1];
    else { const ids = ((m && m.rewardsReceived) || snap.rewards || []).map(cname).filter(Boolean); if (ids.length) gift = ids[ids.length - 1]; }
    const bond = (m && m.bond) || snap.bond || null;
    const branch = h.sidedFor === true ? 'sidedFor' : gift ? 'gift' : bond === 'high' ? 'bond' : 'neutral';
    const tb = dig(linesV2(data), 'turncoatRecord') || {};
    const raw = dig(tb, id, branch) || dig(tb, 'default', branch) || null;
    return { branch, ctx: branch === 'gift' ? { card: gift } : {}, raw };
  }
  const lineEvent = (data, run, raw, ctx, def, extra) => Object.assign({ kind: 'line' }, resolveLine(data, run, raw, ctx, def), extra || {});
  const pickOne = (run, x) => (Array.isArray(x) ? (x.length ? rngPick(run, x) : null) : x || null);
  // lines-v2 arrays: sequences (intro / flashback / down / firstPause / farewellHighBond) play in full;
  // the others (hit / beforeFight / afterWin) are alternatives, one picked with the run rng.
  const SEQUENCE_KEYS = { intro: 1, flashback: 1, down: 1, firstPause: 1, ambushWarn: 1 };
  const linesFor = (run, x, key) => (x == null ? [] : !Array.isArray(x) ? [x] : SEQUENCE_KEYS[key] ? x.slice() : x.length ? [rngPick(run, x)] : []);
  // §1: a story entry is an array, or { default, <advisorId>: [...] } per-advisor variants.
  const MEMBER_STORIES = { l9Freedom: 1, throneRoom: 1, throneAdvisor: 1, normalEnding: 1, whiteRoom: 1, l10Free: 1 };
  // 2026-11-21 用户「第十关结束后先过奥德丽的结束剧情，然后说可以走了（换音乐），走的时候发现这个门，门可以进也可以不进」(L10_EXIT_V2):
  // L10 won → l10Fall (the advisor dies, per-advisor) → l10Free (「你们自由了」, the music turns calm) → the bell door → 【进去看看】 trueDoor → L11
  // or 【不进去】 (act skipDoor) normalEnding → whiteRoom → victory. false = the old order (door first; trueDoor / normalEnding _old_2026_11_21 carry her fall).
  const L10_EXIT_V2 = true;
  function storyLines(data, run, id) {
    if (id === 'fairyWelcome' && run.fairyLines) return run.fairyLines; // v2.2 §3: built once at createRun
    if (id === 'levelIntro') return run.levelIntro ? run.levelIntro.lines : null; // v2.4 [9]: built at startLevel
    if (id === 'rejectedDefeat') return run.defeatLines || null;
    if (BELL_DOOR && (id === 'sideDoor' || id === 'sideDoorPass')) return [TX('story.bellDoor.1'), BELL_HAVE()[bellDoorView(data, run).have]]; // 2026-11-20 铃之门: says how many // SPEC-2026-11-13 E3: built in postQueue
    if (id === 'sealing' && SEALING_BEFORE_REWARD && data.stories && Array.isArray(data.stories.sealing_old_2026_11_19g)) return data.stories.sealing_old_2026_11_19g.slice(); // 2026-11-19 用户亲测 流程: the old 「最后一具骷髅散了架」 opening goes with the old order
    if (id === 'bellFollowed' && tierRule(run, 'bellWound') === false) { // 2026-11-13: 木头 — the night is simply gone, no wound hinted
      const s0 = data.stories && data.stories.bellFollowedLight;
      if (Array.isArray(s0) && s0.length) return s0.slice();
    }
    if (!L10_EXIT_V2 && (id === 'trueDoor' || id === 'normalEnding') && data.stories && Array.isArray(data.stories[id + '_old_2026_11_21'])) return data.stories[id + '_old_2026_11_21'].slice(); // L10_EXIT_V2 off: the old texts (her fall inside)
    const s = data.stories && data.stories[id];
    if (!s) { // v2.2 stories may land after the engine: generic fallbacks (normalEnding → the old victory text)
      if (id === 'normalEnding') return storyLines(data, run, 'victory') || STORY_FALLBACK().normalEnding;
      return STORY_FALLBACK()[id] || null;
    }
    const v = Array.isArray(s) ? s : (run.advisor && s[run.advisor]) || s.default;
    if (!Array.isArray(v)) return null;
    // feedback-1112 #35/#40/#38: in the throne room and the white room a line for a girl the party no longer has is dropped
    if (MEMBER_STORIES[id]) return v.filter((l) => !(l && typeof l === 'object' && /^member\d$/.test(l.speaker || '') && !sacrificable(run)[+l.speaker.slice(6)]));
    // 2026-11-14: L10 is one wave (the advisor boss + her guards) on every tier — finalReveal no longer brings anybody back, so the old
    // 「老朋友 / 一位客人」 rewrite for tiers 0–4 is gone. (The 秘银+ second sacrifice still sets run.returned.final; nothing in L10 reads it.)
    if (id === 'sacrificeIntro' && diceN(run) !== 1) { // v2.5: the rule names how many the dice take on this tier
      const n = NUM_CN()[diceN(run)] || String(diceN(run));
      const re = new RegExp(TX('sacrifice.diceRe'), 'g'); // 第六批 H1-6: the data says 「随机挑走一个」 (tiers 0–4); 秘银+ / untiered → 「两个」
      return v.map((l) => (l && typeof l === 'object' && new RegExp(TX('sacrifice.diceRe')).test(l.text) ? Object.assign({}, l, { text: l.text.replace(re, TX('sacrifice.diceTakes', { n })) })
        : typeof l === 'string' ? l.replace(re, TX('sacrifice.diceTakes', { n })) : l));
    }
    return v;
  }
  const candLine = (data, id, key) => (cand(data, id).lines || {})[key] || null;

  // ---------- events ----------
  function say(data, run, events, id, key, extra) {
    const t = candLine(data, id, key);
    if (t) events.push(lineEvent(data, run, t, Object.assign({ name: nameOf(data, id) }, extra || {}), id, { id, key }));
  }
  function advisorSay(data, run, events, key, ctx) {
    const a = advisorData(data, run);
    if (!a || !a.comments || a.comments[key] == null) return null;
    const raw = pickOne(run, a.comments[key]);
    if (raw == null) return null;
    const e = Object.assign({ kind: 'advisor', key }, resolveLine(data, run, raw, ctx, 'advisor'));
    events.push(e);
    return e.text;
  }
  // lines-v2 advisorGuide.<advisorId>.<key>
  function advisorGuide(data, run, events, key, opts) {
    if (!run.advisorPresent) return;
    let pool = dig(linesV2(data), 'advisorGuide', run.advisor, key);
    // 2026-11-22 试玩: a line marked flawlessOnly (「无人缺席」) is never picked after a battle where someone fell (even if she got back up)
    if (opts && opts.fell && Array.isArray(pool)) pool = pool.filter((r) => !(r && typeof r === 'object' && r.flawlessOnly));
    for (const raw of linesFor(run, pool, key)) events.push(lineEvent(data, run, raw, {}, 'advisor', { key: 'guide.' + key }));
  }
  // 2026-11-20 流程 (FLOW_DEPART_ROUTE): the night only marks the pre-fight line; 「出发」 (guideOnDepart) puts it in the scene intro.
  // Old order (flag false; kept 2026-11-20): advisorGuide(data, run, events, 'beforeFight') right here, in the night's events.
  function guideBeforeFight(data, run, events) {
    if (!FLOW_DEPART_ROUTE) return advisorGuide(data, run, events, 'beforeFight');
    if (run.advisorPresent) run.guidePending = true;
  }
  function guideOnDepart(data, run) {
    if (!run.guidePending) return;
    delete run.guidePending;
    if (!run.advisorPresent || !run.levelIntro) return;
    const add = linesFor(run, dig(linesV2(data), 'advisorGuide', run.advisor, 'beforeFight'), 'beforeFight');
    run.levelIntro.lines = run.levelIntro.lines.concat(add.map((r) => Object.assign({ key: 'guide.beforeFight' }, r)));
  }
  // scenario level.prepWarn = an advisorGuide key: one advisor line played with the campfire talk (key 'campfire'), so the
  // player hears it before the formation (L9 灯火酒馆: 「……经常被偷袭……」)
  // 2026-11-20 用户「篝火边顾问提示谁的血不到一半，要注意治疗」(CAMP_LOW_HP_WARN): one advisor line as the campfire choice opens,
  // naming everyone in the party (the leader too) below half hp; 3 or more → one line for 「好几个人」. Nobody low → nothing.
  // 2026-11-20 用户「牧师也要攻击，攻击和治疗同步，威力的一半变成攻击」(PRIEST_STRIKE): our priest heals AND hits the front-most
  // living enemy for ⌈威力 ÷ 2⌉ (min 1) in the same action; nobody hurt → the old full-power hit. false = heal only.
  const ENRAGE_PIERCE = true; // 2026-11-20 用户「首领狂暴后改成穿透攻击，每经过一个人伤害 /2，打全场；每回合威力 +2」
  const LOSS_NO_XP = true; // 2026-11-22 试玩4 #13: a lost battle (= game over) gives no battle 经验 (false = old: the end screen showed level-ups)
  const FLAWLESS_COUNTS_DOWNS = true; // 2026-11-22 试玩4 #2: a fall that was revived still counts against 「没有一个人倒下」 (false = only who is down at the end)
  const HOLY_SPRING_V5 = true; // 2026-11-23 圣泉 v5: whoever she heals 威力 +1 per heal (false = v4: every action the whole team +1)
  const HOLY_SPRING_V4 = true, HOLY_SPRING_V4_CAP = 4; // 2026-11-20 圣泉 v4 (see the action end)
  const DODGE_GRAZE = true; // see the dodge roll in hit(); false = old: a dodge is a clean miss
  const DODGE_ON = true, DODGE_STEP = 0.2, DODGE_MAX = 0.9; // 2026-11-20 用户「+20% 也做上」: step 0.1 → 0.2 // 2026-11-20 L9 闪避 (灰羽护符 aura + 灰羽首领 dodgeUp)
  const GRAZE_AFTER_N = 5; // 2026-11-24 用户「超过 5 次攻击出现」 (was 3)
  const TEAM_AS_RELIC = true; // 2026-11-25: 拿过的全队卡（护身绳 / 磨刀石 / 庆功酒）在顶栏遗物那一排显示；只是显示
  const BROOD_SHOW_COST = true; // 2026-11-25: L7 母体分裂扣自己的血，战报写出来；false = 旧
  const COPY_SHOW_EFF = true; // 2026-11-25: 小铃复制负面效果时写出效果和「本场」；false = 旧
  const GLASS_WARN = true; // 2026-11-25: 小铃战玩偶的「玻璃瓶」开场就讲清楚；false = 旧（只在碎的时候说）
  const RAMPUP_SHOW_ALL = true; // 2026-11-25 试玩: L9 首领写「每回合 +1」实际一回合涨 2–3（大家都有的越打越凶 +1 + 她自己 +1 + 记仇）→ 战报写清两份，「现」= 下回合真实威力；false = 旧
  const SUMMON_OUT_ATK = 2; // 2026-11-25 用户「威力 +3 改成威力 +2」（先前 3）: 露西安 名册叫空时 威力 +3（最后一段别太松）；0 = 旧
  const OVERTIME_ROUND = 2; // 2026-11-25 露西安「加班条款」(敌方): 每回合开始敌方每人充能 +2；0 = 旧（她站着时敌方每次被充能多 1 格，旧文字「她还站着，敌方每人每次被充能多 1 格」）
  const ENRAGE_CLEAR_CHARGE = true; // 2026-11-25 用户「改」: 首领狂暴时充能清零（攒着的额外行动也清掉），不会刚狂暴就连穿两枪；false = 旧
  const ENRAGE_ONCE = 2; // 0 = old (enraged: 威力 +2 every round instead of +1)
  const grazeState = (t) => !!(t && Array.isArray(t.traits) && t.traits.includes('grazeAfter') && (t.dodgeHits || 0) >= GRAZE_AFTER_N);
  function dodgeOf(B, t) {
    if (!t || t.hp <= 0) return 0;
    let p = 0;
    if (!t.dodgeAura) for (const x of (B && B.enemies) || []) if (x !== t && x.dodgeAura && x.hp > 0) p = Math.max(p, x.dodgeAura);
    if (Array.isArray(t.traits) && t.traits.includes('dodgeUp')) p += DODGE_STEP * (t.dodgeHits || 0);
    if (grazeState(t)) return 1; // 2026-11-23 用户 L9「每回合被攻击 3 次以后进入灵体状态」(trait grazeAfter): every later hit this round grazes
    return Math.min(DODGE_MAX, p);
  }
  const SWAP_RETURNED_ROLE = true; // 2026-11-20 L8 (see the wave build)
  const LOOT_N = 3; // 2026-11-22 用户「道具变多了，还是三选一吧」 (2026-11-20「2 选 1」 was 2; before that 3)
  const LOOT_NO_COMMON_WITH_LEGEND = true; // 2026-11-20 see the reward draw
  const SIDE_BOND_ATK = true; // 2026-11-24 用户: siding with the girl you hire gives her 威力 +1 instead of 心情 +1 (with 没落贵族 she started 高昂); false = the old mood +1 (old text interview.bondEffect: 「♥ 信赖：{who}开局心情 +1，充能 9 格就满」)
  const PRICE_BY_RARITY = true, RARITY_PRICE = { common: 30, rare: 45, epic: 65, legendary: 90 }; // 2026-11-24: one price per rarity for 信物 / 护符 (false = price.tier)
  const SAME_RARITY_LOOT = true; // 2026-11-24: see the reward draw (false = mixed rarities, legendary in the loot)
  const LOOT_ONE_CHARM = true; // 2026-11-24 用户「最多一个护符肯定的」: a loot draw shows at most one legendary 护符 (the rest swap to other cards); false = the old (any number)
  const BADGE_LAST_STAND = true; // 2026-11-22k 试玩「最后一个倒下的人有徽章却没站起来，直接判负」: the round ends first, then she stands up; false = everyone down = defeat at once
  const BADGE_ROUND_END = true; // 2026-11-20 旧公会徽章: stand up at 1 hp at the round's end (see hit())
  const HEAL_SPLIT = true; // 2026-11-24 用户「主目标满血，副目标威力的一半」: share 1 = full 威力, every later share half (false = HEAL_DECAY)
  const HEAL_DECAY = 2; // 2026-11-20 用户「牧师成长后太强，补血量逐份 −2，像刺客一样」: our priest's share i+1 heals 2i less (min 1); 0 = old (every share the full 威力)
  const PRIEST_STRIKE = true;
  const priestHalf = (p) => Math.max(1, Math.ceil(Math.max(0, p) / 2));
  const CAMP_LOW_HP_WARN = true;
  const LOW_HP_DIRE = true; // 2026-11-22g 试玩7 #1: 1/26 hp heard 「血不到一半」 → anyone at ≤ 1/4 hp gets camp.lowHpDire (「只剩一点点血了」), the rest camp.lowHpAlso; false = old (one 「不到一半」 line)
  const PAUSE_ACT_COUNT = true; // 2026-11-22g 试玩7 #2: pause.acted = the player's queued actions (B.pauseActs), not the queued event lines (charge lines made 2 things read 「6 件事」); false = old
  // 2026-11-22g 试玩7 #11 迟疑 vs 发呆: two statuses — 迟疑 (slow-start: the NEXT battle's first action is skipped) and 发呆 (daze: this
  // action skipped). Kept both words, each with its own keyword tip (keywords.json status/terms slow-start). Old zh text: debt.eff.slowStart 「第一次行动发呆」.
  // 2026-11-22g 试玩7 #1 new zh keys camp.lowHpDire / camp.lowHpAlso (old: only camp.lowHp 「{names}的血不到一半了，今晚最好歇一歇。」).
  const BELLS_IN_RELICS = true; // 2026-11-22g 试玩7 #8: every lit bell (refuse / rules / bell) shows in view.relics (id bell, name bellKey.name.*); false = old (only run.relics, i.e. 好奇之铃)
  function lowHpWarn(data, run, events) {
    if (!CAMP_LOW_HP_WARN || !run.advisorPresent || !run.camp || run.camp.quiet) return;
    const low = run.party.filter((id) => { const m = run.members[id]; return m && m.maxHp > 0 && hpOf(m) * 2 < m.maxHp; });
    if (!low.length) return;
    const dire = LOW_HP_DIRE ? low.filter((id) => { const m = run.members[id]; return hpOf(m) * 4 <= m.maxHp; }) : [], half = low.filter((id) => !dire.includes(id)), nm = (ids) => listSeq(ids.map((id) => nameOf(data, id)));
    const text = low.length >= 3 ? TX('camp.lowHpMany') : dire.length ? TX('camp.lowHpDire', { names: nm(dire) }) + (half.length ? TX('camp.lowHpAlso', { names: nm(half) }) : '') : TX('camp.lowHp', { names: nm(low) });
    events.push(lineEvent(data, run, { text }, {}, 'advisor', { key: 'campfire', warn: 'lowHp', low: low.slice() }));
  }
  function prepWarn(data, run, events) {
    const cfg = levelCfg(data, run.level), k = cfg && cfg.prepWarn;
    if (!k || !run.advisorPresent) return;
    for (const raw of linesFor(run, dig(linesV2(data), 'advisorGuide', run.advisor, k), k)) events.push(lineEvent(data, run, raw, {}, 'advisor', { key: 'campfire', warn: k }));
  }
  const REVEAL_EFFECT_NOTE = true; // 2026-11-19 试玩修 数值文字
  // 2026-11-19 伤害分摊 E1: a girl with two hidden traits may have one reveal line per trait (traitRevealBy), else the shared one
  const revealText = (data, id, trait) => { const c = cand(data, id) || {}; return (c.traitRevealBy && c.traitRevealBy[trait]) || c.traitReveal || null; };
  // 2026-11-20 用户「起作用时才说」: a hidden trait is announced only at the moment it first really changes something, with one
  // line saying what it just did (trait.fired.<key>, key = trait or a per-situation variant like 'proud-curse'); no reveal after
  // a battle where it did nothing. false = the old behaviour (post-battle random reveal L1–4, reveal whenever the rule ran).
  const REVEAL_ON_EFFECT = true;
  // would adding `extra` to member id's pending mood total (d[id]) move her clamped mood? (mood traits fire only if so)
  const moodBites = (data, run, d, id, extra) => {
    const m = run.members[id];
    if (!m || !extra || moodless(run, id)) return false;
    const floor = hasTrait(data, id, 'loyal') ? -1 : -2, cur = (m.mood == null ? 0 : m.mood) + (d[id] || 0);
    return clamp(cur, floor, 2) !== clamp(cur + extra, floor, 2);
  };
  // a mood trait's share: added to d now; under REVEAL_ON_EFFECT the reveal waits in `fires` until the totals are known
  function traitMood(data, run, ev, d, fires, id, delta, trait, key) {
    addMood(d, id, delta, null, trait);
    if (REVEAL_ON_EFFECT) fires.push({ id, trait, key, extra: -delta }); else reveal(data, run, ev, id, trait);
  }
  // fires: [{ id, trait, key, extra }] — reveal when taking `extra` off her total would change her mood (i.e. the trait moved it)
  function fireTraits(data, run, ev, d, fires) {
    for (const f of fires) if (moodBites(data, run, d, f.id, f.extra)) reveal(data, run, ev, f.id, f.trait, f.key);
  }
  function reveal(data, run, events, id, trait, key) {
    const m = run.members[id];
    if (!m || m.revealed.includes(trait) || !hasTrait(data, id, trait)) return null;
    m.revealed.push(trait);
    // 2026-11-19 试玩修 数值文字: 阿雾's 「晚成」 reveal only said 「她的箭更快了」 while the card gave +2 instead of +1 — the reveal now
    // ends with what the trait really does (trait.effect.<id>; REVEAL_EFFECT_NOTE false = the old story line alone)
    // 2026-11-20 用户「战斗后说什么骷髅…很多余」: the per-girl story line (candidates traitReveal) is off — just 「X 的特质「Y」显露了。」 + what it does. true = old
    const REVEAL_STORY_LINE = false;
    const tfx = REVEAL_EFFECT_NOTE ? TRAIT_EFFECTS[trait] : null;
    const tip = tfx ? tfx({ name: nameOf(data, id), trait: TRAIT_LABELS()[trait] || trait }) : '';
    const oldText = () => ((REVEAL_STORY_LINE && revealText(data, id, trait)) || TX('trait.reveal', { name: nameOf(data, id), trait: TRAIT_LABELS()[trait] })) + tip;
    const e = { kind: 'reveal', id, name: nameOf(data, id), trait, label: TRAIT_LABELS()[trait] || trait, tip: tip || null, fired: REVEAL_ON_EFFECT ? (key || trait) : null,
      text: REVEAL_ON_EFFECT ? (TRAIT_FIRED[key || trait] || TRAIT_FIRED[trait])({ name: nameOf(data, id) }) : oldText() };
    events.push(e);
    return e;
  }

  // 2026-11-19 试玩修 剧情: a hard day — someone in the party went down in the last battle, a returned girl was fought,
  // or someone was sacrificed / taken since (run.hardDay, set in finishBattle / sacrifice), or the night's recent record is dark
  const hardDay = (run) => !!(run.hardDay || (run.recent && DARK_WHENS[run.recent.when]));
  // 2026-11-19 伤害分摊 E2 (塞西「今天谁都没流血」): someone in the party lost hp in the last battle, or is still below her max hp
  const hurtToday = (run) => !!((run.battle && (run.battle.allies || []).some((a) => (a.taken || 0) > 0 && !a.turned)) || (run.party || []).some((id) => { const m = run.members[id]; return m && hpOf(m) < m.maxHp; }));
  // Mood deltas are accumulated per member, then applied once (so clamping happens on the sum).
  // MOOD_WHY (2026-11-24 用户「每次心情变化，就算 +/- 没有变化，也要在界面底下写清楚变化原因」): whyMap[id] = [{ n, label, trait }] —
  // the mood event carries why + whyText, and a net zero / capped move still gets an event (delta 0, same: true). A trait still
  // hidden after this card reads as 「？」 so nothing is spoiled. false / no whyMap = the old (net zero shows nothing)
  const MOOD_WHY = true;
  // 2026-11-24b 用户「不需要防止剧透；心情不变也不需要说；透露性格就说清楚她的性格对这个事件的影响」: name the trait even before it shows,
  // no line when the mood did not move (MOOD_WHY_SAME false), previews / notes count every trait
  const MOOD_WHY_NAME_ALL = true, MOOD_WHY_SAME = false;
  function moodWhyText(data, run, id, list, from, to) {
    const m = run.members[id];
    const parts = list.map((w) => TX('mood.why.part', { label: w.trait ? (m && (MOOD_WHY_NAME_ALL || m.revealed.includes(w.trait)) ? TX('mood.why.trait', { trait: TRAIT_LABELS()[w.trait] || w.trait }) : TX('mood.why.hidden')) : w.label, sign: w.n < 0 ? '−' : '+', n: Math.abs(w.n) })).join(TX('list.comma'));
    const net = list.reduce((t, w) => t + w.n, 0);
    const tail = to !== from ? TX('mood.why.moved', { from: MOOD_LABELS()[from], to: MOOD_LABELS()[to] }) : net === 0 ? TX('mood.why.zero', { mood: MOOD_LABELS()[to] }) : TX('mood.why.capped', { mood: MOOD_LABELS()[to] });
    return TX('mood.why.line', { name: nameOf(data, id), parts, tail });
  }
  function applyMoods(data, run, events, deltas, whyMap) {
    if (!whyMap && MOOD_WHY) whyMap = MOOD_WHYS.get(deltas) || null; // 2026-11-24 用户「打完仗和篝火的心情变化也写原因」
    if (whyMap) for (const id of Object.keys(whyMap)) { const m = run.members[id]; if (m && !moodless(run, id) && whyMap[id].length && !deltas[id]) deltas[id] = 0; }
    for (const id of Object.keys(deltas)) {
      const m = run.members[id];
      const wl = whyMap && whyMap[id] && whyMap[id].length && m && !moodless(run, id) ? whyMap[id] : null;
      if (MOOD_WHY_SAME && wl && (!deltas[id] || clamp((m.mood == null ? 0 : m.mood) + deltas[id], hasTrait(data, id, 'loyal') ? -1 : -2, 2) === (m.mood == null ? 0 : m.mood))) { // net zero or capped: still say why
        const cur = m.mood == null ? 0 : m.mood;
        if (deltas[id] && cur + deltas[id] < (hasTrait(data, id, 'loyal') ? -1 : -2) && hasTrait(data, id, 'loyal')) reveal(data, run, events, id, 'loyal');
        events.push({ kind: 'mood', id, name: nameOf(data, id), delta: 0, same: true, mood: cur, why: wl, whyText: moodWhyText(data, run, id, wl, cur, cur), text: moodWhyText(data, run, id, wl, cur, cur) });
        continue;
      }
      if (!m || !deltas[id] || moodless(run, id)) continue; // the leader has no mood (LEADER_MOOD false)
      if (m.mood == null) m.mood = 0; // 2026-11-20 团长心情: an older save's leader starts at 平静
      const before = m.mood;
      const floor = hasTrait(data, id, 'loyal') ? -1 : -2;
      const raw = before + deltas[id];
      if (raw < floor && floor === -1) reveal(data, run, events, id, 'loyal');
      m.mood = clamp(raw, floor, 2);
      if (m.mood === before) continue;
      if (m.mood > before) bump(statOf(run, LEADER_ID), 'cheered'); // @stats
      // 2026-11-19 试玩修 数值文字: 「伊芙 心情 下降（愉快）」 read oddly and never said what a level does — now 「高昂 → 愉快」 plus the
      // effect of the new level (mood.effect.<lv>, empty = none). MOOD_EVENT_TEXT_OLD = true: the old 「心情 上升 / 下降（X）」 lines.
      const mv = { name: nameOf(data, id), mood: MOOD_LABELS()[m.mood], from: MOOD_LABELS()[before], effect: MOOD_EFFECT(m.mood) };
      const mtext = MOOD_EVENT_TEXT_OLD ? (m.mood > before ? TX('mood.rose', mv) : TX('mood.fell', mv)) : (m.mood > before ? TX('mood.rose2', mv) : TX('mood.fell2', mv));
      events.push(Object.assign({ kind: 'mood', id, name: nameOf(data, id), delta: m.mood - before, mood: m.mood, text: mtext }, wl ? { why: wl, whyText: moodWhyText(data, run, id, wl, before, m.mood) } : {}));
      if (m.mood === -2) say(data, run, events, id, 'moodLow');
      if (m.mood === 2) say(data, run, events, id, hardDay(run) && candLine(data, id, 'moodHighHard') ? 'moodHighHard' : hurtToday(run) && candLine(data, id, 'moodHighHurt') ? 'moodHighHurt' : 'moodHigh'); // 2026-11-19 试玩修 剧情: no 「今天谁都没受伤」 the night someone was lost / fell · 2026-11-19 伤害分摊 E2: …or anyone bled today
    }
  }
  const MOOD_WHYS = new WeakMap(); // MOOD_WHY: deltas object → { id: [{ n, label, trait }] } (addMood with a label)
  const addMood = (deltas, id, d, label, trait) => { deltas[id] = (deltas[id] || 0) + d;
    if (MOOD_WHY && d && (label || trait)) { const w = MOOD_WHYS.get(deltas) || {}; MOOD_WHYS.set(deltas, w); (w[id] || (w[id] = [])).push({ n: d, label: label || null, trait: trait || null }); } };

  // ---------- v2.3 §B8 stat snapshots, previews and statChange events ----------
  const hpOf = (m) => (m.hp == null ? m.maxHp : m.hp); // hand-made / pre-2.3 members have no hp: full
  // 2026-11-14 片尾人物数据亮点: run.stats[id] is the whole-run tally (older saves: any missing field reads as 0). Only ever
  // added to, never read by the fight — lines tagged @stats can be stripped and the battle logs stay identical (tests/credits-stats).
  const STAT0 = () => ({ battles: 0, damage: 0, healed: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, best: null });
  function statOf(run, id) { if (!run.stats) run.stats = {}; return run.stats[id] || (run.stats[id] = STAT0()); }
  const bump = (S, k, n) => { S[k] = (S[k] || 0) + (n == null ? 1 : n); };
  const statsOf = (m, leader) => ({ hp: hpOf(m), maxHp: m.maxHp, atk: m.atk, skillLv: m.skill ? lvOf(m.skill) : 1, xp: xpOf(m), mood: m.mood == null ? null : m.mood, luck: m.luck || 0 }); // 2026-11-20 团长心情 · 幸运: the leader's mood is null when she has none (was: leader ? null)
  const diffStats = (a, b) => STAT_KEYS.filter((k) => a[k] !== b[k] && a[k] != null && b[k] != null).map((k) => ({ stat: k, from: a[k], to: b[k] }));
  function statChange(data, run, ev, id, before, source) {
    const m = run.members[id];
    if (!m || !before) return;
    const changes = diffStats(before, statsOf(m, isLeader(id)));
    if (changes.length) ev.push({ kind: 'statChange', id, name: nameOf(data, id), changes, source: source || null });
  }
  // stat part of an effect on a member-like object {hp,maxHp,atk,skill}: maxHp gains also heal by the gain, losses clamp hp
  function statEff(m, eff) {
    if (!eff) return;
    if (eff.type === 'stat' && eff.stat === 'atk') m.atk = Math.max(1, m.atk + eff.delta);
    else if (eff.type === 'stat' && eff.stat === 'maxHp') {
      const before = m.maxHp, hp = hpOf(m);
      m.maxHp = Math.max(3, m.maxHp + eff.delta);
      m.hp = clamp(hp + Math.max(0, m.maxHp - before), 0, m.maxHp);
    } else if (eff.type === 'stat' && eff.stat === 'hp') m.hp = clamp(hpOf(m) + eff.delta, 0, m.maxHp);
    else if (eff.type === 'xp') gainXp(m, eff.n || 0); // 2026-11-16 经验
    else if (eff.type === 'stat' && eff.stat === 'luck') m.luck = clamp((m.luck || 0) + eff.delta, LUCK_STORE_MIN != null ? LUCK_STORE_MIN : LUCK_MIN, LUCK_MAX); // 2026-11-20 幸运 · 2026-11-22f LUCK_BELOW_MIN
    // 2026-11-16: a skillUp left anywhere = the xp to her next level (a whole level: 威力 + 生命上限 + 技能); at the cap +XP_TRAIN xp
    // (was: skill.power + 1 alone, maxed → atk +1)
    else if (eff.type === 'skillUp') { const lv = m.skill ? lvOf(m.skill) : LV_CAP; gainXp(m, lv < LV_CAP ? XP_CUM[lv] - xpOf(m) : XP_TRAIN); }
  }
  // DESIGN-skill-level §3: what a skillUp really is for her right now (a maxed skill turns it into atk +1)
  const skillUpAs = (m) => (m.skill && lvOf(m.skill) >= LV_CAP ? { stat: 'xp', delta: XP_TRAIN } : { stat: 'skillLv', delta: 1 }); // 2026-11-16: maxed → xp
  const moodFloor = (data, run, id) => (hasTrait(data, id, 'loyal') && run.members[id].revealed.includes('loyal') ? -1 : -2);
  const PREVIEW_UNSET_MOOD = true; // 2026-11-22e 试玩5 #3「复盘 暗扣心情」: the leader's unset mood (null = 平静 0) showed no 心情 row in previews (Math.min(undefined) = NaN); now it shows 心情 0→-1. false = old
  // what giving `effs` (plus a plain mood delta) would do to member id; hidden traits are not leaked
  const PREVIEW_CHARGE = true; // 2026-11-23: a charge curse shows 充能满格 from → to in the target preview (false = mood only, as before)
  const DEBT_RIVAL_LEADER = true; // 2026-11-23: a rejected girl's 「你没有选她」 hits the leader when the girl you hired over her is gone (false = a random ally)
  const SUMMON_CALLS = true; // 2026-11-23 试玩 16: boss.summon.calls = how many groups she can call in all (0 = no end, the old way)
  function previewFor(data, run, id, effs, moodDelta) {
    const m = run.members[id], leader = isLeader(id);
    const before = statsOf(m, leader);
    if (PREVIEW_UNSET_MOOD && before.mood == null && !moodless(run, id)) before.mood = 0; // the leader's mood starts unset (= 0 平静)
    const sim = { hp: before.hp, maxHp: m.maxHp, atk: m.atk, xp: xpOf(m), luck: m.luck || 0, skill: { kind: m.skill && m.skill.kind, power: (m.skill && m.skill.power) || 0 } };
    let md = moodDelta || 0;
    for (const e of effs) { if (!e) continue; statEff(sim, e); if (e.type === 'mood') md += e.delta; if (e.type === 'token') md += 1; if (CARD_SIDE_MOOD && e.type === 'stat' && e.mood) md += e.mood; }
    const after = statsOf(sim, true);
    after.mood = moodless(run, id) ? null : clamp((m.mood || 0) + md, Math.min(PREVIEW_UNSET_MOOD ? m.mood || 0 : m.mood, moodFloor(data, run, id)), 2);
    const out = diffStats(before, after);
    const cd = PREVIEW_CHARGE ? effs.reduce((n, e) => n + (e && e.type === 'charge' ? e.delta || 0 : 0), 0) : 0; // 2026-11-23 试玩 15「面具印记的预览只写心情，没写充能」: 充能满格 10 → 11
    if (cd) { const f = fullOf({ side: 'ally', bond: m.bond || null, tokens: m.tokens || [] }) + (m.chargeSlow > 0 ? m.chargeSlow : 0); out.push({ stat: 'charge', from: f, to: f + cd }); }
    if (effs.some((e) => e && (e.type === 'skillUp' || e.type === 'xp')) && m.skill && after.skillLv !== before.skillLv) { // DESIGN-skill-level §5: 「暴击率 20% → 35%」
      const pk = perkOf(data, run, id), from = lvLine(m.skill.kind, before.skillLv, pk), to = lvLine(m.skill.kind, after.skillLv, pk); // 2026-11-24 伊芙: her own 掩护 count
      if (from !== to) out.push({ stat: 'skill', from, to, kind: m.skill.kind });
    }
    return out;
  }
  // 2026-11-16 经验条 (用户「锻炼的时候看不出经验」): where she stands — Lv, xp (cumulative), this level's start, the next level's xp (null = 满级)
  function xpInfo(m) {
    const lv = m && m.skill ? lvOf(m.skill) : 1, maxed = lv >= LV_CAP;
    const o = { xp: xpOf(m), lv, xpLvStart: XP_CUM[lv - 1], xpNext: maxed ? null : XP_CUM[lv], maxed };
    if (m && m.skill && m.skill.lv5) o.lv = 5; // 2026-11-25 Lv5
    if (maxed) { o.overStart = XP_CUM[LV_CAP - 1] + ((m && m.overUps) || 0) * OVER_STEP; o.overNext = o.overStart + OVER_STEP; o.overUps = (m && m.overUps) || 0; } // 满级加成 progress
    return o;
  }
  // what the 经验 part of `effs` does to member id: { gain, from, to (xpInfo), up (levels), atk, maxHp (from the level-ups), skill: { from, to } | null }; null = no xp
  function xpGainFor(data, run, id, effs) {
    const m = run.members[id];
    if (!m || !(effs || []).some((e) => e && (e.type === 'xp' || e.type === 'skillUp'))) return null;
    const sim = { hp: hpOf(m), maxHp: m.maxHp, atk: m.atk, xp: xpOf(m), luck: m.luck || 0, overUps: m.overUps || 0, skill: { kind: m.skill && m.skill.kind, power: (m.skill && m.skill.power) || 0 } };
    for (const e of effs) if (e && (e.type === 'xp' || e.type === 'skillUp')) statEff(sim, e);
    const from = xpInfo(m), to = xpInfo(sim), up = to.lv - from.lv;
    const pk = perkOf(data, run, id), sf = up && m.skill ? lvLine(m.skill.kind, from.lv, pk) : '', st = up && m.skill ? lvLine(m.skill.kind, to.lv, pk) : '';
    return { over: (sim.overUps || 0) - (m.overUps || 0), gain: to.xp - from.xp, from, to, up, atk: sim.atk - m.atk, maxHp: sim.maxHp - m.maxHp, skill: up ? { fromLv: from.lv, toLv: to.lv, from: sf !== st ? sf : '', to: sf !== st ? st : '' } : null }; // skill.from/to '' = this step's words don't change (e.g. 盾 Lv3 → Lv4)
  }
  // the leader has no mood: mood cards turn into something she can feel (reward: max HP +1).
  // FEEDBACK-1112 #28+31: a debuff on the leader costs DOUBLE what it costs a girl — stat ×2; a mood card (a girl loses
  // |delta|+1 mood) → max HP −2×(|delta|+1); 「第一次行动发呆」 → her first TWO actions. One rule: 「给团长：效果 ×2」.
  const LEADER_DEBUFF_X = 2;
  // 2026-11-20 用户「就直接 心情 −2（团长：−4）」: a mood curse card's delta IS her whole mood drop (the general 「被点名 −1」 is
  // already inside it, not added on top), and the leader (who has a mood now) pays it ×2. false = the old way (card −1, +1 named)
  const MOOD_CARD_TOTAL = true;
  // 2026-11-20 用户「团长心情 −4 也太过了」「团长 −3 吧」: a mood curse on the leader = the card's drop −1 (not ×2; ×2 was the moodless-leader rule)
  const LEADER_MOOD_EXTRA = 1;
  const LEADER_SLOW_ONCE = true; // 2026-11-22e 用户「开场慢一拍持续了两回合」: the leader's 迟疑 skips only her first action, like a girl's; false = old (first TWO actions)
  function leaderEff(eff, isReward, lm) {
    if (!eff) return eff;
    if (lm && eff.type === 'mood') return MOOD_CARD_TOTAL && !isReward && eff.delta < 0 ? Object.assign({}, eff, { delta: eff.delta - LEADER_MOOD_EXTRA /* was: eff.delta * LEADER_DEBUFF_X (−4) */ }) : eff; // 2026-11-20 团长心情: a mood card moves her mood (a curse ×2, like every other curse)
    if (isReward) return eff.type === 'mood' ? { type: 'stat', stat: 'maxHp', delta: 1 } : eff;
    if (eff.type === 'mood') return { type: 'stat', stat: 'maxHp', delta: -LEADER_DEBUFF_X * (Math.abs(eff.delta) + (MOOD_CARD_TOTAL ? 0 : 1)) }; // MOOD_CARD_TOTAL: the named −1 is inside the delta already
    if (eff.type === 'stat' && eff.stat === 'luck' && eff.delta < 0) return Object.assign({}, eff, { delta: eff.delta - 1 }); // 2026-11-22 厄运: the leader −1 more (not ×2)
    if (eff.type === 'stat' && eff.delta < 0) return Object.assign({}, eff, { delta: eff.delta * LEADER_DEBUFF_X });
    if (eff.type === 'status' && eff.status === 'slow-start') return LEADER_SLOW_ONCE ? eff : Object.assign({}, eff, { double: true });
    if (eff.type === 'charge' || eff.type === 'gold') return Object.assign({}, eff, { delta: eff.delta * LEADER_DEBUFF_X }); // 2026-11-19 诅咒维度: charge / gold ×2 too
    return eff;
  }
  // 信物 (tokens): each one does something real besides the +1 mood
  const TOKEN_FX = lazy(() => ({ [TX('token.hawkEye')]: 'hawkEye' /* 2026-11-17 爆发实验 猎人暴击流 */, [TX('token.hairRope')]: 'combo', [TX('token.guildBadge')]: 'guard', [TX('token.pocketWatch')]: 'opener', [TX('token.testArrow')]: 'arrowCharge', [TX('token.bladeStorm')]: 'bladeStorm', [TX('token.holySpring')]: 'holySpring' /* 2026-11-17 爆发实验 牧师供能流 */, [TX('token.shieldWall')]: 'shieldWall' })); // 2026-11-16 刃风护符: test-only 超级爆发 experiment // 2026-11-16 试射护符: test-only (L10 checks), not on sale
  // 2026-11-15 user: a keepsake (信物) never stacks — the same person can't take a second copy; nobody left → the card isn't offered
  // 2026-11-20 review #4: a keepsake is matched by a stable id (the key in data/text: engine.token.<id>), not by its name in the
  // current language. The run still stores the name (old saves unchanged); tokenKey() turns a name from ANY locale's table into the id,
  // so a save made in one language keeps its keepsakes in another. Cards carry effect.tokenId (tools/validate-data.mjs checks it).
  // TOKEN_BY_ID false = the old match (the name in the current language only).
  const TOKEN_BY_ID = true;
  const TOKEN_FX_ID = { luckCharm: 'luckCharm', chargeCharm: 'chargeCharm' /* 2026-11-22 */, shortString: 'shortString', openShield: 'openShield' /* 2026-11-22 开场护盾 */, echoEar: 'echoEar', flint: 'flint' /* 2026-11-21 充能信物 */, turnRing: 'turnRing' /* 2026-11-21 转向指环 */, hawkEye: 'hawkEye', hairRope: 'combo', guildBadge: 'guard', pocketWatch: 'opener', testArrow: 'arrowCharge', bladeStorm: 'bladeStorm', holySpring: 'holySpring', shieldWall: 'shieldWall' };
  let tokenKeyCache = { tb: null, map: null };
  function tokenKey(name) {
    const tb = textTable();
    if (tokenKeyCache.tb !== tb || !tokenKeyCache.map) {
      const map = new Map();
      for (const loc of Object.keys(tb || {})) for (const k of Object.keys(tb[loc] || {})) if (k.startsWith('engine.token.') && !map.has(tb[loc][k])) map.set(tb[loc][k], k.slice(13));
      tokenKeyCache = { tb, map };
    }
    return tokenKeyCache.map.get(name) || null;
  }
  const sameToken = (name, eff) => name === eff.tokenName || !!(TOKEN_BY_ID && eff.tokenId && tokenKey(name) === eff.tokenId);
  const hasTokenOf = (m, eff) => !!(m && eff && (m.tokens || []).some((t) => sameToken(t, eff)));
  const hasTokName_old_2026_11_20 = (m, eff) => !!(m && eff && eff.type === 'token' && (m.tokens || []).includes(eff.tokenName)); // eslint-disable-line no-unused-vars
  const hasTokName = (m, eff) => !!(m && eff && eff.type === 'token' && hasTokenOf(m, eff));
  // 2026-11-20 用户「已经买过一个传说护符了，后面的商店、战利品就不应该再出现了」(ONE_LEGEND_RELIC): once anyone in the party holds a
  // legendary keepsake (a legendary reward card's or a shop core item's token), no more legendary ones are offered. false = old.
  const ONE_LEGEND_RELIC = false; // 2026-11-22 用户「我当时说的是：买过一个传说护符，这个护符本身就不出现了」→ LEGEND_SELF_ONCE below (true = the old: no legendary at all once one is held)
  // LEGEND_SELF_ONCE: a legendary keepsake anyone in the party already holds is not offered again (loot or shop); the others still are
  const LEGEND_SELF_ONCE = true;
  const partyHolds = (run, eff) => !!(eff && run.party.some((id) => hasTokenOf(run.members[id], eff)));
  function ownsLegendRelic(data, run) {
    const names = new Set();
    for (const c of (data.cards && data.cards.rewards) || []) if (rarityId(c) === 'legendary' && c.effect && c.effect.tokenName) names.add(c.effect.tokenName);
    for (const it of shopItems(data)) if (it.slot === 'core' && it.effect && it.effect.tokenName) names.add(it.effect.tokenName);
    return run.party.some((id) => ((run.members[id] || {}).tokens || []).some((t) => names.has(typeof t === 'string' ? t : t && t.name)));
  }
  const tokenHolders = (run, card) => (card && card.effect && card.effect.type === 'token') ? run.party.filter((id) => hasTokName(run.members[id], card.effect)) : [];
  // 2026-11-22 用户「就牧师限定——如果牧师被献祭了，这个就不要出现」(HOLY_SPRING_PRIEST_ONLY): 圣泉护符 only for a priest (skill heal);
  // not offered (loot / shop) when the party has no priest; a non-priest can't take it. false = anyone (the old).
  const HOLY_SPRING_PRIEST_ONLY = true;
  const isHolySpring = (eff) => !!(eff && eff.tokenId === 'holySpring');
  const priestOnlyBlocks = (run, eff, id) => !!(HOLY_SPRING_PRIEST_ONLY && isHolySpring(eff) && id && !((run.members[id] || {}).skill && run.members[id].skill.kind === 'heal'));
  // 2026-11-22e 试玩5 #8「幸运 −6 时 名单上的梦 白给」(LUCK_FLOOR_BLOCK): a curse whose only effect is 幸运 down can't go to someone already
  // at LUCK_MIN (greyed with a reason); if the whole party is at the floor, anyone can take it (the old way, so the game never sticks). false = old
  const LUCK_FLOOR_BLOCK = false; // 2026-11-22f: off — 幸运 keeps going down (LUCK_BELOW_MIN) (was true)
  const luckOnlyDown = (eff) => !!(eff && eff.type === 'stat' && eff.stat === 'luck' && eff.delta < 0);
  const luckFloorIds = (run, eff) => {
    if (!LUCK_FLOOR_BLOCK || !luckOnlyDown(eff)) return [];
    const at = (run.party || []).filter((id) => ((run.members[id] || {}).luck || 0) <= LUCK_MIN);
    return at.length < (run.party || []).length ? at : [];
  };
  const partyHasPriest = (run) => (run.party || []).some((id) => ((run.members[id] || {}).skill || {}).kind === 'heal');
  const hasTok = (u, fx) => (TOKEN_BY_ID ? (u.tokens || []).some((t) => TOKEN_FX_ID[tokenKey(t)] === fx) : (u.tokens || []).some((t) => TOKEN_FX()[t] === fx)); // review #4: TOKEN_FX (by name) kept for TOKEN_BY_ID false
  // 2026-11-17 爆发实验 猎人暴击流 鹰眼护符 (test-only): a hunter with it gets 威力 +HAWK_EYE_ATK per charge event she receives
  // (HAWK_EYE_PER_PIP: per pip instead) and crit ×+HAWK_EYE_X per action she takes — both for the rest of this battle
  const HAWK_EYE_ATK = 1, HAWK_EYE_PER_PIP = false, HAWK_EYE_X = 0.2; // 2026-11-18 平衡: 0.5 → 0.3 (木桩 5 回合 1637 → 1351, 仍高) → 0.2 (快爆发流目标 1000–1100)
  // 2026-11-19 护符通用: the charge part (威力 +HAWK_EYE_ATK per charge event) works for ANY class holder; the crit part (+HAWK_EYE_X per action)
  // stays hunter-only (see the hawkX lines in act). Old (hunter-only charge part): u.skill.kind === 'aim' was also required here.
  // 2026-11-21 用户「猎人不是可以选择攻击目标吗？」: a girl who woke as herself (L11 MIRROR_WAKE, wokeMember) is one of ours in full —
  // class effects, relics, target lock, barks — only a plain turncoat doll stays cut off from them. (party sync / the 反水 view still read u.turned)
  const coat = (u) => !!(u && u.turned && !u.wokeMember);
  const hawkFed = (u, n) => { if (u.side === 'ally' && !coat(u) && u.skill && hasTok(u, 'hawkEye') && n > 0) u.hawkAtk = Math.min(RELIC_STACK_CAP, (u.hawkAtk || 0) + (HAWK_EYE_PER_PIP ? n : HAWK_EYE_ATK)); }; // 2026-11-20 防滚雪球: capped at +RELIC_STACK_CAP
  const PREVIEW_GOLD_SHORT = true; // 2026-11-22 试玩 round-3 #5: 当众点名 preview shows the short-of-gold extra (girl 心情 −1 more / leader 生命上限 −2); false = old (never shown)
  const PREVIEW_TRAIT_MOOD = true; // 2026-11-24: a reward preview counts the +1 of her revealed 贪心 / 骄傲 / 嫉妒; false = the old (note only)
  function cardPreview(data, run, card, isReward) {
    const eff = isReward ? card.effect || {} : curseUp(run, card.effect || {});
    const out = {};
    if (isReward && eff.type === 'item') return out;
    for (const id of run.party) {
      const m = run.members[id];
      let e = isLeader(id) ? leaderEff(eff, isReward, leaderMoodOn(run)) : eff;
      if (isReward && eff.type === 'stat' && eff.delta > 0 && m.revealed.includes('late-bloomer')) e = Object.assign({}, eff, { delta: eff.delta + 1 });
      let md = 0;
      if (!isReward && !(m.revealed.includes('calm') || (MOOD_WHY_NAME_ALL && hasTrait(data, id, 'calm')))) md = (MOOD_CARD_TOTAL && eff.type === 'mood' ? 0 : -1) + ((MOOD_WHY_NAME_ALL ? hasTrait(data, id, 'proud') : m.revealed.includes('proud')) ? -1 : 0);
      if (!isReward && m.revealed.includes('calm') && eff.type === 'mood') e = null;
      if (PREVIEW_TRAIT_MOOD && isReward && !isLeader(id) && e) for (const t of ['greedy', 'proud', 'jealous']) if ((MOOD_WHY_NAME_ALL || m.revealed.includes(t)) && hasTrait(data, id, t)) md += 1; // 2026-11-24 试玩「骄傲：给她心情多 +1，预览没显示」: shown traits only (a hidden one stays a surprise)
      if (PREVIEW_GOLD_SHORT && !isReward && eff.type === 'gold' && goldOf(run) < -((e && e.delta) || 0)) { // round-3 #5: a fine she cannot pay → the extra the apply step takes
        if (isLeader(id)) e = { type: 'stat', stat: 'maxHp', delta: -LEADER_DEBUFF_X }; else if (!m.revealed.includes('calm')) md -= 1;
      }
      out[id] = previewFor(data, run, id, [e].concat(isReward && e && e.type === 'token' && hpCostEff(eff) ? [hpCostEff(eff)] : []), md); // 2026-11-22 CHARGE_COST
    }
    return out;
  }
  // 2026-11-23 试玩13「嫉妒…选之前完全没提示」(REWARD_TRAIT_NOTE): a reward card's trait reactions, per target — only traits she has
  // already shown (revealed), so hidden ones stay a surprise. { targetId: ['薇奥拉爱嫉妒：心情 −1', …] }. false = none
  const REWARD_TRAIT_NOTE = true;
  // 2026-11-24 试玩「心情已经满了还写『骄傲：给她心情多 +1』」(TRAIT_NOTE_FULL_SKIP) · 「诅咒给葛蕾，小满掉心情，预览没提示」(DEBUFF_FRIEND_NOTE)
  const TRAIT_NOTE_FULL_SKIP = true, DEBUFF_FRIEND_NOTE = true;
  function debuffFriendNotes(data, run) {
    const out = {};
    if (!DEBUFF_FRIEND_NOTE) return out;
    for (const id of run.party) {
      const notes = [];
      for (const o of relatedTo(data, run, id)) { const rel = cand(data, o).relation; if (rel && CLOSE[rel.kind] && !isLeader(o)) notes.push(TX('debuff.friendNote', { name: nameOf(data, o), her: nameOf(data, id) })); }
      if (notes.length) out[id] = notes;
    }
    return out;
  }
  function rewardTraitNotes(data, run) {
    const out = {};
    if (!REWARD_TRAIT_NOTE) return out;
    const shown = (id, t) => run.members[id] && (MOOD_WHY_NAME_ALL || run.members[id].revealed.includes(t)) && hasTrait(data, id, t);
    for (const id of run.party) {
      const notes = [];
      for (const t of ['greedy', 'proud', 'jealous']) if (!isLeader(id) && shown(id, t) && !(TRAIT_NOTE_FULL_SKIP && (run.members[id].mood || 0) >= 2)) notes.push(TX('reward.traitNote.self', { name: nameOf(data, id), trait: TRAIT_LABELS()[t] || t }));
      for (const o of run.party) if (o !== id && shown(o, 'jealous')) notes.push(TX('reward.traitNote.jealousOther', { name: nameOf(data, o) }));
      if (notes.length) out[id] = notes;
    }
    return out;
  }
  // members in party whose relation points at `id`
  const relatedTo = (data, run, id) => run.party.filter((o) => o !== id && cand(data, o).relation && cand(data, o).relation.with === id);


  // ---------- v2.1 §E: what each girl remembers ----------
  function girlMem(run, id) {
    const M = run.memory || (run.memory = {});
    return M[id] || (M[id] = { id, conflict: null, sided: null, sidedFor: null, rival: null, cards: [], levels: [], departure: null, departLevel: null, mood: null, grudge: null, friend: null, teammates: null });
  }
  // her friend among the girls who were ever in the party (her own relation, or one pointing at her)
  function friendOf(data, run, id) {
    const c = cand(data, id);
    if (c.relation && c.relation.kind === 'friend' && run.members[c.relation.with] && !isLeader(c.relation.with)) return c.relation.with;
    return Object.keys(run.members).find((o) => !isLeader(o) && o !== id && cand(data, o).relation && cand(data, o).relation.with === id && cand(data, o).relation.kind === 'friend') || null;
  }
  // The recorded history, completed from older run fields (hand-made / pre-2.1 runs) where missing.
  function historyOf(data, run, id) {
    const h = clone((run.memory || {})[id]) || { id, conflict: null, sided: null, sidedFor: null, rival: null, cards: [], levels: [], departure: null, departLevel: null, mood: null, grudge: null, friend: null, teammates: null };
    const s = run.sacrificed.find((x) => x.id === id);
    const rj = run.rejected.find((x) => x.id === id);
    if (!h.departure) h.departure = s ? (s.mode === 'name' ? 'named' : 'taken') : rj ? 'rejected' : null;
    if (s && !h.cards.length) {
      for (const cid of s.snapshot.debuffs || []) h.cards.push({ card: cid, reward: false, level: null });
      for (const cid of s.snapshot.rewards || []) h.cards.push({ card: cid, reward: true, level: null });
    }
    for (const c of h.cards) if (!c.name) { const cd = cardById(data, c.card); c.name = cd ? cd.name : c.card; }
    if (s && h.mood == null) h.mood = s.snapshot.moodAtSacrifice;
    if (rj && !h.grudge) h.grudge = rj.grudge || null;
    if (!h.friend) h.friend = friendOf(data, run, id);
    return h;
  }

  // ---------- v2.1 §B: generated ability texts ----------
  // ---------- DESIGN-skill-level: 技能等级 Lv1..Lv4, each class grows its own way ----------
  // a 0..1 number from integers, NOT the run's rng (old seeds / sims / tests keep their numbers)
  function hashRand(...xs) {
    let h = 2166136261 >>> 0;
    for (const x of xs) { h = Math.imul(h ^ ((x | 0) >>> 0), 16777619) >>> 0; h ^= h >>> 15; }
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  }

  // ---------- 2026-11-19 伤害分摊: who each enemy hits (docs/SPEC-damage-spread.md v2 §2 / §3 / §6) ----------
  // Every enemy skill carries a target rule: front2 · backWeighted · rightmost · all · lowest (hp %) · strongest (威力).
  // The targets are rolled at the START of each round (the end of the round before / the battle opening) with hashRand on the
  // run seed — the run rng is never touched, so the formation screen can show round 1 exactly as it will play. After a
  // move / lock, front2 / rightmost follow the new positions (stored as a slot), the others keep their rolled ally (re-rolled
  // if she is down). TARGET_SPREAD false or ?spread=0 (or createRun opts.spread 0) → the old rules (leftmost / random archers).
  const TARGET_SPREAD = true; // 2026-11-19 伤害分摊: on/off
  const VETERAN_TEAM_ARMOR = 2; // 2026-11-19 伤害分摊 §5: 退伍老兵 = every ally +2 护甲 in round 1 (0 = the old: the leader +VETERAN_BLOCK)
  const BELL_FOLLOW_QUIET = true; // see followBell: no 「可能是某扇门上的钥匙」 line before the story (the story's last line names the bell)
  const OUTLANDER_GOLD = 20; // 2026-11-24 用户「外乡人改成初始金币 +20」 (replaces the extra shop shelf: OUTLANDER_SHOP_SLOT false)
  const OUTLANDER_SHOP_SLOT = false; // was true // 2026-11-19 伤害分摊 §5: 外乡人 = one more shelf in every shop (false = the old dead 「探索」 effect)
  const FRONT2_P_EARLY = 0.85, FRONT2_P = 0.7, FRONT2_EARLY_TO = 2; // L1–L2 85 / 15, L3 on 70 / 30
  const BACK_WEIGHT = 2; // backWeighted: slot 3 and later count ×2
  const WANDER_ON = true; // 2026-11-20 L1 史莱姆「乱撞」 (enemy / wave field wander); false = never
  const TARGET_RULES = ['front2', 'backWeighted', 'rightmost', 'all', 'lowest', 'strongest'];
  const FOE_ROGUE_FRONT = true; // 2026-11-24 用户「如果对方敌人是刺客（有角色的），还是从前排开打」: a rejected / returned rogue hits the first two like ours; false = the last two (old)
  const ROLE_TARGET = { tank: 'front2', warrior: 'front2', melee: 'front2', adc: 'backWeighted', mage: 'all', healer: 'lowest', rogue: FOE_ROGUE_FRONT ? 'other' : 'rightmost' }; // the rejected / returned girls by class
  const SPREAD_URL_OFF = !!(root && root.location && typeof root.location.search === 'string' && /[?&]spread=0(?:[&#]|$)/.test(root.location.search));
  const tuneOf = (run, k, d) => (run && run.tune && run.tune[k] != null ? run.tune[k] : d);
  const spreadOn = (run) => !!tuneOf(run, 'spread', TARGET_SPREAD && !SPREAD_URL_OFF);
  const veteranArmor = (run) => +tuneOf(run, 'veteranArmor', VETERAN_TEAM_ARMOR) || 0;
  const outlanderShop = (run) => !!tuneOf(run, 'outlanderShop', OUTLANDER_SHOP_SLOT);
  // 2026-11-19 换位/暂停连做 (用户拍板): SWAP_COST — a battle move swaps two ADJACENT members only, once per pause, and the
  // member moved (a.id) loses her next action (status 'swap-skip'; the other one acts normally). false (?swapcost=0, tune
  // swapCost) = the old free move. PAUSE_MULTI — move / useItem / advisorSkill no longer play the round: the effect lands now,
  // its event waits in B.pendingPre, and only 'continue' plays the round (with those events first). false (?pausemulti=0,
  // tune pauseMulti) = the old one-action pause.
  const SWAP_COST = true;
  const PAUSE_MULTI = true;
  const urlOff = (k) => !!(root && root.location && typeof root.location.search === 'string' && new RegExp('[?&]' + k + '=0(?:[&#]|$)').test(root.location.search));
  const SWAP_COST_URL_OFF = urlOff('swapcost'), PAUSE_MULTI_URL_OFF = urlOff('pausemulti');
  const swapCostOn = (run) => !!tuneOf(run, 'swapCost', SWAP_COST && !SWAP_COST_URL_OFF);
  const pauseMultiOn = (run) => !!tuneOf(run, 'pauseMulti', PAUSE_MULTI && !PAUSE_MULTI_URL_OFF);
  // 2026-11-20 团长心情 (用户批准, FEEDBACK-2026-11-20 平衡): the leader has a mood like the girls (same 5 levels, same effects:
  // 高昂 = 威力 +1, 崩溃 = 发呆 every other action / no charge). Moved by: debuff cards given to her (−1, plus a mood card's own
  // delta — no longer turned into max hp), heart cards in training, the quiet night (rest), a flawless win (+1, up to 1),
  // a won battle where someone fell (−1; at L3 her own fall), the −2 → −1 after a win. false (tune leaderMood 0) = the old moodless leader.
  const LEADER_MOOD = true;
  const LEADER_DOWN_MOOD_LEVELS = [3]; // the levels where the leader's own fall costs her −1
  const leaderMoodOn = (run) => !!tuneOf(run, 'leaderMood', LEADER_MOOD);
  const moodless = (run, id) => isLeader(id) && !leaderMoodOn(run);
  const LEADER_MOOD_UNSET_ZERO = true; // 2026-11-22e 试玩5 #7「团长的心情、幸运没显示」: the leader's mood starts unset — the view now says 0 (平静) instead of null (hidden); false = old
  const strHash = (s) => { let h = 7; for (const ch of String(s)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h; };
  // the rule of one enemy unit (before the one-strongest-per-wave cap)
  function baseTargetRule(u) {
    const sk = (u && u.skill) || {};
    if (u.focus) return 'other';
    if (sk.kind === 'spark') return 'all';
    if (mirrorAlly(u)) return sk.kind === 'backstab' ? 'other' : 'front2'; // 2026-11-21 真正的镜像: ours — the first two / the front-most (rollIntent: slot 0)
    if ((u.candidate || u.mirror) && ROLE_TARGET[u.role]) return ROLE_TARGET[u.role];
    if (TARGET_RULES.includes(sk.target)) return sk.target;
    if (sk.kind === 'backstab') return 'other'; // 食尸鬼 / 露西安「朱笔」: the first two, as before
    if (sk.kind === 'aim') return 'backWeighted';
    return 'front2';
  }
  // the rule this unit uses in its wave (cached on the unit): at most one 'strongest' per wave, the others → front2
  function targetRuleIn(B, u) {
    if (u.tRule) return u.tRule;
    let r = baseTargetRule(u);
    if (r === 'strongest' && (B.enemies || []).some((x) => x !== u && x.tRule === 'strongest')) r = 'front2';
    u.tRule = r;
    return r;
  }
  const hpPct = (x) => (x.maxHp > 0 ? x.hp / x.maxHp : 1);
  // pick an ally for a uid rule from the living list af (deterministic: seed, level, wave, round, unit, salt)
  function spreadPickUid(run, B, u, rule, af, roundNo, salt, not) {
    const pool = not ? af.filter((x) => x.id !== not) : af;
    if (!pool.length) return null;
    if (rule === 'lowest') return pool.reduce((b, x) => (hpPct(x) <= hpPct(b) ? x : b), pool[0]).id; // tie → the more right one
    if (rule === 'strongest') return pool.reduce((b, x) => ((x.atk || 0) > (b.atk || 0) ? x : b), pool[0]).id; // tie → the more left one
    const w = pool.map((x) => (rule === 'wander' ? 1 : af.indexOf(x) >= 2 ? BACK_WEIGHT : 1)), tot = w.reduce((a, b) => a + b, 0);
    let r = hashRand(run.seed || 0, B.level || 0, B.wi || 0, roundNo || 0, strHash(u.id), 23, salt || 0) * tot;
    for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r < 0) return pool[i].id; }
    return pool[pool.length - 1].id;
  }
  // roll this unit's targets for round roundNo (u.intent). Allies = B.allies (living), the order is the formation.
  function rollIntent(run, B, u, roundNo) {
    const af = (B.allies || []).filter((x) => x.hp > 0);
    const rule = targetRuleIn(B, u);
    const it = { round: roundNo, rule, slot: 0, uids: [], rerolls: 0 };
    if (rule === 'front2') {
      const p = (B.level || 0) <= FRONT2_EARLY_TO ? FRONT2_P_EARLY : FRONT2_P;
      it.slot = af.length < 2 || mirrorAlly(u) ? 0 : hashRand(run.seed || 0, B.level || 0, B.wi || 0, roundNo || 0, strHash(u.id), 19) < p ? 0 : 1;
    } else if (rule === 'backWeighted' || rule === 'lowest' || rule === 'strongest') {
      const a = spreadPickUid(run, B, u, rule, af, roundNo, 0);
      if (a) it.uids.push(a);
      if (a && rule === 'backWeighted' && Array.isArray(u.traits) && u.traits.includes('twinShot')) { const b = spreadPickUid(run, B, u, rule, af, roundNo, 101, a); if (b) it.uids.push(b); } // 灰羽军官: the second bolt at another one
    }
    // 2026-11-20 L1 史莱姆「乱撞」(FEEDBACK-2026-11-20 #2): u.wander of the rounds its target is any living ally (even odds), rolled
    // with the same seeded hashRand as the rest, so the intent shows it (kind 'wander') and the round plays it
    if (WANDER_ON && u.wander > 0 && af.length > 1 && rule !== 'all' && hashRand(run.seed || 0, B.level || 0, B.wi || 0, roundNo || 0, strHash(u.id), 29) < u.wander) {
      it.rule = 'wander'; it.slot = 0; it.uids = [spreadPickUid(run, B, u, 'wander', u.wanderBack && af.length > 1 ? af.slice(1) : af, roundNo, 7)]; // wanderBack (2026-11-20 L7 小史莱姆): never the front one
    }
    u.intent = it;
    return it;
  }
  function rollIntents(run, B, roundNo) {
    for (const u of B.enemies || []) if (u.hp > 0 && !(u.intent && u.intent.round === roundNo)) rollIntent(run, B, u, roundNo);
  }
  // who the rolled intent hits right now (store: keep a re-roll on the unit; false = a pure look for the view)
  function intentTarget(run, B, u, af, store) {
    if (!af.length) return null;
    let it = u.intent;
    if (!it || it.round !== B.round) it = rollIntent(run, B, u, B.round);
    switch (it.rule) {
      case 'front2': return af[Math.min(it.slot, af.length - 1)];
      case 'rightmost': return af[af.length - 1];
      case 'backWeighted': case 'lowest': case 'strongest': case 'wander': {
        const t = af.find((x) => x.id === it.uids[0]);
        if (t) return t;
        const id = spreadPickUid(run, B, u, it.rule, af, B.round, 1 + it.rerolls); // she is down → re-roll
        if (store) { it.rerolls += 1; it.uids[0] = id; }
        return af.find((x) => x.id === id) || af[0];
      }
      default: return af[0];
    }
  }
  // the intent contract for the UI (docs/SPEC-damage-spread.md §4): { kind, targets: [ally uid…], all }
  function intentView(run, B, u) {
    if (!(u.hp > 0)) return null;
    if (u.passive) return null; // 2026-11-20 L5 铜钟: never acts
    if (u.toll && tollDue(B, u, B.round)) return { kind: 'all', targets: [], all: true }; // 2026-11-20 L5 钟楼守卫: the toll round shows the all-hit
    if (u.xlPhase === 2 && u.xlMark != null) { const t = xlMarkTarget(B, u); return { kind: 'mark', targets: t ? [t.id] : [], all: false }; } // 2026-11-19 小铃强 玩偶弱: her knell — the portrait of whoever stands in the marked slot
    const af = (B.allies || []).filter((x) => x.hp > 0);
    const it = u.intent && u.intent.round === B.round ? u.intent : null;
    const rule = it ? it.rule : targetRuleIn(B, u);
    const sk = u.skill || {};
    if (sk.kind === 'heal' && (B.enemies || []).some((x) => x.hp > 0 && x.hp < x.maxHp && !x.bell)) return { kind: 'heal', targets: [], all: false };
    if (rule === 'all' && foeSplash(u)) { const n = SPARK_TARGETS[clamp((u.elv || 1) - 1, 0, SPARK_TARGETS.length - 1)]; if (n < af.length) return { kind: 'other', targets: af.slice(0, n).map((x) => x.id), all: false }; }
    if (rule === 'all' && girlSparkN(u) && sk.kind === 'spark') { const n = SPARK_TARGETS[clamp((u.elv || 1) - 1, 0, SPARK_TARGETS.length - 1)]; if (n < af.length) return { kind: 'other', targets: af.slice(0, n).map((x) => x.id), all: false }; }
    if (rule === 'all' && mirrorAlly(u) && sk.kind === 'spark' && SPARK_TARGETS[lvOf(sk) - 1] < af.length) return { kind: 'other', targets: af.slice(0, SPARK_TARGETS[lvOf(sk) - 1]).map((x) => x.id), all: false }; // 2026-11-21 真正的镜像: her spark reaches as many as ours
    if (rule === 'all') return { kind: 'all', targets: [], all: true };
    if (!af.length) return { kind: rule, targets: [], all: false };
    if (rule === 'other' || sk.kind === 'backstab') { // first two (食尸鬼 / 朱笔), or the last two for a rightmost rogue
      const two = rule === 'rightmost' ? af.slice(-2).reverse() : af.slice(0, 2);
      return { kind: rule === 'rightmost' ? 'rightmost' : 'other', targets: two.map((x) => x.id), all: false };
    }
    const save = u.intent;
    if (!it) u.intent = Object.assign({}, rollIntent(run, B, u, B.round)); // a look only: put the unit back below
    const t = intentTarget(run, B, u, af, false);
    const out = [t.id];
    const cur = u.intent;
    if (cur.uids[1] && cur.uids[1] !== t.id && af.some((x) => x.id === cur.uids[1])) out.push(cur.uids[1]);
    else if (cur.uids.length > 1 && af.length > 1) out.push(spreadPickUid(run, B, u, cur.rule, af, B.round, 101, t.id)); // 军官's second bolt
    const kind = cur.rule || rule; // 2026-11-20 乱撞: the rolled intent may have turned to 'wander'
    if (!it) u.intent = save;
    return { kind, targets: out, all: false };
  }
  // 2026-11-20 L4–L7 改版 L5 钟楼守卫 (用户批准): a unit with toll { every, n } rings the bell on every `every`-th round of its wave
  // instead of its own action — every living ally loses n (护甲 first, like 地震). Only while a living bell (u.bell, a passive
  // enemy unit) stands on its side: break the bell and the tolls stop, the guardian just strikes.
  function tollDue(B, u, roundNo) {
    const q = u.toll, wr = (roundNo || 1) - (B.waveStart || 1) + 1;
    return !!q && wr > 0 && wr % (q.every || 3) === 0 && (q.noBell || (B.enemies || []).some((x) => x.bell && x.hp > 0)); // 2026-11-23 noBell: the advisor boss tolls without a bell
  }
  // every living enemy's intent + each ally's aimedBy (an all-hit counts for everyone)
  function intentsView(run, B) {
    const ints = {}, aimed = {};
    for (const a of B.allies || []) aimed[a.id] = 0;
    for (const u of B.enemies || []) {
      const iv = intentView(run, B, u);
      if (!iv) continue;
      ints[u.id] = iv;
      if (iv.kind === 'heal') continue;
      if (iv.all) { for (const a of B.allies || []) if (a.hp > 0) aimed[a.id] += 1; }
      else for (const id of new Set(iv.targets)) if (aimed[id] != null) aimed[id] += 1;
    }
    return { intents: ints, aimedBy: aimed };
  }
  // stored as skill.power = upgrades taken (old saves read as-is); level = power + 1, capped
  const SKILL_LV_MAX = 4;
  // 2026-11-16 (ISSUES 五点五, 用户拍板): 等级 = 威力 + 生命上限 + 技能 together, driven by 经验. Lv x → x+1 costs 3x (cumulative
  // XP_CUM); each level: 威力 +1, 生命上限 +LV_HP (盾 +6, others +5 since 2026-11-16), skill one step (skill.power + 1). 木头 caps at LV_CAP (4); Lv5 (青铜+) is later.
  const XP_CUM = [0, 3, 9, 18, 30], LV_CAP = 4, LV_CAP_MAX = 5; // eslint-disable-line no-unused-vars
  // 2026-11-25 Lv5 (docs/DESIGN-2026-11-25-lv5-and-random-party.md, 用户「先做出来 switch off，不做解锁」): LV5_ON → at XP_CUM[4] (30) she
  // breaks through on her own (no cost): skill.lv5 = true, 威力 +1, 生命上限 +LV_HP. The battle reads sk.lv5 (lvOf stays ≤ 4, so every
  // Lv1–4 table is untouched). 盾 掩护全队 全额 · 猎人 打死后多出的伤害传给下一个敌人（只传一次，不暴击）· 法师 全体全额 · 刺客 每下全额 ·
  // 牧师 每个队友一份全额. Off = the game as before. No unlock yet (every girl can).
  let LV5_ON = false;
  const OVER_STEP = 6, OVER_ATK = 1, OVER_HP = 2; // 2026-11-16 满级加成: past LV_CAP, every 6 经验 → 威力 +1, 生命上限 +2
  const XP_DOWNED = true; // 2026-11-20: members who fell in a won battle still get the battle 经验 (false = living only, the old rule)
  const XP_BATTLE = 1, XP_TRAIN = 3; // every battle: each living member +1 · a campfire training card: +3 (some special cards +5)
  // 2026-11-18 平衡 (试玩反馈「战士血量没比猎人高多少」): per class — 盾 +8, 刺客 +4, 后排 (猎人 / 法师 / 牧师) +3; past the cap
  // 满级加成 生命 盾 +3 / 刺客 +2 / 后排 +1 (was +2 for all). LV_HP_BY_CLASS false = the old rule (LV_HP_OLD, OVER_HP).
  const LV_HP_BY_CLASS = true;
  const LV_HP_CLASS = { guard: 8, backstab: 4, strike: 5 }, LV_HP_BACK = 3, OVER_HP_CLASS = { guard: 3, backstab: 2, strike: 2 }, OVER_HP_BACK = 1;
  const LV_HP_OLD = (sk) => (sk && sk.kind === 'guard' ? 6 : 5);
  const LV_HP = (sk) => (!LV_HP_BY_CLASS ? LV_HP_OLD(sk) : sk && LV_HP_CLASS[sk.kind] != null ? LV_HP_CLASS[sk.kind] : LV_HP_BACK);
  const OVER_HP_OF = (sk) => (!LV_HP_BY_CLASS ? OVER_HP : sk && OVER_HP_CLASS[sk.kind] != null ? OVER_HP_CLASS[sk.kind] : OVER_HP_BACK);
  // old saves (no xp): read as the minimum xp of her current level
  const xpOf = (m) => (m && Number.isFinite(m.xp) ? m.xp : XP_CUM[(m && m.skill ? lvOf(m.skill) : 1) - 1]);
  // add n xp to a member-like { xp, atk, maxHp, hp, skill }; returns how many levels she gained
  function gainXp(m, n) {
    m.xp = xpOf(m) + Math.max(0, n || 0);
    let ups = 0;
    while (m.skill && lvOf(m.skill) < LV_CAP && m.xp >= XP_CUM[lvOf(m.skill)]) {
      m.skill.power = (m.skill.power || 0) + 1;
      m.atk += 1;
      const hp = hpOf(m), add = LV_HP(m.skill);
      m.maxHp += add;
      m.hp = Math.min(m.maxHp, hp + add);
      ups += 1;
    }
    // 2026-11-16 用户「满级了可以继续提升 血量 / 威力 +2 / +1」: past the cap, every OVER_STEP more 经验 = 威力 +OVER_ATK, 生命上限 +OVER_HP
    if (m.skill && lvOf(m.skill) >= LV_CAP) {
      const want = Math.floor(Math.max(0, m.xp - XP_CUM[LV_CAP - 1]) / OVER_STEP);
      while ((m.overUps || 0) < want) { m.overUps = (m.overUps || 0) + 1; m.atk += OVER_ATK; const hp = hpOf(m), oh = OVER_HP_OF(m.skill); m.maxHp += oh; m.hp = Math.min(m.maxHp, hp + oh); ups += 1; } // 2026-11-18: by class
      if (LV5_ON && !m.skill.lv5 && m.xp >= XP_CUM[LV_CAP_MAX - 1]) { m.skill.lv5 = true; m.atk += 1; const hp = hpOf(m), add = LV_HP(m.skill); m.maxHp += add; m.hp = Math.min(m.maxHp, hp + add); ups += 1; } // 2026-11-25 Lv5 突破
    }
    return ups;
  }
  // DESIGN-2026-11-14-three-factors (用户拍板): 威力 = how big one hit / heal share / block share is; 技能等级 = how many;
  // 加成 = how often (pseudo-random, see comboRoll). A pulled-in action gets 威力 +1 (CHAIN_POWER), not +depth.
  // 2026-11-16 (DRAFT-2026-11-16-class-levels 职业表): hunters 30/40/70%(+穿甲)/100% crit, always ×2 (was 30/60/90/100% at ×2/×2/×2.5/×3)
  // 2026-11-20 用户「猎人别太线性：20/40/60/80，100 留给 5 级，倍数跟着涨」: rate 20/40/60/80 %, crit ×2/×2.25/×2.5/×2.75 (old rate
  // [0.3, 0.4, 0.7, 1], x [2, 2, 2, 2] in *_old_2026_11_20). 每箭必暴 now only where the rate reaches 1 (no level has it yet)
  const CRIT_RATE_old_2026_11_20 = [0.3, 0.4, 0.7, 1], CRIT_X_LV_old_2026_11_20 = [2, 2, 2, 2]; // eslint-disable-line no-unused-vars
  const CRIT_RATE = [0.2, 0.4, 0.6, 0.8], CRIT_X = 2, CRIT_X_LV = [2, 2.25, 2.5, 2.75], CRIT_X_MAX = CRIT_X_LV[3];
  // 用户 2026-11-15 弓手加强: our hunters' crits from Lv3 穿甲 (ignore 护甲 / 伊芙挺身, straight to hp). Lv1–2 crits and enemy archers (×2) hit 护甲 first.
  // 2026-11-19 试玩修 界面 (switches; false = the old behaviour): OVERKILL_LOG — a hit past the last hp logs tr.overkill;
  // MIRROR_NAME_TAG — the L11 dolls are 「镜·<name>」; DUP_FOE_NUMBER — same-name foes of one wave get 1, 2, 3 …
  const OVERKILL_LOG = true, MIRROR_NAME_TAG = true, DUP_FOE_NUMBER = true;
  function numberDupFoes(list) {
    const n = {}; for (const u of list) if (!u.mirror && !u.candidate) n[u.name] = (n[u.name] || 0) + 1;
    const k = {}; for (const u of list) if (n[u.name] > 1 && !u.mirror && !u.candidate) { k[u.name] = (k[u.name] || 0) + 1; u.baseName = u.name; u.name = TX('battle.dupName', { name: u.name, n: k[u.name] }); }
  }
  const JACKPOT_X = 2; // 2026-11-15 妮可塔「通杀」: ×2 (skill.jackpot = the chance per hit; 2026-11-18 L10: jackpot 0, see bigEvery)
  // 2026-11-18 妮可塔 L10 大招: skill.bigEvery = n → every n-th round (R3 / R6 / R9 …) all her hits that round are ×JACKPOT_X, no dice.
  // One round ahead a narrator line warns (battle.bigTell). 0 / missing = off (the old jackpot roll still works when skill.jackpot > 0).
  const bigRoundOf = (sk, round) => !!(sk && sk.bigEvery > 0 && round > 0 && round % sk.bigEvery === 0);
  const CRIT_PIERCE_ENEMY = false, CRIT_PIERCE_LV = 3; // 设计规则: every class changes in kind at Lv3 — the hunter's is 暴击穿甲
  const CHAIN_POWER = 1; // 充能 extra action: 威力 +1
  // 试玩反馈 2026-11-16 #3 (用户 later that night): our hunters (role adc) shoot the LEFTMOST living enemy, unless the player
  // locked a target (action battle.setAim, CONTRACT「猎人锁定」) — see aimPick inside the battle. AIM_TARGET is a dev switch for
  // the no-lock default: 'lock' (= leftmost + player lock, the game) | 'rightmost' | 'lowest' (fewest hp, tie → rightmost) |
  // 'highest' (most hp, tie → leftmost) | 'leftmost'. Enemy archers are unchanged (random).
  const AIM_TARGET = 'lock';
  const DEBT_WHO_FIRST = true; // 2026-11-22 试玩 round-3 #9: a debt row reads 「伊芙 威力 -1」 (who loses what); false = old 「威力 -1 → 伊芙」
  const AIM_SKIP_FALLEN = true; // 2026-11-22 试玩 round-3 #4: a fallen hunter drops her lock (no 「目标倒下了，改瞄」 line, no lock shown); false = old (her lock followed too)
  // 2026-11-20 牧师治疗 (用户批准): HEAL_TRIAGE — each share goes to the endangered ally who can still be saved and needs the least
  // (aimed damage from the enemies' rolled intents vs hp + 护甲); nobody savable → the ally missing the most hp (tie → front-most).
  // false = the old rule (lowest hp). HEAL_PICK — at a pause the player may pick up to n allies for her shares (setHealTargets).
  const HEAL_TRIAGE = true, HEAL_PICK = true;
  // 2026-11-20 用户「牧师的目标选择改成只能针对一人，叫做重点照顾——先把这个人血加满，再考虑其他的自动规则」: one pick; every share
  // goes to her while she is hurt (the share that fills her spills into 护甲 as usual), the rest by the auto rule. false = the old
  // per-share picks (up to n allies, share i → pick i)
  const HEAL_FOCUS = true;
  function aimTarget(foes) {
    const a = foes.filter((x) => x && x.hp > 0);
    if (!a.length) return null;
    if (AIM_TARGET === 'leftmost' || AIM_TARGET === 'lock') return a[0];
    if (AIM_TARGET === 'lowest') return a.reduce((m, x) => (x.hp <= m.hp ? x : m), a[0]); // <= : a tie goes right
    if (AIM_TARGET === 'highest') return a.reduce((m, x) => (x.hp > m.hp ? x : m), a[0]); // > : a tie stays left
    return a[a.length - 1];
  }
  const LATE_HP_FROM = 6, LATE_HP_MIN = 10; /* 用户 2026-11-15: later levels, every enemy unit ≥ 10 hp */
  const COMBO_DECAY = 2; /* 用户 2026-11-15 晚: our rogue's 连击 does 2 less per hit (was 1) */
  // 2026-11-16 (职业表): 法师 2/2/3/全体 targets (was 2/3/4/全体); Lv3+ each action she charges herself SPARK_SELF more
  // 2026-11-20 用户「每升一级 +1 人」: 2/3/4/5 (old [2, 2, 3, Infinity] in SPARK_TARGETS_old_2026_11_20; skill Lv tops at 4, so no 全体 now)
  // 2026-11-20 用户「莉珂太 IMBA：受伤时暴击 +0.5，不是 ×1.5」(MARKUP_PLUS): 见血加价 adds MARKUP_ADD to the crit x (×2 → ×2.5);
  // false = old: the crit x × perk n (×2 → ×3)
  const MARKUP_PLUS = true, MARKUP_ADD = 0.5;
  const mk = (x, mx) => (mx === 1 ? x : MARKUP_PLUS ? x + MARKUP_ADD : x * mx);
  const SPARK_TARGETS_old_2026_11_20 = [2, 2, 3, Infinity]; // eslint-disable-line no-unused-vars
  const SPARK_TARGETS_old_2026_11_21 = [2, 3, 4, 5]; // eslint-disable-line no-unused-vars
  // 2026-11-21 用户「法师往下调一下，波及人数按等级 −1，第一级不波及」: Lv1 hits one, Lv2 2, Lv3 3, Lv4 4. The data skill texts still say
  // 「波及 **2** 个」 (the old Lv1) — SPARK_TEXT_BASE is the number to find there.
  // 2026-11-21 用户「自己行动的时候充能 +1 改成一个道具，不放到法师自带技能了」: SPARK_SELF_LV 3 → Infinity (the 随身打火石 keepsake, token flint, does it now)
  const SPARK_SELF_LV_old_2026_11_21 = 3; // eslint-disable-line no-unused-vars
  // 2026-11-21 用户「法师还是波及 +1 吧」: back to 2/3/4/5 (the 1/2/3/4 try kept in SPARK_TARGETS_tried_2026_11_21)
  const SPARK_TARGETS_tried_2026_11_21 = [1, 2, 3, 4]; // eslint-disable-line no-unused-vars
  const SPARK_TARGETS = [2, 3, 4, 5], SPARK_SELF_LV = Infinity, SPARK_SELF = 1, SPARK_TEXT_BASE = 2, FLINT_SELF = 1, ECHO_EAR = 1, SHORT_STRING = 1;
  // 试玩反馈 2026-11-16 #5: 法师 Lv3+ 灼烧 — every enemy she hits takes +BURN_ADD per hit (from anyone of ours) until the end of next round;
  // 牧师 Lv3+ 祝福 — every ally she heals has 威力 +BLESS_ADD until the end of next round. Neither stacks (a new one only refreshes the time).
  const BURN_LV = 3, BURN_ADD = 1, BLESS_LV = 3, BLESS_ADD = 1;
  const ONE_HEALER = true;
  const BROOD_REPLACE = true; // 2026-11-20 L7: a new small slime takes a fallen one's slot (like 露西安's summons); false = in on the mother's left, the fallen pruned at the next round start // 2026-11-20 one healer per enemy wave (see the padTo fill)
  const BROOD_CLEAR_END = true; // 2026-11-20: fallen small slimes leave at the end-of-round spit (false = old: at the next round start)
  const BROOD_KEEP = true; // 2026-11-20: the L7 mother stops splitting before her own hp drops below one new slime's (false = old: down to 1 hp)
  // 2026-11-20 用户「第 6 关敌方牧师应该能多重治疗，被治疗的人威力增加」: an enemy healer with the trait 'bless' gives 祝福 like ours (Lv3+)
  // 2026-11-17 爆发实验 法师刺客流 — 烈焰护符 (test-only, token searFlame): the holder's 灼烧 stacks — every hit she lands adds
  // SEAR_ADD 层 to that enemy, and a burning enemy takes +层数 on every hit from us. SEAR_KEEP: the stacks last the whole battle
  // (false = they still run out at the end of next round, like plain 灼烧, and restart from 0 after that).
  const SEAR_ADD = 1, SEAR_KEEP = true, // 2026-11-18 平衡: 2 → 1 (木桩 5 回合 1294, 快爆发流目标 1000–1100)
    SEAR_FOREVER = 99999; // 量过: +1 → L10 木桩 5 回合 910 / +2 → 1325 (KEEP true/false 一样，法师每回合都会续)
  const hasSear = (u) => (TOKEN_BY_ID ? (u.tokens || []).some((t) => tokenKey(t) === 'searFlame') : (u.tokens || []).includes(TX('token.searFlame'))); // review #4
  // 2026-11-20 防滚雪球（用户批准）: 刃风 / 鹰眼 威力 stacks and 烈焰 灼烧 层 per enemy stop at RELIC_STACK_CAP (old: no cap — SEAR_CAP_old_2026_11_20 = Infinity)
  const RELIC_STACK_CAP = 8, SEAR_CAP_old_2026_11_20 = Infinity; // eslint-disable-line no-unused-vars
  const SEAR_CAP = 6; // 2026-11-24 用户「焚痕最多 +6」 (was RELIC_STACK_CAP 8) // 2026-11-19 护符通用: most 灼烧 层 one enemy can carry
  // 试玩反馈 2026-11-14 晚 #17: levels add ONLY targets; damage is 威力 alone — main 威力 (lv kept for callers)
  // 试玩反馈 2026-11-15 (法师成长削弱): the others take max(1, ⌊威力/3⌋) (was ⌊威力/2⌋); 威力 0 splashes nothing
  const sparkMain = (p, lv) => p; // eslint-disable-line no-unused-vars
  const sparkSplash = (p, lv) => (p > 0 ? Math.max(1, Math.ceil(p / 2)) : 0); /* 用户 2026-11-16: 溅射改成一半 /2 rounded UP, min 1 (was /3, 2026-11-15 晚) */ // eslint-disable-line no-unused-vars
  // 牧师 per heal share: 'half' = ⌈威力/2⌉ (chosen 2026-11-14 by sim, see DESIGN-2026-11-14-block 实施记录) · 'minus2' = max(1, 威力 − 2)
  // 试玩反馈 2026-11-14 晚 (用户): the priest was too weak — 'full' = each share heals the full 威力
  const HEAL_FORMULA = 'full';
  const healShare = (p) => (HEAL_FORMULA === 'full' ? Math.max(1, p) : HEAL_FORMULA === 'minus2' ? Math.max(1, p - 2) : Math.ceil(Math.max(1, p) / 2));
  // 2026-11-16 (职业表): ours 护甲 = 威力 (one share), Lv2 掩护 one behind, Lv3 each hit taken = +1 pip to herself (taken), Lv4 own 护甲 +2 (plus)
  // (was { self 1/1/2/2, cover 0/1/1/2 } — kept as ENEMY_GUARD_LV for enemy guards, unchanged)
  // 2026-11-18 平衡 (「战士加甲效率也太低」): her own 护甲 from 盾击 = floor(威力 × self × GUARD_SELF_X) (+ Lv4 plus) — ×1.5 = 威力 + 威力/2,
  // so it grows with 威力 faster. 1 = the old rule (威力 × self). 掩护 shares stay 威力.
  const GUARD_SELF_X = 1.5;
  const guardSelf = (pw, g) => Math.floor(pw * g.self * GUARD_SELF_X) + (g.plus || 0);
  const _old_GUARD_LV_2026_11_21 = [{ self: 1, cover: 0 }, { self: 1, cover: 1 }, { self: 1, cover: 1, taken: 1 }, { self: 1, cover: 1, taken: 1, plus: 2 }];
  // 2026-11-24 用户「挨打充能只有玛尔塔有，不是 3 级 general；伊芙初始掩护 +1，后面升级每级多掩护一个人」(GUARD_PERKS_1124):
  // the class loses Lv3 挨打充能; 玛尔塔 perk 'bracedCharge' = 挨打充能 at every level; 伊芙 perk 'oathCover' = 掩护 = her level (1/2/3/4).
  // false = the old: Lv3+ 挨打充能 for every guard, 玛尔塔 铁砧不卸 (护甲留一半), 伊芙 挺身 (身后挨打先扣她的护甲) — the old perks are in candidates.json _old_2026_11_24
  const GUARD_PERKS_1124 = true;
  const LV4_KEEP_SHOWN = true; // 2026-11-24 试玩: Lv4 lines keep 「护甲不清」 (it read as dropped) and the skill card shows 护甲不清 / 伤害 + 当前护甲; false = the old text
  const DEBT_SIDED_WHO = true; // 2026-11-24: 「你没站在我这边」 names who you backed (she is the one it hits); false = the old bare line
  const XL_MARK_FIXED = 10; // 2026-11-24c 用户「终响打 10 好了」: the knell hits a flat 10 (护甲 still blocks); 0 = 威力 × XL_MARK_X
  // 2026-11-24 进阶难度 (docs/DESIGN-2026-11-22-ascension.md, 杀戮尖塔式: 每档加一条，叠加): run.ascension = N → rows 1..N all on.
  // Only via ?asc=N until it is settled; 0 / absent = the game as it is. Rows: { rule, n }
  const ASCENSION = [ // 用户 2026-11-24 定稿草案 (DIFF_LADDER: 青铜 = 1 … 星辰 = 9)
    { rule: 'enemyHp', n: 2 }, // 1 青铜: every enemy +2 max hp
    { rule: 'restLess', n: 3 }, // 2 白银: a campfire rest heals 3 less
    { rule: 'purse', n: 1 }, // 3 精钢: the purse 130 → 100 (PURSE_FIXED; the 4 dearest picks cost 85–88)
    { rule: 'startMood', n: 1 }, // 4 黄金: every hire starts one mood lower
    { rule: 'eliteAtk', n: 1 }, // 5 秘银: elites / bosses 威力 +1
    { rule: 'curseUp', n: 1 }, // 6 山铜: curse cards one step heavier
    { rule: 'winGold', n: 2 }, // 7 晶钻: 2 less gold a win
    { rule: 'eliteBlock', n: 6 }, // 8 龙鳞: elites / bosses open with 6 护甲
    { rule: 'allAtk', n: 1 }, // 9 星辰: every enemy 威力 +1
  ];
  // 山铜「诅咒卡加重一级」: stat / charge ×2, a fine ×1.5, the daze twice (the leader's own extra still comes on top in leaderEff)
  const curseUp = (run, eff) => {
    if (!eff || !ascOn(run, 'curseUp')) return eff;
    if (eff.type === 'stat' && eff.delta < 0) return Object.assign({}, eff, { delta: eff.delta * 2 });
    if (eff.type === 'charge' && eff.delta > 0) return Object.assign({}, eff, { delta: eff.delta * 2 });
    if (eff.type === 'gold' && eff.delta < 0) return Object.assign({}, eff, { delta: Math.round(eff.delta * 1.5) });
    if (eff.type === 'status' && eff.status === 'slow-start') return Object.assign({}, eff, { upDouble: true });
    return eff;
  };
  // 2026-11-24 用户「木头初始 130；精钢起 100」(PURSE_FIXED): fixed purses — 4 dearest picks cost 85–88, so 100 always covers them.
  // (tried the same day: the dearest picks summed (+20) — PURSE_BY_PICKS, dropped.) false = recruitEco purse (100) on every tier
  const PURSE_FIXED = true, PURSE_EASY = 130, PURSE_HARD = 100;
  const ascPurse = (data, run) => { if (!PURSE_FIXED || !run || !run.recruitPrice || run.recruitSpent) return; run.gold = ascOn(run, 'purse') ? PURSE_HARD : PURSE_EASY; };
  const ascLevel = (run) => Math.max((run && run.ascension) || 0, DIFF_LADDER && run && run.difficulty > 0 ? run.difficulty : 0);
  const ascOn = (run, rule) => { const a = ascLevel(run); let n = 0; for (let i = 0; i < Math.min(a, ASCENSION.length); i++) if (ASCENSION[i].rule === rule) n += ASCENSION[i].n; return n; };
  const GIRL_SPARK_SPLASH = true; // 2026-11-24: a rejected / returned mage hits her targets with the first full, the rest half (was full on each)
  // 墓穴的寒气: run.tune.chill = { fromLevel, start, n, start2, n2 } (tools / sims) or the ascension rule 'chill' (fromLevel 7, start 3, n 1, start2 6, n2 2)
  const CHILL_FLOOR = 1;
  const chillN = (run, level, r) => {
    const c = (run && run.tune && run.tune.chill) || (ascOn(run, 'chill') ? CHILL_DEFAULT : null);
    if (!c || (level || 0) < (c.fromLevel || 1)) return 0;
    if (c.ramp) return Math.min(c.max || Infinity, Math.max(0, (r - (c.start || 1) + 1) * c.ramp)); /* 每回合 +ramp */
    return r >= (c.start2 || Infinity) ? c.n2 || 0 : r >= (c.start || Infinity) ? c.n || 0 : 0;
  };
  const chillArmor = (run) => !!(run && run.tune && run.tune.chill && run.tune.chill.armor); /* 2026-11-25 模拟: 寒气先打护甲 */
  const CHILL_DEFAULT = { fromLevel: 7, start: 3, n: 1, start2: 6, n2: 2 };
  const SPLASH_ALL = true; // 2026-11-24: an enemy spark with skill.splashAll (小铃) hits everyone — the first full, the rest half (sparkSplash); false = full on everyone
  const SWAP_ANY = true; // 2026-11-24: an in-battle move may go to any slot (still once a pause, the mover skips her next action); false = neighbours only
  const SUMMON_ON_ACTION = true; // 2026-11-24: 露西安 calls her group on her own action (false = at round start, the old)
  const ADV_L10_INTRO = true; // 2026-11-24 see the foe-rule block
  const FOE_INTRO_KEEP_RULE = false; // 2026-11-24 tried true (both lines) — 用户「第 9 关顾问介绍了一遍、旁白也介绍了一遍，太长太公式了，简单说一下就行」→ her line only (the earlier 「没有介绍」 was the round banners)
  const GRUDGE_LOW_SOFT = true; // 2026-11-24 see the rejected squad: backed at the interview, not hired → as a foe her first action each fight is skipped (no 虚弱, no flashback); false = the old 虚弱 + flashback (she still acts)
  const SOFT_ONCE = true; // 2026-11-24b: the 心软 skip happens once a run (her first fight against you), with her own line (battle.softLine); false = every fight, no line
  const SOFT_FOE = true; // 2026-11-24 see skipReason
  const SIDE_COST = true; // 2026-11-24: candidates[].sideCost = gold you pay when you back her at the interview (琪琪 5); false = free
  const COVER_HALF = true; // 2026-11-24 用户「掩护加一半甲」: each covered ally gets half her 威力 in 护甲 (rounded down, at least 1); false = the full 威力 (the old). Ours only
  const coverGive = (pw) => (COVER_HALF ? Math.max(1, Math.floor(pw / 2)) : pw);
  const TAKEN_NO_OVERFLOW = true;
  // 2026-11-24 试玩「全军突击 / 地震 全体 −N，不写每个人掉了多少、被护甲挡了多少」(GROUP_HIT_EACH): the line lists each ally after the total
  const GROUP_HIT_EACH = true;
  const groupHitEach = (allies, targets) => (!GROUP_HIT_EACH || !(targets || []).length ? '' : TX('battle.groupHitList', { list: targets.map((tr) => {
    const t = (allies || []).find((x) => x.id === tr.uid), name = t ? t.name : tr.id;
    return tr.blocked > 0 ? TX('battle.groupHitItemBlocked', { name, n: tr.amount, b: tr.blocked }) : TX('battle.groupHitItem', { name, n: tr.amount }); }).join(TX('list.semi')) })); // 2026-11-24 用户: 挨打充能 stops at full (no overflow past the bar); false = the old (uncapped)
  const _GUARD_LV_old_2026_11_24 = [{ self: 1, cover: 0 }, { self: 1, cover: 1 }, { self: 1, cover: 1, taken: 1 }, { self: 1, cover: 1, taken: 1 }];
  // 2026-11-24b 用户「掩护是每级多 1 人，但是伊芙初始就多一人」: our guards cover 0 / 1 / 2 / 3 (was 0 / 1 / 1 / 1); 伊芙 (oathCover) one more at every level
  const GUARD_LV = GUARD_PERKS_1124 ? [{ self: 1, cover: 0 }, { self: 1, cover: 1 }, { self: 1, cover: 2 }, { self: 1, cover: 3 }] : _GUARD_LV_old_2026_11_24;
  const guardLvFor = (perk, i) => { const g = GUARD_LV[clamp(i, 0, GUARD_LV.length - 1)], pid = perk && perk.id; if (!GUARD_PERKS_1124 || !pid) return g;
    return pid === 'bracedCharge' ? Object.assign({}, g, { taken: 1 }) : pid === 'oathCover' ? Object.assign({}, g, { cover: g.cover + 1 }) : g; }; // 用户 2026-11-21: Lv4 +2 护甲 dropped (「威力就够了」); 掩护 3 人 tried and dropped (「先不要了」)
  const ENEMY_GUARD_LV = [{ self: 1, cover: 0 }, { self: 1, cover: 1 }, { self: 2, cover: 1 }, { self: 2, cover: 2 }];
  // 2026-11-16 (职业表): our rogues' 连击 2/2/3/4 hits (was Lv + 1 = 2..5); Lv3+ each hit +1 pip to her arrow side (on top of k)
  // 2026-11-20 用户「刺客 2/3/4/5，那就不充能了」: hits 2/3/4/5 and no Lv3+ 充能 per hit (old hits [2, 2, 3, 4], then [2, 3, 3, 4];
  // old BACKSTAB_GIVE_LV 3 in BACKSTAB_GIVE_LV_old_2026_11_20)
  const BACKSTAB_HITS_old_2026_11_20 = [2, 2, 3, 4]; // eslint-disable-line no-unused-vars
  const BACKSTAB_HITS = [2, 3, 4, 5], BACKSTAB_GIVE_LV_old_2026_11_20 = 3, BACKSTAB_GIVE_LV = Infinity, BACKSTAB_GIVE = 1; // eslint-disable-line no-unused-vars
  // 2026-11-16 (ISSUES 五点六) → 试玩后拍板 2026-11-16: NO generic self-charge any more (SELF_CHARGE 0, was 4); she charges her
  // neighbours by her arrow from Lv1 (NEIGHBOUR_LV 1, was 2). A ↔ member gives only her right side at Lv1 (k = her per-side k),
  // both sides from Lv BOTH_SIDES_LV. Class self-pips stay (法师 Lv3 SPARK_SELF, 盾 Lv3 挨打, 试射护符).
  const SELF_CHARGE = 0, NEIGHBOUR_LV = 1, BOTH_SIDES_LV = 2;
  // 2026-11-19 文字修 圣泉通用: a NON-priest holder — every charge she gives an ally = that ally 威力 +HOLY_SPRING_ANY for the battle
  // (HOLY_SPRING_ANY_CAP = most stacks one ally can take from it; Infinity = no cap). A priest holder keeps the stronger heal-share rule below
  // and does not also get this one. Old (2026-11-17 .. 11-19): priest-only — the relic did nothing on anyone else.
  const HOLY_SPRING_ANY = 1, HOLY_SPRING_ANY_CAP = Infinity;
  // 2026-11-19 文字修 圣泉通用 v2 (用户「治疗不是一直会发生的」): a PRIEST holder — every action she takes (healed anyone or not) = every living
  // ally 威力 +HOLY_SPRING_TEAM for the battle, at most HOLY_SPRING_TEAM_CAP stacks per ally. HOLY_SPRING_HEAL_OLD true brings back the old
  // heal-share rule (each share = 威力 +HOLY_SPRING_BLESS and +HOLY_SPRING_GIVE pips to the healed ally) instead.
  const HOLY_SPRING_HEAL_OLD = false, HOLY_SPRING_TEAM = 1, HOLY_SPRING_TEAM_CAP = Infinity;
  // 2026-11-19 文字修 圣泉 v3: not the whole team — N random living allies (herself included), N = her skill level; hashRand(seed, level, wave, round,
  // her action count, slot, 17) so replays stay stable. HOLY_SPRING_TEAM_ALL true = v2 (everyone).
  const HOLY_SPRING_TEAM_ALL = false;
  const HOLY_SPRING_BLESS = 2, HOLY_SPRING_GIVE = 2; // 2026-11-17 爆发实验 牧师供能流 圣泉护符 (test-only; tried 1/2: 5R 764, 25% win — too mild): each heal share = 威力 +BLESS for the battle; each healed ally +GIVE pips
  // 2026-11-19 护符通用 刃风护符: ANY class holder, 威力 +BLADE_STORM_ATK per ACTION (counts actions, not hits — a multi-hit mage / rogue gains
  // the same as anyone). Old: +1 per landed hit, rogue-only (BLADE_STORM_PER_ACTION false brings that back).
  // BLADE_STORM_RAMP: the rogue holder's 连击 hits go +1 each instead of −COMBO_DECAY (kept from 2026-11-17).
  const BLADE_STORM_PER_ACTION = true, BLADE_STORM_ATK = 1, BLADE_STORM_RAMP = true;
  // 2026-11-23 用户「刃风：一回合内每打中一次威力 +1，回合结束消失」(BLADE_STORM_ROUND; false = every action +1 for the battle)
  // · 烈焰：each enemy gets at most one 焚痕 per round from her (SEAR_PER_ROUND; false = one per hit)
  const BLADE_STORM_ROUND = true, SEAR_PER_ROUND = true;
  // 2026-11-19 护符通用 cap: a guard holder's 盾击 护甲 (威力 × 1.5, plus 掩护 shares) ignores her 刃风 / 鹰眼 stacks when RELIC_GUARD_BLOCK is false —
  // measured: without it a Lv3 guard with 刃风 or 鹰眼 won the 小铃 mirror fight 100% in every test party (70–75% without a relic).
  const RELIC_GUARD_BLOCK = false;
  // 2026-11-22 用户「幸运护符：每当有人触发幸运，威力 +1，最高 8；充能护符：每当有人被充能，威力 +1，最高 8」: u.luckCharmAtk / u.chargeCharmAtk
  const CHARM_CAP = 8, CHARGE_CHARM_EVERY = 2; // 充能护符: +1 every 2nd action that charged anyone (2026-11-22)
  const relicGrowOf = (u) => (RELIC_GUARD_BLOCK ? 0 : (u.stormAtk || 0) + (u.hawkAtk || 0) + (u.luckCharmAtk || 0) + (u.chargeCharmAtk || 0));
  const charmFeed = (B, tok, field, n) => { if (!(n > 0) || !B) return; for (const x of B.allies) if (x.hp > 0 && !(x.turned && !x.wokeMember) && hasTok(x, tok)) x[field] = Math.min(CHARM_CAP, (x[field] || 0) + n); };
  const TEST_ARROW_CHARGE = 2, BLADE_STORM_GIVE = 0; // 刃风护符 (test-only): every hit 威力 +1 for the battle. 2026-11-17 用户「不管充能 只管每刀威力 +1」: the +2 to both neighbours (and the forced both-ways charge) are gone
 // 2026-11-16 试射护符 (test-only keepsake): each arrow +2 more to herself
  // 2026-11-17 爆发实验 盾爆流 (v2, 用户「攻击带甲 / 甲不消失 / 甲高效叠加」, no 挨打长甲, no 护甲→伤害→护甲 loop):
  // GUARD_SLAM_LV4 (class rule since v3): our Lv4 guard hits 威力 + ⌊护甲 / SHIELD_WALL_DIV⌋ (not spent) and keeps ALL her 护甲 at round end
  // (v2 kept half). A new wave still starts from 0. Enemies unchanged. Her 盾击 护甲 is worked out from 威力 WITHOUT the 护甲 bonus (no self-loop).
  const GUARD_SLAM_LV4 = true; // 用户 2026-11-17 v3: Lv4 guard (class rule) hits 威力 + 护甲 and her 护甲 is never cut at round end (a new wave still clears it)
  // v3 (用户 2026-11-17「长甲要慢慢超过敌人的成长」): the keepsake only GROWS 护甲 (the no-cut / 威力 + 护甲 part is the Lv4 class rule now).
  // k-th time she fills up → +SHIELD_WALL_FULL + SHIELD_WALL_FULL_STEP * (k − 1) 护甲 (10, 15, 20, …); every action by another living ally → +SHIELD_WALL_ALLY.
  // Pips from neighbours give nothing (SHIELD_WALL_PIP 0). L10, 20 seeds — see tools/burst-lab/results-shield.md (v3).
  const SHIELD_WALL_DIV = 1, SHIELD_WALL_PIP = 0, SHIELD_WALL_ALLY = 0, SHIELD_WALL_TAKEN = false, SHIELD_WALL_FULL = 0, SHIELD_WALL_FULL_STEP = 0; const SHIELD_WALL_ACT = 1 /* 2026-11-24 用户「每次 +1，最多 +8」 (was 2) */, SHIELD_WALL_ACT_PROG = true; // 2026-11-18 平衡: 3 → 2 (盾击护甲 ×1.5 之后 10 回合 2933, 慢流派目标 1500–2000) // 2026-11-17 爆发实验 盾爆流 (用户「每次出手 额外 +5 甲 / 累计」): her k-th action → +ACT·k 护甲 (PROG) or +ACT flat
  const SHIELD_WALL_ACT_CAP = 8; // 2026-11-24 (was 10) // 2026-11-21 用户「铁壁护符最多 10 甲」: each action's gain grows +2, +4, … up to +10 (Infinity = the old, no cap)
  const BLOCK_CAP = 999; // 2026-11-17 用户: 护甲最多叠到 999 (every unit)
  // 2026-11-19 护符通用: 铁壁护符 grows 护甲 per action for ANY class holder (was guard-only: u.skill.kind === 'guard'). A non-guard's 护甲 still
  // clears at round end (clearBlock; only the Lv4 guard keeps it), so on her it is a per-round shield that grows with her action count.
  const hasWall = (u) => !!(u && u.side === 'ally' && !coat(u) && u.skill && hasTok(u, 'shieldWall'));
  const guardSlam = (u) => !!(GUARD_SLAM_LV4 && u && ((u.side === 'ally' && !coat(u)) || mirrorAlly(u)) && u.skill && u.skill.kind === 'guard' && lvOf(u.skill) >= 4);
  const GUARD_KEEP_LV3 = true; // 用户 2026-11-21「3级护甲不清」: our guard keeps all her 护甲 at round end from Lv3 (was Lv4, with 盾击)
  const guardKeep = (u) => (GUARD_KEEP_LV3 ? !!(GUARD_SLAM_LV4 && u && ((u.side === 'ally' && !coat(u)) || mirrorAlly(u)) && u.skill && u.skill.kind === 'guard' && lvOf(u.skill) >= 3) : guardSlam(u));
  const shieldWallOf = (u) => (guardSlam(u) && u.block > 0 ? Math.floor(u.block / SHIELD_WALL_DIV) : 0);
  // 2026-11-19 merge spread: backup — the two callers now use gainBlock (logged); kept, not called
  const wallFeed = (u, n, from) => { if (!(n > 0) || !hasWall(u) || u.hp <= 0) return; n = Math.min(n, Math.max(0, BLOCK_CAP - (u.block || 0))); if (!(n > 0)) return; u.block = (u.block || 0) + n; const bf = u.blockFrom || (u.blockFrom = {}); bf[from || u.id] = (bf[from || u.id] || 0) + n; };
  // 用户 2026-11-15 牧师变强: 「威力 = 加血，满了变护甲」 from Lv1 — what a share cannot heal becomes 护甲 on that ally; a share with
  // nobody left hurt goes whole as 护甲 to the lowest-hp ally (front-most on a tie). Everyone full before she acts → she attacks (unchanged).
  const HEAL_LV = [{ n: 1, over: true }, { n: 2, over: true }, { n: 3, over: true }, { n: 3, over: true, cleanse: true }]; // shares; Lv4 净化
  function lvOf(sk) { return clamp(1 + ((sk && sk.power) || 0), 1, SKILL_LV_MAX); }
  function hitsOf(sk) { return sk && sk.kind === 'backstab' ? BACKSTAB_HITS[lvOf(sk) - 1] : 1; } // rogues: 连击 2/2/3/4 hits (2026-11-16; was Lv + 1)
  function lvLine(kind, lv, perk) { // the plain words for one level: 「暴击率 35%」 · perk: 2026-11-24 伊芙's 掩护 count (guardLvFor)
    const i = clamp(lv, 1, SKILL_LV_MAX) - 1;
    switch (kind) {
      // 第六批 H1-3: say what this level does, with its own numbers (no vague "per level" wording, no 「+0」)
      case 'guard': { const g = Object.assign({}, guardLvFor(perk, i), { taken: GUARD_LV[i].taken }) /* 2026-11-24: 玛尔塔's 挨打充能 is her perk — not repeated on every level line */; return (g.cover ? TX('skill.lv.guardCover', { self: g.self * GUARD_SELF_X, cover: g.cover }) : TX('skill.lv.guard', { self: g.self * GUARD_SELF_X })) + (g.taken ? TX('skill.lv.guardTakenTag') : '') + (g.plus ? TX('skill.lv.guardPlusTag', { n: g.plus }) : '') + (GUARD_SLAM_LV4 && GUARD_KEEP_LV3 && (LV4_KEEP_SHOWN ? i >= 2 : i === 2) ? TX('skill.lv.guardKeepTag') : '') + (GUARD_SLAM_LV4 && i >= 3 ? (GUARD_KEEP_LV3 ? TX('skill.lv.guardSlamOnlyTag') : TX('skill.lv.guardSlamTag')) : ''); } // 2026-11-17 盾 4 级: 攻击 + 护甲、护甲不减 // 2026-11-16 用户「补上盾 4 级护甲 +2 的说明」 (+ Lv3 挨打充能)
      case 'aim': return CRIT_RATE[i] >= 1 ? TX('skill.lv.aimMax', { x: CRIT_X_MAX }) : (i >= CRIT_PIERCE_LV - 1 ? TX('skill.lv.aimPierce', { pct: Math.round(CRIT_RATE[i] * 100), x: CRIT_X_LV[i] }) : TX('skill.lv.aim', { pct: Math.round(CRIT_RATE[i] * 100), x: CRIT_X_LV[i] }));
      case 'backstab': return TX('skill.lv.backstab', { n: BACKSTAB_HITS[i] });
      case 'spark': return (SPARK_TARGETS[i] === Infinity ? TX('skill.lv.sparkAll') : SPARK_TARGETS[i] === 1 ? TX('skill.lv.sparkOne') : TX('skill.lv.spark', { n: SPARK_TARGETS[i] })) + (i >= BURN_LV - 1 ? TX('skill.lv.burnTag') : ''); // 2026-11-16 Lv3+ 灼烧
      case 'heal': { const h = HEAL_LV[i]; return (h.cleanse ? TX('skill.lv.healCleanse', { n: h.n }) : TX('skill.lv.heal', { n: h.n })) + (i >= BLESS_LV - 1 ? TX('skill.lv.blessTag') : ''); } // 2026-11-16 Lv3+ 祝福
      default: return '';
    }
  }
  // the whole ladder, for a chip's hover tip
  const lvLadder = (kind) => [1, 2, 3, 4].map((l) => TX('skill.lvLadderItem', { lv: l, text: lvLine(kind, l) })).join(TX('list.semi'));
  // ---------- DESIGN-skill-level §2: 个人特点 (perks), damage-only, allies only ----------
  const ELITE_REFS = { 'goblin-boss': 1, 'gate-guardian': 1, 'bandit-officer': 1, 'bandit-chief': 1, 'masked-champion': 1, 'fairy-demon': 1 };
  const isElite = (t) => !!(t && (t.boss || t.advisorBoss || t.waveBoss || t.champion || ELITE_REFS[t.ref]));
  // 2026-11-24 用户「团长选择的职业都是没有特殊加成的——这个职业的白板；一定不会被献祭，但拿不到这个职业的特殊加成」(LEADER_PLAIN):
  // the leader's class carries no perk (data.leader classes[].perk stays as data); false = the old per-class perks
  const LEADER_PLAIN = true;
  function perkOf(data, run, id) {
    if (isLeader(id)) { if (LEADER_PLAIN) return null; const cls = ((data.leader && data.leader.classes) || []).find((x) => x.id === (run && run.leader && run.leader.class)); return (cls && cls.perk) || null; } // LEADER_PLAIN 2026-11-24
    const c = (data.candidates || []).find((x) => x.id === id);
    return (c && c.perk) || null;
  }
  const perkText = (p) => (p ? `${p.name}：${p.text}` : null);
  // what she does on her own turn, with her real numbers (enemy = she stands on the enemy side)
  // 2026-11-19 伤害分摊: rule = the enemy's target rule (null = the old wording: leftmost / random archers)
  const RULE_FOE_TEXT = lazy(() => ({ front2: TX('skill.target.party.front2'), backWeighted: TX('skill.target.party.backWeighted'), rightmost: TX('skill.target.party.rightmost'), lowest: TX('skill.target.party.lowest'), strongest: TX('skill.target.party.strongest') }));
  const RULE_FOE = { front2: 1, backWeighted: 1, rightmost: 1, lowest: 1, strongest: 1 };
  // the rule in plain words, for the enemy skill's tip (heal.* = a healer's 「nobody hurt」 branch)
  const RULE_TIP = lazy(() => ({ front2: TX('skill.rule.front2'), backWeighted: TX('skill.rule.backWeighted'), rightmost: TX('skill.rule.rightmost'), all: TX('skill.rule.all'), lowest: TX('skill.rule.lowest'), strongest: TX('skill.rule.strongest'), other: TX('skill.rule.other'),
    'heal.front2': TX('skill.rule.heal.front2'), 'heal.lowest': TX('skill.rule.heal.lowest'), 'heal.backWeighted': TX('skill.rule.heal.backWeighted'), 'heal.rightmost': TX('skill.rule.heal.rightmost'), 'heal.strongest': TX('skill.rule.heal.strongest'), 'heal.all': TX('skill.rule.all'), 'heal.other': TX('skill.rule.other') }));
  function actionTextFor(skill, atk, enemy, role, elv, rule, perk) { // perk: 2026-11-24 伊芙 掩护 count (guardLvFor)
    if (!skill) return null;
    const ruleFoe = enemy && RULE_FOE[rule] ? RULE_FOE_TEXT()[rule] : null; // 2026-11-19 伤害分摊
    const backRule = enemy && rule === 'rightmost' && skill.kind === 'backstab'; // a returned rogue: the last two
    const ei = enemy && elv > 1 && FOE_LV_KINDS[skill.kind] ? elv - 1 : 0; // 用户 2026-11-15 第 4–7 关: an enemy above Lv1
    const lv = lvOf(skill), i = enemy ? ei : lv - 1;
    const d = (enemy && skill.kind === 'spark' && skill.full ? atk : rawAmount(skill.kind, atk, enemy)) + (enemy && skill.kind === 'spark' ? ei : 0);
    if (enemy && skill.kind === 'spark' && skill.splash && ENEMY_SPARK_SPLASH) return TX('skill.action.sparkEnemySplash', { m: SPARK_TARGETS[Math.min(ei, SPARK_TARGETS.length - 1)] - 1, dmg: d, splash: sparkSplash(d) }) + (ei ? TX('skill.action.lvTag', { lv: ei + 1 }) : '');
    if (enemy && skill.kind === 'spark' && skill.bigEvery > 0) return TX('skill.action.sparkBig', { dmg: d, n: skill.bigEvery, x2: d * JACKPOT_X }); // 2026-11-18 妮可塔 L10 大招
    if (enemy && skill.kind === 'spark' && skill.jackpot) return TX('skill.action.sparkJackpot', { dmg: d, pct: Math.round(skill.jackpot * 100), x2: d * JACKPOT_X }); // 2026-11-15 妮可塔「满场通杀」
    if (ei) { // her real numbers at this level (the same tables as ours: 掩护 / 连击 / 治疗份数; archers crit 30 / 60 / 90%)
      const etag = TX('skill.action.lvTag', { lv: ei + 1 });
      const foeE = ruleFoe || (skill.kind === 'aim' ? TX('skill.target.party.random') : TX('skill.target.party.leftmost'));
      switch (skill.kind) {
        case 'guard': { const g = ENEMY_GUARD_LV[ei], eb = skill.block || ENEMY_GUARD_BLOCK;
          return g.cover ? TX('skill.action.guardEnemyCover', { foe: foeE, dmg: d, block: eb * g.self, cover: g.cover, give: eb, lvTag: etag }) : TX('skill.action.guardEnemy', { foe: foeE, dmg: d, block: eb * g.self }) + etag; }
        case 'aim': return TX('skill.action.aimEnemyCrit', { foe: foeE, dmg: d, pct: Math.round(ENEMY_CRIT_RATE[ei] * 100), critDmg: d * CRIT_X, lvTag: etag });
        case 'backstab': return backRule ? TX('skill.action.backstabEnemyBackLv', { n: ei + 2, dmg: d, lvTag: etag }) : TX('skill.action.backstabEnemyLv', { n: ei + 2, dmg: d, lvTag: etag });
        case 'heal': return TX('skill.action.healEnemyN', { n: HEAL_LV[ei].n, heal: healShare(Math.max(1, atk)), foe: foeE, dmg: d, lvTag: etag });
        case 'spark': return TX('skill.action.sparkEnemy', { dmg: d }) + etag;
        default: break;
      }
    }
    // v2.3 §A[19]: hunters (adc) aim at the rightmost, a skill marked random at anyone
    const where = skill.random || skill.target === 'random' || (enemy && skill.kind === 'aim') ? 0 : role === 'adc' || skill.target === 'rightmost' ? 1 : 2; // v2.4 [18]: random / rightmost / leftmost
    const foe = ruleFoe ? ruleFoe : enemy ? [TX('skill.target.party.random'), TX('skill.target.party.rightmost'), TX('skill.target.party.leftmost')][where]
      : !enemy && role === 'adc' && where === 1 && AIM_TARGET !== 'rightmost' ? ({ lowest: TX('skill.target.enemy.lowest'), highest: TX('skill.target.enemy.highest'), leftmost: TX('skill.target.enemy.leftmost'), lock: TX('skill.target.enemy.leftmost') })[AIM_TARGET] // 2026-11-16 #3 (AIM_TARGET)
        : [TX('skill.target.enemy.random'), TX('skill.target.enemy.rightmost'), TX('skill.target.enemy.leftmost')][where];
    const tag = enemy ? '' : TX('skill.action.lvTag', { lv }); // 2026-11-14 keyword style: the numbers are in the line itself
    switch (skill.kind) {
      case 'guard': { if (enemy) return TX('skill.action.guardEnemy', { foe, dmg: d, block: skill.block || ENEMY_GUARD_BLOCK });
        const g = guardLvFor(perk, i), pw = Math.max(1, atk), slam = LV4_KEEP_SHOWN && GUARD_SLAM_LV4 && i >= 3 ? TX('skill.lv.guardSlamOnlyTag') : ''; // 2026-11-24 试玩「Lv4 卡上只写打最左侧 8」
        return (g.cover ? TX('skill.action.guardCover', { foe, dmg: d, block: guardSelf(pw, g), cover: g.cover, give: coverGive(pw), lvTag: tag }) : TX('skill.action.guard', { foe, dmg: d, block: guardSelf(pw, g), lvTag: tag })) + slam; } // 2026-11-18 GUARD_SELF_X
      case 'aim': if (enemy) return TX('skill.action.aimEnemy', { foe, dmg: d });
        return CRIT_RATE[i] >= 1 ? TX('skill.action.aimMax', { foe, critDmg: Math.floor(d * CRIT_X_MAX), lvTag: tag })
          : i >= CRIT_PIERCE_LV - 1 ? TX('skill.action.aimPierce', { foe, dmg: d, pct: Math.round(CRIT_RATE[i] * 100), critDmg: Math.floor(d * CRIT_X_LV[i]), lvTag: tag })
            : TX('skill.action.aim', { foe, dmg: d, pct: Math.round(CRIT_RATE[i] * 100), critDmg: Math.floor(d * CRIT_X_LV[i]), lvTag: tag });
      case 'backstab': return enemy ? (backRule ? TX('skill.action.backstabEnemyBack', { n: 2, dmg: d }) : TX('skill.action.backstabEnemy', { n: 2, dmg: d })) : TX('skill.action.backstab', { n: hitsOf(skill), dmg: d, lvTag: tag });
      case 'spark': { if (enemy) return TX('skill.action.sparkEnemy', { dmg: d });
        const tag = (i >= BURN_LV - 1 ? TX('skill.lv.burnTag') : '') + TX('skill.action.lvTag', { lv }); // 2026-11-22 试玩 round-3 #7: the party line keeps 灼烧 at Lv3+ (was: dropped)
        return SPARK_TARGETS[i] === Infinity ? TX('skill.action.sparkAll', { dmg: sparkMain(d, lv), splash: sparkSplash(d, lv), lvTag: tag })
          : sparkSplash(d, lv) > 0 ? TX('skill.action.spark', { n: SPARK_TARGETS[i], dmg: sparkMain(d, lv), splash: sparkSplash(d, lv), lvTag: tag }) : TX('skill.action.sparkOne', { dmg: sparkMain(d, lv), lvTag: tag }); }
      case 'heal': { const h = HEAL_LV[i];
        const hv = { n: h.n, heal: healShare(Math.max(1, atk)), foe, dmg: d, lvTag: tag };
        if (!enemy && PRIEST_STRIKE) hv.half = priestHalf(atk);
        hv.decay = HEAL_SPLIT && h.n > 1 ? TX('skill.action.healSplit', { half: Math.max(1, Math.ceil(hv.heal / 2)) }) : !enemy && HEAL_DECAY && h.n > 1 ? TX('skill.action.healDecay', { n: HEAL_DECAY }) : '';
        return enemy ? TX('skill.action.healEnemy', hv) : h.cleanse ? (PRIEST_STRIKE ? TX('skill.action.healCleanseStrike', hv) : TX('skill.action.healCleanse', hv)) : PRIEST_STRIKE ? TX('skill.action.healStrike', hv) : TX('skill.action.heal', hv); }
      default: return enemy && skill.vary ? TX('skill.action.defaultRange', { foe, dmg: d, max: d + skill.vary }) : TX('skill.action.default', { foe, dmg: d });
    }
  }
  // SPEC-11-13 F (rounds 2–3): the kill call for one action — n foes downed by it; 2+ only (no First Blood), Chinese only
  function killCallFor(n) {
    const W = [null, null, TX('battle.killCall.2'), TX('battle.killCall.3'), TX('battle.killCall.4'), TX('battle.killCall.5')];
    if (!(n >= 2)) return null;
    return { n, word: W[Math.min(n, 5)] };
  }
  // F round 2: her happy line for a multi-kill (lines-v2.multiKill.<id>, else the '*' fallback); picked without the rng
  function multiKillLines(data, id) {
    const M = dig(linesV2(data), 'multiKill') || {};
    const own = M[id];
    return Array.isArray(own) && own.length ? own : (Array.isArray(M['*']) ? M['*'] : []);
  }
  // what she does for the neighbours on her left / right (null = nothing) — DESIGN-2026-11-15-charge: 充能 +k each normal action
  // k = her pips per action (chargeK / baseK), keep = what an extra action passes on per generation (0.5, 发绳 0.75)
  function bonusTextFor(combo, k, enemy, keep) {
    if (!combo) return null;
    const mate = enemy ? TX('combo.mate.enemy') : TX('combo.mate.ally');
    const v = { k: Math.floor(k || 0), mate };
    const head = combo.direction === 'both' ? TX('combo.both', v) : combo.direction === 'prev' ? TX('combo.prev', v) : TX('combo.next', v);
    return head + (keep > CHARGE_KEEP ? TX('combo.decayCord') : TX('combo.decay'));
  }
  // her k (per neighbour, whole pips). Ours / returned girls: combo.charge or the white board; an ordinary enemy: u.enemyK (both
  // ways); the fairy: u.fairyK to every other enemy. Mood, bond, 战鼓, 好运 never change k (see STORE_* / DRUM_ADD / LUCK_ADD).
  function chargeK(B, u) {
    if (!u) return 0;
    if (u.combo) return Math.floor(baseK(u.combo));
    if (u.side === 'enemy') return Math.floor(u.ref === 'fairy-demon' ? u.fairyK || 0 : u.enemyK || 0);
    return 0;
  }
  // 蓄能: pips she gets on top of every charge she takes (> 0)
  function storeOf(B, u) {
    let n = 0;
    if (u.side === 'ally' && u.bond === 'high' && !coat(u)) n += STORE_BOND;
    if (CORD_STORE && u.side === 'ally' && !coat(u) && hasTok(u, 'combo')) n += CORD_STORE; // 2026-11-20 母亲的发绳
    if (u.side === 'enemy' && B) {
      if (B.emods && (B.emods.luck || (B.emods.overtime && !OVERTIME_ROUND)) && B.enemies.some((x) => x.advisorBoss && x.hp > 0)) n += STORE_BOSS; // overtime: BOSS_NEW_SKILLS 露西安
      if ((B.enemyCombat === 'luck' || (B.enemyCombat === 'overtime' && !OVERTIME_ROUND)) && u.candidate) n += STORE_BOSS;
    }
    return n;
  }
  // 好运 / 战鼓: every living ally (not broken) gets n pips right away; who is full acts at the start of our next phase
  function giftPips(B, n, from, name) {
    const out = [];
    for (const u of B.allies) {
      if (u.hp <= 0 || (u.side === 'ally' && !u.noMood && u.mood <= -2)) continue;
      const before = u.charge || 0;
      u.charge = before + n;
      hawkFed(u, n); // 2026-11-17 爆发实验 猎人暴击流
      wallFeed(u, n * SHIELD_WALL_PIP, from); // 2026-11-17 爆发实验 盾爆流
      out.push({ kind: 'charge', round: B.round, side: 'ally', gift: true, from, to: u.id, amount: n, before, after: u.charge, gen: 0, text: TX('battle.chargeGift', { src: name, name: u.name, n }) });
    }
    return out;
  }
  // what an action of generation gen passes on: floor at every generation (k 5 → 2 → 1 → 0; 发绳 5 → 3 → 2 → 1)
  function chargeAt(k, keep, gen) { let a = Math.floor(k); for (let i = 0; i < gen; i++) a = Math.floor(a * keep); return a; }
  // the direction a unit gives in: 'prev' | 'next' | 'both' | 'all' (the fairy) | null
  // 2026-11-21 转向指环 (TURN_RING; false = old: the ring does nothing): her charge turns round — 'next' → 'prev', 'prev' → 'next',
  // same k; a 'both' holder gives to ONE side (holder.ringSide, picked when the ring was given; default 'next') RING_BOTH_K pips.
  // Applied to the combo copy itself (battle unit, member view), so the arrow, k, bonus text and the Lv1 'both' → 'next' rule all agree.
  const TURN_RING = true, RING_BOTH_K = 4;
  function ringCombo(combo, holder) {
    if (!TURN_RING || !combo || !holder || !hasTok(holder, 'turnRing')) return combo;
    const d = combo.direction;
    if (d === 'next' || d === 'prev') return { ...combo, direction: d === 'next' ? 'prev' : 'next', charge: baseK(combo) };
    if (d === 'both') return { ...combo, direction: holder.ringSide === 'prev' ? 'prev' : 'next', charge: RING_BOTH_K };
    return combo;
  }
  // her combo before the ring (same as allyUnit: the leader's from the class data when LEADER_COMBO_LIVE)
  function baseComboOf(data, run, id) {
    const m = run.members[id], c = cand(data, id) || {};
    const lcc = isLeader(id) && LEADER_COMBO_LIVE ? ((((data.leader && data.leader.classes) || []).find((x) => x.id === (run.leader && run.leader.class)) || {}).combo) : null;
    return lcc || m.combo || c.combo || null;
  }
  // the ring was just put on her: a 'both' girl keeps the side the player picked (a.side), default 'next'
  function ringSideOn(data, run, id, eff, side) {
    if (!TURN_RING || !eff || eff.tokenId !== 'turnRing') return;
    const cb = baseComboOf(data, run, id);
    if (cb && cb.direction === 'both') run.members[id].ringSide = side === 'prev' ? 'prev' : 'next';
  }
  const chargeDirOf = (u) => (u.combo ? u.combo.direction : u.side === 'enemy' ? (u.ref === 'fairy-demon' ? (u.fairyK > 0 ? 'all' : null) : (u.enemyK > 0 ? 'both' : null)) : null);
  const chargeKeep = (u) => (!CORD_STORE && u.side === 'ally' && hasTok(u, 'combo') ? CHARGE_KEEP_CORD : CHARGE_KEEP); // 2026-11-20: with CORD_STORE the cord no longer changes the keep // 信物 母亲的发绳: 75% per generation

  // ---------- campfire (rest before every battle) ----------
  const actOf = (run) => (run.sacrificeCount > 0 ? 3 : run.sealed ? 2 : 1);
  const DARK_WHENS = { afterTakenOne: 1, afterSacrifice: 1, afterTaken: 1, afterDebuff: 1, afterDebuffSelf: 1, afterReturn: 1 }; // G2 #11: afterDebuffSelf — the leader kept the card
  const SACRIFICE_WHENS = { afterTakenOne: 1, afterSacrifice: 1, afterTaken: 1 }; // feedback-1112 #8
  // SPEC-2026-11-13 E1+: the night after the gate falls (L3 → L4) talks ONLY about the two rules (parties killing each
  // other; give one up in two rounds) — its own pool, split by the leader's answer; nothing else, no advisor small talk
  const SEAL_WHENS = { afterSealAccept: 1, afterSealRefuse: 1 };
  DARK_WHENS.afterSealAccept = 1; DARK_WHENS.afterSealRefuse = 1;
  DARK_WHENS.afterBetrayal = 1; DARK_WHENS.afterDoor = 1; // 2026-11-19 流程修 M3: the L10 night (after the throne) and the L11 night (behind the small door) talk only about it
  const noteRecent = (run, rec) => { run.recent = rec; };
  function campfire(data, run, events) {
    run.campfire = null;
    const talks = (data.campfire && Array.isArray(data.campfire.talks)) ? data.campfire.talks : [];
    const recent = run.recent;
    run.recent = null;
    if (!talks.length) return;
    const played = run.talksPlayed || (run.talksPlayed = []);
    const act = actOf(run);
    const girls = run.party.filter((id) => !isLeader(id));
    const lowMood = girls.find((id) => run.members[id].mood <= -1) || null;
    const highBond = girls.find((id) => run.members[id].bond === 'high') || null;
    const named = (t) => (t.who || []).filter((w) => w !== '*');
    // v2.4 [21]: girls named literally in a talk's lines never fill its '*' slots (she would speak her own name)
    const mentioned = (t) => girls.filter((g) => t.lines.some((raw) => String(raw && typeof raw === 'object' ? raw.text : raw).includes(nameOf(data, g))));
    // G2 #13: a talk that speaks ABOUT {target} (「她一直盯着…看」) never seats {target} herself in a '*' slot
    const subjOf = (ctx) => (ctx && ctx.targetId) || girls.find((g) => ctx && ctx.target && nameOf(data, g) === ctx.target) || null;
    const subject = recent ? subjOf(recent.ctx) : null;
    const aboutTarget = (t) => t.lines.some((raw) => /\{target\}/.test(String(raw && typeof raw === 'object' ? raw.text : raw)));
    const freeFor = (t) => girls.filter((g) => !named(t).includes(g) && !mentioned(t).includes(g) && !(subject && g === subject && aboutTarget(t)));
    const whenOk = (t) => {
      if (!t.when) return true;
      if (DARK_WHENS[t.when]) return !!recent && recent.when === t.when;
      if (t.when === 'lowMood') return !!lowMood;
      if (t.when === 'highBond') return !!highBond;
      return false;
    };
    const ok = (t) => t && t.id && Array.isArray(t.lines) && t.lines.length && !played.includes(t.id)
      && (!Array.isArray(t.act) || !t.act.length || t.act.includes(act))
      && named(t).every((w) => run.party.includes(w))
      && needOk(t)
      && (t.who || []).filter((w) => w === '*').length <= freeFor(t).length
      && whenOk(t);
    // 2026-11-19 试玩修 剧情: need gave / noGave — the returned girl did / did not get a card from the leader (afterReturn ctx.gave)
    function needOk(t) {
      if (!t.need) return true;
      const gave = !!(recent && recent.ctx && recent.ctx.gave);
      return t.need === 'gave' ? gave : t.need === 'noGave' ? !gave : true;
    }
    const sealNight = !!(recent && SEAL_WHENS[recent.when]);
    const eligible = talks.filter(ok).filter((t) => !sealNight || SEAL_WHENS[t.when]); // E1+: rules talk or none
    if (!eligible.length) return;
    const tiers = [eligible.filter((t) => DARK_WHENS[t.when]), eligible.filter((t) => !DARK_WHENS[t.when] && named(t).some((w) => !isLeader(w))), eligible];
    const baseCtx0 = Object.assign({}, (recent && recent.ctx) || {});
    // bind the slots: named ids as they are, '*' → random distinct party girls not named in the talk.
    // v2.4 [21]: a binding whose resolved line has its speaker say her own name (e.g. {target} bound as a speaker) is
    // re-rolled a few times, then the talk is skipped for another.
    function render(t, attempt) {
      const free = freeFor(t);
      const prefer = attempt === 0 ? (t.when === 'lowMood' ? lowMood : t.when === 'highBond' ? highBond : null) : null;
      const bound = (t.who || []).map((w) => {
        if (w !== '*') return w;
        const pick = prefer && free.includes(prefer) ? prefer : rngPick(run, free);
        free.splice(free.indexOf(pick), 1);
        return pick;
      });
      // 2026-11-19 试玩修 剧情: lowBond [slot…] — that slot must not be a high-bond girl (any-highbond: 「你也会有的」); re-rolled like a self-named line
      if (Array.isArray(t.lowBond) && t.lowBond.some((i) => bound[i] && run.members[bound[i]] && run.members[bound[i]].bond === 'high')) return null;
      const ctx = Object.assign({}, baseCtx0);
      const pref = t.when === 'lowMood' ? lowMood : t.when === 'highBond' ? highBond : null;
      if (!ctx.target && pref) ctx.target = nameOf(data, pref);
      const sub = (str) => String(str == null ? '' : str).replace(/\$(\d)/g, (m, i) => (bound[+i] != null ? nameOf(data, bound[+i]) : m));
      const out = [];
      for (const raw of t.lines) {
        const o = raw && typeof raw === 'object' ? Object.assign({}, raw) : { text: raw };
        if (typeof o.speaker === 'string' && /^\$\d$/.test(o.speaker)) o.speaker = bound[+o.speaker.slice(1)] || 'narrator';
        o.text = sub(o.text);
        const e = lineEvent(data, run, o, ctx, 'narrator', { key: 'campfire', talkId: t.id });
        if (selfNamed(e)) return null;
        out.push(e);
      }
      return { bound, out };
    }
    for (const tier of tiers) {
      const pool = tier.slice();
      while (pool.length) {
        const t = rngPick(run, pool);
        const stars = (t.who || []).includes('*');
        let r = null;
        for (let i = 0; i < (stars ? 4 : 1) && !r; i++) r = render(t, i);
        if (!r) { pool.splice(pool.indexOf(t), 1); continue; }
        played.push(t.id);
        for (const e of r.out) events.push(e);
        run.campfire = { talkId: t.id, who: r.bound };
        return;
      }
    }
  }

  // v2.4 [21]: a line must never have its speaker say her own name
  const selfNamed = (l) => !!(l && l.name && l.speaker !== 'narrator' && String(l.text || '').includes(l.name));

  // ---------- defeat epilogue ----------
  const EPI_FALLBACK = lazy(() => ({
    intro: [TX('ending.bad.intro1'), TX('ending.bad.intro2')],
    member: TX('ending.bad.member'),
    vengeful: TX('ending.bad.vengeful'),
    possessed: TX('ending.bad.possessed'),
    leader: [TX('ending.bad.leader')],
    advisor: [{ speaker: 'advisor', text: TX('ending.bad.advisor') }],
    outro: [TX('ending.bad.outro')],
  }));
  const asList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  function defeatEpilogue(data, run) {
    const D = linesV2(data).defeatEpilogue || {};
    const res = (arr, ctx, def) => asList(arr).map((r) => resolveLine(data, run, r, ctx || {}, def || 'narrator'));
    const pickVar = (x) => (x && !Array.isArray(x) && typeof x === 'object' && !('text' in x) ? x[run.advisor] || x.default || null : x);
    const fates = [];
    for (const id of run.party) if (!isLeader(id)) {
      const raw = dig(D, 'fates', id, 'member');
      fates.push({ id, name: nameOf(data, id), status: 'member', corruption: null, lines: res(raw != null ? raw : EPI_FALLBACK().member, { name: nameOf(data, id) }, raw != null ? id : 'narrator') });
    }
    const gone = run.rejected.map((r, i) => ({ id: r.id, status: 'rejected', corruption: 'vengeful', ord: i }))
      .concat(run.sacrificed.map((s, i) => ({ id: s.id, status: 'sacrificed', corruption: 'possessed', ord: 100 + i })));
    const firstSeen = (id) => { const r = run.enemyRecord[id]; return r && r.enemyAt.length ? Math.min(...r.enemyAt) : Infinity; };
    gone.sort((a, b) => firstSeen(a.id) - firstSeen(b.id) || a.ord - b.ord);
    for (const g of gone) {
      const raw = dig(D, 'fates', g.id, 'enemy');
      fates.push({ id: g.id, name: nameOf(data, g.id), status: g.status, corruption: g.corruption,
        lines: res(raw != null ? raw : EPI_FALLBACK()[g.corruption], { name: nameOf(data, g.id) }, raw != null ? g.id : 'narrator') });
    }
    const a = advisorData(data, run);
    const advRaw = D.advisor && !Array.isArray(D.advisor) && typeof D.advisor === 'object' && !('text' in D.advisor) ? D.advisor[run.advisor] : D.advisor;
    return {
      intro: res(pickVar(D.intro) || EPI_FALLBACK().intro),
      fates,
      leader: res(pickVar(D.leader) || EPI_FALLBACK().leader, {}, 'narrator'),
      advisor: a ? { id: a.id, name: a.name, lines: res(advRaw || EPI_FALLBACK().advisor, {}, 'advisor') } : null,
      outro: res(pickVar(D.outro) || EPI_FALLBACK().outro),
    };
  }

  // ---------- v2.4 [26] victory epilogue (normal ending: bitter; true ending: warm) ----------
  const VEPI_FALLBACK = lazy(() => ({
    normal: { intro: [TX('ending.normal.intro')], member: TX('ending.normal.member'),
      enemy: TX('ending.normal.enemy'), sacrificed: TX('ending.normal.sacrificed'),
      leader: [TX('ending.normal.leader')], advisor: [TX('ending.normal.advisor')], outro: [TX('ending.normal.outro')] },
    true: { intro: [TX('ending.true.intro')], member: TX('ending.true.member'), restored: TX('ending.true.restored'),
      leader: [TX('ending.true.leader')], advisor: [TX('ending.true.advisor')], outro: [TX('ending.true.outro')] },
  }));
  const VEPI_TOY = lazy(() => ([TX('ending.toy.1'), TX('ending.toy.2')]));
  const ENDING_TOY_WHO = true; // 2026-11-24 试玩「结局点名伊芙、莉珂、塞西，玩家不一定看得懂她们是谁」: the first line says she is the one you passed over at the interview; false = the old line
  const VEPI_TOY_WHO = lazy(() => ([TX('ending.toy.1who'), TX('ending.toy.2')]));
  function victoryEpilogue(data, run) {
    const V = linesV2(data).victoryEpilogue || {};
    const oc = run.outcome === 'true' ? 'true' : 'normal';
    const FB = VEPI_FALLBACK()[oc];
    const isLineObj = (x) => x && typeof x === 'object' && !Array.isArray(x) && 'text' in x;
    const byOc = (x) => (x && typeof x === 'object' && !Array.isArray(x) && !isLineObj(x) && ('normal' in x || 'true' in x || 'victory' in x) ? (oc === 'true' ? x.true : x.normal || x.victory) : x);
    const byAdv = (x) => (x && typeof x === 'object' && !Array.isArray(x) && !isLineObj(x) ? x[run.advisor] || x.default || null : x);
    const pick = (x) => { const y = byAdv(byOc(x)); return hasAny(y) ? y : null; };
    const res = (arr, ctx, def) => asList(arr).map((r) => resolveLine(data, run, r, ctx || {}, def || 'narrator'));
    const fate = (id, status, keys, corruption) => {
      const ctx = { name: nameOf(data, id) };
      for (const k of keys) { const raw = dig(V, 'fates', id, k); if (hasAny(raw)) return { id, name: ctx.name, status, corruption: corruption || null, lines: res(raw, ctx, id) }; }
      return { id, name: ctx.name, status, corruption: corruption || null, lines: res(FB[keys[keys.length - 1]] || FB.member, ctx, 'narrator') };
    };
    const fates = [];
    const girls = run.party.filter((id) => !isLeader(id));
    const gone = run.rejected.map((r, i) => ({ id: r.id, status: 'rejected', corruption: 'vengeful', ord: i }))
      .concat(run.sacrificed.map((x, i) => ({ id: x.id, status: 'sacrificed', corruption: 'possessed', ord: 100 + i })));
    const firstSeen = (id) => { const r = run.enemyRecord[id]; return r && r.enemyAt.length ? Math.min(...r.enemyAt) : Infinity; };
    gone.sort((a, b) => firstSeen(a.id) - firstSeen(b.id) || a.ord - b.ord);
    if (oc === 'true') { // every girl met comes back
      for (const id of girls) fates.push(fate(id, 'restored', ['restored', 'member']));
      for (const g of gone) fates.push(fate(g.id, 'restored', ['restored', 'member'], null));
    } else {
      for (const id of girls) fates.push(fate(id, 'member', ['member']));
      for (const g of gone) {
        if (g.status === 'rejected') { // feedback-1112 #41: beaten, she ends up in the doll cabinet too — the same fate as the ones you gave away
          fates.push({ id: g.id, name: nameOf(data, g.id), status: 'rejected', corruption: 'possessed', toy: true, lines: res(ENDING_TOY_WHO ? VEPI_TOY_WHO() : VEPI_TOY(), { name: nameOf(data, g.id) }, 'narrator') });
        } else fates.push(Object.assign(fate(g.id, g.status, ['sacrificed', 'enemy'], g.corruption), { toy: true }));
      }
    }
    const a = advisorData(data, run);
    return {
      kind: oc === 'true' ? 'true' : 'victory', outcome: run.outcome,
      intro: res(pick(V.intro) || FB.intro),
      fates,
      leader: res(pick(V.leader) || FB.leader, {}, 'narrator'),
      advisor: a ? { id: a.id, name: a.name, lines: res(pick(V.advisor) || FB.advisor, {}, 'narrator') } : null,
      outro: res(pick(V.outro) || FB.outro),
    };
  }

  // ---------- v2.2 §2 meta memory across runs (the UI stores it; the engine only reads it) ----------
  const META0 = () => ({ runs: 0, wins: 0, trueWins: 0, deaths: 0, lastLevel: 0, lastOutcome: null, lastIdentity: null, lastClass: null,
    lastSacrificed: [], lastRejected: [], lastGrudges: 0, seenTrue: false, dollsGiven: 0, dollsSaved: 0, // 2026-11-14 玩偶总账 (all runs, all tiers)
    fluoSpentLast: 0, fluoSpentTotal: 0, // 2026-11-14 芙洛 remembers your money
    unlocked: 0, tierLast: {}, tierCleared: {}, tierTrue: {} }); // v2.5 difficulty: highest unlocked tier, per-tier last death level / cleared · 2026-11-13: per-tier true ending reached
  function normMeta(m) {
    const o = Object.assign(META0(), m && typeof m === 'object' ? clone(m) : {});
    for (const k of ['runs', 'wins', 'trueWins', 'deaths', 'lastLevel', 'lastGrudges', 'dollsGiven', 'dollsSaved', 'fluoSpentLast', 'fluoSpentTotal']) o[k] = Number.isFinite(+o[k]) ? Math.max(0, Math.floor(+o[k])) : 0;
    for (const k of ['lastSacrificed', 'lastRejected']) o[k] = Array.isArray(o[k]) ? o[k].filter((x) => typeof x === 'string' && x) : [];
    o.seenTrue = !!o.seenTrue;
    o.unlocked = Number.isFinite(+o.unlocked) ? clamp(Math.floor(+o.unlocked), 0, DIFFICULTIES().length - 1) : 0;
    for (const k of ['tierLast', 'tierCleared', 'tierTrue']) o[k] = o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? o[k] : {};
    return o;
  }
  // Pure: the meta after a run that ended with this summary (view(...).summary on 'ending' / 'gameOver').
  function metaUpdate(meta, summary) {
    const m = normMeta(meta);
    const s = summary || {};
    const oc = s.outcome || null;
    m.runs += 1;
    if (oc === 'victory' || oc === 'true') m.wins += 1;
    if (oc === 'true') { m.trueWins += 1; m.seenTrue = true; }
    if (oc === 'defeat') m.deaths += 1;
    m.lastLevel = s.reachedLevel || 0;
    m.lastOutcome = oc;
    if (s.difficulty != null && DIFFICULTIES()[s.difficulty]) { // v2.5: any clear (normal is enough) unlocks the next tier
      const d = s.difficulty;
      if (oc === 'victory' || oc === 'true') {
        m.tierCleared[d] = true;
        if (oc === 'true') m.tierTrue[d] = true; // 2026-11-13: the tier badge glows
        if (d === m.unlocked && d < DIFFICULTIES().length - 1) m.unlocked = d + 1;
      } else if (oc === 'defeat') m.tierLast[d] = s.reachedLevel || 0;
    }
    const L = s.leader || {};
    m.lastIdentity = L.identityName || L.identity || null; // display names (slip lines speak them)
    m.lastClass = L.className || L.class || null;
    const fates = Array.isArray(s.fates) ? s.fates : [];
    m.lastSacrificed = fates.filter((f) => f.fate === 'sacrificed').map((f) => f.name);
    m.lastRejected = fates.filter((f) => f.fate === 'rejected').map((f) => f.name);
    m.lastGrudges = fates.filter((f) => f.fate === 'rejected' && f.grudge === 'high').length;
    const spent = Number.isFinite(+s.shopSpent) ? Math.max(0, Math.floor(+s.shopSpent)) : 0; // 2026-11-14 芙洛
    m.fluoSpentLast = spent; m.fluoSpentTotal += spent;
    return m;
  }
  // 2026-11-14 玩偶总账 (docs/BACKLOG「真真结局」): who this run handed to 小铃 as a doll, and who it got back. Pure, reads
  // only the run (no rng). Each girl at most once per list. given: written down / left to the rules (run.sacrificed, not
  // 'self'); a rejected girl beaten (her squad lost: run.enemyRecord[id].defeated) is carried off by the white gloves
  // (stories rejectedDefeat → 「新玩物」, the doll cabinet); a doll knocked
  // down in L11 (run.flags.l11DollDown — she was one); normal ending: every rejected girl goes into the doll cabinet, and so
  // does the advisor ('advisor:<id>'); defeat: the girls still in the party become the nobles' new toys. saved: every doll
  // knocked down in L11; the true ending brings every given girl back.
  function dollLedger(run) {
    const given = [], saved = [], add = (arr, id) => { if (id && !arr.includes(id)) arr.push(id); };
    if (!run) return { given, saved };
    const f = run.flags || {};
    for (const s of run.sacrificed || []) if (s && s.mode !== 'self') add(given, s.id);
    for (const r of run.rejected || []) { const er = (run.enemyRecord || {})[r.id]; if (er && er.defeated) add(given, r.id); }
    for (const id of Object.keys(f.l11DollDown || {})) { add(given, id); add(saved, id); }
    if (run.outcome === 'victory') {
      for (const r of run.rejected || []) add(given, r.id);
      if (run.advisor) add(given, 'advisor:' + run.advisor);
    }
    if (run.outcome === 'defeat') for (const id of run.party || []) if (!isLeader(id)) add(given, id);
    if (run.outcome === 'true') for (const id of given) if (!/^advisor:/.test(id)) add(saved, id);
    return { given, saved };
  }
  // Pure: book a run's dolls into the meta once (meta.dollsSeed = that run's seed). Call it when the run ends (with
  // metaUpdate) or when it is abandoned; a second call for the same seed (reload, 读档) changes nothing.
  function metaDolls(meta, run) {
    const m = normMeta(meta);
    if (!run || run.seed == null || m.dollsSeed === run.seed) return m;
    const L = dollLedger(run);
    m.dollsGiven += L.given.length; m.dollsSaved += L.saved.length; m.dollsSeed = run.seed;
    return m;
  }
  const greetingCase = (m) => (m.runs === 0 ? 'first' : m.seenTrue ? 'trueSeen' : m.wins > 0 ? 'cleared' : 'familiar');
  // lists of names, locale-aware: list.sep between items ('、' / ', '), list.and before the last one ('和' / ' and ')
  const joinNames = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(TX('list.sep')) + TX('list.and') + xs[xs.length - 1]);
  const listSeq = (xs) => xs.join(TX('list.sep')); // 「甲、乙、丙」: no 'and'
  function slipCtx(m) {
    const pos = (n) => (n > 0 ? String(n) : null);
    return { runs: pos(m.runs), wins: pos(m.wins), lastLevel: pos(m.lastLevel), lastGrudges: pos(m.lastGrudges),
      lastSacrificed: m.lastSacrificed.length ? joinNames(m.lastSacrificed) : null, lastRejected: m.lastRejected.length ? joinNames(m.lastRejected) : null,
      lastIdentity: m.lastIdentity || null, lastClass: m.lastClass || null };
  }
  const SLIP_RE = /\{(runs|wins|lastLevel|lastSacrificed|lastRejected|lastGrudges|lastIdentity|lastClass)\}/g;
  // fill a slip template (array of lines) or null when one of its placeholders has no value
  function fillSlip(tpl, ctx) {
    const arr = Array.isArray(tpl) ? tpl : [tpl];
    const out = [];
    for (const raw of arr) {
      const o = raw && typeof raw === 'object' ? Object.assign({}, raw) : { text: raw };
      let ok = true;
      o.text = String(o.text == null ? '' : o.text).replace(SLIP_RE, (mm, k) => { if (ctx[k] == null) ok = false; return ctx[k] == null ? mm : ctx[k]; });
      if (!ok) return null;
      out.push(o);
    }
    return out;
  }
  // §3 fairyWelcome: greeting for the meta case, one slip (not on the first run) + 「没事没事～」, then the tutorial
  function buildFairyWelcome(data, run) {
    const fz = linesV2(data).fairy;
    if (!fz && data.stories && data.stories.fairyWelcome) return null; // static story wins when there is no fairy block
    const get = (k) => (fz && Array.isArray(fz[k]) && fz[k].length ? fz[k] : FAIRY_FALLBACK()[k]);
    const m = run.meta;
    const asFairy = (raw, expr) => { const o = raw && typeof raw === 'object' ? Object.assign({}, raw) : { text: raw }; if (!o.speaker) o.speaker = 'fairy'; if (expr && !o.expr) o.expr = expr; return o; };
    const lines = get(greetingCase(m)).map((r) => asFairy(r));
    if (m.runs > 0) {
      const ctx = slipCtx(m);
      const ok = get('slip').map((t) => fillSlip(t, ctx)).filter(Boolean);
      if (ok.length) {
        const slip = rngPick(run, ok);
        slip.forEach((o, i) => lines.push(asFairy(o, i === 0 ? 'special' : null)));
        if (!slip.some((o) => new RegExp(TX('fairy.recoveryRe')).test(o.text))) lines.push(asFairy(FAIRY_FALLBACK().recovery));
      }
    }
    for (const r of get('tutorial')) lines.push(asFairy(r));
    return lines;
  }
  const fairyLines = (data, key) => { const b = dig(linesV2(data), 'fairy', 'battle', key); return Array.isArray(b) && b.length ? b : FAIRY_FALLBACK().battle[key]; };

  // v2 saves (engine version 2) gain the v2.2 fields on their next act
  function migrate(run) {
    if (!run.keys) run.keys = Object.assign(KEYS0(), { rules: (run.sacrificed || []).some((x) => x.mode === 'random') });
    if (run.keys.refuse == null) run.keys.refuse = !!(run.flags && run.flags.seal === 'refuse'); // 2026-11-13: key three (older saves)
    if (run.namedGirl == null) run.namedGirl = (run.sacrificed || []).some((x) => x.mode === 'name');
    if (!run.meta) run.meta = normMeta(null);
    if (run.bellLevel === undefined) run.bellLevel = null;
    if (!Array.isArray(run.relics)) run.relics = []; // v2.3
    if (!run.stats) run.stats = {};
    if (!Number.isFinite(run.gold)) run.gold = 0; // 2026-11-14 金币: saves from before the shop have none
    for (const id of Object.keys(run.members || {})) { const m = run.members[id]; if (m && m.hp == null) m.hp = m.maxHp; }
    run.version = 3;
  }

  // ---------- creation ----------
  function createRun(data, opts) {
    const seed = ((opts && opts.seed) != null ? opts.seed : 1) >>> 0;
    const run = {
      version: 3, seed, rng: seed, seq: 0,
      meta: normMeta(opts && opts.meta), keys: KEYS0(), namedGirl: false, bellLevel: null, bell: false, bellDone: false, wounded: false, // v2.2
      phase: 'story', level: 0, story: null, queue: [],
      leader: null, leaderStep: null, leaderEffects: [], advisor: null, advisorPresent: false, advisorMood: 0,
      interviewRound: 0, interviewStep: null, sided: {}, rejectedInfo: {},
      members: {}, party: [], rejected: [], sacrificed: [], items: [], sealed: false, flags: {},
      branch: null, returned: { first: null, final: null }, enemyRecord: {},
      options: null, suggestion: null, battle: null, debuffCount: 0, sacrificeCount: 0,
      outcome: null, lastEvents: [], history: [],
      memory: {}, reckoned: {}, talksPlayed: [], recent: null, campfire: null, // v2.1 §E per-girl history; campfire talks
      relics: [], stats: {}, camp: null, // v2.3
      leaderName: normName(opts && opts.leaderName) || defaultLeaderName(seed), // v2.4 [4]
      difficulty: null, // v2.5: null = untiered (tests, old saves); set by opts.difficulty or the 'difficulty' phase
      gold: shopEco(data).startGold, shopSpent: 0, // 2026-11-14 金币 + 芙洛的店
    };
    // 2026-11-20 招人花钱 (RECRUIT_PRICE): the run starts with the purse (100); each hire pays her price; what is left is the L1 gold.
    // Kept on the run (run.recruitPrice) so a save made mid-interview under the old rule never pays. opts.recruitPrice overrides (tests).
    const rp = opts && opts.recruitPrice != null ? !(opts.recruitPrice === false || opts.recruitPrice === 0 || opts.recruitPrice === '0') : RECRUIT_PRICE;
    if (rp) { run.recruitPrice = true; run.gold = recruitEco(data).purse; run.recruitSpent = 0; } // old flow: gold = startGold (10)
    if (opts && opts.difficulty != null) run.difficulty = clamp(Math.floor(+opts.difficulty) || 0, 0, DIFFICULTIES().length - 1);
    if (opts && opts.ascension != null && +opts.ascension > 0) run.ascension = clamp(Math.floor(+opts.ascension) || 0, 0, ASCENSION.length); // 进阶 (docs/DESIGN-2026-11-22-ascension.md): ?asc=N
    ascPurse(data, run);
    // 2026-11-19 伤害分摊 §6: per-run switches (tools / tests); absent = the constants (+ ?spread=0)
    if (opts && (opts.spread != null || opts.veteranArmor != null || opts.outlanderShop != null || opts.swapCost != null || opts.pauseMulti != null || opts.leaderMood != null)) {
      run.tune = {};
      // 2026-11-19 换位/暂停连做: per-run switches too
      if (opts.swapCost != null) run.tune.swapCost = !(opts.swapCost === false || opts.swapCost === 0 || opts.swapCost === '0');
      if (opts.pauseMulti != null) run.tune.pauseMulti = !(opts.pauseMulti === false || opts.pauseMulti === 0 || opts.pauseMulti === '0');
      if (opts.leaderMood != null) run.tune.leaderMood = !(opts.leaderMood === false || opts.leaderMood === 0 || opts.leaderMood === '0'); // 2026-11-20 团长心情
      if (opts.spread != null) run.tune.spread = !(opts.spread === false || opts.spread === 0 || opts.spread === '0');
      if (opts.veteranArmor != null) run.tune.veteranArmor = Math.max(0, Math.floor(+opts.veteranArmor) || 0);
      if (opts.outlanderShop != null) run.tune.outlanderShop = !(opts.outlanderShop === false || opts.outlanderShop === 0 || opts.outlanderShop === '0');
    }
    useRun(run);
    // §2.1: advisor first, then she asks who you are (identity), then class.
    run.fairyLines = buildFairyWelcome(data, run);
    run.queue = [
      { story: 'fairyWelcome' }, ...(opts && opts.pickDifficulty && run.difficulty == null ? [{ phase: 'difficulty' }] : []), { story: 'opening' }, { phase: 'advisor' }, { story: 'advisorAsks' }, { phase: 'leader', step: 'identity' },
      { story: 'leaderPrompt' }, { phase: 'leader', step: 'class' }, { story: 'interviewIntro' }, { phase: 'interview' }, { story: 'teamAssembled' }, { startLevel: 1 },
    ];
    advance(data, run, run.lastEvents);
    return run;
  }

  // Pop queue entries until one sets a waiting phase.
  // 2026-11-19 用户亲测 流程: a story whose ctx holds a pending hp change (sealRefuse) applies it when the story is left —
  // the player has seen the beat by then; the view shows the old hp until that line (view line hp { id, from, to })
  function settleStoryHp(run) {
    const c = run.story && run.story.ctx;
    if (!c || !c.hpPending) return;
    delete c.hpPending;
    const L = run.members[LEADER_ID];
    if (L && !c.teamTo) L.hp = c.hpTo;
    if (c.teamTo) for (const id of Object.keys(c.teamTo)) if (run.members[id]) run.members[id].hp = c.teamTo[id]; // SEAL_TEAM_HIT
  }
  function advance(data, run, events) {
    settleStoryHp(run);
    for (;;) {
      const step = run.queue.shift();
      if (!step) fail('queue exhausted');
      run.story = null;
      if (step.story) {
        if (step.story === 'sealing') { // §2.7 act 2 starts here even if the text is missing
          run.sealed = true;
          // 2026-11-19 流程修 H3: sealing now plays before the L3 reward — the bell draw waits until the reward is done
          // (startLevel), so the rng stream (reward cards, then the bell) stays the same as before
          const rewardNext = run.queue.some((x) => x && x.phase === 'reward');
          if (run.bellLevel == null && rewardNext) run.bellPending = true; // 2026-11-19 流程修 H3: drawn at the next startLevel
          if (run.bellLevel == null && !rewardNext) { const lv = levelsWith(data, 'bellNight', BELL_LEVELS).filter((n) => levelCfg(data, n)); run.bellLevel = lv.length ? rngPick(run, lv) : null; } // v2.2 §4.3
        }
        const ls = storyLines(data, run, step.story);
        if (!ls || !ls.length) continue; // missing story text: skip
        run.phase = 'story';
        run.story = { id: step.story, ctx: step.ctx || {} };
        // feedback-1112 #7: the sealing story ends on a choice (story.sealChoice refuse | accept; a plain continue = accept)
        if (step.story === 'sealing' && run.party.some(isLeader)) run.story.choice = 'seal';
        if (step.story === 'teamAssembled') teamAssembled(data, run, events);
        if (step.story === 'sideDoor' || step.story === 'sideDoorPass') run.story.door = true; // 2026-11-15 小门
        if (step.story === 'levelIntro' && run.exitHideNo) run.story.noCard = true; // the walk out: no card yet (EXIT_CARD_AFTER_TURN)
        else if (step.story === 'levelIntro') run.story.levelCard = (({ kind, ...c }) => c)(levelCardEvent(data, run, run.level));
        return;
      }
      if (step.startLevel) { startLevel(data, run, step.startLevel, step); continue; }
      if (step.levelCard && step.exitReveal) { run.exitHideNo = false; run.exitRevealed = true; const c = levelCardEvent(data, run, step.levelCard); events.push(Object.assign(c, { line: null, lines: [] })); continue; } // her turn is done: 第 10 关 · cardTitle, no exit quote
      if (step.levelCard) { events.push(levelCardEvent(data, run, step.levelCard)); continue; } // v2.4 [9]
      if (step.battle) { startFight(data, run, events); return; } // 叙事节奏 2026-11-13: queued by goSteps after the scene intro
      if (step.exitHeal) { // 2026-11-20 EXIT_FLOW: 「自由了」 — they patch each other up before leaving (the camp rest's numbers, no choice)
        const heals = [];
        for (const id of run.party) { const m = run.members[id]; if (!m) continue; const before = statsOf(m, isLeader(id)), from = hpOf(m); m.hp = Math.min(m.maxHp, from + (EXIT_HEAL_HP > 0 ? EXIT_HEAL_HP : restFor(data, run, m))); /* 2026-11-23 EXIT_HEAL_HP */ if (m.hp !== from) heals.push({ id, name: nameOf(data, id), from, to: m.hp }); statChange(data, run, events, id, before, 'rest'); }
        events.push({ kind: 'exitHeal', heals, text: TX('story.exitHeal') });
        continue;
      }
      if (step.removeAdvisor) {
        if (run.advisorPresent && !step.turn) advisorSay(data, run, events, 'leaving'); // feedback-1112 #35: in the throne room she turns instead
        run.advisorPresent = false;
        if (step.turn) run.advisorTurned = true; // 2026-11-19 试玩修 界面: the top bar shows her as 「已背叛」, not as our advisor
        if (step.turn) noteRecent(run, { when: 'afterBetrayal' }); // 2026-11-19 流程修 M3: that night's campfire talks about her
        events.push({ kind: 'advisorLeaves', turn: !!step.turn, text: step.turn ? TX('advisor.turned', { advisor: baseCtx(data, run).advisor }) : TX('advisor.left', { advisor: baseCtx(data, run).advisor }) });
        continue;
      }
      run.phase = step.phase;
      if (step.phase === 'leader') run.leaderStep = step.step || 'identity';
      if (step.phase === 'interview') {
        // 2026-11-20 招人花钱: only when every hire fits the purse (hires × max ≤ purse: the real game hires 4); else the old flow
        const re = recruitEco(data);
        if (run.recruitPrice && interviewRounds(data, run).length * re.max > re.purse && !run.recruitSpent) { delete run.recruitPrice; delete run.recruitSpent; run.gold = shopEco(data).startGold; }
        startInterviewRound(data, run, interviewRounds(data, run)[0]);
      }
      if (step.phase === 'prep') {
        run.bell = false; delete run.guidePending; // 2026-11-20 流程: a mark left by a cheat-won night does not carry over
        run.sealNight = !!(run.recent && SEAL_WHENS[run.recent.when]); // SPEC-2026-11-13 E1+: the night after the rules
        run.camp = { step: 'choose' }; // v2.3 §B1: one choice of three, then the formation
        if (step.march) { run.campfire = null; run.camp = { step: 'done', quiet: true, march: true, choice: 'march' }; } // feedback-1112 #35 (old saves only: L9 → L10 now skips the prep)
        else if (step.first) { run.campfire = null; run.camp = { step: 'done', quiet: true, first: true, choice: null }; guideBeforeFight(data, run, events); } // 叙事节奏 2026-11-13: L1, the formation only
        else if (step.quiet) { run.campfire = null; run.camp = { step: 'done', quiet: true, choice: 'followBell' }; } // back from following the bell: no talk, no rest
        else if (run.bellLevel != null && run.bellLevel === run.level && !run.bellDone) { // §4.3 the bell campfire
          run.camp.night = run.campNight = (run.campNight || 0) + 1; // G2 #10: every real campfire counts (the bell night keeps all its options)
          nightHeal(data, run, events);
          // feedback-1112 #8: the first night after a sacrifice always talks about it — even when the bell rings that night
          const sacNight = run.recent && SACRIFICE_WHENS[run.recent.when];
          run.bell = true; run.campfire = null;
          if (sacNight) campfire(data, run, events); else run.recent = null;
          events.push({ kind: 'bell', level: run.level });
          for (const raw of storyLines(data, run, 'bellEvent') || []) events.push(lineEvent(data, run, raw, {}, 'narrator', { key: 'bell' }));
        } else { run.camp.night = run.campNight = (run.campNight || 0) + 1; nightHeal(data, run, events); campfire(data, run, events); if (!run.sealNight) guideBeforeFight(data, run, events); } // E1+: no advisor small talk on the rules night · G2 #10: count the night
        // 2026-11-18 growth-flow round 2 (用户「规则之夜可以锻炼，但要发生在篝火选择之前」): on the rules night the camp opens on a
        // training (pick who → her 1-on-1 → 3 cards), then the usual rest / train choice. RULES_NIGHT_TRAIN_FIRST = false: choice only.
        if (RULES_NIGHT_TRAIN_FIRST && !CAMP_EXPLORE && run.sealNight && run.camp.step === 'choose' && !run.bell) Object.assign(run.camp, { step: 'train-pick', preTrain: true });
        if (!step.quiet) lowHpWarn(data, run, events);
        if (!step.quiet) prepWarn(data, run, events); // 2026-11-19 流程修 M1: not again on the quiet prep after the bell (was said twice) · 用户 2026-11-15 L9: the advisor's warning (先攻), in the camp talk before the formation
        shopOpen(data, run); // 2026-11-14: before L3 / L6 / L9 芙洛 turns up (not a campfire action)
      }
      run.rewardKind = step.phase === 'reward' && step.blessing ? 'blessing' : null; // 2026-11-18 小铃的祝福 reuses the reward screen
      if (run.rewardKind === 'blessing') { run.options = blessingPool(data).map((c) => c.id); return; }
      if (step.phase === 'reward' || step.phase === 'debuff') {
        let pool = step.phase === 'reward' ? data.cards.rewards : data.cards.debuffs;
        pool = pool.filter((c) => !c.disabled);
        if (step.phase === 'reward') pool = pool.filter((c) => !c.teamOnly); // 2026-11-24 全队卡: only on a teamLoot level
        if (LOOT_RETIRED) pool = pool.filter((c) => !c.retired); // 2026-11-20d: retired loot cards stay in the data, off the draw // 2026-11-20 用户: 面具印记 (charge +1 pip) dropped from the pool; the card + its 'charge' effect stay as a backup
        if (step.phase === 'reward' && bagFull(run)) pool = pool.filter((c) => !(c.effect && c.effect.type === 'item')); // v2.4 [24]
        if (step.phase === 'reward') { run.rewardRolls = (run.rewardRolls || 0) + 1; pool = pool.filter((c) => { const oc = offerChanceOf(run, c); return !(oc >= 0 && oc < 1) || hashRand(run.seed || 0, run.level || 0, run.rewardRolls, strHash(c.id), 61) < oc; }); } // 2026-11-22d offerChanceOf (was c.offerChance) // 2026-11-20 防滚雪球: a card with offerChance joins this draw's pool only that share of the time (前辈的批注 0.3); hashRand, so the run rng stream is untouched
        if (step.phase === 'reward') pool = pool.filter((c) => rarityOk(c, run.level)); // 2026-11-18 growth-flow: rarer keepsakes only from later levels
        if (step.phase === 'reward' && ONE_LEGEND_RELIC && ownsLegendRelic(data, run)) pool = pool.filter((c) => rarityId(c) !== 'legendary'); // 2026-11-20 ONE_LEGEND_RELIC
        if (step.phase === 'reward' && LEGEND_SELF_ONCE) pool = pool.filter((c) => !(rarityId(c) === 'legendary' && partyHolds(run, c.effect))); // 2026-11-22: that one keepsake only
        if (step.phase === 'reward') pool = pool.filter((c) => tokenHolders(run, c).length < run.party.length);
        if (step.phase === 'reward' && HOLY_SPRING_PRIEST_ONLY && !partyHasPriest(run)) pool = pool.filter((c) => !isHolySpring(c.effect)); // 圣泉: no priest → not offered // 2026-11-15: everyone has this keepsake → not offered
        const n = step.phase === 'reward' ? LOOT_N + ((leaderHas(run, 'extra-option') || advisorFlow(data, run) === 'fortune') ? 1 : 0) : 3; // 2026-11-20 用户「战利品 2 选 1」: LOOT_N (old 3; 幸运星 +1) // H1-1 妮可塔「幸运星」: 4, never 5 with both
        if (step.phase === 'reward' && SAME_RARITY_LOOT) { // 2026-11-24 用户「战利品三选一必须是同一稀有度」+「传说护符只能买」: roll a rarity (RARITY_W by level) among those
          // with enough cards, then draw only from it; legendary never drops (shop only)
          pool = pool.filter((c) => rarityId(c) !== 'legendary');
          const W = RARITY_W(run.level || 1), cnt = (r) => pool.filter((c) => rarityId(c) === r).length;
          let rs = ['common', 'rare', 'epic'].filter((r) => (W[r] || 0) > 0 && cnt(r) >= n);
          if (!rs.length) rs = ['common', 'rare', 'epic'].filter((r) => cnt(r) > 0).sort((a, b) => cnt(b) - cnt(a)).slice(0, 1);
          const tot = rs.reduce((t, r) => t + (W[r] || 1), 0), x = hashRand(run.seed || 0, run.level || 0, run.rewardRolls || 0, 'lootRarity') * tot;
          let acc = 0, pickR = rs[rs.length - 1]; for (const r of rs) { acc += W[r] || 1; if (x < acc) { pickR = r; break; } }
          if (pickR) pool = pool.filter((c) => rarityId(c) === pickR);
        }
        run.options = rngSample(run, pool.map((c) => c.id), n);
        const teamLoot = step.phase === 'reward' && TEAM_LOOT && (levelCfg(data, run.level) || {}).teamLoot; // 2026-11-24 用户「只放第六关，全给这种稀有卡」
        if (teamLoot) { const tl = data.cards.rewards.filter((c) => c.teamOnly && !c.disabled && !(run.teamTaken || []).includes(c.effect && c.effect.stat)).map((c) => c.id); if (tl.length) run.options = tl; }
        // 试玩反馈 2026-11-14 晚 #21: while a girl is down (心情 ≤ −1) the stew is always on the table
        if (!teamLoot && step.phase === 'reward' && !run.options.includes(STEW_CARD) && !(SAME_RARITY_LOOT && pool.some((c) => c.id === STEW_CARD) === false) && pool.some((c) => c.id === STEW_CARD)
          && run.party.some((id) => !isLeader(id) && run.members[id] && run.members[id].mood <= -1)) run.options[run.options.length - 1] = STEW_CARD;
        // 2026-11-20 用户「战利品有传说级别了，另一个就不能是普通级别，否则还选个屁」(LOOT_NO_COMMON_WITH_LEGEND): with a legendary
        // on the table, every common option (not the stew) is swapped for an unseen rare-or-better one from the same pool
        if (!teamLoot && step.phase === 'reward' && LOOT_ONE_CHARM) {
          const byIdC = (id) => pool.find((c) => c.id === id) || data.cards.rewards.find((c) => c.id === id);
          const legs = run.options.filter((id) => rarityId(byIdC(id)) === 'legendary');
          if (legs.length > 1) {
            const spare = rngSample(run, pool.filter((c) => !run.options.includes(c.id) && rarityId(c) !== 'legendary').map((c) => c.id), legs.length - 1);
            const drop = legs.slice(1);
            run.options = run.options.map((id) => (drop.includes(id) && spare.length ? spare.shift() : id)).filter((id) => !drop.includes(id));
          }
        }
        if (!teamLoot && step.phase === 'reward' && LOOT_NO_COMMON_WITH_LEGEND) {
          const byId = (id) => pool.find((c) => c.id === id) || data.cards.rewards.find((c) => c.id === id);
          if (run.options.some((id) => rarityId(byId(id)) === 'legendary')) {
            const spare = rngSample(run, pool.filter((c) => !run.options.includes(c.id) && rarityId(c) !== 'common' && !(LOOT_ONE_CHARM && rarityId(c) === 'legendary')).map((c) => c.id), run.options.length);
            run.options = run.options.map((id) => (id !== STEW_CARD && rarityId(byId(id)) === 'common' && spare.length ? spare.shift() : id));
          }
        }
      }
      if (step.phase === 'sacrifice') {
        run.sacrificeModes = step.modes;
        run.suggestion = null;
        if (ADVISOR_SACRIFICE_HINT && run.advisorPresent && sacrificable(run).length) {
          const top = topAvg(run);
          const ctx = { name: nameOf(data, top) };
          const a = advisorData(data, run);
          const raw = a.comments && a.comments.sacrificeSuggest ? pickOne(run, a.comments.sacrificeSuggest) : null;
          run.suggestion = { id: top, text: raw ? resolveLine(data, run, raw, ctx, 'advisor').text : '' };
        }
      }
      if (step.phase === 'ending') run.outcome = step.outcome || 'victory';
      if (step.phase === 'gameOver') run.outcome = 'defeat';
      return;
    }
  }

  // ---------- v2.4 [9] team assembly: advisor lines (the story) → one rollcall per girl (party order) → the leader's rally ----------
  const ROLLCALL_FALLBACK = lazy(() => ({ text: TX('level.rollcall') }));
  const RALLY_FALLBACK = lazy(() => ([{ speaker: 'leader', text: TX('level.rally') }]));
  function levelTitleOf(run, cfg) { return (cfg && run.exitRevealed && cfg.cardTitle && run.level === cfg.level) ? cfg.cardTitle : (cfg && cfg.title) || ''; } // EXIT_CARD_AFTER_TURN: 出口 until her turn
  function levelCardEvent(data, run, n) {
    const cfg = levelCfg(data, n) || {};
    const I = run.levelIntro && run.levelIntro.level === n ? run.levelIntro : null;
    const lines = I ? I.lines.map((r) => resolveLine(data, run, r, I.ctx, I.speaker)) : [];
    const title = levelTitleOf(run, cfg);
    return { kind: 'levelCard', level: n, title, act: actOf(run), text: TX('level.card', { n, title }), line: lines[0] || null, lines };
  }
  function teamAssembled(data, run, events) {
    const L = linesV2(data);
    // party order; the leader steps in only when content gives her a rollcall line (her rally follows anyway)
    const rollcall = run.party.filter((id) => !isLeader(id) || hasAny(dig(L, 'rollcall', id))).map((id, index) => {
      const raw = pickOne(run, dig(L, 'rollcall', id)) || ROLLCALL_FALLBACK();
      const line = resolveLine(data, run, raw, { name: nameOf(data, id) }, isLeader(id) ? 'leader' : id);
      const r = { kind: 'rollcall', id, name: nameOf(data, id), index, line };
      if (isLeader(id)) r.isLeader = true;
      return r;
    });
    const rr = dig(L, 'leaderRally'); // alternatives: one is picked
    const rally = (hasAny(rr) ? [pickOne(run, rr)] : RALLY_FALLBACK()).map((raw) => resolveLine(data, run, raw, {}, 'leader'));
    run.story.rollcall = rollcall;
    run.story.rally = rally;
    for (const r of rollcall) events.push(clone(r));
    for (const l of rally) events.push(Object.assign({ kind: 'line' }, l, { key: 'leaderRally' }));
  }

  function startLevel(data, run, n, opts) {
    const cfg = levelCfg(data, n) || fail('no level ' + n);
    if (run.bellPending) { delete run.bellPending; const lv = levelsWith(data, 'bellNight', BELL_LEVELS).filter((x) => levelCfg(data, x)); run.bellLevel = lv.length ? rngPick(run, lv) : null; } // 2026-11-19 流程修 H3: the draw deferred from sealing (see advance)
    run.level = n;
    const q = [];
    // v2.4 [9]: every level opens with the advisor's (or, once she is gone, the narrator's) intro, then the level card
    const intro = levelIntro(data, run, cfg);
    run.levelIntro = intro;
    // 叙事节奏 2026-11-13: the night (prep) comes first and never names the level; the scene intro plays once, after 「出发」 (goSteps).
    // L1: a plain formation, no campfire. After L9 (march): no night at all, straight into the L10 intro.
    if (opts && opts.march && opts.exit && EXIT_FLOW) { // the walk out: intro (+ map) and card, then the throne stories and her turn, then the level's own pre-story + battle
      run.campfire = null; run.camp = { step: 'done', quiet: true, march: true, choice: 'march' };
      // 2026-11-20 用户「到出口的时候奥德丽还说你们的对手是石卫，莫名其妙」: the walk out names no enemy — her one line about the way out
      run.levelIntro.lines = [{ speaker: run.levelIntro.speaker, text: run.levelIntro.speaker === 'narrator' ? TX('level.intro.exitNarrator') : TX('level.intro.exit') }];
      const g = goSteps(data, run, cfg);
      if (EXIT_CARD_AFTER_TURN) { run.exitHideNo = true; q.push(g[0], ...THRONE_STORIES.slice(1).map((id) => ({ story: id })), { removeAdvisor: true, turn: true }, { levelCard: cfg.level, exitReveal: true }, ...g.slice(2)); }
      else q.push(...g.slice(0, 2), ...THRONE_STORIES.slice(1).map((id) => ({ story: id })), { removeAdvisor: true, turn: true }, ...g.slice(2));
    }
    else if (opts && opts.march) { run.campfire = null; q.push(...goSteps(data, run, cfg)); }
    else q.push(n === 1 ? { phase: 'prep', first: true } : { phase: 'prep' });
    run.queue = q.concat(run.queue);
  }
  // 叙事节奏 2026-11-13: 「出发」 → levelIntro (+ its card) → the level's own pre-story (finalReveal / nobleChamber) → the battle
  function goSteps(data, run, cfg) {
    const q = [{ story: 'levelIntro', ctx: run.levelIntro ? run.levelIntro.ctx : {} }, { levelCard: cfg.level }];
    if (cfg.preStory && cfg.preStory !== cfg.foeIntro) { // feedback-1112 #33: a foeIntro story plays inside the battle instead
      // §4.1: the first sacrifice took nobody → L8 has a masked champion and its own story
      const id = cfg.preStory === 'firstReturn' && !run.returned.first && run.branch === 'self' ? 'firstReturnSelf' : cfg.preStory;
      q.push({ story: id, ctx: preStoryCtx(data, run, cfg) });
    }
    q.push({ battle: true });
    return q;
  }
  const LEVEL_INTRO_FALLBACK = lazy(() => ({ advisor: { speaker: 'advisor', text: TX('level.intro.advisor') }, narrator: TX('level.intro.narrator') }));
  function introEnemy(data, run, cfg) { // the first wave's boss, else its most common grunt (never a returning girl or the advisor boss)
    const w = (buildWaves(data, run, cfg)[0] || { units: [] }).units.filter((u) => !u.candidate && !u.advisorBoss && !u.champion);
    const boss = w.find((u) => u.boss || u.waveBoss || BOSS_REFS0[u.ref]);
    if (boss) return boss.name;
    const plain = w.filter((u) => !u.padded).length ? w.filter((u) => !u.padded) : w;
    const counts = {};
    for (const u of plain) counts[u.name] = (counts[u.name] || 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  }
  function levelIntro(data, run, cfg) {
    const who = run.advisorPresent && run.advisor ? run.advisor : 'narrator';
    const at = (tbl) => (Array.isArray(tbl) ? tbl[cfg.level - 1] : tbl && typeof tbl === 'object' ? tbl[String(cfg.level)] : null);
    let raw = at(dig(linesV2(data), 'levelIntro', who));
    if (!hasAny(raw)) raw = at(dig(linesV2(data), 'levelIntro', 'default')); // generic per-level lines (advisor voice)
    if (!hasAny(raw) && who === 'narrator') raw = null;
    if (!hasAny(raw)) raw = LEVEL_INTRO_FALLBACK()[who === 'narrator' ? 'narrator' : 'advisor'];
    const ctx = { level: String(cfg.level), levelTitle: cfg.title || '', enemy: introEnemy(data, run, cfg) || cfg.title || '' };
    const lines = asList(raw).map((r) => (r && typeof r === 'object' ? r : { speaker: who === 'narrator' ? 'narrator' : 'advisor', text: r }));
    return { level: cfg.level, title: cfg.title || '', speaker: who === 'narrator' ? 'narrator' : 'advisor', ctx, lines };
  }
  function preStoryCtx(data, run, cfg) {
    // (2026-11-14: finalReveal no longer names the second sacrificed member — L10 has no returned guard)
    const ids = [];
    let champ = null;
    for (const wave of wavesOf(run, cfg)) for (const e of wave) {
      if (e.rejected) for (const r of e.rejected) { const x = run.rejected[r - 1]; if (x) ids.push(x.id); }
      if (e.returned && run.returned[e.returned]) ids.push(run.returned[e.returned]);
      else if (e.returned && e.fallback) champ = championDef(data, e.fallback).name;
    }
    const names = ids.map((i) => nameOf(data, i)).concat(champ ? [champ] : []);
    // 2026-11-19 试玩修 剧情: gave — for a returned girl, whether the leader ever handed her a card (a noGift line variant reads it)
    const back = ids.filter((i) => run.memory && run.memory[i] && run.memory[i].departure && run.memory[i].departure !== 'rejected');
    const out = names.length ? { name: listSeq(names) } : {};
    if (back.length) out.gave = back.some((i) => (run.memory[i].cards || []).length > 0);
    return out;
  }
  const avgOf = (m) => (m.dpsHistory.length ? r2(m.dpsHistory.reduce((a, b) => a + b, 0) / m.dpsHistory.length) : 0);
  function topAvg(run) {
    const pool = sacrificable(run);
    let best = pool[0];
    for (const id of pool) if (avgOf(run.members[id]) > avgOf(run.members[best])) best = id;
    return best;
  }

  // ---------- act ----------
  function act(data, run0, action) {
    if (!action || typeof action.type !== 'string') fail('action must have a type');
    const run = clone(run0);
    if (!run.leaderName) run.leaderName = defaultLeaderName(run.seed || 0); // pre-2.4 saves
    useRun(run);
    const events = [];
    run.seq += 1;
    run.history.push({ seq: run.seq, phase: run.phase, level: run.level, action: clone(action) });
    migrate(run);
    if (action.type === 'cheatKeys') { // §4.6 playtest: any phase
      run.keys = { self: true, rules: true, bell: true, refuse: true };
      run.namedGirl = false;
      run.cheated = true;
      events.push({ kind: 'cheat', cheat: 'keys', keys: clone(run.keys), text: TX('cheat.keys') });
      run.lastEvents = events;
      return run;
    }
    const h = HANDLERS[run.phase] && HANDLERS[run.phase][action.type];
    if (!h) fail(`action ${action.type} not allowed in phase ${run.phase}`);
    h(data, run, action, events);
    run.lastEvents = events;
    return run;
  }

  function setLeader(data, run, identity, cls, ev) {
    // the one-shot alias from the identity step also skips the queued leaderPrompt + class step
    if (run.leaderStep === 'identity') run.queue = run.queue.filter((q) => !(q.phase === 'leader' || q.story === 'leaderPrompt'));
    const idt = data.leader.identities.find((x) => x.id === identity) || fail('bad identity');
    const c = data.leader.classes.find((x) => x.id === cls) || fail('bad class');
    run.leader = { identity: idt.id, class: c.id };
    run.leaderEffects = [idt.effect, c.effect].filter(Boolean);
    run.leaderStep = null;
    advance(data, run, ev);
  }

  // feedback-1112 #7: after the gate slams shut (L3), the leader answers the noble.
  //  refuse → the noble's guards beat her down: leader hp → 1, then she has to go on anyway · accept → 2 random girls mood −1
  // 2026-11-19 用户亲测 流程 (corrected): the option keeps its price note; only the injury report waits for the beat
  const SEAL_OPTIONS = lazy(() => ([{ id: 'refuse', text: TX('sacrifice.seal.refuse'), note: TX('sacrifice.seal.refuseNote') /* 第六批 H1-5 */ }, { id: 'accept', text: TX('sacrifice.seal.accept'), note: TX('sacrifice.seal.acceptNote') }]));
  function sealChoice(data, run, a, ev) {
    const c = a.choice;
    if (c !== 'refuse' && c !== 'accept') fail('sealChoice: refuse | accept');
    run.flags.seal = c;
    if (c === 'refuse') bump(braveOf(run), 'refuse'); // @stats
    const hadRefuse = keyLit(run, 'refuse'); // 2026-11-20 铃之门
    if (c === 'refuse') run.keys.refuse = true; // 2026-11-13 key one: someone told them no to their face (the curse still lands)
    const gotRefuse = c === 'refuse' ? bellGot(run, 'refuse', hadRefuse, ev) : null, bg = gotRefuse ? { bellGot: gotRefuse } : {}; // 「你获得了反抗之铃」 ends sealRefuse
    noteRecent(run, { when: c === 'refuse' ? 'afterSealRefuse' : 'afterSealAccept' }); // SPEC-2026-11-13 E1+: that night's campfire
    if (c === 'refuse') {
      const L = run.members[LEADER_ID];
      if (L) {
        const from = hpOf(L), to = SEAL_TEAM_HIT ? Math.max(1, from - SEAL_HIT) : 1; // 试玩反馈 2026-11-14 晚 #12: refusing gets the leader beaten down to 1 hp (was ×0.5)
        if (!SEAL_HP_AT_BEAT) L.hp = to; // 2026-11-19 用户亲测 流程: else the hp drops on the beating line (settleStoryHp)
        // 2026-11-19 用户亲测 流程: no injury report at the choice — the beating line carries it (view line hp { id, from, to, text })
        if (!SEAL_HP_AT_BEAT) ev.push({ kind: 'sealCurse', id: LEADER_ID, hpBefore: from, hpAfter: to, text: TX('story.sealBeaten', { hp: to }) }); // the UI shows it on the story's curse line
        const teamTo = SEAL_TEAM_HIT ? Object.fromEntries(run.party.filter((id) => run.members[id]).map((id) => [id, Math.max(1, hpOf(run.members[id]) - SEAL_HIT)])) : null; // SEAL_TEAM_HIT
        if (teamTo && !SEAL_HP_AT_BEAT) for (const id of Object.keys(teamTo)) run.members[id].hp = teamTo[id];
        run.queue.unshift({ story: 'sealRefuse', ctx: Object.assign(SEAL_HP_AT_BEAT ? { hpFrom: from, hpTo: to, hpPending: true } : { hpFrom: from, hpTo: to }, teamTo ? { teamTo } : {}, bg) });
      } else run.queue.unshift({ story: 'sealRefuse', ctx: bg });
    } else {
      for (const raw of storyLines(data, run, 'sealAcceptSay') || []) ev.push(lineEvent(data, run, raw, {}, 'leader', { key: 'sealAccept' })); // she says yes, then the girls flinch
      const d = {};
      if (!SEAL_TEAM_HIT) for (const id of rngSample(run, sacrificable(run), 2)) addMood(d, id, -1, TX('mood.why.sealAccept')); // SEAL_TEAM_HIT: accepting costs nothing
      applyMoods(data, run, ev, d);
      run.queue.unshift({ story: 'sealAccept' });
    }
    advance(data, run, ev);
  }

  const HANDLERS = {
    story: {
      // 2026-11-15 小门: on the open door a plain continue opens it (like the seal's continue = accept), so auto-play still runs
      continue: (data, run, a, ev) => (run.story && run.story.choice === 'seal' ? sealChoice(data, run, { choice: 'accept' }, ev)
        : run.story && run.story.door && doorView(data, run).open ? openDoor(data, run, ev) : advance(data, run, ev)),
      openDoor(data, run, a, ev) { openDoor(data, run, ev); }, // 2026-11-15 小门: only when all three slots are lit
      skipDoor(data, run, a, ev) { skipDoor(data, run, ev); }, // 2026-11-21 L10_EXIT_V2: the open door, 【不进去】 → the normal ending
      sealChoice(data, run, a, ev) { if (!run.story || run.story.choice !== 'seal') fail('no seal choice here'); sealChoice(data, run, a, ev); }, // feedback-1112 #7
    },
    difficulty: { // v2.5: the fairy asks for a tier; locked tiers refuse
      chooseDifficulty(data, run, a, ev) {
        const d = Math.floor(+a.difficulty);
        if (!DIFFICULTIES()[d]) fail('bad difficulty');
        if (d > run.meta.unlocked || d >= OPEN_TIERS) fail('difficulty locked');
        run.difficulty = d;
        useRun(run);
        ascPurse(data, run);
        const said = difficultyView(data, run).picked.slice();
        said.splice(1, 0, { speaker: 'fairy', expr: 'happy', text: [TX('difficulty.quip.0'), TX('difficulty.quip.1'), TX('difficulty.quip.2'), TX('difficulty.quip.3'), TX('difficulty.quip.4'), TX('difficulty.quip.5'), TX('difficulty.quip.6'), TX('difficulty.quip.7'), TX('difficulty.quip.8'), TX('difficulty.quip.9')][d] }); // 2026-11-14 user: a per-tier quip where she half-lets-slip the doll plan
        for (const l of said) ev.push(lineEvent(data, run, Object.assign({}, l, { text: String(l.text).replace(/\{tier\}/g, DIFFICULTIES()[d].name) }), {}, 'fairy', { key: 'difficulty' }));
        advance(data, run, ev);
      },
    },
    advisor: {
      chooseAdvisor(data, run, a, ev) {
        const id = a.advisor || a.id;
        if (!data.advisors.find((x) => x.id === id)) fail('bad advisor');
        run.advisor = id;
        run.advisorPresent = true;
        advance(data, run, ev);
      },
    },
    leader: {
      chooseIdentity(data, run, a, ev) { // → story leaderPrompt (advisor asks the class) → leader step 'class'
        if (run.leaderStep !== 'identity') fail('identity already chosen');
        const idt = data.leader.identities.find((x) => x.id === a.identity) || fail('bad identity');
        run.leader = { identity: idt.id, class: null };
        run.leaderEffects = [idt.effect].filter(Boolean);
        if (OUTLANDER_GOLD > 0 && idt.effect === 'explorer') run.gold = goldOf(run) + OUTLANDER_GOLD; // 2026-11-24 用户「外乡人改成初始金币 +20」
        run.leaderStep = null;
        advance(data, run, ev);
      },
      chooseClass(data, run, a, ev) {
        if (run.leaderStep !== 'class') fail('choose an identity first');
        setLeader(data, run, run.leader.identity, a.cls || a.class, ev);
      },
      // v1 one-shot alias (tests, old walkers): identity + class at once, from either step.
      chooseLeader(data, run, a, ev) { setLeader(data, run, a.identity || (run.leader && run.leader.identity), a.class || a.cls, ev); },
    },
    interview: {
      side(data, run, a, ev) { doSide(data, run, a.id, ev); },
      hire(data, run, a, ev) { doHire(data, run, a.id || a.candidate, ev); },
      // 2026-11-15 老玩家快速开局: one page, one pick per remaining round = side with her AND hire her (the other one is
      // rejected exactly as in the normal flow). Runs the same doSide / doHire steps in round order, so the run state
      // (party, rejected, grudges, memory, rng) matches doing them one by one; the talk lines are dropped (quick page).
      quickRecruit(data, run, a, ev) { quickRecruit(data, run, a, ev); },
    },
    prep: {
      setOrder(data, run, a) {
        const o = a.order;
        if (!Array.isArray(o) || o.length !== run.party.length || [...o].sort().join() !== [...run.party].sort().join()) fail('order must be a permutation of the party');
        run.party = o.slice();
      },
      // 方案 B (2026-11-15): the advisor skill can be armed at the formation for round 1 (the battle's first pause comes after round 1)
      armSkill(data, run, a) { armSkill(data, run, a.on !== false); },
      fight(data, run, a, ev) { // 叙事节奏 2026-11-13: 「出发」 → the scene intro → the battle
        if (a.advisorSkill != null) armSkill(data, run, !!a.advisorSkill);
        autoCamp(data, run, ev); ignoreBell(run);
        guideOnDepart(data, run); // 2026-11-20 流程: the advisor's pre-fight line plays after the arrival (in the scene intro)
        run.queue = goSteps(data, run, levelCfg(data, run.level)).concat(run.queue);
        advance(data, run, ev);
      },
      cheatWin(data, run, a, ev) { autoCamp(data, run, ev); ignoreBell(run); run.skillArmed = false; run.battle = initBattle(data, run); cheatWin(data, run, ev); },
      camp(data, run, a, ev) {
        // 2026-11-18 rules night trains first: a walker that sends the choice straight away (old scripts, tests) gets the free
        // training done for it the autoCamp way (first member, first card) — the UI only sends a choice on the choose step
        const C = run.camp;
        if (C && C.preTrain && !C.preTrainDone && C.step !== 'choose') for (let i = 0; i < 3 && C.step !== 'choose'; i++) {
          if (C.step === 'train-pick') campTrainPick(data, run, run.party[0], ev); else if (C.step === 'train-bonus') campTrainBonus(data, run, C.bonuses[0].id, ev); else break;
        }
        campChoose(data, run, a.choice, ev);
      },
      campExplore(data, run, a, ev) { campExplore(data, run, a.itemId, a.drop, ev); },
      campTrainPick(data, run, a, ev) { campTrainPick(data, run, a.id, ev); },
      campTrainBonus(data, run, a, ev) { campTrainBonus(data, run, a.bonusId, ev); },
      shopBuy(data, run, a, ev) { shopBuy(data, run, a, ev); }, // 2026-11-14 芙洛的店: { itemId, target? }
      shopLeave(data, run, a, ev) { shopLeave(data, run, ev); },
      followBell(data, run, a, ev) { // §4.3 key three: no rest; the next battle starts wounded (not on 木头: bellWound false)
        if (!run.bell) fail('there is no bell to follow here');
        if (run.camp && run.camp.step !== 'choose') fail('the camp choice is already made');
        run.bell = false;
        run.bellDone = true;
        const hadBell = keyLit(run, 'bell'); // 2026-11-20 铃之门
        run.keys.bell = true;
        const gotBell = bellGot(run, 'bell', hadBell, ev);
        bump(braveOf(run), 'bell'); // @stats
        run.wounded = tierRule(run, 'bellWound') !== false;
        if (BELL_NIGHT_REST) { // 2026-11-22i 用户「跟着铃声走那晚照常休息，只是不能锻炼」: the rest heal still lands (no 满血护甲 / mood / tea extras)
          for (const id of run.party) { const m = run.members[id], before = statsOf(m, isLeader(id)); m.hp = Math.min(m.maxHp, hpOf(m) + restFor(data, run, m)); statChange(data, run, ev, id, before, 'rest'); }
        }
        if (run.camp) Object.assign(run.camp, { step: 'done', choice: 'followBell' });
        ev.push({ kind: 'followBell', level: run.level, keys: clone(run.keys) });
        if (!run.relics.includes('bell')) { // v2.3 §A[26]: 「无名铜铃」, no bag slot
          run.relics.push('bell');
          const r = relicDef(data, 'bell');
          if (!BELL_FOLLOW_QUIET) ev.push({ kind: 'relic', relic: 'bell', name: r.name, text: r.text, gained: true }); // 2026-11-24 用户「循着铃声一选择就说钥匙——不要；选完直接接去寻找的剧情」
        }
        run.queue.unshift({ story: 'bellFollowed', ctx: gotBell ? { bellGot: gotBell } : {} }, { phase: 'prep', quiet: true }); // 「你获得了好奇之铃」 ends bellFollowed
        advance(data, run, ev);
      },
    },
    battle: {
      move(data, run, a, ev) {
        const B = run.battle;
        let from = B.allies.findIndex((u) => u.id === a.id);
        if (from < 0) from = B.allies.findIndex((u) => u.wokeMember && u.ref === a.id); // 2026-11-24 用户「反水过来的人没法换到前面」: a woken girl by her ref too
        if (from < 0) fail('not an ally: ' + a.id);
        const to = a.to;
        if (!Number.isInteger(to) || to < 0 || to >= B.allies.length) fail('bad move index');
        // 2026-11-19 换位/暂停连做: SWAP_COST — adjacent only, once per pause; the moved one skips her next action
        const cost = swapCostOn(run);
        if (cost && !SWAP_ANY && Math.abs(to - from) !== 1) fail('swap: only two adjacent members'); // SWAP_ANY 2026-11-24 用户「局中换位什么位置都可以，换位的人停一回合就行」
        if (cost && B.swapDone) fail('swap: once per pause');
        const [u] = B.allies.splice(from, 1);
        B.allies.splice(to, 0, u);
        run.party = B.allies.filter((x) => !x.turned).map((x) => x.id); // turncoats fight with us but never join the party
        const e = { kind: 'move', uid: u.id, from, to, order: run.party.slice(), text: TX('battle.move', { name: u.name, pos: to + 1 }) };
        if (cost) { B.swapDone = true; u.swapSkip = true; e.other = B.allies[from] ? B.allies[from].id : null; e.skip = u.id; e.text += TX('battle.swapSkipNote', { name: u.name }); }
        pauseAct(data, run, ev, [e]);
      },
      advisorSkill(data, run, a, ev) {
        const B = run.battle;
        const adv = advisorData(data, run);
        const cb = adv && run.advisorPresent ? combatOf(adv) : null;
        if (!cb) fail('no advisor skill');
        if (B.advisorSkillUsed) fail('advisor skill already used this battle');
        B.advisorSkillUsed = true;
        B.mods[cb.kind] = true;
        const cv = combatView(adv, run), nAmt = advSkillAmt(run, cb.kind);
        const pre = [{ kind: 'advisorSkill', advisorId: adv.id, skill: cb.kind, name: cb.name, text: `${adv.name}：「${cb.name}」——${cv.text}` }];
        if (giftsPips(cb.kind)) pre.push(...giftPips(B, nAmt, 'advisor', cb.name));
        if (cb.kind === 'formation') B.formationN = nAmt;
        if (cb.kind === 'luckUp') { B.luckUpPending = true; B.luckUpN = nAmt; } // 2026-11-20 妮可塔: the round that plays next
        pauseAct(data, run, ev, pre); // 2026-11-19 换位/暂停连做 (was battleStep)
      },
      useItem(data, run, a, ev) {
        const B = run.battle;
        const idx = run.items.indexOf(a.itemId);
        if (idx < 0) fail('item not in bag: ' + a.itemId);
        const it = itemDef(data, a.itemId) || fail('unknown item ' + a.itemId);
        const kind = itemKind(it);
        let t = null;
        const aim = itemAim(run, it);
        if (aim === 'enemy') {
          t = B.enemies.find((u) => u.id === a.target);
          if (!t || t.hp <= 0) fail('item needs a living enemy target');
        } else if (aim === 'fallen') {
          t = B.allies.find((u) => u.id === a.target);
          if (!t || t.hp > 0 || t.turned) fail('item needs a fallen ally target');
        } else if (aim) {
          t = B.allies.find((u) => u.id === a.target);
          if (!t || t.hp <= 0) fail('item needs a living ally target');
        }
        const e = { kind: 'item', itemId: it.id, name: it.name, target: t ? t.id : null, text: t ? TX('item.usedOn', { item: it.name, target: t.name }) : TX('item.used', { item: it.name }) };
        if (kind === 'healFull') { const h = Math.min(itemNum(it, POTION_HEAL), t.maxHp - t.hp); /* review #7 */ e.amount = h; t.hp += h; e.hpAfter = t.hp; } // 2026-11-15 user: 回血药 = 生命 +10 (was: back to full)
        else if (kind === 'cleanse') {
          if ((t.debuffs || []).length || t.slowStart || (!t.noMood && t.mood < 0)) bump(statOf(run, LEADER_ID), 'cleansed'); // @stats
          cleanse(t);
        }
        else if (kind === 'smoke' && aim === 'enemy') { t.dazed = true; e.dazed = true; } // 2026-11-22 SMOKE_DAZE: she skips the coming round (cleared at round end)
        else if (kind === 'armor') { const n = Math.min(itemNum(it, ARMOR_POTION), Math.max(0, BLOCK_CAP - (t.block || 0))); t.block = (t.block || 0) + n; e.amount = n; e.blockAfter = t.block; } // 2026-11-22 护甲药: normal 护甲 (goes at round end unless her rules keep it)
        else if (kind === 'revive') { // 2026-11-22 复活药: she stands up — every down flag reset, charge 0, no block
          const hp = Math.max(1, Math.round(t.maxHp * (it.effect && Number.isFinite(it.effect.pct) ? it.effect.pct : REVIVE_PCT)));
          t.hp = Math.min(t.maxHp, hp); t.downLogged = false; t.charge = 0; t.block = 0; t.blockFrom = null; t.badgeRevive = false; t.dazed = false;
          e.amount = t.hp; e.hpAfter = t.hp; e.revived = true;
        }
        else if (kind === 'weakAll') { const n = itemNum(it, WEAK_POWDER); for (const u of B.enemies) if (u.hp > 0) { u.weak = (u.weak || 0) + n; u.powderWeak = (u.powderWeak || 0) + n; } e.amount = n; } // 2026-11-22 虚弱粉: off again at round end
        else if (kind === 'vuln') { t.vuln = true; e.vuln = true; } // 2026-11-22 易伤药水: cleared at round end
        else if (kind === 'fire') { B.mods.fire = (B.mods.fire || 0) + itemNum(it, FIRE_BOTTLE); e.amount = itemNum(it, FIRE_BOTTLE); } // 2026-11-22 燃烧瓶: lands at the start of the coming round (fireBottle)
        else if (kind === 'smoke' || kind === 'drum') B.mods[kind] = true;
        if (TURNCOAT_RECORD_LINE && t && t.side !== 'enemy' && t.ref && !isLeader(t.ref) && run.members[t.ref]) { const g = girlMem(run, t.ref); (g.items || (g.items = [])).push(it.name); } // 2026-11-20 反水: remembered (she may name it)
        run.items.splice(idx, 1);
        pauseAct(data, run, ev, [e].concat(kind === 'drum' ? giftPips(B, itemNum(it, DRUM_ADD) /* review #7 */, 'item', it.name) : [])); // 2026-11-19 换位/暂停连做 (was battleStep)
      },
      // 猎人锁定 (CONTRACT-2026-11-16): set / clear one hunter's target at the pause. Does NOT play a round (unlike move / useItem):
      // the 'aim' event goes into the battle log and this action's events; the next 'continue' plays on.
      setAim(data, run, a, ev) {
        const B = run.battle;
        if (!B || B.over) fail('no battle');
        const u = B.allies.find((x) => x.id === a.id) || B.allies.find((x) => x.wokeMember && x.ref === a.id); // the UI sends the view id (her ref) for a woken girl
        if (!u || u.hp <= 0 || coat(u) || u.role !== 'adc' || !u.skill || u.skill.kind !== 'aim') fail('not a living hunter of ours: ' + a.id);
        let t = null;
        if (a.target != null) { t = B.enemies.find((x) => x.id === a.target); if (!t || t.hp <= 0) fail('aim target must be a living enemy: ' + a.target); }
        u.aimLock = t ? t.id : null;
        const e = { kind: 'aim', round: B.round, id: u.id, target: u.aimLock, text: t ? TX('battle.aimSet', { name: u.name, target: t.name }) : TX('battle.aimClear', { name: u.name }) };
        B.log.push(e);
        ev.push(e);
      },
      // 2026-11-20 牧师治疗 (HEAL_PICK): set / clear one priest's picks at the pause — up to n living allies (n = her shares), in order;
      // share i goes to pick i if she is still hurt, else the auto rule. Free, like setAim; kept for the battle until changed.
      setHealTargets(data, run, a, ev) {
        const B = run.battle;
        if (!HEAL_PICK) fail('heal picks are off');
        if (!B || B.over) fail('no battle');
        const u = B.allies.find((x) => x.id === a.id) || B.allies.find((x) => x.wokeMember && x.ref === a.id) || (B.enemies || []).find((x) => x.wokeMember && (x.id === a.id || x.ref === a.id)); // 2026-11-24 用户「葛蕾反水过来后没法指定治疗（error）」: a woken girl, like setAim
        if (!u || u.hp <= 0 || coat(u) || !u.skill || u.skill.kind !== 'heal') fail('not a living priest of ours: ' + a.id);
        const n = HEAL_FOCUS ? 1 : HEAL_LV[lvOf(u.skill) - 1].n, ids = Array.isArray(a.targets) ? a.targets : [];
        if (ids.length > n) fail('at most ' + n + ' heal targets');
        for (const id of ids) { const t = B.allies.find((x) => x.id === id); if (!t || t.hp <= 0 || coat(t) || t.bell) fail('heal target must be a living ally: ' + id); }
        u.healPick = ids.slice();
        const names = ids.map((id) => B.allies.find((x) => x.id === id).name);
        const e = { kind: 'healPick', round: B.round, id: u.id, targets: ids.slice(), text: ids.length ? TX('battle.healPickSet', { name: u.name, targets: listSeq(names) }) : TX('battle.healPickClear', { name: u.name }) };
        B.log.push(e);
        ev.push(e);
      },
      continue(data, run, a, ev) { const B = run.battle, pre = (B && B.pendingPre) || []; if (B) { B.pendingPre = []; B.pauseActs = 0; } battleStep(data, run, ev, PAUSE_REPLAY_MARK ? pre.map((e) => Object.assign({}, e, { replay: true })) : pre); }, // 2026-11-20 用户「加班条款 开战后清零再充」: shown at the pause already → replay: true, the UI skips it // 2026-11-19 换位/暂停连做: the queued pause actions open the round
      cheatWin(data, run, a, ev) { cheatWin(data, run, ev); },
    },
    battleResult: {
      continue(data, run, a, ev) {
        const cfg = levelCfg(data, run.level);
        if (!run.battle.win) { run.outcome = 'defeat'; run.defeatLevel = run.level; const early = EARLY_DEFEAT_SIMPLE && earlyDefeatAt(data, run.level); /* review #5 (was run.level <= EARLY_DEFEAT_MAX_LEVEL) */ run.earlyDefeat = early || undefined; run.queue = [{ story: early ? 'earlyDefeat' : 'gameOver' }, { phase: 'gameOver' }]; return advance(data, run, ev); }
        run.queue = postQueue(data, run, cfg);
        advance(data, run, ev);
      },
      cheatWin: (data, run, a, ev) => cheatAfterLoss(data, run, ev),
    },
    gameOver: { cheatWin: (data, run, a, ev) => cheatAfterLoss(data, run, ev) },
    reward: { pickReward: (data, run, a, ev) => pickCard(data, run, a, ev, true) },
    debuff: { pickDebuff: (data, run, a, ev) => pickCard(data, run, a, ev, false) },
    sacrifice: { sacrifice: (data, run, a, ev) => doSacrifice(data, run, a, ev) },
  };

  // ---------- interview (§2.2) ----------
  // 4+1 rule: the round whose role equals the leader's class role is skipped (the leader fills that role).
  function leaderRole(data, run) {
    const cls = (data.leader.classes || []).find((x) => x.id === (run.leader && run.leader.class)) || {};
    return cls.role || null; // a class that declares no role skips no interview round
  }
  function interviewRounds(data, run) {
    const lr = leaderRole(data, run);
    const rounds = [...new Set(data.candidates.map((c) => c.round))].sort((a, b) => a - b);
    return rounds.filter((r) => !roundPair(data, r).some((c) => c.role === lr));
  }
  function roundPair(data, round) {
    return data.candidates.filter((c) => c.round === round).sort((x, y) => String(x.slot).localeCompare(String(y.slot)));
  }
  // interviews.json pair entry for this round ("a|b" in slot order, reverse accepted); null → v1 fallback.
  function conflictFor(data, round) {
    const pairs = data.interviews && data.interviews.pairs;
    const pair = roundPair(data, round);
    if (!pairs || pair.length < 2) return null;
    const e = pairs[pair[0].id + '|' + pair[1].id] || pairs[pair[1].id + '|' + pair[0].id];
    return e && typeof e === 'object' ? e : null;
  }
  function startInterviewRound(data, run, round) {
    run.interviewRound = round;
    run.interviewStep = conflictFor(data, round) ? 'side' : 'hire';
  }
  function doSide(data, run, id, ev) {
    if (run.interviewStep !== 'side') fail('not choosing a side now');
    const pair = roundPair(data, run.interviewRound);
    const pick = pair.find((c) => c.id === id) || fail('candidate not in this round');
    const cf = conflictFor(data, run.interviewRound);
    run.sided[run.interviewRound] = pick.id;
    const se = sideEffect(data, run, run.interviewRound, pick.id); // G2 #9: the effect, right away
    if (SIDE_COST && pick.sideCost > 0) { // 2026-11-24 用户「琪琪偷钱袋——站她的话要多交 5 块钱」: backing her = the purse she had in her fingers stays with her
      const have = goldOf(run), n = Math.min(have, pick.sideCost);
      run.gold = have - n; run.sideSpent = (run.sideSpent || 0) + n;
      ev.push({ kind: 'gold', n: -n, src: 'sideCost', gold: run.gold, text: TX('interview.sideCostPaid', { name: pick.name, n }) });
    }
    ev.push({ kind: 'sideEffect', id: pick.id, name: pick.name, text: se.effect, more: se.effectMore, against: se.against || null, againstId: se.againstId || null });
    for (const c of pair) {
      const r = dig(cf, 'reactions', pick.id, c.id);
      if (r) ev.push(lineEvent(data, run, r, { name: c.name }, c.id, { id: c.id, key: 'reaction' }));
    }
    run.interviewStep = 'hire';
  }
  // 2026-11-15 一页招完人: on offer to every player (the UI first asks 一个个面试 / 直接写名单), only at the start of a round
  // (nothing picked in it yet). The rounds still to go, in order; null when the quick page is not on offer.
  function quickRounds(data, run) {
    if (run.phase !== 'interview') return null;
    const first = conflictFor(data, run.interviewRound) ? 'side' : 'hire';
    if (run.interviewStep !== first || run.sided[run.interviewRound]) return null;
    const rounds = interviewRounds(data, run);
    const i = rounds.indexOf(run.interviewRound);
    return i < 0 ? null : rounds.slice(i);
  }
  function quickRecruit(data, run, a, ev) {
    const rounds = quickRounds(data, run);
    if (!rounds) fail('quickRecruit only at the start of an interview round');
    const picks = a.picks;
    if (!Array.isArray(picks) || picks.length !== rounds.length) fail(`quickRecruit needs ${rounds.length} picks (one per round, in order)`);
    picks.forEach((id, i) => { if (!roundPair(data, rounds[i]).some((c) => c.id === id)) fail(`pick ${i + 1} is not in round ${rounds[i]}`); });
    const talk = []; // the side / hire lines (reactions, hired, leave): the quick page skips them
    if (!run.flags) run.flags = {};
    run.flags.quickRecruit = true; // 2026-11-19 试玩修 剧情: lines that quote her stance use their ifQuick variant
    picks.forEach((id, i) => {
      if (run.interviewRound !== rounds[i]) fail('quickRecruit: round out of step');
      if (run.interviewStep === 'side') doSide(data, run, id, talk);
      doHire(data, run, id, ev, talk); // the last hire advances (teamAssembled …) into ev
    });
    const qe = { kind: 'quickRecruit', picks: picks.slice(), rejected: run.rejected.slice(-picks.length).map((r) => r.id) };
    if (run.recruitPrice) { qe.prices = picks.map((id) => recruitPrice(data, cand(data, id))); qe.gold = goldOf(run); } // 2026-11-20 招人花钱
    ev.unshift(qe);
  }
  function doHire(data, run, id, ev, talk) {
    const tk = talk || ev;
    const round = run.interviewRound;
    const pair = roundPair(data, round);
    const pick = pair.find((c) => c.id === id) || fail('candidate not in this round');
    const other = pair.find((c) => c.id !== pick.id);
    const cf = conflictFor(data, round);
    const sided = run.sided[round] || null;
    // no conflict data → v1 behaviour: bond high, grudge high. Hiring before siding counts as siding with nobody.
    const bond = !cf ? 'high' : sided === pick.id ? 'high' : 'low';
    if (run.recruitPrice) { // 2026-11-20 招人花钱: she costs her price (the UI disables a pick you can't afford)
      const price = hirePriceFor(data, run, pick); // 2026-11-24 精钢 safety: both too dear → she costs what is left
      if (goldOf(run) < price) fail('not enough gold to hire ' + pick.id);
      run.gold = goldOf(run) - price; run.recruitSpent = (run.recruitSpent || 0) + price;
      ev.push({ kind: 'hirePay', id: pick.id, price, gold: run.gold, text: TX('interview.hirePay', { name: pick.name, n: price, gold: run.gold }) }); // playlog: what she cost and the purse after
    }
    hireMember(data, run, pick, bond);
    for (const c of pair) { // §E: the interview, as she remembers it
      const g = girlMem(run, c.id);
      const o = pair.find((x) => x.id !== c.id);
      g.conflict = cf ? cf.id || pair.map((x) => x.id).join('|') : null;
      g.sided = sided;
      g.sidedFor = sided ? sided === c.id : null;
      g.rival = o ? o.id : null;
    }
    say(data, run, tk, pick.id, 'hired');
    if (other) {
      const grudge = cf && sided === other.id ? 'low' : 'high';
      run.rejected.push({ id: other.id, round, grudge });
      run.rejectedInfo[other.id] = { grudge, round };
      Object.assign(girlMem(run, other.id), { departure: 'rejected', departLevel: run.level, grudge, mood: null });
      const key = sided === other.id ? 'sided' : 'unsided';
      const raw = dig(cf, 'leave', other.id, key) || dig(cf, key === 'sided' ? 'leaveSided' : 'leaveUnsided', other.id);
      if (raw) tk.push(lineEvent(data, run, raw, { name: other.name }, other.id, { id: other.id, key: key === 'sided' ? 'leaveSided' : 'leaveUnsided' }));
      else say(data, run, tk, other.id, 'rejected');
    }
    const rounds = interviewRounds(data, run);
    const next = rounds[rounds.indexOf(round) + 1];
    if (next != null) startInterviewRound(data, run, next);
    else { run.interviewStep = null; addLeader(data, run); advance(data, run, ev); }
  }

  // 用户 2026-11-15 晚「多加一些血」: our side starts with ×1.5 hp (rounded); returned girls on the enemy side keep the data hp
  const ALLY_HP_MUL = 1.5;
  const bossCombatOf = (a) => (BOSS_NEW_SKILLS ? combatOf(a) : a.combat_old_2026_11_20 || combatOf(a)); // 2026-11-20: false = the advisor boss still casts her old skill on us
  const giftsPips = (kind) => kind === 'luck' || kind === 'overtime'; // 充能 +LUCK_ADD the moment it is used
  const luckBase = (data, id, m) => clamp(m && m.luck != null ? m.luck : ((cand(data, id) || {}).luck || 0), LUCK_STORE_MIN != null ? LUCK_STORE_MIN : LUCK_MIN, LUCK_MAX); // 2026-11-22f LUCK_BELOW_MIN: kept below −6 // old saves: from the candidate
  const allyHp = (hp) => Math.round(hp * ALLY_HP_MUL);
  function hireMember(data, run, c, bond) {
    const m = {
      id: c.id, maxHp: allyHp(c.hp), atk: c.atk,
      skill: { kind: c.skill.kind, name: c.skill.name, text: c.skill.text, power: c.skill.power || 0 },
      mood: 0, bond: bond || 'high', statuses: [], tokens: [], growth: [], revealed: [], dpsHistory: [], lastDps: null,
      rewardsReceived: [], debuffsReceived: [],
    };
    if (LUCK_STAT && c.luck > 0) m.luck = clamp(c.luck, 0, LUCK_MAX); // 2026-11-20 幸运: born lucky
    if (leaderHas(run, 'team-hp')) m.maxHp += 1;
    let mood = leaderHas(run, 'steady') ? 1 : 0;
    if (SIDE_BOND_ATK) { if (m.bond === 'high') m.atk += 1; else mood -= 1; } // 2026-11-24 用户「站在那边不要加心情了，就加威力」: backed → 威力 +1 (no mood); hired against → mood −1 as before
    else mood += m.bond === 'high' ? 1 : -1; // §2.2 bond: start mood ±1
    mood -= ascOn(run, 'startMood'); // 黄金: one mood lower
    m.mood = clamp(mood, (c.hiddenTraits || []).includes('loyal') ? -1 : -2, 2);
    m.hp = m.maxHp; // v2.3 §A[17]: hp carries over between battles
    run.members[c.id] = m;
    run.party.push(c.id);
  }

  function addLeader(data, run) {
    const cls = (data.leader.classes || []).find((x) => x.id === (run.leader && run.leader.class)) || {};
    const def = LEADER_DEFAULTS()[cls.id] || LEADER_DEFAULTS().guardian;
    const sk = cls.skill || def.skill;
    const m = {
      id: LEADER_ID, leader: true, role: cls.role || def.role, maxHp: allyHp(cls.hp != null ? cls.hp : def.hp), atk: cls.atk != null ? cls.atk : def.atk,
      skill: { kind: sk.kind, name: sk.name, text: sk.text, power: sk.power || 0 },
      combo: clone(cls.combo || def.combo) || null,
      mood: leaderMoodOn(run) ? 0 : null, bond: null, statuses: [], tokens: [], growth: [], revealed: [], dpsHistory: [], lastDps: null, rewardsReceived: [], debuffsReceived: [],
    };
    if (leaderHas(run, 'team-hp')) m.maxHp += 1;
    m.hp = m.maxHp;
    run.members[LEADER_ID] = m;
    run.party.splice(cls.role === 'tank' ? 0 : Math.floor(run.party.length / 2), 0, LEADER_ID); // tank leader stands in front, else middle
  }

  // SPEC-2026-11-13 E3: the rejected girl who led this level's squad, once beaten: she gets her last words (by grudge),
  // the noble cuts her off and has the 'new toy' carried off (→ the doll cabinet), the leader says one line
  function rejectedLed(run, cfg) { return rejectedAll(run, cfg)[0] || null; }
  // 2026-11-20 L4–L7 改版: every rejected girl in this level's squad (L4 / L6 bring two)
  function rejectedAll(run, cfg) {
    if (rejectedShort(run, cfg)) return [];
    const out = [];
    for (const w of cfg.waves || []) for (const e of w) if (e.rejected) for (const r of e.rejected) { const x = run.rejected[r - 1]; if (x && !out.includes(x.id)) out.push(x.id); }
    return out;
  }
  function defeatLines(data, run, cfg, id) {
    const D = data.stories && data.stories.rejectedDefeat;
    if (!D) return null;
    const herOf = (x) => { const g = (run.rejectedInfo[x] && run.rejectedInfo[x].grudge) || 'high'; return (D.girls && D.girls[x] && D.girls[x][g]) || []; };
    const her = [].concat(...(Array.isArray(id) ? id : [id]).map(herOf)); // 2026-11-20: a squad of two — both say their last words, then the rest once
    const gal = D.gallery && (D.gallery[String(cfg.level)] || D.gallery['4']);
    const lead = (D.leader && D.leader[run.flags && run.flags.seal === 'refuse' ? 'refuse' : 'accept']) || [];
    const out = her.concat(gal ? [gal] : [], asList((Array.isArray(id) && id.length > 1 && D.narratorMany) || D.narrator).slice(0, 1), lead.length ? [lead[cfg.level % lead.length]] : []);
    return her.length ? out : null;
  }
  function postQueue(data, run, cfg) {
    const q = [];
    const post = cfg.post;
    const beatenAll = rejectedAll(run, cfg); // 2026-11-20 L4–L7 改版: L4 / L6 = two girls, one defeat beat with both
    const dl = beatenAll.length ? defeatLines(data, run, cfg, beatenAll) : null;
    if (dl) { run.defeatLines = dl; q.push({ story: 'rejectedDefeat', ctx: { name: listSeq(beatenAll.map((x) => nameOf(data, x))) } }); } // before the reward / debuff / sacrifice
    // 2026-11-19 流程修 H3: the gate slam (sealing) is 'the moment the fight ends' — it plays before the reward, not after it
    const storyFirst = SEALING_BEFORE_REWARD && cfg.postStory === 'sealing' && post !== 'finale' && post !== 'trueEnding' && post !== 'advisorLeaves';
    if (storyFirst) q.push({ story: cfg.postStory });
    if (post === 'reward' || post === 'rewardAndDebuff') q.push({ phase: 'reward' });
    if (post === 'rewardAndDebuff') {
      if (!run.debuffIntroShown) { q.push({ story: 'debuffIntro' }); run.debuffIntroShown = true; }
      q.push({ phase: 'debuff' });
    }
    // feedback-1112 #14: no more writing your own name — the first sacrifice is name | random, the second is name only
    if (post === 'sacrifice') q.push({ story: 'sacrificeIntro' }, { phase: 'sacrifice', modes: ['name', 'random'] });
    // 2026-11-18 growth-flow (用户定「小铃的祝福：第 5 关献祭那一晚，高级加成三选一」): right after the first sacrifice. Switch BLESSING_ON.
    if (post === 'sacrifice' && BLESSING_ON && blessingPool(data).length && !run.blessing) q.push({ story: 'bellBlessing' }, { phase: 'reward', blessing: true }, { story: 'bellBlessingAfter' }); // 2026-11-19 user: she wishes them well after the pick (and almost lets it slip)
    if (post === 'secondSacrifice') { // v2.2 §4.1/§4.2: every branch gets the second sacrifice (no dice)
      q.push({ story: run.branch === 'self' ? 'secondSacrificeIntroSelf' : 'secondSacrificeIntro' }, { phase: 'sacrifice', modes: ['name'] });
    }
    if (post === 'finale') { // §4.4: after L10, the true door or the white room
      if (cfg.postStory) q.push({ story: cfg.postStory });
      if (L10_EXIT_V2) q.push({ story: 'l10Fall' }, { story: 'l10Free' }); // 2026-11-21: her fall, then 「可以走了」, then the door on the way out
      // 2026-11-15 小门: a small door at the side of the path shows the three keys (sideDoor = all three, the button
      // 【打开小门】 → act openDoor; sideDoorPass = an ordinary door, she walks on past on a plain continue). Old saves already
      // past this point keep their queue (no door); a save mid-L10 builds this queue when the battle is won.
      q.push({ story: trueRoute(data, run) ? 'sideDoor' : 'sideDoorPass' });
      if (trueRoute(data, run)) { noteRecent(run, { when: 'afterDoor' }); q.push({ story: 'trueDoor' }, { startLevel: cfg.level + 1 }); } // 2026-11-19 流程修 M3: the L11 night talks about the door / the bell
      else { run.whiteout = true; q.push({ story: 'normalEnding' }, { story: 'whiteRoom' }, { phase: 'ending', outcome: 'victory' }); } // feedback-1112 #39/#40: the white room, the last talk
      return q;
    }
    if (post === 'trueEnding') { // §4.5: L11 won
      if (cfg.postStory) q.push({ story: cfg.postStory });
      // 2026-11-14: she is beaten → the nobles flee, she flies off, the dolls turn back (stories l11After, 8 lines), then the
      // epilogue (trueEnding). Once per run: run.flags.l11After; the queue is saved with the run, so a reload / 读档 never replays it.
      if (!(run.flags || {}).l11After) { if (!run.flags) run.flags = {}; run.flags.l11After = true; q.push({ story: 'l11After' }); }
      // 2026-11-21 用户「清晨的公会那段话说了两遍，有一遍是在还没回到公会画面的时候」: the dawn lines play once, on the guild screen
      // (the ending's playTrueEnding reads view.trueEnding.lines); TRUE_END_ONCE false = the old story step in the broken chamber first
      if (!TRUE_END_ONCE) q.push({ story: 'trueEnding' });
      q.push({ phase: 'ending', outcome: 'true' });
      return q;
    }
    // 2026-11-20 用户「第 9 关结束到第 10 关流程不对：篝火突兀、路线图没用上；不要篝火，自动回血，不补锻炼；第 9 关没有战利品」(EXIT_FLOW):
    // L9 won → 战利品 → 「你们自由了」 → everyone patches up (rest heal, automatic) → no campfire / formation → the L10 intro (路线图 to
    // the 「出口」 node) → through the door → the throne → she turns → finalReveal → the battle (the L9 order stands; the opening pause can swap)
    if (post === 'advisorLeaves' && EXIT_FLOW) {
      q.push({ story: THRONE_STORIES[0] }, { exitHeal: true }); // 2026-11-20 用户「就不要战利品了」: no reward after L9 (as before)
      if (cfg.postStory) q.push({ story: cfg.postStory });
      q.push({ startLevel: cfg.level + 1, march: true, exit: true });
      return q;
    }
    if (post === 'advisorLeaves') { // feedback-1112 #35: L9 won → 「you are free」 → all walk through the door together → the throne → she turns
      for (const id of THRONE_STORIES) q.push({ story: id });
      q.push({ removeAdvisor: true, turn: true });
      if (cfg.postStory) q.push({ story: cfg.postStory });
      // 2026-11-16 (用户「感觉还是过一次篝火吧」): a campfire between L9 and L10 again (was march: no campfire) — MARCH_L9 = true restores it
      q.push(MARCH_L9 ? { startLevel: cfg.level + 1, march: true } : { startLevel: cfg.level + 1 });
      return q;
    }
    if (cfg.postStory && !storyFirst) q.push({ story: cfg.postStory }); // 2026-11-19 流程修 H3: sealing already queued first
    q.push(post === 'ending' ? { phase: 'ending' } : { startLevel: cfg.level + 1 });
    return q;
  }

  const IRON_L10 = true; // 2026-11-21 用户 奥德丽战「考验是破甲」: 铁甲兵 (60 血 + 60 护甲), everyone half 护甲, 列阵 +5, 护甲不掉, 法师群伤 / 弓手点人, 守卫倒后阵线打前三. false = old L10
  const CHESTNUT_FOREVER = true; // 2026-11-21 用户「永久扣」: the member's own max hp drops too (false = this fight only)
  const CHESTNUT_MAXHP = true; // 2026-11-21 栗子扣生命上限（false = 扣当前生命）
  const CHESTNUT_HINT = true; // 2026-11-24: a girl's 2nd chestnut gets one uneasy line (camp.chestnutNumb) so the L10 poison has a clue; false = no clue (the old)
  const CHESTNUT_POISON = true; // 2026-11-21 奥德丽 meta: the chestnuts she handed out poison at her fight (false = off)
  const EXIT_CARD_AFTER_TURN = true; // 2026-11-21 用户「开始之前是出口，开战之后都是第十关；关卡的标题要在顾问叛变之后出现」: the walk out names no level number; the L10 card (cardTitle) plays after her turn. false = card right after the intro
  const EXIT_FLOW = true; // 2026-11-20 L9 → L10 (see postQueue / startLevel); false = old: throne stories, then the L10 campfire
  const THRONE_STORIES = ['l9Freedom', 'throneRoom', 'throneAdvisor']; // feedback-1112 #35
  const BOSS_SKILL_TEXT = lazy(() => ({ formation: TX('battle.bossSkill.formation'), clause: TX('battle.bossSkill.clause'), luck: TX('battle.bossSkill.luck'), overtime: TX('battle.bossSkill.overtime') })); // #36
  // feedback-1112 #14: self-sacrifice is gone, so every tier needs the two keys: the dice (first sacrifice left to the rules) + the bell.
  // Only the FIRST sacrifice can block it by naming a girl (the second one is always written by hand).
  const trueRoute = (data, run) => !!(run.keys && run.keys.refuse && run.keys.rules && run.keys.bell && !run.namedGirl && levelCfg(data, 11)); // all three keys, every tier
  // 2026-11-15 小门: one slot per key, in the order the run meets them (L3 seal → the first sacrifice → the bell). Pure.
  // rules counts only when the first sacrifice was left to the dice (naming a girl blocks it, whatever came later).
  const DOOR_KEYS = ['refuse', 'rules', 'bell'];
  function doorView(data, run) {
    const k = run.keys || KEYS0();
    const slots = DOOR_KEYS.map((key) => ({ key, got: !!k[key] && !(key === 'rules' && run.namedGirl) }));
    return { slots, open: trueRoute(data, run) };
  }
  // 2026-11-20 铃之门 (用户「钥匙门 没达成条件不要跳过去 … 三个槽位都有铜铃 … 你获得了xx之铃」): the three keys are named
  // bells — refuse 反抗之铃 · rules 公正之铃 · bell 好奇之铃 (text: data/text/zh/engine.json bellKey.*). The door always stops:
  // view.bellDoor { have, total, slots: [{ key, got, name, hint }] }; not all three → the UI's 【那就算了吧】 (a plain continue =
  // the normal route), all three → 【进去看看】 (act openDoor, the same true route). Each newly lit key → 「你获得了xx之铃」 as the
  // last line of that scene (story ctx.bellGot) + a silent { kind: 'bellKey' } event. false = the old door (walk past, no names).
  const BELL_DOOR = true;
  const BELL_NAME = lazy(() => ({ refuse: TX('bellKey.name.refuse'), rules: TX('bellKey.name.rules'), bell: TX('bellKey.name.bell') }));
  const BELL_HINT_LOST = false; // 2026-11-25 用户「铃铛介绍保持一致 不需要说 你没说 没拿到」: every slot shows just name + how to get it. true = the old 「（你那次点了名…）」
  const BELL_HINT = lazy(() => ({ refuse: TX('bellKey.hint.refuse'), rules: TX('bellKey.hint.rules'), bell: TX('bellKey.hint.bell'), rulesLost: TX('bellKey.hint.rulesLost') }));
  const BELL_HAVE = lazy(() => [TX('story.bellDoor.have0'), TX('story.bellDoor.have1'), TX('story.bellDoor.have2'), TX('story.bellDoor.have3')]); // literal keys (i18n scan)
  const keyLit = (run, key) => !!(run.keys && run.keys[key]) && !(key === 'rules' && run.namedGirl); // = doorView's slot.got
  function bellDoorView(data, run) { // pure
    const d = doorView(data, run);
    const slots = d.slots.map((s) => ({ key: s.key, got: s.got, name: BELL_NAME()[s.key],
      hint: BELL_HINT_LOST && s.key === 'rules' && !s.got && run.namedGirl ? BELL_HINT().rulesLost : BELL_HINT()[s.key] }));
    return { have: slots.filter((s) => s.got).length, total: slots.length, slots, open: d.open };
  }
  function bellGot(run, key, before, ev) { // the key just lit → its name goes on the event (and the caller's story ctx); else null
    if (!BELL_DOOR || before || !keyLit(run, key)) return null;
    ev.push({ kind: 'bellKey', key, name: BELL_NAME()[key] });
    return key;
  }
  function openDoor(data, run, ev) {
    if (!run.story || !run.story.door) fail('no door here');
    if (!doorView(data, run).open) fail('the door does not open');
    if (!run.flags) run.flags = {};
    run.flags.door = 'open';
    ev.push({ kind: 'doorOpen' });
    advance(data, run, ev);
  }
  function skipDoor(data, run, ev) { // 2026-11-21 L10_EXIT_V2: all three bells, but she walks on → the normal route (the queued trueDoor / L11 dropped)
    if (!L10_EXIT_V2) fail('no skipDoor');
    if (!run.story || !run.story.door) fail('no door here');
    if (!run.flags) run.flags = {};
    run.flags.door = 'skipped';
    ev.push({ kind: 'doorSkip' });
    run.whiteout = true;
    run.queue = [{ story: 'normalEnding' }, { story: 'whiteRoom' }, { phase: 'ending', outcome: 'victory' }]
      .concat((run.queue || []).filter((x) => !(x && (x.story === 'trueDoor' || x.startLevel != null))));
    advance(data, run, ev);
  }
  function ignoreBell(run) { if (run.bell) { run.bell = false; run.bellDone = true; } }

  // ---------- v2.3 §B1/B2 camp: rest / explore / train ----------
  function relicDef(data, id) {
    const r = dig(linesV2(data), 'relics', id) || {};
    const f = RELIC_FALLBACK()[id] || { name: id, text: '' };
    return { id, name: r.name || f.name, text: r.text || f.text, ringLine: hasAny(r.ringLine) ? r.ringLine : f.ringLine || [] };
  }
  const bagFull = (run) => (run.items || []).length >= BAG_MAX;
  const CAMP_EXPLORE = false; // 2026-11-18 growth-flow switch: true = the old rest / explore / train camp
  // 2026-11-19 (用户定): the 3 training cards are one of each kind (training.json normal[].kind) — 苦练 drill (经验 +4, 心情 −1) /
  // 交心 heart (经验 +2, 心情 +1) / 养伤 mend (经验 +2, 生命 +5). The special cards (拼命 / 狠话 / …) are not dealt then.
  // false: the old deal (a skill-level card, another normal card, a special card).
  const TRAIN_KINDS = true, TRAIN_KIND_IDS = ['drill', 'heart', 'mend'];
  // 2026-11-24 用户「五类里抽三类」(TRAIN_KINDS_V2): 苦练 drill always, then two kinds drawn from TRAIN_KIND_PICK (each one card); false = drill / heart / mend
  const TRAIN_KINDS_V2 = true, TRAIN_KIND_PICK = ['heart', 'mend', 'luck', 'power', 'vigor'];
  const RULES_NIGHT_TRAIN_FIRST = false; // 2026-11-18 growth-flow round 2: the rules night trains first, then rest / train (false: the plain choice)
  const exploreN = (data, run) => (leaderHas(run, 'explorer') ? EXPLORE_N_OUTLANDER : EXPLORE_N);
  const restAmount = (data, run) => restHp(run) + (advisorFlow(data, run) === 'tea' ? TEA_HP : 0); // H1-1 露西安「热茶」
  // 2026-11-22 试玩「休息只回 7 点，后期上限 20–30 补不回来」(REST_PCT): each member heals the larger of the flat rest and REST_PCT of her 生命上限 (+ 热茶). 0 = the old flat
  const REST_PCT = 0; // 2026-11-22 用户「休息还是恢复固定血，要保持简单为原则」(tried 0.4)
  const restFor = (data, run, m) => Math.max(0, Math.max(restHp(run), Math.ceil((m.maxHp || 0) * REST_PCT)) + (advisorFlow(data, run) === 'tea' ? TEA_HP : 0) - ascOn(run, 'restLess')); // 白银: −3
  const hasAny = (x) => (Array.isArray(x) ? x.length > 0 : x != null);
  function trainingPool(data) {
    const T = data.training || {};
    const ok = (arr) => (Array.isArray(arr) ? arr.filter((b) => b && b.id && b.effect) : []);
    return { normal: ok(T.normal).length ? ok(T.normal) : TRAINING_FALLBACK().normal, special: ok(T.special).length ? ok(T.special) : TRAINING_FALLBACK().special };
  }
  const campNeed = (run, step) => { if (!run.camp) run.camp = { step: 'choose' }; if (run.camp.step !== step) fail(`camp step is ${run.camp.step}, not ${step}`); return run.camp; };
  // 2026-11-13 休息回血提示: pure — what resting would do to each party member right now: [{ id, name, amount, hp, maxHp, full }]
  // (hp / maxHp are after the rest; full: she was already at max, amount 0)
  function restPreview(data, run) {
    return run.party.filter((id) => run.members[id]).map((id) => {
      const m = run.members[id], hp0 = hpOf(m), hp = Math.min(m.maxHp, hp0 + restFor(data, run, m));
      return { id, name: nameOf(data, id), amount: Math.max(0, hp - hp0), hp, maxHp: m.maxHp, full: hp0 >= m.maxHp, block: hp0 >= m.maxHp ? REST_BLOCK : 0 };
    });
  }
  // G2 #10 (until 2026-11-16): odd campfires offered rest / explore, even ones rest / train — now every night all three. The bell night keeps every option.
  // 试玩反馈 2026-11-15: the rules night (run.sealNight) is rest / explore only — no training (it broke the every-other-night rhythm)
  // (old saves without camp.night: all three)
  function campOptionIds(run) {
    const C = run.camp || {};
    if (!CAMP_EXPLORE) { // 2026-11-18 growth-flow (用户定「篝火只有 休息 / 锻炼 二选一」): no explore; items come from rewards + the shop
      if (run.bell) return ['followBell', 'rest', 'train'];
      return ['rest', 'train'];
    }
    if (run.bell) return ['followBell', 'rest', 'explore', 'train'];
    if (run.sealNight) return ['rest', 'explore'];
    return ['rest', 'explore', 'train']; // 2026-11-16 营火 (ISSUES 七): every night all three (was odd nights rest / explore, even rest / train)
  }
  // 2026-11-16 营火 (ISSUES 七): each real campfire night, before the choice, everyone +nightHeal hp (never above max) — 木头 only
  // (tier field nightHeal; other tiers / untiered: none). Event { kind: 'nightHeal', amount, heals: [{ id, name, from, to }] }.
  function nightHeal(data, run, ev) {
    const n = tierRule(run, 'nightHeal') || 0;
    if (!(n > 0)) return;
    const heals = [];
    for (const id of run.party) {
      const m = run.members[id];
      if (!m) continue;
      const before = statsOf(m, isLeader(id)), from = hpOf(m);
      m.hp = Math.min(m.maxHp, from + n);
      if (m.hp !== from) heals.push({ id, name: nameOf(data, id), from, to: m.hp });
      statChange(data, run, ev, id, before, 'nightHeal');
    }
    ev.push({ kind: 'nightHeal', amount: n, heals, text: TX('camp.nightHeal', { n }) });
  }
  function campChoose(data, run, choice, ev) {
    if (choice === 'followBell') return HANDLERS.prep.followBell(data, run, {}, ev);
    const C = campNeed(run, 'choose');
    if (!CAMP_OPTIONS()[choice] || choice === 'followBell') fail('bad camp choice ' + choice);
    if (!campOptionIds(run).includes(choice)) fail(`camp choice ${choice} is not offered tonight`); // G2 #10
    if (choice === 'explore' && bagFull(run)) { // v2.4 [24]: disabled; a stray click is a no-op with the tip
      ev.push({ kind: 'tip', reason: 'bagFull', choice, text: BAG_FULL_TIP() });
      return;
    }
    ignoreBell(run); // choosing anything else lets the bell go
    C.choice = choice;
    ev.push({ kind: 'camp', choice, text: CAMP_OPTIONS()[choice].label });
    if (choice === 'rest') {
      const healed = [], heals = restPreview(data, run); // 2026-11-13 休息回血提示: the same numbers the camp card showed
      for (const id of run.party) {
        const m = run.members[id], before = statsOf(m, isLeader(id));
        if (hpOf(m) >= m.maxHp) m.restBlock = REST_BLOCK; // 2026-11-14 满血休息: +1 护甲 into the next battle's round 1 (no 蓝血)
        m.hp = Math.min(m.maxHp, hpOf(m) + restFor(data, run, m));
        if (m.hp !== before.hp) healed.push({ id, from: before.hp, to: m.hp });
        statChange(data, run, ev, id, before, 'rest');
      }
      { // 试玩反馈 2026-11-14 晚 #21: a quiet night by the fire — the lowest-mood girl (first in order on ties) +1
        const girls = run.party.filter((id) => !moodless(run, id) && run.members[id] && (run.members[id].mood || 0) < 2); // 2026-11-20 团长心情: she can be the one too
        if (girls.length) { const low = girls.reduce((b, id) => ((run.members[id].mood || 0) < (run.members[b].mood || 0) ? id : b), girls[0]); const d = {}; addMood(d, low, 1, TX('mood.why.rest')); applyMoods(data, run, ev, d); }
      }
      if (advisorFlow(data, run) === 'tea') { const a = advisorData(data, run), f = flowOf(a); // H1-1: she names it, so the extra +1 has a cause
        ev.push({ kind: 'advisorFlow', flow: 'tea', speaker: a.id, speakerId: a.id, name: a.name, expr: 'happy', text: (REST_TEA_SPLIT ? (v) => TX('camp.tea2', v) : (v) => TX('camp.tea', v))({ skill: f.name, hp: TEA_HP, base: restHp(run), total: restAmount(data, run) }) }); // 2026-11-19 试玩修 数值文字: camp.tea2 says the +1 is inside the total
      }
      ev.push({ kind: 'rest', heals });
      C.result = { healed, heals };
      C.step = 'done';
    } else if (choice === 'explore') {
      C.offer = rngSample(run, itemDefs(data).filter((it) => it.explore !== false).map((it) => it.id), exploreN(data, run)); // v2.4 [5] outlander: 3 · H1-1 妮可塔 +1
      C.step = C.offer.length ? 'explore' : 'done';
    } else C.step = 'train-pick';
  }
  function campExplore(data, run, itemId, drop, ev) {
    const C = campNeed(run, 'explore');
    if (!C.offer.includes(itemId)) fail('item not among the finds: ' + itemId);
    const it = itemDef(data, itemId);
    let added = true, dropped = null;
    if (run.items.length >= BAG_MAX) {
      const di = drop != null ? run.items.indexOf(drop) : -1;
      if (di >= 0) { dropped = run.items.splice(di, 1)[0]; } else added = false;
    }
    if (added) run.items.push(itemId);
    C.kept = itemId;
    C.result = { kept: itemId, added, dropped };
    C.step = 'done';
    ev.push({ kind: 'item', itemId, added, lost: !added, dropped, source: 'explore',
      text: added ? (dropped ? TX('camp.explore.keptDropped', { item: it.name, dropped: itemDef(data, dropped).name }) : TX('camp.explore.kept', { item: it.name })) : TX('camp.explore.bagFull', { item: it.name }) });
  }
  // the 1-on-1 talk: campfire talks with when 'train' that name her (or bind her as $0 via '*'), else a generic one
  function trainTalk(data, run, id) {
    const talks = (data.campfire && Array.isArray(data.campfire.talks)) ? data.campfire.talks : [];
    const played = run.talksPlayed || (run.talksPlayed = []);
    const named = (t) => (t.who || []).filter((w) => w !== '*');
    const actOk = (t) => !Array.isArray(t.act) || !t.act.length || t.act.includes(actOf(run));
    const TW = run.sealNight ? 'trainSeal' : 'train'; // SPEC-2026-11-13 E1+: on the rules night the 1-on-1 talk is about the rules too
    const fits = isLeader(id) // v2.4 [11]: training the leader → her own musing (talk train-leader), never a '*' talk
      ? (t) => t && t.id && Array.isArray(t.lines) && t.lines.length && actOk(t) && ((!run.sealNight && t.id === 'train-leader') || (t.when === TW && named(t).length > 0 && named(t).every(isLeader) && !(t.who || []).includes('*')))
      : (t) => t && t.id && t.when === TW && Array.isArray(t.lines) && t.lines.length && actOk(t)
      && named(t).every((w) => w === id || isLeader(w)) && (named(t).includes(id) || (t.who || [])[0] === '*');
    const all = talks.filter(fits).filter((t) => !t.lines.some((raw) => { // v2.4 [21]
      const o = raw && typeof raw === 'object' ? raw : { text: raw };
      const sp = o.speaker === '$0' || o.speaker === id ? id : null;
      return sp && String(o.text || '').includes(nameOf(data, id)) && !/\$0/.test(String(o.text || ''));
    }));
    const mine = all.filter((t) => named(t).includes(id));
    const pick = (arr) => { const fresh = arr.filter((t) => !played.includes(t.id)); return fresh.length ? rngPick(run, fresh) : arr.length ? rngPick(run, arr) : null; };
    const t = pick(mine) || pick(all);
    if (t && !played.includes(t.id)) played.push(t.id);
    const bound = t ? (t.who || []).map((w) => (w === '*' ? id : w)) : [id];
    if (t && !bound.includes(id)) bound[0] = id;
    const sub = (str) => String(str == null ? '' : str).replace(/\$(\d)/g, (m, i) => (bound[+i] != null ? nameOf(data, bound[+i]) : m));
    const lines = (t ? t.lines : isLeader(id) ? TRAIN_LEADER_FALLBACK() : TRAIN_TALK_FALLBACK()).map((raw) => {
      const o = raw && typeof raw === 'object' ? Object.assign({}, raw) : { text: raw };
      if (typeof o.speaker === 'string' && /^\$\d$/.test(o.speaker)) o.speaker = bound[+o.speaker.slice(1)] || 'narrator';
      o.text = sub(o.text);
      return resolveLine(data, run, o, { name: nameOf(data, id) }, 'narrator');
    });
    if (t && lines.some(selfNamed)) { // v2.4 [21]: never let her say her own name — use the generic talk instead
      const fb = isLeader(id) ? TRAIN_LEADER_FALLBACK() : TRAIN_TALK_FALLBACK();
      const sub0 = (str) => String(str == null ? '' : str).replace(/\$0/g, nameOf(data, id));
      return { talkId: null, lines: fb.map((raw) => resolveLine(data, run, Object.assign({}, raw, { speaker: raw.speaker === '$0' ? id : raw.speaker, text: sub0(raw.text) }), { name: nameOf(data, id) }, 'narrator')) };
    }
    return { talkId: t ? t.id : null, lines };
  }
  function campTrainPick(data, run, id, ev) {
    const C = campNeed(run, 'train-pick');
    if (!run.party.includes(id)) fail('not in the party: ' + id);
    const talk = trainTalk(data, run, id);
    for (const l of talk.lines) ev.push(Object.assign({ kind: 'line' }, l, { key: 'trainTalk', talkId: talk.talkId, id }));
    const P = trainingPool(data);
    const okFor = (b) => !moodless(run, id) || ((b.effect || {}).type !== 'mood' && (b.downside || {}).type !== 'mood'); // the leader has no mood (LEADER_MOOD false)
    // 2026-11-15 user: a maxed skill gets no skill-level cards at all (they used to show as 威力 +1 — confusing)
    const mm = run.members[id], maxed = !!(mm && mm.skill && lvOf(mm.skill) >= SKILL_LV_MAX);
    const notSU = (b) => !(maxed && b && b.effect && b.effect.type === 'skillUp');
    const nPool = P.normal.filter(okFor).filter(notSU), sPool = P.special.filter(okFor).filter(notSU);
    // growth-and-relics §9.1/§9.4 (试玩反馈 2026-11-14 晚): card 1 is ALWAYS a skill-level card (对练 / 复盘; a maxed skill shows
    // as 威力 +1 via skillUpAs), card 2 another normal card that is not skillUp, card 3 a special card (a cost that buys more)
    const isSU = (b) => b && b.effect && b.effect.type === 'skillUp';
    const nAll = nPool.length ? nPool : P.normal.filter(notSU), suPool = nAll.filter(isSU), restPool = nAll.filter((b) => !isSU(b));
    const kindIds = TRAIN_KINDS_V2 ? ['drill'].concat(rngSample(run, TRAIN_KIND_PICK.filter((k) => nAll.some((b) => b.kind === k)), 2).sort((a, b) => TRAIN_KIND_PICK.indexOf(a) - TRAIN_KIND_PICK.indexOf(b))) : TRAIN_KIND_IDS;
    const byKind = TRAIN_KINDS ? kindIds.map((k) => nAll.filter((b) => b.kind === k)) : null;
    if (byKind && byKind.every((arr) => arr.length)) { // 2026-11-19: one drill, one heart, one mend (seeded rng, in that order)
      const bonuses = byKind.map((arr) => Object.assign(clone(rngSample(run, arr, 1)[0]), { special: false })).map((b) => deadExtra(run, id, costFor(data, run, id, b)));
      Object.assign(C, { trainee: id, talkId: talk.talkId, talk: talk.lines, bonuses, step: 'train-bonus' });
      return;
    }
    const first = suPool.length ? rngSample(run, suPool, 1) : [];
    const second = rngSample(run, restPool.length ? restPool : nAll.filter((b) => !first.includes(b)), first.length ? 1 : 2);
    const bonuses = first.concat(second).map((b) => Object.assign(clone(b), { special: false }))
      .concat(rngSample(run, sPool.length ? sPool : P.special.filter(notSU), 1).map((b) => Object.assign(clone(b), { special: true })))
      .map((b) => costFor(data, run, id, b))
      .map((b) => (isLeader(id) && b.leaderLabel ? Object.assign(b, { label: b.leaderLabel, text: b.leaderText || b.text }) : b)); // 2026-11-22 试玩4 #10: 「夸她」 makes no sense for the leader herself
    Object.assign(C, { trainee: id, talkId: talk.talkId, talk: talk.lines, bonuses, step: 'train-bonus' });
  }
  // 2026-11-22 试玩「心情已满时，谈心（心情 +1、经验）被早点睡（生命、经验）完全压过」(TRAIN_DEAD_EXTRA): a card whose extra would do
  // nothing — 心情 +n when she is already at the top, 生命 +n when she is at full — trades that extra for 经验 +1. false = old (dead extra kept)
  const TRAIN_DEAD_EXTRA = true;
  function deadExtra(run, id, b) {
    const m = run.members[id], x = b && b.extra;
    if (!TRAIN_DEAD_EXTRA || !m || !x || !b.effect || b.effect.type !== 'xp') return b;
    const dead = (x.type === 'mood' && x.delta > 0 && !moodless(run, id) && (m.mood || 0) >= 2) || (x.type === 'stat' && x.stat === 'hp' && x.delta > 0 && hpOf(m) >= m.maxHp);
    if (!dead) return b;
    b.effect = Object.assign({}, b.effect, { n: (b.effect.n || 0) + 1 }); b.deadExtra = x; delete b.extra;
    b.deadText = x.type === 'mood' ? TX('training.deadExtra.mood', { n: x.delta }) : TX('training.deadExtra.hp', { n: x.delta }); // 2026-11-22 试玩 round-3 #11: say why 热敷 heals nothing
    return b;
  }
  // 2026-11-19 用户亲测 界面 (锻炼选人: 等级 + 离升级多远 + 这次锻炼会不会升级 最显眼): per member, would a training card level her up?
  // 'all' = every normal card she can get does, 'some' = at least one does (e.g. 苦练), absent = none. Read only (UI data)
  function trainUpView(data, run) {
    const P = trainingPool(data), out = {};
    for (const id of run.party) {
      const ok = P.normal.filter((b) => !moodless(run, id) || ((b.effect || {}).type !== 'mood' && (b.downside || {}).type !== 'mood'));
      const ups = ok.map((b) => { const g = xpGainFor(data, run, id, [b.effect, b.extra, b.downside]); return !!(g && (g.up > 0 || g.over > 0)); });
      if (ups.length && ups.every(Boolean)) out[id] = 'all'; else if (ups.some(Boolean)) out[id] = 'some';
    }
    return out;
  }
  // 试玩反馈 2026-11-15: a card may carry downsideBack (+ textBack) — the cost for a back-row class (法师 / 猎人 / 牧师);
  // front-row classes (战士 / 刺客) keep downside. Resolved when the card is dealt, so view, preview and apply agree.
  // The leader has no mood: a mood downsideBack never applies to her (she keeps the plain downside).
  const BACK_ROLES = { mage: 1, adc: 1, healer: 1 };
  function roleOfMember(data, run, id) { const m = run.members[id] || {}; return m.role || ((cand(data, id) || {}).role) || null; }
  function costFor(data, run, id, b) {
    const back = b.downsideBack;
    delete b.downsideBack;
    if (!back || !BACK_ROLES[roleOfMember(data, run, id)] || (moodless(run, id) && back.type === 'mood')) { delete b.textBack; return b; }
    b.downside = back; b.back = true;
    if (b.textBack) b.text = b.textBack;
    delete b.textBack;
    return b;
  }
  function applyBonusEff(data, run, id, eff, d, why) { // why: 2026-11-24 MOOD_WHY label (the training card)
    if (!eff) return;
    const m = run.members[id];
    if (eff.type === 'mood') { if (!moodless(run, id)) addMood(d, id, eff.delta, why || TX('mood.why.train')); return; }
    const su = eff.type === 'skillUp' ? skillUpAs(m) : null; // DESIGN-skill-level: a maxed skill takes atk +1 instead
    statEff(m, eff);
    if (eff.type === 'xp') { m.growth.push({ source: 'train', stat: 'xp', delta: eff.n || 0, level: run.level }); return; } // 2026-11-16 经验
    if (eff.type === 'stat' && eff.stat === 'hp') return; // 2026-11-19 养伤卡: a heal, not growth
    if (eff.type === 'stat' || su) m.growth.push({ source: 'train', stat: su ? su.stat : eff.stat, delta: su ? su.delta : eff.delta, level: run.level });
  }
  // 2026-11-19 试玩修 剧情: after a heart card (谈心 / 夸她 / 加餐) she answers — lines-v2 trainReact.<her id>.<card id>; the
  // n-th time she gets that card says line n (mod the list): no rng, so a repeat says the other line
  function trainReact(data, run, id, b, ev) {
    const ls = dig(linesV2(data), 'trainReact', id, b.id);
    if (!Array.isArray(ls) || !ls.length) return;
    if (!run.flags) run.flags = {};
    const seen = run.flags.trainReact || (run.flags.trainReact = {});
    const k = id + ':' + b.id, n = seen[k] || 0;
    seen[k] = n + 1;
    ev.push(lineEvent(data, run, ls[n % ls.length], { name: nameOf(data, id) }, id, { id, key: 'trainReact', bonusId: b.id }));
  }
  function campTrainBonus(data, run, bonusId, ev) {
    const C = campNeed(run, 'train-bonus');
    const b = C.bonuses.find((x) => x.id === bonusId) || fail('bonus not offered: ' + bonusId);
    const id = C.trainee, before = statsOf(run.members[id], isLeader(id)), d = {};
    applyBonusEff(data, run, id, b.effect, d, b.label);
    applyBonusEff(data, run, id, b.extra, d, b.label); // 试玩反馈 2026-11-14 晚 #7: a card with a cost buys a second effect
    applyBonusEff(data, run, id, b.downside, d, b.label);
    ev.push({ kind: 'train', id, name: nameOf(data, id), bonusId: b.id, label: b.label, special: !!b.special, text: `${nameOf(data, id)}：${b.label}` });
    applyMoods(data, run, ev, d);
    statChange(data, run, ev, id, before, 'train:' + b.id);
    trainReact(data, run, id, b, ev);
    C.picked = b.id;
    C.result = { trainee: id, bonusId: b.id };
    if (C.preTrain && !C.preTrainDone) { C.preTrainDone = true; C.preResult = C.result; C.step = 'choose'; return; } // rules night: the free training, now the choice
    C.step = 'done';
  }
  // fight / cheatWin during the camp step (old walkers, tests): rest, or the first offer at each sub-step
  function autoCamp(data, run, ev) {
    const C = run.camp;
    if (!C) return;
    for (let i = 0; i < 8 && C.step !== 'done'; i++) { // 8: the rules night trains first, then chooses
      if (C.step === 'choose') { if (run.bell) { ignoreBell(run); C.step = 'done'; C.choice = null; } else campChoose(data, run, 'rest', ev); }
      else if (C.step === 'explore') campExplore(data, run, C.offer[0], null, ev);
      else if (C.step === 'train-pick') campTrainPick(data, run, run.party[0], ev);
      else if (C.step === 'train-bonus') campTrainBonus(data, run, C.bonuses[0].id, ev);
    }
  }
  // 2026-11-19: a 交心 card when her mood is already at the top still shows — its line says 「心情已满」 instead of ☺+1
  function moodFullCard(run, id, b) {
    const m = run.members[id];
    if (b.extra && b.extra.type === 'mood' && b.extra.delta > 0 && m && !moodless(run, id) && m.mood >= 2) { b.extra = Object.assign({}, b.extra, { text: TX('training.moodFull') }); b.moodFull = true; }
    return b;
  }
  function campView(data, run) {
    const C = run.camp;
    if (!C) return null;
    const v = { step: C.step, bell: !!run.bell, choice: C.choice || null, quiet: !!C.quiet, march: !!C.march, result: C.result ? clone(C.result) : null, bagFull: bagFull(run) };
    if (C.preTrain && !C.preTrainDone) v.preTrain = true; // 2026-11-18 rules night: the free training before the choice (the choice is still to come)
    if (C.step === 'choose') {
      v.options = campOptionIds(run).map((k) => clone(CAMP_OPTIONS()[k]));
      v.night = C.night || null; // G2 #10: the Nth campfire of the run
      const fb = v.options.find((o) => o.id === 'followBell');
      // 2026-11-19 试玩修 剧情: 篝火没有「探索」了 — zh camp.noAction / ui camp.bell.noWoundDown 改成「这一夜不能休息或锻炼」
      // (旧的 backup，两处原文都是：「这一夜不能休息、探索或锻炼」)
      // 2026-11-22e 试玩5 #4: the wound text now says the whole cost (zh camp.followBell.wound / ui camp.bell.down; old text both: 「不休息，下一战带伤上阵」);
      // 好奇之铃 relic.bell.text (old 「功能不详。」, also kept in lines-v2 relics.bell._old_2026_11_22e)
      if (fb) fb.down = tierRule(run, 'bellWound') === false ? TX('camp.noAction') : TX('camp.followBell.wound'); // 2026-11-13: no wound on 木头
      const ex = v.options.find((o) => o.id === 'explore');
      if (ex) {
        const n = exploreN(data, run);
        if (n !== EXPLORE_N) ex.text = TX('camp.explore.textN', { count: NUM_CN()[n] || n });
        ex.count = n;
        if (bagFull(run)) { ex.disabled = true; ex.tip = BAG_FULL_TIP(); } // v2.4 [24]
      }
      const rest = v.options.find((o) => o.id === 'rest');
      v.restPreview = restPreview(data, run); // 2026-11-13 休息回血提示: per member, the exact heal campChoose('rest') will apply
      // 2026-11-19 试玩修 数值文字: 「热茶 +1 没生效」 was a reading problem — the card's number already had the tea in it (木头 7 + 1 = 8)
      // and her line then said 「额外 +1」. With the tea the card now spells out 7 + 1 = 8 (REST_TEA_SPLIT false: the old one number).
      const teaOn = advisorFlow(data, run) === 'tea';
      if (rest) { rest.text = REST_TEA_SPLIT && teaOn ? TX('camp.rest.textTea', { base: restHp(run), tea: TEA_HP, hp: restAmount(data, run) }) : (REST_PCT > 0 ? TX('camp.rest.textPct', { hp: restAmount(data, run), pct: Math.round(REST_PCT * 100) }) : TX('camp.rest.textN', { hp: restAmount(data, run) })); rest.heals = clone(v.restPreview); rest.preview = {}; for (const id of run.party) rest.preview[id] = previewFor(data, run, id, [{ type: 'stat', stat: 'hp', delta: restAmount(data, run) }], 0); }
    }
    if (C.offer) {
      v.explore = { offer: C.offer.map((id) => { const it = itemDef(data, id) || { id, name: id, text: '' }; return { itemId: id, name: it.name, text: it.text, needsTarget: !!itemAim(run, it), target: itemAim(run, it), kind: itemKind(it) || null, preview: {} }; }),
        bagFull: run.items.length >= BAG_MAX, kept: C.kept || null };
    }
    if (C.step === 'train-pick') v.train = { candidates: run.party.slice(), xp: Object.fromEntries(run.party.map((id) => [id, xpInfo(run.members[id])])), up: trainUpView(data, run) }; // 2026-11-16 经验条 · up: 2026-11-19 用户亲测 界面
    if (C.trainee) {
      v.train = { member: C.trainee, name: nameOf(data, C.trainee), talkId: C.talkId || null, talk: clone(C.talk || []), picked: C.picked || null,
        xp: run.members[C.trainee] ? xpInfo(run.members[C.trainee]) : null, // 2026-11-16 经验条
        bonuses: (C.bonuses || []).map((b) => { const pv = previewFor(data, run, C.trainee, [b.effect, b.extra, b.downside], 0);
          const crash = (pv || []).some((c) => c && c.stat === 'mood' && c.to <= -2 && c.from > -2); // 2026-11-22 试玩4 #11: 低落 → 崩溃 is warned on the card
          return Object.assign(moodFullCard(run, C.trainee, clone(b)), { preview: { [C.trainee]: pv }, xpGain: xpGainFor(data, run, C.trainee, [b.effect, b.extra, b.downside]) }, crash ? { crashText: TX('training.crash') } : {}); }) };
    }
    // flat aliases for the current step (what the UI acts on): items / candidates / bonuses
    if (C.step === 'explore' && v.explore) v.items = v.explore.offer;
    if (C.step === 'train-pick') v.candidates = v.train.candidates;
    if (C.step === 'train-bonus' && v.train) v.bonuses = v.train.bonuses;
    return v;
  }

  // ---------- 2026-11-14 金币 + 提灯货郎·芙洛的店 (MVP; docs/archive/DESIGN-2026-11-14-gold-and-shop.md 「实施记录（MVP）」, data/shop.json) ----------
  // run.gold (old saves: 0) · a win pays winBase + winPerLevel × level (+ 提灯人偶) · before L3 / L6 / L9 she turns up at the
  // night (run.shop, inside the prep phase): it never uses the campfire action, and 「出发」 just leaves her behind. Her stock
  // and her lines are picked with hashRand(seed, level, …) — the run rng is never touched, so every seeded run stays the same.
  // 2026-11-20 用户「开局 100 金，招人要钱」: each candidate has a hire price ≈ 20, a bit more the stronger she starts
  // (score = hp + 2 × 威力 + 2 × 幸运; price = base + round((score − center) × k), clamped; a candidates[].price overrides).
  // 4 × max ≤ purse, so every pick is always affordable. The leader is free. Left over after the 4 hires = the gold for L1.
  // false = the old flow: no price, gold starts at economy.startGold (10).
  const RECRUIT_PRICE = true;
  const RECRUIT_ECO0 = { purse: 100, base: 20, center: 15, k: 0.75, min: 17, max: 24 };
  const recruitEco = (data) => Object.assign({}, RECRUIT_ECO0, (data.shop && data.shop.economy && data.shop.economy.recruit) || {});
  // 2026-11-20 用户「小满这么强吗？」: 幸运 counted ×1 (was ×2 — 幸运 1 ≈ +1/6 damage, not worth 2 威力 points); 薇奥拉 priced by hand (candidates price 24)
  const recruitScore = (c) => (+c.hp || 0) + 2 * (+c.atk || 0) + 1 * (+c.luck || 0);
  // 2026-11-24 (精钢 purse 90): when neither girl of this round is affordable, her price is what is left in the purse (never a dead end)
  const HIRE_FALLBACK = false; // 用户「不行」: no discount when both are too dear (the 精钢 purse always covers the dearest picks)
  function hirePriceFor(data, run, c) {
    const p = recruitPrice(data, c), g = goldOf(run), pair = roundPair(data, run.interviewRound) || [];
    return HIRE_FALLBACK && pair.length && pair.every((x) => recruitPrice(data, x) > g) ? Math.min(p, g) : p;
  }
  function recruitPrice(data, c) {
    if (!c) return 0;
    if (Number.isFinite(c.price)) return c.price;
    const e = recruitEco(data);
    return clamp(e.base + Math.round((recruitScore(c) - e.center) * e.k), e.min, e.max);
  }
  const SHOP_ECO0 = { startGold: 10, winBase: 8, winPerLevel: 2, shopLevels: [3, 6, 9], tiers: { 1: 10, 2: 18, 3: 32, 4: 56, 5: 100 } };
  const shopEco = (data) => Object.assign({}, SHOP_ECO0, (data.shop && data.shop.economy) || {});
  const shopItems = (data) => (data.shop && Array.isArray(data.shop.items) ? data.shop.items.filter((it) => !it.retired) : []); // 2026-11-16: retired = off the shelf
  const SHOP_CORE_FROM = 6; // 2026-11-18 growth-flow: 核心信物 on the shelf from the L6 shop
  const shopItem = (data, id) => shopItems(data).find((x) => x.id === id) || null;
  const guildRelicName = (data, id) => (shopItem(data, id) || {}).name || id; // 2026-11-22 遗物: the name lives in shop.json
  const goldOf = (run) => (Number.isFinite(run.gold) ? run.gold : 0);
  const tierGold = (data, t) => shopEco(data).tiers[t] || Math.round(10 * Math.pow(10, (t - 1) / 4));
  const FLUO = 'fluo';
  function gainGold(run, n, src, ev) {
    if (!(n > 0)) return;
    run.gold = goldOf(run) + n;
    ev.push({ kind: 'gold', n, src, gold: run.gold }); // no text: the reward / formation screens show the purse
    if (src === 'win') run.lastWinGold = { n, level: run.level }; // 2026-11-20b 用户: the loot screen shows what this battle paid (view.winGold)
  }
  // a win: the base by level, plus each 提灯人偶 (relic winGold) worn by someone still in the party
  function winGold(data, run) {
    const e = shopEco(data);
    let n = e.winBase + e.winPerLevel * (run.level || 0);
    for (const it of shopItems(data)) {
      const fx = it.effect || {};
      if (fx.type === 'relic' && fx.winGold) n += fx.winGold * run.party.filter((id) => run.members[id] && hasTokenOf(run.members[id], fx)).length; // review #4 (was (tokens || []).includes(fx.tokenName))
    }
    for (const id of run.party) { const pk = perkOf(data, run, id); if (pk && pk.winGold > 0) n += pk.winGold; }
    n = Math.max(0, n - ascOn(run, 'winGold')); // 晶钻 // 2026-11-24 用户「夜鸦特技：每次战斗结束多获得 2 金币」(perk.winGold)
    return n;
  }
  const FLUO_TEXT = { // her lines, data/text/zh/engine.json shop.fluo.* (literal keys: tests/i18n checks every TX key)
    hello: () => TX('shop.fluo.hello'), answerSellTo: () => TX('shop.fluo.answerSellTo'), greetFirst: () => TX('shop.fluo.greetFirst'), greetFirstAsk: () => TX('shop.fluo.greetFirstAsk'), greetBack: () => TX('shop.fluo.greetBack'),
    slipSpent: (v) => TX('shop.fluo.slipSpent', v), slipDolls: () => TX('shop.fluo.slipDolls'), slipRuns: (v) => TX('shop.fluo.slipRuns', v),
    lv3: () => TX('shop.fluo.lv3'), lv6: () => TX('shop.fluo.lv6'), lv6Tease: () => TX('shop.fluo.lv6Tease'), lv9: () => TX('shop.fluo.lv9'), lv11: () => TX('shop.fluo.lv11') /* 2026-11-24 第 11 关前的店 */, rich: () => TX('shop.fluo.rich'),
    buy1: () => TX('shop.fluo.buy1'), buy2: () => TX('shop.fluo.buy2'), buyMaster: () => TX('shop.fluo.buyMaster'), buyDoll: () => TX('shop.fluo.buyDoll'),
    poor: () => TX('shop.fluo.poor'), moodLow: () => TX('shop.fluo.moodLow'),
    leaveNone: () => TX('shop.fluo.leaveNone'), leaveBought: () => TX('shop.fluo.leaveBought'), leaveLast: () => TX('shop.fluo.leaveLast'),
  };
  const SHOP_WHY = { poor: () => TX('shop.why.poor'), bagFull: () => TX('shop.why.bagFull'), maxed: () => TX('shop.why.maxed'), powerCap: () => TX('shop.why.powerCap'), needLv3: () => TX('shop.why.needLv3'),
    mood: () => TX('shop.why.mood'), noMood: () => TX('shop.why.noMood'), has: () => TX('shop.why.has'), hasRelic: () => TX('shop.why.hasRelic'), priestOnly: () => TX('shop.why.priestOnly'), boughtFor: () => TX('shop.why.boughtFor') };
  // 2026-11-23 用户「应该是 同一个人只能带一个同一物件」(SHOP_PER_PERSON): an item bought for a girl stays on the shelf for the others —
  // one per girl per shop (S.soldTo). Only relic / extra shelves; 对练, 名师指点, 传说 cores and items with no target still sell once. false = old (one per shop)
  const SHOP_PER_PERSON = true;
  const perPerson = (it) => !!(SHOP_PER_PERSON && it && it.needsTarget && (it.slot === 'relic' || it.slot === 'extra')); // 对练 (train, 「每次进店只有一份」), 名师指点 and 传说 cores: once
  const fluoLine = (key, expr, vars) => ({ speaker: FLUO, speakerId: FLUO, name: TX('names.fluo'), expr, text: FLUO_TEXT[key](vars) });
  // her opening (1–3 lines): the first shop of a run greets by the meta (a returning player gets one slip of the tongue,
  // always about money / dolls); every shop then says its level line
  function fluoIntro(data, run) {
    const out = [], M = run.meta || {}, first = !Object.keys(run.shopsSeen || {}).some((k) => +k < run.level);
    const lead = (text, expr) => resolveLine(data, run, { speaker: 'leader', text, expr }, {}, 'leader');
    if (first) {
      out.push(fluoLine('hello', 'happy')); // 2026-11-15 user: her entrance line, right after the bells
      out.push(lead(TX('shop.leader.who'), 'calm')); // 2026-11-15 user: the first time, the leader asks who she is
      if (!(M.runs > 0)) out.push(fluoLine('greetFirst', 'calm'), lead(TX('shop.leader.sellTo'), 'calm'), fluoLine('answerSellTo', 'sly'));
      else {
        out.push(fluoLine('greetFirst', 'calm')); // she introduces herself — then slips
        if (M.fluoSpentLast > 0) out.push(fluoLine('slipSpent', 'shock', { n: M.fluoSpentLast }));
        else if (M.dollsGiven > 0) out.push(fluoLine('slipDolls', 'shock'));
        else out.push(fluoLine('slipRuns', 'shock', { n: M.runs + 1 }));
      }
    }
    const lv = { 3: ['lv3', 'sly'], 6: ['lv6', 'sly'], 9: ['lv9', 'calm'], 11: ['lv11', 'calm'] }[run.level];
    if (lv) out.push(fluoLine(lv[0], lv[1]));
    if (run.level === 6 && out.length < 3) out.push(fluoLine('lv6Tease', 'sly')); // she tells you to save up for the 100-gold lesson
    if (goldOf(run) >= 80 && out.length < 3) out.push(fluoLine('rich', 'special'));
    return out.slice(0, first ? 7 : 3); // the first visit is a short conversation; later ones 1–3 lines
  }
  function shopOpen(data, run) {
    const eco = shopEco(data);
    if (!shopItems(data).length || !eco.shopLevels.includes(run.level)) return;
    if (!run.shopsSeen) run.shopsSeen = {};
    if (run.shopsSeen[run.level]) return; // the quiet prep after following the bell is the same night
    const bought = run.shopBought || [];
    const pick = (slot, k) => {
      const pool = shopItems(data).filter((it) => it.slot === slot && !((slot === 'relic' || slot === 'core') && bought.includes(it.id)) && !(it.slot === 'guildRelic' && (!RELICS_ON || (run.guildRelics || []).includes(it.id))) /* 2026-11-22 遗物 */ && !(it.slot !== 'special' && Array.isArray(it.levels) && !it.levels.includes(run.level)) && !(it.effect && it.effect.type === 'teamStat' && (run.teamTaken || []).includes(it.effect.stat)) /* 2026-11-24 全队道具: only at its shops, never one already taken */ && !(it.minLevel > (run.level || 1)) && !(HOLY_SPRING_PRIEST_ONLY && isHolySpring(it.effect) && !partyHasPriest(run)) && !(LEGEND_SELF_ONCE && slot === 'core' && partyHolds(run, it.effect))); // 2026-11-22 LEGEND_SELF_ONCE: a held legendary not on the shelf // 2026-11-21: an item's minLevel holds it back (母亲的发绳 from L6)
      if (slot === 'relic') { // 2026-11-18 growth-flow: the relic shelf rolls a rarity first (RARITY_W by level), then an item of it
        const W = RARITY_W(run.level), r0 = hashRand(run.seed, run.level, k, 'rarity') * (W.common + W.rare + W.epic);
        const want = r0 < W.common ? 'common' : r0 < W.common + W.rare ? 'rare' : 'epic';
        const sub = pool.filter((it) => rarityId(it) === want);
        if (sub.length) return sub[Math.floor(hashRand(run.seed, run.level, k) * sub.length)].id;
      }
      return pool.length ? pool[Math.floor(hashRand(run.seed, run.level, k) * pool.length)].id : null;
    };
    // 2026-11-18 growth-flow: from SHOP_CORE_FROM on, one 核心信物 (slot core) per shop — the build-defining ones
    const core = run.level >= SHOP_CORE_FROM && !(ONE_LEGEND_RELIC && ownsLegendRelic(data, run)) ? pick('core', 4) : null; // 2026-11-20 ONE_LEGEND_RELIC
    const offers = shopItems(data).filter((it) => it.slot === 'train').map((it) => it.id)
      .concat([pick('extra', 1), pick('supply', 2), pick('relic', 3), core, RELICS_ON ? pick('guildRelic', 8) : null]) // 2026-11-22 遗物: one per shop
      .concat(shopItems(data).filter((it) => it.slot === 'special' && (it.levels || []).includes(run.level) && !bought.includes(it.id)).map((it) => it.id))
      .filter(Boolean);
    if (leaderHas(run, 'explorer') && outlanderShop(run)) { // 2026-11-19 伤害分摊 §5: 外乡人 = one more shelf (another relic, else a supply / extra not on offer yet)
      for (const [slot, k] of [['relic', 5], ['supply', 6], ['extra', 7]]) {
        const pool = shopItems(data).filter((it) => it.slot === slot && !offers.includes(it.id) && !(slot === 'relic' && bought.includes(it.id)) && !(it.minLevel > (run.level || 1)));
        if (pool.length) { offers.push(pool[Math.floor(hashRand(run.seed, run.level, k) * pool.length)].id); break; }
      }
    }
    run.shop = { level: run.level, open: true, offers, sold: [], spent: 0, line: null, lines: [] };
    run.shop.lines = fluoIntro(data, run);
    run.shopsSeen[run.level] = true;
  }
  const shopHere = (run) => (run.shop && run.shop.level === run.level && run.phase === 'prep' ? run.shop : null);
  // what this item costs member id (null id: an untargeted item), or why it can't be bought: { price, tier, reason }
  // reasons: poor · bagFull · maxed · needLv3 · mood · noMood · has
  function shopQuote(data, run, it, id) {
    const p = it.price || {}, fx = it.effect || {}, m = id ? run.members[id] : null;
    let tier = p.tier || 1, reason = null;
    if (CHARGE_ODDS_BY_DIFF && it.charge && diffOf(run)) tier = Math.min(5, tier + (diffOf(run).chargeShop || 0)); // 2026-11-22d
    if (m) {
      const lv = lvOf(m.skill), leader = isLeader(id);
      if (p.by === 'power') { if (m.atk >= 5) reason = 'powerCap'; /* 用户 2026-11-15: say why (her sandbag only goes to 5) */ tier = clamp(m.atk, 1, 4); }
      else if (p.by === 'level') { if (lv >= (fx.capLv || 3)) reason = 'maxed'; tier = clamp(lv + 1, 2, 3); }
      if (fx.type === 'skillUp' && fx.fromLv && lv !== fx.fromLv) reason = 'needLv3';
      else if ((fx.type === 'skillUp' || fx.type === 'xp') && fx.needMood != null && !leader && m.mood < fx.needMood) reason = 'mood';
      if (fx.type === 'mood' && moodless(run, id)) reason = 'noMood'; // 2026-11-20 团长心情: only when she has none
      else if (fx.type === 'mood' && m.mood >= 2) reason = 'maxed';
      if (fx.type === 'relic' && hasTokenOf(m, fx)) reason = 'has';
      else if (fx.type === 'relic' && priestOnlyBlocks(run, fx, id)) reason = 'priestOnly'; // 2026-11-22 圣泉 // review #4 (was (m.tokens || []).includes(fx.tokenName))
    }
    if (fx.type === 'item' && bagFull(run)) reason = 'bagFull';
    if (fx.type === 'guildRelic' && (run.guildRelics || []).includes(it.id)) reason = 'hasRelic'; // 2026-11-22 遗物
    if (fx.type === 'teamStat' && (run.teamTaken || []).includes(fx.stat)) reason = 'hasRelic'; // 2026-11-24 全队道具
    const rp = PRICE_BY_RARITY && (it.slot === 'relic' || it.slot === 'core') ? RARITY_PRICE[rarityId(it)] : null; // 2026-11-24 用户「不同稀有度价格不应该一样」: 信物 / 护符 priced by rarity
    const price = rp != null ? rp : Math.round(tierGold(data, tier) * (p.mul > 0 ? p.mul : 1)); // 2026-11-20 防滚雪球: price.mul (对练 ×1.5)
    if (!reason && price > goldOf(run)) reason = 'poor';
    return { price, tier, reason };
  }
  // the effects shopApply would give member m, as previewFor reads them (「给谁」 shows the change under each face)
  function shopEffs(it, m) {
    const fx = it.effect || {};
    if (fx.type === 'stat' || fx.type === 'skillUp' || fx.type === 'mood' || fx.type === 'xp') return [fx];
    if (fx.type !== 'relic') return [];
    return [{ type: 'token' }].concat(hpCostEff(fx) ? [hpCostEff(fx)] : []).concat((fx.stats || []).map((s) => ({ type: 'stat', stat: s.stat, delta: s.delta })))
      .concat(fx.skillUp && m && lvOf(m.skill) < (fx.capLv || SKILL_LV_MAX) ? [{ type: 'skillUp' }] : []).concat(fx.xp ? [{ type: 'xp', n: fx.xp }] : []);
  }
  // 2026-11-24 全队道具 (TEAM_LOOT): 全员 幸运 / 威力 / 生命上限 — every member now in the party, once; run.teamTaken = [stat…] so the
  // same one is not offered again (第 6 关 loot, 第 9 / 11 关 shops)
  const TEAM_LOOT = true;
  function teamStatApply(data, run, fx, ev, src) {
    for (const pid of run.party) { const m = run.members[pid]; if (!m) continue; const before = statsOf(m, isLeader(pid)); statEff(m, { type: 'stat', stat: fx.stat, delta: fx.delta }); statChange(data, run, ev, pid, before, src); }
    (run.teamTaken || (run.teamTaken = [])).push(fx.stat);
  }
  function shopApply(data, run, it, id, ev, side) {
    const fx = it.effect || {}, d = {};
    if (fx.type === 'item') { run.items.push(fx.item); return; }
    if (fx.type === 'teamStat') { teamStatApply(data, run, fx, ev, 'shop:' + it.id); return; } // 2026-11-24 全队道具
    if (fx.type === 'guildRelic') { const g = run.guildRelics || (run.guildRelics = []); if (!g.includes(it.id)) g.push(it.id); return; } // 2026-11-22 遗物: the guild's
    if (fx.type === 'teamHeal') {
      for (const pid of run.party) { const m = run.members[pid], before = statsOf(m, isLeader(pid)); m.hp = Math.min(m.maxHp, hpOf(m) + fx.n); statChange(data, run, ev, pid, before, 'shop:' + it.id); }
      return;
    }
    const m = run.members[id], before = statsOf(m, isLeader(id));
    const grow = (stat, delta) => m.growth.push({ source: 'shop:' + it.id, stat, delta, level: run.level });
    if (fx.type === 'stat') { statEff(m, fx); grow(fx.stat, fx.delta); if (CARD_SIDE_MOOD && fx.mood) addMood(d, id, fx.mood, it.name); } // 2026-11-21 上架的难吃的口粮: its 心情 −1 too
    else if (fx.type === 'skillUp') { const su = skillUpAs(m); statEff(m, fx); grow(su.stat, su.delta); }
    else if (fx.type === 'xp') { statEff(m, fx); grow('xp', fx.n || 0); } // 2026-11-16 买经验
    else if (fx.type === 'mood') addMood(d, id, fx.delta, it.name);
    else if (fx.type === 'relic') {
      const had = hasTokenOf(m, fx);
      if (!had) { m.tokens.push(fx.tokenName); ringSideOn(data, run, id, fx, side); } // review #4 (was !m.tokens.includes(fx.tokenName))
      const hc = !had && hpCostEff(fx); if (hc) { statEff(m, hc); grow('maxHp', hc.delta); } // 2026-11-22 CHARGE_COST
      addMood(d, id, 1, TX('mood.why.token'));
      for (const s of fx.stats || []) { statEff(m, { type: 'stat', stat: s.stat, delta: s.delta }); grow(s.stat, s.delta); }
      if (fx.skillUp && lvOf(m.skill) < (fx.capLv || SKILL_LV_MAX)) { statEff(m, { type: 'skillUp' }); grow('skillLv', 1); }
      if (fx.xp) { statEff(m, { type: 'xp', n: fx.xp }); grow('xp', fx.xp); } // 2026-11-16: 批注本 = 经验
    }
    applyMoods(data, run, ev, d);
    statChange(data, run, ev, id, before, 'shop:' + it.id);
  }
  const SHOP_BUY_LINE = { 'master-lesson': ['buyMaster', 'special'], 'doll-charm': ['buyDoll', 'sly'] };
  function shopBuy(data, run, a, ev) {
    const S = shopHere(run);
    if (!S || !S.open) fail('the shop is not open');
    const it = shopItem(data, a.itemId);
    if (!it || !S.offers.includes(it.id)) fail('not on sale here: ' + a.itemId);
    if (S.sold.includes(it.id)) fail('sold out: ' + it.id);
    const id = it.needsTarget ? a.target : null;
    if (it.needsTarget && !run.party.includes(id)) fail('shopBuy needs a party target');
    const q = shopQuote(data, run, it, id);
    if (!q.reason && perPerson(it) && ((S.soldTo || {})[it.id] || []).includes(id)) q.reason = 'boughtFor';
    if (q.reason) { // greyed in the UI; a stray tap changes nothing but her line
      ev.push({ kind: 'tip', reason: q.reason, itemId: it.id, target: id, text: SHOP_WHY[q.reason]() });
      S.line = q.reason === 'poor' ? fluoLine('poor', 'calm') : q.reason === 'mood' ? fluoLine('moodLow', 'calm') : S.line;
      return;
    }
    run.gold = goldOf(run) - q.price;
    S.spent += q.price;
    run.shopSpent = (run.shopSpent || 0) + q.price;
    S.buys = (S.buys || 0) + 1; // = the old S.sold.length (Fluo's line roll)
    if (perPerson(it)) { const st = S.soldTo || (S.soldTo = {}); (st[it.id] || (st[it.id] = [])).push(id); if (run.party.every((p) => st[it.id].includes(p))) S.sold.push(it.id); } else S.sold.push(it.id);
    (run.shopBought || (run.shopBought = [])).push(it.id);
    ev.push({ kind: 'shopBuy', itemId: it.id, name: it.name, target: id, targetName: id ? nameOf(data, id) : null, price: q.price, gold: run.gold, level: run.level,
      note: id ? TX('shop.boughtFor', { item: it.name, name: nameOf(data, id), n: q.price }) : TX('shop.bought', { item: it.name, n: q.price }) });
    shopApply(data, run, it, id, ev, a.side); // a.side: 转向指环 on a 'both' girl
    const bl = SHOP_BUY_LINE[it.id];
    S.line = bl ? fluoLine(bl[0], bl[1]) : hashRand(run.seed, run.level, 7, S.buys) < 0.5 ? fluoLine('buy1', 'happy') : fluoLine('buy2', 'special');
  }
  function shopLeave(data, run, ev) {
    const S = shopHere(run);
    if (!S || !S.open) fail('the shop is not open');
    S.open = false;
    S.line = S.spent ? (run.level === shopEco(data).shopLevels.slice(-1)[0] ? fluoLine('leaveLast', 'sly') : fluoLine('leaveBought', 'happy')) : fluoLine('leaveNone', 'sad');
    ev.push({ kind: 'shopLeave', level: run.level, spent: S.spent, gold: goldOf(run) });
    ev.push(Object.assign({ kind: 'line', key: 'fluoLeave' }, S.line));
  }
  function shopView(data, run) {
    const S = shopHere(run);
    if (!S) return null;
    const offers = S.offers.map((oid) => {
      const it = shopItem(data, oid) || { id: oid, name: oid, text: '' };
      const sold = S.sold.includes(oid);
      const o = { id: oid, name: it.name, text: it.text, flavor: it.flavor || '', kind: it.kind || null, needsTarget: !!it.needsTarget, sold, effect: clone(it.effect || {}) };
      if (it.kind === 'relic') o.rarity = rarityId(it); // 2026-11-18 growth-flow round 2: 普通 / 稀有 / 史诗 / 传说 — the name is text key rarity.<id> (engine rarityName)
      if (it.needsTarget) {
        o.targets = run.party.map((id) => { const q = shopQuote(data, run, it, id); if (perPerson(it) && ((S.soldTo || {})[oid] || []).includes(id)) q.reason = 'boughtFor'; return { id, name: nameOf(data, id), price: q.price, tier: q.tier, ok: !q.reason, reason: q.reason, preview: previewFor(data, run, id, shopEffs(it, run.members[id]), 0),
          ...xpInfo(run.members[id]), xpGain: xpGainFor(data, run, id, shopEffs(it, run.members[id])) }; }); // 2026-11-16 经验条
        const ok = o.targets.filter((t) => t.ok), poor = o.targets.filter((t) => t.reason === 'poor');
        const pool = ok.length ? ok : poor.length ? poor : o.targets;
        const best = pool.reduce((b, t) => (t.price < b.price ? t : b), pool[0]);
        Object.assign(o, { price: best.price, tier: best.tier, affordable: ok.length > 0, reason: ok.length ? null : best.reason, varies: new Set(o.targets.map((t) => t.price)).size > 1 });
      } else { const q = shopQuote(data, run, it, null); Object.assign(o, { price: q.price, tier: q.tier, affordable: !q.reason, reason: q.reason }); }
      if (sold) { o.affordable = false; o.reason = 'sold'; }
      return o;
    });
    return { open: !!S.open, level: S.level, gold: goldOf(run), spent: S.spent, offers, lines: clone(S.lines || []), line: S.line ? clone(S.line) : null, bagFull: bagFull(run) };
  }

  // ---------- cards ----------
  // ---------- 2026-11-18 growth-flow: 小铃的祝福 + keepsake rarity ----------
  // BLESSING_ON: after the L5 sacrifice 小铃 offers three team-wide boons (data/cards.json blessings); the pick is run.blessing
  // { id, fx, level }, the two left are run.blessingLeft (kept for her own team later — only recorded for now).
  // Effects: teamStat (every party member, statEff: atk / maxHp) · teamCharge (allies full at CHARGE_FULL + delta, see allyUnit).
  const BLESSING_ON = true;
  const RETURNED_NORMAL = true; // 2026-11-18 growth-flow round 2: the L8 returned girl = fixed numbers (false: her own stats + flips, the old way)
  const RETURNED_SKILL_LV = 2;
  // 2026-11-19 小铃战：镜像玩偶 + 旧人玩偶 (docs/BACKLOG, 用户): L11 runs scenario.levels[11].mirrorWaves instead of .waves —
  // wave 1 = a doll copy of the party (same classes / skills / levels / order, weaker, behind a 「玻璃瓶」 shell of 护甲 that
  // breaks when their round-1 phase starts), wave 2 = dolls of everyone the run gave away / turned down (+ 小铃 herself),
  // padded to MIRROR_GONE_MIN. Her side also gets the two blessings the player did not pick (run.blessingLeft).
  // false = the old L11 (guards + 小铃, then guards + resummoned + 小铃 phase 2), untouched.
  const XIAOLING_MIRROR = true;
  // 2026-11-21 用户「被拒绝的就不反水了；第二波敌人第一轮护甲和血量一样，血量提升一些；玩偶都没了小铃就进入第二阶段；小铃特质 诅咒之铃：
  // 每次她被攻击，攻击者受到 1 伤害（荆棘）」(XL_V3): no random turncoat in the mirror fight (only the sacrificed girl wakes, MIRROR_WAKE);
  // wave-2 openBlockHp (dolls + her); phase 2 = every doll down (no hp / half rule); her thorns 1, once per attack (scenario entry thorns / thornsOnce / thornsBell).
// 2026-11-22 试玩（A / B 两轮都死在「落选者欠账」：两个落选者各让一人第一回合发呆，常常是主输出）: at most ONE 「你没站在我这边」 daze per battle;
  // the next girl's same debt turns into 心情 −1. false = the old (every such debt dazes).
  const DEBT_ONE_DAZE = true;
  const XL_V3 = true;
  const LEADER_COMBO_LIVE = true; // see allyUnit (2026-11-21)
  const TRUE_END_ONCE = true;
  const XL_P2_BELL = true; // 2026-11-21: phase 2 = the knell on the marked one AND the bell on everyone, every round (false = the knell only)
  const MIRROR_WAKE = true;
  const WAKE_AS_MEMBER = true, WAKE_SKILL_UP = 1, WAKE_ATK = 2; // 2026-11-21: she wakes as herself (members[id]: hp / 威力 / skill level / gifts / combo / traits) + the leader's two lines; false = she fights on as the doll // 2026-11-21: wave 2, the sacrificed girl wakes and joins us (see loadWave); false = only the random turncoat chance
  // 2026-11-21 用户「真正的镜像」(MIRROR_TRUE; false = the old dolls: enemy skill rules, no combo, glass 1.0 — scenario _old_2026_11_21b):
  // a wave-1 doll plays her skill by OUR rules at the copied level (spark SPARK_TARGETS, heal HEAL_LV, aim CRIT_RATE / CRIT_X_LV /
  // pierce, backstab BACKSTAB_HITS, guard GUARD_LV + Lv3 keep / Lv4 slam, Lv thresholds of the charge), aims like ours (front-most;
  // a rogue the first two; a hunter the left-most, no lock), keeps the member's combo (the leader's from the class data, no ring)
  // so the doll line passes charge like our formation (no bond / cord / items), and her side's 3-extra cap does not apply to her.
  // Everything else stays enemy-side (her team, her intent shown, the per-round 威力 ramp).
  const MIRROR_TRUE = true;
  // 2026-11-22 试玩 C 第 6 关：落选的法师（薇奥拉）当敌人时打全体 4 人各 7–10，她的卡写的是「波及 2 个」(GIRL_SPARK_N): an enemy candidate girl
  // (rejected / returned / gone dolls) with a spark hits SPARK_TARGETS[her level] like on her card, not everyone. false = old (all).
  const GIRL_SPARK_N = true;
  function girlSparkN(u) { return !!(GIRL_SPARK_N && u && u.side === 'enemy' && u.candidate && !u.mirror); }
  // 2026-11-23 用户「敌方法师…改成 前排满伤，其他波及（跟普通法师一样就行）」(ENEMY_SPARK_SPLASH): an enemy spark with skill.splash hits like ours —
  // SPARK_TARGETS[her level] from the left, the first full, the rest half (sparkSplash). false = old (full on everyone)
  const ENEMY_SPARK_SPLASH = true;
  function foeSplash(u) { return !!(ENEMY_SPARK_SPLASH && u && u.side === 'enemy' && u.skill && u.skill.kind === 'spark' && (u.skill.splash || (GIRL_SPARK_SPLASH && u.candidate && !u.mirror && !u.wokeMember))); } // + 2026-11-24 用户「薇奥拉回来时的攻击也是前排满伤，其他人减半」: an enemy girl mage
  function mirrorAlly(u) { return !!(MIRROR_TRUE && u && u.mirror && u.side === 'enemy'); }
  const MIRROR_HP = 0.6, MIRROR_ATK = -1, MIRROR_GLASS = 1.0, MIRROR_GONE_MIN = 2; // defaults; the scenario entry may override (hpMul / atkAdd / glass / min)
  // 2026-11-19 小铃强 玩偶弱 (用户批准「小铃强一点，玩偶弱一点」): the dolls (both waves) are the emotional beat, not the threat —
  // weaker numbers in scenario mirrorWaves (the old ones kept in mirrorWaves_old_2026_11_19h). 小铃 gets two phases (her wave-2
  // entry carries xlPhases):
  //  phase 1 — she hides behind her dolls: warded (dollWard, each hit at most WARD_HP), rings the bell (全体 + copies a debuff,
  //            charges her dolls) as before;
  //  phase 2 — once XL_P2_DOLLS of the dolls she started with are down (turned ones count) or her hp < XL_P2_HP, she steps
  //            forward (one 'phase2' event with xl: true + her line): no ward any more; each of her actions MARKS one of us
  //            (XL_MARK_RULE: the lowest hp share, not the one marked last time) — stored as a SLOT, so her intent shows whoever stands there and
  //            a swap moves the danger — and her next action is one heavy knell on that slot: 威力 × XL_MARK_X, XL_MARK_PIERCE of
  //            the target's 护甲 knocked off first (logged as tr.sunder). The knell replaces her bell that action.
  // false = the old fight (old mirrorWaves numbers, no phases).
  const XIAOLING_V2 = true;
  // 2026-11-22 用户「钟响确实太强了，处理一下，还是尽量通过群伤压制血量」: the knell ×2 / half the 护甲 off → ×XL_MARK_X_SOFT, no pierce (old in _old)
  const XL_MARK_X_old_2026_11_22 = 2, XL_MARK_PIERCE_old_2026_11_22 = 0.5; // eslint-disable-line no-unused-vars
  const XL_P2_DOLLS = 0.5, XL_P2_HP = 0.5, XL_MARK_X = 0.75, /* 2026-11-24b 用户「终响太难了，再削弱一下」 (was 1; before that 1.25) */ XL_MARK_PIERCE = 0, XL_MARK_RULE = 'lowest';
  const blessingPool = (data) => (data.cards && Array.isArray(data.cards.blessings) ? data.cards.blessings : []);
  // 2026-11-18 growth-flow round 2 (用户「稀有度改名：普通 / 稀有 / 史诗 / 传说」): four tiers, ids common · rare · epic · legendary
  // (was common · uncommon · rare · core — RARITY_OLD maps old data ids; display names: text key rarity.<id>)
  const RARITIES = ['common', 'rare', 'epic', 'legendary'];
  const RARITY_OLD = { uncommon: 'rare', rare: 'epic', core: 'legendary' };
  const rarityId = (c) => { const r = (c && c.rarity) || 'common'; return RARITIES.includes(r) ? r : RARITY_OLD[r] || 'common'; };
  const RARITY_TEXT = { common: () => TX('rarity.common'), rare: () => TX('rarity.rare'), epic: () => TX('rarity.epic'), legendary: () => TX('rarity.legendary') }; // literal keys (tests/i18n)
  const rarityName = (id) => (RARITY_TEXT[id] || RARITY_TEXT.common)();
  // rarity → the first level it can show up as a reward / on the shelf (common 1 · rare 2 · epic 4 · legendary 7); card.minLevel wins
  const RARITY_FROM = { common: 1, rare: 2, epic: 4, legendary: 7 };
  const rarityOk = (c, level) => (c && c.minLevel != null ? c.minLevel : RARITY_FROM[rarityId(c)] || 1) <= (level || 1);
  // shop relic shelf weights by level (ISSUES-2026-11-16 §4 draft): [common, rare, epic] (legendary has its own slot, SHOP_CORE_FROM)
  const RARITY_W = (lv) => (lv >= 7 ? { common: 45, rare: 38, epic: 17 } : lv >= 4 ? { common: 60, rare: 32, epic: 8 } : { common: 80, rare: 20, epic: 0 });
  function pickBlessing(data, run, a, ev) {
    const pool = blessingPool(data), card = pool.find((c) => c.id === a.card), fx = card.effect || {};
    if (fx.type === 'teamStat') for (const id of run.party) {
      const m = run.members[id]; if (!m) continue;
      const before = statsOf(m, isLeader(id));
      statEff(m, { type: 'stat', stat: fx.stat, delta: fx.delta });
      m.growth.push({ source: card.id, stat: fx.stat, delta: fx.delta, level: run.level });
      statChange(data, run, ev, id, before, 'blessing');
    }
    run.blessing = { id: card.id, fx: clone(fx), level: run.level };
    run.blessingLeft = run.options.filter((x) => x !== card.id); // 小铃 keeps the other two (her team, later)
    ev.push({ kind: 'card', card: card.id, target: null, reward: true, blessing: true, text: card.name });
    run.options = null; run.rewardKind = null;
    return advance(data, run, ev);
  }
  function pickCard(data, run, a, ev, isReward) {
    if (!run.options.includes(a.card)) fail('card not among options');
    if (isReward && run.rewardKind === 'blessing') return pickBlessing(data, run, a, ev);
    const card = (isReward ? data.cards.rewards : data.cards.debuffs).find((c) => c.id === a.card);
    if (isReward && card && priestOnlyBlocks(run, card.effect, a.target)) { const pr = run.party.find((id) => !priestOnlyBlocks(run, card.effect, id)); if (!pr) fail('only a priest can take this keepsake'); a = Object.assign({}, a, { target: pr }); } // 圣泉: a non-priest pick goes to the priest (the UI greys the others; dev walkers pick blindly)
    if (!isReward && card && luckFloorIds(run, card.effect).includes(a.target)) { const ok = run.party.find((id) => !luckFloorIds(run, card.effect).includes(id)); a = Object.assign({}, a, { target: ok }); } // LUCK_FLOOR_BLOCK: the UI greys her; dev walkers pick blindly → the first one not at the floor
    let eff = card.effect || {};
    if (!isReward) eff = curseUp(run, eff); // 山铜
    if (isLeader(a.target)) eff = leaderEff(eff, isReward, leaderMoodOn(run));
    if (isReward && eff.type === 'teamStat') { // 2026-11-24 全队卡: everyone, no target
      ev.push({ kind: 'card', card: card.id, target: null, reward: true, team: true, text: card.name });
      teamStatApply(data, run, eff, ev, card.id);
      run.options = null;
      return advance(data, run, ev);
    }
    if (isReward && eff.type === 'item') { // §2.5: goes into the bag, no target
      if (!itemDef(data, eff.item)) fail('unknown item ' + eff.item);
      const full = run.items.length >= BAG_MAX;
      if (!full) run.items.push(eff.item);
      ev.push({ kind: 'card', card: card.id, target: null, reward: true, item: eff.item, text: card.name });
      ev.push({ kind: 'item', itemId: eff.item, added: !full, lost: full, text: full ? TX('item.lostBagFull', { item: itemDef(data, eff.item).name }) : TX('item.added', { item: itemDef(data, eff.item).name }) });
      run.options = null;
      return advance(data, run, ev);
    }
    if (!run.party.includes(a.target)) fail('target not in party');
    const m = run.members[a.target];
    const before = statsOf(m, isLeader(a.target));
    const d = {};
    let goldShort = false; // 2026-11-19 诅咒维度: the fine was more than the purse
    const fires = []; // REVEAL_ON_EFFECT: mood traits that may have acted on this card (checked before applyMoods)
    const tname = nameOf(data, a.target);
    const why = {}, wy = (id, n, label, trait) => { if (MOOD_WHY && n) (why[id] || (why[id] = [])).push({ n, label, trait: trait || null }); }; // 2026-11-24 MOOD_WHY: every mood move on this card, with its reason
    if (!isReward) ev.push({ kind: 'darkTransition', reason: 'debuff' });
    ev.push({ kind: 'card', card: card.id, target: a.target, reward: isReward, text: `${card.name} → ${tname}` });
    const ledger = isReward ? 'rewardsReceived' : 'debuffsReceived';
    (m[ledger] || (m[ledger] = [])).push(card.id); // remembered for the memory flip if she is ever sacrificed (RULES-v1 §3)
    if (!isLeader(a.target)) girlMem(run, a.target).cards.push({ card: card.id, name: card.name, reward: isReward, level: run.level });
    if (!isReward && isLeader(a.target)) bump(statOf(run, LEADER_ID), 'selfDebuffs'); // @stats
    if (!isReward) noteRecent(run, { when: isLeader(a.target) ? 'afterDebuffSelf' : 'afterDebuff', ctx: { target: tname, card: card.name, targetId: a.target } }); // G2 #11: the leader kept it → its own talks (never 「她选了<团长的名字>」) · #13: targetId
    if (eff.type === 'stat') {
      let delta = eff.delta;
      if (isReward && delta > 0 && hasTrait(data, a.target, 'late-bloomer')) { delta += 1; reveal(data, run, ev, a.target, 'late-bloomer'); }
      statEff(m, { type: 'stat', stat: eff.stat, delta });
      m.growth.push({ source: card.id, stat: eff.stat, delta, level: run.level });
    } else if (eff.type === 'skillUp') {
      const su = skillUpAs(m);
      statEff(m, eff);
      m.growth.push({ source: card.id, stat: su.stat, delta: su.delta, level: run.level });
    } else if (eff.type === 'xp') { // 2026-11-16 经验
      statEff(m, eff);
      m.growth.push({ source: card.id, stat: 'xp', delta: eff.n || 0, level: run.level });
    } else if (eff.type === 'token') {
      const had = hasTokenOf(m, eff);
      if (!had) { m.tokens.push(eff.tokenName); ringSideOn(data, run, a.target, eff, a.side); } // 转向指环: a.side // review #4 (was !m.tokens.includes(eff.tokenName)) // 2026-11-15: keepsakes never stack (the UI greys holders; old auto-play / saves just don't get a second copy)
      const hc = !had && hpCostEff(eff); if (hc) { statEff(m, hc); m.growth.push({ source: card.id, stat: 'maxHp', delta: hc.delta, level: run.level }); } // 2026-11-22 CHARGE_COST
      addMood(d, a.target, 1); wy(a.target, 1, TX('mood.why.token'));
    } else if (eff.type === 'status') {
      if (!m.statuses.includes(eff.status)) m.statuses.push(eff.status);
      if (eff.double) m.slowX2 = true;
      if (eff.upDouble) m.slowUp2 = true; // 山铜: her first two actions // FEEDBACK-1112 #28+31: the leader's daze lasts two actions
    } else if (eff.type === 'charge') { // 2026-11-19 诅咒维度「面具印记」: she needs eff.delta more pips to be full, for the rest of the run
      m.chargeSlow = (m.chargeSlow || 0) + (eff.delta || 0);
    } else if (eff.type === 'gold') { // 2026-11-19 诅咒维度「当众点名」: a fine out of the purse; short of it → the purse goes to 0 and the rest is paid in mood (girl) / max hp (leader)
      const owe = -(eff.delta || 0), have = goldOf(run);
      run.gold = Math.max(0, have - owe);
      ev.push({ kind: 'gold', n: -Math.min(have, owe), src: 'debuff', gold: run.gold });
      if (have < owe) { if (isLeader(a.target)) statEff(m, { type: 'stat', stat: 'maxHp', delta: -LEADER_DEBUFF_X }); else goldShort = true; }
    }
    if (isReward) {
      if (eff.type === 'mood') { addMood(d, a.target, eff.delta); wy(a.target, eff.delta, card.name); }
      if (CARD_SIDE_MOOD && eff.type === 'stat' && eff.mood) { addMood(d, a.target, eff.mood); wy(a.target, eff.mood, card.name); } // 2026-11-20d 铁皮口粮: the side cost
      say(data, run, ev, a.target, 'rewardGiven');
      for (const t of ['greedy', 'proud', 'jealous']) if (hasTrait(data, a.target, t)) { traitMood(data, run, ev, d, fires, a.target, 1, t); wy(a.target, 1, null, t); }
      for (const o of run.party) if (o !== a.target && hasTrait(data, o, 'jealous')) { traitMood(data, run, ev, d, fires, o, -1, 'jealous', 'jealous-other'); wy(o, -1, null, 'jealous'); }
    } else {
      run.debuffCount += 1;
      say(data, run, ev, a.target, 'debuffAssigned');
      const drop = (MOOD_CARD_TOTAL && eff.type === 'mood' ? 0 : -1) + (eff.type === 'mood' ? eff.delta : 0) + (goldShort ? -1 : 0); // 2026-11-19 诅咒维度: a fine she could not pay → mood −1 more
      if (hasTrait(data, a.target, 'calm')) { if (!REVEAL_ON_EFFECT) reveal(data, run, ev, a.target, 'calm'); else fires.push({ id: a.target, trait: 'calm', extra: drop }); } // 起作用时才说: only if the drop would have moved her mood
      else {
        addMood(d, a.target, drop);
        wy(a.target, MOOD_CARD_TOTAL && eff.type === 'mood' ? 0 : -1, TX('mood.why.curse')); if (eff.type === 'mood') wy(a.target, eff.delta, card.name); if (goldShort) wy(a.target, -1, TX('mood.why.goldShort'));
        if (hasTrait(data, a.target, 'proud')) { traitMood(data, run, ev, d, fires, a.target, -1, 'proud', 'proud-curse'); wy(a.target, -1, null, 'proud'); }
        if (run.debuffCount === 1 && leaderHas(run, 'soft-heart')) { addMood(d, a.target, -1); wy(a.target, -1, TX('mood.why.softHeart')); }
      }
      for (const o of relatedTo(data, run, a.target)) {
        const rel = cand(data, o).relation;
        if (CLOSE[rel.kind]) { addMood(d, o, -1); wy(o, -1, TX('mood.why.friend', { name: tname })); say(data, run, ev, o, 'friendHurt', { name: tname }); }
        if (hasTrait(data, o, 'protective')) { traitMood(data, run, ev, d, fires, o, -1, 'protective'); wy(o, -1, null, 'protective'); }
      }
    }
    fireTraits(data, run, ev, d, fires); // calm's spared drop is not in d: its extra is the drop itself (adding it would have moved her)
    applyMoods(data, run, ev, d, MOOD_WHY ? why : null);
    statChange(data, run, ev, a.target, before, card.id);
    run.options = null;
    advance(data, run, ev);
  }

  // ---------- sacrifice ----------
  function snapshot(run, id) {
    const m = run.members[id];
    return { maxHp: m.maxHp, atk: m.atk, skill: clone(m.skill), skillLv: lvOf(m.skill), xp: xpOf(m), tokens: m.tokens.slice(), growth: clone(m.growth), avgDps: avgOf(m),
      rewards: (m.rewardsReceived || []).slice(), debuffs: (m.debuffsReceived || []).slice(), moodAtSacrifice: m.mood, bond: m.bond || null };
  }

  function doSacrifice(data, run, a, ev) {
    if (a.target && typeof a.target === 'object') a = Object.assign({}, a, { target: a.target.id }); // v2.3: view.targets are objects
    const modes = run.sacrificeModes || ['name'];
    if (!modes.includes(a.mode)) fail('sacrifice mode not allowed: ' + a.mode);
    const first = run.sacrificeCount === 0;
    if (a.mode === 'self') return selfSacrifice(data, run, ev, first);
    let victims;
    if (a.mode === 'name') {
      if (!run.party.includes(a.target)) fail('target not in party');
      if (isLeader(a.target)) fail('the leader cannot be sacrificed');
      victims = [a.target];
    } else {
      victims = rngSample(run, sacrificable(run), diceN(run)); // v2.5: 木头's dice take one
    }
    if (first) run.branch = a.mode;
    run.sacrificeCount += 1;
    const hadRules = keyLit(run, 'rules'); // 2026-11-20 铃之门
    if (a.mode === 'name' && first) run.namedGirl = true; // §4.1: blocks the true route (feedback-1112 #14: only the first, free choice)
    else run.keys.rules = true; // §4.2 key two
    if (a.mode !== 'name') bump(braveOf(run), 'rules'); // @stats
    const gotRules = bellGot(run, 'rules', hadRules, ev); // 「你获得了公正之铃」 ends the taken story
    ev.push({ kind: 'darkTransition', reason: a.mode === 'name' ? 'sacrifice' : 'taken' });
    const d = {};
    const survivors = run.party.filter((id) => !victims.includes(id));
    // feedback-1112 #15 (round 2): the farewell belongs to her — her own words first, sentence by sentence (2–3 lines),
    // then a 'farewellEnd' marker (the UI lets her portrait go), and only then the advisor's reaction
    if (a.mode === 'name') {
      const v0 = victims[0], t = candLine(data, v0, 'sacrificedNamed');
      if (t) {
        const e0 = lineEvent(data, run, t, { name: nameOf(data, v0) }, v0, { id: v0, key: 'sacrificedNamed' });
        const parts = [];
        let cur = '';
        const s = String(e0.text || '');
        for (let i = 0; i < s.length; i++) { cur += s[i]; if (/[。！？!?]/.test(s[i]) && !/[。！？!?”」』）)]/.test(s[i + 1] || 'x')) { parts.push(cur); cur = ''; } }
        if (cur.trim()) parts.push(cur);
        while (parts.length > 3) parts.splice(parts.length - 2, 2, parts[parts.length - 2] + parts[parts.length - 1]);
        parts.forEach((p, i) => ev.push(Object.assign({}, e0, { text: p, farewell: true, part: i })));
      }
      ev.push({ kind: 'farewellEnd', id: v0 });
    } else for (const v of victims) say(data, run, ev, v, 'sacrificedRandom');
    // advisor reaction (after her farewell)
    if (a.mode === 'name' && run.suggestion) {
      const pleased = run.suggestion.id === a.target;
      run.advisorMood += pleased ? 1 : -1;
      advisorSay(data, run, ev, pleased ? 'pleased' : 'displeased');
      ev.push({ kind: pleased ? 'pleased' : 'displeased', advisorMood: run.advisorMood });
    }
    const selflessVictim = a.mode === 'name' && hasTrait(data, victims[0], 'selfless');
    if (selflessVictim && !REVEAL_ON_EFFECT) reveal(data, run, ev, victims[0], 'selfless');
    const fires = []; // REVEAL_ON_EFFECT: mood traits that may have acted here (checked before applyMoods)
    for (const o of survivors) {
      // §2.7: everyone left loses 1 (named or random). Named keeps the v1 exemptions (selfless victim, soft-heart).
      if (a.mode === 'random' || (!selflessVictim && !leaderHas(run, 'soft-heart'))) addMood(d, o, -1, TX('mood.why.sacrificed'));
      if (a.mode === 'name' && hasTrait(data, o, 'selfless')) traitMood(data, run, ev, d, fires, o, -1, 'selfless');
      if (hasTrait(data, o, 'fragile')) traitMood(data, run, ev, d, fires, o, -1, 'fragile');
      const rel = cand(data, o).relation;
      if (rel && victims.includes(rel.with)) { // the close bond between the two girls: extra −1
        if (CLOSE[rel.kind]) addMood(d, o, -1, TX('mood.why.friendGone'));
        if (hasTrait(data, o, 'protective')) traitMood(data, run, ev, d, fires, o, -1, 'protective', 'protective-sacrifice');
      }
      say(data, run, ev, o, 'witnessSacrifice');
    }
    for (const v of victims) {
      Object.assign(girlMem(run, v), { departure: a.mode === 'name' ? 'named' : 'taken', departLevel: run.level, mood: run.members[v].mood,
        teammates: run.party.filter((x) => x !== v), friend: friendOf(data, run, v) });
      run.sacrificed.push({ id: v, level: run.level, mode: a.mode, snapshot: snapshot(run, v) });
      run.party = run.party.filter((x) => x !== v);
    }
    ev.push({ kind: 'sacrifice', mode: a.mode, ids: victims.slice(), text: TX('sacrifice.taken', { names: listSeq(victims.map((v) => nameOf(data, v))) }) });
    // feedback-1112 #16/#17: after the first sacrifice — a black card (「你选择了 xx。但是，路还是要往前走。」→「第二幕 · 墓穴之下」),
    // then the gallery's talk about watching the parties fight each other, before L6 begins. (Random: queued behind its taken story.)
    // 2026-11-19 流程修 H4: 小铃's blessing happens at the gate, right after the loss — so the path card and the walk down
    // (pathOn / belowTomb) go AFTER bellBlessingAfter, not to the queue front (was: corridor → back to the gate → corridor)
    if (first) {
      const path = [{ story: a.mode === 'name' ? 'pathOn' : 'pathOnTaken', ctx: { name: victims.map((v) => nameOf(data, v)).join(TX('list.and')) } }, { story: 'belowTomb' }];
      const bi = run.queue.findIndex((x) => x && x.story === 'bellBlessingAfter');
      run.queue.splice(bi >= 0 ? bi + 1 : 0, 0, ...path);
    }
    if (a.mode === 'name') {
      run.returned[first ? 'first' : 'final'] = victims[0];
    } else {
      const s = victims.map((v) => run.sacrificed.find((x) => x.id === v));
      if (s.length === 1) run.returned.first = s[0].id; // v2.5 木头: the dice took one
      else {
        const [lo, hi] = s[1].snapshot.avgDps < s[0].snapshot.avgDps ? [s[1], s[0]] : [s[0], s[1]];
        run.returned.first = lo.id;
        run.returned.final = hi.id;
      }
      run.queue.unshift({ story: s.length === 1 ? 'sacrificeRandomTakenOne' : 'sacrificeRandomTaken', ctx: Object.assign({ name: victims.map((v) => nameOf(data, v)).join(TX('list.and')) }, gotRules ? { bellGot: gotRules } : {}) });
    }
    noteRecent(run, a.mode === 'name' ? { when: 'afterSacrifice', ctx: { lost: nameOf(data, victims[0]) } }
      : victims.length === 1 ? { when: 'afterTakenOne', ctx: { lost: nameOf(data, victims[0]) } }
      : { when: 'afterTaken', ctx: { lost: nameOf(data, victims[0]), lost2: victims[1] ? nameOf(data, victims[1]) : '' } });
    run.hardDay = true; // 2026-11-19 试玩修 剧情: until the next battle ends, nobody says 「今天谁都没受伤」
    if (REVEAL_ON_EFFECT) { // 起作用时才说: her gift (nobody loses mood for her) counts only if someone's mood really stayed up
      if (selflessVictim && !leaderHas(run, 'soft-heart') && survivors.some((o) => moodBites(data, run, d, o, -1))) reveal(data, run, ev, victims[0], 'selfless', 'selfless-victim');
      fireTraits(data, run, ev, d, fires);
    }
    applyMoods(data, run, ev, d);
    run.suggestion = null;
    run.sacrificeModes = null;
    advance(data, run, ev);
  }

  const selfMaxHp = (h) => Math.max(SELF_HP_MIN, Math.floor(h * SELF_HP_PCT));
  // §4.1 key one: write your own name. Nobody is taken; the leader pays.
  function selfSacrifice(data, run, ev, first) {
    if (first) run.branch = 'self';
    run.sacrificeCount += 1;
    run.keys.self = true;
    bump(braveOf(run), 'self'); // @stats
    (run.selfMarks || (run.selfMarks = [])).push(run.level);
    ev.push({ kind: 'darkTransition', reason: 'self' });
    // v2.3 §A[21]: every member's max hp ×0.5 (floor, min 3), hp clamped; everyone's mood −2
    const befores = {}, maxHp = [];
    for (const id of run.party) {
      const m = run.members[id];
      befores[id] = statsOf(m, isLeader(id));
      const to = selfMaxHp(m.maxHp);
      maxHp.push({ id, from: m.maxHp, to });
      m.growth.push({ source: 'self', stat: 'maxHp', delta: to - m.maxHp, level: run.level });
      m.maxHp = to;
      m.hp = Math.min(hpOf(m), to);
    }
    const L = maxHp.find((x) => isLeader(x.id));
    ev.push({ kind: 'sacrifice', mode: 'self', ids: [], leaderMaxHp: L ? { before: L.from, after: L.to } : null, maxHp, keys: clone(run.keys), text: TX('sacrifice.self') });
    const d = {};
    for (const id of run.party) addMood(d, id, SELF_MOOD, TX('mood.why.selfGone')); // everyone is shaken (the leader has no mood)
    applyMoods(data, run, ev, d);
    for (const id of run.party) statChange(data, run, ev, id, befores[id], 'self');
    run.recent = null;
    run.suggestion = null;
    run.sacrificeModes = null;
    run.queue.unshift({ story: 'sacrificeSelf' });
    advance(data, run, ev);
  }

  // ---------- enemies ----------
  const championDef = (data, id) => (data.enemies || []).find((x) => x.id === id) || CHAMPION_DEFAULT();
  const cardById = (data, id) => (data.cards.rewards || []).find((c) => c.id === id) || (data.cards.debuffs || []).find((c) => c.id === id) || null;

  // RULES-v1 §3: a returned (sacrificed) member comes back with her ORIGINAL candidate stats + buff, then every card
  // she received is flipped. Self-flips are deterministic; transfers to allies happen when her wave enters.
  function memoryFlip(data, u, snap) {
    const mem = [];
    for (const id of snap.debuffs || []) {
      const card = (data.cards.debuffs || []).find((c) => c.id === id);
      if (!card) continue;
      const eff = card.effect || {};
      if (eff.type === 'stat' && eff.stat === 'atk') u.atk -= eff.delta;
      else if (eff.type === 'stat' && eff.stat === 'maxHp') u.maxHp -= eff.delta;
      else if (eff.type === 'status' && eff.status === 'slow-start') u.extraFirst = (u.extraFirst || 0) + 1;
      else if (eff.type === 'mood' || eff.type === 'charge' || eff.type === 'gold') u.atk += 1; // 2026-11-19 诅咒维度: charge / gold cards flip like the mood card
      mem.push({ card: card.id, flip: 'debuff-returned' });
    }
    for (const id of snap.rewards || []) {
      const card = (data.cards.rewards || []).find((c) => c.id === id);
      if (!card) continue;
      const eff = card.effect || {};
      if (eff.type === 'stat' && eff.stat === 'atk') u.atk -= eff.delta;
      else if (eff.type === 'stat' && eff.stat === 'maxHp') u.maxHp -= eff.delta;
      else if (eff.type === 'skillUp') u.skill.power = (u.skill.power || 0) - 1;
      else if (eff.type === 'mood') u.skipRounds = (u.skipRounds || 0) + 1;
      else if (eff.type === 'token') u.hesitate = (u.hesitate || 0) + 1;
      mem.push({ card: card.id, flip: 'reward-softened' });
    }
    u.atk = Math.max(1, u.atk);
    u.maxHp = Math.max(3, u.maxHp);
    u.skill.power = Math.max(0, u.skill.power || 0);
    u.memory = mem;
    u.resentful = snap.moodAtSacrifice != null && snap.moodAtSacrifice < 0;
  }

  // girls who came back as enemies during the run, in order of first appearance (never one standing in the party)
  function resummonIds(run) {
    const rec = run.enemyRecord || {};
    return Object.keys(rec).filter((id) => rec[id].enemyAt.length && !run.party.includes(id))
      .sort((a, b) => Math.min(...rec[a].enemyAt) - Math.min(...rec[b].enemyAt) || a.localeCompare(b));
  }
  // SPEC-2026-11-13 E3: L4–L7 each bring one rejected girl; a run with fewer rejections than the level asks for
  // (short interviews) falls back to the level's plain-monster waves, and her foeIntro story is skipped
  function rejectedShort(run, cfg) {
    // 2026-11-20 L4–L7 改版: a squad of two (rejected [1, 2]) comes with whoever there is — the fallback only when none of them is
    // (old: any one missing → fallback: rejectedShort_old_2026_11_20)
    return !!cfg.fallbackWaves && cfg.waves.some((w) => w.some((e) => e.rejected)) && !cfg.waves.some((w) => w.some((e) => e.rejected && e.rejected.some((r) => run.rejected[r - 1])));
  }
  function rejectedShort_old_2026_11_20(run, cfg) { // eslint-disable-line no-unused-vars
    return !!cfg.fallbackWaves && cfg.waves.some((w) => w.some((e) => e.rejected && e.rejected.some((r) => !run.rejected[r - 1])));
  }
  const mirrorOn = (cfg) => !!(XIAOLING_MIRROR && cfg && Array.isArray(cfg.mirrorWaves)); // 2026-11-19 小铃战 镜像
  // 2026-11-19 小铃强 玩偶弱: XIAOLING_V2 false → the backed-up numbers (mirrorWaves_old_2026_11_19h), when the data has them
  const mirrorWavesOf = (cfg) => (!XIAOLING_V2 && Array.isArray(cfg.mirrorWaves_old_2026_11_19h) ? cfg.mirrorWaves_old_2026_11_19h : cfg.mirrorWaves);
  function wavesOf(run, cfg) { return mirrorOn(cfg) ? mirrorWavesOf(cfg) : rejectedShort(run, cfg) ? cfg.fallbackWaves : cfg.waves; }
  const carryHpOf = (cfg) => (mirrorOn(cfg) ? cfg.mirrorCarryHp != null ? !!cfg.mirrorCarryHp : true : !!cfg.carryHpBetweenWaves);
  // 2026-11-19 小铃战 第二波: everyone this run gave away (sacrificed, not 'self') or turned down (rejected) — never one in the party
  function goneIds(run) {
    const out = [], add = (id) => { if (id && !out.includes(id) && !(run.party || []).includes(id)) out.push(id); };
    for (const s of run.sacrificed || []) if (s && s.mode !== 'self') add(s.id);
    for (const r of run.rejected || []) add(r && r.id);
    return out;
  }
  // 2026-11-19 小铃战 第一波: one doll per party member, same slot order (front faces front), her class / skill / combo / level
  function mirrorDoll(data, run, id, e0) {
    const e = !MIRROR_TRUE && e0 && e0._old_2026_11_21b ? Object.assign({}, e0, e0._old_2026_11_21b) : e0; // 2026-11-21 MIRROR_TRUE false → the old entry
    const m = run.members[id] || {}, c = id === LEADER_ID ? {} : cand(data, id);
    const hpMul = Number.isFinite(e.hpMul) ? e.hpMul : MIRROR_HP, atkAdd = Number.isFinite(e.atkAdd) ? e.atkAdd : MIRROR_ATK;
    const sk = freshSkill(data, run, id, m.skill) || { kind: 'strike' };
    const u = { ref: id, mirror: true, name: MIRROR_NAME_TAG ? TX('battle.mirrorName', { name: nameOf(data, id) }) : nameOf(data, id), role: /* 2026-11-19 试玩修 界面: 「镜·莉珂」 — our 莉珂 and her doll read apart */ m.role || c.role || null, faction: 'fallen', corruption: 'possessed',
      maxHp: 1, atk: 1, skill: Object.assign(clone(sk), { power: MIRROR_TRUE ? (sk.power || 0) : 0 }) }; // MIRROR_TRUE: lvOf(skill) = her level (our rules read it)
    u.mirrorHp = Math.max(1, Math.round((m.maxHp || 1) * hpMul));
    u.mirrorAtk = Math.max(1, Number.isFinite(e.atkMul) ? Math.round((m.atk || 1) * e.atkMul) : (m.atk || 1) + atkAdd); // 2026-11-21 atkMul: 威力 ×0.7 (was atkAdd −2)
    u.mirrorGlass = Number.isFinite(e.glass) ? e.glass : MIRROR_GLASS;
    const lv = lvOf(m.skill);
    if (lv > 1) u.elv = lv;
    const combo = MIRROR_TRUE ? baseComboOf(data, run, id) : m.combo || c.combo; // MIRROR_TRUE: the leader's combo from the class data (as allyUnit), no ring
    if (combo && !e.noCombo) u.combo = clone(combo); // 2026-11-21 noCombo: 「不带道具/护符/特技」 (dolls never had items / relics)
    return u;
  }
  // 用户 2026-11-15 第 4–7 关: enemy skill levels + level traits, from the scenario wave entry
  // (skillLv: n · traits: { enemyId: [trait…] } for a mercenary squad, or [trait…] for the rejected girl)
  function foeLevelUp(u, e, refId) {
    if (Number.isFinite(e.skillLv) && e.skillLv > 1) u.elv = clamp(Math.floor(e.skillLv), 1, SKILL_LV_MAX);
    // 2026-11-20 L6: healer = { skillLv, traits } for whichever healer the wave entry makes (a mercenary priest, or a returning girl
    // who is a healer — ONE_HEALER then leaves the mercenary one out)
    const hx = e.healer && u.skill && u.skill.kind === 'heal' ? e.healer : null;
    if (hx && Number.isFinite(hx.skillLv)) u.elv = clamp(Math.floor(hx.skillLv), 1, SKILL_LV_MAX);
    if (hx && Array.isArray(hx.traits)) u.traits = Array.from(new Set((u.traits || []).concat(hx.traits)));
    const tr = Array.isArray(e.traits) ? e.traits : e.traits && refId ? e.traits[refId] : null;
    if (Array.isArray(tr) && tr.length) u.traits = Array.from(new Set((u.traits || []).concat(tr)));
    if (u.traits && u.traits.includes('tough')) { u.tough = Math.max(u.tough || 0, 1); u.traits = u.traits.filter((t) => t !== 'tough'); if (!u.traits.length) delete u.traits; } // 坚韧 as a trait: each hit taken −1 (status chip 'tough')
  }
  // 用户 2026-11-15 敌方自动站位 (充能): the biggest both-ways givers stand in the middle, one-way givers at the end facing their
  // mates ('next' givers on the left end, 'prev' givers on the right end); equal givers keep the old order (role formation etc.).
  // Deterministic, no rng. A level with keepOrder (story placements: L3 gate, L8 champion, L9 ambush, L10 boss, L11 fairy) is left alone.
  function chargeFormation(all) {
    const dirOf = (u) => (u.combo ? u.combo.direction : u.ref === 'fairy-demon' ? 'all' : u.enemyK > 0 ? 'both' : null);
    const kOf = (u) => (u.combo ? Math.floor(baseK(u.combo)) : u.ref === 'fairy-demon' ? 0 : u.enemyK || 0);
    const left = all.filter((u) => dirOf(u) === 'next'), right = all.filter((u) => dirOf(u) === 'prev');
    const mid = all.filter((u) => dirOf(u) !== 'next' && dirOf(u) !== 'prev');
    const both = mid.filter((u) => dirOf(u) === 'both'), low = both.length ? Math.min(...both.map(kOf)) : 0;
    const big = mid.filter((u) => dirOf(u) === 'both' && kOf(u) > low).map((u, i) => ({ u, i })).sort((x, y) => kOf(y.u) - kOf(x.u) || x.i - y.i).map((x) => x.u);
    const rest = mid.filter((u) => !big.includes(u));
    const at = Math.floor(rest.length / 2);
    return left.concat(rest.slice(0, at), big, rest.slice(at), right);
  }
  // 2026-11-19 用户亲测 流程 (L5 阿雾 stood at slot 1): stable placement by class floor. Slot 1 goes to a 盾 / 战士 when the
  // wave has one; a named unit (returning girl, champion, boss) is placed no earlier than FOE_NAMED_FLOOR[role] (capped at the
  // last slot). Each slot takes the first unit, in the old order, whose floor allows it — the rest keep their order. Pure.
  function classGuard(data, all) {
    const front = (u) => !!FOE_FRONT_ROLES[foeRole(data, u)];
    const named = (u) => !!(u.candidate || u.returned || u.champion || u.advisorBoss || u.boss || u.waveBoss);
    const hasFront = all.some(front);
    const floor = (u) => Math.min(all.length - 1, Math.max(named(u) ? (FOE_NAMED_FLOOR[foeRole(data, u)] || 0) : 0, hasFront && !front(u) ? 1 : 0));
    const left = all.slice(), out = [];
    while (left.length) {
      let k = left.findIndex((u) => floor(u) <= out.length);
      if (k < 0) k = 0;
      out.push(left.splice(k, 1)[0]);
    }
    return out;
  }
  const FOE_LV_KINDS = { guard: 1, aim: 1, backstab: 1, heal: 1, spark: 1 }; // a strike has no levels
  const FOE_KIND_ROLE = { guard: 'tank', strike: 'melee', backstab: 'rogue', spark: 'mage', aim: 'adc', heal: 'healer' };
  function foeRole(data, u) {
    if (u.role) return u.role;
    const t = (data.enemies || []).find((x) => x.id === u.ref);
    return (t && t.role) || FOE_KIND_ROLE[u.skill && u.skill.kind] || 'melee';
  }
  // 2026-11-19 (用户「小铃祝福没选的两个，小铃战她给自己的队伍用」): run.blessingLeft buffs her side — round 2 of feedback:
  // she picks ONE of the two at random for wave 1 and gives the OTHER to wave 2 (order fixed once per fight in
  // run.flags.xlBless by mirrorBlessOrder at initBattle; MIRROR_BLESS_SPLIT false = both blessings on both waves, the first take)
  const MIRROR_BLESS_SPLIT = true;
  const MIRROR_WAVE_CAP = true; // the 10-round cap counts per wave in her fight (false: the whole fight, like every other battle)
  function mirrorBlessOrder(data, run) {
    const left = (run.blessingLeft || []).filter((id) => blessingPool(data).some((c) => c.id === id));
    if (!run.flags) run.flags = {};
    if (Array.isArray(run.flags.xlBless)) return; // 2026-11-19 流程修 L7: drawn once per run — a retry / cheatResume keeps the waves' blessings
    run.flags.xlBless = left.length > 1 && rngNext(run) < 0.5 ? [left[1], left[0]].concat(left.slice(2)) : left.slice();
  }
  const mirrorBlessFor = (run, wi) => { const o = (run.flags && run.flags.xlBless) || run.blessingLeft || []; return MIRROR_BLESS_SPLIT ? (o[wi] ? [o[wi]] : []) : o; };
  function mirrorBless(data, run, units, wi) {
    for (const bid of mirrorBlessFor(run, wi)) {
      const card = blessingPool(data).find((c) => c.id === bid), fx = card && card.effect;
      if (!fx) continue;
      for (const u of units) {
        if (fx.type === 'teamStat' && fx.stat === 'maxHp') { u.maxHp += fx.delta; if (u.startHp != null) u.startHp += fx.delta; }
        else if (fx.type === 'teamStat' && fx.stat === 'atk') u.atk = Math.max(1, u.atk + fx.delta);
        else if (fx.type === 'teamCharge') u.fullAt = CHARGE_FULL + (fx.delta || 0);
        (u.blessed || (u.blessed = [])).push(bid);
      }
    }
  }
  function buildWaves(data, run, cfg) {
    return wavesOf(run, cfg).map((wave, wi) => {
      const units = [];
      const intro = [];
      const pads = [];
      let summon = null; // 2026-11-16 露西安 L10: a summoner boss (advisors.json boss.summon) — no mercenary squad, chaff called in each round
      const sp = []; // her summon templates (one per enemy id), scaled with the wave below
      for (const e of wave) {
        const b = e.buff || {};
        const bh = b.hp || 0, ba = b.atk || 0;
        if (Array.isArray(e.notFor) && e.notFor.includes(run.advisor)) continue; // 2026-11-17 露西安 L10: an entry left out when this advisor is the boss
        if (Array.isArray(e.onlyFor) && !e.onlyFor.includes(run.advisor)) continue; // 2026-11-18 妮可塔 L10: an entry that only comes when this advisor is the boss
        if (e.padTo) { pads.push(e); continue; }
        if (e.enemy) {
          const t = data.enemies.find((x) => x.id === e.enemy) || (e.optional ? null : fail('unknown enemy ' + e.enemy));
          if (!t) continue; // 2026-11-16: an optional entry (第 10 关 雇佣兵) is skipped on data without it (test fixtures), like padTo
          const u = { ref: t.id, name: t.name, faction: t.faction, maxHp: Math.max(1, t.hp + bh), atk: t.atk + ba, skill: Object.assign({ power: 0 }, t.skill) }; // L1–L3 新敌人 2026-11-16: the L1 slime hp −4 buff would go negative on the tiny test fixtures — hp floor 1
          if (t.boss) u.boss = true;
          if (t.special) u.special = t.special;
          if (Array.isArray(t.traits) && t.traits.length) u.traits = t.traits.slice(); // feedback-1112 #34: twinShot / pickpocket / vengeance
          if (u.traits && u.traits.includes('tough')) foeLevelUp(u, {}, null); // 坚韧 from enemies.json
          if (e.waveBoss) u.waveBoss = true; // §4.5: the wave ends when she drops
          if (e.hpPct) u.startHp = Math.max(1, Math.ceil(u.maxHp * e.hpPct));
          if (e.phase2) u.phase2 = true;
          if (e.dollWard) u.dollWard = true; // 2026-11-19 小铃战: warded while her dolls stand
          if (XL_V3 && e.thorns > 0) { u.thorns = e.thorns; if (e.thornsOnce) u.thornsOnce = true; if (e.thornsBell) u.thornsBell = true; } // 2026-11-21 小铃「诅咒之铃」
          if (e.xlPhases && XIAOLING_V2) u.xlPhases = true; // 2026-11-19 小铃强 玩偶弱: her two phases
          if (Array.isArray(e.addTraits)) u.traits = (u.traits || []).concat(e.addTraits.filter((k) => !(u.traits || []).includes(k))); // 2026-11-18 growth-flow: per-level 考点 traits (e.g. sunder)
          if (e.noOpenBlock) u.noOpenBlock = true; // 2026-11-23 试玩14 L8 盾卫: no opening 护甲
          if (IRON_L10 && e.openBlockHp > 0) u.openBlockHp = e.openBlockHp; // 2026-11-21 奥德丽战: opening 护甲 = openBlockHp × final max hp
          if (IRON_L10 && e.name) u.name = e.name; // 2026-11-21 铁甲卫兵 / 铁甲弓手 / 铁甲法师: a per-level name (the art stays the base enemy's)
          if (IRON_L10 && e.skill) u.skill = Object.assign({}, u.skill, e.skill); // … and a per-level skill (法师群伤 · 弓手点人)
          if (e.quake) u.quake = Object.assign({ every: 2, base: 2, step: 1 }, e.quake); // 2026-11-16 第 10 关 石门守卫「地震」
          if (e.toll || t.toll) u.toll = Object.assign({ every: 3, n: 4 }, t.toll, e.toll); // 2026-11-20 L5 钟楼守卫
          if (e.bell || t.bell) { u.bell = true; u.passive = true; } // 2026-11-20 L5 铜钟: a target that never acts
          if (e.passive || t.passive) u.passive = true; // 2026-11-20 L9 灰羽护符: never acts
          if (e.dodgeAura || t.dodgeAura) u.dodgeAura = e.dodgeAura || t.dodgeAura; // 2026-11-20 L9 灰羽护符: while it stands, the others dodge
          if (e.wander > 0 || t.wander > 0) u.wander = e.wander || t.wander; // 2026-11-20 L1 史莱姆「乱撞」: each round this share of the time its target is a random ally
          if (e.split || t.split) u.split = Object.assign({ cap: 6 }, t.split, e.split); // 2026-11-20 L7 分裂史莱姆
          if (e.brood) u.brood = Object.assign({ n: 2, cap: 6, unit: 'slime', hp: 8, hpStep: 0, atk: 2, atkStep: 1, wander: 0.2 }, e.brood); // 2026-11-20 L7 史莱姆母体 (broodRound)
          if (e.winOnDown) u.winOnDown = true; // her fall ends the battle (the L10 advisor rule, for any wave entry)
          if (e.hpExact > 0) u.hpExact = e.hpExact; // 2026-11-16 第 10 关: the real entry hp, set after every tier / ×multiplier step
          if (e.noRamp) u.noRamp = true; // 2026-11-22k 用户「母体的全体喷溅不吃每回合 +1」: no per-round 威力 ramp for her
          if (e.rampEvery > 1) u.rampEvery = e.rampEvery; // 2026-11-22i scenario rampEvery: her per-round 威力 +1 only every N rounds (L5 钟楼守卫 2)
          if (e.bossEnrage > 0) u.bossEnrage = e.bossEnrage; // 2026-11-16 第 10 关: her fall makes the advisor boss ramp faster
          if (e.leechBoss) u.leechBoss = true; // 2026-11-18 妮可塔 L10: whatever her ghoul leeches, she gains the same too
          if (e.leech > 0) u.leech = e.leech; // 2026-11-18 妮可塔 L10 食尸鬼「吸血」: hp it takes off us heals its most-hurt comrade (itself / her included)
          units.push(u);
        } else if (e.rejected) {
          for (const r of e.rejected) {
            const x = run.rejected[r - 1]; // r = 1-based order of rejection
            if (!x) continue;
            const c = cand(data, x.id);
            const grudge = (run.rejectedInfo[x.id] && run.rejectedInfo[x.id].grudge) || x.grudge || 'high';
            const u = { ref: c.id, candidate: true, name: c.name, role: c.role, faction: 'fallen', corruption: 'vengeful', grudge,
              maxHp: c.hp + bh, atk: c.atk + ba, skill: Object.assign({ power: 0 }, clone(c.skill)) };
            if (grudge === 'high') { u.maxHp += 2; u.atk += 1; } // §2.2 grudge high: stronger, crueller
            else if (GRUDGE_LOW_SOFT) u.softFirst = true; // 2026-11-24 用户「支持她但没选她，第一轮都可以发呆」(方案 2): her first action each fight is skipped; no 虚弱
            else { u.weak = 1; u.flashbackFirst = true; } // grudge low: hesitates once, 虚弱 (威力 −1; was atk −1 before 2026-11-14)
            if (c.combo) u.combo = clone(c.combo);
            if (diffOf(run)) foeLevelUp(u, e, null);
            units.push(u);
            intro.push({ id: c.id, key: 'enemyIntroRejected', v2: ['vengeful', grudge, 'intro'] });
          }
        } else if (e.returned) {
          const id = run.returned[e.returned];
          const s = id && run.sacrificed.find((x) => x.id === id);
          if (!s) { // §4.1: that sacrifice took nobody (self) → a masked champion with the stats she would have had
            if (e.fallback && run.sacrificeCount > 0) {
              const t = championDef(data, e.fallback);
              units.push({ ref: t.id, champion: true, swapRole: !!e.swapRole, name: t.name, faction: t.faction || 'noble', maxHp: t.hp + bh, atk: t.atk + ba, skill: Object.assign({ power: 0 }, clone(t.skill)) });
            }
            continue;
          }
          const c = cand(data, id);
          const u = { ref: id, candidate: true, returned: true, corruption: 'possessed', name: c.name, role: c.role, faction: 'fallen', maxHp: c.hp + bh, atk: c.atk + ba,
            skill: Object.assign({ power: 0 }, clone(c.skill)), tokens: s.snapshot.tokens.slice() };
          if (c.combo) u.combo = clone(RETURNED_RING ? ringCombo(c.combo, { tokens: u.tokens, ringSide: s.snapshot.ringSide || (run.members[id] || {}).ringSide }) : c.combo); // 2026-11-24 用户「莉珂被献祭到第 8 关还是左右 +1」: the ring she took along still turns it
          if (e.swapRole) u.swapRole = true; // 2026-11-20 L8: she takes her class's place in the squad (SWAP_RETURNED_ROLE)
          memoryFlip(data, u, s.snapshot);
          if ((s.snapshot.skillLv || 1) > 1) u.elv = clamp(s.snapshot.skillLv, 1, SKILL_LV_MAX); // 2026-11-16: she comes back at the level she left with
          if (RETURNED_NORMAL && e.fallback) { // 2026-11-18 growth-flow round 2 (用户「第 8 关完全取决于献祭了谁」): only her name, class and skill stay hers —
            // hp / 威力 = the masked champion's numbers + this entry's buff (the same as a run where nobody came back), skill level =
            // the entry's skillLv (default 2), no relics, no flipped-card stat changes (the memory list stays for her lines / hand-backs)
            const t = championDef(data, e.fallback);
            Object.assign(u, { maxHp: t.hp + bh, atk: t.atk + ba, tokens: [] });
            u.skill.power = 0; delete u.skipRounds; delete u.hesitate; delete u.extraFirst;
            const lv = Number.isFinite(e.skillLv) ? e.skillLv : RETURNED_SKILL_LV;
            if (lv > 1) u.elv = clamp(lv, 1, SKILL_LV_MAX); else delete u.elv;
          }
          units.push(u);
          intro.push({ id, key: 'enemyIntroSacrificed', tokens: s.snapshot.tokens, v2: ['possessed', 'intro'] });
        } else if (e.mirror) { // 2026-11-19 小铃战 第一波: the party's doll copy
          for (const id of run.party) units.push(mirrorDoll(data, run, id, e));
        } else if (e.resummon || e.gone) { // §4.5 phase 2: every girl who came back during the run, possessed again (2026-11-19 gone: everyone given away / turned down)
          const ids = e.gone ? goneIds(run) : resummonIds(run);
          if (e.gone) for (let k = ids.length; k < (Number.isFinite(e.min) ? e.min : MIRROR_GONE_MIN); k++) { // too few: plain dolls
            const t = data.enemies.find((x) => x.id === e.pad);
            if (t) units.push({ ref: t.id, padDoll: true, name: t.name, faction: t.faction, maxHp: Math.max(1, t.hp + bh), atk: t.atk + ba, skill: Object.assign({ power: 0 }, t.skill) });
          }
          for (const id of ids) {
            const c = cand(data, id);
            const s = run.sacrificed.find((x) => x.id === id);
            const u = { ref: id, candidate: true, resummoned: true, corruption: 'possessed', name: c.name, role: c.role, faction: 'fallen',
              maxHp: c.hp + bh, atk: c.atk + ba, skill: Object.assign({ power: 0 }, clone(c.skill)) };
            if (c.combo) u.combo = clone(c.combo);
            if (s) { u.tokens = s.snapshot.tokens.slice(); memoryFlip(data, u, s.snapshot); u.memory = []; } // her old flips, no second hand-back
            else {
              const g = (run.rejectedInfo[id] && run.rejectedInfo[id].grudge) || 'high';
              if (g === 'high') { u.maxHp += 2; u.atk += 1; }
            }
            units.push(u);
          }
          if (XL_V3 && e.openBlockHp > 0) for (const u of units) if ((u.resummoned || u.padDoll) && !u.openBlockHp) u.openBlockHp = e.openBlockHp; // 2026-11-21 第二波: opening 护甲 = 血量
        } else if (e.advisorBoss) {
          const adv = advisorData(data, run);
          if (!adv) continue;
          const bs = adv.boss;
          let hp = bs.hp + bh, atk = bs.atk + ba + ((e.atkAddBy && e.atkAddBy[adv.id]) || 0); // 2026-11-22j scenario atkAddBy: L10 boss 威力 per advisor
          if (run.advisorMood >= 2) { hp += 4; atk += 1; } else if (run.advisorMood <= -2) hp -= 4;
          const ub = { ref: adv.id, advisorBoss: true, name: bs.name, faction: bs.faction || 'noble', maxHp: Math.max(1, hp), atk: Math.max(1, atk), skill: Object.assign({ power: 0 }, bs.skill, BOSS_NEW_SKILLS && bs.skill && bs.skill.text_bossNew ? { text: bs.skill.text_bossNew } : {}) }; // BOSS_NEW_SKILLS: 妮可塔 no longer 坐庄
          if (bs.rampEvery > 0) ub.rampEvery = bs.rampEvery; if (bs.rampStep > 0) ub.rampStep = bs.rampStep; // 2026-11-23 用户 妮可塔「不翻倍，每 N 回合 +2」
          if (bs.thorns > 0) ub.thorns = bs.thorns; // 2026-11-17 用户「荆棘」
          if (bs.hitCap > 0) ub.hitCap = bs.hitCap; // 2026-11-18 妮可塔 L10: one hit takes at most hitCap × her max hp (no 猎人 one-shots); 0 = off
          if (IRON_L10 && e.openBlockHpBy && e.openBlockHpBy[adv.id] > 0) ub.openBlockHp = e.openBlockHpBy[adv.id]; // 2026-11-21 奥德丽: half 血 half 护甲
          if (e.tollBy && e.tollBy[adv.id]) ub.toll = Object.assign({ every: 3, n: 4, noBell: true }, e.tollBy[adv.id]); // 2026-11-23 用户「没几轮就要群伤一下」: the advisor boss tolls every N rounds (scenario tollBy)
          if (e.winOnDown) ub.winOnDown = true; // 2026-11-16 用户「奥德丽先死就胜利」: her fall ends the battle, the rest need not die
          if (e.hpExactBy && e.hpExactBy[adv.id] > 0) ub.hpExact = e.hpExactBy[adv.id]; // 2026-11-16 用户「总督 200」: the real entry hp per advisor (others keep their own)
          { const dT = diffOf(run), hT = dT && e.hpExactByTier && e.hpExactByTier[DIFF_LADDER ? 0 : dT.id]; /* 2026-11-25: 阶梯下每档都用木头的 L10 血量（之前青铜起露西安 150） */ if (hT && hT[adv.id] > 0) ub.hpExact = hT[adv.id]; } // 2026-11-19 调难度: per-tier override of hpExactBy (scenario L10 hpExactByTier { "0": { advisor: hp } }, 木头 only so far)
          units.push(ub);
          intro.push({ advisor: true });
          const sm = bs.summon;
          if (sm && Array.isArray(sm.cycle) && sm.cycle.length) {
            summon = { cycle: sm.cycle.map((g) => g.slice()), cap: sm.cap || SUMMON_CAP, next: 1, seq: 0, units: {} };
            // 2026-11-17 露西安 L10 召唤战: every (summon each `every` rounds), minions cap by tier, an opening board, ward, devour
            const hard = (run.difficulty || 0) > 0;
            if (sm.every > 0) Object.assign(summon, { every: sm.every, emergency: !!sm.emergency, wardPhase: !!sm.wardPhase, minions: (hard && sm.minionsHard) || sm.minions || SUMMON_CAP, next: sm.next || 0,
              open: ((hard && sm.openHard) || sm.open || sm.cycle[0]).slice(), ward: sm.ward || 0, calls: SUMMON_CALLS ? sm.calls || 0 : 0, /* 2026-11-23 */ devour: sm.devour ? Object.assign({ share: DEVOUR_SHARE, dmgPer: DEVOUR_DMG }, sm.devour) : null });
            for (const id of new Set([].concat(...sm.cycle, summon.open || []))) {
              const t = data.enemies.find((x) => x.id === id) || fail('unknown summon ' + id);
              const u = { ref: t.id, summoned: true, name: t.name, faction: t.faction, maxHp: Math.max(1, Math.round(t.hp * (sm.hpMul != null ? sm.hpMul : 1))),
                atk: Math.max(1, t.atk + (sm.atkAdd || 0)), skill: Object.assign({ power: 0 }, t.skill) };
              if (sm.atkAddBy && Number.isFinite(sm.atkAddBy[id])) u.atk = Math.max(1, t.atk + sm.atkAddBy[id]); // 2026-11-23 用户「哥布林有法师，骷髅也有法师」: a mage's own bonus
              if (sm.wander && sm.wander[id] > 0) { u.wander = sm.wander[id]; u.wanderBack = true; } // 2026-11-23 用户「史莱姆 20% 不打前排」
              if (Array.isArray(t.traits) && t.traits.length) u.traits = t.traits.slice();
              if (sm.hpExact && sm.hpExact[id] > 0) u.hpExact = sm.hpExact[id]; // 2026-11-17: the real minion hp, after every tier step
              if (sm.block && sm.block[id] > 0) u.sumBlock = sm.block[id]; // 2026-11-17: 护甲 back up to this at each enemy phase
              if (sm.chargeDrain && sm.chargeDrain[id] > 0) u.chargeDrain = sm.chargeDrain[id]; // 2026-11-17: each hit steals that many pips
              if (sm.thorns && sm.thorns[id] > 0) u.thorns = sm.thorns[id]; // 2026-11-17 用户「荆棘」: each hit she takes hurts the hitter back
              summon.units[id] = u;
              sp.push(u);
            }
          }
        }
      }
      // RULES-v1 §5/§7: padTo fills the wave up to the current party size; mercenaries stand at the FRONT.
      const front = [], df0 = diffOf(run);
      if (!summon) for (const e of pads) {
        if (e.padTo !== 'party') continue;
        const t0 = data.enemies.find((x) => x.id === e.enemy);
        if (!t0) continue; // tolerated while content lands; validate-data flags unknown ids
        const b = e.buff || {};
        // 试玩反馈 2026-11-14 晚 #13: squad = a mixed mercenary squad (guard / priest / archer …), filled in this order, cycling
        // 2026-11-16 奥德丽 L10: the advisor boss's data may carry her own squad order (boss.squad) for her wave
        const advSq = wave.some((x) => x.advisorBoss) && advisorData(data, run) && advisorData(data, run).boss && advisorData(data, run).boss.squad;
        const sq = (Array.isArray(advSq) ? advSq : Array.isArray(e.squad) ? e.squad : []).map((id) => data.enemies.find((x) => x.id === id)).filter(Boolean);
        // 用户 2026-11-15 第 4–7 关: padMin keeps the squad at max(padMin, party) — a sacrifice no longer shrinks the fight
        const want = Math.max(run.party.length, df0 && Number.isFinite(e.padMin) ? e.padMin : 0);
        for (let k = 0; units.length + front.length < want; k++) {
          let t = sq.length ? sq[k % sq.length] : t0;
          // 2026-11-20 用户「如果有一个牧师了就不要两个牧师，保持职业平衡」: a squad healer is skipped when the wave already has one
          // (a returning girl, or a healer padded earlier) — the next non-healer of the squad stands in. ONE_HEALER false = the old fill
          if (ONE_HEALER && t.skill && t.skill.kind === 'heal' && units.concat(front).some((x) => x.skill && x.skill.kind === 'heal')) {
            for (let j = 1; j <= sq.length; j++) { const alt = sq[(k + j) % sq.length]; if (!(alt.skill && alt.skill.kind === 'heal')) { t = alt; break; } }
          }
          const u = { ref: t.id, padded: true, name: t.name, faction: t.faction, maxHp: t.hp + (b.hp || 0), atk: t.atk + (b.atk || 0), skill: Object.assign({ power: 0 }, t.skill) };
          if (Array.isArray(t.traits) && t.traits.length) u.traits = t.traits.slice();
          if (df0) foeLevelUp(u, e, t.id);
          front.push(u);
        }
      }
      let all = front.concat(units);
      // 2026-11-20 用户「第 8 关一个标准小队（盾卫 / 法师 / 牧师…），被抛弃的角色替换对应角色所在的位置」(SWAP_RETURNED_ROLE): an entry
      // with swapRole (the returned girl, or the masked champion) takes the slot of the first squad member of her role (a rogue → a
      // melee one), and that member stays home; no match → she keeps her own place
      if (SWAP_RETURNED_ROLE) for (const u of all.filter((x) => x.swapRole)) {
        const r = foeRole(data, u), same = (x, rr) => x !== u && !x.swapRole && !x.candidate && !x.champion && foeRole(data, x) === rr;
        let i = all.findIndex((x) => same(x, r));
        if (i < 0 && r === 'rogue') i = all.findIndex((x) => same(x, 'melee'));
        if (i < 0) continue;
        const keep = all[i];
        all = all.filter((x) => x !== u);
        all[all.indexOf(keep)] = u;
      }
      // 用户 2026-11-15 敌方站位: a level with formation 'role' lines its enemies up by role (scenario.formationOrder:
      // tanks in front, then melee / rogues, then mages / archers, healers at the back); ties keep the old order
      if (df0 && cfg.formation === 'role') {
        const ord = (data.scenario && data.scenario.formationOrder) || {};
        const rank = (u) => { const r = foeRole(data, u); return Number.isFinite(ord[r]) ? ord[r] : 99; };
        all = all.map((u, i) => ({ u, i })).sort((x, y) => rank(x.u) - rank(y.u) || x.i - y.i).map((x) => x.u);
      }
      const df = diffOf(run); // v2.5 difficulty
      if (df) for (const u of all.concat(sp)) {
        const pct = u.startHp != null ? u.startHp / u.maxHp : null;
        const rj = u.corruption === 'vengeful'; // FEEDBACK-1112 #30: the rejected girls can have their own tier numbers
        u.maxHp = Math.max(1, Math.round(u.maxHp * (rj && df.rejectedHp != null ? df.rejectedHp : df.hp)));
        if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct));
        u.atk = Math.max(1, u.atk + (rj && df.rejectedAtk != null ? df.rejectedAtk : df.atk));
        // 试玩反馈 2026-11-14 晚 (木头 curve): per-level enemy hp ×levelHp[L] / atk +levelAtk[L] — tier-only, other tiers untouched
        const lh = df.levelHp && df.levelHp[run.level], la = df.levelAtk && df.levelAtk[run.level];
        if (lh) { u.maxHp = Math.max(1, Math.round(u.maxHp * lh)); if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct)); }
        if (la) u.atk = Math.max(1, u.atk + la);
        // 2026-11-18 growth-flow 第二轮: scenario.enemyCurve.levels[L] { hp ×, atk + } — checkpoints L3 / L5 / L8, the levels between
        // interpolated (tools/growth/curve.cjs). Summoned chaff is left alone. enemyCurve.on false / no table: nothing.
        const EC = data.scenario && data.scenario.enemyCurve, ec = EC && EC.on && EC.levels && EC.levels[run.level];
        if (ec && !u.summoned) {
          if (ec.hp > 0 && ec.hp !== 1) { u.maxHp = Math.max(1, Math.round(u.maxHp * ec.hp)); if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct)); }
          if (ec.atk) u.atk = Math.max(1, u.atk + ec.atk);
        }
      }
      if (df) for (const u of all.concat(sp)) { // 2026-11-13: every enemy ×ENEMY_HP_MUL (ceil), after the tier numbers — the party always eats the first enemy round (untiered = v2.4 numbers, untouched)
        const pct = u.startHp != null ? u.startHp / u.maxHp : null;
        u.maxHp = Math.ceil(u.maxHp * ENEMY_HP_MUL - 1e-9);
        if (ascOn(run, 'allAtk')) u.atk += ascOn(run, 'allAtk'); // 星辰
        if (ascOn(run, 'eliteAtk') && isElite(u)) u.atk += ascOn(run, 'eliteAtk'); // 秘银
        if (ascOn(run, 'enemyHp')) { u.maxHp += ascOn(run, 'enemyHp'); if (u.startHp != null) u.startHp += ascOn(run, 'enemyHp'); } // 进阶第 1 档: every enemy +2 生命
        if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct));
      }
      if (df) { /* 用户 2026-11-15 敌方充能: stamp each unit's k (level field > tier field > default) */
        const lc0 = levelCfg(data, run.level) || {};
        const kOf = (key, d) => { const k0 = lc0[key] != null ? lc0[key] : (tierRule(run, key) ?? d); return k0 > 0 ? Math.floor(k0) : 0; };
        for (const u of all.concat(sp)) { if (u.ref === 'fairy-demon') u.fairyK = kOf('fairyCharge', FAIRY_CHARGE); else u.enemyK = kOf('enemyCharge', ENEMY_CHARGE); }
      }
      if (df && run.level >= LATE_HP_FROM) for (const u of all.concat(sp)) { /* 用户 2026-11-15: from L6 on no enemy unit has a one-digit hp (else one sweep takes them all) */
        if (u.maxHp >= LATE_HP_MIN || u.summoned) continue; // 2026-11-16: 露西安's summoned chaff stays thin (volume, not toughness)
        const pct = u.startHp != null ? u.startHp / u.maxHp : null;
        u.maxHp = LATE_HP_MIN;
        if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct));
      }
      for (const u of sp) if (u.hpExact > 0) { u.maxHp = u.hpExact; delete u.hpExact; } // 2026-11-17 露西安 L10 召唤战
      for (const u of all) if (u.hpExact > 0) { const pct = u.startHp != null ? u.startHp / u.maxHp : null; u.maxHp = u.hpExact; if (pct != null) u.startHp = Math.max(1, Math.ceil(u.maxHp * pct)); delete u.hpExact; }
      for (const u of all) if (u.mirror) { u.maxHp = u.mirrorHp; u.atk = u.mirrorAtk; delete u.mirrorHp; delete u.mirrorAtk; } // 2026-11-19 镜像玩偶: her own numbers, no tier steps
      if (df) for (const u of all) { // 方案 B 开场护甲 (after the final hp)
        const t = data.enemies.find((x) => x.id === u.ref);
        const share = u.summoned ? 0 : (t && Number.isFinite(t.openBlock) ? t.openBlock : OPEN_BLOCK_SHARE[openBlockKind(u)]) * levelNum(data, run.level, 'openBlockMul', OPEN_BLOCK_LEVEL[run.level] || 0); // review #5 (was OPEN_BLOCK_LEVEL[run.level] || 0)
        u.openBlock = share > 0 ? Math.max(OPEN_BLOCK_MIN, Math.round(u.maxHp * share)) : 0;
      }
      for (const u of all) if (u.openBlockHp > 0) u.openBlock = Math.max(1, Math.round(u.maxHp * u.openBlockHp)); // IRON_L10 (any tier)
      for (const u of all) if (u.noOpenBlock) u.openBlock = 0;
      if (ascOn(run, 'eliteBlock')) for (const u of all) if (isElite(u)) u.openBlock = (u.openBlock || 0) + ascOn(run, 'eliteBlock'); // 龙鳞
      for (const u of all) if (u.mirror) { u.glass = u.mirrorGlass > 0 ? Math.max(1, Math.round(u.maxHp * u.mirrorGlass)) : 0; u.openBlock = u.glass; delete u.mirrorGlass; } // 2026-11-19 「玻璃瓶」
      if (mirrorOn(cfg)) mirrorBless(data, run, all, wi);
      if (df && !cfg.keepOrder) all = chargeFormation(all);
      if (df && FOE_CLASS_GUARD && !all.some((u) => u.mirror)) all = classGuard(data, all); // 2026-11-19 用户亲测 流程: keepOrder levels too
      if (summon) { // her opening board: the first group, then her at the right end (the hunter's 「最右侧」 reaches her)
        const bi = all.findIndex((u) => u.advisorBoss);
        all.splice(bi < 0 ? all.length : bi, 0, ...(summon.open || summon.cycle[0]).map((id) => { const m = clone(summon.units[id]); if (m.sumBlock > 0) m.openBlock = m.sumBlock; return m; }));
        all = all.filter((u) => !u.advisorBoss).concat(all.filter((u) => u.advisorBoss));
      }
      all.forEach((u, i) => { u.id = `e${wi + 1}-${i + 1}`; u.hp = u.startHp != null ? u.startHp : u.maxHp; delete u.startHp; });
      const out = { units: all, intro };
      if (summon) out.summon = summon;
      if (wave.some((e) => e.phase2)) out.phase2 = true;
      return out;
    });
  }

  // ---------- keywords / unit views (§5) ----------
  function keywordsFor(data, skill, combo, k) {
    const K = data.keywords;
    const out = [];
    if (!K) { // no keywords.json yet: the old texts, one chip each
      if (skill) out.push({ id: 'skill:' + skill.kind, label: skill.name || skill.kind, tip: String(skill.text || '').replace(/\*\*/g, '') }); // H1-3: hover tips are plain text
      if (combo) out.push({ id: 'combo', label: combo.name || TX('combo.defaultName'), tip: combo.text || '' });
      return out;
    }
    const kw = (grp, id, prefix) => { const e = K[grp] && K[grp][id]; out.push({ id: `${prefix}:${id}`, label: e && e.label ? e.label : id, tip: (e && e.tip) || '' }); };
    if (skill) { kw('skill', skill.kind, 'skill'); const lad = lvLadder(skill.kind); if (lad && out.length) out[out.length - 1].tip += TX('skill.lvLadderTip', { ladder: lad }); }
    if (combo) {
      kw('direction', combo.direction, 'dir');
      out.push({ id: 'charge', label: `+${Math.floor(k != null ? k : baseK(combo))}`, tip: (K.charge && K.charge.tip) || '' }); // 充能 k (the when field is kept in the data, unused)
    }
    return out;
  }
  function statusChip(data, id) {
    const e = dig(data, 'keywords', 'status', id);
    return { id, label: (e && e.label) || STATUS_LABELS()[id] || id, tip: (e && e.tip) || STATUS_TIPS()[id] || '' };
  }
  // 2026-11-18 #2: the advisor boss is warded (each hit at most WARD_HP) while a summoned minion of hers stands (or the whole phase, wardPhase)
  const wardOn = (B, u) => !!(B && u && u.advisorBoss && u.hp > 0 && B.summon && B.summon.ward && (B.wardRound === B.round || (B.enemies || []).some((x) => x.summoned && x.hp > 0)))
    || dollWardOn(B, u);
  // 2026-11-19 小铃战 镜像 (用户): 小铃 in wave 2 is warded the same way (each hit at most WARD_HP) while any of her dolls stands
  // (a gone girl's doll or a padding doll; one who broke free and turned is no longer on her side). Scenario entry dollWard.
  // 2026-11-19 小铃强 玩偶弱: not in her phase 2 (she has stepped out from behind them)
  const dollWardOn = (B, u) => !!(B && u && u.dollWard && u.hp > 0 && u.xlPhase !== 2 && (B.enemies || []).some((x) => x !== u && x.hp > 0 && (x.resummoned || x.padDoll)));
  // 2026-11-19 小铃强 玩偶弱: who her pending knell lands on right now (the ally standing in the marked slot of the living line-up)
  const XL_MARK_SLOT_TEXT = true; // 2026-11-23 试玩14「标记跟着位置走，不跟人走，和文字说的不一致」: the line names the slot; false = old (her name only)
  const xlMarkTarget = (B, u) => { if (!(u && u.xlPhase === 2 && u.xlMark != null && u.hp > 0)) return null; const af = ((B && B.allies) || []).filter((x) => x.hp > 0); return af.length ? af[Math.min(u.xlMark, af.length - 1)] : null; };
  const xlMarkedIn = (B, a) => ((B && B.enemies) || []).some((e) => xlMarkTarget(B, e) === a);
  function unitStatuses(data, B, u) {
    const ids = [];
    if (u.weak > 0) ids.push('weak'); // 2026-11-14: 虚弱 / 坚韧 (护甲 is shown on the hp bar, not as a chip)
    if (u.tough > 0) ids.push('tough');
    if (B && u.burnUntil >= (B.round || 0)) ids.push(u.burnStack > 0 ? 'sear' : 'burn'); // 2026-11-19 文字修: 烈焰护符 stacks show as 焚痕 (was always 'burn') // 2026-11-16 灼烧 / 祝福
    if (B && u.blessUntil >= (B.round || 0)) ids.push('bless');
    if (Array.isArray(u.traits) && u.traits.includes('shell')) ids.push('shell');
    if (u.side === 'ally') {
      if (u.slowStart && u.acts < (u.slowStart === 2 ? 2 : 1)) ids.push('slow-start');
      if (!u.noMood && u.mood <= -2) ids.push('mood-low');
      if (u.bond === 'high') ids.push('bond-high'); else if (u.bond === 'low') ids.push('bond-low');
      if ((u.debuffs || []).length) ids.push('debuffed');
      if (u.swapSkip) ids.push('swap-skip'); // 2026-11-19 换位/暂停连做
      if (B && B.mods) for (const k of ['formation', 'luck', 'drum']) if (B.mods[k]) ids.push(k);
    } else {
      if (u.corruption) ids.push(u.corruption);
      if (u.corruption === 'vengeful' && u.grudge) ids.push('vengeful-' + u.grudge);
      if (B && B.mods && B.mods.smoke) ids.push('smoke');
      if (u.elv > 1 && u.skill && FOE_LV_KINDS[u.skill.kind]) ids.push('foe-lv' + u.elv); // 用户 2026-11-15 第 4–7 关
      for (const t of FOE_TRAIT_CHIPS) if (Array.isArray(u.traits) && u.traits.includes(t)) ids.push(t);
      if (wardOn(B, u)) ids.push('ward'); // 2026-11-18 露西安「契约庇护」: shown on her card (light-blue frame in the UI)
      if (B && B.enemyCombat === 'overtime' && (B.enemies || []).some((x) => x.advisorBoss && x.hp > 0)) ids.push('overtime'); // BOSS_NEW_SKILLS 露西安: every charge +1 while she stands
      if (B && B.luckUpEnemyRound != null && B.luckUpEnemyRound === B.round) ids.push('luckUp'); // BOSS_NEW_SKILLS 妮可塔: 幸运 +2 this round
      if (u.dazed) ids.push('daze'); // 试玩反馈 2026-11-14 晚: 附加条款 → this enemy 发呆 this round (keyword / icon 'daze')
    }
    const chips = ids.map((id) => statusChip(data, id));
    if (u.side === 'enemy' && !u.combo && chargeK(B, u) > 0) chips.push({ id: 'charge', plus: chargeK(B, u), label: TX('status.charge'), tip: u.ref === 'fairy-demon' ? TX('status.tip.chargeFairy', { k: chargeK(B, u) }) : TX('status.tip.chargeEnemy', { k: chargeK(B, u) }) });
    const sto = storeOf(B, u);
    if (sto > 0) chips.push({ id: 'store', plus: sto, label: TX('status.store', { n: sto }), tip: TX('status.tip.store', { n: sto }) });
    if (u.bell && u.hp > 0 && B) { // 2026-11-20 用户「钟要显示还剩几回合」(倒数挂铜钟上): rounds until the guardian rings it, counted from the coming round
      const g = (B.enemies || []).find((x) => x.toll && x.hp > 0), R = powRound(B);
      if (g) for (let d = 0; d <= (g.toll.every || 3); d++) if (tollDue(B, g, R + d)) {
        chips.push({ id: 'tollIn', num: d + 1, label: g.toll.noBell ? TX('status.chargeIn', { n: d + 1 }) : TX('status.tollIn', { n: d + 1 }), /* the same count as the bell's own 「还剩 N 回合」 pop: the coming round included */ tip: g.toll.noBell ? TX('status.tip.charge', { every: g.toll.every || 3, n: g.toll.n || 4, name: g.name }) : TX('status.tip.toll', { every: g.toll.every || 3, n: g.toll.n || 4, name: g.name }) });
        break;
      }
    }
    return chips;
  }
  const spreadB = (B) => (B && B.spread != null ? !!B.spread : TARGET_SPREAD && !SPREAD_URL_OFF); // 2026-11-19 伤害分摊: B.spread is set from the run (battleOps)
  function unitView(data, B, u) {
    const v = { id: u.ref, uid: u.id, side: u.side, name: u.name, role: u.role || null, hp: u.hp, maxHp: u.maxHp, atk: u.atk,
      keywords: keywordsFor(data, u.skill, u.combo, chargeK(B, u)), skillName: u.skill ? u.skill.name : null, comboName: u.combo ? u.combo.name : null,
      actionText: actionTextFor(u.side === 'enemy' && foeSplash(u) && !u.skill.splash ? Object.assign({}, u.skill, { splash: true }) : u.skill, u.atk, u.side === 'enemy', u.role, u.elv, u.side === 'enemy' && spreadB(B) ? targetRuleIn(B, u) : null, u.side === 'ally' ? u.perk : null), bonusText: bonusTextFor(u.combo, chargeK(B, u), u.side === 'enemy', chargeKeep(u)),
      statuses: unitStatuses(data, B, u), block: u.block || 0 };
    if (POWER_LIVE && B && u.hp > 0) { v.pow = powNow(data, B, u, powRound(B)); v.powBase = u.atk0 != null ? u.atk0 : u.atk; v.powParts = powParts(data, B, u, powRound(B)).map((p) => ({ label: p.label, amount: p.amount })); } // powParts: 2026-11-24 用户「威力变绿 / 变红，悬停一行一个写清楚是哪些东西加的 / 减的」 // 2026-11-20b: the card's live 威力 + what it is without buffs
    if (u.side === 'ally' || chargeDirOf(u)) Object.assign(v, { charge: u.charge || 0, chargeFull: fullOf(u), chargeDir: chargeDirOf(u), k: chargeK(B, u), chargeKeep: chargeKeep(u), store: storeOf(B, u), extra: u.extraTotal || 0 });
    if (u.side === 'enemy' && v.actionText && Array.isArray(u.traits)) { // 用户 2026-11-15: the trait is in her line too
      const d = rawAmount(u.skill.kind, u.atk, true);
      if (u.traits.includes('doubleCut') && u.skill.kind === 'strike') v.actionText = TX('skill.action.doubleCutEnemy', { foe: spreadB(B) && RULE_FOE[targetRuleIn(B, u)] ? RULE_FOE_TEXT()[targetRuleIn(B, u)] : TX('skill.target.party.leftmost'), dmg: d, dmg2: Math.max(1, d - 1) }); // 2026-11-19 伤害分摊
      if (u.traits.includes('twinShot') && u.skill.kind === 'aim') v.actionText += TX('skill.action.twinShotSuffix', { dmg: Math.max(1, d - TWIN_SHOT_CUT) });
      if (u.traits.includes('escort')) v.actionText += TX('skill.action.escortSuffix', { n: ESCORT_BLOCK });
      if (u.traits.includes('bless') && u.skill.kind === 'heal' && (u.elv || 1) >= BLESS_LV) v.actionText += TX('skill.action.blessSuffix');
    }
    // 2026-11-20 用户「单位介绍卡片上要写清楚他的攻击方式」: the toll and the bell were missing from the panel's line
    if (u.side === 'enemy' && u.toll && v.actionText) v.actionText += u.toll.noBell ? TX('skill.action.chargeSuffix', { every: u.toll.every || 3, n: u.toll.n || 4 }) : TX('skill.action.tollSuffix', { every: u.toll.every || 3, n: u.toll.n || 4 });
    if (u.side === 'enemy' && u.bell) { const g = B && (B.enemies || []).find((x) => x.toll); v.actionText = TX('skill.action.bellIdle', { every: (g && g.toll.every) || 2 }); } // 2026-11-22: the number from data (was a fixed 3)
    if (u.side === 'enemy' && u.dodgeAura && !u.bell) v.actionText = TX('skill.action.amuletIdle', { pct: Math.round(u.dodgeAura * 100) }); // 2026-11-20 L9 灰羽护符
    if (u.side === 'enemy' && u.hp > 0 && DODGE_ON && B) { const dp = dodgeOf(B, u); if (dp > 0) v.dodge = Math.round(dp * 100); } if (u.side === 'enemy' && u.hp > 0 && grazeState(u)) v.grazeOn = true; // 2026-11-23 蓝边 // 2026-11-20 L9: the dodge chance now (UI tip)
    // 2026-11-20 用户「灰羽首领的介绍 i 根本没写它的闪避特质」: an enemy's trait lines (enemies.json traitText) + her dodge chance now, for her panel
    if (u.side === 'enemy') { const def = (data.enemies || []).find((x) => x.id === u.ref), tt = (def && def.traitText) || {}; const lines = (u.traits || []).map((k) => tt[k]).filter(Boolean); if (v.dodge > 0) lines.unshift(TX('battle.dodgeNow', { pct: v.dodge })); if (lines.length) v.traitLines = lines; }
    if (u.side === 'enemy' && u.brood && v.actionText) v.actionText += (u.brood.atkEvery > 1 ? TX('skill.action.broodSuffixEvery', { n: u.brood.n, cost: u.brood.selfCost > 0 && u.brood.selfCost < 1 ? TX('skill.action.broodCostHalf') : TX('skill.action.broodCostFull'), cap: u.brood.cap, hpStep: u.brood.hpStep || 0, atkStep: u.brood.atkStep || 0, every: NUM_CN()[u.brood.atkEvery] || u.brood.atkEvery }) : TX('skill.action.broodSuffix', { n: u.brood.n, cost: u.brood.selfCost > 0 && u.brood.selfCost < 1 ? TX('skill.action.broodCostHalf') : TX('skill.action.broodCostFull'), cap: u.brood.cap, hpStep: u.brood.hpStep || 0, atkStep: u.brood.atkStep || 0 })) + (u.winOnDown ? TX('skill.action.winOnDownSuffix', { name: u.name }) : '');
    if (u.side === 'enemy' && u.wanderBack && u.wander > 0 && v.actionText) v.actionText += TX('skill.action.wanderBackSuffix', { pct: Math.round(u.wander * 100) });
    if (u.side === 'ally' && u.perk && u.perk.id === 'anvil' && u.block > 1) v.blockKeep = Math.floor(u.block / 2); // 铁砧不卸: kept at the next clear
    if (u.side === 'ally') { v.mood = u.noMood ? null : u.mood; if (isLeader(u.id)) v.isLeader = true; if (u.skill) v.skillLv = lvOf(u.skill); v.perkText = perkText(u.perk); }
    else { if (spreadB(B)) { const r = targetRuleIn(B, u); v.targetRule = r; v.targetText = foeSplash(u) ? actionTextFor(u.skill, u.atk, true, u.role, u.elv, r) : RULE_TIP()[(u.skill && u.skill.kind === 'heal' ? 'heal.' : '') + r] || ''; /* 2026-11-23 ENEMY_SPARK_SPLASH */ // 2026-11-19 伤害分摊: the rule in plain words (the tip)
        const k0 = v.keywords.find((k) => /^skill:/.test(k.id)); if (k0 && v.targetText) k0.tip = v.targetText; } // an enemy's skill chip explains who IT hits (the class tips speak of our side)
      v.faction = u.faction; v.boss = !!(u.advisorBoss || u.boss); if (u.padded) v.padded = true; if (u.elv > 1 && u.skill && FOE_LV_KINDS[u.skill.kind]) v.skillLv = u.elv; if (u.openBlock > 0) v.openBlock = u.openBlock; if (u.advisorBoss) { v.advisorBoss = true; v.advisorId = u.ref; if (wardOn(B, u)) v.ward = true; } }
    if (u.waveBoss) v.waveBoss = true;
    if (u.champion) v.champion = true;
    if (u.resummoned) v.resummoned = true;
    if (u.mirror) v.mirror = true; // 2026-11-19 小铃战 镜像玩偶
    if (u.dollWard && dollWardOn(B, u)) v.ward = true; // her dolls shield her (light-blue frame, as 露西安's 契约庇护)
    if (u.xlPhase) v.xlPhase = u.xlPhase; // 2026-11-19 小铃强 玩偶弱: 1 behind the dolls · 2 stepped forward
    if (u.side === 'ally' && u.hp > 0 && xlMarkedIn(B, u)) v.xlMarked = true; // 2026-11-19 小铃强 玩偶弱: her knell is coming here next round
    if (u.glass > 0) v.glass = u.glass;
    if (LUCK_STAT) { const L = clamp((u.luck || 0) + ((u.side === 'ally' && B && B.luckUpPending) ? (B.luckUpN || LUCK_UP_ADD) : (u.side === 'enemy' && B && B.luckUpEnemyRound != null && B.luckUpEnemyRound === B.round) ? LUCK_UP_ADD : 0), LUCK_MIN, LUCK_MAX); if (L > 0 || (DOOM_ON && L < 0)) v.luck = L; } // 2026-11-20 幸运: on the card only when > 0 (+ 妮可塔's +2 for the round to come)
    if (u.blessed) v.blessed = u.blessed.slice();
    if (u.turned) { v.turned = true; v.originalSide = 'enemy'; }
    if (u.wokeMember) v.woke = true; // 2026-11-21: the L11 girl who woke as herself — drawn as one of ours (威力 chip and all)
    if (u.corruption) v.corruption = u.corruption;
    if (u.grudge) v.grudge = u.grudge;
    if (u.side === 'ally' && u.role === 'adc' && u.skill && u.skill.kind === 'aim') v.aim = u.aimLock || null; // 猎人锁定
    if (u.side === 'ally' && u.skill && u.skill.kind === 'heal' && !coat(u)) { // 2026-11-20 牧师治疗: her picks + how many shares + the rule (tip)
      if (HEAL_PICK) { v.healPick = (u.healPick || []).filter((id) => ((B && B.allies) || []).some((x) => x.id === id && x.hp > 0)); /* 2026-11-20 用户「牧师倒下报错点不了继续」: finishBattle builds the report with B = null */ v.healN = HEAL_FOCUS ? 1 : HEAL_LV[lvOf(u.skill) - 1].n; }
      if (HEAL_TRIAGE) v.healRule = TX('skill.healRule.triage');
    }
    return v;
  }

  const statRow = (u) => ({ uid: u.id, id: u.ref, name: u.name, damage: u.damage || 0, healed: u.healing || 0, taken: u.taken || 0, kills: u.kills || 0, maxChain: u.maxChain || 0, extra: u.extraTotal || 0, actions: u.actions || 0 });
  // ---------- battle (§2.3 interactive, one round per pause) ----------
  const KIND_VERB = lazy(() => ({ guard: TX('skill.verb.attack'), aim: TX('skill.verb.aim'), strike: TX('skill.verb.attack'), backstab: TX('skill.verb.backstab'), heal: TX('skill.verb.attack'), spark: TX('skill.verb.spark') }));
  const SIDE_LABEL = lazy(() => ({ ally: TX('battle.side.ally'), enemy: TX('battle.side.enemy') }));
  const FOE_INTRO_MAX = 2, PRE_OTHER_MAX = 3; // feedback-1112 #23: before round 1 — foeIntro ≤2, foeIntro + scout + rally ≤3, enemies ≤3
  // 2026-11-16 (用户拍板, ISSUES-2026-11-16 一): 狂热 removed from the whole game; instead every acting enemy gets 威力 +1 per round
  // of its wave (round r of the wave: +(r−1), ENEMY_RAMP) and a battle lasts at most 10 rounds — not done by then = a defeat.
  const HARD_ROUND_CAP = 20; // 2026-11-22h 用户「10 回合判输不要，改成 20 回合」(was 10; 2026-11-16: 10 rounds, then a defeat; v2.1 §C: 30)
  const FRENZY_FROM = 5; // 2026-11-16: no longer used (狂热 removed) — kept for reference: ×2 from this round of the wave, then ×4, …
  const FRENZY_ON = false; // 2026-11-16: 狂热 off for good
  const frenzyMult = (round) => (FRENZY_ON && round >= FRENZY_FROM ? Math.pow(2, Math.min(30, round - FRENZY_FROM + 1)) : 1);
  const ENEMY_RAMP = 1; // 2026-11-16: per round of the wave, per acting enemy (replaces 狂热)
  // 2026-11-20b 用户「第一回合 威力 +2，卡上的威力数字不变」: the card's 威力 = the CURRENT effective power for round r — u.atk plus the
  // bonuses that do not depend on the target (mood 高昂, 团长的怀表 on round 1, 圣泉 / 鹰眼 / 刃风 stacks, 盾爆, 祝福, the 危机领袖 aura,
  // the enemies' per-round ramp), minus 虚弱 (never below 1). Mirrors atkBonuses() inside battleOps (old-master / formation / chain /
  // frenzy depend on the target or the action and stay out). POWER_LIVE false = no u.pow in the view and no 'pow' events (backup).
  const POWER_LIVE = true;
  // 2026-11-20 POW_SOURCE: powNow split into named parts (the same sum: atk + Σ parts = powNow) — a 'pow' event says which
  // parts changed, so the card's float names its source (「高昂 威力 +1」), never a bare number
  function powParts(data, B, u, r) {
    const out = [], add = (ic, label, amount) => { if (amount) out.push({ ic, label, amount }); };
    if (u.side === 'ally') {
      if (!u.noMood && u.mood >= 2) add('moodHigh', TX('battle.bonus.moodHigh'), 1);
      if (hasTok(u, 'opener') && r === 1) add('pocketWatch', TX('battle.bonus.pocketWatch'), 2);
      if (u.springAtk > 0) add('holySpring', TX('battle.bonus.holySpring'), u.springAtk);
      if (u.hawkAtk > 0) add('hawkEye', TX('battle.bonus.hawkEye'), u.hawkAtk);
      if (u.stormAtk > 0) add('bladeStorm', TX('battle.bonus.bladeStorm'), u.stormAtk);
      if (u.luckCharmAtk > 0) add('luckCharm', TX('battle.bonus.luckCharm'), u.luckCharmAtk);
      if (u.chargeCharmAtk > 0) add('chargeCharm', TX('battle.bonus.chargeCharm'), u.chargeCharmAtk);
      { const sw = shieldWallOf(u); if (sw > 0) add('shieldWall', hasWall(u) ? TX('battle.bonus.shieldWall') : TX('battle.bonus.guardSlam'), sw); }
      if (B && B.allies && B.allies.some((x) => x.id !== u.id && x.hp > 0 && x.hp * 2 <= x.maxHp && hasTrait(data, x.ref || x.id, 'crisis-leader'))) add('crisisLeader', TX('battle.bonus.crisisLeader'), 1);
      if (u.blessUntil >= r) add('bless', TX('battle.bonus.bless'), BLESS_ADD);
      if (hornOn(B, u, r)) add('warHorn', guildRelicName(data, 'war-horn'), RELIC_HORN); // 2026-11-22 遗物 号角
    } else if (u.side === 'enemy' && !u.turned && B) {
      const rr = enemyRamp(B, u, r);
      add('ramp', TX('battle.bonus.ramp', { n: rr }), rr);
      if (u.blessUntil >= r) add('bless', TX('battle.bonus.bless'), BLESS_ADD); // 2026-11-20 enemy 祝福 (L6 priest)
    }
    const full = (u.atk || 0) + out.reduce((s, p) => s + p.amount, 0), now = powNow(data, B, u, r);
    add('weak', TX('status.weak'), now - full); // 虚弱 (never below 1)
    return out;
  }
  // 2026-11-21 用户 奥德丽战「取消每回合威力 +1，但奥德丽本身会加威力」: B.rampBossOnly → only the advisor boss ramps (IRON_L10, scenario rampBossOnlyFor)
  // 2026-11-21 用户「前三关敌人不加威力」: no per-round 威力 ramp before ENEMY_RAMP_FROM_LV (1 = the old: every level)
  const ENEMY_RAMP_FROM_LV = 4;
  const BROOD_NO_RAMP = true; // 2026-11-23: L7 small slimes take no per-round ramp (false = the old: born with the battle's ramp)
  function enemyRamp(B, u, r) {
    if (B.rampBossOnly && !u.advisorBoss) return 0;
    if (u.noRamp) return 0; // scenario noRamp (L7 母体)
    if (BROOD_NO_RAMP && u.broodOf) return 0; // 2026-11-23 试玩 18 bug: a small slime born in round 7 came out with 越打越凶 +6 — her batches already grow (atkStep)
    if ((B.level || 0) < ENEMY_RAMP_FROM_LV) return 0;
    return (u.rampStep > 0 ? u.rampStep : ENEMY_RAMP) * Math.floor(Math.max(0, (r || 1) - (B.waveStart || 1)) / (u.rampEvery > 1 ? u.rampEvery : 1)) + (u.enrageRound ? Math.max(0, u.enrageRamp - ENEMY_RAMP) * Math.max(0, (r || 1) - u.enrageRound) : 0);
  }
  function powNow(data, B, u, r) {
    let a = u.atk || 0;
    if (u.side === 'ally') {
      if (!u.noMood && u.mood >= 2) a += 1;
      if (hasTok(u, 'opener') && r === 1) a += 2;
      a += (u.springAtk > 0 ? u.springAtk : 0) + (u.hawkAtk > 0 ? u.hawkAtk : 0) + (u.stormAtk > 0 ? u.stormAtk : 0) + (u.luckCharmAtk > 0 ? u.luckCharmAtk : 0) + (u.chargeCharmAtk > 0 ? u.chargeCharmAtk : 0) + shieldWallOf(u);
      if (B && B.allies && B.allies.some((x) => x.id !== u.id && x.hp > 0 && x.hp * 2 <= x.maxHp && hasTrait(data, x.ref || x.id, 'crisis-leader'))) a += 1;
      if (u.blessUntil >= r) a += BLESS_ADD;
      if (hornOn(B, u, r)) a += RELIC_HORN; // 2026-11-22 遗物 号角
    } else if (u.side === 'enemy' && !u.turned && B) {
      a += enemyRamp(B, u, r);
      if (u.blessUntil >= r) a += BLESS_ADD; // 2026-11-20 enemy 祝福
    }
    return Math.max(Math.min(1, a), a - (u.weak || 0));
  }
  const powRound = (B) => (B ? (B.opening || B.over ? B.round : B.round + 1) || 1 : 1); // the round the pause is before
  const HEAL_CAP_X = Infinity; // 2026-11-22i 用户「每人一场最多被治疗 2 倍生命上限，不要这个」: no cap (was 2 — total healing one unit can receive in a battle = 2 × maxHp)
  // DESIGN-skill-level: our hunters' aim = atk (the old +1 became the crit); enemy archers keep atk + 1
  // the main hit for 威力 a (enemy archers keep +1; an enemy spark — the fairy's bell — keeps the old flat 1/2 to everyone)
  // 2026-11-20 用户「就扣威力啊，太强了就削威力，否则法师的威力还有什么意义」(ENEMY_SPARK_FULL): an enemy spark (打全体) hits every one
  // of ours for her full 威力; false = old: a flat 2 (威力 ≥ 4) or 1, whatever her 威力
  const ENEMY_SPARK_FULL = true;
  const rawAmount0 = (kind, a, enemy) => (kind === 'aim' ? a + (enemy ? 1 : 0) : kind === 'backstab' ? (enemy ? Math.max(1, a - 1) : a) : kind === 'spark' ? (enemy ? (ENEMY_SPARK_FULL ? a : a >= 4 ? 2 : 1) : a) : a);
  const rawAmount = rawAmount0;

  // 试玩反馈 2026-11-15: a member's skill text is copied at hire time; show the current data's text (rules change, saves don't)
  function freshSkill(data, run, id, sk0) {
    const sk = clone(sk0);
    if (!sk) return sk;
    const src = isLeader(id) ? ((((data.leader && data.leader.classes) || []).find((x) => x.id === (run.leader && run.leader.class)) || {}).skill)
      : (((data.candidates || []).find((c) => c.id === id) || {}).skill);
    if (src && src.kind === sk.kind && src.text) sk.text = src.text;
    if (sk.text) sk.text = skillTextAtLv(sk.kind, sk.text, lvOf(sk), perkOf(data, run, id)); // 2026-11-16 用户「改一下技能说明」: the data text is the Lv1 text — show her current level's numbers
    return sk;
  }
  // the bold level number in a skill text → the number at Lv lv (波及 N 个 · 连击 ×N · 治疗 ×N · 暴击 N%): the data text is the
  // Lv1 text, so the Lv1 phrase (built from the same TX template) is swapped for this level's — no Han in code (i18n test).
  function skillTextAtLv(kind, text, lv, perk) {
    const i = clamp(lv, 1, SKILL_LV_MAX) - 1, sw = (a, b) => (a && text.indexOf(a) >= 0 ? text.replace(a, b) : text);
    if (kind === 'spark') return sw(TX('skill.text.sparkN', { n: SPARK_TEXT_BASE }), SPARK_TARGETS[i] === Infinity ? TX('skill.text.sparkAll') : SPARK_TARGETS[i] === 1 ? TX('skill.text.sparkOne') : TX('skill.text.sparkN', { n: SPARK_TARGETS[i] }));
    if (kind === 'backstab') return sw(TX('skill.text.backstabN', { n: BACKSTAB_HITS[0] }), TX('skill.text.backstabN', { n: BACKSTAB_HITS[i] }));
    if (kind === 'heal') return sw(TX('skill.text.healN', { n: HEAL_LV[0].n }), TX('skill.text.healN', { n: HEAL_LV[i].n }));
    if (kind === 'aim') return sw(TX('skill.text.aim', { pct: Math.round(CRIT_RATE[0] * 100), x: CRIT_X_LV[0] }), TX('skill.text.aim', { pct: Math.round(CRIT_RATE[i] * 100), x: CRIT_X_LV[i] }) + (i + 1 >= CRIT_PIERCE_LV ? TX('skill.text.pierceTag') : ''));
    if (kind === 'guard') {
      const g = guardLvFor(perk, i); text = sw(TX('skill.text.guard', { self: GUARD_LV[0].self * GUARD_SELF_X }), TX('skill.text.guard', { self: g.self * GUARD_SELF_X }) + (g.plus ? TX('skill.text.guardPlus', { n: g.plus }) : ''));
      text = g.cover ? text + TX('skill.text.coverTag', { n: g.cover }) : text;
      if (LV4_KEEP_SHOWN && GUARD_SLAM_LV4 && GUARD_KEEP_LV3 && i >= 2) text += TX('skill.text.guardKeepTag'); // 2026-11-24 试玩: the card never said 护甲不清 / 伤害 + 当前护甲
      if (LV4_KEEP_SHOWN && GUARD_SLAM_LV4 && i >= 3) text += TX('skill.text.guardSlamTag');
      return text;
    }
    return text;
  }
  function allyUnit(data, run, id, idx) {
    const m = run.members[id];
    const c = cand(data, id);
    const u = { id, ref: id, name: nameOf(data, id), side: 'ally', role: m.role || c.role || null, maxHp: m.maxHp, hp: clamp(hpOf(m), 1, m.maxHp), atk: m.atk, skill: freshSkill(data, run, id, m.skill),
      mood: m.mood || 0, bond: m.bond || null, slot: idx, slowStart: m.statuses.includes('slow-start') ? ((m.slowX2 && !LEADER_SLOW_ONCE) || m.slowUp2 ? 2 : true) : false, acts: 0, block: 0, damage: 0, healing: 0, debuffs: [], taken: 0, kills: 0, maxChain: 0, actions: 0, charge: OPEN_CHARGE, extraRound: 0, extraTotal: 0 }; // 充能: every battle starts at OPEN_CHARGE
    if (moodless(run, id)) u.noMood = true; // 2026-11-20 团长心情: with LEADER_MOOD she carries her mood into battle
    if (run.blessing && run.blessing.fx && run.blessing.fx.type === 'teamCharge') u.fullAt = CHARGE_FULL + (run.blessing.fx.delta || 0); // 2026-11-18 小铃的祝福
    if (m.chargeSlow > 0) u.fullAt = fullOf(u) + m.chargeSlow; // 2026-11-19 诅咒维度「面具印记」: slower charge
    const pk = perkOf(data, run, id);
    if (pk) u.perk = clone(pk); // DESIGN-skill-level §2
    u.tokens = (m.tokens || []).slice();
    if (LUCK_STAT) { const L = luckBase(data, id, m); if (L) u.luck = L; } // 2026-11-20 幸运
    if (LUCK_STAT && guildHas(run, 'dice-cup')) u.luck = clamp((u.luck || 0) + RELIC_LUCK, LUCK_STORE_MIN != null ? LUCK_STORE_MIN : LUCK_MIN, LUCK_MAX); // 2026-11-22 遗物 幸运骰盅
    // 2026-11-21 用户「团长 +3 或者两边 +1」: the leader's combo comes from the class data now (a save keeps the copy made at the start, so old runs would stay +4)
    const lcc = isLeader(id) && LEADER_COMBO_LIVE ? ((((data.leader && data.leader.classes) || []).find((x) => x.id === (run.leader && run.leader.class)) || {}).combo) : null;
    const combo = lcc || m.combo || c.combo;
    if (combo) u.combo = clone(ringCombo(combo, m)); // 2026-11-21 转向指环 (m carries tokens + ringSide)
    // debuff cards still on her (for holy water): stat deltas from the run
    for (const cid of m.debuffsReceived || []) {
      const card = (data.cards.debuffs || []).find((x) => x.id === cid);
      const eff = card && card.effect;
      if (eff && eff.type === 'stat') u.debuffs.push({ card: cid, stat: eff.stat, delta: eff.delta });
    }
    return u;
  }
  // holy water: undo debuff stat deltas (battle only), clear slow-start, lift a bad mood to 0
  function cleanse(u) {
    for (const d of u.debuffs || []) {
      if (d.stat === 'atk') u.atk -= d.delta;
      else if (d.stat === 'maxHp') { u.maxHp -= d.delta; }
    }
    u.debuffs = [];
    u.slowStart = false;
    if (!u.noMood && u.mood < 0) u.mood = 0;
  }

  function initBattle(data, run) {
    const cfg = levelCfg(data, run.level) || fail('no current level');
    if (mirrorOn(cfg)) mirrorBlessOrder(data, run); // 2026-11-19 小铃战: which unpicked blessing goes to which wave (seeded)
    const waves = buildWaves(data, run, cfg);
    const keepEnemyBlock = IRON_L10 && Array.isArray(cfg.enemyKeepBlockFor) && cfg.enemyKeepBlockFor.includes(run.advisor);
    const rampBossOnly = IRON_L10 && Array.isArray(cfg.rampBossOnlyFor) && cfg.rampBossOnlyFor.includes(run.advisor);
    const B = { keepEnemyBlock, rampBossOnly, level: run.level, round: 0, wi: -1, needWave: true, waveCount: waves.length, waves,
      allies: run.party.map((id, idx) => allyUnit(data, run, id, idx)), enemies: [], log: [], lastRound: [],
      chainSeq: 0, mods: {}, enemyCombat: null, clauseUsed: false, advisorSkillUsed: false, over: false, win: false, pre: [], spread: spreadOn(run) }; // 2026-11-19 伤害分摊: spread
    if (run.wounded) { // §4.3: followed the bell → every ally starts at ⌈70%⌉
      run.wounded = false;
      for (const u of B.allies) u.hp = Math.min(u.hp, Math.ceil(u.maxHp * WOUND_PCT)); // v2.3: hp carries over, the wound only lowers it
      B.pre.push({ kind: 'wounded', allies: B.allies.map((u) => ({ uid: u.id, hp: u.hp, maxHp: u.maxHp })), text: TX('battle.wounded') });
    }
    if (leaderHas(run, 'veteran') && veteranArmor(run) > 0) { // 2026-11-19 伤害分摊 §5: 退伍老兵 = every ally +VETERAN_TEAM_ARMOR 护甲 in round 1
      const L = B.allies.find((u) => isLeader(u.id));
      for (const u of B.allies) u.openBlock = (u.openBlock || 0) + veteranArmor(run);
      if (L) L.openVeteran = true; else if (B.allies[0]) B.allies[0].openVeteran = true;
      B.veteranTeam = veteranArmor(run);
    } else if (leaderHas(run, 'veteran')) { // 2026-11-14 护甲 (old, VETERAN_TEAM_ARMOR 0): 退伍老兵 = +1 护甲 at the start of round 1 (after the ally clear, so it covers round 1)
      const L = B.allies.find((u) => isLeader(u.id));
      if (L) { L.openBlock = (L.openBlock || 0) + VETERAN_BLOCK; L.openVeteran = true; }
    }
    // 2026-11-14 满血休息: a member who rested at full hp carries +1 护甲 into this battle's round 1 (then it is spent)
    for (const u of B.allies) { const m = run.members[u.id]; if (m && m.restBlock > 0) { u.openBlock = (u.openBlock || 0) + m.restBlock; m.restBlock = 0; } }
    if (OPEN_SHIELD > 0) for (const u of B.allies) if (hasTok(u, 'openShield')) u.openBlock = (u.openBlock || 0) + OPEN_SHIELD; // 2026-11-22 开场护盾: 护甲 +8 in round 1
    B.guildRelics = RELICS_ON ? (run.guildRelics || []).slice() : []; // 2026-11-22 遗物
    if (bRelic(B, 'war-banner')) { // 战旗: every ally starts with 充能 +RELIC_BANNER (already on the cards when the battle opens)
      for (const u of B.allies) u.charge = (u.charge || 0) + RELIC_BANNER;
      B.pre.push({ kind: 'guildRelic', relic: 'war-banner', n: RELIC_BANNER, text: TX('battle.relic.banner', { relic: guildRelicName(data, 'war-banner'), n: RELIC_BANNER }) });
    }
    if (bRelic(B, 'guild-crest')) for (const u of B.allies) u.openCrest = RELIC_CREST; // 公会徽记: 护甲 at our round-1 phase start (startPhaseBlock)
    const fk = advisorFlow(data, run); // G2 #8: the advisor's team passive (ward is gone since 2026-11-14 护甲)
    if (fk === 'lucky') B.lucky = true;
    // 2026-11-14: the first sacrificed girl comes back (L8) — the leader talks to her; if he wrote her name, he freezes in round 1
    const rf = run.returned && run.returned.first, rs = rf && (run.sacrificed || []).find((x) => x.id === rf);
    if (rs && waves[0] && waves[0].units.some((u) => u.returned && u.ref === rf)) {
      B.l8 = { id: rf, mode: rs.mode === 'name' ? 'named' : 'taken' };
      const L = B.allies.find((u) => isLeader(u.id));
      if (L && B.l8.mode === 'named') L.regret = 1; // round 1 only
      if (L && B.l8.mode === 'named' && DEBT_ONE_DAZE) B.debtDazed = true; // 2026-11-22 试玩 B 第 8 关：团长懊悔 + 怨气发呆 + 诅咒发呆，第 1 回合只剩一人出手 → the leader's freeze uses up the battle's one grudge daze
    }
    if (run.level === 9) for (const id of run.party) if (hasTrait(data, id, 'old-master')) {
      B.pre.push(lineEvent(data, run, candLine(data, id, 'oldMaster') || cand(data, id).traitReveal || TX('trait.oldMasterSpotted', { name: nameOf(data, id) }), { name: nameOf(data, id) }, id, { id, key: 'oldMaster' }));
    }
    return B;
  }

  // All battle rules, closing over the JSON battle state B. Returns { round(preEvents) }.
  function battleOps(data, run, B) {
    B.spread = spreadOn(run); // 2026-11-19 伤害分摊 (unitView reads it)
    const maxRounds = Math.min(data.scenario.maxRounds || HARD_ROUND_CAP, HARD_ROUND_CAP);
    const advA = advisorData(data, run);
    let R = [];
    // 2026-11-20 阵容同步: 每一回合（open / round / cheat）开始时记下双方的【开始阵容】（顺序 + 画卡要的字段），跟着 view 给画面
    // （battle.roundStart）。画面先按它画卡，再按 lastRound 的事件一步步把阵容推成结束阵容（ui/round-plan.js applyLineup）。
    const snapStart = () => { B.roundStart = { allies: B.allies.map((u) => unitView(data, B, u)), enemies: B.enemies.map((u) => unitView(data, B, u)) }; };
    // 2026-11-19 用户亲测 流程: B.quiet (L11 last wave) drops every spoken line but the few in QUIET_KEEP
    const quietDrop = (e) => !!(B.quiet && e && (e.kind === 'line' || e.kind === 'flashback') && !QUIET_KEEP[e.key]);
    const push = (e) => { if (quietDrop(e)) return; B.log.push(e); R.push(e); };
    const pending = []; // entries produced inside hit(), flushed after the action entry
    const alive = (arr) => arr.filter((u) => u.hp > 0);
    const crisisOn = () => B.allies.find((u) => u.hp > 0 && u.hp * 2 <= u.maxHp && hasTrait(data, u.ref || u.id, 'crisis-leader'));
    const slotOf = (u) => (u.side === 'ally' ? B.allies : B.enemies).indexOf(u);
    const enemyFormation = (u) => u.side === 'enemy' && B.enemyCombat === 'formation' && slotOf(u) < 2;
    const v2 = (id, path) => dig(linesV2(data), 'returns', id, ...path);
    const DOLL_LINE_NAME = true; // false = old (a mirror doll's lines carry the girl's own name)
    function v2Lines(u, path, extra) {
      return linesFor(run, v2(u.ref, path), path[path.length - 1])
        .map((raw) => lineEvent(data, run, raw, { name: u.name }, u.ref, Object.assign({ id: u.ref, uid: u.id, key: path.join('.') }, extra || {})))
        .map((e) => (DOLL_LINE_NAME && u.mirror && e.name && u.name ? Object.assign(e, { name: u.name }) : e)); // 2026-11-23 试玩14: a doll's line says 「镜·琪琪」, not our 琪琪
    }
    function v2Line(u, path, extra) {
      const ls = v2Lines(u, path, extra);
      ls.forEach(push);
      return ls.length > 0;
    }

    // 2026-11-20 起作用时才说: a hidden trait that just acted in battle → one narrator line in this battle's log, after the action
    // entry (pending). REVEAL_ON_EFFECT false = the old silent mark.
    function fireInBattle(u, trait) {
      const tmp = [];
      const r = reveal(data, run, tmp, u.id, trait);
      if (r && REVEAL_ON_EFFECT) pending.push({ kind: 'line', key: 'traitFired', speaker: 'narrator', name: '', expr: null, round: B.round, uid: u.id, id: u.id, trait, label: r.label, text: r.text });
    }
    function atkBonuses(u, target) {
      const out = [];
      if (u.side === 'ally') {
        if (!u.noMood && u.mood >= 2) out.push({ from: u.id, ic: 'moodHigh', label: TX('battle.bonus.moodHigh'), amount: 1 });
        if (hasTok(u, 'opener') && B.round === 1) out.push({ from: u.id, ic: 'pocketWatch', label: TX('battle.bonus.pocketWatch'), amount: 2 }); // 信物 团长的怀表
        if (u.springAtk > 0) out.push({ from: u.springFrom || u.id, ic: 'holySpring', label: TX('battle.bonus.holySpring'), amount: u.springAtk }); // 2026-11-17 爆发实验 牧师供能流: stacked 祝福 (this battle)
        if (u.hawkAtk > 0) out.push({ from: u.id, ic: 'hawkEye', label: TX('battle.bonus.hawkEye'), amount: u.hawkAtk }); // 2026-11-17 爆发实验 猎人暴击流
        if (u.stormAtk > 0) out.push({ from: u.id, ic: 'bladeStorm', label: TX('battle.bonus.bladeStorm'), amount: u.stormAtk });
        if (u.luckCharmAtk > 0) out.push({ from: u.id, ic: 'luckCharm', label: TX('battle.bonus.luckCharm'), amount: u.luckCharmAtk }); // 2026-11-22 幸运护符
        if (u.chargeCharmAtk > 0) out.push({ from: u.id, ic: 'chargeCharm', label: TX('battle.bonus.chargeCharm'), amount: u.chargeCharmAtk }); // 2026-11-22 充能护符 // 刃风护符: +1 per hit so far this battle (用户 2026-11-16「这场战斗一直有效」)
        { const sw = shieldWallOf(u); if (sw > 0) out.push({ from: u.id, ic: 'shieldWall', label: hasWall(u) ? TX('battle.bonus.shieldWall') : TX('battle.bonus.guardSlam'), amount: sw }); } // 2026-11-17 爆发实验 盾爆流: 威力 + her current 护甲
        const cl = crisisOn();
        if (cl && cl.id !== u.id) { out.push({ from: cl.id, ic: 'crisisLeader', label: TX('battle.bonus.crisisLeader'), amount: 1 }); fireInBattle(cl, 'crisis-leader'); }
        if (target && target.faction === 'bandit' && hasTrait(data, u.ref || u.id, 'old-master')) { out.push({ from: u.id, ic: 'oldMaster', label: TX('battle.bonus.oldMaster'), amount: 1 }); fireInBattle(u, 'old-master'); }
        if (u.blessUntil >= B.round) out.push({ from: u.blessFrom || u.id, ic: 'bless', label: TX('battle.bonus.bless'), amount: BLESS_ADD }); // 2026-11-16 牧师 Lv3+ 祝福
        if (hornOn(B, u, B.round)) out.push({ from: u.id, ic: 'warHorn', label: guildRelicName(data, 'war-horn'), amount: RELIC_HORN }); // 2026-11-22 遗物 号角
      } else if (enemyFormation(u)) {
        const cb = advA && bossCombatOf(advA);
        out.push({ from: 'advisor', ic: 'formation', label: (cb && cb.name) || TX('skill.formation'), amount: 1 });
      }
      if (u.side === 'enemy' && !u.turned) { // 2026-11-16 (replaces 狂热): 威力 +1 per round of this wave, from its 2nd round
        const rr = enemyRamp(B, u, B.round); // 上强度 (enrageBoss) · rampBossOnly
        if (rr > 0) out.push({ from: u.id, ic: 'ramp', label: TX('battle.bonus.ramp', { n: rr }), amount: rr });
        if (u.blessUntil >= B.round) out.push({ from: u.blessFrom || u.id, ic: 'bless', label: TX('battle.bonus.bless'), amount: BLESS_ADD }); // 2026-11-20 enemy 祝福
      }
      return out;
    }
    const sum = (bs) => bs.reduce((s, b) => s + b.amount, 0);
    // ---- 2026-11-14 护甲 (block) ----
    // src = { name, skill }: who / what gave it — 试玩反馈 2026-11-14 晚 #14: the log says 「伊芙【盾击】：护甲 +2」
    function gainBlock(t, n, from, later, src) { // later: inside an action — the event follows the action entry
      if (!(n > 0) || !t || t.hp <= 0) return 0;
      n = Math.min(n, Math.max(0, BLOCK_CAP - (t.block || 0))); if (!(n > 0)) return 0; // 2026-11-17 用户「甲最多叠到 999」
      t.block = (t.block || 0) + n;
      if (from && t.side === 'ally') { const bf = t.blockFrom || (t.blockFrom = {}); bf[from] = (bf[from] || 0) + n; } // @stats
      const e = { kind: 'block', round: B.round, side: t.side, uid: t.id, id: t.ref, amount: n, total: t.block, from: from || null,
        text: !src ? TX('battle.blockGain', { name: t.name, n }) : src.name === t.name || !src.name ? TX('battle.blockGainSelf', { name: t.name, skill: src.skill, n })
          : TX('battle.blockGainBy', { src: src.name, skill: src.skill, name: t.name, n }) };
      if (src) e.source = src.skill;
      if (later) pending.push(e); else push(e);
      return n;
    }
    function dropBlock(t) { if (t && t.block > 0) { t.block = 0; t.blockFrom = null; } }
    // her block absorbs up to dmg; returns what it took (credited to whoever gave the block, oldest share first)
    function absorb(t, dmg) {
      const a = Math.min(t.block || 0, dmg);
      if (!(a > 0)) return 0;
      t.block -= a;
      if (t.side === 'ally') creditBlock(t, a); // @stats
      return a;
    }
    // @stats: credit absorbed block to whoever gave it (oldest share first), read only by the credits
    function creditBlock(t, a) {
      let left = a;
      const bf = t.blockFrom || {};
      for (const k of Object.keys(bf)) { const x = Math.min(bf[k], left); if (x > 0) { tallyBlock(B, k, x); bf[k] -= x; left -= x; } if (!(bf[k] > 0)) delete bf[k]; }
      if (left > 0) tallyBlock(B, t.id, left);
    }
    // 伊芙「挺身」: an ally behind a living Eve is hit through Eve's block first; Eve loses no hp
    const shieldOf = (t) => (t.side !== 'ally' ? null : B.allies.find((g) => g !== t && g.hp > 0 && (g.block || 0) > 0 && g.perk && g.perk.id === 'stepIn' && B.allies.indexOf(g) < B.allies.indexOf(t)) || null);
    // tools/ref-paths 理论值 (opt-in, run.expect; off in play): one hit's EXPECTED outcome instead of a roll. crit may be
    // { p, x } (a chance of ×x); w = the chance this hit lands on t at all (a random target spread over everyone). Each branch
    // (crit or not) is worked out on the current block / hp, then hp and block loss are mixed by their chances — fractions kept.
    function expectHit(u, t, amount, crit, pierceOk, w, tr) {
      let wt = w == null ? 1 : w;
      if (u.side === 'enemy' && B.mods.smoke) wt *= 1 - SMOKE_MISS; // 烟雾弹: the miss chance, not a roll
      const cr = crit && typeof crit === 'object' ? crit : null;
      const cx0 = crit && !cr ? (typeof crit === 'number' ? crit : CRIT_X) : 1;
      const branches = cr ? [{ p: 1 - Math.min(1, cr.p), cx: 1, pierce: false }, { p: Math.min(1, cr.p), cx: cr.x, pierce: !!pierceOk }] : [{ p: 1, cx: cx0, pierce: !!crit && !!pierceOk }];
      const eve = shieldOf(t);
      let hp = 0, ea = 0, ta = 0;
      for (const b of branches) {
        if (!(b.p > 0)) continue;
        let dmg = (b.cx === 1 ? amount : Math.floor(amount * b.cx)) * (B.mult || 1);
        if (t.tough > 0 && dmg > 0) dmg = Math.max(0, dmg - t.tough);
        let e1 = 0, t1 = 0;
        if (dmg > 0 && !b.pierce && eve) { e1 = Math.min(eve.block || 0, dmg); dmg -= e1; }
        if (dmg > 0 && !b.pierce) { t1 = Math.min(t.block || 0, dmg); dmg -= t1; }
        if (amount > 0 && !(e1 + t1)) dmg = Math.max(MIN_DAMAGE, dmg);
        hp += b.p * Math.min(dmg, t.hp); ea += b.p * e1; ta += b.p * t1;
      }
      if (cr || cx0 !== 1) tr.critX = cr ? 1 - Math.min(1, cr.p) + Math.min(1, cr.p) * cr.x : cx0;
      tr.expect = wt;
      let blocked = 0;
      if (eve && ea * wt > 0) { const a = absorb(eve, ea * wt); blocked += a; tr.shieldBy = eve.id; tr.shieldAmt = a; }
      if (ta * wt > 0) { const a = absorb(t, ta * wt); blocked += a; if (a > 0 && t.perk && t.perk.id === 'dent') t.dents = (t.dents || 0) + wt; }
      if (blocked > 0) { tr.blocked = blocked; tr.blockAfter = t.block || 0; if (t.glassUp) tr.glass = true; } // 2026-11-23 试玩14: the bottle took it (a crit does not pierce it)
      return hp * wt;
    }
    // 2026-11-20 幸运 (LUCK_STAT): her 幸运 now (base + 妮可塔「好运当头」 this round), 0..LUCK_MAX
    function luckNow(u) {
      if (!LUCK_STAT || !u) return 0;
      return clamp((u.luck || 0) + ((u.side === 'ally' && B.luckUpRound != null && B.luckUpRound === B.round) ? (B.luckUpN || LUCK_UP_ADD)
        : (u.side === 'enemy' && B.luckUpEnemyRound != null && B.luckUpEnemyRound === B.round) ? LUCK_UP_ADD : 0), LUCK_MIN, LUCK_MAX); // + BOSS_NEW_SKILLS 妮可塔 boss: the enemies' round
    }
    // one d6 per action (hashRand on the seed — the run rng is never touched); roll <= 幸运 → this action's damage hits ×LUCK_X
    function luckRoll(u, seq) {
      const L = luckNow(u);
      if (!L) return false;
      if (L < 0) { // 2026-11-22 厄运
        if (run.expect) { u.luckySeq = seq; u.luckyExp = 1 - (1 - DOOM_X) * Math.min(6, -L) / 6; u.luckRoll = null; return false; }
        const d0 = 1 + Math.floor(hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, u.side === 'ally' ? 1 : 2, 19) * 6);
        u.luckRoll = d0;
        if (d0 <= -L) u.doomSeq = seq;
        return false;
      }
      if (run.expect) { u.luckySeq = seq; u.luckyExp = 1 + (LUCK_X - 1) * L / 6; u.luckRoll = null; return false; } // 理论值: the expected ×
      const d = 1 + Math.floor(hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, u.side === 'ally' ? 1 : 2, 19) * 6);
      u.luckRoll = d;
      if (d > L) return false;
      u.luckySeq = seq;
      return true;
    }
    function hit(u, t, amount, crit, pierceOk, w) {
      const tr = { uid: t.id, id: t.ref, amount: 0, hpAfter: t.hp, kind: 'damage' };
      let dmg, pierce = false;
      const lx = u && u.luckySeq != null && u.luckySeq === B.seq ? (run.expect ? u.luckyExp || 1 : LUCK_X) : 1; // 2026-11-20 幸运 「好运一击」
      if (lx !== 1 && lx > 1) { tr.lucky = true; tr.luckX = run.expect ? lx : LUCK_X; if (run.expect) amount = amount * lx; }
      if (lx !== 1 && lx < 1 && run.expect) amount = amount * lx; // 厄运 (expected value)
      const dx = !run.expect && u && u.doomSeq != null && u.doomSeq === B.seq ? DOOM_X : 1; // 2026-11-22 厄运「倒霉一击」
      if (dx !== 1) tr.doom = true;
      if (t.glassUp) pierceOk = false; // 2026-11-19 「玻璃瓶」: a crit does not pierce the bottle
      // 2026-11-18 growth-flow 考点「破甲」(trait sunder, switch SUNDER_ON): before an enemy with sunder lands a hit, the target's
      // 护甲 is halved (rounded down) — a pile of block melts; tr.sunder = how much block it took off
      if (SUNDER_ON && u.side === 'enemy' && Array.isArray(u.traits) && u.traits.includes('sunder') && (t.block || 0) > 0) { const k = t.block - Math.floor(t.block / 2); t.block -= k; tr.sunder = k; }
      if (run.expect) dmg = expectHit(u, t, amount, crit, pierceOk, w, tr);
      else {
      // 2026-11-20 用户 L9「灰羽护符活着时其他敌人闪避 30%；首领本回合每被打中一次闪避 +10%」(DODGE_ON): our hit on a dodging enemy
      // may miss (tr.dodge); the chief's landed hits this round stack her dodge (dodgeHits, reset at the round start)
      if (DODGE_ON && u.side === 'ally' && t.side === 'enemy') { const p = dodgeOf(B, t); if (p > 0) { t.dodgeRoll = (t.dodgeRoll || 0) + 1; if (hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, B.seq || 0, strHash(t.id), t.dodgeRoll, 71) < p) { tr.dodge = true; if (!DODGE_GRAZE) { tr.miss = true; return tr; } /* 2026-11-20 用户「落空不要不掉血，改成掉一滴，带着 落空 −1」: a dodged hit still takes 1 hp (no 护甲, no bonus) */ tr.graze = true; t.hp = Math.max(0, t.hp - 1); tr.amount = 1; tr.hpAfter = t.hp; return tr; } } }
      if (u.side === 'enemy' && B.mods.smoke && rngNext(run) < SMOKE_MISS) { tr.miss = true; return tr; } // 试玩反馈 2026-11-14 晚 #4 烟雾弹: each enemy hit misses SMOKE_MISS of the time
      const cx = crit ? (typeof crit === 'number' ? crit : CRIT_X) : 1;
      dmg = Math.floor(Math.floor(amount * cx) * lx * dx) * (B.mult || 1); // §C frenzy multiplies every hit before the block; a crit first · 2026-11-20 幸运 ×LUCK_X (stacks with the crit)
      if (crit) tr.critX = cx;
      pierce = !!crit && !!pierceOk; // 用户 2026-11-15 弓手加强: from skill Lv3 a crit 穿甲 — 护甲 / 挺身 take none of it
      if (pierce) { tr.pierce = true; if ((t.block || 0) > 0) tr.pierceBlock = t.block; }
      if (t.tough > 0 && dmg > 0) { dmg = Math.max(0, dmg - t.tough); tr.tough = t.tough; } // 坚韧: −1 per hit taken (rare)
      if (t.vuln && dmg > 0) { const x = Math.floor(dmg * VULN_X) - dmg; if (x > 0) { dmg += x; tr.vuln = x; } } // 2026-11-22 易伤药水: ×1.5 (rounded down) before 护甲
      let blocked = 0;
      const eve = dmg > 0 && !pierce ? shieldOf(t) : null;
      if (eve) { const a = absorb(eve, dmg); if (a > 0) { blocked += a; dmg -= a; tr.shieldBy = eve.id; tr.shieldAmt = a; } }
      if (dmg > 0 && !pierce) { const a = absorb(t, dmg); blocked += a; dmg -= a; if (a > 0 && t.perk && t.perk.id === 'dent') t.dents = (t.dents || 0) + 1; } // 玛尔塔「凹痕」: her block took a hit
      if (blocked > 0) { tr.blocked = blocked; tr.blockAfter = t.block || 0; if (t.glassUp) tr.glass = true; } // 2026-11-23 试玩14: the bottle took it (a crit does not pierce it)
      if (amount > 0 && !blocked) dmg = Math.max(MIN_DAMAGE, dmg); // v2.4 [13]: a connecting hit deals at least 1 — unless block soaked part of it (fully soaked = 0)
      }
      if (t.dollWard && dmg > WARD_HP && dollWardOn(B, t)) { // 2026-11-19 小铃战: her dolls shield her
        tr.ward = dmg - WARD_HP; dmg = WARD_HP;
        if (!B.dollWardSaid) { B.dollWardSaid = true; pending.push(lineEvent(data, run, FD(TX('fairy.mirror.ward', { n: WARD_HP }), 'happy'), {}, 'fairy-demon', { key: 'l11.mirror.ward', id: t.ref, uid: t.id, round: B.round })); }
      } else if (t.advisorBoss && dmg > WARD_HP && B.summon && B.summon.ward && (B.wardRound === B.round || B.enemies.some((x) => x.summoned && x.hp > 0))) { // 2026-11-17 露西安 L10 召唤战「护身」
        tr.ward = dmg - WARD_HP; dmg = WARD_HP;
        if (B.wardSaid !== B.round) { B.wardSaid = B.round; pending.push({ kind: 'line', key: 'ward', speaker: 'narrator', name: '', expr: null, round: B.round, uid: t.id, id: t.ref, text: TX('battle.ward', { name: t.name, n: WARD_HP }) }); }
      }
      if (t.hitCap > 0 && dmg > 0) { // 2026-11-18 妮可塔 L10: per-hit cap (hitCap × max hp), after 护甲 / crit — the cut part is logged as tr.hitCapped
        const cap = Math.max(1, Math.floor(t.maxHp * t.hitCap));
        if (dmg > cap) { tr.hitCapped = dmg - cap; dmg = cap; }
      }
      if (t.side === 'enemy' && B.enemyCombat === 'clause' && !B.clauseUsed && dmg >= t.hp && t.hp > 0) {
        B.clauseUsed = true;
        dmg = t.hp - 1;
        const cb = advA && bossCombatOf(advA);
        pending.push({ kind: 'line', speaker: 'advisor', speakerId: advA ? advA.id : 'advisor', name: advA ? advA.name : '', expr: null, combat: 'clause', id: t.id, text: TX('battle.clauseSave', { clause: (cb && cb.name) || TX('battle.clauseName'), name: t.name }) });
      }
      // 2026-11-20 用户「徽章应该回合末起来——敌人行动轮完全结束时，不影响下一轮」(BADGE_ROUND_END): she falls as usual; at the
      // end of the round (after the enemy phase) she stands up at 1 hp (badgeRevive). false = old: the lethal hit leaves 1 hp.
      if (BADGE_ROUND_END && t.side === 'ally' && hasTok(t, 'guard') && !t.badgeUsed && t.hp > 0 && dmg >= t.hp) { t.badgeUsed = true; t.badgeRevive = true; }
      if (!BADGE_ROUND_END && t.side === 'ally' && hasTok(t, 'guard') && !t.badgeUsed && t.hp > 1 && dmg >= t.hp) { // 信物 旧公会徽章: once per battle
        t.badgeUsed = true; dmg = t.hp - 1;
        pending.push({ kind: 'line', speaker: 'narrator', name: '', expr: null, key: 'token', id: t.id, text: TX('battle.badgeSave', { name: t.name }) });
      }
      if (OVERKILL_LOG && dmg > t.hp && t.hp > 0) tr.overkill = dmg - t.hp; // 2026-11-19 试玩修 界面: the part past her last hp (a crit of 16 on 4 hp shows 「暴击 16」, not just −4)
      dmg = Math.min(dmg, t.hp);
      t.hp -= dmg;
      if (DODGE_ON && u && u.side === 'ally' && t.side === 'enemy' && Array.isArray(t.traits) && (t.traits.includes('dodgeUp') || t.traits.includes('grazeAfter'))) t.dodgeHits = (t.dodgeHits || 0) + 1; // 2026-11-20 L9 灰羽首领
      if (run.expect && t.hp < 1e-6) t.hp = 0; /* 理论值: fractions kept, float dust is no hp */
      if (t.split && t.hp > 0 && dmg > 0 && !run.expect) t.splitDue = true; // 2026-11-20 L7 分裂史莱姆: splits at the next check
      if (t.hp <= 0) dropBlock(t); // 试玩反馈 2026-11-14 晚 #15: block never outlives its unit
      if (tr.blocked || (pierce && tr.pierceBlock)) tr.blockAfter = t.block || 0; // 穿甲: her 护甲 stays on the card (UI hitBlocks)
      if (t.side === 'ally' && dmg > 0) u.hurtSeq = B.seq || 0; // 伊芙「赎罪」 remembers who hurt us
      u.damage = (u.damage || 0) + dmg; // v2.3 §B9 stats, both sides
      t.taken = (t.taken || 0) + dmg;
      tr.amount = dmg;
      tr.hpAfter = t.hp;
      // §2.7 possessed: one flashback the first time she drops below half
      if (t.corruption === 'possessed' && !t.flashbackDone && t.hp > 0 && t.hp * 2 < t.maxHp) {
        t.flashbackDone = true;
        for (const e of v2Lines(t, ['possessed', 'flashback'])) pending.push(Object.assign(e, { kind: 'flashback' }));
      }
      // 2026-11-16 盾 Lv3+: each enemy hit that reaches her (hp or 护甲) = +1 pip to herself
      if (((t.side === 'ally' && u.side === 'enemy') || (mirrorAlly(t) && u.side === 'ally')) && t.hp > 0 && t.skill && t.skill.kind === 'guard' && !t.turned && (dmg > 0 || tr.blocked)) { // 2026-11-21 真正的镜像: a guard doll too
        const g = guardLvFor(t.perk, lvOf(t.skill) - 1);
        const tkCap = TAKEN_NO_OVERFLOW ? Math.max(0, fullOf(t) - (t.charge || 0)) : Infinity; // 2026-11-24 用户「挨打充能最多充满，不会溢出」
        if (g && g.taken && tkCap > 0 && !(t.side === 'ally' && !t.noMood && t.mood <= -2)) { const n = Math.min(tkCap, g.taken * (w == null ? 1 : w)), before = t.charge || 0; t.charge = before + n; if (SHIELD_WALL_TAKEN) wallFeed(t, n * SHIELD_WALL_PIP, t.id); // 2026-11-17 爆发实验 盾爆流
          pending.push({ kind: 'charge', round: B.round, side: t.side, self: true, taken: true, from: t.id, to: t.id, amount: n, before, after: t.charge, gen: 0, text: TX('battle.chargeTaken', { name: t.name, n }) }); }
      }
      return tr;
    }
    function downLine(t) {
      if (t.dodgeAura && t.side === 'enemy') { // 2026-11-20 用户 L9「护符坏掉后首领狂暴，每次打前两人」
        push({ kind: 'line', key: 'amuletBroken', speaker: 'narrator', name: '', expr: null, round: B.round, uid: t.id, id: t.ref, text: TX('battle.amuletBroken', { name: t.name }) });
        for (const x of B.enemies) if (x.hp > 0 && Array.isArray(x.traits) && x.traits.includes('enrageOnAmulet') && !x.enraged) { x.enraged = true; if (ENRAGE_CLEAR_CHARGE) { x.charge = 0; x.raised = 0; } if (ENRAGE_ONCE) x.atk += ENRAGE_ONCE; /* 2026-11-23 用户「狂暴：攻击穿透全场 威力+2」: +2 once (was +2 every round) */ push({ kind: 'line', key: 'enraged', speaker: 'narrator', name: '', expr: null, round: B.round, uid: x.id, id: x.ref, text: TX('battle.enraged', { name: x.name }) }); }
      }
      if (t.bell) push({ kind: 'line', key: 'bellBroken', speaker: 'narrator', name: '', expr: null, round: B.round, uid: t.id, id: t.ref, text: TX('battle.bellBroken', { name: t.name }) }); // 2026-11-20 L5: no more tolls
      if (t.candidate) {
        const path = t.corruption === 'possessed' ? ['possessed', 'down'] : ['vengeful', t.grudge || 'high', 'down'];
        if (v2Line(t, path)) return;
        const l = candLine(data, t.ref, 'enemyDefeated');
        if (l) push(lineEvent(data, run, l, { name: t.name }, t.ref, { id: t.ref, uid: t.id, key: 'enemyDefeated' }));
      }
      if (t.ref === 'fairy-demon' && B.wi + 1 >= B.waveCount) { for (const raw of fairyLines(data, 'down')) push(lineEvent(data, run, raw, {}, 'fairy-demon', { id: t.ref, uid: t.id, key: 'fairy.down' })); return; }
      if (t.advisorBoss) { const a = advisorData(data, run); if (a.comments && a.comments.defeated) push(lineEvent(data, run, a.comments.defeated, {}, 'advisor', { key: 'defeated' })); }
    }
    // 2026-11-14 L11: a girl she turned into a doll (phase 2, resummoned) goes down — whoever hit her — and the leader says one
    // line to her (lines-v2 l11DollDown, one picked, {name} = her). Once per doll per run (run.flags.l11DollDown[ref]); the line
    // carries once:'l11Doll:<ref>' so a reload / 读档 replay never says it again (A.onceFilter, like l11Meet).
    function dollDown(t) {
      if (B.level !== 11 || t.side !== 'enemy' || !t.resummoned) return;
      if (!run.flags) run.flags = {};
      const seen = run.flags.l11DollDown || (run.flags.l11DollDown = {});
      if (seen[t.ref]) return;
      const ls = asList(linesV2(data).l11DollDown).filter(Boolean);
      if (!ls.length) return;
      seen[t.ref] = true;
      const L = B.allies.find((x) => isLeader(x.id));
      push(lineEvent(data, run, rngPick(run, ls), { name: t.name }, 'leader', { key: 'l11.dollDown', once: 'l11Doll:' + t.ref, doll: t.ref, uid: L ? L.id : null, id: L ? L.ref : null, round: B.round }));
    }
    // ---- v2.1 §D ally barks: at most one per round, rng-gated (kill > low hp > attack), only when content exists ----
    const hasLines = (x) => Array.isArray(x) ? x.length > 0 : x != null;
    function bark(u, kills, healed, downed) {
      if (B.barkRound === B.round) return;
      const b = dig(linesV2(data), 'barks', u.ref);
      if (!b) return;
      const low = u.hp > 0 && u.hp * 2 <= u.maxHp;
      const key = kills > 0 && hasLines(b.kill) ? 'kill' : low && hasLines(b.lowHp) ? 'lowHp' : !healed && hasLines(b.attack) ? 'attack' : null;
      if (!key) return;
      if (rngNext(run) >= ({ kill: 0.6, lowHp: 0.45, attack: 0.3 })[key]) return;
      B.barkRound = B.round;
      const kv = key === 'kill' ? killVariant(u, b, downed || []) : null; // 2026-11-19 试玩修 剧情: no 「到手！」 over a girl we knew
      const ev = kv ? lineEvent(data, run, pickOne(run, kv.lines), { name: kv.victim.name }, u.ref, { id: u.ref, uid: u.id, key: 'bark', bark: kv.key, round: B.round })
        : lineEvent(data, run, pickOne(run, b[key]), { name: u.name }, u.ref, { id: u.ref, uid: u.id, key: 'bark', bark: key, round: B.round });
      if (B.mkSkip !== u.id) push(ev); // F round 2: her multi-kill line already spoke (the rng is still drawn: same battle)
    }
    // 2026-11-19 试玩修 剧情: the kill line, by who fell — someone tied to her by relation (killKnown.<id>, e.g. 琪琪 / 薇奥拉 and
    // the silver bracelet), else any girl who came back to fight us (killReturned). Same rng draws as the plain kill line.
    // (a girl = one of the candidates by ref: the L10 / L11 dolls carry no candidate flag)
    const girlFoe = (t) => !!(t && (t.candidate || (data.candidates || []).some((c) => c.id === t.ref)));
    function killVariant(u, b, downed) {
      const known = downed.find((t) => girlFoe(t) && hasLines(dig(b, 'killKnown', t.ref)));
      if (known) return { key: 'killKnown', victim: known, lines: b.killKnown[known.ref] };
      const back = downed.find(girlFoe);
      if (back && hasLines(b.killReturned)) return { key: 'killReturned', victim: back, lines: b.killReturned };
      return null;
    }
    // ---- v2.4 [14] enemy barks: at most one enemy line per round, rng-gated, only when lines-v2.enemyBarks has content ----
    function enemyBark(u, key) {
      if (!u || u.side !== 'enemy' || B.enemyBarkRound === B.round) return;
      if (u.candidate && u.corruption) return; // returned / rejected girls have their own revenge lines
      if (u.ref === 'fairy-demon' && key !== 'hurt') return; // the fairy keeps her own attack / down lines
      if (u.advisorBoss && key === 'down') return; // her `defeated` comment plays instead
      const arr = dig(linesV2(data), 'enemyBarks', u.advisorBoss ? 'advisor-boss' : u.ref, key);
      if (!hasLines(arr)) return;
      if (rngNext(run) >= ENEMY_BARK_P[key]) return;
      B.enemyBarkRound = B.round;
      const e = lineEvent(data, run, pickOne(run, arr), { name: u.name }, u.advisorBoss ? 'advisor' : u.ref, { key: 'enemyBark', bark: key, id: u.ref, uid: u.id, round: B.round });
      if (!(u.advisorBoss && e.speaker === 'advisor')) Object.assign(e, { speaker: u.ref, speakerId: u.ref, name: u.name });
      push(e);
    }
    // ---- §D soft heart: an ally's single-target attack on a returned girl she once stood beside ----
    function softHeart(u, t) {
      if (B.quiet) return false; // 2026-11-19 用户亲测 流程: no 心软 in the L11 last wave
      if (u.side !== 'ally' || !t || !t.candidate || !t.corruption || t.hp <= 0) return false;
      if (!run.members[t.ref] || run.party.includes(t.ref)) return false; // she must have been a party member (sacrificed), not a rejected girl
      const h = (run.memory || {})[t.ref];
      if (u.turned) return false;
      if (h && Array.isArray(h.teammates) && !h.teammates.includes(u.id)) return false;
      const su = B.softUsed || (B.softUsed = {});
      if (su[u.id]) return false;
      const rel = !isLeader(u.ref) && !u.turned ? cand(data, u.ref).relation : null;
      const relBack = cand(data, t.ref).relation;
      const close = (rel && rel.with === t.ref && rel.kind === 'friend') || (relBack && relBack.with === u.id && relBack.kind === 'friend') || u.bond === 'high';
      if (rngNext(run) >= (close ? 0.35 : 0.2)) return false;
      su[u.id] = true;
      return true;
    }
    function softLine(u, t) {
      const raw = dig(linesV2(data), 'barks', u.ref, 'softHeart');
      const r = hasLines(raw) ? pickOne(run, raw) : { speaker: u.ref, text: '……{name}。' };
      B.barkRound = B.round;
      push(lineEvent(data, run, r, { name: t.name }, u.ref, { id: u.ref, uid: u.id, key: 'bark', bark: 'softHeart', soft: true, target: t.id, round: B.round }));
    }
    // ---- §E memory templates, filled from what she really remembers ----
    const textOf = (raw) => (raw && typeof raw === 'object' ? raw.text : raw);
    const PH = /\{(\w+)\}/g;
    function memoryFacts(u) {
      const h = u.hist || (u.hist = historyOf(data, run, u.ref));
      const nm = (id) => (id ? nameOf(data, id) : null);
      const facts = [];
      for (const c of h.cards || []) facts.push({ type: c.reward ? 'reward' : 'debuff', ctx: { card: c.name, level: c.level } });
      if (h.sided && h.sided !== u.ref && h.sidedFor === false) facts.push({ type: 'sidedAgainst', ctx: { rival: nm(h.sided) } });
      if (h.sidedFor === true) facts.push({ type: 'sidedFor', ctx: { rival: nm(h.rival) } });
      if (h.departure) facts.push({ type: h.departure, ctx: { rival: nm(h.rival) } });
      if (h.friend) facts.push({ type: 'friend', ctx: { friend: nm(h.friend) } });
      return facts;
    }
    function memoryLine(u) {
      const T = linesV2(data).memoryTemplates || {};
      const opts = [];
      // 2026-11-19 试玩修 剧情: a 快速开局 run never heard the stance said aloud — <type>Quick templates when there are some
      const tplOf = (ty) => (quickRun(run) && Array.isArray(T[ty + 'Quick']) && T[ty + 'Quick'].length ? T[ty + 'Quick'] : T[ty]);
      for (const f of memoryFacts(u)) (Array.isArray(tplOf(f.type)) ? tplOf(f.type) : []).forEach((raw, i) => {
        const ctx = Object.assign(baseCtx(data, run), { name: u.name }, f.ctx);
        const t = textOf(raw);
        if (typeof t !== 'string') return;
        if ((t.match(PH) || []).every((m) => ctx[m.slice(1, -1)] != null && ctx[m.slice(1, -1)] !== '')) opts.push({ tpl: `${f.type}:${i}`, raw: t, ctx });
      });
      if (!opts.length) return null;
      const fresh = opts.filter((o) => o.tpl !== u.lastTpl);
      const o = rngPick(run, fresh.length ? fresh : opts);
      u.lastTpl = o.tpl;
      return { tpl: o.tpl, text: fill(o.raw, o.ctx) };
    }
    const corrPath = (u) => (u.corruption === 'possessed' ? ['possessed'] : ['vengeful', u.grudge || 'high']);
    // one revenge line per attack: an attack line (with {memory} filled) or, without attack lines, a bare memory template
    function revengeLine(u) {
      const atk = v2(u.ref, corrPath(u).concat('attack'));
      let raw = null, mem = null;
      if (Array.isArray(atk) && atk.length) {
        let idx = atk.map((_, i) => i).filter((i) => i !== u.lastAtk);
        if (!idx.length) idx = [0];
        for (;;) {
          if (!idx.length) return false;
          const i = idx.splice(rngInt(run, idx.length), 1)[0];
          const t = textOf(atk[i]);
          if (/\{memory\}/.test(t || '')) { mem = memoryLine(u); if (!mem) continue; }
          raw = atk[i]; u.lastAtk = i;
          break;
        }
      } else {
        mem = memoryLine(u);
        if (!mem) return false;
        raw = { speaker: u.ref, text: mem.text, expr: u.corruption === 'possessed' ? 'possessed' : 'vengeful-sneer' };
      }
      push(lineEvent(data, run, raw, { name: u.name, memory: mem ? mem.text : '' }, u.ref, { id: u.ref, uid: u.id, key: 'revenge', round: B.round, template: mem ? mem.tpl : null }));
      return true;
    }
    // ---- §E the reckoning: monologue → debts → one memory event per debt (real effects) ----
    const MONO_FALLBACK = {
      possessed: [TX('debt.possessed.1'), TX('debt.possessed.2'), TX('debt.possessed.3')],
      vengeful: [TX('debt.vengeful.1'), TX('debt.vengeful.2'), TX('debt.vengeful.3')],
    };
    function effText(eff) {
      if (!eff) return '';
      if (eff.type === 'stat') return eff.stat === 'atk' ? TX('debt.eff.atk', { delta: (eff.delta > 0 ? '+' : '') + eff.delta }) : TX('debt.eff.maxHp', { delta: (eff.delta > 0 ? '+' : '') + eff.delta });
      if (eff.type === 'mood') return TX('debt.eff.mood', { delta: (eff.delta > 0 ? '+' : '') + eff.delta });
      if (eff.type === 'status' && eff.status === 'slow-start') return TX('debt.eff.slowStart');
      if (eff.type === 'charge') return TX('debt.eff.charge', { delta: eff.delta }); // 2026-11-19 诅咒维度
      if (eff.type === 'gold') return TX('debt.eff.mood', { delta: '-1' }); // 2026-11-19 诅咒维度: in battle a fine turns into mood −1
      return '';
    }
    function applyEff(a, eff, cardId) {
      if (eff.type === 'stat' && eff.stat === 'atk') { const before = a.atk; a.atk = Math.max(1, a.atk + eff.delta); a.debuffs.push({ card: cardId, stat: 'atk', delta: a.atk - before }); }
      else if (eff.type === 'stat' && eff.stat === 'maxHp') { const before = a.maxHp; a.maxHp = Math.max(3, a.maxHp + eff.delta); a.hp = Math.min(a.hp, a.maxHp); a.debuffs.push({ card: cardId, stat: 'maxHp', delta: a.maxHp - before }); }
      else if (eff.type === 'status' && eff.status === 'slow-start') { if (a.acts === 0) a.slowStart = true; }
      else if (eff.type === 'mood' && !a.noMood) { if (a.mood + eff.delta < -1 && hasTrait(data, a.id, 'loyal')) fireInBattle(a, 'loyal'); a.mood = clamp(a.mood + eff.delta, hasTrait(data, a.id, 'loyal') ? -1 : -2, 2); }
      else if (eff.type === 'charge') a.fullAt = fullOf(a) + (eff.delta || 0); // 2026-11-19 诅咒维度: this battle only
      else if (eff.type === 'gold' && !a.noMood) { if (a.mood - 1 < -1 && hasTrait(data, a.id, 'loyal')) fireInBattle(a, 'loyal'); a.mood = clamp(a.mood - 1, hasTrait(data, a.id, 'loyal') ? -1 : -2, 2); } // 2026-11-19 诅咒维度
    }
    function reckoning(u) {
      (run.reckoned || (run.reckoned = {}))[u.ref] = true;
      const h = u.hist = historyOf(data, run, u.ref);
      const monoRaw = v2(u.ref, corrPath(u).concat('monologue'));
      const mono0 = hasLines(monoRaw) ? (Array.isArray(monoRaw) ? monoRaw : [monoRaw]) : MONO_FALLBACK[u.corruption].map((t) => ({ speaker: u.ref, text: t }));
      // feedback-1112 [23]: ≤3 enemy lines before a wave: keep her first line, the {memory} line and her last line
      // feedback-1112 #23 (round 2): her intro / token lines already spent part of her share (u.talkShare, set in loadWave)
      const left = B.talkLeft == null ? 3 : B.talkLeft;
      const cap = u.talkShare != null ? Math.max(1, Math.min(left, u.talkShare)) : Math.max(1, left - B.enemies.filter((x) => x !== u && reckPending(x)).length);
      let keep = mono0.map((_, i) => i);
      if (keep.length > cap) {
        const mi = mono0.findIndex((r) => /\{memory\}/.test(textOf(r) || ''));
        const pri = (cap >= 3 ? [0, mi, mono0.length - 1] : [mi, mono0.length - 1, 0]).concat(keep).filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
        keep = pri.slice(0, cap).sort((a, b) => a - b);
      }
      const mono = keep.map((i) => mono0[i]);
      B.talkLeft = left - mono.length;
      const lines = mono.map((raw) => {
        const t = textOf(raw);
        const mem = /\{memory\}/.test(t || '') ? memoryLine(u) : null;
        return resolveLine(data, run, raw, { name: u.name, memory: mem ? mem.text : '……' }, u.ref);
      });
      push({ kind: 'reckoning', round: B.round, id: u.ref, uid: u.id, name: u.name, corruption: u.corruption, grudge: u.grudge || null, lines });
      // build 1–3 debts from her real history
      const living = alive(B.allies);
      const debts = [];
      const one = (prefer, moodOnly, orElse) => {
        const p = prefer && living.find((a) => a.id === prefer);
        if (p && !(moodOnly && p.noMood)) return [p];
        const q = orElse && living.find((a) => a.id === orElse || (orElse === 'leader' && isLeader(a.ref || a.id)));
        if (q) return [q]; // 2026-11-23 DEBT_RIVAL_LEADER
        const pool = moodOnly ? living.filter((a) => !a.noMood) : living;
        const src = pool.length ? pool : living;
        return src.length ? [rngPick(run, src)] : [];
      };
      if (!living.length) return;
      if (h.departure === 'named') debts.push({ source: 'named', label: TX('debt.named'), eff: { type: 'stat', stat: 'maxHp', delta: -2 }, allies: one(h.friend, false, DEBT_RIVAL_LEADER ? 'leader' : null) }); // 2026-11-23 her friend gone → the leader
      else if (h.departure === 'taken') debts.push({ source: 'taken', label: TX('debt.taken'), eff: { type: 'mood', delta: -1 }, allies: one(h.friend, true, DEBT_RIVAL_LEADER ? 'leader' : null) }); // 2026-11-23 her friend gone → the leader
      else if (h.departure === 'rejected') debts.push({ source: 'rejected', label: u.grudge === 'low' ? TX('debt.rejectedLow') : TX('debt.rejected'), eff: { type: 'stat', stat: 'atk', delta: -1 }, allies: one(h.rival, false, DEBT_RIVAL_LEADER ? 'leader' : null) }); // 2026-11-23 试玩 16/17「夜鸦削的是阿雾」: the girl hired over her is gone → the leader (who chose), not a random one
      const usedMem = new Set();
      (u.memory || []).forEach((mm, i) => {
        if (mm.flip !== 'debuff-returned' || debts.length >= 3) return;
        const card = cardById(data, mm.card);
        if (!card) return;
        usedMem.add(i);
        debts.push({ source: 'debuff', card: card.id, label: TX('debt.card', { card: card.name }), eff: card.effect || {}, allies: u.resentful ? living.slice() : [rngPick(run, living)], all: !!u.resentful });
      });
      if (debts.length < 3 && h.sided && h.sided !== u.ref && h.sidedFor === false) {
        const first = living.every((a) => a.acts === 0) && !(DEBT_ONE_DAZE && B.debtDazed); // 2026-11-22 DEBT_ONE_DAZE: one grudge daze per battle; a second one is 心情 −1
        if (first && DEBT_ONE_DAZE) B.debtDazed = true;
        debts.push({ source: 'sidedAgainst', label: quickRun(run) ? TX('debt.sidedAgainstQuick') : DEBT_SIDED_WHO && h.sided ? TX('debt.sidedAgainstWho', { rival: nameOf(data, h.sided) }) : TX('debt.sidedAgainst'), /* 2026-11-24 试玩「琪琪说你没站在我这边，挨效果的却是夜鸦，看不懂」: name the girl you backed */ /* 2026-11-19 试玩修 剧情 */ eff: first ? { type: 'status', status: 'slow-start' } : { type: 'mood', delta: -1 }, allies: one(h.sided, !first, DEBT_RIVAL_LEADER ? 'leader' : null) }); // 2026-11-23 试玩 19「夜鸦『你没站在我这边』打到塞西」: the girl you sided with is gone → the leader
      }
      const who = (d) => (d.all ? TX('battle.wholeTeam') : listSeq(d.allies.map((a) => a.name)));
      push({ kind: 'debts', round: B.round, id: u.ref, uid: u.id, name: u.name,
        debts: debts.map((d, i) => ({ index: i, label: d.label, text: DEBT_WHO_FIRST ? `${who(d)} ${effText(d.eff)}` : `${effText(d.eff)} → ${who(d)}`, source: d.source, card: d.card || null, allies: d.allies.map((a) => a.id) })) });
      debts.forEach((d, i) => {
        const hpWas = d.allies.map((a) => ({ uid: a.id, hp: a.hp, maxHp: a.maxHp })); // batch6 H2-14: the UI shows the old numbers until the dots land
        for (const a of d.allies) applyEff(a, d.eff, d.card || 'debt:' + d.source);
        const e = { kind: 'memory', hpWas, id: u.ref, unit: u.id, allies: d.allies.map((a) => a.id), card: d.card || null, flip: d.source === 'debuff' ? 'debuff-returned' : 'debt', debt: i, source: d.source, label: d.label,
          text: d.card ? TX('debt.returnCard', { name: u.name, card: cardById(data, d.card).name, who: who(d) }) : TX('debt.return', { name: u.name, label: d.label, who: who(d), eff: effText(d.eff) }) };
        if (d.allies.length === 1) e.ally = d.allies[0].id;
        push(e);
        while (pending.length) push(pending.shift()); // 起作用时才说 (loyal) after the entry
      });
      applyMemory(u, usedMem); // the rest: debuffs past the third debt, rewards that soften her
    }
    // 2026-11-16 第 10 关 (用户): when a unit carrying bossEnrage (scenario wave entry) drops, the living advisor boss
    // 「上强度」: from the next round her own 越打越凶 grows by bossEnrage a round instead of ENEMY_RAMP. Event 'enrage'.
    function enrageBoss(t) {
      const boss = B.enemies.find((x) => x.advisorBoss && x.hp > 0 && !x.enrageRound);
      if (!boss) return;
      boss.enrageRound = B.round; boss.enrageRamp = t.bossEnrage;
      push({ kind: 'enrage', round: B.round, side: 'enemy', uid: boss.id, id: boss.ref, from: t.id, ramp: t.bossEnrage,
        text: TX('battle.enrage', { name: boss.name, fallen: t.name, n: t.bossEnrage }) });
    }
    function downs(targets, foes) {
      let killed = 0;
      for (const tr of targets) {
        const t = foes.find((x) => x.id === tr.uid);
        if (t && t.hp <= 0) dropBlock(t);
        if (t && t.hp <= 0 && !t.downLogged) {
          t.downLogged = true;
          killed += 1;
          push({ kind: 'down', round: B.round, side: t.side, id: t.id, uid: t.id, ref: t.ref, text: TX('battle.down', { name: t.name }) });
          if (t.side === 'enemy') moveAim(t); // 猎人锁定: the lock moves right (else left)
          if (t.side === 'ally' && AIM_SKIP_FALLEN && t.aimLock) t.aimLock = null; // round-3 #4: fallen hunter → no lock
          downLine(t);
          if (t.side === 'enemy' && !B.cheating) enemyBark(t, 'down');
          dollDown(t);
          if (t.side === 'enemy' && t.bossEnrage > 0) enrageBoss(t); // 2026-11-16 第 10 关: 石门守卫 down → 奥德丽 上强度
          if (t.side === 'enemy' && !B.cheating) for (const v of B.enemies) { // feedback-1112 #34 记仇: a fallen underling makes her stronger
            if (v === t || v.hp <= 0 || !hasTrait0(v, 'vengeance')) continue;
            v.atk += 1;
            push({ kind: 'line', key: 'trait', trait: 'vengeance', round: B.round, speaker: v.ref, speakerId: v.ref, uid: v.id, id: v.ref, name: v.name, expr: null, atk: v.atk,
              text: TX('battle.avenge', { name: t.name, avenger: v.name, atk: v.atk }) });
          }
        }
      }
      return killed;
    }
    const hasTrait0 = (u, k) => !!(u && Array.isArray(u.traits) && u.traits.includes(k));
    // feedback-1112 #34 顺手牵羊: the first time she hurts an ally this battle, one item leaves the bag for good
    function pickpocket(u, targets) {
      if (u.side !== 'enemy' || !hasTrait0(u, 'pickpocket') || u.stoleOnce || !targets.some((t) => t.amount > 0) || !(run.items || []).length) return;
      u.stoleOnce = true;
      const i = Math.floor(rngNext(run) * run.items.length);
      const itemId = run.items.splice(i, 1)[0];
      const it = itemDef(data, itemId) || { name: itemId };
      push({ kind: 'line', key: 'trait', trait: 'pickpocket', round: B.round, speaker: u.ref, speakerId: u.ref, uid: u.id, id: u.ref, name: u.name, expr: null, itemId, lost: true,
        text: TX('battle.steal', { name: u.name, item: it.name }) });
    }
    // 2026-11-14 L8: the leader and the girl he gave up. open (round 1, before anyone acts): leader → her;
    // regret (named, his round-1 turn): his inner line + 'regret' event; wake (end of round 1): a teammate calls him; sorry (round 2): his apology / goodbye
    function l8Beat(when, who) {
      if (!when || !B.l8) return;
      const her = B.enemies.find((x) => x.ref === B.l8.id && x.returned);
      const L = B.allies.find((x) => isLeader(x.id));
      if (!her || !L) return;
      const set = dig(linesV2(data), 'l8Return', B.l8.id, B.l8.mode) || {};
      const ctx = { name: her.name };
      const say1 = (raw, def, u, key) => { if (raw) push(lineEvent(data, run, raw, ctx, def, { key, uid: u.id, id: u.ref, round: B.round, l8: B.l8.mode })); };
      if (when === 'open') {
        if (her.hp <= 0) return;
        say1(set.open, LEADER_ID, L, 'l8.open');
        say1(set.reply, her.ref, her, 'l8.reply');
      } else if (when === 'regret') {
        push({ kind: 'regret', round: B.round, uid: who.id, actor: who.id, actorId: who.ref, her: her.ref, text: TX('battle.regret', { name: who.name, her: her.name }) });
        say1(set.regret, LEADER_ID, who, 'l8.regret');
      } else if (when === 'wake') {
        if (L.hp <= 0) return;
        const living = alive(B.allies).filter((x) => !isLeader(x.id));
        const fr = girlMem(run, B.l8.id).friend;
        const w = living.find((x) => x.id === fr) || living[0];
        const raw = w && (dig(linesV2(data), 'l8Wake', w.ref) || dig(linesV2(data), 'l8Wake', 'default'));
        if (raw) push(lineEvent(data, run, raw, ctx, w.ref, { key: 'l8.wake', uid: w.id, id: w.ref, round: B.round, wake: L.id }));
      } else if (when === 'sorry') {
        if (her.hp <= 0 || L.hp <= 0) return;
        say1(set.sorry, LEADER_ID, L, 'l8.sorry');
        say1(set.after, her.ref, her, 'l8.after');
      }
    }
    // Why `u` would sit this action out (null = she acts). Used both for normal turns and to refuse a chain.
    function skipReason(u, peek) {
      if (u.side === 'ally') {
        const n = peek ? u.acts + 1 : u.acts;
        if (u.regret && B.round <= u.regret) return 'regret'; // 2026-11-14: L8, she was the name you wrote — the leader freezes (round 1)
        if (u.slowStart && n >= 1 && n <= (u.slowStart === 2 ? 2 : 1)) return 'slow-start'; // 2 = the leader's doubled daze (#28+31)
        if (!u.noMood && u.mood <= -2 && n % 2 === 0) return 'mood';
        if (u.swapSkip) return 'swap'; // 2026-11-19 换位/暂停连做: she was moved at the pause
        return null;
      }
      if (u.dazed) return 'clause'; // 试玩反馈 2026-11-14 晚 #22 附加条款: she was picked to 发呆 this round
      if (u.skipRounds && B.round <= u.skipRounds) return 'memory';
      // 2026-11-24 用户「选择了夜鸦，但是支持琪琪，那么琪琪变成敌人的时候，第一回合就心软不出手」(SOFT_FOE): candidates[].softFoe (琪琪) — you
      // backed her at the interview but hired the other → as a foe, her first action in each fight is skipped. false = she attacks as usual
      if (SOFT_FOE && u.candidate && !u.wokeMember && !u.softUsed && !(SOFT_ONCE && (run.enemyRecord[u.ref] || {}).softDone) && (u.softFirst || ((cand(data, u.ref) || {}).softFoe && girlMem(run, u.ref).sidedFor === true))) { if (!peek) u.softUsed = true; return 'soft'; } // SOFT_ONCE: the battle end stamps enemyRecord[ref].softDone // GRUDGE_LOW_SOFT: every backed-but-not-hired girl (u.softFirst)
      if (u.hesitate) return 'hesitate';
      return null;
    }
    // One action. k = chain depth (0 = normal turn; >=1 = chain-triggered extra action, +k damage/heal).
    // free = extra action outside the normal turn (chain, inverted slow-start): no daze check, does not count as an act.
    // st = the chain this action belongs to. Returns { damage, kills, healed, guard } or null if she sat it out.
    // ---- v2.2 §4.5 turncoat: a re-summoned girl may break free and turn on the fairy (for good) ----
    function turnChance(u) {
      const id = u.ref, m = run.members[id], h = (run.memory || {})[id] || {};
      const kind = (m && m.bond === 'high') || h.sidedFor === true || (h.cards || []).some((c) => c.reward) || (m && (m.rewardsReceived || []).length > 0);
      const grudge = (run.rejectedInfo[id] && run.rejectedInfo[id].grudge) || h.grudge || null;
      return Math.max(0, TURN_BASE + (kind ? TURN_KIND : 0) - (grudge === 'high' ? TURN_GRUDGE : 0));
    }
    const fairyOf = () => B.enemies.find((x) => x.waveBoss && x.hp > 0) || null;
    function turncoat(u) {
      const boss = fairyOf();
      u.turned = true;
      B.enemies.splice(B.enemies.indexOf(u), 1);
      Object.assign(u, { side: 'ally', noMood: true, mood: 0, bond: null, debuffs: [], damage: 0, healing: 0, guard: false, focus: boss ? boss.id : null });
      B.allies.push(u);
      push({ kind: 'turncoat', round: B.round, uid: u.id, id: u.ref, name: u.name, target: boss ? boss.id : null, text: TX('battle.turncoat', { name: u.name, target: boss ? boss.name : TX('names.fairy') }) });
      if (TURNCOAT_RECORD_LINE) { // 2026-11-20 反水 one line, from the real record
        const pk = turncoatPick(data, run, u.ref);
        push(lineEvent(data, run, pk.raw || { text: TX('battle.turncoatLine'), expr: 'upset' }, Object.assign({ name: u.name }, pk.ctx), u.ref, { id: u.ref, uid: u.id, key: 'turncoat', turn: pk.branch, round: B.round }));
      } else {
        const raw = dig(linesV2(data), 'turncoat', u.ref);
        const ls = hasLines(raw) ? (Array.isArray(raw) ? raw : [raw]) : [{ speaker: u.ref, text: TX('battle.turncoatLine'), expr: 'upset' }];
        for (const r of ls) push(lineEvent(data, run, r, { name: u.name }, u.ref, { id: u.ref, uid: u.id, key: 'turncoat', round: B.round }));
      }
      push({ kind: 'switchSide', round: B.round, uid: u.id, id: u.ref, from: 'enemy', to: 'ally', index: B.allies.length - 1, unit: unitView(data, B, u) });
    }
    // fairy 「好玩好玩」: copy one random stat debuff on our side onto another living ally
    function copyDebuff(u) {
      const living = alive(B.allies);
      const pool = [];
      for (const a of living) for (const d of a.debuffs || []) if (d.delta && living.some((b) => b !== a && !(b.debuffs || []).some((x) => x.card === d.card))) pool.push({ a, d });
      if (!pool.length) return;
      const { a, d } = rngPick(run, pool);
      const b = rngPick(run, living.filter((x) => x !== a && !(x.debuffs || []).some((y) => y.card === d.card)));
      applyEff(b, { type: 'stat', stat: d.stat, delta: d.delta }, d.card);
      const cd = cardById(data, d.card);
      const label = cd ? cd.name : (String(d.card).startsWith('debt:') ? TX('debt.oldDebt') : d.card);
      push({ kind: 'copyDebuff', round: B.round, actor: u.id, actorId: u.ref, from: a.id, to: b.id, card: d.card, stat: d.stat, delta: d.delta,
        text: TX('battle.fairyCopy', { name: u.name, from: a.name, label, to: b.name }) + (COPY_SHOW_EFF ? copyEffText(d) : '') });
    }
    function copyEffText(d) { // 2026-11-25 试玩: say what the copy does and that it lasts this battle only
      const dl = (d.delta > 0 ? '+' : '') + d.delta;
      const eff = ({ atk: () => TX('debt.eff.atk', { delta: dl }), maxHp: () => TX('debt.eff.maxHp', { delta: dl }), mood: () => TX('debt.eff.mood', { delta: dl }), charge: () => TX('debt.eff.charge', { delta: d.delta }) })[d.stat];
      return eff ? TX('battle.fairyCopyEff', { eff: eff() }) : '';
    }
    // 2026-11-19 小铃强 玩偶弱 phase 2: she marks one of us — XL_MARK_RULE 'lowest' = the smallest hp share (ties → the more
    // right, like the 弱 rule; 'strongest' = the biggest 威力 — it mostly picked the 护甲-heavy tank, a wasted knell), not the one she marked
    // last if anyone else stands — as a SLOT of the living line-up (her intent shows whoever stands there; a swap moves it)
    function xlPlaceMark(u, notUid) {
      const af = alive(B.allies);
      if (!af.length) { u.xlMark = null; return; }
      const pool = af.length > 1 && notUid ? af.filter((x) => x.id !== notUid) : af;
      const t = XL_MARK_RULE === 'lowest' ? pool.reduce((b, x) => (hpPct(x) <= hpPct(b) ? x : b), pool[0]) : pool.reduce((b, x) => ((x.atk || 0) > (b.atk || 0) ? x : b), pool[0]); // lowest: the smallest hp share (tie → the more right) · strongest: the biggest 威力 (tie → the more left)
      u.xlMark = af.indexOf(t);
      push({ kind: 'xlMark', round: B.round, actor: u.id, actorId: u.ref, uid: t.id, target: t.id, slot: u.xlMark, text: XL_MARK_SLOT_TEXT ? TX('battle.xlMarkSlot', { name: u.name, target: t.name, n: u.xlMark + 1 }) : TX('battle.xlMark', { name: u.name, target: t.name }) }); // 2026-11-23 试玩14: the mark is a slot — say so
    }
    // 2026-11-19 小铃强 玩偶弱 phase 2: the knell on the marked slot — 威力 (with this round's bonuses, − 虚弱) × XL_MARK_X, the
    // target's 护甲 cut by XL_MARK_PIERCE first (tr.sunder); one 'action' entry (xlKnell: true), then she marks the next one
    function xlKnell(u, k, st, rnd) {
      const t = xlMarkTarget(B, u);
      if (!t) { u.xlMark = null; return null; }
      const b = atkBonuses(u, t), a = u.atk + sum(b), p = Math.max(Math.min(1, a), a - (u.weak || 0));
      const amount = XL_MARK_FIXED > 0 ? XL_MARK_FIXED : Math.max(1, Math.round(p * XL_MARK_X)); // 2026-11-24c 用户「终响打 10 好了」: a fixed 10
      const cut = Math.floor((t.block || 0) * XL_MARK_PIERCE);
      if (cut > 0) t.block -= cut;
      const tr = hit(u, t, amount, false, false);
      if (cut > 0) tr.sunder = cut;
      const skill = TX('skill.xlKnell');
      let text = TX('battle.xlKnell', { name: u.name, skill, target: t.name, dmg: tr.amount, hp: t.hp });
      if (tr.blocked) text += TX('battle.blockAbsorb', { n: tr.blocked });
      push({ kind: 'action', round: rnd, side: u.side, actor: u.id, actorId: u.ref, skill, skillKind: 'strike', chainId: st ? st.chainId : null, chainDepth: k || 0,
        base: amount, bonuses: [], targets: [tr], text, xlKnell: true });
      while (pending.length) push(pending.shift());
      const kills = downs([tr], B.allies);
      u.actions = (u.actions || 0) + 1;
      u.xlMark = null;
      if (u.hp > 0) xlPlaceMark(u, t.id);
      return { damage: tr.amount, kills, healed: false, guard: false };
    }
    function doAction(u, k, free, st, from) {
      const rnd = B.round;
      if (!free && !(B.quiet && FINAL_NO_TURNCOAT) && !(XL_V3 && B.level === 11 && mirrorOn(levelCfg(data, B.level))) && u.side === 'enemy' && u.resummoned && !u.turned && fairyOf() && rngNext(run) < turnChance(u)) turncoat(u);
      if (u.passive) { // 2026-11-20 L5 铜钟: never acts (not even raised by a charge)
        // 2026-11-20 用户「还剩几回合应该是铜钟自己的行动，像攻击一样 pop 出来」: on its own turn the bell says how many rounds until the toll
        const g = !free && u.bell && u.hp > 0 && B.enemies.find((x) => x.toll && x.hp > 0);
        if (g) for (let d = 0; d <= (g.toll.every || 3); d++) if (tollDue(B, g, rnd + d) && (d > 0 || g.lastToll !== rnd)) {
          push({ kind: 'bellCount', round: rnd, side: 'enemy', actor: u.id, actorId: u.ref, uid: u.id, n: d, text: d ? TX('battle.bellCount', { n: d }) : TX('battle.bellCountNow') });
          break;
        }
        // 2026-11-22 试玩4 #7: a charge raised it (「攒满放出：灰羽护符」) — say it does nothing, once per release (the UI ignores this kind)
        if (free && u.hp > 0 && !(B.burst && B.burst.i > 1)) push({ kind: 'passiveIdle', round: rnd, side: u.side, actor: u.id, actorId: u.ref, text: TX('battle.skip.passive', { name: u.name }) });
        return null;
      }
      if (!free && u.side === 'enemy' && u.special === 'copyDebuff' && u.hp > 0) copyDebuff(u);
      const mine = u.side === 'ally' ? B.allies : B.enemies;
      const foes = u.side === 'ally' ? B.enemies : B.allies;
      if (!free) {
        u.acts += 1;
        if (u.side === 'ally' && B.emods && B.emods.clause && (B.emods.clause === true || B.emods.clause === u.id)) { // #36 the boss's 附加条款: our first action this round is void (2026-11-18: or the marked ally's next one)
          B.emods.clause = false;
          const cb = advA && bossCombatOf(advA);
          push({ kind: 'cancel', round: rnd, side: u.side, actor: u.id, actorId: u.ref, enemySkill: true, text: TX('battle.clauseCancel', { clause: (cb && cb.name) || TX('battle.clauseName'), name: u.name }) });
          return null;
        }
        if (u.flashbackFirst && !u.flashbackDone) { // §2.2 grudge low: remembers you spoke for her — one flashback, once
          u.flashbackDone = true;
          const ls = v2Lines(u, ['vengeful', 'low', 'flashback']);
          if (!ls.length) ls.push({ speaker: u.ref, speakerId: u.ref, name: u.name, text: TX('battle.handPause', { name: u.name }), expr: null });
          // 修复 2026-11-13「落选者小队不攻击」: her lines end in 「我得出手了」 — she hesitates, then still acts this turn
          // (was: the flashback ate her action; L4–L7 fights last 1–2 enemy phases, so the squad leader never attacked)
          for (const e of ls) push(Object.assign(e, { kind: 'flashback', round: rnd, id: u.ref, uid: u.id, actor: u.id, key: 'vengeful.low.flashback' }));
        }
        const why = skipReason(u, false);
        if (why === 'regret') l8Beat('regret', u);
        if (why) {
          if (u.swapSkip) u.swapSkip = false; // 2026-11-19 换位/暂停连做: any lost turn pays the swap
          if (why === 'hesitate') u.hesitate -= 1;
          if (why === 'clause') u.dazed = false;
          const text = why === 'clause' ? TX('battle.skip.clause', { name: u.name }) : why === 'hesitate' ? TX('battle.skip.hesitate', { name: u.name })
            : why === 'soft' ? ((cand(data, u.ref) || {}).softFoe ? TX('battle.skip.soft', { name: u.name }) : TX('battle.skip.softAny', { name: u.name })) : why === 'memory' ? TX('battle.skip.memory', { name: u.name }) : why === 'regret' ? TX('battle.skip.regret', { name: u.name }) : why === 'swap' ? TX('battle.skip.swap', { name: u.name })
            : why === 'slow-start' ? TX('battle.skip.slowStart', { name: u.name }) : why === 'mood' ? TX('battle.skip.mood', { name: u.name }) : TX('battle.skip.idle', { name: u.name }); // 2026-11-22 试玩: say why (迟疑 / 心情)
          if (why === 'soft' && SOFT_ONCE) push(lineEvent(data, run, { speaker: u.ref, text: TX('battle.softLine'), expr: 'sad' }, {}, u.ref, { key: 'softLine', round: rnd, uid: u.id })); // 2026-11-24 用户「她发呆时要说明原因——『你当时支持了我，这份恩情我记着……但是就这一次』」
          push({ kind: 'daze', round: rnd, side: u.side, actor: u.id, actorId: u.ref, reason: why, text });
          return null;
        }
      }
      if (SUMMON_ON_ACTION && !free && u.side === 'enemy' && u.advisorBoss && B.summon && u.hp > 0) { summonRound(); if (spreadOn(run)) rollIntents(run, B, B.round); } // 2026-11-24 用户「露西安应召应该发生在她行动的时候，而不是回合开始」: she calls, then strikes
      if (!free && u.side === 'enemy' && u.toll && u.hp > 0 && tollDue(B, u, B.round)) { toll(u); return null; } // 2026-11-20 L5 钟楼守卫: the toll replaces his strike
      if (!free && u.side === 'enemy' && u.xlPhase === 2 && u.xlMark != null && u.hp > 0) { // 2026-11-19 小铃强 玩偶弱: the knell replaces her bell
        const kr = xlKnell(u, k, st, rnd);
        if (!XL_P2_BELL || !(u.hp > 0) || !alive(B.allies).length) return kr; // 2026-11-21 用户「小铃第二阶段应该每轮往所有人身上扔招」: the knell, then her bell on everyone as well
      }
      const sk = u.skill, ally = u.side === 'ally' || mirrorAlly(u) /* 2026-11-21 真正的镜像: a doll's skill math = ours */, li = ally ? lvOf(sk) - 1 : (u.elv || 1) - 1, L5 = ally && LV5_ON && !!(sk && sk.lv5); // DESIGN-skill-level: enemies Lv1 unless the level gives them more (用户 2026-11-15 第 4–7 关, u.elv)
      const rawAmount = (kind, a, enemy) => (enemy && kind === 'spark' && sk.full ? a : rawAmount0(kind, a, enemy)) + (enemy && kind === 'spark' ? li : 0); // an enemy spark: +1 per level above 1 · sk.full (妮可塔「满场通杀」): full 威力 on everyone
      const pk = ally && u.perk ? u.perk : null, pid = pk ? pk.id : null, pn = pk ? (pk.n || 1) : 0;
      B.seq = (B.seq || 0) + 1; // this battle's action counter (crit hash, 赎罪)
      const seq = B.seq;
      const lucky = luckRoll(u, seq); // 2026-11-20 幸运: one d6 per action
      let af = alive(foes);
      if (u.focus) { const f = af.find((x) => x.id === u.focus); if (f) af = [f].concat(af.filter((x) => x !== f)); } // turncoats go for the fairy
      if (!af.length) return null;
      let targets = [], heal = false, healAmt = 0, text, bon = [], soft = null, pflat = [], plater = [];
      const base = rawAmount(sk.kind, u.atk, !ally);
      // 威力 for this action: atk + bonuses − 虚弱, +1 when pulled in by 加成 (three-factors 用户拍板 #3)
      const powerFor = (t) => { const b = atkBonuses(u, t), a = u.atk + sum(b); return { b, p: Math.max(Math.min(1, a), a - (u.weak || 0)) + (k ? CHAIN_POWER : 0) }; }; // 虚弱 never takes 威力 below 1
      const amountFor = (t) => { const r = powerFor(t); return { b: r.b, p: r.p, amt: rawAmount(sk.kind, r.p, !ally) }; };
      // §2 个人特点: flat per-hit damage on target t (hit i of n); each entry is shown as a bonus
      const perkFlat = (t, i, n, fallback) => {
        const out = [];
        if (!ally) return out;
        if (u.vigil) out.push({ from: u.vigilFrom || u.id, ic: 'vigil', label: TX('battle.bonus.vigil'), amount: u.vigil });
        if (t && t.side === 'enemy' && t.burnUntil >= B.round) out.push({ from: t.burnFrom || u.id, ic: 'burn', label: t.burnStack > 0 ? TX('battle.bonus.searFlame') : TX('battle.bonus.burn'), amount: t.burnStack > 0 ? t.burnStack : BURN_ADD }); // 2026-11-16 灼烧: +1 per hit // 2026-11-17 爆发实验 法师刺客流: 烈焰护符 → +层数
        if (t && t.side === 'enemy' && bRelic(B, 'hunter-mark') && B.allies.some((a) => a.hp > 0 && a.aimLock === t.id)) out.push({ from: u.id, ic: 'hunterMark', label: guildRelicName(data, 'hunter-mark'), amount: RELIC_MARK }); // 2026-11-22 遗物 猎人记号
        if (!pid || !t) return out;
        if (pid === 'dent' && u.dents) out.push({ from: u.id, label: pk.name, amount: Math.min(u.dents, pk.max || 3) });
        else if (pid === 'penance' && t.hurtSeq && t.hurtSeq > (u.lastSeq || 0)) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'collect' && i === n - 1) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'elite' && isElite(t)) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'calm' && u.hp * 2 <= u.maxHp) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'vanguard' && alive(mine)[0] === u) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'prep' && !u.prepDone) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'finish' && t.hp * 2 <= t.maxHp) out.push({ from: u.id, label: pk.name, amount: pn });
        else if (pid === 'steady' && fallback) out.push({ from: u.id, label: pk.name, amount: pn });
        return out;
      };
      // §4 crit: our hunters only; the roll is a hash, never the main rng
      const critOf = (t, i) => {
        const hx = ally && sk.kind === 'aim' && hasTok(u, 'hawkEye') ? (u.hawkX || 0) : 0; // 2026-11-17 爆发实验 猎人暴击流: added to the crit x, before 见血加价
        if (run.expect) { /* 理论值: the chance itself, { p, x } — see expectHit */
          if (!ally && sk.kind === 'spark' && sk.bigEvery > 0) return bigRoundOf(sk, B.round) ? { p: 1, x: JACKPOT_X } : false; // 2026-11-18 大招
          if (!ally && sk.kind === 'spark' && sk.jackpot) return { p: sk.jackpot, x: JACKPOT_X };
          if (sk.kind !== 'aim') return false;
          if (!ally) return li > 0 && ENEMY_CRIT_RATE[li] > 0 ? { p: ENEMY_CRIT_RATE[li], x: CRIT_X } : false;
          const mx = pid === 'markup' && t.hp < t.maxHp ? pn : 1; // 2026-11-16 莉珂「见血加价」: a hurt target, crit ×1.5
          if (CRIT_RATE[li] >= 1) return mk(CRIT_X_MAX + hx, mx);
          if (pid === 'breath' && !u.breathDone) { u.breathDone = true; return mk(CRIT_X_LV[li] + hx, mx); }
          let er = CRIT_RATE[li];
          if (pid === 'firstshot' && t.hp >= t.maxHp) er += pn;
          return { p: Math.min(1, er), x: mk(CRIT_X_LV[li] + hx, mx) };
        }
        if (!ally && sk.kind === 'spark' && sk.bigEvery > 0) return bigRoundOf(sk, B.round) ? JACKPOT_X : false; // 2026-11-18 妮可塔 L10 大招: every bigEvery-th round, all ×2
        if (!ally && sk.kind === 'spark' && sk.jackpot) return hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, foes.indexOf(t), 13) < sk.jackpot ? JACKPOT_X : false; // 2026-11-15 妮可塔「通杀」: each hit rolls on its own
        if (sk.kind !== 'aim') return false;
        if (!ally) return li > 0 && hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, i, 11) < ENEMY_CRIT_RATE[li]; // 用户 2026-11-15: enemy archers Lv2+ crit ×2
        const mx = pid === 'markup' && t.hp < t.maxHp ? pn : 1; // 2026-11-16 莉珂「见血加价」(was 暴击率 +25%): a hurt target (hp < max), crit ×1.5 (×2 → ×3)
        if (CRIT_RATE[li] >= 1) return mk(CRIT_X_MAX + hx, mx); // 每箭必暴 (was: Lv4)
        if (pid === 'breath' && !u.breathDone) { u.breathDone = true; return mk(CRIT_X_LV[li] + hx, mx); } // 阿雾「屏息」: her first arrow each battle
        let rate = CRIT_RATE[li];
        if (pid === 'firstshot' && t.hp >= t.maxHp) rate += pn;
        return hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, i) < rate ? mk(CRIT_X_LV[li] + hx, mx) : false; // 用户 2026-11-15: ×2 / ×2 / ×2.5
      };
      if (sk.kind === 'heal') {
        const hurt = alive(mine).filter((x) => x.hp < x.maxHp && !x.bell); // 2026-11-20 L5: nobody mends the bell
        if (hurt.length) {
          // §C per-battle heal cap: prefer the lowest-hp ally still below her cap; if every hurt ally is capped, the heal is wasted
          const room = (x) => HEAL_CAP_X * x.maxHp - (x.healedIn || 0);
          const hl = ally ? HEAL_LV[li] : { n: HEAL_LV[li].n }; // enemy priests: Lv shares (Lv1 = one), never 护甲 (用户 2026-11-15 第 4–7 关)
          const r = powerFor(null);
          bon = r.b;
          const share = healShare(r.p);
          const raw0 = B.mult > 1 ? Math.floor(share / 2) : share, raw = raw0; // §C healing halved in frenzy · raw0 = the first share (HEAL_DECAY)
          let refund = 0;
          heal = true;
          // three-factors §3.4: hl.n shares, each to whoever is lowest right then (the same ally may get several);
          // what a share cannot heal becomes 护甲 on her (2026-11-15: from Lv1; 葛蕾「回本」 turns it into damage instead);
          // a share with nobody left hurt goes whole as 护甲 to the lowest-hp ally (front-most on a tie) — 回本: damage
          // 2026-11-20 牧师治疗: the damage aimed at each of ours this round (HEAL_TRIAGE) + the player's picks (HEAL_PICK)
          const threat = HEAL_TRIAGE ? healThreat(mine) : null;
          const picks = ally && HEAL_PICK && Array.isArray(u.healPick) ? (u.healPick = u.healPick.filter((id) => mine.some((x) => x.id === id && x.hp > 0))) : [];
          const overOk = !!hl.over && pid !== 'refund';
          const triage = (n) => { // the endangered ally who can be saved with the shares left and needs the least (tie → front-most)
            const pot = (hl.n - n) * raw;
            let best = null, bn = Infinity;
            for (const x of alive(mine)) {
              if (x.bell || room(x) <= 0 || (x.hp >= x.maxHp && !overOk)) continue;
              const need = (threat[x.id] || 0) - (x.hp + (x.block || 0)) + 1;
              if (need <= 0) continue; // not in danger
              const can = overOk ? pot : Math.min(pot, x.maxHp - x.hp, room(x));
              if (need <= can && need < bn) { best = x; bn = need; }
            }
            return best;
          };
          if (L5) { // 2026-11-25 Lv5 牧师: one full share for every living ally (what it cannot heal → 护甲, 回本 → damage)
            for (const t of alive(mine).filter((x) => !x.bell)) {
              const amt = Math.max(0, Math.min(raw0, t.maxHp - t.hp, room(t))), over = raw0 - amt;
              if (over > 0 && pid === 'refund') refund += over; else if (over > 0 && hl.over) gainBlock(t, over, u.id, true, { name: u.name, skill: sk.name });
              t.hp += amt; t.healedIn = (t.healedIn || 0) + amt; u.healing += amt; healAmt += amt;
              if (pid === 'vigil' && amt > 0) { t.vigil = pn; t.vigilFrom = u.id; }
              const tr = { uid: t.id, id: t.ref, amount: amt, hpAfter: t.hp, kind: 'heal' };
              if (over > 0 && pid !== 'refund' && hl.over) tr.overBlock = over;
              targets.push(tr);
            }
          }
          for (let n = 0; n < (L5 ? 0 : hl.n); n++) {
            const raw = HEAL_SPLIT ? (n > 0 ? Math.max(1, Math.ceil(raw0 / 2)) : raw0) : ally && HEAL_DECAY && raw0 > 0 ? Math.max(1, raw0 - HEAL_DECAY * n) : raw0; // 2026-11-24 HEAL_SPLIT // 2026-11-20 用户「补血量逐份 −2，像刺客一样」
            const left = alive(mine).filter((x) => x.hp < x.maxHp && !x.bell);
            let pick = null;
            const pid0 = HEAL_FOCUS ? picks[0] : picks[n]; // 重点照顾: every share to her until she is full
            if (pid0) { const p = left.find((x) => x.id === pid0); if (p && room(p) > 0) pick = p; }
            if (!pick && threat && raw > 0) pick = triage(n);
            if (!left.length && !pick) {
              if (!hl.over || raw <= 0) break;
              if (pid === 'refund') { refund += raw; continue; }
              const t = alive(mine).reduce((b, x) => (x.hp < b.hp ? x : b), alive(mine)[0]);
              gainBlock(t, raw, u.id, true, { name: u.name, skill: sk.name });
              continue;
            }
            const open = left.filter((x) => room(x) > 0);
            const pool = open.length ? open : left;
            const t = pick || (HEAL_TRIAGE ? pool.reduce((b, x) => (x.maxHp - x.hp > b.maxHp - b.hp ? x : b), pool[0]) : pool.reduce((b, x) => (x.hp < b.hp ? x : b), pool[0]));
            const capped = room(t) <= 0;
            const amt = capped ? 0 : Math.max(0, Math.min(raw, t.maxHp - t.hp, room(t)));
            const over = capped ? 0 : raw - amt;
            if (over > 0 && pid === 'refund') refund += over; // 葛蕾「回本」: the overflow becomes damage
            else if (over > 0 && hl.over) gainBlock(t, over, u.id, true, { name: u.name, skill: sk.name });
            t.hp += amt;
            t.healedIn = (t.healedIn || 0) + amt;
            u.healing += amt;
            healAmt += amt;
            if (ally && !coat(u) && !capped && HOLY_SPRING_HEAL_OLD && hasTok(u, 'holySpring')) { /* 2026-11-19 文字修: behind HOLY_SPRING_HEAL_OLD */ t.springAtk = (t.springAtk || 0) + HOLY_SPRING_BLESS; t.springFrom = u.id; } // 2026-11-17 爆发实验 牧师供能流: every share = 威力 +1, whole battle
            if (pid === 'vigil' && amt > 0) { t.vigil = pn; t.vigilFrom = u.id; } // 塞西「守夜」
            const prev = targets.find((x) => x.uid === t.id);
            const ob = over > 0 && pid !== 'refund' && hl.over ? over : 0; // 2026-11-22 试玩4 #9: the overflow that became 护甲, on the target row (text only)
            if (prev && !capped) { prev.amount += amt; prev.hpAfter = t.hp; if (ob) prev.overBlock = (prev.overBlock || 0) + ob; continue; }
            const tr = { uid: t.id, id: t.ref, amount: amt, hpAfter: t.hp, kind: 'heal' };
            if (ob) tr.overBlock = ob;
            if (capped) tr.capped = true;
            targets.push(tr);
            if (n === 0 && capped && hl.n === 1) text = TX('battle.healCapped', { name: u.name, target: t.name });
            if (capped) break;
          }
          if (hl.cleanse) { const c = alive(mine).find((x) => (x.debuffs || []).length || x.slowStart || (!x.noMood && x.mood < 0) || x.weak > 0); if (c) { const what = [((c.debuffs || []).length ? TX('battle.cleanseWhat.debuff') : ''), (c.slowStart ? TX('battle.cleanseWhat.slow') : ''), (!c.noMood && c.mood < 0 ? TX('battle.cleanseWhat.mood') : ''), (c.weak > 0 ? TX('battle.cleanseWhat.weak') : '')].filter(Boolean).join('、'); cleanse(c); c.weak = 0; pending.push({ kind: 'cleanse', round: rnd, uid: c.id, by: u.id, text: (what ? TX('battle.healCleanseWhat', { name: c.name, what }) : TX('battle.healCleanse', { name: c.name })) }); } } // Lv4 净化
          if (!text) text = TX('battle.heal', { name: u.name, skill: sk.name, targets: listSeq(targets.map((tr) => TX('battle.healItem', { target: mine.find((x) => x.id === tr.uid).name, amount: tr.amount, hp: tr.hpAfter }))) });
          if (PRIEST_STRIKE && ally && !coat(u) && alive(foes).length) {
            const t = alive(foes)[0], tr = hit(u, t, priestHalf(r.p));
            tr.priestStrike = true;
            targets.push(tr);
            text += TX('battle.healStrike', { dmg: tr.amount, target: t.name, hp: t.hp });
          }
          if (refund > 0 && alive(foes).length) {
            const t = alive(foes)[0], tr = hit(u, t, refund);
            tr.refund = true;
            targets.push(tr);
            text += TX('battle.healRefund', { dmg: tr.amount, target: t.name, hp: t.hp });
          }
        }
      }
      if (!heal) {
        // RULES-v1 §7: single-target skills hit the front-most living foe; v2.3 §A[19]: hunters (adc) the rightmost,
        // a skill marked random a random one; a turncoat keeps her focus
        // v2.4 [18]: every enemy `aim` (skeleton archers, mercenary archers, a returned hunter …) picks a random ally
        const randomAim = sk.random || sk.target === 'random' || (u.side === 'enemy' && sk.kind === 'aim' && !mirrorAlly(u));
        const spread = !!run.expect && randomAim && !u.focus && u.side === 'enemy' && af.length > 1 && !spreadOn(run); // 理论值: a random-target enemy hit is spread over every living ally (1/n each) — 2026-11-19 伤害分摊: off while the rolled targets are on
        const sp = !u.focus && u.side === 'enemy' && spreadOn(run); // 2026-11-19 伤害分摊: the rolled target (intentTarget)
        const front = sp ? intentTarget(run, B, u, af, true) : u.focus ? af[0] : spread ? af[0] : randomAim ? rngPick(run, af) : (u.side === 'ally' || mirrorAlly(u)) && u.role === 'adc' ? aimPick(u, af) : sk.target === 'rightmost' ? af[af.length - 1] : af[0]; // 用户 2026-11-15 L9 探子: an enemy skill may aim at our rightmost
        const fallback = sk.kind === 'heal';
        bon = amountFor(front).b;
        // one hit on t (hit i of n): perks, crit, then the target's own reductions in hit()
        // dk (用户 2026-11-15 刺客连击递减): hit i+1 of her 连击 does i less (after every bonus), never below 1 — logged per hit
        const hitOne = (t, i, n, adj, dk, w) => {
          const pf = perkFlat(t, i, n, fallback);
          if (i === 0 && t === front) pflat = pf;
          else if (i > 0 && pid === 'collect') plater = plater.concat(pf.filter((x) => x.label === pk.name).map((x) => Object.assign({}, x, { hit: i + 1 }))); // 夜鸦「收账」: the +1 on her last hit (log fix 2026-11-15)
          const crit = critOf(t, i);
          const a0 = amountFor(t).amt + (!ally && sk.vary && run.expect ? sk.vary / 2 : !ally && sk.vary ? Math.floor(hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, seq, i, 7) * (sk.vary + 1)) : 0); // 试玩反馈 #3: 史莱姆 1–2
          const base = Math.max(0, adj ? adj(a0) : a0) + sum(pf), dec = dk ? Math.min(i * (dk === true ? 1 : dk), Math.max(0, base - 1)) : 0;
          if (dec) plater.push({ from: u.id, label: TX('battle.comboDecay'), amount: -dec, hit: i + 1 });
          const tr = hit(u, t, base - dec, crit, crit && (ally ? li >= CRIT_PIERCE_LV - 1 : CRIT_PIERCE_ENEMY), w);
          if (crit) tr.crit = true;
          if (crit && !ally && (sk.jackpot || sk.bigEvery > 0)) tr.jackpot = true; // UI tag 「通杀」 (大招 too)
          if (n > 1) tr.hit = i + 1;
          return tr;
        };
        // §D soft heart also applies to each target of a multi-target skill (once per ally per battle)
        const softOrHit = (t, i, n, adj, dk) => {
          if (soft === t) return { uid: t.id, id: t.ref, amount: 0, hpAfter: t.hp, kind: 'damage', miss: true, soft: true };
          if (!soft && softHeart(u, t)) { soft = t; return { uid: t.id, id: t.ref, amount: 0, hpAfter: t.hp, kind: 'damage', miss: true, soft: true }; }
          return hitOne(t, i, n, adj, dk);
        };
        if (sk.kind === 'spark') {
          // 法师 (three-factors, 用户 2026-11-14 final): Lv1 2 targets, +1 per level, main = leftmost, splash left→right.
          // main 威力 · others max(1, ⌊威力/3⌋) · max level: the same, but on everyone. An enemy spark (the bell) hits everyone flat.
          const fsp = foeSplash(u), nT = L5 ? Infinity : ally || girlSparkN(u) || fsp ? SPARK_TARGETS[Math.min(li, SPARK_TARGETS.length - 1)] : Infinity, lv = li + 1; // L5: everyone, full // 2026-11-22 GIRL_SPARK_N: an enemy girl hits as many as her card says
          const list = af.slice(0, nT).filter((t, j) => L5 || !ally || j === 0 || sparkSplash(amountFor(t).amt, lv) > 0);
          const fall = !ally && !fsp && SPLASH_ALL && sk.splashAll; // 2026-11-24 用户「小铃群伤改成第一个全额，其他减半」: everyone, the front-most full, the rest half
          targets = list.map((t, j) => softOrHit(t, 0, 1, L5 ? (a) => sparkMain(a, lv) : fall ? (j === 0 ? null : (a) => sparkSplash(a, lv)) : !ally && !fsp ? null : j === 0 ? (a) => sparkMain(a, lv) : (a) => sparkSplash(a, lv)));
          for (const tr of targets) if (tr.uid !== list[0].id) tr.splash = true;
          // v36 (试玩者 1): the battle text says how many it really hit — 「波及全体」 only for the all-target spark (Lv4 / the bell)
          if (pid === 'prep') u.prepDone = true;
          const sArgs = { name: u.name, skill: sk.name, n: targets.length, hits: targets.map((r) => { const hv = { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount }; return r.jackpot ? TX('battle.sparkHitJackpot', hv) : TX('battle.sparkHit', hv); }).join(TX('list.comma')) };
          text = nT === Infinity ? TX('battle.spark', sArgs) : targets.length > 1 ? TX('battle.sparkN', sArgs) : TX('battle.sparkOne', sArgs);
        } else if (!ally && sk.sweepStep > 0 && alive(foes).length > 1) { // 2026-11-25 用户 露西安「每个人都打一遍，往后每人 −2」: first full 威力, each next one sweepStep less (min 1)
          targets = alive(foes).map((t, i) => hitOne(t, 0, 1, (a) => Math.max(1, a - sk.sweepStep * i)));
          targets.forEach((tr, i) => { tr.line = i; });
          text = TX('battle.multiHit', { name: u.name, skill: sk.name, n: targets.length, hits: targets.map((r) => TX('battle.multiHitItem', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter })).join(TX('list.comma')) });
        } else if (sk.kind === 'backstab') {
          // 连击: hit the first two living foes in turn (re-picked every hit); with one foe left, every hit lands on her
          let n = hitsOf(ally ? sk : null) || 2, extra = false;
          if (!ally) n = li + 2; // enemies: Lv1 2 hits, +1 per level (用户 2026-11-15 第 4–7 关)
          for (let i = 0; i < n; i++) {
            const lv = alive(foes);
            if (!lv.length) break;
            const pair = u.focus && lv.includes(af[0]) ? [af[0]] : sp && targetRuleIn(B, u) === 'rightmost' ? lv.slice(-2).reverse() : lv.slice(0, 2); // 2026-11-19 伤害分摊: a returned rogue (绕) cuts the last two, right first
            const t = pair[i % pair.length];
            const tr = softOrHit(t, i, n, null, ally ? (hasTok(u, 'bladeStorm') && BLADE_STORM_RAMP ? -1 : L5 ? 0 : COMBO_DECAY) : li > 0); // L5: every hit full // 2026-11-19 护符通用: the in-action ramp is BLADE_STORM_RAMP // 刃风护符: each hit +1 instead of −2 // 连击递减: ours −2 per hit (用户 2026-11-15), enemies Lv2+ −1
            targets.push(tr);
            if (pid === 'handy' && !extra && tr.amount > 0 && t.hp <= 0 && alive(foes).length) { extra = true; n += 1; tr.handy = true; } // 琪琪「顺手」
          }
          if (ally && hasTok(u, 'bladeStorm') && !BLADE_STORM_PER_ACTION) u.stormAtk = Math.min(RELIC_STACK_CAP, (u.stormAtk || 0) + targets.filter((r) => !r.miss).length); // 刃风护符 (old, before 2026-11-19): every hit = 威力 +1 for the rest of this battle
          if (n > 1) for (const tr of targets) tr.of = n;
          text = TX('battle.multiHit', { name: u.name, skill: sk.name, n: targets.length, hits: targets.map((r) => (r.pierce ? TX('battle.multiHitItemPierce', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter }) : r.crit ? TX('battle.multiHitItemCrit', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter }) : TX('battle.multiHitItem', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter }))).join(TX('list.comma')) });
        } else if (!ally && sk.kind === 'strike' && hasTrait0(u, 'doubleCut')) { // 用户 2026-11-15 连斩: two cuts at the front-most, the second 1 less
          const n = DOUBLE_CUT_HITS;
          for (let i = 0; i < n; i++) { const lv = alive(foes); if (!lv.length) break; targets.push(hitOne(sp ? (front.hp > 0 ? front : intentTarget(run, B, u, lv, true)) : lv[0], i, n, null, true)); } // 2026-11-19 伤害分摊: both cuts at the rolled target
          for (const tr of targets) tr.of = n;
          text = TX('battle.multiHit', { name: u.name, skill: sk.name, n: targets.length, hits: targets.map((r) => TX('battle.multiHitItem', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter })).join(TX('list.comma')) });
        } else if (IRON_L10 && !ally && sk.front3AfterGuard && !B.enemies.some((x) => x.ref === 'gate-guardian' && x.hp > 0) && alive(foes).length > 1) { // 2026-11-21 用户「石门守卫死掉的话，奥德丽的阵线攻击变成每回合打前排 3 人」
          if (!u.frontLineSaid) { u.frontLineSaid = true; push({ kind: 'line', speaker: 'advisor', speakerId: u.ref, name: u.name, expr: 'special', round: B.round, text: TX('battle.frontLineCall') }); }
          targets = alive(foes).slice(0, 3).map((t) => hitOne(t, 0, 1));
          text = TX('battle.frontLineHit', { name: u.name, skill: sk.name, hits: targets.map((r) => TX('battle.multiHitItem', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter })).join(TX('list.comma')) });
        } else if (!ally && u.enraged && (sk.kind === 'strike' || sk.kind === 'guard') && alive(foes).length > 1) { // 2026-11-20 L9 狂暴: ENRAGE_PIERCE = one shot through the whole line from the front, each one passed halves it (min 1); false = old: both front-most, full 威力
          targets = ENRAGE_PIERCE ? alive(foes).map((t, i) => hitOne(t, 0, 1, (a) => Math.max(1, Math.floor(a / Math.pow(2, i))))) : alive(foes).slice(0, 2).map((t) => hitOne(t, 0, 1));
          if (ENRAGE_PIERCE) targets.forEach((tr, i) => { tr.line = i; }); // UI: one beam through the line, the hits land one after another
          text = TX('battle.enragedHit', { name: u.name, skill: sk.name, hits: targets.map((r) => TX('battle.multiHitItem', { target: foes.find((x) => x.id === r.uid).name, dmg: r.amount, hp: r.hpAfter })).join(TX('list.comma')) });
        } else if (softHeart(u, front)) { // §D: she cannot bring herself to hit a girl she once fought beside
          soft = front;
          targets = [{ uid: front.id, id: front.ref, amount: 0, hpAfter: front.hp, kind: 'damage', miss: true, soft: true }];
          text = TX('battle.softHeart', { name: u.name, skill: sk.name, target: front.name });
        } else {
          targets = spread ? af.map((t) => hitOne(t, 0, 1, null, null, 1 / af.length)) : [hitOne(front, 0, 1)];
          if (L5 && sk.kind === 'aim' && targets[0] && targets[0].overkill > 0 && front.hp <= 0) { // 2026-11-25 Lv5 猎人: the overkill goes on to the next foe — once, no crit, 护甲 first
            const nx = alive(foes)[0];
            if (nx) { const tr2 = hit(u, nx, targets[0].overkill); tr2.passOn = true; targets.push(tr2); }
          }
          { const hv = { name: u.name, skill: sk.name, verb: KIND_VERB()[sk.kind] || TX('skill.verb.attack'), target: front.name, dmg: targets[0].amount, hp: front.hp };
          text = targets[0].pierce ? TX('battle.hitPierce', hv) : targets[0].crit ? TX('battle.hitCrit', hv) : TX('battle.hit', hv);
          if (targets[0].blocked) text += TX('battle.blockAbsorb', { n: targets[0].blocked }); }
          const other = u.side === 'enemy' && hasTrait0(u, 'twinShot') ? alive(foes).filter((x) => x !== front) : [];
          if (other.length) { // feedback-1112 #34 连弩: a second bolt at another random ally
            // 2026-11-19 伤害分摊: the second bolt goes to the rolled second ally (another one if she is down / was hit first)
            const t2sp = sp ? (other.find((x) => u.intent && x.id === u.intent.uids[1]) || other.find((x) => x.id === spreadPickUid(run, B, u, 'backWeighted', alive(foes), B.round, 101, front.id)) || other[0]) : null;
            if (run.expect && !sp) { for (const t2 of other) targets.push(hit(u, t2, Math.max(1, amountFor(t2).amt - TWIN_SHOT_CUT), false, false, 1 / other.length)); } /* 理论值: the second bolt spread */
            const t2 = sp ? t2sp : run.expect ? other[0] : rngPick(run, other);
            if (!run.expect || sp) targets.push(hit(u, t2, Math.max(1, amountFor(t2).amt - TWIN_SHOT_CUT))); // the second bolt is weaker
            text += TX('battle.twinShot', { target: t2.name, dmg: targets[1].amount, hp: t2.hp });
          }
        }
        if (sk.kind === 'guard' && u.hp > 0) { // 盾击 (2026-11-14 护甲): 威力 per share — herself, then (掩护) the nearest living allies behind her
          const src = { name: u.name, skill: sk.name };
          if (!ally) { // enemies.json skill.block overrides (石门守卫 +6, 用户 2026-11-15); Lv2+ (第 4–7 关): the same self / 掩护 shares as ours
            const g = ENEMY_GUARD_LV[li], eb = sk.block || ENEMY_GUARD_BLOCK;
            gainBlock(u, eb * g.self, u.id, true, src);
            const at = mine.indexOf(u);
            for (const x of mine.slice(at + 1).filter((y) => y.hp > 0).slice(0, g.cover)) gainBlock(x, eb, u.id, true, src);
          } else {
            const g = guardLvFor(u.perk, li), pw = Math.max(1, powerFor(front).p - shieldWallOf(u) - relicGrowOf(u)); // 2026-11-19 护符通用 cap: minus the 刃风 / 鹰眼 stacks (RELIC_GUARD_BLOCK) // 用户 2026-11-14: the same 威力 as the hit, temporary bonuses (mood / 怀表 / …) included // 2026-11-17 爆发实验 盾爆流: minus the 铁壁 bonus
            gainBlock(u, guardSelf(pw, g), u.id, true, src); // 2026-11-16: Lv4 +2 // 2026-11-18: × GUARD_SELF_X
            const at = mine.indexOf(u);
            if (L5) { for (const x of mine.filter((y) => y !== u && y.hp > 0)) gainBlock(x, pw, u.id, true, src); } // 2026-11-25 Lv5 盾: the whole team, full 威力
            else for (const x of mine.slice(at + 1).filter((y) => y.hp > 0).slice(0, g.cover)) gainBlock(x, coverGive(pw), u.id, true, src);
          }
        }
        if (pid === 'dent') u.dents = 0;
        if (u.vigil) { u.vigil = 0; u.vigilFrom = null; }
        if (!ally && hasTrait0(u, 'escort') && u.hp > 0) { // 用户 2026-11-15 护队: each living neighbour (left / right) +ESCORT_BLOCK 护甲
          const at = mine.indexOf(u), src = { name: u.name, skill: STATUS_LABELS().escort };
          for (const x of [mine.slice(0, at).reverse().find((y) => y.hp > 0), mine.slice(at + 1).find((y) => y.hp > 0)]) if (x) gainBlock(x, ESCORT_BLOCK, u.id, true, src);
        }
        if (!soft && targets.length && targets.every((t) => t.miss)) text = TX('battle.smokeMiss', { name: u.name, skill: sk.name });
      }
      if (ally) u.lastSeq = seq;
      // bonuses as shown to the player: atk bonuses (collapsed if the skill's math is not linear) + chain depth
      const atkPart = rawAmount(sk.kind, u.atk + sum(bon), !ally) - rawAmount(sk.kind, u.atk, !ally); // 2026-11-15: enemy-aware (an enemy spark is 1 / 2 by 威力 tier)
      let bonuses = bon;
      if (atkPart !== sum(bon)) bonuses = atkPart ? [{ from: u.id, label: listSeq(bon.map((b) => b.label)), amount: atkPart }] : [];
      if (pflat.length) bonuses = bonuses.concat(pflat); // §2 个人特点 (first hit / first target)
      if (plater.length) bonuses = bonuses.concat(plater); // later hits only (entry.hit = which hit), not part of the first hit
      if (u.weak > 0 && !heal) { // 虚弱: what it really took off (威力 never drops below 1 — 用户 2026-11-14: say so when it did nothing)
        // 2026-11-15 log fix: the drop is measured on the damage, not on 威力 — an enemy spark (1 / 2 by tier) may not change at all
        const a0 = u.atk + sum(bon), a1 = Math.max(Math.min(1, a0), a0 - u.weak);
        const drop = rawAmount(sk.kind, a0, !ally) - rawAmount(sk.kind, a1, !ally);
        bonuses = bonuses.concat([drop > 0 ? { from: u.id, label: TX('status.weak'), amount: -drop }
          : { from: u.id, label: a0 - a1 > 0 ? TX('status.weakNoneStep') : TX('status.weakNone'), amount: 0, noEffect: true }]);
      }
      if (k) bonuses = bonuses.concat([{ from: from || u.id, ic: 'chain', label: TX('battle.bonus.chain', { k }), amount: CHAIN_POWER }]); // 加成: 威力 +1
      if (k) text += TX('battle.chainSuffix', { k });
      const mult = B.mult || 1;
      if (mult > 1 && !heal && !soft) { // §C: the frenzy share of the first hit, so base + bonuses still add up
        const pre = amountFor(targets.length ? foes.find((x) => x.id === targets[0].uid) || af[0] : af[0]).amt + sum(pflat); // 2026-11-15: + the first hit's perk bonus (it is multiplied too)
        bonuses = bonuses.concat([{ from: 'frenzy', ic: 'frenzy', label: TX('battle.bonus.frenzy', { mult }), amount: pre * (mult - 1) }]);
      }
      const entry = { kind: 'action', round: rnd, side: u.side, actor: u.id, actorId: u.ref, skill: sk.name, skillKind: sk.kind,
        chainId: st ? st.chainId : null, chainDepth: k || 0, base, bonuses, targets, text };
      if (heal) entry.heal = true;
      if (lucky && targets.some((t) => t.lucky) && u.side === 'ally') charmFeed(B, 'luckCharm', 'luckCharmAtk', 1); // 2026-11-22 幸运护符: an ally's 好运一击
      if (targets.some((t) => t.doom)) { entry.doom = true; entry.text = (entry.text || '') + TX('battle.doomSuffix', { roll: u.luckRoll, n: -luckNow(u) }); } // 2026-11-22 厄运
      if (lucky && targets.some((t) => t.lucky)) { entry.lucky = true; entry.luckRoll = u.luckRoll; entry.text = (entry.text || '') + TX('battle.luckySuffix', { roll: u.luckRoll, luck: luckNow(u) }); } // 2026-11-20 幸运「好运一击」
      const nh = targets.filter((t) => t.hit).length, nc = targets.filter((t) => t.crit).length;
      if (nh > 1) entry.hits = nh; // DESIGN-skill-level §4: 连击 (one blow, nh hits)
      if (nc) entry.crits = nc;
      if (ally) entry.skillLv = lvOf(sk);
      else if (li > 0) entry.skillLv = li + 1; // 用户 2026-11-15: an enemy above Lv1 says so in the log
      if (mult > 1) entry.mult = mult;
      if (B.burst) entry.burst = { i: B.burst.i, n: B.burst.n };
      if (ally && !coat(u) && !heal && hasSear(u)) for (const tr of targets) { // 2026-11-19 护符通用 烈焰护符: ANY class holder, ANY level — every hit she lands = 灼烧 +SEAR_ADD on that enemy (was: the Lv3+ mage only)
        const x = tr.kind === 'damage' && !tr.miss ? foes.find((f) => f.id === tr.uid) : null;
        if (!(x && x.hp > 0)) continue;
        if (!(x.burnUntil >= B.round)) x.burnStack = 0;
        if (SEAR_PER_ROUND) { x.searBy = x.searBy || {}; if (x.searBy[u.id] === B.round) { tr.burn = x.burnStack > 0; continue; } x.searBy[u.id] = B.round; } // 2026-11-23 用户「每回合被打中一次多一层焚痕——法师群伤最好用」
        x.burnStack = Math.min(SEAR_CAP, (x.burnStack || 0) + SEAR_ADD); x.burnUntil = SEAR_KEEP ? SEAR_FOREVER : B.round + 1; x.burnFrom = u.id; tr.burn = true;
      } else
      if (ally && !coat(u) && sk.kind === 'spark' && !heal && li >= BURN_LV - 1) for (const tr of targets) { // 2026-11-16 灼烧 (after this hit; refresh only)
        const x = tr.kind === 'damage' && !tr.miss ? foes.find((f) => f.id === tr.uid) : null;
        if (x && x.hp > 0 && hasSear(u)) { // 2026-11-17 爆发实验 法师刺客流: 烈焰护符 — stacks (+SEAR_ADD per hit), kept all battle when SEAR_KEEP
          if (!(x.burnUntil >= B.round)) x.burnStack = 0;
          x.burnStack = Math.min(SEAR_CAP, (x.burnStack || 0) + SEAR_ADD); x.burnUntil = SEAR_KEEP ? SEAR_FOREVER : B.round + 1; x.burnFrom = u.id; tr.burn = true;
        } else
        if (x && x.hp > 0) { const kept = x.burnStack > 0 && x.burnUntil >= B.round; x.burnUntil = Math.max(x.burnUntil || 0, B.round + 1); if (!kept) x.burnFrom = u.id; tr.burn = true; } // 2026-11-19 护符通用: never cuts short (or re-labels) a 烈焰 holder's stacks — was x.burnUntil = B.round + 1; x.burnFrom = u.id
      }
      if (ally && !coat(u) && heal && HOLY_SPRING_HEAL_OLD && hasTok(u, 'holySpring')) { // 2026-11-19 文字修: behind HOLY_SPRING_HEAL_OLD // 2026-11-17 爆发实验 牧师供能流: whoever she healed gets +GIVE pips (normal action: in giveCharge, can raise; released: pips stay)
        const ids = [...new Set(targets.filter((tr) => tr.kind === 'heal' && !tr.capped).map((tr) => tr.uid))];
        if (!free) u.springTo = ids;
        else for (const id of ids) { const x = mine.find((m) => m.id === id); if (x && x.hp > 0 && !broken(x)) { const before = x.charge || 0; x.charge = before + HOLY_SPRING_GIVE; pending.push({ kind: 'charge', round: B.round, side: u.side, from: u.id, to: x.id, amount: HOLY_SPRING_GIVE, before, after: x.charge, gen: 0, text: TX('battle.charge', { name: u.name, target: x.name, n: HOLY_SPRING_GIVE }) }); } }
      }
      if (((ally && !coat(u)) || (!ally && u.traits && u.traits.includes('bless'))) && heal && li >= BLESS_LV - 1 && !(HOLY_SPRING_HEAL_OLD && hasTok(u, 'holySpring'))) for /* 2026-11-19 文字修: the new 圣泉 no longer replaces 祝福 */ (const tr of targets) { // 2026-11-16 祝福 (refresh only)
        const x = mine.find((m) => m.id === tr.uid);
        if (x && x.hp > 0) { x.blessUntil = B.round + 1; x.blessFrom = u.id; tr.bless = true; }
      }
      push(entry);
      if (u.chargeDrain > 0 && !heal) for (const tr of targets) { // 充能 hook (no enemy uses it yet): each hit takes chargeDrain pips off its target
        const x = tr.kind === 'damage' && tr.amount > 0 ? foes.find((f) => f.id === tr.uid) : null;
        if (x && x.charge > 0) x.charge = Math.max(0, x.charge - Math.floor(u.chargeDrain));
      }
      if (u.leech > 0 && u.hp > 0 && !heal) { // 2026-11-18 妮可塔 L10 食尸鬼「吸血」: leech × the hp it took off us → the lowest-hp-share wounded comrade
        const got = targets.reduce((n, tr) => n + (tr.kind === 'damage' && !tr.miss ? tr.amount || 0 : 0), 0);
        const pal = alive(mine).filter((x) => x.hp < x.maxHp).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp || mine.indexOf(x) - mine.indexOf(y))[0];
        const h = pal ? Math.min(Math.ceil(got * u.leech - 1e-9), pal.maxHp - pal.hp) : 0;
        if (h > 0) {
          pal.hp += h; u.leeched = (u.leeched || 0) + h;
          push({ kind: 'leech', round: B.round, side: u.side, from: u.id, to: pal.id, amount: h, targets: [{ uid: pal.id, id: pal.ref, amount: h, hpAfter: pal.hp, kind: 'heal' }], text: TX('battle.leech', { name: u.name, target: pal.name, n: h }) });
        }
        // 2026-11-18 妮可塔 L10「供奉」: a leechBoss ghoul feeds her the same L it leeched (L = ⌈hp taken × leech⌉, her missing hp at most;
        // not twice when she was the one it healed). Event 'leech' with boss: true.
        const boss = u.leechBoss ? alive(mine).find((x) => x.advisorBoss && x !== pal) : null;
        const hb = boss && got > 0 ? Math.min(Math.ceil(got * u.leech - 1e-9), boss.maxHp - boss.hp) : 0;
        if (hb > 0) {
          boss.hp += hb; u.leeched = (u.leeched || 0) + hb;
          push({ kind: 'leech', boss: true, round: B.round, side: u.side, from: u.id, to: boss.id, amount: hb, targets: [{ uid: boss.id, id: boss.ref, amount: hb, hpAfter: boss.hp, kind: 'heal' }], text: TX('battle.leechBoss', { name: u.name, target: boss.name, n: hb }) });
        }
      }
      if (u.hp > 0 && !heal) { // 2026-11-17 用户「荆棘」: every hit that lands on a thorned foe (hp or 护甲) sends thorns back to the hitter — counts hits, not damage
        let back = 0;
        const once = new Set(); let bellBack = false;
        for (const tr of targets) { const x = tr.kind === 'damage' && !tr.miss && (tr.amount > 0 || tr.blocked > 0) ? foes.find((f) => f.id === tr.uid) : null; if (x && x.thorns > 0 && !(x.thornsOnce && once.has(x.id))) { back += x.thorns; if (x.thornsOnce) once.add(x.id); if (x.thornsBell) bellBack = true; } } // 2026-11-21 诅咒之铃: once per attack
        if (back > 0) {
          const blocked = Math.min(u.block || 0, back), dmg = back - blocked;
          if (blocked) u.block -= blocked;
          u.hp = Math.max(0, u.hp - dmg); u.taken = (u.taken || 0) + dmg;
          const tt = [{ uid: u.id, id: u.ref, amount: dmg, blocked, blockAfter: u.block || 0, hpAfter: u.hp, kind: 'damage' }];
          push({ kind: 'thorns', round: B.round, side: u.side === 'ally' ? 'enemy' : 'ally', to: u.id, amount: back, targets: tt, text: bellBack ? TX('battle.thornsBell', { name: u.name, n: back }) : TX('battle.thorns', { name: u.name, n: back }) });
          downs(tt, u.side === 'ally' ? B.allies : B.enemies);
        }
      }
      u.actions = (u.actions || 0) + 1;
      if (ally && !coat(u) && SHIELD_WALL_ALLY) for (const x of B.allies) if (x !== u && x.hp > 0) wallFeed(x, SHIELD_WALL_ALLY, u.id); // 2026-11-17 爆发实验 盾爆流: a teammate acted
      if (k) u.maxChain = Math.max(u.maxChain || 0, k);
      while (pending.length) push(pending.shift());
      if (!heal) pickpocket(u, targets); // feedback-1112 #34
      if (soft) softLine(u, soft);
      const dmgT = targets.filter((t) => t.kind === 'damage'); // a heal may carry 葛蕾's refund hit
      const kills = dmgT.length ? downs(dmgT, foes) : 0;
      const downedNow = kills ? dmgT.map((t) => foes.find((x) => x.id === t.uid)).filter((x) => x && x.hp <= 0) : []; // 2026-11-19 试玩修 剧情: who fell (for her kill line)
      u.kills = (u.kills || 0) + kills;
      const kc = u.side === 'ally' && !coat(u) ? killCallFor(kills) : null; // SPEC-11-13 F: Double Kill …
      if (kc) {
        entry.killCall = kc;
        const who = isLeader(u.id) ? LEADER_ID : u.ref, ls = multiKillLines(data, who);
        if (ls.length && !downedNow.some(girlFoe)) { B.mkSkip = u.id; /* 2026-11-19 试玩修 剧情: a girl we knew fell too → her kill line instead */ push(lineEvent(data, run, ls[(B.round + u.kills + seq) % ls.length], { name: u.name }, who, { id: who, uid: u.id, key: 'bark', bark: 'multiKill', round: B.round })); }
      }
      const damage = heal ? 0 : dmgT.reduce((s, t) => s + t.amount, 0);
      if (st) { st.total += heal ? 0 : damage; if (k) { st.links += 1; st.max = Math.max(st.max, k); } }
      if (u.side === 'enemy' && u.candidate && u.corruption && !heal && u.hp > 0 && revengeLine(u)) { /* §E her revenge line */ }
      else if (u.corruption === 'vengeful' && u.grudge === 'high' && damage > 0 && !u.hitLineDone) { u.hitLineDone = true; v2Line(u, ['vengeful', 'high', 'hit']); }
      if (u.side === 'ally' && !soft && !coat(u)) bark(u, kills, heal, downedNow);
      B.mkSkip = null;
      if (u.side === 'ally' && !heal) { const hurt = targets.map((tr) => foes.find((x) => x.id === tr.uid)).find((x) => x && x.hp > 0 && targets.some((tr) => tr.uid === x.id && tr.amount > 0)); if (hurt) enemyBark(hurt, 'hurt'); }
      if (u.side === 'enemy' && !heal && u.hp > 0) enemyBark(u, 'attack');
      if (u.ref === 'fairy-demon' && u.side === 'enemy' && u.hp > 0 && rngNext(run) < 0.4) push(lineEvent(data, run, pickOne(run, fairyLines(data, 'attack')), {}, 'fairy-demon', { id: u.ref, uid: u.id, key: 'fairy.attack', round: rnd }));
      if (ally && SHIELD_WALL_ACT && hasWall(u)) { u.wallActs = (u.wallActs || 0) + 1; gainBlock(u, Math.min(SHIELD_WALL_ACT_CAP, SHIELD_WALL_ACT * (SHIELD_WALL_ACT_PROG ? u.wallActs : 1)), u.id, false, { name: u.name, skill: TX('token.shieldWall') }); } // 2026-11-19 merge spread: was wallFeed (silent, no block event → the badge drifted from the engine; block-sync caught it once a 铁壁 priest reached L8); same numbers, now logged // 2026-11-17 爆发实验 盾爆流: every action she takes (burst ones too)
      // 2026-11-20 用户「圣泉：普通人带着每次行动自己威力 +1，牧师带着改成全队 +1；最多 +4」(HOLY_SPRING_V4): springAtk caps at
      // HOLY_SPRING_V4_CAP per person; false = v3 below (priest: skill-level random allies · others: +1 to whoever she charges)
      if (HOLY_SPRING_V5 && ally && !coat(u) && heal && hasTok(u, 'holySpring')) { // 2026-11-23 用户「圣泉改成 被治疗的人 每次被治疗威力 +1」: each ally she heals (amount > 0) 威力 +1, up to HOLY_SPRING_V4_CAP each
        for (const id of new Set(targets.filter((tr) => tr.kind === 'heal' && tr.amount > 0).map((tr) => tr.uid))) { const x = mine.find((m) => m.id === id); if (x && x.hp > 0 && (x.springAtk || 0) < HOLY_SPRING_V4_CAP) { x.springAtk = (x.springAtk || 0) + 1; x.springFrom = u.id; } }
      }
      if (!HOLY_SPRING_V5 && HOLY_SPRING_V4 && ally && !coat(u) && hasTok(u, 'holySpring')) {
        const who = sk.kind === 'heal' ? B.allies.filter((x) => x.hp > 0 && !x.turned) : [u];
        for (const x of who) if ((x.springAtk || 0) < HOLY_SPRING_V4_CAP) { x.springAtk = (x.springAtk || 0) + 1; x.springFrom = u.id; }
      }
      if (!HOLY_SPRING_V4 && ally && !coat(u) && !HOLY_SPRING_HEAL_OLD && sk.kind === 'heal' && hasTok(u, 'holySpring')) { // 2026-11-19 文字修 圣泉 v3 (用户「几级就随机加几个人」): priest holder, every action = (her skill level) random living allies 威力 +1 — herself included; v2 was the whole team
        const pool = B.allies.filter((x) => x.hp > 0 && !x.turned && (x.springTeam || 0) < HOLY_SPRING_TEAM_CAP);
        const pick = HOLY_SPRING_TEAM_ALL ? pool : pool.map((x, i) => ({ x, r: hashRand(run.seed || 0, B.level || 0, B.wi || 0, B.round || 0, u.actions || 0, i, 17) })).sort((a, b) => a.r - b.r).slice(0, li + 1).map((o) => o.x);
        for (const x of pick) { x.springTeam = (x.springTeam || 0) + 1; x.springAtk = (x.springAtk || 0) + HOLY_SPRING_TEAM; x.springFrom = u.id; }
      }
      if (ally && !coat(u) && BLADE_STORM_ROUND && hasTok(u, 'bladeStorm')) u.stormAtk = Math.min(RELIC_STACK_CAP, (u.stormAtk || 0) + targets.filter((r) => r.kind === 'damage' && !r.miss).length); // 2026-11-23 every hit this round
      else if (ally && !coat(u) && BLADE_STORM_PER_ACTION && hasTok(u, 'bladeStorm')) u.stormAtk = Math.min(RELIC_STACK_CAP, (u.stormAtk || 0) + BLADE_STORM_ATK); // 2026-11-19 护符通用: 刃风 — every action (burst ones too), any class
      if (ally && sk.kind === 'aim' && hasTok(u, 'hawkEye')) u.hawkX = (u.hawkX || 0) + HAWK_EYE_X; // 2026-11-17 爆发实验 猎人暴击流: every action she takes (burst ones too) → crit x +0.5 from her next one
      if (!free && u.side === 'enemy' && u.xlPhase === 2 && u.hp > 0 && !(XL_P2_BELL && u.xlMark != null)) xlPlaceMark(u, null); // 2026-11-19 小铃强 玩偶弱: her first phase-2 action rings the bell, then marks
      return { damage, kills, healed: heal && healAmt > 0, guard: !heal && sk.kind === 'guard' };
    }
    function neighbour(arr, u, dir) {
      const i = arr.indexOf(u);
      if (dir === 'next') { for (let j = i + 1; j < arr.length; j++) if (arr[j].hp > 0) return arr[j]; }
      else for (let j = i - 1; j >= 0; j--) if (arr[j].hp > 0) return arr[j];
      return null;
    }
    // DESIGN-2026-11-15-charge §1.1: after an action of generation gen (0 = her normal action), she charges her living
    // neighbour(s) in her direction (left before right): k × keep^gen (keep 0.5, 发绳 0.75). A broken (mood −2) member neither gives nor takes. A receiver
    // who reached EXTRA_CAP extra actions this round takes nothing. Whoever reaches CHARGE_FULL joins the FIFO queue (gen + 1).
    // Hooks: u.chargeLock > 0 → she gives nothing (anti-charge enemies, later).
    // 2026-11-21 回声耳坠 (用户「每当一个行动中有队友充能，自己 +1」): after one action's charge spread, a holder gets +ECHO_EAR once
    // if any OTHER ally's charge went up in it (self-pips of the actor count — she is a teammate; her own don't)
    function giveCharge(u, gen, q, st) {
      const echo = u.side === 'ally' ? B.allies.filter((x) => x.hp > 0 && !coat(x) && hasTok(x, 'echoEar')) : [];
      const charm = u.side === 'ally' && B.allies.some((x) => x.hp > 0 && hasTok(x, 'chargeCharm'));
      const was = echo.length || charm ? new Map(B.allies.map((x) => [x, x.charge || 0])) : null;
      giveCharge0(u, gen, q, st);
      if (charm && B.allies.some((y) => (y.charge || 0) > was.get(y))) { B.chargeCharmN = (B.chargeCharmN || 0) + 1; if (B.chargeCharmN % CHARGE_CHARM_EVERY === 0) charmFeed(B, 'chargeCharm', 'chargeCharmAtk', 1); } // 用户「每两次行动 +1」 // 2026-11-22 充能护符: +1 once per action that charged anyone (用户「一次行动只算一次」; was +1 per ally charged)
      for (const x of echo) {
        if (!B.allies.some((y) => y !== x && (y.charge || 0) > was.get(y)) || (x.extraRound || 0) >= EXTRA_CAP || broken(x) || x.hp <= 0) continue;
        const before = x.charge || 0; x.charge = before + ECHO_EAR;
        push({ kind: 'charge', round: B.round, side: 'ally', self: true, echo: true, chainId: st ? st.chainId : null, from: x.id, to: x.id, amount: ECHO_EAR, before, after: x.charge, gen,
          text: TX('battle.chargeEcho', { name: x.name, n: ECHO_EAR }) });
        enqueue(q, x, gen + 1, x.id);
      }
    }
    function giveCharge0(u, gen, q, st) {
      if (u.hp <= 0 || u.chargeLock > 0 || broken(u)) return;
      const ours = ((u.side === 'ally' && !coat(u)) || mirrorAlly(u)) && !!u.skill, ulv = ours ? lvOf(u.skill) : 0;
      if (ours && (u.extraRound || 0) < EXTRA_CAP) { // class self-pips only (法师 Lv3, 试射护符); the generic SELF_CHARGE is 0 since 2026-11-16
        const n = SELF_CHARGE + (u.skill.kind === 'spark' && ulv >= SPARK_SELF_LV ? SPARK_SELF : 0) + (hasTok(u, 'arrowCharge') ? TEST_ARROW_CHARGE : 0) /* 2026-11-19 护符通用: 试射护符 any class (was u.skill.kind === 'aim') */ + (hasTok(u, 'flint') ? FLINT_SELF : 0) /* 2026-11-21 随身打火石 */, before = u.charge || 0;
        if (n > 0) {
        u.charge = before + n;
        push({ kind: 'charge', round: B.round, side: u.side, self: true, chainId: st ? st.chainId : null, from: u.id, to: u.id, amount: n, before, after: u.charge, gen,
          text: TX('battle.chargeSelf', { name: u.name, n }) });
        }
      }
      if (ours && u.springTo) { // 2026-11-17 爆发实验 牧师供能流 圣泉护符: +GIVE to everyone her heal just reached (normal charge: halved per generation, may raise)
        const ids = u.springTo, amt = chargeAt(HOLY_SPRING_GIVE, chargeKeep(u), gen), mine = B.allies;
        u.springTo = null;
        if (amt > 0) for (const id of ids) {
          const t = mine.find((x) => x.id === id);
          if (!t || t.hp <= 0 || broken(t) || (t.extraRound || 0) >= EXTRA_CAP) continue;
          const store = storeOf(B, t), n = amt + store, before = t.charge || 0;
          t.charge = before + n;
          push({ kind: 'charge', round: B.round, side: u.side, chainId: st ? st.chainId : null, from: u.id, to: t.id, amount: n, before, after: t.charge, gen,
            text: TX('battle.charge', { name: u.name, target: t.name, n }) });
          enqueue(q, t, gen + 1, u.id);
        }
      }
      let dir = chargeDirOf(u);
      if (!dir) return;
      if (ours && ulv < NEIGHBOUR_LV) return;
      const storm = ours && u.skill.kind === 'backstab' && hasTok(u, 'bladeStorm');
      if (storm && BLADE_STORM_GIVE) dir = 'both'; // 刃风护符 (old): both sides at any level — off since 2026-11-17
      if (ours && dir === 'both' && ulv < BOTH_SIDES_LV && !storm) dir = 'next'; // 2026-11-16: ↔ at Lv1 → right side only (her per-side k)
      const mine = u.side === 'ally' ? B.allies : B.enemies;
      const bsGive = ours && u.skill.kind === 'backstab' && ulv >= BACKSTAB_GIVE_LV ? BACKSTAB_GIVE * hitsOf(u.skill) : 0; // 2026-11-16 刺客 Lv3+: +1 per hit to her arrow side
      const amt = chargeAt(chargeK(B, u) + bsGive + (storm ? BLADE_STORM_GIVE * hitsOf(u.skill) : 0), chargeKeep(u), gen);
      if (!(amt > 0)) return; // 0 = nothing at all
      const targets = dir === 'all' ? mine.filter((x) => x !== u && x.hp > 0) : (dir === 'both' ? ['prev', 'next'] : [dir]).map((d) => neighbour(mine, u, d));
      for (const t of targets) {
        if (!t || t.hp <= 0 || broken(t) || (t.extraRound || 0) >= EXTRA_CAP) continue;
        const store = storeOf(B, t), n = amt + store, before = t.charge || 0, after = before + n;
        t.charge = after;
        hawkFed(t, n); // 2026-11-17 爆发实验 猎人暴击流
        if (!HOLY_SPRING_V4 && ours && u.skill.kind !== 'heal' && hasTok(u, 'holySpring') && (t.springAny || 0) < HOLY_SPRING_ANY_CAP) { t.springAny = (t.springAny || 0) + 1; t.springAtk = (t.springAtk || 0) + HOLY_SPRING_ANY; t.springFrom = u.id; } // 2026-11-19 文字修 圣泉通用: any non-priest holder, +威力 per charge she gives
        wallFeed(t, n * SHIELD_WALL_PIP, u.id); // 2026-11-17 爆发实验 盾爆流
        const e = { kind: 'charge', round: B.round, side: u.side, chainId: st ? st.chainId : null, from: u.id, to: t.id, amount: n, before, after, gen,
          text: TX('battle.charge', { name: u.name, target: t.name, n }) };
        if (store) { e.give = amt; e.store = store; }
        push(e);
        enqueue(q, t, gen + 1, u.id);
      }
    }
    function broken(x) { return x.side === 'ally' && !x.noMood && x.mood <= -2; } // 原来: a −2 member never starts a chain and never answers one
    function enqueue(q, t, gen, from) {
      if ((t.charge || 0) >= fullOf(t) && (t.extraRound || 0) < EXTRA_CAP && !q.some((x) => x.t === t)) q.push({ t, gen, from });
    }
    // CONTRACT-2026-11-16-charge-release「先蓄后放」(用户拍板): the queue, first in first out — whoever is full spends CHARGE_FULL and
    // is RAISED (kind 'raise', stack +1), and counts as having acted: she passes charge on at once (neighbours by her arrow, halved per
    // generation) — no damage, no 盾挨打 pips. Can't act right now (down / dazed / slow start): not raised, nothing spent.
    // When the spreading stops: kind 'release' (left → right), then each raised one plays her n actions in one go (burst {i, n},
    // chainDepth = the generation of her first raise, 威力 +CHAIN_POWER). Released actions charge nobody (already counted while raising).
    function drainQueue(q, ps, st) {
      const side = st.side || (q[0] && q[0].t.side);
      while (q.length) {
        const { t, gen, from } = q.shift();
        if (t.hp <= 0 || (t.charge || 0) < fullOf(t) || (t.extraRound || 0) >= EXTRA_CAP) continue;
        if (t.side === 'enemy' && !mirrorAlly(t) && ps.count >= ENEMY_EXTRA_MAX) continue; // 2026-11-21 真正的镜像: no side cap for a doll // their side: at most 3 extra actions a round (pips kept)
        if (skipReason(t, true)) continue;
        t.charge -= fullOf(t);
        t.extraRound = (t.extraRound || 0) + 1; t.extraTotal = (t.extraTotal || 0) + 1;
        ps.count += 1;
        if (!(t.raised > 0)) { t.raised = 0; t.raiseGen = Math.max(1, gen); t.raiseFrom = from; }
        t.raised += 1;
        if (SHIELD_WALL_FULL && hasWall(t)) { t.wallFills = (t.wallFills || 0) + 1; gainBlock(t, SHIELD_WALL_FULL + SHIELD_WALL_FULL_STEP * (t.wallFills - 1), t.id, false, { name: t.name, skill: TX('token.shieldWall') }); } // 2026-11-19 merge spread: was wallFeed (silent) — same numbers, now a logged block event // 2026-11-17 爆发实验 盾爆流 (v3 累进): the k-th fill-up gives 10 + 5(k − 1)
        push({ kind: 'raise', round: B.round, side: t.side, chainId: st.chainId, from, to: t.id, stack: t.raised, left: t.charge, gen,
          text: TX('battle.raise', { name: t.name, n: t.raised }) });
        giveCharge(t, gen, q, st); // as if she acted (no hit)
        enqueue(q, t, gen, from); // still ≥ 10: once more
      }
      releaseRaised(side || st.side, st);
    }
    // 猎人锁定 (CONTRACT-2026-11-16「猎人锁定」): u.aimLock = the enemy uid she was told to shoot (battle-only). Locked and alive →
    // that one; no lock → aimTarget (leftmost). A locked enemy that is down moves the lock (moveAim, at the moment it drops).
    // 2026-11-20 牧师治疗 (HEAL_TRIAGE): uid → the damage the enemies' rolled intents aim at each of OUR units this round (an
    // estimate: the skill's base amount, a rogue's hits shared over her targets, the toll's n; 护甲 is counted by the caller).
    // Only for our side and only while the intents are rolled (伤害分摊); an enemy priest gets {} (→ the most-missing rule).
    function healThreat(mine) {
      const m = {};
      if (mine !== B.allies || !spreadOn(run)) return m;
      for (const e of B.enemies || []) {
        if (!(e.hp > 0)) continue;
        const iv = intentView(run, B, e);
        if (!iv || iv.kind === 'heal') continue;
        const s = e.skill || {}, elv = e.elv || 1;
        const ids = iv.all ? B.allies.filter((x) => x.hp > 0).map((x) => x.id) : iv.targets;
        if (!ids.length) continue;
        const d = e.toll && iv.all ? (e.toll.n || 0) : rawAmount0(s.kind, e.atk || 0, true) + (s.kind === 'spark' ? elv - 1 : 0);
        const hits = s.kind === 'backstab' ? Math.ceil((elv + 1) / ids.length) : 1;
        for (const id of ids) m[id] = (m[id] || 0) + d * hits;
      }
      return m;
    }
    function aimPick(u, af) {
      if (AIM_TARGET === 'lock' && u.aimLock) {
        const t = af.find((x) => x.id === u.aimLock);
        if (t) return t;
        const x = B.enemies.find((e) => e.id === u.aimLock);
        if (x) moveAim(x); else { u.aimLock = null; push({ kind: 'aim', round: B.round, id: u.id, target: null, auto: true, text: TX('battle.aimClear', { name: u.name }) }); }
        const t2 = u.aimLock && af.find((y) => y.id === u.aimLock);
        if (t2) return t2;
      }
      return aimTarget(af);
    }
    function moveAim(dead) { // the nearest living enemy to its right, else the nearest to its left; every hunter locked on it follows
      if (!dead || dead.side !== 'enemy') return;
      if (AIM_SKIP_FALLEN) for (const a of B.allies) if (a.hp <= 0 && a.aimLock === dead.id) a.aimLock = null; // round-3 #4: fallen hunters drop it quietly
      const hunters = B.allies.filter((a) => a.aimLock === dead.id);
      if (!hunters.length) return;
      const i = B.enemies.indexOf(dead);
      const right = B.enemies.slice(i + 1).find((e) => e.hp > 0), left = B.enemies.slice(0, Math.max(0, i)).reverse().find((e) => e.hp > 0);
      const nt = right || left || null;
      for (const h of hunters) {
        h.aimLock = nt ? nt.id : null;
        push({ kind: 'aim', round: B.round, id: h.id, target: h.aimLock, auto: true,
          text: nt ? TX('battle.aimMove', { name: h.name, target: nt.name }) : TX('battle.aimClear', { name: h.name }) });
      }
    }
    // 试玩反馈 2026-11-16 #2 石门守卫「地震」: every living ally loses base + step × (earlier quakes) — 护甲 first, then hp. No crit,
    // no 坚韧, no 盾挨打 pips (it is not a hit). Event 'quake' (CONTRACT-2026-11-16): targets [{ uid, amount, blocked, hpAfter }].
    function quake(u) {
      // 2026-11-16 试玩后: amount by the wave's round — the k-th quake slot (round every·k of the wave) hits base + step·(k−1);
      // every 1 → round 1: base, round 2: base + step … (was base + step × earlier quakes)
      const q = u.quake, wr = (B.round || 1) - (B.waveStart || 1) + 1, slot = Math.max(1, Math.floor(wr / (q.every || 2)));
      const n = (q.base || 2) + (q.step == null ? 1 : q.step) * (slot - 1);
      u.quakes = (u.quakes || 0) + 1; u.quakeRound = B.round;
      const targets = [];
      for (const t of alive(B.allies)) {
        const blocked = Math.min(t.block || 0, n), dmg = n - blocked;
        if (blocked) t.block -= blocked;
        t.hp = Math.max(0, t.hp - dmg);
        t.taken = (t.taken || 0) + dmg;
        u.damage = (u.damage || 0) + dmg;
        targets.push({ uid: t.id, id: t.ref, amount: dmg, blocked, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' }); // blockAfter: the 护甲 badge (and RoundPlan.blockStart) follow it
      }
      push({ kind: 'quake', round: B.round, side: 'enemy', from: u.id, amount: n, targets, text: TX('battle.quake', { name: u.name, n }) + groupHitEach(B.allies, targets) });
      downs(targets, B.allies);
    }
    // 2026-11-20 L5 钟楼守卫「钟响」: every living ally loses toll.n — 护甲 first, then hp (the 地震 rules: no crit, no 坚韧). Event
    // 'quake' with toll: true (the UI shakes the field the same way, its banner says the bell)
    function toll(u) {
      const n = u.toll.n || 4, targets = [];
      u.tolls = (u.tolls || 0) + 1; u.lastToll = B.round;
      for (const t of alive(B.allies)) {
        const blocked = Math.min(t.block || 0, n), dmg = n - blocked;
        if (blocked) t.block -= blocked;
        t.hp = Math.max(0, t.hp - dmg);
        t.taken = (t.taken || 0) + dmg;
        u.damage = (u.damage || 0) + dmg;
        targets.push({ uid: t.id, id: t.ref, amount: dmg, blocked, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' });
      }
      push({ kind: 'quake', toll: true, round: B.round, side: 'enemy', from: u.id, amount: n, targets, text: (u.toll.noBell ? TX('battle.allOut', { name: u.name, n }) /* 2026-11-25: was a 2nd 'battle.charge' key that overwrote the 充能 line */ : TX('battle.toll', { name: u.name, n })) + groupHitEach(B.allies, targets) });
      downs(targets, B.allies);
    }
    // 2026-11-20 L7 分裂史莱姆: a split unit hit and still standing splits (at the next check): it keeps half its hp (rounded up),
    // a copy with the other half comes in on its right — max hp halves too, and both lose split.atkDrop (default 1) 威力. Never more than split.cap living split units on the
    // side, and a 1-hp slime does not split. Event 'summon' (split: true, parent { uid, hp, maxHp }).
    function splitCheck() {
      for (const u of B.enemies.slice()) {
        if (!u.splitDue) continue;
        u.splitDue = false;
        if (!(u.hp > 1) || !u.split) continue;
        if (alive(B.enemies).filter((x) => x.split).length >= (u.split.cap || 6)) continue;
        const a = Math.ceil(u.hp / 2), b = u.hp - a, mx = Math.ceil(u.maxHp / 2);
        u.hp = a; u.maxHp = Math.max(a, mx); u.atk = Math.max(1, u.atk - (u.split.atkDrop != null ? u.split.atkDrop : 1)); // smaller slimes hit softer (威力 −atkDrop each split)
        B.splitSeq = (B.splitSeq || 0) + 1;
        const c = Object.assign({}, u, { id: `${u.id}-k${B.splitSeq}`, hp: b, maxHp: Math.max(b, mx), block: 0, damage: 0, healing: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, acts: 0,
          charge: 0, extraRound: 0, extraTotal: 0, intent: null, splitDue: false, burnStack: 0, burnUntil: 0, burnFrom: null, skill: clone(u.skill), split: clone(u.split) });
        if (Array.isArray(u.traits)) c.traits = u.traits.slice();
        const di = B.enemies.findIndex((x) => x.split && x.hp <= 0); // a fallen slime's card makes room (its stats go to B.gone), like the summons
        if (di >= 0) { B.gone = (B.gone || []).concat([statRow(B.enemies[di])]); c.slotOf = B.enemies[di].id; B.enemies[di] = c; } else B.enemies.splice(B.enemies.indexOf(u) + 1, 0, c);
        push({ kind: 'summon', split: true, round: B.round, uid: u.id, units: [unitView(data, B, c)], slots: c.slotOf ? [{ uid: c.id, was: c.slotOf }] : [], parent: { uid: u.id, hp: u.hp, maxHp: u.maxHp }, text: TX('battle.split', { name: u.name }) });
      }
    }
    function releaseRaised(side, st) {
      const arr = side === 'ally' ? B.allies : B.enemies;
      const up = arr.filter((u) => u.raised > 0);
      if (!up.length) return;
      push({ kind: 'release', round: B.round, side, chainId: st.chainId, order: up.map((u) => ({ to: u.id, n: u.raised })),
        text: TX('battle.release', { names: listSeq(up.map((u) => u.name)) }) });
      for (const u of up) {
        const n = u.raised, gen = u.raiseGen || 1, from = u.raiseFrom;
        u.raised = 0; u.raiseGen = 0; u.raiseFrom = null;
        for (let i = 1; i <= n; i++) {
          if (check()) { for (const x of up) { x.raised = 0; x.raiseGen = 0; x.raiseFrom = null; } return; } // the fight (or wave) is over
          const why = u.hp <= 0 ? 'down' : skipReason(u, true) || null;
          if (why) { // 先蓄后放: she cannot let it go — the rest of her stack is lost (the pips were already spent)
            if (why === 'swap') u.swapSkip = false; // 2026-11-19 换位/暂停连做: the lost stack pays the swap
            push({ kind: 'burstSkip', round: B.round, side, chainId: st.chainId, to: u.id, reason: why, lost: n - i + 1, n,
              text: TX('battle.burstSkip', { name: u.name, n: n - i + 1 }) });
            break;
          }
          B.burst = { i, n };
          doAction(u, gen, true, st, from);
          B.burst = null;
        }
      }
    }
    // RULES-v1 §3: returned members hand old debuffs back (battle-only) and remember old kindness.
    function applyMemory(u, skip) {
      const cid = u.ref;
      (u.memory || []).forEach((mm, mi) => {
        if (skip && skip.has(mi)) return;
        const card = cardById(data, mm.card);
        if (mm.flip === 'reward-softened') {
          push({ kind: 'memory', id: cid, unit: u.id, card: card.id, flip: mm.flip, text: TX('battle.memorySlow', { name: u.name, card: card.name }) });
          return;
        }
        const living = alive(B.allies);
        if (!living.length) return;
        const hitList = u.resentful ? living : [rngPick(run, living)];
        const eff = card.effect || {};
        const hpWas = hitList.map((a) => ({ uid: a.id, hp: a.hp, maxHp: a.maxHp })); // batch6 H2-14
        for (const a of hitList) applyEff(a, eff, card.id);
        const entry = { kind: 'memory', hpWas, id: cid, unit: u.id, allies: hitList.map((a) => a.id), card: card.id, flip: mm.flip,
          text: TX('battle.memoryReturn', { name: u.name, card: card.name, who: u.resentful ? TX('battle.wholeTeam') : hitList[0].name }) };
        if (hitList.length === 1) entry.ally = hitList[0].id;
        push(entry);
        while (pending.length) push(pending.shift()); // 起作用时才说 (loyal) after the entry
      });
    }
    // enemies speak before the battle: bosses / named first, then one grunt; 1–3 lines; returned girls get the reckoning instead
    const BOSS_REFS = BOSS_REFS0;
    const reckPending = (u) => u.candidate && u.corruption && !u.resummoned && !(run.reckoned || {})[u.ref];
    function taunts() {
      if (B.enemies.some(reckPending)) return; // feedback-1112 [23]: her monologue is this wave's enemy speech
      const T = Object.assign({}, linesV2(data).enemyTaunts || {});
      if (!T['fairy-demon']) T['fairy-demon'] = fairyLines(data, 'taunt');
      const keyOf = (u) => (u.advisorBoss ? 'advisor-boss' : u.ref);
      const alts = (u) => { const a = T[keyOf(u)]; return Array.isArray(a) ? a.filter((x) => x != null && (!Array.isArray(x) || x.length)) : []; };
      const speakers = B.enemies.filter((u) => !(u.candidate && u.corruption) && alts(u).length);
      const bosses = speakers.filter((u) => u.advisorBoss || u.boss || BOSS_REFS[u.ref]);
      const grunts = speakers.filter((u) => !bosses.includes(u));
      const out = [];
      const say = (u, max) => {
        const alt = rngPick(run, alts(u));
        for (const raw of (Array.isArray(alt) ? alt : [alt]).slice(0, max)) {
          const e = lineEvent(data, run, raw, { name: u.name }, u.advisorBoss ? 'advisor' : u.ref, { key: 'taunt', id: u.ref, uid: u.id, round: B.round });
          if (!u.advisorBoss || e.speaker !== 'advisor') Object.assign(e, { speaker: u.ref, speakerId: u.ref, name: u.name });
          out.push(e);
        }
      };
      const lim = Math.max(0, (B.talkLeft == null ? 3 : B.talkLeft) - (B.talkReserve || 0)); // feedback-1112 #23: the reveal / betrayal lines come later
      for (const u of bosses) if (out.length < lim) say(u, lim - out.length);
      if (out.length < lim && grunts.length) { const seen = new Set(); const uniq = grunts.filter((u) => !seen.has(u.ref) && seen.add(u.ref)); say(rngPick(run, uniq), lim - out.length); }
      if (B.talkLeft != null) B.talkLeft -= out.length;
      out.forEach(push);
    }
    // v2.3 §B10: after the taunts, before round 1 — the advisor scouts (while present), then one girl rallies
    // 2026-11-18 #6 彩蛋 (伏笔: 她是召唤师): with 露西安 as the advisor, in levels 1..PET_WISH.maxLevel, a fight with slimes or
    // goblins → she lets slip one line, once per fight (only here, before round 1). Text: battle.petWish.<kind>.
    function petWish(all) {
      if (!PET_WISH.on || run.advisor !== PET_WISH.advisor || !run.advisorPresent || !(B.level >= 1 && B.level <= PET_WISH.maxLevel) || B.petWished) return;
      const kind = PET_WISH.kinds.find((k) => all.some((u) => String(u.ref || '').startsWith(k)));
      if (!kind) return;
      B.petWished = true;
      push(lineEvent(data, run, { text: ({ slime: () => TX('battle.petWish.slime'), goblin: () => TX('battle.petWish.goblin') }[kind] || (() => ''))() }, {}, 'advisor', { key: 'petWish', round: B.round, pet: kind })); // 2026-11-18 cleanup: literal keys so the i18n key scan sees them
    }
    function preBattleLines(room, advisorSpoke) { // feedback-1112 #23: room = how many of scout + rally still fit (null: both); no scout if the advisor already spoke in the foeIntro
      if (room == null) room = 2;
      const all = B.waves.flatMap((w) => w.units);
      const boss = all.find((u) => u.advisorBoss || u.boss || u.waveBoss || BOSS_REFS[u.ref]) || null;
      const counts = {};
      for (const u of all) if (!u.padded) counts[u.name] = (counts[u.name] || 0) + 1;
      const common = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || (all[0] && all[0].name) || '';
      const enemy = boss ? boss.name : common || levelCfg(data, B.level).title || '';
      // FEEDBACK-1112 #21: {count} used to be the total of ALL units while {enemy} named one kind (or the
      // boss) — 「史莱姆王，4个」. Now {count} counts {enemy} itself, and {foes} spells the whole line-up
      // in plain words: 「史莱姆王，带着两个史莱姆」 / 「三个哥布林和一个弓手」.
      const tally = {};
      for (const u of all) tally[u.name] = (tally[u.name] || 0) + 1;
      const CN = [TX('num.0'), TX('num.1'), TX('num.2'), TX('num.3'), TX('num.4'), TX('num.5'), TX('num.6'), TX('num.7'), TX('num.8'), TX('num.9'), TX('num.10')];
      const cn = (n) => CN[n] || String(n);
      const people = [...new Set(all.filter((u) => u.candidate && (!boss || u.name !== boss.name)).map((u) => u.name))]; // girls go by name, never 「一个玛尔塔」
      const rest = Object.keys(tally).filter((k) => (!boss || k !== boss.name) && !people.includes(k)).sort((a, b) => tally[b] - tally[a]);
            const grpJ = joinNames(rest.slice(0, 4).map((k) => TX('battle.foes.count', { count: cn(tally[k]), enemy: k }))), pplJ = joinNames(people);
      const rjoin = grpJ && pplJ ? TX('battle.foes.groupsAndPeople', { groups: grpJ, people: pplJ }) : grpJ || pplJ;
      const bossJ = boss && (tally[boss.name] > 1 ? TX('battle.foes.count', { count: cn(tally[boss.name]), enemy: boss.name }) : boss.name);
      const foes = boss ? (rjoin ? TX('battle.foes.bossWith', { boss: bossJ, rest: rjoin }) : bossJ) : (rjoin || enemy);
      const ctx = { enemy, count: String(tally[enemy] || counts[enemy] || all.length), boss: boss ? boss.name : null, foes };
      const tpls = run.advisorPresent && !advisorSpoke ? dig(linesV2(data), 'advisorScout', run.advisor) : null;
      if (Array.isArray(tpls) && tpls.length) {
        const ok = tpls.filter((r) => { const t = textOf(r); return typeof t === 'string' && (ctx.boss || !/\{boss\}/.test(t)); });
        if (ok.length && room > 0) {
          room -= 1;
          const raw = rngPick(run, ok);
          const o = raw && typeof raw === 'object' ? Object.assign({}, raw) : { text: raw };
          o.text = String(o.text).replace(/\{(count|boss|foes)\}/g, (m, k) => (ctx[k] != null ? ctx[k] : m));
          push(lineEvent(data, run, o, { enemy }, 'advisor', { key: 'scout', round: B.round, enemy, count: all.length, boss: ctx.boss }));
        }
      }
      petWish(all);
      const girls = alive(B.allies).filter((u) => !isLeader(u.id) && hasLines(dig(linesV2(data), 'barks', u.ref, 'rally')));
      if (girls.length && room > 0) {
        const u = rngPick(run, girls);
        push(lineEvent(data, run, pickOne(run, dig(linesV2(data), 'barks', u.ref, 'rally')), { name: u.name, enemy }, u.ref, { id: u.ref, uid: u.id, key: 'rally', round: B.round }));
      }
    }
    // feedback-1112 #33: the level's foeIntro story plays on the battlefield, the returning girl's card lit for every narrated line
    function foeIntro() {
      const cfg = levelCfg(data, B.level) || {};
      if (!cfg.foeIntro || rejectedShort(run, cfg)) return null; // SPEC-2026-11-13 E3: no rejected girl → no intro about her
      if (ONEPAGE_SKIP_FOE_INTRO && quickRun(run)) return null; // 2026-11-20 (off) no scene about her before the fight
      const id = cfg.foeIntro === 'firstReturn' && !run.returned.first && run.branch === 'self' && data.stories && data.stories.firstReturnSelf ? 'firstReturnSelf' : cfg.foeIntro;
      const ls = storyLines(data, run, id) || [];
      if (!ls.length) return null;
      const ctx = preStoryCtx(data, run, cfg);
      const foe = B.enemies.find((u) => u.candidate || u.champion) || B.enemies.find((u) => u.boss || BOSS_REFS[u.ref]) || B.enemies.find((u) => !u.padded) || null;
      // feedback-1112 #23 (round 2): at most FOE_INTRO_MAX lines — the one that names her, the gallery / advisor
      // line, then the scene-setting first line; kept in story order
      const score = (raw, i) => { const t = textOf(raw) || '', sp = raw && typeof raw === 'object' ? raw.speaker : null;
        return (/\{name\}/.test(t) ? 3 : 0) + (sp === 'gallery' || sp === 'advisor' ? 2 : 0) + (i === 0 ? 1 : 0); };
      // 2026-11-19 流程修 M4: a line marked keep:true (a setup line a later story pays off, e.g. L9 「打赢你们就能出去」 → l9Freedom)
      // always stays; it counts toward the cap (the rest fill by score)
      const pinned = (raw) => !!(raw && typeof raw === 'object' && raw.keep);
      const keep = ls.map((raw, i) => ({ i, s: score(raw, i) + (pinned(raw) ? 100 : 0) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, FOE_INTRO_MAX).map((x) => x.i).sort((a, b) => a - b);
      let said = 0, advSaid = false;
      for (const raw of keep.map((i) => ls[i])) {
        said += 1;
        const e = lineEvent(data, run, raw, ctx, 'narrator', { key: 'foeIntro', story: id, round: B.round });
        if (foe && (e.speaker === 'narrator' || e.speaker === foe.ref)) Object.assign(e, { uid: foe.id, id: foe.ref, foe: foe.ref });
        if (e.speaker === 'advisor') advSaid = true;
        push(e);
      }
      return { n: said, advisor: advSaid };
    }
    // 2026-11-14 L11 小铃登场: before her wave the leader recognises her and she drops the act (lines-v2 l11Meet, 5 lines).
    // 2026-11-19 流程修 H1: nobleChamber already unmasks her, so l11Meet is now her 2 follow-on lines (no second 「你怎么在这里」).
    // It IS this wave's enemy speech (her taunt and the guards' are not said too) and nothing else is said after it. Once per run
    // (run.flags.l11Meet); the lines carry once:'l11Meet' so the UI never replays them after a reload / 读档 (A.onceFilter).
    function l11Meet() {
      if (B.level !== 11 || B.wi !== 0 || (run.flags || {}).l11Meet) return false;
      const her = B.enemies.find((u) => u.ref === 'fairy-demon' && u.waveBoss)
        || (mirrorOn(levelCfg(data, B.level)) ? B.waves.flatMap((w) => w.units).find((u) => u.ref === 'fairy-demon') : null); // 2026-11-19 镜像: she watches wave 1 from the back
      const L = B.allies.find((x) => isLeader(x.id));
      const ls = asList(linesV2(data).l11Meet).filter(Boolean);
      if (!her || !ls.length) return false;
      if (!run.flags) run.flags = {};
      run.flags.l11Meet = true;
      for (const raw of ls) {
        const u = raw && raw.speaker === 'leader' ? L : her;
        const on = u && (u === L || B.enemies.includes(u));
        push(lineEvent(data, run, raw, { name: her.name }, 'fairy-demon', { key: 'l11.meet', once: 'l11Meet', uid: on ? u.id : null, id: u ? u.ref : null, round: B.round }));
      }
      return true;
    }
    // v2.3 §A[26]: the bell relic rings in the noble chamber — the fairy starts phase 1 at −25% hp
    function bellRings() {
      if (B.level !== 11 || !(run.relics || []).includes('bell')) return;
      if (XL_V3 && mirrorOn(levelCfg(data, B.level))) return; // 2026-11-21 用户「削弱就算了吧」: the bell no longer cuts her 25% in the mirror fight
      const f = B.enemies.find((u) => u.ref === 'fairy-demon' && u.hp > 0);
      if (!f) return;
      const before = f.hp;
      f.hp = Math.max(1, f.hp - Math.floor(f.maxHp * BELL_HP_CUT));
      const r = relicDef(data, 'bell');
      push({ kind: 'relic', relic: 'bell', ring: true, uid: f.id, id: f.ref, hpBefore: before, hpAfter: f.hp, maxHp: f.maxHp, name: r.name, text: TX('battle.bellRing', { bell: r.name, name: f.name, before, hp: f.hp }) });
      for (const raw of asList(r.ringLine)) push(lineEvent(data, run, raw, {}, 'narrator', { key: 'bellRing', round: B.round }));
    }
    // 2026-11-19 小铃战 镜像: her lines as each wave steps in (text fairy.mirror.*), and the 「玻璃瓶」 shell on wave 1
    function mirrorWaveLines(w) {
      if (B.level !== 11 || !mirrorOn(levelCfg(data, B.level))) return;
      const mir = w.units.some((u) => u.mirror), key = mir ? 'wave1' : 'wave2';
      const ls = mir ? [FD(TX('fairy.mirror.wave1.open'), 'happy')] // (her music line comes first of all: loadWave, before the l11Meet talk) // 2026-11-19 用户: her wave-1 opening (old two lines: fairy.mirror.wave1._old1/_old2)
        : [FD(TX('fairy.mirror.wave2.1'), 'happy'), FD(TX('fairy.mirror.wave2.2'), 'special')];
      // 2026-11-20 BELL_FX (UI): the blessing line carries what it gave and to whom — { stat: 'atk' | 'maxHp' | 'fullAt', delta, uids }
      const blessAt = {};
      const blessFxOf = (card, bid) => { const fx = card.effect || {}; return { stat: fx.type === 'teamCharge' ? 'fullAt' : fx.stat, delta: fx.delta || 0, uids: B.enemies.filter((u) => u.hp > 0 && (u.blessed || []).includes(bid)).map((u) => u.id) }; };
      for (const bid of mirrorBlessFor(run, B.wi)) { // the blessing she hands this wave, by name
        const card = blessingPool(data).find((c) => c.id === bid);
        if (card) { const bo = { name: card.name }; ls.push(FD(MIRROR_BLESS_SPLIT ? (mir ? TX('fairy.mirror.blessing1', bo) : TX('fairy.mirror.blessing2', bo)) : TX('fairy.mirror.blessing', bo), 'happy')); blessAt[ls.length - 1] = blessFxOf(card, bid); } // keys spelled out for the i18n key check
      }
      for (let i = 0; i < ls.length; i++) push(lineEvent(data, run, ls[i], {}, 'fairy-demon', Object.assign({ key: blessAt[i] && XL_V3 ? 'l11.mirror.bless' : 'l11.mirror.' + key, id: 'fairy-demon', uid: null, round: B.round }, blessAt[i] ? { bless: blessAt[i] } : {})));
      for (const u of B.enemies) if (u.glass > 0 && u.hp > 0) u.glassUp = true;
      B.glassUp = B.enemies.some((u) => u.glassUp);
      if (GLASS_WARN && B.glassUp) push({ kind: 'line', speaker: 'narrator', name: '', expr: null, round: B.round, key: 'glassWarn', text: TX('battle.glassWarn') }); // 2026-11-25 试玩: 开打前没说玻璃瓶，玩家白打一轮才知道
      // 2026-11-22 用户「说明可以先做，但带剧情的游戏也要说清楚」: wave 2 opens with the rule told in the story — 小铃 hides behind her dolls
      if (!mir && XL_V3 && B.enemies.some((u) => u.dollWard)) {
        push(lineEvent(data, run, FD(TX('fairy.mirror.wardOpen', { n: WARD_HP }), 'happy'), {}, 'fairy-demon', { key: 'l11.mirror.ward', id: 'fairy-demon', uid: null, round: B.round }));
        push({ kind: 'line', key: 'l11.mirror.ward', speaker: 'narrator', name: '', expr: null, round: B.round, text: TX('battle.wardHint', { n: WARD_HP }) });
      }
    }
    function loadWave() {
      const w = B.waves[B.wi];
      B.quiet = !!(FINAL_WAVE_QUIET && B.level === 11 && mirrorOn(levelCfg(data, B.level)) && B.waveCount > 1 && B.wi + 1 >= B.waveCount); // 2026-11-19 用户亲测 流程 (the live 小铃 mirror fight; the pre-mirror L11 waves stay as they were)
      const outUids = B.enemies.map((u) => u.id); // 2026-11-20 阵容同步: 上一波被移走（记在第一个 enemyEnter 的 out 上）
      if (B.enemies.length) B.gone = (B.gone || []).concat(B.enemies.map(statRow)); // v2.3 §B9: earlier waves keep their stats
      for (const a of B.allies) if (a.block > 0) { a.block = 0; a.blockFrom = null; } // 2026-11-14 护甲: a new wave starts from 0 (kept block too) // 2026-11-17 爆发实验 盾爆流 v3: 铁壁护符 no longer keeps it
      B.enemies = w.units.map((u) => Object.assign({ side: 'enemy', acts: 0, block: 0, damage: 0, healing: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, charge: 0, extraRound: 0, extraTotal: 0 }, clone(u)));
      if (DUP_FOE_NUMBER) numberDupFoes(B.enemies); // 2026-11-19 试玩修 界面: two 骷髅弓手 → 骷髅弓手 1 / 骷髅弓手 2
      for (const u of B.enemies) if (u.xlPhases) Object.assign(u, { xlPhase: 1, xlDolls: B.enemies.filter((x) => x.resummoned || x.padDoll).length, xlMark: null }); // 2026-11-19 小铃强 玩偶弱: phase 1, how many dolls she started with
      B.summon = w.summon ? clone(w.summon) : null; // 2026-11-16 露西安: her roll call (rotation, cap)
      for (const u of B.enemies) if (u.openBlock > 0 && u.hp > 0) u.block = u.openBlock; // 方案 B 开场护甲: on the card from the entrance on; the enemy phase clears it
      if (w.phase2) { // §4.5: she gets back up, and calls the girls back
        push({ kind: 'phase2', round: B.round, wave: B.wi + 1, resummoned: B.enemies.filter((u) => u.resummoned).map((u) => u.ref),
          lines: B.quiet ? [] : fairyLines(data, 'phase2').map((raw) => resolveLine(data, run, raw, {}, 'fairy-demon')), text: TX('battle.fairyStands') }); // 2026-11-19 用户亲测 流程: quiet last wave
      }
      B.enemies.forEach((u, i) => push(Object.assign({ kind: 'enemyEnter', wave: B.wi + 1, uid: u.id, id: u.ref, unit: unitView(data, B, u) }, i === 0 && outUids.length ? { out: outUids } : {})));
      if (FOE_RULES_AT_START && (!B.quiet || QUIET_WAVE_THORNS_RULE)) { // 2026-11-23 试玩 20「反震开打前没说明」: a quiet wave still tells the thorns rule (only that) // 2026-11-22j 试玩「敌人的特殊规则开战时看不到」: one narrator line per enemy kind with a special rule
        const seen = new Set();
        // 2026-11-24 用户「所有单位的介绍都要顾问来讲，要讲得有趣」(ADVISOR_FOE_INTRO): a kind met for the first time this run is
        // introduced by the advisor in her own voice (lines-v2 foeIntro[ref][advisor], the rule inside the line) instead of the
        // narrator's rule line; at most ADV_INTRO_MAX a battle (kinds with a rule first); later meetings → the narrator rule as before
        // 2026-11-24 用户「第 10 关还是顾问介绍：『既然当了你们的顾问，我还是勉为其难地介绍一下吧～』，戏谑的口吻」(ADV_L10_INTRO): the turned advisor
        // opens with linesV2.foeIntroL10[adv].open, then one line per kind on the field (herself first); the narrator skips those kinds
        const l10 = ADV_L10_INTRO && !B.quiet && B.wi === 0 && advA && B.enemies.some((u) => u.advisorBoss) && data.linesV2 && dig(data.linesV2, 'foeIntroL10', advA.id);
        if (l10 && !B.l10IntroDone) {
          B.l10IntroDone = true;
          const say10 = (raw, extra) => push(lineEvent(data, run, Object.assign({ speaker: advA.id, expr: 'special' }, typeof raw === 'string' ? { text: raw } : raw), {}, advA.id, Object.assign({ key: 'foeIntroL10', round: B.round }, extra)));
          if (l10.open) say10(l10.open, {});
          const order = B.enemies.filter((u) => u.hp > 0).sort((x, y) => Number(!!y.advisorBoss) - Number(!!x.advisorBoss));
          for (const u of order) { const k = u.advisorBoss ? advA.id : u.ref; if (seen.has('intro|' + u.ref) || !l10[k]) continue; seen.add('intro|' + u.ref); say10(l10[k], { uid: u.id, foe: u.ref }); }
        }
        const fi = ADVISOR_FOE_INTRO && !B.quiet && run.advisorPresent && advA && data.linesV2 && data.linesV2.foeIntro;
        if (fi) {
          run.foesMet = run.foesMet || [];
          const kinds = [];
          for (const u of B.enemies) if (u.hp > 0 && !u.candidate && !u.champion && !u.advisorBoss && fi[u.ref] && fi[u.ref][advA.id] && !run.foesMet.includes(u.ref) && !kinds.some((k) => k.ref === u.ref)) kinds.push({ ref: u.ref, u, ruled: (u.boss || BOSS_REFS[u.ref] || u.winOnDown ? 2 : 0) + (foeRuleTexts(data, B, u, run).length > 0 ? 1 : 0) }); // the boss first, then kinds with a rule
          kinds.sort((x, y) => Number(y.ruled) - Number(x.ruled));
          for (const k of kinds.slice(0, ADV_INTRO_MAX)) {
            run.foesMet.push(k.ref);
            const raw = fi[k.ref][advA.id];
            push(lineEvent(data, run, Object.assign({ speaker: advA.id, expr: 'calm' }, typeof raw === 'string' ? { text: raw } : raw), {}, advA.id, { key: 'foeIntroAdv', round: B.round, uid: k.u.id, foe: k.ref }));
            seen.add('intro|' + k.ref);
          }
        }
        for (const u of B.enemies) {
          if (!(u.hp > 0)) continue;
          if (B.quiet && !(u.thorns > 0)) continue;
          if (!FOE_INTRO_KEEP_RULE && seen.has('intro|' + u.ref)) continue; // she just told it (FOE_INTRO_KEEP_RULE 2026-11-24: the plain rule line still follows her fun one)
          const rules = foeRuleTexts(data, B, u, run).map((t) => t.replace(/[。；\s]+$/, '')), key = (u.baseName || u.name) + '|' + rules.join('；');
          if (!rules.length || seen.has(key)) continue;
          seen.add(key);
          push(lineEvent(data, run, { speaker: 'narrator', text: TX('battle.foeRule', { name: u.baseName || u.name, rules: rules.join('；') }) }, {}, 'narrator', { key: 'foeRule', round: B.round, uid: u.id }));
        }
      }
      if (ADV_GROWN_LINE && B.wi === 0 && B.level === ADV_SKILL_LV2 && run.advisorPresent && advA && !run.advGrownSaid) { // 2026-11-23 试玩 19「技能 +1 悄悄变 +2」: say it once, the battle it grows (no word about the sacrifice)
        const cb = combatOf(advA), pr = cb && ADV_SKILL_SCALE && ['formation', 'overtime', 'luckUp'].includes(cb.kind) ? advSkillPair(cb.kind) : null;
        if (pr && pr[0] < pr[1]) { run.advGrownSaid = true; push({ kind: 'line', key: 'advGrown', speaker: 'narrator', name: '', expr: null, round: B.round, text: TX('battle.advGrown', { name: advA.name, skill: cb.name, from: pr[0], to: pr[1] }) }); }
      }
      const fi = B.wi === 0 ? foeIntro() : null; // feedback-1112 #33: who the opponents are, told on the battlefield (not counted as taunts)
      // feedback-1112 [23] (round 2): EVERYTHING the enemies say before a wave — taunts, the girls' intro / token lines,
      // their reckoning monologues, the advisor boss's reveal and betrayal lines — is 3 lines at most
      B.talkLeft = 3;
      const revealN = w.intro.some((it) => it.advisor) && advA && advA.comments && advA.comments.reveal ? 1 : 0;
      const betrayN = B.enemies.some((u) => u.advisorBoss) && advA && bossCombatOf(advA) ? 1 : 0;
      const pend = B.enemies.filter(reckPending);
      B.talkReserve = revealN + betrayN + pend.length;
      const girlBudget = Math.max(pend.length, 3 - revealN - betrayN);
      pend.forEach((u, i) => { u.talkShare = Math.floor(girlBudget / pend.length) + (i < girlBudget % pend.length ? 1 : 0); });
      if (B.wi === 0 && B.level === 11 && mirrorOn(levelCfg(data, B.level))) push(lineEvent(data, run, FD(TX('fairy.mirror.music'), 'happy'), {}, 'fairy-demon', { key: 'l11.mirror.music', id: 'fairy-demon', uid: null, round: B.round })); // 2026-11-19 用户: the first line of the fight
      const met = l11Meet(); // 2026-11-14: her talk replaces the taunts and the scout / rally
      if (met) B.talkLeft = 0;
      else if (!w.phase2) taunts();
      B.talkReserve = 0;
      if (B.wi === 0) { preBattleLines(met ? 0 : Math.max(0, PRE_OTHER_MAX - (fi ? fi.n : 0) - B.pre.filter((e) => e.kind === 'line').length), !!(fi && fi.advisor)); /* L9 oldMaster counts too */ bellRings(); }
      else if (mirrorOn(levelCfg(data, B.level))) bellRings(); // 2026-11-19 镜像: she only steps in with wave 2
      mirrorWaveLines(w);
      if (B.quiet) { // 2026-11-19 用户亲测 流程: one short line, and no mercy beats from her girls this wave
        push(lineEvent(data, run, FD(TX('fairy.mirror.final'), 'calm'), {}, 'fairy-demon', { key: 'l11.final', id: 'fairy-demon', uid: null, round: B.round }));
        for (const u of B.enemies) { delete u.hesitate; delete u.skipRounds; delete u.flashbackFirst; }
      }
      push({ kind: 'wave', wave: B.wi + 1, text: B.waveCount > 1 ? TX('battle.wave', { wave: B.wi + 1 }) : TX('battle.enemiesAppear') });
      for (const it of w.intro) {
        if (it.advisor) { const a = advA; if (revealN && B.talkLeft > 0) { B.talkLeft -= 1; push(lineEvent(data, run, a.comments.reveal, {}, 'advisor', { key: 'reveal', name: a.boss.name })); } continue; }
        const u = B.enemies.find((x) => x.ref === it.id) || { ref: it.id, id: null, name: nameOf(data, it.id) };
        let ls = v2Lines(u, it.v2);
        if (!ls.length) {
          const l = candLine(data, it.id, it.key);
          if (l) ls = [lineEvent(data, run, l, { name: u.name }, it.id, { id: it.id, uid: u.id, key: it.key })];
        }
        const tks = (it.tokens || []).map((tk) => { const tl = candLine(data, it.id, 'tokenRecognized');
          return tl ? lineEvent(data, run, tl, { token: tk, name: u.name }, it.id, { id: it.id, uid: u.id, key: 'tokenRecognized', token: tk }) : null; }).filter(Boolean);
        // her first intro line, then the line about the keepsake you gave her, then the rest of her intro;
        // a girl whose reckoning is still to come keeps one line of her share for it
        const pool = ls.slice(0, 1).concat(tks, ls.slice(1));
        const room = reckPending(u) && u.talkShare != null ? Math.min(B.talkLeft - 1, u.talkShare - 1) : B.talkLeft - (B.enemies.filter(reckPending).length);
        const said = pool.slice(0, Math.max(0, room));
        said.sort((a, b) => pool.indexOf(a) - pool.indexOf(b)).forEach(push);
        B.talkLeft -= said.length;
        if (u.talkShare != null) u.talkShare -= said.length;
      }
      if (B.enemies.some((u) => u.corruption)) push({ kind: 'darkTransition', reason: 'return' });
      if (B.wi > 0 && !carryHpOf(levelCfg(data, B.level))) B.allies.forEach((a) => { a.hp = a.maxHp; a.downLogged = false; });
      // RULES-v1 §9: the advisor boss turns her combat skill on the player — passively, over her whole wave
      B.enemyCombat = null;
      const boss = B.enemies.find((u) => u.advisorBoss);
      const bc = boss && advA && bossCombatOf(advA);
      if (bc) {
        B.enemyCombat = bc.kind;
        B.talkLeft -= 1; // feedback-1112 #23: counted (reserved before the taunts)
        push({ kind: 'line', speaker: 'advisor', speakerId: advA.id, name: advA.name, expr: null, combat: bc.kind, betrayal: true, text: TX('battle.betrayal', { advisor: advA.name, skill: bc.name }) });
      }
      // 2026-11-21 用户「奥德丽这边来一点 meta：开战的时候栗子的毒性发作（你喜欢我的栗子吗，它们真的很有效啊），每人每次吃过的栗子 −1 生命，
      // 然后说一下：啊——肚子疼了一下」. Once, at her wave; straight to hp (no 护甲), never below 1. Event 'quake' with chestnut: true.
      if (CHESTNUT_POISON && boss && advA && (flowOf(advA) || {}).kind === 'chestnut' && !B.chestnutDone) {
        B.chestnutDone = true;
        const ate = run.chestnuts || {}, targets = [];
        for (const t of alive(B.allies)) {
          const n = ate[t.ref] || 0; if (!n) continue;
          // 2026-11-21 用户「直接扣生命上限」: −1 max hp per chestnut (this fight), hp follows down; max never below 1 (old CHESTNUT_MAXHP false: −1 hp, never below 1)
          if (CHESTNUT_MAXHP) {
            const cut = Math.min(n, Math.max(0, t.maxHp - 1)); t.maxHp -= cut; const before = t.hp; t.hp = Math.min(t.hp, t.maxHp);
            const mm = CHESTNUT_FOREVER && run.members[t.ref]; if (mm && cut) { const mc = Math.min(cut, Math.max(0, mm.maxHp - 1)); mm.maxHp -= mc; mm.hp = Math.min(hpOf(mm), mm.maxHp); } // 2026-11-21 用户「永久扣」
            targets.push({ uid: t.id, id: t.ref, amount: before - t.hp, maxCut: cut, ate: n, blocked: 0, blockAfter: t.block || 0, hpAfter: t.hp, maxHpAfter: t.maxHp, kind: 'damage' });
            continue;
          }
          const dmg = Math.min(n, Math.max(0, t.hp - 1)); t.hp -= dmg; t.taken = (t.taken || 0) + dmg;
          targets.push({ uid: t.id, id: t.ref, amount: dmg, ate: n, blocked: 0, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' });
        }
        if (targets.length) {
          push({ kind: 'line', speaker: 'advisor', speakerId: advA.id, name: advA.name, expr: 'special', chestnut: true, text: TX('battle.chestnutAsk') });
          push({ kind: 'quake', chestnut: true, round: B.round, side: 'enemy', from: boss.id, amount: 0, targets, text: TX('battle.chestnutPoison', { list: targets.filter((t) => (t.maxCut != null ? t.maxCut : t.amount) > 0).map((t) => TX('battle.chestnutPoisonOne', { name: nameOf(data, t.id), n: t.maxCut != null ? t.maxCut : t.amount })).join('、') }) }); // 2026-11-23 用户「应该是喂过栗子的人」: name each eater (was 「队伍一共 −{n}」, read as the whole team)
          const most = targets.reduce((b, t) => (t.ate > b.ate ? t : b), targets[0]);
          push({ kind: 'line', speaker: most.id, speakerId: most.id, name: nameOf(data, most.id), expr: 'sad', chestnut: true, text: TX('battle.chestnutHurt') });
        }
      }
      // 2026-11-21 用户「第二波里之前献祭的那个人一开始在玩偶里——这个时候她会反水，清醒，然后加入玩家阵营」(MIRROR_WAKE):
      // every girl the run sacrificed (not 'self') wakes as wave 2 steps in and turns at once (the turncoat path: one line, fights the
      // fairy); she no longer counts toward 小铃's doll count (so her phase 2 doesn't fire early). Turned-down girls keep the random chance.
      if (MIRROR_WAKE && B.wi > 0 && B.level === 11 && mirrorOn(levelCfg(data, B.level))) {
        for (const u of B.enemies.slice()) if (u.resummoned && !u.turned && (run.sacrificed || []).some((s) => s && s.id === u.ref && s.mode !== 'self')) {
          const xl = B.enemies.find((x) => x.xlPhases); if (xl) xl.xlDolls = Math.max(0, (xl.xlDolls || 0) - 1);
          u.openBlock = 0; u.block = 0; u.blockFrom = null; // her wave-2 opening 护甲 was the doll's
          if (WAKE_AS_MEMBER && run.members[u.ref]) { // 2026-11-21 用户「反水的人物要变成正常人物——之前走的时候带的加成/礼物都在身上，有猎人的技能/特质」
            const a = allyUnit(data, run, u.ref, B.allies.length), atkB = (u.blessed || []).includes('bless-atk') ? 1 : 0; // 小铃's 铃之锋芒 stays on her (用户「正好有一个反水的带加成」)
            for (const k of ['corruption', 'faction', 'elv', 'memory', 'candidate', 'combo', 'perk', 'luck', 'fullAt']) delete u[k];
            const dollHp = u.maxHp, dollAtk = u.atk; // 用户「stats 可以提升一些（或者用最后战的这个 stats）」: the higher of her own and the doll's numbers
            // 用户「要让玩家的感觉是：这个人还跟以前一样用，而且更强了」: her own skill one level up (WAKE_SKILL_UP), 威力 = her own + WAKE_ATK (+ 铃之锋芒), hp the higher of hers / the doll's
            const sk = WAKE_SKILL_UP ? freshSkill(data, run, u.ref, Object.assign(clone(a.skill), { power: Math.min(SKILL_LV_MAX - 1, ((a.skill && a.skill.power) || 0) + WAKE_SKILL_UP) })) : a.skill;
            u.wakeFrom = { atk: a.atk, hp: a.maxHp, lv: lvOf(a.skill), skill: a.skill && a.skill.name };
            Object.assign(u, { name: a.name, role: a.role, maxHp: Math.max(a.maxHp, dollHp), hp: Math.max(a.maxHp, dollHp), atk: Math.max(a.atk + WAKE_ATK + atkB, dollAtk), skill: sk, tokens: a.tokens, charge: a.charge, wokeMember: true },
              a.combo ? { combo: a.combo } : {}, a.perk ? { perk: a.perk } : {}, a.luck ? { luck: a.luck } : {}, a.fullAt ? { fullAt: a.fullAt } : {});
          }
          turncoat(u);
          if (u.wokeMember) u.focus = null; // she picks her targets like before (猎人锁定 / her class rule), not only 小铃
          if (WAKE_AS_MEMBER && u.wakeFrom) { const f = u.wakeFrom; push({ kind: 'line', key: 'l11.wake', speaker: 'narrator', name: '', expr: null, round: B.round, uid: u.id, id: u.ref, wake: true,
            text: TX('battle.wakeStronger', { name: u.name, a0: f.atk, a1: u.atk, h0: f.hp, h1: u.maxHp, skill: f.skill || '', l0: f.lv, l1: lvOf(u.skill) }) }); }
          if (WAKE_AS_MEMBER) { // the leader answers her: 「xx……你回来了！」「我们的小队齐了。最后一战，大家加油！」
            const L = B.allies.find((x) => isLeader(x.id));
            for (const k of ['battle.wakeLeader1', 'battle.wakeLeader2']) push(lineEvent(data, run, { speaker: 'leader', text: k === 'battle.wakeLeader1' ? TX('battle.wakeLeader1', { name: u.name }) : TX('battle.wakeLeader2') }, { name: u.name }, 'leader', { key: 'l11.wake', id: 'leader', uid: L ? L.id : null, round: B.round }));
          }
        }
      }
      for (const u of B.enemies) {
        if (u.resummoned || u.mirror) continue; // §4.5: her reckoning already happened (2026-11-19: a mirror doll has none)
        if (u.candidate && u.corruption && !(run.reckoned || {})[u.ref]) reckoning(u); // §E first appearance
        else if (u.memory && u.memory.length) applyMemory(u);
      }
    }
    // 2026-11-19 小铃强 玩偶弱: phase 1 → 2 when half her dolls are down (killed or turned) or she is below half hp — checked
    // after every action (check()); one 'phase2' event (xl: true — the UI's phase banner + her line) and she loses the ward
    function xlPhaseCheck() {
      for (const u of B.enemies) {
        if (!(u.xlPhase === 1 && u.hp > 0)) continue;
        const standing = B.enemies.filter((x) => x !== u && x.hp > 0 && (x.resummoned || x.padDoll)).length;
        const down = (u.xlDolls || 0) - standing;
        if (XL_V3 ? standing > 0 : !(down >= Math.ceil((u.xlDolls || 0) * XL_P2_DOLLS) || u.hp < u.maxHp * XL_P2_HP)) continue; // 2026-11-21 XL_V3: phase 2 only once every doll is down
        u.xlPhase = 2; u.xlMark = null;
        push({ kind: 'phase2', xl: true, round: B.round, wave: B.wi + 1, uid: u.id, id: u.ref, resummoned: [],
          lines: [resolveLine(data, run, FD(TX('fairy.xl.stepForward'), 'special'), {}, 'fairy-demon')], text: TX('battle.xlStepForward', { name: u.name }) });
      }
    }
    const check = () => {
      splitCheck(); // 2026-11-20 L7 分裂史莱姆
      xlPhaseCheck(); // 2026-11-19 小铃强 玩偶弱
      if (!alive(B.allies).length) return 'lose';
      if (!alive(B.enemies).length || B.enemies.some((u) => (u.waveBoss || u.winOnDown) && u.hp <= 0)) return 'wave'; // §4.5 the fairy down ends her wave · 2026-11-16 winOnDown: the advisor boss down ends the L10 fight
      return null;
    };
    function endChain(st) {
      if (st.links > 0 && st.starter) st.starter.maxChain = Math.max(st.starter.maxChain || 0, st.max);
      if (st.links > 0) push({ kind: 'chainEnd', chainId: st.chainId, side: st.side, depth: st.max, links: st.links, total: st.total });
    }
    // 2026-11-14 护甲 → 2026-11-16 用户拍板「我方护甲回合结束清」: block lasts one round. The ENEMY side's block goes at the
    // start of their phase (as before); OUR side's block goes at the END of the round (after the enemy phase — clearBlock
    // from round()), so a pause between rounds never shows last round's block. 玛尔塔「铁砧不卸」 keeps half (rounded down) at
    // that moment. A new wave still starts from 0 (loadWave).
    function clearBlock(side, arr) {
      const cleared = [];
      for (const u of arr) {
        if (!(u.block > 0)) { u.blockFrom = null; continue; }
        const keep = u.hp > 0 && (guardKeep(u) || (side === 'enemy' && B.keepEnemyBlock)) ? u.block // IRON_L10: 奥德丽战 enemies keep it all // 2026-11-17 爆发实验 盾爆流 v3: Lv4 guard keeps it all
          : u.side === 'ally' && u.hp > 0 && u.perk && u.perk.id === 'anvil' ? Math.floor(u.block / 2) : 0;
        if (keep > 0 && u.blockFrom) { const f = keep / u.block; for (const k of Object.keys(u.blockFrom)) u.blockFrom[k] = Math.floor(u.blockFrom[k] * f); } // @stats
        if (!(keep > 0)) u.blockFrom = null;
        cleared.push({ uid: u.id, from: u.block, to: keep });
        u.block = keep;
      }
      if (cleared.length) push({ kind: 'blockClear', round: B.round, side, units: cleared });
      // 2026-11-22 试玩4 #6: the rule (enemy 护甲 goes when their phase starts) is said once per battle, the first time it takes any (the UI ignores this kind)
      if (side === 'enemy' && !B.enemyClearSaid && cleared.some((c) => c.from > c.to)) { B.enemyClearSaid = true; push({ kind: 'blockGoneNote', round: B.round, side, text: TX('battle.enemyBlockGone') }); }
    }
    // the start-of-phase gains: 硬壳 tops up to SHELL_BLOCK (enemies, after their clear); ours: round 1's opening block
    // (退伍老兵 / 满血休息), 奥德丽「列阵」 (the round it was used)
    function startPhaseBlock(side, arr) {
      if (side === 'enemy') clearBlock(side, arr);
      if (side === 'enemy' && B.glassUp) { // 2026-11-19 「玻璃瓶」 碎了: their opening shell went with the clear above
        B.glassUp = false;
        for (const u of B.enemies) delete u.glassUp;
        push({ kind: 'line', key: 'l11.mirror.glass', speaker: 'narrator', name: '', expr: null, round: B.round, glass: true, text: TX('battle.mirrorGlass') });
      }
      for (const u of alive(arr)) {
        if (side === 'enemy' && hasTrait0(u, 'shell') && (u.block || 0) < SHELL_BLOCK) gainBlock(u, SHELL_BLOCK - (u.block || 0), u.id, false, { name: u.name, skill: STATUS_LABELS().shell });
        if (side === 'enemy' && u.sumBlock > 0 && (u.block || 0) < u.sumBlock) gainBlock(u, u.sumBlock - (u.block || 0), u.id, false, { name: u.name, skill: STATUS_LABELS().shell }); // 2026-11-17 露西安 召唤物 (骷髅)
        if (side === 'ally' && u.openCrest > 0) { const n = u.openCrest, nm = guildRelicName(data, 'guild-crest'); u.openCrest = 0; gainBlock(u, n, u.id, false, { name: nm, skill: nm }); } // 2026-11-22 遗物 公会徽记
        if (side === 'ally' && u.openBlock > 0) {
          const n = u.openBlock; u.openBlock = 0;
          const vet = u.openVeteran;
          if (u.openVeteran) { u.openVeteran = false; push(B.veteranTeam ? { kind: 'veteran', team: true, round: B.round, uid: u.id, n: B.veteranTeam, text: TX('battle.veteranTeam', { name: u.name, n: B.veteranTeam }) } : { kind: 'veteran', round: B.round, uid: u.id, text: TX('battle.veteranGuard', { name: u.name }) }); } // 2026-11-19 伤害分摊: the whole team
          gainBlock(u, n, isLeader(u.id) || !B.veteranTeam ? u.id : (B.allies.find((x) => isLeader(x.id)) || u).id, false, { name: u.name, skill: vet || B.veteranTeam ? TX('battle.blockSrc.veteran') : TX('camp.rest.label') });
        }
      }
      if (side === 'ally' && B.mods.formation) { const cb = advA && combatOf(advA); for (const u of alive(arr)) gainBlock(u, B.formationN != null ? B.formationN : FORMATION_BLOCK, 'advisor', false, { name: advA ? advA.name : '', skill: (cb && cb.name) || STATUS_LABELS().formation }); }
    }
    // RULES-v1 §1: one side acts slot 1→n.
    // 用户 2026-11-15 先攻 (ambush): an enemy phase before ours in round 1 (first wave) — only the units with the trait act.
    // Our start-of-round gains (开场护甲 退伍老兵 / 满血休息, 列阵) land first and our own round-1 phase does not clear them;
    // the enemies keep their opening block (no clear) until their normal round-1 phase.
    function runPhase(side, ambush) {
      const arr = side === 'ally' ? B.allies : B.enemies;
      const ps = { count: 0 }; // count = this phase's extra actions (their side: ENEMY_EXTRA_MAX)
      if (!ambush) for (const u of arr) u.extraRound = 0; // 充能: EXTRA_CAP counts per side phase
      if (ambush) push({ kind: 'phase', round: B.round, side, ambush: true, text: TX('battle.phaseAmbush', { round: B.round }) });
      else push({ kind: 'phase', round: B.round, side, text: TX('battle.phase', { round: B.round, side: SIDE_LABEL()[side] }) });
      if (side === 'ally' && B.summon && B.summon.ward && B.summon.wardPhase && B.enemies.some((x) => x.summoned && x.hp > 0)) B.wardRound = B.round; // 2026-11-17 护身按回合: minions up when our phase starts → she is warded the whole phase
      if (ambush) { startPhaseBlock('ally', B.allies); B.allyPrimed = true; }
      else if (side === 'ally' && B.allyPrimed) B.allyPrimed = false;
      else startPhaseBlock(side, arr);
      if (side === 'ally' && !ambush) for (const x of alive(B.enemies)) if (x.advisorBoss && bigRoundOf(x.skill, B.round + 1)) { // 2026-11-18 妮可塔 L10 大招: warned one round ahead
        push({ kind: 'line', key: 'bigTell', speaker: 'narrator', name: '', expr: null, round: B.round, uid: x.id, id: x.ref, text: TX('battle.bigTell', { name: x.name, skill: x.skill.name }) });
      }
      if (side === 'ally' && B.l8 && B.wi === 0) l8Beat(B.round === 1 ? 'open' : B.round === 2 ? 'sorry' : null); // 2026-11-14 (after 「第 1 回合」: the ≤6 pre-battle lines stay)
      let outcome = null;
      // 2026-11-16 用户拍板: no separate chain at the start of the phase for whoever is already full (好运 / 战鼓 / 盾挨打 pips,
      // pips left from last round) — she is raised at the head of her OWN normal action's chain (below) and her stack fires
      // together with that action. Down / controlled before her turn, or no normal action this round: the pips stay.
      if (side === 'ally' && B.round === 1 && B.wi === 0 && leaderHas(run, 'first-strike') && arr.length && arr[0].hp > 0) {
        doAction(arr[0], 0, false, { chainId: ++B.chainSeq, side, links: 0, max: 0, total: 0 }); // first-strike: no chain
        if ((outcome = check())) return outcome;
      }
      for (const u of arr.slice()) {
        if (u.hp <= 0) continue;
        if (ambush && !hasTrait0(u, 'ambush')) continue;
        const firstReal = u.side === 'enemy' && u.extraFirst && !u.didAct;
        if (!ambush && side === 'enemy' && u.quake && u.quakeRound !== B.round && ((B.round || 1) - (B.waveStart || 1) + 1) % (u.quake.every || 2) === 0) {
          quake(u); // 2026-11-16 第 10 关 石门守卫: every `every` rounds of the wave (scenario: every 1 = each round), right before her own action
          if ((outcome = check())) return outcome;
        }
        const st = { chainId: ++B.chainSeq, side, links: 0, max: 0, total: 0, starter: u };
        const r = doAction(u, 0, false, st);
        if ((outcome = check())) { endChain(st); return outcome; }
        if (r) { // 充能: every normal action charges her neighbours, then the queue plays out before the next normal action
          const q = [];
          enqueue(q, u, 1, u.id); // already full when her turn came: she is raised first (counts as acting once, gen 1)
          giveCharge(u, 0, q, st);
          enqueue(q, u, 1, u.id);
          drainQueue(q, ps, st);
          if ((outcome = check())) { endChain(st); return outcome; }
        }
        endChain(st);
        if ((outcome = check())) return outcome;
        if (r && firstReal) {
          u.didAct = true;
          for (let i = 0; i < u.extraFirst && u.hp > 0; i++) {
            doAction(u, 0, true, { chainId: ++B.chainSeq, side, links: 0, max: 0, total: 0 }); // inverted slow-start: acts again right away
            if ((outcome = check())) return outcome;
          }
        } else if (r) u.didAct = true;
      }
      return null;
    }
    function end(win) {
      B.over = true;
      B.win = win;
      push({ kind: 'end', win, text: win ? TX('battle.win') : (alive(B.allies).length ? TX('battle.timeout', { rounds: maxRounds }) : TX('battle.wipe')) });
    }
    // feedback-1112 #36: the advisor boss casts her own advisor skill on the player every round (on top of her passive)
    //  列阵 formation → enemies take −1 per hit this round · 附加条款 clause → our first action this round is void
    //  好运 luck → every enemy hit +1 this round
    // 试玩反馈 2026-11-14 晚 #22 附加条款 (our advisor): CLAUSE_DAZE_N random living enemies 发呆 (skip) this round
    function clauseDaze() {
      const picked = rngSample(run, alive(B.enemies), CLAUSE_DAZE_N);
      if (!picked.length) return;
      for (const u of picked) u.dazed = true;
      B.clauseRound = B.round;
      const cb = advA && combatOf(advA);
      push({ kind: 'clauseDaze', round: B.round, status: 'daze', units: picked.map((u) => u.id),
        text: TX('battle.clauseDaze', { clause: (cb && cb.name) || TX('battle.clauseName'), names: listSeq(picked.map((u) => u.name)) }) });
    }
    // 2026-11-16 露西安 L10 召唤: from her wave's 2nd round on, at the start of each round she calls the next group of
    // the rotation (3 slimes → 2 goblins → 2 skeletons → …) in on her left (she stays at the right end). Never more than
    // summon.cap living enemies (her included): a group that does not fit comes in part, a full side gets nobody (the
    // rotation moves on anyway). Minions felled earlier leave the lane first. She is down → no more summons; the
    // minions already there fight on and must be cleared as usual.
    // 2026-11-24 墓穴的寒气 (用户「试一下寒气」): at the end of round r (counted from the wave's first round) every living ally loses
    // n hp — no 护甲, never below 1 (CHILL_FLOOR). n = chillN(run, level, r); 0 = off. Event 'quake' with chill: true (the UI shakes / bannerss it)
    function chillRound() {
      const r = B.round - (B.waveStart || 1) + 1, n = chillN(run, B.level, r);
      if (!(n > 0)) return;
      const targets = [];
      for (const t of alive(B.allies)) {
        const blocked = chillArmor(run) ? Math.min(t.block || 0, n) : 0; if (blocked) t.block -= blocked;
        const dmg = Math.max(0, Math.min(n - blocked, t.hp - CHILL_FLOOR));
        t.hp -= dmg; t.taken = (t.taken || 0) + dmg;
        targets.push({ uid: t.id, id: t.ref, amount: dmg, blocked, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' });
      }
      push({ kind: 'quake', chill: true, round: B.round, side: 'enemy', from: null, amount: n, targets, text: TX('battle.chill', { n }) + groupHitEach(B.allies, targets) });
    }
    function summonRound() {
      const S = B.summon;
      if (!S) return;
      const dead = SUMMON_REPLACE_SLOT ? [] : B.enemies.filter((u) => u.summoned && u.hp <= 0); // 2026-11-18: fallen summons now keep their slot until a new one takes it (placeSummons)
      if (dead.length) { B.gone = (B.gone || []).concat(dead.map(statRow)); B.enemies = B.enemies.filter((u) => !dead.includes(u)); push({ kind: 'lineupOut', round: B.round, side: 'enemy', uids: dead.map((u) => u.id) }); } // 2026-11-20 阵容同步: 移走也发事件
      const boss = B.enemies.find((u) => u.advisorBoss && u.hp > 0);
      if (!boss || B.round <= (B.waveStart || 1)) return;
      if (S.every > 0) return rollCall(S, boss); // 2026-11-17 露西安 L10 召唤战
      const group = S.cycle[S.next % S.cycle.length];
      S.next += 1;
      const room = Math.max(0, (S.cap || SUMMON_CAP) - alive(B.enemies).length);
      const ids = group.slice(0, room);
      if (!ids.length) { push({ kind: 'summon', round: B.round, uid: boss.id, full: true, units: [], text: TX('battle.summonFull', { name: boss.name }) }); return; }
      const fresh = ids.map((id) => {
        S.seq += 1;
        const u = Object.assign({ side: 'enemy', acts: 0, block: 0, damage: 0, healing: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, charge: 0, extraRound: 0, extraTotal: 0 }, clone(S.units[id]));
        u.id = `e${B.wi + 1}-s${S.seq}`; u.hp = u.maxHp;
        return u;
      });
      placeSummons(fresh, boss);
      push({ kind: 'summon', round: B.round, uid: boss.id, units: fresh.map((u) => unitView(data, B, u)), short: SUMMON_TEXT_SHORT, slots: fresh.filter((u) => u.slotOf).map((u) => ({ uid: u.id, was: u.slotOf })),
        text: summonText(boss, fresh) });
    }
    // 2026-11-18 #7: each new summon takes the leftmost slot of a fallen summoned card (its stats go to B.gone); the rest go in
    // on her left. SUMMON_REPLACE_SLOT false = old: all of them on her left (summonRound removed the fallen first).
    function summonText(boss, fresh) {
      if (!SUMMON_TEXT_SHORT) return TX('battle.summon', { name: boss.name, names: listSeq(fresh.map((u) => u.name)) });
      const n = {}; for (const u of fresh) n[u.name] = (n[u.name] || 0) + 1;
      return TX('battle.summonShort', { names: listSeq(Object.keys(n).map((k) => (n[k] > 1 ? TX('battle.summonCount', { name: k, n: n[k] }) : k))) });
    }
    // 2026-11-20 用户 L7「一个分裂史莱姆不停地召唤小史莱姆，考群伤」: a unit with brood { n, cap, unit, hp, hpStep, atk, atkStep, wander }
    // spits n small ones at the opening and at the END of every round (用户: 每一轮结束时) (never more than cap living ones); each costs her the small one's hp
    // (she never spits below 1 hp left over); each round's batch hits harder (atk + atkStep per batch); the small ones 乱撞
    // (wander) at a non-front ally. With winOnDown her fall wins the fight. Event 'summon' with parent { uid, hp, maxHp }.
    function pruneBrood() { // the brood fallen last round that no new one replaced leave the lane at this round's start (用户「死掉的也不应该继续在上面」)
      const dead = B.enemies.filter((u) => u.broodOf && u.hp <= 0);
      if (!dead.length) return;
      B.gone = (B.gone || []).concat(dead.map(statRow));
      B.enemies = B.enemies.filter((u) => !dead.includes(u));
      push({ kind: 'lineupOut', round: B.round, side: 'enemy', uids: dead.map((u) => u.id) }); // 2026-11-20 阵容同步: 画面在这一拍才把倒下的小史莱姆移走
    }
    // 2026-11-22 燃烧瓶: FIRE_BOTTLE to every living enemy (护甲 first) — a 'quake' event with fire: true, side ally
    function fireBottle() {
      const n = B.mods.fire; B.mods.fire = 0;
      const targets = [];
      for (const t of alive(B.enemies)) {
        const blocked = absorb(t, n), dmg = n - blocked;
        t.hp = Math.max(0, t.hp - dmg); t.taken = (t.taken || 0) + dmg;
        targets.push({ uid: t.id, id: t.ref, amount: dmg, blocked, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' });
      }
      push({ kind: 'quake', fire: true, round: B.round, side: 'ally', from: null, amount: n, targets, text: TX('battle.fireBottle', { n }) });
      downs(targets, B.enemies);
    }
    function badgeRevive() {
      for (const u of B.allies) {
        if (!u.badgeRevive) continue;
        u.badgeRevive = false;
        if (u.hp > 0) continue;
        u.hp = 1; u.block = 0;
        push({ kind: 'badgeRevive', round: B.round, side: 'ally', uid: u.id, hpAfter: 1, text: TX('battle.badgeRevive', { name: u.name }) });
      }
    }
    const broodCost = (Q, hp1) => (Q.selfCost > 0 && Q.selfCost < 1 ? Math.max(1, Math.ceil(hp1 * Q.selfCost)) : hp1);
    function broodRound() {
      for (const m of B.enemies.slice()) {
        const Q = m.brood; if (!Q || !(m.hp > 0)) continue;
        const t = data.enemies.find((x) => x.id === Q.unit); if (!t) continue;
        const room = Math.max(0, Q.cap - alive(B.enemies).filter((u) => u.broodOf === m.id).length);
        const gen = (m.broodGen || 0) + 1, hp1 = Q.hp + (gen - 1) * (Q.hpStep || 0); // 2026-11-20: each batch 生命 +hpStep, 威力 +atkStep
        // 2026-11-20 用户「母体血比分出来的少就停，别把自己耗死」(BROOD_KEEP): she keeps at least one batch-slime's hp for herself
        const cost1 = broodCost(Q, hp1); // 2026-11-23 用户批 E「母体分裂扣自己的血减半」(brood.selfCost 0.5): she pays half of each slime's hp
        const k = Math.min(Q.n, room, Math.max(0, BROOD_KEEP ? Math.floor((m.hp - hp1) / cost1) : Math.floor((m.hp - 1) / cost1)));
        if (!k) continue;
        m.broodGen = gen; B.broodSeq = B.broodSeq || 0;
        const fresh = [];
        for (let i = 0; i < k; i++) {
          B.broodSeq += 1; m.hp -= cost1;
          fresh.push({ side: 'enemy', ref: t.id, name: BROOD_NUMBERED ? TX('battle.dupName', { name: t.name, n: B.broodSeq }) : t.name, baseName: t.name, faction: t.faction, summoned: true, broodOf: m.id, id: `${m.id}-b${B.broodSeq}`, maxHp: hp1, hp: hp1,
            atk: Q.atk + Math.floor((m.broodGen - 1) / (Q.atkEvery > 1 ? Q.atkEvery : 1)) * Q.atkStep /* 2026-11-22h atkEvery: 威力 +atkStep every atkEvery batches (L7: 2) */, skill: Object.assign({ power: 0 }, t.skill), wander: Q.wander, wanderBack: true,
            acts: 0, block: 0, damage: 0, healing: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, charge: 0, extraRound: 0, extraTotal: 0 });
        }
        // 2026-11-20 用户「我方开始攻击时对方的史莱姆都消失了，打空气」: the new ones never take a fallen one's slot here (the UI draws the
        // lane as it stands at the END of the round, so a slot swap at the end hid the slimes that were still alive at its start);
        // they go in on her left, and the fallen ones leave at the START of the next round (pruneBrood) — a beat that is safe to draw
        // 2026-11-20 用户「参考第 10 关露西安的召唤：死掉的被顶替而不是推出去」(BROOD_REPLACE): each new one takes a fallen one's slot;
        // the fallen one's card (wasUnit) is in the event, so the UI keeps drawing it through the round and swaps it at this beat
        const slots = [];
        for (const f of fresh) {
          const i = BROOD_REPLACE ? B.enemies.findIndex((x) => x.broodOf === m.id && x.hp <= 0) : -1;
          if (i >= 0) { const old = B.enemies[i]; slots.push({ uid: f.id, was: old.id, wasUnit: unitView(data, B, old) }); B.gone = (B.gone || []).concat([statRow(old)]); f.slotOf = old.id; B.enemies[i] = f; }
          else B.enemies.splice(B.enemies.indexOf(m), 0, f);
        }
        push({ kind: 'summon', brood: true, round: B.round, uid: m.id, units: fresh.map((u) => unitView(data, B, u)), short: true, slots,
          parent: { uid: m.id, hp: m.hp, maxHp: m.maxHp, hpBefore: m.hp + k * cost1 }, text: TX('battle.brood', { name: m.name, n: k, atk: fresh[0].atk }) + (BROOD_SHOW_COST ? TX('battle.broodCost', { lost: k * cost1, hp: m.hp }) : '') }); // 2026-11-25 试玩: 母体分裂扣的血写进战报
      }
      // 2026-11-20 用户「还是有死掉的史莱姆没清理」(BROOD_CLEAR_END): the fallen ones no new slime replaced leave right after the spit,
      // at the end of the round they fell in, instead of staying grey through the next round's start
      if (BROOD_CLEAR_END) pruneBrood();
    }
    function placeSummons(fresh, boss) {
      const rest = [];
      for (const u of fresh) {
        const i = SUMMON_REPLACE_SLOT ? B.enemies.findIndex((x) => x.summoned && x.hp <= 0) : -1;
        if (i >= 0) { B.gone = (B.gone || []).concat([statRow(B.enemies[i])]); u.slotOf = B.enemies[i].id; B.enemies[i] = u; } else rest.push(u);
      }
      if (rest.length) B.enemies.splice(B.enemies.indexOf(boss), 0, ...rest);
    }
    // 2026-11-17 露西安 L10 召唤战 (用户): every S.every rounds of the wave (3rd, 5th … round) she calls the next group; her
    // minions never pass S.minions (she is not counted), a group that does not fit comes in part. A roll call with no room
    // left is a 「吞噬」 instead: she eats S.devour.share of her minions (lowest hp first), their hp left joins hers (max hp
    // grows with it), then every living ally loses eaten × dmgPer (护甲 first, like 地震). Event 'devour' (quake format).
    function rollCall(S, boss) {
      const wr = B.round - (B.waveStart || 1);
      const mins = alive(B.enemies).filter((u) => u.summoned);
      if (wr % S.every && !(S.emergency && !mins.length)) return; // 2026-11-17 紧急召唤 (anti 清场再爆发): an empty board is refilled at once
      if (S.calls > 0 && (S.called || 0) >= S.calls) { // 2026-11-23 SUMMON_CALLS (试玩 16「召唤物根本打不完」): the roll book runs out after S.calls groups
        if (!S.outSaid) { S.outSaid = true; if (SUMMON_OUT_ATK) boss.atk += SUMMON_OUT_ATK; push({ kind: 'summon', round: B.round, uid: boss.id, full: true, out: true, units: [], text: TX('battle.summonOut', { name: boss.name }) + (SUMMON_OUT_ATK ? TX('battle.summonOutAtk', { n: SUMMON_OUT_ATK }) : '') }); }
        return;
      }
      S.called = (S.called || 0) + 1;
      const room = Math.max(0, S.minions - mins.length);
      if (!room && S.devour && mins.length) return devour(S, boss, mins);
      const group = S.cycle[S.next % S.cycle.length];
      S.next += 1;
      const ids = group.slice(0, room);
      if (!ids.length) { push({ kind: 'summon', round: B.round, uid: boss.id, full: true, units: [], text: TX('battle.summonFull', { name: boss.name }) }); return; }
      const fresh = ids.map((id) => {
        S.seq += 1;
        const u = Object.assign({ side: 'enemy', acts: 0, block: 0, damage: 0, healing: 0, taken: 0, kills: 0, maxChain: 0, actions: 0, charge: 0, extraRound: 0, extraTotal: 0 }, clone(S.units[id]));
        u.id = `e${B.wi + 1}-s${S.seq}`; u.hp = u.maxHp;
        if (u.sumBlock > 0) u.block = u.sumBlock;
        return u;
      });
      placeSummons(fresh, boss);
      push({ kind: 'summon', round: B.round, uid: boss.id, units: fresh.map((u) => unitView(data, B, u)), short: SUMMON_TEXT_SHORT, slots: fresh.filter((u) => u.slotOf).map((u) => ({ uid: u.id, was: u.slotOf })),
        text: summonText(boss, fresh) });
    }
    function devour(S, boss, mins) {
      const n = Math.max(1, Math.ceil(mins.length * S.devour.share));
      const eaten = mins.map((u, i) => ({ u, i })).sort((a, b) => a.u.hp - b.u.hp || a.i - b.i).slice(0, n).map((x) => x.u);
      const gain = eaten.reduce((a, u) => a + u.hp, 0);
      for (const u of eaten) { u.hp = 0; u.block = 0; u.devoured = true; }
      B.gone = (B.gone || []).concat(eaten.map(statRow));
      B.enemies = B.enemies.filter((u) => !eaten.includes(u));
      boss.hp += gain; boss.maxHp = Math.max(boss.maxHp, boss.hp);
      const dmgN = eaten.length * S.devour.dmgPer, targets = [];
      for (const t of alive(B.allies)) {
        const blocked = Math.min(t.block || 0, dmgN), dmg = Math.min(t.hp, dmgN - blocked);
        if (blocked) t.block -= blocked;
        t.hp -= dmg;
        t.taken = (t.taken || 0) + dmg;
        boss.damage = (boss.damage || 0) + dmg;
        targets.push({ uid: t.id, id: t.ref, amount: dmg, blocked, blockAfter: t.block || 0, hpAfter: t.hp, kind: 'damage' });
      }
      push({ kind: 'devour', round: B.round, side: 'enemy', from: boss.id, uid: boss.id, eaten: eaten.map((u) => u.id), heal: gain, hpAfter: boss.hp, maxHp: boss.maxHp,
        amount: dmgN, targets, text: TX('battle.devour', { name: boss.name, names: listSeq(eaten.map((u) => u.name)), heal: gain, n: dmgN }) + groupHitEach(B.allies, targets) });
      downs(targets, B.allies);
    }
    function bossSkill() {
      B.emods = {};
      const boss = B.enemies.find((u) => u.advisorBoss && u.hp > 0);
      const cb = boss && advA && bossCombatOf(advA);
      if (!cb) return;
      if (cb.kind === 'clause' && !CLAUSE_BOSS_EVERY_ROUND) { // 2026-11-18: round 2, 4, 6 … of the wave, the most-charged ally
        const wr = B.round - (B.waveStart || 1) + 1, live = alive(B.allies);
        if (wr < CLAUSE_BOSS_FROM || (wr - CLAUSE_BOSS_FROM) % CLAUSE_BOSS_EVERY || !live.length) return;
        const t = live.reduce((b, x) => ((x.charge || 0) > (b.charge || 0) ? x : b), live[0]);
        B.emods.clause = t.id;
        push({ kind: 'advisorSkill', enemy: true, round: B.round, actor: boss.id, uid: boss.id, advisorId: advA.id, skill: cb.kind, name: cb.name, target: t.id,
          text: TX('battle.bossSkill.clauseMost', { boss: advA.name, clause: cb.name, name: t.name }) });
        return;
      }
      if (cb.kind === 'luckUp') { // BOSS_NEW_SKILLS 妮可塔「好运当头」: wave rounds 2, 4, 6 … every living enemy 幸运 +LUCK_UP_ADD this round
        const wr = B.round - (B.waveStart || 1) + 1, them = alive(B.enemies);
        if (wr < CLAUSE_BOSS_FROM || (wr - CLAUSE_BOSS_FROM) % CLAUSE_BOSS_EVERY || !them.length) return;
        if (LUCK_SKIP_JACKPOT && bigRoundOf(boss.skill, B.round)) return; // 2026-11-20: never on her 梭哈 round (R6 would stack to ×4); false = old
        B.luckUpEnemyRound = B.round;
        const what = TX('battle.bossSkill.luckUp', { n: LUCK_UP_ADD });
        push({ kind: 'advisorSkill', enemy: true, round: B.round, actor: boss.id, uid: boss.id, advisorId: advA.id, skill: cb.kind, name: cb.name, text: `${advA.name}：「${cb.name}」——${what}` });
        push({ kind: 'luckUp', side: 'enemy', round: B.round, n: LUCK_UP_ADD, units: them.map((u) => u.id), luck: them.map((u) => luckNow(u)), text: what });
        return;
      }
      B.emods[cb.kind] = true;
      // 2026-11-16 奥德丽 L10 (考穿甲): her boss data may carry formation { front, frontN, self, ramp } —
      //  front: armor for the front frontN enemies (not her) · self: armor for herself · ramp: her 威力 +ramp from round 2 on.
      //  Missing fields keep the old rule (front two +BOSS_FORMATION_BLOCK, nothing for her).
      const F = (advA.boss && advA.boss.formation) || {};
      //  all (2026-11-16 试玩后): every living enemy, her included, +all armor each round (replaces front / self when set).
      const fAll = cb.kind === 'formation' && F.all > 0 ? F.all : 0;
      const fFront = F.front != null ? F.front : BOSS_FORMATION_BLOCK, fN = F.frontN != null ? F.frontN : 2, fSelf = F.self || 0, fRamp = F.ramp || 0;
      const ramp = cb.kind === 'formation' && fRamp > 0 && B.round > 1 ? fRamp : 0;
      let what = fAll ? TX('battle.bossSkill.formationAll', { n: fAll }) : cb.kind === 'formation' ? TX('battle.bossSkill.formation', { n: fFront }) : BOSS_SKILL_TEXT()[cb.kind] || cb.text;
      if (!fAll && cb.kind === 'formation' && fSelf > 0) what += TX('battle.bossSkill.formationSelf', { n: fSelf });
      if (ramp) what += TX('battle.bossSkill.formationRamp', { n: ramp });
      push({ kind: 'advisorSkill', enemy: true, round: B.round, actor: boss.id, uid: boss.id, advisorId: advA.id, skill: cb.kind, name: cb.name, text: `${advA.name}：「${cb.name}」——${what}` });
      if (cb.kind === 'overtime' && OVERTIME_ROUND > 0) { // 2026-11-25 用户「露西安 每回合充能 +2」: every living enemy +OVERTIME_ROUND pips at round start (full → raised at her turn)
        const them = alive(B.enemies);
        for (const x of them) { const before = x.charge || 0; x.charge = before + OVERTIME_ROUND; push({ kind: 'charge', round: B.round, side: 'enemy', self: true, from: boss.id, to: x.id, amount: OVERTIME_ROUND, before, after: x.charge, gen: 0, text: TX('battle.chargeGift', { src: cb.name, name: x.name, n: OVERTIME_ROUND }) }); }
      }
      if (ramp) boss.atk += ramp;
      if (fAll) { for (const u of alive(B.enemies)) gainBlock(u, fAll, boss.id, false, { name: boss.name, skill: cb.name }); return; }
      if (cb.kind === 'formation' && fSelf > 0) gainBlock(boss, fSelf, boss.id, false, { name: boss.name, skill: cb.name });
      if (cb.kind === 'formation') for (const u of alive(B.enemies).filter((x) => !x.advisorBoss).slice(0, fN)) gainBlock(u, fFront, boss.id, false, { name: boss.name, skill: cb.name }); // 2026-11-14 护甲: front two +3 (2026-11-16: never her)
    }
    // One round = ally phase + enemy phase. A wave cleared mid-round ends the round; the next wave enters
    // at the start of the next round (never mid-chain).
    // 2026-11-16 开场暂停 (用户「第一回合之前应该有回合选择」): the battle opens with prologue() only — the enemies enter, the
    // opening lines, the advisor / boss opening skills — and stops (B.opening) at a pause BEFORE round 1, where the player
    // can use an item, the advisor skill, move, aim the hunters or just continue. The next round() skips the prologue it
    // already played (an advisor 附加条款 used at that pause still dazes this round).
    // 2026-11-20b POWER_LIVE: one 'pow' event per unit whose live 威力 changed (for round r), with from / to / delta — the card's
    // number follows it (round start: 怀表 +2 on round 1, back on round 2; end of round: 祝福 / 刃风 / mood / items for the next one)
    function powEvents(r) {
      if (!POWER_LIVE) return;
      B.powSeen = B.powSeen || {};
      for (const u of B.allies.concat(B.enemies)) {
        if (!(u.hp > 0)) continue;
        if (u.atk0 == null) u.atk0 = u.atk;
        const was = B.powSeen[u.id] != null ? B.powSeen[u.id] : u.atk0, now = powNow(data, B, u, r);
        B.powSeen[u.id] = now;
        const pp = powParts(data, B, u, r), pw = (B.powPartsSeen = B.powPartsSeen || {})[u.id] || []; B.powPartsSeen[u.id] = pp; // 2026-11-20 POW_SOURCE
        if (now !== was) {
          const amt = (list, ic) => list.filter((x) => x.ic === ic).reduce((s, x) => s + x.amount, 0), parts = [];
          pp.concat(pw).forEach((x) => { if (parts.some((y) => y.ic === x.ic)) return; const d = amt(pp, x.ic) - amt(pw, x.ic); if (d) parts.push({ ic: x.ic, label: (pp.find((y) => y.ic === x.ic) || x).label, amount: d, gone: !amt(pp, x.ic) && amt(pw, x.ic) > 0 }); }); // gone: 2026-11-20 用户「怀表第二轮应该是效果消失」 — a bonus that ended
          push({ kind: 'pow', round: r, uid: u.id, id: u.ref, side: u.side, from: was, to: now, delta: now - was, base: u.atk0, parts, all: pp.map((p) => ({ label: p.label, amount: p.amount })) });
        }
      }
    }
    function prologue() {
      B.round += 1;
      if (BLADE_STORM_ROUND) for (const a of B.allies) if (a.stormAtk) a.stormAtk = 0; // 2026-11-23 刃风: gone at round end
      if (B.needWave) { B.needWave = false; B.wi += 1; B.waveStart = B.round; loadWave(); }
      for (const l of B.pre) push(l);
      B.pre = [];
      // 第六批 H1-8: every wave counts its frenzy rounds from its own first round (was only frenzyPerWave / L11 phase 2):
      // a second wave starts calm again
      B.mult = frenzyMult(B.round - (B.waveStart || 1) + 1);
      if (B.mult > 1) push({ kind: 'frenzy', round: B.round, mult: B.mult, text: TX('battle.frenzy', { mult: B.mult }) });
      if (!SUMMON_ON_ACTION) summonRound(); // SUMMON_ON_ACTION: at her own action instead (doAction)
      pruneBrood(); // 2026-11-20 L7: last round's fallen small slimes leave now (round start), not at the spit
      bossSkill();
      if (B.mods.clause) clauseDaze();
      if (spreadOn(run)) rollIntents(run, B, B.round); // 2026-11-19 伤害分摊: whoever has no target for this round yet (a new wave, summons, the opening)
      powEvents(B.round); // 2026-11-20b POWER_LIVE
    }
    function open(pre) {
      snapStart(); // 2026-11-20 阵容同步
      R = [];
      for (const e of pre || []) push(e);
      prologue();
      broodRound(); // 2026-11-20 L7 史莱姆母体: the first batch at the opening
      if (spreadOn(run)) rollIntents(run, B, B.round); // (the new ones need a target for round 1)
      B.opening = true;
      B.lastRound = R;
      return R;
    }
    function round(pre) {
      snapStart();
      for (const x of B.enemies) if (x.dodgeHits) x.dodgeHits = 0; // 2026-11-20 L9 灰羽首领: her dodge stacks only within a round // 2026-11-20 阵容同步（换位已在暂停时生效，所以开始阵容是换过以后的；'move' 事件不再改阵容）
      R = [];
      for (const e of pre || []) push(e);
      if (B.opening) { B.opening = false; if (B.mods.clause && B.clauseRound !== B.round) clauseDaze(); }
      else if (WAVE_OPEN_PAUSE && B.needWave && B.wi >= 0) { prologue(); B.opening = true; B.lastRound = R; return R; } // 2026-11-20: the next wave enters, then the pause (as the battle's opening)
      else prologue();
      if (B.mods.fire > 0 && !B.over) fireBottle(); // 2026-11-22 燃烧瓶
      if (B.luckUpPending) { // 2026-11-20 妮可塔「好运当头」: this round, every ally 幸运 +LUCK_UP_ADD
        B.luckUpPending = false; B.luckUpRound = B.round;
        const us = alive(B.allies);
        push({ kind: 'luckUp', round: B.round, n: B.luckUpN || LUCK_UP_ADD, units: us.map((u) => u.id), luck: us.map((u) => luckNow(u)), text: TX('battle.luckUp', { n: B.luckUpN || LUCK_UP_ADD }) });
      }
      let outcome = null;
      if (B.round === 1 && B.wi === 0 && alive(B.enemies).some((u) => hasTrait0(u, 'ambush'))) outcome = runPhase('enemy', true); // 先攻
      if (!outcome) outcome = runPhase('ally');
      if (!outcome) outcome = runPhase('enemy');
      if (outcome === 'lose' && BADGE_LAST_STAND && B.allies.some((u) => u.badgeRevive && u.hp <= 0)) outcome = null; // 2026-11-22k: the last one down with 旧公会徽章 still stands up at the round's end
      if (outcome === 'lose') end(false);
      else if (outcome === 'wave') { if (B.wi + 1 < B.waveCount) B.needWave = true; else end(true); }
      if (!B.over && B.l8 && B.l8.mode === 'named' && B.round === 1 && B.wi === 0) l8Beat('wake'); // a teammate shakes the leader awake
      if (!outcome && chillArmor(run) && !B.over && !B.needWave) chillRound(); // 2026-11-25 寒气吃护甲（模拟用）: 在清甲之前算
      if (!outcome) clearBlock('ally', B.allies); // 2026-11-16 用户拍板: our block goes at the END of the round (a new wave: loadWave clears it)
      if (!B.over && !B.needWave && !chillArmor(run)) chillRound(); // 2026-11-24 墓穴的寒气 (CHILL)
      if (!B.over && !B.needWave) broodRound(); // 2026-11-20 用户「每一轮结束的时候分裂出新的，而不是开始的时候」
      if (!B.over && !B.needWave) badgeRevive(); // 2026-11-20 旧公会徽章 (BADGE_ROUND_END): the fallen holder stands up now
      if (!B.over && !B.needWave) for (const x of B.enemies) if (x.hp > 0 && Array.isArray(x.traits) && x.traits.includes('rampUp')) { const n = x.enraged && ENRAGE_PIERCE && !ENRAGE_ONCE ? 2 : 1; x.atk += n; /* 2026-11-20 狂暴后每回合 +2 */
        { const eff = x.atk + (RAMPUP_SHOW_ALL ? enemyRamp(B, x, B.round + 1) : 0); push({ kind: 'rampUp', round: B.round, side: 'enemy', uid: x.id, id: x.ref, n, atk: eff, text: RAMPUP_SHOW_ALL ? TX('battle.rampUpAll', { name: x.name, n, atk: eff, ramp: ENEMY_RAMP }) : TX('battle.rampUp', { name: x.name, n, atk: eff }) }); } } // 2026-11-22 试玩4 #4: the round-end step is logged, so 「记仇 +1（现 3）」 → 「+1（现 5）」 adds up (the UI ignores this kind) // 2026-11-20 用户 L9「首领每回合威力 +1」 (shown at the pause by powEvents)
      if (spreadOn(run) && !B.over && !B.needWave) rollIntents(run, B, B.round + 1); // 2026-11-19 伤害分摊: the next round's targets, shown at the pause
      if (!B.over && !B.needWave) powEvents(B.round + 1); // 2026-11-20b POWER_LIVE: the 威力 for the next round, shown at the pause
      // 2026-11-19 小铃战 镜像 (MIRROR_WAVE_CAP): a two-wave fight gets the round cap per wave (rounds since this wave stepped in)
      const capRound = MIRROR_WAVE_CAP && mirrorOn(levelCfg(data, B.level)) ? B.round - (B.waveStart || 1) + 1 : B.round;
      if (!B.over && capRound >= maxRounds) end(false);
      B.mods = {};
      B.emods = {};
      for (const u of B.enemies) if (u.dazed) u.dazed = false;
      for (const u of B.enemies) { if (u.vuln) u.vuln = false; if (u.powderWeak) { u.weak = Math.max(0, (u.weak || 0) - u.powderWeak); u.powderWeak = 0; } } // 2026-11-22 易伤药水 / 虚弱粉: one round
      B.lastRound = R;
      return R;
    }
    // playtest cheat. v2.4 [25]: it clears ONE wave — the current one (or the next, if it has not entered yet; its
    // reckoning / debts / memory fire as usual). On a multi-wave level (L10 advisor boss, L11 phase 2) the battle then
    // pauses with the next wave pending: it enters on the next 'continue' and must be fought (or cheated) on its own.
    function cheat(pre) {
      snapStart(); // 2026-11-20 阵容同步
      R = [];
      B.opening = false;
      for (const e of pre || []) push(e);
      const ce = { kind: 'cheat', text: TX('cheat.instantWin') };
      push(ce);
      if (B.round === 0) B.round = 1;
      if (B.needWave) {
        B.needWave = false; B.wi += 1; B.waveStart = B.round;
        const keep = B.allies.map((a) => a.hp);
        loadWave();
        B.allies.forEach((a, i) => { a.hp = Math.min(keep[i], a.maxHp); });
        for (const l of B.pre) push(l);
        B.pre = [];
      }
      for (const t of B.enemies) { if (t.hp > 0) t.hp = 0; t.block = 0; t.blockFrom = null; }
      B.cheating = true; downs(B.enemies.map((t) => ({ uid: t.id })), B.enemies); B.cheating = false;
      Object.assign(ce, { wave: B.wi + 1, waveCount: B.waveCount });
      if (B.wi + 1 < B.waveCount) {
        B.needWave = true;
        ce.cleared = 'wave';
        ce.text = TX('cheat.clearWave', { wave: B.wi + 1 });
        push({ kind: 'waveCleared', round: B.round, wave: B.wi + 1, next: B.wi + 2, waveCount: B.waveCount, text: TX('battle.waveCleared', { wave: B.wi + 1 }) });
      } else { ce.cleared = 'battle'; end(true); }
      B.mods = {};
      B.lastRound = R;
      return R;
    }
    return { round, cheat, open };
  }

  function armSkill(data, run, on) {
    const adv = advisorData(data, run);
    if (on && !(adv && run.advisorPresent && combatOf(adv))) fail('no advisor skill');
    run.skillArmed = !!on;
  }
  // prep → fight: the entrance (enemies, opening lines and skills), then the opening pause in phase 'battle' (2026-11-16).
  function startFight(data, run, ev) {
    run.battle = initBattle(data, run);
    const pre = [];
    if (run.skillArmed) { // 方案 B: the advisor skill armed at the formation fires in round 1 (the battle's one use)
      run.skillArmed = false;
      const adv = advisorData(data, run), cb = adv && run.advisorPresent ? combatOf(adv) : null;
      if (cb) { const B = run.battle; B.advisorSkillUsed = true; B.mods[cb.kind] = true;
        const cv = combatView(adv, run), nAmt = advSkillAmt(run, cb.kind);
        pre.push({ kind: 'advisorSkill', open: true, advisorId: adv.id, skill: cb.kind, name: cb.name, text: `${adv.name}：「${cb.name}」——${cv.text}` });
        if (giftsPips(cb.kind)) pre.push(...giftPips(B, nAmt, 'advisor', cb.name));
        if (cb.kind === 'formation') B.formationN = nAmt;
        if (cb.kind === 'luckUp') { B.luckUpPending = true; B.luckUpN = nAmt; } }
    }
    battleOps(data, run, run.battle).open(pre); // 2026-11-16 开场暂停: the entrance only; round 1 plays on the first pause action
    if (run.battle.over) return finishBattle(data, run, ev);
    run.phase = 'battle';
    if (!run.flags.firstPause) { run.flags.firstPause = true; advisorGuide(data, run, run.battle.lastRound, 'firstPause'); }
  }
  function cheatWin(data, run, ev) {
    run.cheated = true;
    battleOps(data, run, run.battle).cheat([]);
    if (run.battle.over) finishBattle(data, run, ev);
    else run.phase = 'battle'; // v2.4 [25]: the next wave is still to come
  }
  // v2.3 §H: a lost battle re-scored as a win (from battleResult, or from gameOver before the epilogue); the run goes on
  function cheatAfterLoss(data, run, ev) {
    const B = run.battle;
    if (!B || !B.over || B.win || (run.phase === 'gameOver' && run.defeatLevel == null)) fail('cheatWin needs a lost battle');
    if (B.waveCount > 1 && B.wave < B.waveCount) return cheatResume(data, run, ev, B.wave);
    B.win = true;
    for (const u of B.allies || []) u.hp = Math.max(1, u.hp);
    for (const u of B.enemies || []) u.hp = 0;
    for (const id of run.party) { const m = run.members[id]; m.hp = clamp(Math.max(1, hpOf(m)), 1, m.maxHp); }
    for (const id of Object.keys(run.enemyRecord || {})) if ((run.enemyRecord[id].enemyAt || []).includes(run.level)) run.enemyRecord[id].defeated = true;
    if (run.level === 10) run.advisorDefeated = true;
    run.cheated = true;
    run.outcome = null;
    run.defeatLevel = null;
    run.earlyDefeat = undefined;
    ev.push({ kind: 'cheat', cheat: 'win', from: run.phase, level: run.level, text: TX('cheat.win') });
    run.queue = postQueue(data, run, levelCfg(data, run.level));
    advance(data, run, ev);
  }
  // v2.4 [25]: lost before the last wave of a multi-wave level (L10 wave 1, L11 phase 1) → the lost wave counts as
  // cleared and the battle resumes at the next one (allies back at full hp, a fresh round budget): the advisor boss /
  // phase 2 can never be skipped by a cheat.
  function cheatResume(data, run, ev, lostWave) {
    for (const id of run.party) { const m = run.members[id]; m.hp = m.maxHp; }
    run.cheated = true;
    run.outcome = null;
    run.defeatLevel = null;
    run.queue = [];
    ev.push({ kind: 'cheat', cheat: 'win', from: run.phase, level: run.level, wave: lostWave, resumed: true, text: TX('cheat.resumeWin', { lostWave }) });
    run.battle = initBattle(data, run);
    run.battle.wi = lostWave - 1;
    run.phase = 'battle';
    battleStep(data, run, ev, [{ kind: 'cheat', cheat: 'resume', wave: lostWave + 1, text: TX('cheat.resumeFrom', { wave: lostWave + 1 }) }]);
  }
  function battleStep(data, run, ev, pre) {
    battleOps(data, run, run.battle).round(pre);
    run.battle.swapDone = false; // 2026-11-19 换位/暂停连做: a new pause, a new swap
    if (run.battle.over) finishBattle(data, run, ev);
  }
  // 2026-11-19 换位/暂停连做: a pause action. PAUSE_MULTI: its effect has landed (the caller did it); the events go to the
  // action's ev now (the UI shows them at once) and wait in B.pendingPre for the round 'continue' plays. Off = the old: play the round now.
  function pauseAct(data, run, ev, pre) {
    const B = run.battle;
    if (!pauseMultiOn(run)) return battleStep(data, run, ev, pre);
    B.pendingPre = (B.pendingPre || []).concat(pre);
    B.pauseActs = (B.pauseActs || 0) + 1; // PAUSE_ACT_COUNT
    for (const e of pre) ev.push(Object.assign({ pending: true }, e));
  }
  function battleStats(B) {
    const allies = B.allies.map(statRow);
    const enemies = (B.gone || []).concat(B.enemies.map(statRow));
    const score = (r) => r.damage + r.healed;
    const best = allies.reduce((b, r) => (!b || score(r) > score(b) || (score(r) === score(b) && r.kills > b.kills) ? r : b), null);
    return { allies, enemies, rounds: B.round, mvp: best && score(best) > 0 ? best.uid : null };
  }
  const battleUnits = (B) => B.allies.map((a) => ({ id: a.id, name: a.name, side: 'ally', maxHp: a.maxHp, wave: 0 }))
    .concat(...B.waves.map((w, i) => w.units.map((u) => ({ id: u.id, name: u.name, side: 'enemy', maxHp: u.maxHp || u.hp, wave: i + 1 }))));
  const battleDps = (B) => { const s = {}; for (const a of B.allies) s[a.id] = { damage: a.damage, healing: a.healing, dps: r2(a.damage / Math.max(1, B.round)) }; return s; };

  // ---- 2026-11-14 片尾人物数据亮点: whole-run tallies, read only by the credits (ui/credits.js pickHighlights) ----
  const braveOf = (run) => { const L = statOf(run, LEADER_ID); return L.brave || (L.brave = {}); };
  // damage 护甲 took off a hit, credited to whoever gave that block (2026-11-14: blockFrom)
  function tallyBlock(B, id, n) {
    if (!(n > 0) || !id) return;
    const T = B.tally || (B.tally = {});
    T[id] = (T[id] || 0) + n;
  }
  // what she did in this battle, read back off its log (the fight itself is untouched)
  function tallyLog(run, B, id, S, win) {
    let down = 0;
    for (const e of B.log || []) {
      if (e.kind === 'down' && e.side === 'ally' && e.uid === id) down += 1;
      if (e.kind !== 'action' || e.side !== 'ally' || e.actor !== id) continue;
      if (e.skillKind === 'guard') bump(S, 'guards');
      if (e.chainDepth > 0) bump(S, 'chains');
      if (e.hits > 1) { bump(S, 'combos'); bump(S, 'comboHits', e.hits); }
      if (e.killCall && e.killCall.n === 2) bump(S, 'doubleKills');
      if (e.killCall && e.killCall.n >= 3) bump(S, 'tripleKills');
      if (e.heal) continue;
      for (const t of e.targets || []) {
        if (t.kind !== 'damage' || !(t.amount > 0)) continue;
        bump(S, 'hits');
        if (t.crit) bump(S, 'crits');
        if (t.amount > (S.maxHit || 0)) S.maxHit = t.amount;
      }
    }
    if (B.tally && B.tally[id]) bump(S, 'blocked', B.tally[id]);
    if (down) { bump(S, 'downs', down); if (win) bump(S, 'standUps'); }
    if (id === LEADER_ID && S.guards) braveOf(run).guard = S.guards; // 挡在前面的盾击
  }

  // a girl who stood on the other side (rejected / handed over) keeps her own tally of those fights
  function tallyFoes(run, B, stats) {
    for (const r of stats.enemies || []) {
      const u = B.waves.flatMap((w) => w.units).find((x) => x.id === r.uid);
      if (!u || !u.candidate || !u.ref) continue;
      const S = statOf(run, u.ref);
      bump(S, 'foeBattles'); bump(S, 'foeDamage', r.damage); bump(S, 'foeKills', r.kills);
    }
  }

  function finishBattle(data, run, ev) {
    const B = run.battle;
    const win = B.win;
    const dps = battleDps(B);
    const stats = battleStats(B);
    const xpRows = {}; // 2026-11-19 战报 XP 栏: id → xpGainFor(…) of this battle's +XP
    // record per-member dps, consume one-battle statuses
    for (const id of run.party) {
      const m = run.members[id];
      const u = B.allies.find((x) => x.id === id && !x.turned);
      if (u) m.hp = u.hp > 0 ? Math.min(u.hp, m.maxHp) : win ? 1 : 0; // v2.3 §A[17]: hp carries over; a down member stands up at 1 after a win
      const row = stats.allies.find((r) => r.uid === id);
      if (row) { // v2.3 §B11 cumulative stats
        const S = statOf(run, id);
        S.battles += 1;
        for (const k of ['damage', 'healed', 'taken', 'kills', 'actions']) S[k] += row[k];
        S.maxChain = Math.max(S.maxChain, row.maxChain);
        if (row.damage > 0 && (!S.best || row.damage > S.best.damage)) S.best = { damage: row.damage, level: run.level };
        tallyLog(run, B, id, S, win); // @stats
      }
      if (u && (XP_DOWNED || u.hp > 0) && !(LOSS_NO_XP && !win)) { // 2026-11-22 试玩4 #13 (LOSS_NO_XP): a lost battle ends the run — no level-ups on the way out // 2026-11-16: each battle, every living member +1 经验 · 2026-11-20 用户「死掉了不加经验吗？这个不好吧」: the fallen too (XP_DOWNED)
        // 2026-11-19 战报 XP 栏 (用户「在战报里显示每个人加了多少、谁升级了」): what this +XP does, read before it is applied (UI only)
        const xg = xpGainFor(data, run, id, [{ type: 'xp', n: XP_BATTLE }]); if (xg) xpRows[id] = xg;
        const before = statsOf(m, isLeader(id)); if (gainXp(m, XP_BATTLE)) statChange(data, run, ev, id, before, 'battle:xp');
      }
      const d = dps[id] ? dps[id].dps : 0;
      m.lastDps = d;
      m.dpsHistory.push(d);
      m.statuses = m.statuses.filter((s) => s !== 'slow-start');
      delete m.slowX2; delete m.slowUp2;
      if (!isLeader(id)) { const g = girlMem(run, id); if (!g.levels.includes(run.level)) g.levels.push(run.level); }
    }
    tallyFoes(run, B, stats); // @stats
    const ret = B.waves.flatMap((w) => w.units).find((u) => u.candidate && u.corruption);
    // 2026-11-19 试玩修 剧情: gave — did the leader ever hand her a card (her memory)? the 「有一样是你给的」 talk needs it
    if (ret) noteRecent(run, { when: 'afterReturn', ctx: { enemy: ret.name, enemyId: ret.ref, gave: ((girlMem(run, ret.ref).cards) || []).length > 0 } });
    // 2026-11-19 试玩修 剧情: a hard day — someone in the party went down, or a girl who once stood with us was fought
    run.hardDay = !!ret || (B.log || []).some((e) => e.kind === 'down' && e.side === 'ally');
    for (const w of B.waves) for (const u of w.units) if (u.candidate) {
      const r = run.enemyRecord[u.ref] || (run.enemyRecord[u.ref] = { enemyAt: [], defeated: false });
      if (u.softUsed) r.softDone = true; // SOFT_ONCE: she spared you once — not again this run
      if (u.wokeMember) { r.wokeAt = run.level; continue; } // 2026-11-24 试玩「结局说她第 11 关站在了对面，可她挣脱了控制」: woke = she ended that fight with us
      if (!r.enemyAt.includes(run.level)) r.enemyAt.push(run.level);
      if (win) r.defeated = true;
    }
    if (win && run.level === 10) run.advisorDefeated = true;
    // Victory steadies the broken: anyone at mood -2 recovers to -1 after a won battle.
    if (win) {
      const d = {};
      for (const id of run.party) if (run.members[id].mood <= -2) addMood(d, id, 1, TX('mood.why.winSteady'));
      applyMoods(data, run, ev, d);
      // §9 flow 「烤栗子」: after each win the lowest-mood member (first in order on ties) gets +1
      if (advisorFlow(data, run) === 'chestnut') {
        const pool = sacrificable(run);
        if (pool.length) {
          const low = pool.reduce((b, id) => (run.members[id].mood < run.members[b].mood ? id : b), pool[0]);
          const before = run.members[low].mood;
          const moodEv = [];
          const cd = {}; addMood(cd, low, 1, TX('mood.why.chestnut', { advisor: advisorData(data, run).name })); applyMoods(data, run, moodEv, cd);
          // FEEDBACK-1112 #27: the advisor herself hands it over (her face, her voice), and the same line names the
          // mood gain — so the ↑ that follows has its cause right in front of it.
          if (run.members[low].mood !== before) {
            run.chestnuts = run.chestnuts || {}; run.chestnuts[low] = (run.chestnuts[low] || 0) + 1; // 2026-11-21 栗子 meta: who ate how many (CHESTNUT_POISON)
            const nm = nameOf(data, low), lbl = MOOD_LABELS()[run.members[low].mood];
            ev.push({ kind: 'advisorFlow', flow: 'chestnut', id: low, speaker: run.advisor, speakerId: run.advisor, name: advisorData(data, run).name, expr: 'happy',
              text: lbl ? TX('camp.chestnutMood', { name: nm, advisor: advisorData(data, run).name, mood: lbl }) : TX('camp.chestnut', { name: nm, advisor: advisorData(data, run).name }) });
          }
          ev.push(...moodEv);
          // 2026-11-24 试玩「栗子发作前没有任何提示，有点阴」(CHESTNUT_HINT): her 2nd chestnut, the girl notices something — once each
          if (CHESTNUT_HINT && CHESTNUT_POISON && run.chestnuts && run.chestnuts[low] === 2 && !isLeader(low))
            ev.push({ kind: 'line', speaker: low, speakerId: low, name: nameOf(data, low), expr: 'sad', chestnut: true, text: TX('camp.chestnutNumb') });
        }
      }
      // 试玩反馈 2026-11-14 晚 #21 (mood was too scarce): a win where nobody fell lifts every girl below 心情 1 by +1
      // 2026-11-22 试玩4 #2 (FLAWLESS_COUNTS_DOWNS): someone who fell and got back up (复活药 / 徽章) is not 「没有一个人倒下」 — the log's downs count too
      const fd = {}, fellLog = (B.log || []).some((e) => e.kind === 'down' && e.side === 'ally'), flawless = !B.allies.some((u) => !u.turned && u.hp <= 0) && !(FLAWLESS_COUNTS_DOWNS && fellLog);
      if (flawless) {
        const lift = run.party.filter((id) => !moodless(run, id) && run.members[id] && (run.members[id].mood || 0) < FLAWLESS_MOOD_CAP); // 2026-11-20 团长心情: the leader too
        for (const id of lift) addMood(fd, id, 1, TX('mood.why.flawless'));
        if (lift.length) ev.push({ kind: 'line', speaker: 'narrator', name: '', expr: null, key: 'flawlessMood', text: TX('battle.flawlessMood') });
        applyMoods(data, run, ev, fd);
      }
      // 2026-11-20 团长心情: a win that cost someone a fall weighs on the leader (−1). At LEADER_DOWN_MOOD_LEVELS only her
      // OWN fall counts (the 墓穴 test knocks someone down on purpose — that is the lesson, not a heartache)
      if (!flawless && leaderMoodOn(run) && run.party.includes(LEADER_ID)) {
        const own = levelsWith(data, 'leaderDownMood', LEADER_DOWN_MOOD_LEVELS).includes(run.level); // review #5
        const fell = (B.log || []).some((e) => e.kind === 'down' && e.side === 'ally' && (!own || isLeader(e.uid)));
        if (fell) { const ld = {}; addMood(ld, LEADER_ID, -1, TX('mood.why.someoneFell')); applyMoods(data, run, ev, ld); }
      }
      advisorGuide(data, run, ev, 'afterWin', { fell: (B.log || []).some((e) => e.kind === 'down' && e.side === 'ally') || B.allies.some((u) => !u.turned && u.hp <= 0) });
      if (guildHas(run, 'supply-cart')) { // 2026-11-22 遗物 补给马车: every living member 生命 +RELIC_CART (never above max)
        for (const id of run.party) { const m = run.members[id]; if (!m || hpOf(m) <= 0 || hpOf(m) >= m.maxHp) continue; const before = statsOf(m, isLeader(id)); m.hp = Math.min(m.maxHp, hpOf(m) + RELIC_CART); statChange(data, run, ev, id, before, 'relic:supply-cart'); }
      }
      gainGold(run, winGold(data, run), 'win', ev); // 2026-11-14 金币
    }
    let comment = null;
    if (win && run.advisorPresent) {
      const a = advisorData(data, run);
      const top = run.party.reduce((b, id) => ((dps[id] ? dps[id].dps : 0) > (dps[b] ? dps[b].dps : 0) ? id : b), run.party[0]);
      // 2026-11-22 试玩4 #2: the neutral comments say 「阵型没乱」 / 「没人受重伤」 — after a battle where someone fell, only the top-dps praise
      const anyFell = (B.log || []).some((e) => e.kind === 'down' && e.side === 'ally') || B.allies.some((u) => !u.turned && u.hp <= 0);
      let key = rngNext(run) < 0.5 ? 'postBattleTopDps' : 'postBattleNeutral';
      if (FLAWLESS_COUNTS_DOWNS && anyFell) key = 'postBattleTopDps';
      const arr = (a.comments && a.comments[key]) || [];
      if (arr.length) comment = resolveLine(data, run, rngPick(run, arr), { name: nameOf(data, top) }, 'advisor').text;
    }
    if (!REVEAL_ON_EFFECT && win && run.level >= 1 && run.level <= 4) { // 2026-11-20 起作用时才说: no reveal for a trait that did nothing
      const pool = run.party.filter((id) => (cand(data, id).hiddenTraits || []).some((t) => !run.members[id].revealed.includes(t)));
      if (pool.length) {
        const id = rngPick(run, pool);
        reveal(data, run, ev, id, cand(data, id).hiddenTraits.find((t) => !run.members[id].revealed.includes(t)));
      }
    }
    run.battle = {
      over: true, win, rounds: B.round, round: B.round, stats, wave: B.wi + 1, waveCount: B.waveCount, log: B.log, dps, units: battleUnits(B), advisorComment: comment, xp: xpRows, // 2026-11-19 战报 XP 栏
      allies: B.allies.map((u) => unitView(data, null, u)), enemies: B.enemies.map((u) => unitView(data, null, u)), lastRound: B.lastRound,
    };
    run.phase = 'battleResult';
  }

  // Dry run of the current level's battle (auto-continue every pause); does not touch the given run.
  function simulateBattle(data, run) {
    const r = useRun(clone(run));
    const B = initBattle(data, r);
    const ops = battleOps(data, r, B);
    while (!B.over) ops.round([]);
    return { win: B.win, rounds: B.round, log: B.log, dps: battleDps(B), units: battleUnits(B) };
  }

  // ---------- view ----------
  function memberView(data, run, id) {
    const m = run.members[id], c = cand(data, id);
    const combo = ringCombo(isLeader(id) ? m.combo : c.combo, m); // 2026-11-21 转向指环: the formation arrow turns too
    const pu = { side: 'ally', combo, bond: m.bond || null, mood: m.mood || 0, noMood: moodless(run, id), tokens: m.tokens || [] }, mk = chargeK(null, pu); // 充能 k outside battle
    const common = { keywords: keywordsFor(data, m.skill, combo, mk), skillName: m.skill.name, comboName: combo ? combo.name : null, chargeDir: combo ? combo.direction : null, k: mk,
      actionText: actionTextFor(m.skill, m.atk, false, isLeader(id) ? m.role : c.role, null, null, perkOf(data, run, id)), bonusText: bonusTextFor(combo, mk, false, chargeKeep(pu)),
      skillLv: lvOf(m.skill), perkText: perkText(perkOf(data, run, id)), chargeFull: fullOf({ side: 'ally', bond: m.bond || null, tokens: m.tokens || [], fullAt: run.blessing && run.blessing.fx && run.blessing.fx.type === 'teamCharge' ? CHARGE_FULL + (run.blessing.fx.delta || 0) : 0 }) + (m.chargeSlow > 0 ? m.chargeSlow : 0) /* 2026-11-24 用户「查看队伍时看不到充能满格数」 */, ...xpInfo(m), // 2026-11-16 经验条
      chargeFull: fullOf(Object.assign({}, pu, run.blessing && run.blessing.fx && run.blessing.fx.type === 'teamCharge' ? { fullAt: CHARGE_FULL + (run.blessing.fx.delta || 0) } : {})) + (m.chargeSlow > 0 ? m.chargeSlow : 0) }; // 2026-11-22g 试玩7 #15: her 充能 full mark before a battle (信赖 / 短弦扣 / 铃之急响 / 面具印记), view only: xp / lv / xpLvStart / xpNext / maxed
    if (isLeader(id)) {
      return Object.assign({ id, name: c.name, isLeader: true, role: m.role, roleLabel: ROLE_LABELS()[m.role], hp: hpOf(m), maxHp: m.maxHp, atk: m.atk,
        skill: freshSkill(data, run, id, m.skill), mood: moodless(run, id) || (m.mood == null && !LEADER_MOOD_UNSET_ZERO) ? null : m.mood || 0, moodLabel: moodless(run, id) || (m.mood == null && !LEADER_MOOD_UNSET_ZERO) ? null : MOOD_LABELS()[m.mood || 0], /* 2026-11-20 用户「出战排列团长没有心情图标」: was always null */ luck: m.luck || 0, /* 2026-11-22e 试玩5 #7 */ bond: null, visibleTags: [], revealedTraits: [], relation: null, tokens: m.tokens.slice(),
        statuses: m.statuses.slice(), avgDps: avgOf(m), lastDps: m.lastDps, combo: m.combo ? clone(m.combo) : null }, common);
    }
    const rel = c.relation ? { with: c.relation.with, withName: nameOf(data, c.relation.with), kind: c.relation.kind, text: c.relation.text } : null;
    return Object.assign({
      id, name: c.name, role: c.role, roleLabel: ROLE_LABELS()[c.role], hp: hpOf(m), maxHp: m.maxHp, atk: m.atk,
      skill: freshSkill(data, run, id, m.skill), mood: m.mood, moodLabel: MOOD_LABELS()[m.mood], luck: m.luck || 0 /* 2026-11-22e 试玩5 #7 */, bond: m.bond || null, visibleTags: (c.visibleTags || []).slice(),
      revealedTraits: m.revealed.map((t) => ({ trait: t, label: TRAIT_LABELS()[t] || t, text: revealText(data, id, t) || '' })), // 2026-11-19 伤害分摊 E1: one line per trait
      relation: rel, tokens: m.tokens.slice(), statuses: m.statuses.slice(), avgDps: avgOf(m), lastDps: m.lastDps,
      combo: c.combo ? clone(c.combo) : null,
    }, common);
  }
  function candidateView(data, run, c, other) {
    const v = {
      id: c.id, name: c.name, role: c.role, roleLabel: ROLE_LABELS()[c.role], hp: allyHp(c.hp), atk: c.atk, luck: LUCK_STAT ? c.luck || 0 : 0, /* 2026-11-22g 试玩7 #7: her born 幸运 on the interview card */ skill: clone(c.skill),
      look: c.look, bio: c.bio, visibleTags: (c.visibleTags || []).slice(), combo: c.combo ? clone(c.combo) : null,
      keywords: keywordsFor(data, c.skill, c.combo), skillName: c.skill.name, comboName: c.combo ? c.combo.name : null,
      actionText: actionTextFor(c.skill, c.atk, false, c.role, null, null, c.perk), bonusText: bonusTextFor(c.combo, baseK(c.combo), false), skillLv: lvOf(c.skill), perkText: perkText(c.perk),
      // her one-line self-introduction (v2 interview step 1): candidates[].intro if present, else her first own interview line
      intro: (() => { const raw = c.intro || (c.interview || []).find((l) => l.speaker === 'self'); return raw ? resolveLine(data, run, Object.assign({}, typeof raw === 'string' ? { text: raw } : raw, { speaker: c.id }), { name: c.name }, c.id) : null; })(),
      interview: (c.interview || []).map((l) => {
        const sp = l.speaker === 'rival' && other ? other : c;
        return { speakerId: sp.id, speaker: sp.name, text: fill(l.text, Object.assign(baseCtx(data, run), { name: c.name })) };
      }),
    };
    if (run.recruitPrice) { v.price = hirePriceFor(data, run, c); v.afford = goldOf(run) >= v.price; } // 2026-11-20 招人花钱
    return v;
  }
  function conflictView(data, run, round) {
    const cf = conflictFor(data, round);
    if (!cf) return null;
    const pair = roundPair(data, round);
    return {
      id: cf.id || pair.map((c) => c.id).join('|'), title: cf.title || '',
      lines: (cf.lines || []).map((l) => resolveLine(data, run, l, {}, 'narrator')),
      options: pair.map((c) => Object.assign({ id: c.id, name: c.name, label: fill(dig(cf, 'options', c.id) || TX('interview.side', { name: c.name }), baseCtx(data, run)) }, sideEffect(data, run, round, c.id))),
    };
  }
  // G2 #9: what siding with `pickId` does, in words — shown on the option before the pick and as a toast after it.
  // for: the one you back (信赖 → hired: mood +1, bonus +10% · rejected: grudge low, atk −1 and one hesitation)
  // against: the other one (hired: mood −1, no bonus · rejected: grudge high, hp +2 atk +1)
  const SIDE_AGAINST = lazy(() => (TX('interview.sideAgainst')));
  function sideEffect(data, run, round, pickId) {
    const pair = roundPair(data, round), me = pair.find((c) => c.id === pickId), other = pair.find((c) => c.id !== pickId);
    const out = { effect: TX('interview.bondEffect', { who: me ? me.name : TX('interview.her') }) + (SIDE_COST && me && me.sideCost > 0 ? TX('interview.sideCostTag', { n: me.sideCost }) : ''), effectMore: TX('interview.bondMore') };
    if (other) { out.against = SIDE_AGAINST(); out.againstId = other.id; } // 第六批 H1-4: no write-up of the other girl, one plain line
    return out;
  }
  // §2.3: enemies stay hidden in prep; scouts (outlander identity / nicota flow) get per-wave totals only.
  function prepInfo(data, run) {
    const cfg = levelCfg(data, run.level);
    const waves = buildWaves(data, run, cfg);
    const out = { enemyCount: waves.reduce((s, w) => s + w.units.length, 0), waveCount: waves.length, scout: null };
    if (leaderHas(run, 'scout') || advisorFlow(data, run) === 'scout') {
      out.scout = waves.map((w, i) => ({ wave: i + 1, count: w.units.length, hpTotal: w.units.reduce((s, u) => s + u.maxHp, 0), atkMax: Math.max(0, ...w.units.map((u) => u.atk)) }));
    }
    // lucienne 「档案」 (flow kind reveal-trait; v2 hides no traits): her dossier names every returning girl
    // in each wave, with her corruption and grudge, before the fight.
    if (advisorFlow(data, run) === 'reveal-trait') {
      out.dossier = waves.map((w, i) => ({ wave: i + 1, count: w.units.length,
        returning: w.units.filter((u) => u.corruption).map((u) => ({ id: u.ref, name: u.name, corruption: u.corruption, grudge: u.grudge || null })) }));
    }
    return out;
  }
  // 2026-11-19 伤害分摊 §4: round 1 of the coming battle, for the formation screen (the battle does not exist yet).
  // Built like initBattle (first wave + our current order and hp, the bell wound included) on light copies — the run is
  // not touched; the targets come from the same hashRand rolls the battle will make, so they match round 1 exactly.
  // → v.preIntent = { round: 1, wave: 1, enemies: [{ uid, id, name, targetRule, intent }], allies: [{ id, uid, aimedBy }] }
  function preIntentView(data, run) {
    const cfg = levelCfg(data, run.level);
    if (!cfg || !spreadOn(run)) return null;
    let waves;
    try { waves = buildWaves(data, Object.assign({}, run, { flags: clone(run.flags || {}) }), cfg); } catch (e) { return null; }
    const w = waves[0];
    if (!w) return null;
    const allies = run.party.map((id, idx) => allyUnit(data, run, id, idx));
    if (run.wounded) for (const u of allies) u.hp = Math.min(u.hp, Math.ceil(u.maxHp * WOUND_PCT));
    const B = { level: run.level, round: 1, wi: 0, allies, enemies: w.units.map((u) => Object.assign({ side: 'enemy' }, u)), spread: true };
    rollIntents(run, B, 1);
    const iv = intentsView(run, B);
    return { round: 1, wave: 1, waveCount: waves.length,
      enemies: B.enemies.map((u) => ({ uid: u.id, id: u.ref, name: u.name, targetRule: targetRuleIn(B, u), intent: iv.intents[u.id] || null })),
      allies: allies.map((u) => ({ id: u.id, uid: u.id, aimedBy: iv.aimedBy[u.id] || 0 })) };
  }
  function itemsView(data, run) {
    return (run.items || []).map((id) => { const it = itemDef(data, id) || { id, name: id, text: '' }; return { itemId: id, name: it.name, text: it.text, needsTarget: !!itemAim(run, it), target: itemAim(run, it), kind: itemKind(it) || null }; }); // 2026-11-22 target: 'ally' | 'enemy' | 'fallen' | null
  }
  function battleView(data, run) {
    const B = run.battle;
    const a = advisorData(data, run);
    const cb = a && run.advisorPresent ? combatOf(a) : null;
    const out = {
      round: B.round, wave: B.wi + 1, waveCount: B.waveCount,
      opening: !!B.opening, // 2026-11-16 开场暂停: the pause before round 1 (lastRound = the entrance only)
      // 修复 2026-11-14 多波战斗: this wave is down and the next one enters on the next 'continue' — the UI advances by itself
      nextWave: !!(B.needWave && !B.over && B.wi >= 0 && B.wi + 1 < B.waveCount),
      allies: B.allies.map((u) => unitView(data, B, u)), enemies: B.enemies.map((u) => unitView(data, B, u)),
      lastRound: clone(B.lastRound),
      roundStart: B.roundStart ? clone(B.roundStart) : null, // 2026-11-20 阵容同步: 这一回合开始时的双方阵容（画面按它起画）
      pause: {
        move: !(swapCostOn(run) && B.swapDone), // 2026-11-19 换位/暂停连做: the one swap of this pause is spent
        swapCost: swapCostOn(run), multi: pauseMultiOn(run), swapDone: !!B.swapDone,
        acted: PAUSE_ACT_COUNT ? ((B.pendingPre || []).length ? Math.max(1, B.pauseActs || 0) : 0) : (B.pendingPre || []).length, // queued pause actions (PAUSE_MULTI): the drivers that do one thing a pause continue after one
        pending: clone(B.pendingPre || []),
        advisorSkill: cb ? { available: !B.advisorSkillUsed, used: !!B.advisorSkillUsed, kind: cb.kind, name: cb.name, text: (combatView(advisorData(data, run), run) || cb).text } : null,
        items: itemsView(data, run),
        canAim: B.allies.filter((u) => u.hp > 0 && !coat(u) && u.role === 'adc' && u.skill && u.skill.kind === 'aim').map((u) => u.id), // 猎人锁定
        canHealPick: HEAL_PICK ? B.allies.filter((u) => u.hp > 0 && !coat(u) && u.skill && u.skill.kind === 'heal').map((u) => u.id) : [], // 2026-11-20 牧师治疗
      },
    };
    // 2026-11-19 伤害分摊 intent contract (docs/SPEC-damage-spread.md §4): each living enemy view gets
    // intent { kind, targets: [ally uid…], all } for the round the next 'continue' plays; each ally view gets aimedBy (an all-hit counts)
    if (spreadOn(run) && !B.over) {
      const W = withIntentRound(B), iv = intentsView(run, W);
      out.intentRound = W.round;
      out.enemies.forEach((e) => { if (iv.intents[e.uid]) e.intent = iv.intents[e.uid]; });
      out.allies.forEach((x) => { x.aimedBy = iv.aimedBy[x.uid] || 0; });
    }
    return out;
  }
  // the round the intents are for: B.round + 1 at a pause (rolled at the end of the round), B.round at the opening pause.
  // The view never writes into the run: a light copy of B whose round is that round.
  function withIntentRound(B) {
    const r = B.opening ? B.round : B.round + 1;
    const ens = (B.enemies || []).map((u) => Object.assign({}, u, { intent: u.intent ? Object.assign({}, u.intent, { uids: (u.intent.uids || []).slice() }) : u.intent }));
    return Object.assign({}, B, { round: r, enemies: ens });
  }
  function summary(data, run) {
    const fates = data.candidates.map((c) => {
      const s = run.sacrificed.find((x) => x.id === c.id);
      const rj = run.rejected.find((x) => x.id === c.id);
      const er = run.enemyRecord[c.id] || { enemyAt: [], defeated: false };
      const f = { id: c.id, name: c.name, fate: s ? 'sacrificed' : rj ? 'rejected' : run.members[c.id] ? 'survived' : 'unmet', round: c.round,
        enemyAt: er.enemyAt.slice(), wokeAt: er.wokeAt || null, defeated: er.defeated, tokens: s ? s.snapshot.tokens.slice() : run.members[c.id] ? run.members[c.id].tokens.slice() : [] };
      if (s) { f.sacrificedAt = s.level; f.mode = s.mode; }
      if (rj) f.grudge = rj.grudge || null;
      if (run.members[c.id]) f.bond = run.members[c.id].bond || null;
      return f;
    });
    const a = advisorData(data, run);
    const idt = run.leader ? (data.leader.identities || []).find((x) => x.id === run.leader.identity) : null;
    const cls = run.leader ? (data.leader.classes || []).find((x) => x.id === run.leader.class) : null;
    const out = {
      outcome: run.outcome, reachedLevel: run.level, fates, difficulty: run.difficulty == null ? null : run.difficulty,
      leader: run.leader ? { identity: run.leader.identity, class: run.leader.class, identityName: idt ? idt.name : null, className: cls ? cls.name : null } : null,
      keys: clone(run.keys || KEYS0()), namedGirl: !!run.namedGirl, bellLevel: run.bellLevel == null ? null : run.bellLevel,
      whiteout: run.outcome === 'victory' && run.whiteout ? { captions: WHITEOUT().slice() } : null, // §4.4 normal ending
      trueEnding: null,
      advisor: a ? { id: a.id, name: a.name, bossName: a.boss.name, defeated: !!run.advisorDefeated, mood: run.advisorMood } : null,
      branch: run.branch, history: clone(run.history),
      earlyDefeat: !!(run.outcome === 'defeat' && run.earlyDefeat), // EARLY_DEFEAT_SIMPLE: the story was the whole ending
      epilogue: run.outcome === 'defeat' ? (run.earlyDefeat ? null : defeatEpilogue(data, run)) : run.outcome === 'victory' || run.outcome === 'true' ? victoryEpilogue(data, run) : null, // v2.4 [26]
      cheated: !!run.cheated,
      gold: goldOf(run), shopSpent: run.shopSpent || 0, // 2026-11-14 金币 (meta: 芙洛 remembers what you spent)
    };
    if (out.epilogue && run.outcome === 'defeat' && run.level === 11) // §4.5 lost in the noble chamber: the normal epilogue plus her line
      out.epilogue.fairy = fairyLines(data, 'win').map((raw) => resolveLine(data, run, raw, {}, 'fairy-demon'));
    if (run.outcome === 'true') { // §4.5: every girl met comes back — sacrificed, rejected, possessed
      const met = new Set(Object.keys(run.members).filter((id) => !isLeader(id)).concat(run.rejected.map((r) => r.id)));
      out.trueEnding = { restored: data.candidates.filter((c) => met.has(c.id)).map((c) => c.id),
        lines: (storyLines(data, run, 'trueEnding') || []).map((p) => resolveLine(data, run, p, {}, 'narrator')) };
    }
    out.defeatEpilogue = run.outcome === 'defeat' ? out.epilogue : null; // same object under the name the coordinator used
    out.victoryEpilogue = run.outcome === 'defeat' ? null : out.epilogue; // v2.4 [26]
    return out;
  }

  // v2.3 §B11: 4–8 short facts she leaves behind (sacrifice screen)
  function memoryFragments(data, run, id) {
    const h = historyOf(data, run, id), m = run.members[id], S = (run.stats || {})[id], c = cand(data, id);
    const out = [];
    const rival = h.rival ? nameOf(data, h.rival) : null;
    const q = quickRun(run); // 2026-11-19 试玩修 剧情: 快速开局 — 「名单上，你写了她」, not 「面试时，你站在她这边」
    if (h.sidedFor === true) out.push(rival ? (q ? TX('memory.sidedForVsQuick', { rival }) : TX('memory.sidedForVs', { rival })) : (q ? TX('memory.sidedForQuick') : TX('memory.sidedFor')));
    else if (h.sidedFor === false) out.push(rival ? (q ? TX('memory.sidedRivalQuick', { rival }) : TX('memory.sidedRival', { rival })) : (q ? TX('memory.notSidedQuick') : TX('memory.notSided')));
    else if (h.conflict) out.push(TX('memory.noSide'));
    for (const cd of (h.cards || []).slice(-3)) out.push(TX('memory.card', { name: cd.name }));
    // 2026-11-22g 试玩7 #13: S.best = her best SINGLE battle; old zh memory.best 「第 {level} 关 打出 {damage} 伤害」 read like a running total
    if (S && S.best) out.push(TX('memory.best', { level: S.best.level, damage: S.best.damage }));
    if (S && S.healed > 0) out.push(TX('memory.healed', { healed: S.healed }));
    if (S && S.kills > 0) out.push(TX('memory.kills', { kills: S.kills }));
    if (m && m.mood != null) out.push(TX('memory.mood', { mood: MOOD_LABELS()[m.mood] }));
    if (h.friend) out.push(TX('memory.friend', { name: nameOf(data, h.friend) }));
    const raw = (c.lines || {}).hired || (c.lines || {}).rewardGiven || c.intro;
    const said = raw ? resolveLine(data, run, raw, { name: c.name }, id).text : null;
    if (said) out.push(`“${said.replace(/^[“"]|[”"]$/g, '')}”`);
    if (S && S.battles) out.push(TX('memory.battles', { battles: S.battles }));
    if (out.length < 4) out.push(`${ROLE_LABELS[c.role] || TX('memory.member')}`);
    if (out.length < 4 && c.bio) out.push(String(c.bio).split(/[。！？]/)[0]);
    while (out.length < 4) out.push(c.name);
    return out.slice(0, 8);
  }

  // RULES-v1 §4: what each candidate says once picked, before the sacrifice is confirmed.
  // v2: a high-bond member uses lines-v2 farewellHighBond.<id> when present.
  function farewells(data, run) {
    const out = {};
    for (const id of sacrificable(run)) {
      const m = run.members[id];
      const tone = m.mood >= 0 ? 'brave' : 'bewildered';
      const ls = cand(data, id).lines || {};
      const hb = m.bond === 'high' ? dig(linesV2(data), 'farewellHighBond', id) : null;
      const raws = hb ? (Array.isArray(hb) ? hb : [hb]) : [(tone === 'brave' ? ls.farewellBrave : ls.farewellBewildered) || ls.sacrificedNamed || ''];
      const lines = raws.map((r) => resolveLine(data, run, r, { name: nameOf(data, id) }, id));
      out[id] = { tone, text: lines.map((l) => l.text).join(''), line: lines[0], lines };
      if (hb) out[id].highBond = true;
    }
    return out;
  }

  function view(data, run) {
    useRun(run);
    const cfg = run.level ? levelCfg(data, run.level) : null;
    const a = advisorData(data, run);
    const v = {
      phase: run.phase, level: run.level, levelTitle: cfg ? levelTitleOf(run, cfg) : '', levelNoHidden: !!run.exitHideNo, leaderName: run.leaderName || leaderName(),
      act: run.sacrificeCount > 0 ? 3 : run.sealed ? 2 : 1, // §2.7
      party: run.party.map((id) => memberView(data, run, id)),
      items: itemsView(data, run),
      advisor: a ? { id: a.id, name: a.name, buffText: advisorSkillText(a, run), flow: clone(flowOf(a)), combat: combatView(a, run), present: run.advisorPresent, turned: !!run.advisorTurned } : null, // 2026-11-19 试玩修 界面: turned = she became the boss
      advisorMood: run.advisorMood, events: clone(run.lastEvents),
      mirrorFight: run.level === 11 && mirrorOn(levelCfg(data, 11)), // 2026-11-19 小铃战 镜像: the UI plays her own track (guild-dark)
      keys: clone(run.keys || KEYS0()), // §4: the UI shows only the ones obtained
      relics: (run.relics || []).map((id) => { const r = relicDef(data, id); return { id, name: r.name, text: r.text }; }).concat(BELLS_IN_RELICS && BELL_DOOR ? DOOR_KEYS.filter((k) => run.keys && run.keys[k] && !(k === 'bell' && (run.relics || []).includes('bell'))).map((k) => ({ id: 'bell', key: k, name: BELL_NAME()[k], text: TX('relic.bell.text') })) : []), // v2.3: no bag slot · 2026-11-22g 试玩7 #8 BELLS_IN_RELICS: + every lit bell (反抗之铃 / 公正之铃 …)
      guildRelics: (RELICS_ON ? (run.guildRelics || []).map((id) => { const it = shopItem(data, id) || {}; return { id, name: it.name || id, text: it.text || '' }; }) : []).concat(TEAM_AS_RELIC ? (run.teamTaken || []).map((st) => { const c = (data.cards.rewards || []).find((x) => x.teamOnly && x.effect && x.effect.stat === st); return c ? { id: c.id, name: c.name, text: c.text || '', team: true } : null; }).filter(Boolean) : []), // 2026-11-25 用户「放进去」: 护身绳 / 磨刀石 / 庆功酒 shown with the relics (display only) // 2026-11-22 遗物
      gold: goldOf(run), // 2026-11-14 金币 (the UI shows it only where items are)
      difficulty: diffOf(run) ? { id: run.difficulty, name: diffOf(run).name } : null, // v2.5
    };
    switch (run.phase) {
      case 'story': {
        const ctx = run.story.ctx;
        v.storyId = run.story.id;
        v.lines = (storyLines(data, run, run.story.id) || []).map((p) => resolveLine(data, run, p, ctx, 'narrator'));
        if (BELL_DOOR && ctx && ctx.bellGot && BELL_NAME()[ctx.bellGot]) v.lines.push(Object.assign(resolveLine(data, run, { speaker: 'narrator', text: TX('bellKey.got', { name: BELL_NAME()[ctx.bellGot] }) }, ctx, 'narrator'), { bellGot: ctx.bellGot })); // 2026-11-20 铃之门
        v.paragraphs = v.lines.map((l) => l.text); // v1 compatibility
        if (run.story.rollcall) { v.rollcall = clone(run.story.rollcall); v.rally = clone(run.story.rally || []); } // v2.4 [9] teamAssembled
        if (run.story.levelCard) v.levelCard = clone(run.story.levelCard); // v2.4 [9] levelIntro
        if (run.story.noCard) v.noCard = true;
        if (run.story.id === 'sealRefuse') { // feedback-1112 #7: { hpFrom, hpTo } for the curse line
          v.curse = { hpFrom: ctx.hpFrom, hpTo: ctx.hpTo };
          // 2026-11-19 用户亲测 流程: the hp event sits on the beat itself (the fx 'curse' line, where she is pinned to the ground)
          if (SEAL_HP_AT_BEAT && ctx.hpFrom != null) { const l = v.lines.find((x) => x && x.fx === 'curse'); if (l) l.hp = { id: LEADER_ID, from: ctx.hpFrom, to: ctx.hpTo, text: ctx.teamTo ? TX('story.sealBeatenAll', { n: SEAL_HIT }) : TX('story.sealBeaten', { hp: ctx.hpTo }) }; }
        }
        if (run.story.door) v.door = doorView(data, run); // 2026-11-15 小门: { slots: [{ key, got }], open }
        if (run.story.door && BELL_DOOR) v.bellDoor = bellDoorView(data, run); // 2026-11-20 铃之门: names + hints + how many
        if (run.story.choice === 'seal') v.sealOptions = clone(SEAL_OPTIONS()); // feedback-1112 #7: act story.sealChoice { choice }
        break;
      }
      case 'leader':
        v.leaderStep = run.leaderStep;
        v.identities = clone(data.leader.identities);
        v.classes = data.leader.classes.map((c) => {
          const def = LEADER_DEFAULTS()[c.id] || {};
          const sk = c.skill || def.skill, cb = c.combo || def.combo;
          const atk = c.atk != null ? c.atk : def.atk;
          return Object.assign(clone(c), { hp: allyHp(c.hp != null ? c.hp : def.hp), keywords: keywordsFor(data, sk, cb), skillName: sk ? sk.name : null, comboName: cb ? cb.name : null,
            actionText: atk != null ? actionTextFor(sk, atk, false, c.role || def.role) : null, bonusText: bonusTextFor(cb, baseK(cb), false), skillLv: lvOf(sk), perkText: LEADER_PLAIN ? null : perkText(c.perk) }, LEADER_PLAIN ? { perk: null } : {}); // LEADER_PLAIN: no perk row on the register
        });
        if (run.leader && run.leader.identity) v.identity = run.leader.identity;
        break;
      case 'difficulty': v.difficulties = difficultyView(data, run); break;
      case 'advisor': v.advisors = data.advisors.map((x) => ({ id: x.id, name: x.name, look: x.look, intro: x.intro, buffText: advisorSkillText(x, run), flow: clone(flowOf(x)), combat: combatView(x, run) })); break;
      case 'interview': {
        const pair = roundPair(data, run.interviewRound);
        const rounds = interviewRounds(data, run);
        v.round = rounds.indexOf(run.interviewRound) + 1;
        v.roundTotal = rounds.length;
        v.leaderRole = leaderRole(data, run);
        v.interviewStep = run.interviewStep;
        v.pair = pair.map((c) => candidateView(data, run, c, pair.find((o) => o.id !== c.id)));
        v.conflict = conflictView(data, run, run.interviewRound);
        v.sided = run.sided[run.interviewRound] || null;
        const qr = quickRounds(data, run); // 2026-11-15 老玩家快速开局: act interview.quickRecruit { picks: [id per row] }
        if (run.recruitPrice) v.recruitPrice = true; // 2026-11-20 招人花钱: the interview shows prices + the purse (v.gold)
        if (qr) v.quick = { rows: qr.map((r) => { const p = roundPair(data, r); return { round: r, role: p[0] && p[0].role, pair: p.map((c) => candidateView(data, run, c, p.find((o) => o.id !== c.id))) }; }) }; // absent when not on offer
        break;
      }
      case 'prep': v.levelTitle = ''; Object.assign(v, prepInfo(data, run)); v.campfire = run.campfire ? { talkId: run.campfire.talkId } : null; v.bell = !!run.bell; v.bellWound = tierRule(run, 'bellWound') !== false; v.wounded = !!run.wounded; v.camp = campView(data, run); if (cfg) v.nextLevel = { n: run.level, title: cfg.title || '' }; /* 2026-11-19: the plate names the coming battle */ v.skillArmed = !!run.skillArmed; v.shop = shopView(data, run); { const pi = preIntentView(data, run); if (pi) v.preIntent = pi; } /* 2026-11-19 伤害分摊 §4 */ break; // 叙事节奏 2026-11-13: the night never names the next level
      case 'battle': v.battle = battleView(data, run); break;
      case 'battleResult': v.battle = clone(run.battle); break;
      case 'reward': case 'debuff': {
        if (run.phase === 'reward' && run.rewardKind === 'blessing') { // 2026-11-18 小铃的祝福: three team-wide cards, no target
          v.blessing = true;
          v.options = run.options.map((id) => Object.assign(clone(blessingPool(data).find((x) => x.id === id)), { needsTarget: false, preview: [] }));
          v.targets = run.party.slice(); v.bagFull = run.items.length >= BAG_MAX;
          break;
        }
        if (run.phase === 'reward' && run.lastWinGold && run.lastWinGold.level === run.level) v.winGold = run.lastWinGold.n; // 2026-11-20b 用户: this battle's gold on the loot screen
        if (FORTUNE_NOTE && run.phase === 'reward' && advisorFlow(data, run) === 'fortune' && !leaderHas(run, 'extra-option')) { const ad = advisorData(data, run); v.fortuneNote = TX('reward.fortuneNote', { name: (ad && ad.name) || '' }); } // 2026-11-23 试玩 19「看不出哪张是她多翻的」
        const pool = run.phase === 'reward' ? data.cards.rewards : data.cards.debuffs;
        v.options = run.options.map((id) => {
          const c = clone(pool.find((x) => x.id === id));
          if (c.effect && c.effect.type === 'item') { const it = itemDef(data, c.effect.item); c.item = it ? { itemId: it.id, name: it.name, text: it.text, needsTarget: !!it.needsTarget } : null; c.needsTarget = false; }
          else if (c.effect && c.effect.type === 'teamStat') { c.needsTarget = false; c.team = true; } // 2026-11-24 全队卡
          else c.needsTarget = true;
          c.preview = cardPreview(data, run, pool.find((x) => x.id === id), run.phase === 'reward'); // v2.3 §B8
          if (run.phase === 'reward') { const cd = pool.find((x) => x.id === id), po = HOLY_SPRING_PRIEST_ONLY && cd && isHolySpring(cd.effect) ? run.party.filter((pid) => priestOnlyBlocks(run, cd.effect, pid)) : [], h = tokenHolders(run, cd).concat(po); if (h.length) c.has = h; if (po.length) c.priestOnly = po; } // 2026-11-22 试玩4 #1: priestOnly = greyed for 「牧师专用」, not 「已经有了」 // 圣泉: non-priests greyed
          if (run.phase === 'debuff') { const lf = luckFloorIds(run, pool.find((x) => x.id === id).effect); if (lf.length) { c.has = lf; c.luckFloor = lf; } } // LUCK_FLOOR_BLOCK: greyed 「幸运已经最低了」
          if (run.phase === 'reward' && c.needsTarget) { const tn = rewardTraitNotes(data, run); if (Object.keys(tn).length) c.traitNotes = tn; }
          if (run.phase === 'debuff' && c.needsTarget) { const fn = debuffFriendNotes(data, run); if (Object.keys(fn).length) c.traitNotes = fn; }
          if (run.phase === 'reward' && c.rarity) c.rarity = rarityId(c); // 2026-11-18 growth-flow round 2 (name: text key rarity.<id>) // 2026-11-15: who already holds this keepsake (greyed in 「给谁」)
          return c;
        });
        v.targets = run.party.slice();
        if (run.phase === 'reward') v.bagFull = run.items.length >= BAG_MAX;
        break;
      }
      case 'sacrifice': v.modes = (run.sacrificeModes || ['name']).slice(); v.diceTakes = diceN(run); /* v2.5 */ v.targetIds = sacrificable(run);
        v.targets = v.targetIds.map((id) => ({ id, name: nameOf(data, id), memory: memoryFragments(data, run, id) })); // v2.3 §B11
        v.selfCost = { maxHpPct: SELF_HP_PCT, maxHpMin: SELF_HP_MIN, mood: SELF_MOOD,
          maxHp: run.party.map((id) => ({ id, from: run.members[id].maxHp, to: selfMaxHp(run.members[id].maxHp) })),
          text: TX('sacrifice.selfEffect', { hpMin: SELF_HP_MIN, mood: SELF_MOOD }) }; v.suggestion = run.suggestion ? clone(run.suggestion) : null; v.farewells = farewells(data, run); break;
      case 'gameOver': case 'ending': v.summary = summary(data, run); break;
    }
    return v;
  }

  // 2026-11-18 growth-flow: the branch switches, read-only (tests skip old-behaviour checks when a switch is off)
  const FLAGS = Object.freeze({ RECRUIT_PRICE, CAMP_EXPLORE, BAG_MAX, SUNDER_ON, BLESSING_ON, BELL_DOOR, RULES_NIGHT_TRAIN_FIRST, TRAIN_KINDS, RETURNED_NORMAL, SHOP_CORE_FROM, RELICS_ON });
  const ChooserEngine = { FLAGS, rarityName, _t: { setLv5: (on) => { LV5_ON = !!on; }, gainXp, xpInfo, sawInterview, revealText, turncoatPick /* 2026-11-20 反水 */, statEff /* 2026-11-20 幸运 */, recruitPrice, recruitEco /* 2026-11-20 招人花钱 */, tokenKey /* review #4 */, rawAmount0, ENEMY_GUARD_BLOCK /* review #6: tests/enemy-text.test.cjs */ } /* 2026-11-19 伤害分摊: test hooks (pure) */, /* 2026-11-18: 普通 / 稀有 / 史诗 / 传说 for a rarity id */ setOpenTiers: (n) => { OPEN_TIERS = Math.max(1, Math.floor(+n) || 1); }, get openTiers() { return OPEN_TIERS; }, createRun, view, act, doorView, bellDoorView, skillLvLine: (kind, lv) => lvLine(kind, lv), /* 2026-11-19 用户亲测 界面: 升级页 — the plain words of one skill level (pure, UI only) */ /* 2026-11-15 小门, pure */ simulateBattle, metaUpdate, metaDolls, dollLedger, rankOf, killCallFor, get DIFFICULTIES() { return (DIFF_LADDER ? DIFF_LADDERED() : DIFFICULTIES()).map((d) => Object.assign({}, d)); }, version: 3,
    t, setLocale, getLocale: () => I18N.locale, i18n: { pickLocale, localizeData, setText: (tb) => { I18N.text = tb || null; }, get missing() { return I18N.missing; }, get strict() { return I18N.strict; }, set strict(v) { I18N.strict = !!v; }, get loadCalls() { return I18N.loadCalls; } } };
  I18N.loading = false;
  if (typeof window !== 'undefined' && typeof root.T !== 'function') root.T = t; // the UI's shared lookup (docs/I18N.md)
  if (typeof module !== 'undefined' && module.exports) module.exports = ChooserEngine;
  else root.ChooserEngine = ChooserEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
