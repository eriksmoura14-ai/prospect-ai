"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { build } = require("../scripts/build-frontend.cjs");
const { publicFiles } = require("../static-resources.cjs");
const security = require("../request-security.cjs");
const config = require("../vercel.json");
const root = path.resolve(__dirname, "..");

test("build publica apenas recursos da interface e preserva atribuições e imports da Terra", async () => {
  const output = await build();
  const actual = (await fs.readdir(output, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => path.relative(output, path.join(entry.parentPath, entry.name))).sort();
  const expected = Object.keys(publicFiles).filter(route => route !== "/").map(route => route.slice(1)).sort();
  assert.deepEqual(actual, expected);
  for (const privateFile of ["server.cjs", "agent.cjs", "accounts.cjs", "auth.cjs", "db/schema.sql", "package.json", ".env", "vercel.json", "netlify.toml", "netlify/functions/render-api.mjs"]) {
    await assert.rejects(fs.access(path.join(output, privateFile)));
  }
  const html = await fs.readFile(path.join(output, "index.html"), "utf8");
  assert.match(html, /Search by LocationIQ\.com/);
  assert.match(html, /openstreetmap\.org\/copyright/);
  assert.match(html, /Powered by Geoapify/);
  for (const [, [file]] of Object.entries(publicFiles)) {
    if (file === "index.html") continue;
    const route = Object.keys(publicFiles).find(key => publicFiles[key][0] === file && key !== "/");
    assert.deepEqual(await fs.readFile(path.join(output, route.slice(1))), await fs.readFile(path.join(root, file)));
  }
  assert.match(await fs.readFile(path.join(output, "vendor/three.module.js"), "utf8"), /three\.core\.min\.js/);
});

test("Vercel encaminha API, logout e health ao Render e proíbe cache de dados pessoais", () => {
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "dist");
  assert.equal(config.buildCommand, "npm run build:frontend");
  assert.deepEqual(config.rewrites.map(route => route.source), ["/api/:path*", "/auth/logout", "/health"]);
  for (const route of config.rewrites) assert.equal(new URL(route.destination).origin, "https://prospect-ai-a90q.onrender.com");
  for (const route of ["/api/:path*", "/auth/logout", "/health"]) {
    const headers = Object.fromEntries(config.headers.find(item => item.source === route).headers.map(item => [item.key.toLowerCase(), item.value]));
    assert.match(headers["cache-control"], /no-store/);
    assert.equal(headers["cdn-cache-control"], "no-store");
    assert.equal(headers["vercel-cdn-cache-control"], "no-store");
    assert.equal(headers["x-vercel-enable-rewrite-caching"], "0");
  }
  const backendHeaders = {};
  security.headers({ setHeader(name, value) { backendHeaders[name.toLowerCase()] = value; } }, true);
  const frontendHeaders = Object.fromEntries(config.headers[0].headers.map(item => [item.key.toLowerCase(), item.value]));
  for (const [name, value] of Object.entries(backendHeaders)) assert.equal(frontendHeaders[name], value);
});
