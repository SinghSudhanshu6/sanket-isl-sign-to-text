import json

from django.conf import settings
from django.core.management.base import BaseCommand

from api.services.pack import build_pack


class Command(BaseCommand):
    help = "Write the sign pack (taught landmark samples) into the extension: extension/model/signs.json"

    def add_arguments(self, parser):
        parser.add_argument("-o", "--output", default=str(settings.EXTENSION_DIR / "model" / "signs.json"))
        parser.add_argument("--max-per-label", type=int, default=40)

    def handle(self, *args, **opts):
        pack = build_pack(max_per_label=opts["max_per_label"])
        with open(opts["output"], "w", encoding="utf-8") as f:
            json.dump(pack, f, separators=(",", ":"))
        n = sum(len(s["samples"]) for s in pack["signs"])
        self.stdout.write(self.style.SUCCESS(f"Sign pack written: {len(pack['signs'])} signs, {n} samples -> {opts['output']}"))
        if not pack["signs"]:
            self.stdout.write(self.style.WARNING("No taught signs yet - teach some in the Studio (/demo/) first."))
