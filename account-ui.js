"use strict";

const accountUI = (() => {
  let state = { mode: "basic", authenticated: false, user: null, csrfToken: null };
  let saveTimer = null;
  let view = "login";
  let linkToken = null;
  const element = (tag, text) => { const item = document.createElement(tag); if (text != null) item.textContent = text; return item; };
  const jobKey = () => state.mode === "password" ? `prospect-ai-active-job:${state.user?.id || "anonymous"}` : "prospect-ai-active-job";
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(state.csrfToken ? { "X-CSRF-Token": state.csrfToken } : {}), ...options.headers },
      signal: AbortSignal.timeout(15000) });
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 401 && state.authenticated && !url.startsWith("/api/auth/")) expire();
      throw new Error(value.error || "Não foi possível concluir a solicitação.");
    }
    return value;
  }
  function loginMessage(text) {
    document.getElementById("account-status").textContent = text;
  }
  function showView(next) {
    view = next;
    document.getElementById("account-login-form").hidden = next !== "login";
    document.getElementById("account-email-form").hidden = !["register", "forgot"].includes(next);
    document.getElementById("account-password-form").hidden = !["activate", "reset"].includes(next);
    document.getElementById("login-title").textContent = ({ login: "Entre no Prospect AI", register: "Crie sua conta", forgot: "Recupere sua senha", activate: "Crie sua senha", reset: "Defina uma nova senha" })[next];
    document.getElementById("account-email-help").textContent = next === "register" ? "Enviaremos um link para confirmar seu Gmail. Você criará sua senha ao abrir o link." : "Enviaremos um link para definir uma nova senha. Ao trocar a senha, as sessões anteriores serão encerradas.";
    document.getElementById("account-email-submit").textContent = next === "register" ? "Enviar confirmação" : "Enviar recuperação";
    loginMessage("");
  }
  async function initialize() {
    state = await request("/api/account");
    const login = document.getElementById("login-panel");
    const content = document.getElementById("workspace");
    const controls = document.getElementById("account-controls");
    const history = document.getElementById("account-history");
    if (state.mode !== "password") return true;
    content.hidden = !state.authenticated || Boolean(linkToken);
    login.hidden = state.authenticated && !linkToken;
    controls.hidden = !state.authenticated;
    history.hidden = !state.authenticated || Boolean(linkToken);
    document.body.classList.toggle("account-logged-out", !state.authenticated);
    if (state.authenticated) {
      document.getElementById("account-email").textContent = state.user.email;
      void refreshHistory();
    } else {
      showView(linkToken ? view : "login");
    }
    if (linkToken) showView(view);
    return Boolean(state.authenticated && !linkToken);
  }
  async function refreshHistory() {
    if (state.mode !== "password" || !state.authenticated) return;
    const list = document.getElementById("history-list");
    try {
      const records = await request("/api/history");
      list.replaceChildren();
      if (!records.length) { list.append(element("p", "Seu histórico aparecerá aqui após uma busca.")); return; }
      for (const record of records) {
        const button = element("button", `${record.place || record.city} · ${record.niche} · ${new Date(record.createdAt).toLocaleDateString("pt-BR")}`);
        button.type = "button";
        button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("prospect:history", { detail: record.id })));
        list.append(button);
      }
    } catch (error) { list.replaceChildren(element("p", error.message)); }
  }
  // URL fragments never reach HTTP logs. Remove the one-use email token promptly.
  function readLink() {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (!fragment.has("activate") && !fragment.has("reset")) return false;
    linkToken = null;
    for (const purpose of ["activate", "reset"]) {
      if (fragment.size === 1 && /^[A-Za-z0-9_-]{43}$/.test(fragment.get(purpose) || "")) {
        view = purpose; linkToken = fragment.get(purpose);
      }
    }
    window.history.replaceState(null, "", location.pathname + location.search);
    return Boolean(linkToken);
  }
  readLink();
  window.addEventListener("hashchange", () => {
    if (!readLink() || state.mode !== "password") return;
    document.getElementById("workspace").hidden = true;
    document.getElementById("login-panel").hidden = false;
    document.getElementById("account-history").hidden = true;
    showView(view);
  });
  document.getElementById("account-register-open").addEventListener("click", () => showView("register"));
  document.getElementById("account-forgot-open").addEventListener("click", () => showView("forgot"));
  for (const button of document.querySelectorAll(".account-back")) button.addEventListener("click", () => {
    linkToken = null;
    document.getElementById("account-password-form").reset();
    showView("login");
  });
  for (const id of ["account-login-form", "account-email-form", "account-password-form"]) {
    document.getElementById(id).addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const action = view;
      if (["activate", "reset"].includes(action) && document.getElementById("account-new-password").value !== document.getElementById("account-repeat-password").value) {
        loginMessage("As senhas precisam ser iguais."); return;
      }
      const input = action === "login" ? { email: document.getElementById("login-email").value, password: document.getElementById("login-password").value }
        : ["register", "forgot"].includes(action) ? { email: document.getElementById("account-request-email").value }
        : { token: linkToken, password: document.getElementById("account-new-password").value };
      button.disabled = true; loginMessage("Aguarde…");
      try {
        // Renew the anonymous CSRF cookie if the form has been open for a while.
        state = await request("/api/account");
        const result = await request(`/api/auth/${action}`, { method: "POST", body: JSON.stringify(input) });
        if (["register", "forgot"].includes(action)) loginMessage(result.message);
        else { form.reset(); linkToken = null; location.assign("/"); }
      } catch (error) { loginMessage(error.message); }
      finally { button.disabled = false; }
    });
  }
  document.getElementById("account-logout").addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      await request("/auth/logout", { method: "POST", body: "{}" });
      try { localStorage.removeItem(jobKey()); } catch { /* Optional browser storage. */ }
      location.assign("/");
    } catch (error) { button.disabled = false; document.getElementById("account-actions-status").textContent = error.message; }
  });
  const deletion = document.getElementById("account-delete-dialog");
  document.getElementById("account-delete-open").addEventListener("click", () => {
    document.getElementById("account-delete-confirmation").value = "";
    document.getElementById("account-delete-password").value = "";
    document.getElementById("account-delete-status").textContent = "";
    deletion.showModal();
  });
  document.getElementById("account-delete-cancel").addEventListener("click", () => deletion.close());
  document.getElementById("account-delete-form").addEventListener("submit", async event => {
    event.preventDefault();
    const confirmation = document.getElementById("account-delete-confirmation").value;
    const button = document.getElementById("account-delete-submit"); button.disabled = true;
    try {
      await request("/api/account", { method: "DELETE", body: JSON.stringify({ confirmation, password: document.getElementById("account-delete-password").value }) });
      try { localStorage.removeItem(jobKey()); } catch { /* Optional browser storage. */ }
      location.assign("/");
    } catch (error) { document.getElementById("account-delete-status").textContent = error.message; button.disabled = false; }
  });
  function expire() {
    if (state.mode !== "password") return;
    state.authenticated = false; state.csrfToken = null; state.user = null;
    clearTimeout(saveTimer);
    document.getElementById("workspace").hidden = true;
    document.getElementById("login-panel").hidden = false;
    document.getElementById("account-controls").hidden = true;
    document.getElementById("account-history").hidden = true;
    document.getElementById("history-list").replaceChildren();
    document.getElementById("account-email").textContent = "Minha conta";
    document.body.classList.add("account-logged-out");
    showView("login");
    loginMessage("Sua sessão terminou. Entre novamente para acessar seus dados.");
    window.dispatchEvent(new Event("prospect:session-expired"));
  }
  return {
    initialize, refreshHistory, jobKey, request,
    get mode() { return state.mode; },
    get csrf() { return state.csrfToken; },
    get profile() { return state.user; },
    preferences() { return state.user?.preferences || {}; },
    savePreferences(value) {
      if (!state.user) return;
      state.user.preferences = value;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void request("/api/account/preferences", { method: "PATCH", body: JSON.stringify(value) })
          .catch(error => { document.getElementById("account-actions-status").textContent = error.message; });
      }, 500);
    },
    expire
  };
})();
