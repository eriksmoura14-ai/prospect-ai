"use strict";
// Presentation-only recommendations. A missing field is never proof of a need.
(function (root) {
  const stages = Object.freeze({ new: "Novo", contacted: "Contatado", replied: "Respondeu", interested: "Interessado", proposal: "Proposta enviada", won: "Fechado", lost: "Sem interesse" });
  const services = Object.freeze({ website: "Sites e landing pages", social: "Gestão de redes sociais", design: "Design e identidade visual", ads: "Tráfego pago", automation: "Automação e atendimento" });
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  function service(value) { return Object.hasOwn(services, value) ? value : "website"; }
  function analyze(row, selected = "website", settings = {}) {
    selected = service(selected);
    let usableSite = false;
    try { const url = new URL(row.website); usableSite = ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch {}
    const missing = !usableSite && (row.websiteVerification === "not_identified" || row.status === "LIKELY_NO_WEBSITE");
    const compatible = usableSite && row.websiteVerification === "compatible";
    const conflict = row.phoneVerification === "conflict";
    const contact = Boolean(String(row.phone || "").trim()) && !conflict;
    let title, evidence, question;
    if (selected === "website") {
      title = missing ? "Vale investigar a presença digital" : compatible ? "Explore a experiência no site" : "Confirme a presença digital";
      evidence = missing ? "Nenhum site foi identificado na consulta. Confirme com a empresa antes de oferecer um projeto." : compatible ? "Foi encontrado um site com identidade compatível. O desempenho e a qualidade ainda precisam ser avaliados." : "Os dados disponíveis não permitem concluir se a empresa precisa de um site.";
      question = missing ? "Vocês já têm um site para apresentar os serviços e receber pedidos de orçamento?" : "Como vocês recebem contatos pelo site hoje? Há algo nesse processo que gostariam de melhorar?";
    } else {
      const ideas = {
        social: ["Entenda a rotina das redes sociais", "Como vocês organizam as publicações e os contatos que chegam pelas redes sociais?"],
        design: ["Descubra os objetivos da marca", "Vocês estão planejando renovar a identidade visual ou algum material de divulgação?"],
        ads: ["Valide a estratégia de aquisição", "Hoje vocês investem em anúncios? Qual resultado gostariam de melhorar?"],
        automation: ["Mapeie o atendimento", "Qual parte do atendimento ou dos pedidos toma mais tempo da equipe hoje?"]
      };
      [title, question] = ideas[selected];
      evidence = "A fonte identifica o negócio, mas não demonstra necessidade deste serviço. Comece com uma pergunta de diagnóstico.";
    }
    const seller = String(settings.seller || "").trim();
    const offer = String(settings.offer || "").trim() || services[selected].toLocaleLowerCase("pt-BR");
    const intro = seller ? `Sou ${seller} e trabalho com ${offer}.` : `Trabalho com ${offer}.`;
    const draft = `Olá, equipe da ${row.name || "empresa"}! ${intro} ${question} Se fizer sentido, posso compartilhar uma ideia breve por aqui?`;
    // Readiness describes available evidence/contact, not buying likelihood.
    const priority = (contact ? 30 : 0) + (conflict ? -30 : 0) + (selected === "website" && missing ? 40 : 0) + (compatible ? 10 : 0);
    const next = conflict ? "Compare os telefones nas fontes antes de qualquer contato." : !contact ? "Procure um canal comercial publicado na fonte ou no site." : "Confira o destinatário e envie uma primeira pergunta curta, se o canal aceitar contato comercial.";
    return { selected, label: services[selected], title, evidence, question, draft, priority, contact, conflict, next,
      checklist: ["Confirme o nome da empresa e a atualização do cadastro.", next, "Entenda a necessidade antes de propor escopo e preço.", "Registre a resposta e o próximo passo na sua lista."],
      prompt: `Quero oferecer ${offer} para ${row.name || "esta empresa"}. ${evidence} Prepare uma estratégia com diagnóstico, primeira abordagem e próximos passos. Separe fatos de hipóteses; não invente avaliações, preços ou resultados.` };
  }
  const model = Object.freeze({ stages, services, service, normalize, analyze });
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else root.ProspectOpportunities = model;
})(typeof globalThis !== "undefined" ? globalThis : this);
