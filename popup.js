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
const contentPanels = document.getElementById("content-panels");
const summaryToggleBtn = document.getElementById("summary-toggle");
const summaryBody = document.getElementById("summary-body");
const summaryText = document.getElementById("summary-text");
const truncationNote = document.getElementById("truncation-note");
const chatToggleBtn = document.getElementById("chat-toggle");
const chatBody = document.getElementById("chat-body");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendBtn = document.getElementById("chat-send");
const copyBtn = document.getElementById("copy-btn");
const copyMenu = document.getElementById("copy-menu");
const copySummaryBtn = document.getElementById("copy-summary");
const copyAllBtn = document.getElementById("copy-all");
const historyToggle = document.getElementById("history-toggle");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");
const historyCount = document.getElementById("history-count");

// Chat state
let chatConversation = [];
let pageContentForChat = "";

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

async function saveToHistory(url, title, summary, chat) {
  const history = await getHistory();

  // Replace existing entry for same URL, or add new
  const existingIdx = history.findIndex((h) => h.url === url);
  const entry = {
    url,
    title: title || url,
    summary,
    chat: chat || [],
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

async function updateHistoryChat(url) {
  const history = await getHistory();
  const entry = history.find((h) => h.url === url);
  if (entry) {
    entry.chat = [...chatConversation];
    entry.timestamp = Date.now();
    await chrome.storage.local.set({ history });
  }
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

      const qCount = entry.chat ? entry.chat.filter((m) => m.role === "user").length : 0;
      const qBadge = qCount > 0 ? `<span class="history-badge">${qCount} Q&A</span>` : "";

      return `<div class="history-item" data-url="${entry.url.replaceAll('"', '&quot;')}">
        <div class="history-item-header">
          <span class="history-title">${titleText}</span>
          <span class="history-meta">${qBadge}<span class="history-time">${timeStr}</span></span>
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
  contentPanels.classList.add("hidden");
  summarizeBtn.disabled = true;
}

function showError(message) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  contentPanels.classList.add("hidden");
  summarizeBtn.disabled = false;
}

function showResult(text, wasTruncated) {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  summaryText.textContent = text;
  contentPanels.classList.remove("hidden");
  summarizeBtn.disabled = false;

  if (wasTruncated) {
    truncationNote.textContent = `(trimmed to ${MAX_CHARS.toLocaleString()} chars)`;
    truncationNote.classList.remove("hidden");
  } else {
    truncationNote.classList.add("hidden");
  }
}

// Accordion

function toggleAccordion(headerBtn, bodyEl) {
  headerBtn.classList.toggle("active");
  bodyEl.classList.toggle("collapsed");
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

    // Store page content for chat context and reset conversation
    pageContentForChat = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    chatConversation = [];
    chatMessages.innerHTML = "";

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

summaryToggleBtn.addEventListener("click", () => {
  toggleAccordion(summaryToggleBtn, summaryBody);
});

chatToggleBtn.addEventListener("click", () => {
  toggleAccordion(chatToggleBtn, chatBody);
});

copyBtn.addEventListener("click", () => {
  copyMenu.classList.toggle("hidden");
});

// Close menu when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".copy-dropdown")) {
    copyMenu.classList.add("hidden");
  }
});

async function copyAndConfirm(text) {
  await navigator.clipboard.writeText(text);
  copyMenu.classList.add("hidden");
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 1500);
}

copySummaryBtn.addEventListener("click", () => {
  copyAndConfirm(summaryText.textContent);
});

copyAllBtn.addEventListener("click", () => {
  let text = "## Summary\n\n" + summaryText.textContent;
  if (chatConversation.length > 0) {
    text += "\n\n## Q&A\n";
    for (const msg of chatConversation) {
      const label = msg.role === "user" ? "Q" : "A";
      text += `\n**${label}:** ${msg.content}\n`;
    }
  }
  copyAndConfirm(text);
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
  chrome.tabs.create({ url });
});

// Chat

function addChatMessage(role, text) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

async function sendChatMessage() {
  const question = chatInput.value.trim();
  if (!question) return;

  chatInput.value = "";
  chatSendBtn.disabled = true;

  addChatMessage("user", question);
  chatConversation.push({ role: "user", content: question });

  const typingEl = addChatMessage("assistant", "Thinking...");
  typingEl.classList.add("typing");

  try {
    const settings = await loadSettings();
    const summary = summaryText.textContent;

    const messages = [
      {
        role: "system",
        content: `You are a helpful assistant. The user is reading a web page. Here is the page content:\n\n${pageContentForChat}\n\nHere is the summary you provided:\n\n${summary}\n\nAnswer the user's questions about this page. Be concise and helpful.`,
      },
      ...chatConversation,
    ];

    const response = await fetch(settings.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "No response.";

    typingEl.textContent = reply;
    typingEl.classList.remove("typing");
    chatConversation.push({ role: "assistant", content: reply });

    // Persist chat to history
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      await updateHistoryChat(tab.url);
    }
  } catch (err) {
    typingEl.textContent = `Error: ${err.message}`;
    typingEl.classList.remove("typing");
    chatConversation.pop(); // remove the failed user message from conversation
  }

  chatSendBtn.disabled = false;
  chatInput.focus();
}

chatSendBtn.addEventListener("click", sendChatMessage);

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
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

    // Restore saved chat conversation
    if (cached.chat && cached.chat.length > 0) {
      chatConversation = [...cached.chat];
      chatMessages.innerHTML = "";
      for (const msg of cached.chat) {
        addChatMessage(msg.role, msg.content);
      }
    }
  }
}

// Init
loadSettings();
checkCachedSummary();
