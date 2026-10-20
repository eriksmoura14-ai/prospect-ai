"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const check = require("../discovery-check.cjs");
const locations = require("../locations.cjs");

test("Release check uses validated locations across three continents and never verifies websites or sends email", async () => {
  const cases = [];
  const result = await check.run({ locations, discover: async (query, niche, progress, diagnostic, selection) => {
    assert.equal(query,selection.query); assert.ok(selection.stateIso);
    cases.push(selection.countryCode);
    diagnostic({queryAttempt:{purpose:"candidates",outcome:"success",query:"not included in the report"}});
    return {rows:[{}],provider:"qlever",geographicScope:"Selected locality"};
  }});
  assert.deepEqual(cases,["BR","AU","IN"]);
  assert.deepEqual(result,{planned:3,completed:3,passed:3});
});
test("Release check stops on quota/authentication rejection rather than repeating across cities", async () => {
  const cases=[];
  const report=await check.run({locations,discover:async()=>{throw Object.assign(new Error("quota"),{code:"qlever_http_429"});},onCase:item=>cases.push(item)});
  assert.equal(report.completed,1);assert.equal(report.passed,0);
  assert.equal(cases[0].outcome,"qlever_http_429");
});
