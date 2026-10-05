"use strict";

// Local numbering metadata only. No WhatsApp lookup or message is performed.
const { parsePhoneNumberFromString, isSupportedCountry } = require("libphonenumber-js/max");

function countryCode(value) {
  if (typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isSupportedCountry(code) ? code : "";
}

function jobCountry(job) {
  return countryCode(job?.discoveryDiagnostics?.geocode?.selected?.address?.country_code) ||
    countryCode(job?.discoveryDiagnostics?.location?.countryCode);
}

function whatsappURL(value, country) {
  if (typeof value !== "string" || value.length > 200) return "";
  const defaultCountry = countryCode(country) || undefined;
  // OSM can contain several numbers; use the first complete, valid number.
  for (const item of value.split(/[;,]/u)) {
    const phone = parsePhoneNumberFromString(item.trim(), { defaultCountry, extract: false });
    if (phone?.isValid()) return "https://wa.me/" + phone.number.slice(1);
  }
  return "";
}

function details(company, fallbackCountry) {
  const code = countryCode(company?.countryCode) || countryCode(fallbackCountry);
  return { ...company, countryCode: code, whatsappUrl: whatsappURL(company?.phone, code) };
}

module.exports = { countryCode, jobCountry, whatsappURL, details };
