"use strict";
const https = require("node:https");
const ENDPOINT = "https://api.geoapify.com/v2/places";
// Índices comerciais; não misturar índices de geometria (rios, bairros, edifícios).
const CATEGORIES = ["commercial", "service", "office"];
// Grupos documentados que incluem os tags OSM cadastrados nesses nichos.
// A classificação continua exclusiva de businessMatch no servidor.
const CATEGORY_HINTS = {
  "Barber": ["service.beauty.hairdresser"],
  "Hair Salon": ["service.beauty.hairdresser"],
  "Auto Detailing": ["service.vehicle"],
  "Electrician": ["service.electrician"]
};
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
    if (!rings) throw failure("geoapify_geometry", "Limite geográfico vazio.");
    if (rings > 100 || positions > 10000 || Buffer.byteLength(JSON.stringify(geometry)) > 102400)
      return spatialFilter({...place, osm_type: "node"}); // Retângulo integral + filtro local pelo polígono intacto.
    return {type: "polygon", geometry};
  }
  const [south, north, west, east] = place.boundingbox.map(Number);
  if (![south,north,west,east].every(Number.isFinite) || south >= north || west >= east)
    throw failure("geoapify_geometry", "Retângulo geográfico inválido.");
  return {type: "rect", lon1: west, lat1: south, lon2: east, lat2: north};
}
// -1 fora, 0 sobre a borda, 1 dentro. Mantém todos os vértices e buracos.
function ringPosition(point, ring) {
  const [x,y] = point; let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [ax,ay]=ring[j], [bx,by]=ring[i];
    const cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax);
    if (Math.abs(cross)<=1e-12 && x>=Math.min(ax,bx) && x<=Math.max(ax,bx) && y>=Math.min(ay,by) && y<=Math.max(ay,by)) return 0;
    if ((ay>y)!==(by>y) && x < (bx-ax)*(y-ay)/(by-ay)+ax) inside=!inside;
  }
  return inside ? 1 : -1;
}
function contains(geometry, point) {
  const polygons=geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings=>ringPosition(point,rings[0])>=0 && rings.slice(1).every(ring=>ringPosition(point,ring)<=0));
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
      clearTimeout(connectionTimer);
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
        trace.phase = "complete"; trace.count = data.features.length;
        trace.rawFields = Object.keys(data.features[0]?.properties?.datasource?.raw || {});
        trace.commercialTagCount = data.features.filter(f => ["shop","craft","office","amenity","service"].some(k => f.properties?.datasource?.raw?.[k])).length;
        trace.categorySamples = data.features.slice(0,5).map(f=>({categories:f.properties?.categories, raw: Object.fromEntries(["shop","craft","office","amenity","service","hairdresser","osm_type"].filter(k=>f.properties?.datasource?.raw?.[k] != null).map(k=>[k,f.properties.datasource.raw[k]]))})); finish(null, data);
      });
    });
    req.on("socket", socket => {
      const connected = () => {clearTimeout(connectionTimer); trace.phase="awaiting_headers"; trace.connectedMs=Date.now()-started;};
      if (req.reusedSocket) {trace.reusedConnection=true; connected();}
      else socket.once("secureConnect", connected);
    });
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
  const tags = {...raw};
  // Geoapify também publica componentes de endereço sem o prefixo addr:.
  for (const [target,source] of [["addr:street","street"],["addr:housenumber","housenumber"],["addr:postcode","postcode"],["addr:city","city"]]) {
    if (!tags[target] && typeof (raw[source] ?? feature.properties?.[source]) === "string") tags[target] = raw[source] ?? feature.properties[source];
  }
  return {type, id, lat, lon, tags};
}
async function discover(place, {apiKey, onTrace, onProgress = () => {}, transport = request, categories = CATEGORIES, budget = {remaining:4}} = {}) {
  const filter = spatialFilter(place), elements = [], seen = new Set();
  const localPolygon = place.osm_type === "relation" && filter.type === "rect" ? place.geojson : null;
  if (localPolygon) onProgress("Consultando o retângulo completo; os pontos serão filtrados pelo limite administrativo original, sem simplificação…");
  // Até 100 créditos nominais por busca (4 páginas de 500). Nunca retorna uma lista truncada.
  for (let page = 0; page < 4; page++) {
    onProgress(`Consultando Geoapify, página ${page + 1}. A quantidade total ainda é desconhecida…`);
    if (budget.remaining <= 0) throw failure("geoapify_budget", "A busca exige mais páginas que o orçamento gratuito. Nenhum resultado parcial foi apresentado; a área e os filtros foram preservados.");
    budget.remaining--;
    const data = await transport({categories, filter, limit: 500, offset: page * 500}, apiKey, onTrace);
    if (!Array.isArray(data.features) || data.features.length > 500) throw failure("geoapify_schema", "Página inválida do Geoapify.");
    for (const feature of data.features) {
      const item = element(feature), key = `${item.type}/${item.id}`;
      if (seen.has(key)) throw failure("geoapify_pagination", "Geoapify repetiu resultados entre páginas. Não é possível confirmar uma busca completa.");
      seen.add(key);
      if (!localPolygon || contains(localPolygon, [item.lon,item.lat])) elements.push(item);
    }
    if (data.features.length < 500) return {elements};
  }
  throw failure("geoapify_budget", "A cidade exige mais páginas que o orçamento gratuito por busca. Nenhum resultado parcial foi apresentado; a área e os filtros foram preservados.");
}
module.exports = {discover, spatialFilter, element, request, contains, CATEGORIES, CATEGORY_HINTS, ENDPOINT};
