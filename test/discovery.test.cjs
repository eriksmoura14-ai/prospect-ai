"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Fixtures de regressão, não resultados reais de empresas/geocodificação.
// Exercitam a descoberta sem contatos externos, contas ou chaves de produção.
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
const localRequire = createRequire(path.join(root, "server.cjs"));

function place(name, osmId, bounds, osmType = "relation") {
  return { name, display_name: name, category: "place", type: "city",
    osm_type: osmType, osm_id: osmId, boundingbox: bounds.map(String) };
}

function harness({ locations, answers = [], failure } = {}) {
  const queries = [];
  const geocodes = [];
  const fixtureFS = { ...fs,
    readFileSync: () => { throw new Error("Sem cache persistente nos testes."); },
    mkdirSync() {}, writeFileSync() {}, renameSync() {} };
  const query = async (_endpoint, ql, options) => {
    queries.push(ql);
    options?.onTrace?.({ query: ql, phase: "complete", outcome: failure ? failure.code : "success" });
    if (failure) throw failure;
    return { elements: answers[queries.length - 1] || [] };
  };
  const context = {
    require: name => name === "node:fs" ? fixtureFS
      : name === "./overpass.cjs" ? { ...localRequire(name), query } : localRequire(name),
    module: { exports: {} }, __dirname: root,
    process: { env: { APP_PASSWORD: "local-only-test-password", APP_ORIGIN: "http://127.0.0.1:3000" } },
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
      return new Response(JSON.stringify(locations[city] || []));
    }
  };
  const code = source;
  vm.runInNewContext(code.slice(0, code.lastIndexOf("server.listen(")) + `
    module.exports = { discover, locate, businessMatch,
      handler: server.listeners("request")[0], resetGeocode: () => { lastGeocode = 0; } };
  `, context, { filename: path.join(root, "server.cjs") });
  return { ...context.module.exports, queries, geocodes };
}

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
