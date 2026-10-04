"use strict";

function configuration(env) {
  if (env.APP_HOSTED != null && !["true", "false"].includes(env.APP_HOSTED)) {
    throw new Error("APP_HOSTED deve ser true ou false.");
  }
  // O Render continua protegido mesmo se APP_HOSTED=false for configurado.
  const hosted = env.APP_HOSTED === "true" || env.RENDER === "true";
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT deve ser uma porta TCP válida.");
  }
  const externalOrigin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (hosted && !externalOrigin) {
    throw new Error("Configure APP_ORIGIN com a URL pública HTTPS da aplicação.");
  }
  const url = new URL(externalOrigin || `http://127.0.0.1:${port}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("APP_ORIGIN deve ser uma URL HTTP(S), sem credenciais.");
  }
  return { hosted, port, origin: url.origin, bind: hosted ? "0.0.0.0" : "127.0.0.1" };
}

module.exports = { configuration };
