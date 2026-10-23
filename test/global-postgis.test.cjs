"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),{Pool}=require("pg"),{randomUUID}=require("node:crypto");
const geo=require("../discovery/geometry.cjs"),records=require("../discovery/records.cjs"),{createStore}=require("../discovery/store.cjs");
test("real disposable PostGIS: geometry, upserts, licenses, leases, checkpoint recovery and budgets",{skip:!process.env.TEST_DISCOVERY_DATABASE_URL},async t=>{
  const databaseUrl=process.env.TEST_DISCOVERY_DATABASE_URL,u=new URL(databaseUrl);
  assert(["127.0.0.1","localhost"].includes(u.hostname));assert.match(u.pathname,/^\/prospect_audit_/);
  const store=createStore({databaseUrl,local:true,maxRecords:20}),sql=new Pool({connectionString:databaseUrl});
  const p={name:"Fixture",display_name:"Fixture, Germany",osm_type:"relation",osm_id:Date.now(),address:{country_code:"de"},boundingbox:[0,2,0,2],geojson:{type:"Polygon",coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.8,.8],[1.2,.8],[1.2,1.2],[.8,1.2],[.8,.8]]]}};
  const area=geo.area(p),id=String(Date.now()),row=(suffix,x=.3)=>records.osm({type:"node",id:id+suffix,lat:x,lon:x,tags:{name:"Fixture",amenity:"restaurant",phone:"+4930901820"}},area,"Restaurantes");
  try{
    await store.migration();await store.migration();await store.ready();await store.saveArea(area,area.key);
    await t.test("GiST and country/category indexes exist; boundary holes and country remain restrictive",async()=>{
      const inserted=await store.upsert([row("1"),{...row("2"),latitude:1,longitude:1},{...row("3"),countryCode:"BR"}]);assert.equal(inserted.saved,3);
      const result=await store.query(area,"Restaurantes");assert.equal(result.rows.length,1);
      const indexes=(await sql.query("SELECT indexdef FROM pg_indexes WHERE tablename='discovery_records'")).rows.map(r=>r.indexdef).join(" ");assert.match(indexes,/USING gist/);assert.match(indexes,/country_code, category/);
      const plan=(await sql.query("SET enable_seqscan=off; EXPLAIN SELECT id FROM discovery_records WHERE geom && ST_MakeEnvelope(0,0,2,2,4326)"))[1].rows.map(r=>r['QUERY PLAN']).join(" ");assert.match(plan,/Index|Bitmap/);
    });
    await t.test("upsert is idempotent and unapproved licenses are rejected transactionally",async()=>{
      await store.upsert([row("1")]);assert.equal((await store.query(area,"Restaurantes")).rows.length,1);
      await assert.rejects(store.upsert([{...row("4"),license:{id:"unknown"}}]),/Licença/);
    });
    await t.test("only one worker owns a task; another account cannot read its state",async()=>{
      const task=await store.enqueue(area,"Restaurantes","alice"),same=await store.enqueue(area,"Restaurantes","bob");assert.equal(task.id,same.id);
      const claims=await Promise.all([store.claim(task.id),store.claim(task.id)]);const lease=claims.find(Boolean);assert.equal(claims.filter(Boolean).length,1);
      assert.equal(await store.task(task.id,"bob"),null);
      await store.checkpoint(lease,{qlever:{count:1}});await sql.query("UPDATE discovery_tasks SET lease_until=now()-interval '1 second' WHERE id=$1",[task.id]);
      const renewed=await store.claim(task.id);assert.deepEqual(renewed.checkpoint,{qlever:{count:1}});assert.notEqual(renewed.token,lease.token);
      await assert.rejects(store.upsert([row("5")],lease),e=>e.code==="lease_lost");
      await assert.rejects(store.checkpoint(lease,{}),e=>e.code==="lease_lost");
      await store.upsert([row("5")],renewed);await store.finish(renewed);assert.equal((await store.task(task.id,"alice")).state,"done");
    });
    await t.test("retry limit releases expired tasks instead of blocking the area forever",async()=>{
      const task=await store.enqueue(area,"Restaurantes","alice");await store.claim(task.id);
      await sql.query("UPDATE discovery_tasks SET attempts=3,lease_until=now()-interval '1 second' WHERE id=$1",[task.id]);
      assert.equal(await store.claim(task.id),null);assert.equal((await store.task(task.id,"alice")).state,"failed");
      assert.notEqual((await store.enqueue(area,"Restaurantes","alice")).id,task.id);
    });
    await t.test("freshness is scoped by source, niche and exact area",async()=>{
      await store.mark(area,"Restaurantes","qlever",{complete:true,count:1,outcome:"success",ttlSeconds:30});
      assert.equal((await store.coverage(area,"Restaurantes"))[0].fresh,true);assert.deepEqual(await store.coverage(area,"Barber"),[]);
      assert.equal((await store.findArea(area.key)).identity,area.identity);
    });
    await t.test("catalog cap stops new records while preserving updates to existing source IDs",async()=>{
      const capped=createStore({databaseUrl,local:true,maxRecords:1});
      try{assert.equal((await capped.upsert([row("9")])).rejectedByBudget,1);assert.equal((await capped.upsert([row("1")])).saved,1);}finally{await capped.close();}
    });
    await t.test("batches preserve duplicate updates, verification invalidation and transaction rollback",async()=>{
      const bulk=createStore({databaseUrl,local:true,maxRecords:500});
      const rows=Array.from({length:105},(_,i)=>row("7"+i));
      try{
        const changed={...rows[0],phone:"+4930901821"};
        assert.equal((await bulk.upsert([rows[0],changed,...rows.slice(1),{...changed,phone:"+4930901822"}])).saved,107);
        assert.equal(Number((await sql.query("SELECT count(*) AS n FROM discovery_records WHERE source_id LIKE $1",['node/'+id+'7%'])).rows[0].n),105);
        assert.equal((await sql.query("SELECT phone FROM discovery_records WHERE source_id=$1",[rows[0].sourceId])).rows[0].phone,"+4930901822");
        await sql.query("UPDATE discovery_records SET last_verified_at=now() WHERE source_id=$1",[rows[0].sourceId]);
        await bulk.upsert([{...changed,phone:"+4930901822"}]);
        assert((await sql.query("SELECT last_verified_at FROM discovery_records WHERE source_id=$1",[rows[0].sourceId])).rows[0].last_verified_at);
        await bulk.upsert([changed]);
        assert.equal((await sql.query("SELECT last_verified_at FROM discovery_records WHERE source_id=$1",[rows[0].sourceId])).rows[0].last_verified_at,null);
        await assert.rejects(bulk.upsert([row("81"),{...row("82"),license:{id:"unapproved"}}]),/Licença/);
        assert.equal(Number((await sql.query("SELECT count(*) AS n FROM discovery_records WHERE source_id=$1",[row("81").sourceId])).rows[0].n),0);
      }finally{await bulk.close();}
    });
  }finally{
    await sql.query("DELETE FROM discovery_tasks WHERE area_key=$1",[area.key]);await sql.query("DELETE FROM discovery_coverage WHERE area_key=$1",[area.key]);await sql.query("DELETE FROM discovery_areas WHERE key=$1",[area.key]);
    await sql.query("DELETE FROM discovery_records WHERE source_id LIKE $1",['node/'+id+'%']);await store.close();await sql.end();
  }
});
