"use strict";

// Adapter for gosom/google-maps-scraper v1.18.1, the engine used by
// Mahanaicoach/google-maps-scraper-kit. No agent skill is executed by the app.
const { createHash } = require("node:crypto");
const contacts = require("./contacts.cjs");
const ENDPOINT = "http://127.0.0.1:8080";
const LIMITS = Object.freeze({ depth: 3, maxTime: 180, totalMs: 205000,
  requestMs: 10000, pollMs: 2000, bytes: 4 * 1024 * 1024, results: 20 });
const queriesBR = {
  "Auto Detailing": "estética automotiva", Cleaning: "empresa de limpeza",
  Landscaping: "paisagismo", Plumbing: "encanador", HVAC: "ar condicionado",
  Roofing: "telhados", Painting: "pintor", Fencing: "instalação de cercas",
  "Pressure Washing": "limpeza de fachadas", Moving: "empresa de mudanças",
  Handyman: "marido de aluguel", Barber: "barbearia", "Hair Salon": "salão de beleza",
  Electrician: "eletricista"
};
const failure = (code, message) => Object.assign(new Error(message), { code });

function configuration(env) {
  const enabled = env.BUSINESS_PROVIDER === "google-maps";
  const testMode = env.PROSPECT_TEST_MODE === "true";
  if (enabled && !testMode) throw new Error("Google Maps exige PROSPECT_TEST_MODE=true nesta branch.");
  if (testMode && (env.DATABASE_URL || (env.AUTH_MODE && env.AUTH_MODE !== "basic") ||
      env.GROQ_API_KEY || env.BREVO_API_KEY || env.APP_FRONTEND_ORIGIN)) {
    throw new Error("O teste exige login básico, mesma origem e nenhuma credencial de contas, e-mail ou IA.");
  }
  return { enabled, testMode };
}

function parseCSV(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > LIMITS.bytes) {
    throw failure("maps_csv_limit", "O resultado do scraper excedeu o limite do teste.");
  }
  const records = []; let row = [], cell = "", quoted = false, closed = false;
  const push = () => { row.push(cell); cell = ""; closed = false; };
  const finish = () => { push(); if (row.some(value => value.length)) records.push(row); row = []; };
  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"' && !cell && !closed) quoted = true;
    else if (char === ",") push();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finish();
    } else if (closed || char === '"') throw failure("maps_csv_invalid", "CSV inválido retornado pelo scraper.");
    else cell += char;
  }
  if (quoted) throw failure("maps_csv_invalid", "CSV incompleto retornado pelo scraper.");
  if (cell || row.length || closed) finish();
  if (!records.length) return [];
  const headers = records.shift();
  if (!headers.includes("title") || !headers.includes("place_id") || new Set(headers).size !== headers.length) {
    throw failure("maps_csv_invalid", "O scraper retornou colunas incompatíveis.");
  }
  return records.map(values => {
    if (values.length !== headers.length) throw failure("maps_csv_invalid", "CSV com colunas incompletas.");
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

function sourceURL(row) {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${row.name} ${row.city}`);
  if (row.placeId) url.searchParams.set("query_place_id", row.placeId);
  return url.href;
}

function normalizeRows(records, place, niche, city) {
  const [south, north, west, east] = place.boundingbox.map(Number);
  const seen = new Set(), rows = [];
  for (const record of records) {
    const name = (record.title || "").trim().slice(0, 300);
    const lat = record.latitude?.trim() ? Number(record.latitude) : NaN;
    const lon = (record.longitude || record.longtitude)?.trim() ? Number(record.longitude || record.longtitude) : NaN;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < south || lat > north || lon < west || lon > east) continue;
    if (/permanently.closed|closed.permanently|permanentemente.fechad|fechad.*permanentemente/i.test(record.status || "")) continue;
    const placeId = /^[A-Za-z0-9_-]{5,200}$/.test(record.place_id || "") ? record.place_id : "";
    const id = placeId || createHash("sha256").update(`${name}:${lat}:${lon}`).digest("hex");
    if (seen.has(id)) continue;
    seen.add(id);
    const website = contacts.websiteURL(record.website || "");
    const phone = (record.phone || "").trim().slice(0, 200);
    const row = {
      name, category: niche, sourceCategory: (record.category || "").slice(0, 200),
      city: place.name || city.split(",")[0].trim(), address: (record.address || "").slice(0, 1000),
      phone, mobilePhone: "", whatsappPhone: "", sitePhone: "",
      phoneSource: phone ? "Google Maps · telefone cadastrado" : "",
      phoneVerification: phone ? "listed" : "not_listed",
      website, websiteSource: website ? "Google Maps · website cadastrado" : "",
      websiteVerification: website ? "listed" : "not_identified",
      invalidListedWebsite: Boolean(record.website && !website),
      countryCode: contacts.countryCode(place.address?.country_code),
      latitude: lat, longitude: lon, osmId: `google:${id}`, osmIds: [], placeId,
      source: "Google Maps", matchMethod: "search", chainSignal: false,
      status: website ? "WEBSITE_LISTED" : "UNCERTAIN", confidence: website ? 0.4 : 0,
      reason: website ? "Site cadastrado no Google Maps; aguardando verificação."
        : "Site não informado no Google Maps. Isso não comprova ausência de site.",
      verification: null
    };
    const rating = Number(record.review_rating), count = Number(record.review_count);
    if (record.review_rating?.trim() && Number.isFinite(rating) && rating >= 0 && rating <= 5) row.rating = rating;
    if (record.review_count?.trim() && Number.isSafeInteger(count) && count >= 0) row.reviewCount = count;
    row.sourceUrl = sourceURL(row);
    rows.push(row);
  }
  return rows;
}

function createClient({ fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, limits = LIMITS } = {}) {
  let busy = false, blocked = false;
  async function request(route, { method = "GET", body, csv = false, deadline = now() + limits.requestMs } = {}) {
    let response;
    try {
      response = await fetcher(ENDPOINT + route, { method, redirect: "error",
        signal: AbortSignal.timeout(Math.max(1, Math.min(limits.requestMs, deadline - now()))),
        headers: { Accept: csv ? "text/csv" : "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("HTTP"); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body || []) {
        bytes += chunk.length;
        if (bytes > limits.bytes) throw failure("maps_response_limit", "O resultado do scraper excedeu o limite do teste.");
        chunks.push(Buffer.from(chunk));
      }
      const value = Buffer.concat(chunks).toString("utf8");
      return csv ? value : JSON.parse(value);
    } catch (error) {
      if (error.code?.startsWith("maps_")) throw error;
      throw failure("maps_engine_unavailable", "O motor Google Maps não respondeu corretamente. Aguarde; não houve repetição automática.");
    }
  }
  return {
    async discover(place, niche, city, { onProgress = () => {}, onTrace = () => {} } = {}) {
      if (blocked) throw failure("maps_engine_restart_required", "Reinicie o ambiente de testes: uma tarefa anterior não terminou com segurança.");
      if (busy) throw failure("maps_busy", "Uma pesquisa Google Maps já está em andamento.");
      const latitude = Number(place.lat), longitude = Number(place.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        throw failure("maps_location_invalid", "A cidade não forneceu coordenadas válidas.");
      }
      busy = true; let id, finished = false;
      const deadline = now() + limits.totalMs;
      try {
        const country = contacts.countryCode(place.address?.country_code);
        const keyword = country === "BR" ? queriesBR[niche] || niche : niche;
        onProgress("Consultando Google Maps. O teste pode levar alguns minutos…");
        const started = await request("/api/v1/jobs", { method: "POST", deadline, body: {
          name: "Prospect AI · teste isolado", keywords: [`${keyword} in ${city}`],
          lang: country === "BR" ? "pt" : "en", zoom: 14, lat: String(latitude), lon: String(longitude),
          fast_mode: true, radius: 10000, depth: limits.depth, max_time: limits.maxTime,
          email: false, extra_reviews: false, proxies: []
        } });
        // The engine returns lowercase id on creation and capitalized Job fields when polling.
        id = started.id;
        if (!/^[a-f0-9-]{36}$/i.test(id || "")) throw failure("maps_job_invalid", "O scraper não retornou uma tarefa válida.");
        while (now() < deadline) {
          const job = await request(`/api/v1/jobs/${id}`, { deadline });
          const status = job.Status ?? job.status;
          onTrace({ endpoint: "local-google-maps-engine", purpose: "businesses", outcome: status });
          if (status === "ok") {
            finished = true;
            const csv = await request(`/api/v1/jobs/${id}/download`, { csv: true, deadline });
            const records = parseCSV(csv);
            if (!records.length) throw failure("maps_empty", "Google Maps não retornou empresas. Pode ser ausência de resultados ou bloqueio; não houve nova tentativa automática.");
            return { rows: normalizeRows(records, place, niche, city),
              warning: "Teste limitado: resultados por relevância, filtrados pelo retângulo da cidade; cobertura e categoria não garantidas." };
          }
          if (status === "failed") { finished = true; throw failure("maps_job_failed", "O scraper falhou. Pode haver bloqueio ou falta de recursos; nenhuma tentativa automática foi feita."); }
          if (!["pending", "working"].includes(status)) throw failure("maps_status_invalid", "O scraper retornou um estado desconhecido.");
          await sleep(Math.min(limits.pollMs, Math.max(0, deadline - now())));
        }
        throw failure("maps_timeout", "O teste excedeu o tempo de espera. Reinicie o ambiente antes de uma nova busca.");
      } finally {
        // Deleting a running gosom job does not cancel its browser. Prevent a
        // second run on uncertainty instead of stacking hidden browser tasks.
        if (!finished) blocked = true;
        if (finished && id) {
          try { await request(`/api/v1/jobs/${id}`, { method: "DELETE" }); }
          catch { blocked = true; }
        }
        busy = false;
      }
    },
    async ready() { await request("/api/v1/jobs"); return true; }
  };
}

module.exports = { ENDPOINT, LIMITS, configuration, parseCSV, normalizeRows, sourceURL, createClient };
