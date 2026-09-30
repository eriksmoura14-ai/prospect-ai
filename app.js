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
    return localStorage.getItem("prospect-ai-active-job");
  } catch {
    return null;
  }
}

function rememberJob(id) {
  try {
    if (id) localStorage.setItem("prospect-ai-active-job", id);
    else localStorage.removeItem("prospect-ai-active-job");
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
      credentials: "same-origin",
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Tente novamente.");
  }
  if (response.status === 401) {
    const error = new Error(
      "Acesso não autorizado. Recarregue a página e informe seu usuário e senha."
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

function setBusy(value) {
  busy = value;
  $("search").querySelectorAll("input, select, button")
    .forEach(element => { element.disabled = value || !ready; });
  $("search").querySelector("button").textContent =
    value ? "Aguarde…" : "Buscar empresas";
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
      return;
    }
    await sleep(1800);
  }
}

$("search").addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || !ready) return;
  const city = $("city").value.trim();
  if (city.length < 2) {
    $("city").setCustomValidity("Informe uma cidade com pelo menos dois caracteres.");
    $("city").reportValidity();
    return;
  }
  const payload = {
    city, niche: $("niche").value, limit: Number($("quantity").value)
  };
  const pendingJob = storedJob();
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

$("city").addEventListener("input", () => { $("city").setCustomValidity(""); });
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
  document.querySelector(".version").textContent = "Pesquisa de empresas · v0.2";
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
    link("© OpenStreetMap contributors · ODbL", "https://www.openstreetmap.org/copyright")
  );
  setBusy(true);
  progressText = "Conectando ao servidor…";
  render();

  try {
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
    
