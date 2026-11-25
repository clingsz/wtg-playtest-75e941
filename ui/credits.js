// 2026-11-14 真结局片尾 (docs/archive/SPEC-2026-11-13-batch6.md「追加：结局去英文 + 真结局片尾」). Pure parts, node-tested
// (tests/credits.test.cjs); app.js playCredits() only draws what these return.
//
//   cards(summary, run, data)  → one card per person of this run, in order: those who stayed → those handed over →
//                                those not chosen → the advisor → 小铃 → 团长. Each card: { id, name, kind, sub, art, past, lines }
//                                art  = { id, variant, expr }  her portrait in her FINAL state (true ending: back, smiling)
//                                past = { id, variant, expr } | null  a small round face of what she was in this run
//                                lines = 2–3 short sentences from this run (battles together, keepsakes, the sacrifice,
//                                        whose side you took …) + her line from lines-v2.json creditsEpilogue
//   staff(data)                → { title, rows: [{ role, names }], thanks, dawnCaption } (lines-v2.json credits; safe defaults)
//   plan(nCards, nRows, opts)  → the timeline: [{ kind: 'dawn'|'card'|'staff'|'thanks'|'white', i?, t, ms }], plus .total.
//                                opts.songMs (length of the ending song, if known) stretches the cards to fit it (within limits),
//                                the way the ailan credits lay their cards along the song. opts.reduced → short beats.
//   (opts.closing adds a 'closing' beat after the cards: the leader card's outro + CLOSING_LINE, a screen of its own)
//   pickHighlights / leaderThanks: see 片尾人物数据亮点 below
//   next(segs, t)              → the start time of the segment after the one playing at t (a click = jump there)
//
// Learnt from ailan (game/chapter3_credits.rpy): the credits are one plan computed up front from the song length (no
// drifting timer sums), they open out of white and close into white, nothing is written during the lead-in, the staff list
// lives in an editable data file, and there is always a way out (skip) so the scene can never hang.
(function (root) {
  'use strict';
  var ORDER = { survived: 0, sacrificed: 1, rejected: 2 };
  // i18n (docs/I18N.md): text from data/text/<locale>/ui.json, looked up when used (this file loads before the data)
  function tx(k, v) { var E = root.ChooserEngine, f = (E && E.t) || root.T || nodeT(); return f ? f(k, v) : k; }
  function nodeT() { try { return typeof module === 'object' && typeof require === 'function' ? require('../engine/engine.js').t : null; } catch (e) { return null; } }
  function num(n) { var CN = tx('ui.numerals').split(','); return n >= 0 && n < CN.length ? CN[n] : String(n); }
  function quote(list) { return list.map(function (x) { return '「' + x + '」'; }).join(''); }
  function epiLine(data, id) {
    var E = data && data.linesV2 && data.linesV2.creditsEpilogue;
    var t = E && typeof E[id] === 'string' ? E[id] : '';
    return t || '';
  }
  function fill(s, ctx) { return String(s || '').replace(/\{(\w+)\}/g, function (m, k) { return ctx[k] != null ? ctx[k] : ''; }); }
  function stat(run, id) { var s = run && run.stats && run.stats[id]; return s && typeof s === 'object' ? s : null; }
  function mem(run, id) { var m = run && run.memory && run.memory[id]; return m && typeof m === 'object' ? m : null; }
  function cap(lines) { return lines.filter(Boolean).slice(0, 3); }
  // 2026-11-14 修复「真结局直接进片尾」: the true ending no longer plays the per-person epilogue dialogue (summary.epilogue)
  // before the credits; what each person's epilogue said is folded into her card here, one paragraph, so nothing is lost.
  function said(lines) { return (Array.isArray(lines) ? lines : []).map(function (l) { return l && typeof l === 'object' ? l.text : l; }).filter(function (x) { return typeof x === 'string' && x; }).join(''); }
  function epiOf(summary, id) {
    var ep = summary && summary.epilogue; if (!ep || typeof ep !== 'object') return '';
    if (id === 'leader') return said(ep.leader);
    if (ep.advisor && ep.advisor.id === id) return said(ep.advisor.lines);
    var f = (ep.fates || []).filter(function (x) { return x && x.id === id; })[0];
    return f ? said(f.lines) : '';
  }

  // ---- 2026-11-14 片尾人物数据亮点 (SPEC「追加：片尾人物数据亮点 + 团长感谢」) ----
  // pickHighlights(stats, role, team) → her 3 brightest numbers this run: [{ key, n, text }], best first.
  //   stats = run.stats[id] (missing fields = 0) plus a few facts the card adds (interview round, first level on the other side …)
  //   role  = her skill kind (guard / aim / strike / backstab / heal / spark): her own kind of number counts extra
  //   team  = everyone's stats, so a number is weighed against the best of the party (a 23 that tops the team beats a 40 that does not)
  // Each text is one short line; the number is wrapped in **…** (app.js turns it bold).
  var B2 = function (n) { return '**' + n + '**'; };
  var HL = [ // key, base weight, the roles it suits, the line
    { k: 'damage', w: 0.6, r: ['aim', 'strike', 'spark', 'backstab'], t: function (n) { return tx('ui.credits.stat.damage', { n: n }); } },
    { k: 'combos', w: 0.7, r: ['backstab'], t: function (n, S) { return S.comboHits > n ? tx('ui.credits.stat.combosWithHits', { n: n, hits: S.comboHits }) : tx('ui.credits.stat.combos', { n: n }); } },
    { k: 'hits', w: 0.3, r: ['spark', 'backstab'], t: function (n) { return tx('ui.credits.stat.hits', { n: n }); } },
    { k: 'kills', w: 0.55, r: ['spark', 'strike', 'aim'], t: function (n) { return tx('ui.credits.stat.kills', { n: n }); } },
    { k: 'tripleKills', w: 0.9, r: ['spark'], t: function (n) { return tx('ui.credits.stat.tripleKills', { n: n }); } },
    { k: 'doubleKills', w: 0.6, r: ['spark'], t: function (n) { return tx('ui.credits.stat.doubleKills', { n: n }); } },
    { k: 'blocked', w: 0.65, r: ['guard'], t: function (n) { return tx('ui.credits.stat.blocked', { n: n }); } },
    { k: 'guards', w: 0.25, r: ['guard'], t: function (n) { return tx('ui.credits.stat.guards', { n: n }); } },
    { k: 'healed', w: 0.65, r: ['heal'], t: function (n) { return tx('ui.credits.stat.healed', { n: n }); } },
    { k: 'cleansed', w: 0.45, r: ['heal'], t: function (n) { return tx('ui.credits.stat.cleansed', { n: n }); } },
    { k: 'crits', w: 0.5, r: ['aim'], t: function (n) { return tx('ui.credits.stat.crits', { n: n }); } },
    { k: 'maxHit', w: 0.35, r: ['aim', 'strike'], t: function (n) { return tx('ui.credits.stat.maxHit', { n: n }); } },
    { k: 'chains', w: 0.35, r: [], t: function (n) { return tx('ui.credits.stat.chains', { n: n }); } },
    { k: 'standUps', w: 0.4, r: [], t: function (n) { return tx('ui.credits.stat.standUps', { n: n }); } },
    { k: 'battles', w: 0.15, r: [], t: function (n) { return tx('ui.credits.stat.battles', { n: n }); } },
    { k: 'foeBattles', w: 0.2, r: [], t: function (n) { return tx('ui.credits.stat.foeBattles', { n: n }); } },
    { k: 'foeDamage', w: 0.15, r: [], t: function (n) { return tx('ui.credits.stat.foeDamage', { n: n }); } },
    { k: 'foeKills', w: 0.15, r: [], t: function (n) { return tx('ui.credits.stat.foeKills', { n: n }); } },
    // facts the card adds from the summary (lowest weight: real fight numbers win)
    { k: 'sacrificedAt', w: 0.05, r: [], t: function (n) { return tx('ui.credits.stat.sacrificedAt', { n: n }); } },
    { k: 'foeFirst', w: 0.04, r: [], t: function (n) { return tx('ui.credits.stat.foeFirst', { n: n }); } },
    { k: 'round', w: 0.03, r: [], t: function (n) { return tx('ui.credits.stat.round', { n: n }); } }
  ];
  var TEAM_KEYS = { round: 1, sacrificedAt: 1, foeFirst: 1 }; // facts are not compared across the team
  function val(S, k) { var v = S && +S[k]; return isFinite(v) && v > 0 ? Math.floor(v) : 0; }
  function pickHighlights(stats, role, team) {
    var S = stats || {}, T = Array.isArray(team) ? team : [];
    var pool = [];
    HL.forEach(function (h, i) {
      var n = val(S, h.k); if (!n) return;
      if (h.k === 'hits' && val(S, 'combos')) return; // 连击 already carries how many blows
      var top = TEAM_KEYS[h.k] ? n : T.reduce(function (m, x) { return Math.max(m, val(x, h.k)); }, n);
      var score = h.w + n / top + (h.r.indexOf(role) >= 0 ? 1 : 0);
      pool.push({ key: h.k, n: n, text: h.t(n, S), score: Math.round(score * 1000) / 1000, i: i });
    });
    pool.sort(function (a, b) { return b.score - a.score || b.n - a.n || a.i - b.i; });
    return pool.slice(0, 3).map(function (x) { return { key: x.key, n: x.n, text: x.text, score: x.score }; });
  }
  function roleOf(run, data, id) {
    var m = run && run.members && run.members[id];
    if (m && m.skill && m.skill.kind) return m.skill.kind;
    var c = data && Array.isArray(data.candidates) ? data.candidates.filter(function (x) { return x && x.id === id; })[0] : null;
    return (c && c.skill && c.skill.kind) || (c && c.role) || '';
  }
  function teamOf(run) {
    var all = run && run.stats && typeof run.stats === 'object' ? run.stats : {};
    return Object.keys(all).map(function (k) { return all[k]; }).filter(function (x) { return x && typeof x === 'object'; });
  }
  function girlHighlights(f, run, data) {
    var S = Object.assign({}, stat(run, f.id) || {});
    if (f.round) S.round = f.round;
    if (f.fate === 'sacrificed' && f.sacrificedAt) S.sacrificedAt = f.sacrificedAt;
    if (f.enemyAt && f.enemyAt.length) S.foeFirst = Math.min.apply(null, f.enemyAt);
    return pickHighlights(S, roleOf(run, data, f.id), teamOf(run)).map(function (h) { return h.text; });
  }

  // 团长卡: thank-you lines built from her own choices this run (run.stats.leader: selfDebuffs, cheered, brave{…}),
  // 3–4 lines, warm and picked by the data; the credits close on CLOSING_LINE, a screen of its own after this card.
  function closingLine() { return tx('ui.credits.closing'); }
  function pickV(list, seed) { return list[Math.abs(seed | 0) % list.length]; }
  function leaderThanks(ls, ctx) {
    var L = ls || {}, c = ctx || {}, out = [];
    var self = val(L, 'selfDebuffs'), cheer = val(L, 'cheered'), br = L.brave && typeof L.brave === 'object' ? L.brave : {};
    var guard = val(br, 'guard'), acts = [];
    if (val(br, 'refuse')) acts.push(tx('ui.credits.leader.act.refuse'));
    if (val(br, 'rules')) acts.push(tx('ui.credits.leader.act.rules'));
    if (val(br, 'self')) acts.push(tx('ui.credits.leader.act.self'));
    if (val(br, 'bell')) acts.push(tx('ui.credits.leader.act.bell'));
    var brave = ['refuse', 'rules', 'self', 'bell', 'guard'].reduce(function (s, k) { return s + val(br, k); }, 0);
    var home = c.home | 0, back = c.back | 0, seed = self * 7 + cheer * 3 + brave;
    out.push(pickV([tx('ui.credits.leader.open1'), tx('ui.credits.leader.open2'), tx('ui.credits.leader.open3')], seed));
    var rows = [];
    if (self) rows.push({ s: 3 + self, t: pickV([tx('ui.credits.leader.selfDebuffs1', { n: self }), tx('ui.credits.leader.selfDebuffs2', { n: self })], seed) });
    if (cheer) rows.push({ s: 2 + Math.min(cheer, 20) / 10, t: pickV([tx('ui.credits.leader.cheered1', { n: cheer }), tx('ui.credits.leader.cheered2', { n: cheer })], seed + 1) });
    if (brave) {
      var tail = acts.slice(0, 3).join(tx('ui.list.sep'));
      var gl = guard ? tx('ui.credits.leader.braveGuard', { n: guard }) : '';
      var detail = tail && gl ? tx('ui.credits.leader.braveDetailBoth', { acts: tail, guard: gl }) : tail || gl;
      rows.push({ s: 2.5, t: detail ? tx('ui.credits.leader.braveWith', { n: brave, detail: detail }) : tx('ui.credits.leader.brave', { n: brave }) });
    }
    if (home) rows.push({ s: 4, t: back ? tx('ui.credits.leader.homeAndBack', { n: home, back: back }) : tx('ui.credits.leader.home', { n: home }) });
    rows.sort(function (a, b) { return b.s - a.s; });
    return out.concat(rows.slice(0, 3).map(function (x) { return x.t; }));
  }

  function girlCard(f, run, data, restored, told) {
    var st = stat(run, f.id), m = mem(run, f.id), n = st && st.battles > 0 ? st.battles : 0, L = [];
    var fate = f.fate, tokens = (f.tokens || []).filter(Boolean);
    var gifts = m && Array.isArray(m.cards) ? m.cards.filter(function (c) { return c && c.reward && c.name; }).map(function (c) { return c.name; }) : [];
    var marks = m && Array.isArray(m.cards) ? m.cards.filter(function (c) { return c && !c.reward && c.name; }).map(function (c) { return c.name; }) : [];
    if (fate === 'survived') {
      L.push(n ? tx('ui.credits.girl.survivedFought', { battles: num(n) }) : tx('ui.credits.girl.survived'));
    } else if (fate === 'sacrificed') {
      var how = f.mode === 'random' ? 'ui.credits.girl.takenByRule' : 'ui.credits.girl.namedByYou';
      L.push((n ? tx('ui.credits.girl.foughtWith', { battles: num(n) }) : '') + (f.sacrificedAt ? tx(how + 'At', { level: f.sacrificedAt }) : tx(how)));
    } else if (fate === 'rejected') {
      var why = m && m.sidedFor ? 'ui.credits.girl.notKept' : 'ui.credits.girl.notChosen';
      L.push(f.round ? tx(why + 'AtRound', { round: f.round }) : tx(why));
    }
    if ((fate === 'sacrificed' || fate === 'rejected') && f.enemyAt && f.enemyAt.length) L.push(tx('ui.credits.girl.enemyAt', { levels: f.enemyAt.join(tx('ui.list.sep')) }));
    else if (tokens.length) L.push(tx('ui.credits.girl.tokens', { items: quote(tokens.slice(0, 2)) }));
    else if (gifts.length) L.push(tx('ui.credits.girl.gifts', { items: quote(gifts.slice(0, 2)) }));
    else if (marks.length) L.push(tx('ui.credits.girl.marks', { items: quote(marks.slice(0, 1)) }));
    var e = told || epiLine(data, f.id); // her epilogue paragraph (true ending) or her general creditsEpilogue line
    if (L.length >= 2 && e) L = [L[0], L[1], e]; else if (e) L.push(e);
    if (!L.length) L.push(tx('ui.credits.girl.untold'));
    var corrupt = fate === 'sacrificed' ? 'possessed' : fate === 'rejected' ? 'vengeful' : null;
    var art = restored || !corrupt ? { id: f.id, variant: 'base', expr: 'happy' } : { id: f.id, variant: corrupt, expr: corrupt === 'possessed' ? 'possessed-blank' : 'vengeful-tears' };
    var past = restored && corrupt ? { id: f.id, variant: corrupt, expr: corrupt === 'possessed' ? 'possessed-blank' : 'vengeful-tears' } : null;
    var sub = tx(fate === 'survived' ? 'ui.credits.sub.survived' : fate === 'sacrificed' ? (restored ? 'ui.credits.sub.sacrificedBack' : 'ui.credits.sub.sacrificed') : (restored ? 'ui.credits.sub.rejectedBack' : 'ui.credits.sub.rejected'));
    var lines = cap(L);
    return { id: f.id, name: f.name || f.id, kind: fate, sub: sub, art: art, past: past, lines: lines, stats: girlHighlights(f, run, data), tail: e || lines[lines.length - 1] };
  }

  function cards(summary, run, data) {
    var s = summary || {}, out = [];
    var restored = (s.trueEnding && Array.isArray(s.trueEnding.restored)) ? s.trueEnding.restored : [];
    var trueEnd = s.outcome === 'true';
    (s.fates || []).filter(function (f) { return f && f.id && ORDER[f.fate] != null; })
      .map(function (f, i) { return { f: f, i: i }; })
      .sort(function (a, b) { return ORDER[a.f.fate] - ORDER[b.f.fate] || a.i - b.i; })
      .forEach(function (x) { out.push(girlCard(x.f, run, data, trueEnd || restored.indexOf(x.f.id) >= 0, trueEnd ? epiOf(s, x.f.id) : '')); });
    var a = s.advisor;
    if (a && a.id) {
      var AL = [tx(a.defeated ? 'ui.credits.advisor.defeated' : 'ui.credits.advisor.welcome')];
      var ae = (trueEnd && epiOf(s, a.id)) || epiLine(data, a.id); if (ae) AL.push(ae);
      out.push({ id: a.id, name: a.name || a.id, kind: 'advisor', sub: tx('ui.credits.advisor.sub'), art: { id: a.id, variant: a.defeated ? 'boss' : 'base', expr: 'calm' }, past: null, lines: cap(AL) });
    }
    var keys = run && run.keys != null ? run.keys : s.keys, nk = Array.isArray(keys) ? keys.length : keys && typeof keys === 'object' ? Object.keys(keys).filter(function (k) { return keys[k] === true && k !== 'self'; }).length : +keys || 0;
    var FL = [tx(trueEnd ? 'ui.credits.fairy.trueEnd' : 'ui.credits.fairy.missed')];
    if (trueEnd && nk) FL.push(tx('ui.credits.fairy.keys', { n: num(nk) }));
    var fe = epiLine(data, 'fairy'); if (fe) FL.push(fe);
    out.push({ id: 'fairy', name: tx('ui.credits.fairy.name'), kind: 'fairy', sub: tx('ui.credits.fairy.sub'), art: { id: 'fairy', variant: 'base', expr: 'happy' }, past: trueEnd ? { id: 'fairy-demon', variant: 'base', expr: 'calm' } : null, lines: cap(FL) });
    var ls = stat(run, 'leader'), lb = ls && ls.battles > 0 ? ls.battles : 0, lname = (run && run.leaderName) || tx('ui.credits.leader.defaultName');
    var LL = [lb ? tx('ui.credits.leader.fought', { battles: num(lb) }) : tx('ui.credits.leader.came')];
    var lt = trueEnd ? epiOf(s, 'leader') : '', le = epiLine(data, 'leader');
    if (lt) LL.push(fill(lt, { leader: lname })); else if (le) LL.push(fill(le, { leader: lname }));
    var outro = trueEnd ? said(s.epilogue && s.epilogue.outro) : ''; if (outro) LL.push(outro); // the epilogue's last line closes the last card
    var home = (s.fates || []).filter(function (f) { return f && f.fate === 'survived'; }).length;
    var back = trueEnd ? (s.fates || []).filter(function (f) { return f && (f.fate === 'sacrificed' || f.fate === 'rejected'); }).length : 0;
    out.push({ id: 'leader', name: lname, kind: 'leader', sub: tx('ui.credits.leader.sub'), art: { id: 'leader', variant: 'base', expr: 'happy' }, past: null, lines: cap(LL),
      stats: leaderThanks(ls, { home: home, back: back }), tail: lt ? fill(lt, { leader: lname }) : le ? fill(le, { leader: lname }) : '', outro: outro, closing: closingLine() });
    return out;
  }

  function staffDefault() {
    return { title: tx('ui.credits.staff.title'), rows: [{ role: tx('ui.credits.staff.planning'), names: ['Alpico'] }, { role: tx('ui.credits.staff.writing'), names: ['Alpico'] }, { role: tx('ui.credits.staff.art'), names: ['Alpico'] },
      { role: tx('ui.credits.staff.music'), names: ['Alpico'] /* 2026-11-24 用户「片尾曲不是《写下你的名字》」: no song title (the ending plays the dawn track) */ }, { role: tx('ui.credits.staff.code'), names: ['Alpico'] }], thanks: tx('ui.credits.staff.thanks'), dawnCaption: tx('ui.credits.staff.dawnCaption') };
  }
  function staff(data) {
    var c = data && data.linesV2 && data.linesV2.credits, STAFF_DEFAULT = staffDefault();
    if (!c || typeof c !== 'object') return STAFF_DEFAULT;
    var rows = (Array.isArray(c.staff) ? c.staff : []).filter(function (r) { return r && r.role; })
      .map(function (r) { return { role: String(r.role), names: (Array.isArray(r.names) ? r.names : r.name ? [r.name] : []).map(String) }; });
    return { title: c.title || STAFF_DEFAULT.title, rows: rows.length ? rows : STAFF_DEFAULT.rows, thanks: c.thanks || STAFF_DEFAULT.thanks, dawnCaption: c.dawnCaption != null ? c.dawnCaption : STAFF_DEFAULT.dawnCaption };
  }

  // 2026-11-24 用户「最后的字幕太快了——尤其是团长的，还没看清楚就结束了」: slower cards (old card 6000 / min 4500 / max 9000, closing 5500), the leader card ×LEADER_X
  var T = { dawn: 6500, card: 8000, cardMin: 6500, cardMax: 11000, staffBase: 4000, staffRow: 1100, thanks: 4000, white: 1600, closing: 7500, leaderX: 1.8 };
  function plan(nCards, nRows, opts) {
    var o = opts || {}, k = o.reduced ? 0.15 : 1, n = Math.max(0, nCards | 0), r = Math.max(0, nRows | 0);
    var staffMs = T.staffBase + T.staffRow * r, card = T.card;
    var song = +o.songMs;
    if (isFinite(song) && song > 0 && n) { // lay the cards along the song: what the dawn / staff / thanks leave over, shared out
      var left = song - T.dawn - staffMs - T.thanks - (o.closing ? T.closing : 0);
      card = Math.max(T.cardMin, Math.min(T.cardMax, Math.floor(left / (n + (o.leaderIdx >= 0 ? T.leaderX - 1 : 0))))); // the leader's longer card counts in the share
    }
    var segs = [], t = 0;
    function add(kind, ms, i) { var s = { kind: kind, t: t, ms: Math.max(1, Math.round(ms * k)) }; if (i != null) s.i = i; segs.push(s); t += s.ms; }
    add('dawn', T.dawn);
    for (var i = 0; i < n; i++) add('card', i === o.leaderIdx ? card * T.leaderX : card, i); // the leader's card has the most to read
    if (o.closing) add('closing', T.closing); // 2026-11-14: 团长卡之后，单独一屏的收尾句
    add('staff', staffMs);
    add('thanks', T.thanks);
    add('white', T.white);
    segs.total = t;
    return segs;
  }
  function at(segs, t) { for (var i = segs.length - 1; i >= 0; i--) if (t >= segs[i].t) return i; return 0; }
  function next(segs, t) { var i = at(segs, t); return i + 1 < segs.length ? segs[i + 1].t : segs.total; }
  var HOLD_MS = 800; // a long press (or a held key) this long skips the whole credits

  var API = { pickHighlights: pickHighlights, leaderThanks: leaderThanks, cards: cards, staff: staff, plan: plan, at: at, next: next, HOLD_MS: HOLD_MS, TIMING: T };
  Object.defineProperty(API, 'CLOSING_LINE', { enumerable: true, get: closingLine }); // looked up when read (locale may change)
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.ChooserCredits = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
