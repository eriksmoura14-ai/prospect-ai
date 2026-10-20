"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const qlever = require("../qlever.cjs");
const niches = require("../niches.cjs");
const place = {osm_type:"relation",osm_id:314875};
const uri = value => ({type:"uri",value});
const literal = value => ({type:"literal",value});
function row(id = "10594432545", tag = "shop", value = "barber") {
  return {region:uri("https://www.openstreetmap.org/relation/314875"),
    poi:uri("https://www.openstreetmap.org/node/" + id),name:literal("Empresa fictícia"),
    tag:uri("https://www.openstreetmap.org/wiki/Key:" + tag),value:literal(value),wkt:literal("POINT(-48.3 -18.9)")};
}
const data = bindings => ({results:{bindings}});

test("QLever preserves exact administrative relations for Brazil and international cities", () => {
  for (const id of [314875, 1720290]) {
    const query = qlever.buildQuery({...place,osm_id:id}, niches.Barber);
    assert.ok(query.includes(`VALUES ?region { <https://www.openstreetmap.org/relation/${id}> }`));
    assert.ok(query.includes(`<https://www.openstreetmap.org/relation/${id}> ogc:sfContains ?poi`));
    assert.ok(!query.includes('?region ogc:sfContains ?poi'));
    assert.ok(query.includes('LIMIT 501'));
    assert.ok(!query.includes("IBGE") && !query.includes("radius"));
  }
  assert.throws(() => qlever.buildQuery({osm_type:"node",osm_id:2},niches.Barber), {code:"qlever_region_unsupported"});
  assert.throws(() => qlever.buildQuery({...place,osm_id:'1> . ?x ?y ?z'},niches.Barber), {code:"qlever_region_unsupported"});
});
test("City relations do not require an administrative tag; all world catalogue geometries stay bounded", () => {
  const fixtures = require('./fixtures/geocoding-world.json');
  for (const item of fixtures.queries.filter(item => item.data.length)) {
    const selected = item.data[0];
    for (const mode of ['categories', 'names']) {
      const query = qlever.buildQuery(selected, niches.Barber, mode);
      assert.ok(query.includes(`VALUES ?region { <https://www.openstreetmap.org/${selected.osm_type}/${selected.osm_id}> }`), item.name);
      assert.ok(!query.includes('Key:boundary> "administrative"'), item.name);
      const optional = query.slice(query.indexOf('OPTIONAL {'));
      if (selected.osm_type === 'relation') {
        assert.ok(optional.includes(`<https://www.openstreetmap.org/relation/${selected.osm_id}> ogc:sfContains ?poi`), item.name);
        assert.ok(!optional.includes('?region ogc:sfContains'), item.name);
      } else {
        const [s,n,w,e] = selected.boundingbox.map(Number);
        assert.ok(optional.includes(`POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`), item.name);
        assert.ok(optional.includes('geof:sfIntersects(?searchGeometry,'), item.name);
        assert.ok(!query.includes('ogc:sfContains ?poi'), item.name);
      }
    }
  }
});
test("Node and way localities retain identity for both results and a genuine empty response", () => {
  for (const type of ['node','way']) {
    const town = {osm_type:type,osm_id:42,boundingbox:['1','2','3','4']};
    const binding = {...row(),region:uri(`https://www.openstreetmap.org/${type}/42`)};
    assert.equal(qlever.extract(data([binding]),town).elements.length,1);
    assert.equal(qlever.extract(data([{region:binding.region}]),town).elements.length,0);
    assert.throws(()=>qlever.extract(data([row()]),town),{code:'qlever_region_missing'});
    assert.ok(qlever.buildQuery(town,niches.Barber).includes('POLYGON((3 1,4 1,4 2,3 2,3 1))'));
  }
});
test("Invalid or oversized locality rectangles are rejected before making a request", async () => {
  for (const boundingbox of [null,[],[1,2,3,'4)> . ?x ?y ?z'],['',2,3,4],[2,1,3,4],[1,2,4,3],[1,4,3,4],[-91,-90,3,4],[1,2,179,181]]) {
    let calls=0;
    await assert.rejects(qlever.discover({osm_type:'node',osm_id:42,boundingbox},niches.Barber,{fetchImpl:async()=>{calls++;}}),{code:'qlever_region_unsupported'});
    assert.equal(calls,0);
  }
});
test("QLever covers original niche categories, cuisine and restricted food name matching", () => {
  for (const config of Object.values(niches)) assert.ok(qlever.buildQuery(place,config).includes("SELECT DISTINCT ?region ?poi ?name"));
  const pizza = qlever.buildQuery(place,niches.Pizzarias);
  assert.ok(pizza.includes('Key:cuisine> ?cuisine'));
  assert.ok(pizza.includes('(pizza)'));
  const names=qlever.buildQuery(place,niches.Pizzarias,"names");
  assert.ok(names.includes('Key:amenity> ?foodType'));
  assert.ok(!pizza.includes('Key:office> ?commercialType'));
  assert.ok(qlever.buildQuery(place,niches.Barber,"names").includes("barbearia"));
});
test("RDF rows preserve IDs, public tags, exact coordinates and missing coordinates", () => {
  const a = row(), b = row(undefined,"contact:phone","+55 34 3238 1200"), c = row("22","contact:whatsapp","+55 34 99999 1234");
  c.poi=uri("https://www.openstreetmap.org/way/22");c.wkt=literal("POLYGON((-48 -18,-47 -18,-48 -18))");
  const result = qlever.extract(data([a,b,c]),place);
  assert.equal(result.elements.length,2);
  assert.equal(result.elements[0].id,"10594432545");
  assert.equal(result.elements[0].tags["contact:phone"],"+55 34 3238 1200");
  assert.equal(result.elements[0].lat,-18.9);assert.equal(result.elements[0].lon,-48.3);
  assert.equal(result.elements[1].lat,undefined);
  assert.equal(result.elements[1].tags["contact:whatsapp"],"+55 34 99999 1234");
  assert.equal(result.truncated,false);
});
test("RDF rejects unrelated regions, external subjects, blank names and invalid coordinates", () => {
  const external = {...row(),poi:uri("https://evil.example/node/1")};
  const blank = {...row(),name:literal(" ")};
  const invalid = {...row("2"),wkt:literal("POINT(999 NaN)")};
  const result=qlever.extract(data([external,blank,invalid]),place);
  assert.equal(result.elements.length,1);assert.equal(result.elements[0].lat,undefined);
  assert.throws(()=>qlever.extract(data([{...row(),region:uri("https://www.openstreetmap.org/relation/99")}]),place),{code:"qlever_region_missing"});
  assert.throws(()=>qlever.extract({exception:"timeout",...data([row()])},place),{code:"qlever_invalid_response"});
  assert.throws(()=>qlever.extract(null,place),{code:"qlever_invalid_response"});
  assert.equal(qlever.extract(data([{region:row().region}]),place).elements.length,0);
});
test("Candidate limit counts entities rather than tag rows and labels truncation", () => {
  const bindings=Array.from({length:501},(_,i)=>row(String(i+1)));
  const result=qlever.extract(data(bindings.flatMap(r=>[r,{...r,tag:uri("https://www.openstreetmap.org/wiki/Key:phone"),value:literal("123")}])) ,place);
  assert.equal(result.elements.length,500);assert.equal(result.truncated,true);assert.match(result.warning,/500/);
  assert.equal(qlever.extract(data(bindings.slice(0,500)),place).truncated,false);
});
test("Request uses public endpoint and two bounded stages for the selected subjects",async()=>{
  const traces=[];let calls=0;
  const result=await qlever.discover(place,niches.Barber,{onTrace:t=>traces.push(t),fetchImpl:async(url,options)=>{
    calls++;assert.equal(new URL(url).origin,"https://qlever.dev");assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,undefined);
    return new Response(JSON.stringify(data([row()])));
  }});
  assert.equal(calls,2);assert.equal(result.elements.length,1);assert.equal(traces[0].outcome,"success");
  assert.equal(traces[0].httpStatus,200);assert.ok(traces[0].bytes>0);assert.equal(traces[0].phase,"complete");
  assert.equal(traces[1].purpose,"details");
});
test("Details preserve only selected OSM subjects and fail on incomplete enrichment",()=>{
 const elements=qlever.extract(data([row()]),place).elements;
 const details=row();delete details.region;delete details.name;
 assert.equal(qlever.enrich(elements,data([details]))[0].tags.shop,"barber");
 assert.throws(()=>qlever.enrich(elements,data([{...details,poi:uri("https://evil.example/node/1")}])),{code:"qlever_invalid_response"});
 assert.throws(()=>qlever.buildDetailsQuery([{type:"node",id:"1>"}]),{code:"qlever_invalid_subject"});
 assert.ok(qlever.buildDetailsQuery(elements).includes("VALUES ?poi"));
});
test("Wide detail columns preserve original contacts and chain identifiers without inventing a phone",()=>{
 const elements=qlever.extract(data([row()]),place).elements;
 const query=qlever.buildDetailsQuery(elements);
 const phoneIndex=/Key:contact:phone> \?field(\d+)/.exec(query)[1];
 const chainIndex=/Key:brand:wikidata> \?field(\d+)/.exec(query)[1];
 const item={poi:row().poi,wkt:literal("POINT(-48.3 -18.9)"),[`field${phoneIndex}`]:literal("+55 34 3238 1200"),[`field${chainIndex}`]:uri("http://www.wikidata.org/entity/Q1")};
 qlever.enrich(elements,data([item]));
 assert.equal(elements[0].tags["contact:phone"],"+55 34 3238 1200");
 assert.equal(elements[0].tags.whatsapp,undefined);assert.equal(elements[0].tags["brand:wikidata"],"http://www.wikidata.org/entity/Q1");
});
test("Large subject lists use POST, and empty categories use one bounded name query",async()=>{
 let calls=0;
 const subjects=Array.from({length:100},(_,i)=>row(String(i+1)));
 await qlever.discover(place,niches.Barber,{fetchImpl:async(url,options)=>{
   calls++;
   if(calls===1)return new Response(JSON.stringify(data(subjects)));
   assert.equal(options.method,"POST");assert.equal(url,qlever.ENDPOINT);
   assert.ok(new URLSearchParams(options.body).get("query").includes("VALUES ?poi"));
   return new Response(JSON.stringify(data(subjects)));
 }});
 assert.equal(calls,2);calls=0;
 const result=await qlever.discover(place,niches.Barber,{fetchImpl:async()=>{calls++;return new Response(JSON.stringify(data([{region:row().region}])));}});
 assert.equal(calls,2);assert.equal(result.elements.length,0);
});
test("429 stops without retry, switching provider or reporting an empty result",async()=>{
  let calls=0;const traces=[];
  await assert.rejects(qlever.discover(place,niches.Barber,{onTrace:t=>traces.push(t),fetchImpl:async()=>{calls++;return new Response("quota",{status:429});}}),{code:"qlever_http_429"});
  assert.equal(calls,1);assert.equal(traces[0].outcome,"qlever_http_429");
});
test("Timeouts, numeric transport codes, invalid JSON and oversized responses become clear errors",async()=>{
  for(const [error,code] of [[Object.assign(new Error("timeout"),{name:"TimeoutError",code:23}),"qlever_timeout"],[new Error("connection"),"qlever_connection"]]) {
    await assert.rejects(qlever.discover(place,niches.Barber,{fetchImpl:async()=>{throw error;}}),{code});
  }
  await assert.rejects(qlever.discover(place,niches.Barber,{fetchImpl:async()=>new Response("not json")}),{code:"qlever_invalid_response"});
  await assert.rejects(qlever.discover(place,niches.Barber,{fetchImpl:async()=>new Response("x".repeat(qlever.MAX_BYTES+1))}),{code:"qlever_response_limit"});
});
