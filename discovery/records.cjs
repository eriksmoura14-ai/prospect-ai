"use strict";
const contacts=require("../contacts.cjs"),geo=require("./geometry.cjs");
const OSM={id:"ODbL-1.0",url:"https://opendatacommons.org/licenses/odbl/1-0/",attribution:"© OpenStreetMap contributors",attributionUrl:"https://www.openstreetmap.org/copyright",shareAlike:true};
const OVERTURE={id:"CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0",url:"https://docs.overturemaps.org/attribution/",attribution:"Overture Maps Foundation; original providers retained per record",attributionUrl:"https://docs.overturemaps.org/attribution/",shareAlike:false};
const text=(value,max=2000)=>typeof value==="string"?value.trim().slice(0,max):"";
const groups={Barber:["barber","barber_shop"],"Hair Salon":["hair_salon","hairdresser"],Restaurantes:["restaurant"],Hamburguerias:["burger_restaurant","hamburger_restaurant"],Sorveterias:["ice_cream_shop","ice_cream_parlor"],Pizzarias:["pizza_restaurant"],Padarias:["bakery"],Confeitarias:["pastry_shop","confectionery"],Cafeterias:["cafe","coffee_shop"],Lanchonetes:["fast_food_restaurant","sandwich_shop"],"Açaiterias":["acai_shop"],Churrascarias:["steakhouse","brazilian_steakhouse","barbecue_restaurant"],"Auto Detailing":["car_wash","auto_detailing"],Cleaning:["cleaning_service"],Landscaping:["landscaping_service","gardener"],Plumbing:["plumber"],HVAC:["heating_and_air_conditioning"],Roofing:["roofer"],Painting:["painter"],Fencing:["fence_contractor"],"Pressure Washing":["pressure_washing_service"],Moving:["moving_company"],Handyman:["handyman"],Electrician:["electrician"]};
function overtureMatches(row,niche) {
  const categories=[row.taxonomy?.primary,...row.taxonomy?.hierarchy||[],...row.taxonomy?.alternates||[],row.categories?.primary,...row.categories?.alternate||[],row.basic_category].filter(value=>typeof value==="string");
  return (groups[niche]||[]).some(value=>categories.includes(value));
}
function osmMatches(tags,niche) {
  const config=require("../niches.cjs")[niche],matching=require("../niche-matching.cjs");
  if(!config||!tags.name||["yes","true","1"].includes(tags.disused)||["yes","true","1"].includes(tags.abandoned)||tags.shop==="vacant")return false;
  if(!["shop","craft","office","amenity","service"].some(key=>tags[key]&&tags[key]!=="no"))return false;
  if(matching.matchesTags(tags,config))return true;
  if(config.food&&!matching.isFoodPlace(tags))return false;
  const fold=value=>String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  return config.terms.some(term=>(" "+fold(tags.name)+" ").includes(" "+fold(term)+" "));
}
function overture(raw,area,release="2026-10-21.0") {
  if(release!=="2026-10-21.0")throw new Error("Revise a licença/esquema desta release antes da importação.");
  const p=raw.properties||raw,id=typeof raw.id==="string"&&raw.id.length<=180?raw.id.trim():"",name=text(p.names?.primary||p.name,400);
  const coordinates=raw.geometry?.coordinates||[p.bbox?.xmin,p.bbox?.ymin];
  if(!id||!name||p.operating_status==="permanently_closed"||p.confidence!=null&&(!Number.isFinite(p.confidence)||p.confidence<0.5||p.confidence>1))return null;
  const address=p.addresses?.[0]||{},countryCode=text(address.country,2).toUpperCase()||area.countryCode;
  const website=(p.websites||[]).map(contacts.websiteURL).find(url=>url&&!contacts.isProfile(url))||(p.websites||[]).map(contacts.websiteURL).find(Boolean)||"";
  const phones=[];let whatsappPhone="";
  for(const value of (p.phones||[]).slice(0,5)) {
    if(typeof value!=="string"||value.length>200)continue;
    const linked=contacts.whatsappLinkNumber(value),number=linked||value.trim();
    if(linked&&!whatsappPhone)whatsappPhone=linked;
    if(number&&[...phones,number].join("; ").length<=200)phones.push(number);
  }
  const phone=phones.join("; ");
  const row={osmId:"overture/"+id,sourceId:id,name,category:"",city:text(address.locality,1000)||area.city,state:text(address.region,200)||area.state,countryCode,
    latitude:coordinates?.[1],longitude:coordinates?.[0],address:[address.freeform,address.postcode].filter(Boolean).join(", ").slice(0,2000),
    phone,whatsappPhone,whatsappSource:whatsappPhone?"Overture Maps · phones":"",phoneSource:"Overture Maps · phones",phoneVerification:phone?"listed":"not_listed",website,websiteSource:website?"Overture Maps · websites":"",websiteVerification:website?"listed":"not_identified",
    source:"Overture Maps",sourceKey:"overture",sourceUrl:"https://explore.overturemaps.org/",sourceRelease:release,license:OVERTURE,sourceConfidence:Number.isFinite(p.confidence)?p.confidence:null,
    taxonomy:p.taxonomy||null,categories:p.categories||null,basic_category:p.basic_category,operatingStatus:p.operating_status||"unknown",externalIds:[]};
  const known=new Set(["alltheplaces","overture","birdeye","brightquery","dac","foursquare","krick","microsoft","opentravel","pinmeto","renderseo","uberall","meta"]);
  const datasets=(p.sources||[]).map(s=>({dataset:text(s.dataset,100),recordId:text(s.record_id,200),
    license:text(s.license,100)||(String(s.dataset).toLowerCase()==="foursquare"?"Apache-2.0":String(s.dataset).toLowerCase()==="alltheplaces"?"CC0-1.0":"CDLA-Permissive-2.0"),property:text(s.property,200)}));
  if(!datasets.length||datasets.some(s=>!known.has(s.dataset.toLowerCase())))return null;
  if(datasets.some(s=>!["CDLA-Permissive-2.0","Apache-2.0","CC0-1.0"].includes(s.license)))return null;
  row.externalIds=datasets.filter(d=>d.recordId).map(d=>({namespace:d.dataset,id:d.recordId}));
  row.license={...OVERTURE,attribution:"Overture Maps Foundation"+(datasets.length?"; "+[...new Set(datasets.map(d=>d.dataset))].join("; "):"")};
  row.provenance=[{source:"overture",sourceId:id,release,license:row.license,datasets}];
  return geo.inside(area,row)?finish(row):null;
}
function osm(element,area,niche,source="overpass") {
  const tags=element.tags||{},id=`${element.type}/${element.id}`;
  if(!/^(node|way|relation)\/[1-9]\d*$/.test(id)||!text(tags.name,400))return null;
  const row={name:text(tags.name,400),category:niche,city:text(tags["addr:city"],1000)||area.city,state:area.state,countryCode:area.countryCode,
    latitude:element.lat??element.center?.lat,longitude:element.lon??element.center?.lon,locationMethod:element.locationMethod||(element.center?"geometry_bbox_center":"source_point"),
    address:text(tags["addr:full"]||[[tags["addr:street"],tags["addr:housenumber"]].filter(Boolean).join(" "),tags["addr:postcode"]].filter(Boolean).join(", ")),
    street:text(tags["addr:street"],400),houseNumber:text(tags["addr:housenumber"],100),...contacts.sourceData(tags),osmId:id,osmIds:[id],sourceId:id,sourceKey:source,
    source:`OpenStreetMap via ${source}`,sourceUrl:`https://www.openstreetmap.org/${id}`,license:OSM,matchMethod:"tag",
    tags:Object.fromEntries(["name","shop","craft","office","amenity","service","hairdresser","cuisine","disused","abandoned"].filter(key=>typeof tags[key]==="string").map(key=>[key,text(tags[key],400)]))};
  row.provenance=[{source,sourceId:id,license:OSM}];
  return geo.inside(area,row)?finish(row):null;
}
function finish(row) {
  row.discoveredAt ||= new Date().toISOString();row.lastSeenAt ||= row.discoveredAt;
  row.status=row.website?"WEBSITE_LISTED":"UNCERTAIN";row.confidence=row.website?0.4:0;
  row.reason=row.website?"Website publicado na fonte; identidade e disponibilidade ainda não confirmadas.":"Sem website identificado na fonte; ausência não comprovada.";
  row.websiteClassification=row.website?(contacts.isProfile(row.website)?"needs_verification":"website_identified"):"insufficient_information";
  const detailed=contacts.details(row);
  detailed.prospectScore=Math.min(100,20+(detailed.phoneFormat==="valid"?20:0)+(row.address?10:0)+10+(row.name.length>=4?10:0));
  detailed.quality={validLocation:true,publicPhoneFormat:detailed.phoneFormat,hasAddress:Boolean(row.address),websiteEvidence:row.websiteVerification};
  return detailed;
}
function duplicate(a,b) {
  if(a.osmId===b.osmId)return true;
  if(a.countryCode!==b.countryCode||geo.normalize(a.name)!==geo.normalize(b.name)||geo.distance(a,b)>60)return false;
  if(a.address&&b.address&&geo.normalize(a.address)!==geo.normalize(b.address))return false;
  const shared=contacts.numbers(a.phone,a.countryCode).some(p=>contacts.numbers(b.phone,b.countryCode).includes(p));
  return Boolean(shared||(a.address&&b.address&&geo.normalize(a.address)===geo.normalize(b.address)));
}
function merge(rows) {
  const output=[],cells=new Map(),ids=new Map();
  const priority={geofabrik:0,overpass:1,qlever:2,overture:3};
  for(const original of [...rows].sort((a,b)=>(priority[a.sourceKey]??9)-(priority[b.sourceKey]??9)||a.osmId.localeCompare(b.osmId))) {
    const row=structuredClone(original),x=Math.floor(row.longitude/0.002),y=Math.floor(row.latitude/0.002),prefix=row.countryCode+":"+geo.normalize(row.name)+":";
    let previous=ids.get(row.osmId);
    for(let dx=-1;dx<=1&&!previous;dx++)for(let dy=-1;dy<=1&&!previous;dy++)previous=(cells.get(prefix+(x+dx)+":"+(y+dy))||[]).find(other=>duplicate(other,row));
    if(!previous){output.push(row);ids.set(row.osmId,row);const key=prefix+x+":"+y;cells.set(key,[...cells.get(key)||[],row]);continue;}
    ids.set(row.osmId,previous);
    previous.provenance=[...previous.provenance||[],...row.provenance||[]].filter((p,i,all)=>all.findIndex(v=>v.source===p.source&&v.sourceId===p.sourceId)===i);
    if(previous.phone&&row.phone&&!contacts.numbers(previous.phone,previous.countryCode).some(p=>contacts.numbers(row.phone,row.countryCode).includes(p))){previous.phoneVerification="conflict";previous.sitePhone=row.phone;}
    if(row.website&&(!previous.website||contacts.isProfile(previous.website)&&!contacts.isProfile(row.website)))for(const key of ["website","websiteSource","websiteVerification"])previous[key]=row[key];
    for(const key of ["phone","phoneSource","address","street","houseNumber","whatsappPhone","whatsappSource"])if(!previous[key]&&row[key])previous[key]=row[key];
    Object.assign(previous,finish(previous));
  }
  return output;
}
module.exports={OSM,OVERTURE,overture,overtureMatches,osm,finish,merge,duplicate,groups,osmMatches};
