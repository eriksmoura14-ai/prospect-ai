"use strict";

// Development only. Starts the existing fixture, never the production server.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const { setTimeout: pause } = require("node:timers/promises");
const root = path.resolve(__dirname, "..");

function validateDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Configure TEST_DATABASE_URL com PostgreSQL local descartável."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
      || !["127.0.0.1", "localhost"].includes(url.hostname)
      || !url.username || !url.password
      || !/^\/prospect_audit_[a-z0-9_]+$/.test(url.pathname)
      || url.search || url.hash) {
    throw new Error("A auditoria exige banco local exclusivo chamado prospect_audit_*, sem parâmetros extras.");
  }
}

function command(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env: process.env, stdio: "inherit" });
    child.once("error", () => reject(new Error("Não foi possível iniciar uma dependência da auditoria.")));
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("Uma verificação de segurança falhou ou ficou incompleta.")));
  });
}

async function run() {
  validateDatabase(process.env.TEST_DATABASE_URL);
  const python = process.env.SECURITY_AUDIT_PYTHON || "python3";
  await command(python, ["-m", "unittest", "discover", "-s", "tools/security-audit", "-p", "test_agent.py", "-v"]);
  const fixture = spawn(process.execPath, ["test/prospects-browser-server.cjs"], {
    cwd: root, env: { ...process.env, FRONTEND_BROWSER_TEST: "false", NETLIFY_BROWSER_TEST: "false" },
    stdio: ["ignore", "ignore", "ignore"]
  });
  let stopped = false, ready = false;
  fixture.once("error", () => { stopped = true; });
  const exited = once(fixture, "exit").catch(() => {});
  fixture.once("exit", () => { stopped = true; });
  try {
    // Require a fixture response and a live child; an occupied port fails closed.
    for (let i = 0; i < 120 && !stopped; i++) {
      try {
        const response = await fetch("http://127.0.0.1:3161/__test/info", {
          signal: AbortSignal.timeout(500), redirect: "error"
        });
        if (response.ok && (await response.json()).desktop?.alice) { ready = true; break; }
      } catch { /* Wait only for this local fixture's startup. */ }
      await pause(250);
    }
    await pause(150);
    if (!ready || stopped) throw new Error("O servidor de fixtures não iniciou na porta local 3161.");
    await command(python, ["tools/security-audit/prospect_audit.py", "--output-dir", ".artifacts/security-audit"]);
  } finally {
    if (!stopped) {
      fixture.kill("SIGTERM");
      let timer;
      try {
        await Promise.race([exited, new Promise(resolve => {
          timer = setTimeout(() => { fixture.kill("SIGKILL"); resolve(); }, 8000);
        })]);
      } finally { clearTimeout(timer); }
    }
    await exited;
  }
}

if (require.main === module) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateDatabase };
