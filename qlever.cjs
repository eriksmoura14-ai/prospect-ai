"use strict";

// Public OSM RDF snapshot. No API key, inference of contacts or message sending.
const matching = require("./niche-matching.cjs");
const ENDPOINT = "https://qlever.dev/api/osm-planet";
const KEY = "https://www.openstreetmap.org/wiki/Key:";
const MAX_BUSINESSES = 500;
const MAX_BYTES = 6 * 1024 * 1024;
const TAGS = ["shop", "craft", "office", "amenity", "service", "hairdresser", "cuisine",
  "disused", "abandoned", "phone", "contact:phone", "mobile", "contact:mobile",
  "whatsapp", "contact:whatsapp", "website", "contact:website", "url",
  "addr:full", "addr:street", "addr:housenumber", "addr:unit", "addr:postcode",
  "addr:city", "brand:wikidata", "operator:wikidata"];
const literal = value => JSON.stringify(value);
const predicate = key => `<${KEY}${key}>`;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function failure(code, message) { return Object.assign(new Error(message), { code }); }

function regionURI(place) {
  if (place?.osm_type !== "relation" || !/^[1-9]\d{0,15}$/.test(String(place.osm_id))) {
    throw failure("qlever_region_unsupported", "Esta localidade não possui um limite administrativo compatível com o QLever.");
  }
  return `https://www.openstreetmap.org/relation/${place.osm_id}`;
}

function buildQuery(place, config, mode = "categories") {
  const region = regionURI(place);
  const food = [["amenity", matching.FOOD_AMENITIES], ["shop", matching.FOOD_SHOPS], ["craft", matching.FOOD_CRAFTS]];
  const foodPattern = food.map(([key, values]) => `{ ?poi ${predicate(key)} ?foodType . VALUES ?foodType { ${values.map(literal).join(" ")} } }`).join(" UNION ");
  const branches = config.tags.map(([key, value]) => `{ ?poi ${predicate(key)} ${literal(value)} . }`);
  // Many barbers publish shop=hairdresser rather than hairdresser=barber.
  // The existing local classifier still distinguishes barbers from salons.
  if (config.tags.some(([key, value]) => key === "hairdresser" && value === "barber")) {
    branches.push(`{ ?poi ${predicate("shop")} "hairdresser" . }`);
  }
  if (config.cuisines?.length) {
    const pattern = "(^|;)\\s*(" + config.cuisines.map(escapeRegex).join("|") + ")\\s*(;|$)";
    branches.push(`{ ?poi ${predicate("cuisine")} ?cuisine . FILTER(REGEX(STR(?cuisine), ${literal(pattern)}, "i")) }`);
  }
  if ((mode === "names" || !branches.length) && config.terms.length) {
    branches.length = 0;
    const pattern = config.terms.map(escapeRegex).join("|");
    const commercial = ["shop", "craft", "office", "amenity", "service"].map(key =>
      `{ ?poi ${predicate(key)} ?commercialType . FILTER(STR(?commercialType) != "no") }`).join(" UNION ");
    branches.push(`{ { ${config.food ? foodPattern : commercial} } FILTER(REGEX(STR(?name), ${literal(pattern)}, "i")) }`);
  }
  if (!branches.length) throw failure("qlever_niche_invalid", "Nicho sem critérios de pesquisa.");
  return `PREFIX ogc: <http://www.opengis.net/rdf#>
SELECT DISTINCT ?region ?poi ?name WHERE {
 VALUES ?region { <${region}> }
 ?region ${predicate("boundary")} "administrative" .
 OPTIONAL {
    ?region ogc:sfContains ?poi .
    ?poi ${predicate("name")} ?name .
    { ${branches.join(" UNION ")} }
 }
} LIMIT ${MAX_BUSINESSES + 1}`;
}

function buildDetailsQuery(elements) {
  const subjects = elements.map(element => {
    if (!["node", "way", "relation"].includes(element.type) || !/^[1-9]\d*$/.test(String(element.id))) {
      throw failure("qlever_invalid_subject", "Identidade OSM inválida.");
    }
    return `<https://www.openstreetmap.org/${element.type}/${element.id}>`;
  });
  if (!subjects.length || subjects.length > MAX_BUSINESSES) throw failure("qlever_invalid_subject", "Quantidade de empresas inválida.");
  return `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
SELECT ?poi ${TAGS.map((_, i) => `?field${i}`).join(" ")} ?wkt WHERE {
 VALUES ?poi { ${subjects.join(" ")} }
 ${TAGS.map((key, i) => `OPTIONAL { ?poi ${predicate(key)} ?field${i} . }`).join("\n ")}
 OPTIONAL { VALUES ?poi { ${subjects.join(" ")} } ?poi geo:hasGeometry ?geometry . ?geometry geo:asWKT ?wkt . }
}`;
}

function point(wkt) {
  const match = /^POINT\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)$/i.exec(wkt || "");
  if (!match) return {};
  const lon = Number(match[1]), lat = Number(match[2]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? { lat, lon } : {};
}

function extract(data, place) {
  const bindings = data?.results?.bindings;
  if (data?.exception || data?.status === "ERROR" || !Array.isArray(bindings)) {
    throw failure("qlever_invalid_response", "A fonte QLever retornou uma resposta inválida ou incompleta.");
  }
  const expected = regionURI(place);
  if (!bindings.some(row => row.region?.type === "uri" && row.region.value === expected)) {
    throw failure("qlever_region_missing", "O limite administrativo desta cidade não foi encontrado na base QLever. Não foi usada uma região diferente.");
  }
  const records = new Map();
  for (const row of bindings) {
    if (row.region?.value !== expected || row.poi?.type !== "uri" || row.name?.type !== "literal") continue;
    const id = /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/([1-9]\d*)$/.exec(row.poi.value);
    if (!id || !row.name.value.trim()) continue;
    let element = records.get(row.poi.value);
    if (!element) {
      element = { type: id[1], id: id[2], tags: { name: row.name.value }, ...point(row.wkt?.value) };
      records.set(row.poi.value, element);
    }
    const key = row.tag?.type === "uri" && row.tag.value.startsWith(KEY) ? row.tag.value.slice(KEY.length) : "";
    if (TAGS.includes(key) && row.value?.type === "literal") element.tags[key] = row.value.value;
  }
  const truncated = records.size > MAX_BUSINESSES;
  return { elements: [...records.values()].slice(0, MAX_BUSINESSES), truncated,
    warning: truncated ? `Amostra limitada aos primeiros ${MAX_BUSINESSES} registros da fonte; podem existir outras empresas.` : "" };
}

function enrich(elements, data) {
  if (data?.exception || data?.status === "ERROR" || !Array.isArray(data?.results?.bindings)) {
    throw failure("qlever_invalid_response", "A fonte QLever retornou detalhes inválidos ou incompletos.");
  }
  const records = new Map(elements.map(e => [`https://www.openstreetmap.org/${e.type}/${e.id}`, e]));
  const seen = new Set();
  for (const row of data.results.bindings) {
    const element = row.poi?.type === "uri" && records.get(row.poi.value);
    if (!element) continue;
    seen.add(row.poi.value);
    const key = row.tag?.type === "uri" && row.tag.value.startsWith(KEY) ? row.tag.value.slice(KEY.length) : "";
    if (TAGS.includes(key) && (row.value?.type === "literal" || ["brand:wikidata", "operator:wikidata"].includes(key) && row.value?.type === "uri")) element.tags[key] = row.value.value;
    for (const [i, field] of TAGS.entries()) {
      const value = row[`field${i}`];
      if (value?.type === "literal" || ["brand:wikidata", "operator:wikidata"].includes(field) && value?.type === "uri") element.tags[field] = value.value;
    }
    Object.assign(element, point(row.wkt?.value));
  }
  if (seen.size !== records.size) throw failure("qlever_invalid_response", "Os detalhes de algumas empresas não foram retornados. A pesquisa não foi apresentada como completa.");
  return elements;
}

async function request(query, { fetchImpl, userAgent, onTrace, purpose, deadline }) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  const started = Date.now();
  let outcome = "success";
  try {
    const usePost = url.href.length > 6000;
    const response = await fetchImpl(usePost ? ENDPOINT : url.href, {
      ...(usePost ? {method:"POST",body:new URLSearchParams({query}).toString()} : {}),
      headers: { Accept: "application/sparql-results+json", "User-Agent": userAgent,
        ...(usePost ? {"Content-Type":"application/x-www-form-urlencoded"} : {}) },
      redirect: "error", signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    if (!response.ok) {
      await response.body?.cancel();
      throw failure(`qlever_http_${response.status}`, response.status === 429
        ? "A fonte QLever atingiu seu limite de consultas. Aguarde antes de tentar novamente."
        : "A fonte QLever está indisponível temporariamente. Tente novamente mais tarde.");
    }
    const reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) throw failure("qlever_response_limit", "A resposta QLever ultrapassou o limite. Não foi apresentada uma lista incompleta.");
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw failure("qlever_invalid_response", "A fonte QLever retornou uma resposta inválida."); }
    if (data?.exception || data?.status === "ERROR" || !Array.isArray(data?.results?.bindings)) throw failure("qlever_invalid_response", "A fonte QLever retornou uma resposta inválida ou incompleta.");
    return data;
  } catch (error) {
    outcome = ["TimeoutError", "AbortError"].includes(error.name) ? "qlever_timeout"
      : typeof error.code === "string" && error.code.startsWith("qlever_") ? error.code : "qlever_connection";
    if (typeof error.code === "string" && error.code.startsWith("qlever_")) throw error;
    throw failure(outcome, outcome === "qlever_timeout" ? "A consulta QLever demorou a responder. Tente novamente mais tarde."
      : "Não foi possível conectar à fonte QLever. Tente novamente mais tarde.");
  } finally { onTrace({ endpoint: ENDPOINT, purpose, phase: "complete", outcome, elapsedMs: Date.now() - started }); }
}

async function discover(place, config, { fetchImpl = fetch, userAgent = "ProspectAI/0.7", onTrace = () => {} } = {}) {
  const options = {fetchImpl, userAgent, onTrace, deadline:Date.now() + 45000};
  const result = extract(await request(buildQuery(place, config), {...options, purpose:"candidates"}), place);
  if (!result.elements.length && config.terms.length) {
    Object.assign(result, extract(await request(buildQuery(place, config, "names"), {...options, purpose:"names"}), place));
  }
  if (result.elements.length) enrich(result.elements,
    await request(buildDetailsQuery(result.elements), {...options, purpose:"details"}));
  return result;
}

module.exports = { ENDPOINT, MAX_BUSINESSES, MAX_BYTES, buildQuery, buildDetailsQuery, extract, enrich, discover };
