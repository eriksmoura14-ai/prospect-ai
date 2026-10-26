"use strict";
const crypto=require("node:crypto"),geo=require("./geometry.cjs");
const fail=()=>Object.assign(new Error("Limite geográfico arquivado temporariamente indisponível."),{code:"catalog_geometry_unavailable"});
function createGeometryArchive({sql,fetchImpl=fetch,origin}) {
 const cache=new Map(),pending=new Map();let cachedBytes=0;
 const maximumBytes=2*1024*1024,cacheBudget=4*1024*1024;
 async function load(asset) {
  let url;try{url=new URL(asset.url);}catch{throw fail();}
  if(!url.href.startsWith(origin)||url.href!==asset.url||url.username||url.password||url.search||url.hash||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>maximumBytes)throw fail();
  const hit=cache.get(asset.sha256);
  if(hit){cache.delete(asset.sha256);cache.set(asset.sha256,hit);return hit.data;}
  if(pending.has(asset.sha256))return pending.get(asset.sha256);
  if(pending.size>=2)throw fail();
  const promise=(async()=>{
   const response=await fetchImpl(url.href,{method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Accept:"application/json"}});
   if(!response.ok||!response.body)throw fail();
   let size=0;const chunks=[];
   for await(const part of response.body){size+=part.length;if(size>asset.bytes||size>maximumBytes)throw fail();chunks.push(Buffer.from(part));}
   const body=Buffer.concat(chunks);
   if(size!==asset.bytes||crypto.createHash("sha256").update(body).digest("hex")!==asset.sha256)throw fail();
   let data;try{data=JSON.parse(body);}catch{throw fail();}
   if(data.version!==1||!Array.isArray(data.areas)||data.areas.length>1000)throw fail();
   while(cache.size&&cachedBytes+size>cacheBudget){const [key,value]=cache.entries().next().value;cache.delete(key);cachedBytes-=value.bytes;}
   cache.set(asset.sha256,{data,bytes:size});cachedBytes+=size;return data;
  })();pending.set(asset.sha256,promise);
  try{return await promise;}finally{pending.delete(asset.sha256);}
 }
 async function resolve(selection) {
  if(!Number.isSafeInteger(selection.cityId))return null;
  const rows=await sql("SELECT payload FROM catalog_manifests WHERE id=$1",["geometry-v1:"+selection.countryCode+":"+selection.stateCode]);
  if(rows.length!==1)return null;const m=rows[0].payload;
  if(m.version!==1||m.countryCode!==selection.countryCode||m.stateCode!==selection.stateCode||!Array.isArray(m.parts)||m.parts.length>200)throw fail();
  const parts=m.parts.filter(a=>Array.isArray(a.cityIds)&&a.cityIds.includes(selection.cityId));
  if(parts.length!==1)return null;
  const data=await load(parts[0]);
  if(data.countryCode!==selection.countryCode||data.stateCode!==selection.stateCode)throw fail();
  const hits=data.areas.filter(a=>a.city_id===selection.cityId);
  if(hits.length!==1)return null;const row=hits[0];
  if(row.country_code!==selection.countryCode||row.city_key!==[selection.countryCode,selection.stateCode,selection.cityId].join(":")||geo.normalize(row.name)!==geo.normalize(selection.cityName)||!/^[a-f0-9]{64}$/.test(row.area_key)||!row.geometry||!row.license?.id)throw fail();
  return row;
 }
 return {resolve};
}
module.exports={createGeometryArchive};
