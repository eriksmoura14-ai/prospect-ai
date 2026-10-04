"use strict";
const https = require("node:https");
const ENDPOINT = "https://api.geoapify.com/v2/places";
// Todos os grupos de POIs documentados, sem substituir os seletores de niches.cjs.
const CATEGORIES = "accommodation,activity,airport,commercial,catering,emergency,education,childcare,entertainment,healthcare,heritage,highway,leisure,man_made,maritime,waterway,natural,national_park,office,parking,pet,power,production,railway,rental,service,tourism,religion,camping,amenity,beach,adult,building,ski,sport,public_transport,administrative,postal_code,political,low_emission_zone,populated_place,memorial".split(",");
function failure(code, message) { return Object.assign(new Error(message), {code}); }
function spatialFilter(place) {
  if (place.osm_type === "relation") {
    const geometry = place.geojson;
    if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type))
      throw failure("geoapify_geometry", "O geocodificador não forneceu o limite completo da cidade. A área não foi substituída por um raio ou retângulo.");
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons)) throw failure("geoapify_geometry", "Limite geográfico inválido.");
    let rings = 0, positions = 0;
    for (const polygon of polygons) for (const ring of polygon) {
      rings++; positions += ring.length;
      if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)) ||
          !ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90))
        throw failure("geoapify_geometry", "Limite geográfico inválido.");
    }
    if (!rings || rings > 100 || positions > 10000 || Buffer.byteLength(JSON.stringify(geometry)) > 102400)
      throw failure("geoapify_geometry_limit", "O limite completo desta cidade excede a capacidade do provedor. A área não foi reduzida.");
    return {type: "polygon", geometry};
  }
  const [south, north, west, east] = place.boundingbox.map(Number);
  if (![south,north,west,east].every(Number.isFinite) || south >= north || west >= east)
    throw failure("geoapify_geometry", "Retângulo geográfico inválido.");
  return {type: "rect", lon1: west, lat1: south, lon2: east, lat2: north};
}
function request(body, apiKey, onTrace = () => {}) {
  return new Promise((resolve, reject) => {
    if (!apiKey || /[\r\n]/.test(apiKey)) return reject(failure("geoapify_configuration", "Configure GEOAPIFY_API_KEY no ambiente do servidor."));
    const started = Date.now();
    const trace = {provider: "Geoapify", endpoint: ENDPOINT, offset: body.offset, phase: "connecting", bytes: 0};
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(connectionTimer);
      trace.elapsedMs = Date.now() - started; trace.outcome = error?.code || "success";
      onTrace({...trace}); error ? reject(error) : resolve(result);
    };
    const payload = JSON.stringify(body);
    const req = https.request(ENDPOINT, {method: "POST", headers: {"x-api-key": apiKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload)}}, res => {
      trace.phase = "reading_body"; trace.httpStatus = res.statusCode;
      if (res.statusCode !== 200) {
        res.resume();
        return finish(failure(`geoapify_http_${res.statusCode}`, res.statusCode === 429 ? "A cota do Geoapify foi atingida. A busca não foi concluída." : `Geoapify recusou a consulta (HTTP ${res.statusCode}). A busca não foi concluída.`));
      }
      const chunks = [];
      res.on("data", chunk => {
        trace.bytes += chunk.length;
        if (trace.bytes > 8388608) { finish(failure("geoapify_size", "Resposta do Geoapify excedeu o limite seguro. A busca não foi concluída.")); res.destroy(); return; }
        chunks.push(chunk);
      });
      res.on("aborted", () => finish(failure("geoapify_body", "Conexão interrompida durante a resposta do Geoapify.")));
      res.on("error", () => finish(failure("geoapify_body", "Conexão interrompida durante a resposta do Geoapify.")));
      res.on("end", () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks)); } catch { return finish(failure("geoapify_json", "Geoapify enviou uma resposta inválida.")); }
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features)) return finish(failure("geoapify_schema", "Geoapify enviou um formato inesperado."));
        trace.phase = "complete"; trace.count = data.features.length; finish(null, data);
      });
    });
    req.on("socket", socket => socket.once("secureConnect", () => {clearTimeout(connectionTimer); trace.phase = "awaiting_headers"; trace.connectedMs = Date.now() - started;}));
    req.on("error", () => finish(failure("geoapify_connection", "Não foi possível conectar ao Geoapify.")));
    const timer = setTimeout(() => {finish(failure(trace.phase === "connecting" ? "geoapify_connection_timeout" : "geoapify_response_timeout", "Geoapify não respondeu no prazo. A busca não foi concluída.")); req.destroy();}, 20000);
    const connectionTimer = setTimeout(() => {finish(failure("geoapify_connection_timeout", "Não foi possível conectar ao Geoapify no prazo.")); req.destroy();}, 5000);
    req.end(payload);
  });
}
function element(feature) {
  const raw = feature.properties?.datasource?.raw;
  // Sem reconstruir tags pela categoria do provedor: a classificação original exige evidência OSM.
  if (!raw || typeof raw !== "object") throw failure("geoapify_raw_missing", "O provedor não forneceu as tags originais necessárias à classificação. A busca não foi concluída.");
  const osmType = String(raw.osm_type || "").toLowerCase();
  const type = ({n: "node", w: "way", r: "relation"})[osmType] || osmType;
  const id = Number(raw.osm_id);
  if (!["node", "way", "relation"].includes(type) || !Number.isSafeInteger(id) || id <= 0)
    throw failure("geoapify_identity", "O provedor não forneceu a identidade OSM original. A busca não foi concluída.");
  const [lon, lat] = feature.geometry?.coordinates || [];
  if (feature.geometry?.type !== "Point" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw failure("geoapify_coordinates", "O provedor não forneceu coordenadas válidas. A busca não foi concluída.");
  return {type, id, lat, lon, tags: {...raw}};
}
async function discover(place, {apiKey, onTrace, onProgress = () => {}, transport = request} = {}) {
  const filter = spatialFilter(place), elements = [], seen = new Set();
  // Até 100 créditos nominais por busca (4 páginas de 500). Nunca retorna uma lista truncada.
  for (let page = 0; page < 4; page++) {
    onProgress(`Consultando Geoapify, página ${page + 1}. A quantidade total ainda é desconhecida…`);
    const data = await transport({categories: CATEGORIES, filter, limit: 500, offset: page * 500}, apiKey, onTrace);
    if (!Array.isArray(data.features) || data.features.length > 500) throw failure("geoapify_schema", "Página inválida do Geoapify.");
    for (const feature of data.features) {
      const item = element(feature), key = `${item.type}/${item.id}`;
      if (seen.has(key)) throw failure("geoapify_pagination", "Geoapify repetiu resultados entre páginas. Não é possível confirmar uma busca completa.");
      seen.add(key); elements.push(item);
    }
    if (data.features.length < 500) return {elements};
  }
  throw failure("geoapify_budget", "A cidade exige mais páginas que o orçamento gratuito por busca. Nenhum resultado parcial foi apresentado; a área e os filtros foram preservados.");
}
module.exports = {discover, spatialFilter, element, request, CATEGORIES, ENDPOINT};
