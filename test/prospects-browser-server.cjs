"use strict";
// Local-only fixtures for Chromium. No email delivery or company discovery.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { Pool } = require("pg");
const accounts = require("../accounts.cjs"), auth = require("../auth.cjs"), passwords = require("../passwords.cjs");
const root = path.resolve(__dirname, ".."), localRequire = createRequire(path.join(root, "server.cjs"));
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) throw new Error("Use apenas PostgreSQL local descartável em TEST_DATABASE_URL.");
const port = 3161, origin = `http://127.0.0.1:${port}`;
const config = auth.configuration({ AUTH_MODE: "password", DATABASE_URL: databaseUrl,
  DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), BREVO_API_KEY: "fixture-only-not-a-real-key", EMAIL_FROM: "sender@example.test" }, { hosted: false, origin });
const store = accounts.createStore({ databaseUrl, encryptionKey: config.encryptionKey, local: true });
const sql = new Pool(accounts.databaseOptions(databaseUrl, true));
const service = auth.createService(config, { store, mailer: async () => { throw new Error("Email is prohibited in this fixture server."); } });
const context = { require: name => name === "./auth.cjs" ? { ...auth, configuration: () => config, createService: () => service } : localRequire(name),
  module: { exports: {} }, __dirname: root, process: { env: { APP_ORIGIN: origin, PORT: String(port) } },
  console, Buffer, URL, URLSearchParams, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch };
const source = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
vm.runInNewContext(source.slice(0, source.lastIndexOf("server.listen(")) + "\nmodule.exports={server,jobs};", context);
const backend = context.module.exports, fixtures = {}, owners = [];
const phrase = "Senha exclusiva de fixture local 2026!";
async function start() {
  await store.ready(); const passwordHash = await passwords.hashPassword(phrase);
  for (const device of ["desktop", "mobile"]) {
    const suffix = crypto.randomBytes(6).toString("hex"), users = {};
    for (const who of ["alice", "bob"]) {
      const email = `${who}${device}${suffix}@gmail.com`, token = crypto.randomBytes(32).toString("base64url");
      await store.issueEmailToken("activate", email, token);
      const profile = await store.consumeEmailToken("activate", token, passwordHash, crypto.randomBytes(32).toString("base64url"));
      owners.push(profile.id); users[who] = { email, id: profile.id };
    }
    const job = { id: crypto.randomUUID(), ownerId: users.alice.id, state: "done", city: "Cidade de fixture", niche: "Barber", limit: 2,
      message: "Resultados controlados para testar listas.", total: 2, totalDiscovered: 2, completed: 2, createdAt: Date.now(),
      rows: [{ osmId: "node/10001", name: "Barbearia <img src=x onerror=window.listXss=1>", category: "Barber", city: "Cidade de fixture", address: "Rua de teste, 1", phone: "+55 11 1234-5678", status: "UNCERTAIN", confidence: 0.5, prospectScore: 40, source: "OpenStreetMap" },
        { osmId: "node/10002", name: "Oficina de exemplo", category: "Auto Detailing", city: "Cidade de fixture", address: "Avenida de teste, 2", phone: "", status: "WEBSITE_LISTED", website: "https://fixture.example", confidence: 0.9, prospectScore: 0, source: "OpenStreetMap" }] };
    await store.saveSearch(users.alice.id, job, { city: job.city, niche: job.niche, state: job.state, total: 2 });
    backend.jobs.set(job.id, job); fixtures[device] = { ...users, password: phrase, jobId: job.id };
  }
  const realHandler = backend.server.listeners("request")[0]; backend.server.removeAllListeners("request");
  backend.server.on("request", async (request, response) => {
    if (request.url.startsWith("/__test/info")) {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return response.end(JSON.stringify(fixtures));
    }
    if (request.url === "/__test/expire") {
      const identity = await service.identity(request); if (identity) await service.logout(identity);
      response.writeHead(200); return response.end("fixture session revoked");
    }
    if (request.url === "/api/search" || request.url === "/api/ai") {
      response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return response.end(JSON.stringify({ error: "External operations prohibited by fixture server." }));
    }
    return realHandler(request, response);
  });
  backend.server.listen(port, "127.0.0.1", () => console.log("List browser fixtures ready on loopback."));
}
async function stop() {
  backend.server.close();
  await sql.query("DELETE FROM prospect_accounts WHERE id=ANY($1::uuid[])", [owners]);
  await store.close(); await sql.end(); process.exit(0);
}
process.on("SIGTERM", () => { void stop(); }); process.on("SIGINT", () => { void stop(); });
start().catch(() => { console.error("Local list browser fixtures could not start."); process.exit(1); });
