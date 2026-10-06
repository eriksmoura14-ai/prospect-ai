"use strict";

const http = require("node:http");
const https = require("node:https");
const dns = require("node:dns").promises;
const fs = require("node:fs");
const path = require("node:path");
const {
  randomUUID,
  createHash,
  timingSafeEqual
} = require("node:crypto");

const niches = require("./niches.cjs");
const nicheMatching = require("./niche-matching.cjs");
const agent = require("./agent.cjs");
const overpass = require("./overpass.cjs");
const geoapify = require("./geoapify.cjs");
const locations = require("./locations.cjs");
const geocoding = require("./geocoding.cjs");
const contacts = require("./contacts.cjs");
const websiteEvidence = require("./website-evidence.cjs");
const GEOAPIFY_KEY = (process.env.GEOAPIFY_API_KEY || "").trim();
const BUSINESS_PROVIDER = process.env.BUSINESS_PROVIDER || "overpass";
if (!["overpass", "geoapify"].includes(BUSINESS_PROVIDER)) throw new Error("BUSINESS_PROVIDER inválido.");

// Configuração local e hospedada.
const hosting = require("./hosting.cjs").configuration(process.env);
const HOSTED = hosting.hosted;
const PORT = hosting.port;
const ORIGIN = hosting.origin;
const accountAuth = require("./auth.cjs");
const authConfig = accountAuth.configuration(process.env, hosting);
const accountService = accountAuth.createService(authConfig);
const requestSecurity = require("./request-security.cjs");
const requestGate = requestSecurity.createGate();

const USER = process.env.APP_USER || "admin";
const PASSWORD = process.env.APP_PASSWORD || "";

const UA =
  `ProspectAI/0.2 (+${ORIGIN}; public business research)`;

const LOCATIONIQ_KEY = (process.env.LOCATIONIQ_KEY || "").trim();
const serveStatic = require("./static-resources.cjs").createResponder({
  root: __dirname, locationIQ: Boolean(LOCATIONIQ_KEY)
});

const NOMINATIM =
  process.env.NOMINATIM_URL ||
  "https://nominatim.openstreetmap.org/search";

const OVERPASS =
  process.env.OVERPASS_URL ||
  "https://overpass.private.coffee/api/interpreter";
const OVERPASS_API_KEY = (process.env.OVERPASS_API_KEY || "").trim();

// Alternativas só existem quando configuradas explicitamente no servidor.
// Cada uma deve oferecer a base mundial do OpenStreetMap.
const OVERPASS_ENDPOINTS = [OVERPASS, ...(process.env.OVERPASS_FALLBACK_URLS || "")
  .split(",").map(value => value.trim()).filter(Boolean)];
const overpassClient = overpass.createClient({ endpoints: OVERPASS_ENDPOINTS,
  userAgent: UA, request: overpass.query, apiKey: OVERPASS_API_KEY,
  method: (process.env.OVERPASS_HTTP_METHOD || "POST").toUpperCase(),
  family: Number(process.env.OVERPASS_IP_FAMILY || 0) });

if (HOSTED && authConfig.mode === "basic" && PASSWORD.length < 16) {
  console.error(
    "Configure APP_PASSWORD na hospedagem com pelo menos 16 caracteres."
  );
  process.exit(1);
}

console.log("Business discovery:", JSON.stringify({provider: BUSINESS_PROVIDER, geoapifyConfigured: Boolean(GEOAPIFY_KEY)}));

const HOUR = 3600000;
const PAGE_MAX_BYTES = 768 * 1024;
const PAGE_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const CACHE_DIR = path.join(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "data.json");

const jobs = new Map();

let aiBusy = false;
let lastAI = 0;
const aiEvidenceCache = new Map();
const pageCache = new Map();
const pageInFlight = new Map();
// Verifica no máximo três empresas simultaneamente.
const VERIFY_CONCURRENCY = 3;

let activeJob = null;
let lastSearch = 0;
let lastGeocode = 0;
let cache = {};
let cacheTimer = null;
let lastDiscoveryDiagnostics = null;
let diagnosticProbe = null;
let lastProbeAt = 0;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const normalize = value =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Localidades precisam manter alfabetos não latinos nas chaves e comparação.
// A normalização da classificação comercial permanece inalterada.
const normalizeLocation = value =>
  String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  cache = {};
}

function cached(key) {
  const item = cache[key];
  return item && item.expires > Date.now()
    ? item.value
    : undefined;
}

function saveCache(key, value, ttl = 6 * HOUR) {
  cache[key] = {
    value,
    expires: Date.now() + ttl
  };

  if (cacheTimer) return;

  cacheTimer = setTimeout(() => {
    cacheTimer = null;

    cache = Object.fromEntries(
      Object.entries(cache)
        .filter(([, item]) => item.expires > Date.now())
        .slice(-2000)
    );

    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(
        CACHE_FILE + ".tmp",
        JSON.stringify(cache)
      );
      fs.renameSync(CACHE_FILE + ".tmp", CACHE_FILE);
    } catch {
      console.warn("Cache mantido apenas em memória.");
    }
  }, 500);

  cacheTimer.unref();
}

function authenticated(request) {
  if (!PASSWORD) return !HOSTED;

  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Basic ")) return false;

  const received = Buffer.from(
    authorization.slice(6),
    "base64"
  ).toString("utf8");

  const digest = text =>
    createHash("sha256").update(text).digest();

  return timingSafeEqual(
    digest(received),
    digest(`${USER}:${PASSWORD}`)
  );
}

async function fetchJSON(url, options = {}, geocode = false, timeoutMs = 35000, maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (geocode) {
      await sleep(
        Math.max(0, 1100 - (Date.now() - lastGeocode))
      );
      lastGeocode = Date.now();
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          ...options.headers
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        const retryable = [429, 502, 503, 504]
          .includes(response.status);

        const retryAfter =
          response.headers.get("retry-after");

        let delay = 2000;

        if (retryAfter) {
          delay = /^\d+$/.test(retryAfter)
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - Date.now();

          if (!Number.isFinite(delay)) delay = 2000;
        }

        await response.body?.cancel();

        if (retryable && attempt + 1 < maxAttempts && delay <= 10000) {
          await sleep(Math.max(2000, delay));
          continue;
        }

        throw Object.assign(new Error(`Serviço respondeu HTTP ${response.status}.`), { httpStatus: response.status });
      }

      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;

      while (true) {
        const part = await reader.read();
        if (part.done) break;

        total += part.value.length;

        if (total > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Resposta excedeu o limite de tamanho.");
        }

        chunks.push(Buffer.from(part.value));
      }

      return JSON.parse(
        Buffer.concat(chunks).toString("utf8")
      );
    } catch (error) {
      const transient =
        error instanceof TypeError ||
        ["TimeoutError", "AbortError"].includes(error.name);

      if (attempt + 1 < maxAttempts && transient) {
        await sleep(2000);
        continue;
      }

      throw error;
    }
  }
}

function locationSummary(place) {
  if (!place || typeof place !== "object") place = {};
  const coordinate = value => typeof value === "number" || typeof value === "string" && value.trim() !== ""
    ? Number(value) : NaN;
  const latitude = coordinate(place.lat);
  const longitude = coordinate(place.lon);
  const visualPoint = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? {latitude, longitude} : {};
  return {
    displayName: place.display_name, name: place.name,
    osmType: place.osm_type, osmId: place.osm_id,
    category: place.category || place.class, type: place.type,
    boundingbox: place.boundingbox,
    address: place.address,
    ...(place.prospectGeocoder ? {geocoder:place.prospectGeocoder} : {}),
    ...visualPoint
  };
}

async function locate(city, onLocation = () => {}, selection = null) {
  const constraint = selection ? `${selection.countryCode}:${selection.stateCode}:${normalizeLocation(selection.stateName)}` : "legacy";
  const key = `city:v7:${BUSINESS_PROVIDER}:${LOCATIONIQ_KEY ? "locationiq" : "nominatim"}:${constraint}:${normalizeLocation(city)}`;
  const hit = cached(key);
  if (hit) {
    onLocation({ cacheHit: true, provider:hit.prospectGeocoder, selected: locationSummary(hit) });
    return hit;
  }

  const attempts = [];
  const deadline = Date.now() + 30000;
  for (const plan of geocoding.plans(city, selection, Boolean(LOCATIONIQ_KEY))) {
    const useIQ = plan.provider === "LocationIQ";
    const url = new URL(useIQ ? "https://us1.locationiq.com/v1/search" : NOMINATIM);
    if (useIQ) {
      url.searchParams.set("key", LOCATIONIQ_KEY);
      url.searchParams.set("source", "nom");
      url.searchParams.set("statecode", "1");
    }
    url.searchParams.set("q", plan.query);
    if (selection) {
      url.searchParams.set("countrycodes", selection.countryCode.toLowerCase());
      url.searchParams.set("accept-language", "en");
    }
    url.searchParams.set("format", useIQ ? "json" : "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("extratags", "1");
    if (BUSINESS_PROVIDER === "geoapify") url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("limit", "10");
    // Localities include towns/villages/boroughs in the worldwide catalogue.
    // Keep the provider's default feature coverage and validate results locally.
    const attempt = { ...plan, startedAt: new Date().toISOString() };
    attempts.push(attempt);
    const started = Date.now();
    let data;
    try {
      if (deadline - Date.now() < 1500) throw Object.assign(new Error("O serviço de localização não respondeu no prazo."), {code:"geocode_timeout"});
      // Alternative wording is tried only after an empty or incompatible result.
      // No automatic retry/switch on quota, authentication or connection failure.
      data = await fetchJSON(url, {}, true, Math.min(10000, deadline - Date.now() - 1100), 1);
    } catch (error) {
      attempt.elapsedMs = Date.now() - started;
      if (useIQ && error.httpStatus === 404) {
        data = [];
        attempt.httpStatus = 404;
      } else {
        attempt.outcome = "service_error";
        if (error.httpStatus) attempt.httpStatus = error.httpStatus;
        onLocation({cacheHit:false, attempts:structuredClone(attempts), selected:null});
        const timeout = ["TimeoutError","AbortError"].includes(error.name) || error.code === "geocode_timeout";
        const code = error.httpStatus === 429 ? "geocode_rate_limit" : timeout ? "geocode_timeout" : "geocode_service_error";
        console.error("Falha ao localizar cidade:", JSON.stringify({provider:plan.provider,code,httpStatus:error.httpStatus}));
        throw Object.assign(new Error(error.httpStatus === 429
          ? "O serviço de localização atingiu seu limite de consultas. Aguarde e tente novamente; sua seleção continua válida."
          : timeout ? "O serviço de localização demorou a responder. Tente novamente; sua seleção continua válida."
          : "Não foi possível consultar o serviço de localização. Tente novamente; sua seleção continua válida."),{code});
      }
    }
    attempt.elapsedMs = Date.now() - started;
    if (!Array.isArray(data)) {
      attempt.outcome = "invalid_response";
      onLocation({cacheHit:false,attempts:structuredClone(attempts),selected:null});
      throw Object.assign(new Error("O serviço de localização retornou uma resposta inválida."),{code:"geocode_invalid_response"});
    }
    const inspected = data.slice(0,10).map(place => ({place,rejection:geocoding.rejection(place,city,selection)}));
    const places = inspected.filter(item => !item.rejection).map(item => item.place);
    attempt.received = data.length;
    attempt.candidates = inspected.map(item => ({...locationSummary(item.place),rejection:item.rejection}));
    attempt.outcome = places.length ? "matched" : data.length ? "incompatible_results" : "empty_response";
    if (!places.length) {
      onLocation({cacheHit:false, attempts:structuredClone(attempts), selected:null});
      continue;
    }
    const exact = places.filter(place => geocoding.cityMatch(place,city,selection));
    if (!selection && exact.length > 1 && !city.includes(",")) {
      throw new Error("Há cidades com esse nome. Informe cidade, estado/província e país.");
    }
    const selected = geocoding.choose(places,city,selection);
    selected.prospectGeocoder = plan.provider;
    onLocation({cacheHit:false,provider:plan.provider,attempts:structuredClone(attempts),
      candidates:places.map(locationSummary),selected:locationSummary(selected)});
    saveCache(key,selected,useIQ ? 48 * HOUR : 7 * 24 * HOUR);
    return selected;
  }
  const incompatible = attempts.some(attempt => attempt.outcome === "incompatible_results");
  throw Object.assign(new Error(selection
    ? incompatible ? "A cidade retornada não pôde ser confirmada no país e estado/província selecionados. Confira a subdivisão escolhida ou informe o nome local."
      : "Os serviços de localização não encontraram essa cidade. Confira o nome ou use a opção de informar a cidade manualmente."
    : "Cidade não encontrada."),{code:incompatible ? "geocode_selection_unconfirmed" : "geocode_not_found"});
}

function businessMatch(tags, niche) {
  if (!tags.name) return false;

  if (
    ["yes", "true", "1"].includes(tags.disused) ||
    ["yes", "true", "1"].includes(tags.abandoned) ||
    tags.shop === "vacant"
  ) {
    return false;
  }

  const commercial = [
    "shop", "craft", "office", "amenity", "service"
  ].some(key => tags[key] && tags[key] !== "no");

  if (!commercial) return false;

  const config = niches[niche];

  if (
    nicheMatching.matchesTags(tags, config)
  ) {
    return true;
  }

  const name = ` ${normalize(tags.name)} `;

  if (config.food && !nicheMatching.isFoodPlace(tags)) return false;

  return config.terms.some(term =>
    name.includes(` ${normalize(term)} `)
  );
}

function prospectScore(row) {
  let score = 20;

  if (row.name.length >= 4) score += 10;
  if (row.phone) score += 20;
  if (row.address) score += 10;
  if (row.latitude != null && row.longitude != null) {
    score += 10;
  }

  if (row.matchMethod === "tag") score += 10;
  if (row.status === "LIKELY_NO_WEBSITE") score += 20;

  if (
    ["WEBSITE_LISTED", "WEBSITE_FOUND"].includes(row.status)
  ) {
    score -= 45;
  }

  if (row.chainSignal) score -= 25;
  if (!row.address && !row.phone) score -= 15;

  return Math.max(0, Math.min(100, score));
}

function deduplicate(rows) {
  const output = [];

  for (const row of rows) {
    const previous = output.find(other => {
      if (other.osmId === row.osmId) return true;

      if (normalizeLocation(other.name) !== normalizeLocation(row.name) ||
          normalizeLocation(other.city) !== normalizeLocation(row.city)) {
        return false;
      }

      const near =
        Math.abs(other.latitude - row.latitude) < 0.0008 &&
        Math.abs(other.longitude - row.longitude) < 0.0008;

      const sameAddress =
        row.address &&
        other.address &&
        normalizeLocation(row.address) === normalizeLocation(other.address);

      const phones = contacts.numbers(row.phone, row.countryCode);
      const sharedPhone = contacts.numbers(other.phone, other.countryCode).some(value => phones.includes(value));
      // Proximity and a brand name alone do not identify the same branch.
      return near && (sameAddress || ((!row.address || !other.address) && sharedPhone));
    });

    if (!previous) {
      output.push(row);
      continue;
    }

    for (const key of [
      "phone", "phoneSource", "mobilePhone", "whatsappPhone", "address", "website", "websiteSource", "street", "houseNumber"
    ]) {
      if (!previous[key] && row[key]) previous[key] = row[key];
    }

    previous.osmIds.push(row.osmId);
    previous.chainSignal ||= row.chainSignal;
    previous.invalidListedWebsite ||= row.invalidListedWebsite;

    if (previous.website) {
      previous.status = "WEBSITE_LISTED";
      previous.websiteVerification = "listed";
      previous.confidence = 0.4;
      previous.reason =
        "Site informado na fonte; identidade e disponibilidade ainda não verificadas.";
    }
    if (previous.phone) previous.phoneVerification = "listed";

    previous.prospectScore = prospectScore(previous);
  }

  return output;
}

async function discover(city, niche, onProgress = () => {}, onDiagnostics = () => {}, selection = null) {
  const constraint = selection ? `${selection.countryCode}:${selection.stateCode}:${normalizeLocation(selection.stateName)}` : "legacy";
  const key = `discovery:v12:${BUSINESS_PROVIDER}:${LOCATIONIQ_KEY ? "locationiq" : "nominatim"}:${constraint}:${normalizeLocation(city)}:${niche}`;
  const hit = cached(key);
  if (hit) {
    onDiagnostics({ cacheHit: true, place: hit.place, geographicScope: hit.geographicScope });
    // Reaproveita o ponto já geocodificado para a animação, sem nova consulta de rede.
    const cachedPlace = cached(`city:v7:${BUSINESS_PROVIDER}:${LOCATIONIQ_KEY ? "locationiq" : "nominatim"}:${constraint}:${normalizeLocation(city)}`);
    if (cachedPlace) onDiagnostics({ geocode: { cacheHit: true, selected: locationSummary(cachedPlace) } });
    return structuredClone(hit);
  }

  onProgress("Localizando cidade…");
  const geocodeStarted = Date.now();
  const place = await locate(city, geocode => onDiagnostics({ geocode }), selection);
  onDiagnostics({ geocodeMs: Date.now() - geocodeStarted, place: place.display_name });
  onProgress("Cidade localizada. Consultando empresas no OpenStreetMap…");
  const [south, north, west, east] =
    place.boundingbox.map(Number);

  if (
    ![south, north, west, east].every(Number.isFinite) ||
    north - south > 2 ||
    east - west > 3
  ) {
    throw new Error(
      "Região muito ampla. Informe uma cidade específica."
    );
  }

  const relation =
    place.osm_type === "relation" &&
    Number.isSafeInteger(Number(place.osm_id));

  const areaId = relation
    ? 3600000000 + Number(place.osm_id)
    : null;

  const scope = relation
    ? "(area.searchArea)"
    : `(${south},${west},${north},${east})`;

  onDiagnostics({ geographicScope: relation ? "Limite administrativo" : "Retângulo geográfico da localidade",
    areaId, scope, boundingbox: [south, north, west, east] });

  const config = niches[niche];

  const escapeRegex = value =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const keywords =
    config.terms.map(escapeRegex).join("|");

  const tagSelectors = nicheMatching.selectors(config, scope);
  const nameSelectors = keywords
    ? ["shop", "craft", "office", "amenity", "service"].map(key =>
        `nwr${scope}[${JSON.stringify(key)}]["name"~${JSON.stringify(keywords)},i];`
      )
    : [];

  async function queryBusinesses(selectors, method) {
    if (!selectors.length) return { elements: [] };
    const query = `
      [out:json][timeout:45][maxsize:16777216];
      ${relation ? `area(${areaId})->.searchArea;` : ""}
      (${selectors.join("\n")});
      out body center;
    `;
    let answer;
    try {
      answer = await overpassClient.execute(query, {
        onProgress,
        onTrace: trace => onDiagnostics({ queryAttempt: { method, ...trace } })
      });
    } catch (error) {
      console.error("Falha Overpass:", JSON.stringify(error.diagnostics || { code: error.code }));
      throw error;
    }
    return answer;
  }

  let discoveryMethod, data;
  if (BUSINESS_PROVIDER === "geoapify") {
    discoveryMethod = "Índices comerciais do Geoapify · tags OSM originais";
    const hints = geoapify.CATEGORY_HINTS[niche];
    const fallbackCategories = config.food ? geoapify.FOOD_CATEGORIES : geoapify.CATEGORIES;
    const options = {apiKey: GEOAPIFY_KEY, onProgress, budget:{remaining:4},
      onTrace: trace => onDiagnostics({queryAttempt: {method:"categories", ...trace}})};
    data = await geoapify.discover(place, {...options, categories: hints || fallbackCategories});
    if (hints && !data.elements.some(element => businessMatch(element.tags || {}, niche))) {
      onProgress("Sem correspondências na categoria. Consultando os índices comerciais para a classificação original…");
      data = await geoapify.discover(place, {...options, categories: fallbackCategories,
        onTrace: trace => onDiagnostics({queryAttempt: {method:"commercial_fallback", ...trace}})});
    }
  } else {
  discoveryMethod = tagSelectors.length ? "Categorias cadastradas" : "Correspondência pelo nome";
  onProgress("Consultando empresas por categoria. A quantidade ainda é desconhecida…");
  data = await queryBusinesses(tagSelectors.length ? tagSelectors : nameSelectors,
    tagSelectors.length ? "categories" : "names");
  // A busca por nomes é alternativa, em vez de ampliar todas as consultas.
  if (tagSelectors.length && nameSelectors.length &&
      !data.elements.some(element => businessMatch(element.tags || {}, niche))) {
    onProgress("Nenhuma correspondência por categoria. Consultando nomes de empresas…");
    data = await queryBusinesses(nameSelectors, "names");
    discoveryMethod = "Correspondência pelo nome";
  }

  }

  const rows = [];

  for (const element of data.elements) {
    const tags = element.tags || {};
    if (!businessMatch(tags, niche)) continue;

    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }

    const contactData = contacts.sourceData(tags, element.providerContact);

    const address = tags["addr:full"] || [
      [
        tags["addr:housenumber"],
        tags["addr:street"]
      ].filter(Boolean).join(" "),
      tags["addr:unit"] ? `Unit ${tags["addr:unit"]}` : "",
      tags["addr:postcode"]
    ].filter(Boolean).join(", ");

    const row = {
      name: tags.name,
      category: niche,
      city:
        tags["addr:city"] ||
        place.name ||
        city.split(",")[0].trim(),
      address,
      ...contactData,
      countryCode: contacts.countryCode(place.address?.country_code) || contacts.countryCode(selection?.countryCode),
      latitude,
      longitude,
      osmId: `${element.type}/${element.id}`,
      osmIds: [`${element.type}/${element.id}`],
      source: BUSINESS_PROVIDER === "geoapify" ? "OpenStreetMap via Geoapify" : "OpenStreetMap",
      street: tags["addr:street"] || "",
      houseNumber: tags["addr:housenumber"] || "",
      chainSignal: Boolean(
        tags["brand:wikidata"] || tags["operator:wikidata"]
      ),
      matchMethod: nicheMatching.matchesTags(tags, config) ? "tag" : "keyword",
      status: contactData.website ? "WEBSITE_LISTED" : "UNCERTAIN",
      confidence: contactData.website ? 0.4 : 0,
      reason: contactData.website
        ? "Site informado na fonte; identidade e disponibilidade ainda não verificadas."
        : "Aguardando verificação.",
      verification: null
    };

    row.prospectScore = prospectScore(row);
    rows.push(row);
  }

  const result = {
    place: place.display_name,
    discoveryMethod,
    provider: BUSINESS_PROVIDER,
    coverage: BUSINESS_PROVIDER === "geoapify" ? "Índices comerciais, serviços e escritórios do Geoapify; cobertura diferente do Overpass." : "Seletores OpenStreetMap",
    geographicScope: relation
      ? "Limite administrativo"
      : "Retângulo geográfico da localidade",
    rows: deduplicate(rows)
  };

  onDiagnostics({ outcome: result.rows.length ? "success" : "empty",
    matchedCount: result.rows.length, discoveryMethod });

  saveCache(key, result);
  return structuredClone(result);
}

// O verificador só conecta a endereços IPv4 públicos.
function publicIPv4(ip) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;

  const [a, b, c, d] = ip.split(".").map(Number);

  if ([a, b, c, d].some(n => n > 255)) return false;

  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

async function resolveHost(host) {
  const key = `dns:v2:${host}`;
  const hit = cached(key);
  if (hit) return hit;

  const resolver = new dns.Resolver({
    timeout: 1500,
    tries: 1
  });

  let result;

  try {
    const addresses = await resolver.resolve4(host);

    result =
      addresses.length && addresses.every(publicIPv4)
        ? { state: "public", ip: addresses[0] }
        : {
            state: "uncertain",
            reason: "Destino não permitido."
          };
  } catch (error) {
    if (error.code === "ENOTFOUND") {
      result = { state: "absent" };
    } else if (error.code === "ENODATA") {
      try {
        const addresses = await resolver.resolve6(host);

        result = addresses.length
          ? {
              state: "uncertain",
              reason: "Website disponível somente por IPv6."
            }
          : { state: "absent" };
      } catch (other) {
        result = ["ENODATA", "ENOTFOUND"].includes(other.code)
          ? { state: "absent" }
          : {
              state: "uncertain",
              reason: "Consulta DNS inconclusiva."
            };
      }
    } else {
      result = {
        state: "uncertain",
        reason: "Consulta DNS inconclusiva."
      };
    }
  }

  if (result.state !== "uncertain") {
    saveCache(key, result, HOUR);
  }

  return result;
}

// Cache pequeno em memória: evita baixar repetidamente a mesma página.
// Não armazena credenciais e mantém a validação de destinos na leitura original.
async function pageRequest(input, deadline, redirects = 3, acceptPlain = false) {
  if (Date.now() >= deadline) throw new Error("Limite de tempo atingido.");
  const key = `${input}|${redirects}|${acceptPlain}`;
  const hit = pageCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) pageCache.delete(key);
  if (pageInFlight.has(key)) return pageInFlight.get(key);
  const pending = pageRequestUncached(input, deadline, redirects, acceptPlain);
  pageInFlight.set(key, pending);
  try {
    const result = await pending;
    if (result.status >= 200 && result.status < 300) {
      const bytes = Buffer.byteLength(result.html || "");
      let cacheBytes = [...pageCache.values()].reduce((total,item) => total + item.bytes, 0);
      while (pageCache.size >= 32 || cacheBytes + bytes > PAGE_CACHE_MAX_BYTES) {
        const oldest = pageCache.keys().next().value;
        cacheBytes -= pageCache.get(oldest).bytes;
        pageCache.delete(oldest);
      }
      pageCache.set(key, { value: result, bytes, expires: Date.now() + 10 * 60000 });
    }
    return result;
  } finally {
    pageInFlight.delete(key);
  }
}

async function pageRequestUncached(input, deadline, redirects = 3, acceptPlain = false) {
  if (Date.now() >= deadline) {
    throw new Error("Limite de tempo atingido.");
  }

  const url = new URL(input);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !url.hostname.includes(".")
  ) {
    throw new Error("URL não permitida.");
  }

  const resolved = await resolveHost(url.hostname);

  if (resolved.state !== "public") {
    throw new Error("DNS inconclusivo ou destino bloqueado.");
  }

  await sleep(250);

  const timeout = Math.min(4000, deadline - Date.now());
  if (timeout <= 0) throw new Error("Limite de tempo atingido.");

  const result = await new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;

    let settled = false;
    let timer;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    }

    const request = transport.get(url, {
      agent: false,
      family: 4,
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        "Accept-Encoding": "identity"
      },
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{
            address: resolved.ip,
            family: 4
          }]);
        } else {
          callback(null, resolved.ip, 4);
        }
      }
    }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (
        [301, 302, 303, 307, 308].includes(status) &&
        location
      ) {
        try {
          finish(null, {
            status,
            redirect: new URL(location, url).href
          });
        } catch {
          finish(new Error("Redirecionamento inválido."));
        }
        response.destroy();
        return;
      }

      const type = String(
        response.headers["content-type"] || ""
      );

      if (!type.includes("text/html") && !(acceptPlain && type.includes("text/plain"))) {
        finish(null, {
          status,
          html: "",
          policyReadable: false,
          finalUrl: url.href
        });
        response.destroy();
        return;
      }

      let bytes = 0;
      const chunks = [];

      response.on("data", chunk => {
        bytes += chunk.length;

        if (bytes > PAGE_MAX_BYTES) {
          finish(new Error("Página excedeu o limite de leitura segura (768 KB)."));
          response.destroy();
          return;
        }

        chunks.push(chunk);
      });

      response.on("end", () => finish(null, {
        status,
        finalUrl: url.href,
        policyReadable: !acceptPlain || type.includes("text/plain"),
        html: Buffer.concat(chunks).toString("utf8")
      }));

      response.on("error", error => finish(error));

      response.on("aborted", () =>
        finish(new Error("Resposta interrompida."))
      );
    });

    timer = setTimeout(() => {
      finish(new Error("Tempo limite ao acessar website."));
      request.destroy();
    }, timeout);

    request.on("error", error => finish(error));
  });

  if (result.redirect) {
    // Expose redirect metadata for the public-page reader, which checks the
    // new origin's robots.txt and DNS before reading each destination.
    if (redirects < 0) return result;
    if (redirects === 0) {
      throw new Error("Excesso de redirecionamentos.");
    }

    return pageRequest(
      result.redirect,
      deadline,
      redirects - 1,
      acceptPlain
    );
  }

  return result;
}

function candidates(name, city, country) {
  return websiteEvidence.candidates(name, city, country);
}

function analyze(page, business) {
  return websiteEvidence.analyze(page, business);
}

async function verify(business) {
  const key = "verify:v4:" + createHash("sha256").update(JSON.stringify([
    business.osmId, business.name, business.city, business.countryCode,
    business.phone, business.address, business.website, business.mobilePhone, business.whatsappPhone
  ])).digest("hex");
  const hit = cached(key);
  if (hit) {
    const row = { ...business, ...hit };
    row.prospectScore = prospectScore(row);
    return row;
  }

  const listed = Boolean(business.website);
  if (listed && websiteEvidence.isProfile(business.website)) {
    const row = {...business, status:"WEBSITE_LISTED", confidence:0.4, websiteVerification:"profile",
      reason:"Perfil ou diretório informado na fonte; site próprio da empresa não confirmado."};
    row.prospectScore = prospectScore(row);
    return row;
  }
  const domains = listed ? [business.website] : candidates(business.name, business.city, business.countryCode);
  const deadline = Date.now() + (listed ? 12000 : 25000);
  const evidence = [];
  let checked = 0, found = null, phoneData = {}, incomplete = false;
  for (const domain of domains) {
    if (Date.now() >= deadline) {
      incomplete = true;
      evidence.push({reason: "Verificação parcial: limite de tempo atingido."});
      break;
    }
    checked++;
    if (!listed) {
      const resolved = await resolveHost(domain);
      if (resolved.state !== "public") {
        evidence.push({domain, dns:resolved.state, reason:resolved.reason});
        incomplete ||= resolved.state !== "absent";
        continue;
      }
    }
    // Guesses use HTTPS only. Never downgrade a failed HTTPS request.
    const input = listed ? domain : `https://${domain}`;
    try {
      const page = await websiteEvidence.readPublicPage(input, deadline, pageRequest);
      const match = analyze(page, business);
      evidence.push({domain, protocol:new URL(input).protocol, httpStatus:page.status,
        finalUrl:page.finalUrl, title:match.title,
        matching:{name:match.nameMatch,city:match.cityMatch,phone:match.phoneMatch,address:match.addressMatch},
        reason:match.compatible ? "Identidade compatível com a página pública." : "A página não confirmou a identidade da empresa."});
      if (match.compatible) {
        found = page.finalUrl;
        phoneData = {...(match.phoneMatch ? {phoneVerification:"website_match",sitePhone:match.matchedPhone} : {}),
          ...websiteEvidence.enrichPhone(page, business)};
        if (phoneData.phoneVerification === "conflict") evidence.push({reason:"O telefone da fonte diverge do cadastro da mesma empresa na página. Revise antes de entrar em contato."});
        break;
      }
    } catch (error) {
      incomplete = true;
      evidence.push({domain, error:String(error.message).slice(0,300)});
    }
  }
  const checkedAt = new Date().toISOString();
  const result = {
    ...phoneData,
    website: found || business.website || "",
    websiteSource: business.websiteSource || (found ? "Página pública com identidade compatível" : ""),
    websiteVerification: found ? "compatible" : listed ? "inconclusive" : "not_identified",
    websiteCheckedAt: checkedAt,
    status: found ? "WEBSITE_FOUND" : listed ? "WEBSITE_LISTED" : "UNCERTAIN",
    confidence: found ? 0.95 : listed ? 0.4 : 0,
    reason: found
      ? "Nome, cidade e telefone ou endereço compatíveis na página pública. Isso não comprova propriedade nem atualização do cadastro."
      : listed
        ? "Site informado na fonte, mas sua identidade ou disponibilidade não foi confirmada. Revise manualmente."
        : "Nenhum site identificado nesta verificação limitada. Os domínios sugeridos não cobrem todos os sites possíveis; ausência não comprovada.",
    verification: {method:listed ? "listed" : "domain_candidates", checkedAt,
      candidatesTotal:domains.length,candidatesChecked:checked,incomplete,evidence}
  };
  saveCache(key, result, found ? 6 * HOUR : 5 * 60000);
  const row = { ...business, ...result };
  row.prospectScore = prospectScore(row);
  return row;
}

async function run(job, city, niche, limit, selection = null) {
  const started = Date.now();
  job.timings = {};
  job.discoveryDiagnostics = { city, niche, cacheHit: false, queries: [] };
  if (selection) job.discoveryDiagnostics.location = selection;
  lastDiscoveryDiagnostics = job.discoveryDiagnostics;
  let discoveryStarted;
  try {
    job.message = "Localizando cidade e consultando empresas…";

    discoveryStarted = Date.now();
    const discovery = await discover(city, niche, message => {
      job.message = message;
    }, update => {
      if (update.queryAttempt) {
        const attempt = update.queryAttempt;
        const queries = job.discoveryDiagnostics.queries;
        const index = queries.findIndex(item => item.method === attempt.method &&
          item.endpoint === attempt.endpoint && item.purpose === attempt.purpose);
        if (index < 0) queries.push(attempt);
        else queries[index] = attempt;
      } else Object.assign(job.discoveryDiagnostics, update);
      if (update.place) job.place = update.place;
      if (update.geographicScope) job.geographicScope = update.geographicScope;
    }, selection);
    job.timings.discoveryMs = Date.now() - discoveryStarted;

    job.place = discovery.place;
    job.geographicScope = `${discovery.geographicScope} · ${discovery.discoveryMethod || "Consulta à fonte"}`;
    job.totalDiscovered = discovery.rows.length;

    job.rows = discovery.rows
      .sort((a, b) => b.prospectScore - a.prospectScore)
      .slice(0, limit);

    job.total = job.rows.length;

    // Cada trabalhador reserva um índice antes de aguardar a rede.
    // Atualiza o resultado assim que a empresa termina, sem esperar as outras.
    let nextIndex = 0;
    const verificationStarted = Date.now();
    job.message = `Verificando websites: 0 de ${job.total} concluídos`;
    async function worker() {
      while (nextIndex < job.rows.length) {
        const index = nextIndex++;
        try {
          job.rows[index] = await verify(job.rows[index]);
        } catch {
          const row = job.rows[index];
          row.status = "UNCERTAIN";
          row.confidence = 0;
          row.reason = "Erro durante a verificação. Revise manualmente.";
          row.prospectScore = prospectScore(row);
        }
        job.completed++;
        job.message = `Verificando websites: ${job.completed} de ${job.total} concluídos`;
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(VERIFY_CONCURRENCY, job.rows.length) },
      () => worker()
    ));
    job.timings.verificationMs = Date.now() - verificationStarted;

    job.state = "done";
    job.message = job.total
      ? "Pesquisa concluída."
      : "Nenhuma empresa correspondente encontrada nesta fonte.";
  } catch (error) {
    job.state = "error";
    job.message = error.message;
    job.errorCode = error.code || "discovery_error";
    job.discoveryDiagnostics.outcome = job.errorCode;
  } finally {
    if (job.timings.discoveryMs == null && discoveryStarted != null) {
      job.timings.discoveryMs = Date.now() - discoveryStarted;
    }
    job.timings.totalMs = Date.now() - started;
    console.log(`Pesquisa concluída: descoberta=${job.timings.discoveryMs ?? "falhou"}ms, verificação=${job.timings.verificationMs ?? 0}ms, total=${job.timings.totalMs}ms, empresas=${job.total}, estado=${job.state}`);
    if (accountService) {
      try { await accountService.store.saveSearch(job.ownerId, job, jobSummary(job)); }
      catch { job.persistenceWarning = "Não foi possível salvar o histórico. Exporte os resultados antes de sair."; }
    }
    activeJob = null;
  }
}

function jobSummary(job) {
  return { city: job.city || "", niche: job.niche || "", limit: job.limit,
    place: job.place || "", state: job.state, total: job.total };
}

async function ownedJob(id, ownerId) {
  let live = jobs.get(id);
  if (accountService && live && live.createdAt < Date.now() - 30 * 24 * HOUR) {
    jobs.delete(id); live = null;
  }
  if (live) return live.ownerId === ownerId ? live : null;
  return accountService ? accountService.store.search(ownerId, id) : null;
}

function publicJob(job) {
  const value = { ...job }; delete value.ownerId;
  const country = contacts.jobCountry(job);
  if (Array.isArray(job.rows)) value.rows = job.rows.map(row => contacts.details(row, country));
  return value;
}

function conflict(ownerId) {
  const data = { error: "Uma pesquisa já está em andamento. Aguarde alguns instantes." };
  if (jobs.get(activeJob)?.ownerId === ownerId) data.jobId = activeJob;
  return data;
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

const readBody = requestSecurity.readJSON;

// Checagem pontual de uma página pública, sem pesquisa em massa.
// Conservador: não lê o site se robots.txt restringir este robô,
// se robots.txt falhar; cada redirecionamento passa por DNS e permissões próprios.
async function collectAIEvidence(row) {
  const key = `${row.osmId}:${row.website}:${row.phone}:${row.address}:${row.phoneVerification}:${row.phoneSource}`;
  const cachedEvidence = aiEvidenceCache.get(key);
  if (cachedEvidence && cachedEvidence.expires > Date.now()) {
    return cachedEvidence.value;
  }
  const value = {
    checkedAt: new Date().toISOString(),
    business: {
      name: row.name, category: row.category, city: row.city,
      phone: row.phone, address: row.address, website: row.website,
      status: row.status
    },
    source: `https://www.openstreetmap.org/${row.osmId}`,
    contactStatus: row.phoneVerification === "conflict"
      ? "Telefone da fonte diverge do telefone publicado no cadastro da mesma empresa no site. Revise antes de entrar em contato."
      : row.phoneVerification === "website_published"
        ? "Telefone publicado em página pública com identidade compatível. Titularidade, atualização e conta WhatsApp não confirmadas."
        : "Telefone e endereço informados na fonte; titularidade, atualização e conta WhatsApp não confirmadas.",
    contactSource: row.phoneSource || "OpenStreetMap",
    websiteCheck: { state: "not_identified", note: "Site não identificado. Isso não comprova ausência de site." },
    previousVerification: row.verification ? {
      checkedAt: row.verification.checkedAt,
      candidatesChecked: row.verification.candidatesChecked,
      candidatesTotal: row.verification.candidatesTotal
    } : null
  };
  if (row.website) {
    const deadline = Date.now() + 12000;
    try {
      const page = await websiteEvidence.readPublicPage(row.website, deadline, pageRequest);
      const match = analyze(page, row);
      value.websiteCheck = {
        state: page.status >= 200 && page.status < 300 ? "accessible" : "http_error",
        source: page.finalUrl, httpStatus: page.status,
        title: match.title.slice(0, 400),
        identityCompatible: match.compatible,
        matching: { name: match.nameMatch, city: match.cityMatch,
          phone: match.phoneMatch, address: match.addressMatch },
        note: match.compatible
          ? "Nome, cidade e telefone ou endereço compatíveis na página pública consultada. Não é confirmação de proprietário ou atualização cadastral."
          : "A consulta não confirmou todos os critérios de identidade; revisar manualmente."
      };
    } catch (error) {
      value.websiteCheck = { state: "inconclusive", source: row.website,
        note: String(error.message).slice(0, 300) };
    }
  }
  if (aiEvidenceCache.size >= 100) aiEvidenceCache.delete(aiEvidenceCache.keys().next().value);
  aiEvidenceCache.set(key, { value, expires: Date.now() + 10 * 60000 });
  return value;
}

const server = http.createServer({ maxHeaderSize: 16384, connectionsCheckingInterval: 1000 }, async (request, response) => {
  requestSecurity.headers(response, HOSTED && ORIGIN.startsWith("https:"));
  let release;
  try {
    const url = new URL(request.url, ORIGIN);

    // Endpoint sem dados de usuário, para o health check.
    if (request.method === "GET" && url.pathname === "/health") {
      if (accountService) {
        for (const [id, job] of jobs) if (job.createdAt < Date.now() - 30 * 24 * HOUR) jobs.delete(id);
        try { await accountService.ready(); }
        catch { return json(response, 503, { ok: false }); }
      }
      return json(response, 200, { ok: true });
    }

    if (request.headers.host !== new URL(ORIGIN).host) {
      return json(response, 403, {
        error: "Use o endereço configurado da aplicação."
      });
    }

    if (accountService) release = requestGate.enter(url.pathname, request.method);

    let identity = null;
    let ownerId = "legacy";
    if (accountService) {
      if (url.pathname.startsWith("/api/") || url.pathname === "/auth/logout") {
        try { identity = await accountService.identity(request); }
        catch { return json(response, 503, { error: "Não foi possível verificar a sessão. Tente novamente." }); }
        if (request.method === "GET" && url.pathname === "/api/account") {
          const result = accountService.account(request, identity);
          if (result.cookies.length) response.setHeader("Set-Cookie", result.cookies);
          return json(response, 200, result.data);
        }
        if (request.method === "POST" && ["/api/auth/register", "/api/auth/forgot", "/api/auth/login", "/api/auth/activate", "/api/auth/reset"].includes(url.pathname)) {
          if (!accountService.checkMutation(request, identity)) return json(response, 403, { error: "Solicitação inválida. Recarregue a página e tente novamente." });
          const input = await readBody(request, 4096);
          if (!input || typeof input !== "object" || Array.isArray(input)) return json(response, 400, { error: "Dados inválidos." });
          const action = url.pathname.split("/").pop();
          try {
            if (["register", "forgot"].includes(action)) {
              const result = await accountService.requestEmail(request, input, action === "register" ? "activate" : "reset");
              return json(response, 202, result);
            }
            const result = action === "login" ? await accountService.login(request, input) : await accountService.complete(request, input, action);
            response.setHeader("Set-Cookie", result.cookies);
            return json(response, 200, { ok: true });
          } catch (error) {
            const status = error.status || 503;
            return json(response, status, { error: error.status ? error.message : "O login está indisponível no momento. Tente novamente mais tarde." });
          }
        }
        if (!identity) return json(response, 401, { error: "Entre com seu Gmail e sua senha do Prospect AI para continuar." });
        ownerId = identity.user.id;
        if (["POST", "PATCH", "DELETE", "PUT"].includes(request.method) &&
            !accountService.checkMutation(request, identity)) {
          return json(response, 403, { error: "Solicitação inválida. Recarregue a página e tente novamente." });
        }
      }
    } else if (!authenticated(request)) {
      response.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Prospect AI", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end("Informe seu usuário e senha.");
      return;
    }

    if (!accountService && request.method === "GET" && url.pathname === "/api/account") {
      return json(response, 200, { mode: "basic", authenticated: true, user: null, csrfToken: null });
    }
    if (accountService && request.method === "POST" && url.pathname === "/auth/logout") {
      try {
        const cookies = await accountService.logout(identity);
        response.setHeader("Set-Cookie", cookies);
        return json(response, 200, { ok: true });
      } catch { return json(response, 503, { error: "Não foi possível encerrar a sessão. Tente novamente." }); }
    }
    if (accountService && request.method === "PATCH" && url.pathname === "/api/account/preferences") {
      const value = await readBody(request, 16384);
      const tone = value.tone === undefined ? "Natural" : value.tone;
      const knowledge = value.knowledge === undefined ? "" : value.knowledge;
      if (typeof value.seller !== "string" || value.seller.length > 100 ||
          typeof value.offer !== "string" || value.offer.length > 3000 ||
          !["Natural", "Profissional"].includes(tone) ||
          typeof knowledge !== "string" || knowledge.length > 1800 ||
          !["Português", "English", "Español"].includes(value.language)) {
        return json(response, 400, { error: "Preferências inválidas." });
      }
      try {
        await accountService.store.preferences(ownerId, { seller: value.seller, offer: value.offer, tone, knowledge, language: value.language });
        return json(response, 200, { ok: true });
      } catch { return json(response, 503, { error: "Não foi possível salvar as preferências." }); }
    }
    if (accountService && request.method === "DELETE" && url.pathname === "/api/account") {
      const input = await readBody(request, 4096);
      if (input.confirmation !== "EXCLUIR") return json(response, 400, { error: "Confirme a exclusão da conta." });
      try {
        const passwordHash = await accountService.confirmPassword(request, identity, input.password);
        if (!await accountService.store.deleteAccount(ownerId, passwordHash)) return json(response, 400, { error: "Sua senha mudou. Entre novamente para excluir a conta." });
        for (const [id, job] of jobs) if (job.ownerId === ownerId) jobs.delete(id);
        response.setHeader("Set-Cookie", accountService.clearCookies());
        return json(response, 200, { ok: true });
      } catch (error) { return json(response, error.status || 503, { error: error.status ? error.message : "Não foi possível excluir a conta." }); }
    }
    if (accountService && request.method === "GET" && url.pathname === "/api/history") {
      try { return json(response, 200, await accountService.store.history(ownerId)); }
      catch { return json(response, 503, { error: "Não foi possível carregar o histórico." }); }
    }

    if (url.pathname === "/api/lists" || url.pathname.startsWith("/api/lists/")) {
      if (!accountService) return json(response, 404, { error: "Listas exigem uma conta pessoal." });
      const parts = url.pathname.split("/").slice(3);
      const method = request.method;
      try {
        if (["POST", "PATCH", "DELETE"].includes(method) &&
            !await accountService.store.allow([{ key: `lists:${ownerId}`, limit: 120, seconds: 600 }])) {
          return json(response, 429, { error: "Muitas alterações nas listas. Aguarde alguns minutos." });
        }
        const input = ["POST", "PATCH"].includes(method) ? await readBody(request, 16384) : null;
        if (["POST", "PATCH"].includes(method) && (!input || typeof input !== "object" || Array.isArray(input))) return json(response, 400, { error: "Dados inválidos." });
        const store = accountService.store;
        if (!parts.length) {
          if (method === "GET") return json(response, 200, await store.lists(ownerId));
          if (method === "POST") return json(response, 201, await store.createList(ownerId, input.name));
        }
        if (parts.length === 1) {
          if (method === "PATCH") return json(response, 200, await store.renameList(ownerId, parts[0], input.name));
          if (method === "DELETE") return json(response, 200, await store.deleteList(ownerId, parts[0]));
        }
        if (parts.length === 2 && parts[1] === "companies") {
          if (method === "GET") return json(response, 200, await store.listCompanies(ownerId, parts[0]));
          if (method === "POST") {
            if (typeof input.jobId !== "string" || typeof input.osmId !== "string") return json(response, 400, { error: "Selecione uma empresa dos seus resultados." });
            const job = await ownedJob(input.jobId, ownerId);
            const row = job?.rows?.find(item => item.osmId === input.osmId);
            if (!row) return json(response, 404, { error: "Empresa não encontrada nos seus resultados." });
            if (job.state === "running") return json(response, 409, { error: "Aguarde a pesquisa terminar antes de salvar." });
            const result = await store.saveCompany(ownerId, parts[0], contacts.details(row, contacts.jobCountry(job)));
            return json(response, result.created ? 201 : 200, result);
          }
        }
        if (parts.length === 3 && parts[1] === "companies") {
          if (method === "PATCH") return json(response, 200, await store.updateCompany(ownerId, parts[0], parts[2], input));
          if (method === "DELETE") return json(response, 200, await store.deleteCompany(ownerId, parts[0], parts[2]));
        }
        return json(response, 404, { error: "Rota não encontrada." });
      } catch (error) {
        if (error.safeRequestError) {
          if (error.closeRequest) response.setHeader("Connection", "close");
          return json(response, error.status, { error: error.message });
        }
        if (error.name === "SyntaxError") return json(response, 400, { error: "Dados inválidos." });
        if (error.message === "Pedido grande demais.") return json(response, 413, { error: "A solicitação excede o limite permitido." });
        return json(response, error.status || 503, { error: error.status ? error.message : "Não foi possível acessar suas listas. Tente novamente." });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/diagnostics/overpass") {
      if (accountService && !accountService.isAdmin(identity.user)) return json(response, 404, { error: "Rota não encontrada." });
      // Protegido pela mesma autenticação da aplicação. Sem chave do LocationIQ.
      // A consulta real só aparece depois de uma pesquisa; não é repetida aqui.
      let probe = null;
      if (url.searchParams.get("probe") === "1") {
        if (activeJob) {
          return json(response, 409, { error: "Aguarde a pesquisa terminar antes de testar a conexão." });
        }
        if (!diagnosticProbe && Date.now() - lastProbeAt < 30000) {
          return json(response, 429, { error: "Aguarde 30 segundos entre testes de conexão." });
        }
        if (!diagnosticProbe) {
          lastProbeAt = Date.now();
          diagnosticProbe = (async () => {
            let trace;
            try {
              const target = url.searchParams.get("target") || "primary";
              const endpoint = target === "primary" ? OVERPASS
                : target === "fallback" ? OVERPASS_ENDPOINTS[1] : null;
              if (!endpoint) return { outcome: "configuration", note: "Alternativa não configurada ou target inválido." };
              await overpass.query(endpoint, overpass.PROBE_QUERY, {
                userAgent: UA,
                method: overpassClient.method, family: overpassClient.family,
                apiKey: endpoint === OVERPASS ? OVERPASS_API_KEY : "",
                limits: overpass.PROBE_LIMITS,
                onTrace: value => { trace = value; }
              });
            } catch { /* O resultado e a fase da falha estão no trace. */ }
            return trace;
          })();
        }
        const pending = diagnosticProbe;
        try { probe = await pending; }
        finally { if (diagnosticProbe === pending) diagnosticProbe = null; }
      }
      return json(response, 200, {
        businessProvider: BUSINESS_PROVIDER,
        geoapify: {authenticationConfigured: Boolean(GEOAPIFY_KEY), endpoint: geoapify.ENDPOINT, requestMs: 20000, maximumPages: 4, coverage: "POIs indexados; não é substituição equivalente da base Overpass."},
        endpoint: overpass.endpointLabel(OVERPASS),
        endpointSource: process.env.OVERPASS_URL ? "OVERPASS_URL" : "default",
        configuredEndpoints: overpassClient.endpoints,
        httpMethod: overpassClient.method,
        ipFamily: overpassClient.family || "auto",
        authenticationConfigured: Boolean(OVERPASS_API_KEY),
        geocoder: LOCATIONIQ_KEY ? "LocationIQ" : "Nominatim",
        geocoding: { maximumAttempts:3, requestMs:10000, totalMs:30000,
          recovery:"Nomes alternativos após resposta vazia ou incompatível; país e subdivisão continuam obrigatórios. Nominatim é alternativa ao LocationIQ somente nesses casos.",
          automaticNetworkOrQuotaRetries:0 },
        limits: overpass.LIMITS,
        automaticQueryRetries: 0,
        maximumBusinessAttemptsPerStage: overpassClient.endpoints.length,
        recovery: { minimalProbeFirst: true, alternativeEndpoints: "Somente falha de conexão, espera sem headers ou HTTP 502/503/504; mesma consulta completa.", cooldownMs: 60000 },
        lastDiscovery: lastDiscoveryDiagnostics,
        probe,
        note: "Um teste mínimo confirma apenas acesso ao endpoint. Não confirma a consulta de empresas nem a escolha da cidade. awaiting_headers pode indicar fila ou execução; sozinho não identifica a causa."
      });
    }

    if (request.method === "POST" && url.pathname === "/api/ai") {
      if (request.headers.origin !== ORIGIN) {
        return json(response, 403, { error: "Origem não permitida." });
      }
      const input = await readBody(request, 32768);
      try { agent.validate(input); }
      catch (error) { return json(response, error.status || 400, { error: error.message }); }
      if (typeof input.jobId !== "string" || typeof input.osmId !== "string") {
        return json(response, 400, { error: "Selecione uma empresa da pesquisa." });
      }
      const job = await ownedJob(input.jobId, ownerId);
      const row = job?.rows.find(item => item.osmId === input.osmId);
      if (!row) return json(response, 404, { error: "A pesquisa expirou no servidor. Faça a busca novamente." });
      if (job.state === "running") {
        return json(response, 409, { error: "Aguarde a pesquisa terminar antes de usar a IA." });
      }
      if (aiBusy || Date.now() - lastAI < 3000) {
        return json(response, 429, { error: "Aguarde a geração atual ou alguns segundos antes de tentar novamente." });
      }
      if (!process.env.GROQ_API_KEY) {
        return json(response, 503, { error: "Configure GROQ_API_KEY no Render." });
      }
      aiBusy = true;
      lastAI = Date.now();
      try {
        const evidence = await collectAIEvidence(row);
        const result = await agent.generate(input, evidence);
        return json(response, 200, result);
      } catch (error) {
        return json(response, error.status || 502, { error: error.message });
      } finally {
        aiBusy = false;
      }
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/niches"
    ) {
      return json(response, 200, Object.keys(niches));
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/locations/")) {
      try {
        if (url.pathname === "/api/locations/countries") {
          return json(response, 200, await locations.listCountries());
        }
        if (url.pathname === "/api/locations/states") {
          return json(response, 200, await locations.listStates(url.searchParams.get("country")));
        }
        if (url.pathname === "/api/locations/cities") {
          return json(response, 200, await locations.listCities(url.searchParams.get("country"), url.searchParams.get("state")));
        }
        return json(response, 404, { error: "Lista de localidades não encontrada." });
      } catch (error) {
        return json(response, error.status || 503, { error: error.status === 400 ? error.message : "Não foi possível carregar as localidades. Tente novamente." });
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/search"
    ) {
      if (request.headers.origin !== ORIGIN) {
        return json(response, 403, {
          error: "Origem não permitida."
        });
      }

      if (activeJob) {
        return json(response, 409, conflict(ownerId));
      }

      if (Date.now() - lastSearch < 3000) {
        return json(response, 429, {
          error: "Aguarde alguns segundos entre pesquisas."
        });
      }

      const input = await readBody(request);
      const { niche, limit } = input;
      let city = input.city;
      let selection = null;
      if (Object.hasOwn(input, "location")) {
        try {
          selection = await locations.resolveSelection(input.location);
          city = selection.query;
        } catch (error) {
          return json(response, error.status || 503, { error: error.status === 400 ? error.message : "Não foi possível validar a localidade. Tente novamente." });
        }
      }

      if (
        typeof city !== "string" ||
        city.trim().length < 2 ||
        city.length > (selection ? 600 : 100) ||
        typeof niche !== "string" ||
        !Object.hasOwn(niches, niche) ||
        ![10, 20, 30, 50].includes(limit)
      ) {
        return json(response, 400, {
          error: "Cidade, nicho ou quantidade inválidos."
        });
      }

      // A leitura do corpo e a validação de localidades são assíncronas.
      // Reconfere os limites antes de reservar o único job de descoberta.
      if (activeJob) {
        return json(response, 409, conflict(ownerId));
      }
      if (Date.now() - lastSearch < 3000) {
        return json(response, 429, { error: "Aguarde alguns segundos entre pesquisas." });
      }

      while (jobs.size >= 20) {
        jobs.delete(jobs.keys().next().value);
      }

      const id = randomUUID();

      const job = {
        id,
        ownerId,
        city: city.trim(), niche, limit,
        state: "running",
        message: "Iniciando…",
        rows: [],
        total: 0,
        completed: 0,
        createdAt: Date.now()
      };

      jobs.set(id, job);
      activeJob = id;
      lastSearch = Date.now();

      if (accountService) {
        try { await accountService.store.saveSearch(ownerId, job, jobSummary(job)); }
        catch {
          jobs.delete(id); if (activeJob === id) activeJob = null;
          return json(response, 503, { error: "Não foi possível salvar a pesquisa. Tente novamente." });
        }
      }

      json(response, 202, { jobId: id });
      void run(job, city.trim(), niche, limit, selection);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/jobs/")
    ) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = await ownedJob(id, ownerId);

      return json(
        response,
        job ? 200 : 404,
        job ? publicJob(job) : {
          error: "Pesquisa não encontrada. Inicie outra busca."
        }
      );
    }

    if (await serveStatic(request, response, url.pathname)) return;

    json(response, 404, { error: "Rota não encontrada." });
  } catch (error) {
    if (response.destroyed) return;
    if (!response.headersSent) {
      if (error.safeRequestError) {
        if (error.retryAfter) response.setHeader("Retry-After", String(error.retryAfter));
        if (error.closeRequest) response.setHeader("Connection", "close");
        return json(response, error.status, { error: error.message });
      }
      json(response, 400, {
        error: "Não foi possível processar a solicitação."
      });
    } else {
      response.end();
    }
  } finally { release?.(); }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 100;

server.listen(
  PORT,
  hosting.bind,
  () => {
    console.log(`Prospect AI iniciado na porta ${PORT}.`);
    console.log(`Endereço: ${ORIGIN}`);
    // Explicit, bounded diagnostics only. Never enabled by an API request.
    const evaluationRun = process.env.AGENT_EVALUATION_RUN || "";
    if (HOSTED && accountService && /^[a-zA-Z0-9-]{8,80}$/.test(evaluationRun)) {
      (async () => {
        await accountService.ready();
        const revision = require("./agent-guidance.cjs").REVISION;
        if (!await accountService.store.allow([{ key: `agent-evaluation:${evaluationRun}:${revision}`, limit: 1, seconds: 86400 }])) return;
        const report = await require("./agent-evaluation.cjs").run({ limit: 3,
          onCase: item => console.log("AGENT_EVALUATION", JSON.stringify({ run: evaluationRun, ...item })) });
        console.log("AGENT_EVALUATION", JSON.stringify({ run: evaluationRun, revision: report.revision,
          outcome: report.completed !== report.planned ? "incomplete" : report.passed === report.planned ? "checks_passed" : "checks_failed",
          planned: report.planned, completed: report.completed, passed: report.passed,
          scope: report.scope, automaticChecksOnly: true }));
      })().catch(() => console.log("AGENT_EVALUATION", JSON.stringify({ run: evaluationRun, outcome: "unavailable" })));
    }
    if (HOSTED && accountService) {
      void require("./email.cjs").probeConfiguration(authConfig.email)
        .catch(() => console.log("EMAIL_DIAGNOSTIC", JSON.stringify({ event: "email_configuration", outcome: "diagnostic_unavailable" })));
    }
    if (process.env.RENDER_SERVICE_NAME === "prospect-ai-discovery-test" &&
        ["1", "categories"].includes(process.env.GEOAPIFY_DISCOVERY_CHECK)) {
      (async () => {
        if (BUSINESS_PROVIDER !== "geoapify" || !GEOAPIFY_KEY) {
          console.log("GEOAPIFY_CHECK", JSON.stringify({outcome: "configuration", provider: BUSINESS_PROVIDER, keyConfigured: Boolean(GEOAPIFY_KEY)}));
          return;
        }
        if (process.env.GEOAPIFY_DISCOVERY_CHECK === "categories") {
          for (const [label,categories,bounds] of [
            ["Uberlândia hairdressers",["service.beauty.hairdresser"],[-48.8234391,-19.416808,-47.9034816,-18.5922258]],
            ["Uberlândia commercial roots",["commercial","service","office"],[-48.8234391,-19.416808,-47.9034816,-18.5922258]],
            ["Sydney car wash",["service.vehicle.car_wash"],[150.260825,-34.2598367,151.3431756,-33.3641864]]]) {
            const [lon1,lat1,lon2,lat2]=bounds;
            try {
              const result=await geoapify.request({categories,filter:{type:"rect",lon1,lat1,lon2,lat2},limit:20,offset:0},GEOAPIFY_KEY,
                trace=>console.log("GEOAPIFY_CATEGORY_CHECK",JSON.stringify({label,categories,...trace})));
              console.log("GEOAPIFY_CATEGORY_SAMPLE",JSON.stringify({label, examples:result.features.slice(0,3).map(f=>{
                const item=geoapify.element(f);return {name:item.tags.name,osmId:`${item.type}/${item.id}`, tags:Object.fromEntries(["shop","craft","office","amenity","service","hairdresser"].filter(k=>item.tags[k]).map(k=>[k,item.tags[k]])), barberMatch:businessMatch(item.tags,"Barber"),autoDetailingMatch:businessMatch(item.tags,"Auto Detailing")};
              })}));
            } catch(error) {console.log("GEOAPIFY_CATEGORY_CHECK",JSON.stringify({label,outcome:error.code||"error"}));}
          }
          return;
        }
        for (const [city,niche] of [["Uberlândia, Minas Gerais, Brasil", "Barber"],
          ["Saskatoon, Saskatchewan, Canada", "Barber"], ["Sydney, New South Wales, Australia", "Auto Detailing"]]) {
          const diagnostic = {city,niche,queries:[]};
          try {
            const result = await discover(city,niche,()=>{},update=>{
              if (update.queryAttempt) diagnostic.queries.push(update.queryAttempt);
              else Object.assign(diagnostic,update);
            });
            console.log("GEOAPIFY_CHECK", JSON.stringify({...diagnostic, outcome: result.rows.length ? "success" : "empty", count:result.rows.length,
              examples: result.rows.slice(0,3).map(row=>({name:row.name,osmId:row.osmId,matchMethod:row.matchMethod}))}));
          } catch (error) {
            console.log("GEOAPIFY_CHECK", JSON.stringify({...diagnostic, outcome:error.code || "error"}));
            if (["geoapify_http_401", "geoapify_http_403", "geoapify_http_429"].includes(error.code)) break;
          }
        }
      })().catch(()=>console.log("GEOAPIFY_CHECK", JSON.stringify({outcome:"check_failed"})));
    }

    if (process.env.RENDER_SERVICE_NAME === "prospect-ai-discovery-test" &&
        process.env.OVERPASS_NETWORK_CHECK === "1") {
      require("./network-check.cjs").run().catch(() => console.error("NETWORK_CHECK failed"));
    }
  }
);
