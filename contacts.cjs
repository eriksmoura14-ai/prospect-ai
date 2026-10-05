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

function whatsappContact(value, country) {
  if (typeof value !== "string" || value.length > 200) return {};
  const defaultCountry = countryCode(country) || undefined;
  // OSM can contain several numbers; use the first complete, valid number.
  for (const item of value.split(/[;,]/u)) {
    const phone = parsePhoneNumberFromString(item.trim(), { defaultCountry, extract: false });
    if (phone?.isValid()) return { url: "https://wa.me/" + phone.number.slice(1), number: phone.number, adjustment: "" };
    // Brazilian legacy mobile numbers received a ninth digit by 2017.
    // Only repair an invalid eight-digit mobile in the old 6/8/9 ranges.
    // Valid numbers, landlines and the ambiguous 7 range remain unchanged.
    if (phone?.country === "BR" && /^\d{2}[689]\d{7}$/.test(phone.nationalNumber)) {
      const candidate = "+55" + phone.nationalNumber.slice(0, 2) + "9" + phone.nationalNumber.slice(2);
      const updated = parsePhoneNumberFromString(candidate, { extract: false });
      if (updated?.isValid() && updated.getType() === "MOBILE") {
        return { url: "https://wa.me/" + updated.number.slice(1), number: updated.number, adjustment: "br_ninth_digit" };
      }
    }
  }
  return {};
}

function whatsappURL(value, country) { return whatsappContact(value, country).url || ""; }

function details(company, fallbackCountry) {
  const code = countryCode(company?.countryCode) || countryCode(fallbackCountry);
  const contact = whatsappContact(company?.phone, code);
  return { ...company, countryCode: code, whatsappUrl: contact.url || "",
    whatsappNumber: contact.number || "", whatsappAdjustment: contact.adjustment || "" };
}

module.exports = { countryCode, jobCountry, whatsappURL, details };
