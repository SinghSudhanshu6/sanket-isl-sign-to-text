// Content script (runs on every http/https page): types the confirmed sentence into the text box the person is using
// (WhatsApp Web, Instagram, Google search, Gmail, ChatGPT, Claude, Gemini, ...), reads the latest reply or the selected text,
// and can press Send ONLY when the side panel asks (the "Also press Send for me" setting, off by default).
// It reads nothing from the page unless the side panel asks, and it never touches password / card fields.
// NOTE: the site-specific selectors are heuristics; sites change their markup, so adjust here if one breaks.
(() => {
  if (window.__sanketContent) return;
  window.__sanketContent = true;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const isField = (el) => el.tagName === "TEXTAREA" || el.tagName === "INPUT";
  const contentOf = (el) => (isField(el) ? el.value : el.innerText || el.textContent || "");

  // ------------------------------------------------------------ which text box is the target?
  let lastEditable = null;          // the last text box the person clicked / tabbed into on this page
  const lastInserted = new WeakMap(); // box -> the sentence Sanket last put there

  const TEXT_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "tel"]);
  function editingHost(el) {
    if (!el || el.nodeType !== 1) return null;
    if (isField(el) || !el.isContentEditable) return el;
    let host = el;
    while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    return host;
  }
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();   // password, number, date... are never used
      return TEXT_INPUT_TYPES.has(type) && !el.disabled && !el.readOnly && !/^cc-/.test(el.autocomplete || "");
    }
    return !!el.isContentEditable;
  }
  function deepActive() {   // document.activeElement, looking inside shadow DOMs too
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  document.addEventListener("focusin", (e) => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    const el = editingHost(t);
    if (isEditable(el)) lastEditable = el;
  }, true);

  // Used only when the person has not clicked into any box yet (then the best guess is the page's main chat/message box).
  const SITE_SELECTORS = [
    "#prompt-textarea",                                    // ChatGPT
    "div.ProseMirror[contenteditable='true']",             // Claude, ChatGPT (new editor)
    "rich-textarea .ql-editor",                            // Gemini
    "footer div[contenteditable='true']",                  // WhatsApp Web message box
    "div[contenteditable='true'][data-tab='10']",          // WhatsApp Web (other layout)
    "div[role='textbox'][contenteditable='true']",         // Instagram / Messenger / Telegram Web / Slack / X / LinkedIn ...
    "textarea[placeholder*='message' i]",
    "textarea[name='q'], input[name='q'], input[type='search']",   // search boxes
    "textarea",
  ];
  const GENERIC = "textarea, input, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], [role='textbox']";

  function findInput() {
    const active = editingHost(deepActive());
    if (isEditable(active) && visible(active)) return active;
    if (lastEditable && lastEditable.isConnected && isEditable(lastEditable) && visible(lastEditable)) return lastEditable;
    for (const sel of SITE_SELECTORS) {
      const el = [...document.querySelectorAll(sel)].reverse().find((x) => isEditable(x) && visible(x));
      if (el) return el;
    }
    const all = [...document.querySelectorAll(GENERIC)].filter((x) => isEditable(x) && visible(x));
    const inView = all.filter(inViewport);
    return (inView.length ? inView : all).pop() || null;
  }

  // ------------------------------------------------------------ typing into it
  // Rule: if the box is empty, or holds only Sanket's previous sentence, the sentence replaces it (so re-inserting never
  // duplicates). If the person has typed something of their own, Sanket adds to it instead of wiping it.
  function setCaret(el, replace) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    const inside = sel.rangeCount && el.contains(sel.anchorNode);
    if (replace) { /* whole content selected */ }
    else if (inside) return;                 // keep the person's own caret
    else range.collapse(false);              // otherwise: end of the box
    sel.removeAllRanges(); sel.addRange(range);
  }

  async function insert(el, text) {
    el.focus();
    const prev = lastInserted.get(el);
    const current = contentOf(el);
    const replace = !norm(current) || (prev !== undefined && norm(current) === norm(prev));

    if (isField(el)) {                       // <textarea> / <input>: React-safe native setter + input event
      let start = current.length, end = current.length;
      if (!replace) { try { start = el.selectionStart ?? start; end = el.selectionEnd ?? start; } catch (e) { /* e.g. type=email */ } }
      else start = 0;
      const before = replace ? "" : current.slice(0, start), after = replace ? "" : current.slice(end);
      const gap = before && !/\s$/.test(before) ? " " : "";
      const value = before + gap + text + after, caret = (before + gap + text).length;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, value);
      try { el.setSelectionRange(caret, caret); } catch (e) { /* not supported for this type */ }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      lastInserted.set(el, text);
      return true;
    }

    // contenteditable (ProseMirror, Quill, Lexical in WhatsApp / Instagram, Slack, ...). Try the gentlest way first and
    // check the text really arrived, because some editors ignore one method and accept another.
    const present = () => norm(contentOf(el)).includes(norm(text));
    setCaret(el, replace);
    document.execCommand("insertText", false, text);
    await wait(80);
    if (!present()) {                        // fallback 1: a paste event
      el.focus(); setCaret(el, replace);
      try {
        const dt = new DataTransfer(); dt.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch (e) { /* ignore */ }
      await wait(80);
    }
    if (!present()) {                        // fallback 2: a beforeinput event
      el.focus(); setCaret(el, replace);
      el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      await wait(80);
    }
    if (!present()) {                        // last resort: write the text directly
      el.textContent = replace || !norm(current) ? text : current.replace(/\s+$/, "") + " " + text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      await wait(40);
    }
    const ok = present();
    if (ok) lastInserted.set(el, text);
    return ok;
  }

  // ------------------------------------------------------------ pressing Send (only when the person turned that on)
  const SEND_SELECTORS = [
    "button[data-testid='send-button']",   // ChatGPT
    "button[aria-label='Send message']",   // Claude
    "button[aria-label='Send']",           // WhatsApp Web, Messenger, Telegram Web
    "span[data-icon='send']",              // WhatsApp Web (icon inside the button)
    "button[aria-label*='Send']",          // Gemini and others
    "button.send-button",
  ];
  const usable = (b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true";
  const sayssend = (b) => [b.getAttribute("aria-label"), b.getAttribute("title"), b.getAttribute("data-testid"), (b.innerText || "").trim().slice(0, 20)]
    .some((t) => t && /^send\b/i.test(t.trim()));
  function findSendButton(input) {
    for (const sel of SEND_SELECTORS) {
      const found = [...document.querySelectorAll(sel)].find(usable);
      if (found) return found.closest("button, [role='button']") || found;
    }
    let scope = input;                       // generic: a button that says "Send", looking outward from the text box
    for (let i = 0; i < 6 && scope && scope.parentElement; i++) {
      scope = scope.parentElement;
      const b = [...scope.querySelectorAll("button, [role='button'], input[type='submit']")].find((x) => usable(x) && sayssend(x));
      if (b) return b;
    }
    return null;
  }
  function sendNow() {
    const el = findInput();
    const btn = findSendButton(el);
    if (btn) { btn.click(); return { ok: true, detail: "Pressed Send." }; }
    if (el) {
      const form = el.form || el.closest("form");
      const searchy = el.type === "search" || /^(q|query|search)$/i.test(el.name || "") || (form && form.getAttribute("role") === "search");
      if (form && searchy) { try { form.requestSubmit(); return { ok: true, detail: "Submitted the search." }; } catch (e) { /* fall through */ } }
      el.focus();
      const ev = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", ev));
      el.dispatchEvent(new KeyboardEvent("keypress", ev));
      el.dispatchEvent(new KeyboardEvent("keyup", ev));
      return { ok: true, detail: "Tried Enter - please check the page; press Send yourself if it did not go." };
    }
    return { ok: false, detail: "Send button not found - press Send yourself." };
  }

  // ------------------------------------------------------------ reading text to simplify
  const REPLY_SELECTORS = [
    "[data-message-author-role='assistant']",                   // ChatGPT
    ".font-claude-message, [data-testid='assistant-message']",  // Claude
    "message-content, .model-response-text",                    // Gemini
    ".message-in .copyable-text",                               // WhatsApp Web: last received message
  ];
  function lastReply() {
    const selected = (window.getSelection() || "").toString().trim();   // text the person highlighted wins
    if (selected) return selected;
    for (const sel of REPLY_SELECTORS) {
      const nodes = [...document.querySelectorAll(sel)];
      if (nodes.length) return nodes[nodes.length - 1].innerText.trim();
    }
    return "";
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "SANKET_INJECT") {
      const el = findInput();
      if (!el) { sendResponse({ ok: false, error: "No text box found. Click inside the box you want to type in, then try again." }); return false; }
      insert(el, String(msg.text || ""))
        .then((ok) => sendResponse(ok ? { ok: true, host: location.hostname } : { ok: false, error: "This box did not accept the text. Click inside it and try again." }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;                           // answer arrives asynchronously
    }
    if (msg.type === "SANKET_SEND") { sendResponse(sendNow()); return false; }
    if (msg.type === "SANKET_GET_REPLY") { sendResponse({ text: lastReply() }); return false; }
    return false;
  });
})();
