"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const geo=require("../discovery/geometry.cjs"),records=require("../discovery/records.cjs"),{createEngine}=require("../discovery/engine.cjs");
const place={name:"Town",display_name:"Town, Germany",osm_type:"relation",osm_id:1,address:{country_code:"de"},boundingbox:[0,2,0,2],geojson:{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.7,.7],[1.3,.7],[1.3,1.3],[.7,1.3],[.7,.7]]]}};
const area=geo.area(place,{countryCode:"DE",cityName:"Town"});
const osm=(id=1,phone="+4930901820",x=.3)=>records.osm({type:"node",id,lat:.3,lon:x,tags:{name:"Central",amenity:"restaurant",phone,"addr:street":"Main","addr:housenumber":"1"}},area,"Restaurantes");
const raw=(id="external")=>({id,names:{primary:"Central"},geometry:{type:"Point",coordinates:[.3,.3]},taxonomy:{primary:"italian_restaurant",hierarchy:["food_and_drink","restaurant","italian_restaurant"]},phones:["+4930901820"],websites:["https://fixture.example/"],addresses:[{freeform:"Main 1",country:"DE"}],sources:[{dataset:"Foursquare",record_id:"public-id"}],confidence:.9});
test("full municipal geometry keeps rural outskirts and excludes holes and another country",()=>{
  assert(geo.inside(area,{latitude:1.9,longitude:1.9,countryCode:"DE"}));
  assert(!geo.inside(area,{latitude:1,longitude:1,countryCode:"DE"}));
  assert(!geo.inside(area,{latitude:.3,longitude:.3,countryCode:"BR"}));
  for(const bounds of [[-91,2,0,2],[0,2,170,-170],[0,40,0,2]])assert.throws(()=>geo.area({...place,boundingbox:bounds}));
  assert.throws(()=>geo.area({...place,geojson:{type:"Point",coordinates:[1,1]}}),/ponto central/);
});
test("multipolygons preserve separate islands and source coordinates",()=>{
  const a=geo.area({...place,geojson:{type:"MultiPolygon",coordinates:[[[[0,0],[.5,0],[.5,.5],[0,.5],[0,0]]],[[[1.5,1.5],[2,1.5],[2,2],[1.5,2],[1.5,1.5]]]]}});
  assert(geo.inside(a,{latitude:1.8,longitude:1.8}));assert(!geo.inside(a,{latitude:1,longitude:1}));
});
test("official-boundary QLever results are filtered by the actual polygon including holes",async()=>{
 let calls=0;
 const uri=value=>({type:"uri",value}),literal=value=>({type:"literal",value});
 const provider=require("../discovery/providers.cjs").providers({businessMatch:records.osmMatches,fetchImpl:async(url,options)=>{
  const query=options?.method==="POST"?new URLSearchParams(options.body).get("query"):new URL(url).searchParams.get("query");calls++;
  if(calls===1){const scope=query.match(/urn:prospect:area:[a-f0-9]{64}/)[0];return new Response(JSON.stringify({results:{bindings:[1,2,3].map(id=>({region:uri(scope),poi:uri("https://www.openstreetmap.org/node/"+id),name:literal("Public restaurant "+id)}))}}));}
  return new Response(JSON.stringify({results:{bindings:[1,2,3].map((id,i)=>({poi:uri("https://www.openstreetmap.org/node/"+id),field3:literal("restaurant"),wkt:literal(["POINT(.3 .3)","POINT(1 1)","POINT(4 4)"][i])}))}}));
 }});
 const result=await provider.qlever({...area,officialBoundary:true},"Restaurantes");
 assert.equal(calls,2);assert.equal(result.rows.length,1);assert.equal(result.rows[0].sourceId,"node/1");assert.equal(result.rows[0].license.id,"ODbL-1.0");
});
test("Overture current taxonomy, confidence, licenses and public fields are preserved without emails",()=>{
  const row=records.overture({...raw(),emails:["private@example.test"]},area);
  assert(records.overtureMatches(row,"Restaurantes"));assert(!records.overtureMatches(row,"Barber"));
  assert.equal(row.phone,"+4930901820");assert.equal(row.whatsappStatus,"not_listed");
  assert.match(row.license.attribution,/Foursquare/);assert.equal(row.sourceConfidence,.9);assert(!("emails"in row));
  const saved=require("../prospects.cjs").snapshot(row);assert.equal(saved.sourceConfidence,.9);assert.equal(saved.provenance[0].datasets[0].license,"Apache-2.0");
  for(const p of [{...raw(),operating_status:"permanently_closed"},{...raw(),confidence:.2},{...raw(),sources:[]},{...raw(),sources:[{dataset:"meta",license:"unreviewed_license"}]},{...raw(),sources:[{dataset:"unreviewed_provider"}]}])assert.equal(records.overture(p,area),null);
  assert(records.overture({...raw(),confidence:null},area));
  assert.throws(()=>records.overture(raw(),area,"unreviewed-release"),/licença/);
});
test("cross-source dedup requires evidence and retains conflicts, attribution and separate branches",()=>{
  const a=osm(),b=records.overture(raw(),area);b.category="Restaurantes";
  const result=records.merge([a,b]);assert.equal(result.length,1);assert.equal(result[0].provenance.length,2);assert.equal(result[0].website,b.website);
  const conflict=records.overture({...raw(),phones:["+4930901821"]},area);
  assert.equal(records.merge([a,conflict])[0].phoneVerification,"conflict");
  assert.equal(records.merge([a,conflict])[0].whatsappUrl,"");
  assert.equal(records.merge([a,{...b,address:"Main 2"}]).length,2);
  assert.equal(records.merge([a,{...b,longitude:.5}]).length,2);
  assert.equal(records.merge([a,{...a,name:"Renamed",sourceKey:"qlever"}]).length,1);
});
test("source records omit unrelated raw tags and avoid claiming no website",()=>{
  const row=records.osm({type:"node",id:1,lat:.3,lon:.3,tags:{name:"Central",amenity:"restaurant",email:"private",operator:"Personal Name"}},area,"Restaurantes");
  assert.equal(row.tags.email,undefined);assert.equal(row.tags.operator,undefined);assert.equal(row.status,"UNCERTAIN");assert.match(row.reason,/ausência não comprovada/);
});
test("Overture preserves complete phone fields and explicit WhatsApp destinations without cutting digits",()=>{
  const row=records.overture({...raw(),phones:["https://wa.me/5534998883900?text=Oi%3B%20%2B12125550100","+4930901820"]},area);
  assert.equal(row.whatsappNumber,"+5534998883900");assert.equal(row.whatsappStatus,"listed");
  assert.match(row.phone,/\+4930901820$/);
  const huge="+"+"1".repeat(199),bounded=records.overture({...raw(),phones:[huge,"+4930901820"]},area);
  assert.equal(bounded.phone,huge);assert(bounded.phone.length<=200);
});
function memory(){let rows=[],coverage=[],task={id:"fixture",token:"lease",attempts:1,checkpoint:{}};return {
  query:async()=>({rows:structuredClone(rows),truncated:false}),coverage:async()=>coverage,enqueue:async()=>task,claim:async()=>task,
  upsert:async values=>{rows=[...rows,...values];return{saved:values.length,rejectedByBudget:0};},
  mark:async(a,n,s,r)=>{coverage=[...coverage.filter(c=>c.source!==s),{source:s,complete:r.complete,fresh:true}];},checkpoint:async()=>{},finish:async()=>{}
};}
test("multi-source discovery preserves successful data when a provider fails and avoids redundant calls",async()=>{
  const store=memory();let calls=0;
  const engine=createEngine({store,sources:["qlever","overture"],providers:{qlever:async()=>{calls++;throw Object.assign(new Error("quota"),{code:"source_http_429",httpStatus:429,retryAfter:"600"});},overture:async()=>{calls++;return{rows:[records.overture(raw(),area)],truncated:false};}}});
  const first=await engine.search(area,"Restaurantes");assert.equal(first.rows.length,1);assert(first.partial);assert.equal(calls,2);
  const second=await engine.search(area,"Restaurantes");assert.equal(second.rows.length,1);assert.equal(calls,2);
});
test("unavailable sources never masquerade as zero businesses",async()=>{
  const engine=createEngine({store:memory(),sources:["qlever"],providers:{qlever:async()=>{throw Object.assign(new Error(),{code:"source_timeout"});}}});
  await assert.rejects(engine.search(area,"Restaurantes"),error=>error.code==="discovery_sources_unavailable");
});
test("a valid empty response is limited evidence, not a census",async()=>{
  const engine=createEngine({store:memory(),sources:["qlever"],providers:{qlever:async()=>({rows:[],truncated:false})}});
  const result=await engine.search(area,"Restaurantes");assert.equal(result.rows.length,0);assert.match(result.warning,/ausência de registro não comprova/);
});
test("concurrent requests for the same area share one bounded refresh",async()=>{
  let calls=0;const engine=createEngine({store:memory(),sources:["qlever"],providers:{qlever:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return{rows:[osm()],truncated:false};}}});
  await Promise.all([engine.search(area,"Restaurantes"),engine.search(area,"Restaurantes")]);assert.equal(calls,1);
});
test("a claimed task that only needs fresh local data is completed, without leaking its lease",async()=>{
  const store=memory();let finished=0;store.finish=async()=>{finished++;};
  const engine=createEngine({store,sources:["qlever"],providers:{qlever:async()=>({rows:[osm()],truncated:false})}});
  await engine.search(area,"Restaurantes");
  await engine.search(area,"Restaurantes",{task:{id:"existing",token:"lease",attempts:1}});
  assert.equal(finished,2);
});
test("an empty cooldown result releases a claimed lease while preserving the source failure",async()=>{
  const store=memory();let finish;
  store.coverage=async()=>[{source:"qlever",fresh:true,complete:false}];store.finish=async(task,state)=>{finish=state;};
  const engine=createEngine({store,sources:["qlever"],providers:{}});
  await assert.rejects(engine.search(area,"Restaurantes",{task:{id:"claimed",token:"lease",attempts:1}}),error=>error.code==="discovery_sources_unavailable");
  assert.equal(finish.retry,true);assert.equal(finish.errorCode,"source_unavailable");
});
