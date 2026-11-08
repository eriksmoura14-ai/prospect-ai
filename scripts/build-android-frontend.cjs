"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { build } = require("./build-frontend.cjs");
const { publicFiles } = require("../static-resources.cjs");

async function bundle(root = path.resolve(__dirname, "..")) {
  const dist = await build(root);
  const assets = path.join(root, "android/app/src/main/assets");
  const output = path.join(assets, "web");
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true });
  const routes = {};
  for (const [route, [source, type]] of Object.entries(publicFiles)) {
    const file = source === "index.html" ? "index.html" : route.slice(1);
    if (route.startsWith("/api/") || file.includes("..") || /(^|\/)\.env/.test(file)) throw new Error("Private Android asset rejected");
    const content = await fs.readFile(path.join(dist, file));
    const destination = path.join(output, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
    routes[route] = { file, mime: type.split(";")[0], sha256: createHash("sha256").update(content).digest("hex") };
  }
  await fs.writeFile(path.join(assets, "web-manifest.json"), JSON.stringify({ version: 1, routes }, null, 2));
  console.log(`Android: ${Object.keys(routes).length} public routes bundled; API requests remain online.`);
  return routes;
}
if (require.main === module) bundle().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { bundle };
