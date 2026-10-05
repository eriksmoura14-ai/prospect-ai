"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {spatialFilter, element, discover, contains} = require("../geoapify.cjs");
const ring = [[-49,-19],[-48,-19],[-48,-18],[-49,-19]];
const place = {osm_type:"relation", geojson:{type:"Polygon",coordinates:[ring]},boundingbox:[-19,-18,-49,-48]};
const feature = id => ({type:"Feature",geometry:{type:"Point",coordinates:[-48.2,-18.9]},properties:{datasource:{raw:{osm_type:"node",osm_id:id,name:"Fixture Barber",shop:"barber",website:"https://example.com"}}}});
test("Geoapify preserva todas as partes e buracos sem simplificar",()=>{
 const geometry={type:"MultiPolygon",coordinates:[[ring,ring],[ring]]};
 assert.strictEqual(spatialFilter({...place,geojson:geometry}).geometry,geometry);
});
test("limite administrativo ausente não vira bounding box",()=>assert.throws(()=>spatialFilter({...place,geojson:null}),{code:"geoapify_geometry"}));
test("polígono acima do limite usa retângulo completo sem truncar geometria",()=>{const geometry={type:"Polygon",coordinates:[Array(10001).fill(ring[0])]};assert.equal(spatialFilter({...place,geojson:geometry}).type,"rect");assert.equal(geometry.coordinates[0].length,10001);});
test("localidade sem relação usa todo o retângulo original",()=>assert.deepEqual(spatialFilter({...place,osm_type:"node"}),{type:"rect",lon1:-49,lat1:-19,lon2:-48,lat2:-18}));
test("tags originais e identidade OSM permanecem intactas",()=>assert.deepEqual(element(feature(7)),{type:"node",id:7,lat:-18.9,lon:-48.2,tags:feature(7).properties.datasource.raw}));
test("categoria externa não fabrica tags para a classificação",()=>assert.throws(()=>element({properties:{categories:["service.beauty.hairdresser"]}}),{code:"geoapify_raw_missing"}));
test("identidade OSM ausente impede sucesso",()=>assert.throws(()=>element({...feature(7),properties:{datasource:{raw:{name:"Fixture",shop:"barber"}}}}),{code:"geoapify_identity"}));
test("paginação busca página final inteira mantendo filtro e categorias",async()=>{
 const bodies=[]; const data=await discover(place,{apiKey:"fixture",transport:async body=>{bodies.push(body);return {features:bodies.length===1?Array.from({length:500},(_,i)=>feature(i+1)):[feature(501)]};}});
 assert.equal(data.elements.length,501);assert.equal(bodies[1].offset,500);assert.deepEqual(bodies[0].filter,bodies[1].filter);assert.deepEqual(bodies[0].categories,bodies[1].categories);
});
test("falha de cota na segunda página não retorna resultados parciais",async()=>{
 let calls=0;await assert.rejects(discover(place,{transport:async()=>{if(++calls===2)throw Object.assign(new Error("quota"),{code:"geoapify_http_429"});return {features:Array.from({length:500},(_,i)=>feature(i+1))};}}),{code:"geoapify_http_429"});
});
test("limite de orçamento aborta em vez de apresentar cobertura parcial",async()=>{
 let calls=0;await assert.rejects(discover(place,{transport:async()=>{const offset=(calls++)*500; return {features:Array.from({length:500},(_,i)=>feature(offset+i+1))};}}),{code:"geoapify_budget"});
});
test("página repetida não é aceita como paginação completa",async()=>{
 await assert.rejects(discover(place,{transport:async()=>({features:Array.from({length:500},(_,i)=>feature(i+1))})}),{code:"geoapify_pagination"});
});
test("resposta vazia válida é distinta de falha",async()=>assert.deepEqual(await discover(place,{transport:async()=>({features:[]})}),{elements:[]}));

test("identificador compacto OSM é normalizado sem alterar tags",()=>{const f=feature(8);f.properties.datasource.raw.osm_type="w";assert.equal(element(f).type,"way");assert.equal(element(f).tags.osm_type,"w");});
test("transporte manda chave só em cabeçalho e distingue HTTP 429 sem vazá-la", async () => {
 const https=require("node:https"), {EventEmitter}=require("node:events"), original=https.request;
 const {request}=require("../geoapify.cjs");const secret="fixture-secret-never-log";let headers,endpoint;const traces=[];
 https.request=(url,options,callback)=>{endpoint=url;headers=options.headers;const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=429;res.resume=()=>{};callback(res);});return req;};
 try {await assert.rejects(request({offset:0},secret,t=>traces.push(t)),{code:"geoapify_http_429"});assert.equal(headers["x-api-key"],secret);assert.equal(endpoint.includes(secret),false);assert.equal(JSON.stringify(traces).includes(secret),false);assert.equal(traces[0].httpStatus,429);}
 finally {https.request=original;}
});

test("filtro local preserva partes, buracos e bordas",()=>{
 const outer=[[0,0],[4,0],[4,4],[0,4],[0,0]],hole=[[1,1],[3,1],[3,3],[1,3],[1,1]],second=[[6,0],[7,0],[7,1],[6,1],[6,0]];
 const geometry={type:"MultiPolygon",coordinates:[[outer,hole],[second]]};
 assert.equal(contains(geometry,[0.5,0.5]),true);assert.equal(contains(geometry,[2,2]),false);assert.equal(contains(geometry,[6.5,0.5]),true);assert.equal(contains(geometry,[5,0.5]),false);assert.equal(contains(geometry,[0,2]),true);assert.equal(contains(geometry,[1,2]),true);
});
test("retângulo amplo não aceita pontos fora do polígono original",async()=>{
 const geometry={type:"Polygon",coordinates:[Array.from({length:10002},(_,i)=>{const edge=Math.floor(i/3334),t=(i%3334)/3334,a=ring[edge],b=ring[edge+1];return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}).concat([ring[0]])]};
 const outside=feature(2);outside.geometry.coordinates=[-47,-18];
 const result=await discover({...place,geojson:geometry},{transport:async body=>{assert.equal(body.filter.type,"rect");return {features:[feature(1),outside]};}});
 assert.equal(result.elements.length,1);assert.equal(result.elements[0].id,1);
});

test("consulta de empresas não seleciona o índice de limites administrativos",()=>{const {CATEGORIES}=require("../geoapify.cjs");for(const category of ["administrative","postal_code","political","low_emission_zone","populated_place"])assert.equal(CATEGORIES.includes(category),false);for(const category of ["commercial","service","office"])assert.equal(CATEGORIES.includes(category),true);});

test("categorias de nicho orientam consulta sem fabricar tags comerciais",async()=>{
 const {CATEGORY_HINTS}=require("../geoapify.cjs");let body;
 await discover(place,{categories:CATEGORY_HINTS.Barber,transport:async b=>{body=b;return {features:[feature(1)]};}});
 assert.deepEqual(body.categories,["service.beauty.hairdresser"]);
});
test("componentes públicos de endereço são normalizados sem alterar classificação",()=>{
 const f=feature(8);f.properties.datasource.raw.street="Rua Teste";f.properties.housenumber="12";const e=element(f);
 assert.equal(e.tags["addr:street"],"Rua Teste");assert.equal(e.tags["addr:housenumber"],"12");assert.equal(e.tags.shop,"barber");
});

test("contatos normalizados não são descartados nem apresentados como tags OSM originais",()=>{
 const f=feature(8);f.properties.contact={phone:"+1 212 555 0100",email:"private@example.com"};f.properties.website="https://provider.example/";
 const before=structuredClone(f.properties.datasource.raw),e=element(f);
 assert.deepEqual(e.tags,before);
 assert.deepEqual(e.providerContact,{phone:"+1 212 555 0100",website:"https://provider.example/"});
 assert.equal(e.providerContact.email,undefined);
 assert.equal(e.tags["contact:phone"],undefined);
});

test("orçamento de páginas é compartilhado entre categorias e alternativa",async()=>{
 const budget={remaining:1};await discover(place,{budget,transport:async()=>({features:[]})});
 await assert.rejects(discover(place,{budget,transport:async()=>{throw new Error("não deve chamar");}}),{code:"geoapify_budget"});
});

test("socket HTTPS reutilizado não espera outro evento secureConnect",async()=>{
 const https=require("node:https"),{EventEmitter}=require("node:events"),original=https.request;
 const {request}=require("../geoapify.cjs");const traces=[];
 https.request=(_url,_options,callback)=>{const req=new EventEmitter();req.reusedSocket=true;req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{
   req.emit("socket",new EventEmitter());const res=new EventEmitter();res.statusCode=200;callback(res);
   res.emit("data",Buffer.from(JSON.stringify({type:"FeatureCollection",features:[]})));res.emit("end");
 });return req;};
 try {await request({offset:0},"fixture",t=>traces.push(t));assert.equal(traces[0].reusedConnection,true);assert.equal(Number.isFinite(traces[0].connectedMs),true);assert.equal(traces[0].outcome,"success");}
 finally {https.request=original;}
});
