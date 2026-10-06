"use strict";
// Local-only fixtures for Chromium. No email delivery or company discovery.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { Pool } = require("pg");
const accounts = require("../accounts.cjs"), auth = require("../auth.cjs"), passwords = require("../passwords.cjs");
const contacts = require("../contacts.cjs");
const root = path.resolve(__dirname, ".."), localRequire = createRequire(path.join(root, "server.cjs"));
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname)) throw new Error("Use apenas PostgreSQL local descartável em TEST_DATABASE_URL.");
const port = 3161, origin = `http://127.0.0.1:${port}`;
const frontendOrigin = process.env.FRONTEND_BROWSER_TEST === "true" ? "http://localhost:3162" : null;
const config = auth.configuration({ AUTH_MODE: "password", DATABASE_URL: databaseUrl,
  DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), BREVO_API_KEY: "fixture-only-not-a-real-key", EMAIL_FROM: "sender@example.test" }, { hosted: false, origin, frontendOrigin });
const store = accounts.createStore({ databaseUrl, encryptionKey: config.encryptionKey, local: true });
const sql = new Pool(accounts.databaseOptions(databaseUrl, true));
const service = auth.createService(config, { store, mailer: async () => { throw new Error("Email is prohibited in this fixture server."); } });
const context = { require: name => name === "./auth.cjs" ? { ...auth, configuration: () => config, createService: () => service } : localRequire(name),
  module: { exports: {} }, __dirname: root, process: { env: { APP_ORIGIN: origin, APP_FRONTEND_ORIGIN: frontendOrigin || "", PORT: String(port) } },
  console, Buffer, URL, URLSearchParams, AbortSignal, structuredClone, setTimeout, clearTimeout, fetch };
const source = fs.readFileSync(path.join(root, "server.cjs"), "utf8");
vm.runInNewContext(source.slice(0, source.lastIndexOf("server.listen(")) + "\nmodule.exports={server,jobs};", context);
const backend = context.module.exports, fixtures = {}, owners = [];
const phrase = "Senha exclusiva de fixture local 2026!";
let frontend;
let netlifyProxy;
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
      discoveryDiagnostics: { geocode: { selected: { address: { country_code: "br" } } } },
      rows: [{ osmId: "node/10001", name: "Barbearia <img src=x onerror=window.listXss=1>", category: "Barber", city: "Cidade de fixture", address: "Rua de teste, 1", phone: "(11) 91234-5678", status: "UNCERTAIN", confidence: 0.5, prospectScore: 40, source: "OpenStreetMap" },
        { osmId: "node/10002", name: "Oficina de exemplo", category: "Auto Detailing", city: "Cidade de fixture", address: "Avenida de teste, 2", phone: "", status: "WEBSITE_LISTED", website: "https://fixture.example", confidence: 0.9, prospectScore: 0, source: "OpenStreetMap" }] };
    await store.saveSearch(users.alice.id, job, { city: job.city, niche: job.niche, state: job.state, total: 2 });
    backend.jobs.set(job.id, job); fixtures[device] = { ...users, password: phrase, jobId: job.id,
      legacyMobile: contacts.details({ name: "Celular antigo fictício", phone: "(34) 9123-4567", countryCode: "BR" }),
      contactCases: [
        {name:"Fixo do exemplo relatado",phone:"+553432249090",countryCode:"BR"},
        {name:"Serviço especial fictício",phone:"0800 123 4567",countryCode:"BR"},
        {name:"Ramal fictício",phone:"+5511912345678 ext. 123",countryCode:"BR"},
        {name:"WhatsApp fixo explicitamente informado fictício",phone:"+553432249090",whatsappPhone:"+553432249090",countryCode:"BR"}
      ].map(company => contacts.details(company)) };
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
  if (frontendOrigin) {
    if (process.env.NETLIFY_BROWSER_TEST === "true") {
      const { createProxy } = await import("../netlify/functions/render-api.mjs");
      netlifyProxy = createProxy({ backend: origin });
    }
    // Local HTTP equivalent of the external rewrite. Preserve Origin, cookies,
    // CSRF, methods and all Set-Cookie headers; serve the actual build directory.
    const http = require("node:http"), { publicFiles } = require("../static-resources.cjs");
    frontend = http.createServer(async (request, response) => {
      const pathname = new URL(request.url, frontendOrigin).pathname;
      if (pathname.startsWith("/api/") || ["/auth/logout", "/health", "/__test/info"].includes(pathname)) {
        if (netlifyProxy && pathname !== "/__test/info") {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const incoming = new Request(frontendOrigin + request.url, { method: request.method,
            headers: request.headers, ...(["GET", "HEAD"].includes(request.method) ? {} : { body: Buffer.concat(chunks) }) });
          const result = await netlifyProxy(incoming, { site: { url: frontendOrigin } });
          const headers = Object.fromEntries([...result.headers].filter(([name]) => name !== "set-cookie"));
          if (result.headers.getSetCookie().length) headers["set-cookie"] = result.headers.getSetCookie();
          response.writeHead(result.status, headers);
          if (result.body) for await (const chunk of result.body) response.write(Buffer.from(chunk));
          response.end(); return;
        }
        const upstream = http.request(origin + request.url, { method: request.method,
          headers: { ...request.headers, host: new URL(origin).host, "x-forwarded-host": new URL(frontendOrigin).host } }, incoming => {
          response.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(response);
        });
        upstream.on("error", () => { response.writeHead(502); response.end(); });
        request.pipe(upstream); return;
      }
      require("../request-security.cjs").headers(response, false);
      if (!["GET", "HEAD"].includes(request.method) || !Object.hasOwn(publicFiles, pathname)) { response.writeHead(404); response.end(); return; }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      const content = fs.readFileSync(path.join(root, "dist", file));
      response.writeHead(200, { "Content-Type": publicFiles[pathname][1], "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : content);
    });
    frontend.listen(3162, "127.0.0.1", () => console.log("Static frontend and API proxy fixtures ready on loopback."));
  }
}
async function stop() {
  frontend?.close();
  backend.server.close();
  await sql.query("DELETE FROM prospect_accounts WHERE id=ANY($1::uuid[])", [owners]);
  await store.close(); await sql.end(); process.exit(0);
}
process.on("SIGTERM", () => { void stop(); }); process.on("SIGINT", () => { void stop(); });
start().catch(() => { console.error("Local list browser fixtures could not start."); process.exit(1); });
