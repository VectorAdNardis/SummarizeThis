const DEFAULT_MAX_CHARS = 10000;
const MAX_HISTORY = 200;

const DEFAULT_SETTINGS = {
  endpoint: "http://localhost:1234/v1/chat/completions",
  model: "default",
};

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";

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
const exportBtn = document.getElementById("export-btn");
const exportMenu = document.getElementById("export-menu");
const exportSummaryBtn = document.getElementById("export-summary");
const exportAllBtn = document.getElementById("export-all");
const maxCharsInput = document.getElementById("max-chars");
const exportModeSelect = document.getElementById("export-mode");
const exportSubfolderInput = document.getElementById("export-subfolder");
const viewToggleBtn = document.getElementById("view-toggle");
const historyToggle = document.getElementById("history-toggle");
const historyPanel = document.getElementById("history-panel");
const historyList = document.getElementById("history-list");
const clearHistoryBtn = document.getElementById("clear-history");
const tldrBtn = document.getElementById("tldr-btn");
const historyCount = document.getElementById("history-count");

// State
let chatConversation = [];
let pageContentForChat = "";
let fullPageText = "";
let currentPageUrl = "";
let currentPageTitle = "";
let isExtended = false;
let viewMode = "rendered"; // "rendered" or "source"
let rawSummaryText = "";

// Settings

async function loadSettings() {
  const data = await chrome.storage.local.get(["endpoint", "model", "maxChars", "exportMode", "exportSubfolder"]);
  const endpoint = data.endpoint || DEFAULT_SETTINGS.endpoint;
  const model = data.model || DEFAULT_SETTINGS.model;
  const maxChars = data.maxChars || DEFAULT_MAX_CHARS;
  endpointInput.value = endpoint;
  modelInput.value = model;
  maxCharsInput.value = maxChars;
  exportModeSelect.value = data.exportMode || "ask";
  exportSubfolderInput.value = data.exportSubfolder || "PageSummaries";
  return { endpoint, model, maxChars };
}

async function saveSettings() {
  await chrome.storage.local.set({
    endpoint: endpointInput.value.trim() || DEFAULT_SETTINGS.endpoint,
    model: modelInput.value.trim() || DEFAULT_SETTINGS.model,
    maxChars: parseInt(maxCharsInput.value, 10) || DEFAULT_MAX_CHARS,
    exportMode: exportModeSelect.value,
    exportSubfolder: exportSubfolderInput.value.trim() || "PageSummaries",
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

function showLoading(message) {
  loadingEl.classList.remove("hidden");
  loadingEl.querySelector("span").textContent = message || "Summarizing...";
  errorEl.classList.add("hidden");
  contentPanels.classList.add("hidden");
  summarizeBtn.disabled = true;
  tldrBtn.disabled = true;
}

function showError(message) {
  loadingEl.classList.add("hidden");
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
  contentPanels.classList.add("hidden");
  summarizeBtn.disabled = false;
  tldrBtn.disabled = false;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMarkdown(md) {
  const lines = md.split("\n");
  const html = [];
  let inList = false;
  let listType = null; // "ul" or "ol"
  let inTable = false;
  let tableHeader = null;
  let tableRows = [];

  function closeList() {
    if (inList) {
      html.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
      listType = null;
    }
  }

  function closeTable() {
    if (!inTable) return;
    let t = "<table>";
    if (tableHeader) {
      t += "<thead><tr>";
      for (const cell of tableHeader) {
        t += `<th>${inlineFormat(cell)}</th>`;
      }
      t += "</tr></thead>";
    }
    t += "<tbody>";
    for (const row of tableRows) {
      t += "<tr>";
      for (const cell of row) {
        t += `<td>${inlineFormat(cell)}</td>`;
      }
      t += "</tr>";
    }
    t += "</tbody></table>";
    html.push(t);
    inTable = false;
    tableHeader = null;
    tableRows = [];
  }

  function inlineFormat(text) {
    let s = escapeHtml(text);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/`(.+?)`/g, "<code>$1</code>");
    return s;
  }

  function parseTableCells(line) {
    // Strip leading/trailing pipes and split
    const stripped = line.replace(/^\|/, "").replace(/\|$/, "");
    return stripped.split("|").map((c) => c.trim());
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Table rows (lines containing |)
    if (line.includes("|") && line.trim().startsWith("|")) {
      closeList();
      const cells = parseTableCells(line);

      // Skip separator rows (|---|---|)
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    }

    // If we were in a table and hit a non-table line, close it
    if (inTable) {
      closeTable();
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered list
    if (/^[\-\*]\s+/.test(line)) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        inList = true;
        listType = "ul";
      }
      html.push(`<li>${inlineFormat(line.replace(/^[\-\*]\s+/, ""))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        inList = true;
        listType = "ol";
      }
      html.push(`<li>${inlineFormat(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    closeList();

    // Blank line
    if (line.trim() === "") {
      continue;
    }

    // Regular paragraph
    html.push(`<p>${inlineFormat(line)}</p>`);
  }

  closeTable();
  closeList();
  return html.join("\n");
}

function displaySummary(text) {
  if (viewMode === "rendered") {
    summaryText.innerHTML = renderMarkdown(text);
    summaryText.classList.add("md-rendered");
    viewToggleBtn.textContent = "Markdown";
  } else {
    summaryText.textContent = text;
    summaryText.classList.remove("md-rendered");
    viewToggleBtn.textContent = "Formatted";
  }
}

function showResult(text, wasTruncated) {
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  rawSummaryText = text;
  displaySummary(text);
  contentPanels.classList.remove("hidden");
  summarizeBtn.disabled = false;

  // Show action buttons after first summary
  summarizeBtn.textContent = "Re-summarize";
  tldrBtn.classList.remove("hidden");
  if (isExtended) {
    // Extended summary shown — offer TL;DR
    tldrBtn.textContent = "TL;DR";
    tldrBtn.disabled = false;
  } else {
    // Brief (TL;DR) already shown
    tldrBtn.textContent = "TL;DR";
    tldrBtn.disabled = true;
  }

  if (wasTruncated) {
    truncationNote.textContent = "(content was trimmed to fit model context)";
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

function isPdfUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".pdf");
  } catch {
    return false;
  }
}

async function extractPdfText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const textParts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    if (pageText.trim()) {
      textParts.push(pageText.trim());
    }
  }

  const fullText = textParts.join("\n\n");
  if (!fullText) {
    throw new Error("No text content found in this PDF.");
  }

  return fullText;
}

async function extractPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  // chrome:// and edge:// pages cannot be scripted
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) {
    throw new Error("Cannot extract text from browser internal pages.");
  }

  // PDF handling — fetch and parse with pdf.js
  if (isPdfUrl(tab.url)) {
    return extractPdfText(tab.url);
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

const FORMAT_INSTRUCTIONS =
  "Format your response using markdown: use headings (##, ###), bold (**), bullet lists (- ), numbered lists, and tables where appropriate.";

const SUMMARY_PROMPTS = {
  brief: {
    system: `You are a helpful assistant. Summarize the following web page content concisely. Focus on the key points and main ideas. Use clear, readable language. ${FORMAT_INSTRUCTIONS}`,
    user: "Please summarize this web page briefly:\n\n",
    maxTokens: 1024,
  },
  extended: {
    system: `You are a helpful assistant. Provide a detailed, in-depth summary of the following content. If the content has chapters, sections, or subheadings, organize your summary to reflect that structure. Include nuanced details, key arguments, and supporting points. Be thorough but readable. ${FORMAT_INSTRUCTIONS}`,
    user: "Please provide a detailed summary of this content:\n\n",
    maxTokens: 4096,
  },
};

async function summarize(text, settings, mode, charLimit) {
  const wasTruncated = text.length > charLimit;
  const content = wasTruncated ? text.slice(0, charLimit) : text;
  const prompt = SUMMARY_PROMPTS[mode];

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user + content },
      ],
      temperature: 0.3,
      max_tokens: prompt.maxTokens,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(
      `LLM API returned ${response.status}. ${body ? body.slice(0, 200) : "Is LM Studio running?"}`
    );
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const summary = data.choices?.[0]?.message?.content;

  if (!summary) {
    throw new Error("LLM returned an empty response.");
  }

  return { summary, wasTruncated };
}

const MIN_CHARS = 2000;

async function summarizeExtended(text, settings) {
  const baseLimit = settings.maxChars || DEFAULT_MAX_CHARS;
  // Try progressively smaller inputs: 2x, 1.5x, 1x, 0.7x, 0.5x base
  const limits = [
    baseLimit * 2,
    Math.floor(baseLimit * 1.5),
    baseLimit,
    Math.floor(baseLimit * 0.7),
    Math.floor(baseLimit * 0.5),
  ].map((l) => Math.max(l, MIN_CHARS));

  // Deduplicate (in case multiple rounds collapse to MIN_CHARS)
  const uniqueLimits = [...new Set(limits)];

  let lastError;
  for (const limit of uniqueLimits) {
    try {
      return await summarize(text, settings, "extended", limit);
    } catch (err) {
      lastError = err;
      if (err.status === 400) {
        // Context too large, try smaller
        continue;
      }
      throw err; // Network error or other — stop immediately
    }
  }

  throw new Error(
    "Could not extend — content exceeds the model's maximum context length. Try loading a model with a larger context window in LM Studio."
  );
}

// Event handlers

summarizeBtn.addEventListener("click", async () => {
  showLoading("Summarizing...");

  try {
    const settings = await loadSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentPageUrl = tab.url;
    currentPageTitle = tab.title;
    const text = await extractPageText();
    fullPageText = text;

    const { summary, wasTruncated } = await summarizeExtended(text, settings);
    isExtended = true;
    showResult(summary, wasTruncated);

    // Store page content for chat context and reset conversation
    const charLimit = settings.maxChars || DEFAULT_MAX_CHARS;
    pageContentForChat = text.length > charLimit ? text.slice(0, charLimit) : text;
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

tldrBtn.addEventListener("click", async () => {
  showLoading("Summarizing...");

  try {
    const settings = await loadSettings();

    // Re-extract page text if we don't have it (e.g. loaded from cache)
    if (!fullPageText) {
      fullPageText = await extractPageText();
    }

    const charLimit = settings.maxChars || DEFAULT_MAX_CHARS;
    const { summary, wasTruncated } = await summarize(fullPageText, settings, "brief", charLimit);
    isExtended = false;
    showResult(summary, wasTruncated);

    // Update history with brief summary
    await saveToHistory(currentPageUrl, currentPageTitle, summary, chatConversation);
  } catch (err) {
    // Restore UI without hiding the existing summary
    loadingEl.classList.add("hidden");
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
    summarizeBtn.disabled = false;
    tldrBtn.disabled = false;
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

viewToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  viewMode = viewMode === "rendered" ? "source" : "rendered";
  if (rawSummaryText) {
    displaySummary(rawSummaryText);
  }
});

chatToggleBtn.addEventListener("click", () => {
  toggleAccordion(chatToggleBtn, chatBody);
});

copyBtn.addEventListener("click", () => {
  copyMenu.classList.toggle("hidden");
  exportMenu.classList.add("hidden");
});

exportBtn.addEventListener("click", () => {
  exportMenu.classList.toggle("hidden");
  copyMenu.classList.add("hidden");
});

// Close menus when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".copy-dropdown")) {
    copyMenu.classList.add("hidden");
    exportMenu.classList.add("hidden");
  }
});

// Copy

async function copyAndConfirm(text) {
  await navigator.clipboard.writeText(text);
  copyMenu.classList.add("hidden");
  copyBtn.textContent = "Copied!";
  setTimeout(() => {
    copyBtn.textContent = "Copy";
  }, 1500);
}

copySummaryBtn.addEventListener("click", () => {
  copyAndConfirm(rawSummaryText);
});

copyAllBtn.addEventListener("click", () => {
  let text = "## Summary\n\n" + rawSummaryText;
  if (chatConversation.length > 0) {
    text += "\n\n## Q&A\n";
    for (const msg of chatConversation) {
      const label = msg.role === "user" ? "Q" : "A";
      text += `\n**${label}:** ${msg.content}\n`;
    }
  }
  copyAndConfirm(text);
});

// Export

function buildMarkdown(includeChat) {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  let md = `---\n`;
  md += `date: ${dateStr}\n`;
  md += `time: "${timeStr}"\n`;
  md += `url: "${currentPageUrl || ""}"\n`;
  md += `title: "${(currentPageTitle || "").replaceAll('"', '\\"')}"\n`;
  md += `---\n\n`;
  md += `# ${currentPageTitle || "Page Summary"}\n\n`;
  md += `> **Source:** ${currentPageUrl || "unknown"}\n`;
  md += `> **Date:** ${dateStr} ${timeStr}\n\n`;
  md += `## Summary\n\n${rawSummaryText}\n`;

  if (includeChat && chatConversation.length > 0) {
    md += `\n## Q&A\n`;
    for (const msg of chatConversation) {
      const label = msg.role === "user" ? "Q" : "A";
      md += `\n**${label}:** ${msg.content}\n`;
    }
  }

  return md;
}

function sanitizeFilename(str) {
  return str
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

async function exportMarkdown(includeChat) {
  exportMenu.classList.add("hidden");

  const md = buildMarkdown(includeChat);
  const dataUrl = "data:text/markdown;base64," + btoa(unescape(encodeURIComponent(md)));

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const safeName = sanitizeFilename(currentPageTitle || "summary");
  const filename = `${dateStr}-${safeName}.md`;

  const data = await chrome.storage.local.get(["exportMode", "exportSubfolder"]);
  const mode = data.exportMode || "ask";
  const subfolder = data.exportSubfolder || "PageSummaries";

  const filePath = mode === "auto" ? `${subfolder}/${filename}` : filename;

  chrome.downloads.download(
    {
      url: dataUrl,
      filename: filePath,
      saveAs: mode === "ask",
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        exportBtn.textContent = "Error";
      } else {
        exportBtn.textContent = "Exported!";
      }
      setTimeout(() => {
        exportBtn.textContent = "Export .md";
      }, 1500);
    }
  );
}

exportSummaryBtn.addEventListener("click", () => exportMarkdown(false));
exportAllBtn.addEventListener("click", () => exportMarkdown(true));

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
    const messages = [
      {
        role: "system",
        content: `You are a helpful assistant. The user is reading a web page. Here is the page content:\n\n${pageContentForChat}\n\nHere is the summary you provided:\n\n${rawSummaryText}\n\nAnswer the user's questions about this page. Be concise and helpful.`,
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

  currentPageUrl = tab.url;
  currentPageTitle = tab.title;

  const history = await getHistory();
  const cached = history.find((h) => h.url === tab.url);
  if (cached) {
    isExtended = true;
    showResult(cached.summary, false);

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
