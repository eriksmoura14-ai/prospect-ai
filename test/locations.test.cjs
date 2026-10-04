"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const locations = require("../locations.cjs");

const invalid = error => error.status === 400 && error.code === "LOCATION_INVALID";
const brazil = { countryCode: "BR", stateCode: "MG", cityId: 15434 };
const newYork = { countryCode: "US", stateCode: "NY", cityId: 122795 };

test("location countries use real ISO codes and Portuguese labels", async () => {
  const countries = await locations.listCountries();
  assert.equal(countries.length, 250);
  assert.deepEqual(countries.find(country => country.code === "BR"), {
    code: "BR", name: "Brazil", labelpt: "Brasil", latitude: -10, longitude: -55
  });
  assert.equal(countries.find(country => country.code === "US").labelpt, "Estados Unidos");
  countries.find(country => country.code === "BR").name = "changed";
  assert.equal((await locations.listCountries()).find(country => country.code === "BR").name, "Brazil");
});

test("real location dataset contains Brazil / Minas Gerais / Uberlândia", async () => {
  const states = await locations.listStates("BR");
  assert.equal(states.length, 27);
  assert.deepEqual(states.find(state => state.code === "MG"), {
    code: "MG", name: "Minas Gerais", latitude: -18.5264844, longitude: -44.1588654
  });
  const cities = await locations.listCities("BR", "MG");
  assert.deepEqual(cities.find(city => city.id === 15434), {
    id: 15434, name: "Uberlândia", latitude: -19.02333, longitude: -48.33477
  });
  const { stateIsoPeers, ...selection } = await locations.resolveSelection(brazil);
  assert.ok(stateIsoPeers.includes("BR-SP"));
  assert.deepEqual(selection, {
    query: "Uberlândia, Minas Gerais, Brazil",
    countryCode: "BR", cityName: "Uberlândia", stateName: "Minas Gerais", countryName: "Brazil",
    stateCode: "MG", stateNative: "Minas Gerais", stateIso: "BR-MG"
  });
});

test("real location dataset resolves United States / New York / New York City", async () => {
  const { stateIsoPeers, ...selection } = await locations.resolveSelection(newYork);
  assert.ok(stateIsoPeers.includes("US-TX"));
  assert.deepEqual(selection, {
    query: "New York City, New York, United States",
    countryCode: "US", cityName: "New York City", stateName: "New York", countryName: "United States",
    stateCode: "NY", stateNative: "New York", stateIso: "US-NY"
  });
});

test("location selector rejects cities from another country or state", async () => {
  await assert.rejects(locations.resolveSelection({ ...brazil, cityId: newYork.cityId }), invalid);
  await assert.rejects(locations.resolveSelection({ ...newYork, cityId: brazil.cityId }), invalid);
  await assert.rejects(locations.resolveSelection({ ...brazil, stateCode: "SP" }), invalid);
  await assert.rejects(locations.listCities("US", "MG"), invalid);
});

test("location codes and city identifiers reject malformed values", async () => {
  for (const code of ["br", " BR", "ZZ", "../BR", 31, null]) {
    await assert.rejects(locations.listStates(code), invalid);
  }
  for (const code of ["mg", "../MG", "", null]) {
    await assert.rejects(locations.listCities("BR", code), invalid);
  }
  for (const cityId of ["15434", 0, -1, 15434.5, Number.MAX_SAFE_INTEGER + 1, NaN, null]) {
    await assert.rejects(locations.resolveSelection({ ...brazil, cityId }), invalid);
  }
});

test("manual Unicode city keeps the selected country and state in the query", async () => {
  const location = await locations.resolveSelection({
    countryCode: "EG", stateCode: "C", cityId: "__manual__", manualCity: "  القاهرة  "
  });
  assert.equal(location.cityName, "القاهرة");
  assert.equal(location.countryCode, "EG");
  assert.equal(location.stateName, "Cairo");
  assert.equal(location.stateNative, "القاهرة");
  assert.equal(location.stateIso, "EG-C");
  assert.equal(location.stateCode, "C");
  assert.equal(location.query, "القاهرة, Cairo, Egypt");
});

test("a country with no states supports an explicit manual city", async () => {
  assert.deepEqual(await locations.listStates("GI"), []);
  assert.deepEqual(await locations.listCities("GI", "__none__"), []);
  const location = await locations.resolveSelection({
    countryCode: "GI", stateCode: "__none__", cityId: "__manual__", manualCity: "Gibraltar"
  });
  assert.equal(location.query, "Gibraltar");
  assert.equal(location.stateName, "");
  assert.equal(location.stateNative, "");
  assert.equal(location.stateIso, "");
  assert.equal(location.stateCode, "__none__");
  await assert.rejects(locations.resolveSelection({ countryCode: "GI", stateCode: "__none__", cityId: 15434 }), invalid);
});

test("no-state option cannot skip a country that has states", async () => {
  await assert.rejects(locations.listCities("BR", "__none__"), invalid);
  await assert.rejects(locations.resolveSelection({
    countryCode: "BR", stateCode: "__none__", cityId: "__manual__", manualCity: "Uberlândia"
  }), invalid);
});

test("an uncatalogued state requires an explicit manual state and city", async () => {
  assert.deepEqual(await locations.listCities("BR", "__manual__"), []);
  const location = await locations.resolveSelection({
    countryCode: "BR", stateCode: "__manual__", manualState: "Região nova",
    cityId: "__manual__", manualCity: "Cidade nova"
  });
  assert.equal(location.query, "Cidade nova, Região nova, Brazil");
  assert.equal(location.stateNative, "Região nova");
  assert.equal(location.stateIso, "");
  assert.equal(location.stateCode, "__manual__");
  await assert.rejects(locations.resolveSelection({
    countryCode: "BR", stateCode: "__manual__", manualState: "Minas Gerais",
    cityId: "__manual__", manualCity: "Uberlândia"
  }), invalid);
  await assert.rejects(locations.resolveSelection({
    countryCode: "BR", stateCode: "__manual__", manualState: "MG",
    cityId: "__manual__", manualCity: "Uberlândia"
  }), invalid);
  await assert.rejects(locations.resolveSelection({
    countryCode: "BR", stateCode: "__manual__", manualState: "Região nova", cityId: 15434
  }), invalid);
});

test("manual names validate Unicode length and control characters", async () => {
  for (const manualCity of ["", " ", "a".repeat(101), "Rome\n", "\tRoma", "A\u0000B", "A\u202eB", "A\u2028B", "A\ud800B", null]) {
    await assert.rejects(locations.resolveSelection({ ...brazil, cityId: "__manual__", manualCity }), invalid);
  }
  const location = await locations.resolveSelection({
    ...brazil, cityId: "__manual__", manualCity: "  Sa\u0303o Paulo  "
  });
  assert.equal(location.cityName, "São Paulo");
  for (const manualState of [undefined, "", "a", "a".repeat(101), "State\n"]) {
    await assert.rejects(locations.resolveSelection({
      countryCode: "BR", stateCode: "__manual__", manualState,
      cityId: "__manual__", manualCity: "Nova cidade"
    }), invalid);
  }
});

test("cidades com um caractere e cidade/estado homônimos mantêm seleção completa", async () => {
  const short = await locations.resolveSelection({ ...brazil, cityId: "__manual__", manualCity: "津" });
  assert.equal(short.cityName, "津");
  const berlin = await locations.resolveSelection({ countryCode: "DE", stateCode: "BE", cityId: "__manual__", manualCity: "Berlin" });
  assert.equal(berlin.query, "Berlin, Germany");
  assert.equal(berlin.stateName, "Berlin");
  assert.equal(berlin.stateIso, "DE-BE");
});

test("invalid selection objects fail with a client error", async () => {
  for (const selection of [null, undefined, "BR", [], {}]) {
    await assert.rejects(locations.resolveSelection(selection), invalid);
  }
});

test("location attribution identifies the versioned ODbL source", () => {
  assert.equal(locations.attribution.license, "ODbL-1.0");
  assert.equal(locations.attribution.version, "1.0.9");
  assert.equal(locations.attribution.url, "https://github.com/dr5hn/countries-states-cities-database");
});
