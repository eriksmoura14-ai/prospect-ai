"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { query, endpointLabel } = require("../overpass.cjs");

// Serviços LOCAIS controlados: validam falhas de transporte e protocolo.
// Não são evidência de disponibilidade/velocidade do Overpass em produção.
async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/api/interpreter`;
}

test("POST envia a consulta inteira e registra conexão/headers/bytes", async t => {
  const ql = '[out:json][timeout:45];area(3600123456)->.searchArea;(nwr(area.searchArea)["craft"="cleaning"]["name"];);out body center;';
  const endpoint = await serve(t, async (req, res) => {
    assert.equal(req.method, "POST");
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(new URLSearchParams(body).get("data"), ql);
    res.end(JSON.stringify({ elements: [{ type: "node", id: 12 }] }));
  });
  let trace;
  const answer = await query(endpoint, ql, { onTrace: value => { trace = value; } });
  assert.equal(answer.elements.length, 1);
  assert.equal(trace.outcome, "success");
  assert.equal(trace.phase, "complete");
  assert.ok(trace.connectedMs >= 0);
  assert.ok(trace.headersMs >= trace.connectedMs);
  assert.ok(trace.bytes > 0);
});

test("lista vazia válida é empty", async t => {
  const endpoint = await serve(t, (_req, res) => res.end('{"elements":[]}'));
  let trace;
  assert.deepEqual(await query(endpoint, "query", { onTrace: value => { trace = value; } }), { elements: [] });
  assert.equal(trace.outcome, "empty");
});

for (const [remark, code] of [
  ["runtime error: Query timed out in query at line 4 after 45 seconds.", "query_timeout"],
  ["runtime error: Query run out of memory", "query_incomplete"]
]) test(`remark rejeita resultados parciais: ${code}`, async t => {
  const endpoint = await serve(t, (_req, res) => res.end(JSON.stringify({ remark, elements: [{ id: 1 }] })));
  await assert.rejects(query(endpoint, "query"), error => error.code === code && error.diagnostics.remark === remark);
});

for (const status of [429, 502, 504]) test(`HTTP ${status} é falha, sem repetição`, async t => {
  let calls = 0;
  const endpoint = await serve(t, (_req, res) => { calls++; res.writeHead(status); res.end("not JSON"); });
  await assert.rejects(query(endpoint, "query"), error => error.code === "http_error" && error.diagnostics.httpStatus === status);
  assert.equal(calls, 1);
});

test("headers ausentes após conexão não são classificados como execução comprovadamente lenta", async t => {
  let calls = 0;
  const endpoint = await serve(t, () => { calls++; });
  await assert.rejects(query(endpoint, "query", { limits: { connectionMs: 500, requestMs: 80 } }), error =>
    error.code === "response_timeout" && error.diagnostics.phase === "awaiting_headers" &&
    error.diagnostics.connectedMs != null && /fila ou consulta lenta/.test(error.message));
  assert.equal(calls, 1);
});

test("transferência lenta distingue reading_body", async t => {
  const endpoint = await serve(t, (_req, res) => { res.writeHead(200); res.write('{"elements":['); });
  await assert.rejects(query(endpoint, "query", { limits: { connectionMs: 500, requestMs: 80 } }), error =>
    error.code === "response_timeout" && error.diagnostics.phase === "reading_body" && error.diagnostics.bytes > 0);
});

test("TCP conectado com handshake TLS pendente é connection_timeout", async t => {
  const sockets = new Set();
  const server = net.createServer(socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  await assert.rejects(query(`https://127.0.0.1:${server.address().port}/api/interpreter`, "query",
    { limits: { connectionMs: 80, requestMs: 500 } }), error =>
    error.code === "connection_timeout" && error.diagnostics.tcpMs != null && error.diagnostics.connectedMs == null);
});

test("conexão recusada registra código e não simula resposta vazia", async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(query(`http://127.0.0.1:${port}/`, "query"), error =>
    error.code === "connection_error" && error.diagnostics.networkCode === "ECONNREFUSED");
});

for (const [body, code] of [["<html>gateway</html>", "invalid_json"], ['{"ok":true}', "invalid_response"]]) {
  test(`resposta inválida: ${code}`, async t => {
    const endpoint = await serve(t, (_req, res) => res.end(body));
    await assert.rejects(query(endpoint, "query"), error => error.code === code);
  });
}

test("limite de bytes rejeita resposta e encerra conexão", async t => {
  const endpoint = await serve(t, (_req, res) => res.end('{"elements":[]}'));
  await assert.rejects(query(endpoint, "query", { limits: { responseBytes: 5 } }), error => error.code === "response_too_large");
});

test("diagnóstico não inclui usuário, senha nem parâmetros de URL", () => {
  assert.equal(endpointLabel("https://user:password@example.com/api/interpreter?key=secret"), "https://example.com/api/interpreter");
});

test("GET transmite a QL completa sem body e registra família IP real", async t => {
  const ql = '[out:json];nwr(-34,150,-33,151)["name"~"Barber|東京",i];out body center;';
  const endpoint = await serve(t, async (req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(new URL(req.url, "http://local.test").searchParams.get("data"), ql);
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(body, "");
    assert.equal(req.headers["content-length"], undefined);
    res.end('{"elements":[]}');
  });
  let trace;
  await query(endpoint, ql, { method: "GET", family: 4, onTrace: value => { trace = value; } });
  assert.equal(trace.httpMethod, "GET");
  assert.equal(trace.ipFamily, 4);
  assert.equal(trace.remoteFamily, "IPv4");
  assert.equal(trace.remoteAddress, "127.0.0.1");
  assert.ok(!trace.endpoint.includes("data="));
});

test("método e família inválidos falham antes de contato externo", async () => {
  await assert.rejects(query("http://127.0.0.1:1/", "query", { method: "DELETE" }), e => e.code === "configuration");
  await assert.rejects(query("http://127.0.0.1:1/", "query", { family: 3 }), e => e.code === "configuration");
});

test("chave nunca é transmitida em HTTP ou com quebra de linha", async () => {
  for (const [endpoint, apiKey] of [["http://127.0.0.1:1/", "fixture-key"],
    ["https://127.0.0.1:1/", "fixture\r\nX-Test: x"]]) {
    let trace;
    await assert.rejects(query(endpoint, "query", { apiKey, onTrace: value => { trace = value; } }),
      error => error.code === "configuration");
    assert.ok(!JSON.stringify(trace).includes(apiKey));
    assert.equal(trace.tcpMs, undefined);
  }
});

test("Bearer é colocado no cabeçalho HTTPS e não no diagnóstico (mock controlado)", async t => {
  const https = require("node:https");
  const { EventEmitter } = require("node:events");
  let headers;
  let destination;
  t.mock.method(https, "request", (url, options, callback) => {
    destination = url.href;
    headers = options.headers;
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.destroy = () => {};
      callback(response);
      response.emit("data", Buffer.from(JSON.stringify({ elements: [], remark: "error reflects fixture-key" })));
      response.emit("end");
    });
    return request;
  });
  let trace;
  await assert.rejects(query("https://primary.example/api/interpreter", "query", {
    apiKey: "fixture-key", onTrace: value => { trace = value; }
  }), error => error.code === "query_incomplete");
  assert.equal(headers.Authorization, "Bearer fixture-key");
  assert.ok(!destination.includes("fixture-key"));
  assert.ok(!JSON.stringify(trace).includes("fixture-key"));
  assert.ok(trace.remark.includes("[redacted]"));
});
