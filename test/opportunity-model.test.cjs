"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const model = require("../opportunity-model.js");
const { details, STATUSES } = require("../prospects.cjs");
const lead = { name: "Oficina São José", city: "São Paulo", phone: "+5511912345678", websiteVerification: "not_identified", status: "LIKELY_NO_WEBSITE" };
test("website opportunity distinguishes missing evidence from proven absence", () => {
  const plan = model.analyze(lead);
  assert.match(plan.evidence, /consulta.*Confirme/);
  assert.match(plan.draft, /Vocês já têm um site/);
  assert.equal(plan.contact, true);
  assert.ok(plan.priority > model.analyze({ ...lead, phone: "" }).priority);
  assert.doesNotMatch(plan.draft, /não têm|sem site|garant|R\$|\d+%/);
});
test("non-website offers never infer advertising, branding or social quality from OSM", () => {
  for (const selected of ["social", "ads", "design", "automation"]) {
    const plan = model.analyze(lead, selected);
    assert.match(plan.evidence, /não demonstra necessidade/);
    assert.match(plan.draft, /\?/);
    assert.equal(plan.priority, model.analyze({ ...lead, website: "https://example.test", websiteVerification: "compatible" }, selected).priority - 10);
  }
});
test("divergent phones lose contact readiness and never rank ahead of consistent peers", () => {
  const conflicting = model.analyze({ ...lead, phoneVerification: "conflict" });
  assert.equal(conflicting.contact, false); assert.equal(conflicting.conflict, true);
  assert.match(conflicting.next, /Compare os telefones/);
  assert.ok(conflicting.priority < model.analyze(lead).priority);
});
test("invalid published phone format does not add contact readiness", () => {
  const invalid = model.analyze({ ...lead, phone: "123", phoneFormat: "needs_review" });
  assert.equal(invalid.contact, false);
  assert.equal(invalid.priority, model.analyze({ ...lead, phone: "" }).priority);
  assert.match(invalid.next, /Procure um canal/);
});
test("unsafe URLs are not compatible website evidence; offer text is preserved literally", () => {
  for (const website of ["javascript:alert(1)", "https://user:pass@example.test"]) {
    const plan = model.analyze({ ...lead, website, websiteVerification: "compatible" }, "website", { seller: "Erik", offer: "<img onerror=x>" });
    assert.doesNotMatch(plan.evidence, /encontrado um site com identidade/);
    assert.match(plan.draft, /Sou Erik/); assert.match(plan.draft, /<img onerror=x>/);
  }
  assert.equal(model.service("__proto__"), "website");
  assert.equal(model.normalize("São JOSÉ"), "sao jose");
});
test("all new sales stages pass strict note validation, existing stages stay valid", () => {
  assert.deepEqual(STATUSES, Object.keys(model.stages));
  for (const status of STATUSES) assert.deepEqual(details({ status, note: "Texto do usuário" }), { status, note: "Texto do usuário" });
  assert.throws(() => details({ status: "winner", note: "" }), error => error.status === 400);
  assert.throws(() => details({ status: "won", note: "", price: 500 }), error => error.status === 400);
});
