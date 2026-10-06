"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const geocoding=require("../geocoding.cjs"),locations=require("../locations.cjs");
const recorded=require("./fixtures/geocoding-world.json");

test("31 captured real world lookups preserve their original metadata and constraints",()=>{
  let successes=0;
  for(const row of recorded.queries){
    const accepted=row.data.filter(p=>!geocoding.rejection(p,row.selection.query,row.selection));
    if(!row.data.length){assert.equal(row.name,"Lima");continue;}
    assert.ok(accepted.length,`${row.name} failed: ${row.data.map(p=>geocoding.rejection(p,row.selection.query,row.selection)).join(",")}`);
    const chosen=geocoding.choose(accepted,row.selection.query,row.selection);
    assert.equal(chosen.address.country_code.toUpperCase(),row.selection.countryCode);
    assert.ok(geocoding.stateMatch(chosen,row.selection));
    assert.ok(geocoding.cityMatch(chosen,row.selection.query,row.selection));
    assert.ok(row.data.includes(chosen)); // Complete original object, not a smaller synthetic area.
    successes++;
  }
  assert.equal(successes,30);
});

test("captured Lima lookup recovers with city/country and the real subdivision ISO",()=>{
  const row=recorded.queries.find(x=>x.name==="Lima");
  assert.equal(row.data.length,0);
  const fallback=recorded.fallbacks.find(x=>x.query==="Lima, Peru");
  const accepted=fallback.data.filter(p=>!geocoding.rejection(p,row.selection.query,row.selection));
  const chosen=geocoding.choose(accepted,row.selection.query,row.selection);
  assert.ok(chosen);assert.equal(chosen.osm_type,"relation");
  assert.equal(chosen.extratags.admin_level,"8");
  assert.equal(chosen.address["ISO3166-2-lvl6"],"PE-LMA");
  assert.equal(chosen.address["ISO3166-2-lvl4"],"PE-LIM"); // Different type: a region, not the selected municipality.
  assert.equal(fallback.data.includes(chosen),true);
});

test("LocationIQ state_code handles names translated differently; foreign peers cannot override it",()=>{
  const selection={countryCode:"BR",stateName:"Minas Gerais",stateNative:"Minas Gerais",stateIso:"BR-MG",stateIsoPeers:["BR-MG","BR-SP"]};
  assert.equal(geocoding.stateMatch({address:{country_code:"br",state:"State of Minas Gerais",state_code:"MG"}},selection),true);
  assert.equal(geocoding.stateMatch({address:{country_code:"br",state:"Minas Gerais",state_code:"BR-SP"}},selection),false);
  assert.equal(geocoding.stateMatch({address:{country_code:"us",state_code:"MG"}},selection),false);
  assert.equal(geocoding.stateMatch({address:{country_code:"br",state_code:"MG","ISO3166-2-lvl6":"BR-SP"}},selection),false);
});

test("own subdivision ISO confirms a city-state without inventing a missing state field",()=>{
  const selection={countryCode:"DE",stateName:"Berlin",stateIso:"DE-BE",stateIsoPeers:["DE-BE","DE-BB"]};
  assert.equal(geocoding.stateMatch({address:{country_code:"de",city:"Berlin"},extratags:{"ISO3166-2":"DE-BE"}},selection),true);
  assert.equal(geocoding.stateMatch({address:{country_code:"de",city:"Berlin"}},selection),false);
});

test("native and multilingual place names match without mixing non-Latin cities",()=>{
  const selection={cityName:"Tokyo",stateName:"Tokyo",stateNative:"東京都"};
  assert.equal(geocoding.cityMatch({name:"東京都"},"Tokyo, Japan",selection),true);
  assert.equal(geocoding.cityMatch({name:"北京"},"Tokyo, Japan",selection),false);
  assert.equal(geocoding.cityMatch({name:"Praha",namedetails:{"name:en":"Prague"}},"Prague, Czechia",{cityName:"Prague"}),true);
  assert.equal(geocoding.cityMatch({name:"Paris",address:{city:"Prague"}},"Prague, Czechia",{cityName:"Prague"}),false);
  assert.equal(geocoding.cityMatch({name:"New York"},"New York City, United States",{cityName:"New York City"}),true);
});

test("fallback plans are bounded, deduplicated and retain state checking separately",async()=>{
  const brazil=await locations.resolveSelection({countryCode:"BR",stateCode:"MG",cityId:10324});
  assert.deepEqual(geocoding.plans(brazil.query,brazil,true).map(x=>[x.provider,x.query]),[
    ["LocationIQ","Araguari, Minas Gerais, Brazil"],["LocationIQ","Araguari, Brazil"],["Nominatim","Araguari, Brazil"]]);
  assert.equal(geocoding.plans(brazil.query,brazil,false).length,2);
  assert.equal(geocoding.plans("City",null,true).length,1);
  const native={...brazil,stateNative:"Different native name"};
  assert.equal(geocoding.plans(brazil.query,native,false).length,3);
});

test("invalid bounds and non-locality records are rejected before discovery",()=>{
  for(const value of [null,[],{}, {boundingbox:["",2,3,4]}, {boundingbox:[4,3,2,1]}, {boundingbox:[-100,-90,3,4]}]){
    assert.equal(geocoding.rejection(value,"City",null),"invalid_bounds");
  }
  assert.equal(geocoding.rejection({boundingbox:[1,2,3,4],type:"restaurant",category:"amenity"},"City",null),"not_locality");
});
