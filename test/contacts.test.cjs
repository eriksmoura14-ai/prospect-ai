"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const contacts = require("../contacts.cjs"), { snapshot } = require("../prospects.cjs");

test("telefone nacional usa o país correto e preserva o zero necessário na Itália", () => {
  for (const [phone, country, number] of [
    ["(11) 91234-5678", "BR", "5511912345678"],
    ["(212) 555-0100", "US", "12125550100"],
    ["020 7946 0958", "GB", "442079460958"],
    ["02 3661 8300", "IT", "390236618300"],
    ["090-1234-5678", "JP", "819012345678"],
    ["030 901820", "DE", "4930901820"]
  ]) assert.equal(contacts.whatsappURL(phone, country), "https://wa.me/" + number);
});

test("código internacional explícito tem prioridade e prefixos de saída são tratados pelo país", () => {
  assert.equal(contacts.whatsappURL("+1 (212) 555-0100", "BR"), "https://wa.me/12125550100");
  assert.equal(contacts.whatsappURL("+44 20 7946 0958"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("011 44 20 7946 0958", "US"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("00 44 20 7946 0958", "DE"), "https://wa.me/442079460958");
});

test("telefones incompletos e texto arbitrário não viram destinatários", () => {
  for (const phone of ["", "123", "(11) 91234-5678", "javascript:alert(5511912345678)",
    "<a href=evil>+5511912345678</a>", "Ligue para +5511912345678", "x".repeat(201), null, {}]) {
    assert.equal(contacts.whatsappURL(phone), "");
  }
  assert.equal(contacts.whatsappURL("123", "BR"), "");
  assert.equal(contacts.whatsappURL("(11) 91234-5678", "ZZ"), "");
});

test("números múltiplos usam o primeiro válido e ramal não vira parte do destinatário", () => {
  assert.equal(contacts.whatsappURL("123; +44 20 7946 0958; +1 212 555 0100", "BR"), "https://wa.me/442079460958");
  assert.equal(contacts.whatsappURL("+1 212 555 0100, +44 20 7946 0958"), "https://wa.me/12125550100");
  assert.equal(contacts.whatsappURL("(11) 91234-5678 ext. 123", "BR"), "https://wa.me/5511912345678");
});

test("metadados do histórico definem o país e URLs fornecidas são recalculadas", () => {
  const job = { discoveryDiagnostics: { geocode: { selected: { address: { country_code: "br" } } }, location: { countryCode: "US" } } };
  const original = { phone: "(11) 91234-5678", whatsappUrl: "https://evil.example/", name: "Empresa" };
  assert.equal(contacts.jobCountry(job), "BR");
  const result = contacts.details(original, contacts.jobCountry(job));
  assert.equal(result.whatsappUrl, "https://wa.me/5511912345678");
  assert.equal(result.phone, original.phone); assert.equal(original.countryCode, undefined);
  assert.equal(contacts.details({ phone: "(212) 555-0100", countryCode: "US" }, "BR").whatsappUrl, "https://wa.me/12125550100");
  assert.equal(contacts.jobCountry({ discoveryDiagnostics: { location: { countryCode: "GB" } } }), "GB");
});

test("listas preservam o país necessário e não aceitam uma URL de contato forjada", () => {
  const company = snapshot({ osmId: "node/1", name: "Empresa", phone: "020 7946 0958", countryCode: "gb", whatsappUrl: "javascript:alert(1)" });
  assert.equal(company.countryCode, "GB"); assert.equal(company.whatsappUrl, "https://wa.me/442079460958");
  assert.equal(contacts.details({ phone: "+1 212 555 0100" }).whatsappUrl, "https://wa.me/12125550100");
  assert.equal(contacts.details({ phone: "020 7946 0958" }).whatsappUrl, "");
});
