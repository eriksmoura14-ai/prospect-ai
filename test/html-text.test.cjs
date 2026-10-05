"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const html = require("../html-text.cjs");

test("texto comercial preserva Unicode, título e conteúdo e ignora código dos sites", () => {
  const page = 'İstanbul 東京 <TITLE lang="pt">Empresa <b>Central</b></TITLE>' +
    '<SCRIPT>"Telefone falso 9999999999";</SCRIPT><style>.fake{content:"cidade falsa"}</style>' +
    '<main>São Paulo <span>+55 (11) 1234-5678</span><br>Rua Central 123</main>';
  assert.equal(html.title(page), "Empresa  Central");
  const text = html.text(page);
  assert.ok(text.includes("İstanbul 東京")); assert.ok(text.includes("São Paulo"));
  assert.ok(text.includes("+55 (11) 1234-5678")); assert.ok(text.includes("Rua Central 123"));
  assert.ok(!text.includes("Telefone falso")); assert.ok(!text.includes("cidade falsa"));
  assert.equal(html.text("sem tags <> final"), "sem tags <> final");
  assert.equal(html.title("sem título"), "");
});

test("HTML malformado no limite de 384 KiB não bloqueia a análise por backtracking", () => {
  // A separate process deadline tests the failure mode without risking a hung suite.
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict'), html = require('./html-text.cjs');
    for (const piece of ['<', '<title', '<script', '<style', '<SCRIPTx']) {
      const input = piece.repeat(Math.floor(384 * 1024 / piece.length));
      assert.equal(html.text(input), input);
      assert.equal(html.title(input), '');
    }
    process.stdout.write('bounded');
  `], { cwd: require("node:path").resolve(__dirname, ".."), timeout: 3000, encoding: "utf8" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "bounded");
});
