"""Optional LLM layer (Anthropic Messages API over plain HTTPS). The API key stays on the server.

Every function returns None on any problem so callers can fall back to the rule engine.
"""
import json
import logging
import re

import requests
from django.conf import settings

log = logging.getLogger(__name__)
API_URL = "https://api.anthropic.com/v1/messages"


def enabled() -> bool:
    return bool(settings.SANKET["ANTHROPIC_API_KEY"])


def _call(system: str, user: str, max_tokens: int = 600):
    if not enabled():
        return None
    try:
        r = requests.post(
            API_URL,
            headers={
                "x-api-key": settings.SANKET["ANTHROPIC_API_KEY"],
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": settings.SANKET["LLM_MODEL"],
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=settings.SANKET["LLM_TIMEOUT"],
        )
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))
    except Exception as exc:  # network, quota, bad key ...
        log.warning("LLM call failed: %s", exc)
        return None


def _json_from(text):
    if not text:
        return None
    text = re.sub(r"```(?:json)?", "", text).strip()
    try:
        return json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except ValueError:
                return None
    return None


INTENT_SYSTEM = (
    "These are Indian Sign Language glosses in ISL word order (mostly Subject-Object-Verb, time words first, "
    "WH-words last, no articles or 'is/am/are', NOT after the verb). The signer is a Deaf person talking to an "
    "AI chatbot. Return ONLY JSON with keys: task, topic, recipient, when, style, language, length, filter, type, "
    "prompt. Use null for unknown fields. 'prompt' is ONE clear, natural English request the chatbot can act on. "
    "Do not invent details that are not in the glosses."
)


def build_intent(glosses: list):
    data = _json_from(_call(INTENT_SYSTEM, "Glosses: " + " ".join(glosses)))
    if not isinstance(data, dict) or not data.get("prompt") or not data.get("task"):
        return None
    return data


SIMPLIFY_SYSTEM = (
    "Rewrite the text for a Deaf reader whose first language is Indian Sign Language, so plain short English "
    "works best. Use very short lines (max 10 words), simple words, no idioms, keep every important fact and "
    "number. Return ONLY JSON: {\"lines\": [{\"text\": str, \"highlights\": [key words copied exactly from text]}]}. "
    "Max 10 lines, max 3 highlights per line."
)


def simplify(text: str):
    data = _json_from(_call(SIMPLIFY_SYSTEM, text[:6000], max_tokens=900))
    if not isinstance(data, dict) or not isinstance(data.get("lines"), list):
        return None
    lines = []
    for item in data["lines"][:10]:
        if isinstance(item, dict) and isinstance(item.get("text"), str) and item["text"].strip():
            hl = [h for h in item.get("highlights", []) if isinstance(h, str) and h in item["text"]][:3]
            lines.append({"text": item["text"].strip(), "highlights": hl})
    return lines or None
