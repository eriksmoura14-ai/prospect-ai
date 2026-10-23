"use strict";
const {Pool}=require("pg"),{randomUUID}=require("node:crypto"),fs=require("node:fs"),path=require("node:path");
const {databaseOptions}=require("../accounts.cjs"),geo=require("./geometry.cjs"),records=require("./records.cjs");
function createStore({databaseUrl,local=false,maxRecords=50000,maxBytes=64*1024*1024}) {
  const pool=new Pool({...databaseOptions(databaseUrl,local),max:3,statement_timeout:10000});
  pool.on("error",()=>{});
  const ready=()=>pool.query("SELECT to_regclass('discovery_records') AS records").then(({rows})=>{if(!rows[0].records)throw new Error("Execute a migração discovery.sql na base isolada antes de habilitar o motor.");});
  const migration=()=>pool.query(fs.readFileSync(path.join(__dirname,"../db/discovery.sql"),"utf8"));
  const saveArea=(area,locationKey)=>pool.query(`INSERT INTO discovery_areas(key,location_key,country_code,geom,payload) VALUES($1,$2,$3,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4),4326)),$5)
    ON CONFLICT(key) DO UPDATE SET location_key=EXCLUDED.location_key,payload=EXCLUDED.payload,updated_at=now()`,[area.key,locationKey,area.countryCode,JSON.stringify(area.geometry),area]);
  const findArea=async key=>(await pool.query("SELECT payload FROM discovery_areas WHERE location_key=$1 AND updated_at>now()-interval '7 days' ORDER BY updated_at DESC LIMIT 1",[key])).rows[0]?.payload||null;
  const getArea=async key=>(await pool.query("SELECT payload FROM discovery_areas WHERE key=$1",[key])).rows[0]?.payload||null;
  const query=async(area,niche,limit=5000)=>{
    const config=require("../niches.cjs")[niche];if(!config)throw new Error("Segmento inválido.");
    const patterns=config.tags.map(([key,value])=>({[key]:value}));
    const result=await pool.query(`SELECT payload,discovered_at,last_seen_at,last_verified_at,verification_status FROM discovery_records WHERE country_code=$1 AND geom && ST_MakeEnvelope($2,$3,$4,$5,4326)
      AND ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($6),4326),geom)
      AND (category=$7 OR EXISTS(SELECT 1 FROM jsonb_array_elements($8::jsonb) pattern WHERE payload->'tags' @> pattern)
        OR normalized_name LIKE ANY($9::text[]) OR regexp_split_to_array(lower(trim(payload->'tags'->>'cuisine')),'\\s*;\\s*') && $10::text[]
        OR source='overture' AND (payload->'taxonomy'->'hierarchy' ?| $11::text[] OR payload->'taxonomy'->>'primary'=ANY($11::text[]) OR payload->>'basic_category'=ANY($11::text[])))
      ORDER BY source,source_id LIMIT $12`,[area.countryCode,area.bounds[2],area.bounds[0],area.bounds[3],area.bounds[1],JSON.stringify(area.geometry),niche,JSON.stringify(patterns),config.terms.map(t=>"%"+geo.normalize(t)+"%"),config.cuisines||[],records.groups[niche]||[],Math.min(limit,10000)+1]);
    const rows=result.rows.slice(0,limit).map(r=>({...r.payload,discoveredAt:r.discovered_at.toISOString(),lastSeenAt:r.last_seen_at.toISOString(),lastVerifiedAt:r.last_verified_at?.toISOString()||null,previousVerificationStatus:r.verification_status}));
    return {rows:rows.filter(r=>r.sourceKey==="overture"?records.overtureMatches(r,niche):records.osmMatches(r.tags||{},niche)).map(r=>({...r,category:niche})),truncated:result.rows.length>limit};
  };
  async function upsert(rows,task) {
    const client=await pool.connect();let saved=0;
    try {
      await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(741326953)");
      if(task&&!((await client.query("SELECT 1 FROM discovery_tasks WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",[task.id,task.token])).rowCount))throw Object.assign(new Error("Concessão de execução vencida."),{code:"lease_lost"});
      const count=Number((await client.query("SELECT count(*)::integer AS n FROM discovery_records")).rows[0].n);
      const bytes=Number((await client.query("SELECT pg_total_relation_size('discovery_records') AS n")).rows[0].n);
      let byteRoom=Math.max(0,maxBytes-bytes);
      let room=Math.max(0,maxRecords-count);
      for(const row of rows) {
        if(!["overpass","qlever","geofabrik","overture"].includes(row.sourceKey)||!row.sourceId||!row.license||!row.provenance?.length)throw new Error("Registro sem proveniência/licença permitida.");
        const expected=row.sourceKey==="overture"?records.OVERTURE.id:records.OSM.id;
        if(row.license.id!==expected)throw new Error("Licença não aprovada para esta fonte.");
        if(!Number.isFinite(row.latitude)||!Number.isFinite(row.longitude)||Math.abs(row.latitude)>90||Math.abs(row.longitude)>180)continue;
        const payloadBytes=Buffer.byteLength(JSON.stringify(row)),cost=payloadBytes*4+2048;
        if(payloadBytes>16384||byteRoom<cost)continue;
        const exists=(await client.query("SELECT 1 FROM discovery_records WHERE source=$1 AND source_id=$2",[row.sourceKey,row.sourceId])).rowCount;
        if(!exists&&room<=0)continue;
        if(!exists)room--;
        byteRoom-=cost;
        await client.query(`INSERT INTO discovery_records(id,source,source_id,name,normalized_name,category,country_code,state,city,address,geom,phone,website,license,payload,confidence,opportunity_score,verification_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,ST_SetSRID(ST_MakePoint($11,$12),4326),$13,$14,$15,$16,$17,$18,$19)
          ON CONFLICT(source,source_id) DO UPDATE SET name=EXCLUDED.name,normalized_name=EXCLUDED.normalized_name,category=EXCLUDED.category,country_code=EXCLUDED.country_code,state=EXCLUDED.state,city=EXCLUDED.city,address=EXCLUDED.address,
          geom=EXCLUDED.geom,phone=EXCLUDED.phone,website=EXCLUDED.website,license=EXCLUDED.license,payload=EXCLUDED.payload,last_seen_at=now(),confidence=EXCLUDED.confidence,opportunity_score=EXCLUDED.opportunity_score,verification_status=EXCLUDED.verification_status,
          last_verified_at=CASE WHEN discovery_records.website=EXCLUDED.website AND discovery_records.phone=EXCLUDED.phone THEN discovery_records.last_verified_at ELSE NULL END`,
          [randomUUID(),row.sourceKey,row.sourceId,row.name,geo.normalize(row.name),row.category||"",row.countryCode,row.state||"",row.city||"",row.address||"",row.longitude,row.latitude,row.phone||"",row.website||"",row.license,row,row.sourceConfidence??null,row.prospectScore||0,row.websiteClassification||"needs_verification"]);
        saved++;
      }
      await client.query("COMMIT");return {saved,rejectedByBudget:rows.length-saved};
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  const coverage=async(area,niche)=>(await pool.query("SELECT source,complete,expires_at>now() AS fresh,records,outcome FROM discovery_coverage WHERE area_key=$1 AND niche=$2",[area.key,niche])).rows;
  const mark=async(area,niche,source,result)=>pool.query(`INSERT INTO discovery_coverage(area_key,niche,source,complete,expires_at,records,outcome) VALUES($1,$2,$3,$4,now()+$5::int*interval '1 second',$6,$7)
    ON CONFLICT(area_key,niche,source) DO UPDATE SET complete=EXCLUDED.complete,expires_at=EXCLUDED.expires_at,records=EXCLUDED.records,outcome=EXCLUDED.outcome,checked_at=now()`,[area.key,niche,source,result.complete,result.ttlSeconds||3600,result.count||0,result.outcome]);
  async function enqueue(area,niche,owner="operator") {
    await pool.query("DELETE FROM discovery_tasks WHERE state IN ('done','failed') AND updated_at<now()-interval '30 days'");
    const pending=Number((await pool.query("SELECT count(*)::int AS n FROM discovery_tasks WHERE state IN ('queued','running')")).rows[0].n);
    if(pending>=1000)throw Object.assign(new Error("Fila atingiu o orçamento de 1.000 tarefas pendentes."),{code:"discovery_queue_budget"});
    const result=await pool.query(`INSERT INTO discovery_tasks(id,owner_id,area_key,niche) VALUES($1,$2,$3,$4)
      ON CONFLICT(area_key,niche) WHERE state IN ('queued','running') DO UPDATE SET area_key=EXCLUDED.area_key RETURNING id,state`,[randomUUID(),owner,area.key,niche]);
    return result.rows[0];
  }
  async function claim(id) {
    const token=randomUUID();
    await pool.query("UPDATE discovery_tasks SET state='failed',lease_token=NULL,lease_until=NULL,error_code='attempt_limit',updated_at=now() WHERE state='running' AND lease_until<now() AND attempts>=3");
    const result=await pool.query(`WITH next AS (SELECT id FROM discovery_tasks WHERE ($1::uuid IS NULL OR id=$1) AND attempts<3 AND run_after<=now()
      AND (state='queued' OR state='running' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE discovery_tasks SET state='running',lease_token=$2,lease_until=now()+interval '120 seconds',attempts=attempts+1,updated_at=now() WHERE id IN (SELECT id FROM next) RETURNING id,owner_id,area_key,niche,checkpoint,attempts`,[id||null,token]);
    return result.rows[0]?{...result.rows[0],token}:null;
  }
  async function checkpoint(task,value) {
    const result=await pool.query("UPDATE discovery_tasks SET checkpoint=$3,lease_until=now()+interval '120 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='running' RETURNING id",[task.id,task.token,value]);
    if(!result.rowCount)throw Object.assign(new Error("A tarefa perdeu a concessão de execução."),{code:"lease_lost"});
  }
  async function finish(task,{retry=false,errorCode=null}={}) {
    const result=await pool.query(`UPDATE discovery_tasks SET state=$3,error_code=$4,lease_until=NULL,lease_token=NULL,run_after=now()+interval '5 minutes',updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND state='running' RETURNING id`,[task.id,task.token,retry&&task.attempts<3?"queued":errorCode?"failed":"done",errorCode]);
    if(!result.rowCount)throw Object.assign(new Error("A tarefa perdeu a concessão de execução."),{code:"lease_lost"});
  }
  const task=async(id,owner)=>(await pool.query("SELECT id,state,niche,checkpoint,attempts,error_code,created_at,updated_at FROM discovery_tasks WHERE id=$1 AND owner_id=$2",[id,owner])).rows[0]||null;
  const verification=async row=>{
    if(!row.websiteCheckedAt||!row.sourceKey||!row.sourceId)return;
    await pool.query("UPDATE discovery_records SET last_verified_at=$3,verification_status=$4,opportunity_score=$5 WHERE source=$1 AND source_id=$2",[row.sourceKey,row.sourceId,row.websiteCheckedAt,row.websiteClassification||"needs_verification",row.prospectScore]);
  };
  return {ready,migration,saveArea,findArea,getArea,query,upsert,coverage,mark,enqueue,claim,checkpoint,finish,task,verification,close:()=>pool.end()};
}
module.exports={createStore};
