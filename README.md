# Sanket: sign language to text, on any website

**Team Code Mavricks** 

> Sign in front of your camera. Sanket reads Indian Sign Language (ISL) on your device and types the sentence into the text box you are already using: WhatsApp Web, Instagram, Google search, Maps, ChatGPT, Claude, Gemini and more.

**Demo video:** https://drive.google.com/file/d/1j9r9tosUhqahLT2q0pyuPYooUI0gbwp7/view?usp=sharing

## The problem

Most of the web assumes you can type fluently in a spoken language. For many deaf and hard-of-hearing people whose first language is sign language, writing a message or a prompt is slower and harder than signing it. Sanket lets a person sign naturally and turns it into a ready-to-send sentence in whatever app they are using, with no new app to learn.

## How it works

```
Camera → MediaPipe hand landmarks (on-device) → sign classifier → sign sequence (glosses)
       → intent card (you confirm) → sentence typed into the active text box
       → (AI chatbots only) the reply is rewritten into short lines with key words highlighted
```

- **Privacy first:** video never leaves your device. Only 130-number landmark vectors are stored, never images or video.
- **You stay in control:** the sentence is placed in the box, but **you press Send**. A wrong sign should never become a sent message. An optional 3-second countdown can send automatically if you turn it on.
- **Works offline after syncing:** the extension keeps a saved copy of your signs.

## Quick start

```bash
# 1. Run the Studio (teach signs, test, measure)
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate && python manage.py load_vocab
python manage.py runserver                            # open http://127.0.0.1:8000/demo/

# 2. Install the extension (Chrome or Edge)
#    Open chrome://extensions or edge://extensions → Developer mode → Load unpacked → select the `extension` folder
```

Then teach a few signs in the Studio, open the extension panel, press **Sync signs now**, click a text box on any site and start signing.

## Project structure

```
sanket/
  backend/     Django + DRF: api/intent, api/simplify, api/teach, api/trials, api/metrics
               plus demo / vocabulary / validation / metrics pages
  extension/   Chrome / Edge (Chromium) Manifest V3 side panel + content script
               lib/ (core.js, app.js, sanket.css) is shared with the Django demo page
  ml/          collect.py, train.py, export_tfjs.py (optional MLP/LSTM upgrade over the built-in kNN)
  docs/        DEMO_SCRIPT.md, DEPLOY_PYTHONANYWHERE.md, CASUAL_AND_SHORTCUTS.md
```

## Studio and extension

| | **Studio** (`backend/`, runs on localhost) | **Extension** (`extension/`) |
|---|---|---|
| Teach / train signs with the camera | **Yes** (`/demo/`) | No |
| Recognise signs | Yes | Yes, using signs from the Studio |
| Measure accuracy, validation, admin | Yes | No |
| Types the sentence into the text box you are using | Into a mock chatbox | **Automatically** (you press Send) |

**How they connect:** you teach a sign in the Studio and it is saved in the Studio's database. The extension fetches the signs from `http://127.0.0.1:8000/api/pack/` when its panel opens (or when you press **Sync signs now**), keeps a saved copy, and then recognises signs offline. No file copying.

Start the Studio at least once to sync. After that the extension keeps working from its saved copy even when the Studio is off. To let others use it without your laptop, deploy the Studio (see `docs/DEPLOY_PYTHONANYWHERE.md`) and put its URL in the extension's Settings, or download `signs.json` from the Studio page and bundle it in `extension/model/`.

## What you can sign

**Casual messages** (WhatsApp, Instagram, ...) and **AI requests** both work. Glosses follow ISL-style grammar, with the question word last.

| Sign these glosses | Sentence typed into the box |
|---|---|
| `HELLO HOW YOU` | Hello, how are you? |
| `I FINE YOU HOW` | I am fine. How are you? |
| `GOOD MORNING` | Good morning! |
| `MEET TOMORROW 5` | Let's meet tomorrow at 5:00. |
| `NEAR HOSPITAL` (a shortcut) | Where is the nearest hospital? |

Requests that contain AI-task words (EXPLAIN, WRITE, REMIND...) or topics (WEATHER, EXAM...) become AI prompts, and the chatbot's reply is rewritten into short lines with key words highlighted.

**Shortcuts:** a short sign key can map to an exact sentence by editing `backend/data/shortcuts.csv`. Full details, the word list, and how to extend the rules are in [`docs/CASUAL_AND_SHORTCUTS.md`](docs/CASUAL_AND_SHORTCUTS.md).

## Optional: AI wording

Add `ANTHROPIC_API_KEY` to `backend/.env` to let the server polish AI prompts and simplify chatbot replies. The key stays on the server. Everything also works without it using the built-in rule engine. Casual sentences and shortcuts are never rewritten by the AI.

## Tests

```bash
cd backend
python manage.py test
```

## Current limitations and future work

We want to be clear about what is finished and what is not.

- **Signs are taught, not pre-loaded.** The vocabulary (85 words) is text labels. The recogniser is a kNN over landmark vectors, so it knows only the signs taught in the Studio (about 100 samples per sign from 3 or more people works best). With an empty sign pack the extension recognises nothing.
- **Sign accuracy has not been verified by an ISL expert yet.** Glosses and signs still need review against ISLRTC resources and an ISL interpreter or teacher. Each word has a *verified* flag in the admin for this.
- **User validation is in progress.** Interviews can be recorded in `/admin/api/interview/` and are shown on `/validation/`. Nothing is fabricated.
- **Accuracy and speed measurements:** the *Measure* panel and `/metrics/` compare accuracy and time-to-prompt against typing. Trials from signers not in the training data are marked separately.
- **Facial grammar is not detected.** Eyebrow cues (WH vs yes/no question) are not read, so the confirm card lets the user check the sentence.
- **Site compatibility is heuristic.** The text-box finder and Send/reply selectors in `extension/content.js` depend on each site's markup, which can change.
- **Browser testing:** the backend, rule engine and UI logic are tested headlessly. Live camera with MediaPipe on the real sites should be re-checked on your own machine.
- **Public launch needs auth.** The API is anonymous with rate limits. Add authentication before any public deployment.

**Future work:** a stronger MLP/LSTM model from `ml/`, more signs and signers, expert-verified vocabulary, facial-grammar detection, and Firefox support.

## Data flow and privacy

Only landmark vectors are stored (`TaughtSign`), never video. To train your own model:

```bash
python manage.py export_samples -o ../ml/data/samples.csv
python ml/train.py
```
