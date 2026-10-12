from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from .models import Sign, TaughtSign
from .serializers import IntentRequest, SimplifyRequest, TeachRequest, TrialSerializer
from .services import glossary, llm, metrics
from .services.pack import build_pack
from .services.intent import CARD_KEYS, parse_glosses
from .services.simplify import simplify_text


class LLMThrottle(ScopedRateThrottle):
    scope = "llm"


class TeachThrottle(ScopedRateThrottle):
    scope = "teach"


@api_view(["GET"])
def health(request):
    return Response({"ok": True, "llm": llm.enabled(), "feature_dim": settings.SANKET["FEATURE_DIM"]})


@api_view(["GET"])
def vocabulary(request):
    signs = list(Sign.objects.values("gloss", "english", "group", "kind", "islrtc_verified"))
    if not signs:  # DB not seeded yet -> serve the CSV
        signs = [
            {"gloss": e.gloss, "english": e.english, "group": e.group, "kind": e.kind, "islrtc_verified": False}
            for e in glossary.lexicon().values()
        ]
    return Response({"signs": signs})


@api_view(["POST"])
@throttle_classes([LLMThrottle])
def intent(request):
    """Sign sequence in -> intent card + English prompt out."""
    ser = IntentRequest(data=request.data)
    ser.is_valid(raise_exception=True)
    glosses = ser.validated_data["glosses"]
    result = parse_glosses(glosses)  # always computed: it is the fallback and the safety net

    # casual chat ("Hello, how are you?") is sent exactly as the rule engine wrote it; only AI-assistant requests get the optional AI wording
    ai = llm.build_intent(result["glosses"]) if llm.enabled() and result["task"] not in ("chat", "shortcut") else None
    if ai:
        for key in CARD_KEYS:
            result[key] = ai.get(key) if isinstance(ai.get(key), (str, type(None))) else result[key]
        result["prompt"] = str(ai["prompt"]).strip()[:500]
        result["mode"] = "llm"
    return Response(result)


@api_view(["POST"])
@throttle_classes([LLMThrottle])
def simplify(request):
    """Chatbot reply in -> short lines with highlighted key words out."""
    ser = SimplifyRequest(data=request.data)
    ser.is_valid(raise_exception=True)
    text = ser.validated_data["text"]
    lines = llm.simplify(text) if llm.enabled() else None
    if lines:
        return Response({"lines": lines, "truncated": False, "mode": "llm"})
    return Response(simplify_text(text))


@api_view(["GET", "POST"])
@throttle_classes([TeachThrottle])
def teach(request):
    """GET: every stored landmark sample (the browser trains its kNN classifier from this).
    POST: save a 'Teach Sanket a sign' recording. Landmark vectors only - no video."""
    if request.method == "POST":
        ser = TeachRequest(data=request.data)
        ser.is_valid(raise_exception=True)
        obj = TaughtSign.objects.create(**ser.validated_data)
        return Response({"id": obj.id, "label": obj.label, "stored": obj.sample_count}, status=status.HTTP_201_CREATED)

    grouped = {}
    for row in TaughtSign.objects.values("label", "samples", "signer"):
        g = grouped.setdefault(row["label"], {"label": row["label"], "samples": [], "signers": set()})
        g["samples"].extend(row["samples"])
        if row["signer"]:
            g["signers"].add(row["signer"])
    signs = [{**g, "signers": sorted(g["signers"])} for g in grouped.values()]
    return Response({"signs": signs, "feature_dim": settings.SANKET["FEATURE_DIM"]})


@api_view(["POST"])
def trials(request):
    ser = TrialSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(metrics.summary(), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def metrics_summary(request):
    return Response(metrics.summary())


@api_view(["GET"])
def pack(request):
    """The sign pack for the recognition-only extension. ?download=1 sends it as signs.json."""
    try:
        per = max(5, min(200, int(request.query_params.get("max", 40))))
    except ValueError:
        per = 40
    resp = Response(build_pack(max_per_label=per))
    if request.query_params.get("download"):
        resp["Content-Disposition"] = 'attachment; filename="signs.json"'
    return resp
