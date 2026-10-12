"""Rule-based reply simplifier: short lines + highlighted key words (works with no API key)."""
import re
from collections import Counter

STOP = set(
    """a an the and or but if then so of to in on at by for from with as is are was were be been being am do does did
    has have had it its this that these those you your we our they their he she his her i me my can could should would
    will may might also just very more most some any each other such than too into over under about after before
    which who whom whose what when where why how there here not no yes""".split()
)
SPLIT_AT = re.compile(r"(?<=[,;:])\s+|\s+(?=(?:and|but|because|which|while|so that|however|then)\s)", re.I)


def strip_markdown(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", text, flags=re.M)
    text = re.sub(r"[*_~>|]+", "", text)
    text = re.sub(r"\([^)]{0,80}\)", "", text)
    return text


def _chunks(sentence: str, max_words: int):
    parts = [p.strip(" ,;:") for p in SPLIT_AT.split(sentence) if p and p.strip(" ,;:")]
    out, cur = [], []
    for part in parts:
        words = part.split()
        if cur and len(cur) + len(words) > max_words:
            out.append(" ".join(cur))
            cur = []
        cur.extend(words)
        while len(cur) > max_words * 1.5:  # very long clause: hard split
            out.append(" ".join(cur[:max_words]))
            cur = cur[max_words:]
    if cur:
        out.append(" ".join(cur))
    return out


def _highlights(line: str, freq: Counter, limit: int = 2):
    scored = []
    for i, w in enumerate(re.findall(r"[\w'’$%.:/-]+", line)):
        bare = w.strip(".,;:!?'’")
        low = bare.lower()
        if not bare or low in STOP or len(bare) < 3:
            continue
        score = freq[low] * 0.5 + len(bare) * 0.1
        if any(c.isdigit() for c in bare):
            score += 3
        if bare[0].isupper() and i > 0:
            score += 2
        scored.append((score, bare))
    scored.sort(key=lambda s: -s[0])
    seen, out = set(), []
    for _, w in scored:
        if w.lower() not in seen:
            seen.add(w.lower())
            out.append(w)
        if len(out) == limit:
            break
    return out


def simplify_text(text: str, max_words: int = 10, max_lines: int = 12) -> dict:
    clean = strip_markdown(text)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", clean) if s.strip()]
    freq = Counter(w.lower() for w in re.findall(r"[A-Za-z]{4,}", clean) if w.lower() not in STOP)
    lines = []
    for s in sentences:
        for chunk in _chunks(s, max_words):
            chunk = chunk[:1].upper() + chunk[1:]
            lines.append({"text": chunk, "highlights": _highlights(chunk, freq)})
    truncated = len(lines) > max_lines
    return {"lines": lines[:max_lines], "truncated": truncated, "mode": "rules"}
