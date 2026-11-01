"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../android/app/src/main/assets/export-bridge.js"), "utf8");

function browser({ blob = new Blob(["\uFEFFnome,telefone\r\nEmpresa,+5534998883900"], { type: "text/csv;charset=utf-8" }) } = {}) {
  const listeners = [], messages = [], revoked = [];
  let nextUrl = 0;
  const context = {
    window: { ProspectAndroid: { postMessage(value) { messages.push(JSON.parse(value)); } } },
    document: { addEventListener(type, callback) { listeners.push(callback); } },
    location: { origin: "https://prospect-ai-a90q.onrender.com" },
    fetch: async () => { throw new Error("CSP blocks fetch(blob:)"); },
    TextDecoder,
    Blob,
    URL: {
      createObjectURL() { return `blob:https://prospect-ai-a90q.onrender.com/${++nextUrl}`; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  };
  vm.runInNewContext(source, context);
  async function click(overrides = {}) {
    const link = { href: context.URL.createObjectURL(blob), download: "prospect-ai-1793560000000.csv", ...overrides };
    let prevented = false;
    listeners[0]({ target: { closest() { return link; } }, preventDefault() { prevented = true; } });
    await new Promise(resolve => setImmediate(resolve));
    return { prevented, messages };
  }
  return { click, context, listeners, messages, revoked };
}

test("Android CSV exports preserve complete phone numbers and use the native save picker", async () => {
  const { click } = browser();
  const { prevented, messages } = await click();
  assert.equal(prevented, true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "export");
  assert.equal(messages[0].mime, "text/csv");
  assert.equal(messages[0].text, "\uFEFFnome,telefone\r\nEmpresa,+5534998883900");
});
test("Android JSON exports retain provenance and Unicode", async () => {
  const text = JSON.stringify({ attribution: "© OpenStreetMap contributors", results: [{ name: "Nauan Baí", phone: "+5534998883900" }] });
  const { click } = browser({ blob: new Blob([text], { type: "application/json;charset=utf-8" }) });
  const { messages } = await click({ download: "prospect-ai-parcial-1793560000000.json" });
  assert.equal(messages[0].text, text);
  assert.equal(messages[0].mime, "application/json");
});
test("foreign blobs, ordinary links and unexpected filenames do not reach the native exporter", async () => {
  const b = browser();
  for (const change of [{ href: "blob:https://evil.test/id" }, { href: "https://wa.me/5534998883900" }, { download: "../secrets.csv" }, { download: "malware.apk" }]) {
    const result = await b.click(change);
    assert.equal(result.prevented, false);
  }
  assert.equal(b.messages.length, 0);
});
test("oversized exports and MIME mismatches produce no file payload", async () => {
  for (const blob of [new Blob(["a".repeat(8 * 1024 * 1024 + 1)], { type: "text/csv" }), new Blob(["html"], { type: "text/html" })]) {
    const { click } = browser({ blob });
    const { messages } = await click();
    assert.deepEqual(messages, [{ type: "export-error" }]);
  }
});
test("the exporter is installed once per document and never replaces standard browser exports", () => {
  const b = browser(); vm.runInNewContext(source, b.context);
  assert.equal(b.listeners.length, 1);
  const web = { window: {}, document: { addEventListener() { throw new Error("browser should remain unchanged"); } } };
  vm.runInNewContext(source, web);
});
test("native export stays functional under strict CSP while object URLs retain their normal revoke behaviour", async () => {
  const b = browser();
  const image = new Blob(["image fixture"], { type: "image/png" });
  const url = b.context.URL.createObjectURL(image);
  b.context.URL.revokeObjectURL(url);
  assert.deepEqual(b.revoked, [url]);
  assert.equal(b.messages.length, 0);
  const exported = await b.click();
  assert.equal(exported.messages[0].type, "export");
});
