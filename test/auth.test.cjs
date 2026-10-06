"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const auth = require("../auth.cjs");
const passwords = require("../passwords.cjs");
const mail = require("../email.cjs");
const { vault, databaseOptions } = require("../accounts.cjs");
const key = () => crypto.randomBytes(32).toString("base64");
const local = { hosted: false, origin: "http://127.0.0.1:3042" };
const env = () => ({ AUTH_MODE: "password", BREVO_API_KEY: "fixture-only-not-an-api-key", EMAIL_FROM: "sender@example.test",
  DATABASE_URL: "postgres://fixture:fixture@127.0.0.1:55432/test", DATA_ENCRYPTION_KEY: key() });

test("contas exigem configuração completa e HTTPS hospedado; o modo básico permanece explícito", () => {
  assert.deepEqual(auth.configuration({}, local), { mode: "basic" });
  for (const name of ["BREVO_API_KEY", "EMAIL_FROM", "DATABASE_URL", "DATA_ENCRYPTION_KEY"]) {
    const value = env(); delete value[name]; assert.throws(() => auth.configuration(value, local));
  }
  assert.throws(() => auth.configuration(env(), { hosted: true, origin: "http://site.example" }));
  assert.throws(() => auth.configuration(env(), { hosted: false, origin: "https://external.example" }));
  assert.throws(() => auth.configuration({ AUTH_MODE: "google" }, local));
});
test("banco externo mantém validação TLS mesmo com parâmetro que tenta desligá-la", () => {
  const options = databaseOptions("postgres://fixture:fixture@db.example/app?sslmode=no-verify&sslrejectunauthorized=false", false);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.ok(!options.connectionString.includes("ssl"));
  assert.throws(() => databaseOptions("postgres://fixture:fixture@127.0.0.1/app", false));
  assert.equal(databaseOptions("postgres://fixture:fixture@127.0.0.1/app", true).ssl, false);
  const secret = "private-test-password";
  try {
    databaseOptions(`postgres://fixture:${secret}@[broken/app`, false);
    assert.fail("Conexão malformada deveria ser recusada.");
  } catch (error) {
    assert.match(error.message, /DATABASE_URL inválida/);
    assert.ok(!JSON.stringify(Object.getOwnPropertyNames(error).map(name=>error[name])).includes(secret));
  }
});
test("criptografia autentica o conteúdo e o dono, usa IV aleatório e rejeita adulteração", () => {
  const box = vault(key()), text = { email: "account@example.test", note: "Dados privados" };
  const a = box.encrypt(text, "owner:a"), b = box.encrypt(text, "owner:a");
  assert.notEqual(a, b); assert.ok(!a.includes(text.email)); assert.deepEqual(box.decrypt(a, "owner:a"), text);
  assert.throws(() => box.decrypt(a, "owner:b"));
  const bits = a.split("."); bits[2] = Buffer.alloc(16).toString("base64url");
  assert.throws(() => box.decrypt(bits.join("."), "owner:a"));
  assert.throws(() => vault("short"));
});
test("somente Gmail é aceito; pontos, maiúsculas e +tags não criam contas duplicadas", () => {
  assert.equal(auth.gmail(" First.Last+test@GMAIL.com "), "firstlast@gmail.com");
  for (const value of ["user@company.example", "attacker@gmail.com.example", "user@gmail.com\nBcc:other@test", "@@gmail.com", "@gmail.com", "user@googlemail.com", "a".repeat(255)+"@gmail.com", null]) assert.throws(() => auth.gmail(value));
});
test("cookies duplicados ou malformados não autenticam; comparação Unicode não quebra", () => {
  const value = crypto.randomBytes(32).toString("base64url");
  assert.equal(auth.cookieValue({ headers: { cookie: "sid=" + value } }, "sid"), value);
  assert.equal(auth.cookieValue({ headers: { cookie: `sid=${value}; sid=${value}` } }, "sid"), null);
  assert.equal(auth.cookieValue({ headers: { cookie: "sid=not-a-session" } }, "sid"), null);
  assert.equal(auth.equal("é", "a"), false); assert.equal(auth.equal(undefined, "a"), false);
});
test("cookie anônimo e origem protegem inclusive o login contra CSRF", () => {
  const config = auth.configuration({ ...env(), DATABASE_URL: "postgres://fixture:fixture@db.example/app" }, { hosted: true, origin: "https://app.example" });
  const box = vault(config.encryptionKey);
  const service = auth.createService(config, { store: { csrf: value => box.mac("csrf", value) }, mailer: async () => {} });
  const result = service.account({ headers: {} }, null);
  assert.match(result.cookies[0], /^__Host-prospect_challenge=.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  const request = { headers: { origin: config.origin, cookie: result.cookies[0].split(";")[0], "x-csrf-token": result.data.csrfToken, "sec-fetch-site": "same-origin" } };
  assert.equal(service.checkMutation(request, null), true);
  assert.equal(service.checkMutation({ headers: { ...request.headers, origin: "https://evil.example" } }, null), false);
  assert.equal(service.checkMutation({ headers: { ...request.headers, "x-csrf-token": "wrong" } }, null), false);
  assert.equal(service.checkMutation({ headers: { ...request.headers, "sec-fetch-site": "cross-site" } }, null), false);
});

test("interface Vercel mantém CSRF e cookies protegidos, links usam origem configurada", async () => {
  const hosting = require("../hosting.cjs").configuration({ RENDER: "true", RENDER_EXTERNAL_URL: "https://api.onrender.com",
    APP_FRONTEND_ORIGIN: "https://prospect.vercel.app" });
  const config = auth.configuration({ ...env(), DATABASE_URL: "postgres://fixture:fixture@db.example/app" }, hosting);
  const box = vault(config.encryptionKey), messages = [];
  const service = auth.createService(config, { store: { csrf: value => box.mac("csrf", value), allow: async () => true,
    issueEmailToken: async () => {} }, mailer: async value => { messages.push(value); } });
  const account = service.account({ headers: {} }, null);
  const headers = { origin: hosting.frontendOrigin, cookie: account.cookies[0].split(";")[0],
    "x-csrf-token": account.data.csrfToken, "sec-fetch-site": "same-origin" };
  for (const origin of [hosting.origin, hosting.frontendOrigin]) assert.equal(service.checkMutation({ headers: { ...headers, origin } }, null), true);
  for (const origin of [undefined, "null", "https://preview.vercel.app", "https://prospect.vercel.app.evil.example", "https://evil.example"]) {
    assert.equal(service.checkMutation({ headers: { ...headers, origin, "x-forwarded-host": "prospect.vercel.app" } }, null), false);
  }
  assert.equal(service.checkMutation({ headers: { ...headers, "x-csrf-token": "wrong" } }, null), false);
  assert.equal(service.checkMutation({ headers: { ...headers, "sec-fetch-site": "cross-site" } }, null), false);
  assert.match(account.cookies[0], /HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  assert.doesNotMatch(account.cookies[0], /Domain=/i);
  await service.requestEmail({ headers, socket: { remoteAddress: "127.0.0.1" } }, { email: "fixture@gmail.com" }, "activate");
  assert.equal(new URL(messages[0].link).origin, hosting.frontendOrigin);
  assert.match(new URL(messages[0].link).hash, /^#activate=/);
});
test("senhas usam scrypt com salt próprio, preservam espaços e rejeitam senha incorreta", async () => {
  const phrase = "Uma frase privada longa 2026!";
  const a = await passwords.hashPassword(phrase), b = await passwords.hashPassword(phrase);
  assert.notEqual(a, b); assert.ok(!a.includes(phrase)); assert.match(a, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await passwords.verifyPassword(phrase, a), true);
  assert.equal(await passwords.verifyPassword("Outra frase totalmente diferente", a), false);
  assert.equal(await passwords.verifyPassword(phrase, null), false);
  await assert.rejects(passwords.hashPassword("short"));
  await assert.rejects(passwords.hashPassword("x".repeat(129)));
  assert.notEqual(passwords.normalize(" frase com espaços "), passwords.normalize("frase com espaços"));
});
test("fila de hashes limita memória e rejeita excesso de trabalho", async () => {
  const attempts = Array.from({length:6}, () => passwords.verifyPassword("Senha fictícia para teste", null));
  const results = await Promise.allSettled(attempts);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 5);
  const refusal = results.find(x => x.status === "rejected");
  assert.equal(refusal.reason.status, 429);
});
test("adaptador de e-mail usa HTTPS e não expõe chave no corpo; envio real depende de configuração externa", async () => {
  let captured;
  const send = mail.createMailer({ apiKey: "local-fixture", from: "sender@example.test" }, async (url, options) => {
    captured = { url, options }; return new Response("{}", { status: 201 });
  });
  await send({ email: "fixture@gmail.com", purpose: "activate", link: "https://app.example/#activate=local-token" });
  assert.equal(captured.url, "https://api.brevo.com/v3/smtp/email");
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(body.to, [{ email: "fixture@gmail.com" }]);
  assert.ok(!captured.options.body.includes("local-fixture"));
  assert.match(body.textContent, /não informe a senha do Gmail/);
  const failure = mail.createMailer({ apiKey: "local-fixture", from: "sender@example.test" }, async () => new Response("{}", {status:401}));
  await assert.rejects(failure({ email: "fixture@gmail.com", purpose: "reset", link: "https://app.example/" }));
});
