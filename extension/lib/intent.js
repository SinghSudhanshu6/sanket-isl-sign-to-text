/* Offline ISL-gloss -> intent card + English prompt. A line-by-line port of backend/api/services/intent.py,
 * so the extension works with no server. Needs lexicon.js first. Exposes window.SanketIntent.parse(glosses).
 * Grammar assumptions (Build Pack section 2): SOV order, time first, WH-words last, no articles, NOT after the verb. */
(function (root) {
  "use strict";
  const LEX = {};
  (root.SANKET_LEXICON || []).forEach((r) => (LEX[r[0]] = { gloss: r[0], english: r[1], group: r[2], role: r[3], kind: r[4] }));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ALIASES = { ME: "I", THANKS: "THANK-YOU", THANKYOU: "THANK-YOU", SUMMARISE: "SUMMARY", SUMMARIZE: "SUMMARY",
    DOING: "DO", EATING: "EAT", GOING: "GO", COMING: "COME", OK: "FINE", OKAY: "FINE", GOODBYE: "BYE", "BYE-BYE": "BYE" };
  const FINGERSPELL = /^[A-Z](-[A-Z])+$/;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const aAn = (w) => ("aeiou".includes(w.slice(0, 1).toLowerCase()) ? "an" : "a");

  function normalizeTokens(raw) {
    if (typeof raw === "string") raw = raw.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    const tokens = [];
    for (const item of raw) {
      let g = String(item).trim().toUpperCase();
      if (!g) continue;
      if (has(ALIASES, g)) g = ALIASES[g];
      if (has(LEX, g)) { const e = LEX[g]; tokens.push({ gloss: e.gloss, role: e.role, english: e.english }); }
      else if (FINGERSPELL.test(g)) {
        const word = g.replace(/-/g, "");
        if (has(LEX, word)) { const e = LEX[word]; tokens.push({ gloss: e.gloss, role: e.role, english: e.english }); }
        else tokens.push({ gloss: word, role: "fingerspelled", english: cap(word) });
      } else tokens.push({ gloss: g, role: "unknown", english: g.toLowerCase() });
    }
    return tokens;
  }

  const hourOf = (digits) => { const n = parseInt(digits.join(""), 10); return n >= 0 && n <= 23 ? `${n}:00` : String(n); };


  // ---- casual chat (Hello, how are you? / what are you doing? / I am fine / let's meet tomorrow ...) -------------
  // Port of _casual() in backend/api/services/intent.py - keep the two in step.
  const TASK_VERBS = new Set(["UNDERSTAND", "REMIND", "TRANSLATE", "SUMMARY", "EXPLAIN", "WRITE", "SEND", "APPLY", "SEARCH", "READ", "HELP"]);
  const CASUAL_ROLES = new Set(["daypart", "good", "state", "feel", "place", "do", "act"]);
  const GREET_TEXT = { HELLO: "Hello", BYE: "Bye", "THANK-YOU": "Thank you", SORRY: "Sorry" };
  const ING = { EAT: "eating", GO: "going", COME: "coming", WAIT: "waiting" };
  const Q_ACT = {   // question about the other person (YOU + action [+ WH-word]); "_" = no WH-word
    EAT: { _: "did you eat?", WHAT: "what are you eating?", WHEN: "when are you eating?" },
    GO: { _: "are you going?", WHERE: "where are you going?", WHEN: "when are you going?", WHY: "why are you going?" },
    COME: { _: "are you coming?", WHEN: "when are you coming?", WHY: "why are you coming?", WHERE: "where are you coming from?" },
    WAIT: { _: "are you waiting?", WHERE: "where are you waiting?", WHY: "why are you waiting?" },
    MEET: { _: "can we meet?", WHEN: "when can we meet?", WHERE: "where can we meet?" },
    CALL: { _: "can you call me?", WHEN: "when can you call me?" },
  };
  const PLAIN_ACT = { EAT: "let's eat.", GO: "let's go.", COME: "come here.", MEET: "let's meet.", CALL: "call me.", WAIT: "please wait." };
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const low1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  // Returns { prompt, recipient, when, warnings } or null when the glosses are not casual chat.
  // Explicit AI-task words (EXPLAIN, WRITE, REMIND, ...) and real topics (WEATHER, EXAM, ...) always keep the normal path.
  function casual(tokens, hasG, wh, day, digits) {
    for (const v of TASK_VERBS) if (hasG.has(v)) return null;
    if (tokens.some((t) => t.role === "topic" && t.gloss !== "FOOD")) return null;
    const roles = new Set(tokens.map((t) => t.role));
    const persons = tokens.filter((t) => t.role === "person");
    const names = tokens.filter((t) => t.role === "fingerspelled").map((t) => t.english);
    const you = hasG.has("YOU"), iSelf = hasG.has("I"), negated = hasG.has("NOT");
    const greetRole = roles.has("greet");
    const triggered = [...roles].some((r) => CASUAL_ROLES.has(r)) || hasG.has("BYE") || (wh === "HOW" && (you || greetRole)) || (greetRole && (persons.length || names.length));
    if (!triggered) return null;

    const acts = tokens.filter((t) => t.role === "act").map((t) => t.gloss);
    const states = tokens.filter((t) => t.role === "state").map((t) => t.gloss.toLowerCase());
    if (hasG.has("GOOD") && !(hasG.has("MORNING") || hasG.has("NIGHT"))) states.push("good");
    const feels = tokens.filter((t) => t.role === "feel").map((t) => t.gloss);
    const home = hasG.has("HOME");
    const warnings = [];

    const greets = [];   // greeting words, in the order signed
    for (const t of tokens) {
      const text = t.gloss === "MORNING" ? "Good morning" : t.gloss === "NIGHT" ? "Good night" : GREET_TEXT[t.gloss];
      if (text && !greets.includes(text)) greets.push(text);
    }
    const objPerson = feels.length > 0 || (iSelf && (hasG.has("CALL") || hasG.has("MEET")));
    const voc = names.length ? names[0] : persons.length && !objPerson ? persons[0].english : null;

    let when = null;   // today / tomorrow / now (+ clock); YESTERDAY does not fit present-tense messages
    if (day === "yesterday") warnings.push("YESTERDAY is ignored in casual messages.");
    else if (day || (digits.length && acts.length)) {
      const clock = digits.length ? hourOf(digits) : null;
      when = day && clock ? `${day} at ${clock}` : clock ? `at ${clock}` : day;
    }

    const clauses = [];
    // --- statements about me
    if (states.length && (iSelf || !you)) clauses.push(`I am ${negated ? "not " : ""}${states[0]}.`);
    if (feels.length) {
      const obj = you ? "you" : persons.length ? `my ${persons[0].english}` : "you";
      clauses.push(`I ${negated ? "do not " : ""}${feels[0] === "MISS" ? "miss" : "love"} ${obj}.`);
    }
    if (acts.length && (iSelf || !you)) {
      const a = acts[0], person = persons.length ? persons[0].english : null;
      const food = a === "EAT" && hasG.has("FOOD") ? " food" : "";
      let text;
      if (iSelf && negated && ING[a]) text = `I am not ${ING[a]}.`;
      else if (iSelf && ING[a]) {
        text = `I am ${ING[a]}${food}.`;
        if (home && (a === "GO" || a === "COME")) text = `I am ${ING[a]} home.`;
        else if (home) text = `I am ${ING[a]}${food} at home.`;
      } else if (iSelf && a === "MEET") text = negated ? "I cannot meet." : person && !you ? `I will meet my ${person}.` : "Let's meet.";
      else if (iSelf && a === "CALL") text = `I will ${negated ? "not " : ""}call ${you || !person ? "you" : `my ${person}`}.`;
      else text = PLAIN_ACT[a];
      clauses.push(text);
    } else if (home && iSelf && !acts.length && !states.length && !feels.length) clauses.push(`I am ${negated ? "not " : ""}at home.`);
    // --- one question about you (HOW > DO > action > state)
    if (you && !feels.length) {
      let q = null;
      if (wh === "HOW") q = "how are you?";
      else if (hasG.has("DO") && !iSelf) q = "what are you doing?";
      else if (acts.length && !iSelf) {
        const table = Q_ACT[acts[0]];
        q = table[wh] || table._;
        if (home && (acts[0] === "GO" || acts[0] === "COME") && q.endsWith("ing?") && !wh) q = q.slice(0, -1) + " home?";
      } else if (states.length && !iSelf) q = `are you ${negated ? "not " : ""}${states[0]}?`;
      if (q) clauses.push(q);
    } else if (hasG.has("DO") && !iSelf && !you && !feels.length) clauses.push("what are you doing?");
    else if (wh === "HOW" && !clauses.length) clauses.push("how are you?");
    else if (hasG.has("DO") && iSelf && !clauses.length) clauses.push("I am doing it.");

    if (when && clauses.length) {
      const k = clauses.findIndex((c) => !/^(I miss|I love|I do not)/.test(c));
      if (k >= 0) clauses[k] = clauses[k].slice(0, -1) + ` ${when}` + clauses[k].slice(-1);
      else when = null;
    } else when = null;

    const sentences = clauses.map(cap1);
    let lead = [greets[0], ...greets.slice(1).map(low1)].filter((x) => x !== undefined).join(", ");
    if (voc) lead = lead ? `${lead} ${voc}` : cap1(voc);
    if (lead) {
      if (sentences.length) {
        const first = sentences[0];
        sentences[0] = `${lead}, ${first.startsWith("I ") || first.startsWith("I'") ? first : low1(first)}`;
      } else sentences.push(lead + "!");
    }
    if (!sentences.length) return null;
    if (digits.length && !acts.length) warnings.push("Numbers are ignored in casual messages unless you sign a meeting/going/calling word.");
    return { prompt: sentences.join(" "), recipient: voc, when, warnings };
  }

  // shortcuts (backend/data/shortcuts.csv -> lib/shortcuts.js): a short sign sequence that types one exact sentence, order-free
  const SHORTCUTS = (root.SANKET_SHORTCUTS || []).map(([keys, sentence]) => ({ keys: new Set(normalizeTokens(keys).map((t) => t.gloss)), sentence }));

  function parse(raw) {
    const tokens = normalizeTokens(raw);
    const glosses = tokens.map((t) => t.gloss);
    if (tokens.length && !tokens.some((t) => t.role === "unknown")) {
      const set = new Set(glosses);
      const hit = SHORTCUTS.find((s) => s.keys.size === set.size && [...s.keys].every((k) => set.has(k)));
      if (hit) return { task: "shortcut", topic: null, recipient: null, when: null, style: null, language: null, length: null, filter: null, type: null,
                        prompt: hit.sentence, glosses, confidence: 1, warnings: [], mode: "rules" };
    }
    const hasG = new Set(glosses);
    const byRole = (r) => tokens.filter((t) => t.role === r);

    let wh = null;
    for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].role === "wh") { wh = tokens[i].gloss; break; }
    const times = byRole("time"), digits = byRole("digit").map((t) => t.gloss), persons = byRole("person"), languages = byRole("language");
    const topics = tokens.filter((t) => t.role === "topic" || t.role === "fingerspelled");
    const unknown = byRole("unknown").map((t) => t.gloss);
    const isThis = hasG.has("THIS"), mine = hasG.has("MY") || hasG.has("I");
    const nearest = hasG.has("NEAR"), easy = hasG.has("EASY"), short = hasG.has("SHORT"), negated = hasG.has("NOT");

    const day = times.length ? times[0].english : null;
    let when = day, clock = null;
    if (digits.length && (hasG.has("REMIND") || times.length)) { clock = hourOf(digits); when = day ? `${day} ${clock}` : clock; }

    const chat = casual(tokens, hasG, wh, day, digits);   // "Hello, how are you?" gets its own friendly path
    if (chat) {
      const warn = [...chat.warnings];
      if (unknown.length) warn.push("Unrecognised signs: " + unknown.join(", "));
      return {
        task: "chat", topic: null, recipient: chat.recipient, when: chat.when, style: null, language: null, length: null, filter: null, type: null,
        prompt: chat.prompt, glosses, confidence: Math.round(Math.max(0.2, 1.0 - 0.2 * unknown.length) * 100) / 100, warnings: warn, mode: "rules",
      };
    }

    let task;
    if (hasG.has("UNDERSTAND") && negated) task = "re-explain";
    else if (hasG.has("REMIND")) task = "reminder";
    else if (hasG.has("TRANSLATE")) task = "translate";
    else if (hasG.has("SUMMARY")) task = "summarise";
    else if (hasG.has("EXPLAIN")) task = "explain";
    else if (hasG.has("WRITE")) task = "write";
    else if (hasG.has("SEND")) task = "send";
    else if (wh === "HOW" || (hasG.has("APPLY") && !wh)) task = "how-to";
    else if (wh) task = "ask";
    else if (hasG.has("SEARCH")) task = "search";
    else if (hasG.has("READ")) task = "read";
    else if (hasG.has("HELP")) task = "help";
    else if (byRole("greet").length && !topics.length) task = "chat";
    else task = "ask";

    const isEmail = hasG.has("EMAIL");
    let topic = topics.length ? topics.map((t) => t.english).join(" ") : null;
    if (isThis && !topic) topic = "current page/text";
    if (task === "how-to" && hasG.has("APPLY") && topic) topic = `${topic} application`;
    if (task === "ask" && wh === "WHEN" && topic && !topic.endsWith("date")) topic = `${topic} date`;

    const card = {
      task, topic,
      recipient: persons.length ? persons[0].english : null,
      when,
      style: task === "re-explain" ? "simpler" : easy ? "simple" : null,
      language: languages.length ? languages[0].english : null,
      length: short && task === "summarise" ? "short" : null,
      filter: nearest ? "nearest" : null,
      type: isEmail && (task === "write" || task === "send") ? "email" : null,
    };
    if (short && task !== "summarise") card.style = card.style || "short";

    const prompt = buildPrompt(card, tokens, { wh, isThis, mine, day, clock, topics });
    const warnings = [];
    if (unknown.length) warnings.push("Unrecognised signs: " + unknown.join(", "));
    if (!tokens.length) warnings.push("No signs received.");
    let confidence = Math.max(0.2, 1.0 - 0.2 * unknown.length);
    if (!tokens.length || (!wh && task === "ask" && !topics.length)) confidence = Math.min(confidence, 0.4);
    return { ...card, prompt, glosses, confidence: Math.round(confidence * 100) / 100, warnings, mode: "rules" };
  }

  function buildPrompt(card, tokens, c) {
    const { task, topic } = card, { wh, isThis, mine, day, clock, topics } = c;
    const t = topics.length ? topics[0].english : null;
    const what = isThis && !topics.length ? "this" : topic || "this";

    if (task === "re-explain") return "I did not understand. Please explain it again in simpler words.";
    if (task === "reminder") {
      const when = day && clock ? `${day} at ${clock}` : clock ? `at ${clock}` : day || "";
      const about = topic && topic !== "current page/text" ? ` about ${topic}` : "";
      return `Remind me ${when}${about}.`.replaceAll("  ", " ").replaceAll(" .", ".");
    }
    if (task === "translate") return card.language ? `Translate ${what} into ${card.language}.` : `Translate ${what}.`;
    if (task === "summarise") return `Summarise ${what}${card.length === "short" ? " in short" : ""}.`;
    if (task === "explain") return card.style ? `Explain ${what} in ${card.style} words.` : `Explain ${what} clearly.`;
    if (task === "write" || task === "send") {
      const verb = task === "write" ? "Write" : "Send", kind = card.type || "message";
      const to = card.recipient ? ` to my ${card.recipient}` : "";
      const about = topic && topic !== "current page/text" ? ` about ${topic}` : "";
      return `${verb} ${aAn(kind)} ${kind}${to}${about}.`;
    }
    if (task === "how-to") {
      if (topic && topic.endsWith(" application")) { const thing = topic.slice(0, -" application".length); return `How do I apply for ${aAn(thing)} ${thing}?`; }
      return topic ? `How does ${topic} work?` : "How do I do this?";
    }
    if (task === "search") return `Search for ${topic || what}.`;
    if (task === "read") return `Read ${what} for me.`;
    if (task === "help") return topic ? `I need help with ${topic}.` : "I need help.";
    if (task === "chat") { const g = tokens.find((x) => x.role === "greet"); return cap(g ? g.english : "hello") + "!"; }

    if (!topic) return "Can you help me?";
    if (t === "rain") return `Will it rain ${day || "today"}?`;
    const when = day ? ` ${day}` : "";
    if (wh === "WHERE") return card.filter ? `Where is the nearest ${topic}?` : `Where is ${mine ? "my" : "the"} ${topic}?`;
    if (wh === "WHEN") return `When is ${mine ? "my" : "the"} ${t || topic}?`;
    if (wh === "WHO") return `Who is ${topic}?`;
    if (wh === "WHY") return `Can you explain why ${topic}${when}?`;
    if (wh === "HOW") return `How does ${topic} work?`;
    return `What is the ${topic}${when}?`;
  }

  root.SanketIntent = { parse, normalizeTokens };
})(typeof window !== "undefined" ? window : globalThis);
