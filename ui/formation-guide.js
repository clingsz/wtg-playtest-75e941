// Formation guide (docs/archive/DESIGN-2026-11-14-formation-guide.md): the first time the player reaches the formation
// screen, the advisor asks whether to explain it; on yes, a few small diagram + one-sentence pages.
// Self-contained: renders its own overlay inside #stage (stage px), never touches #modal or app.js state.
// Every visible word comes from data/text/<locale>/ui.json via t() (keys ui.fguide.*); diagrams are inline SVG.
(function (root) {
  'use strict';
  var SEEN = 'fguideSeen';
  var PAGES = ['p1', 'p2', 'p3']; // order / who gets hit / neighbours
  var ADVISORS = ['audrey', 'lucienne', 'nicota']; // voiced variants (a missing variant falls back to the plain key)

  // ---------- text ----------
  function defT() {
    var A = root.CHOOSER_ASSETS;
    if (A && A.t) return A.t;
    if (typeof root.T === 'function') return root.T;
    return function (k) { return k; };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // t() returns the key itself when the text is missing (engine t()): try the advisor's voice first, then the plain key
  function say(t, key, adv) {
    var full = 'ui.fguide.' + key;
    if (adv) { var v = t(full + '.' + adv); if (v != null && v !== full + '.' + adv) return v; }
    return t(full);
  }
  function L(t, key, vars) { return t('ui.fguide.' + key, vars); }

  // every key the guide can read for this advisor (tests check each one exists)
  function keys(adv) {
    var out = ['ask', 'yes', 'no', 'prev', 'next', 'done', 'close', 'page', 'menu',
      'lbl.us', 'lbl.foe', 'lbl.first', 'lbl.then', 'lbl.tough', 'lbl.random', 'lbl.chain', 'lbl.cover'];
    PAGES.forEach(function (p) { out.push(p + '.title', p + '.say'); });
    if (adv) { out.push('ask.' + adv); PAGES.forEach(function (p) { out.push(p + '.say.' + adv); }); }
    return out;
  }

  // ---------- diagrams (viewBox 960 x 420, drawn 1:1 in stage px) ----------
  var SX = function (i) { return 200 + 160 * i; }; // slot centre x, i = 0..4
  var AY = 280; // ally row centre y
  function defs() {
    return '<defs><marker id="fg-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0 0L10 5L0 10z" class="fg-ahead"/></marker>' +
      // the same gold medal as the prep screen's slot-order badge (.lane-prep .order-no)
      '<radialGradient id="fg-ord" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff3cc"/><stop offset=".6" stop-color="#e2b768"/><stop offset="1" stop-color="#a07a46"/></radialGradient></defs>';
  }
  function slot(i, cls) {
    var x = SX(i);
    return '<g class="fg-slot' + (cls ? ' ' + cls : '') + '"><rect x="' + (x - 60) + '" y="' + (AY - 50) + '" width="120" height="100" rx="14"/>' +
      '<circle cx="' + x + '" cy="' + AY + '" r="26"/><text class="fg-num" x="' + x + '" y="' + (AY + 9) + '">' + (i + 1) + '</text></g>';
  }
  function slots(mark) { var s = ''; for (var i = 0; i < 5; i++) s += slot(i, mark && mark[i]); return s; }
  // an enemy: a plain blob with two eyes; an archer carries a bow arc
  function foe(x, archer) {
    var y = 90;
    return '<g class="fg-foe' + (archer ? ' archer' : '') + '"><path d="M' + (x - 44) + ' ' + (y + 46) + 'Q' + (x - 50) + ' ' + (y - 46) + ' ' + x + ' ' + (y - 48) + 'Q' + (x + 50) + ' ' + (y - 46) + ' ' + (x + 44) + ' ' + (y + 46) + 'z"/>' +
      '<circle class="fg-eye" cx="' + (x - 14) + '" cy="' + (y - 6) + '" r="6"/><circle class="fg-eye" cx="' + (x + 14) + '" cy="' + (y - 6) + '" r="6"/>' +
      (archer ? '<path class="fg-bow" d="M' + (x + 52) + ' ' + (y - 40) + 'Q' + (x + 84) + ' ' + y + ' ' + (x + 52) + ' ' + (y + 40) + '"/><line class="fg-bow" x1="' + (x + 52) + '" y1="' + (y - 40) + '" x2="' + (x + 52) + '" y2="' + (y + 40) + '"/>' : '') + '</g>';
  }
  function arrow(d, dashed) { return '<path class="fg-arrow' + (dashed ? ' dashed' : '') + '" d="' + d + '" marker-end="url(#fg-ah)"/>'; }
  function label(x, y, s, cls) { return '<text class="fg-lbl' + (cls ? ' ' + cls : '') + '" x="' + x + '" y="' + y + '">' + esc(s) + '</text>'; }
  function shield(x, y) { return '<path class="fg-shield" d="M' + x + ' ' + (y - 22) + 'L' + (x + 20) + ' ' + (y - 14) + 'L' + (x + 18) + ' ' + (y + 6) + 'Q' + (x + 12) + ' ' + (y + 18) + ' ' + x + ' ' + (y + 24) + 'Q' + (x - 12) + ' ' + (y + 18) + ' ' + (x - 18) + ' ' + (y + 6) + 'L' + (x - 20) + ' ' + (y - 14) + 'z"/>'; }
  function sides(t) { return label(56, 98, L(t, 'lbl.foe'), 'side') + label(56, AY + 8, L(t, 'lbl.us'), 'side'); }
  function svg(body) { return '<svg class="fg-svg" viewBox="0 0 960 420" width="960" height="420" aria-hidden="true">' + defs() + body + '</svg>'; }

  var DIAGRAM = {
    // ① → ⑤ first, then the enemies
    p1: function (t) {
      return svg(sides(t) + foe(280) + foe(520) + foe(760, true) + slots() +
        arrow('M150 372H860') + label(505, 410, L(t, 'lbl.first'), 'step') +
        arrow('M230 176H800') + label(515, 168, L(t, 'lbl.then'), 'step dim'));
    },
    // most blows fall on ①; archers pick at random
    p2: function (t) {
      return svg(sides(t) + foe(280) + foe(520) + foe(760, true) + slots(['hot']) +
        arrow('M268 146L214 222') + arrow('M500 146L236 226') + arrow('M752 146L688 222', true) +
        label(800, 196, L(t, 'lbl.random'), 'note') + shield(SX(0) + 46, AY - 46) + label(SX(0), 372, L(t, 'lbl.tough'), 'note gold'));
    },
    // neighbours: a guard's shield covers the one behind her; a combo pulls the one beside her in
    p3: function (t) {
      return svg(label(56, AY + 8, L(t, 'lbl.us'), 'side') + slots(['hot', 'cov']) +
        '<rect class="fg-dome" x="' + (SX(0) - 74) + '" y="' + (AY - 66) + '" width="' + (SX(1) - SX(0) + 148) + '" height="132" rx="30"/>' +
        shield(SX(0) + 46, AY - 46) + label((SX(0) + SX(1)) / 2, AY - 86, L(t, 'lbl.cover'), 'note gold') +
        arrow('M' + SX(2) + ' ' + (AY - 56) + 'Q' + (SX(2) + 80) + ' ' + (AY - 150) + ' ' + (SX(3) - 8) + ' ' + (AY - 58)) +
        label(SX(2) + 80, AY - 128, L(t, 'lbl.chain'), 'note'));
    }
  };

  // ---------- html ----------
  function faceHtml(o) {
    var f = o.face;
    if (!f && o.advisor && o.advisor.id && root.CHOOSER_ASSETS && root.CHOOSER_ASSETS.face) {
      try { f = root.CHOOSER_ASSETS.face(o.advisor.id, 'calm'); } catch (e) { f = null; }
    }
    if (Array.isArray(f)) f = f[0];
    return f ? '<span class="fg-face"><img src="' + esc(f) + '" alt="" onerror="this.style.visibility=\'hidden\'"></span>' : '';
  }
  function head(o) {
    var name = o.advisor && o.advisor.name;
    return '<div class="fg-head">' + faceHtml(o) + (name ? '<b class="fg-name">' + esc(name) + '</b>' : '') +
      '<button class="fg-x" data-fg="close" aria-label="' + esc(L(o.t, 'close')) + '">✕</button></div>';
  }
  function advId(o) { return o.advisor && o.advisor.id; }
  function askHtml(o) {
    var t = o.t || defT();
    o = Object.assign({}, o, { t: t });
    return '<div class="fg-card fg-ask" role="dialog" aria-modal="true">' + head(o) +
      '<p class="fg-say">' + esc(say(t, 'ask', advId(o))) + '</p>' +
      '<div class="fg-btns"><button class="btn btn-secondary fg-btn" data-fg="no">' + esc(L(t, 'no')) + '</button>' +
      '<button class="btn btn-primary fg-btn" data-fg="yes">' + esc(L(t, 'yes')) + '</button></div></div>';
  }
  function pageHtml(i, o) {
    var t = o.t || defT(), p = PAGES[i], last = i === PAGES.length - 1;
    o = Object.assign({}, o, { t: t });
    return '<div class="fg-card fg-page" role="dialog" aria-modal="true" data-page="' + (i + 1) + '">' + head(o) +
      '<h3 class="fg-title">' + esc(L(t, p + '.title')) + '<small>' + esc(L(t, 'page', { i: i + 1, n: PAGES.length })) + '</small></h3>' +
      '<div class="fg-fig">' + DIAGRAM[p](t) + '</div>' +
      '<p class="fg-say">' + esc(say(t, p + '.say', advId(o))) + '</p>' +
      '<div class="fg-btns">' + (i > 0 ? '<button class="btn btn-secondary fg-btn" data-fg="prev">' + esc(L(t, 'prev')) + '</button>' : '<span></span>') +
      '<button class="btn btn-primary fg-btn" data-fg="' + (last ? 'done' : 'next') + '">' + esc(L(t, last ? 'done' : 'next')) + '</button></div></div>';
  }

  // ---------- seen flag (player prefs, not per run) ----------
  function shouldShow(prefs) { return !(prefs && prefs[SEEN]); }
  function markSeen(prefs, save) {
    if (!prefs) return;
    prefs[SEEN] = true;
    if (typeof save === 'function') { try { save(prefs); } catch (e) { /* storage full: the guide shows again, harmless */ } }
  }

  // ---------- overlay ----------
  var cur = null; // { el, o, page, resolve, promise, onKey }
  function paint() {
    if (!cur) return;
    cur.el.innerHTML = cur.page < 0 ? askHtml(cur.o) : pageHtml(cur.page, cur.o);
    var b = cur.el.querySelector('.btn-primary');
    if (b && b.focus) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  function finish(result) {
    if (!cur) return;
    var c = cur; cur = null;
    if (c.onKey) root.document.removeEventListener('keydown', c.onKey, true);
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    markSeen(c.o.prefs, c.o.save);
    c.resolve(result);
  }
  function act(what) {
    if (!cur) return;
    if (what === 'yes') { cur.page = 0; paint(); }
    else if (what === 'no') finish('skipped');
    else if (what === 'close') finish(cur.page < 0 ? 'skipped' : 'closed');
    else if (what === 'next' && cur.page < PAGES.length - 1) { cur.page += 1; paint(); }
    else if (what === 'prev' && cur.page > 0) { cur.page -= 1; paint(); }
    else if (what === 'done') finish('explained');
  }
  // opts: { advisor: {id, name}, prefs, save(prefs), t(key, vars), host, face, ask (default true) }
  // → Promise<'explained' | 'skipped' | 'closed'>; any ending marks the guide seen (when prefs is given)
  function open(opts) {
    if (cur) return cur.promise;
    var o = Object.assign({}, opts || {});
    o.t = o.t || defT();
    var doc = root.document;
    if (!doc) return Promise.resolve('closed');
    var host = o.host || doc.getElementById('stage') || doc.body;
    var el = doc.createElement('div');
    el.className = 'fg-ov';
    var resolve, promise = new Promise(function (r) { resolve = r; });
    cur = { el: el, o: o, page: o.ask === false ? 0 : -1, resolve: resolve, promise: promise };
    el.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-fg]') : null;
      e.stopPropagation();
      if (b) act(b.getAttribute('data-fg'));
    });
    cur.onKey = function (e) {
      if (!cur) return;
      var k = e.key;
      if (k === 'Escape') act('close');
      else if (k === 'ArrowRight' && cur.page >= 0) act(cur.page === PAGES.length - 1 ? 'done' : 'next');
      else if (k === 'ArrowLeft' && cur.page > 0) act('prev');
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    doc.addEventListener('keydown', cur.onKey, true);
    host.appendChild(el);
    paint();
    return promise;
  }
  function close() { if (cur) finish('closed'); }

  var API = {
    SEEN_KEY: SEEN, PAGES: PAGES.slice(), ADVISORS: ADVISORS.slice(),
    shouldShow: shouldShow, markSeen: markSeen, open: open, close: close,
    isOpen: function () { return !!cur; }, pageCount: function () { return PAGES.length; },
    keys: keys, askHtml: askHtml, pageHtml: pageHtml
  };
  root.CHOOSER_FGUIDE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
