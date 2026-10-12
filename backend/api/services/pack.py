"""Build the 'sign pack' (signs.json) that the recognition-only browser extension ships with."""
import random

from django.conf import settings
from django.utils import timezone

from api.models import TaughtSign


def build_pack(max_per_label: int = 40, decimals: int = 3, seed: int = 7) -> dict:
    """Merge every taught recording per label, cap samples per label (keeps the file small) and round."""
    rng = random.Random(seed)
    grouped = {}
    for row in TaughtSign.objects.values("label", "samples"):
        grouped.setdefault(row["label"], []).extend(row["samples"])
    signs = []
    for label in sorted(grouped):
        samples = grouped[label]
        if len(samples) > max_per_label:
            samples = rng.sample(samples, max_per_label)
        signs.append({"label": label, "samples": [[round(x, decimals) for x in v] for v in samples]})
    return {
        "feature_dim": settings.SANKET["FEATURE_DIM"],
        "version": 1,
        "created": timezone.now().isoformat(timespec="seconds"),
        "signs": signs,
    }
