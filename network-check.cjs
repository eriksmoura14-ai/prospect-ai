"use strict";

// Diagnóstico opt-in no serviço de teste, sem autenticação ou consultas de empresas.
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const overpass = require("./overpass.cjs");
const execute = promisify(execFile);
const ql = overpass.PROBE_QUERY;
const primary = "https://overpass.private.coffee/api/interpreter";
const alternate = "https://maps.mail.ru/osm/tools/overpass/api/interpreter";

function summarize(body) {
  try {
    const answer = JSON.parse(body);
    return { validOverpass: Array.isArray(answer.elements) && !answer.remark,
      elements: answer.elements?.length, remarkPresent: Boolean(answer.remark) };
  } catch { return { validOverpass: false }; }
}

async function run() {
  const userAgent = "ProspectAI-network-diagnostic/1.0";
  const log = result => console.log("NETWORK_CHECK " + JSON.stringify(result));
  log({ event: "start", commit: process.env.RENDER_GIT_COMMIT,
    service: process.env.RENDER_SERVICE_NAME });
  for (const transport of ["native", "fetch", "curl-get", "curl-post", "curl-alternate"]) {
    const started = Date.now();
    const endpoint = transport === "curl-alternate" ? alternate : primary;
    const record = { transport, endpoint };
    try {
      if (transport === "native") {
        await overpass.query(endpoint, ql, { method: "GET", family: 4, userAgent,
          limits: { connectionMs: 3000, requestMs: 6000 },
          onTrace: trace => { record.trace = trace; } });
      } else if (transport === "fetch") {
        const url = new URL(endpoint);
        url.searchParams.set("data", ql);
        const response = await fetch(url, { redirect: "error",
          signal: AbortSignal.timeout(6000), headers: { "User-Agent": userAgent } });
        record.httpStatus = response.status;
        Object.assign(record, summarize(await response.text()));
      } else {
        const args = ["--silent", "--show-error", "--connect-timeout", "3", "--max-time", "6",
          "--ipv4", "--user-agent", userAgent, "--data-urlencode", "data=" + ql,
          "--write-out", "\nNETWORK_CURL %{http_code} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}"];
        if (transport !== "curl-post") args.push("--get");
        args.push(endpoint);
        let output;
        try { output = await execute("curl", args, { timeout: 7000, maxBuffer: 128 * 1024 }); }
        catch (error) { record.exitCode = error.code; output = error; }
        const text = String(output.stdout || "");
        const marker = text.lastIndexOf("\nNETWORK_CURL ");
        if (marker >= 0) {
          const [status, tcp, tls, firstByte, total] = text.slice(marker + 14).trim().split(/\s+/);
          Object.assign(record, { httpStatus: Number(status), tcpSeconds: Number(tcp),
            tlsSeconds: Number(tls), firstByteSeconds: Number(firstByte), totalSeconds: Number(total) },
          summarize(text.slice(0, marker)));
        }
      }
    } catch (error) { record.outcome = error.code || error.name; }
    log({ ...record, elapsedMs: Date.now() - started });
  }
  log({ event: "complete" });
}

module.exports = { run };
