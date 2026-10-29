/* Offline reply simplifier: short lines + highlighted key words. Port of backend/api/services/simplify.py.
 * Exposes window.SanketSimplify.simplifyText(text). */
(function (root) {
  "use strict";
  const STOP = new Set(`a an the and or but if then so of to in on at by for from with as is are was were be been being am do does did
    has have had it its this that these those you your we our they their he she his her i me my can could should would
    will may might also just very more most some any each other such than too into over under about after before
    which who whom whose what when where why how there here not no yes`.split(/\s+/));
  const SPLIT_AT = /(?<=[,;:])\s+|\s+(?=(?:and|but|because|which|while|so that|however|then)\s)/i;
  const trimChars = (s, chars) => { let a = 0, b = s.length; while (a < b && chars.includes(s[a])) a++; while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); };

  function stripMarkdown(t) {
    t = t.replace(/```[\s\S]*?```/g, " ");
    t = t.replace(/`([^`]*)`/g, "$1");
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    t = t.replace(/^\s{0,3}#{1,6}\s*/gm, "");
    t = t.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/gm, "");
    t = t.replace(/[*_~>|]+/g, "");
    t = t.replace(/\([^)]{0,80}\)/g, "");
    return t;
  }

  function chunks(sentence, maxWords) {
    const parts = sentence.split(SPLIT_AT).filter((p) => p && trimChars(p, " ,;:")).map((p) => trimChars(p, " ,;:"));
    const out = []; let cur = [];
    for (const part of parts) {
      const words = part.split(/\s+/).filter(Boolean);
      if (cur.length && cur.length + words.length > maxWords) { out.push(cur.join(" ")); cur = []; }
      cur.push(...words);
      while (cur.length > maxWords * 1.5) { out.push(cur.slice(0, maxWords).join(" ")); cur = cur.slice(maxWords); }
    }
    if (cur.length) out.push(cur.join(" "));
    return out;
  }

  function highlights(line, freq, limit = 2) {
    const scored = [];
    (line.match(/[\w'\u2019$%.:/-]+/g) || []).forEach((w, i) => {
      const bare = trimChars(w, ".,;:!?'\u2019"), low = bare.toLowerCase();
      if (!bare || STOP.has(low) || bare.length < 3) return;
      let score = (freq[low] || 0) * 0.5 + bare.length * 0.1;
      if (/\d/.test(bare)) score += 3;
      const c = bare[0];
      if (c === c.toUpperCase() && c !== c.toLowerCase() && i > 0) score += 2;
      scored.push([score, bare]);
    });
    scored.sort((a, b) => b[0] - a[0]);
    const seen = new Set(), out = [];
    for (const [, w] of scored) {
      if (!seen.has(w.toLowerCase())) { seen.add(w.toLowerCase()); out.push(w); }
      if (out.length === limit) break;
    }
    return out;
  }

  function simplifyText(text, maxWords = 10, maxLines = 12) {
    const clean = stripMarkdown(text);
    const sentences = clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    const freq = {};
    (clean.match(/[A-Za-z]{4,}/g) || []).forEach((w) => { const l = w.toLowerCase(); if (!STOP.has(l)) freq[l] = (freq[l] || 0) + 1; });
    const lines = [];
    for (const s of sentences) for (let chunk of chunks(s, maxWords)) {
      chunk = chunk.charAt(0).toUpperCase() + chunk.slice(1);
      lines.push({ text: chunk, highlights: highlights(chunk, freq) });
    }
    return { lines: lines.slice(0, maxLines), truncated: lines.length > maxLines, mode: "rules" };
  }

  root.SanketSimplify = { simplifyText };
})(typeof window !== "undefined" ? window : globalThis);
