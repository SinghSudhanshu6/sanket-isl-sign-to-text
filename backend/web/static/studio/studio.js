/* Sanket STUDIO extras (localhost only): teach signs, measure accuracy, export the sign pack.
 * Loaded by /demo/ after extension/lib/app.js. This file is NOT part of the browser extension. */
(function () {
  "use strict";
  const P = window.SanketPanel;
  if (!P) return;
  const { h, card, setMsg, api, clf, S } = P;
  const FEATURE = P.C.FEATURE_DIM;

  // ---------------------------------------------------------- teach
  const teachLabel = h("input", { class: "sk-input", list: "sk-vocab", placeholder: "Sign label, e.g. HOSPITAL" });
  const teachSigner = h("input", { class: "sk-input", placeholder: "Signer name (needed for held-out testing)" });
  const teachBtn = h("button", { class: "sk-btn primary", onclick: teachSign }, "Record 30 samples");
  const teachMsg = h("div", { class: "sk-msg" }), counts = h("div", { class: "sk-muted", style: "margin-top:6px" });
  const teachCard = card("Studio · Teach a sign",
    h("div", { class: "sk-grid", style: "grid-template-columns:1fr" }, teachLabel, teachSigner),
    h("div", { class: "sk-row" }, teachBtn), teachMsg, counts);

  function renderCounts() {
    const c = clf.counts(), keys = Object.keys(c).sort();
    counts.textContent = keys.length ? `Taught ${keys.length} signs: ` + keys.map((k) => `${k} (${c[k]})`).join(", ") : "Nothing taught yet.";
  }

  async function teachSign() {
    const label = teachLabel.value.trim().toUpperCase().replace(/\s+/g, "-");
    if (!/^[A-Z0-9-]{1,40}$/.test(label)) { setMsg(teachMsg, "Enter a label (letters, digits, dashes).", true); return; }
    if (!S.tracker) { setMsg(teachMsg, "Start the camera first.", true); return; }
    teachBtn.disabled = true;
    for (let n = 3; n > 0; n--) { setMsg(teachMsg, `Get ready... ${n}`); await new Promise((r) => setTimeout(r, 1000)); }
    const N = 30, samples = [];
    await new Promise((resolve) => {
      S.collecting = { samples, tick: (c) => { setMsg(teachMsg, `Recording ${c}/${N} - hold the sign, move slightly`); if (c >= N) resolve(); } };
      setTimeout(resolve, 15000); // give up if no hand appears
    });
    S.collecting = null; teachBtn.disabled = false;
    if (samples.length < 10) { setMsg(teachMsg, "Hand not seen long enough - try again.", true); return; }
    try {
      await api._req("/api/teach/", "POST", { label, samples, signer: teachSigner.value.trim() });
      clf.add(label, samples); renderCounts();
      setMsg(teachMsg, `Saved ${samples.length} samples for ${label}. Record from a few angles and a few people.`);
    } catch (e) { setMsg(teachMsg, "Could not save: " + e.message, true); }
  }

  // ---------------------------------------------------------- measure
  const mExpected = h("input", { class: "sk-input", placeholder: "Intended glosses, e.g. TODAY WEATHER WHAT" });
  const mTyped = h("input", { class: "sk-input", type: "number", step: "0.1", placeholder: "Seconds to type the same request (optional)" });
  const mHeld = h("input", { type: "checkbox" }), mMsg = h("div", { class: "sk-msg" });
  const measureCard = card("Studio · Measure (Round 2 numbers)",
    h("div", { class: "sk-grid", style: "grid-template-columns:1fr" }, mExpected, mTyped,
      h("label", { style: "display:flex;gap:6px;align-items:center" }, mHeld, "Signer is NOT in the training data")),
    h("div", { class: "sk-row" }, h("button", { class: "sk-btn small primary", onclick: saveTrial }, "Save trial")), mMsg);

  async function saveTrial() {
    const expected = mExpected.value.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const predicted = S.sequence.map((s) => s.gloss);
    if (!expected.length) { setMsg(mMsg, "Enter the glosses the signer intended.", true); return; }
    const correct = expected.filter((g, i) => predicted[i] === g).length, typed = parseFloat(mTyped.value);
    try {
      const m = await api._req("/api/trials/", "POST", {
        signer: teachSigner.value.trim() || "unknown", held_out: mHeld.checked, expected, predicted,
        signs_expected: expected.length, signs_correct: correct,
        sanket_ms: S.sanketMs || null, typing_ms: isFinite(typed) ? Math.round(typed * 1000) : null,
      });
      setMsg(mMsg, `Saved (${correct}/${expected.length} correct). Unseen-signer accuracy so far: ${m.accuracy_held_out ?? "–"}%`);
    } catch (e) { setMsg(mMsg, "Could not save: " + e.message, true); }
  }

  // ---------------------------------------------------------- export the sign pack for the extension
  const exportCard = card("Studio · Connected to the extension",
    h("div", { class: "sk-muted" }, "Signs you teach here are picked up by the browser extension automatically while this Studio is running: open the extension and press Sync signs now (it also syncs when the panel opens). The extension has no training of its own."),
    h("div", { class: "sk-muted", style: "margin-top:6px" }, "Optional: download a copy to bundle inside the extension for people who will not run a Studio."),
    h("div", { class: "sk-row", style: "margin-top:8px" },
      h("a", { class: "sk-btn small", href: "/api/pack/?download=1", style: "text-decoration:none" }, "Download signs.json")));

  P.root.append(teachCard, measureCard, exportCard);

  (async () => {
    try {
      const taught = await api._req("/api/teach/", "GET");
      if (taught.feature_dim === FEATURE) clf.loadFromApi(taught.signs);
    } catch (e) { /* server pill already shows the problem */ }
    renderCounts();
  })();
})();
