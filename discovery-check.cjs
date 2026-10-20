"use strict";

// Explicit, bounded release verification. Never initiated by an HTTP request.
const CASES = Object.freeze([
  { countryCode: "BR", stateCode: "MG", cityId: "__manual__", manualCity: "Araguari", niche: "Restaurantes" },
  { countryCode: "AU", stateCode: "NSW", cityId: "__manual__", manualCity: "Sydney", niche: "Auto Detailing" },
  { countryCode: "IN", stateCode: "MH", cityId: "__manual__", manualCity: "Mumbai", niche: "Barber" }
]);

async function run({ discover, locations, onCase = () => {} }) {
  const results = [];
  for (const input of CASES) {
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
    } catch (error) {
      result = { city: input.manualCity, country: input.countryCode, niche: input.niche,
        outcome: error.code || "discovery_error", count: 0 };
    }
    result.elapsedMs = Date.now() - started;
    result.attempts = attempts.map(({ purpose, phase, outcome, httpStatus, bytes, elapsedMs }) =>
      ({ purpose, phase, outcome, httpStatus, bytes, elapsedMs }));
    results.push(result); onCase(result);
    if (/http_(401|403|429)$|rate_limit/.test(result.outcome)) break;
  }
  return { planned: CASES.length, completed: results.length,
    passed: results.filter(item => item.outcome === "success").length };
}

module.exports = { run };
