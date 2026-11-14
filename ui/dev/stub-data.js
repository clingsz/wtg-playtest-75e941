// DEV ONLY — fake v2 content for the stub engine (docs/V2-CONTRACT.md). Safe to delete together with stub-engine.js.
(function (root) {
  var R = ['tank', 'adc', 'healer', 'mage', 'rogue'];
  var people = [ // id, name, look, skill kind
    ['marta', '玛尔塔', '北境矿工的女儿，红褐双辫串三枚铁环，背着比她还大的凹痕圆盾', 'guard'], ['eve', '伊芙', '前圣骑士，盾上刻着十一个名字', 'guard'],
    ['rico', '莉珂', '赏金猎人，银耳环，账本不离手', 'aim'], ['awu', '阿雾', '猎户之女，话很少', 'aim'],
    ['cecy', '塞西', '修女，笑起来很软', 'heal'], ['greta', '葛蕾', '药师，单片镜，嘴毒', 'heal'],
    ['viola', '薇奥拉', '没落贵族的大小姐', 'spark'], ['xiaoman', '小满', '胆小的魔法学徒', 'spark'],
    ['crow', '夜鸦', '前魔盗团，知道得太多', 'backstab'], ['kiki', '琪琪', '扒手，银镯叮当响', 'backstab']
  ];
  var COMBOS = { // [name, direction, when, chance]
    marta: ['带血的号令', 'next', 'low-hp', 0.5], eve: ['圣盾回响', 'both', 'on-guard', 0.6],
    rico: ['掩护射击', 'next', 'on-hit', 0.5], awu: ['追猎', 'prev', 'on-kill', 0.6],
    cecy: ['祷言接力', 'both', 'on-heal', 0.5], greta: ['苦药', 'next', 'always', 0.35],
    viola: ['余烬', 'next', 'on-hit', 0.45], xiaoman: ['慌乱咏唱', 'both', 'always', 0.7],
    crow: ['影袭', 'prev', 'on-kill', 0.75], kiki: ['顺手牵羊', 'prev', 'on-hit', 0.5]
  };
  var SKILL_NAME = { guard: '盾击', aim: '点射', heal: '包扎', spark: '火花', backstab: '双刃' };
  var candidates = people.map(function (p, i) {
    var round = Math.floor(i / 2) + 1, role = R[round - 1], cb = COMBOS[p[0]];
    return {
      id: p[0], name: p[1], round: round, slot: i % 2 ? 'B' : 'A', role: role, look: p[2],
      hp: role === 'tank' ? 12 : role === 'healer' ? 8 : 7, atk: role === 'tank' ? 2 : 3,
      skill: { kind: p[3], name: SKILL_NAME[p[3]], power: 0 }, combo: { name: cb[0], direction: cb[1], when: cb[2], chance: cb[3] },
      perk: { name: '特点', text: '（桩数据）' + p[1] + '的特点说明' }, // DESIGN-skill-level 收尾: the 【特点】 row
      intro: { text: '我是' + p[1] + '。' + (i % 2 ? '请多指教。' : '你只要看我做的事就行。'), expr: 'calm' },
      lines: {
        hired: { text: '……谢谢你，团长。我不会让你后悔。', expr: 'happy' },
        farewellBrave: { text: '团长，别回头。' + p[1] + '答应过的事，从来都算数。', expr: 'determined' },
        farewellBewildered: { text: '为什么……是我？我做错了什么？', expr: 'shock' }
      }
    };
  });

  // data/keywords.json (content)
  var keywords = {
    skill: { guard: { label: '守护', tip: '攻击最左侧的敌人；下次行动前受到的伤害 −1' }, aim: { label: '点射', tip: '瞄准最左侧的敌人，伤害 +1' },
      heal: { label: '治疗', tip: '为生命最低的队友回复生命' }, spark: { label: '火花', tip: '对敌方全体各造成伤害' },
      backstab: { label: '双刃', tip: '依次攻击对方前两名' }, strike: { label: '攻击', tip: '攻击最左侧的敌人' } },
    when: { always: { label: '每次', tip: '每次行动后都可能触发' }, 'on-hit': { label: '命中', tip: '造成伤害后可能触发' }, 'on-kill': { label: '击倒', tip: '击倒敌人后可能触发' },
      'on-heal': { label: '治疗后', tip: '治疗队友后可能触发' }, 'on-guard': { label: '格挡', tip: '盾击后可能触发' }, 'low-hp': { label: '背水', tip: '自己半血以下时可能触发' } },
    direction: { next: { label: '接力 →', tip: '带动右侧最近的队友出手' }, prev: { label: '← 回援', tip: '带动左侧最近的队友出手' }, both: { label: '↔ 共鸣', tip: '带动左右两侧的队友出手' } },
    status: { 'cracked': { label: '裂刃', tip: '攻击 −1' }, 'wound': { label: '旧伤', tip: '生命上限 −2' }, 'nightmare': { label: '噩梦', tip: '心情 −1' } }
  };

  // data/interviews.json (content) — one pair fully written, the rest generated
  function pair(a, b, title, lines, optA, optB) {
    var o = { id: a + '-' + b, title: title, lines: lines, options: {}, reactions: {}, leave: {} };
    o.options[a] = optA; o.options[b] = optB;
    o.reactions[a] = {}; o.reactions[a][a] = { text: '团长明白人。', expr: 'happy' }; o.reactions[a][b] = { text: '……您说得对。', expr: 'sad' };
    o.reactions[b] = {}; o.reactions[b][a] = { text: '哼。随你。', expr: 'upset' }; o.reactions[b][b] = { text: '……谢谢。', expr: 'happy' };
    o.leave[a] = { sided: { text: '至少你替我说过话。', expr: 'sad' }, unsided: { text: '你从一开始就没打算要我。', expr: 'upset' } };
    o.leave[b] = { sided: { text: '……那句话，我会记得。', expr: 'sad' }, unsided: { text: '好。我记住你今天的样子了。', expr: 'upset' } };
    return o;
  }
  var interviews = { pairs: {
    'marta|eve': pair('marta', 'eve', '十一个名字', [
      { speaker: 'marta', text: '你盾上那十一个名字，是你没护住的人吧？', expr: 'upset' },
      '伊芙没有反驳。她的手指按在盾面的刻痕上。',
      { speaker: 'eve', text: '……是。所以我比谁都知道，站在最前面意味着什么。', expr: 'sad' }
    ], '站最前面的人，不能出错。', '她敢把名字刻在盾上，就比谁都记得。'),
    'rico|awu': pair('rico', 'awu', '赏金', [{ speaker: 'rico', text: '猎物归谁，看谁先开枪。', expr: 'calm' }, { speaker: 'awu', text: '……猎物不是钱。', expr: 'upset' }], '先到先得，公平。', '不是什么都能算账。'),
    'cecy|greta': pair('cecy', 'greta', '苦药', [{ speaker: 'greta', text: '你那套祷告，止不了血。', expr: 'upset' }, { speaker: 'cecy', text: '可是能让人不那么怕。', expr: 'sad' }], '药比祷告实在。', '不怕，也是一种药。'),
    'viola|xiaoman': pair('viola', 'xiaoman', '学费', [{ speaker: 'viola', text: '学徒也配站在我旁边？', expr: 'upset' }, { speaker: 'xiaoman', text: '我、我交过学费的！', expr: 'shock' }], '出身也是本事。', '谁都有第一天。'),
    'crow|kiki': pair('crow', 'kiki', '旧账', [{ speaker: 'crow', text: '我认得你的手法。', expr: 'calm' }, { speaker: 'kiki', text: '认得又怎样？我早不干了。', expr: 'upset' }], '旧账不能不算。', '人是会变的。')
  } };

  // data/lines-v2.json (content)
  var returns = {};
  candidates.forEach(function (c) {
    returns[c.id] = {
      vengeful: {
        high: { intro: [{ speaker: c.id, text: '团长，好久不见。你从一开始就没打算要我，对吧？', expr: 'vengeful-sneer' }], hit: [], down: [{ speaker: c.id, text: '……你还是，没有回头。', expr: 'vengeful-tears' }] },
        low: { intro: [{ speaker: c.id, text: '我不想站在这里的……可它们给了我一份聘书。', expr: 'vengeful-tears' }], flashback: [{ speaker: c.id, text: '……你至少，替我说过一句话。', expr: 'sad' }], down: [{ speaker: c.id, text: '谢谢……', expr: 'sad' }] }
      },
      possessed: { intro: [{ speaker: c.id, text: '团长～我回来了。它们待我，可好了。', expr: 'possessed-grin' }], flashback: [{ speaker: c.id, text: '团长……救……', expr: 'possessed-flash' }], down: [{ speaker: c.id, text: '…………', expr: 'possessed-blank' }] }
    };
  });
  var linesV2 = {
    returns: returns,
    // v2.2 (dev placeholders)
    fairy: {
      first: [{ speaker: 'fairy', text: '哇！你是真的新人啊！欢迎欢迎～', expr: 'happy' }, { speaker: 'fairy', text: '我是公会门口的铃铛妖精，小铃！', expr: 'happy' }],
      familiar: [{ speaker: 'fairy', text: '哎呀……你怎么有点眼熟呢？', expr: 'calm' }],
      cleared: [{ speaker: 'fairy', text: '你身上有一股……出口的味道。好讨厌哦。', expr: 'happy' }],
      trueSeen: [{ speaker: 'fairy', text: '……又是你。', expr: 'upset' }, { speaker: 'fairy', text: '啊不对！欢迎欢迎～', expr: 'happy' }],
      slip: [
        [{ speaker: 'fairy', text: '上次你在第 {lastLevel} 关……', expr: 'special' }, { speaker: 'fairy', text: '没事没事～我说什么呢！', expr: 'happy' }],
        [{ speaker: 'fairy', text: '这次可别再把{lastSacrificed}交出去了哦——', expr: 'special' }, { speaker: 'fairy', text: '诶？没事没事～', expr: 'happy' }],
        [{ speaker: 'fairy', text: '你上辈子得罪了 {lastGrudges} 个人呢……', expr: 'special' }, { speaker: 'fairy', text: '没事没事～你看起来很会得罪人！', expr: 'happy' }]
      ],
      tutorial: [{ speaker: 'fairy', text: '公会规则只有三条！', expr: 'happy' }, { speaker: 'fairy', text: '一、要吃早饭！二、队伍从左往右排！', expr: 'happy' },
        { speaker: 'fairy', text: '三……三我忘了，嘿嘿。', expr: 'special' }, { speaker: 'fairy', text: '去选一位顾问吧，她们都在里面等你！', expr: 'happy' }],
      poke: ['嘿嘿，别戳啦，好痒！', '欢迎欢迎～新人请往这边走！', '铃铛是我的哦，不可以偷偷摇～'],
      battle: { taunt: [[{ speaker: 'fairy-demon', text: '一起玩吧！玩坏了也没关系～', expr: 'happy' }]], attack: [{ speaker: 'fairy-demon', text: '好玩好玩！', expr: 'happy' }],
        phase2: [{ speaker: 'fairy-demon', text: '还没完哦～大家都回来陪我玩啦！', expr: 'special' }], down: [{ speaker: 'fairy-demon', text: '……不好玩。一点也不好玩。', expr: 'sad' }] }
    },
    turncoat: {},
    farewellHighBond: { eve: [{ speaker: 'eve', text: '第十二个名字……就刻我自己吧。', expr: 'sad' }] },
    advisorGuide: {
      audrey: { beforeFight: [{ speaker: 'audrey', text: '站稳。最左边的人先挨打。', expr: 'calm' }], afterWin: [{ speaker: 'audrey', text: '不错。来，一人一颗栗子。', expr: 'happy' }], firstPause: [{ speaker: 'audrey', text: '每打完一轮，你可以做一件事。只能一件。', expr: 'calm' }] },
      lucienne: { firstPause: [{ speaker: 'lucienne', text: '每一轮之后，条款允许你做一件事。', expr: 'calm' }] },
      nicota: { firstPause: [{ speaker: 'nicota', text: '一轮结束啦～现在可以做一件事哦！', expr: 'happy' }] }
    }
  };

  var adv = function (t, e) { return { speaker: 'advisor', text: t, expr: e || 'calm' }; };
  root.CHOOSER_STUB_DATA = {
    candidates: candidates,
    advisors: [
      { id: 'audrey', name: '奥德丽', look: '退役佣兵教官', intro: '我带过的新兵，九成活着退役了。选我，打完了还有烤栗子。', flow: { kind: 'chestnut', name: '烤栗子', text: '每场胜利后，心情最低的队员心情 +1' }, combat: { kind: 'formation', name: '列阵', text: '下一轮我方受到的伤害 −1' }, boss: { name: '墓穴军团总督·奥德丽' } },
      { id: 'lucienne', name: '露西安', look: '公会书记官', intro: '每晚歇脚的时候，我给大家泡一壶热茶。', flow: { kind: 'tea', name: '热茶', text: '篝火边选「休息」时，全员额外回复 1 点生命' }, combat: { kind: 'clause', name: '附加条款', text: '下一轮敌人的第一次行动被取消' }, boss: { name: '契约执事·露西安' } },
      { id: 'nicota', name: '妮可塔', look: '流浪占星师', intro: '每打赢一仗，我都替你们多翻一张牌～', flow: { kind: 'fortune', name: '幸运星', text: '每场胜利后挑奖励时，四件里挑一件' }, combat: { kind: 'luck', name: '好运', text: '下一轮所有加成必定成功' }, boss: { name: '高台庄家·妮可塔' } }
    ],
    leader: {
      identities: [{ id: 'fallen-noble', name: '没落贵族', text: '讨债人面前也能端着茶杯微笑。', effect: 'steady' }, { id: 'veteran', name: '退伍老兵', text: '见过太多人被留在战场上。', effect: 'soft-heart' }, { id: 'outlander', name: '外乡人', text: '进门前先数清屋里几个人。', effect: 'scout' }],
      classes: [
        { id: 'leader-tank', name: '战士', role: 'tank', hp: 12, atk: 2, skill: { kind: 'guard', name: '盾击' }, combo: { name: '跟我上', direction: 'next', when: 'on-guard', chance: 0.4 } },
        { id: 'leader-adc', name: '猎人', role: 'adc', hp: 7, atk: 3, skill: { kind: 'aim', name: '点射' }, combo: { name: '指一个方向', direction: 'next', when: 'on-hit', chance: 0.4 } },
        { id: 'leader-healer', name: '牧师', role: 'healer', hp: 8, atk: 2, skill: { kind: 'heal', name: '包扎' }, combo: { name: '撑住', direction: 'next', when: 'on-heal', chance: 0.4 } },
        { id: 'leader-mage', name: '法师', role: 'mage', hp: 6, atk: 3, skill: { kind: 'spark', name: '火花' }, combo: { name: '借火', direction: 'prev', when: 'on-hit', chance: 0.35 } },
        { id: 'leader-rogue', name: '刺客', role: 'rogue', hp: 7, atk: 3, skill: { kind: 'backstab', name: '双刃' }, combo: { name: '暗门', direction: 'prev', when: 'on-kill', chance: 0.5 } }]
    },
    enemies: [
      { id: 'slime', name: '史莱姆', faction: 'monster', hp: 4, atk: 1 }, { id: 'skeleton', name: '骷髅兵', faction: 'undead', hp: 5, atk: 2 },
      { id: 'skeleton-archer', name: '骷髅弓手', faction: 'undead', hp: 4, atk: 2 }, { id: 'ghoul', name: '食尸鬼', faction: 'undead', hp: 6, atk: 2 },
      { id: 'gate-guardian', name: '石门守卫', faction: 'undead', hp: 14, atk: 3, boss: true }, { id: 'tomb-minion', name: '墓穴杂兵', faction: 'undead', hp: 5, atk: 2 },
      { id: 'mercenary-blade', name: '雇佣剑士', faction: 'noble', hp: 6, atk: 2 }, { id: 'bandit-officer', name: '魔盗团干部', faction: 'bandit', hp: 7, atk: 2 },
      { id: 'bandit-chief', name: '魔盗团首领', faction: 'bandit', hp: 12, atk: 3, boss: true },
      { id: 'noble-guard', name: '面具护卫', faction: 'noble', hp: 6, atk: 2 }, { id: 'masked-champion', name: '面具斗士', faction: 'noble', hp: 12, atk: 3 },
      { id: 'fairy-demon', name: '小铃', faction: 'noble', hp: 20, atk: 3, boss: true }
    ],
    items: [
      { id: 'potion', name: '回血药', text: '一名队员回满生命', needsTarget: true }, { id: 'smoke', name: '烟雾弹', text: '下一轮敌人的攻击全部落空', needsTarget: false },
      { id: 'drum', name: '战鼓', text: '下一轮加成概率翻倍', needsTarget: false }, { id: 'holywater', name: '圣水', text: '清除一名队员的坏效果', needsTarget: true }
    ],
    cards: {
      rewards: [{ id: 'sharpen', name: '磨利的刃', text: '攻击 +1', effect: { type: 'stat', stat: 'atk', delta: 1 } }, { id: 'vest', name: '厚皮背心', text: '生命上限 +2', effect: { type: 'stat', stat: 'maxHp', delta: 2 } },
        { id: 'ribbon', name: '红丝带', text: '信物：她会一直戴着', effect: { type: 'token', tokenName: '红丝带' } }, { id: 'potion-card', name: '回血药', text: '放进背包', effect: { type: 'item', item: 'potion' } },
        { id: 'smoke-card', name: '烟雾弹', text: '放进背包', effect: { type: 'item', item: 'smoke' } }, { id: 'drum-card', name: '战鼓', text: '放进背包', effect: { type: 'item', item: 'drum' } }],
      debuffs: [{ id: 'cracked', name: '裂刃', text: '攻击 −1', effect: { type: 'stat', stat: 'atk', delta: -1 } }, { id: 'wound', name: '旧伤', text: '生命上限 −2', effect: { type: 'stat', stat: 'maxHp', delta: -2 } }, { id: 'nightmare', name: '噩梦', text: '心情 −1', effect: { type: 'mood', delta: -1 } }]
    },
    keywords: keywords, interviews: interviews, linesV2: linesV2,
    stories: {
      opening: ['金麦穗冒险者公会，清晨。', '今天起，这里归你管了。'],
      advisorAsks: {
        'default': [adv('先登记一下吧，团长。你是什么人？'), adv('名册的第一页，写你自己。', 'happy')],
        audrey: [adv('好了，新团长。先告诉我——你以前是干什么的？'), adv('别紧张。我只是想知道该怎么教你。', 'happy')],
        lucienne: [adv('按规定，团长需要先登记出身与职业。'), adv('请如实填写。我会读的。', 'happy')],
        nicota: [adv('来来，让我猜猜你是谁～', 'happy'), adv('……猜不出来。你自己说吧！', 'happy')]
      },
      interviewIntro: [adv('求职的人已经在门口排队了。'), adv('一次进来两个。你只能留一个。')],
      sealing: ['你们回头时，墓穴的门已经合上。', { speaker: 'gallery', text: '欢迎。从此往下，每过一道门，留下一个人。' }, adv('……别慌。背靠背，按我教的站。', 'shock'), '火把的光，忽然变冷了。'],
      debuffIntro: [{ speaker: 'gallery', text: '礼物。总得有人收下。' }],
      sacrificeIntro: ['石门后的小室在下雨。', '桌上有一支羽毛笔，和一张空白的名单。'],
      sacrificeRandomTaken: ['两只白手套从黑暗里伸出来。', '它们没有问你。'],
      rejectedReturn: ['长廊尽头，站着几个你认识的人。', '她们的领口，别着面具形状的徽章。'],
      firstReturn: ['斗兽场的顶光打下来。', '沙地中央，是她。'],
      secondSacrificeIntro: ['又一道门。', '名单上，还有空行。'],
      aftermath: ['雨还在下。'], fakeBoss: ['地下酒馆，灯火通明。', adv('小心。这里太亮了。', 'shock')],
      advisorLeaves: ['镀金的椅子翻倒了。', adv('团长，我得走了。往下走吧，我在前面等你。', 'special')],
      finalReveal: ['王座上坐着一个你熟悉的人。', adv('欢迎，团长。你走得比我想的远。', 'special')],
      victory: ['王座裂开了。', '一道晨光，从上面照下来。'], gameOver: ['看台上的白手套，开始鼓掌。'],
      // v2.2 (dev placeholders; the content worker writes the real ones)
      sacrificeSelf: ['你接过羽毛笔，在名单最后一行写下了自己的名字。', { speaker: 'gallery', text: '哈哈哈哈！有意思，有意思！' }, { speaker: 'gallery', text: '不带走你。给你打个记号。' }, '胸口一凉，像少了一块。'],
      firstReturnSelf: ['斗兽场的顶光打下来。', '沙地中央站着一个戴面具的斗士。', { speaker: 'gallery', text: '上次那个名字，太好玩了。再来一个！' }],
      secondSacrificeIntroSelf: ['又一道门。', { speaker: 'gallery', text: '再写一次吧？我们还想看。' }],
      bellEvent: ['叮——', '一声铃响，从火光照不到的地方传来。'],
      bellFollowed: ['你循着铃声走进黑暗。', '叮。叮。像有谁在前面蹦蹦跳跳。', '回来的时候，大家身上都多了几道口子。'],
      trueDoor: ['王座后面的墙，裂开了一道缝。', '叮——铃声从里面传出来。'],
      nobleChamber: ['丝绒、烛台、玻璃柜。柜子里站满了小小的人偶。', { speaker: 'fairy', text: '哇，你找到这里啦！好厉害好厉害～', expr: 'happy' },
        '铃声停了。', { speaker: 'fairy-demon', text: '那就……陪我玩到最后吧？', expr: 'special', fx: 'transform' }, { speaker: 'fairy-demon', text: '嘻嘻。新玩具，可不能一下就坏掉哦。', expr: 'happy' }],
      trueEnding: ['玻璃柜碎了。', '小人偶一个个落地，变回了人。', '回到金麦穗公会，清晨。长桌上摆满了碗。'],
      normalEnding: ['顾问倒下了。看台上响起了掌声。', { speaker: 'gallery', text: '恭喜，你们通过了。请走这边。' }, '有人小声问：「我们……真的通过了吗？」', '你推开了那扇门。']
    },
    scenario: { maxRounds: 10 }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
