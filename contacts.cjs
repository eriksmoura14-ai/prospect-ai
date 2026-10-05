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

function numbers(value, country) {
  if (typeof value !== "string" || value.length > 200) return [];
  return [...new Set(value.split(/[;,]/u).map(item => whatsappContact(item.trim(), country).number).filter(Boolean))];
}

function websiteURL(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const raw = value.trim();
    if (!raw || (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw))) return "";
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.hostname.includes(".") ? url.href : "";
  } catch { return ""; }
}

function listedWhatsApp(value) {
  if (typeof value !== "string" || value.length > 200) return "";
  if (!/^https?:/i.test(value)) return /^[+\d(][\d(). \t+-]{5,199}$/.test(value.trim()) ? value.trim() : "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "wa.me" && !url.username && !url.password && !url.port && /^\/[1-9]\d{6,14}$/.test(url.pathname)
      ? "+" + url.pathname.slice(1) : "";
  } catch { return ""; }
}

// Keep the original category tags intact. These are contact fields, not
// independent proof of ownership, freshness or WhatsApp registration.
function sourceData(tags = {}, provider = {}) {
  const phoneFields = ["phone", "contact:phone", "mobile", "contact:mobile"];
  const values = [], sources = [];
  for (const key of phoneFields) {
    if (typeof tags[key] !== "string" || !tags[key].trim() || tags[key].length > 200) continue;
    if (!values.includes(tags[key].trim())) values.push(tags[key].trim());
    sources.push(`OpenStreetMap · ${key}`);
  }
  const whatsappPhone = listedWhatsApp(tags["contact:whatsapp"] || tags.whatsapp);
  if (whatsappPhone && !values.includes(whatsappPhone)) { values.push(whatsappPhone); sources.push("OpenStreetMap · WhatsApp informado"); }
  if (typeof provider.phone === "string" && provider.phone.trim() && provider.phone.length <= 200) {
    if (!values.includes(provider.phone.trim())) values.push(provider.phone.trim());
    sources.push("Geoapify · contact.phone");
  }
  const selected = [];
  for (const value of values) if ([...selected, value].join("; ").length <= 200) selected.push(value);
  const phone = selected.join("; ");
  const mobileValues = [tags["contact:mobile"], tags.mobile].filter(value => typeof value === "string" && value.trim() && value.length <= 200).map(value => value.trim());
  const mobilePhone = [...new Set(mobileValues)].join("; ");
  const websiteFields = ["website", "contact:website", "url"];
  const websites = websiteFields.flatMap(key => typeof tags[key] === "string" && tags[key].length <= 2000
    ? tags[key].split(";").map(value => ({value, source: `OpenStreetMap · ${key}`})) : []);
  if (typeof provider.website === "string") websites.push({value: provider.website, source: "Geoapify · website"});
  const listed = websites.map(item => ({...item, url: websiteURL(item.value)})).find(item => item.url);
  return { phone, mobilePhone, whatsappPhone, phoneSource: sources.join("; ").slice(0, 1000),
    phoneVerification: phone ? "listed" : "not_listed", sitePhone: "",
    website: listed?.url || "", websiteSource: listed?.source || "",
    websiteVerification: listed ? "listed" : "not_identified",
    invalidListedWebsite: !listed && websites.some(item => item.value.trim()) };
}

function details(company, fallbackCountry) {
  const code = countryCode(company?.countryCode) || countryCode(fallbackCountry);
  const sitePhone = ["website_match","website_published"].includes(company?.phoneVerification) ? company?.sitePhone : "";
  const contact = company?.phoneVerification === "conflict" ? {} :
    [company?.whatsappPhone, sitePhone, company?.mobilePhone, company?.phone].map(value => whatsappContact(value, code)).find(item => item.url) || {};
  return { ...company, countryCode: code, whatsappUrl: contact.url || "",
    whatsappNumber: contact.number || "", whatsappAdjustment: contact.adjustment || "" };
}

module.exports = { countryCode, jobCountry, whatsappURL, details, numbers, sourceData, websiteURL };
