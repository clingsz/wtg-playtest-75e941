// DEV ONLY — a fake v2 ChooserEngine (docs/archive/V2-CONTRACT.md) with toy rules, so the UI can build every screen
// before the real engine lands. Exposes globalThis.ChooserStubEngine (browser) / module.exports (node).
(function (root) {
  'use strict';
  var LEVELS = [
    { level: 1, title: '公会的第一单', waves: [['slime', 'slime', 'slime']], post: 'reward' },
    { level: 3, title: '墓穴讨伐', waves: [['skeleton', 'skeleton', 'skeleton-archer']], post: 'reward', postStory: 'sealing' },
    { level: 4, title: '向下的第一层', waves: [['ghoul', 'ghoul', 'skeleton-archer']], post: 'rewardAndDebuff' },
    { level: 5, title: '石门', waves: [['ghoul', 'gate-guardian']], post: 'sacrifice' },
    { level: 6, title: '对面的熟面孔', preStory: 'rejectedReturn', waves: [['mercenary-blade', { rejected: 0 }, { rejected: 1 }]], post: 'reward' },
    { level: 8, title: '她回来了', preStory: 'firstReturn', waves: [['tomb-minion', { returned: 'first' }]], post: 'secondSacrifice' },
    { level: 9, title: '魔盗团', preStory: 'fakeBoss', waves: [['bandit-officer', 'bandit-chief']], post: 'advisorLeaves', postStory: 'advisorLeaves' },
    { level: 10, title: '高台之上', preStory: 'finalReveal', waves: [['tomb-minion', { returned: 'final' }], ['mercenary-blade', { advisorBoss: true }]], post: 'afterL10' },
    // v2.2 §4.5 the noble chamber (true route only)
    { level: 11, title: '贵族的房间', act: 3, preStory: 'nobleChamber', waves: [[{ guards: true }, { fairy: 1 }], [{ fairy: 0.6 }, { resummon: true }]], post: 'trueEnding' }
  ];
  var BELL_LEVELS = [6, 8, 9]; // the stub's act-3 campfires
  var ROLE_LABEL = { tank: '战士', adc: '猎人', healer: '牧师', mage: '法师', rogue: '刺客' };
  var MOOD_LABEL = { '-2': '崩溃', '-1': '低落', '0': '平静', '1': '高兴', '2': '振奋' };
  function rng(run) { // mulberry32
    var t = (run.rng = (run.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(run, arr) { return arr && arr.length ? arr[Math.floor(rng(run) * arr.length)] : null; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function cand(data, id) { return data.candidates.filter(function (c) { return c.id === id; })[0]; }
  function lvl(run) { return LEVELS[run.levelIdx] || null; }
  function clampMood(m) { return Math.max(-2, Math.min(2, m)); }
  function advData(data, run) { return data.advisors.filter(function (a) { return a.id === run.advisor; })[0]; }
  function nameOf(data, run, id) {
    if (id === 'leader') return (run && run.leaderName) || '团长';
    if (id === 'fairy' || id === 'fairy-demon') return '小铃';
    if (id === 'advisor') { var a = advData(data, run); return a ? a.name : '顾问'; }
    var c = cand(data, id); if (c) return c.name;
    var a2 = data.advisors.filter(function (x) { return x.id === id; })[0]; return a2 ? a2.name : '';
  }
  // §1: resolve a story/say line to { speaker, speakerId, name, text, expr }
  function L(data, run, x, ctx) {
    if (x == null) return null;
    if (typeof x === 'string') x = { speaker: 'narrator', text: x };
    var sid = x.speaker === 'advisor' ? run.advisor : x.speaker;
    var text = String(x.text).replace(/\{leader\}/g, run.leaderName || '团长').replace(/\{advisor\}/g, nameOf(data, run, 'advisor')).replace(/\{name\}/g, (ctx && ctx.name) || '');
    return { speaker: x.speaker || 'narrator', speakerId: sid === 'narrator' || sid === 'gallery' ? null : sid, name: sid === 'narrator' ? '' : sid === 'gallery' ? '看台上的声音' : nameOf(data, run, sid), text: text, expr: x.expr || 'calm' };
  }
  function lineEv(data, run, x, ctx) { var l = L(data, run, x, ctx); if (l) l.kind = 'line'; return l; }
  function keywords(data, skill, combo) {
    var K = data.keywords || {}, out = [];
    if (skill && K.skill && K.skill[skill.kind]) out.push({ id: 'skill:' + skill.kind, label: K.skill[skill.kind].label, tip: K.skill[skill.kind].tip });
    if (combo && K.direction && K.direction[combo.direction]) out.push({ id: 'dir:' + combo.direction, label: K.direction[combo.direction].label, tip: K.direction[combo.direction].tip });
    if (combo && K.when && K.when[combo.when]) out.push({ id: 'when:' + combo.when, label: K.when[combo.when].label + ' ' + Math.round(combo.chance * 100) + '%', tip: K.when[combo.when].tip + '（' + Math.round(combo.chance * 100) + '%）' });
    return out;
  }
  // v2.1 §B: the two generated sentences
  // DESIGN-skill-level 收尾: the view fields the real engine added (skillLv = skill.power + 1, max 4; perkText 「名字：说明」)
  function skLv(skill) { return Math.max(1, Math.min(4, 1 + ((skill && skill.power) || 0))); }
  function perkTextOf(data, id, c) { var p = (c && c.perk) || ((data.candidates || []).filter(function (x) { return x.id === id; })[0] || {}).perk; return p ? p.name + '：' + p.text : null; }
  function actionTextOf(skill, atk) {
    var k = skill && skill.kind;
    if (k === 'heal') return '为生命最低的队友回复 ' + atk + ' 点；全员满血时改为攻击';
    if (k === 'aim') return '攻击最左侧的敌人，伤害 = 攻击 + 1';
    if (k === 'spark') return '对全体敌人各造成一半攻击的伤害';
    if (k === 'backstab') return '攻击最左侧两名敌人，每次伤害 = 攻击 − 1';
    if (k === 'guard') return '攻击最左侧的敌人，并在下次行动前受到的伤害 −1';
    return '攻击最左侧的敌人，伤害 = 攻击';
  }
  var WHEN = { always: '每次行动后', 'on-hit': '命中敌人后', 'on-kill': '击倒敌人后', 'on-heal': '治疗队友后', 'on-guard': '盾击后', 'low-hp': '生命低于一半时，每次行动后' };
  var DIR = { next: '让**右侧**队友立刻追加一次行动', prev: '让**左侧**队友立刻追加一次行动', both: '让**左右两侧**队友各追加一次行动' };
  function bonusTextOf(combo) { return combo && DIR[combo.direction] ? (WHEN[combo.when] || '行动后') + '，' + Math.round(combo.chance * 100) + '% ' + DIR[combo.direction] : null; }
  // dev fallback lines (the content worker writes the real ones in lines-v2.json)
  var FB = {
    monologue: {
      possessed: ['嘻嘻……团长，你知道他们把我带去哪了吗？', '看台上全是戴面具的人。他们鼓掌。他们一直鼓掌。', '他们说我“还能再改改”。改了一次，又改了一次。', '我叫你的名字叫到嗓子坏了，你没来。', '现在我很漂亮了，对吧？他们都这么说。', '我现在要把这些……奉还给你。'],
      vengeful: ['你说「谢谢，不过……」的时候，连头都没抬。', '我在城门口坐了三天。没有一个公会肯收被退回的人。', '我把那句话嚼了一千遍，嚼到没了味道。', '然后有人给了我一把刀，和一个理由。', '我现在要把这些奉还给你。']
    },
    attack: { possessed: ['你给我的「{card}」，我一直留着呢。', '鼓掌啊！他们在看呢！', '是你亲手写下我的名字。', '疼吗？我那时候也这么问过。'],
      vengeful: ['你说「谢谢，不过……」。我记得你的口气。', '面试那天，你站在别人那边。', '这一下，是替那三天的我还的。', '你不是很会挑人吗？'] },
    bark: { attack: ['看我的！', '让开让开！', '交给我！', '这下总该倒了吧？'], kill: ['一个！', '下一个！', '解决了。'], lowHp: ['……还撑得住。'], softHeart: ['……{name}，我下不去手。', '对不起，{name}……我做不到。'] },
    turncoat: ['……不对。我不要再听你的了！', '团长，这一下，我替你打！', '放开我……我自己选站哪边！'],
    taunt: { 'noble-guard': ['请勿喧哗。', '大人们在看。'], slime: ['咕噜咕噜！'], skeleton: ['咔……咔咔……'], ghoul: ['新鲜的……'], 'bandit-chief': ['魔盗团的地盘，也敢来？'], 'gate-guardian': ['此门……不开。'], any: ['又来了一队送死的。', '看台上的大人们等着呢。'] }
  };
  function fill(t, ctx) { return String(t).replace(/\{(\w+)\}/g, function (m, k) { return ctx && ctx[k] != null ? ctx[k] : m; }); }
  function itemView(data, id) { var it = (data.items || []).filter(function (x) { return x.id === id; })[0] || { id: id, name: id, text: '' }; return { itemId: it.id, name: it.name, text: it.text, needsTarget: !!it.needsTarget }; }
  function pairKey(data, a, b) { var P = (data.interviews || {}).pairs || {}; return P[a + '|' + b] ? a + '|' + b : P[b + '|' + a] ? b + '|' + a : null; }

  function createRun(data, opts) {
    var meta = clone((opts && opts.meta) || {}) || {};
    var run = { v: 2, stub: true, leaderName: (opts && opts.leaderName) || '团长', seed: opts.seed, rng: opts.seed >>> 0, phase: 'story', story: { id: 'fairyWelcome' }, act: 1, level: 0, levelIdx: -1,
      meta: meta, keys: { self: false, rules: false, bell: false }, namedGirl: false, bellLevel: null, bellNow: false, bellDone: false, wounded: false, selfAt: [], slipIdx: null,
      advisor: null, advisorPresent: true, leader: {}, party: [], members: {}, rejected: [], rejectedInfo: {}, sacrificed: [], sided: {}, items: [],
      interviewIdx: 0, interviewStep: null, battle: null, history: [], lastEvents: [], branch: null, outcome: null, options: null, sacrificeModes: null,
      queue: [{ story: 'opening' }, { phase: 'advisor' }, { story: 'advisorAsks' }, { phase: 'leader' }, { story: 'interviewIntro' }, { phase: 'interview' }, { story: 'teamAssembled' }, { startLevel: 0 }] };
    if ((meta.runs || 0) > 0) { var sl = fillableSlips(data, meta); run.slipIdx = sl.length ? sl[Math.floor(rng(run) * sl.length)] : null; }
    return run;
  }
  // v2.2 §2 the fairy's greeting + slip (built from lines-v2 → fairy)
  function slipCtx(m) {
    return { runs: m.runs || '', wins: m.wins || '', lastLevel: m.lastLevel || '', lastSacrificed: (m.lastSacrificed || []).join('、'), lastRejected: (m.lastRejected || []).join('、'),
      lastGrudges: m.lastGrudges || '', lastIdentity: m.lastIdentity || '', lastClass: m.lastClass || '' };
  }
  function fillableSlips(data, m) {
    var F = (data.linesV2 || {}).fairy || {}, ctx = slipCtx(m), out = [];
    (F.slip || []).forEach(function (tpl, i) { var ok = JSON.stringify(tpl).replace(/\{(\w+)\}/g, function (x, k) { if (!(k in ctx) || ctx[k] === '') ok = false; return ''; }); if (ok !== false) out.push(i); });
    return out;
  }
  function fairyLines(data, run) {
    var F = (data.linesV2 || {}).fairy || {}, m = run.meta || {}, ctx = slipCtx(m);
    var kase = !(m.runs > 0) ? 'first' : m.seenTrue ? 'trueSeen' : m.wins > 0 ? 'cleared' : 'familiar';
    var out = (F[kase] || []).slice();
    if (run.slipIdx != null && F.slip && F.slip[run.slipIdx]) out = out.concat(F.slip[run.slipIdx].map(function (x) { var o = clone(x); o.text = fill(o.text, ctx); return o; }));
    return out.concat(F.tutorial || []);
  }
  function metaUpdate(meta, s) {
    var m = clone(meta || {}) || {}, o = s && s.outcome, fates = (s && s.fates) || [];
    m.runs = (m.runs || 0) + 1;
    if (o === 'victory' || o === 'true') m.wins = (m.wins || 0) + 1;
    if (o === 'true') { m.trueWins = (m.trueWins || 0) + 1; m.seenTrue = true; }
    if (o === 'defeat') m.deaths = (m.deaths || 0) + 1;
    m.lastLevel = s.reachedLevel || 0; m.lastOutcome = o; m.lastIdentity = s.identity || null; m.lastClass = s.cls || null;
    m.lastSacrificed = fates.filter(function (f) { return f.fate === 'sacrificed'; }).map(function (f) { return f.name; });
    m.lastRejected = fates.filter(function (f) { return f.fate === 'rejected'; }).map(function (f) { return f.name; });
    m.lastGrudges = fates.filter(function (f) { return f.grudge === 'high'; }).length;
    m.seenTrue = !!m.seenTrue;
    return m;
  }
  function trueRoute(run) { var k = run.keys; return k.self && k.rules && k.bell && !run.namedGirl; }
  function rounds(data, run) { // the leader's role takes one interview round
    var lr = run.leader.role, out = [];
    [1, 2, 3, 4, 5].forEach(function (r) { var p = data.candidates.filter(function (c) { return c.round === r; }); if (p[0].role !== lr) out.push(r); });
    return out;
  }
  function roundPair(data, r) { return data.candidates.filter(function (c) { return c.round === r; }); }
  function advance(data, run, ev) {
    var step = run.queue.shift();
    if (!step) { run.phase = 'ending'; return; }
    if (step.story) {
      if (step.story === 'sealing') { run.act = 2; ev.push({ kind: 'darkTransition', reason: 'sealing' }); run.bellLevel = pick(run, BELL_LEVELS); }
      run.phase = 'story'; run.story = { id: step.story }; return;
    }
    if (step.startLevel != null) { startLevel(data, run, step.startLevel, ev); return; }
    run.phase = step.phase;
    if (step.phase === 'prep') {
      run.bellNow = false;
      run.camp = { step: step.noTalk ? 'done' : 'choose' }; // v2.3 §B1 the campfire choice
      if (step.noTalk) run.campfire = null;
      else if (run.level === run.bellLevel && !run.bellDone) { // v2.2 §4.3 the bell instead of the campfire talk
        run.bellNow = true; run.campfire = null;
        (data.stories.bellEvent || []).forEach(function (x) { var l = lineEv(data, run, x); l.key = 'bellEvent'; ev.push(l); });
      } else campfire(data, run, ev);
    }
    if (step.phase === 'leader') run.leaderStep = 'identity';
    if (step.phase === 'interview') { run.interviewIdx = 0; setInterviewStep(data, run); }
    if (step.phase === 'reward' || step.phase === 'debuff') {
      var pool = step.phase === 'reward' ? data.cards.rewards : data.cards.debuffs, p = pool.slice(); run.options = [];
      while (run.options.length < 3 && p.length) run.options.push(p.splice(Math.floor(rng(run) * p.length), 1)[0].id);
    }
    if (step.phase === 'sacrifice') {
      run.sacrificeModes = step.modes;
      var tg = run.party.filter(function (id) { return id !== 'leader'; });
      var top = tg.slice().sort(function (a, b) { return run.members[b].atk - run.members[a].atk; })[0];
      run.suggestion = run.advisorPresent && top ? { id: top, text: '如果一定要交人，交' + nameOf(data, run, top) + '。她最强，在那边最有可能活下来。' } : null;
    }
    if (step.phase === 'ending') run.outcome = step.outcome || 'victory';
    if (step.phase === 'gameOver') run.outcome = 'defeat';
  }
  // v2.1 campfire: a small random talk among the party before every battle
  var TALKS = [
    { id: 'stew', lines: [['narrator', '火上的锅咕嘟作响。'], [0, '谁放的盐？这是盐吗？'], [1, '……是我。别问了。', 'upset'], [0, '哈哈，挺好喝的，真的。', 'happy']] },
    { id: 'stars', lines: [['narrator', '风停了，火星往上飘。'], [1, '你们说，墓穴里能看见星星吗？'], [0, '看不见。所以现在多看两眼。', 'calm']] },
    { id: 'names', lines: [[0, '回去以后，我想把名字刻在公会的柱子上。'], [1, '刻歪了我可不管。', 'happy'], ['narrator', '大家都笑了。火光把影子拉得很长。']] }
  ];
  function campfire(data, run, ev) {
    var ms = run.party.filter(function (id) { return id !== 'leader'; }); if (ms.length < 2) { run.campfire = null; return; }
    var t = TALKS[(run.levelIdx + (run.seed % 3) + 3) % TALKS.length], a = ms[Math.floor(rng(run) * ms.length)], b2 = ms.filter(function (x) { return x !== a; })[Math.floor(rng(run) * (ms.length - 1))];
    t.lines.forEach(function (x) { var who = x[0] === 0 ? a : x[0] === 1 ? b2 : x[0]; var l = lineEv(data, run, { speaker: who, text: x[1], expr: x[2] || 'calm' }); l.key = 'campfire'; l.talkId = t.id; ev.push(l); });
    run.campfire = { talkId: t.id };
  }
  // ---------- v2.3 stub: camp choice, training, item previews, memory fragments ----------
  var TRAIN = { normal: [{ id: 'whet', label: '磨刀', text: '攻击 +1', effect: { type: 'stat', stat: 'atk', delta: 1 } }, { id: 'drill', label: '加练', text: '生命上限 +3', effect: { type: 'stat', stat: 'maxHp', delta: 3 } },
    { id: 'heart', label: '谈心', text: '心情 +1', effect: { type: 'mood', delta: 1 } }, { id: 'stance', label: '站桩', text: '生命上限 +2', effect: { type: 'stat', stat: 'maxHp', delta: 2 } }],
    special: [{ id: 'allout', label: '拼命', text: '攻击 +3', effect: { type: 'stat', stat: 'atk', delta: 3 }, downside: { type: 'stat', stat: 'maxHp', delta: -3 } },
      { id: 'harsh', label: '狠话', text: '攻击 +2', effect: { type: 'stat', stat: 'atk', delta: 2 }, downside: { type: 'mood', delta: -1 } }] };
  function statPreview(run, id, effs) {
    var m = run.members[id], cur = { atk: m.atk, maxHp: m.maxHp, mood: m.mood }, out = [];
    effs.forEach(function (e) { if (!e) return; var st = e.type === 'mood' ? 'mood' : e.stat; if (!st || cur[st] == null || e.delta == null) return; if (st === 'mood' && id === 'leader') return;
      var to = st === 'mood' ? clampMood(cur[st] + e.delta) : Math.max(1, cur[st] + e.delta); out.push({ stat: st, from: cur[st], to: to }); cur[st] = to; });
    return out;
  }
  function applyEffs(run, id, effs, ev) {
    var ch = statPreview(run, id, effs), m = run.members[id];
    ch.forEach(function (c) { m[c.stat] = c.to; if (c.stat === 'maxHp') m.hp = Math.min(m.hp, m.maxHp); });
    if (ch.length) ev.push({ kind: 'statChange', id: id, changes: ch });
  }
  function campAct(data, run, a, ev) {
    var c = run.camp || (run.camp = { step: 'choose' });
    if (a.type === 'camp') {
      if (c.step !== 'choose') throw new Error('camp: not choosing');
      if (run.bellNow) { run.bellNow = false; run.bellDone = true; }
      if (a.choice === 'rest') { run.party.forEach(function (id) { var m = run.members[id], f = m.hp; m.hp = Math.min(m.maxHp, m.hp + 5); if (m.hp !== f) ev.push({ kind: 'statChange', id: id, changes: [{ stat: 'hp', from: f, to: m.hp }] }); }); c.step = 'done'; }
      else if (a.choice === 'explore' && run.items.length >= 3) throw new Error('camp: bag full');
      else if (a.choice === 'explore') { var p = (data.items || []).map(function (x) { return x.id; }), got = []; while (got.length < 2 && p.length) got.push(p.splice(Math.floor(rng(run) * p.length), 1)[0]); c.step = 'explore'; c.items = got; }
      else if (a.choice === 'train') c.step = 'train-pick';
      else throw new Error('camp: bad choice');
      c.choice = a.choice; return;
    }
    if (a.type === 'campExplore') { if (c.step !== 'explore' || c.items.indexOf(a.itemId) < 0) throw new Error('campExplore'); if (run.items.length < 3) run.items.push(a.itemId); ev.push({ kind: 'item', itemId: a.itemId }); c.step = 'done'; return; }
    if (a.type === 'campTrainPick') {
      if (c.step !== 'train-pick' || run.party.indexOf(a.id) < 0 || a.id === 'leader') throw new Error('campTrainPick');
      c.step = 'train-bonus'; c.member = a.id;
      var nm = TRAIN.normal.slice(), b = []; while (b.length < 2) b.push(nm.splice(Math.floor(rng(run) * nm.length), 1)[0].id);
      b.push(pick(run, TRAIN.special).id); c.bonuses = b;
      [{ speaker: 'narrator', text: '火堆另一边，只剩你们两个。' }, { speaker: a.id, text: '团长，陪我练一会儿？', expr: 'happy' }, { speaker: a.id, text: '……我想再强一点。下一关，我想站得更久。', expr: 'calm' }]
        .forEach(function (x) { var l = lineEv(data, run, x); l.key = 'train'; ev.push(l); });
      return;
    }
    if (a.type === 'campTrainBonus') {
      if (c.step !== 'train-bonus' || c.bonuses.indexOf(a.bonusId) < 0) throw new Error('campTrainBonus');
      var bo = TRAIN.normal.concat(TRAIN.special).filter(function (x) { return x.id === a.bonusId; })[0];
      applyEffs(run, c.member, [bo.effect, bo.downside], ev); c.step = 'done'; return;
    }
  }
  function campView(data, run) {
    var c = clone(run.camp) || { step: 'done' };
    if (c.step === 'choose') c.options = [{ id: 'rest', label: '休息', text: '全员生命 +5' }, { id: 'explore', label: '探索', text: '找到两样东西，留一样', disabled: run.items.length >= 3, tip: run.items.length >= 3 ? '背包满了' : null }, { id: 'train', label: '锻炼', text: '陪一个人练练' }];
    if (c.step === 'explore') c.items = c.items.map(function (id) { return itemView(data, id); });
    if (c.step === 'train-pick') c.candidates = run.party.filter(function (id) { return id !== 'leader'; });
    if (c.step === 'train-bonus') c.bonuses = c.bonuses.map(function (id) { var x = clone(TRAIN.normal.concat(TRAIN.special).filter(function (y) { return y.id === id; })[0]); x.special = !!x.downside; x.preview = {}; x.preview[c.member] = statPreview(run, c.member, [x.effect, x.downside]); return x; });
    return c;
  }
  function memoryOf(data, run, id) {
    var m = run.members[id], out = [];
    var sided = Object.keys(run.sided).some(function (r) { return run.sided[r] === id; });
    out.push(sided ? '面试时，你站在她这边' : '面试时，你站的是另一个人');
    (m.statuses || []).filter(function (s) { return s.dark; }).forEach(function (s) { out.push('你给过她「' + s.label + '」'); });
    out.push('第 ' + Math.max(1, run.level - 1) + ' 关 打出 ' + (7 + (m.atk * 3)) + ' 伤害');
    out.push('心情：' + (MOOD_LABEL[m.mood] || '平静'));
    var c = cand(data, id); if (c && c.lines && c.lines.hired) out.push('“' + c.lines.hired.text + '”');
    out.push('她的攻击是 ' + m.atk);
    return out;
  }
  function setInterviewStep(data, run) {
    var r = rounds(data, run)[run.interviewIdx], p = roundPair(data, r);
    run.interviewStep = pairKey(data, p[0].id, p[1].id) ? 'side' : 'hire';
  }
  function startLevel(data, run, idx, ev) {
    run.levelIdx = idx; var cfg = lvl(run); run.level = cfg.level;
    run.party.forEach(function (id) { var m = run.members[id]; m.hp = m.maxHp; });
    var pre = cfg.preStory === 'firstReturn' && !run.sacrificed.length ? 'firstReturnSelf' : cfg.preStory;
    if (pre) run.queue.unshift({ story: pre });
    run.queue.splice(cfg.preStory ? 1 : 0, 0, { story: 'levelIntro' }, { phase: 'prep' }); // v2.4 [9]
    advance(data, run, ev);
  }
  function postQueue(data, run) {
    var cfg = lvl(run), q = [];
    if (cfg.post === 'reward' || cfg.post === 'rewardAndDebuff') q.push({ phase: 'reward' });
    if (cfg.post === 'rewardAndDebuff') q.push({ story: 'debuffIntro' }, { phase: 'debuff' });
    if (cfg.post === 'sacrifice') q.push({ story: 'sacrificeIntro' }, { phase: 'sacrifice', modes: ['name', 'random', 'self'] });
    if (cfg.post === 'secondSacrifice') q.push({ story: run.branch === 'self' ? 'secondSacrificeIntroSelf' : 'secondSacrificeIntro' }, { phase: 'sacrifice', modes: ['name', 'self'] });
    if (cfg.post === 'afterL10') { run.queue = (trueRoute(run) ? [{ story: 'trueDoor' }, { startLevel: run.levelIdx + 1 }] : [{ story: 'normalEnding' }, { phase: 'ending' }]).concat(run.queue); return; }
    if (cfg.post === 'trueEnding') { run.queue = [{ story: 'trueEnding' }, { phase: 'ending', outcome: 'true' }].concat(run.queue); return; }
    if (cfg.post === 'secondSacrifice') q.push({ phase: 'reward' });
    if (cfg.postStory) q.push({ story: cfg.postStory });
    q.push(cfg.post === 'ending' ? { phase: 'ending' } : { startLevel: run.levelIdx + 1 });
    if (cfg.post === 'advisorLeaves') run.advisorPresent = false;
    run.queue = q.concat(run.queue);
  }
  function addMember(data, run, id, bond) {
    var c = cand(data, id);
    run.members[id] = { id: id, name: c.name, role: c.role, hp: c.hp, maxHp: c.hp, atk: c.atk, mood: bond === 'high' ? 1 : bond === 'low' ? -1 : 0, bond: bond, statuses: [], tokens: [], skill: clone(c.skill), combo: clone(c.combo) };
    run.party.push(id);
  }
  function moodAll(data, run, ev, extraFor) {
    run.party.forEach(function (id) {
      var m = run.members[id]; if (id === 'leader') return;
      var d = -1 - (extraFor && extraFor(id) ? 1 : 0), before = m.mood; m.mood = clampMood(m.mood + d);
      ev.push({ kind: 'mood', id: id, delta: m.mood - before, mood: m.mood, name: m.name });
    });
  }

  // ---------- battle ----------
  var uidN = 0;
  function mkUnit(data, run, spec, side) {
    var u;
    if (side === 'ally') { var m = run.members[spec]; u = { id: spec, name: m.name, role: m.role, hp: m.hp, maxHp: m.maxHp, atk: Math.max(1, m.atk), skill: clone(m.skill), combo: clone(m.combo), statuses: clone(m.statuses), mood: m.mood, bond: m.bond }; }
    else if (typeof spec === 'string') { var e = data.enemies.filter(function (x) { return x.id === spec; })[0]; u = { id: e.id, name: e.name, role: null, hp: e.hp * 3, maxHp: e.hp * 3, atk: e.atk, skill: { kind: 'strike', name: '攻击' }, statuses: [], boss: !!e.boss }; }
    else if (spec.rejected != null) {
      var rj = run.rejected[spec.rejected]; if (!rj) return null; var c = cand(data, rj.id), hi = rj.grudge === 'high';
      u = { id: c.id, name: c.name, role: c.role, hp: c.hp * 2 + (hi ? 4 : 2), maxHp: c.hp * 2 + (hi ? 4 : 2), atk: hi ? c.atk + 1 : Math.max(1, c.atk - 1), skill: clone(c.skill), statuses: [], corruption: 'vengeful', grudge: rj.grudge };
    } else if (spec.returned) {
      var s = spec.returned === 'first' ? run.sacrificed[0] : run.sacrificed[run.sacrificed.length - 1];
      if (!s || (spec.returned === 'final' && run.selfAt.length && run.selfAt[run.selfAt.length - 1] === 8)) return mkUnit(data, run, 'masked-champion', side); // §4.1 a self sacrifice takes nobody
      var c2 = cand(data, s.id);
      u = { id: c2.id, name: c2.name, role: c2.role, hp: c2.hp * 3 + 8, maxHp: c2.hp * 3 + 8, atk: c2.atk + 1, skill: clone(c2.skill), statuses: [], corruption: 'possessed' };
    } else if (spec.fairy) {
      var fd = data.enemies.filter(function (x) { return x.id === 'fairy-demon'; })[0] || { name: '小铃', hp: 20, atk: 3 };
      u = { id: 'fairy-demon', name: fd.name, role: null, hp: Math.round(fd.hp * 3 * spec.fairy), maxHp: fd.hp * 3, atk: fd.atk, skill: { kind: 'spark', name: '好玩好玩' }, statuses: [], boss: true };
    } else if (spec.girl) {
      var c3 = cand(data, spec.girl);
      u = { id: c3.id, name: c3.name, role: c3.role, hp: c3.hp * 2 + 4, maxHp: c3.hp * 2 + 4, atk: c3.atk, skill: clone(c3.skill), combo: clone(c3.combo), statuses: [], corruption: 'possessed', resummoned: true };
    } else if (spec.advisorBoss) { var a = advData(data, run); u = { id: 'advisor-boss', advisorId: a.id, name: a.boss.name, role: null, hp: 40, maxHp: 40, atk: 3, skill: { kind: 'guard', name: '真身' }, statuses: [], boss: true }; }
    u.uid = side[0] + (++uidN); u.side = side; u.keywords = keywords(data, u.skill, u.combo);
    u.actionText = actionTextOf(u.skill, u.atk); u.bonusText = side === 'ally' ? bonusTextOf(u.combo) : null;
    if (side === 'ally') { u.skillLv = skLv(u.skill); u.perkText = perkTextOf(data, u.id); }
    return u;
  }
  function startBattle(data, run) {
    var cfg = lvl(run);
    var wounded = run.wounded; run.wounded = false;
    run.battle = { round: 0, wave: 0, waveCount: cfg.waves.length, allies: run.party.map(function (id) { return mkUnit(data, run, id, 'ally'); }), enemies: [],
      pendingWave: 0, advisorUsed: false, fx: {}, chainSeq: 0, flash: {}, lastRound: [], win: null, maxChain: 0, dealt: {}, reckoned: {}, softUsed: {}, lastRevenge: {}, mult: 1, barkedRound: false };
    if (wounded) run.battle.allies.forEach(function (u) { u.hp = Math.ceil(u.maxHp * 0.7); }); // §4.3 带伤
    if (data.loseAt && run.level >= data.loseAt) run.battle.allies.forEach(function (u) { u.atk = 0; u.hp = 1; }); // dev: ?lose=N
  }
  function alive(arr) { return arr.filter(function (u) { return u.hp > 0; }); }
  function resolveRound(data, run) {
    var b = run.battle, ev = [], fx = b.fx; b.fx = {}; b.round++;
    if (b.pendingWave != null) {
      var w = lvl(run).waves[b.pendingWave]; b.wave = b.pendingWave + 1; b.pendingWave = null; b.enemies = [];
      if (b.wave > 1) ev.push({ kind: 'wave', wave: b.wave, text: '第 ' + b.wave + ' 波' });
      var specs = [];
      w.forEach(function (spec) {
        if (spec.guards) { for (var gi = 0; gi < Math.max(1, run.party.length - 1); gi++) specs.push('noble-guard'); return; }
        if (spec.resummon) { run.sacrificed.map(function (x) { return x.id; }).concat(run.rejected.map(function (x) { return x.id; })).slice(0, 5).forEach(function (id) { specs.unshift({ girl: id }); }); return; }
        specs.push(spec);
      });
      if (b.wave > 1 && run.level === 11) ev.push({ kind: 'phase2', lines: (((data.linesV2 || {}).fairy || {}).battle || {}).phase2 ? data.linesV2.fairy.battle.phase2.map(function (x) { return L(data, run, x); }) : [] });
      specs.forEach(function (spec) {
        var u = mkUnit(data, run, spec, 'enemy'); if (!u) return; b.enemies.push(u); ev.push({ kind: 'enemyEnter', uid: u.uid, unit: clone(u) });
        var R = ((data.linesV2 || {}).returns || {})[u.id];
        if (u.corruption === 'vengeful' && R) (R.vengeful[u.grudge].intro || []).forEach(function (x) { ev.push(lineEv(data, run, x)); });
        if (u.corruption === 'possessed' && R) (R.possessed.intro || []).forEach(function (x) { ev.push(lineEv(data, run, x)); });
        if (u.advisorId) ev.push(lineEv(data, run, { speaker: u.advisorId, text: '团长。你的阵是我教的——我最清楚从哪儿拆。', expr: 'special' }));
      });
      // v2.1 taunts: 1–3 enemies speak right after they enter
      var plain = b.enemies.filter(function (u) { return !u.corruption && u.id !== 'fairy-demon'; }).slice(0, 1 + Math.floor(rng(run) * 2));
      b.enemies.forEach(function (u) { var T = (((data.linesV2 || {}).fairy || {}).battle || {}).taunt; if (u.id === 'fairy-demon' && b.wave === 1 && T && T[0]) T[0].forEach(function (x) { var l = lineEv(data, run, x); l.uid = u.uid; l.key = 'taunt'; ev.push(l); }); });
      plain.forEach(function (u) { var l = lineEv(data, run, { speaker: 'narrator', text: pick(run, FB.taunt[u.id] || FB.taunt.any) }); l.speaker = u.id; l.speakerId = u.id; l.name = u.name; l.uid = u.uid; l.key = 'taunt'; ev.push(l); });
      // v2.1 §E the reckoning: monologue, the debts, one memory event per debt
      b.enemies.forEach(function (u) { if (u.corruption && !u.resummoned && !b.reckoned[u.id]) { b.reckoned[u.id] = 1; reckoning(data, run, u, ev); } });
    }
    // v2.1 §C frenzy from round 4
    var FZ = data.frenzyFrom || 4; b.mult = b.round >= FZ ? Math.pow(2, b.round - FZ + 1) : 1;
    if (b.mult > 1) ev.push({ kind: 'frenzy', round: b.round, mult: b.mult });
    b.barkedRound = false;
    var over = function () { return !alive(b.enemies).length || !alive(b.allies).length; };
    // §4.5 turncoat: each re-summoned girl may break free this round and strike the fairy instead
    alive(b.enemies).filter(function (u) { return u.resummoned && !u.turned; }).forEach(function (u) {
      var ch = 0.15 + (data.turnBoost != null ? data.turnBoost : 0.2), fairy = alive(b.enemies).filter(function (x) { return x.id === 'fairy-demon'; })[0];
      if (!fairy || rng(run) >= ch) return;
      u.turned = true; u.side = 'ally'; b.enemies.splice(b.enemies.indexOf(u), 1); b.allies.push(u);
      ev.push({ kind: 'turncoat', uid: u.uid, id: u.id });
      var tl = ((data.linesV2 || {}).turncoat || {})[u.id], tline = lineEv(data, run, tl && tl[0] ? tl[0] : { speaker: u.id, text: pick(run, FB.turncoat), expr: 'determined' }); tline.key = 'turncoat'; tline.uid = u.uid; ev.push(tline);
      ev.push({ kind: 'switchSide', uid: u.uid });
      var dmg = u.atk * Math.max(1, b.mult); fairy.hp = Math.max(0, fairy.hp - dmg);
      var te = { kind: 'action', side: 'ally', actor: u.uid, actorId: u.id, skill: u.skill.name, chainId: null, chainDepth: 0, base: u.atk, bonuses: [], targets: [{ uid: fairy.uid, id: fairy.id, amount: dmg, hpAfter: fairy.hp, kind: 'damage' }] };
      ev.push(te); downs(data, run, te, ev);
    });
    // allies, left → right; each starter can trigger a chain
    var starters = alive(b.allies).map(function (u) { return u.uid; });
    for (var i = 0; i < starters.length && !over(); i++) {
      var st = b.allies.filter(function (u) { return u.uid === starters[i]; })[0]; if (!st || st.hp <= 0) continue;
      var chainId = 'c' + (++b.chainSeq), depth = 0, actor = st, prev = null, total = 0;
      while (actor && !over()) {
        var e = allyAction(data, run, actor, depth, prev, chainId, fx); ev.push(e); total += e.base + e.bonuses.reduce(function (s, x) { return s + x.amount; }, 0);
        var nDown = downs(data, run, e, ev);
        var softT = e.targets.filter(function (t) { return t.soft; })[0];
        if (softT) { var vic = b.enemies.filter(function (x) { return x.uid === softT.uid; })[0]; ev.push(barkEv(data, run, actor, 'softHeart', { name: vic ? vic.name : '' })); }
        else if (!b.barkedRound && actor.id !== 'leader' && (nDown ? rng(run) < 0.7 : rng(run) < 0.3)) { b.barkedRound = true; ev.push(barkEv(data, run, actor, nDown ? 'kill' : actor.hp < actor.maxHp / 2 ? 'lowHp' : 'attack')); }
        var cb = actor.combo; prev = actor; actor = null;
        if (cb && !over()) {
          var ch = fx.luck ? 1 : Math.min(0.95, cb.chance * (fx.drum ? 2 : 1) + (prev.bond === 'high' ? 0.1 : 0));
          if (rng(run) < ch) {
            var row = b.allies, idx = row.indexOf(prev), dirs = cb.direction === 'both' ? (rng(run) < 0.5 ? [1, -1] : [-1, 1]) : [cb.direction === 'next' ? 1 : -1];
            for (var d = 0; d < dirs.length && !actor; d++) for (var j = idx + dirs[d]; j >= 0 && j < row.length; j += dirs[d]) if (row[j].hp > 0 && depth < 4) { actor = row[j]; break; }
            if (actor) depth++;
          }
        }
      }
      if (depth >= 1) { ev.push({ kind: 'chainEnd', chainId: chainId, depth: depth, total: total }); b.maxChain = Math.max(b.maxChain, depth); }
    }
    if (!alive(b.enemies).length && b.wave < b.waveCount) { b.pendingWave = b.wave; }
    else if (!over()) { // enemies, left → right
      var cancelled = false;
      alive(b.enemies).forEach(function (u) {
        if (over() || u.hp <= 0) return;
        var R = ((data.linesV2 || {}).returns || {})[u.id];
        if (u.corruption === 'vengeful' && u.grudge === 'low' && !b.flash[u.uid] && R) { b.flash[u.uid] = 1; ev.push(fbEv(data, run, u, R.vengeful.low.flashback)); return; }
        if (fx.clause && !cancelled) { cancelled = true; ev.push({ kind: 'line', speaker: 'narrator', name: '', text: u.name + ' 的行动被「附加条款」取消了。', expr: 'calm' }); return; }
        var t = alive(b.allies)[0]; if (!t) return; var amt = fx.smoke ? 0 : Math.max(0, u.atk * b.mult - (fx.formation ? 1 : 0));
        if (u.corruption) { // §E: every time she attacks she says something that remembers
          var pool = FB.attack[u.corruption].filter(function (x) { return x !== b.lastRevenge[u.uid]; }), tx = pick(run, pool); b.lastRevenge[u.uid] = tx;
          var rl = lineEv(data, run, { speaker: u.id, text: fill(tx, { card: '公开问责' }), expr: u.corruption === 'vengeful' ? 'vengeful-rage' : 'possessed-grin' }); rl.key = 'revenge'; rl.uid = u.uid; ev.push(rl);
        }
        t.hp = Math.max(0, t.hp - amt);
        var e2 = { kind: 'action', side: 'enemy', actor: u.uid, actorId: u.id, skill: u.skill.name, chainId: null, chainDepth: 0, base: u.atk, bonuses: fx.formation ? [{ from: 'advisor', label: '列阵', amount: -1 }] : [],
          targets: [{ uid: t.uid, id: t.id, amount: amt, hpAfter: t.hp, kind: 'damage', miss: !!fx.smoke }] };
        ev.push(e2); downs(data, run, e2, ev);
      });
    }
    // possessed flashback: first time below half
    b.enemies.forEach(function (u) {
      if (u.corruption === 'possessed' && u.hp > 0 && u.hp < u.maxHp / 2 && !b.flash[u.uid]) { b.flash[u.uid] = 1; var R = data.linesV2.returns[u.id]; if (R) ev.push(fbEv(data, run, u, R.possessed.flashback)); }
    });
    if (!alive(b.allies).length) b.win = false;
    else if (!alive(b.enemies).length && b.pendingWave == null) b.win = true;
    else if (b.round >= 12) b.win = false;
    if (b.win != null) ev.push({ kind: 'end', win: b.win, text: b.win ? '战斗胜利！' : '全员倒下了……' });
    b.lastRound = ev;
  }
  function fbEv(data, run, u, arr) { var l = L(data, run, (arr || [])[0] || { speaker: u.id, text: '……团长？', expr: 'sad' }); l.kind = 'flashback'; l.uid = u.uid; return l; }
  function allyAction(data, run, u, depth, prev, chainId, fx) {
    var b = run.battle, k = u.skill.kind, base = u.atk + (k === 'aim' ? 1 : 0), bonuses = [];
    if (depth > 0) bonuses.push({ from: prev.uid, label: '加成', amount: depth });
    if (depth > 0 && u.bond === 'high') bonuses.push({ from: 'bond', label: '羁绊', amount: 1 });
    var total = base + bonuses.reduce(function (s, x) { return s + x.amount; }, 0), targets = [], foes = alive(b.enemies);
    if (k === 'heal') {
      var low = alive(b.allies).sort(function (x, y) { return x.hp / x.maxHp - y.hp / y.maxHp; })[0];
      if (low && low.hp < low.maxHp) { var amt = Math.min(b.mult > 1 ? Math.max(1, Math.floor(total / 2)) : total, low.maxHp - low.hp); low.hp += amt; targets.push({ uid: low.uid, id: low.id, amount: amt, hpAfter: low.hp, kind: 'heal' }); }
      else k = 'strike';
    }
    if (k !== 'heal') {
      var list = k === 'spark' ? foes : k === 'backstab' ? foes.slice(0, 2) : foes.slice(0, 1);
      if (b.mult > 1) bonuses.push({ from: 'frenzy', label: '狂热 ×' + b.mult, amount: total * (b.mult - 1) });
      list.forEach(function (t) {
        var amt = (k === 'spark' ? Math.max(1, Math.round(total / 2)) : k === 'backstab' ? Math.max(1, total - 1) : total) * b.mult;
        // §D soft heart: a girl who was once in the party with her
        var once = (run.sacrificed || []).some(function (x) { return x.id === t.id; });
        if (list.length === 1 && t.corruption === 'possessed' && once && !b.softUsed[u.id] && u.id !== 'leader' && rng(run) < (u.bond === 'high' ? 0.35 : 0.2) + (data.softBoost || 0)) {
          b.softUsed[u.id] = 1; targets.push({ uid: t.uid, id: t.id, amount: 0, hpAfter: t.hp, kind: 'damage', miss: true, soft: true }); return;
        }
        t.hp = Math.max(0, t.hp - amt); targets.push({ uid: t.uid, id: t.id, amount: amt, hpAfter: t.hp, kind: 'damage' });
        b.dealt[u.id] = (b.dealt[u.id] || 0) + amt;
      });
    }
    return { kind: 'action', side: 'ally', actor: u.uid, actorId: u.id, skill: u.skill.name, chainId: chainId, chainDepth: depth, base: base, bonuses: bonuses, targets: targets, hits: 1, crits: 0, skillLv: skLv(u.skill) }; // skill-level log fields (the stub never crits / multi-hits)
  }
  function downs(data, run, e, ev) {
    var b = run.battle, n = 0;
    e.targets.forEach(function (t) {
      if (t.kind !== 'damage' || t.hpAfter > 0) return;
      var u = b.allies.concat(b.enemies).filter(function (x) { return x.uid === t.uid; })[0]; if (!u || u.downed) return; u.downed = true;
      ev.push({ kind: 'down', uid: u.uid, id: u.id, side: u.side, text: u.name + ' 倒下了' });
      var R = u.side === 'enemy' && ((data.linesV2 || {}).returns || {})[u.id];
      var dl = R && u.corruption ? lineEv(data, run, ((u.corruption === 'possessed' ? R.possessed.down : R.vengeful[u.grudge].down) || [])[0]) : null;
      if (dl) ev.push(dl); n++;
    });
    return n;
  }
  function barkEv(data, run, u, kind, ctx) {
    var l = lineEv(data, run, { speaker: u.id, text: fill(pick(run, FB.bark[kind]), ctx || {}), expr: kind === 'softHeart' ? 'sad' : 'happy' });
    l.key = kind === 'softHeart' ? 'softHeart' : 'bark'; l.uid = u.uid; return l;
  }
  function reckoning(data, run, u, ev) {
    var R = (((data.linesV2 || {}).returns || {})[u.id] || {}), cv = u.corruption, src = cv === 'possessed' ? R.possessed : (R.vengeful || {})[u.grudge || 'high'];
    var mono = (src && src.monologue) || FB.monologue[cv].map(function (t) { return { speaker: u.id, text: t, expr: cv === 'vengeful' ? 'vengeful-rage' : 'possessed-grin' }; });
    ev.push({ kind: 'reckoning', id: u.id, uid: u.uid, corruption: cv, lines: mono.map(function (x) { return L(data, run, x); }) });
    var m = run.members[u.id], debts = [];
    if (cv === 'possessed') debts.push({ label: '你写下的名字', text: '全队攻击 −1（本场）', source: 'sacrifice' });
    else debts.push({ label: '「谢谢，不过……」', text: '一人开场发呆一回合', source: 'rejected' });
    ((m && m.statuses) || []).filter(function (x) { return x.dark; }).slice(0, 1).forEach(function (x) { debts.push({ label: '你亲手给的「' + x.label + '」', text: '一人生命上限 −2', source: 'debuff' }); });
    var sidedFor = Object.keys(run.sided).some(function (r) { return run.sided[r] === u.id; });
    if (!sidedFor && debts.length < 3) debts.push({ label: '你没站在我这边', text: '一人心情 −1', source: 'sidedAgainst' });
    ev.push({ kind: 'debts', id: u.id, debts: debts });
    var b = run.battle;
    debts.forEach(function (d) {
      var all = d.source === 'sacrifice', hit = all ? alive(b.allies) : [pick(run, alive(b.allies))];
      hit.forEach(function (a) { a.statuses = (a.statuses || []).concat([{ id: 'debt', label: '旧账', dark: true, tip: d.label + '：' + d.text }]); if (all) a.atk = Math.max(1, a.atk - 1); });
      ev.push({ kind: 'memory', id: u.id, unit: u.uid, allies: hit.map(function (a) { return a.uid; }), text: u.name + '把「' + d.label + '」还给了你们' });
    });
  }
  function battleView(data, run) {
    var b = run.battle, a = advData(data, run);
    var unit = function (u) { var o = { turned: !!u.turned, id: u.id, uid: u.uid, name: u.name, role: u.role, hp: u.hp, maxHp: u.maxHp, atk: u.atk, keywords: u.keywords, actionText: u.actionText, bonusText: u.bonusText, skillLv: u.skillLv, perkText: u.perkText, statuses: u.statuses, side: u.side, boss: !!u.boss };
      if (u.corruption) { o.corruption = u.corruption; o.grudge = u.grudge; } if (u.advisorId) o.advisorId = u.advisorId; if (u.mood != null) o.mood = u.mood; return o; };
    return { round: b.round, wave: b.wave, waveCount: b.waveCount, allies: b.allies.map(unit), enemies: b.enemies.map(unit), lastRound: clone(b.lastRound), win: b.win, maxChain: b.maxChain,
      mvp: Object.keys(b.dealt).sort(function (x, y) { return b.dealt[y] - b.dealt[x]; })[0] || null,
      pause: { move: true, advisorSkill: run.advisorPresent && a ? { available: !b.advisorUsed, used: b.advisorUsed, name: a.combat.name, text: a.combat.text } : null, items: run.items.map(function (id) { return itemView(data, id); }) } };
  }
  function syncBack(run) { // battle hp/statuses → members (and the order the player left them in)
    var b = run.battle; run.party = b.allies.filter(function (u) { return run.members[u.id] && !u.turned; }).map(function (u) { return u.id; });
    b.allies.forEach(function (u) { var m = run.members[u.id]; if (m) m.statuses = clone(u.statuses); });
  }

  // ---------- act ----------
  function act(data, run0, a) {
    var run = clone(run0), ev = [], b;
    run.history.push({ phase: run.phase, level: run.level, action: clone(a) });
    if (a.type === 'cheatKeys') { run.keys = { self: true, rules: true, bell: true }; run.namedGirl = false; run.lastEvents = [{ kind: 'cheat', what: 'keys' }]; return run; }
    switch (run.phase) {
      case 'story': advance(data, run, ev); break;
      case 'advisor': run.advisor = a.advisor; advance(data, run, ev); break;
      case 'leader':
        if (a.type === 'chooseLeader') { run.leader.identity = a.identity; a = { type: 'chooseClass', cls: a['class'] }; run.leaderStep = 'class'; }
        if (a.type === 'chooseIdentity') { run.leader.identity = a.identity; run.leaderStep = 'class'; break; }
        var cl = data.leader.classes.filter(function (c) { return c.id === a.cls; })[0];
        run.leader.cls = cl.id; run.leader.role = cl.role;
        run.members.leader = { id: 'leader', name: run.leaderName || '团长', role: cl.role, hp: cl.hp, maxHp: cl.hp, atk: cl.atk, mood: null, statuses: [], tokens: [], skill: clone(cl.skill), combo: clone(cl.combo), leader: true };
        run.party.push('leader'); advance(data, run, ev); break;
      case 'interview': {
        var r = rounds(data, run)[run.interviewIdx], p = roundPair(data, r), key = pairKey(data, p[0].id, p[1].id), I = key && data.interviews.pairs[key];
        if (a.type === 'side') {
          run.sided[r] = a.id; run.interviewStep = 'hire';
          p.forEach(function (c) { ev.push(lineEv(data, run, Object.assign({ speaker: c.id }, I.reactions[a.id][c.id]))); });
          break;
        }
        var other = p.filter(function (c) { return c.id !== a.candidate && c.id !== a.id; })[0], hid = a.candidate || a.id, sided = run.sided[r];
        var bond = !I ? 'high' : hid === sided ? 'high' : 'low', grudge = !I ? 'high' : other.id === sided ? 'low' : 'high';
        addMember(data, run, hid, bond);
        run.rejected.push({ id: other.id, round: r, grudge: grudge }); run.rejectedInfo[other.id] = { grudge: grudge, round: r };
        ev.push(lineEv(data, run, Object.assign({ speaker: hid }, cand(data, hid).lines.hired)));
        if (I) ev.push(lineEv(data, run, Object.assign({ speaker: other.id }, I.leave[other.id][other.id === sided ? 'sided' : 'unsided'])));
        run.interviewIdx++;
        if (run.interviewIdx < rounds(data, run).length) setInterviewStep(data, run); else advance(data, run, ev);
        break;
      }
      case 'prep':
        if (a.type === 'setOrder') { run.party = a.order.slice(); break; }
        if (a.type === 'camp' || a.type === 'campExplore' || a.type === 'campTrainPick' || a.type === 'campTrainBonus') { campAct(data, run, a, ev); break; }
        if (a.type === 'followBell') {
          if (!run.bellNow) throw new Error('no bell here');
          run.keys.bell = true; run.wounded = true; run.relics = (run.relics || []).concat(['bell']); run.bellNow = false; run.bellDone = true;
          run.queue.unshift({ phase: 'prep', noTalk: true }); run.phase = 'story'; run.story = { id: 'bellFollowed' }; break;
        }
        if (run.bellNow) { run.bellNow = false; run.bellDone = true; }
        if (a.type === 'cheatWin') { startBattle(data, run); resolveRound(data, run); run.phase = 'battle'; cheat(run); endCheck(data, run, ev); break; }
        startBattle(data, run); resolveRound(data, run); run.phase = 'battle'; endCheck(data, run, ev);
        if (run.phase === 'battle' && run.battle.round === 1 && run.advisorPresent) { var g = ((data.linesV2.advisorGuide || {})[run.advisor] || {}).firstPause; if (g && run.levelIdx === 0) g.forEach(function (x) { ev.push(lineEv(data, run, x)); }); }
        break;
      case 'battle':
        b = run.battle;
        if (a.type === 'cheatWin') { cheat(run); b.lastRound = b.lastRound.filter(function (e) { return e.kind === 'reckoning' || e.kind === 'debts' || e.kind === 'memory' || e.kind === 'enemyEnter'; }); endCheck(data, run, ev); break; }
        if (a.type === 'move') { var from = b.allies.map(function (u) { return u.id; }).indexOf(a.id), u0 = b.allies.splice(from, 1)[0]; b.allies.splice(Math.max(0, Math.min(a.to, b.allies.length)), 0, u0); }
        if (a.type === 'advisorSkill') { b.advisorUsed = true; b.fx[advData(data, run).combat.kind] = true; }
        if (a.type === 'useItem') {
          var ii = run.items.indexOf(a.itemId); if (ii < 0) throw new Error('no such item'); run.items.splice(ii, 1);
          var tu = b.allies.filter(function (x) { return x.id === a.target; })[0];
          if (a.itemId === 'potion' && tu) tu.hp = tu.maxHp;
          if (a.itemId === 'holywater' && tu) tu.statuses = [];
          if (a.itemId === 'smoke') b.fx.smoke = true; if (a.itemId === 'drum') b.fx.drum = true;
        }
        resolveRound(data, run); endCheck(data, run, ev); break;
      case 'battleResult':
        if (a.type === 'cheatWin') { // v2.3 §H: a lost battle re-scored as a win
          b = run.battle; if (b.win !== false) throw new Error('cheatWin needs a lost battle');
          b.allies.forEach(function (u) { u.hp = Math.max(1, u.hp); }); b.enemies.forEach(function (u) { u.hp = 0; }); b.win = true; run.cheated = true; b.lastRound = [];
          ev.push({ kind: 'cheat', text: '改判胜利。' }); syncBack(run); postQueue(data, run); advance(data, run, ev); break;
        }
        if (run.battle && run.battle.win === false) { run.outcome = 'defeat'; run.queue = [{ story: 'gameOver' }, { phase: 'gameOver' }]; run.phase = 'gameOver'; break; }
        postQueue(data, run); advance(data, run, ev); break;
      case 'reward': case 'debuff': {
        var pool = run.phase === 'reward' ? data.cards.rewards : data.cards.debuffs, card = pool.filter(function (c) { return c.id === a.card; })[0], eff = card.effect, m = run.members[a.target];
        if (eff.type === 'item') { if (run.items.length < 3) run.items.push(eff.item); else ev.push({ kind: 'line', speaker: 'narrator', name: '', text: '背包满了。' + card.name + '没能带走。', expr: 'calm' }); }
        else if (m) {
          if (eff.type === 'stat') applyEffs(run, a.target, [eff], ev);
          if (eff.type === 'token') m.tokens.push(eff.tokenName);
          if (run.phase === 'debuff') m.statuses.push({ id: card.id, label: card.name, dark: true });
          if (a.target !== 'leader') {
            var before = m.mood; m.mood = clampMood(m.mood + (run.phase === 'reward' ? 1 : -1) + (eff.type === 'mood' ? eff.delta : 0));
            if (run.phase === 'debuff') ev.push({ kind: 'darkTransition', reason: 'debuff' });
            ev.push(lineEv(data, run, { speaker: a.target, text: run.phase === 'reward' ? '给我的？谢谢团长！' : '……给我？行。我记着。', expr: run.phase === 'reward' ? 'happy' : 'upset' }));
            ev.push({ kind: 'mood', id: a.target, delta: m.mood - before, mood: m.mood, name: m.name });
          }
        }
        advance(data, run, ev); break;
      }
      case 'sacrifice': {
        if (a.mode === 'self') { // §4.1 key one: your own name
          run.party.forEach(function (pid) { var pm = run.members[pid]; pm.maxHp = Math.max(3, Math.floor(pm.maxHp * 0.5)); pm.hp = Math.min(pm.hp, pm.maxHp); if (pid !== 'leader') pm.mood = clampMood(pm.mood - 1); });
          run.keys.self = true; run.branch = run.branch || 'self'; run.selfAt.push(run.level);
          ev.push({ kind: 'darkTransition', reason: 'self' }); moodAll(data, run, ev); run.act = 3;
          run.queue.unshift({ story: 'sacrificeSelf' }); advance(data, run, ev); break;
        }
        if (a.mode === 'random') run.keys.rules = true; else run.namedGirl = true;
        var gone = a.mode === 'random' ? (function () { var t = run.party.filter(function (id) { return id !== 'leader'; }), out = []; while (out.length < 2 && t.length) out.push(t.splice(Math.floor(rng(run) * t.length), 1)[0]); return out; })() : [a.target];
        run.branch = run.branch || a.mode;
        gone.forEach(function (id) { run.party = run.party.filter(function (x) { return x !== id; }); run.sacrificed.push({ id: id, level: run.level, mode: a.mode }); });
        ev.push({ kind: 'darkTransition', reason: a.mode === 'random' ? 'taken' : 'sacrifice' });
        moodAll(data, run, ev, function (id) { return run.members[id].bond === 'high' && rng(run) < 0.3; });
        run.act = 3;
        if (a.mode === 'random') run.queue.unshift({ story: 'sacrificeRandomTaken' });
        else if (run.levelIdx === 3) run.queue.unshift({ story: 'aftermath' });
        advance(data, run, ev); break;
      }
      default: throw new Error('stub: no actions in phase ' + run.phase);
    }
    run.lastEvents = ev;
    return run;
  }
  function cheat(run) { // dev: every enemy (and every later wave) is gone; the round's reckoning still plays
    var b = run.battle; b.enemies.forEach(function (u) { u.hp = 0; }); b.pendingWave = null; b.wave = b.waveCount; b.win = true;
    b.lastRound = (b.lastRound || []).filter(function (e) { return e.kind !== 'end'; }).concat([{ kind: 'end', win: true, text: '战斗胜利！' }]);
  }
  function endCheck(data, run, ev) {
    var b = run.battle; if (b.win == null) return;
    syncBack(run);
    run.phase = 'battleResult'; // v2.3: a loss shows the (lost) result first; continue → gameOver (see the battleResult case)
  }

  // ---------- view ----------
  function memberView(data, run, id) {
    var m = run.members[id];
    return { id: id, name: m.name, isLeader: id === 'leader', role: m.role, roleLabel: ROLE_LABEL[m.role], hp: m.hp, maxHp: m.maxHp, atk: m.atk, mood: m.mood, moodLabel: m.mood == null ? null : MOOD_LABEL[m.mood],
      bond: m.bond || null, statuses: clone(m.statuses), tokens: m.tokens.slice(), skillName: m.skill.name, comboName: m.combo ? m.combo.name : null, keywords: keywords(data, m.skill, m.combo),
      actionText: actionTextOf(m.skill, m.atk), bonusText: bonusTextOf(m.combo), skillLv: skLv(m.skill), perkText: perkTextOf(data, id) };
  }
  function view(data, run) {
    var cfg = lvl(run), a = advData(data, run);
    var v = { phase: run.phase, level: run.level, levelTitle: cfg ? cfg.title : '', act: run.act, party: run.party.map(function (id) { return memberView(data, run, id); }),
      advisor: a ? { id: a.id, name: a.name, present: run.advisorPresent, combat: clone(a.combat), flow: clone(a.flow) } : null,
      items: run.items.map(function (id) { return itemView(data, id); }), relics: (run.relics || []).map(function (id) { return { id: id, name: '无名铜铃', text: '功能不详。' }; }), events: clone(run.lastEvents), keys: clone(run.keys) };
    switch (run.phase) {
      case 'story': {
        var s = run.story.id === 'fairyWelcome' ? fairyLines(data, run) : data.stories[run.story.id] || [];
        if (!Array.isArray(s)) s = s[run.advisor] || s['default'] || [];
        v.storyId = run.story.id; v.lines = s.map(function (x) { var l = L(data, run, x); if (x && x.fx) l.fx = x.fx; return l; });
        if (run.story.id === 'teamAssembled') v.lines = stubAssembled(data, run);
        if (run.story.id === 'levelIntro') v.lines = stubLevelIntro(data, run);
        break;
      }
      case 'advisor': v.advisors = data.advisors.map(function (x) { return { id: x.id, name: x.name, look: x.look, intro: x.intro, combat: clone(x.combat), flow: clone(x.flow) }; }); break;
      case 'leader': v.leaderStep = run.leaderStep; v.identities = clone(data.leader.identities);
        v.classes = data.leader.classes.map(function (c) { var o = clone(c); o.roleLabel = ROLE_LABEL[c.role]; o.keywords = keywords(data, c.skill, c.combo); o.actionText = actionTextOf(c.skill, c.atk); o.bonusText = bonusTextOf(c.combo); o.skillLv = skLv(c.skill); o.perkText = perkTextOf(data, null, c); return o; }); break;
      case 'interview': {
        var rs = rounds(data, run), r = rs[run.interviewIdx], p = roundPair(data, r), key = pairKey(data, p[0].id, p[1].id), I = key && data.interviews.pairs[key];
        v.round = run.interviewIdx + 1; v.roundTotal = rs.length; v.leaderRole = run.leader.role; v.interviewStep = run.interviewStep; v.sided = run.sided[r] || null;
        v.pair = p.map(function (c) { return { id: c.id, name: c.name, role: c.role, roleLabel: ROLE_LABEL[c.role], hp: c.hp, atk: c.atk, look: c.look, skillName: c.skill.name, comboName: c.combo.name, keywords: keywords(data, c.skill, c.combo), actionText: actionTextOf(c.skill, c.atk), bonusText: bonusTextOf(c.combo), skillLv: skLv(c.skill), perkText: perkTextOf(data, c.id, c), intro: L(data, run, Object.assign({ speaker: c.id }, c.intro)) }; });
        v.conflict = I ? { id: I.id, title: I.title, lines: I.lines.map(function (x) { return L(data, run, x); }), options: p.map(function (c) { return { id: c.id, label: I.options[c.id] }; }) } : null;
        break;
      }
      case 'prep': v.camp = campView(data, run); v.enemyCount = cfg.level === 11 ? run.party.length : cfg.waves[0].length; v.waveCount = cfg.waves.length; v.campfire = clone(run.campfire); v.bell = !!run.bellNow; v.wounded = !!run.wounded; break;
      case 'battle': case 'battleResult': v.battle = battleView(data, run); break;
      case 'reward': case 'debuff': {
        var pool = run.phase === 'reward' ? data.cards.rewards : data.cards.debuffs;
        v.options = run.options.map(function (id) { var o = clone(pool.filter(function (c) { return c.id === id; })[0]); if (o.effect && (o.effect.type === 'stat' || o.effect.type === 'mood')) { o.preview = {}; run.party.forEach(function (pid) { o.preview[pid] = statPreview(run, pid, [o.effect]); }); } return o; });
        v.targets = run.party.slice(); v.bagFull = run.items.length >= 3; break;
      }
      case 'sacrifice': {
        v.modes = run.sacrificeModes.slice(); v.targets = run.party.filter(function (id) { return id !== 'leader'; }); v.memory = {}; v.targets.forEach(function (id) { v.memory[id] = memoryOf(data, run, id); }); v.suggestion = clone(run.suggestion); v.farewells = {};
        if (!data.noFarewells) v.targets.forEach(function (id) { var m = run.members[id], c = cand(data, id), tone = m.mood >= 0 ? 'brave' : 'bewildered', l = c.lines[tone === 'brave' ? 'farewellBrave' : 'farewellBewildered'];
          var hb = m.bond === 'high' && data.linesV2.farewellHighBond[id]; v.farewells[id] = Object.assign({ tone: tone }, L(data, run, Object.assign({ speaker: id }, hb ? hb[0] : l))); });
        break;
      }
      case 'gameOver': case 'ending':
        if (run.battle) v.battle = battleView(data, run);
        v.summary = { outcome: run.outcome, reachedLevel: run.level, branch: run.branch, identity: run.leader.identity, cls: run.leader.cls,
          fates: data.candidates.map(function (c) { var s = run.sacrificed.filter(function (x) { return x.id === c.id; })[0], rj = run.rejectedInfo[c.id];
            var f = { id: c.id, name: c.name, fate: s ? 'sacrificed' : rj ? 'rejected' : run.members[c.id] ? 'survived' : 'unmet', round: c.round, tokens: run.members[c.id] ? run.members[c.id].tokens.slice() : [], enemyAt: [] };
            if (s) { f.sacrificedAt = s.level; f.mode = s.mode; } if (rj) f.grudge = rj.grudge; if (run.members[c.id]) f.bond = run.members[c.id].bond; return f; }),
          advisor: a ? { id: a.id, name: a.name, bossName: a.boss.name, defeated: run.outcome === 'victory' } : null };
        if (run.phase === 'gameOver') v.summary.epilogue = epilogue(data, run);
        if (run.outcome === 'victory') v.summary.whiteout = { captions: ['终于结束了。', '……吗？'] };
        if (run.outcome === 'victory' || run.outcome === 'true') v.summary.epilogue = victoryEpilogue(data, run);
        if (run.outcome === 'true') {
          var met = run.party.filter(function (id) { return id !== 'leader'; }).concat(run.sacrificed.map(function (x) { return x.id; }), run.rejected.map(function (x) { return x.id; }));
          v.summary.trueEnding = { restored: met, lines: [L(data, run, '名册摊在长桌上，第一页的名字，一个都没有被划掉。'), L(data, run, { speaker: met[0], text: '团长，早饭好了！', expr: 'happy' }), L(data, run, '门口的铜铃，再也没有自己响过。')] };
        }
        break;
    }
    return v;
  }
  // v2.4 [9] stub shapes: rollcall + levelCard ride in story lines
  var RC = ['到！今天也要加油！', '……在。', '我来啦！别丢下我！', '嗯，交给我吧。', '报到。剑已经磨好了。'];
  function stubAssembled(data, run) {
    var out = [L(data, run, { speaker: 'advisor', text: '人齐了。{leader}，这就是你的队伍。', expr: 'happy' })];
    run.party.filter(function (id) { return id !== 'leader'; }).forEach(function (id, i) { out.push({ kind: 'rollcall', id: id, line: L(data, run, { speaker: id, text: RC[i % RC.length], expr: 'happy' }) }); });
    out.push(L(data, run, { speaker: 'leader', text: '团员们！出发！', expr: 'happy' }));
    return out;
  }
  function stubLevelIntro(data, run) {
    var cfg = lvl(run) || {}, gone = !run.advisorPresent || run.level >= 10;
    return [L(data, run, gone ? { speaker: 'narrator', text: '没有人再为你们念任务书了。' } : { speaker: 'advisor', text: '第 ' + run.level + ' 单任务……「' + (cfg.title || '') + '」。小心点。', expr: 'calm' }),
      { kind: 'levelCard', level: run.level, title: cfg.title || '' }];
  }
  function victoryEpilogue(data, run) {
    var N = function (t) { return L(data, run, { speaker: 'narrator', text: t }); }, tr = run.outcome === 'true';
    var fates = run.party.filter(function (id) { return id !== 'leader'; }).map(function (id) { var n = nameOf(data, run, id);
      return { id: id, name: n, status: tr ? 'restored' : 'member', corruption: null, lines: [N(n + '回到了公会。'), L(data, run, { speaker: id, text: '团长，下一单接什么？', expr: 'happy' })] }; });
    if (!tr) fates = fates.concat(run.sacrificed.map(function (x) { var n = nameOf(data, run, x.id); return { id: x.id, name: n, status: 'enemy', corruption: 'possessed', lines: [N(n + '还留在那个壁龛里。没有人去接她。')] }; }));
    else fates = fates.concat(run.sacrificed.concat(run.rejected).map(function (x) { var n = nameOf(data, run, x.id); return { id: x.id, name: n, status: 'restored', corruption: null, lines: [N(n + '从玻璃柜里走了出来，揉了揉眼睛。')] }; }));
    var a = advData(data, run);
    return { intro: [N(tr ? '那一天之后，公会的早晨又热闹了起来。' : '你们走出了墓穴。阳光有点刺眼。')], fates: fates, leader: [N(run.leaderName + '把名册合上了。')],
      advisor: a ? { id: a.id, name: a.name, lines: [N(tr ? a.name + '的位置空着。没有人提起她。' : a.name + '被摆在了贵族的架子上，像一只人偶。')] } : null, outro: [] };
  }
  function epilogue(data, run) {
    var N = function (t) { return L(data, run, { speaker: 'narrator', text: t }); };
    var fates = run.party.filter(function (id) { return id !== 'leader'; }).map(function (id) { var n = nameOf(data, run, id);
      return { id: id, name: n, status: 'member', corruption: null, lines: [N(n + '被抬上了看台。面具们鼓掌，说她的眼神“还很新鲜”。'), L(data, run, { speaker: id, text: '……团长？你在哪？', expr: 'sad' })] }; })
      .concat(run.rejected.map(function (r) { var n = nameOf(data, run, r.id); return { id: r.id, name: n, status: 'rejected', corruption: 'vengeful', lines: [N(n + '拿到了她要的赏钱。后来，她再也没离开过那条走廊。')] }; }))
      .concat(run.sacrificed.map(function (x) { var n = nameOf(data, run, x.id); return { id: x.id, name: n, status: 'sacrificed', corruption: 'possessed', lines: [N(n + '被陈列在高台的第三个壁龛里。旁边的铭牌写着：“改过两次”。')] }; }));
    return { intro: [N('又一支不知天高地厚的小队，倒在了墓穴深处。'), N('她们没有死。她们成了贵族们的新玩具。'), { speaker: 'gallery', speakerId: null, name: '看台上的声音', text: '这一批，挺耐玩的。', expr: 'calm' }],
      fates: fates, leader: [N('团长被留到了最后。她们让她看着，一个，一个。'), N('后来，她不再说话了。')],
      advisor: (function () { var a = advData(data, run); return a ? { id: a.id, name: a.name, lines: [L(data, run, { speaker: a.id, text: '真可惜。不过公会的门，明天还会开的。', expr: 'happy' }), N(a.name + '理了理衣领，笑着走回了大厅。下一支小队，已经在门口排队了。')] } : null; })(),
      outro: [N('冒险者公会的招牌，在风里轻轻晃着。'), N('欢迎加入。')] };
  }
  function simulateBattle(data, run0) {
    var run = clone(run0); startBattle(data, run); var n = 0;
    do { resolveRound(data, run); } while (run.battle.win == null && ++n < 30);
    return { win: !!run.battle.win, rounds: run.battle.round };
  }

  var StubEngine = { createRun: createRun, view: view, act: act, simulateBattle: simulateBattle, metaUpdate: metaUpdate, version: 2, stub: true };
  if (typeof module !== 'undefined' && module.exports) module.exports = StubEngine;
  root.ChooserStubEngine = StubEngine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
