from django.contrib import admin

from .models import Interview, Sign, TaughtSign, Trial


@admin.register(Sign)
class SignAdmin(admin.ModelAdmin):
    list_display = ("gloss", "english", "group", "kind", "islrtc_verified")
    list_filter = ("group", "kind", "islrtc_verified")
    search_fields = ("gloss", "english")
    list_editable = ("islrtc_verified",)


@admin.register(TaughtSign)
class TaughtSignAdmin(admin.ModelAdmin):
    list_display = ("label", "sample_count", "signer", "created_at")
    list_filter = ("label", "signer")
    exclude = ("samples",)  # large JSON blob; export with `manage.py export_samples`


@admin.register(Trial)
class TrialAdmin(admin.ModelAdmin):
    list_display = ("signer", "held_out", "signs_correct", "signs_expected", "sanket_ms", "typing_ms", "created_at")
    list_filter = ("held_out",)


@admin.register(Interview)
class InterviewAdmin(admin.ModelAdmin):
    list_display = ("role", "interviewed_on", "show_publicly")
    list_filter = ("role",)
