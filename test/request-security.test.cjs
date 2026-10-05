"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const security = require("../request-security.cjs");

test("orçamentos agregados independem de cookies/IP e voltam a admitir após espera", () => {
  let now = 0;
  const gate = security.createGate({ clock: () => now });
  for (let i = 0; i < 30; i++) gate.enter("/api/auth/login", "POST")();
  assert.throws(() => gate.enter("/api/auth/login", "POST"), error => error.status === 429 && error.retryAfter === 1);
  gate.enter("/api/account", "GET")(); // Separate budget for anonymous CSRF renewal.
  now = 500;
  gate.enter("/api/auth/reset", "POST")();
  assert.throws(() => gate.enter("/api/auth/register", "POST"), { status: 429 });
  now += 40000;
  for (let i = 0; i < 30; i++) gate.enter("/api/auth/login", "POST")();
  assert.throws(() => gate.enter("/api/auth/login", "POST"), { status: 429 });
});

test("limite concorrente protege antes do banco e liberação não ocorre duas vezes", () => {
  const gate = security.createGate({ maximumActive: 2 });
  const a = gate.enter("/api/jobs/first", "GET"), b = gate.enter("/api/history", "GET");
  assert.throws(() => gate.enter("/api/lists", "GET"), { status: 429 });
  gate.enter("/index.html", "GET")();
  a(); a();
  const c = gate.enter("/api/lists", "GET");
  assert.throws(() => gate.enter("/api/history", "GET"), { status: 429 });
  b(); c();
  gate.enter("/auth/logout", "POST")();
});

test("parser rejeita tipos, tamanhos e uploads lentos em conexões HTTP reais", async t => {
  let parsed = 0;
  const server = http.createServer(async (request, response) => {
    security.headers(response, true);
    try {
      const body = await security.readJSON(request, 64, { timeoutMs: 120 });
      parsed++;
      response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(body));
    } catch (error) {
      if (error.closeRequest) response.setHeader("Connection", "close");
      response.writeHead(error.status || 500); response.end(error.message);
    }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  function call({ headers = {}, chunks = [], end = true } = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: "127.0.0.1", port: server.address().port, method: "POST", headers }, response => {
        const body = []; response.on("data", chunk => body.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(body).toString() }));
      });
      request.on("error", reject); request.setTimeout(2000, () => request.destroy(new Error("Test HTTP deadline")));
      for (const chunk of chunks) request.write(chunk);
      if (end) request.end();
      else request.flushHeaders();
    });
  }
  const json = { "content-type": "application/json; charset=utf-8" };
  const normal = await call({ headers: json, chunks: ['{"value":"ação"}'] });
  assert.equal(normal.status, 200); assert.equal(JSON.parse(normal.body).value, "ação");
  assert.match(normal.headers["content-security-policy"], /form-action 'self'/);
  assert.match(normal.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(normal.headers["cross-origin-resource-policy"], "same-origin");
  assert.equal(normal.headers["strict-transport-security"], "max-age=31536000");
  assert.equal((await call({ headers: { "content-type": "text/plain" }, chunks: ["{}"] })).status, 415);
  assert.equal((await call({ headers: { ...json, "content-encoding": "gzip" }, chunks: ["{}"] })).status, 415);
  const declared = await call({ headers: { ...json, "content-length": "10000" }, end: false });
  assert.equal(declared.status, 413); assert.equal(declared.headers.connection, "close");
  const chunked = await call({ headers: json, chunks: ["x".repeat(65)], end: false });
  assert.equal(chunked.status, 413); assert.equal(chunked.headers.connection, "close");
  const slow = await call({ headers: json, chunks: ["{"], end: false });
  assert.equal(slow.status, 408); assert.equal(slow.headers.connection, "close");
  for (const body of ["null", "[]", "42", '"secret-test-string"', '{"private":"invalid-secret"']) {
    const invalid = await call({ headers: json, chunks: [body] });
    assert.equal(invalid.status, 400); assert.ok(!invalid.body.includes("secret"));
  }
  assert.equal(parsed, 1);
});
