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
test("global release check validates three proven small municipalities without emitting business contacts",async()=>{
  const records=[];
  const report=await check.run({locations,profile:"global",discover:async(query,niche,progress,diagnostic,selection)=>{
    records.push(selection.cityName);return {rows:[{phone:"private-output-not-allowed"}],provider:"global",metrics:{unique:1},partial:true,
      sources:[{source:"qlever",outcome:"success",count:1},{source:"overture",outcome:"source_timeout"}]};
  },onCase:result=>{assert.equal(result.partial,true);assert.equal(result.metrics.unique,1);assert(!JSON.stringify(result).includes("private-output"));}});
  assert.deepEqual(records,["Cochem","Monte Carmelo","Lunenburg"]);assert.equal(report.passed,3);
});
test("global release check never turns an unavailable source into a zero-company count",async()=>{
  const results=[];await check.run({locations,profile:"global",discover:async()=>{throw Object.assign(new Error("quota"),{code:"source_http_429"});},onCase:r=>results.push(r)});
  assert.equal(results.length,1);assert.equal(results[0].count,null);
});
