"use strict";
// Real local HTTP flow with a synthetic engine and synthetic geocoding.
// No requests to Google, customer websites, mail, databases or production.
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const http = require("node:http"), { once } = require("node:events");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, ".."), localRequire = createRequire(path.join(root,"server.cjs"));
const origin = "http://127.0.0.1:3197";
const credential = "local-fixture-not-a-real-password";
const engineId = "22222222-2222-4222-8222-222222222222";

test("isolated Maps flow: auth → valid location → engine task → CSV → verification → results and cooldown", async t => {
  const calls = [];
  const engine = http.createServer(async (request,response) => {
    calls.push({method:request.method,url:request.url});
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      const chunks=[]; for await (const chunk of request) chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks));
      assert.equal(input.email,false); assert.equal(input.depth,3);
      assert.match(input.keywords[0],/Uberlândia, Minas Gerais, Brazil/);
      response.writeHead(201);return response.end(JSON.stringify({id:engineId}));
    }
    if (request.method === "DELETE") return response.end("{}");
    if (request.url.endsWith("/download")) {
      response.setHeader("Content-Type","text/csv");
      return response.end('title,place_id,category,address,phone,website,latitude,longitude,review_rating,review_count\n'+
        'Empresa fictícia do teste,ChIJ_flow_fixture,Barber shop,Rua de teste 1,+5534991234567,https://instagram.com/fixture,-18.92,-48.28,4.7,8\n'+
        'Empresa fora da área,ChIJ_outside_fixture,Barber shop,Rua de teste 2,,,12,12,4.9,10\n');
    }
    response.end(JSON.stringify({ID:engineId,Status:"ok"}));
  });
  engine.listen(8080,"127.0.0.1");await once(engine,"listening");
  t.after(()=>new Promise(resolve=>{engine.closeAllConnections();engine.close(resolve);}));
  const place={name:"Uberlândia",display_name:"Uberlândia, Minas Gerais, Brazil",category:"place",type:"city",
    osm_type:"relation",osm_id:314875,lat:"-18.92",lon:"-48.28",boundingbox:["-19","-18.8","-48.4","-48.1"],
    address:{country_code:"br",state:"Minas Gerais","ISO3166-2-lvl4":"BR-MG"}};
  const fixtureFS={...fs,readFileSync:()=>{throw new Error("No persistent cache in fixture");},
    mkdirSync(){},writeFileSync(){},renameSync(){}};
  const source=fs.readFileSync(path.join(root,"server.cjs"),"utf8");
  const context={require:name=>name==="node:fs"?fixtureFS:localRequire(name),__dirname:root,module:{exports:{}},
    process:{env:{BUSINESS_PROVIDER:"google-maps",PROSPECT_TEST_MODE:"true",AUTH_MODE:"basic",
      APP_USER:"erik-test",APP_PASSWORD:credential,APP_ORIGIN:origin}},
    console:{log(){},warn(){},error(){}},Buffer,URL,URLSearchParams,AbortSignal,structuredClone,setTimeout,clearTimeout,
    fetch:async input=>{
      assert.equal(new URL(input).hostname,"nominatim.openstreetmap.org");
      return Response.json([place]);
    }};
  vm.runInNewContext(source.slice(0,source.lastIndexOf("server.listen("))+"\nmodule.exports={server};",context,{filename:path.join(root,"server.cjs")});
  const server=context.module.exports.server;
  server.listen(3197,"127.0.0.1");await once(server,"listening");
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Host:new URL(origin).host,Origin:origin,Authorization:"Basic "+Buffer.from("erik-test:"+credential).toString("base64"),"Content-Type":"application/json"};
  const call=(route,options={})=>fetch(base+route,{...options,headers:{...headers,...options.headers}});
  assert.equal((await call("/api/runtime",{headers:{Authorization:""}})).status,401);
  const runtime=await (await call("/api/runtime")).json();
  assert.equal(runtime.testMode,true);assert.equal(runtime.businessProvider,"google-maps");assert.deepEqual(runtime.quantities,[10,20]);
  assert.equal((await call("/api/search",{method:"POST",headers:{Origin:"https://untrusted.example"},body:"{}"})).status,403);
  const payload={location:{countryCode:"BR",stateCode:"MG",cityId:15434},niche:"Barber",limit:10};
  assert.equal((await call("/api/search",{method:"POST",body:JSON.stringify({...payload,limit:50})})).status,400);
  assert.equal(calls.length,0);
  const created=await call("/api/search",{method:"POST",body:JSON.stringify(payload)});
  assert.equal(created.status,202);const {jobId}=await created.json();
  let job;
  for(let i=0;i<100;i++){
    job=await(await call("/api/jobs/"+jobId)).json();
    if(job.state!=="running")break;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(job.state,"done",JSON.stringify(job));assert.equal(job.rows.length,1);
  const row=job.rows[0];
  assert.equal(job.discoveryProvider,"google-maps");assert.equal(row.source,"Google Maps");
  assert.equal(row.sourceCategory,"Barber shop");assert.equal(row.websiteVerification,"profile");
  assert.equal(row.rating,4.7);assert.equal(row.reviewCount,8);assert.match(row.sourceUrl,/www.google.com/);
  assert.equal(row.status,"WEBSITE_LISTED");assert.notEqual(row.status,"LIKELY_NO_WEBSITE");
  assert.equal(calls.filter(call=>call.method==="POST").length,1);assert.equal(calls.at(-1).method,"DELETE");
  assert.equal((await call("/api/search",{method:"POST",body:JSON.stringify(payload)})).status,429);
  assert.equal((await call("/api/v1/jobs")).status,404);
  for(const privateFile of ["/server.cjs","/google-maps.cjs","/.env","/Dockerfile.maps-test"]){
    assert.equal((await call(privateFile)).status,404);
  }
  assert.equal((await call("/api/history")).status,404); // No production account/database.
});
