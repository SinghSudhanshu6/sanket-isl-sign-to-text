// Extension host adapter (recognition only - no training UI here).
// Signs taught in the localhost Studio are pulled over HTTP (/api/pack/), cached in chrome.storage.local,
// and used offline afterwards. Order: Studio -> saved copy -> signs bundled in model/signs.json.
const DEFAULT_STUDIO = "http://127.0.0.1:8000";

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function toPage(message) {
  const tab = await activeTab();
  if (!tab || !tab.id) throw new Error("No active tab. Open the website where you want to type, in the current window.");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // Tab was open before the extension was installed/reloaded: inject the content script once and retry.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (e2) {
      throw new Error("Sanket cannot reach this page (browser pages like edge://, the new-tab page and the Edge Add-ons store are blocked). Switch to a normal website tab, or reload it, and try again.");
    }
  }
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(timer); }
}

async function loadPack(studioUrl) {
  let studio = "offline"; // "offline" | "empty"
  try {
    const r = await fetchWithTimeout(studioUrl + "/api/pack/?max=40", 3000);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const pack = await r.json();
    if (pack.signs && pack.signs.length) {
      const syncedAt = Date.now();
      await chrome.storage.local.set({ packCache: pack, packSyncedAt: syncedAt });
      return { ...pack, _source: "studio", _syncedAt: syncedAt };
    }
    studio = "empty"; // Studio is running but nothing has been taught yet
  } catch (e) { /* Studio not running: fall through to the saved copy */ }

  const { packCache, packSyncedAt } = await chrome.storage.local.get(["packCache", "packSyncedAt"]);
  if (packCache && packCache.signs && packCache.signs.length) return { ...packCache, _source: "cache", _syncedAt: packSyncedAt, _studio: studio };

  const r = await fetch(chrome.runtime.getURL("model/signs.json"));
  const bundled = await r.json();
  return { ...bundled, _source: "bundled", _studio: studio };
}

(async () => {
  const stored = await chrome.storage.local.get(["studioUrl", "smartMode"]);
  const studioUrl = (stored.studioUrl || DEFAULT_STUDIO).trim().replace(/\/$/, "");
  const smartMode = !!stored.smartMode; // optional: AI wording from the Studio server
  window.SANKET_HOST = {
    name: "extension",
    mode: "extension",
    studioUrl,
    smartMode,
    useBackend: smartMode,
    apiBase: studioUrl,
    assetBase: chrome.runtime.getURL("vendor/mediapipe/hands/"),
    loadPack: () => loadPack(studioUrl),
    async getSetting(key, def) { const o = await chrome.storage.local.get(key); return o[key] === undefined ? def : o[key]; },
    async setSetting(key, value) { await chrome.storage.local.set({ [key]: value }); },
    async inject(text) {
      const r = await toPage({ type: "SANKET_INJECT", text });
      return r && r.ok ? { ok: true, detail: "Sentence is in the text box on " + (r.host || "this page") + ". Press Send." }
                       : { ok: false, detail: (r && r.error) || "No text box found. Click inside the box you want to type in, then try again." };
    },
    async send() {
      const r = await toPage({ type: "SANKET_SEND" });
      return r || { ok: false, detail: "No answer from the page. Press Send yourself." };
    },
    async getLastReply() {
      const r = await toPage({ type: "SANKET_GET_REPLY" });
      return (r && r.text) || "";
    },
    openPermissionPage() { chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") }); },
  };
  const s = document.createElement("script");
  s.src = "lib/app.js";
  document.body.append(s);
})();
