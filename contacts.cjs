"use strict";

// Local numbering metadata only. No WhatsApp lookup or message is performed.
const { parsePhoneNumberFromString, isSupportedCountry } = require("libphonenumber-js/max");
const dialableTypes = new Set(["MOBILE", "FIXED_LINE", "FIXED_LINE_OR_MOBILE"]);

function countryCode(value) {
  if (typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && isSupportedCountry(code) ? code : "";
}

function jobCountry(job) {
  return countryCode(job?.discoveryDiagnostics?.geocode?.selected?.address?.country_code) ||
    countryCode(job?.discoveryDiagnostics?.location?.countryCode);
}

// These official links publish an international number, even without '+'.
// Never copy the optional message text or accept lookalike hosts/group links.
function whatsappLinkNumber(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return "";
    let digits;
    if (url.hostname === "wa.me" && /^\/[1-9]\d{6,14}\/?$/.test(url.pathname)) digits = url.pathname.replaceAll("/", "");
    else if (["api.whatsapp.com", "web.whatsapp.com"].includes(url.hostname) && /^\/send\/?$/.test(url.pathname) && url.searchParams.getAll("phone").length === 1) digits = url.searchParams.get("phone");
    if (!/^[1-9]\d{6,14}$/.test(digits || "")) return "";
    const phone = parsePhoneNumberFromString("+" + digits, { extract: false });
    return phone?.isValid() && !phone.ext && dialableTypes.has(phone.getType()) ? phone.number : "";
  } catch { return ""; }
}

function phoneEntries(value, country) {
  if (typeof value !== "string" || value.length > 200) return [];
  const linkNumber = whatsappLinkNumber(value);
  const items = /^https?:/i.test(value.trim()) || /^tel:/i.test(value.trim()) ? [value]
    : value.replace(/;\s*ext=(\d+)/gi, " ext. $1").split(/[;,]/u);
  return items.flatMap(item => {
    let raw = item.trim(), linked = whatsappLinkNumber(raw);
    // Do not lose a tel URI's extension by splitting it into separate numbers.
    if (/^tel:/i.test(raw)) {
      const match = /^tel:([+\d(). -]+)(?:;ext=(\d+))?$/i.exec(raw);
      if (!match) return [];
      raw = match[1] + (match[2] ? " ext. " + match[2] : "");
    }
    const phone = parsePhoneNumberFromString(linked || linkNumber || raw, { defaultCountry: countryCode(country) || undefined, extract: false });
    return phone ? [{ phone, linked: Boolean(linked || linkNumber) }] : [];
  });
}
const contactURL = phone => "https://wa.me/" + phone.number.slice(1);
function whatsappContact(value, country) {
  const entry = phoneEntries(value, country).find(({ phone }) => phone.isValid() && !phone.ext && dialableTypes.has(phone.getType()));
  return entry ? { url: contactURL(entry.phone), number: entry.phone.number } : {};
}

function whatsappURL(value, country) { return whatsappContact(value, country).url || ""; }

function numbers(value, country) {
  if (typeof value !== "string" || value.length > 200) return [];
  // Comparison must use published digits, never a guessed ninth digit.
  return [...new Set(phoneEntries(value, country).filter(({ phone }) => phone.isValid()).map(({ phone }) => phone.number))];
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
  if (/^https?:/i.test(value.trim())) return whatsappLinkNumber(value);
  return /^[+\d(][\d(). \t+;,\-]{5,199}$/.test(value.trim()) ? value.trim() : "";
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
  const whatsappPhone = listedWhatsApp(tags["contact:whatsapp"]) || listedWhatsApp(tags.whatsapp);
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
  const entries = [company?.whatsappPhone, sitePhone, company?.mobilePhone, company?.phone].flatMap((value, index) =>
    phoneEntries(value, code).map(entry => ({ ...entry, listed: index === 0 || entry.linked })));
  const valid = entries.filter(({ phone }) => phone.isValid() && !phone.ext);
  const contact = valid.find(entry => entry.listed && dialableTypes.has(entry.phone.getType())) || valid.find(({ phone }) => ["MOBILE", "FIXED_LINE_OR_MOBILE"].includes(phone.getType()));
  let suggestion;
  if (!contact) for (const { phone } of entries) {
    if (phone.ext || phone.isValid() || phone.country !== "BR" || !/^\d{2}[689]\d{7}$/.test(phone.nationalNumber)) continue;
    const candidate = parsePhoneNumberFromString("+55" + phone.nationalNumber.slice(0, 2) + "9" + phone.nationalNumber.slice(2), { extract: false });
    if (candidate?.isValid() && candidate.getType() === "MOBILE") { suggestion = candidate; break; }
  }
  const conflict = company?.phoneVerification === "conflict";
  const reason = conflict ? "conflict" : contact ? "" : suggestion ? "br_ninth_digit" : entries.some(({ phone }) => phone.ext) ? "extension"
    : valid.some(({ phone }) => phone.getType() === "FIXED_LINE") ? "fixed_line" : valid.length ? "special_number" : "invalid_number";
  return { ...company, countryCode: code,
    whatsappUrl: !conflict && contact ? contactURL(contact.phone) : "",
    whatsappNumber: !conflict && contact ? contact.phone.number : "",
    whatsappStatus: conflict ? "needs_review" : contact ? contact.listed ? "listed" : "unverified" : suggestion ? "needs_review" : "not_listed",
    whatsappReason: reason, whatsappAdjustment: !conflict && suggestion ? "br_ninth_digit" : "",
    whatsappSuggestedUrl: !conflict && suggestion ? contactURL(suggestion) : "",
    whatsappSuggestedNumber: !conflict && suggestion ? suggestion.number : "" };
}

module.exports = { countryCode, jobCountry, whatsappURL, whatsappLinkNumber, details, numbers, sourceData, websiteURL };
