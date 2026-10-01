"use strict";

const http = require("node:http");
const https = require("node:https");

const LIMITS = Object.freeze({ executionSeconds: 45, connectionMs: 15000,
  requestMs: 65000, responseBytes: 8 * 1024 * 1024 });

function endpointLabel(input) {
  const url = new URL(input);
  return url.origin + url.pathname;
}

// Uma tentativa, com prazos separados para conexão e resposta completa.
// Os eventos registrados permitem distinguir rede de execução/fila/transferência.
// Uma espera sem headers NÃO prova que a consulta é lenta.
function query(endpoint, ql, options = {}) {
  const limits = { ...LIMITS, ...options.limits };
  const method = options.method || "POST";
  const apiKey = options.apiKey ?? "";
  const trace = { endpoint: endpointLabel(endpoint), query: ql,
    startedAt: new Date().toISOString(), phase: "connecting", bytes: 0,
    httpMethod: method, ipFamily: options.family || "auto", limits: { ...limits },
    connectionAttempts: [] };
  const started = Date.now();
  const notify = () => options.onTrace?.({ ...trace });
  notify();

  return new Promise((resolve, reject) => {
    let request;
    let response;
    let settled = false;
    let connectionTimer;
    let totalTimer;
    const elapsed = () => Date.now() - started;

    function finish(code, message, answer) {
      if (settled) return;
      settled = true;
      clearTimeout(connectionTimer);
      clearTimeout(totalTimer);
      trace.elapsedMs = elapsed();
      trace.outcome = code || (answer.elements.length ? "success" : "empty");
      notify();
      if (code) {
        const error = new Error(message);
        error.code = code;
        error.diagnostics = { ...trace };
        reject(error);
        response?.destroy();
        request?.destroy();
      } else resolve(answer);
    }

    try {
      const url = new URL(endpoint);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          !["GET", "POST"].includes(method) || ![undefined, 0, 4, 6].includes(options.family) ||
          typeof apiKey !== "string" || /[\r\n]/.test(apiKey) ||
          (apiKey && url.protocol !== "https:")) {
        finish("configuration", "OVERPASS_URL inválida: use HTTP(S) sem credenciais.");
        return;
      }
      const body = new URLSearchParams({ data: ql }).toString();
      if (method === "GET") url.searchParams.set("data", ql);
      const transport = url.protocol === "https:" ? https : http;
      request = transport.request(url, {
        method, agent: false, ...(options.family ? { family: options.family } : {}),
        headers: { "User-Agent": options.userAgent || "ProspectAI/0.2",
          Accept: "application/json", "Accept-Encoding": "identity",
          ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body) } : {}) }
      }, incoming => {
        response = incoming;
        trace.phase = "reading_body";
        trace.headersMs = elapsed();
        trace.httpStatus = incoming.statusCode;
        notify();
        if (incoming.statusCode < 200 || incoming.statusCode >= 300) {
          finish("http_error", `O servidor de empresas respondeu HTTP ${incoming.statusCode}. Seus filtros continuam válidos.`);
          return;
        }
        const chunks = [];
        incoming.on("data", chunk => {
          trace.bytes += chunk.length;
          if (trace.bytes > limits.responseBytes) {
            finish("response_too_large", "A resposta de empresas excedeu o limite de leitura; a pesquisa não foi concluída.");
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          let answer;
          try { answer = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch {
            finish("invalid_json", "O servidor de empresas retornou uma resposta inválida.");
            return;
          }
          if (answer?.remark) {
            // Pode conter resultados PARCIAIS. Nunca tratar como sucesso/vazio.
            const remark = String(answer.remark);
            trace.remark = (apiKey ? remark.split(apiKey).join("[redacted]") : remark).slice(0, 500);
            const timedOut = /timed?\s*out|timeout|time limit/i.test(trace.remark);
            finish(timedOut ? "query_timeout" : "query_incomplete", timedOut
              ? "O Overpass informou que a consulta excedeu o tempo de execução. A pesquisa não foi concluída; seus filtros continuam válidos."
              : "O Overpass informou uma consulta incompleta. Seus filtros continuam válidos.");
            return;
          }
          if (!answer || !Array.isArray(answer.elements)) {
            finish("invalid_response", "O servidor de empresas não retornou uma lista válida.");
            return;
          }
          trace.elementCount = answer.elements.length;
          trace.phase = "complete";
          finish(null, null, answer);
        });
        incoming.on("aborted", () => finish("response_interrupted", "A transferência das empresas foi interrompida. Seus filtros continuam válidos."));
        incoming.on("error", error => {
          trace.networkCode = error.code || "UNKNOWN";
          finish("response_interrupted", "A transferência das empresas falhou. Seus filtros continuam válidos.");
        });
      });

      request.on("socket", socket => {
        socket.on("lookup", (error, address, family) => {
          trace.dnsMs = elapsed();
          if (error) trace.networkCode = error.code;
          if (address) {
            trace.resolvedAddresses ||= [];
            if (!trace.resolvedAddresses.some(item => item.address === address)) {
              trace.resolvedAddresses.push({ address, family });
            }
          }
          notify();
        });
        socket.on("connectionAttempt", (address, port, family) => {
          trace.connectionAttempts.push({ address, port, family, startedMs: elapsed() });
          notify();
        });
        socket.on("connectionAttemptFailed", (address, port, family, error) => {
          trace.connectionAttempts.push({ address, port, family, failedMs: elapsed(), code: error.code });
          notify();
        });
        socket.on("connect", () => {
          trace.tcpMs = elapsed();
          trace.remoteAddress = socket.remoteAddress;
          trace.remoteFamily = socket.remoteFamily;
          notify();
        });
        const readyEvent = url.protocol === "https:" ? "secureConnect" : "connect";
        socket.once(readyEvent, () => {
          clearTimeout(connectionTimer);
          trace.connectedMs = elapsed();
          trace.phase = "awaiting_headers";
          notify();
        });
      });
      request.on("error", error => {
        trace.networkCode = error.code || "UNKNOWN";
        if (Array.isArray(error.errors)) {
          trace.networkErrors = error.errors.map(item => ({ code: item.code,
            address: item.address, port: item.port }));
        }
        finish(trace.connectedMs == null ? "connection_error" : "response_interrupted",
          trace.connectedMs == null
            ? `Não foi possível conectar ao servidor de empresas (${trace.networkCode}). Seus filtros continuam válidos.`
            : "A conexão com o servidor de empresas foi interrompida. Seus filtros continuam válidos.");
      });
      connectionTimer = setTimeout(() => finish("connection_timeout",
        "A conexão com o servidor de empresas excedeu o prazo. Seus filtros continuam válidos."), limits.connectionMs);
      totalTimer = setTimeout(() => finish("response_timeout", trace.phase === "reading_body"
        ? "A transferência das empresas excedeu o prazo. Seus filtros continuam válidos."
        : "O servidor de empresas não enviou uma resposta no prazo após a conexão. Pode haver fila ou consulta lenta; seus filtros continuam válidos."), limits.requestMs);
      request.end(method === "POST" ? body : undefined);
    } catch {
      finish("configuration", "Não foi possível iniciar a consulta. Verifique OVERPASS_URL no servidor.");
    }
  });
}

const PROBE_QUERY = "[out:json][timeout:5][maxsize:16777216];node(1);out count;";
const PROBE_LIMITS = Object.freeze({ executionSeconds: 5, connectionMs: 5000, requestMs: 10000 });

function canUseAlternative(error) {
  if (["connection_error", "connection_timeout"].includes(error.code)) return true;
  if (error.code === "response_timeout") return error.diagnostics?.phase === "awaiting_headers";
  // Não contorna autenticação, bloqueios ou limites HTTP 429.
  return error.code === "http_error" && [502, 503, 504].includes(error.diagnostics?.httpStatus);
}

function createClient({ endpoints, userAgent, method = "POST", family = 0, apiKey = "", request = query, now = Date.now }) {
  if (!["GET", "POST"].includes(method) || ![0, 4, 6].includes(family)) {
    throw new Error("Configure OVERPASS_HTTP_METHOD como GET/POST e OVERPASS_IP_FAMILY como 0/4/6.");
  }
  const urls = [...new Set(endpoints.map(endpoint => {
    const url = new URL(endpoint);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Configure endpoints Overpass HTTP(S), sem credenciais ou parâmetros.");
    }
    return url.href;
  }))];
  if (!urls.length) throw new Error("Configure pelo menos um endpoint Overpass.");
  if (typeof apiKey !== "string" || /[\r\n]/.test(apiKey) ||
      (apiKey && new URL(urls[0]).protocol !== "https:")) {
    throw new Error("Configure OVERPASS_API_KEY sem quebras de linha e use HTTPS no endpoint primário.");
  }
  const health = new Map();
  const cooldownMs = 60000;

  async function execute(ql, { onTrace = () => {}, onProgress = () => {} } = {}) {
    const failures = [];
    for (const endpoint of urls) {
      // A credencial pertence exclusivamente ao primário; nunca a uma alternativa.
      const endpointKey = endpoint === urls[0] ? apiKey : "";
      const state = health.get(endpoint);
      if (state?.unavailableUntil > now()) {
        const trace = { endpoint: endpointLabel(endpoint), purpose: "cooldown",
          outcome: "temporarily_unavailable", phase: "not_requested",
          unavailableUntil: state.unavailableUntil, previousOutcome: state.outcome };
        onTrace(trace);
        failures.push(trace);
        continue;
      }
      let purpose = "probe";
      try {
        if (!(state?.healthyUntil > now())) {
          onProgress("Testando disponibilidade do servidor de empresas…");
          await request(endpoint, PROBE_QUERY, {
            userAgent, method, family, apiKey: endpointKey, limits: PROBE_LIMITS,
            onTrace: trace => onTrace({ ...trace, purpose: "probe" })
          });
          health.set(endpoint, { healthyUntil: now() + cooldownMs });
        }
        purpose = "businesses";
        onProgress("Consultando empresas na área completa da localidade…");
        // Exatamente a mesma QL em cada endpoint. Nunca muda área ou seletores.
        const answer = await request(endpoint, ql, {
          userAgent, method, family, apiKey: endpointKey, onTrace: trace => onTrace({ ...trace, purpose: "businesses" })
        });
        health.set(endpoint, { healthyUntil: now() + cooldownMs });
        return answer; // Lista vazia também é válida: não amplia a busca.
      } catch (error) {
        failures.push({ ...error.diagnostics, endpoint: endpointLabel(endpoint),
          purpose, outcome: error.code });
        if (!canUseAlternative(error)) throw error;
        health.set(endpoint, { unavailableUntil: now() + cooldownMs, outcome: error.code });
        onProgress("Servidor indisponível. Verificando alternativa com a mesma área e filtros…");
      }
    }
    const error = new Error("Os servidores de empresas configurados estão indisponíveis. Tente novamente mais tarde; sua área e seus filtros continuam válidos.");
    error.code = "overpass_unavailable";
    error.diagnostics = { outcome: error.code, attempts: failures };
    throw error;
  }

  return { execute, endpoints: urls.map(endpointLabel), method, family,
    probeQuery: PROBE_QUERY, probeLimits: PROBE_LIMITS };
}

module.exports = { query, LIMITS, endpointLabel, createClient, PROBE_QUERY, PROBE_LIMITS };
