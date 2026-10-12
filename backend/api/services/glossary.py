"""Vocabulary / lexicon loader. data/vocabulary.csv is the single source of truth."""
import csv
import re
from pathlib import Path
from dataclasses import dataclass
from functools import lru_cache

from django.conf import settings


@dataclass(frozen=True)
class Entry:
    gloss: str
    english: str
    group: str
    role: str
    kind: str


@lru_cache(maxsize=1)
def lexicon() -> dict:
    out = {}
    with open(settings.SANKET["VOCAB_CSV"], newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[row["gloss"].upper()] = Entry(row["gloss"].upper(), row["english"], row["group"], row["role"], row["kind"])
    return out


_ALIASES = {"ME": "I", "THANKS": "THANK-YOU", "THANKYOU": "THANK-YOU", "SUMMARISE": "SUMMARY", "SUMMARIZE": "SUMMARY",
            "DOING": "DO", "EATING": "EAT", "GOING": "GO", "COMING": "COME", "OK": "FINE", "OKAY": "FINE",
            "GOODBYE": "BYE", "BYE-BYE": "BYE"}
_FINGERSPELL = re.compile(r"^[A-Z](-[A-Z])+$")


@dataclass
class Token:
    gloss: str
    role: str  # lexicon role, or "fingerspelled" / "unknown"
    english: str


def normalize_tokens(raw) -> list:
    """Accepts 'TODAY WEATHER WHAT' or ['TODAY', 'WEATHER', 'WHAT'] (and fingerspelling 'A-A-D-H-A-A-R')."""
    if isinstance(raw, str):
        raw = raw.replace(",", " ").split()
    lex = lexicon()
    tokens = []
    for item in raw:
        g = str(item).strip().upper()
        if not g:
            continue
        g = _ALIASES.get(g, g)
        if g in lex:
            e = lex[g]
            tokens.append(Token(e.gloss, e.role, e.english))
        elif _FINGERSPELL.match(g):
            word = g.replace("-", "")
            if word in lex:  # fingerspelled form of a known word, e.g. A-A-D-H-A-A-R
                e = lex[word]
                tokens.append(Token(e.gloss, e.role, e.english))
            else:
                tokens.append(Token(word, "fingerspelled", word.title()))
        else:
            tokens.append(Token(g, "unknown", g.lower()))
    return tokens


@lru_cache(maxsize=1)
def shortcuts() -> tuple:
    """data/shortcuts.csv -> ((frozenset of glosses, sentence), ...). A short sign sequence that always types one exact sentence."""
    path = Path(settings.SANKET["VOCAB_CSV"]).with_name("shortcuts.csv")
    out = []
    if path.exists():
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                keys, sentence = (row.get("glosses") or "").strip(), (row.get("sentence") or "").strip()
                if keys and sentence and not keys.startswith("#"):
                    out.append((frozenset(t.gloss for t in normalize_tokens(keys)), sentence))
    return tuple(out)
