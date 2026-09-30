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

// Configuração local e hospedada.
const HOSTED = process.env.RENDER === "true";
const PORT = Number(process.env.PORT || 3000);

const ORIGIN = new URL(
  process.env.APP_ORIGIN ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://127.0.0.1:${PORT}`
).origin;

const USER = process.env.APP_USER || "admin";
const PASSWORD = process.env.APP_PASSWORD || "";

const UA =
  `ProspectAI/0.2 (+${ORIGIN}; public business research)`;

const LOCATIONIQ_KEY = (process.env.LOCATIONIQ_KEY || "").trim();

const NOMINATIM =
  process.env.NOMINATIM_URL ||
  "https://nominatim.openstreetmap.org/search";

const OVERPASS =
  process.env.OVERPASS_URL ||
  "https://overpass-api.de/api/interpreter";

if (HOSTED && PASSWORD.length < 16) {
  console.error(
    "Configure APP_PASSWORD no Render com pelo menos 16 caracteres."
  );
  process.exit(1);
}

const HOUR = 3600000;
const CACHE_DIR = path.join(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "data.json");

const jobs = new Map();

let activeJob = null;
let lastSearch = 0;
let lastGeocode = 0;
let cache = {};
let cacheTimer = null;

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const normalize = value =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const digits = value =>
  String(value || "").replace(/\D/g, "");

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

async function fetchJSON(url, options = {}, geocode = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
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
        signal: AbortSignal.timeout(35000)
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

        if (retryable && attempt === 0 && delay <= 10000) {
          await sleep(Math.max(2000, delay));
          continue;
        }

        throw new Error(
          `Serviço respondeu HTTP ${response.status}.`
        );
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

      if (attempt === 0 && transient) {
        await sleep(2000);
        continue;
      }

      throw error;
    }
  }
}

async function locate(city) {
  const key = `city:v3:${LOCATIONIQ_KEY ? "locationiq" : "nominatim"}:${normalize(city)}`;
  const hit = cached(key);
  if (hit) return hit;

  const url = new URL(LOCATIONIQ_KEY
    ? "https://us1.locationiq.com/v1/search"
    : NOMINATIM
  );

  if (LOCATIONIQ_KEY) {
    url.searchParams.set("key", LOCATIONIQ_KEY);
    url.searchParams.set("source", "nom");
  }
  url.searchParams.set("q", city);
  url.searchParams.set("format", LOCATIONIQ_KEY ? "json" : "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "5");
  if (!LOCATIONIQ_KEY) url.searchParams.set("featuretype", "city");

  let data;

  try {
    data = await fetchJSON(url, {}, true);
  } catch (error) {
    const rawDetail = [
      error.name,
      error.message,
      error.cause?.code
    ].filter(Boolean).join(" — ");
    const detail = LOCATIONIQ_KEY
      ? rawDetail.split(LOCATIONIQ_KEY).join("[chave ocultada]")
      : rawDetail;

    console.error("Falha ao localizar cidade:", detail);

    throw new Error(
      "Falha na consulta da cidade: " + detail
    );
  }

  if (!Array.isArray(data)) {
    throw new Error("O serviço de localização retornou uma resposta inválida.");
  }

  const places = data.filter(place =>
    place.boundingbox &&
    (
      place.class === "place" ||
      place.category === "place" ||
      place.type === "administrative"
    )
  );

  if (!places.length) {
    throw new Error("Cidade não encontrada.");
  }

  const requested = normalize(city.split(",")[0]);

  const exact = places.filter(place =>
    normalize(
      place.name || place.display_name.split(",")[0]
    ) === requested
  );

  if (exact.length > 1 && !city.includes(",")) {
    throw new Error(
      "Há cidades com esse nome. Informe cidade, estado/província e país."
    );
  }

  const selected = exact[0] || places[0];

  saveCache(key, selected, LOCATIONIQ_KEY ? 48 * HOUR : 7 * 24 * HOUR);
  return selected;
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
    config.tags.some(([key, value]) => tags[key] === value)
  ) {
    return true;
  }

  const name = ` ${normalize(tags.name)} `;

  return config.terms.some(term =>
    name.includes(` ${normalize(term)} `)
  );
}

function websiteURL(value) {
  if (!value) return "";

  try {
    const raw = String(value).split(";")[0].trim();

    const url = new URL(
      /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    );

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
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

      if (normalize(other.name) !== normalize(row.name)) {
        return false;
      }

      const near =
        Math.abs(other.latitude - row.latitude) < 0.0008 &&
        Math.abs(other.longitude - row.longitude) < 0.0008;

      const sameAddress =
        row.address &&
        other.address &&
        normalize(row.address) === normalize(other.address);

      return near || sameAddress;
    });

    if (!previous) {
      output.push(row);
      continue;
    }

    for (const key of [
      "phone", "address", "website", "street", "houseNumber"
    ]) {
      if (!previous[key] && row[key]) previous[key] = row[key];
    }

    previous.osmIds.push(row.osmId);
    previous.chainSignal ||= row.chainSignal;
    previous.invalidListedWebsite ||= row.invalidListedWebsite;

    if (previous.website) {
      previous.status = "WEBSITE_LISTED";
      previous.confidence = 1;
      previous.reason =
        "Website informado diretamente no OpenStreetMap.";
    }

    previous.prospectScore = prospectScore(previous);
  }

  return output;
}

async function discover(city, niche) {
  const key = `discovery:v3:${LOCATIONIQ_KEY ? "locationiq" : "nominatim"}:${normalize(city)}:${niche}`;
  const hit = cached(key);
  if (hit) return structuredClone(hit);

  const place = await locate(city);
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

  const config = niches[niche];

  const escapeRegex = value =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const keywords =
    config.terms.map(escapeRegex).join("|");

  const selectors = config.tags.map(([key, value]) =>
    `nwr${scope}[${JSON.stringify(key)}=${JSON.stringify(value)}]["name"];`
  );

  selectors.push(
    `nwr${scope}` +
    `[~"^(shop|craft|office|amenity|service)$"~"."]` +
    `["name"~${JSON.stringify(keywords)},i];`
  );

  const query = `
    [out:json][timeout:25][maxsize:16777216];
    ${relation ? `area(${areaId})->.searchArea;` : ""}
    (${selectors.join("\n")});
    out center tags;
  `;

  let data;

  try {
    data = await fetchJSON(OVERPASS, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ data: query }).toString()
    });
  } catch {
    throw new Error(
      "Overpass indisponível ou consulta demorou demais. Tente mais tarde."
    );
  }

  if (data.remark || !Array.isArray(data.elements)) {
    throw new Error(
      "O Overpass retornou uma resposta incompleta."
    );
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

    const rawWebsite =
      tags.website || tags["contact:website"] || tags.url;

    const website = websiteURL(rawWebsite);

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
      phone: tags.phone || tags["contact:phone"] || "",
      website,
      latitude,
      longitude,
      osmId: `${element.type}/${element.id}`,
      osmIds: [`${element.type}/${element.id}`],
      source: "OpenStreetMap",
      street: tags["addr:street"] || "",
      houseNumber: tags["addr:housenumber"] || "",
      invalidListedWebsite: Boolean(rawWebsite && !website),
      chainSignal: Boolean(
        tags["brand:wikidata"] || tags["operator:wikidata"]
      ),
      matchMethod: config.tags.some(
        ([key, value]) => tags[key] === value
      ) ? "tag" : "keyword",
      status: website ? "WEBSITE_LISTED" : "UNCERTAIN",
      confidence: website ? 1 : 0,
      reason: website
        ? "Website informado diretamente no OpenStreetMap."
        : "Aguardando verificação.",
      verification: null
    };

    row.prospectScore = prospectScore(row);
    rows.push(row);
  }

  const result = {
    place: place.display_name,
    geographicScope: relation
      ? "Limite administrativo"
      : "Retângulo geográfico da localidade",
    rows: deduplicate(rows)
  };

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

async function pageRequest(input, deadline, redirects = 3) {
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

      if (!type.includes("text/html")) {
        finish(null, {
          status,
          html: "",
          finalUrl: url.href
        });
        response.destroy();
        return;
      }

      let bytes = 0;
      const chunks = [];

      response.on("data", chunk => {
        bytes += chunk.length;

        if (bytes > 384 * 1024) {
          finish(new Error("Página excedeu o limite de leitura."));
          response.destroy();
          return;
        }

        chunks.push(chunk);
      });

      response.on("end", () => finish(null, {
        status,
        finalUrl: url.href,
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
    if (redirects === 0) {
      throw new Error("Excesso de redirecionamentos.");
    }

    return pageRequest(
      result.redirect,
      deadline,
      redirects - 1
    );
  }

  return result;
}

function candidates(name, city) {
  const original = normalize(name);

  const simplified = original
    .replace(
      /\b(inc|incorporated|ltd|limited|llc|corp|corporation)\b/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  const compact = simplified.replaceAll(" ", "");

  const variants = [...new Set([
    original.replaceAll(" ", ""),
    compact,
    simplified.replaceAll(" ", "-"),
    compact + normalize(city).replaceAll(" ", "")
  ])].filter(value =>
    value.length >= 3 && value.length <= 63
  );

  return variants.flatMap(value =>
    [".com", ".ca", ".net", ".org"].map(tld => value + tld)
  );
}

function analyze(page, business) {
  const title = (
    page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  ).replace(/<[^>]+>/g, " ").trim();

  const text = page.html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  const normalizedText = normalize(text);
  const name = normalize(business.name);

  const nameMatch =
    name.length >= 6 &&
    normalize(title).includes(name);

  const phone = digits(business.phone);

  // Compara sequências com formato de telefone, não todos
  // os dígitos da página concatenados.
  const pagePhones =
    text.match(/\+?\d[\d(). \t-]{7,24}\d/g) || [];

  const phoneMatch =
    phone.length >= 10 &&
    pagePhones.some(value =>
      digits(value).endsWith(phone.slice(-10))
    );

  const city = normalize(business.city);
  const cityMatch =
    city.length >= 3 && normalizedText.includes(city);

  const street = normalize(business.street);

  const addressMatch =
    street.length >= 5 &&
    Boolean(business.houseNumber) &&
    normalizedText.includes(street) &&
    normalizedText.includes(normalize(business.houseNumber));

  const parked =
    /\b(domain for sale|buy this domain|website coming soon|parked domain)\b/i
      .test(text);

  const compatible =
    page.status >= 200 &&
    page.status < 300 &&
    !parked &&
    nameMatch &&
    cityMatch &&
    (phoneMatch || addressMatch);

  return {
    title,
    compatible,
    nameMatch,
    phoneMatch,
    cityMatch,
    addressMatch
  };
}

async function verify(business) {
  if (business.status === "WEBSITE_LISTED") return business;

  const key =
    `verify:v2:${business.osmId}:${normalize(business.name)}:` +
    `${business.city}:${business.phone}:${business.address}`;

  const hit = cached(key);

  if (hit) {
    const row = { ...business, ...hit };
    row.prospectScore = prospectScore(row);
    return row;
  }

  const domains = candidates(business.name, business.city);
  const deadline = Date.now() + 25000;
  const evidence = [];

  let uncertain =
    domains.length === 0 || business.invalidListedWebsite;

  let checked = 0;
  let found = null;

  for (const domain of domains) {
    if (Date.now() >= deadline) {
      uncertain = true;
      evidence.push({
        reason: "Verificação parcial: limite de tempo atingido."
      });
      break;
    }

    await sleep(80);

    const resolved = await resolveHost(domain);
    checked++;

    if (resolved.state === "absent") {
      evidence.push({ domain, dns: "absent" });
      continue;
    }

    uncertain = true;

    if (resolved.state !== "public") {
      evidence.push({
        domain,
        dns: resolved.state,
        reason: resolved.reason
      });
      continue;
    }

    for (const protocol of ["https:", "http:"]) {
      try {
        const page = await pageRequest(
          `${protocol}//${domain}`,
          deadline
        );

        const match = analyze(page, business);

        evidence.push({
          domain,
          protocol,
          dns: "public",
          httpStatus: page.status,
          finalUrl: page.finalUrl,
          title: match.title,
          matching: {
            name: match.nameMatch,
            city: match.cityMatch,
            phone: match.phoneMatch,
            address: match.addressMatch
          }
        });

        if (match.compatible) {
          found = page.finalUrl;
          break;
        }
      } catch (error) {
        evidence.push({
          domain,
          protocol,
          error: error.message
        });
      }
    }

    if (found) break;
  }

  const result = {
    website: found || "",
    status: found
      ? "WEBSITE_FOUND"
      : uncertain
        ? "UNCERTAIN"
        : "LIKELY_NO_WEBSITE",
    confidence: found ? 0.95 : uncertain ? 0.40 : 0.65,
    reason: found
      ? "Nome, cidade e telefone ou endereço compatíveis."
      : uncertain
        ? "Verificação incompleta ou domínio duvidoso. Revise manualmente."
        : "Nenhum website encontrado nos candidatos verificados. Isso não comprova ausência.",
    verification: {
      checkedAt: new Date().toISOString(),
      candidatesTotal: domains.length,
      candidatesChecked: checked,
      evidence
    }
  };

  saveCache(
    key,
    result,
    uncertain && !found ? 5 * 60000 : 6 * HOUR
  );

  const row = { ...business, ...result };
  row.prospectScore = prospectScore(row);
  return row;
}

async function run(job, city, niche, limit) {
  try {
    job.message = "Localizando cidade e consultando empresas…";

    const discovery = await discover(city, niche);

    job.place = discovery.place;
    job.geographicScope = discovery.geographicScope;
    job.totalDiscovered = discovery.rows.length;

    job.rows = discovery.rows
      .sort((a, b) => b.prospectScore - a.prospectScore)
      .slice(0, limit);

    job.total = job.rows.length;

    for (let index = 0; index < job.rows.length; index++) {
      job.message =
        `Verificando websites: ${index + 1} de ${job.total}`;

      try {
        job.rows[index] = await verify(job.rows[index]);
      } catch {
        const row = job.rows[index];
        row.status = "UNCERTAIN";
        row.confidence = 0;
        row.reason = "Erro durante a verificação. Revise manualmente.";
        row.prospectScore = prospectScore(row);
      }

      job.completed = index + 1;
    }

    job.state = "done";
    job.message = job.total
      ? "Pesquisa concluída."
      : "Nenhuma empresa correspondente encontrada nesta fonte.";
  } catch (error) {
    job.state = "error";
    job.message = error.message;
  } finally {
    activeJob = null;
  }
}

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let body = "";
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error("Pedido grande demais.");
    body += chunk.toString();
  }

  return JSON.parse(body);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, ORIGIN);

    // Endpoint sem dados de usuário, para o health check.
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true });
    }

    if (request.headers.host !== new URL(ORIGIN).host) {
      return json(response, 403, {
        error: "Use o endereço configurado da aplicação."
      });
    }

    if (!authenticated(request)) {
      response.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="Prospect AI", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end("Informe seu usuário e senha.");
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/niches"
    ) {
      return json(response, 200, Object.keys(niches));
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
        return json(response, 409, {
          error: "Uma pesquisa já está em andamento.",
          jobId: activeJob
        });
      }

      if (Date.now() - lastSearch < 3000) {
        return json(response, 429, {
          error: "Aguarde alguns segundos entre pesquisas."
        });
      }

      const { city, niche, limit } = await readBody(request);

      if (
        typeof city !== "string" ||
        city.trim().length < 2 ||
        city.length > 100 ||
        typeof niche !== "string" ||
        !Object.hasOwn(niches, niche) ||
        ![10, 20, 30, 50].includes(limit)
      ) {
        return json(response, 400, {
          error: "Cidade, nicho ou quantidade inválidos."
        });
      }

      while (jobs.size >= 20) {
        jobs.delete(jobs.keys().next().value);
      }

      const id = randomUUID();

      const job = {
        id,
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

      json(response, 202, { jobId: id });
      void run(job, city.trim(), niche, limit);
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname.startsWith("/api/jobs/")
    ) {
      const id = url.pathname.slice("/api/jobs/".length);
      const job = jobs.get(id);

      return json(
        response,
        job ? 200 : 404,
        job || {
          error: "Pesquisa não encontrada. Inicie outra busca."
        }
      );
    }

    const staticFiles = {
      "/": ["index.html", "text/html; charset=utf-8"],
      "/index.html": ["index.html", "text/html; charset=utf-8"],
      "/app.js": ["app.js", "text/javascript; charset=utf-8"]
    };

    if (
      request.method === "GET" &&
      Object.hasOwn(staticFiles, url.pathname)
    ) {
      const [file, type] = staticFiles[url.pathname];

      let content;
      try {
        content = fs.readFileSync(path.join(__dirname, file));
      } catch {
        return json(response, 503, {
          error: `O arquivo ${file} ainda não foi adicionado ao projeto.`
        });
      }

      if (file === "index.html" && LOCATIONIQ_KEY) {
        content = content.toString("utf8").replace(
          /<body\b[^>]*>/i,
          body => body +
            '<div style="padding:10px 24px;text-align:center">' +
            '<a href="https://locationiq.com" target="_blank" ' +
            'rel="noopener noreferrer">Search by LocationIQ.com</a>' +
            '</div>'
        );
      }

      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self'; " +
          "img-src 'self' data:; " +
          "object-src 'none'; " +
          "base-uri 'none'; " +
          "frame-ancestors 'none'"
      });

      response.end(content);
      return;
    }

    json(response, 404, { error: "Rota não encontrada." });
  } catch {
    if (!response.headersSent) {
      json(response, 400, {
        error: "Não foi possível processar a solicitação."
      });
    } else {
      response.end();
    }
  }
});

server.requestTimeout = 15000;
server.headersTimeout = 10000;

server.listen(
  PORT,
  HOSTED ? "0.0.0.0" : "127.0.0.1",
  () => {
    console.log(`Prospect AI iniciado na porta ${PORT}.`);
    console.log(`Endereço: ${ORIGIN}`);
  }
);