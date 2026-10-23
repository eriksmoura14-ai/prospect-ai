"use strict";
// Operator-only commands. Never invoked by startup, frontend builds or cron.
const fs=require("node:fs"),readline=require("node:readline"),{createHash}=require("node:crypto");
const geo=require("../discovery/geometry.cjs"),records=require("../discovery/records.cjs"),niches=require("../niches.cjs");
async function main() {
  const [action,...args]=process.argv.slice(2),url=process.env.DISCOVERY_DATABASE_URL;
  if(!url)throw new Error("Configure DISCOVERY_DATABASE_URL na base de desenvolvimento.");
  const parsed=new URL(url),local=["localhost","127.0.0.1"].includes(parsed.hostname);
  if(url===process.env.DATABASE_URL)throw new Error("Não use a base de autenticação como catálogo de desenvolvimento.");
  if(!local&&process.env.DISCOVERY_REMOTE_TARGET!=="development")throw new Error("Alvo remoto exige confirmação explícita DISCOVERY_REMOTE_TARGET=development; não use produção.");
  const store=require("../discovery/store.cjs").createStore({databaseUrl:url,local});
  try {
    if(action==="migrate") {
      if(!args.includes("--apply"))throw new Error("Revise db/discovery.sql e passe --apply no banco isolado.");
      await store.migration();console.log("Migração PostGIS concluída no catálogo configurado.");return;
    }
    await store.ready();
    if(action==="import") {
      const [areaFile,inputFile,source]=args;
      if(!["overture","geofabrik"].includes(source))throw new Error("Fonte de importação não permitida.");
      const stat=fs.statSync(inputFile);if(stat.size>32*1024*1024)throw new Error("Divida a importação em arquivos de até 32 MiB.");
      const spec=JSON.parse(fs.readFileSync(areaFile,"utf8")),area=geo.area(spec.place,spec.selection);
      await store.saveArea(area,geo.locationKey(area.city,spec.selection));
      const checksum=createHash("sha256").update(fs.readFileSync(inputFile)).digest("hex"),checkpointFile=inputFile+".checkpoint.json";
      let checkpoint={checksum,line:0,saved:0};
      try{checkpoint=JSON.parse(fs.readFileSync(checkpointFile,"utf8"));if(checkpoint.checksum!==checksum)throw new Error("Arquivo alterado desde o checkpoint.");}catch(error){if(error.code!=="ENOENT")throw error;}
      let line=0,batch=[];
      const commit=async()=>{if(batch.length){const result=await store.upsert(batch);if(result.rejectedByBudget)throw new Error("Orçamento de registros atingido; checkpoint anterior foi preservado.");checkpoint.saved+=result.saved;batch=[];}checkpoint.line=line;fs.writeFileSync(checkpointFile+".tmp",JSON.stringify(checkpoint));fs.renameSync(checkpointFile+".tmp",checkpointFile);};
      for await(const text of readline.createInterface({input:fs.createReadStream(inputFile),crlfDelay:Infinity})) {
        if(++line<=checkpoint.line||!text.trim())continue;
        if(line>10000)throw new Error("Importação limitada a 10 mil linhas por arquivo.");
        const data=JSON.parse(text);
        const supported=source==="geofabrik"?Object.keys(niches).find(n=>records.osmMatches(data.tags||{},n)):null;
        const row=source==="overture"?records.overture(data,area):supported?records.osm(data,area,supported,"geofabrik"):null;
        if(row)batch.push(row);if(batch.length>=100)await commit();
      }
      await commit();console.log(JSON.stringify({source,lines:line,saved:checkpoint.saved,checksum,complete:true}));return;
    }
    if(action==="enqueue") {
      const [areaFile,niche]=args;if(!Object.hasOwn(niches,niche))throw new Error("Segmento inválido.");
      const spec=JSON.parse(fs.readFileSync(areaFile,"utf8")),area=geo.area(spec.place,spec.selection);
      await store.saveArea(area,geo.locationKey(area.city,spec.selection));console.log(JSON.stringify(await store.enqueue(area,niche)));return;
    }
    if(action==="worker") {
      const max=Number(args[0]||1);if(!Number.isInteger(max)||max<1||max>5)throw new Error("Escolha de 1 a 5 tarefas por execução.");
      const sources=(process.env.DISCOVERY_SOURCES||"qlever,overpass").split(",");
      if(sources.some(s=>!["qlever","overpass","overture"].includes(s)))throw new Error("Fonte inválida.");
      const engine=require("../discovery/engine.cjs").createEngine({store,sources,providers:require("../discovery/providers.cjs").providers({businessMatch:records.osmMatches,python:process.env.OVERTURE_PYTHON})});
      const deadline=Date.now()+120000;
      for(let i=0;i<max&&Date.now()<deadline;i++) {
        const task=await store.claim();if(!task)break;const area=await store.getArea(task.area_key);
        try{const result=await engine.search(area,task.niche,{task});console.log(JSON.stringify({task:task.id,records:result.rows.length,partial:result.partial}));}
        catch(error){console.log(JSON.stringify({task:task.id,error:error.code||"worker_error"}));}
      }return;
    }
    throw new Error("Use migrate --apply | import area.json records.ndjson overture|geofabrik | enqueue area.json segmento | worker 1..5");
  }finally{await store.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
