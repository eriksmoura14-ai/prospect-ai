"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { Readable } = require("node:stream");

// Fixtures de regressão, não resultados reais de empresas/geocodificação.
// Exercitam a descoberta sem contatos externos, contas ou chaves de produção.
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const localRequire = createRequire(path.join(root, "server.cjs"));

function place(name, osmId, bounds, osmType = "relation") {
  return { name, display_name: name, category: "place", type: "city",
    osm_type: osmType, osm_id: osmId, boundingbox: bounds.map(String) };
}

function harness({ locations, answers = [], failure, provider = "overpass", geoAnswers = [], geoFailure } = {}) {
  const geoQueries = [];
  const geoQuery = async (place, options) => {
    geoQueries.push({place, categories: options.categories});
    if (geoFailure) throw geoFailure;
    return {elements:geoAnswers[geoQueries.length-1] || []};
  };
  const queries = [];
  const geocodes = [];
  const geocodeRequests = [];
  const fixtureFS = { ...fs,
    readFileSync: () => { throw new Error("Sem cache persistente nos testes."); },
    mkdirSync() {}, writeFileSync() {}, renameSync() {} };
  const query = async (_endpoint, ql, options) => {
    if (ql === localRequire("./overpass.cjs").PROBE_QUERY) {
      options?.onTrace?.({ query: ql, phase: "complete", outcome: "success" });
      return { elements: [{ type: "count", tags: { total: "0" } }] };
    }
    queries.push(ql);
    options?.onTrace?.({ query: ql, phase: "complete", outcome: failure ? failure.code : "success" });
    if (failure) throw failure;
    return { elements: answers[queries.length - 1] || [] };
  };
  const context = {
    require: name => name === "node:fs" ? fixtureFS
      : name === "./overpass.cjs" ? { ...localRequire(name), query }
      : name === "./geoapify.cjs" ? {...localRequire(name), discover:geoQuery} : localRequire(name),
    module: { exports: {} }, __dirname: root,
    process: { env: { APP_PASSWORD: "local-only-test-password", APP_ORIGIN: "http://127.0.0.1:3000", BUSINESS_PROVIDER:provider, GEOAPIFY_API_KEY:provider === "geoapify" ? "fixture-secret" : "" } },
    console: { log() {}, warn() {}, error() {} },
    Buffer, URL, URLSearchParams, AbortSignal, structuredClone, setTimeout, clearTimeout,
    fetch: async (input, options) => {
      const url = new URL(input);
      if (url.pathname.includes("interpreter")) {
        const data = await query(url.href, new URLSearchParams(options.body).get("data"));
        return new Response(JSON.stringify(data));
      }
      const city = url.searchParams.get("q");
      geocodes.push(city);
      geocodeRequests.push(url);
      return new Response(JSON.stringify(locations[city] || []));
    }
  };
  const code = source;
  vm.runInNewContext(code.slice(0, code.lastIndexOf("server.listen(")) + `
    module.exports = { discover, locate, businessMatch,
      handler: server.listeners("request")[0], resetGeocode: () => { lastGeocode = 0; } };
  `, context, { filename: path.join(root, "server.cjs") });
  return { ...context.module.exports, queries, geocodes, geocodeRequests, geoQueries };
}

async function callAPI(h, url, { body, authorized = true } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = body === undefined ? "GET" : "POST";
  request.url = url;
  request.headers = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json",
    authorization: authorized ? "Basic " + Buffer.from("admin:local-only-test-password").toString("base64") : "" };
  const response = { status: null, headersSent: false, body: "",
    setHeader() {},
    writeHead(status) { this.status = status; this.headersSent = true; },
    end(body) { this.body = body || ""; } };
  await h.handler(request, response);
  return response;
}

test("listas de localidades exigem autenticação e validam a cascata real sem acesso externo", async () => {
  const h = harness({ locations: {} });
  assert.equal((await callAPI(h, "/api/locations/countries", { authorized: false })).status, 401);
  const countries = await callAPI(h, "/api/locations/countries");
  assert.equal(countries.status, 200);
  assert.ok(JSON.parse(countries.body).some(item => item.code === "BR" && item.labelpt === "Brasil"));
  const regions = await callAPI(h, "/api/locations/states?country=BR");
  assert.ok(JSON.parse(regions.body).some(item => item.code === "MG"));
  const cities = await callAPI(h, "/api/locations/cities?country=BR&state=MG");
  assert.ok(JSON.parse(cities.body).some(item => item.id === 15434 && item.name === "Uberlândia"));
  assert.equal((await callAPI(h, "/api/locations/cities?country=BR&state=NY")).status, 400);
  assert.equal(h.geocodes.length, 0);
  assert.equal(h.queries.length, 0);
});

test("busca rejeita cidade de outro país antes de consultar serviços externos", async () => {
  const h = harness({ locations: {} });
  const response = await callAPI(h, "/api/search", { body: {
    location: { countryCode: "BR", stateCode: "MG", cityId: 122795 }, niche: "Barber", limit: 10
  } });
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /não pertence/);
  assert.equal(h.geocodes.length, 0);
  assert.equal(h.queries.length, 0);
});

test("geocoder respeita país/estado escolhidos e mantém limite administrativo completo", async () => {
  const selection = await localRequire("./locations.cjs").resolveSelection({ countryCode: "BR", stateCode: "MG", cityId: 15434 });
  const correct = { ...place("Uberlândia", 314875, [-19.416808, -18.5922258, -48.8234391, -47.9034816]),
    address: { country_code: "br", state: "Minas Gerais", "ISO3166-2-lvl4": "BR-MG" } };
  const wrongState = { ...correct, osm_id: 999, address: { country_code: "br", state: "São Paulo", "ISO3166-2-lvl4": "BR-SP" } };
  const wrongCountry = { ...correct, osm_id: 1000, address: { country_code: "us", state: "Minas Gerais" } };
  const h = harness({ locations: { [selection.query]: [wrongCountry, wrongState, correct] },
    answers: [[{ type: "node", id: 1, lat: -18.9, lon: -48.3, tags: { name: "Empresa fictícia", shop: "barber", phone: "(34) 91234-5678" } }]] });
  const result = await h.discover(selection.query, "Barber", () => {}, () => {}, selection);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].countryCode, "BR");
  assert.equal(result.rows[0].phone, "(34) 91234-5678");
  assert.equal(h.geocodeRequests[0].searchParams.get("countrycodes"), "br");
  assert.equal(h.geocodeRequests[0].searchParams.get("q"), "Uberlândia, Minas Gerais, Brazil");
  assert.match(h.queries[0], /area\(3600314875\)/);
  assert.ok(!h.queries[0].includes("3600000999"));
});

test("geocoder incompatível com os filtros não inicia descoberta nem reaproveita cache antigo", async () => {
  const selection = await localRequire("./locations.cjs").resolveSelection({ countryCode: "US", stateCode: "NY", cityId: 122795 });
  const mismatch = { ...place("New York City", 7, [40.4, 40.9, -74.3, -73.6]),
    address: { country_code: "us", state: "Texas", "ISO3166-2-lvl4": "US-TX" } };
  const h = harness({ locations: { [selection.query]: [mismatch] } });
  await h.locate(selection.query); // Cache da interface antiga sem restrições.
  h.resetGeocode();
  await assert.rejects(h.discover(selection.query, "Barber", () => {}, () => {}, selection), /país e estado/);
  assert.equal(h.geocodes.length, 2);
  assert.equal(h.queries.length, 0);
});

test("estado com alfabeto não latino é conferido pelo código ISO", async () => {
  const selection = { query: "Tokyo, Tokyo, Japan", countryCode: "JP", stateCode: "13", stateName: "Tokyo", stateNative: "東京都", stateIso: "JP-13" };
  const p = { ...place("東京都", 12345, [35.5, 35.9, 139.5, 139.9]), address: { country_code: "jp", state: "東京都", "ISO3166-2-lvl4": "JP-13" } };
  const h = harness({ locations: { [selection.query]: [p] } });
  assert.equal((await h.locate(selection.query, () => {}, selection)).osm_id, 12345);
});

test("nome estadual não contorna código conhecido de outro estado", async () => {
  const selection = await localRequire("./locations.cjs").resolveSelection({ countryCode: "BR", stateCode: "MG", cityId: 15434 });
  const p = { ...place("Uberlândia", 314875, [-19.4, -18.6, -48.8, -47.9]),
    address: { country_code: "br", state: "Minas Gerais", "ISO3166-2-lvl4": "BR-SP" } };
  const h = harness({ locations: { [selection.query]: [p] } });
  await assert.rejects(h.locate(selection.query, () => {}, selection), /país e estado/);
  assert.equal(h.queries.length, 0);
});

test("busca em cache fornece ponto geográfico ao globo sem novas consultas externas", async () => {
  const selection = await localRequire("./locations.cjs").resolveSelection({ countryCode: "BR", stateCode: "MG", cityId: "__manual__", manualCity: "Uberlândia" });
  const p = { ...place("Uberlândia", 314875, [-19.4, -18.6, -48.8, -47.9]),
    lat: "-18.9186", lon: "-48.2772",
    address: { country_code: "br", state: "Minas Gerais", "ISO3166-2-lvl4": "BR-MG" } };
  const h = harness({ locations: { [selection.query]: [p] } });
  await h.discover(selection.query, "Barber", () => {}, () => {}, selection);
  const count = { geocodes: h.geocodes.length, queries: h.queries.length };
  const updates = [];
  await h.discover(selection.query, "Barber", () => {}, value => updates.push(value), selection);
  assert.equal(h.geocodes.length, count.geocodes);
  assert.equal(h.queries.length, count.queries);
  const selected = updates.find(value => value.geocode)?.geocode.selected;
  assert.equal(selected.latitude, -18.9186);
  assert.equal(selected.longitude, -48.2772);
});

test("buscas simultâneas após validação assíncrona reservam um único job", async () => {
  const selection = await localRequire("./locations.cjs").resolveSelection({ countryCode: "BR", stateCode: "MG", cityId: 15434 });
  const p = { ...place("Uberlândia", 314875, [-19.4, -18.6, -48.8, -47.9]),
    address: { country_code: "br", state: "Minas Gerais", "ISO3166-2-lvl4": "BR-MG" } };
  const h = harness({ locations: { [selection.query]: [p] } });
  const body = { location: { countryCode: "BR", stateCode: "MG", cityId: 15434 }, niche: "Barber", limit: 10 };
  const responses = await Promise.all([callAPI(h, "/api/search", { body }), callAPI(h, "/api/search", { body })]);
  assert.equal(responses.filter(response => response.status === 202).length, 1);
  assert.ok(responses.some(response => [409, 429].includes(response.status)));
  const jobId = JSON.parse(responses.find(response => response.status === 202).body).jobId;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2));
    const job = JSON.parse((await callAPI(h, `/api/jobs/${jobId}`)).body);
    if (job.state !== "running") break;
  }
  assert.equal(h.geocodes.length, 1);
});

const scenarios = [
  ["São Paulo, Brasil", [-24.1, -23.3, -46.9, -46.3], "relation"],
  ["Saskatoon, Canada", [52.0, 52.3, -106.9, -106.4], "relation"],
  ["Sydney, Australia", [-34.2, -33.3, 150.2, 151.4], "relation"],
  ["東京", [35.5, 35.9, 139.5, 139.9], "relation"],
  ["القاهرة", [29.9, 30.2, 31.1, 31.5], "node"]
];

for (const [city, bounds, type] of scenarios) {
  test(`alcance completo e classificação preservados: ${city}`, async () => {
    const locations = { [city]: [place(city.split(",")[0], 12345, bounds, type)] };
    const element = { type: "node", id: 22, lat: bounds[0], lon: bounds[2],
      tags: { name: "Fixture Barber", shop: "barber", website: "https://example.com" } };
    const after = harness({ locations, answers: [[element]] });
    const b = await after.discover(city, "Barber");
    assert.equal(after.queries.length, 1);
    assert.equal(b.rows.length, 1);
    assert.equal(b.rows[0].status, "WEBSITE_LISTED");
    assert.equal(b.rows[0].matchMethod, "tag");
    assert.equal(b.rows[0].confidence, 1);
    assert.ok(after.queries[0].includes('["shop"="barber"]["name"]'));
    assert.ok(after.queries[0].includes('["hairdresser"="barber"]["name"]'));
    if (type === "relation") assert.match(after.queries[0], /area\(3600012345\)/);
    else assert.ok(after.queries[0].includes(`(${bounds[0]},${bounds[2]},${bounds[1]},${bounds[3]})`));
  });
}

test("cidades não latinas têm caches de localidade e descoberta independentes", async () => {
  const locations = {
    "北京": [place("北京", 11111, [39.7, 40.1, 116.1, 116.7])],
    "東京": [place("東京", 22222, [35.5, 35.9, 139.5, 139.9])]
  };
  const h = harness({ locations });
  await h.discover("北京", "Barber");
  h.resetGeocode();
  const tokyo = await h.discover("東京", "Barber");
  assert.equal(tokyo.place, "東京");
  assert.deepEqual(h.geocodes, ["北京", "東京"]);
  assert.match(h.queries[0], /area\(3600011111\)/);
  assert.match(h.queries[2], /area\(3600022222\)/);
  assert.equal(h.queries.length, 4); // categoria + nomes em cada cidade, ambos vazios
  const calls = h.queries.length;
  const cached = await h.discover("東京", "Barber");
  assert.equal(cached.place, "東京");
  assert.equal(h.queries.length, calls);
});

test("nome exato não latino não seleciona outra cidade de outro alfabeto", async () => {
  const h = harness({ locations: { "東京": [
    place("北京", 11111, [39.7, 40.1, 116.1, 116.7]),
    place("東京", 22222, [35.5, 35.9, 139.5, 139.9])
  ] } });
  const selected = await h.locate("東京");
  assert.equal(selected.osm_id, 22222);
});

test("resposta vazia mantém alternativa por nomes e distingue empty", async () => {
  const h = harness({ locations: { City: [place("City", 12345, [1, 2, 3, 4])] } });
  const diagnostics = [];
  const result = await h.discover("City", "Barber", () => {}, value => diagnostics.push(value));
  assert.equal(h.queries.length, 2);
  assert.match(h.queries[1], /barbershop/);
  assert.equal(result.rows.length, 0);
  assert.equal(diagnostics.at(-1).outcome, "empty");
});

test("falha Overpass não aciona alternativa por nomes nem salva resultado vazio", async () => {
  const failure = Object.assign(new Error("Timeout controlado"), { code: "query_timeout" });
  const h = harness({ locations: { City: [place("City", 12345, [1, 2, 3, 4])] }, failure });
  await assert.rejects(h.discover("City", "Barber"), error => error.code === "query_timeout");
  assert.equal(h.queries.length, 1);
  await assert.rejects(h.discover("City", "Barber"), error => error.code === "query_timeout");
  assert.equal(h.queries.length, 2);
});

test("diagnóstico exige autenticação e não faz contato externo por padrão", async () => {
  const h = harness({ locations: {} });
  async function call(authorization) {
    const response = { status: null, headersSent: false, body: "",
      setHeader() {},
      writeHead(status) { this.status = status; this.headersSent = true; },
      end(body) { this.body = body || ""; } };
    await h.handler({ method: "GET", url: "/api/diagnostics/overpass",
      headers: { host: "127.0.0.1:3000", authorization } }, response);
    return response;
  }
  assert.equal((await call("")).status, 401);
  const response = await call("Basic " + Buffer.from("admin:local-only-test-password").toString("base64"));
  assert.equal(response.status, 200);
  const result = JSON.parse(response.body);
  assert.equal(result.probe, null);
  assert.equal(result.lastDiscovery, null);
  assert.equal(h.queries.length, 0);
  assert.equal(h.geocodes.length, 0);
  assert.ok(!response.body.includes("local-only-test-password"));
});

test("Geoapify usa categoria adequada e mantém businessMatch e fonte",async()=>{
 const city="Fixture, Brasil",p=place("Fixture",7,[-19,-18,-49,-48]);const e={type:"node",id:1,lat:-18.5,lon:-48.5,tags:{name:"Fixture Barber",shop:"barber"}};
 const h=harness({locations:{[city]:[p]},provider:"geoapify",geoAnswers:[[e]]});const result=await h.discover(city,"Barber");
 assert.equal(h.queries.length,0);assert.equal(h.geoQueries.length,1);assert.deepEqual(h.geoQueries[0].categories,["service.beauty.hairdresser"]);assert.equal(result.rows[0].matchMethod,"tag");assert.equal(result.rows[0].source,"OpenStreetMap via Geoapify");
});
test("Geoapify sem correspondência tenta índices comerciais sem fabricar tags",async()=>{
 const city="Fixture, Brasil",p=place("Fixture",7,[-19,-18,-49,-48]);const e={type:"node",id:1,lat:-18.5,lon:-48.5,tags:{name:"Fixture Barber Company",shop:"hairdresser"}};
 const h=harness({locations:{[city]:[p]},provider:"geoapify",geoAnswers:[[],[e]]});const result=await h.discover(city,"Barber");
 assert.equal(h.geoQueries.length,2);assert.deepEqual(h.geoQueries[1].categories,["commercial","service","office"]);assert.equal(result.rows[0].matchMethod,"keyword");assert.equal(result.rows[0].category,"Barber");
});
test("falha de cota Geoapify não é convertida em alternativa ou lista vazia",async()=>{
 const city="Fixture, Brasil",p=place("Fixture",7,[-19,-18,-49,-48]);const h=harness({locations:{[city]:[p]},provider:"geoapify",geoFailure:Object.assign(new Error("quota"),{code:"geoapify_http_429"})});
 await assert.rejects(h.discover(city,"Barber"),{code:"geoapify_http_429"});assert.equal(h.geoQueries.length,1);assert.equal(h.queries.length,0);
});

test("nichos de comida usam tags e culinária múltipla sem classificar comércio de outro ramo", () => {
  const h = harness({ locations: {} });
  for (const [niche, tags] of [
    ["Hamburguerias", { name: "Empresa fictícia", amenity: "fast_food", cuisine: "american; Burger " }],
    ["Pizzarias", { name: "Empresa fictícia", amenity: "restaurant", cuisine: "italian; pizza" }],
    ["Sorveterias", { name: "Empresa fictícia", amenity: "ice_cream" }],
    ["Padarias", { name: "Empresa fictícia", shop: "bakery" }],
    ["Confeitarias", { name: "Empresa fictícia", shop: "pastry" }],
    ["Cafeterias", { name: "Empresa fictícia", amenity: "cafe" }],
    ["Lanchonetes", { name: "Empresa fictícia", amenity: "fast_food" }],
    ["Açaiterias", { name: "Empresa fictícia", amenity: "cafe", cuisine: "AÇAÍ" }],
    ["Churrascarias", { name: "Empresa fictícia", amenity: "restaurant", cuisine: "regional;barbecue" }],
    ["Restaurantes", { name: "Empresa fictícia", amenity: "restaurant" }]
  ]) assert.equal(h.businessMatch(tags, niche), true, niche);
  assert.equal(h.businessMatch({ name: "Pizza seguros", office: "insurance", cuisine: "pizza" }, "Pizzarias"), false);
  assert.equal(h.businessMatch({ name: "Burger elétrica", craft: "electrician", cuisine: "burger" }, "Hamburguerias"), false);
  assert.equal(h.businessMatch({ name: "Fechado", amenity: "restaurant", cuisine: "pizza", disused: "yes" }, "Pizzarias"), false);
  assert.equal(h.businessMatch({ name: "Empresa fictícia", amenity: "restaurant", cuisine: "burger_sauce" }, "Hamburguerias"), false);
});

test("Overpass pesquisa culinária com tags conjuntas no mesmo limite administrativo", async () => {
  const city = "Food fixture", p = place("Food fixture", 314875, [-19.4, -18.6, -48.8, -47.9]);
  const e = { type: "node", id: 17, lat: -18.9, lon: -48.3, tags: { name: "Empresa fictícia", amenity: "fast_food", cuisine: "american;burger" } };
  const h = harness({ locations: { [city]: [p] }, answers: [[e]] });
  const result = await h.discover(city, "Hamburguerias");
  assert.equal(h.queries.length, 1);
  assert.ok(h.queries[0].includes('area(3600314875)->.searchArea;'));
  assert.ok(h.queries[0].includes('nwr(area.searchArea)["amenity"~'));
  assert.ok(h.queries[0].includes('["cuisine"~"(^|;)[[:space:]]*(burger|hamburger)[[:space:]]*(;|$)",i]'));
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].matchMethod, "tag");
});

test("Geoapify inclui índices de alimentação na alternativa sem inventar tags", async () => {
  const city = "Food fixture", p = place("Food fixture", 17, [-19, -18, -49, -48]);
  const e = { type: "node", id: 19, lat: -18.5, lon: -48.5, tags: { name: "Pizzaria fictícia", amenity: "restaurant" } };
  const h = harness({ locations: { [city]: [p] }, provider: "geoapify", geoAnswers: [[], [e]] });
  const result = await h.discover(city, "Pizzarias");
  assert.deepEqual(h.geoQueries[0].categories, ["catering.restaurant.pizza", "catering.fast_food.pizza"]);
  assert.deepEqual(h.geoQueries[1].categories, ["catering", "commercial.food_and_drink"]);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].matchMethod, "keyword");
});

test("Geoapify classifica hamburgueria por culinária original, não pela categoria externa", async () => {
  const city = "Food fixture", p = place("Food fixture", 18, [-19, -18, -49, -48]);
  const e = { type: "node", id: 20, lat: -18.5, lon: -48.5, tags: { name: "Empresa fictícia", amenity: "restaurant", cuisine: "pizza;burger" } };
  const h = harness({ locations: { [city]: [p] }, provider: "geoapify", geoAnswers: [[e]] });
  const result = await h.discover(city, "Hamburguerias");
  assert.equal(h.geoQueries.length, 1); assert.equal(result.rows[0].matchMethod, "tag");
  assert.equal(result.rows[0].category, "Hamburguerias");
});

test("menu de nichos inclui dez opções de alimentação e conserva as anteriores", async () => {
  const h = harness({ locations: {} });
  const response = await callAPI(h, "/api/niches");
  const values = JSON.parse(response.body);
  assert.equal(values.length, 24);
  for (const name of ["Barber", "Auto Detailing", "Electrician", "Restaurantes", "Hamburguerias", "Sorveterias", "Pizzarias", "Padarias", "Confeitarias", "Cafeterias", "Lanchonetes", "Açaiterias", "Churrascarias"]) assert.ok(values.includes(name));
  assert.equal(h.geocodes.length, 0); assert.equal(h.queries.length, 0);
});
