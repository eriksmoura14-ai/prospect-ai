"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { promisify } = require("node:util");
const zlib = require("node:zlib");
const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

// Only public application resources. Account, history and job responses never
// enter this cache; authentication and security headers stay in server.cjs.
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/account-ui.js": ["account-ui.js", "text/javascript; charset=utf-8"],
  "/account.css": ["account.css", "text/css; charset=utf-8"],
  "/prospects-ui.js": ["prospects-ui.js", "text/javascript; charset=utf-8"],
  "/prospects.css": ["prospects.css", "text/css; charset=utf-8"],
  "/privacy.html": ["privacy.html", "text/html; charset=utf-8"],
  "/location-picker.js": ["location-picker.js", "text/javascript; charset=utf-8"],
  "/earth.css": ["earth.css", "text/css; charset=utf-8"],
  "/earth-loader.js": ["earth-loader.js", "text/javascript; charset=utf-8"],
  "/earth-background.js": ["earth-background.js", "text/javascript; charset=utf-8"],
  "/earth-math.js": ["earth-math.js", "text/javascript; charset=utf-8"],
  "/vendor/three.module.js": ["node_modules/three/build/three.module.min.js", "text/javascript; charset=utf-8"],
  "/vendor/three.core.min.js": ["node_modules/three/build/three.core.min.js", "text/javascript; charset=utf-8"],
  "/assets/earth-day.jpg": ["assets/earth-day.jpg", "image/jpeg"],
  "/assets/earth-day-desktop.jpg": ["assets/earth-day-desktop.jpg", "image/jpeg"],
  "/assets/earth-clouds.webp": ["assets/earth-clouds.webp", "image/webp"],
  "/assets/earth-clouds-desktop.webp": ["assets/earth-clouds-desktop.webp", "image/webp"],
  "/assets/earth-specular.jpg": ["assets/earth-specular.jpg", "image/jpeg"],
  "/assets/earth-night.jpg": ["assets/earth-night.jpg", "image/jpeg"],
  "/assets/icon.svg": ["assets/icon.svg", "image/svg+xml"],
  "/vendor/three.LICENSE.txt": ["node_modules/three/LICENSE", "text/plain; charset=utf-8"]
};

function encoding(header) {
  if (!header) return "identity";
  const qualities = new Map();
  for (const item of String(header).toLowerCase().split(",")) {
    const [name, ...parameters] = item.trim().split(";");
    const q = parameters.find(value => value.trim().startsWith("q="));
    const value = q ? Number(q.trim().slice(2)) : 1;
    qualities.set(name, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
  }
  const quality = name => qualities.get(name) ??
    (name === "identity" ? (qualities.get("*") === 0 ? 0 : 1) : qualities.get("*") ?? 0);
  return ["br", "gzip", "identity"].map(name => ({ name, q: quality(name) }))
    .filter(item => item.q > 0).sort((a, b) => b.q - a.q)[0]?.name || null;
}

function unchanged(header, etag) {
  return typeof header === "string" && header.split(",")
    .some(tag => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""));
}

function createResponder({ root, locationIQ = false }) {
  const cache = new Map();
  function load(file, type) {
    if (!cache.has(file)) {
      const pending = (async () => {
        let content = await fs.readFile(path.join(root, file));
        if (file === "index.html" && locationIQ) {
          content = Buffer.from(content.toString("utf8").replace(/<body\b[^>]*>/i, body => body +
            '<div style="padding:10px 24px;text-align:center">' +
            '<a href="https://locationiq.com" target="_blank" ' +
            'rel="noopener noreferrer">Search by LocationIQ.com</a></div>'));
        }
        const compressible = type.startsWith("text/") || type === "image/svg+xml";
        const [br, gz] = compressible ? await Promise.all([
          brotli(content, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }),
          gzip(content)
        ]) : [];
        return { content, br, gzip: gz, etag: 'W/"' + createHash("sha256").update(content).digest("hex") + '"' };
      })().catch(error => { cache.delete(file); throw error; });
      cache.set(file, pending);
    }
    return cache.get(file);
  }

  return async function serve(request, response, pathname) {
    if (!["GET", "HEAD"].includes(request.method) || !Object.hasOwn(files, pathname)) return false;
    const [file, type] = files[pathname];
    let asset;
    try { asset = await load(file, type); }
    catch {
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: `O arquivo ${file} ainda não foi adicionado ao projeto.` }));
      return true;
    }
    // JPEG/WebP are already compressed. Respect an explicit identity refusal.
    const selected = asset.br ? encoding(request.headers["accept-encoding"])
      : encoding(request.headers["accept-encoding"] ? request.headers["accept-encoding"] + ",br;q=0,gzip;q=0" : "");
    if (!selected) {
      response.writeHead(406, { "Cache-Control": "no-store", Vary: "Accept-Encoding" });
      response.end(); return true;
    }
    const body = selected === "identity" ? asset.content : asset[selected];
    response.setHeader("Content-Type", type);
    response.setHeader("Cache-Control", type.startsWith("image/") ? "private, max-age=3600" : "private, no-cache");
    response.setHeader("ETag", asset.etag);
    response.setHeader("Vary", "Accept-Encoding");
    if (selected !== "identity") response.setHeader("Content-Encoding", selected);
    if (unchanged(request.headers["if-none-match"], asset.etag)) {
      response.writeHead(304); response.end(); return true;
    }
    response.setHeader("Content-Length", body.length);
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  };
}

module.exports = { createResponder };
