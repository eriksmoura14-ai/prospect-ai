"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");

// Small DOM fixture: exercise the real menu listeners without a browser keyboard.
function harness(touch = true) {
  const windowEvents = {}, viewportEvents = {};
  const document = { activeElement: null, addEventListener() {} };
  class Element {
    constructor() {
      this.style = {}; this.dataset = {}; this.children = []; this.attributes = {}; this.listeners = {};
      this.classList = { toggle() {} }; this.value = ""; this.scrollTop = 0; this.clientHeight = 180; this.offsetHeight = 44;
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(key, callback) { this.listeners[key] = callback; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; items.forEach((item, i) => { item.offsetTop = i * 44; }); }
    before() {}
    closest() { return {}; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    getBoundingClientRect() { return { top: 200, bottom: 248, left: 20, width: 280 }; }
    focus() { document.activeElement = this; }
  }
  document.createElement = () => new Element(); document.body = new Element();
  const viewport = { height: 800, width: 360, offsetTop: 0, offsetLeft: 0, addEventListener: (name, listener) => { viewportEvents[name] = listener; } };
  const window = { visualViewport: viewport, innerHeight: 800, innerWidth: 360,
    matchMedia: () => ({ matches: touch }), addEventListener: (name, listener) => { windowEvents[name] = listener; } };
  const context = { document, window };
  vm.runInNewContext(fs.readFileSync(require.resolve("../location-picker.js"), "utf8") + "\nglobalThis.Menu = LocationMenu;", context);
  const select = new Element(); select.id = "country"; select.disabled = false;
  select.options = [{ value: "", textContent: "Selecione o país" }, { value: "BR", textContent: "Brasil" }, { value: "CA", textContent: "Canadá" }];
  select.selectedOptions = [select.options[0]];
  const menu = new context.Menu(select, "País");
  return { menu, document, viewport, windowEvents, viewportEvents };
}

test("abrir menu por toque não foca a busca nem abre o teclado automaticamente", () => {
  const { menu, document } = harness(); menu.open();
  assert.equal(menu.popup.hidden, false); assert.equal(document.activeElement, menu.popup);
  assert.notEqual(document.activeElement, menu.query);
});

test("teclado e barra do navegador podem redimensionar a tela sem fechar nem limpar a lista", () => {
  const { menu, viewport, windowEvents, viewportEvents } = harness(); menu.open();
  menu.query.value = "can"; menu.render(); menu.list.scrollTop = 40;
  viewport.height = 320; windowEvents.resize(); viewportEvents.resize();
  assert.equal(menu.popup.hidden, false); assert.equal(menu.query.value, "can");
  assert.equal(menu.items.length, 1); assert.equal(menu.items[0].value, "CA");
  assert.equal(menu.list.scrollTop, 40);
  const top = Number.parseFloat(menu.popup.style.top), height = Number.parseFloat(menu.list.style.maxHeight);
  assert.ok(top >= 12); assert.ok(top + height + 70 <= viewport.height - 12);
  viewport.offsetTop = 100; viewportEvents.scroll();
  assert.ok(Number.parseFloat(menu.popup.style.top) >= 112); assert.equal(menu.popup.hidden, false);
});

test("menu por teclado mantém busca focada e Escape devolve o foco ao seletor", () => {
  const { menu, document } = harness(false); menu.open();
  assert.equal(document.activeElement, menu.query);
  menu.popup.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(menu.popup.hidden, true); assert.equal(document.activeElement, menu.button);
});

test("rolagem da página reposiciona o menu, enquanto um campo oculto fecha sua lista", () => {
  const { menu } = harness(); menu.open();
  menu.position(); assert.equal(menu.popup.hidden, false);
  menu.button.getClientRects = () => []; menu.position(); assert.equal(menu.popup.hidden, true);
});
