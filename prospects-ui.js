"use strict";

const prospectLists = (() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, className = "") => {
    const item = document.createElement(tag); item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const labels = { new: "Novo", contacted: "Contatado", interested: "Interessado" };
  const websiteLabels = { WEBSITE_LISTED: "Site listado", WEBSITE_FOUND: "Site encontrado", LIKELY_NO_WEBSITE: "Provavelmente sem site", UNCERTAIN: "Site incerto" };
  let enabled = false, lists = [], companies = [], selected = "", epoch = 0, listRead = 0, companyRead = 0;
  let saving = null, naming = null;
  let loadState = "ready";
  const drafts = new Map(), working = new Set(), feedback = new Map();
  const current = token => enabled && epoch === token;
  const request = (url, method = "GET", body) => accountUI.request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const status = text => { $("lists-status").textContent = text; };
  const validURL = value => {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  function link(label, value) {
    const url = validURL(value); if (!url) return node("span", label);
    const item = node("a", label); item.href = url; item.target = "_blank"; item.rel = "noopener noreferrer";
    return item;
  }
  function whatsappButton(company) {
    if (typeof company.phone !== "string" || !company.phone.trim()) return null;
    const url = typeof company.whatsappUrl === "string" && /^https:\/\/wa\.me\/[1-9]\d{6,14}$/.test(company.whatsappUrl)
      ? company.whatsappUrl : "";
    const item = node(url ? "a" : "button", url ? "Entrar em contato · WhatsApp" : "WhatsApp indisponível", "whatsapp-contact");
    if (url) {
      item.href = url; item.target = "_blank"; item.rel = "noopener noreferrer";
      item.title = "Abrir WhatsApp para +" + url.split("/").pop();
      item.setAttribute("aria-label", `Entrar em contato com ${company.name} pelo WhatsApp`);
    } else {
      item.type = "button"; item.disabled = true;
      item.title = "É necessário um telefone completo com código de país para abrir o WhatsApp.";
    }
    return item;
  }
  function clear() {
    epoch++; listRead++; companyRead++; enabled = false; lists = []; companies = []; selected = ""; saving = null; naming = null;
    drafts.clear(); working.clear(); feedback.clear();
    $("lists-section").hidden = true; $("list-companies").replaceChildren(); $("list-select").replaceChildren();
    $("list-save-select").replaceChildren(); $("list-name").value = ""; $("list-save-name").value = "";
    $("list-search").value = ""; $("list-save-title").textContent = "Salvar empresa";
    $("list-summary").textContent = ""; $("lists-count").textContent = "";
    $("list-status-filter").value = "all"; $("lists-section").open = false;
    $("list-save-status").textContent = ""; $("list-name-status").textContent = "";
    for (const id of ["list-save-dialog", "list-name-dialog"]) $(id).close();
    status("");
  }
  function options(select, data, chosen) {
    select.replaceChildren();
    for (const record of data) { const option = node("option", record.name); option.value = record.id; select.append(option); }
    if (chosen && data.some(record => record.id === chosen)) select.value = chosen;
  }
  async function refresh(preferred) {
    if (!enabled) return;
    const token = epoch, serial = ++listRead;
    status("Carregando suas listas…");
    try {
      const records = await request("/api/lists");
      if (!current(token) || serial !== listRead) return;
      lists = records;
      selected = records.some(record => record.id === (preferred || selected)) ? (preferred || selected) : records[0]?.id || "";
      options($("list-select"), records.map(record => ({ ...record, name: `${record.name} (${record.count})` })), selected);
      $("list-select").disabled = !records.length;
      $("list-rename").disabled = $("list-delete").disabled = !selected;
      $("lists-count").textContent = `${records.length} ${records.length === 1 ? "lista" : "listas"}`;
      $("list-empty").hidden = Boolean(records.length);
      status("");
      await loadCompanies();
    } catch (error) { if (current(token) && serial === listRead) status(error.message); }
  }
  async function loadCompanies() {
    const token = epoch, serial = ++companyRead, id = selected;
    companies = []; loadState = id ? "loading" : "ready"; render();
    if (!id || !enabled) return;
    status("Carregando empresas salvas…");
    try {
      const records = await request(`/api/lists/${id}/companies`);
      if (!current(token) || serial !== companyRead || id !== selected) return;
      companies = records; loadState = "ready"; status(""); render();
    } catch (error) { if (current(token) && serial === companyRead) { loadState = "error"; status(error.message); render(); } }
  }
  function card(item) {
    const company = item.company, article = node("article", undefined, "prospect-card");
    const draft = drafts.get(item.id) || { note: item.note, status: item.status };
    article.dataset.savedId = item.id;
    const heading = node("div", undefined, "prospect-heading");
    heading.append(node("h3", company.name), node("span", labels[item.status] || "Novo", `prospect-contact-status ${item.status}`));
    article.append(heading, node("p", `${company.category} · ${company.city}`, "meta"),
      node("p", company.address || "Endereço não informado", "prospect-contact"),
      node("p", company.phone || "Telefone não informado", "prospect-contact"));
    const sources = node("div", undefined, "prospect-links");
    const contactButton = whatsappButton(company);
    if (contactButton) sources.append(contactButton);
    if (validURL(company.website)) sources.append(link("Abrir site", company.website));
    if (/^(node|way|relation)\/\d+$/.test(company.osmId)) sources.append(link("Ver fonte", `https://www.openstreetmap.org/${company.osmId}`));
    sources.append(node("span", websiteLabels[company.status] || "Site incerto"));
    article.append(sources);
    const form = node("form", undefined, "prospect-edit-form");
    const select = node("select"); select.id = "company-status-" + item.id;
    options(select, Object.entries(labels).map(([id, name]) => ({ id, name })), draft.status);
    const stage = node("label", "Status do contato"); stage.htmlFor = select.id; stage.append(select);
    const note = node("textarea"); note.id = "company-note-" + item.id; note.maxLength = 3000; note.rows = 3; note.value = draft.note;
    const noteLabel = node("label", "Notas"); noteLabel.htmlFor = note.id; noteLabel.append(note);
    const count = node("small", `${note.value.length}/3.000`, "prospect-note-count");
    const remember = () => { drafts.set(item.id, { note: note.value, status: select.value }); count.textContent = `${note.value.length}/3.000`; };
    note.addEventListener("input", remember); select.addEventListener("change", remember);
    const buttons = node("div", undefined, "prospect-buttons");
    const save = node("button", "Salvar alterações", "primary"); save.type = "submit";
    const remove = node("button", "Remover da lista"); remove.type = "button";
    const message = node("p", working.has(item.id) ? "Salvando…" : feedback.get(item.id) || "", "prospect-message"); message.setAttribute("role", "status");
    save.disabled = remove.disabled = note.disabled = select.disabled = working.has(item.id);
    buttons.append(save, remove); form.append(stage, noteLabel, count, buttons, message); article.append(form);
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (working.has(item.id)) return; const token = epoch;
      const value = { status: select.value, note: note.value };
      working.add(item.id); save.disabled = remove.disabled = note.disabled = select.disabled = true; message.textContent = "Salvando…";
      try {
        const updated = await request(`/api/lists/${item.listId}/companies/${item.id}`, "PATCH", value);
        if (!current(token)) return;
        const visibleItem = companies.find(value => value.id === item.id);
        if (visibleItem) Object.assign(visibleItem, updated);
        drafts.delete(item.id); feedback.set(item.id, "Alterações salvas.");
      } catch (error) { if (current(token)) feedback.set(item.id, error.message); }
      finally {
        working.delete(item.id);
        if (current(token)) { render(); $("list-companies").querySelector(`[data-saved-id="${item.id}"] button[type="submit"]`)?.focus({ preventScroll: true }); }
      }
    });
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remover ${company.name} desta lista? As notas desta entrada também serão removidas.`)) return;
      const token = epoch; working.add(item.id); save.disabled = remove.disabled = note.disabled = select.disabled = true;
      try {
        await request(`/api/lists/${item.listId}/companies/${item.id}`, "DELETE");
        if (!current(token)) return;
        drafts.delete(item.id); feedback.delete(item.id); await refresh(item.listId); if (current(token)) status("Empresa removida da lista.");
      } catch (error) { if (current(token)) message.textContent = error.message; }
      finally { working.delete(item.id); save.disabled = remove.disabled = note.disabled = select.disabled = false; }
    });
    return article;
  }
  function render() {
    const query = $("list-search").value.trim().toLocaleLowerCase(), filter = $("list-status-filter").value;
    const visible = companies.filter(item => (filter === "all" || item.status === filter) &&
      [item.company.name, item.company.city, item.company.phone, item.note].some(value => String(value).toLocaleLowerCase().includes(query)));
    $("list-companies").replaceChildren(...visible.map(card));
    $("list-summary").textContent = selected ? `${visible.length} de ${companies.length} empresas · Novo: ${companies.filter(x => x.status === "new").length} · Contatado: ${companies.filter(x => x.status === "contacted").length} · Interessado: ${companies.filter(x => x.status === "interested").length}` : "";
    if (selected && !visible.length) $("list-companies").append(node("p", loadState === "loading" ? "Carregando empresas salvas…" : loadState === "error" ? "Use Atualizar para tentar carregar a lista novamente." : companies.length ? "Nenhuma empresa corresponde aos filtros." : "Salve empresas dos seus resultados para preencher esta lista.", "meta"));
  }
  function nameDialog(action) {
    naming = { action, id: selected };
    $("list-name-title").textContent = action === "create" ? "Criar lista" : "Renomear lista";
    $("list-name").value = action === "create" ? "" : lists.find(item => item.id === selected)?.name || "";
    $("list-name-status").textContent = ""; $("list-name-submit").disabled = false;
    $("list-name-dialog").showModal(); $("list-name").focus();
  }
  async function openSave(row, jobId) {
    if (!enabled) return;
    const token = epoch;
    saving = { rowId: row.osmId, jobId };
    const selection = saving;
    $("list-save-title").textContent = "Salvar · " + row.name;
    $("list-save-status").textContent = "Carregando listas…"; $("list-save-submit").disabled = true;
    $("list-save-dialog").showModal();
    try {
      const records = await request("/api/lists");
      if (!current(token) || selection !== saving || !$("list-save-dialog").open) return;
      options($("list-save-select"), [...records, { id: "create", name: "Criar nova lista…" }], selected);
      $("list-save-name").value = "Favoritos";
      $("list-save-new").hidden = $("list-save-select").value !== "create";
      $("list-save-name").required = !$("list-save-new").hidden;
      $("list-save-status").textContent = ""; $("list-save-submit").disabled = false;
    } catch (error) { if (current(token)) $("list-save-status").textContent = error.message; }
  }
  $("list-save-select").addEventListener("change", () => {
    $("list-save-new").hidden = $("list-save-select").value !== "create";
    $("list-save-name").required = !$("list-save-new").hidden;
  });
  $("list-save-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!saving || !enabled) return;
    const token = epoch, company = { ...saving }, selection = saving;
    const button = $("list-save-submit"); button.disabled = true; $("list-save-status").textContent = "Salvando…";
    try {
      let id = $("list-save-select").value;
      if (id === "create") {
        const record = await request("/api/lists", "POST", { name: $("list-save-name").value });
        if (!current(token)) return;
        id = record.id;
        // If saving fails later, retry into the newly created list instead of duplicating it.
        options($("list-save-select"), [{ id, name: record.name }], id); $("list-save-new").hidden = true; $("list-save-name").required = false;
      }
      const result = await request(`/api/lists/${id}/companies`, "POST", { jobId: company.jobId, osmId: company.rowId });
      if (!current(token)) return;
      if (selection === saving) $("list-save-dialog").close(); $("lists-section").open = true;
      await refresh(id); if (current(token)) status(result.created ? "Empresa salva na lista." : "A empresa já estava nesta lista. Suas notas e seu status foram preservados.");
    } catch (error) { if (current(token) && selection === saving) $("list-save-status").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("list-name-form").addEventListener("submit", async event => {
    event.preventDefault(); if (!naming || !enabled) return;
    const token = epoch, action = { ...naming }; $("list-name-submit").disabled = true;
    try {
      const result = await request(action.action === "create" ? "/api/lists" : `/api/lists/${action.id}`, action.action === "create" ? "POST" : "PATCH", { name: $("list-name").value });
      if (!current(token)) return;
      $("list-name-dialog").close(); $("lists-section").open = true;
      await refresh(result.id || action.id); status(action.action === "create" ? "Lista criada." : "Lista renomeada.");
    } catch (error) { if (current(token)) $("list-name-status").textContent = error.message; }
    finally { $("list-name-submit").disabled = false; }
  });
  for (const prefix of ["list-save", "list-name"]) $(prefix + "-cancel").addEventListener("click", () => $(prefix + "-dialog").close());
  $("list-create").addEventListener("click", () => nameDialog("create"));
  $("list-rename").addEventListener("click", () => nameDialog("rename"));
  $("list-delete").addEventListener("click", async () => {
    const record = lists.find(item => item.id === selected);
    if (!record || !window.confirm(`Excluir a lista “${record.name}” com ${record.count} empresas? As notas desta lista também serão excluídas.`)) return;
    const token = epoch; $("list-delete").disabled = true;
    try { await request(`/api/lists/${record.id}`, "DELETE"); if (current(token)) { await refresh(); status("Lista excluída."); } }
    catch (error) { if (current(token)) status(error.message); }
    finally { $("list-delete").disabled = !selected; }
  });
  $("list-select").addEventListener("change", () => { selected = $("list-select").value; void loadCompanies(); });
  $("lists-refresh").addEventListener("click", () => { void refresh(); });
  $("list-search").addEventListener("input", render); $("list-status-filter").addEventListener("change", render);
  window.addEventListener("prospect:session-expired", clear);
  window.addEventListener("hashchange", () => { if ($("workspace").hidden) clear(); });
  return {
    whatsappButton,
    initialize() {
      enabled = accountUI.mode === "password" && Boolean(accountUI.profile);
      $("lists-section").hidden = !enabled;
      if (enabled) void refresh();
    },
    button(row, job) {
      if (!enabled) return null;
      const button = node("button", "Salvar na lista", "save-to-list"); button.type = "button";
      button.setAttribute("aria-label", `Salvar ${row.name} em uma lista`);
      button.disabled = !job?.id || job.state === "running";
      if (button.disabled) button.title = "Aguarde a pesquisa terminar.";
      button.addEventListener("click", () => { void openSave(row, job.id); });
      return button;
    }
  };
})();
