from django.urls import path

from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("demo/", views.demo, name="demo"),
    path("vocabulary/", views.vocabulary, name="vocabulary"),
    path("validation/", views.validation, name="validation"),
    path("metrics/", views.metrics, name="metrics"),
]
