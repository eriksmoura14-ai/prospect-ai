"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {createEngine}=require("../discovery/engine.cjs"),records=require("../discovery/records.cjs");
const {createArchive,cursor,decodeCursor}=require("../discovery/catalog-archive.cjs");
const area={key:"fixture",countryCode:"US",bounds:[0,2,0,2],geometry:{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]},city:"Small Town",state:"State"};
const raw={source_id:"public-1",name:"Town Bakery",country_code:"US",state:"WA",city:"Small Town",address:"Main 1",longitude:1,latitude:1,primary_category:"bakery",category_hierarchy:["bakery"],alternate_categories:[],phones:[],websites:[],confidence:.8,source_release:"2026-10-21.0",provenance:JSON.stringify([{dataset:"overture-signals",record_id:"operating_status_signal",property:"/properties/operating_status",license:"CDLA-Permissive-2.0"}]),discovered_at:"2026-10-01T00:00:00Z",last_seen_at:"2026-10-21T00:00:00Z"};
test("archive preserves observation dates and treats absent contacts as unverified",async()=>{
 const archive=createArchive({databaseUrl:"postgresql://reader:fixture@fixture.neon.tech/catalog",python:"python",fetchImpl:async()=>({ok:true,json:async()=>({rows:[]})}),reader:async()=>({rows:[raw],truncated:false,next:null})});
 const page=await archive.query(area,"Padarias",10);
 assert.equal(page.rows.length,1);assert.equal(page.rows[0].discoveredAt,raw.discovered_at);assert.equal(page.rows[0].lastVerifiedAt,null);assert.equal(page.rows[0].websiteClassification,"insufficient_information");assert.equal(page.rows[0].phone,"");assert.equal(page.rows[0].catalogArchive,true);
});
test("reviewed status signals cannot authorize an unrelated field or license",()=>{
 const source={id:"p",names:{primary:"Place"},geometry:{coordinates:[1,1]},sources:[{dataset:"overture-signals",license:"CDLA-Permissive-2.0",property:"/properties/phones"}]};
 assert.equal(records.overture(source,area),null);
 assert.equal(records.overture({...source,sources:[{...source.sources[0],property:"/properties/operating_status",license:"unknown"}]},area),null);
});
test("pagination cursor cannot be reused for another city or segment",()=>{
 const value=cursor(area,"Padarias","public-id","f".repeat(64));assert.deepEqual(decodeCursor(value,area,"Padarias"),{after:"public-id",snapshot:"f".repeat(64)});
 assert.throws(()=>decodeCursor(value,{...area,key:"other-city"},"Padarias"));assert.throws(()=>decodeCursor(value,area,"Barber"));assert.throws(()=>decodeCursor("bad",area,"Padarias"));
});
test("a changed catalog snapshot rejects the old cursor before reading Parquet",async()=>{
 const archive=createArchive({databaseUrl:"postgresql://reader:fixture@fixture.neon.tech/catalog",python:"python",fetchImpl:async()=>({ok:true,json:async()=>({rows:[]})}),reader:async()=>assert.fail("Snapshot changed")});
 await assert.rejects(archive.query(area,"Padarias",10,"public-id","f".repeat(64)),e=>e.status===409);
});
test("enough archived unique records avoids another provider request or mutable-catalog write",async()=>{
 const row={osmId:"overture/p",name:"Town Bakery",countryCode:"US",latitude:1,longitude:1,sourceKey:"overture",phone:"",website:"",address:"",provenance:[]};
 const forbidden=()=>assert.fail("Unnecessary source call or mutable write");
 const engine=createEngine({store:{query:async()=>({rows:[row],archive:true,truncated:false}),coverage:forbidden,enqueue:forbidden,upsert:forbidden},sources:["qlever"],providers:{qlever:forbidden}});
 const result=await engine.search(area,"Padarias",{desiredRows:1});assert.equal(result.metrics.archive,true);assert.equal(result.partial,true);
});
test("unapproved asset URLs fail before a reader subprocess starts",async()=>{
 const archive=createArchive({databaseUrl:"postgresql://reader:fixture@fixture.neon.tech/catalog",python:"python",fetchImpl:async()=>({ok:true,json:async()=>({rows:[{url:"http://127.0.0.1/private",sha256:"a".repeat(64),bytes:100}]})}),reader:async()=>assert.fail("Invalid URL reached reader")});
 await assert.rejects(archive.query(area,"Padarias",10),e=>e.code==="catalog_archive_unavailable");
});
test("official geometry queries use a source-neutral scope marker instead of a fabricated OSM identity",async()=>{
 let calls=0;
 const provider=require("../discovery/providers.cjs").providers({businessMatch:()=>true,fetchImpl:async(url,options)=>{
  calls++;const query=options?.method==="POST"?new URLSearchParams(options.body).get("query"):new URL(url).searchParams.get("query");
  assert.match(query,/urn:prospect:area:[a-f0-9]{64}/);assert.match(query,/geof:sfIntersects/);assert.doesNotMatch(query,/<https:\/\/www.openstreetmap.org\/(relation|node|way)\//);
  const scope=query.match(/urn:prospect:area:[a-f0-9]{64}/)[0];return new Response(JSON.stringify({results:{bindings:[{region:{type:"uri",value:scope}}]}}));
 }});
 const result=await provider.qlever({...area,officialBoundary:true},"Padarias");assert.equal(result.rows.length,0);assert(calls>=1);
});
test("HTTPS catalog transport refuses mutation SQL",async()=>{
 const read=require("../discovery/neon-read.cjs").createRead("postgresql://reader:fixture@fixture.neon.tech/catalog",()=>assert.fail());await assert.rejects(read("UPDATE catalog_assets SET state='retired'"),/somente leitura/);
});
test("archive narrows files by geographic overlap before applying its bounded reader limit",async()=>{
 let request;
 const archive=createArchive({databaseUrl:"postgresql://reader:fixture@fixture.neon.tech/catalog",python:"python",fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({rows:[]})};},reader:async()=>({rows:[],next:null,truncated:false})});
 await archive.query({...area,bounds:[10,20,30,40]},"Padarias",10);
 assert.deepEqual(request.params,["US",40,30,20,10]);
 assert.match(request.query,/bounds IS NULL OR bounds='null'::jsonb/);
 assert.ok(request.query.indexOf("bounds->>0")<request.query.indexOf("LIMIT 9"));
 assert.match(request.query,/state='ready'/);
});
