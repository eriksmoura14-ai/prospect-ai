"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient, PROBE_QUERY } = require("../overpass.cjs");
const http = require("node:http");

// Testes unitários controlados do fluxo de recuperação. Não provam acesso remoto.
const primary = "https://primary.example/api/interpreter";
const fallback = "https://fallback.example/api/interpreter";
const ql = '[out:json][timeout:45];area(3600314875)->.a;(nwr(area.a)["shop"="barber"]["name"];);out body center;';
const timeout = () => Object.assign(new Error("Timeout controlado"), {
  code: "response_timeout", diagnostics: { phase: "awaiting_headers" }
});

test("probe sem headers usa alternativa; mesma QL e nenhuma consulta pesada no primário", async () => {
  const calls = [];
  const traces = [];
  const client = createClient({ endpoints: [primary, fallback], request: async (url, query, options) => {
    calls.push({ url, query, limits: options.limits });
    options.onTrace({ phase: "awaiting_headers", endpoint: url });
    if (url === primary) throw timeout();
    return { elements: query === PROBE_QUERY ? [{ type: "count" }] : [{ id: 25 }] };
  } });
  const result = await client.execute(ql, { onTrace: trace => traces.push(trace) });
  assert.equal(result.elements[0].id, 25);
  assert.deepEqual(calls.map(x => [x.url, x.query]), [[primary, PROBE_QUERY], [fallback, PROBE_QUERY], [fallback, ql]]);
  assert.equal(calls[0].limits.requestMs, 10000);
  assert.ok(traces.some(x => x.purpose === "probe"));
  assert.ok(traces.some(x => x.purpose === "businesses"));
});

test("consulta pesada sem headers também usa exatamente a mesma QL na alternativa", async () => {
  const calls = [];
  const client = createClient({ endpoints: [primary, fallback], request: async (url, query) => {
    calls.push([url, query]);
    if (url === primary && query === ql) throw timeout();
    return { elements: [] };
  } });
  await client.execute(ql);
  assert.deepEqual(calls, [[primary, PROBE_QUERY], [primary, ql], [fallback, PROBE_QUERY], [fallback, ql]]);
});

test("resposta vazia válida não troca endpoint", async () => {
  const calls = [];
  const client = createClient({ endpoints: [primary, fallback], request: async (url, query) => {
    calls.push([url, query]);
    return { elements: [] };
  } });
  assert.deepEqual(await client.execute(ql), { elements: [] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(x => x[0] === primary));
});

test("sem alternativa configurada, indisponibilidade é erro e nunca lista vazia", async () => {
  const client = createClient({ endpoints: [primary], request: async () => { throw timeout(); } });
  await assert.rejects(client.execute(ql), error => error.code === "overpass_unavailable" && error.diagnostics.attempts.length === 1);
});

test("cooldown evita repetir o primário indisponível e expira após um minuto", async () => {
  let time = 1000;
  const calls = [];
  const client = createClient({ endpoints: [primary, fallback], now: () => time, request: async (url, query) => {
    calls.push([url, query]);
    if (url === primary) throw timeout();
    return { elements: [] };
  } });
  await client.execute(ql);
  await client.execute(ql);
  assert.equal(calls.filter(x => x[0] === primary).length, 1);
  assert.equal(calls.filter(x => x[0] === fallback && x[1] === PROBE_QUERY).length, 1);
  time += 60001;
  await client.execute(ql);
  assert.equal(calls.filter(x => x[0] === primary).length, 2);
});

for (const status of [401, 403, 429]) test(`HTTP ${status} não é contornado por outra instância`, async () => {
  const calls = [];
  const error = Object.assign(new Error("HTTP controlado"), { code: "http_error", diagnostics: { httpStatus: status } });
  const client = createClient({ endpoints: [primary, fallback], request: async url => { calls.push(url); throw error; } });
  await assert.rejects(client.execute(ql), e => e === error);
  assert.deepEqual(calls, [primary]);
});

for (const [code, phase] of [["query_timeout", "complete"], ["query_incomplete", "complete"],
  ["response_timeout", "reading_body"], ["invalid_json", "reading_body"]]) {
  test(`${code}/${phase} não dispara nova consulta pesada`, async () => {
    const calls = [];
    const error = Object.assign(new Error("Falha controlada"), { code, diagnostics: { phase } });
    const client = createClient({ endpoints: [primary, fallback], request: async (url, query) => {
      calls.push([url, query]);
      if (query === PROBE_QUERY) return { elements: [] };
      throw error;
    } });
    await assert.rejects(client.execute(ql), e => e === error);
    assert.deepEqual(calls, [[primary, PROBE_QUERY], [primary, ql]]);
  });
}

for (const status of [502, 503, 504]) test(`HTTP ${status} permite alternativa configurada`, async () => {
  const client = createClient({ endpoints: [primary, fallback], request: async (url, query) => {
    if (url === primary) throw Object.assign(new Error("Gateway controlado"), { code: "http_error", diagnostics: { httpStatus: status } });
    return { elements: query === PROBE_QUERY ? [] : [{ id: 25 }] };
  } });
  assert.equal((await client.execute(ql)).elements[0].id, 25);
});

test("endpoints duplicados são removidos e URLs com credenciais são rejeitadas", () => {
  assert.equal(createClient({ endpoints: [primary, primary] }).endpoints.length, 1);
  assert.throws(() => createClient({ endpoints: ["https://user:secret@primary.example/api/interpreter"] }));
  assert.throws(() => createClient({ endpoints: [primary + "?key=secret"] }));
});

test("recuperação completa com sockets locais reais após HTTP 503", async t => {
  const received = [];
  async function start(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    return `http://127.0.0.1:${server.address().port}/api/interpreter`;
  }
  const first = await start((_req, res) => { res.writeHead(503); res.end(); });
  const second = await start(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const query = new URLSearchParams(body).get("data");
    received.push(query);
    res.end(JSON.stringify({ elements: query === PROBE_QUERY ? [{ type: "count" }] : [{ type: "node", id: 25 }] }));
  });
  const client = createClient({ endpoints: [first, second] });
  const result = await client.execute(ql);
  assert.equal(result.elements[0].id, 25);
  assert.deepEqual(received, [PROBE_QUERY, ql]);
});

test("método e família configurados são iguais em probe e consulta em cada endpoint", async () => {
  const calls = [];
  const client = createClient({ endpoints: [primary, fallback], method: "GET", family: 4,
    request: async (url, query, options) => {
      calls.push({ url, query, method: options.method, family: options.family });
      if (url === primary) throw timeout();
      return { elements: [] };
    } });
  await client.execute(ql);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(item => item.method === "GET" && item.family === 4));
  assert.equal(calls.at(-1).query, ql);
  assert.throws(() => createClient({ endpoints: [primary], method: "DELETE" }));
  assert.throws(() => createClient({ endpoints: [primary], family: 5 }));
});
