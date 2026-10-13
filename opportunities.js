"use strict";
(() => {
  const dialog = document.getElementById("strategy-dialog");
  const body = document.getElementById("strategy-content");
  const status = document.getElementById("strategy-status");
  const copy = async (text, feedback) => {
    try { await navigator.clipboard.writeText(text); feedback.textContent = "Copiado. Revise antes de usar."; }
    catch { feedback.textContent = "Selecione o texto e use Copiar no seu navegador."; }
  };
  window.prospectCopy = copy;
  window.prospectStrategy = (row, jobId, selected, settings = {}) => {
    const plan = ProspectOpportunities.analyze(row, selected, settings);
    document.getElementById("strategy-title").textContent = row.name;
    document.getElementById("strategy-subtitle").textContent = `${plan.label} · ${row.city || "Local não informado"}`;
    body.replaceChildren(); status.textContent = "";
    const evidence = node("section", "strategy-block");
    evidence.append(node("span", "section-kicker", "01 · OPORTUNIDADE"), node("h3", "", plan.title), node("p", "", plan.evidence));
    const draft = node("section", "strategy-block");
    const text = node("p", "approach-text", plan.draft);
    const copyButton = node("button", "", "Copiar abordagem"); copyButton.type = "button";
    copyButton.addEventListener("click", () => void copy(plan.draft, status));
    draft.append(node("span", "section-kicker", "02 · PRIMEIRA CONVERSA"), text, copyButton);
    const steps = node("section", "strategy-block");
    const list = node("ol"); for (const step of plan.checklist) list.append(node("li", "", step));
    steps.append(node("span", "section-kicker", "03 · PRÓXIMOS PASSOS"), list);
    const price = node("p", "strategy-price", "Defina o preço após conhecer o escopo, o prazo e os custos. Não há orçamento confirmado para esta empresa.");
    body.append(evidence, draft, steps, price);
    const ai = document.getElementById("strategy-ai");
    ai.disabled = !jobId;
    ai.onclick = () => { dialog.close(); window.dispatchEvent(new CustomEvent("prospect:chat-company", { detail: { row, jobId, prompt: plan.prompt } })); };
    dialog.showModal();
  };
  document.getElementById("strategy-close").addEventListener("click", () => dialog.close());
  window.addEventListener("prospect:session-expired", () => { dialog.close(); body.replaceChildren(); status.textContent = ""; });
})();
