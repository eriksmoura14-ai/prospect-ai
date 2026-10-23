"use strict";
const {spawn}=require("node:child_process"),path=require("node:path");
const qlever=require("../qlever.cjs"),matching=require("../niche-matching.cjs"),niches=require("../niches.cjs"),records=require("./records.cjs");
const failure=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
async function json(url,options,fetchImpl=fetch) {
  const response=await fetchImpl(url,{...options,redirect:"error"});
  if(!response.ok){await response.body?.cancel();throw failure("source_http_"+response.status,"Fonte respondeu HTTP "+response.status,{httpStatus:response.status,retryAfter:response.headers.get("retry-after")});}
  const parts=[];let bytes=0;
  for await(const part of response.body){bytes+=part.length;if(bytes>8*1024*1024)throw failure("source_size","Resposta excedeu 8 MiB.");parts.push(Buffer.from(part));}
  try{return JSON.parse(Buffer.concat(parts).toString());}catch{throw failure("source_json","Resposta JSON inválida.");}
}
function overture(area,niche,{python,timeoutMs=60000,maxBytes=32*1024*1024,maxRows=1000}={}) {
  if(!python)throw failure("source_not_configured","Configure OVERTURE_PYTHON ou importe um recorte regional.");
  return new Promise((resolve,reject)=>{
    const allowed=["PATH","HOME","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy","SSL_CERT_FILE","REQUESTS_CA_BUNDLE","DUCKDB_EXTENSION_DIRECTORY","OVERTURE_CACHE_DIR"];
    const env=Object.fromEntries(allowed.filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    const child=spawn(python,[path.join(__dirname,"../scripts/overture-region.py")],{env,stdio:["pipe","pipe","pipe"]});
    const chunks=[];let size=0,done=false;const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(data);};
    const timer=setTimeout(()=>{child.kill("SIGKILL");finish(failure("source_timeout","Recorte Overture excedeu o prazo."));},Math.min(timeoutMs,75000));
    child.on("error",()=>finish(failure("source_process","Não foi possível iniciar o extrator Overture.")));
    child.stderr.resume();
    child.stdout.on("data",part=>{size+=part.length;if(size>8*1024*1024){child.kill("SIGKILL");finish(failure("source_size","Recorte Overture excedeu o limite de saída."));}else chunks.push(part);});
    child.on("exit",code=>{let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{return finish(failure("source_process","Extrator não retornou dados válidos."));}
      if(code!==0||data.error)return finish(failure(data.error||"source_process","Overture indisponível dentro do orçamento configurado.",{providerReason:data.reason,providerDetails:data.detail,httpStatus:data.httpStatus,retryAfter:data.retryAfter}));
      const rows=data.rows.map(raw=>records.overture(raw,area,data.release)).filter(Boolean).filter(row=>records.overtureMatches(row,niche)).map(row=>({...row,category:niche}));
      const insideCount=data.rows.filter(raw=>require("./geometry.cjs").inside(area,{latitude:raw.geometry?.coordinates?.[1],longitude:raw.geometry?.coordinates?.[0]})).length;
      finish(null,{rows,truncated:Boolean(data.truncated)||rows.length<insideCount,metrics:{...data.metrics,rejectedInsideArea:insideCount-rows.length}});});
    child.stdin.on("error",()=>{});child.stdin.end(JSON.stringify({bounds:area.bounds,geometry:area.geometry,maxBytes,maxRows,timeoutSeconds:Math.max(1,Math.ceil(timeoutMs/1000)-5),categories:records.groups[niche]||[]}));
  });
}
function providers({overpassURL="https://overpass.private.coffee/api/interpreter",overpassMethod="POST",python,fetchImpl=fetch,businessMatch,userAgent="ProspectAI/0.9 (+https://github.com/eriksmoura14-ai/prospect-ai)"}={}) {
  return {
    async qlever(area,niche,options={}) {
      if(area.officialBoundary)throw failure("source_area_unsupported","QLever exige um identificador OSM confirmado; a área oficial não foi convertida em uma relação fictícia.");
      const data=await qlever.discover(area.place,niches[niche],{fetchImpl,userAgent,geometryOnly:true,onTrace:options.onTrace,timeoutMs:options.timeoutMs});
      const matchingElements=data.elements.filter(e=>businessMatch(e.tags||{},niche));
      const rows=matchingElements.map(e=>records.osm(e,area,niche,"qlever")).filter(Boolean);
      const missingCoordinates=matchingElements.filter(e=>!Number.isFinite(e.lat??e.center?.lat)||!Number.isFinite(e.lon??e.center?.lon)).length;
      return {rows,truncated:Boolean(data.truncated)||missingCoordinates>0,metrics:{raw:data.elements.length,valid:rows.length,missingCoordinates}};
    },
    async overpass(area,niche,options={}) {
      const [s,n,w,e]=area.bounds,scope=`(${s},${w},${n},${e})`,selectors=matching.selectors(niches[niche],scope);
      if(!selectors.length)return {rows:[],truncated:true,metrics:{note:"Segmento sem seletor direto; fonte complementar necessária."}};
      const query=`[out:json][timeout:20][maxsize:8388608];(${selectors.join("\n")});out body center;`;
      const url=new URL(overpassURL),method=overpassMethod;let body;
      if(method==="GET")url.searchParams.set("data",query);else body=new URLSearchParams({data:query});
      const data=await json(url,{method,body,headers:{"User-Agent":userAgent,"Content-Type":"application/x-www-form-urlencoded"},signal:AbortSignal.timeout(Math.min(30000,options.timeoutMs||30000))},fetchImpl);
      if(data.remark||!Array.isArray(data.elements))throw failure("source_incomplete","Overpass retornou uma resposta incompleta.");
      const rows=data.elements.filter(e=>businessMatch(e.tags||{},niche)).map(e=>records.osm(e,area,niche,"overpass")).filter(Boolean);
      return {rows,truncated:false,metrics:{raw:data.elements.length,valid:rows.length}};
    },
    overture:(area,niche,options)=>overture(area,niche,{...options,python})
  };
}
module.exports={providers,overture,json};
