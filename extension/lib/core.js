/* Sanket core - shared by the Chrome extension side panel and the Django demo page.
 * Pure browser JS, no build step. Exposes window.SanketCore.
 *
 * Pipeline:  MediaPipe landmarks -> feature vector -> kNN classifier -> sequencer -> API
 * Keep FEATURE_DIM in sync with settings.SANKET["FEATURE_DIM"] and ml/features.py.
 */
(function (root) {
  "use strict";

  const PER_HAND = 65; // 21 landmarks x (x,y,z) normalised + wrist (x,y) in the frame
  const FEATURE_DIM = PER_HAND * 2;

  // ---------------------------------------------------------------- features
  function normalizeHand(lm) {
    const w = lm[0], mcp = lm[9];
    const scale = Math.hypot(mcp.x - w.x, mcp.y - w.y, (mcp.z || 0) - (w.z || 0)) || 1e-6; // hand size
    const out = [];
    for (let i = 0; i < 21; i++) {
      out.push((lm[i].x - w.x) / scale, (lm[i].y - w.y) / scale, ((lm[i].z || 0) - (w.z || 0)) / scale);
    }
    out.push(w.x, w.y); // where in the frame the hand is (matters for signs like TEACHER vs DOCTOR)
    return out;
  }

  /** results: MediaPipe Hands results object. Returns null when no hand is visible. */
  function featureVector(results) {
    const hands = results && results.multiHandLandmarks;
    if (!hands || !hands.length) return null;
    const vec = new Array(FEATURE_DIM).fill(0);
    const used = [false, false];
    hands.slice(0, 2).forEach((lm, i) => {
      const label = results.multiHandedness && results.multiHandedness[i] && results.multiHandedness[i].label;
      let slot = label === "Left" ? 0 : 1;
      if (used[slot]) slot = 1 - slot;
      used[slot] = true;
      normalizeHand(lm).forEach((v, j) => (vec[slot * PER_HAND + j] = v));
    });
    return vec;
  }

  // ---------------------------------------------------------------- classifier
  /** k-nearest-neighbour over landmark vectors. Works the moment someone has taught a few signs;
   *  swap in a TensorFlow.js MLP/LSTM later via `setModel(fn)` (fn(vec) -> [{label, conf}]). */
  class SignClassifier {
    constructor(opts) {
      this.k = (opts && opts.k) || 7;
      this.maxDist = (opts && opts.maxDist) || 4.0; // beyond this the nearest sample is "too far" -> low confidence
      this.samples = []; // {label, vec}
      this.model = null;
    }
    clear() { this.samples = []; }
    add(label, vecs) { vecs.forEach((v) => this.samples.push({ label: label.toUpperCase(), vec: v })); }
    loadFromApi(signs) {
      this.clear();
      (signs || []).forEach((s) => this.add(s.label, s.samples));
    }
    setModel(fn) { this.model = fn; }
    counts() {
      const c = {};
      this.samples.forEach((s) => (c[s.label] = (c[s.label] || 0) + 1));
      return c;
    }
    predict(vec) {
      if (!vec) return null;
      if (this.model) return this.model(vec);
      if (!this.samples.length) return [];
      const dists = new Array(this.samples.length);
      for (let i = 0; i < this.samples.length; i++) {
        const s = this.samples[i].vec;
        let d = 0;
        for (let j = 0; j < FEATURE_DIM; j++) { const t = vec[j] - s[j]; d += t * t; }
        dists[i] = [Math.sqrt(d), i];
      }
      dists.sort((a, b) => a[0] - b[0]);
      const near = dists.slice(0, this.k);
      const gate = Math.exp(-Math.pow(near[0][0] / this.maxDist, 2)); // 1 = very close, ~0 = far from anything known
      const score = {};
      let total = 0;
      near.forEach(([d, i]) => {
        const w = 1 / (d + 0.05);
        score[this.samples[i].label] = (score[this.samples[i].label] || 0) + w;
        total += w;
      });
      return Object.entries(score)
        .map(([label, w]) => ({ label, conf: (w / total) * gate }))
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 3);
    }
  }

  // ---------------------------------------------------------------- sequencer
  /** Accepts a sign once the same top guess holds for `holdFrames` (~10) frames, and requires the hand to drop
   *  or the sign to change before the same sign counts again.
   *  A sentence now ends by itself when ANY of these happens (no button needed):
   *   1. the sentence sounds complete: it ends in a sign that ISL puts last (WH-words, WRITE, TRANSLATE ...) - short grace delay
   *   2. nothing new is signed for `pauseMs`, even if the hand stays in view
   *   3. the hand leaves the view for `pauseMs`
   *   4. `maxSigns` signs have been accepted */
  class SignSequencer {
    constructor(o) {
      o = o || {};
      this.holdFrames = o.holdFrames || 10;
      this.minConf = o.minConf || 0.6;
      this.pauseMs = o.pauseMs || 1600;
      this.graceMs = o.graceMs === undefined ? 600 : o.graceMs;
      this.maxSigns = o.maxSigns || 6;
      this.autoComplete = o.autoComplete !== false;
      this.terminal = o.terminal || new Set();
      this.onSign = o.onSign || (() => {});
      this.onSentence = o.onSentence || (() => {});
      this.reset();
    }
    reset() {
      this.sequence = [];
      this.candidate = null;
      this.count = 0;
      this.lastAccepted = null;
      this.released = true;
      this.lastHandAt = 0;
      this.lastAcceptAt = 0;
      this.finishAt = null;
      this.startedAt = null;
    }
    _idleCheck(now) {
      const forming = this.candidate && this.candidate !== this.lastAccepted && this.count > 0; // a new sign is being formed
      if (this.sequence.length && !forming && now - this.lastAcceptAt > this.pauseMs) this.finish(true);
    }
    /** top3: array from classifier.predict(), or null when no hand is visible. */
    update(top3, now) {
      now = now || performance.now();
      if (this.finishAt !== null && now >= this.finishAt) this.finish(!!top3);
      if (!top3) {
        this.candidate = null; this.count = 0; this.released = true;
        if (this.sequence.length && this.lastHandAt && now - this.lastHandAt > this.pauseMs) this.finish(false);
        return;
      }
      this.lastHandAt = now;
      const best = top3[0];
      if (!best || best.conf < this.minConf) { this.candidate = null; this.count = 0; this._idleCheck(now); return; }
      if (best.label === this.candidate) this.count++; else { this.candidate = best.label; this.count = 1; }
      if (this.count >= this.holdFrames && (best.label !== this.lastAccepted || this.released)) {
        if (this.startedAt === null) this.startedAt = now;
        this.sequence.push({ gloss: best.label, alternatives: top3.map((t) => t.label) });
        this.lastAccepted = best.label;
        this.lastAcceptAt = now;
        this.released = false;
        this.count = 0;
        this.finishAt = null;
        if (this.autoComplete) {
          if (this.sequence.length >= this.maxSigns) this.finishAt = now;
          else if (this.sequence.length >= 2 && this.terminal.has(best.label)) this.finishAt = now + this.graceMs;
        }
        this.onSign(this.sequence[this.sequence.length - 1], this.sequence);
      }
      this._idleCheck(now);
    }
    /** handVisible: if the hand is still holding the last sign, it must not be re-read as a new sentence. */
    finish(handVisible) {
      const seq = this.sequence, startedAt = this.startedAt, held = this.lastAccepted;
      this.reset();
      if (handVisible) { this.lastAccepted = held; this.released = false; }
      if (seq.length) this.onSentence(seq, startedAt);
    }
  }

  // ---------------------------------------------------------------- tracker (MediaPipe Hands)
  /** Needs the global `Hands` from vendor/mediapipe/hands/hands.js. assetBase must end with "/". */
  async function startTracker({ video, canvas, assetBase, onResults, stream }) {
    if (typeof Hands === "undefined") throw new Error("MediaPipe Hands script not loaded");
    const hands = new Hands({ locateFile: (f) => assetBase + f });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
    const ctx = canvas.getContext("2d");
    hands.onResults((res) => {
      canvas.width = video.videoWidth || canvas.width;
      canvas.height = video.videoHeight || canvas.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      (res.multiHandLandmarks || []).forEach((lm) => drawHand(ctx, lm, canvas.width, canvas.height));
      onResults(res);
    });
    video.srcObject = stream || (await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }));
    await video.play();
    let running = true, busy = false;
    const loop = async () => {
      if (!running) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { await hands.send({ image: video }); } catch (e) { console.warn(e); }
        busy = false;
      }
      requestAnimationFrame(loop);
    };
    loop();
    return {
      stop() {
        running = false;
        (video.srcObject && video.srcObject.getTracks() || []).forEach((t) => t.stop());
        video.srcObject = null;
        try { hands.close(); } catch (e) { /* ignore */ }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
    };
  }

  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  function drawHand(ctx, lm, w, h) {
    ctx.strokeStyle = "#818cf8"; ctx.lineWidth = 3; ctx.fillStyle = "#f472b6";
    BONES.forEach(([a, b]) => { ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke(); });
    lm.forEach((p) => { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3.5, 0, 6.3); ctx.fill(); });
  }

  // ---------------------------------------------------------------- API client
  class SanketApi {
    constructor(base) { this.base = (base || "").replace(/\/$/, ""); }
    async _req(path, method, body) {
      const r = await fetch(this.base + path, {
        method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(JSON.stringify(data).slice(0, 200) || r.statusText);
      return data;
    }
    health() { return this._req("/api/health/", "GET"); }
    intent(glosses) { return this._req("/api/intent/", "POST", { glosses }); }
    simplify(text) { return this._req("/api/simplify/", "POST", { text }); }
  }

  root.SanketCore = { FEATURE_DIM, featureVector, normalizeHand, SignClassifier, SignSequencer, startTracker, SanketApi };
})(typeof window !== "undefined" ? window : globalThis);
