const MAX_CHARS = 10000;
const MAX_HISTORY = 200;

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
const historyToggle = document.getElementById("history-toggle");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");
const historyCount = document.getElementById("history-count");

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

// History

async function getHistory() {
  const data = await chrome.storage.local.get("history");
  return data.history || [];
}

async function saveToHistory(url, title, summary) {
  const history = await getHistory();

  // Replace existing entry for same URL, or add new
  const existingIdx = history.findIndex((h) => h.url === url);
  const entry = {
    url,
    title: title || url,
    summary,
    timestamp: Date.now(),
  };

  if (existingIdx !== -1) {
    history[existingIdx] = entry;
  } else {
    history.unshift(entry);
  }

  // Cap at MAX_HISTORY, drop oldest
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  // Sort newest first
  history.sort((a, b) => b.timestamp - a.timestamp);

  await chrome.storage.local.set({ history });
}

async function clearHistory() {
  await chrome.storage.local.remove("history");
}

function renderHistory(history) {
  historyCount.textContent = `(${history.length})`;

  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No summaries yet.</div>';
    return;
  }

  historyList.innerHTML = history
    .map((entry) => {
      const date = new Date(entry.timestamp);
      const timeStr = date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }) + " " + date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      const titleText = entry.title.length > 50
        ? entry.title.slice(0, 50) + "..."
        : entry.title;
      const previewText = entry.summary.length > 120
        ? entry.summary.slice(0, 120) + "..."
        : entry.summary;

      return `<div class="history-item" data-url="${entry.url.replaceAll('"', '&quot;')}">
        <div class="history-item-header">
          <span class="history-title">${titleText}</span>
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-preview">${previewText}</div>
      </div>`;
    })
    .join("");
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const text = await extractPageText();
    const { summary, wasTruncated } = await summarize(text, settings);
    showResult(summary, wasTruncated);

    // Save to history
    await saveToHistory(tab.url, tab.title, summary);
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

historyToggle.addEventListener("click", async () => {
  const isHidden = historyPanel.classList.toggle("hidden");
  if (!isHidden) {
    const history = await getHistory();
    renderHistory(history);
  }
});

clearHistoryBtn.addEventListener("click", async () => {
  await clearHistory();
  renderHistory([]);
});

historyList.addEventListener("click", (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;

  const url = item.dataset.url;
  const history = JSON.parse(historyList.dataset.cache || "[]");
  // Find entry and show it
  getHistory().then((hist) => {
    const entry = hist.find((h) => h.url === url);
    if (entry) {
      showResult(entry.summary, false);
    }
  });
});

// Check if current page has a cached summary on open
async function checkCachedSummary() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const history = await getHistory();
  const cached = history.find((h) => h.url === tab.url);
  if (cached) {
    showResult(cached.summary, false);
    summarizeBtn.textContent = "Re-summarize This Page";
  }
}

// Init
loadSettings();
checkCachedSummary();
