(() => {
  'use strict';
  function locate(text, anchor) {
    const {quote, start, prefix = '', suffix = ''} = anchor;
    if (!quote) return null;
    const candidates = [];
    let at = text.indexOf(quote);
    while (at !== -1 && candidates.length < 2000) {
      const before = text.slice(Math.max(0, at - prefix.length), at);
      const after = text.slice(at + quote.length, at + quote.length + suffix.length);
      const score = (prefix && before === prefix ? 1 : 0) + (suffix && after === suffix ? 1 : 0);
      candidates.push({start: at, end: at + quote.length, score});
      at = text.indexOf(quote, at + 1);
    }
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0];
    const best = candidates.sort((a, b) => b.score - a.score);
    if (best[0].score > 0 && best[0].score > best[1].score) return best[0];
    // Ambiguous repeated passages must not silently receive the wrong highlight.
    return null;
  }
  globalThis.ReaderAnchors = {locate};
  if (typeof module !== 'undefined') module.exports = {locate};
})();
