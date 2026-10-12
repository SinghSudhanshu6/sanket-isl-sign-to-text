"""Deterministic ISL-gloss -> intent card + English prompt.

Grammar assumptions (Build Pack section 2): SOV order, time first, WH-words last, no articles,
NOT after the verb. The same card shape is produced by the LLM path, so the UI never cares which ran.
"""
from .glossary import normalize_tokens, shortcuts

CARD_KEYS = ("task", "topic", "recipient", "when", "style", "language", "length", "filter", "type")


def _a_an(word: str) -> str:
    return "an" if word[:1].lower() in "aeiou" else "a"


def _hour(digits: list) -> str:
    n = int("".join(digits))
    return f"{n}:00" if 0 <= n <= 23 else str(n)


# ---- casual chat (Hello, how are you? / what are you doing? / I am fine / let's meet tomorrow ...) --------------
_TASK_VERBS = {"UNDERSTAND", "REMIND", "TRANSLATE", "SUMMARY", "EXPLAIN", "WRITE", "SEND", "APPLY", "SEARCH", "READ", "HELP"}
_CASUAL_ROLES = {"daypart", "good", "state", "feel", "place", "do", "act"}
_GREET_TEXT = {"HELLO": "Hello", "BYE": "Bye", "THANK-YOU": "Thank you", "SORRY": "Sorry"}
_ING = {"EAT": "eating", "GO": "going", "COME": "coming", "WAIT": "waiting"}
_Q_ACT = {  # question about the other person (YOU + action [+ WH-word]); None = no WH-word
    "EAT": {None: "did you eat?", "WHAT": "what are you eating?", "WHEN": "when are you eating?"},
    "GO": {None: "are you going?", "WHERE": "where are you going?", "WHEN": "when are you going?", "WHY": "why are you going?"},
    "COME": {None: "are you coming?", "WHEN": "when are you coming?", "WHY": "why are you coming?", "WHERE": "where are you coming from?"},
    "WAIT": {None: "are you waiting?", "WHERE": "where are you waiting?", "WHY": "why are you waiting?"},
    "MEET": {None: "can we meet?", "WHEN": "when can we meet?", "WHERE": "where can we meet?"},
    "CALL": {None: "can you call me?", "WHEN": "when can you call me?"},
}
_PLAIN_ACT = {"EAT": "let's eat.", "GO": "let's go.", "COME": "come here.", "MEET": "let's meet.", "CALL": "call me.", "WAIT": "please wait."}


def _cap1(s: str) -> str:
    return s[:1].upper() + s[1:]


def _casual(tokens, has, wh, day, digits):
    """Friendly-message path. Returns (prompt, extra) or None when the glosses are not casual chat.
    Explicit AI-task words (EXPLAIN, WRITE, REMIND, ...) and real topics (WEATHER, EXAM, ...) always keep the normal path."""
    if has & _TASK_VERBS:
        return None
    if any(t.role == "topic" and t.gloss != "FOOD" for t in tokens):
        return None
    roles = {t.role for t in tokens}
    persons = [t for t in tokens if t.role == "person"]
    names = [t.english for t in tokens if t.role == "fingerspelled"]
    you, i, negated = "YOU" in has, "I" in has, "NOT" in has
    greet_role = "greet" in roles
    if not (roles & _CASUAL_ROLES or "BYE" in has or (wh == "HOW" and (you or greet_role)) or (greet_role and (persons or names))):
        return None

    acts = [t.gloss for t in tokens if t.role == "act"]
    states = [t.gloss.lower() for t in tokens if t.role == "state"]
    if "GOOD" in has and not ({"MORNING", "NIGHT"} & has):
        states.append("good")
    feels = [t.gloss for t in tokens if t.role == "feel"]
    home = "HOME" in has
    warnings = []

    # greeting words, in the order signed ("Hello", "Good morning", "Thank you", ...)
    greets = []
    for t in tokens:
        text = {"MORNING": "Good morning", "NIGHT": "Good night"}.get(t.gloss) or _GREET_TEXT.get(t.gloss)
        if text and text not in greets:
            greets.append(text)
    obj_person = bool(feels) or (i and ("CALL" in has or "MEET" in has))
    voc = names[0] if names else (persons[0].english if persons and not obj_person else None)

    # when: today / tomorrow / now (+ clock). YESTERDAY does not fit these present-tense messages, so it is dropped.
    when = None
    if day == "yesterday":
        warnings.append("YESTERDAY is ignored in casual messages.")
    elif day or (digits and acts):
        clock = _hour(digits) if digits else None
        when = f"{day} at {clock}" if day and clock else (f"at {clock}" if clock else day)

    clauses = []
    # --- statements about me
    if states and (i or not you):
        clauses.append(f"I am {'not ' if negated else ''}{states[0]}.")
    if feels:
        obj = "you" if you else (f"my {persons[0].english}" if persons else "you")
        clauses.append(f"I {'do not ' if negated else ''}{'miss' if feels[0] == 'MISS' else 'love'} {obj}.")
    if acts and (i or not you):
        a = acts[0]
        person = persons[0].english if persons else None
        if i and negated and a in _ING:
            text = f"I am not {_ING[a]}."
        elif i and a in _ING:
            text = f"I am {_ING[a]}{' food' if a == 'EAT' and 'FOOD' in has else ''}."
            if home and a in ("GO", "COME"):
                text = f"I am {_ING[a]} home."
            elif home:
                text = f"I am {_ING[a]}{' food' if a == 'EAT' and 'FOOD' in has else ''} at home."
        elif i and a == "MEET":
            text = "I cannot meet." if negated else (f"I will meet my {person}." if person and not you else "Let's meet.")
        elif i and a == "CALL":
            obj = "you" if you or not person else f"my {person}"
            text = f"I will {'not ' if negated else ''}call {obj}."
        else:
            text = _PLAIN_ACT[a]
        clauses.append(text)
    elif home and i and not acts and not states and not feels:
        clauses.append(f"I am {'not ' if negated else ''}at home.")
    # --- one question about you (HOW > DO > action > state)
    if you and not feels:
        q = None
        if wh == "HOW":
            q = "how are you?"
        elif "DO" in has and not i:
            q = "what are you doing?"
        elif acts and not i:
            table = _Q_ACT[acts[0]]
            q = table.get(wh) or table[None]
            if home and acts[0] in ("GO", "COME") and q.endswith("ing?") and wh is None:
                q = q[:-1] + " home?"
        elif states and not i:
            q = f"are you {'not ' if negated else ''}{states[0]}?"
        if q:
            clauses.append(q)
    elif "DO" in has and not i and not you and not feels:
        clauses.append("what are you doing?")
    elif wh == "HOW" and not clauses:
        clauses.append("how are you?")
    elif "DO" in has and i and not clauses:
        clauses.append("I am doing it.")

    if when and clauses:
        first = next((k for k, c in enumerate(clauses) if not c.startswith(("I miss", "I love", "I do not"))), None)
        if first is not None:
            clauses[first] = clauses[first][:-1] + f" {when}" + clauses[first][-1]
        else:
            when = None
    else:
        when = None

    sentences = [_cap1(c) for c in clauses]
    lead = ", ".join(greets[:1] + [g[:1].lower() + g[1:] for g in greets[1:]])
    if voc:
        lead = f"{lead} {voc}" if lead else _cap1(voc)
    if lead:
        if sentences:
            first = sentences[0]
            first = first if first.startswith(("I ", "I'")) else first[:1].lower() + first[1:]
            sentences[0] = f"{lead}, {first}"
        else:
            sentences = [lead + "!"]
    if not sentences:
        return None
    if digits and not acts:
        warnings.append("Numbers are ignored in casual messages unless you sign a meeting/going/calling word.")
    return " ".join(sentences), {"recipient": voc, "when": when, "warnings": warnings}


def parse_glosses(raw) -> dict:
    tokens = normalize_tokens(raw)
    glosses = [t.gloss for t in tokens]
    has = set(glosses)
    by_role = lambda r: [t for t in tokens if t.role == r]  # noqa: E731

    # ---- shortcut: a short sign sequence listed in data/shortcuts.csv types its exact sentence (order does not matter)
    if tokens and not any(t.role == "unknown" for t in tokens):
        for keys, sentence in shortcuts():
            if keys == set(glosses):
                return {"task": "shortcut", "topic": None, "recipient": None, "when": None, "style": None, "language": None,
                        "length": None, "filter": None, "type": None, "prompt": sentence, "glosses": glosses,
                        "confidence": 1.0, "warnings": [], "mode": "rules"}

    wh = next((t.gloss for t in reversed(tokens) if t.role == "wh"), None)
    times = by_role("time")
    digits = [t.gloss for t in by_role("digit")]
    persons = by_role("person")
    languages = by_role("language")
    topics = [t for t in tokens if t.role in ("topic", "fingerspelled")]
    unknown = [t.gloss for t in by_role("unknown")]
    this = "THIS" in has
    mine = "MY" in has or "I" in has
    nearest = "NEAR" in has
    easy = "EASY" in has
    short = "SHORT" in has
    negated = "NOT" in has

    # ---- when -------------------------------------------------------------
    day = times[0].english if times else None
    when = day
    clock = None
    if digits and ("REMIND" in has or times):
        clock = _hour(digits)
        when = f"{day} {clock}" if day else clock

    # ---- casual chat ("Hello, how are you?") gets its own friendly path ------
    casual = _casual(tokens, has, wh, day, digits)
    if casual is not None:
        prompt, extra = casual
        card = {"task": "chat", "topic": None, "recipient": extra["recipient"], "when": extra["when"], "style": None,
                "language": None, "length": None, "filter": None, "type": None}
        warnings = list(extra["warnings"])
        if unknown:
            warnings.append("Unrecognised signs: " + ", ".join(unknown))
        return {**card, "prompt": prompt, "glosses": glosses, "confidence": round(max(0.2, 1.0 - 0.2 * len(unknown)), 2),
                "warnings": warnings, "mode": "rules"}

    # ---- task (first matching rule wins) ----------------------------------
    if "UNDERSTAND" in has and negated:
        task = "re-explain"
    elif "REMIND" in has:
        task = "reminder"
    elif "TRANSLATE" in has:
        task = "translate"
    elif "SUMMARY" in has:
        task = "summarise"
    elif "EXPLAIN" in has:
        task = "explain"
    elif "WRITE" in has:
        task = "write"
    elif "SEND" in has:
        task = "send"
    elif wh == "HOW" or ("APPLY" in has and not wh):
        task = "how-to"
    elif wh:
        task = "ask"
    elif "SEARCH" in has:
        task = "search"
    elif "READ" in has:
        task = "read"
    elif "HELP" in has:
        task = "help"
    elif by_role("greet") and not topics:
        task = "chat"
    else:
        task = "ask"

    # ---- fields -----------------------------------------------------------
    is_email = "EMAIL" in has
    topic_words = [t.english for t in topics]
    topic = " ".join(topic_words) if topic_words else None
    if this and not topic:
        topic = "current page/text"
    if task == "how-to" and "APPLY" in has and topic:
        topic = f"{topic} application"
    if task == "ask" and wh == "WHEN" and topic and not topic.endswith("date"):
        topic = f"{topic} date"
    if task in ("write", "send") and is_email and not topic:
        topic = None

    recipient = persons[0].english if persons else None
    card = {
        "task": task,
        "topic": topic,
        "recipient": recipient if task in ("write", "send") else (recipient if recipient else None),
        "when": when,
        "style": "simpler" if task == "re-explain" else ("simple" if easy else None),
        "language": languages[0].english if languages else None,
        "length": "short" if short and task == "summarise" else None,
        "filter": "nearest" if nearest else None,
        "type": "email" if is_email and task in ("write", "send") else None,
    }
    if short and task not in ("summarise",):
        card["style"] = card["style"] or "short"

    prompt = _build_prompt(card, tokens, wh=wh, this=this, mine=mine, day=day, clock=clock, topics=topics)
    warnings = []
    if unknown:
        warnings.append("Unrecognised signs: " + ", ".join(unknown))
    if not tokens:
        warnings.append("No signs received.")
    confidence = max(0.2, 1.0 - 0.2 * len(unknown))
    if not tokens or (not wh and task == "ask" and not topics):
        confidence = min(confidence, 0.4)

    return {
        **card,
        "prompt": prompt,
        "glosses": glosses,
        "confidence": round(confidence, 2),
        "warnings": warnings,
        "mode": "rules",
    }


def _build_prompt(card, tokens, *, wh, this, mine, day, clock, topics) -> str:
    task, topic = card["task"], card["topic"]
    t = (topics[0].english if topics else None)  # bare topic noun, e.g. "exam"
    what = "this" if this and not topics else (topic or "this")

    if task == "re-explain":
        return "I did not understand. Please explain it again in simpler words."
    if task == "reminder":
        when = f"{day} at {clock}" if day and clock else (clock and f"at {clock}") or day or ""
        about = f" about {topic}" if topic and topic != "current page/text" else ""
        return f"Remind me {when}{about}.".replace("  ", " ").replace(" .", ".")
    if task == "translate":
        lang = card["language"]
        return f"Translate {what} into {lang}." if lang else f"Translate {what}."
    if task == "summarise":
        return f"Summarise {what}{' in short' if card['length'] == 'short' else ''}."
    if task == "explain":
        return f"Explain {what} in {card['style']} words." if card["style"] else f"Explain {what} clearly."
    if task in ("write", "send"):
        verb = "Write" if task == "write" else "Send"
        kind = card["type"] or "message"
        to = f" to my {card['recipient']}" if card["recipient"] else ""
        about = f" about {topic}" if topic and topic != "current page/text" else ""
        return f"{verb} {_a_an(kind)} {kind}{to}{about}."
    if task == "how-to":
        if topic and topic.endswith(" application"):
            thing = topic[: -len(" application")]
            return f"How do I apply for {_a_an(thing)} {thing}?"
        return f"How does {topic} work?" if topic else "How do I do this?"
    if task == "search":
        return f"Search for {topic or what}."
    if task == "read":
        return f"Read {what} for me."
    if task == "help":
        return f"I need help with {topic}." if topic else "I need help."
    if task == "chat":
        first = next((tok.english for tok in tokens if tok.role == "greet"), "hello")
        return first.capitalize() + "!"

    # task == "ask"
    if not topic:
        return "Can you help me?"
    if t == "rain":
        return f"Will it rain {day or 'today'}?"
    when = f" {day}" if day else ""
    if wh == "WHERE":
        return f"Where is the nearest {topic}?" if card["filter"] else f"Where is {'my' if mine else 'the'} {topic}?"
    if wh == "WHEN":
        return f"When is {'my' if mine else 'the'} {t or topic}?"
    if wh == "WHO":
        return f"Who is {topic}?"
    if wh == "WHY":
        return f"Can you explain why {topic}{when}?"
    if wh == "HOW":
        return f"How does {topic} work?"
    return f"What is the {topic}{when}?"
