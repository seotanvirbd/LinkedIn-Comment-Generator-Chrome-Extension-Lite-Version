# AI LinkedIn Comment Generator (Lite) | Free Chrome Extension Using OpenAI, Gemini & Groq

A free, lightweight Chrome extension that adds an AI-powered "Generate" button to LinkedIn's comment boxes, letting you draft context-aware, human-sounding replies in one click — powered by your own OpenAI, Groq, or Google Gemini API key.

> 💎 **This is the Lite (free) edition.** It generates AI comment replies only. For AI-generated LinkedIn posts as well, upgrade to the **Premium** version.

<p align="center">
  <img src="icon.png" alt="AI LinkedIn Comment Generator Icon" width="140" />
</p>

---

## ✨ Features

- **🤖 One-Click AI Comments** — Adds an "AI Suggestion" button to every LinkedIn comment box. It reads the original post's author and text (plus the parent comment, if you're replying to a reply) and generates a short, human-sounding, context-aware reply.
- **🔌 Multi-Provider Support** — Works with:
  - **OpenAI** (`gpt-4o-mini`)
  - **Groq** (free tier — `llama-4-maverick-17b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`)
  - **Google Gemini** (free tier — `gemini-2.0-flash-lite`, `gemini-2.0-flash`, `gemini-2.5-flash`)
- **🧠 Dynamic Model Discovery** — Automatically fetches the latest available models from your chosen provider's API, with sensible fallback models baked in if the request fails.
- **🕵️ Resilient DOM Detection** — Uses layered CSS selector fallbacks and a MutationObserver (with a backup polling interval) so the comment button keeps appearing even as LinkedIn updates its UI.
- **✍️ Smart Text Insertion** — Inserts generated replies using a three-tier strategy (clipboard paste → `execCommand` → direct `innerHTML`) to reliably work with LinkedIn's rich-text comment editor.
- **🧹 Clean Output** — Strips stray Markdown syntax before inserting text so replies paste in as plain, natural text.
- **🔒 Local-Only Storage** — Your API key and provider choice are stored using `chrome.storage.local` and never leave your browser except to call the AI provider you selected.
- **🐞 Built-In Debug Logging** — Every action is logged to the console (and forwarded to the popup) with the function name and line number for easy troubleshooting.

### ⛔ Not included in Lite
- AI Post generation (the "AI Post" composer button)
- Topic-based post drafting overlay

These are available in the **Premium** version.

---

## 📦 Installation

1. **Download or clone this repository** to your computer.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the folder containing this extension's files (`manifest.json`, `content.js`, `popup.html`, `popup.js`, `icon.png`).
6. The extension icon will appear in your Chrome toolbar. Pin it for easy access.

---

## ⚙️ Configuration

1. Click the extension icon in your Chrome toolbar to open the popup.
2. Select your preferred **AI Provider**: `OpenAI`, `Groq (Free)`, or `Google Gemini (Free)`.
3. Paste your **API Key** for that provider into the input field.
4. Click **Save Configuration**.

Your settings are saved locally and restored automatically the next time you open the popup.

### Where to get an API key

| Provider | Get your key |
|---|---|
| OpenAI | https://platform.openai.com/api-keys |
| Groq | https://console.groq.com/keys |
| Google Gemini | https://aistudio.google.com/apikey |

---

## 🚀 Usage

### Generating a comment
1. Open LinkedIn and find a post you want to comment on.
2. Click the comment box to open the editor.
3. Click the small **AI Suggestion** (brain icon) button injected into the comment toolbar.
4. A context-aware reply is generated from the post's content and inserted directly into the comment box — edit as needed, then post it.

---

## 🗂️ Project Structure

```
├── manifest.json     # Chrome Extension (Manifest V3) configuration
├── content.js         # Core logic: DOM scanning, AI requests, UI injection, text insertion
├── popup.html          # Extension popup UI (provider & API key settings)
├── popup.js            # Popup logic — saves/restores settings via chrome.storage.local
└── icon.png            # Extension icon
```

### How it works under the hood
- **`Scanner`** continuously watches the LinkedIn DOM (via `MutationObserver` + a backup interval) for new comment boxes, then injects the AI Suggestion button.
- **`DomExtractor`** pulls the post author, post text, and any parent comment to build a relevant prompt.
- **`AIService`** sends that prompt to your selected provider's chat-completions endpoint, trying multiple models if needed, and returns clean generated text.
- **`EditorHandler`** inserts the generated text into LinkedIn's rich-text editor using multiple fallback strategies to guarantee compatibility.

---

## 🔐 Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | To save your API key and provider selection locally in the browser. |
| Host access to `linkedin.com` | To inject the AI Suggestion button into comment boxes. |
| Host access to `api.openai.com`, `api.groq.com`, `generativelanguage.googleapis.com` | To send your prompts directly to the AI provider you configured. |

No data is ever sent to any third-party server other than the AI provider you explicitly select and authenticate with your own key.

---

## ⚠️ Disclaimer

This is an independent, unofficial tool and is **not affiliated with, endorsed by, or sponsored by LinkedIn Corporation or any AI provider** mentioned above. LinkedIn's DOM structure may change at any time, which could temporarily break selector-based features until they're updated. Use responsibly and in accordance with LinkedIn's Terms of Service — this tool is intended to assist and speed up your own writing, not to enable spam or inauthentic engagement.

---

## 💎 Want AI Post Generation Too?

The **Premium** version adds a one-click "AI Post" button to LinkedIn's post composer — describe a topic and get a ready-to-publish post with a scroll-stopping hook and relevant hashtags. Contact the author below to upgrade.

---

## 🤝 Contributing

Issues and pull requests are welcome. If you find a broken selector or a new LinkedIn UI variant this extension doesn't handle, please open an issue with details (and console logs if possible).

---

## 👨‍💻 Author

**Mohammad Tanvir**

- 🔗 LinkedIn: [linkedin.com/in/seotanvirbd](https://www.linkedin.com/in/seotanvirbd/)
- 🌐 Website: [seotanvirbd.com](https://seotanvirbd.com/)
- 💼 Upwork: [Hire me on Upwork](https://www.upwork.com/freelancers/~010fc1db7bfe386976)
- 📧 Email: tanvirafra1@gmail.com

If this project saved you time, consider connecting on LinkedIn or leaving a ⭐ on the repo!

---

## 📄 License

This project is provided as-is for personal and educational use. Contact the author for commercial licensing inquiries.
