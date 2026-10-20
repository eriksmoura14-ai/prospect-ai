"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createClient, configuration } = require("../google-maps.cjs");
const config = configuration(process.env);
if (!config.enabled || !config.testMode || (process.env.APP_PASSWORD || "").length < 16) {
  throw new Error("Defina o modo Google Maps de testes e uma APP_PASSWORD exclusiva com pelo menos 16 caracteres.");
}

// Never load production data, env files, databases or keys. Scratch results
// are ephemeral, confined to this process/container and removed on restart.
const dataFolder = fs.mkdtempSync("/tmp/prospect-maps-test-");
const root = path.resolve(__dirname, "..");
const children = new Set();
let stopping = false;
let stopTimer;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  stopTimer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10000);
  stopTimer.unref();
}
function start(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env });
  children.add(child);
  child.on("error", () => { console.error("Um processo do ambiente de testes não iniciou."); stop(1); });
  child.on("exit", () => {
    children.delete(child);
    if (!stopping) { console.error("Um processo do ambiente de testes encerrou."); stop(1); }
    if (!children.size) { clearTimeout(stopTimer); fs.rmSync(dataFolder, { recursive: true, force: true }); }
  });
  return child;
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
start("google-maps-scraper", ["-web", "-addr", "127.0.0.1:8080", "-data-folder", dataFolder,
  "-c", "1", "-browser-pool-size", "1", "-pages-per-browser", "1"]);

async function boot() {
  const engine = createClient();
  for (let attempt = 0; attempt < 30 && !stopping; attempt++) {
    try { await engine.ready(); if (!stopping) start(process.execPath, ["server.cjs"]); return; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  if (!stopping) { console.error("O motor de testes não ficou disponível."); stop(1); }
}
void boot();
