"use strict";

// Explicit, bounded release verification. Never initiated by an HTTP request.
const CASES = Object.freeze([
  { countryCode: "BR", stateCode: "MG", cityId: "__manual__", manualCity: "Araguari", niche: "Restaurantes" },
  { countryCode: "AU", stateCode: "NSW", cityId: "__manual__", manualCity: "Sydney", niche: "Auto Detailing" },
  { countryCode: "IN", stateCode: "MH", cityId: "__manual__", manualCity: "Mumbai", niche: "Barber" }
]);
const GLOBAL_CASES=Object.freeze([
  {countryCode:"DE",stateCode:"RP",cityId:"__manual__",manualCity:"Cochem",niche:"Restaurantes"},
  {countryCode:"BR",stateCode:"MG",cityId:"__manual__",manualCity:"Monte Carmelo",niche:"Restaurantes"},
  {countryCode:"CA",stateCode:"NS",cityId:"__manual__",manualCity:"Lunenburg",niche:"Restaurantes"}
]);

async function run({ discover, locations, onCase = () => {}, profile = "legacy" }) {
  if(!["legacy","global"].includes(profile))throw new Error("Perfil de verificação inválido.");
  const cases=profile==="global"?GLOBAL_CASES:CASES;
  const results = [];
  for (const input of cases) {
    const started = Date.now(), attempts = [];
    let result;
    try {
      const selection = await locations.resolveSelection(input);
      const answer = await discover(selection.query, input.niche, () => {}, update => {
        if (update.queryAttempt) attempts.push(update.queryAttempt);
      }, selection);
      result = { city: input.manualCity, country: input.countryCode, niche: input.niche,
        outcome: answer.rows.length ? "success" : "empty", count: answer.rows.length,
        provider: answer.provider, geographicScope: answer.geographicScope };
      if(profile==="global")Object.assign(result,{metrics:answer.metrics,partial:Boolean(answer.partial||answer.truncated),
        sources:answer.sources?.filter(source=>!source.purpose).map(({source,outcome,count,httpStatus})=>({source,outcome,count,httpStatus}))});
    } catch (error) {
      result = { city: input.manualCity, country: input.countryCode, niche: input.niche,
        outcome: error.code || "discovery_error", count: profile==="global"?null:0 };
    }
    result.elapsedMs = Date.now() - started;
    result.attempts = attempts.map(({ purpose, phase, outcome, httpStatus, bytes, elapsedMs }) =>
      ({ purpose, phase, outcome, httpStatus, bytes, elapsedMs }));
    results.push(result); onCase(result);
    if (/http_(401|403|429)$|rate_limit/.test(result.outcome)) break;
  }
  return { planned: cases.length, completed: results.length,
    passed: results.filter(item => item.outcome === "success").length };
}

module.exports = { run };
