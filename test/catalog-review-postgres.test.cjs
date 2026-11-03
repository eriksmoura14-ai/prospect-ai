"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),{spawnSync}=require("node:child_process");
test("below-target audits expire when evidence, boundaries, or counts change",{skip:!process.env.TEST_DISCOVERY_DATABASE_URL},async()=>{
 const emitted=spawnSync("python",["scripts/catalog-review.py","--verification-sql"],{encoding:"utf8"});
 assert.equal(emitted.status,0,emitted.stderr);
 const {Client}=require("pg"),client=new Client({connectionString:process.env.TEST_DISCOVERY_DATABASE_URL});
 await client.connect();
 try{const result=await client.query(emitted.stdout);assert.equal(result.rows.length,8);for(const row of result.rows)assert.equal(row.actual,row.expected,row.label);}finally{await client.end();}
});
