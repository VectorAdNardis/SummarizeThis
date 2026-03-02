# Summarize This

By [VectorAdNardis](https://github.com/VectorAdNardis)

A Chrome extension that summarizes any web page or PDF using a local LLM via [LM Studio](https://lmstudio.ai/) (or any OpenAI-compatible API).

All processing happens locally — no data is sent to external servers.

## Features

- **One-click summaries** of any web page or PDF
- **Extend** a brief summary into a detailed one (auto-retries if the model's context window is too small)
- **Chat** — ask follow-up questions about the page content
- **History** — previously summarized pages are cached and restored automatically
- **Export** — save summaries as `.md` files or copy to clipboard
- **PDF support** — extracts text from PDF files via PDF.js
- **Configurable** — API endpoint, model name, max input length, summary format (plain text / markdown), export settings

### Privacy

Everything stays on your machine. Summaries, chat history, and settings are stored in the browser's local storage — nothing is sent to the cloud or shared with third parties. The only network request the extension makes is to your own LLM server (localhost by default). There is no analytics, telemetry, or tracking of any kind.

## Prerequisites

You need a local LLM server running an OpenAI-compatible chat completions endpoint. The easiest option:

1. Download and install **[LM Studio](https://lmstudio.ai/)** (free, runs on macOS, Windows, and Linux)
2. Open LM Studio and download a model (recommended: any 7B–14B parameter model, e.g. Llama 3, Mistral, Qwen)
3. Go to the **Local Server** tab (left sidebar, the `<->` icon)
4. Click **Start Server** — it will start on `http://localhost:1234` by default

> **Tip:** If you're on a machine with limited RAM, use a smaller quantized model (e.g. Q4_K_M). For better extended summaries, use a model with a larger context window (8K+ tokens).

### Alternative LLM servers

Any server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint will work:

- [Ollama](https://ollama.com/) — use endpoint `http://localhost:11434/v1/chat/completions`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — use endpoint `http://localhost:8080/v1/chat/completions`
- [LocalAI](https://localai.io/)
- Any remote OpenAI-compatible API (update the endpoint in settings)

## Installation

### Step 1: Get the extension files

**Option A — Clone the repo:**

```bash
git clone https://github.com/VectorAdNardis/SummarizeThis.git
cd SummarizeThis
```

**Option B — Download as ZIP:**

Download and unzip the project folder to a permanent location on your machine.

### Step 2: Load in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `SummarizeThis` folder (the one containing `manifest.json`)
5. The extension icon will appear in your toolbar

> Also works on other Chromium browsers: **Edge**, **Brave**, **Arc**, **Vivaldi**, etc. — same process.

### Step 3: Start your LLM server

Make sure LM Studio (or your chosen server) is running with a model loaded and the API server started.

## Usage

1. Navigate to any web page or PDF
2. Click the **Summarize This** extension icon in your toolbar
3. Click **Summarize** — the page text is extracted, sent to your local LLM, and a brief summary appears
4. After the summary loads:
   - **Re-summarize** — regenerate the summary
   - **Extend** — get a detailed, in-depth summary (auto-retries with smaller inputs if the model's context is exceeded)
5. Use the **Chat** panel to ask follow-up questions about the page
6. **Copy** or **Export .md** to save the summary

## Settings

Click the gear icon to configure:

| Setting | Description | Default |
|---|---|---|
| API Endpoint | URL of your LLM server | `http://localhost:1234/v1/chat/completions` |
| Model Name | Model identifier to send in API requests | `default` |
| Max Input Length | Maximum characters of page text sent to the LLM | `10000` |
| Summary Format | Output format: Plain text or Markdown | Plain text |
| Export Mode | Ask where to save, or auto-save to a subfolder | Always ask |
| Export Subfolder | Folder inside Downloads for auto-save | `PageSummaries` |

## Project Structure

```
SummarizeThis/
  manifest.json          Chrome extension manifest (Manifest V3)
  popup.html             Popup UI
  popup.css              Styles (liquid glass dark theme)
  popup.js               All application logic
  lib/
    pdf.min.js           PDF.js v3.11 (PDF text extraction)
    pdf.worker.min.js    PDF.js web worker
  icons/
    icon16.png           Toolbar icon
    icon48.png           Extension page icon
    icon128.png          Chrome Web Store icon
```

## Troubleshooting

**"Could not connect to LLM"**
- Make sure LM Studio is running and the server is started
- Check that the API endpoint in settings matches your server's address

**"The number of tokens to keep from the initial prompt is greater than the context length"**
- Lower the **Max Input Length** in settings (try 5000 or less)
- Or load a model with a larger context window in LM Studio

**"Cannot extract text from browser internal pages"**
- The extension can't read `chrome://`, `edge://`, or other browser-internal pages

**"No text content found in this PDF"**
- Some PDFs are image-only (scanned documents). PDF.js can only extract text from PDFs that contain actual text layers

**Extension shows "Disable developer mode extensions" popup on Chrome startup**
- This is normal for locally loaded extensions. Click the dismiss button — it won't affect functionality

## License

MIT
