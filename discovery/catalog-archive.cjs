"use strict";
const {spawn}=require("node:child_process"),path=require("node:path"),crypto=require("node:crypto");
const records=require("./records.cjs"),geo=require("./geometry.cjs");
const failure=()=>Object.assign(new Error("Catálogo regional temporariamente indisponível; resultados existentes preservados."),{code:"catalog_archive_unavailable"});
const ORIGIN="https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/";
function createArchive({databaseUrl,python,fetchImpl=fetch,reader=read}={}) {
 const url=new URL(databaseUrl);if(!url.hostname.endsWith(".neon.tech")||url.protocol!=="postgresql:"||!python)throw new Error("Configure a base isolada e o leitor do catálogo.");
 let busy=false;
 async function sql(query,params=[]) {
  const response=await fetchImpl("https://"+url.hostname+"/sql",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json","Neon-Connection-String":databaseUrl,"Neon-Raw-Text-Output":"false","Neon-Array-Mode":"false"},body:JSON.stringify({query,params})});
  if(!response.ok)throw failure();const data=await response.json();if(data.error||!Array.isArray(data.rows))throw failure();return data.rows;
 }
 async function resolveArea(selection) {
  if(!selection?.countryCode||!selection.stateCode)return null;
  const rows=await sql(`SELECT c.name,c.country_code,c.state_name,c.city_key,c.association_status,c.unique_supported,a.id,a.kind,a.source,a.vintage,a.license,a.bounds,a.area_key,ST_AsGeoJSON(a.geom,15,0)::jsonb AS geometry
   FROM catalog_city_inventory c JOIN catalog_admin_areas a ON a.id=c.admin_id WHERE c.country_code=$1 AND c.state_code=$2 AND ($3::bigint IS NOT NULL AND c.city_id=$3 OR $3::bigint IS NULL AND c.normalized_name=$4) LIMIT 2`,[selection.countryCode,selection.stateCode,Number.isSafeInteger(selection.cityId)?selection.cityId:null,geo.normalize(selection.cityName)]);
  if(rows.length!==1)return null;const row=rows[0];
  const place={name:row.name,display_name:[row.name,row.state_name,row.country_code].join(", "),osm_type:"external",osm_id:row.id,boundingbox:row.bounds,geojson:row.geometry,address:{country_code:row.country_code.toLowerCase(),state:row.state_name}};
  const area=geo.area(place,{countryCode:row.country_code,cityName:row.name,stateName:row.state_name});
  return {...area,key:row.area_key,scope:`${row.source} · ${row.kind} · ${row.vintage}`,catalogCityKey:row.city_key,boundaryLicense:row.license,officialBoundary:true};
 }
 async function query(area,niche,limit=50,after="",expectedSnapshot=null) {
  if(!records.groups[niche]||!Number.isSafeInteger(limit)||limit<1||limit>3000||typeof after!=="string"||after.length>180)throw new Error("Página de catálogo inválida.");
  if(busy)throw failure();busy=true;
  try {
   const assets=await sql("SELECT id,url,sha256,bytes,records,source,release,license FROM catalog_assets WHERE state='ready' AND $1=ANY(countries) ORDER BY id LIMIT 9",[area.countryCode]);
   for(const a of assets)if(!a.url.startsWith(ORIGIN)||!/^[a-f0-9]{64}$/.test(a.sha256)||Number(a.bytes)>256*1024*1024)throw failure();
   const snapshot=crypto.createHash("sha256").update(JSON.stringify(assets.map(a=>[a.id,a.sha256]))).digest("hex");
   if(expectedSnapshot&&expectedSnapshot!==snapshot)throw Object.assign(new Error("O catálogo foi ampliado. Reinicie a paginação para usar a nova versão."),{status:409});
   const data=await reader(python,{assets,countryCode:area.countryCode,bounds:area.bounds,geometry:area.geometry,categories:records.groups[niche],limit,after});
   const rows=data.rows.map(raw=>{
    const provenance=typeof raw.provenance==="string"?JSON.parse(raw.provenance):raw.provenance;
    const result=records.overture({id:raw.source_id,geometry:{type:"Point",coordinates:[raw.longitude,raw.latitude]},properties:{names:{primary:raw.name},taxonomy:{primary:raw.primary_category,hierarchy:raw.category_hierarchy,alternates:raw.alternate_categories},basic_category:raw.basic_category,confidence:raw.confidence,operating_status:raw.operating_status,addresses:[{country:raw.country_code,region:raw.state,locality:raw.city,freeform:raw.address}],phones:raw.phones||[raw.phone],websites:raw.websites||[raw.website],sources:provenance}},area,raw.source_release);
    return result?{...result,category:niche,discoveredAt:raw.discovered_at,lastSeenAt:raw.last_seen_at,lastVerifiedAt:raw.last_verified_at||null,catalogArchive:true}:null;
   }).filter(Boolean);
   return {...data,rows,snapshot,archive:true,partial:true,sources:assets.map(a=>({source:a.source,release:a.release,asset:a.id,verified:false})),rejected:data.rows.length-rows.length};
  }catch(error){if(error.status===409)throw error;throw failure();}finally{busy=false;}
 }
 return {resolveArea,query};
}
function read(python,spec) {
 return new Promise((resolve,reject)=>{
  const allowed=["PATH","HOME","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy","SSL_CERT_FILE","REQUESTS_CA_BUNDLE","CATALOG_CACHE_DIR"];
  const env=Object.fromEntries(allowed.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const child=spawn(python,[path.join(__dirname,"../scripts/catalog-read.py")],{env,stdio:["pipe","pipe","pipe"]});let bytes=0,done=false;const chunks=[];
  const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);err?reject(failure()):resolve(data);};
  const timer=setTimeout(()=>{child.kill("SIGKILL");finish(true);},65000);
  child.on("error",()=>finish(true));child.stderr.resume();child.stdin.on("error",()=>{});
  child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){child.kill("SIGKILL");finish(true);}else chunks.push(chunk);});
  child.on("close",code=>{try{const data=JSON.parse(Buffer.concat(chunks));finish(code!==0||data.error||!Array.isArray(data.rows),data);}catch{finish(true);}});child.stdin.end(JSON.stringify(spec));
 });
}
function cursor(area,niche,last,snapshot="") {return Buffer.from(JSON.stringify([crypto.createHash("sha256").update(area.key+":"+niche).digest("hex"),last,snapshot])).toString("base64url");}
function decodeCursor(value,area,niche) {
 if(!value)return {after:"",snapshot:null};
 try{if(value.length>700)throw Error();const [scope,last,snapshot]=JSON.parse(Buffer.from(value,"base64url"));if(cursor(area,niche,last,snapshot)!==value||typeof last!=="string"||last.length>180||typeof snapshot!=="string"||snapshot&&!/^[a-f0-9]{64}$/.test(snapshot))throw Error();return {after:last,snapshot};}catch{throw Object.assign(new Error("Página inválida para esta busca."),{status:400});}
}
module.exports={createArchive,read,cursor,decodeCursor};
