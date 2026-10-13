"use strict";

(() => {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const feed = document.getElementById("chat-messages");
  const welcome = document.getElementById("chat-welcome");
  const status = document.getElementById("chat-status");
  const send = document.getElementById("chat-send");
  const fresh = document.getElementById("chat-new");
  const clear = document.getElementById("chat-context-clear");
  let messages = [], company = null, pending = false, generation = 0;

  function append(role, text) {
    welcome.hidden = true;
    const article = node("article", `chat-message chat-${role}`);
    const body = node("div", "chat-message-body");
    body.append(node("span", "chat-author", role === "user" ? "Você" : "Prospect AI"), node("p", "chat-text", text));
    if (role === "assistant") {
      article.append(node("span", "chat-assistant-mark", "✦"));
      const copy = node("button", "chat-copy", "Copiar");
      copy.type = "button";
      copy.setAttribute("aria-label", "Copiar resposta da IA");
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(text); status.textContent = "Resposta copiada."; }
        catch { status.textContent = "Selecione o texto da resposta e use Copiar no seu navegador."; }
      });
      body.append(copy);
    }
    article.append(body);
    feed.append(article);
    feed.scrollTop = feed.scrollHeight;
    return article;
  }

  function reset(selection = null) {
    generation++;
    messages = []; company = selection;
    for (const item of feed.querySelectorAll(".chat-message")) item.remove();
    welcome.hidden = false;
    input.value = ""; status.textContent = "";
    document.getElementById("chat-context").hidden = !company;
    document.getElementById("chat-company").textContent = company ? `Empresa em contexto: ${company.row.name}` : "";
    welcome.querySelector("h2").textContent = company ? `Vamos conversar sobre ${company.row.name}?` : "Como posso ajudar na sua prospecção?";
  }

  function setPending(value) {
    pending = value;
    input.disabled = send.disabled = fresh.disabled = clear.disabled = value;
    send.textContent = value ? "Respondendo…" : "Enviar ↑";
    form.setAttribute("aria-busy", String(value));
    for (const button of document.querySelectorAll("[data-chat-prompt]")) button.disabled = value;
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || pending || document.getElementById("workspace").hidden) return;
    const token = generation;
    const history = [...messages.slice(-12), { role: "user", content: text }];
    while (history.length > 1 && history.reduce((size, message) => size + message.content.length, 0) > 22000) history.splice(0, 2);
    const user = append("user", text);
    setPending(true);
    status.textContent = "Seu agente está preparando uma resposta…";
    try {
      const settings = readOfferSettings();
      const result = await api("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(65000),
        body: JSON.stringify({ action: "chat", messages: history,
          seller: settings.seller, offer: settings.offer, language: settings.language, tone: settings.tone, knowledge: settings.knowledge,
          ...(company ? { jobId: company.jobId, osmId: company.row.osmId } : {}) })
      });
      if (generation !== token) return;
      if (typeof result.text !== "string" || !result.text.trim()) throw new Error("A IA não retornou uma resposta. Tente novamente.");
      messages.push({ role: "user", content: text }, { role: "assistant", content: result.text });
      messages = messages.slice(-80);
      append("assistant", result.text);
      input.value = "";
      status.textContent = "";
    } catch (error) {
      if (generation !== token) return;
      user.remove();
      welcome.hidden = messages.length > 0;
      status.textContent = error.message;
    } finally {
      if (generation === token) {
        setPending(false);
        if (document.body.dataset.page === "agent-section") input.focus({ preventScroll: true });
      }
    }
  }

  form.addEventListener("submit", event => { event.preventDefault(); void submit(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submit(); }
  });
  fresh.addEventListener("click", () => { if (!pending) { reset(); input.focus(); } });
  clear.addEventListener("click", () => { if (!pending) { reset(); input.focus(); } });
  document.getElementById("chat-preferences").addEventListener("click", event => {
    window.dispatchEvent(new CustomEvent("prospect:agent-settings", { detail: { returnFocus: event.currentTarget } }));
  });
  for (const button of document.querySelectorAll("[data-chat-prompt]")) button.addEventListener("click", () => {
    if (pending) return;
    input.value = button.dataset.chatPrompt;
    input.focus({ preventScroll: true });
  });
  window.addEventListener("prospect:chat-company", event => {
    if (document.getElementById("workspace").hidden) return;
    window.dispatchEvent(new CustomEvent("prospect:navigate", { detail: "agent-section" }));
    if (pending) { status.textContent = "Aguarde a resposta atual antes de trocar de empresa."; return; }
    if (company?.jobId !== event.detail.jobId || company?.row.osmId !== event.detail.row.osmId) reset(event.detail);
    input.value = "Revise as evidências desta empresa e me ajude a preparar uma abordagem.";
    input.focus({ preventScroll: true });
  });
  window.addEventListener("prospect:session-expired", () => { reset(); setPending(false); });
})();
