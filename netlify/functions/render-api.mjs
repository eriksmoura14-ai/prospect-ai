import security from "../../request-security.cjs";

export const LIMITS = Object.freeze({ requestMs: 55000, requestBytes: 32768 });
const BACKEND = "https://prospect-ai-a90q.onrender.com";
const forwarded = ["accept", "authorization", "content-type", "cookie", "origin", "sec-fetch-site", "x-csrf-token"];

function protectedHeaders(secure) {
  const headers = new Headers();
  security.headers({ setHeader: (key, value) => headers.set(key, value) }, secure);
  headers.set("Cache-Control", "private, no-store");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Netlify-CDN-Cache-Control", "no-store");
  return headers;
}
function failure(status, message, secure = true) {
  const headers = protectedHeaders(secure);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

// Injectable only for local tests. The deployed handler always uses the fixed
// Render origin; no user-supplied URL, header or query parameter selects a host.
export function createProxy({ backend = BACKEND, fetcher = fetch, requestMs = LIMITS.requestMs } = {}) {
  return async function proxy(request, context) {
    let incoming, site;
    try { incoming = new URL(request.url); site = new URL(context.site.url); }
    catch { return failure(503, "Não foi possível identificar o endereço da aplicação."); }
    if (incoming.origin !== site.origin) return failure(403, "Use o endereço de produção da aplicação.");
    const secure = incoming.protocol === "https:";
    if (!(incoming.pathname.startsWith("/api/") || ["/auth/logout", "/health"].includes(incoming.pathname))) {
      return failure(404, "Rota não encontrada.", secure);
    }
    if (!["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
      return failure(405, "Método não permitido.", secure);
    }
    const headers = new Headers({ "Accept-Encoding": "identity" });
    for (const name of forwarded) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    let body;
    if (!["GET", "HEAD"].includes(request.method)) {
      const length = request.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMITS.requestBytes)) {
        return failure(413, "A solicitação excede o limite permitido.", secure);
      }
      const chunks = []; let bytes = 0;
      try {
        if (request.body) for await (const chunk of request.body) {
          bytes += chunk.byteLength;
          if (bytes > LIMITS.requestBytes) return failure(413, "A solicitação excede o limite permitido.", secure);
          chunks.push(Buffer.from(chunk));
        }
      } catch { return failure(400, "Não foi possível receber os dados da solicitação.", secure); }
      body = Buffer.concat(chunks);
    }
    try {
      const url = new URL(incoming.pathname + incoming.search, backend);
      const upstream = await fetcher(url, { method: request.method, headers, body,
        redirect: "manual", signal: AbortSignal.timeout(requestMs) });
      // Never follow an origin redirect with a user's cookies or credentials.
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return failure(502, "O servidor da aplicação retornou um encaminhamento inesperado.", secure);
      }
      const responseHeaders = protectedHeaders(secure);
      for (const name of ["content-type", "retry-after", "www-authenticate"]) {
        if (upstream.headers.has(name)) responseHeaders.set(name, upstream.headers.get(name));
      }
      for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("Set-Cookie", cookie);
      // A ReadableStream keeps the function in streaming mode (20 MB platform
      // ceiling), avoiding Lambda's smaller buffered response ceiling. The
      // fetch deadline still bounds the complete upstream response.
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      const timeout = ["TimeoutError", "AbortError"].includes(error.name);
      return failure(timeout ? 504 : 502, timeout
        ? "O servidor da aplicação demorou a responder. Aguarde e tente novamente."
        : "Não foi possível conectar ao servidor da aplicação. Aguarde e tente novamente.", secure);
    }
  };
}

export default createProxy();
export const config = { path: ["/api/*", "/auth/logout", "/health"] };
