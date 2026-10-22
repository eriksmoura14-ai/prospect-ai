"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { validateDatabase } = require("../scripts/audit-auth.cjs");
const { publicFiles } = require("../static-resources.cjs");

test("auditoria aceita somente PostgreSQL local autenticado em banco exclusivo", () => {
  for (const host of ["127.0.0.1", "localhost"]) {
    validateDatabase(`postgresql://fixture:fixture@${host}:55439/prospect_audit_local`);
  }
  for (const value of [undefined, "invalid", "https://127.0.0.1/prospect_audit_local",
    "postgresql://fixture:fixture@production.example/prospect_audit_local",
    "postgresql://fixture:fixture@127.0.0.1/neondb",
    "postgresql://127.0.0.1/prospect_audit_local",
    "postgresql://fixture:fixture@127.0.0.1/prospect_audit_local?host=production.example",
    "postgresql://fixture:fixture@127.0.0.1/prospect_audit_local#unexpected"]) {
    assert.throws(() => validateDatabase(value));
  }
});

test("configuração remota falha antes de iniciar dependências e não revela a senha", () => {
  const credential = "private-sentinel-not-a-real-credential";
  const result = spawnSync(process.execPath, ["scripts/audit-auth.cjs"], {
    cwd: require("node:path").resolve(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, TEST_DATABASE_URL: `postgresql://fixture:${credential}@production.example/prospect_audit_local`,
      SECURITY_AUDIT_PYTHON: "/this-executable-must-not-run" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /banco local exclusivo/);
  assert.ok(!result.stderr.includes(credential));
  assert.ok(!result.stderr.includes("dependência"));
});

test("fontes da auditoria e relatórios não pertencem aos arquivos públicos", () => {
  for (const route of Object.keys(publicFiles)) {
    assert.ok(!route.startsWith("/tools/") && !route.startsWith("/.artifacts/")
      && !route.startsWith("/scripts/") && !route.startsWith("/test/"));
  }
});
