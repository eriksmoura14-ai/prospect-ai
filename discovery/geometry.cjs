"use strict";
const {createHash}=require("node:crypto");
const {contains}=require("../geoapify.cjs");
const normalize=value=>String(value||"").normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const fail=message=>{throw Object.assign(new Error(message),{code:"discovery_geometry"});};
function area(place,selection={}) {
  const countryCode=String(selection.countryCode||place.address?.country_code||"").toUpperCase();
  if(!/^[A-Z]{2}$/.test(countryCode))fail("País da área não confirmado.");
  if(selection.countryCode && place.address?.country_code && countryCode!==place.address.country_code.toUpperCase())fail("País da área incompatível.");
  if(!Array.isArray(place.boundingbox)||place.boundingbox.some(v=>!["string","number"].includes(typeof v)||String(v).trim()===""))fail("Limites geográficos inválidos.");
  const bounds=place.boundingbox.map(Number);
  if(!bounds||bounds.length!==4||!bounds.every(Number.isFinite))fail("Limites geográficos ausentes.");
  const [south,north,west,east]=bounds;
  if(south>=north||west>=east||south< -90||north>90||west< -180||east>180||north-south>10||east-west>15)fail("Área não suportada pelo orçamento do MVP; nenhum raio foi substituído.");
  let geometry=place.geojson;
  const polygon=geometry&&["Polygon","MultiPolygon"].includes(geometry.type);
  if(!polygon)fail("Limite municipal/distrital ausente. O ponto central não foi tratado como limite da cidade. Configure geocodificador com polígonos ou importe a área oficial.");
  if(Buffer.byteLength(JSON.stringify(geometry))>2*1024*1024)fail("Limite geográfico excede o orçamento do MVP.");
  let vertices=0;
  for(const poly of geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates||[]) {
    if(!Array.isArray(poly)||!poly.length)fail("Polígono vazio.");
    for(const ring of poly) {
      if(!Array.isArray(ring)||ring.length<4||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))fail("Anel geográfico inválido.");
      for(const point of ring) {
        if(++vertices>50000||!Array.isArray(point)||point.length<2||!point.slice(0,2).every(Number.isFinite)||point[0]<west-1e-6||point[0]>east+1e-6||point[1]<south-1e-6||point[1]>north+1e-6)fail("Coordenadas incompatíveis com o limite.");
      }
    }
  }
  if(!vertices)fail("Polígono vazio.");
  const identity=`${countryCode}:${place.osm_type}/${place.osm_id}`;
  const key=createHash("sha256").update(identity+JSON.stringify(geometry)).digest("hex");
  return {key,identity,countryCode,state:selection.stateName||place.address?.state||"",city:selection.cityName||place.name,displayName:place.display_name,
    geometry,bounds,scope:"Limite geográfico completo",place};
}
function inside(area,row) {
  return Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)&&Math.abs(row.latitude)<=90&&Math.abs(row.longitude)<=180&&
    (!row.countryCode||row.countryCode===area.countryCode)&&contains(area.geometry,[row.longitude,row.latitude]);
}
function distance(a,b) {
  const radians=Math.PI/180,lat=(a.latitude+b.latitude)/2*radians;
  return Math.hypot((a.latitude-b.latitude)*111195,(a.longitude-b.longitude)*111195*Math.cos(lat));
}
const locationKey=(city,selection)=>createHash("sha256").update(JSON.stringify([normalize(city),selection?.countryCode,selection?.stateCode,normalize(selection?.stateName)])).digest("hex");
module.exports={area,inside,distance,normalize,locationKey};
