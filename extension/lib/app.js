/* Sanket panel UI - one script for the Chrome/Edge side panel (recognition only) and the localhost Studio.
 * Needs: core.js, lexicon.js, intent.js, simplify.js, and window.SANKET_HOST:
 *   { mode: "extension" | "studio", useBackend, apiBase, assetBase, inject(text)->{ok,detail}, getLastReply()->string,
 *     loadPack()->{signs}  (extension), getSetting(k,def), setSetting(k,v), openPermissionPage?() }
 * The Studio adds training / measuring cards through window.SanketPanel (see backend/web/static/studio/studio.js).
 * The extension bundle contains NO training code. */
(function () {
  "use strict";
  const C = window.SanketCore, HOST = window.SANKET_HOST;
  const EXT = HOST.mode === "extension";
  const root = document.getElementById("sanket-root");

  const EXAMPLES = [
    ["Hello, how are you?", "HELLO HOW YOU"], ["Hello, what are you doing?", "HELLO WHAT YOU DO"],
    ["I am fine. How are you?", "I FINE YOU HOW"], ["Good morning", "GOOD MORNING"], ["Let's meet tomorrow at 5:00", "MEET TOMORROW 5"],
    ["What is the weather today?", "TODAY WEATHER WHAT"], ["Explain this in simple words", "THIS EXPLAIN EASY"],
    ["Write an email to my teacher", "I TEACHER EMAIL WRITE"], ["Translate this into Hindi", "THIS HINDI TRANSLATE"],
    ["Where is the nearest hospital?", "NEAR HOSPITAL WHERE"], ["How do I apply for an Aadhaar card?", "AADHAAR APPLY HOW"],
    ["When is my exam?", "MY EXAM WHEN"], ["Summarise this in short", "THIS SHORT SUMMARY"],
    ["Remind me tomorrow at 5", "TOMORROW 5 I REMIND"], ["I did not understand. Say it again", "I UNDERSTAND NOT AGAIN EXPLAIN"],
  ];
  const CARD_FIELDS = ["task", "topic", "recipient", "when", "style", "language", "length", "filter", "type"];

  // tiny DOM helper - always textContent, so API data can never inject HTML
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((k) => k != null && el.append(k.nodeType ? k : document.createTextNode(String(k))));
    return el;
  }
  const card = (title, ...kids) => h("section", { class: "sk-card" }, h("h3", {}, title), ...kids);
  const setMsg = (el, text, err) => { el.textContent = text || ""; el.classList.toggle("err", !!err); };

  // ------------------------------------------------------------ state
  const api = HOST.useBackend ? new C.SanketApi(HOST.apiBase) : null; // null = fully offline (rule engine in the browser)
  const clf = new C.SignClassifier();
  const S = { tracker: null, lastVec: null, sequence: [], selected: -1, startedAt: null, sanketMs: null, collecting: null, flashUntil: 0 };
  let autoInsert = true, autoSend = false, sendTimer = null;
  // ISL puts question words and the main verb last, so a sentence ending in one of these sounds complete.
  const TERMINAL = new Set(["WHAT", "WHERE", "WHEN", "HOW", "WHY", "WHO", "WRITE", "TRANSLATE", "SUMMARY", "REMIND", "SEND", "SEARCH", "READ"]);
  const seq = new C.SignSequencer({
    terminal: TERMINAL, maxSigns: 6,
    onSign: (_sign, sequence) => { S.flashUntil = performance.now() + 800; S.sequence = sequence; S.selected = sequence.length - 1; S.startedAt = seq.startedAt; renderSeq(); },
    onSentence: (sequence, startedAt) => { S.sequence = sequence; S.startedAt = startedAt; S.selected = -1; renderSeq(); buildIntent(); },
  });

  // ------------------------------------------------------------ layout
  const statusPill = h("span", { class: "sk-pill" }, "starting...");
  const header = h("div", { class: "sk-head" }, h("span", { class: "sk-title" }, "SANKET"), statusPill);

  const video = h("video", { playsinline: true, muted: true }), canvas = h("canvas");
  const signBadge = h("div", { class: "sk-sign" });
  const live = h("div", { class: "sk-live sk-muted" }, "Camera is off. Video never leaves this device.");
  const bar = h("div", { class: "sk-bar" }, h("div"));
  const camBtn = h("button", { class: "sk-btn primary", onclick: toggleCamera }, "Start camera");
  const camMsg = h("div", { class: "sk-msg" }), packInfo = h("div", { class: "sk-msg" });
  const syncBtn = h("button", { class: "sk-btn", onclick: () => syncPack() }, "Sync signs now");
  const camCard = card("1 · Sign", h("div", { class: "sk-video-wrap" }, video, canvas, signBadge), live, bar,
    h("div", { class: "sk-row", style: "margin-top:8px" }, camBtn, EXT ? syncBtn : null), camMsg, packInfo);

  const chips = h("div", { class: "sk-row" }), alts = h("div", { class: "sk-row", style: "margin-top:6px" });
  const glossInput = h("input", { class: "sk-input", list: "sk-vocab", placeholder: "or type glosses, e.g. TODAY WEATHER WHAT" });
  const vocabList = h("datalist", { id: "sk-vocab" }, (window.SANKET_LEXICON || []).map((r) => h("option", { value: r[0] }, r[1])));
  const exampleSel = h("select", { class: "sk-input", onchange: () => { if (exampleSel.value) { loadGlosses(exampleSel.value); exampleSel.value = ""; } } },
    h("option", { value: "" }, "Quick examples (no camera needed)..."), EXAMPLES.map(([en, g]) => h("option", { value: g }, `${en}  →  ${g}`)));
  const seqCard = card("2 · Signs → sentence", chips, alts,
    h("div", { class: "sk-row", style: "margin-top:8px" }, glossInput, vocabList),
    h("div", { class: "sk-row", style: "margin-top:6px" },
      h("button", { class: "sk-btn small", onclick: addTyped }, "Add"),
      h("button", { class: "sk-btn small primary", onclick: buildIntent }, "Make sentence"),
      h("button", { class: "sk-btn small", onclick: clearAll }, "Clear")),
    h("div", { style: "margin-top:6px" }, exampleSel),
    h("div", { class: "sk-muted", style: "margin-top:6px" }, "Sign 3-4 words. Sanket ends the sentence by itself (when it sounds complete, or after a short pause) and puts it in the text box you last clicked, on any site. Tap a chip to fix a wrong word."));

  const fieldInputs = {}, grid = h("div", { class: "sk-grid" });
  CARD_FIELDS.forEach((k) => { fieldInputs[k] = h("input", { class: "sk-input" }); grid.append(h("label", {}, k), fieldInputs[k]); });
  const promptBox = h("textarea", { class: "sk-area", rows: "2", placeholder: "The sentence appears here" });
  const modeBadge = h("span", { class: "sk-badge" }, "–"), intentMsg = h("div", { class: "sk-msg" });
  const insertBtn = h("button", { class: "sk-btn primary", onclick: () => insertPrompt(), disabled: true }, EXT ? "Put in text box again" : "Send to chatbot");
  const intentCard = card("3 · Sentence",
    h("div", { class: "sk-row", style: "margin-bottom:6px" }, modeBadge, h("span", { class: "sk-muted" }, EXT ? "It goes into the text box you last clicked, by itself. You press Send." : "It goes into the chat box by itself. You press Send.")),
    promptBox, h("div", { class: "sk-row", style: "margin-top:8px" }, insertBtn), intentMsg,
    h("details", { style: "margin-top:8px" }, h("summary", { class: "sk-muted" }, "Intent card details"), grid));

  const replyBox = h("textarea", { class: "sk-area", rows: "4", placeholder: "Reply or selected text to simplify..." });
  const replyOut = h("div"), replyMsg = h("div", { class: "sk-msg" });
  const replyCard = card("4 · Simpler answer", replyBox,
    h("div", { class: "sk-row", style: "margin-top:6px" },
      h("button", { class: "sk-btn small", onclick: grabReply }, EXT ? "Use reply / selected text" : "Use chatbot reply"),
      h("button", { class: "sk-btn small primary", onclick: simplifyReply }, "Simplify")), replyMsg, replyOut);

  // settings (both modes)
  const autoBox = h("input", { type: "checkbox", checked: true });
  autoBox.addEventListener("change", () => { autoInsert = autoBox.checked; HOST.setSetting("autoInsert", autoInsert); });
  const pauseSel = h("select", { class: "sk-input", onchange: () => { seq.pauseMs = +pauseSel.value; HOST.setSetting("pauseMs", seq.pauseMs); } },
    [[1000, "Short pause (1 s)"], [1600, "Normal pause (1.6 s)"], [2500, "Long pause (2.5 s)"]].map(([v, t]) => h("option", { value: v }, t)));
  const completeBox = h("input", { type: "checkbox", checked: true });
  completeBox.addEventListener("change", () => { seq.autoComplete = completeBox.checked; HOST.setSetting("autoComplete", seq.autoComplete); });
  const sendBox = h("input", { type: "checkbox" });
  sendBox.addEventListener("change", () => { autoSend = sendBox.checked; if (!autoSend) cancelSend(); HOST.setSetting("autoSend", autoSend); });
  const settingsKids = [
    h("label", { style: "display:flex;gap:6px;align-items:center" }, completeBox, "Finish the sentence by itself when it sounds complete"),
    h("label", { style: "display:flex;gap:6px;align-items:center;margin-top:6px" }, autoBox, "Put the sentence in the text box automatically"),
    EXT && HOST.send ? h("label", { style: "display:flex;gap:6px;align-items:center;margin-top:6px" }, sendBox, "Also press Send for me (3 s countdown, you can cancel)") : null,
    h("div", { style: "margin-top:6px" }, pauseSel),
  ];
  if (EXT) {
    const studioInput = h("input", { class: "sk-input", value: HOST.studioUrl, placeholder: "http://127.0.0.1:8000" });
    studioInput.addEventListener("change", async () => { await HOST.setSetting("studioUrl", studioInput.value.trim()); location.reload(); });
    const smartBox = h("input", { type: "checkbox", checked: !!HOST.smartMode });
    smartBox.addEventListener("change", async () => { await HOST.setSetting("smartMode", smartBox.checked); location.reload(); });
    settingsKids.push(
      h("div", { class: "sk-muted", style: "margin-top:8px" }, "Studio address (where you teach signs):"), studioInput,
      h("label", { style: "display:flex;gap:6px;align-items:center;margin-top:6px" }, smartBox, "Use the Studio for AI wording (needs an API key there)"),
      h("div", { class: "sk-muted", style: "margin-top:4px" }, "Signs are copied from the Studio and then work offline. No video is ever sent."));
  }
  const settingsCard = card("Settings", ...settingsKids);

  root.append(header, camCard, seqCard, intentCard, replyCard, settingsCard);
  window.SanketPanel = { h, card, setMsg, root, api, clf, S, seq, C, HOST, statusPill, settingsCard };

  // ------------------------------------------------------------ rendering
  function renderSeq() {
    chips.replaceChildren(...(S.sequence.length ? S.sequence.map((s, i) =>
      h("span", { class: "sk-chip" + (i === S.selected ? " sel" : ""), onclick: () => { S.selected = i; renderSeq(); } }, s.gloss,
        h("span", { class: "x", onclick: (e) => { e.stopPropagation(); S.sequence.splice(i, 1); S.selected = -1; renderSeq(); } }, "×")))
      : [h("span", { class: "sk-muted" }, "No signs yet.")]));
    const sel = S.sequence[S.selected];
    alts.replaceChildren(...(sel && sel.alternatives.length > 1
      ? [h("span", { class: "sk-muted" }, "Did you mean:"), ...sel.alternatives.map((a) => h("span", { class: "sk-chip sk-alt", onclick: () => { sel.gloss = a; renderSeq(); } }, a))] : []));
  }
  function showSign(top) {
    if (top && top.length && top[0].conf >= seq.minConf) {
      const accepted = performance.now() < S.flashUntil;
      signBadge.replaceChildren((accepted ? "\u2713 " : "") + top[0].label, h("small", {}, Math.round(top[0].conf * 100) + "%"));
      signBadge.classList.toggle("ok", accepted);
      signBadge.style.display = "block";
    } else signBadge.style.display = "none";
  }
  function setLive(top) {
    showSign(top);
    if (!top || !top.length) { live.textContent = top ? "Hand seen, but this sign is not in the sign pack." : "Show a hand to the camera..."; bar.firstChild.style.width = "0"; return; }
    live.textContent = top.map((t) => `${t.label} ${Math.round(t.conf * 100)}%`).join("  \u00b7  ");
    bar.firstChild.style.width = Math.round(top[0].conf * 100) + "%";
  }

  // ------------------------------------------------------------ camera + recognition
  async function toggleCamera() {
    if (S.tracker) { S.tracker.stop(); S.tracker = null; camBtn.textContent = "Start camera"; live.textContent = "Camera is off."; signBadge.style.display = "none"; return; }
    setMsg(camMsg, "Starting camera and loading the hand model...");
    try {
      S.tracker = await C.startTracker({ video, canvas, assetBase: HOST.assetBase, onResults: onFrame });
      camBtn.textContent = "Stop camera"; setMsg(camMsg, "");
    } catch (e) {
      const denied = e && (e.name === "NotAllowedError" || e.name === "PermissionDismissedError");
      setMsg(camMsg, denied ? "Camera permission is blocked." : "Could not start: " + (e.message || e), true);
      if (denied && HOST.openPermissionPage) camMsg.append(" ", h("button", { class: "sk-btn small", onclick: HOST.openPermissionPage }, "Grant camera access"));
    }
  }
  function onFrame(res) {
    const vec = C.featureVector(res);
    S.lastVec = vec;
    if (S.collecting && vec) { S.collecting.samples.push(vec); S.collecting.tick(S.collecting.samples.length); } // Studio recording
    const top = vec ? clf.predict(vec) : null;
    setLive(top);
    if (!S.collecting) seq.update(top);
  }

  // ------------------------------------------------------------ sequence helpers
  function loadGlosses(str) { S.sequence = []; S.startedAt = null; addGlosses(str.split(/\s+/)); buildIntent(); }
  function addGlosses(list) {
    if (S.startedAt === null) S.startedAt = performance.now();
    list.filter(Boolean).forEach((g) => S.sequence.push({ gloss: g.toUpperCase(), alternatives: [g.toUpperCase()] }));
    S.selected = -1; renderSeq();
  }
  function addTyped() { addGlosses(glossInput.value.replace(/,/g, " ").split(/\s+/)); glossInput.value = ""; }
  function clearAll() {
    seq.reset(); S.sequence = []; S.startedAt = null; S.selected = -1; renderSeq(); promptBox.value = "";
    CARD_FIELDS.forEach((k) => (fieldInputs[k].value = "")); insertBtn.disabled = true; setMsg(intentMsg, "");
  }

  // ------------------------------------------------------------ sentence + insert into the chatbot
  async function buildIntent() {
    if (glossInput.value.trim()) addTyped();
    if (!S.sequence.length) { setMsg(intentMsg, "Add some signs first.", true); return; }
    setMsg(intentMsg, "Making the sentence...");
    const glosses = S.sequence.map((s) => s.gloss);
    let r = null;
    if (api) { try { r = await api.intent(glosses); } catch (e) { r = null; } } // smart mode, falls back to offline rules
    if (!r) r = window.SanketIntent.parse(glosses);
    CARD_FIELDS.forEach((k) => (fieldInputs[k].value = r[k] || ""));
    promptBox.value = r.prompt; modeBadge.textContent = r.mode === "llm" ? "AI wording" : "rule engine";
    insertBtn.disabled = false;
    const warn = (r.warnings || []).join(" ");
    if (autoInsert) await insertPrompt(warn); else setMsg(intentMsg, warn || `Confidence ${Math.round(r.confidence * 100)}%. Press the button to send.`, !!warn);
  }
  async function insertPrompt(extra) {
    const text = promptBox.value.trim();
    if (!text) return;
    cancelSend();
    S.sanketMs = S.startedAt !== null ? Math.round(performance.now() - S.startedAt) : null;
    try {
      const r = await HOST.inject(text);
      setMsg(intentMsg, [r.detail || (r.ok ? "Done." : "Could not insert."), extra, S.sanketMs ? `Time: ${(S.sanketMs / 1000).toFixed(1)} s.` : ""].filter(Boolean).join(" "), !r.ok);
      if (r.ok && autoSend && HOST.send) startSendCountdown();
    } catch (e) { setMsg(intentMsg, "Could not insert: " + e.message, true); }
  }
  function cancelSend(msg) {
    if (!sendTimer) return;
    clearInterval(sendTimer); sendTimer = null;
    if (msg) setMsg(intentMsg, msg);
  }
  function startSendCountdown() {
    cancelSend();
    let n = 3;
    const cancel = h("button", { class: "sk-btn small", onclick: () => cancelSend("Cancelled. The sentence is still in the text box.") }, "Cancel");
    const show = () => { intentMsg.classList.remove("err"); intentMsg.replaceChildren(`Sending in ${n} s... `, cancel); };
    show();
    sendTimer = setInterval(async () => {
      n--;
      if (n > 0) { show(); return; }
      clearInterval(sendTimer); sendTimer = null;
      try { const r = await HOST.send(); setMsg(intentMsg, r.detail || (r.ok ? "Sent." : "Could not press Send - press it yourself."), !r.ok); }
      catch (e) { setMsg(intentMsg, "Could not press Send: " + e.message, true); }
    }, 1000);
  }

  // ------------------------------------------------------------ reply simplifier
  async function grabReply() {
    try { replyBox.value = (await HOST.getLastReply()) || ""; setMsg(replyMsg, replyBox.value ? "" : "Nothing found - select some text on the page first, or paste it here."); }
    catch (e) { setMsg(replyMsg, e.message, true); }
  }
  function marked(text, words) {
    const ws = (words || []).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!ws.length) return [text];
    return text.split(new RegExp("(" + ws.join("|") + ")", "i")).map((p, i) => (i % 2 ? h("mark", {}, p) : p));
  }
  async function simplifyReply() {
    const text = replyBox.value.trim();
    if (!text) { setMsg(replyMsg, "Nothing to simplify yet.", true); return; }
    setMsg(replyMsg, "Simplifying...");
    let r = null;
    if (api) { try { r = await api.simplify(text); } catch (e) { r = null; } }
    if (!r) r = window.SanketSimplify.simplifyText(text);
    replyOut.replaceChildren(...r.lines.map((l) => h("div", { class: "sk-line" }, marked(l.text, l.highlights))));
    setMsg(replyMsg, (r.mode === "llm" ? "AI wording" : "Rule engine") + (r.truncated ? " · shortened" : ""));
  }

  // ------------------------------------------------------------ boot
  let lastSync = Date.now();
  async function syncPack(quiet) {
    if (!EXT) return;
    lastSync = Date.now();
    if (!quiet) setMsg(packInfo, "Syncing signs from the Studio...");
    let pack;
    try { pack = await HOST.loadPack(); } catch (e) { setMsg(packInfo, "Could not load signs: " + e.message, true); return; }
    if (pack.feature_dim && pack.feature_dim !== C.FEATURE_DIM) { setMsg(packInfo, "These signs were made by a different Sanket version.", true); return; }
    clf.loadFromApi(pack.signs || []);
    const n = Object.keys(clf.counts()).length, when = pack._syncedAt ? new Date(pack._syncedAt).toLocaleString() : "";
    let text, err = false;
    if (pack._source === "studio") text = `Synced from your Studio: ${n} signs.`;
    else if (pack._source === "cache") text = `Studio is not running - using the ${n} signs saved on ${when}.`;
    else if (n) text = `Studio is not running - using the ${n} signs bundled with the extension.`;
    else {
      err = true;
      text = pack._studio === "empty" ? "Your Studio has no taught signs yet. Teach some at /demo/, then press Sync signs now."
        : "No signs yet. Start the Studio (python manage.py runserver), teach signs at /demo/, then press Sync signs now.";
    }
    setMsg(packInfo, text, err);
    if (!api) {
      statusPill.textContent = pack._source === "studio" ? "synced with Studio" : n ? "saved signs (Studio off)" : "no signs yet";
      statusPill.className = "sk-pill " + (n ? "ok" : "bad");
    }
  }
  window.addEventListener("focus", () => { if (EXT && Date.now() - lastSync > 20000) syncPack(true); });

  async function boot() {
    renderSeq();
    autoInsert = !!(await HOST.getSetting("autoInsert", true)); autoBox.checked = autoInsert;
    seq.pauseMs = +(await HOST.getSetting("pauseMs", 1600)); pauseSel.value = String(seq.pauseMs);
    seq.autoComplete = !!(await HOST.getSetting("autoComplete", true)); completeBox.checked = seq.autoComplete;
    autoSend = !!(await HOST.getSetting("autoSend", false)); sendBox.checked = autoSend;
    if (EXT) await syncPack(true);
    if (api) {
      try {
        const hl = await api.health();
        if (EXT) { if (hl.llm) statusPill.textContent += " \u00b7 AI wording"; }
        else { statusPill.textContent = hl.llm ? "studio \u00b7 AI on" : "studio \u00b7 rules"; statusPill.className = "sk-pill ok"; }
      } catch (e) { if (!EXT) { statusPill.textContent = "studio server offline"; statusPill.className = "sk-pill bad"; } }
    }
    window.dispatchEvent(new Event("sanket-ready"));
  }
  boot();
})();
