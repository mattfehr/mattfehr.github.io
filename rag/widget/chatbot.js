(function () {
  "use strict";

  // Replace after deploying the Cloudflare Worker, or set window.PORTFOLIO_CHAT_API_URL before this script loads.
  const CHAT_API_URL =
    window.PORTFOLIO_CHAT_API_URL || "https://portfolio-rag-chatbot.mattfehr2004.workers.dev/chat";
  const CHAT_API_CONFIGURED = !CHAT_API_URL.includes("YOUR_SUBDOMAIN");

  const STARTER_QUESTIONS = [
    "What AI projects has Matthew built?",
    "What is Matthew's current role?",
    "What tech stack does ResuMatch AI use?",
    "How can I contact Matthew?",
  ];

  const history = [];

  function createRoot() {
    const root = document.createElement("div");
    root.id = "portfolio-chatbot-root";
    root.innerHTML = `
      <div id="portfolio-chatbot-panel" aria-hidden="true">
        <div id="portfolio-chatbot-header">
          <div>
            <h3>Matthew's Portfolio Assistant</h3>
            <p>Ask about projects, skills, and experience</p>
          </div>
          <button id="portfolio-chatbot-reset" type="button" aria-label="Reset conversation" title="Reset conversation">Reset</button>
        </div>
        <div id="portfolio-chatbot-messages" aria-live="polite"></div>
        <div id="portfolio-chatbot-starters"></div>
        <div id="portfolio-chatbot-sources"></div>
        <form id="portfolio-chatbot-form">
          <input id="portfolio-chatbot-input" type="text" maxlength="1000" placeholder="Ask a question..." autocomplete="off" />
          <button id="portfolio-chatbot-submit" type="submit">Send</button>
        </form>
      </div>
      <button id="portfolio-chatbot-toggle" type="button" aria-expanded="false" aria-controls="portfolio-chatbot-panel" title="Open chat">
        Chat
      </button>
    `;
    document.body.appendChild(root);
    return root;
  }

  function appendMessage(role, text) {
    const messages = document.getElementById("portfolio-chatbot-messages");
    const bubble = document.createElement("div");
    bubble.className = `chatbot-message ${role}`;
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function setLoading(isLoading) {
    const existing = document.getElementById("portfolio-chatbot-typing");
    if (!isLoading && existing) {
      existing.remove();
      return;
    }

    if (isLoading && !existing) {
      const messages = document.getElementById("portfolio-chatbot-messages");
      const typing = document.createElement("div");
      typing.id = "portfolio-chatbot-typing";
      typing.className = "chatbot-typing";
      typing.textContent = "Thinking...";
      messages.appendChild(typing);
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function renderSources(sources) {
    const container = document.getElementById("portfolio-chatbot-sources");
    container.innerHTML = "";
    container.classList.toggle("is-visible", sources.length > 0);

    for (const source of sources) {
      const chip = document.createElement(source.url ? "a" : "span");
      chip.className = "chatbot-source-chip";
      if (source.url) {
        chip.href = source.url;
        chip.target = "_blank";
        chip.rel = "noopener noreferrer";
      }
      chip.textContent = `${source.title} - ${source.section}`;
      container.appendChild(chip);
    }
  }

  function renderStarters() {
    const container = document.getElementById("portfolio-chatbot-starters");
    container.innerHTML = "";

    for (const question of STARTER_QUESTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chatbot-starter";
      button.textContent = question;
      button.addEventListener("click", () => sendMessage(question));
      container.appendChild(button);
    }
  }

  function setFormDisabled(disabled) {
    document.getElementById("portfolio-chatbot-input").disabled = disabled;
    document.getElementById("portfolio-chatbot-submit").disabled = disabled;
  }

  async function sendMessage(message) {
    const trimmed = message.trim();
    if (!trimmed) return;

    if (!CHAT_API_CONFIGURED) {
      appendMessage("error", "The chat API is not deployed yet.");
      return;
    }

    const priorHistory = history.slice(-10);
    appendMessage("user", trimmed);
    history.push({ role: "user", content: trimmed });
    setFormDisabled(true);
    setLoading(true);
    renderSources([]);

    try {
      const response = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: priorHistory }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorText =
          data.code === "rate_limited" || data.code === "upstream_rate_limited"
            ? data.error || "Rate limit reached. Please wait a minute and try again."
            : data.error || "Something went wrong. Please try again.";
        appendMessage("error", errorText);
        return;
      }

      appendMessage("assistant", data.answer || "I do not know.");
      history.push({ role: "assistant", content: data.answer || "I do not know." });
      renderSources(Array.isArray(data.sources) ? data.sources : []);
    } catch {
      appendMessage("error", "Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
      setFormDisabled(false);
      document.getElementById("portfolio-chatbot-input").focus();
    }
  }

  function resetConversation() {
    history.length = 0;
    document.getElementById("portfolio-chatbot-messages").innerHTML = "";
    document.getElementById("portfolio-chatbot-starters").innerHTML = "";
    renderSources([]);
    setFormDisabled(!CHAT_API_CONFIGURED);

    if (!CHAT_API_CONFIGURED) {
      appendMessage(
        "assistant",
        "The chat UI is ready, but the Cloudflare Worker URL still needs to be connected before live answers work.",
      );
      return;
    }

    appendMessage(
      "assistant",
      "Hi! I can answer questions about Matthew's projects, skills, experience, and contact info.",
    );
    renderStarters();
  }

  function init() {
    createRoot();

    const panel = document.getElementById("portfolio-chatbot-panel");
    const toggle = document.getElementById("portfolio-chatbot-toggle");
    const form = document.getElementById("portfolio-chatbot-form");
    const input = document.getElementById("portfolio-chatbot-input");

    toggle.addEventListener("click", () => {
      const isOpen = panel.classList.toggle("is-open");
      panel.setAttribute("aria-hidden", String(!isOpen));
      toggle.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) input.focus();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      input.value = "";
      sendMessage(value);
    });

    document.getElementById("portfolio-chatbot-reset").addEventListener("click", resetConversation);

    resetConversation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
