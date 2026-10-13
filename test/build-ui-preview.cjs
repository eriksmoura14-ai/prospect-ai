"use strict";
// Explicit preview-only build. The normal frontend build never ships fixtures.
const fs = require("node:fs/promises"), path = require("node:path");
const { build } = require("../scripts/build-frontend.cjs");
(async () => {
  const root = path.resolve(__dirname, ".."); await build(root);
  const html = (await fs.readFile(path.join(root, "index.html"), "utf8"))
    .replace('<script src="/location-picker.js" defer>', '<script src="/qa-preview.js" defer></script>\n<script src="/location-picker.js" defer>');
  await fs.writeFile(path.join(root, "dist/qa-preview.html"), html);
  await fs.copyFile(path.join(__dirname, "ui-preview-fixture.js"), path.join(root, "dist/qa-preview.js"));
  await fs.writeFile(path.join(root, "dist/qa-mobile.html"), '<!doctype html><meta charset="utf-8"><title>Prospect · teste de 390 px</title><style>body{margin:0;background:#080611;display:flex;justify-content:center}iframe{width:390px;height:844px;border:0}</style><iframe title="Prospect AI, tela móvel de demonstração" src="qa-preview.html"></iframe>');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
