import csv
import sys

from django.core.management.base import BaseCommand

from api.models import TaughtSign


class Command(BaseCommand):
    help = "Export taught landmark samples to CSV for ml/train.py:  label,signer,f0..f129"

    def add_arguments(self, parser):
        parser.add_argument("-o", "--output", default="-", help="CSV path (default: stdout)")

    def handle(self, *args, **opts):
        out = sys.stdout if opts["output"] == "-" else open(opts["output"], "w", newline="")
        w = csv.writer(out)
        n = 0
        for ts in TaughtSign.objects.all().iterator():
            for vec in ts.samples:
                if n == 0:
                    w.writerow(["label", "signer"] + [f"f{i}" for i in range(len(vec))])
                w.writerow([ts.label, ts.signer] + [round(x, 5) for x in vec])
                n += 1
        if out is not sys.stdout:
            out.close()
        self.stderr.write(f"Exported {n} samples.")
