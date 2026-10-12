from itertools import groupby

from django.db.models import Count
from django.shortcuts import render

from api.models import Interview, Sign
from api.services import glossary, llm
from api.services import metrics as metrics_service


def home(request):
    return render(request, "web/home.html")


def demo(request):
    return render(request, "web/demo.html", {"llm": llm.enabled()})


def vocabulary(request):
    signs = list(Sign.objects.all())
    if not signs:
        rows = [{"gloss": e.gloss, "english": e.english, "group": e.group, "kind": e.kind, "islrtc_verified": False}
                for e in glossary.lexicon().values()]
    else:
        rows = [{"gloss": s.gloss, "english": s.english, "group": s.group, "kind": s.kind, "islrtc_verified": s.islrtc_verified}
                for s in signs]
    rows.sort(key=lambda r: r["group"])
    groups = [(g, list(items)) for g, items in groupby(rows, key=lambda r: r["group"])]
    return render(request, "web/vocabulary.html", {"groups": groups, "total": len(rows)})


def validation(request):
    qs = Interview.objects.filter(show_publicly=True)
    by_role = {r["role"]: r["n"] for r in qs.values("role").annotate(n=Count("id"))}
    labels = dict(Interview.Role.choices)
    counts = [(labels[k], v) for k, v in by_role.items()]
    return render(request, "web/validation.html", {
        "total": qs.count(),
        "counts": counts,
        "quotes": qs.exclude(quote="")[:6],
        "workarounds": qs.exclude(workaround="").values_list("workaround", flat=True).distinct()[:6],
    })


def metrics(request):
    return render(request, "web/metrics.html", {"m": metrics_service.summary()})
