"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {setup}=require("../scripts/setup-hosted-discovery.cjs");
const env={RENDER:"true",DISCOVERY_INSTALL_OVERTURE:"true",OVERTURE_PYTHON:".venv-discovery/bin/python",DUCKDB_EXTENSION_DIRECTORY:".duckdb-extensions"};
test("optional reader installation never downloads during ordinary npm installs",()=>{
  for(const vars of [{},{RENDER:"true"},{...env,RENDER:"false"},{...env,DISCOVERY_INSTALL_OVERTURE:"false"}]) {
    assert.deepEqual(setup({env:vars,run:()=>assert.fail("Unexpected subprocess")}),{installed:false});
  }
});
test("explicit Render build keeps proxy/TLS but strips account credentials from installer subprocesses",()=>{
  const calls=[];
  const result=setup({env:{...env,PATH:"/usr/bin",HTTPS_PROXY:"http://proxy:8080",SSL_CERT_FILE:"/ca.crt",DATABASE_URL:"private-database",DATA_ENCRYPTION_KEY:"private-key",BREVO_API_KEY:"private-mail"},
    run:(command,args,options)=>{calls.push({command,args,options});return{status:0};},log:()=>{}});
  assert.equal(result.installed,true);assert.equal(calls.length,3);
  assert(calls[1].args.includes("duckdb==1.4.4"));assert(calls[1].args.includes("--only-binary=:all:"));
  for(const call of calls){assert.equal(call.options.shell,false);assert.equal(call.options.env.HTTPS_PROXY,"http://proxy:8080");assert.equal(call.options.env.SSL_CERT_FILE,"/ca.crt");
    for(const key of ["DATABASE_URL","DATA_ENCRYPTION_KEY","BREVO_API_KEY"])assert.equal(call.options.env[key],undefined);}
});
test("invalid paths or failed installation abort publication instead of silently enabling a broken reader",()=>{
  assert.throws(()=>setup({env:{...env,OVERTURE_PYTHON:"/unreviewed/path"},run:()=>assert.fail()}),/caminhos/);
  let calls=0;assert.throws(()=>setup({env,run:()=>{calls++;return {status:1};}}),/interrompida/);assert.equal(calls,1);
});
