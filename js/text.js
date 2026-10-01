// js/text.js — Loudleaf's pure text logic: sentences, speech cleanup, pronunciation dictionary.
// Every transform keeps a character map (spoken index → original index) so word highlighting
// stays exact even after text is rewritten for speech. No DOM, no chrome.* — runs in Node tests.

(function (root) {
  const MAX_CHUNK = 260; // shorter utterances keep remote voices from stalling and make skipping precise

  /** Split into sentences → [{ start, end }] offsets into `text` (trimmed, non-empty). */
  function sentences(text) {
    const out = [];
    const push = (s, e) => {
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e > s && /[\p{L}\p{N}]/u.test(text.slice(s, e))) out.push({ start: s, end: e });
    };
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: "sentence" });
      for (const s of seg.segment(text)) push(s.index, s.index + s.segment.length);
    } else {
      const re = /[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g;
      let m;
      while ((m = re.exec(text))) push(m.index, m.index + m[0].length);
    }
    // Keep citation markers with the sentence they belong to: "day.[3] Next" splits as
    // "day.[" + "3] Next" in some engines — move "[3]" back to the first sentence.
    for (let k = out.length - 2; k >= 0; k--) {
      const nxt = text.slice(out[k + 1].start, out[k + 1].end);
      const tail = text.slice(out[k].start, out[k].end);
      const m = /^[\d,\s–-]*\]|^\[[^\]]{1,24}\]/.exec(nxt);
      if (m && (/\[$/.test(tail) || /^\[/.test(nxt))) {
        let cut = out[k + 1].start + m[0].length;
        out[k].end = cut;
        while (cut < out[k + 1].end && /\s/.test(text[cut])) cut++;
        if (cut >= out[k + 1].end) out.splice(k + 1, 1);
        else out[k + 1].start = cut;
      }
    }
    // Break very long sentences at natural pauses so each utterance stays short.
    const final = [];
    for (const s of out) {
      let a = s.start;
      while (s.end - a > MAX_CHUNK) {
        const slice = text.slice(a, a + MAX_CHUNK);
        let cut = Math.max(slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" — "), slice.lastIndexOf(": "));
        if (cut < 80) cut = slice.lastIndexOf(" ");
        if (cut < 40) cut = MAX_CHUNK - 1;
        final.push({ start: a, end: a + cut + 1 });
        a = a + cut + 1;
        while (a < s.end && /\s/.test(text[a])) a++;
      }
      if (s.end > a) final.push({ start: a, end: s.end });
    }
    return final;
  }

  /** Apply ordered [regex, replacement] rules, tracking where each output char came from. */
  function rewrite(text, rules) {
    let cur = { text, map: Array.from({ length: text.length + 1 }, (_, i) => i) };
    for (const [re, rep] of rules) {
      let out = "";
      const map = [];
      let last = 0;
      re.lastIndex = 0;
      let m;
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      while ((m = g.exec(cur.text))) {
        if (m[0].length === 0) {
          g.lastIndex++;
          continue;
        }
        for (let i = last; i < m.index; i++) {
          out += cur.text[i];
          map.push(cur.map[i]);
        }
        const r = typeof rep === "function" ? rep(m) : rep;
        for (let i = 0; i < r.length; i++) {
          out += r[i];
          map.push(cur.map[m.index]); // replacement text points at the start of what it replaced
        }
        last = m.index + m[0].length;
      }
      for (let i = last; i < cur.text.length; i++) {
        out += cur.text[i];
        map.push(cur.map[i]);
      }
      map.push(cur.map[cur.text.length]);
      cur = { text: out, map };
    }
    return cur;
  }

  /**
   * Text as it should be spoken.
   * opts.smart (Pro): drop citation markers [12], [citation needed], (Smith, 2020)-style refs; read URLs as "link"
   * opts.dictionary: [{ from, to }] whole-word, case-insensitive pronunciation fixes
   */
  function forSpeech(text, opts = {}) {
    const rules = [[/\s+/g, " "]];
    if (opts.smart) {
      rules.push([/\[(\d+(?:[,–-]\s*\d+)*|citation needed|clarification needed|note \d+|[a-z])\]/gi, ""]);
      rules.push([/\bhttps?:\/\/\S+/gi, "link"]);
      rules.push([/\(\s*(?:[A-Z][\w.-]+(?: et al\.)?(?:,| and| &)?\s*)+\d{4}[a-z]?\s*\)/g, ""]);
    }
    for (const d of opts.dictionary || []) {
      const from = String(d.from || "").trim();
      if (!from) continue;
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rules.push([new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), String(d.to || "")]);
    }
    return rewrite(text, rules);
  }

  function words(text) {
    const m = String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    return m ? m.length : 0;
  }

  /** Minutes to listen at a rate (1.0 ≈ 180 words per minute for most voices). */
  function minutesFor(wordCount, rate = 1) {
    return wordCount / (180 * Math.max(0.1, rate));
  }

  /** Word at a spoken charIndex → { start, end } in spoken text (for highlighting). */
  function wordAt(spoken, i) {
    if (i < 0 || i >= spoken.length) return null;
    let s = i;
    while (s > 0 && /[\p{L}\p{N}'’-]/u.test(spoken[s - 1])) s--;
    let e = i;
    while (e < spoken.length && /[\p{L}\p{N}'’-]/u.test(spoken[e])) e++;
    return e > s ? { start: s, end: e } : null;
  }

  function fmtMinutes(min) {
    if (min < 1) return `${Math.max(1, Math.round(min * 60))} sec`;
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  const api = { sentences, rewrite, forSpeech, words, minutesFor, wordAt, fmtMinutes, MAX_CHUNK };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LoudleafText = api;
})(typeof self !== "undefined" ? self : this);
