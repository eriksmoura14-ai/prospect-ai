"use strict";
// Local HTTP regression tests; DNS/outbound pages are controlled fixtures.
// They do not scan external hosts or use customer accounts.
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const http = require("node:http"), https = require("node:https"), crypto = require("node:crypto");
const { createRequire } = require("node:module"), { Readable } = require("node:stream");
const { EventEmitter, once } = require("node:events");
const root = path.resolve(__dirname, ".."), localRequire = createRequire(path.join(root, "server.cjs"));

function harness({ service, records = {}, pages = {} } = {}) {
  const outbound = [];
  const get = (url, options, callback) => {
    outbound.push({ url, options });
    const request = new EventEmitter(); request.destroy = () => {};
    queueMicrotask(() => {
      const page = pages[url.href] || { status: 200, html: "<title>Public site</title>" };
      const response = Readable.from([page.html || ""]);
      response.statusCode = page.status;
      response.headers = { "content-type": "text/html", ...(page.location ? { location: page.location } : {}) };
      callback(response);
    });
    return request;
  };
  class Resolver { async resolve4(host) { return records[host] || ["93.184.215.14"]; } }
  const fixtureFS = { ...fs, readFileSync: () => { throw new Error("No persistent discovery cache in fixtures"); }, mkdirSync() {}, writeFileSync() {}, renameSync() {} };
  const context = {
    require: name => name === "node:http" ? { ...http, get }
      : name === "node:https" ? { ...https, get }
      : name === "node:dns" ? { promises: { Resolver } }
      : name === "node:fs" ? fixtureFS
      : name === "./hosting.cjs" ? { configuration: () => ({ hosted: true, origin: "https://app.example", port: 0, bind: "127.0.0.1" }) }
      : name === "./auth.cjs" ? { configuration: () => ({ mode: "password" }), createService: () => service || { ready: async () => {}, identity: async () => null, account: () => ({ cookies: [], data: { authenticated: false } }) } }
      : localRequire(name),
    module: { exports: {} }, __dirname: root, process: { env: {} },
    console: { log() {}, warn() {}, error() {} }, Buffer, URL, URLSearchParams, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch
  };
  const source = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
  vm.runInNewContext(source.slice(0, source.lastIndexOf("server.listen(")) +
    "\nmodule.exports={server,publicIPv4,resolveHost,pageRequestUncached,analyze};", context);
  return { ...context.module.exports, outbound };
}

async function listening(t, options) {
  const h = harness(options); h.server.listen(0, "127.0.0.1"); await once(h.server, "listening");
  t.after(() => new Promise(resolve => { h.server.closeAllConnections(); h.server.close(resolve); }));
  h.call = (url, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port: h.server.address().port, path: url, method,
      headers: { host: "app.example", ...headers } }, response => {
      const chunks = []; response.on("data", value => chunks.push(value));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject); request.setTimeout(3000, () => request.destroy(new Error("Test deadline"))); request.end(body);
  });
  return h;
}

test("cookies e X-Forwarded-For diferentes não contornam o limite antes da sessão", async t => {
  let checked = 0;
  const h = await listening(t, { service: { identity: async () => { checked++; return null; }, checkMutation: () => false,
    account: () => ({ cookies: [], data: { authenticated: false } }) } });
  for (let i = 0; i < 30; i++) {
    const result = await h.call("/api/auth/login", { method: "POST", headers: {
      cookie: "prospect_challenge=" + crypto.randomBytes(32).toString("base64url"), "x-forwarded-for": "8.8.8." + i } });
    assert.equal(result.status, 403);
  }
  const excess = await h.call("/api/auth/login", { method: "POST" });
  assert.equal(excess.status, 429); assert.equal(checked, 30);
  assert.equal(excess.headers["retry-after"], "1"); assert.equal(excess.headers["cache-control"], "no-store");
  assert.match(excess.headers["content-security-policy"], /script-src-attr 'none'/);
  assert.equal((await h.call("/api/account")).status, 200);
});

test("32 solicitações pendentes limitam a fila antes do banco e liberam vagas ao terminar", async t => {
  let checked = 0, unblock, allEntered;
  const held = new Promise(resolve => { unblock = resolve; });
  const entered = new Promise(resolve => { allEntered = resolve; });
  const h = await listening(t, { service: { identity: async () => { if (++checked === 32) allEntered(); await held; return null; } } });
  const waiting = Array.from({ length: 32 }, () => h.call("/api/history"));
  await entered;
  assert.equal((await h.call("/api/history")).status, 429); assert.equal(checked, 32);
  unblock();
  assert.ok((await Promise.all(waiting)).every(result => result.status === 401));
  assert.equal((await h.call("/api/history")).status, 401); assert.equal(checked, 33);
});

test("servidor aplica o parser e protege respostas de erro, scripts e arquivos privados", async t => {
  let attempts = 0;
  const h = await listening(t, { service: { identity: async () => null, checkMutation: () => true,
    login: async () => { attempts++; return { cookies: [] }; } } });
  assert.equal((await h.call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(4097) })).status, 413);
  assert.equal((await h.call("/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal(attempts, 0);
  for (const url of ["/server.cjs", "/auth.cjs", "/db/schema.sql", "/.env", "/.cache/data.json"]) {
    const result = await h.call(url); assert.equal(result.status, 404);
    assert.equal(result.headers["x-frame-options"], "DENY");
    assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
  }
  const huge = await h.call("/api/history", { headers: { "x-fixture": "x".repeat(17000) } });
  assert.equal(huge.status, 431);
  const normal = await h.call("/app.js"); assert.equal(normal.status, 200);
  assert.match(normal.headers["content-security-policy"], /form-action 'self'/);
});

test("verificador bloqueia rede privada, metadata, DNS misto e redirecionamento interno", async () => {
  const h = harness({ records: { "mixed.example": ["93.184.215.14", "10.0.0.2"], "internal.example": ["172.16.0.2"],
    "169.254.169.254": ["169.254.169.254"] }, pages: { "https://public.example/": { status: 302, location: "http://internal.example/" } } });
  for (const ip of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1"]) assert.equal(h.publicIPv4(ip), false, ip);
  for (const url of ["http://169.254.169.254/latest/meta-data/", "https://mixed.example/", "http://user:pass@public.example/", "http://public.example:8080/", "file:///etc/passwd"]) {
    await assert.rejects(h.pageRequestUncached(url, Date.now() + 3000));
  }
  assert.equal(h.outbound.length, 0);
  await assert.rejects(h.pageRequestUncached("https://public.example/", Date.now() + 3000), /destino bloqueado/);
  assert.equal(h.outbound.length, 1); assert.equal(h.outbound[0].url.hostname, "public.example");
  assert.equal(h.outbound[0].options.family, 4);
  const pinned = await new Promise((resolve, reject) => h.outbound[0].options.lookup("public.example", {}, (error, ip, family) => error ? reject(error) : resolve({ ip, family })));
  assert.deepEqual(pinned, { ip: "93.184.215.14", family: 4 });
});

test("limite do título exibido mantém a correspondência comercial após 400 caracteres", () => {
  const h = harness(), business = { name: "Empresa Central", city: "São Paulo", phone: "+55 11 1234-5678", street: "Rua Central", houseNumber: "123" };
  const page = { status: 200, html: "<title>" + "x".repeat(600) + " Empresa Central</title><p>São Paulo, Rua Central 123, +55 (11) 1234-5678</p>" };
  const result = h.analyze(page, business);
  assert.equal(result.compatible, true); assert.equal(result.nameMatch, true); assert.equal(result.phoneMatch, true);
  assert.equal(result.cityMatch, true); assert.equal(result.addressMatch, true); assert.equal(result.title.length, 400);
  assert.equal(h.analyze({ ...page, html: page.html + "<p>domain for sale</p>" }, business).compatible, false);
});
