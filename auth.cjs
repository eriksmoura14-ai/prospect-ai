"use strict";

const crypto = require("node:crypto");
const { createStore, vault, databaseOptions } = require("./accounts.cjs");
const passwords = require("./passwords.cjs");
const emailService = require("./email.cjs");
const token = () => crypto.randomBytes(32).toString("base64url");
const validToken = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const equal = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
function gmail(value) {
  if (typeof value !== "string" || value.length > 254) throw Object.assign(new Error("Use um endereço @gmail.com."), { status: 400 });
  const match = /^([a-z0-9](?:[a-z0-9.]*[a-z0-9])?(?:\+[a-z0-9._-]+)?)@gmail\.com$/i.exec(value.trim());
  if (!match) throw Object.assign(new Error("Use um endereço @gmail.com."), { status: 400 });
  // Gmail dots and +tags identify the same mailbox, not separate accounts.
  return match[1].split("+")[0].replace(/\./g, "").toLowerCase() + "@gmail.com";
}
function configuration(env, hosting) {
  const mode = env.AUTH_MODE || "basic";
  if (!["basic", "password"].includes(mode)) throw new Error("AUTH_MODE inválido.");
  if (mode === "basic") return { mode };
  const origin = new URL(hosting.origin);
  if (hosting.hosted && origin.protocol !== "https:") throw new Error("Login hospedado exige HTTPS.");
  if (!hosting.hosted && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Login local exige loopback.");
  if (!env.DATABASE_URL) throw new Error("Configure DATABASE_URL para as contas.");
  vault(env.DATA_ENCRYPTION_KEY);
  databaseOptions(env.DATABASE_URL, !hosting.hosted);
  return { mode, origin: origin.origin, hosted: hosting.hosted, secure: origin.protocol === "https:",
    databaseUrl: env.DATABASE_URL, encryptionKey: env.DATA_ENCRYPTION_KEY, email: emailService.configuration(env),
    administrators: (env.ADMIN_EMAILS || "").split(",").filter(x => x.trim()).map(gmail) };
}
function cookieValue(request, name) {
  const header = request.headers.cookie || "";
  if (header.length > 16384) return null;
  const matches = header.split(";").map(x => x.trim()).filter(x => x.startsWith(name + "="));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(name.length + 1);
  return validToken(value) ? value : null;
}
function createService(config, { store, mailer } = {}) {
  if (config.mode !== "password") return null;
  store ||= createStore({ databaseUrl: config.databaseUrl, encryptionKey: config.encryptionKey, local: !config.hosted });
  mailer ||= emailService.createMailer(config.email);
  const sessionName = config.secure ? "__Host-prospect_session" : "prospect_session";
  const challengeName = config.secure ? "__Host-prospect_challenge" : "prospect_challenge";
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${config.secure ? "; Secure" : ""}`;
  const clearCookies = () => [cookie(sessionName, "", 0), cookie(challengeName, "", 0)];
  const attempts = new Map();
  const rate = async (request, action, email) => {
    const ip = request.socket?.remoteAddress || "unknown";
    const browser = cookieValue(request, sessionName) || cookieValue(request, challengeName) || ip;
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = `${action}:${browser}`;
    const limit = attempts.get(key) || { count: 0, until: now + 600000 };
    if (limit.count++ >= 30 || attempts.size >= 2000) throw Object.assign(new Error("Muitas tentativas. Aguarde alguns minutos."), { status: 429 });
    attempts.set(key, limit);
    const sending = ["activate-mail", "reset-mail"].includes(action);
    const rules = [{ key: `${sending ? "mail" : action}:${email || browser}`, limit: sending ? 3 : 10, seconds: sending ? 3600 : 600 }];
    if (sending) rules.push({ key: "mail-total", limit: 150, seconds: 86400 });
    else rules.unshift({ key: "password-work-total", limit: 120, seconds: 60 });
    if (!await store.allow(rules)) throw Object.assign(new Error("Muitas tentativas. Aguarde antes de tentar novamente."), { status: 429 });
  };
  return {
    config, store, sessionName,
    ready: () => store.maintain(),
    isAdmin(user) { return Boolean(user && config.administrators.includes(user.email)); },
    async identity(request) {
      const value = cookieValue(request, sessionName);
      if (!value) return null;
      const user = await store.session(value);
      return user ? { user, csrf: store.csrf(value), token: value } : null;
    },
    account(request, identity) {
      const challenge = cookieValue(request, challengeName) || token();
      return { data: { mode: "password", authenticated: Boolean(identity), user: identity?.user || null,
        csrfToken: identity?.csrf || store.csrf(`anonymous:${challenge}`) },
        cookies: identity ? [] : [cookie(challengeName, challenge, 600)] };
    },
    checkMutation(request, identity) {
      const challenge = cookieValue(request, challengeName);
      const expected = identity?.csrf || (challenge ? store.csrf(`anonymous:${challenge}`) : null);
      return request.headers.origin === config.origin && equal(request.headers["x-csrf-token"], expected) && request.headers["sec-fetch-site"] !== "cross-site";
    },
    async requestEmail(request, input, purpose) {
      const email = gmail(input.email);
      await rate(request, purpose === "activate" ? "activate-mail" : "reset-mail", email);
      const value = token();
      await store.issueEmailToken(purpose, email, value);
      try { await mailer({ email, purpose, link: `${config.origin}/#${purpose}=${value}` }); }
      catch { throw Object.assign(new Error("Não foi possível enviar o e-mail agora. Tente novamente mais tarde."), { status: 503 }); }
      return { message: "Confira sua caixa de entrada e a pasta de spam. Se o endereço puder concluir esta solicitação, o link chegará em instantes." };
    },
    async login(request, input) {
      const email = gmail(input.email);
      await rate(request, "login", email);
      const credentials = await store.credentials(email);
      if (!await passwords.verifyPassword(input.password, credentials?.password_hash)) throw Object.assign(new Error("E-mail ou senha inválidos."), { status: 401 });
      const value = token();
      const user = await store.signIn(email, credentials.password_hash, value, cookieValue(request, sessionName));
      if (!user) throw Object.assign(new Error("E-mail ou senha inválidos."), { status: 401 });
      return { user, cookies: [cookie(sessionName, value, 7 * 86400), cookie(challengeName, "", 0)] };
    },
    async complete(request, input, purpose) {
      await rate(request, "complete", null);
      if (!validToken(input.token)) throw Object.assign(new Error("Link inválido ou expirado. Solicite um novo e-mail."), { status: 400 });
      if (!await store.validEmailToken(purpose, input.token)) throw Object.assign(new Error("Link inválido ou expirado. Solicite um novo e-mail."), { status: 400 });
      const encoded = await passwords.hashPassword(input.password);
      const value = token();
      const user = await store.consumeEmailToken(purpose, input.token, encoded, value, cookieValue(request, sessionName));
      if (!user) throw Object.assign(new Error("Link inválido, expirado ou já utilizado. Entre ou solicite um novo e-mail."), { status: 400 });
      return { user, cookies: [cookie(sessionName, value, 7 * 86400), cookie(challengeName, "", 0)] };
    },
    async confirmPassword(request, identity, password) {
      await rate(request, "confirm", identity.user.email);
      const credentials = await store.credentials(identity.user.email);
      if (!credentials || !await passwords.verifyPassword(password, credentials.password_hash)) throw Object.assign(new Error("Confirme sua senha do Prospect AI."), { status: 400 });
      return credentials.password_hash;
    },
    clearCookies,
    async logout(identity) { await store.logout(identity.token); return clearCookies(); }
  };
}
module.exports = { configuration, createService, gmail, cookieValue, equal, validToken };
