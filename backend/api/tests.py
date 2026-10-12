from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse  # noqa: F401

from api.models import Interview, TaughtSign, Trial
from api.services.intent import parse_glosses
from api.services.simplify import simplify_text

# The ten sentences from the Build Pack (section 3): (gloss, expected prompt, expected card fields)
PACK = [
    ("TODAY WEATHER WHAT", "What is the weather today?", {"task": "ask", "topic": "weather", "when": "today"}),
    ("THIS EXPLAIN EASY", "Explain this in simple words.", {"task": "explain", "topic": "current page/text", "style": "simple"}),
    ("I TEACHER EMAIL WRITE", "Write an email to my teacher.", {"task": "write", "type": "email", "recipient": "teacher"}),
    ("THIS HINDI TRANSLATE", "Translate this into Hindi.", {"task": "translate", "language": "Hindi"}),
    ("NEAR HOSPITAL WHERE", "Where is the nearest hospital?", {"task": "ask", "topic": "hospital", "filter": "nearest"}),
    ("AADHAAR APPLY HOW", "How do I apply for an Aadhaar card?", {"task": "how-to", "topic": "Aadhaar card application"}),
    ("MY EXAM WHEN", "When is my exam?", {"task": "ask", "topic": "exam date"}),
    ("THIS SHORT SUMMARY", "Summarise this in short.", {"task": "summarise", "length": "short"}),
    ("TOMORROW 5 I REMIND", "Remind me tomorrow at 5:00.", {"task": "reminder", "when": "tomorrow 5:00"}),
    ("I UNDERSTAND NOT AGAIN EXPLAIN", "I did not understand. Please explain it again in simpler words.", {"task": "re-explain", "style": "simpler"}),
]


# Casual chat (messages to friends, not requests to an AI assistant): (gloss, expected message)
CASUAL = [
    ("HELLO HOW YOU", "Hello, how are you?"),
    ("HELLO YOU HOW", "Hello, how are you?"),
    ("HELLO WHAT YOU DO", "Hello, what are you doing?"),
    ("HELLO YOU DO WHAT", "Hello, what are you doing?"),
    ("I FINE YOU HOW", "I am fine. How are you?"),
    ("THANK-YOU I FINE YOU HOW", "Thank you, I am fine. How are you?"),
    ("GOOD MORNING", "Good morning!"),
    ("HELLO FRIEND HOW YOU", "Hello friend, how are you?"),
    ("HELLO R-A-H-U-L HOW YOU", "Hello Rahul, how are you?"),
    ("YOU EAT", "Did you eat?"),
    ("I GO HOME", "I am going home."),
    ("YOU GO WHERE", "Where are you going?"),
    ("TOMORROW I COME", "I am coming tomorrow."),
    ("MEET TOMORROW 5", "Let's meet tomorrow at 5:00."),
    ("I MISS YOU", "I miss you."),
    ("HELLO", "Hello!"),
]


class IntentRulesTests(TestCase):
    def test_casual_chat_sentences(self):
        for glosses, message in CASUAL:
            with self.subTest(glosses):
                r = parse_glosses(glosses)
                self.assertEqual(r["prompt"], message)
                self.assertEqual(r["task"], "chat")

    def test_shortcuts_csv(self):
        for glosses in ("NEAR HOSPITAL", "HOSPITAL NEAR"):
            r = parse_glosses(glosses)
            self.assertEqual((r["prompt"], r["task"]), ("Where is the nearest hospital?", "shortcut"))
        self.assertEqual(parse_glosses("NEAR HOSPITAL WHERE")["prompt"], "Where is the nearest hospital?")

    def test_casual_words_do_not_hijack_ai_requests(self):
        self.assertEqual(parse_glosses("TODAY WEATHER WHAT")["task"], "ask")
        self.assertEqual(parse_glosses("AADHAAR APPLY HOW")["task"], "how-to")
        self.assertEqual(parse_glosses("I TEACHER EMAIL WRITE")["task"], "write")

    def test_build_pack_sentences(self):
        for glosses, prompt, expected in PACK:
            with self.subTest(glosses):
                r = parse_glosses(glosses)
                self.assertEqual(r["prompt"], prompt)
                for k, v in expected.items():
                    self.assertEqual(r[k], v, f"{k} for {glosses}")
                self.assertEqual(r["mode"], "rules")

    def test_fingerspelled_known_word(self):
        self.assertEqual(parse_glosses("A-A-D-H-A-A-R APPLY HOW")["task"], "how-to")

    def test_unknown_sign_lowers_confidence(self):
        r = parse_glosses("TODAY FLUBBER WHAT")
        self.assertLess(r["confidence"], 1)
        self.assertTrue(r["warnings"])

    def test_digits_become_clock(self):
        self.assertEqual(parse_glosses("TOMORROW 1 0 REMIND")["when"], "tomorrow 10:00")


class SimplifyTests(TestCase):
    def test_short_lines_and_highlights(self):
        text = ("**Aadhaar** is a 12-digit number issued by UIDAI, and you can apply at an enrolment centre near you, "
                "but you must carry proof of identity and proof of address.")
        out = simplify_text(text)
        self.assertGreater(len(out["lines"]), 1)
        self.assertTrue(all(len(l["text"].split()) <= 15 for l in out["lines"]))
        self.assertTrue(any(l["highlights"] for l in out["lines"]))
        self.assertNotIn("**", " ".join(l["text"] for l in out["lines"]))


class ApiTests(TestCase):
    def test_health_and_vocab_fallback(self):
        self.assertTrue(self.client.get("/api/health/").json()["ok"])
        self.assertGreaterEqual(len(self.client.get("/api/vocabulary/").json()["signs"]), 50)

    def test_load_vocab_command(self):
        call_command("load_vocab", verbosity=0)
        self.assertGreaterEqual(len(self.client.get("/api/vocabulary/").json()["signs"]), 50)

    def test_intent_endpoint(self):
        r = self.client.post("/api/intent/", {"glosses": ["TODAY", "WEATHER", "WHAT"]}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["prompt"], "What is the weather today?")
        self.assertEqual(self.client.post("/api/intent/", {"glosses": []}, content_type="application/json").status_code, 400)

    def test_simplify_endpoint(self):
        r = self.client.post("/api/simplify/", {"text": "Rain is likely today. Carry an umbrella."}, content_type="application/json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["lines"])

    def test_teach_roundtrip_and_validation(self):
        vec = [0.1] * 130
        r = self.client.post("/api/teach/", {"label": "hello", "samples": [vec, vec], "signer": "A"}, content_type="application/json")
        self.assertEqual(r.status_code, 201)
        got = self.client.get("/api/teach/").json()
        self.assertEqual(got["signs"][0]["label"], "HELLO")
        self.assertEqual(len(got["signs"][0]["samples"]), 2)
        bad = self.client.post("/api/teach/", {"label": "x", "samples": [[0.1] * 5]}, content_type="application/json")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(TaughtSign.objects.count(), 1)

    def test_trials_and_metrics(self):
        payload = {"signer": "Ravi", "held_out": True, "expected": ["A", "B"], "predicted": ["A", "C"],
                   "signs_expected": 2, "signs_correct": 1, "sanket_ms": 9000, "typing_ms": 20000}
        self.assertEqual(self.client.post("/api/trials/", payload, content_type="application/json").status_code, 201)
        m = self.client.get("/api/metrics/").json()
        self.assertEqual(m["accuracy_held_out"], 50.0)
        self.assertEqual(m["avg_sanket_s"], 9.0)


class PackTests(TestCase):
    def test_pack_endpoint_and_command(self):
        import json, os, tempfile
        from django.core.management import call_command
        vec = [0.123456] * 130
        for lab in ("HELLO", "HELLO", "YES"):
            TaughtSign.objects.create(label=lab, samples=[vec] * 30, signer="A")
        pack = self.client.get("/api/pack/?max=40").json()
        self.assertEqual(pack["feature_dim"], 130)
        by = {s["label"]: len(s["samples"]) for s in pack["signs"]}
        self.assertEqual(by, {"HELLO": 40, "YES": 30})          # 60 HELLO samples capped to 40
        self.assertEqual(pack["signs"][0]["samples"][0][0], 0.123)  # rounded
        self.assertIn("attachment", self.client.get("/api/pack/?download=1")["Content-Disposition"])
        out = os.path.join(tempfile.mkdtemp(), "signs.json")
        call_command("export_pack", "-o", out, verbosity=0)
        self.assertEqual(len(json.load(open(out))["signs"]), 2)


class WebTests(TestCase):
    def test_pages_render(self):
        Interview.objects.create(role="teacher", quote="Typing English is slow for my students.")
        Trial.objects.create(signer="x", signs_expected=1, signs_correct=1)
        for path in ("/", "/demo/", "/vocabulary/", "/validation/", "/metrics/"):
            with self.subTest(path):
                self.assertEqual(self.client.get(path).status_code, 200)
