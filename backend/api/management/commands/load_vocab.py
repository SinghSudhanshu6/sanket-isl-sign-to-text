from django.core.management.base import BaseCommand

from api.models import Sign
from api.services.glossary import lexicon


class Command(BaseCommand):
    help = "Seed / refresh the Sign table from data/vocabulary.csv (keeps your 'verified' ticks)."

    def handle(self, *args, **opts):
        created = 0
        for e in lexicon().values():
            _, new = Sign.objects.update_or_create(
                gloss=e.gloss, defaults={"english": e.english, "group": e.group, "role": e.role, "kind": e.kind}
            )
            created += new
        self.stdout.write(self.style.SUCCESS(f"Vocabulary ready: {Sign.objects.count()} signs ({created} new)."))
