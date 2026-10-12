from django.db.models import Avg, Sum

from api.models import Trial


def summary() -> dict:
    """Numbers for the Round-2 slide: accuracy on unseen signers + time-to-prompt vs typing."""
    out = {"trials": Trial.objects.count()}
    held = Trial.objects.filter(held_out=True)
    for key, qs in (("held_out", held), ("all", Trial.objects.all())):
        agg = qs.aggregate(c=Sum("signs_correct"), e=Sum("signs_expected"))
        out[f"accuracy_{key}"] = round(100 * agg["c"] / agg["e"], 1) if agg["e"] else None
    both = Trial.objects.filter(sanket_ms__isnull=False, typing_ms__isnull=False)
    agg = both.aggregate(s=Avg("sanket_ms"), t=Avg("typing_ms"))
    out["avg_sanket_s"] = round(agg["s"] / 1000, 1) if agg["s"] else None
    out["avg_typing_s"] = round(agg["t"] / 1000, 1) if agg["t"] else None
    out["timed_trials"] = both.count()
    out["held_out_trials"] = held.count()
    return out
