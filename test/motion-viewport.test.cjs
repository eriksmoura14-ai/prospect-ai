"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");

function harness() {
  const bounds = { width: 390, height: 850 };
  const events = {}, draws = [];
  let seeds = 0, allocations = 0, scene, canvas;
  const ctx = { setTransform() {}, clearRect() { draws.length = 0; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc(x, y, radius) { draws.push({ x, y, radius }); } };
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.classList = { toggle() {}, contains: () => false }; }
    setAttribute() {}
    append(value) { this.children.push(value); }
    get clientWidth() { return bounds.width; }
    get clientHeight() { return bounds.height; }
  }
  const document = { hidden: false, body: { prepend(value) { scene = value; }, classList: { toggle() {}, contains: () => false } },
    getElementById: () => null, addEventListener() {}, createElement(tag) {
      const element = new Element();
      if (tag === "canvas") {
        let width, height;
        Object.defineProperties(element, { width: { get: () => width, set(value) { allocations++; width = value; } },
          height: { get: () => height, set(value) { allocations++; height = value; } } });
        element.getContext = () => ctx; canvas = element;
      }
      return element;
    } };
  const media = { matches: false, addEventListener() {} };
  const window = { innerWidth: 390, innerHeight: 780, devicePixelRatio: 3, addEventListener(name, callback) { events[name] = callback; } };
  const math = Object.create(Math); math.random = () => { seeds++; return .3; };
  vm.runInNewContext(fs.readFileSync(require.resolve("../motion.js"), "utf8"), {
    document, window, Math: math, matchMedia: () => media,
    localStorage: { getItem: () => null, setItem() {} }, performance: { now: () => 0 },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}
  });
  return { window, bounds, scene, canvas, draws, resize: events.resize,
    get seeds() { return seeds; }, get allocations() { return allocations; } };
}

test("barra do navegador e teclado não realocam nem recriam o fundo quando a cena mantém seu tamanho", () => {
  const h = harness(), allocations = h.allocations, seeds = h.seeds, revision = h.scene.dataset.layoutRevision;
  for (const height of [700, 850, 780, 420, 850]) { h.window.innerHeight = height; h.resize(); }
  assert.equal(h.allocations, allocations); assert.equal(h.seeds, seeds);
  assert.equal(h.scene.dataset.layoutRevision, revision);
  assert.equal(h.canvas.width, 585); assert.equal(h.canvas.height, 1275);
});

test("rotação real da tela preserva as partículas e reprojeta suas posições", () => {
  const h = harness(), seeds = h.seeds;
  h.bounds.width = 850; h.bounds.height = 390; h.resize();
  assert.equal(h.seeds, seeds); assert.equal(h.scene.dataset.nodeCount, "28");
  const points = h.draws.filter(point => Math.abs(point.radius - 1.43) < .0001);
  assert.equal(points.length, 28);
  for (const point of points) { assert.ok(Math.abs(point.x - 255) < .0001); assert.ok(Math.abs(point.y - 117) < .0001); }
  assert.equal(h.scene.dataset.layoutRevision, "2");
});

test("mudança de densidade de pixels preserva a rede e mantém a resolução limitada", () => {
  const h = harness(), seeds = h.seeds;
  h.window.devicePixelRatio = 1; h.resize();
  assert.equal(h.seeds, seeds); assert.equal(h.canvas.width, 390); assert.equal(h.canvas.height, 850);
  h.window.devicePixelRatio = 4; h.resize();
  assert.equal(h.seeds, seeds); assert.equal(h.scene.dataset.pixelRatio, "1.5");
});
