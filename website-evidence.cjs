"use strict";

const htmlText = require("./html-text.cjs");
const contacts = require("./contacts.cjs");

const normalize = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function decode(value) {
  return String(value || "").replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d{1,7}|#x[a-f\d]{1,6});/gi, entity => {
    const named = {"&amp;":"&","&quot;":"\"","&apos;":"'","&lt;":"<","&gt;":">","&nbsp;":" "};
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const number = /^&#x/i.test(entity) ? parseInt(entity.slice(3,-1),16) : Number(entity.slice(2,-1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : " ";
  });
}
function attribute(fragment, key) {
  if (fragment.length > 4096) return "";
  const match = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,"i").exec(fragment);
  return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}
function structuredEntities(input) {
  const lower = input.replace(/[A-Z]/g, value => value.toLowerCase());
  const entities = []; let position = 0, scripts = 0;
  function visit(value, depth = 0) {
    if (depth > 6 || entities.length >= 64 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value.slice(0,64)) visit(item, depth + 1); return; }
    if (typeof value.name === "string" && value.address && typeof value.address === "object") entities.push(value);
    if (value["@graph"]) visit(value["@graph"],depth + 1);
    if (value.mainEntity) visit(value.mainEntity,depth + 1);
  }
  while (scripts++ < 32) {
    const opening = lower.indexOf("<script", position);
    if (opening < 0) break;
    const end = input.indexOf(">",opening + 7);
    if (end < 0) break;
    const closing = lower.indexOf("</script",end + 1);
    if (closing < 0) break;
    position = closing + 8;
    if (attribute(input.slice(opening + 7,end),"type").toLowerCase() !== "application/ld+json") continue;
    try { visit(JSON.parse(input.slice(end + 1,closing))); } catch { /* Never evaluate page scripts. */ }
  }
  return entities;
}
function includesWords(text, value) {
  return Boolean(value) && (` ${text} `).includes(` ${value} `);
}
function matchesName(value, name) {
  const text = normalize(decode(value)), expected = normalize(name);
  return expected.length >= 2 && (text === expected || (expected.length >= 6 && includesWords(text,expected)));
}
function matchesAddress(value, business) {
  const text = normalize(decode(value)), street = normalize(business.street), number = normalize(business.houseNumber);
  if (street.length < 3 || !number) return false;
  let start = 0;
  while (start < text.length) {
    const index = text.indexOf(street,start);
    if (index < 0) break;
    start = index + street.length;
    if (!includesWords(text.slice(Math.max(0,index - 45),index + street.length + 45),street)) continue;
    if (includesWords(text.slice(Math.max(0,index - 45),index + street.length + 45),number)) return true;
  }
  return false;
}
function matchingEntities(page, business) {
  return structuredEntities(page.html || "").filter(entity => {
    const address = entity.address;
    const local = normalize(address.addressLocality), city = normalize(business.city);
    const country = typeof address.addressCountry === "string" ? contacts.countryCode(address.addressCountry) : "";
    return matchesName(entity.name,business.name) && city.length >= 2 && includesWords(local,city) &&
      (!country || !business.countryCode || country === business.countryCode) && matchesAddress(address.streetAddress,business);
  });
}
function pageNumbers(page, business) {
  const text = decode(htmlText.text(page.html || ""));
  const numbers = (text.match(/\+?\d[\d(). \t-]{7,24}\d/g) || []).slice(0,128)
    .flatMap(value => contacts.numbers(value,business.countryCode));
  const tags = (page.html || "").match(/<a\b[^>]{0,4096}>/gi) || [];
  for (const tag of tags.slice(0,256)) {
    const href = attribute(tag,"href");
    if (!/^tel:/i.test(href)) continue;
    let value; try { value = decodeURIComponent(href.slice(4).split("?")[0]); } catch { continue; }
    numbers.push(...contacts.numbers(value,business.countryCode));
  }
  for (const entity of matchingEntities(page,business)) {
    const values = Array.isArray(entity.telephone) ? entity.telephone : [entity.telephone];
    for (const value of values.slice(0,8)) numbers.push(...contacts.numbers(value,business.countryCode));
  }
  return [...new Set(numbers)];
}
function analyze(page, business) {
  const title = decode(htmlText.title(page.html || "")), text = decode(htmlText.text(page.html || ""));
  const normalizedText = normalize(text), entities = matchingEntities(page,business);
  const nameMatch = matchesName(title,business.name) || entities.length > 0;
  const city = normalize(business.city);
  const cityMatch = city.length >= 2 && includesWords(normalizedText,city) || entities.length > 0;
  const addressMatch = matchesAddress(text,business) || entities.length > 0;
  const originals = contacts.numbers(business.phone,business.countryCode);
  const matchedPhones = pageNumbers(page,business).filter(value => originals.includes(value));
  const phoneMatch = matchedPhones.length > 0;
  const parked = /\b(domain for sale|buy this domain|website coming soon|parked domain)\b/i.test(text);
  const compatible = page.status >= 200 && page.status < 300 && !parked && nameMatch && cityMatch && (phoneMatch || addressMatch);
  return {title: title.slice(0,400),compatible,nameMatch,cityMatch,phoneMatch,addressMatch,
    matchedPhone:matchedPhones.length === 1 ? matchedPhones[0] : ""};
}

// Add a phone only from a structured record for this exact name, city and
// street/house number. A developer's footer or another branch cannot supply it.
function enrichPhone(page, business) {
  if (!analyze(page,business).compatible) return {};
  const values = matchingEntities(page,business).flatMap(entity =>
    (Array.isArray(entity.telephone) ? entity.telephone : [entity.telephone]).slice(0,8))
    .flatMap(value => contacts.numbers(value,business.countryCode));
  const phones = [...new Set(values)];
  if (phones.length !== 1) return {};
  const existing = contacts.numbers(business.phone,business.countryCode), phone = phones[0];
  if (business.phone) return existing.includes(phone)
    ? {phoneVerification:"website_match",sitePhone:phone}
    : {phoneVerification:"conflict",sitePhone:phone};
  return {phone, phoneSource: page.finalUrl, phoneVerification:"website_published",sitePhone:phone};
}

const COUNTRY_DOMAINS = {BR:[".com.br",".br"],GB:[".co.uk",".uk"],AU:[".com.au",".au"],JP:[".co.jp",".jp"],NZ:[".co.nz",".nz"],ZA:[".co.za",".za"],AR:[".com.ar",".ar"],MX:[".com.mx",".mx"],TR:[".com.tr",".tr"],IN:[".co.in",".in"]};
function candidates(name, city, country) {
  // Preserve the previous global suffixes; national suffixes add candidates.
  const original = normalize(name);
  const simple = original.replace(/\b(inc|incorporated|ltd|limited|llc|corp|corporation)\b/g, "").replace(/\s+/g," ").trim();
  const compact = simple.replaceAll(" ","");
  const variants = [...new Set([original.replaceAll(" ",""),compact,simple.replaceAll(" ","-"),compact + normalize(city).replaceAll(" ","")])]
    .filter(value => value.length >= 3 && value.length <= 63);
  const code = contacts.countryCode(country);
  const national = COUNTRY_DOMAINS[code] || (code ? ["." + code.toLowerCase()] : []);
  const suffixes = [...new Set([...national,".com",".ca",".net",".org"])];
  return variants.flatMap(value => suffixes.map(suffix => {
    try { return new URL(`https://${value}${suffix}`).hostname; } catch { return ""; }
  })).filter(Boolean);
}

function isProfile(input) {
  try {
    const url = new URL(input), host = url.hostname;
    return ["facebook.com","instagram.com","linkedin.com","youtube.com","tiktok.com","wa.me","linktr.ee","yelp.com","tripadvisor.com","maps.app.goo.gl","g.page"]
      .some(value => host === value || host.endsWith("." + value)) ||
      ((host === "google.com" || host.endsWith(".google.com")) && url.pathname.startsWith("/maps"));
  } catch { return false; }
}

function canonicalPath(value) {
  return value.replace(/[^\x00-\x7f]/gu, character => encodeURIComponent(character))
    .replace(/%[a-f\d]{2}/gi, octet => {
      const character = String.fromCharCode(parseInt(octet.slice(1),16));
      return /[a-z\d._~-]/i.test(character) ? character : octet.toUpperCase();
    });
}
function robotsPermit(input, path = "/") {
  path = canonicalPath(path);
  const lines = String(input).split(/\r?\n/);
  if (lines.length > 4096) return false;
  const groups = []; let group = null;
  for (const raw of lines) {
    const line = raw.split("#")[0].trim(), colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0,colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (name === "user-agent") {
      if (!group || group.rules.length) { group = {agents:[],rules:[]}; groups.push(group); }
      group.agents.push(value.toLowerCase().split(/[\s/]/)[0]);
    } else if (group && ["disallow","allow"].includes(name) && value) {
      if (value.length > 2000) return false;
      group.rules.push({value:canonicalPath(value),allow:name === "allow"});
    }
  }
  const specific = groups.filter(group => group.agents.includes("prospectai"));
  const selected = specific.length ? specific : groups.filter(group => group.agents.includes("*"));
  let longest = -1, allowed = true;
  for (const group of selected) for (const rule of group.rules) {
    const anchored = rule.value.endsWith("$"), pattern = anchored ? rule.value.slice(0,-1) : rule.value;
    const parts = pattern.split("*");
    if (!path.startsWith(parts[0])) continue;
    let cursor = parts[0].length, matches = true;
    for (let i=1;i<parts.length;i++) {
      const index = anchored && i === parts.length - 1 ? path.length - parts[i].length : path.indexOf(parts[i],cursor);
      if (index < cursor || !path.startsWith(parts[i],index)) {matches = false; break;}
      cursor = index + parts[i].length;
    }
    if (!matches || (anchored && parts.length === 1 && cursor !== path.length)) continue;
    const length = Buffer.byteLength(pattern.replaceAll("*",""));
    if (length > longest) {longest = length; allowed = rule.allow;}
    else if (length === longest && rule.allow) allowed = true;
  }
  return allowed;
}
async function readPublicPage(input,deadline,read) {
  let current = input;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = new URL(current);
    let robots = await read(new URL("/robots.txt",url).href,deadline,-1,true);
    // A same-origin redirect can serve the policy from a different path.
    if (robots.redirect && new URL(robots.redirect).origin === url.origin) robots = await read(robots.redirect,deadline,-1,true);
    if (robots.redirect || (robots.status !== 404 && (robots.status < 200 || robots.status >= 300 || robots.policyReadable === false)))
      throw new Error("Não foi possível consultar as permissões do site.");
    if (robots.status !== 404 && !robotsPermit(robots.html,url.pathname + url.search)) throw new Error("O site possui restrições para robôs. Revise manualmente.");
    const page = await read(current,deadline,-1);
    if (!page.redirect) return page;
    current = page.redirect;
  }
  throw new Error("Excesso de redirecionamentos.");
}

module.exports = {analyze,enrichPhone,candidates,readPublicPage,robotsPermit,isProfile};
