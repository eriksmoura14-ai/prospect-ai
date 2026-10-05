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
