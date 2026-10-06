"use strict";

// Pure geocoder compatibility rules. Alternative wording never changes the
// selected country/subdivision or the returned complete search boundary.
const normalize = value => String(value || "").normalize("NFKD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function stateMatch(place, selection) {
  if (!selection) return true;
  const address = place.address || {};
  if (String(address.country_code || "").toUpperCase() !== selection.countryCode) return false;
  if (!selection.stateName) return true;
  const codes = Object.entries(address).filter(([key]) => key.startsWith("ISO3166-2-"))
    .map(([, value]) => String(value).toUpperCase());
  const ownCode = place.extratags?.["ISO3166-2"];
  if (typeof ownCode === "string") codes.push(ownCode.toUpperCase());
  // LocationIQ exposes this documented field only when statecode=1 is sent.
  if (typeof address.state_code === "string") {
    const value = address.state_code.toUpperCase();
    codes.push(value.startsWith(selection.countryCode + "-") ? value : selection.countryCode + "-" + value);
  }
  // A contradictory peer at any administrative level takes precedence over
  // translated names or another matching code. Counties are not state peers.
  if (selection.stateIsoPeers?.some(code => code !== selection.stateIso && codes.includes(code))) return false;
  if (selection.stateIso && codes.includes(selection.stateIso)) return true;
  const aliases = [selection.stateName, selection.stateNative].filter(Boolean).map(normalize);
  return Object.entries(address).some(([key, value]) =>
    /^(state|province|region|county|district|state_district|municipality)$/.test(key) && aliases.includes(normalize(value)));
}

function names(place) {
  const values = [place.name, typeof place.display_name === "string" ? place.display_name.split(",")[0] : ""];
  for (const [key, value] of Object.entries(place.namedetails || {}).slice(0,100)) {
    if (/^(name|official_name|short_name|alt_name|loc_name|int_name)(:|$)/.test(key) && typeof value === "string") {
      values.push(...value.slice(0,2000).split(";").slice(0,20));
    }
  }
  // Older LocationIQ results may omit a top-level name/display_name.
  if (!values.some(Boolean)) for (const key of ["city","town","village","municipality","borough","hamlet"]) {
    if (place.address?.[key]) { values.push(place.address[key]); break; }
  }
  return [...new Set(values.filter(value => typeof value === "string").map(normalize).filter(Boolean))];
}

function cityAliases(city, selection) {
  const result = [normalize(selection?.cityName || city.split(",")[0])];
  if (selection && result[0] === normalize(selection.stateName)) result.push(normalize(selection.stateNative));
  return result.filter(Boolean);
}

function municipalName(name) {
  const result = name.replace(/^(city of|municipality of|cidade de|municipio de) /, "").replace(/ city$/, "");
  return result.length >= 2 ? result : name;
}

function cityMatch(place, city, selection) {
  return names(place).some(name => cityAliases(city, selection).some(alias =>
    name === alias || municipalName(name) === municipalName(alias)));
}

function rejection(place, city, selection) {
  if (!place || typeof place !== "object" || Array.isArray(place)) return "invalid_bounds";
  if (!Array.isArray(place.boundingbox) || place.boundingbox.length !== 4 ||
      place.boundingbox.some(value => !["string","number"].includes(typeof value) || String(value).trim() === "")) return "invalid_bounds";
  const [south,north,west,east] = place.boundingbox.map(Number);
  if (![south,north,west,east].every(Number.isFinite) || south >= north || west >= east ||
      south < -90 || north > 90 || west < -180 || east > 180) return "invalid_bounds";
  if (place.class !== "place" && place.category !== "place" && place.type !== "administrative") return "not_locality";
  if (selection && String(place.address?.country_code || "").toUpperCase() !== selection.countryCode) return "country_mismatch";
  if (!stateMatch(place, selection)) return "subdivision_unconfirmed";
  if (selection && !cityMatch(place, city, selection)) return "city_mismatch";
  return null;
}

function choose(places, city, selection) {
  const requested = normalize(selection?.cityName || city.split(",")[0]);
  const score = place => {
    let value = names(place).includes(requested) ? 100 : cityMatch(place, city, selection) ? 80 : 0;
    // Prefer the complete municipal boundary over its place-node when both are
    // returned. Do not replace a chosen relation with a small radius or rectangle.
    if (place.osm_type === "relation") value += 10;
    const rank = Number(place.place_rank);
    if (rank >= 14 && rank <= 18) value += 20;
    return value;
  };
  return [...places].sort((left,right) => score(right) - score(left))[0];
}

function plans(city, selection, locationIQ) {
  const primary = locationIQ ? "LocationIQ" : "Nominatim";
  const result = [{provider:primary, query:city, wording:"selected_location"}];
  if (!selection) return result;
  const simple = [selection.cityName, selection.countryName].filter(Boolean).join(", ");
  if (simple && normalize(simple) !== normalize(city)) result.push({provider:primary, query:simple, wording:"city_country"});
  if (locationIQ) result.push({provider:"Nominatim", query:simple || city, wording:"alternative_geocoder"});
  else if (selection.stateNative && normalize(selection.stateNative) !== normalize(selection.stateName)) {
    const native = [selection.cityName,selection.stateNative,selection.countryName].filter(Boolean).join(", ");
    if (!result.some(plan => normalize(plan.query) === normalize(native))) result.push({provider:primary,query:native,wording:"native_subdivision"});
  }
  return result.slice(0,3);
}

module.exports = { stateMatch, cityMatch, rejection, choose, plans };
