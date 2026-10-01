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
  const trace = { endpoint: endpointLabel(endpoint), query: ql,
    startedAt: new Date().toISOString(), phase: "connecting", bytes: 0,
    limits: { ...limits } };
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
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        finish("configuration", "OVERPASS_URL inválida: use HTTP(S) sem credenciais.");
        return;
      }
      const body = new URLSearchParams({ data: ql }).toString();
      const transport = url.protocol === "https:" ? https : http;
      request = transport.request(url, {
        method: "POST", agent: false,
        headers: { "User-Agent": options.userAgent || "ProspectAI/0.2",
          Accept: "application/json", "Accept-Encoding": "identity",
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body) }
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
            trace.remark = String(answer.remark).slice(0, 500);
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
        socket.on("lookup", error => {
          trace.dnsMs = elapsed();
          if (error) trace.networkCode = error.code;
          notify();
        });
        socket.on("connect", () => {
          trace.tcpMs = elapsed();
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
      request.end(body);
    } catch {
      finish("configuration", "Não foi possível iniciar a consulta. Verifique OVERPASS_URL no servidor.");
    }
  });
}

module.exports = { query, LIMITS, endpointLabel };
