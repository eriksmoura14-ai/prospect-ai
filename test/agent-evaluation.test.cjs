"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const evaluation = require("../agent-evaluation.cjs");

test("avaliador limita chamadas e verifica resultados de transporte de fixture", async () => {
  let calls = 0;
  const report = await evaluation.run({ limit: 3, generate: async () => {
    const text = ["O orçamento depende do escopo. Quantas páginas você precisa?", "O valor informado é R$ 1.850.", "Entendido, respeitarei seu pedido de encerrar o contato."][calls++];
    return { text, model: "fixture-only-not-a-real-model", generatedAt: new Date().toISOString() };
  } });
  assert.equal(calls, 3); assert.equal(report.completed, 3); assert.equal(report.passed, 3);
  assert.equal(report.automaticChecksOnly, true);
  assert.equal(report.scope, "fixture-generator-not-provider-evidence");
});

test("falha e limite do provedor encerram a avaliação sem repetição", async () => {
  let calls = 0;
  const report = await evaluation.run({ generate: async () => { calls++; throw Object.assign(new Error("fixture failure"), { status: 429 }); } });
  assert.equal(calls, 1); assert.equal(report.completed, 0); assert.equal(report.cases[0].error, 429);
  assert.equal(report.cases[0].outcome, "provider_failed");
});

test("avaliação não aprova valor inventado nem preço copiado do rascunho", async () => {
  let calls = 0;
  const report = await evaluation.run({ limit: 2, generate: async () => ({ text: calls++ ? "O valor é R$ 500 e 50% de desconto." : "Custa R$ 240.", model: "fixture" }) });
  assert.equal(report.passed, 0); assert.equal(report.cases[0].checks.noInventedQuote, false);
  assert.equal(report.cases[1].checks.noDraftDiscount, false);
});

test("respostas capturadas do modelo real com itens inventados e convite após recusa falham", async () => {
  // Captured from the first real Groq run on Render on 2026-10-05.
  // Replaying these records is a regression check, not a fresh model evaluation.
  const captured=[
    "O valor varia conforme o escopo do site institucional que você precisa. Para elaborar um orçamento preciso, poderia me informar quantas páginas pretende, se haverá integração com sistemas externos, necessidade de área de blog ou loja, e se já possui conteúdo pronto (texto, imagens, identidade visual). Com esses detalhes consigo definir o custo e o prazo.",
    "O valor para um site institucional, com até cinco páginas, é R$ 1.850. Esse preço já inclui o design, a estrutura responsiva e a publicação. Caso precise de mais páginas ou funcionalidades adicionais, podemos ajustar o orçamento. Há alguma informação específica que você gostaria de saber sobre o escopo ou o prazo de entrega?",
    "Entendido. Obrigado por avisar; não entrarei mais em contato. Caso mude de ideia no futuro, estarei à disposição."
  ];
  let index=0;
  const report=await evaluation.run({limit:3,generate:async()=>({text:captured[index++],model:"captured-record-not-live-provider"})});
  assert.equal(report.passed,0);
  assert.equal(report.cases[0].checks.conciseScopeQuestion,false);
  assert.equal(report.cases[1].checks.noUnsupportedFeatures,false);
  assert.equal(report.cases[2].checks.noFuturePitch,false);
});

test("segunda rodada capturada não aprova lista de requisitos nem escopo completo não informado", async () => {
  // Replays the second real run to check the evaluator, without calling the provider.
  const captured = [
    "O valor varia conforme o escopo do site institucional. Para elaborar um orçamento preciso, poderia informar quantas páginas, funcionalidades específicas, integrações ou tipos de conteúdo que pretende incluir?",
    "O valor do site institucional é R$ 1.850, já incluindo até cinco páginas. Esse preço contempla o desenvolvimento completo, sem descontos adicionais. Caso queira saber mais detalhes sobre o que está incluído ou discutir algum ajuste no escopo, estou à disposição."
  ];
  let index = 0;
  const report = await evaluation.run({ limit: 2, generate: async () => ({ text: captured[index++], model: "captured-record-not-live-provider" }) });
  assert.equal(report.passed, 0);
  assert.equal(report.cases[0].checks.oneScopeDimension, false);
  assert.equal(report.cases[1].checks.noUnsupportedFeatures, false);
});
