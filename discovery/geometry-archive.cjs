"use strict";
const crypto=require("node:crypto"),zlib=require("node:zlib"),geo=require("./geometry.cjs");
const fail=()=>Object.assign(new Error("Limite geográfico arquivado temporariamente indisponível."),{code:"catalog_geometry_unavailable"});
function createGeometryArchive({sql,fetchImpl=fetch,origin}) {
 const cache=new Map(),pending=new Map();let cachedBytes=0;
 const maximumBytes=2*1024*1024,cacheBudget=4*1024*1024;
 async function load(asset) {
  let url;try{url=new URL(asset.url);}catch{throw fail();}
  if(!url.href.startsWith(origin)||url.href!==asset.url||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>maximumBytes)throw fail();
  if(asset.encoding!==undefined&&asset.encoding!=="gzip-json")throw fail();
  if(asset.encoding==="gzip-json"&&(!Number.isSafeInteger(asset.decodedBytes)||asset.decodedBytes<1||asset.decodedBytes>maximumBytes||!/^[a-f0-9]{64}$/.test(asset.decodedSha256)))throw fail();
  const cacheKey=[asset.sha256,asset.bytes,asset.encoding||"json",asset.decodedBytes||"",asset.decodedSha256||""].join(":");
  const hit=cache.get(cacheKey);
  if(hit){cache.delete(cacheKey);cache.set(cacheKey,hit);return hit.data;}
  if(pending.has(cacheKey))return pending.get(cacheKey);
  if(pending.size>=2)throw fail();
  const promise=(async()=>{
   const response=await fetchImpl(url.href,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/json"}});
   if(!response.ok||!response.body)throw fail();
   let size=0;const chunks=[];
   for await(const part of response.body){size+=part.length;if(size>asset.bytes||size>maximumBytes)throw fail();chunks.push(Buffer.from(part));}
   let body=Buffer.concat(chunks);
   if(size!==asset.bytes||crypto.createHash("sha256").update(body).digest("hex")!==asset.sha256)throw fail();
   if(asset.encoding==="gzip-json"){
    try{body=zlib.gunzipSync(body,{maxOutputLength:asset.decodedBytes});}catch{throw fail();}
    if(body.length!==asset.decodedBytes||crypto.createHash("sha256").update(body).digest("hex")!==asset.decodedSha256)throw fail();
    size=body.length;
   }
   let data;try{data=JSON.parse(body);}catch{throw fail();}
   if(data.version!==1||!Array.isArray(data.areas)||data.areas.length>1000)throw fail();
   while(cache.size&&cachedBytes+size>cacheBudget){const [key,value]=cache.entries().next().value;cache.delete(key);cachedBytes-=value.bytes;}
   cache.set(cacheKey,{data,bytes:size});cachedBytes+=size;return data;
  })();pending.set(cacheKey,promise);
  try{return await promise;}finally{pending.delete(cacheKey);}
 }
 async function resolve(selection) {
  if(!Number.isSafeInteger(selection.cityId))return null;
  // A reviewed German municipality takes precedence over a cartographic
  // locality with the same name. Missing identities in an audited state must
  // stay unresolved instead of falling back to a larger neighbouring region.
  let rows=[],strict=false;
  if(selection.countryCode==="DE"){
   rows=await sql("SELECT payload FROM catalog_manifests WHERE id=$1",["geometry-municipal-v2:DE:"+selection.stateCode]);
   strict=rows.length>0;
  }
  if(!strict)rows=await sql("SELECT payload FROM catalog_manifests WHERE id=$1",["geometry-v1:"+selection.countryCode+":"+selection.stateCode]);
  if(rows.length!==1)return null;const m=rows[0].payload;
  if(m.version!==1||m.countryCode!==selection.countryCode||m.stateCode!==selection.stateCode||!Array.isArray(m.parts)||m.parts.length>200)throw fail();
  let approval;
  if(strict){
   if(m.municipalIdentityVerified!==true||!m.municipalIdentities||typeof m.municipalIdentities!=="object")throw fail();
   approval=m.municipalIdentities[String(selection.cityId)];
   if(!approval)return null;
   const states={"01":"SH","02":"HH","03":"NI","04":"HB","05":"NW","06":"HE","07":"RP","08":"BW","09":"BY","10":"SL","11":"BE","12":"BB","13":"MV","14":"SN","15":"ST","16":"TH"};
   if(!/^\d{8}$/.test(approval.AGS)||states[approval.AGS.slice(0,2)]!==selection.stateCode||!/^https:\/\/www\.openstreetmap\.org\/relation\/[1-9]\d*$/.test(approval.source))throw fail();
  }
  const parts=m.parts.filter(a=>Array.isArray(a.cityIds)&&a.cityIds.includes(selection.cityId));
  if(parts.length!==1)return null;
  const data=await load(parts[0]);
  if(data.countryCode!==selection.countryCode||data.stateCode!==selection.stateCode)throw fail();
  const hits=data.areas.filter(a=>a.city_id===selection.cityId);
  if(hits.length!==1)return null;const row=hits[0];
  if(row.country_code!==selection.countryCode||row.city_key!==[selection.countryCode,selection.stateCode,selection.cityId].join(":")||geo.normalize(row.name)!==geo.normalize(selection.cityName)||!/^[a-f0-9]{64}$/.test(row.area_key)||!row.geometry||!row.license?.id)throw fail();
  return strict?{...row,kind:"municipality",municipalAGS:approval.AGS,municipalBoundarySource:approval.source}:row;
 }
 return {resolve};
}
module.exports={createGeometryArchive};
