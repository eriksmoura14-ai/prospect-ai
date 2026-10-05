"use strict";

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let rows = [];
let filter = "all";
let busy = false;
let ready = false;
let searched = false;
let progressText = "";
let lastJob = null;
let searchError = "";
let globeJobLocationKey = "";

const fields = [
  "name", "category", "city", "address", "phone", "website",
  "status", "confidence", "prospectScore", "latitude", "longitude",
  "osmId", "source"
];

const states = {
  WEBSITE_LISTED: { label: "Site listado", className: "found" },
  WEBSITE_FOUND: { label: "Site encontrado", className: "found" },
  LIKELY_NO_WEBSITE: {
    label: "Provavelmente sem site", className: "prospect"
  },
  UNCERTAIN: { label: "Incerto", className: "uncertain" }
};

function storedJob() {
  try {
    return localStorage.getItem(accountUI.jobKey());
  } catch {
    return null;
  }
}

function rememberJob(id) {
  try {
    if (id) localStorage.setItem(accountUI.jobKey(), id);
    else localStorage.removeItem(accountUI.jobKey());
  } catch {
    // O armazenamento é opcional.
  }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function link(text, href) {
  const element = node("a", "", text);
  element.href = href;
  element.target = "_blank";
  element.rel = "noopener noreferrer";
  return element;
}

function safeWebsite(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) ||
        url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function hasWebsite(row) {
  return ["WEBSITE_LISTED", "WEBSITE_FOUND"].includes(row.status);
}

function visibleRows() {
  const phoneFilter = $("phone-filter").value;
  const sort = $("sort").value;
  return rows.filter(row => {
    const statusOK = filter === "all" ||
      (filter === "prospect" && row.status === "LIKELY_NO_WEBSITE") ||
      (filter === "found" && hasWebsite(row)) ||
      (filter === "uncertain" && row.status === "UNCERTAIN");
    const phoneOK = phoneFilter === "all" ||
      (phoneFilter === "yes" && Boolean(row.phone)) ||
      (phoneFilter === "no" && !row.phone);
    return statusOK && phoneOK;
  }).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "pt-BR");
    if (sort === "confidence") return b.confidence - a.confidence;
    return b.prospectScore - a.prospectScore;
  });
}

function makeCard(row) {
  const state = states[row.status] || states.UNCERTAIN;
  const card = node("article", "panel card");
  const business = node("div", "business");
  business.append(
    node("h3", "", row.name),
    node("p", "meta", `${row.category} · ${row.city} · OpenStreetMap`)
  );

  const contact = node("div", "contact");
  contact.append(
    node("span", "", row.phone || "Telefone não informado"),
    node("span", "", row.address || "Endereço não informado")
  );
  business.append(contact);

  const website = node("div", "website");
  const websiteUrl = safeWebsite(row.website);
  if (websiteUrl) website.append(link(websiteUrl, websiteUrl));
  else website.textContent = row.status === "LIKELY_NO_WEBSITE"
    ? "Nenhum website encontrado nas verificações realizadas."
    : "Website não confirmado.";
  business.append(website);

  const actions = node("div", "actions");
  if (Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) {
    actions.append(link("Ver no mapa",
      `https://www.openstreetmap.org/?mlat=${row.latitude}` +
      `&mlon=${row.longitude}#map=18/${row.latitude}/${row.longitude}`));
  }
  actions.append(link("Pesquisar manualmente",
    "https://www.google.com/search?q=" +
    encodeURIComponent(`${row.name} ${row.city} website`)));
  if (/^(node|way|relation)\/\d+$/.test(row.osmId)) {
    actions.append(link("Ver fonte",
      `https://www.openstreetmap.org/${row.osmId}`));
  }
  const aiButton = node("button", "", "Abrir assistente de IA");
  aiButton.type = "button";
  aiButton.disabled = !lastJob?.id || lastJob.state === "running";
  aiButton.title = aiButton.disabled ? "Aguarde a pesquisa terminar." : "Revisar empresa e preparar mensagens";
  aiButton.addEventListener("click", () => openAIPanel(row, lastJob.id));
  actions.append(aiButton);
  const saveButton = prospectLists.button(row, lastJob);
  if (saveButton) actions.append(saveButton);
  business.append(actions);

  const verification = node("div", "verification");
  verification.append(
    node("span", `badge ${state.className}`, state.label),
    node("div", "confidence",
      `Confidence: ${Number(row.confidence).toFixed(2)}`),
    node("p", "reason", row.reason || "Verificação ainda não concluída.")
  );

  if (row.verification) {
    const details = node("details", "reason");
    details.dataset.osmId = row.osmId;
    details.append(node("summary", "",
      `${row.verification.candidatesChecked} de ` +
      `${row.verification.candidatesTotal} candidatos verificados`));
    if (row.verification.checkedAt) {
      details.append(node("p", "", "Verificado em " +
        new Date(row.verification.checkedAt).toLocaleString("pt-BR")));
    }
    for (const evidence of row.verification.evidence || []) {
      const description = [
        evidence.domain, evidence.protocol,
        evidence.httpStatus ? `HTTP ${evidence.httpStatus}` : "",
        evidence.title, evidence.finalUrl,
        evidence.error || evidence.reason ||
          (evidence.dns === "absent" ? "Sem endereço DNS encontrado" : "")
      ].filter(Boolean).join(" · ");
      const line = node("p", "", description);
      line.style.overflowWrap = "anywhere";
      details.append(line);
    }
    verification.append(details);
  }

  const score = node("div", "score");
  score.append(
    node("span", "score-label", "Prospect Score"),
    node("strong", "", String(row.prospectScore)),
    node("span", "", " /100")
  );
  const bar = document.createElement("progress");
  bar.max = 100;
  bar.value = row.prospectScore;
  bar.setAttribute("aria-label", "Prospect Score");
  score.append(bar);
  card.append(business, verification, score);
  return card;
}

function render() {
  // Antes de a fonte responder, a quantidade ainda é desconhecida.
  const awaitingResults = busy && rows.length === 0 &&
    !searchError && (!lastJob || lastJob.totalDiscovered == null);
  $("total").textContent = awaitingResults ? "—" : rows.length;
  $("prospects").textContent = awaitingResults ? "—" :
    rows.filter(row => row.status === "LIKELY_NO_WEBSITE").length;
  $("websites").textContent = awaitingResults ? "—" :
    rows.filter(hasWebsite).length;
  $("uncertain").textContent = awaitingResults ? "—" :
    rows.filter(row => row.status === "UNCERTAIN").length;
  $("phones").textContent = awaitingResults ? "—" :
    rows.filter(row => Boolean(row.phone)).length;

  const visible = visibleRows();
  const openDetails = new Set(
    [...$("cards").querySelectorAll("details[open]")]
      .map(element => element.dataset.osmId)
  );
  $("cards").replaceChildren();
  $("csv").disabled = visible.length === 0;
  $("json").disabled = visible.length === 0;

  const countKnown = searched &&
    (rows.length > 0 || lastJob?.state === "done");
  $("summary").textContent = [
    progressText,
    countKnown ? `${visible.length} de ${rows.length} resultados visíveis` : ""
  ].filter(Boolean).join(" · ");

  if (!visible.length) {
    let title;
    let description;
    if (searchError) {
      title = "Não foi possível concluir a pesquisa";
      description = searchError;
    } else if (rows.length > 0) {
      title = "Nenhuma empresa corresponde aos filtros";
      description = "Selecione Todos nos filtros de site e telefone para ver as empresas encontradas.";
    } else if (busy) {
      title = searched ? "Consultando empresas…" : "Conectando ao servidor…";
      description = "A quantidade será exibida quando os resultados chegarem.";
    } else if (lastJob?.state === "done") {
      title = "Nenhuma empresa encontrada nesta pesquisa";
      description = "Tente outro nicho ou cidade. A cobertura da fonte varia por região.";
    } else if (searched) {
      title = "Pesquisa sem resultados disponíveis";
      description = progressText || "Inicie uma pesquisa para consultar empresas.";
    } else {
      title = "Sua pesquisa começa aqui";
      description = "Informe cidade e nicho para procurar negócios públicos.";
    }
    const empty = node("div", "panel empty");
    empty.append(node("h3", "", title), node("p", "", description));
    $("cards").append(empty);
    return;
  }

  for (const row of visible) {
    const card = makeCard(row);
    const details = card.querySelector("details");
    if (details && openDetails.has(row.osmId)) details.open = true;
    $("cards").append(card);
  }
}

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...options.headers, ...(accountUI.csrf ? { "X-CSRF-Token": accountUI.csrf } : {}) },
      credentials: "same-origin",
      signal: options.signal || AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
  }
  if (response.status === 401) {
    accountUI.expire();
    const error = new Error(
      accountUI.mode === "password" ? "Sua sessão terminou. Entre novamente." : "Acesso não autorizado. Recarregue a página e informe seu usuário e senha."
    );
    error.status = 401;
    throw error;
  }
  let data;
  try {
    data = await response.json();
  } catch {
    const error = new Error(
      "O servidor não retornou uma resposta válida. " +
      "Ele pode estar iniciando; aguarde e recarregue a página."
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a solicitação.");
    error.status = response.status;
    error.jobId = data.jobId;
    throw error;
  }
  return data;
}

const locationPicker = new LocationPicker({ api, isLocked: () => busy || !ready,
  canResume: () => Boolean(storedJob()) });

function setBusy(value) {
  busy = value;
  $("search").querySelectorAll("input, select, button")
    .forEach(element => { element.disabled = value || !ready; });
  $("search").querySelector('button[type="submit"]').textContent =
    value ? "Aguarde…" : storedJob() ? "Reconectar pesquisa" : "Buscar empresas";
  locationPicker.sync();
}

async function watch(jobId) {
  let failures = 0;
  while (true) {
    let job;
    try {
      job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      failures = 0;
    } catch (error) {
      if (error.status === 404) {
        rememberJob(null);
        throw error;
      }
      if (error.status === 401) throw error;
      failures++;
      if (failures >= 3) {
        throw new Error(
          "Conexão interrompida. A pesquisa pode continuar no servidor. " +
          "Clique em Buscar empresas para tentar reconectar."
        );
      }
      await sleep(2000 * failures);
      continue;
    }

    lastJob = job;
    const point = job.discoveryDiagnostics?.geocode?.selected;
    if (point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
      const key = `${jobId}:${point.latitude}:${point.longitude}`;
      if (key !== globeJobLocationKey) {
        globeJobLocationKey = key;
        window.prospectLocationTarget = {
          latitude: point.latitude, longitude: point.longitude, stage: "city",
          label: point.name || job.place || "", countryCode: point.address?.country_code?.toUpperCase() || ""
        };
        window.dispatchEvent(new CustomEvent("prospect:location", { detail: window.prospectLocationTarget }));
      }
    }
    rows = job.rows || [];
    searchError = job.state === "error"
      ? job.message || "Erro durante a pesquisa." : "";
    progressText = [
      job.message,
      job.place || "",
      job.geographicScope || "",
      job.totalDiscovered != null
        ? `${job.totalDiscovered} correspondências na fonte; ${job.total} selecionadas`
        : ""
    ].filter(Boolean).join(" · ");
    render();
    if (job.state === "done" || job.state === "error") {
      rememberJob(null);
      if (job.persistenceWarning) { progressText += " · " + job.persistenceWarning; render(); }
      void accountUI.refreshHistory();
      return;
    }
    await sleep(1800);
  }
}

$("search").addEventListener("submit", async event => {
  event.preventDefault();
  const pendingJob = storedJob();
  if (busy || !ready || (!pendingJob && !locationPicker.valid())) return;
  const payload = pendingJob ? null : {
    location: locationPicker.payload(), niche: $("niche").value, limit: Number($("quantity").value)
  };
  const previousRows = rows;
  const previousJob = lastJob;
  searched = true;
  searchError = "";
  // Só mantém a pesquisa anterior se a criação da nova busca falhar.
  rows = [];
  lastJob = null;
  progressText = pendingJob ? "Reconectando à pesquisa…" : "Iniciando pesquisa…";
  setBusy(true);
  render();

  try {
    if (pendingJob) {
      await watch(pendingJob);
      return;
    }
    const result = await api("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    rememberJob(result.jobId);
    await watch(result.jobId);
  } catch (error) {
    if (error.jobId) {
      try {
        rows = [];
        lastJob = null;
        rememberJob(error.jobId);
        await watch(error.jobId);
      } catch (watchError) {
        searchError = watchError.message;
        progressText = searchError;
      }
    } else {
      if (!storedJob() && !lastJob && previousJob) {
        rows = previousRows;
        lastJob = previousJob;
      }
      searchError = error.message;
      progressText = searchError;
      if (rows.length && !storedJob()) {
        progressText += " Os resultados anteriores foram mantidos.";
      }
    }
  } finally {
    setBusy(false);
    render();
  }
});

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(other => {
      other.setAttribute("aria-pressed", String(other === button));
    });
    render();
  });
});
$("phone-filter").addEventListener("change", render);
$("sort").addEventListener("change", render);

function download(content, type, extension) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const partial = lastJob?.state !== "done";
  anchor.href = url;
  anchor.download = `prospect-ai${partial ? "-parcial" : ""}-${Date.now()}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

$("csv").addEventListener("click", () => {
  const lines = [fields.join(","), ...visibleRows().map(row =>
    fields.map(field => csvCell(row[field])).join(","))];
  download("\uFEFF" + lines.join("\r\n"), "text/csv;charset=utf-8", "csv");
});

$("json").addEventListener("click", () => {
  download(JSON.stringify({
    exportedAt: new Date().toISOString(),
    partial: lastJob?.state !== "done",
    attribution: "© OpenStreetMap contributors",
    license: "https://www.openstreetmap.org/copyright",
    results: visibleRows()
  }, null, 2), "application/json;charset=utf-8", "json");
});

async function initialize() {
  document.title = "Prospect AI";
  document.querySelector(".version").textContent = "Pesquisa de empresas · v0.6";
  document.querySelector(".notice").textContent =
    "Dados públicos do OpenStreetMap. A ausência de website " +
    "cadastrado não significa ausência de site. Durante a busca, " +
    "os negócios ainda não verificados aparecem como incertos.";
  document.querySelector(".form-note").replaceChildren(
    node("span", "", "Pesquisas manuais · cache"),
    node("span", "", "A quantidade escolhida é um limite, não uma garantia de resultados.")
  );
  document.querySelector("footer").replaceChildren(
    node("span", "", "Confidence e Prospect Score são heurísticas, não probabilidades " +
      "calibradas nem garantias comerciais. "),
    link("© OpenStreetMap contributors · ODbL", "https://www.openstreetmap.org/copyright"),
    node("span", "", " · "),
    link("Powered by Geoapify", "https://www.geoapify.com/"),
    node("span", "", " · "),
    link("Localidades: Countries States Cities Database · ODbL", "https://github.com/dr5hn/countries-states-cities-database"),
    node("span", "", " · "),
    link("Terra: NASA / Blue Marble e Black Marble", "https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/")
  );
  setBusy(true);
  progressText = "Conectando ao servidor…";
  render();

  try {
    if (!await accountUI.initialize()) return;
    prospectLists.initialize();
    void locationPicker.initialize();
    const names = await api("/api/niches");
    $("niche").replaceChildren();
    for (const name of names) {
      const option = node("option", "", name);
      option.value = name;
      $("niche").append(option);
    }
    ready = true;
    progressText = "Pronto para pesquisar.";
    const pendingJob = storedJob();
    if (pendingJob) {
      searched = true;
      try {
        await watch(pendingJob);
      } catch (error) {
        searchError = error.message;
        progressText = searchError;
      }
    }
  } catch (error) {
    searchError = error.message;
    progressText = searchError + " Recarregue a página para tentar novamente.";
  } finally {
    setBusy(false);
    render();
  }
}

initialize();

// O painel fica fora dos cartões para não perder campos durante o progresso.
const aiCompanyStates = new Map();
let aiPanel = null;

function readOfferSettings() {
  try {
    const saved = accountUI.mode === "password" ? accountUI.preferences() : JSON.parse(localStorage.getItem("prospect-ai-offer") || "{}");
    return { seller: typeof saved.seller === "string" ? saved.seller : "",
      offer: typeof saved.offer === "string" ? saved.offer : "",
      language: ["Português", "English", "Español"].includes(saved.language)
        ? saved.language : "Português" };
  } catch { return { seller: "", offer: "", language: "Português" }; }
}

function saveOfferSettings(settings) {
  if (accountUI.mode === "password") { accountUI.savePreferences(settings); return; }
  try { localStorage.setItem("prospect-ai-offer", JSON.stringify(settings)); }
  catch { /* O navegador pode bloquear o armazenamento. */ }
}

window.addEventListener("prospect:session-expired", () => {
  rows = []; lastJob = null; ready = false; searched = false; searchError = "";
  aiCompanyStates.clear();
  if (aiPanel) { aiPanel.dialog.close(); aiPanel.dialog.remove(); aiPanel = null; }
  render();
});

window.addEventListener("prospect:history", async event => {
  if (busy || !ready || typeof event.detail !== "string") return;
  searched = true; searchError = ""; setBusy(true);
  try { await watch(event.detail); }
  catch (error) { searchError = error.message; progressText = error.message; }
  finally { setBusy(false); render(); }
});

function createAIPanel() {
  const style = node("style");
  style.textContent = `
    .ai-dialog{background:#121722;color:#edf2fa;border:1px solid #3b4860;
      border-radius:14px;width:min(820px,94vw);max-height:90vh;padding:24px;overflow:auto}
    .ai-dialog::backdrop{background:rgba(0,0,0,.75)}
    .ai-dialog h2{margin:0 0 8px}.ai-dialog h3{margin:20px 0 8px}
    .ai-dialog label{display:block;margin:12px 0}
    .ai-dialog textarea{width:100%;min-height:100px;box-sizing:border-box;
      background:#0c111a;color:#edf2fa;border:1px solid #3b4860;border-radius:8px;
      padding:12px;font:inherit;resize:vertical;margin-top:6px}
    .ai-dialog textarea:focus-visible{outline:3px solid #a6ef75;outline-offset:2px}
    .ai-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
    .ai-row>*{flex:1}.ai-dialog .ai-output{min-height:140px}
    .ai-dialog .ai-audit{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;
      background:#0c111a;border-radius:8px;color:#c3cddd}
    .ai-dialog .ai-note{font-size:13px;color:#a2aec1;margin:8px 0}
    .ai-dialog .ai-status{font-size:14px;color:#a6ef75;white-space:pre-wrap}
    .ai-dialog details p{font-size:13px;overflow-wrap:anywhere}
  `;
  document.head.append(style);
  const dialog = node("dialog", "ai-dialog");
  const title = node("h2", "", "Assistente de IA");
  const close = node("button", "", "Fechar");
  close.type = "button";
  const heading = node("div", "ai-row");
  heading.append(title, close);
  dialog.append(heading, node("p", "ai-note",
    "Revisa evidências e prepara rascunhos. Confira os fatos antes de copiar e enviar."));

  function field(labelText, tag, maxLength, placeholder) {
    const label = node("label", "", labelText);
    const element = node(tag);
    if (maxLength) element.maxLength = maxLength;
    if (placeholder) element.placeholder = placeholder;
    if (tag === "input") element.type = "text";
    label.append(element);
    dialog.append(label);
    return element;
  }
  const seller = field("Seu nome ou nome da sua empresa", "input", 100, "Como você se apresenta ao cliente");
  const offer = field("Sua oferta", "textarea", 1800,
    "Descreva o serviço, o que está incluído e, se desejar, preço, moeda e prazo. A IA usará essas condições.");
  const language = field("Idioma das mensagens", "select");
  for (const value of ["Português", "English", "Español"]) {
    const option = node("option", "", value); option.value = value; language.append(option);
  }

  const status = node("p", "ai-status", "Selecione uma ação.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const actions = node("div", "ai-row");
  const auditButton = node("button", "", "1. Revisar empresa");
  const draftButton = node("button", "", "2. Gerar abordagem");
  auditButton.type = draftButton.type = "button";
  actions.append(auditButton, draftButton);
  dialog.append(actions, status);

  const audit = node("div", "ai-audit", "Nenhuma revisão realizada nesta aba.");
  const sources = node("details");
  const sourceSummary = node("summary", "", "Fontes e checagens");
  const sourceBody = node("div");
  sources.append(sourceSummary, sourceBody);
  dialog.append(node("h3", "", "Revisão da empresa"), audit, sources);

  const draft = field("Rascunho para revisar e enviar", "textarea", 2500);
  draft.className = "ai-output";
  const copy = node("button", "", "Copiar rascunho");
  const record = node("button", "", "Registrar que enviei esta mensagem");
  copy.type = record.type = "button";
  const messageActions = node("div", "ai-row");
  messageActions.append(copy, record); dialog.append(messageActions);

  const history = field("Histórico real da conversa", "textarea", 4000,
    "Cole mensagens que realmente foram enviadas ou recebidas. Ex.: Eu: ... / Cliente: ...");
  const clientMessage = field("Nova resposta do cliente", "textarea", 2000,
    "Cole aqui a resposta para a IA sugerir como continuar.");
  const replyButton = node("button", "primary", "3. Sugerir resposta");
  replyButton.type = "button";
  dialog.append(replyButton, node("p", "ai-note",
    "Os campos informados serão enviados à Groq quando você usar a IA. Remova dados pessoais sensíveis. " +
    (accountUI.mode === "password" ? "Sua oferta fica salva na sua conta; " : "A oferta fica salva neste navegador; ") +
    "o histórico da conversa fica apenas nesta aba. Copie-o antes de recarregar."));
  document.body.append(dialog);
  const panel = { dialog, title, seller, offer, language, status, audit, sourceBody,
    draft, history, clientMessage, auditButton, draftButton, replyButton,
    copy, record, busy: false, selection: null };

  function saveState() {
    if (!panel.selection) return;
    Object.assign(panel.selection.state, {
      draft: draft.value, history: history.value, clientMessage: clientMessage.value
    });
    saveOfferSettings({ seller: seller.value, offer: offer.value, language: language.value });
  }
  for (const element of [seller, offer, language, draft, history, clientMessage]) {
    element.addEventListener("input", saveState);
    element.addEventListener("change", saveState);
  }
  close.addEventListener("click", () => { saveState(); dialog.close(); });
  dialog.addEventListener("cancel", saveState);
  copy.addEventListener("click", async () => {
    if (!draft.value.trim()) { status.textContent = "Gere ou escreva um rascunho primeiro."; return; }
    try { await navigator.clipboard.writeText(draft.value); status.textContent = "Rascunho copiado."; }
    catch { draft.focus(); draft.select(); status.textContent = "Texto selecionado. Use a opção Copiar do seu navegador."; }
  });
  record.addEventListener("click", () => {
    if (!draft.value.trim()) { status.textContent = "Não há mensagem para registrar."; return; }
    const state = panel.selection.state;
    const pending = state.draftAction === "reply" && clientMessage.value.trim()
      ? "Cliente: " + clientMessage.value.trim() + "\n" : "";
    const entry = pending + "Eu: " + draft.value.trim();
    const combined = [history.value.trim(), entry].filter(Boolean).join("\n\n");
    if (combined.length > 4000) {
      status.textContent = "O histórico está cheio. Copie-o e mantenha só as mensagens relevantes."; return;
    }
    history.value = combined;
    if (pending) clientMessage.value = "";
    // Limpa o rascunho para evitar registrar a mesma mensagem por engano.
    draft.value = ""; state.draftAction = ""; saveState();
    status.textContent = "Mensagem registrada no histórico desta aba.";
  });

  async function run(action) {
    if (panel.busy) return;
    if (action !== "audit" && (!seller.value.trim() || !offer.value.trim())) {
      status.textContent = "Preencha seu nome e sua oferta antes de gerar a mensagem."; return;
    }
    if (action === "reply" && !clientMessage.value.trim()) {
      status.textContent = "Cole a nova resposta do cliente."; return;
    }
    saveState();
    const selection = panel.selection;
    panel.busy = true;
    for (const button of [auditButton, draftButton, replyButton, record]) button.disabled = true;
    status.textContent = "Conferindo evidências e consultando a IA…";
    try {
      const result = await api("/api/ai", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(65000),
        body: JSON.stringify({ action, jobId: selection.jobId, osmId: selection.row.osmId,
          seller: seller.value, offer: offer.value, language: language.value,
          history: history.value, clientMessage: clientMessage.value,
          previousDraft: draft.value })
      });
      if (action === "audit") selection.state.audit = result.text;
      else { selection.state.draft = result.text.slice(0, 2500); selection.state.draftAction = action; }
      selection.state.evidence = result.evidence;
      // Uma geração em curso pode terminar após o usuário fechar o painel.
      if (panel.selection === selection) {
        audit.textContent = selection.state.audit || "Use Revisar empresa para gerar o resumo das evidências.";
        draft.value = selection.state.draft || "";
        showAISources(panel, result.evidence);
        status.textContent = action === "audit" ? "Revisão pronta. Confira as fontes abaixo."
          : "Rascunho pronto. Revise e copie para enviar.";
      }
    } catch (error) {
      if (panel.selection === selection) status.textContent = error.message;
    } finally {
      panel.busy = false;
      for (const button of [auditButton, draftButton, replyButton, record]) button.disabled = false;
    }
  }
  auditButton.addEventListener("click", () => run("audit"));
  draftButton.addEventListener("click", () => run("draft"));
  replyButton.addEventListener("click", () => run("reply"));
  return panel;
}

function showAISources(panel, evidence) {
  panel.sourceBody.replaceChildren();
  if (!evidence) return;
  const source = safeWebsite(evidence.source);
  if (source) panel.sourceBody.append(link("Cadastro no OpenStreetMap", source));
  panel.sourceBody.append(node("p", "", evidence.contactStatus || ""));
  const website = evidence.websiteCheck || {};
  const url = safeWebsite(website.source);
  if (url) panel.sourceBody.append(link("Página do site", url));
  panel.sourceBody.append(node("p", "", website.note || ""));
  if (website.httpStatus) panel.sourceBody.append(node("p", "", `HTTP ${website.httpStatus}`));
  if (website.matching) panel.sourceBody.append(node("p", "",
    "Correspondências na página: " + Object.entries(website.matching).map(([key, yes]) =>
      `${({name:"nome",city:"cidade",phone:"telefone",address:"endereço"})[key] || key}: ${yes ? "sim" : "não"}`
    ).join(" · ")));
  if (evidence.checkedAt) panel.sourceBody.append(node("p", "",
    "Checado em " + new Date(evidence.checkedAt).toLocaleString("pt-BR")));
}

function openAIPanel(row, jobId) {
  if (!aiPanel) aiPanel = createAIPanel();
  if (aiPanel.busy && aiPanel.selection?.row.osmId !== row.osmId) {
    aiPanel.dialog.showModal();
    aiPanel.status.textContent = "Aguarde a geração atual antes de trocar de empresa.";
    return;
  }
  const key = `${jobId}:${row.osmId}`;
  if (!aiCompanyStates.has(key)) {
    if (aiCompanyStates.size >= 100) aiCompanyStates.delete(aiCompanyStates.keys().next().value);
    aiCompanyStates.set(key, { draft: "", history: "", clientMessage: "", audit: "", evidence: null });
  }
  const state = aiCompanyStates.get(key);
  // Não substitui a seleção que uma geração pendente está usando.
  if (!aiPanel.busy) aiPanel.selection = { row, jobId, state };
  const settings = readOfferSettings();
  aiPanel.title.textContent = "Assistente · " + row.name;
  aiPanel.seller.value = settings.seller; aiPanel.offer.value = settings.offer;
  aiPanel.language.value = settings.language;
  aiPanel.draft.value = state.draft; aiPanel.history.value = state.history;
  aiPanel.clientMessage.value = state.clientMessage;
  aiPanel.audit.textContent = state.audit || "Nenhuma revisão realizada nesta aba.";
  showAISources(aiPanel, state.evidence);
  if (!aiPanel.busy) aiPanel.status.textContent = "Selecione uma ação.";
  aiPanel.dialog.showModal();
}
