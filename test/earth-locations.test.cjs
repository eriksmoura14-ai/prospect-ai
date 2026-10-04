"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const locations = require("../locations.cjs");

function assertCoordinates(row) {
  assert.ok(row, "The selected real location exists");
  assert.equal(typeof row.latitude, "number");
  assert.equal(typeof row.longitude, "number");
  assert.ok(Number.isFinite(row.latitude) && Math.abs(row.latitude) <= 90);
  assert.ok(Number.isFinite(row.longitude) && Math.abs(row.longitude) <= 180);
  assert.ok(row.latitude !== 0 || row.longitude !== 0);
}

test("globe targets use real city coordinates on different continents", async () => {
  for (const [country, state, id, latitude, longitude] of [
    ["BR", "MG", 15434, -19.02333, -48.33477],
    ["US", "NY", 122795, 40.71427, -74.00597],
    ["JP", "13", 64500, 35.6895, 139.69171],
    ["AU", "NSW", 7408, -33.86785, 151.20732],
    ["KE", "30", 64845, -1.28333, 36.81667],
    ["DE", "BE", 24053, 52.52437, 13.41053]
  ]) {
    const city = (await locations.listCities(country, state)).find(row => row.id === id);
    assertCoordinates(city);
    assert.equal(city.latitude, latitude);
    assert.equal(city.longitude, longitude);
  }
});

test("missing and known misplaced dataset targets are omitted without removing selections", async () => {
  const countries = await locations.listCountries();
  assert.equal(countries.length, 250);
  for (const country of countries) {
    if (country.code === "UM") {
      assert.ok(!("latitude" in country));
      assert.ok(!("longitude" in country));
    } else assertCoordinates(country);
  }
  for (const state of await locations.listStates("SG")) {
    if (["02", "05"].includes(state.code)) {
      assert.ok(!("latitude" in state));
      assert.ok(!("longitude" in state));
    } else assertCoordinates(state);
  }
  for (const state of (await locations.listStates("US")).filter(row => ["AE", "AA", "AP"].includes(row.code))) {
    assert.ok(!("latitude" in state));
    assert.ok(!("longitude" in state));
  }
});

test("visual coordinates do not turn blank, invalid or out-of-range data into a target", async () => {
  const rows = [
    [null, null], ["", ""], ["  ", "  "], [false, true], [undefined, undefined],
    ["NaN", "10"], [Infinity, 10], ["91", "0"], ["0", "-181"], ["0", "0"],
    ["-33.8", "151.2"]
  ].map(([latitude, longitude], index) => ({
    iso2: String(index), name: `Region ${index}`, latitude, longitude
  }));
  const fakeDatabase = {
    getCountries: async () => [{ iso2: "AU", name: "Australia", latitude: "-27", longitude: "133" }],
    getStatesOfCountry: async () => rows
  };
  const context = { module: { exports: {} }, require: () => fakeDatabase, Intl };
  vm.runInNewContext(fs.readFileSync(require.resolve("../locations.cjs"), "utf8"), context);
  const states = await context.module.exports.listStates("AU");
  for (const state of states.slice(0, -1)) {
    assert.ok(!("latitude" in state));
    assert.ok(!("longitude" in state));
  }
  assertCoordinates(states.at(-1));
});

function pickerHarness(api) {
  class Element {
    constructor() { this.value = ""; this.children = []; this.listeners = {}; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; }
  }
  const ids = ["country", "region", "city", "manual-region", "manual-city", "location-status",
    "location-retry", "manual-region-label", "manual-city-label"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const submit = new Element();
  const events = [];
  const context = {
    document: { getElementById: id => elements[id], querySelector: () => submit },
    window: { dispatchEvent: event => events.push(JSON.parse(JSON.stringify(event.detail))) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    Option: class { constructor(label, value) { this.label = label; this.value = value; } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../location-picker.js"), "utf8") +
    "\nglobalThis.Picker = LocationPicker;", context);
  return { picker: new context.Picker({ api, isLocked: () => false }), elements, events };
}

const countryRows = [
  { code: "BR", name: "Brazil", labelpt: "Brasil", latitude: -10, longitude: -55 },
  { code: "US", name: "United States", labelpt: "Estados Unidos", latitude: 38, longitude: -97 }
];
const stateRows = {
  BR: [
    { code: "MG", name: "Minas Gerais", latitude: -18.5264844, longitude: -44.1588654 },
    { code: "EMPTY", name: "No coordinates" }
  ],
  US: [{ code: "NY", name: "New York", latitude: 40.7127753, longitude: -74.0059728 }]
};
const cityRows = {
  BR: [
    { id: 15434, name: "Uberlândia", latitude: -19.02333, longitude: -48.33477 },
    { id: 999, name: "No coordinates", latitude: null, longitude: null }
  ],
  US: [{ id: 122795, name: "New York City", latitude: 40.71427, longitude: -74.00597 }]
};

async function fixtureApi(path) {
  if (path === "/api/locations/countries") return countryRows;
  const url = new URL(path, "http://localhost");
  const country = url.searchParams.get("country");
  return url.pathname.endsWith("/states") ? stateRows[country] : cityRows[country];
}

test("globe follows country, state and city selections while keeping the search payload unchanged", async () => {
  const { picker, elements, events } = pickerHarness(fixtureApi);
  await picker.initialize();
  assert.equal(events.at(-1), null);
  elements.country.value = "BR";
  await picker.loadStates();
  assert.deepEqual(events.at(-1), {
    latitude: -10, longitude: -55, stage: "country", label: "Brasil", countryCode: "BR"
  });
  elements.region.value = "MG";
  await picker.loadCities();
  assert.equal(events.at(-1).stage, "state");
  assert.equal(events.at(-1).label, "Minas Gerais");
  elements.city.value = "15434";
  picker.sync();
  assert.deepEqual(events.at(-1), {
    latitude: -19.02333, longitude: -48.33477, stage: "city", label: "Uberlândia", countryCode: "BR"
  });
  assert.deepEqual(JSON.parse(JSON.stringify(picker.payload())), {
    countryCode: "BR", stateCode: "MG", cityId: 15434
  });
  const count = events.length;
  picker.sync();
  assert.equal(events.length, count, "Repeated UI updates should not restart the flight");
  elements.country.value = "US";
  await picker.loadStates();
  assert.equal(events.at(-1).stage, "country");
  assert.equal(events.at(-1).countryCode, "US");
  assert.equal(elements.city.value, "");
  elements.country.value = "";
  await picker.loadStates();
  assert.equal(events.at(-1), null);
});

test("manual and missing city or state targets keep the closest valid parent", async () => {
  const { picker, elements, events } = pickerHarness(fixtureApi);
  await picker.initialize();
  elements.country.value = "BR";
  await picker.loadStates();
  elements.region.value = "MG";
  await picker.loadCities();
  elements.city.value = "999";
  picker.sync();
  assert.equal(events.at(-1).stage, "state");
  elements.city.value = "__manual__";
  elements["manual-city"].value = "My town";
  picker.sync();
  assert.equal(events.at(-1).stage, "state");
  elements.region.value = "EMPTY";
  await picker.loadCities();
  assert.equal(events.at(-1).stage, "country");
  elements.region.value = "__manual__";
  await picker.loadCities();
  elements["manual-region"].value = "My province";
  elements["manual-city"].value = "My town";
  picker.sync();
  assert.equal(events.at(-1).stage, "country");
  assert.equal(events.at(-1).label, "Brasil");
});

test("a stale country list response cannot move the globe back to a previous country", async () => {
  let finishBrazil;
  const { picker, elements, events } = pickerHarness(async path => {
    if (path.includes("/states?country=BR")) return new Promise(resolve => { finishBrazil = resolve; });
    return fixtureApi(path);
  });
  await picker.initialize();
  elements.country.value = "BR";
  const first = picker.loadStates();
  elements.country.value = "US";
  await picker.loadStates();
  const count = events.length;
  finishBrazil(stateRows.BR);
  await first;
  assert.equal(events.length, count);
  assert.equal(events.at(-1).countryCode, "US");
  assert.equal(picker.regions[0].code, "NY");
});
