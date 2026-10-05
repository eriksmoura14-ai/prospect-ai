"use strict";

const API = "https://api.brevo.com/v3";
const SUBJECTS = ["Confirme seu e-mail no Prospect AI", "Recupere sua senha do Prospect AI"];
const EVENTS = new Set(["requests", "request", "delivered", "deferred", "blocked", "hardbounce", "softbounce", "hardBounces", "softBounces", "invalid", "error", "spam", "opened", "clicks", "uniqueOpened", "unsubscribe"]);
const report = record => console.log("EMAIL_DIAGNOSTIC", JSON.stringify(record));
const record = (log, value) => { try { log(value); } catch { /* Diagnostics cannot interrupt authentication. */ } };

function rejection(status, data) {
  // Provider text may contain private values. Only return fixed classifications.
  const text = `${typeof data?.code === "string" ? data.code.slice(0, 100) : ""} ${typeof data?.message === "string" ? data.message.slice(0, 2000) : ""}`.toLowerCase();
  if (/\bip\b.*(?:unauthor|not author|not allow)|(?:unauthor|not author|not allow).*\bip\b/.test(text)) return "ip_not_authorized";
  if (/dkim|dmarc|\bspf\b/.test(text)) return "domain_authentication";
  if (/(?:account|smtp|transactional).*(?:not.*activ|disabled|suspend|deactiv)/.test(text)) return "transactional_disabled";
  if (/sender.*(?:not.*(?:valid|verif|author)|unverified|inactive)/.test(text)) return "sender_unverified";
  if (/credit|quota|daily.*limit/.test(text)) return "quota_exhausted";
  if (/timeout|timed out/.test(text)) return "delivery_timeout";
  if (status === 401) return "authentication_rejected";
  if (status === 403) return "permission_denied";
  if (status === 429) return "provider_rate_limit";
  if (status >= 500) return "provider_unavailable";
  return "provider_rejected";
}
function networkFailure(error) {
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "request_timeout";
  const code = error?.cause?.code || error?.code;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "dns_failure";
  if (["ECONNREFUSED", "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return "connection_failure";
  if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"].includes(code)) return "tls_failure";
  return "network_failure";
}
async function readJson(response) {
  if (!response.body) return null;
  const reader = response.body.getReader(), parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) { await reader.cancel(); return null; }
      parts.push(value);
    }
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
    catch { return null; }
  } finally { reader.releaseLock(); }
}
async function inspect(config, path, send) {
  try {
    const response = await send(API + path, { headers: { Accept: "application/json", "api-key": config.apiKey },
      signal: AbortSignal.timeout(8000), redirect: "error" });
    const data = await readJson(response);
    return { status: response.status, data, reason: response.status === 200 ? null : rejection(response.status, data) };
  } catch (error) { return { status: null, data: null, reason: networkFailure(error) }; }
}

async function probeConfiguration(config, send = fetch, log = report) {
  // Read-only, once per hosted startup. No test message and no user-visible endpoint.
  const account = await inspect(config, "/account", send);
  if (account.status !== 200 || !account.data || typeof account.data !== "object" || Array.isArray(account.data)) {
    const result = { event: "email_configuration", outcome: account.reason || "invalid_response", httpStatus: account.status };
    record(log, result); return result;
  }
  const [senders, activity] = await Promise.all([
    inspect(config, "/senders", send), inspect(config, "/smtp/statistics/events?days=1&limit=50", send)
  ]);
  const list = Array.isArray(senders.data?.senders) ? senders.data.senders : null;
  const sender = list?.find(item => typeof item?.email === "string" && item.email.toLowerCase() === config.from.toLowerCase());
  const relayEnabled = typeof account.data.relay?.enabled === "boolean" ? account.data.relay.enabled : null;
  const activityValid = activity.status === 200 && Array.isArray(activity.data?.events);
  const events = activityValid ? activity.data.events.filter(item => item &&
    ((typeof item.from === "string" && item.from.toLowerCase() === config.from.toLowerCase()) || item.tag === "prospect-ai-account") &&
    (!item.subject || SUBJECTS.includes(item.subject))) : [];
  const result = { event: "email_configuration", httpStatus: account.status,
    outcome: relayEnabled === false ? "transactional_disabled" : list && !sender ? "sender_missing" : sender?.active === false ? "sender_unverified" : "configuration_checked",
    relayEnabled, senderFound: list ? Boolean(sender) : null, senderActive: typeof sender?.active === "boolean" ? sender.active : null,
    senderCheckStatus: senders.status, senderCheckReason: senders.reason,
    activityCheckStatus: activity.status, activityCheckReason: activity.reason, activityValid,
    recentEvents: events.slice(0, 10).map(item => ({ event: EVENTS.has(item.event) ? item.event : "other",
      reason: item.reason ? rejection(400, { message: item.reason }) : null })) };
  record(log, result); return result;
}

function configuration(env) {
  const apiKey = (env.BREVO_API_KEY || "").trim();
  const from = (env.EMAIL_FROM || "").trim();
  if (apiKey.length < 20 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw new Error("Configure BREVO_API_KEY no ambiente para enviar confirmações e recuperar senhas.");
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(from) || from.length > 254) throw new Error("EMAIL_FROM deve ser um remetente verificado no serviço de e-mail.");
  return { apiKey, from };
}
function createMailer(config, send = fetch, log = report) {
  return async ({ email, purpose, link }) => {
    const activate = purpose === "activate";
    const started = Date.now();
    let response;
    try { response = await send(API + "/smtp/email", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": config.apiKey },
      body: JSON.stringify({ sender: { name: "Prospect AI", email: config.from }, to: [{ email }],
        subject: SUBJECTS[activate ? 0 : 1], tags: ["prospect-ai-account"],
        textContent: `${activate ? "Para confirmar seu e-mail e criar sua senha do Prospect AI" : "Para definir uma nova senha do Prospect AI"}, abra este link:\n\n${link}\n\nO link vale por 30 minutos e pode ser usado uma única vez. A senha criada é exclusiva do Prospect AI; não informe a senha do Gmail. Se você não pediu isso, ignore esta mensagem.\n\nProspect AI` }),
      signal: AbortSignal.timeout(10000), redirect: "error"
    }); } catch (error) {
      record(log, { event: "email_send", purpose: activate ? "activate" : "reset", outcome: networkFailure(error), elapsedMs: Date.now() - started });
      throw new Error("O serviço de e-mail não aceitou o envio.");
    }
    if (response.status === 201) {
      try { await response.body?.cancel(); } catch { /* Headers already acknowledge acceptance. */ }
      record(log, { event: "email_send", purpose: activate ? "activate" : "reset", outcome: "accepted", httpStatus: 201, elapsedMs: Date.now() - started });
      return;
    }
    let data = null;
    try { data = await readJson(response); } catch { /* HTTP status remains diagnostic evidence. */ }
    record(log, { event: "email_send", purpose: activate ? "activate" : "reset", outcome: "rejected", httpStatus: response.status,
      reason: rejection(response.status, data), elapsedMs: Date.now() - started });
    throw new Error("O serviço de e-mail não aceitou o envio.");
  };
}
module.exports = { configuration, createMailer, probeConfiguration };
