"use strict";

function configuration(env) {
  const apiKey = (env.BREVO_API_KEY || "").trim();
  const from = (env.EMAIL_FROM || "").trim();
  if (apiKey.length < 20 || apiKey.length > 512 || /[\r\n]/.test(apiKey)) throw new Error("Configure BREVO_API_KEY no ambiente para enviar confirmações e recuperar senhas.");
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(from) || from.length > 254) throw new Error("EMAIL_FROM deve ser um remetente verificado no serviço de e-mail.");
  return { apiKey, from };
}
function createMailer(config, send = fetch) {
  return async ({ email, purpose, link }) => {
    const activate = purpose === "activate";
    const response = await send("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": config.apiKey },
      body: JSON.stringify({ sender: { name: "Prospect AI", email: config.from }, to: [{ email }],
        subject: activate ? "Confirme seu e-mail no Prospect AI" : "Recupere sua senha do Prospect AI",
        textContent: `${activate ? "Para confirmar seu e-mail e criar sua senha do Prospect AI" : "Para definir uma nova senha do Prospect AI"}, abra este link:\n\n${link}\n\nO link vale por 30 minutos e pode ser usado uma única vez. A senha criada é exclusiva do Prospect AI; não informe a senha do Gmail. Se você não pediu isso, ignore esta mensagem.\n\nProspect AI` }),
      signal: AbortSignal.timeout(10000), redirect: "error"
    });
    await response.body?.cancel();
    if (response.status !== 201) throw new Error("O serviço de e-mail não aceitou o envio.");
  };
}
module.exports = { configuration, createMailer };
