"use strict";

const { performance } = require("node:perf_hooks");

const failure = (status, message, options = {}) => Object.assign(new Error(message),
  { status, safeRequestError: true, ...options });
const CSP = "default-src 'self'; script-src 'self'; script-src-attr 'none'; " +
  "style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; " +
  "object-src 'none'; base-uri 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'";

function headers(response, hostedHTTPS) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", CSP);
  if (hostedHTTPS) response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function createGate({ clock = () => performance.now(), maximumActive = 32 } = {}) {
  let active = 0;
  // Fixed-size aggregate budgets do not trust cookies or forwarded IP headers.
  // They protect the free instance before session/database work is admitted.
  const budgets = {
    auth: { tokens: 30, capacity: 30, perMs: 120 / 60000, at: clock() },
    account: { tokens: 80, capacity: 80, perMs: 600 / 60000, at: clock() }
  };
  return {
    enter(pathname, method) {
      if (!pathname.startsWith("/api/") && pathname !== "/auth/logout") return () => {};
      if (active >= maximumActive) throw failure(429, "Muitas solicitações simultâneas. Aguarde alguns segundos.", { retryAfter: 1, closeRequest: true });
      const budget = pathname.startsWith("/api/auth/") ? budgets.auth
        : pathname === "/api/account" && method === "GET" ? budgets.account : null;
      if (budget) {
        const now = clock();
        budget.tokens = Math.min(budget.capacity, budget.tokens + Math.max(0, now - budget.at) * budget.perMs);
        budget.at = now;
        if (budget.tokens < 1) throw failure(429, "Muitas tentativas. Aguarde alguns segundos.", {
          retryAfter: Math.max(1, Math.ceil((1 - budget.tokens) / budget.perMs / 1000)), closeRequest: true
        });
        budget.tokens--;
      }
      active++; let released = false;
      return () => { if (!released) { released = true; active--; } };
    }
  };
}

async function readJSON(request, maxBytes = 4096, { timeoutMs = 8000 } = {}) {
  const type = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(type) ||
      (request.headers["content-encoding"] && request.headers["content-encoding"].toLowerCase() !== "identity")) {
    throw failure(415, "Envie os dados em JSON UTF-8 sem compressão.", { closeRequest: true });
  }
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw failure(413, "A solicitação excede o limite permitido.", { closeRequest: true });
  }
  let timer;
  const reading = (async () => {
    const chunks = []; let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const buffer = Buffer.from(chunk); size += buffer.length;
      if (size > maxBytes) throw failure(413, "A solicitação excede o limite permitido.", { closeRequest: true });
      chunks.push(buffer);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw failure(400, "Dados JSON inválidos."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw failure(400, "Envie um objeto JSON válido.");
    return value;
  })();
  try {
    return await Promise.race([reading, new Promise((_, reject) => {
      timer = setTimeout(() => reject(failure(408, "Tempo limite para receber os dados.", { closeRequest: true })), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

module.exports = { headers, createGate, readJSON };
