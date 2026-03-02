const MAX_CHARS = 10000;

const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:1234/v1/chat/completions",
  model: "default",
};

// DOM elements
const summarizeBtn = document.getElementById("summarize-btn");
const settingsToggle = document.getElementById("settings-toggle");
const settingsPanel = document.getElementById("settings-panel");
const saveSettingsBtn = document.getElementById("save-settings");
const endpointInput = document.getElementById("api-endpoint");
const modelInput = document.getElementById("model-name");
const loadingEl = document.getElementById("loading");
const errorEl = document.getElementById("error");
const resultEl = document.getElementById("result");
const summaryText = document.getElementById("summary-text");
const truncationNote = document.getElementById("truncation-note");
const copyBtn = document.getElementById("copy-btn");

// Settings

async function loadSettings() {
  const data = await chrome.storage.local.get(["endpoint", "model"]);
  const endpoint = data.endpoint || DEFAULT_SETTINGS.endpoint;
  const model = data.model || DEFAULT_SETTINGS.model;
  endpointInput.value = endpoint;
  modelInput.value = model;
  return { endpoint, model };
}

async function saveSettings() {
  await chrome.storage.local.set({
    endpoint: endpointInput.value.trim() || DEFAULT_SETTINGS.endpoint,
    model: modelInput.value.trim() || DEFAULT_SETTINGS.model,
  });
}

// UI helpers

function showLoading() {
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  resultEl.classList.add("hidden");
  summarizeBtn.disabled = true;
}

function showError(message) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  resultEl.classList.add("hidden");
  summarizeBtn.disabled = false;
}

function showResult(text, wasTruncated) {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  summaryText.textContent = text;
  resultEl.classList.remove("hidden");
  summarizeBtn.disabled = false;

  if (wasTruncated) {
    truncationNote.textContent = `Page content was trimmed to ${MAX_CHARS.toLocaleString()} characters.`;
    truncationNote.classList.remove("hidden");
  } else {
    truncationNote.classList.add("hidden");
  }
}

// Core logic

async function extractPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  // chrome:// and edge:// pages cannot be scripted
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) {
    throw new Error("Cannot extract text from browser internal pages.");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body.innerText,
  });

  const text = results?.[0]?.result;
  if (!text || text.trim().length === 0) {
    throw new Error("No text content found on this page.");
  }

  return text.trim();
}

async function summarize(text, settings) {
  const wasTruncated = text.length > MAX_CHARS;
  const content = wasTruncated ? text.slice(0, MAX_CHARS) : text;

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Summarize the following web page content concisely. Focus on the key points and main ideas. Use clear, readable language.",
        },
        {
          role: "user",
          content: `Please summarize this web page:\n\n${content}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `LLM API returned ${response.status}. ${body ? body.slice(0, 200) : "Is LM Studio running?"}`
    );
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content;

  if (!summary) {
    throw new Error("LLM returned an empty response.");
  }

  return { summary, wasTruncated };
}

// Event handlers

summarizeBtn.addEventListener("click", async () => {
  showLoading();

  try {
    const settings = await loadSettings();
    const text = await extractPageText();
    const { summary, wasTruncated } = await summarize(text, settings);
    showResult(summary, wasTruncated);
  } catch (err) {
    if (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")) {
      showError(
        "Could not connect to LLM. Make sure LM Studio is running and the API server is started."
      );
    } else {
      showError(err.message);
    }
  }
});

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("hidden");
});

saveSettingsBtn.addEventListener("click", async () => {
  await saveSettings();
  settingsPanel.classList.add("hidden");
});

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(summaryText.textContent);
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 1500);
});

// Init
loadSettings();
