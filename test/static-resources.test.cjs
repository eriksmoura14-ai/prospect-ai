"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { gunzipSync, brotliDecompressSync } = require("node:zlib");
const { createResponder } = require("../static-resources.cjs");

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prospect-static-"));
  const script = Buffer.from('const example = "dados públicos";\n'.repeat(10000));
  await fs.writeFile(path.join(root, "app.js"), script);
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><body>Prospect AI</body>");
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "assets/icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  await fs.writeFile(path.join(root, "assets/earth-day.jpg"), Buffer.from([255, 216, 255, 217]));
  const serve = createResponder({ root, ...options });
  const server = http.createServer(async (request, response) => {
    if (!await serve(request, response, new URL(request.url, "http://localhost").pathname)) {
      response.writeHead(404); response.end("outside static allowlist");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const get = (url, headers = {}, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: url, headers, method }, response => {
      const buffers = []; response.on("data", data => buffers.push(data));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(buffers) }));
    });
    req.on("error", reject); req.end();
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  return { root, script, get };
}

test("static files use lossless Brotli/gzip, share validators and reuse content across concurrent requests", async t => {
  const { root, script, get } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => get("/app.js", { "Accept-Encoding": i % 2 ? "gzip" : "br, gzip" })));
  for (const result of results) {
    assert.equal(result.status, 200);
    const br = result.headers["content-encoding"] === "br";
    assert.deepEqual(br ? brotliDecompressSync(result.body) : gunzipSync(result.body), script);
    assert.equal(result.headers["cache-control"], "private, no-cache");
    assert.equal(result.headers.vary, "Accept-Encoding");
    assert.equal(result.headers.etag, results[0].headers.etag);
    assert.equal(Number(result.headers["content-length"]), result.body.length);
  }
  await fs.unlink(path.join(root, "app.js"));
  const cached = await get("/app.js");
  assert.equal(cached.status, 200); assert.deepEqual(cached.body, script);
  const conditional = await get("/app.js", { "If-None-Match": '"other", ' + results[0].headers.etag, "Accept-Encoding": "br" });
  assert.equal(conditional.status, 304); assert.equal(conditional.body.length, 0);
});

test("encoding negotiation never sends explicitly refused encodings", async t => {
  const { get, script } = await fixture(t);
  for (const header of ["br;q=0, gzip;q=0", "gzip;q=0, *;q=0, identity;q=1", "br;q=bad", "gzip;q=0.4"]) {
    const response = await get("/app.js", { "Accept-Encoding": header });
    assert.equal(response.status, 200); assert.equal(response.headers["content-encoding"], undefined);
    assert.deepEqual(response.body, script);
  }
  const gzip = await get("/app.js", { "Accept-Encoding": "br;q=0.2, gzip;q=1, identity;q=0" });
  assert.equal(gzip.headers["content-encoding"], "gzip");
  const refused = await get("/app.js", { "Accept-Encoding": "*;q=0" });
  assert.equal(refused.status, 406); assert.equal(refused.body.length, 0);
});

test("HEAD and revalidation avoid bodies; a new deployment changes the content validator", async t => {
  const { root, get, script } = await fixture(t);
  const initial = await get("/app.js");
  const head = await get("/app.js", {}, "HEAD");
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), script.length);
  const strongMatch = await get("/app.js", { "If-None-Match": initial.headers.etag.slice(2) });
  assert.equal(strongMatch.status, 304);
  await fs.writeFile(path.join(root, "app.js"), "new deployment");
  const replacement = createResponder({ root });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
    writeHead(code) { this.code = code; }, end(body) { this.body = body; } };
  await replacement({ method: "GET", headers: { "if-none-match": initial.headers.etag } }, response, "/app.js");
  assert.equal(response.code, 200); assert.notEqual(response.headers.ETag, initial.headers.etag);
});

test("static allowlist excludes APIs, paths, source files and non-read methods", async t => {
  const { get } = await fixture(t);
  for (const url of ["/api/account", "/api/jobs/fixture", "/api/lists", "/accounts.cjs", "/static-resources.cjs", "/.env", "/../package.json", "/__proto__"]) {
    assert.equal((await get(url)).status, 404);
  }
  assert.equal((await get("/app.js", {}, "POST")).status, 404);
  assert.equal((await get("/earth-loader.js")).status, 503);
});

test("HTML compression retains LocationIQ attribution and images retain their original bytes", async t => {
  const { get } = await fixture(t, { locationIQ: true });
  const page = await get("/", { "Accept-Encoding": "br" });
  assert.equal(page.status, 200); assert.equal(page.headers["cache-control"], "private, no-cache");
  assert.match(brotliDecompressSync(page.body).toString(), /Search by LocationIQ\.com/);
  const image = await get("/assets/earth-day.jpg", { "Accept-Encoding": "br,gzip" });
  assert.equal(image.headers["content-encoding"], undefined);
  assert.deepEqual(image.body, Buffer.from([255, 216, 255, 217]));
  assert.equal(image.headers["cache-control"], "private, max-age=3600");
  assert.equal((await get("/assets/earth-day.jpg", { "Accept-Encoding": "identity;q=0" })).status, 406);
});

test("an existing visible LocationIQ link is retained without duplicate attribution", async t => {
  const { root, get } = await fixture(t, { locationIQ: true });
  const html = '<!doctype html><body><footer><a href="https://locationiq.com">Search by LocationIQ.com</a></footer></body>';
  await fs.writeFile(path.join(root, "index.html"), html);
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.equal(page.body.toString(), html);
});
