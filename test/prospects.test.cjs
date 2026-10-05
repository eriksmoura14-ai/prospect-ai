"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { snapshot, details, listName } = require("../prospects.cjs");
test("saved-company snapshots discard private fields and retain website classification",()=>{
  const result=snapshot({osmId:"node/1",name:"Empresa",status:"WEBSITE_FOUND",latitude:40,longitude:-70,
    ownerId:"private-account",password:"private-password",discoveryDiagnostics:{apiKey:"private-key"},verification:{privateField:"secret"}});
  assert.equal(result.status,"WEBSITE_FOUND");assert.equal(result.latitude,40);
  for(const key of ["ownerId","password","discoveryDiagnostics","verification"])assert.equal(result[key],undefined);
  assert.throws(()=>snapshot({osmId:"x".repeat(201)}),error=>error.status===400);
});
test("notes preserve literal user text while contact status remains independent of website status",()=>{
  const value={note:"<img src=x onerror=alert(1)>\nObservação",status:"contacted"};
  assert.deepEqual(details(value),value);
  assert.throws(()=>details({note:"",status:"WEBSITE_LISTED"}),error=>error.status===400);
  assert.equal(listName("  São Paulo  "),"São Paulo");
});
