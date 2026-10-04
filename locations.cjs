"use strict";

// This module uses the versioned ODbL location dataset only for selection names.
// The existing geocoder remains responsible for resolving the complete search area.
const database = require("@countrystatecity/countries");

const attribution = Object.freeze({
  name: "Countries States Cities Database",
  url: "https://github.com/dr5hn/countries-states-cities-database",
  license: "ODbL-1.0",
  licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  version: "1.0.9"
});
const MANUAL = "__manual__";
const NO_STATE = "__none__";
const displayNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
let countriesPromise;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "LOCATION_INVALID";
  return error;
}

function countryCode(value) {
  if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) {
    throw invalid("Selecione um país válido.");
  }
  return value;
}

function stateCode(value) {
  if (typeof value !== "string" || !/^[A-Z0-9-]{1,12}$/.test(value)) {
    throw invalid("Selecione um estado ou província válido.");
  }
  return value;
}

function manualName(value, label, minimum = 2) {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) {
    throw invalid(`Informe ${label} sem caracteres de controle.`);
  }
  const name = value.trim().normalize("NFC");
  const length = Array.from(name).length;
  if (length < minimum || length > 100) {
    throw invalid(`Informe ${label} com ${minimum} a 100 caracteres.`);
  }
  return name;
}

function labelKey(name) {
  return name.normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

async function listCountries() {
  if (!countriesPromise) {
    countriesPromise = database.getCountries().then(rows => rows.map(row => ({
      code: row.iso2,
      name: row.name,
      labelpt: displayNames.of(row.iso2) || row.name
    })).sort((left, right) => left.labelpt.localeCompare(right.labelpt, "pt-BR")));
  }
  return (await countriesPromise).map(row => ({ ...row }));
}

async function getCountry(code) {
  countryCode(code);
  const country = (await listCountries()).find(row => row.code === code);
  if (!country) throw invalid("Selecione um país cadastrado.");
  return country;
}

async function listStates(code) {
  await getCountry(code);
  return (await database.getStatesOfCountry(code)).map(row => ({
    code: row.iso2,
    name: row.name
  }));
}

async function getState(code, selected) {
  const states = await listStates(code);
  if (selected === NO_STATE) {
    if (states.length) throw invalid("Este país possui estados ou províncias; selecione um deles.");
    return null;
  }
  if (selected === MANUAL) return null;
  stateCode(selected);
  const state = states.find(row => row.code === selected);
  if (!state) throw invalid("O estado ou província não pertence ao país selecionado.");
  const record = await database.getStateByCode(code, selected);
  return {
    ...state,
    native: record && record.native || state.name,
    iso: record && record.iso3166_2 || "",
    type: record && record.type || ""
  };
}

async function listCities(code, selectedState) {
  const state = await getState(code, selectedState);
  if (!state) return [];
  return (await database.getCitiesOfState(code, selectedState)).map(row => ({
    id: row.id,
    name: row.name
  }));
}

async function resolveSelection(selection) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw invalid("Selecione país, estado ou província e cidade.");
  }
  const selectedCountry = await getCountry(selection.countryCode);
  const states = await listStates(selectedCountry.code);
  let stateName = "";
  let selectedState = null;

  if (selection.stateCode === MANUAL) {
    stateName = manualName(selection.manualState, "o estado ou província");
    const key = labelKey(stateName);
    if (states.some(state => labelKey(state.name) === key || labelKey(state.code) === key)) {
      throw invalid("Esse estado ou província já está na lista; selecione-o.");
    }
  } else {
    selectedState = await getState(selectedCountry.code, selection.stateCode);
    stateName = selectedState ? selectedState.name : "";
  }

  let cityName;
  if (selection.cityId === MANUAL) {
    cityName = manualName(selection.manualCity, "a cidade", 1);
  } else {
    if (!selectedState) {
      throw invalid("Informe a cidade manualmente para esse estado ou país.");
    }
    if (!Number.isSafeInteger(selection.cityId) || selection.cityId <= 0) {
      throw invalid("Selecione uma cidade válida.");
    }
    const city = (await listCities(selectedCountry.code, selection.stateCode))
      .find(row => row.id === selection.cityId);
    if (!city) throw invalid("A cidade não pertence ao estado e país selecionados.");
    cityName = city.name;
  }

  // Cidade e subdivisão homônimas não devem virar uma consulta duplicada (Tokyo, Tokyo).
  const parts = [cityName, stateName, selectedCountry.name].filter(Boolean);
  const query = parts.filter((part, index) => index === 0 || labelKey(part) !== labelKey(parts[index - 1])).join(", ");
  if (Array.from(query).length > 300) throw invalid("A localização selecionada é muito longa.");
  return {
    query,
    countryCode: selectedCountry.code,
    cityName,
    stateName,
    stateCode: selection.stateCode,
    stateNative: selectedState ? selectedState.native : stateName,
    stateIso: selectedState ? selectedState.iso : "",
    stateIsoPeers: selectedState ? (await database.getStatesOfCountry(selectedCountry.code))
      .filter(state => state.type === selectedState.type && state.iso3166_2)
      .map(state => state.iso3166_2) : [],
    countryName: selectedCountry.name
  };
}

module.exports = { listCountries, listStates, listCities, resolveSelection, attribution };
