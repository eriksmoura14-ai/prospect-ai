"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const maps = require("../google-maps.cjs");
// All businesses below are synthetic fixtures, never live Google Maps results.
const place = { name: "Uberlândia", lat: "-18.92", lon: "-48.28",
  address: { country_code: "br" }, boundingbox: ["-19", "-18.8", "-48.4", "-48.1"] };
const id = "11111111-1111-4111-8111-111111111111";
const csv = 'title,place_id,category,address,phone,website,latitude,longitude,review_rating,review_count\r\n' +
  '"Barbearia fictícia, teste",ChIJ_fixture_123,Barber shop,"Rua Exemplo, 1",+5534991234567,https://instagram.com/fixture,-18.92,-48.28,4.8,12\r\n';

function client(statuses = ["pending", "working", "ok"], extra = {}) {
  const calls = []; let polls = 0, clock = 1000;
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === "DELETE") return new Response("{}");
    if (url.endsWith("/download")) return new Response(csv);
    if (options.method === "POST") return Response.json({ id });
    return Response.json({ Status: statuses[Math.min(polls++, statuses.length - 1)] });
  };
  return { calls, api: maps.createClient({ fetcher, now: () => clock,
    sleep: async ms => { clock += ms; }, ...extra }) };
}

test("Maps CSV accepts BOM, escaped quotes, commas and multiline cells; rejects partial or incompatible data", () => {
  const input = '\uFEFFtitle,place_id,address\r\n"A ""quoted"" name",ChIJ123,"line1\nline2"\r\n';
  assert.deepEqual(maps.parseCSV(input), [{title:'A "quoted" name',place_id:"ChIJ123",address:"line1\nline2"}]);
  for (const invalid of ['title,place_id\n"unfinished,id', 'title,place_id\n"name"x,id', 'title,place_id\nname', 'title,title\na,b', 'name,place_id\na,b']) {
    assert.throws(() => maps.parseCSV(invalid), { code: "maps_csv_invalid" });
  }
  assert.throws(() => maps.parseCSV("x".repeat(maps.LIMITS.bytes + 1)), { code: "maps_csv_limit" });
});

test("Maps normalization retains source evidence, deduplicates place IDs and discards missing/outside coordinates", () => {
  const first = maps.parseCSV(csv)[0];
  const rows = maps.normalizeRows([first, first, { ...first, place_id:"outside",latitude:"-20" },
    { ...first, place_id:"empty",longitude:"" }, { ...first,place_id:"closed",status:"Permanently closed" }], place, "Barber", "Uberlândia");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, "Google Maps"); assert.equal(row.osmId, "google:ChIJ_fixture_123");
  assert.deepEqual(row.osmIds, []); assert.equal(row.phoneSource, "Google Maps · telefone cadastrado");
  assert.equal(row.sourceCategory, "Barber shop"); assert.equal(row.rating, 4.8); assert.equal(row.reviewCount, 12);
  assert.equal(row.countryCode, "BR"); assert.equal(row.matchMethod, "search");
  assert.equal(new URL(row.sourceUrl).hostname, "www.google.com");
  assert.equal(new URL(row.sourceUrl).searchParams.get("query_place_id"), row.placeId);
});

test("missing website and unsafe URLs never become proof of no website or clickable scraper links", () => {
  const original = maps.parseCSV(csv)[0];
  const row = maps.normalizeRows([{...original, website:"javascript:alert(1)", link:"https://evil.example",place_id:"../bad"}], place, "Barber", "Uberlândia")[0];
  assert.equal(row.website, ""); assert.equal(row.status, "UNCERTAIN"); assert.equal(row.confidence, 0);
  assert.equal(row.placeId, ""); assert.match(row.osmId, /^google:[a-f0-9]{64}$/);
  assert.match(row.reason, /não comprova/); assert.ok(!row.sourceUrl.includes("evil.example"));
});

test("Maps client creates one bounded task, polls capitalized engine states, downloads then removes it", async () => {
  const { api, calls } = client();
  const answer = await api.discover(place, "Barber", "Uberlândia, Brazil");
  assert.equal(answer.rows.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.depth, 3); assert.equal(body.max_time, 180); assert.equal(body.email, false);
  assert.equal(body.extra_reviews, false); assert.deepEqual(body.proxies, []);
  assert.equal(body.lang, "pt"); assert.match(body.keywords[0], /barbearia/);
  assert.equal(body.lat, "-18.92");
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.equal(calls.at(-1).method, "DELETE");
  assert.ok(calls.every(call => call.url.startsWith("http://127.0.0.1:8080/api/v1/jobs")));
  assert.ok(calls.every(call => call.redirect === "error"));
});

test("failed Maps task does not retry and is cleaned up", async () => {
  const { api, calls } = client(["failed"]);
  await assert.rejects(api.discover(place, "Barber", "Uberlândia"), {code:"maps_job_failed"});
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.equal(calls.at(-1).method, "DELETE");
  assert.equal(calls.some(call => call.url.endsWith("/download")), false);
});

test("uncertain Maps timeout blocks another browser task until restart and does not pretend DELETE cancels it", async () => {
  const { api, calls } = client(["working"], { limits: {...maps.LIMITS, totalMs:5,pollMs:5} });
  await assert.rejects(api.discover(place, "Barber", "Uberlândia"), {code:"maps_timeout"});
  await assert.rejects(api.discover(place, "Barber", "Uberlândia"), {code:"maps_engine_restart_required"});
  assert.equal(calls.filter(call => call.method === "POST").length, 1);
  assert.equal(calls.some(call => call.method === "DELETE"), false);
});

test("invalid engine IDs and network errors fail without reflecting internal errors or retrying", async () => {
  for (const fetcher of [async () => Response.json({id:"../../secret"}), async () => {throw new Error("private details");}]) {
    const api = maps.createClient({fetcher});
    await assert.rejects(api.discover(place,"Barber","Uberlândia"), error => /^maps_/.test(error.code) && !error.message.includes("private details"));
    await assert.rejects(api.discover(place,"Barber","Uberlândia"), {code:"maps_engine_restart_required"});
  }
});

test("Maps mode refuses production database, account, frontend and AI credentials", () => {
  assert.throws(() => maps.configuration({BUSINESS_PROVIDER:"google-maps"}));
  const env = {PROSPECT_TEST_MODE:"true", BUSINESS_PROVIDER:"google-maps", AUTH_MODE:"basic"};
  assert.deepEqual(maps.configuration(env), {testMode:true,enabled:true});
  for (const field of ["DATABASE_URL","GROQ_API_KEY","BREVO_API_KEY","APP_FRONTEND_ORIGIN"]) {
    assert.throws(() => maps.configuration({...env,[field]:"fixture-never-a-real-secret"}));
  }
  assert.throws(() => maps.configuration({...env,AUTH_MODE:"password"}));
});

test("test frontend deployment configuration cannot target the production API", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const file of ["vercel.json", "netlify/functions/render-api.mjs"]) {
    const source = fs.readFileSync(path.join(__dirname,"..",file),"utf8");
    assert.ok(!source.includes("prospect-ai-a90q.onrender.com"));
    assert.ok(source.includes("prospect-ai-maps-test-erik.onrender.com"));
  }
});
