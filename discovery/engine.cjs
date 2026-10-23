"use strict";
const records=require("./records.cjs"),geo=require("./geometry.cjs");
function createEngine({store,providers,sources=["qlever","overpass"],maxRows=3000,totalMs=75000,clock=Date.now}) {
  const inflight=new Map();
  async function search(area,niche,{onProgress=()=>{},onRows=()=>{},owner="operator",task:claimed,desiredRows=50}={}) {
    const key=area.key+":"+niche;
    if(inflight.has(key))return inflight.get(key);
    const promise=(async()=>{
      const started=clock(),existing=await store.query(area,niche,maxRows);
      let raw=existing.rows;onRows(records.merge(raw));
      if(existing.archive && !claimed && raw.length>=desiredRows) {
        const rows=records.merge(raw);
        if(rows.length>=desiredRows)return {rows,partial:true,truncated:existing.truncated,sources:existing.sources||[],warning:"Catálogo regional reutilizado. Cobertura parcial; contatos publicados ainda precisam de verificação.",metrics:{raw:raw.length,unique:rows.length,withPhone:rows.filter(r=>r.phone).length,withWebsite:rows.filter(r=>r.website).length,withAddress:rows.filter(r=>r.address).length,validLocation:rows.length,elapsedMs:clock()-started,cacheHit:true,archive:true}};
      }
      const coverage=await store.coverage(area,niche),traces=[];
      if(sources.every(source=>coverage.some(c=>c.source===source&&c.fresh))) {
        const partial=Boolean(existing.archiveUnavailable)||existing.truncated||coverage.some(c=>sources.includes(c.source)&&!c.complete);
        const rows=records.merge(raw);
        if(!rows.length&&partial){
          if(claimed)await store.finish(claimed,{retry:true,errorCode:"source_unavailable"});
          throw Object.assign(new Error("Fontes em espera após falha; ausência de empresas não confirmada."),{code:"discovery_sources_unavailable"});
        }
        if(claimed)await store.finish(claimed);
        return {rows,partial,truncated:existing.truncated,sources:coverage,warning:partial?"Dados locais preservados; fontes temporariamente em espera após consulta parcial ou indisponível.":"Dados locais das fontes consultadas; não equivalem a um censo de empresas.",metrics:{raw:raw.length,unique:rows.length,withPhone:rows.filter(r=>r.phone).length,withWebsite:rows.filter(r=>r.website).length,withAddress:rows.filter(r=>r.address).length,validLocation:rows.filter(r=>geo.inside(area,r)).length,elapsedMs:clock()-started,cacheHit:true}};
      }
      const queued=claimed?null:await store.enqueue(area,niche,owner),task=claimed||await store.claim(queued.id);
      if(!task){
        if(!raw.length)throw Object.assign(new Error("A atualização está em execução ou aguardando retomada; não há dados locais suficientes ainda."),{code:"discovery_refresh_pending"});
        return {rows:records.merge(raw),truncated:existing.truncated,partial:true,sources:[],warning:"Atualização já está em execução ou em espera; dados locais disponíveis foram preservados.",taskId:queued?.id};
      }
      let errors=0,success=0,partial=Boolean(existing.archiveUnavailable)||existing.truncated,checkpoint=task.checkpoint||{};
      try {
        for(const source of sources) {
          const previous=coverage.find(c=>c.source===source);
          if(previous?.fresh){traces.push({source,outcome:"cache",complete:previous.complete});partial||=!previous.complete;success+=Number(previous.complete);continue;}
          if(clock()-started>=totalMs){partial=true;traces.push({source,outcome:"budget_exhausted"});break;}
          if(!providers[source]){partial=true;traces.push({source,outcome:"not_configured"});continue;}
          onProgress(`Consultando ${source}; ${records.merge(raw).length} empresas disponíveis…`);
          const began=clock();
          try {
            const result=await providers[source](area,niche,{timeoutMs:Math.min(60000,totalMs-(clock()-started)),onTrace:trace=>traces.push({source,...trace})});
            const accepted=result.rows.filter(row=>geo.inside(area,row));
            const persisted=await store.upsert(accepted,task);
            raw=[...raw.filter(r=>!accepted.some(v=>v.sourceKey===r.sourceKey&&v.sourceId===r.sourceId)),...accepted];
            const complete=!result.truncated&&!persisted.rejectedByBudget;
            partial||=!complete;success++;
            await store.mark(area,niche,source,{complete,count:accepted.length,outcome:complete?"success":"partial",ttlSeconds:complete?(accepted.length?7*86400:3600):300});
            checkpoint={...checkpoint,[source]:{outcome:complete?"success":"partial",count:accepted.length,checkedAt:new Date(clock()).toISOString()}};
            await store.checkpoint(task,checkpoint);
            traces.push({source,outcome:complete?"success":"partial",raw:result.metrics?.raw??accepted.length,count:accepted.length,elapsedMs:clock()-began,metrics:result.metrics});
            onRows(records.merge(raw));
          }catch(error){
            if(error.code==="lease_lost")throw error;
            errors++;partial=true;
            const requested=/^\d+$/.test(error.retryAfter||"")?Number(error.retryAfter):(Date.parse(error.retryAfter)-clock())/1000;
            const retrySeconds=Number.isNaN(requested)?300:Math.max(300,Math.min(2147483647,Math.ceil(requested)));
            await store.mark(area,niche,source,{complete:false,count:0,outcome:error.code||"source_error",ttlSeconds:retrySeconds});
            traces.push({source,outcome:error.code||"source_error",elapsedMs:clock()-began,httpStatus:error.httpStatus,reason:error.providerReason,detail:error.providerDetails});
          }
        }
        await store.finish(task,{retry:errors>0,errorCode:errors?"source_unavailable":null});
      }catch(error){if(error.code!=="lease_lost")await store.finish(task,{retry:true,errorCode:error.code||"engine_error"});throw error;}
      const rows=records.merge(raw).slice(0,maxRows);
      if(!rows.length&&!success)throw Object.assign(new Error("As fontes não concluíram a consulta. Isso não significa ausência de empresas."),{code:"discovery_sources_unavailable",sources:traces});
      return {rows,truncated:partial,partial,sources:traces,taskId:task.id,metrics:{raw:raw.length,unique:rows.length,withPhone:rows.filter(r=>r.phone).length,withWebsite:rows.filter(r=>r.website).length,withAddress:rows.filter(r=>r.address).length,validLocation:rows.filter(r=>geo.inside(area,r)).length,elapsedMs:clock()-started,sourceErrors:errors},
        warning:partial?"Cobertura parcial: uma fonte, limite de recursos ou verificação de localização impediu confirmar a consulta completa. Resultados disponíveis foram preservados.":"Cadastros das fontes consultadas; ausência de registro não comprova ausência de empresa."};
    })();
    inflight.set(key,promise);try{return await promise;}finally{inflight.delete(key);}
  }
  return {search};
}
module.exports={createEngine};
