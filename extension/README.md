# Sanket - browser extension (recognition only, works on any website)

Sign in front of your camera; Sanket joins 3-4 signs into one sentence and types it into the text box you are using
on **any website** - WhatsApp Web, Instagram, Google search, Gmail, ChatGPT, Claude, Gemini and so on. You press Send.
**Click inside the box you want to type in first** (that is how Sanket knows where to write); it uses the last box you clicked on that tab. Hand tracking, recognition, sentence building
and answer simplification all run inside the browser. No video is ever recorded or sent anywhere.

## Install (Chrome, Edge, Brave and other Chromium browsers on Windows / Mac / Linux / ChromeOS)
1. Unzip, open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
2. **Load unpacked** and pick the folder that contains `manifest.json`.
3. Open any site (e.g. web.whatsapp.com), click inside a message box, click the Sanket icon, press **Start camera**.
   After updating the extension, press the reload icon on `edge://extensions` and refresh the site tabs.
(Not supported: Chrome/Safari on phones, Firefox. To share with non-developers, publish it to the Chrome Web Store / Edge Add-ons.)

## How a sentence is finished (nothing to click)
Sign 3-4 words. The sentence ends by itself when any of these happens, then goes into the chat box:
- it sounds complete: the last sign is a question word (WHAT, WHERE, WHEN, HOW, WHY, WHO) or a final verb (WRITE, TRANSLATE, SUMMARY, REMIND, SEND, SEARCH, READ) - about 0.6 s later;
- nothing new is signed for the pause time (Settings, default 1.6 s), even if your hand stays in view;
- your hand leaves the camera for the pause time, or 6 signs are reached.
You still press Send in the chatbot. Optional: Settings -> "Also press Send for me" (off by default) sends after a 3 s countdown with a Cancel button.

## Where the signs come from
The extension has **no training**. You teach signs in the Sanket Studio (Django, `python manage.py runserver`, page `/demo/`).
When the side panel opens, or when you press **Sync signs now**, the extension fetches those signs from the Studio
(`http://127.0.0.1:8000` by default; change it in Settings), saves a copy, and uses it offline afterwards.
If the Studio is off it uses the saved copy; if there is none, it uses `model/signs.json` (empty until you export one).
With no signs at all the camera recognises nothing; typing glosses and the Quick examples still work.

## Where it can and cannot type
- Works in normal `http(s)` pages: plain text boxes, search boxes and rich editors (WhatsApp Web, Instagram, Slack, Gmail, ChatGPT...).
- If the box already holds something you typed, the sentence is **added** to it; if it holds only Sanket's previous sentence, it is **replaced**.
- Never writes into password, number or card fields.
- Not possible: browser pages (`edge://`, new tab, Edge Add-ons store), the PDF viewer, and boxes inside embedded frames (e.g. Google Docs). Desktop apps (the WhatsApp Windows app) are not browser pages - use their web versions.
- "Use reply / selected text" simplifies the text you highlighted on the page; with nothing highlighted it reads the last assistant reply (ChatGPT/Claude/Gemini) or the last received message (WhatsApp Web).

## Optional AI wording
Settings → "Use the Studio for AI wording". Off by default (offline rules). The API key stays on the Studio server, never in the extension.

## Privacy
The extension asks for access to all websites only so it can type into the box you choose. The page script reads nothing unless the side panel asks (to type, to press Send, or to read the text you highlighted).
Camera frames stay on the device and are never recorded. The extension only downloads sign data from your own Studio.
With AI wording on, only the recognised sign names / text are sent to the Studio.
