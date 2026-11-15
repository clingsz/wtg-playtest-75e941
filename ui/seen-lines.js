// 2026-11-15 老玩家快速开局 · 跳过已读: which dialogue lines this player has already seen (one localStorage key per ?profile=).
// Pure: a line's key is a hash of who says it + the text, so the same line is the same key in every run (any screen, any
// story). The set is bounded: past `max` keys the oldest are dropped. node: require it; browser: window.ChooserSeen.
(function (root) {
  var KEY = 'chooser.seen.v1', MAX = 4000;
  function hash(s) { // FNV-1a 32-bit, base36
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  // l: the dialogue contract object { speaker, speakerId, text, … } or a plain string (narration). null → no key.
  function lineKey(l) {
    if (l == null) return null;
    if (typeof l === 'string') l = { text: l };
    var text = String(l.text == null ? '' : l.text).trim();
    if (!text) return null;
    var who = String(l.speakerId || l.speaker || 'narrator');
    return hash(who + '|' + text) + text.length.toString(36);
  }
  // keys: an array (oldest first) as stored; returns a set { has, add, list, size }. add() returns true when the key is new.
  function create(keys, max) {
    var cap = max > 0 ? max : MAX, list = Array.isArray(keys) ? keys.filter(function (k) { return typeof k === 'string' && k; }) : [], idx = {};
    if (list.length > cap) list = list.slice(list.length - cap);
    list.forEach(function (k) { idx[k] = 1; });
    return {
      has: function (k) { return !!k && idx[k] === 1; },
      add: function (k) {
        if (!k || idx[k] === 1) return false;
        idx[k] = 1; list.push(k);
        while (list.length > cap) delete idx[list.shift()];
        return true;
      },
      list: function () { return list.slice(); },
      get size() { return list.length; }
    };
  }
  // A run of lines from position i: how many in a row are already seen (the fast-forward stops at the first unseen one).
  function seenRun(set, lines, i) {
    var n = 0;
    for (var j = i || 0; j < (lines || []).length; j++) { if (!set.has(lineKey(lines[j]))) break; n++; }
    return n;
  }
  // only a returning player (at least one finished run in the meta) gets the button
  function returning(meta) { return !!(meta && +meta.runs >= 1); }
  var ChooserSeen = { KEY: KEY, MAX: MAX, lineKey: lineKey, create: create, seenRun: seenRun, returning: returning };
  if (typeof module !== 'undefined' && module.exports) module.exports = ChooserSeen; else root.ChooserSeen = ChooserSeen;
})(typeof globalThis !== 'undefined' ? globalThis : this);
