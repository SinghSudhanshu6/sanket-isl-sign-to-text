"""Sanket - Django settings (env-driven, SQLite by default)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
EXTENSION_DIR = BASE_DIR.parent / "extension"


def _load_dotenv():
    path = BASE_DIR / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()


def env(name, default=""):
    return os.environ.get(name, default)


SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = env("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = [h.strip() for h in env("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost,testserver").split(",") if h.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "api",
    "web",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "sanket_project.urls"
WSGI_APPLICATION = "sanket_project.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Static files -----------------------------------------------------------
# Browser code (core.js, app.js, sanket.css) and MediaPipe vendor files live in /extension and
# are served by Django too, so the demo page and the Chrome extension share exactly one copy.
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [
    ("sanket", EXTENSION_DIR / "lib"),
    ("vendor", EXTENSION_DIR / "vendor"),
]

# --- REST framework ---------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],  # anonymous API (no CSRF friction for the extension)
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {"llm": "60/min", "teach": "30/min"},
}

# --- CORS (extension + local dev) -------------------------------------------
CORS_URLS_REGEX = r"^/api/.*$"
CORS_ALLOWED_ORIGIN_REGEXES = [r"^chrome-extension://[a-z]{32}$"]
CORS_ALLOWED_ORIGINS = [o.strip() for o in env("SANKET_CORS_ORIGINS").split(",") if o.strip()]

# --- Sanket ----------------------------------------------------------------
SANKET = {
    "FEATURE_DIM": 130,  # 2 hands x (21 landmarks x 3 + wrist x,y). Keep in sync with extension/lib/core.js
    "MAX_SAMPLES_PER_POST": 200,
    "ANTHROPIC_API_KEY": env("ANTHROPIC_API_KEY"),
    "LLM_MODEL": env("SANKET_LLM_MODEL", "claude-sonnet-5-5"),
    "LLM_TIMEOUT": 20,
    "VOCAB_CSV": BASE_DIR / "data" / "vocabulary.csv",
}
