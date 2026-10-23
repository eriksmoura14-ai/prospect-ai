"use strict";
// Explicit, bounded live validation. Not part of npm test; no production writes.
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{execFileSync}=require("node:child_process"),{createRequire,Module}=require("node:module");
if(process.env.DISCOVERY_LIVE_TEST!=="seven-selected-cities")throw new Error("Set DISCOVERY_LIVE_TEST=seven-selected-cities for the bounded live benchmark.");
const root=path.resolve(__dirname,".."),out=path.join(root,".artifacts/global-discovery-20261023"),base="f876edde5df0c178245411f48ed3a7c94953b641";
const samples=JSON.parse(fs.readFileSync(path.join(out,"geocodes.json")));
const mode=process.argv[2]||"baseline",niche="Restaurantes",requireLocal=createRequire(path.join(root,"server.cjs"));
function oldModule(file){const m=new Module(path.join(root,file));m.filename=path.join(root,file);m.paths=module.paths;m._compile(execFileSync("git",["show",base+":"+file],{cwd:root,encoding:"utf8"}),m.filename);return m.exports;}
const originalQlever=oldModule("qlever.cjs"),originalGeocoding=oldModule("geocoding.cjs");
const mockFS={...fs,readFileSync:()=>{throw new Error("No persistent legacy cache in live comparison");},mkdirSync(){},writeFileSync(){},renameSync(){}};
const context={require:name=>name==="node:fs"?mockFS:name==="./qlever.cjs"?originalQlever:name==="./geocoding.cjs"?originalGeocoding:requireLocal(name),module:{exports:{}},__dirname:root,
  process:{env:{APP_PASSWORD:"isolated-benchmark-only-password",APP_ORIGIN:"http://127.0.0.1:3000",BUSINESS_PROVIDER:"qlever"}},console:{log(){},error(){},warn(){}},Buffer,URL,URLSearchParams,AbortSignal,structuredClone,setTimeout,clearTimeout,
  fetch:async(input,options)=>{const url=new URL(input);if(url.hostname==="nominatim.openstreetmap.org"){
    const city=url.searchParams.get("q").split(",")[0];const sample=samples.find(s=>s.city===city);return new Response(JSON.stringify(sample?.candidates||[]));
  }return fetch(input,options);}};
const source=execFileSync("git",["show",base+":server.cjs"],{cwd:root,encoding:"utf8"});
vm.runInNewContext(source.slice(0,source.lastIndexOf("server.listen("))+"\nmodule.exports={discover,businessMatch};",context);
const legacy=context.module.exports;
const metrics=rows=>({unique:rows.length,withPhone:rows.filter(r=>r.phone).length,withWebsite:rows.filter(r=>r.website).length,withAddress:rows.filter(r=>r.address).length,validLocation:rows.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).length});
async function main(){
  let store,engine;
  if(mode==="new"){
    const u=new URL(process.env.TEST_DISCOVERY_DATABASE_URL);if(!["127.0.0.1","localhost"].includes(u.hostname))throw new Error("Benchmark only writes to disposable loopback PostGIS.");
    store=require("../discovery/store.cjs").createStore({databaseUrl:u.href,local:true});await store.migration();
    engine=require("../discovery/engine.cjs").createEngine({store,providers:require("../discovery/providers.cjs").providers({businessMatch:legacy.businessMatch,python:process.env.OVERTURE_PYTHON}),sources:["qlever","overture"],totalMs:75000});
  }
  const report={mode,baselineCommit:base,niche,scope:"Discovery only; no website verification, accounts, WhatsApp lookups or production writes",samples:[]};
  try{for(const sample of samples){const start=Date.now(),selection={countryCode:sample.country,stateName:sample.state,stateIso:sample.iso,stateCode:sample.iso.split("-")[1],cityName:sample.city,countryName:({DE:"Germany",BR:"Brazil",CA:"Canada"})[sample.country]};
    try{
      let result;
      if(mode==="baseline")result=await legacy.discover(sample.city+", "+sample.state+", "+selection.countryName,niche,()=>{},()=>{},selection);
      else{const area=require("../discovery/geometry.cjs").area(sample.selected,selection);await store.saveArea(area,require("../discovery/geometry.cjs").locationKey(sample.city,selection));result=await engine.search(area,niche);}
      report.samples.push({city:sample.city,country:sample.country,elapsedMs:Date.now()-start,status:"success",...metrics(result.rows),raw:result.metrics?.raw??null,truncated:Boolean(result.truncated),sourceCoverage:result.sources||[{source:result.provider,outcome:"success",count:result.rows.length}],selectedOsmId:sample.selected?.osm_id});
    }catch(error){report.samples.push({city:sample.city,country:sample.country,elapsedMs:Date.now()-start,status:"error",errorCode:error.code||"error",error:error.message,sources:error.sources||[],unique:null,withPhone:null,withWebsite:null,withAddress:null,validLocation:null});}
    fs.writeFileSync(path.join(out,mode+".json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report.samples.at(-1)),"\n");
  }}finally{await store?.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
