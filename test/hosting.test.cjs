"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { configuration } = require("../hosting.cjs");

test("modo local permanece restrito ao loopback", () => {
  assert.deepEqual(configuration({}), { hosted: false, port: 3000,
    origin: "http://127.0.0.1:3000", bind: "127.0.0.1" });
});
test("hospedagem fora do Render escuta externamente com origem explícita", () => {
  assert.deepEqual(configuration({ APP_HOSTED: "true", PORT: "8080", APP_ORIGIN: "https://prospect.example/" }),
    { hosted: true, port: 8080, origin: "https://prospect.example", bind: "0.0.0.0" });
});
test("Render preserva origem, bind e modo protegido", () => {
  assert.equal(configuration({ RENDER: "true", APP_HOSTED: "false", PORT: "10000",
    RENDER_EXTERNAL_URL: "https://test.onrender.com" }).hosted, true);
});
test("hospedagem não aceita origem ausente, esquema inválido ou credencial na URL", () => {
  for (const APP_ORIGIN of [undefined, "file:///tmp/site", "https://user:fixture@prospect.example/"]) {
    assert.throws(() => configuration({ APP_HOSTED: "true", APP_ORIGIN }));
  }
});
test("booleanos e portas inválidos não abrem serviço incorreto", () => {
  assert.throws(() => configuration({ APP_HOSTED: "1" }));
  for (const PORT of ["NaN", "-1", "0", "65536", "3.5"]) assert.throws(() => configuration({ PORT }));
});
