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
  if (!["node", "way", "relation"].includes(place?.osm_type) || !/^[1-9]\d{0,15}$/.test(String(place.osm_id))) {
    throw failure("qlever_region_unsupported", "Esta localidade não possui uma identidade OpenStreetMap válida.");
  }
  return `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`;
}

function geographicPattern(place, region) {
  // A constant inside OPTIONAL prevents a global spatial join before the
  // outer VALUES is applied. Keep the complete relation, including place=city.
  if (place.osm_type === "relation") return `<${region}> ogc:sfContains ?poi .`;
  const bounds = place.boundingbox;
  if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(value =>
      !["string", "number"].includes(typeof value) || String(value).trim() === "")) {
    throw failure("qlever_region_unsupported", "Esta localidade não possui limites geográficos válidos.");
  }
  const [south, north, west, east] = bounds.map(Number);
  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east ||
      south < -90 || north > 90 || west < -180 || east > 180 || north - south > 2 || east - west > 3) {
    throw failure("qlever_region_unsupported", "Esta localidade não possui limites geográficos válidos.");
  }
  // Keep the full geocoder rectangle previously sent to Overpass: no radius,
  // alternative city, or switch to another source after a failure.
  const wkt = `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
  return `?poi geo:hasGeometry/geo:asWKT ?searchGeometry .
    FILTER(geof:sfIntersects(?searchGeometry, ${literal(wkt)}^^geo:wktLiteral))`;
}

function buildQuery(place, config, mode = "categories", geometryOnly = false) {
  const region = regionURI(place);
  const geography = geographicPattern(geometryOnly ? {...place,osm_type:"node"} : place, region);
  // UNION branches are planned independently by QLever. Pin the locality
  // inside every branch so name/cuisine filters cannot scan the planet first.
  const scoped = pattern => `{ ${geography} ${pattern} }`;
  const food = [["amenity", matching.FOOD_AMENITIES], ["shop", matching.FOOD_SHOPS], ["craft", matching.FOOD_CRAFTS]];
  const foodPattern = food.map(([key, values]) => scoped(`?poi ${predicate(key)} ?foodType . VALUES ?foodType { ${values.map(literal).join(" ")} }`)).join(" UNION ");
  const branches = config.tags.map(([key, value]) => scoped(`?poi ${predicate(key)} ${literal(value)} .`));
  // Many barbers publish shop=hairdresser rather than hairdresser=barber.
  // The existing local classifier still distinguishes barbers from salons.
  if (config.tags.some(([key, value]) => key === "hairdresser" && value === "barber")) {
    branches.push(scoped(`?poi ${predicate("shop")} "hairdresser" .`));
  }
  if (config.cuisines?.length) {
    const pattern = "(^|;)\\s*(" + config.cuisines.map(escapeRegex).join("|") + ")\\s*(;|$)";
    branches.push(scoped(`?poi ${predicate("cuisine")} ?cuisine . FILTER(REGEX(STR(?cuisine), ${literal(pattern)}, "i"))`));
  }
  if ((mode === "names" || !branches.length) && config.terms.length) {
    branches.length = 0;
    const pattern = config.terms.map(escapeRegex).join("|");
    const commercial = ["shop", "craft", "office", "amenity", "service"].map(key =>
      scoped(`?poi ${predicate(key)} ?commercialType . FILTER(STR(?commercialType) != "no")`)).join(" UNION ");
    branches.push(`{ { ${config.food ? foodPattern : commercial} } FILTER(REGEX(STR(?name), ${literal(pattern)}, "i")) }`);
  }
  if (!branches.length) throw failure("qlever_niche_invalid", "Nicho sem critérios de pesquisa.");
  return `PREFIX ogc: <http://www.opengis.net/rdf#>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
SELECT DISTINCT ?region ?poi ?name WHERE {
 VALUES ?region { <${region}> }
 ${geometryOnly ? `BIND(${literal(place.name || "selected area")} AS ?regionName)` : `?region ${predicate("name")} ?regionName .`}
 OPTIONAL {
    ${geography}
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

function point(wkt, centers = false) {
  const match = /^POINT\s*\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)$/i.exec(wkt || "");
  if (!match) {
    if (!centers || typeof wkt!=="string" || wkt.length>2*1024*1024 || !/^(POLYGON|MULTIPOLYGON|LINESTRING|MULTILINESTRING)\s*\(/i.test(wkt)) return {};
    const pairs=[...wkt.matchAll(/(?:\(|,)\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*(?=[,)])/g)].map(m=>[Number(m[1]),Number(m[2])]);
    if (!pairs.length || pairs.length>50000 || pairs.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>180||Math.abs(y)>90)) return {};
    return {lon:(Math.min(...pairs.map(p=>p[0]))+Math.max(...pairs.map(p=>p[0])))/2,
      lat:(Math.min(...pairs.map(p=>p[1]))+Math.max(...pairs.map(p=>p[1])))/2,locationMethod:"geometry_bbox_center"};
  }
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
    throw failure("qlever_region_missing", "Esta localidade não foi encontrada na base QLever. Não foi usada uma região diferente.");
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

function enrich(elements, data, centers = false) {
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
    Object.assign(element, point(row.wkt?.value, centers));
  }
  if (seen.size !== records.size) throw failure("qlever_invalid_response", "Os detalhes de algumas empresas não foram retornados. A pesquisa não foi apresentada como completa.");
  return elements;
}

async function request(query, { fetchImpl, userAgent, onTrace, purpose, deadline }) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("query", query);
  const started = Date.now();
  let outcome = "success";
  let phase = "awaiting_response", httpStatus, bytes = 0;
  try {
    const usePost = url.href.length > 6000;
    const response = await fetchImpl(usePost ? ENDPOINT : url.href, {
      ...(usePost ? {method:"POST",body:new URLSearchParams({query}).toString()} : {}),
      headers: { Accept: "application/sparql-results+json", "User-Agent": userAgent,
        ...(usePost ? {"Content-Type":"application/x-www-form-urlencoded"} : {}) },
      redirect: "error", signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    httpStatus = response.status;
    phase = "reading_response";
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(failure(`qlever_http_${response.status}`, response.status === 429
        ? "A fonte QLever atingiu seu limite de consultas. Aguarde antes de tentar novamente."
        : "A fonte QLever está indisponível temporariamente. Tente novamente mais tarde."), {httpStatus:response.status,retryAfter:response.headers.get("retry-after")});
    }
    const reader = response.body.getReader();
    const chunks = [];
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
    phase = "complete";
    return data;
  } catch (error) {
    outcome = ["TimeoutError", "AbortError"].includes(error.name) ? "qlever_timeout"
      : typeof error.code === "string" && error.code.startsWith("qlever_") ? error.code : "qlever_connection";
    if (typeof error.code === "string" && error.code.startsWith("qlever_")) throw error;
    throw failure(outcome, outcome === "qlever_timeout" ? "A consulta QLever demorou a responder. Tente novamente mais tarde."
      : "Não foi possível conectar à fonte QLever. Tente novamente mais tarde.");
  } finally { onTrace({ endpoint: ENDPOINT, purpose, phase, outcome, httpStatus, bytes, elapsedMs: Date.now() - started }); }
}

async function discover(place, config, { fetchImpl = fetch, userAgent = "ProspectAI/0.7", onTrace = () => {}, geometryOnly = false, timeoutMs = 45000 } = {}) {
  const options = {fetchImpl, userAgent, onTrace, deadline:Date.now() + Math.min(timeoutMs,45000)};
  const result = extract(await request(buildQuery(place, config, "categories", geometryOnly), {...options, purpose:"candidates"}), place);
  if (!result.elements.length && config.terms.length) {
    Object.assign(result, extract(await request(buildQuery(place, config, "names", geometryOnly), {...options, purpose:"names"}), place));
  }
  if (result.elements.length) enrich(result.elements,
    await request(buildDetailsQuery(result.elements), {...options, purpose:"details"}), geometryOnly);
  return result;
}

module.exports = { ENDPOINT, MAX_BUSINESSES, MAX_BYTES, buildQuery, buildDetailsQuery, extract, enrich, discover };
