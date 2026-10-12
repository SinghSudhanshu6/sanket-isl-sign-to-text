import math

from django.conf import settings
from rest_framework import serializers

from .models import Trial


class IntentRequest(serializers.Serializer):
    glosses = serializers.ListField(child=serializers.CharField(max_length=40), min_length=1, max_length=40)


class SimplifyRequest(serializers.Serializer):
    text = serializers.CharField(max_length=8000)


class TeachRequest(serializers.Serializer):
    label = serializers.RegexField(r"^[A-Za-z0-9-]{1,40}$", max_length=40)
    samples = serializers.ListField(child=serializers.ListField(child=serializers.FloatField()), min_length=1)
    signer = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    client_id = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")

    def validate_samples(self, value):
        cfg = settings.SANKET
        if len(value) > cfg["MAX_SAMPLES_PER_POST"]:
            raise serializers.ValidationError(f"At most {cfg['MAX_SAMPLES_PER_POST']} samples per request.")
        for vec in value:
            if len(vec) != cfg["FEATURE_DIM"]:
                raise serializers.ValidationError(f"Each sample must have {cfg['FEATURE_DIM']} numbers.")
            if not all(math.isfinite(x) and abs(x) < 100 for x in vec):
                raise serializers.ValidationError("Samples contain invalid numbers.")
        return value

    def validate_label(self, value):
        return value.upper()


class TrialSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trial
        fields = ["signer", "held_out", "expected", "predicted", "signs_expected", "signs_correct", "sanket_ms", "typing_ms"]
