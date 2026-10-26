"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {createGeometryArchive}=require("../discovery/geometry-archive.cjs");
const origin="https://catalog.example.test/public/",selection={countryCode:"MX",stateCode:"AAA",cityId:123,cityName:"Town"};
const row={city_id:123,city_key:"MX:AAA:123",country_code:"MX",name:"Town",area_key:"b".repeat(64),geometry:{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,0]]]},license:{id:"CC-BY-4.0"}};
function fixture({record=row,url=origin+"geometry.json",hash,manifest={}}={}) {
 const body=JSON.stringify({version:1,countryCode:"MX",stateCode:"AAA",areas:[record]});
 const asset={url,sha256:hash||crypto.createHash("sha256").update(body).digest("hex"),bytes:Buffer.byteLength(body),cityIds:[123]};
 return {body,payload:{version:1,countryCode:"MX",stateCode:"AAA",parts:[asset],...manifest}};
}
test("archived polygons preserve exact city identity and reuse a hash-verified cache",async()=>{
 const f=fixture();let reads=0;
 const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:async(url,options)=>{reads++;assert.equal(options.headers["Neon-Connection-String"],undefined);return new Response(f.body);}});
 assert.deepEqual(await archive.resolve(selection),row);assert.deepEqual(await archive.resolve(selection),row);assert.equal(reads,1);
});
test("unapproved geometry origins fail before any request",async()=>{
 const f=fixture({url:"http://127.0.0.1/private"});
 const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:()=>assert.fail("SSRF request")});
 await assert.rejects(archive.resolve(selection),e=>e.code==="catalog_geometry_unavailable");
});
test("geometry hashes are verified before a polygon is used",async()=>{
 const f=fixture({hash:"0".repeat(64)});const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:async()=>new Response(f.body)});
 await assert.rejects(archive.resolve(selection),e=>e.code==="catalog_geometry_unavailable");
});
test("an incorrect city name or country cannot inherit another city's boundary",async()=>{
 for(const record of [{...row,name:"Other"},{...row,country_code:"BR"}]){
  const f=fixture({record});const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:async()=>new Response(f.body)});
  await assert.rejects(archive.resolve(selection),e=>e.code==="catalog_geometry_unavailable");
 }
});
test("ambiguous chunk membership does not select an arbitrary boundary",async()=>{
 const f=fixture();f.payload.parts.push({...f.payload.parts[0]});const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:()=>assert.fail("Ambiguous source")});
 assert.equal(await archive.resolve(selection),null);
});
test("streaming response length is bounded independently of HTTP headers",async()=>{
 const f=fixture();f.payload.parts[0].bytes=1;
 const archive=createGeometryArchive({origin,sql:async()=>[{payload:f.payload}],fetchImpl:async()=>new Response(f.body)});
 await assert.rejects(archive.resolve(selection),e=>e.code==="catalog_geometry_unavailable");
});
test("manual places still use the existing interactive resolution flow",async()=>{
 const archive=createGeometryArchive({origin,sql:()=>assert.fail("Unexpected bulk geocoding")});
 assert.equal(await archive.resolve({...selection,cityId:null}),null);
});
