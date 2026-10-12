from django.db import models


class Sign(models.Model):
    """One entry of the ~50-sign starter vocabulary (Build Pack, section 4)."""

    class Kind(models.TextChoices):
        STATIC = "static", "Static (single pose)"
        DYNAMIC = "dynamic", "Dynamic (movement)"

    gloss = models.CharField(max_length=40, unique=True)
    english = models.CharField(max_length=80)
    group = models.CharField(max_length=60)
    role = models.CharField(max_length=20, blank=True, help_text="Grammar role used by the rule engine")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.DYNAMIC)
    islrtc_verified = models.BooleanField(
        default=False, help_text="Tick once the sign is checked against the ISLRTC dictionary / a real signer"
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["group", "gloss"]

    def __str__(self):
        return self.gloss


class TaughtSign(models.Model):
    """A recording session from 'Teach Sanket a sign'. Stores landmark vectors only - never video."""

    label = models.CharField(max_length=40, db_index=True)
    samples = models.JSONField(help_text="List of feature vectors (see SANKET['FEATURE_DIM'])")
    signer = models.CharField(max_length=60, blank=True, help_text="Who recorded it (needed for held-out testing)")
    client_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def sample_count(self):
        return len(self.samples or [])

    def __str__(self):
        return f"{self.label} ({self.sample_count} samples, {self.signer or 'anon'})"


class Trial(models.Model):
    """One measured demo/test run - feeds the Round-2 'accuracy' and 'time-to-prompt vs typing' slide."""

    signer = models.CharField(max_length=60)
    held_out = models.BooleanField(default=False, help_text="Signer NOT in the training data")
    expected = models.JSONField(default=list, help_text="Glosses the signer intended")
    predicted = models.JSONField(default=list, help_text="Glosses Sanket recognised (after top-3 corrections)")
    signs_expected = models.PositiveIntegerField(default=0)
    signs_correct = models.PositiveIntegerField(default=0)
    sanket_ms = models.PositiveIntegerField(null=True, blank=True, help_text="First sign -> prompt confirmed")
    typing_ms = models.PositiveIntegerField(null=True, blank=True, help_text="Same request, typed by the same person")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.signer}: {self.signs_correct}/{self.signs_expected}"


class Interview(models.Model):
    """Evidence for pitch-deck slide 2 (Validation). Fill with REAL interviews only."""

    class Role(models.TextChoices):
        USER = "isl_user", "ISL user"
        INTERPRETER = "interpreter", "Interpreter"
        TEACHER = "teacher", "Deaf-school teacher"
        OTHER = "other", "Other"

    role = models.CharField(max_length=20, choices=Role.choices)
    quote = models.TextField(blank=True, help_text="Short, paraphrased quote about the pain point")
    workaround = models.CharField(max_length=200, blank=True, help_text="What they do today instead")
    interviewed_on = models.DateField(null=True, blank=True)
    show_publicly = models.BooleanField(default=True)

    class Meta:
        ordering = ["-interviewed_on", "-id"]

    def __str__(self):
        return f"{self.get_role_display()} ({self.interviewed_on or 'undated'})"
