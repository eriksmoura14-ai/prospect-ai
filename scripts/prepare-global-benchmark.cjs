"use strict";
// Explicit seven-city validation, one thread, cached. Never a production cron.
const fs=require("node:fs"),path=require("node:path"),geo=require("../geocoding.cjs");
const cases=[
  ["Berlin","DE","Berlin","DE-BE","Germany"],
  ["Monschau","DE","North Rhine-Westphalia","DE-NW","Germany"],
  ["Cochem","DE","Rhineland-Palatinate","DE-RP","Germany"],
  ["Uberlândia","BR","Minas Gerais","BR-MG","Brazil"],
  ["Monte Carmelo","BR","Minas Gerais","BR-MG","Brazil"],
  ["Toronto","CA","Ontario","CA-ON","Canada"],
  ["Lunenburg","CA","Nova Scotia","CA-NS","Canada"]
];
async function main(){
  if(process.env.DISCOVERY_LIVE_TEST!=="seven-selected-cities")throw new Error("Confirme a coleta única de sete localidades e a política do Nominatim com DISCOVERY_LIVE_TEST=seven-selected-cities.");
  const file=path.join(__dirname,"../.artifacts/global-discovery-20261023/geocodes.json");fs.mkdirSync(path.dirname(file),{recursive:true});
  let result=[];try{result=JSON.parse(fs.readFileSync(file,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
  let last=0;
  for(const [city,country,state,iso,countryName] of cases){
    if(result.some(r=>r.city===city&&r.country===country&&r.selected?.geojson))continue;
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,1100-(Date.now()-last))));last=Date.now();
    const words=[city,state,countryName].filter((value,index,all)=>!index||geo.normalize(value)!==geo.normalize(all[index-1]));
    const url=new URL(process.env.NOMINATIM_URL||"https://nominatim.openstreetmap.org/search");
    for(const [key,value] of Object.entries({q:words.join(", "),countrycodes:country.toLowerCase(),format:"jsonv2",addressdetails:"1",namedetails:"1",extratags:"1",polygon_geojson:"1",limit:"10","accept-language":"en"}))url.searchParams.set(key,value);
    const response=await fetch(url,{headers:{"User-Agent":"ProspectAI-seven-city-validation/0.9 (+https://github.com/eriksmoura14-ai/prospect-ai)"},signal:AbortSignal.timeout(15000),redirect:"error"});
    if(!response.ok){await response.body?.cancel();throw new Error(`Geocodificação HTTP ${response.status}; sem repetição automática. Reutilize o cache e respeite Retry-After antes de retomar.`);}
    let bytes=0;const chunks=[];
    for await(const part of response.body){bytes+=part.length;if(bytes>8*1024*1024)throw new Error("Limite de resposta geográfica excedido.");chunks.push(Buffer.from(part));}
    const data=JSON.parse(Buffer.concat(chunks).toString()),selection={countryCode:country,stateName:state,stateIso:iso,cityName:city};
    if(!Array.isArray(data))throw new Error("Resposta de localização inválida.");
    const accepted=data.filter(p=>!geo.rejection(p,city,selection)),selected=geo.choose(accepted,city,selection);
    if(!selected)throw new Error(`Localidade não confirmada: ${city}. Nenhuma região alternativa foi inventada.`);
    result=result.filter(r=>r.city!==city||r.country!==country);result.push({city,country,state,iso,status:200,candidates:accepted,selected});
    fs.writeFileSync(file+".tmp",JSON.stringify(result));fs.renameSync(file+".tmp",file);
    console.log(city+": área confirmada e cacheada; © OpenStreetMap contributors / Nominatim.");
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
