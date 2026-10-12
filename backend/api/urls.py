from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health),
    path("vocabulary/", views.vocabulary),
    path("intent/", views.intent),
    path("simplify/", views.simplify),
    path("teach/", views.teach),
    path("trials/", views.trials),
    path("metrics/", views.metrics_summary),
    path("pack/", views.pack),
]
