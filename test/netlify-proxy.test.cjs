"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const http = require("node:http"), { once } = require("node:events");
const load = () => import("../netlify/functions/render-api.mjs");
const site = { site: { url: "https://prospect.netlify.app" } };

test("Netlify proxy preserves query, method, CSRF and individual cookies without trusting forwarded hosts", async () => {
  const { createProxy } = await load(); let sent;
  const proxy = createProxy({ fetcher: async (url, options) => {
    sent = { url, options };
    const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "public, max-age=900", "Content-Encoding": "gzip" });
    headers.append("Set-Cookie", "__Host-prospect_session=fixture; Path=/; Secure; HttpOnly; SameSite=Lax");
    headers.append("Set-Cookie", "__Host-prospect_challenge=; Path=/; Secure; HttpOnly; Max-Age=0");
    return new Response('{"ok":true}', { headers });
  } });
  const input = new Request("https://prospect.netlify.app/api/account/preferences?name=a&name=b", { method: "PATCH", body: '{"seller":"example"}',
    headers: { "content-type": "application/json", origin: site.site.url, cookie: "sid=fixture", "x-csrf-token": "fixture-csrf",
      "sec-fetch-site": "same-origin", "x-forwarded-host": "evil.example", "x-forwarded-for": "8.8.8.8" } });
  const response = await proxy(input, site);
  assert.equal(sent.url.href, "https://prospect-ai-a90q.onrender.com/api/account/preferences?name=a&name=b");
  assert.equal(sent.options.method, "PATCH"); assert.equal(sent.options.body.toString(), '{"seller":"example"}');
  for (const header of ["origin", "cookie", "x-csrf-token", "sec-fetch-site"]) assert.equal(sent.options.headers.get(header), input.headers.get(header));
  assert.equal(sent.options.headers.get("x-forwarded-host"), null); assert.equal(sent.options.headers.get("x-forwarded-for"), null);
  assert.equal(sent.options.redirect, "manual");
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal(await response.text(), '{"ok":true}');
});

test("Netlify proxy rejects preview origins, invalid routes, oversized bodies and redirects before leaking cookies", async () => {
  const { createProxy } = await load(); let calls = 0;
  const proxy = createProxy({ fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: "https://evil.example" } }); } });
  assert.equal((await proxy(new Request("https://preview.netlify.app/api/account"), site)).status, 403);
  assert.equal((await proxy(new Request("http://prospect.netlify.app/api/account"), site)).status, 403);
  for (const path of ["/server.cjs", "/api/../server.cjs", "/.netlify/functions/render-api", "/api/../../auth.cjs"]) {
    const result = await proxy(new Request(site.site.url + path), site); assert.ok([403, 404].includes(result.status));
  }
  assert.equal((await proxy(new Request(site.site.url + "/api/account", { method: "OPTIONS" }), site)).status, 405);
  assert.equal((await proxy(new Request(site.site.url + "/api/auth/login", { method: "POST", body: "x".repeat(32769) }), site)).status, 413);
  assert.equal((await proxy(new Request(site.site.url + "/api/auth/login", { method: "POST", body: "{}", headers: { "content-length": "99999" } }), site)).status, 413);
  assert.equal(calls, 0);
  const redirect = await proxy(new Request(site.site.url + "/api/account", { headers: { cookie: "sid=fixture" } }), site);
  assert.equal(redirect.status, 502); assert.equal(redirect.headers.get("location"), null); assert.equal(calls, 1);
});

test("Netlify proxy distinguishes connection failure, timeout and upstream error without automatic retries", async () => {
  const { createProxy } = await load();
  for (const [name, status] of [["TypeError", 502], ["TimeoutError", 504]]) {
    let calls = 0;
    const proxy = createProxy({ fetcher: async () => { calls++; throw Object.assign(new Error("Sensitive connection detail"), { name }); } });
    const response = await proxy(new Request(site.site.url + "/api/search", { method: "POST", body: "{}" }), site);
    assert.equal(response.status, status); assert.equal(calls, 1);
    assert.ok(!(await response.text()).includes("Sensitive"));
    assert.equal(response.headers.getSetCookie().length, 0);
  }
  const proxy = createProxy({ fetcher: async () => new Response('{"error":"Entre na sua conta"}', { status: 401, headers: { "Content-Type": "application/json" } }) });
  const result = await proxy(new Request(site.site.url + "/api/history"), site);
  assert.equal(result.status, 401); assert.deepEqual(await result.json(), { error: "Entre na sua conta" });
});

test("Netlify proxy handles a real local HTTP deadline and streams responses beyond the buffered Lambda ceiling", async t => {
  const { createProxy } = await load();
  const large = "x".repeat(7 * 1024 * 1024);
  const upstream = http.createServer((req, res) => {
    if (req.url === "/api/slow") return;
    res.writeHead(200, { "Content-Type": "text/plain" }); res.end(large);
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const backend = `http://127.0.0.1:${upstream.address().port}`;
  const timed = createProxy({ backend, requestMs: 40 });
  const response = await timed(new Request(site.site.url + "/api/slow"), site);
  assert.equal(response.status, 504);
  const streaming = createProxy({ backend });
  const result = await streaming(new Request(site.site.url + "/api/large"), site);
  assert.equal(result.status, 200); assert.equal(await result.text(), large);
});

test("Netlify routes use a streaming Node function, leaving business processing on Render", async () => {
  const { config, LIMITS } = await load();
  assert.deepEqual(config.path, ["/api/*", "/auth/logout", "/health"]);
  assert.equal(LIMITS.requestMs, 55000); assert.equal(LIMITS.requestBytes, 32768);
  // Configuration parses with the same TOML parser used by Netlify CLI in the
  // separate offline build. Public output verification lives in frontend-build.
});
