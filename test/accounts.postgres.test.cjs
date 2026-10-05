"use strict";
// Uses a real, disposable PostgreSQL supplied through TEST_DATABASE_URL.
// Email delivery is captured locally; these tests do not prove inbox delivery.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { Readable } = require("node:stream");
const { Pool } = require("pg");
const accounts = require("../accounts.cjs");
const auth = require("../auth.cjs");
const root = path.resolve(__dirname, "..");
const localRequire = createRequire(path.join(root, "server.cjs"));
const random = () => crypto.randomBytes(32).toString("base64url");
const phrase = "Senha somente para testes locais 2026!";

test("contas e isolamento com PostgreSQL real", { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const config = auth.configuration({ AUTH_MODE: "password", DATABASE_URL: process.env.TEST_DATABASE_URL,
    DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString("base64"), BREVO_API_KEY: "fixture-only-not-an-api-key", EMAIL_FROM: "sender@example.test" },
    { hosted: false, origin: "http://127.0.0.1:3042" });
  const store = accounts.createStore({ ...{databaseUrl:config.databaseUrl,encryptionKey:config.encryptionKey}, local:true });
  const sql = new Pool(accounts.databaseOptions(config.databaseUrl, true));
  const messages = [];
  const service = auth.createService(config, { store, mailer: async value => { messages.push(value); } });
  const context = { require: name => name === "./auth.cjs" ? { ...auth, configuration: () => config, createService: () => service } : localRequire(name),
    module: {exports:{}}, __dirname:root, process:{ env:{APP_ORIGIN:config.origin,PORT:"3042",APP_PASSWORD:"legacy-password-cannot-bypass"} },
    console:{log(){},warn(){},error(){}}, Buffer,URL,URLSearchParams,AbortSignal,structuredClone,setTimeout,clearTimeout,fetch };
  const source = fs.readFileSync(path.join(root,"server.cjs"),"utf8");
  vm.runInNewContext(source.slice(0,source.lastIndexOf("server.listen(")) + `
    module.exports = {handler:server.listeners("request")[0],jobs, activateJob:job=>{activeJob=job.id;jobs.set(job.id,job);}};
  `, context, {filename:path.join(root,"server.cjs")});
  const backend = context.module.exports;
  function browser() {
    const jar = new Map(); let csrf;
    return {
      jar,
      async call(method, url, input, headers = {}) {
        const request = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
        request.method=method; request.url=url;
        request.headers={host:"127.0.0.1:3042",origin:config.origin,"sec-fetch-site":"same-origin",
          cookie:[...jar].map(([name,value])=>name+"="+value).join("; "),"x-csrf-token":csrf,...headers};
        request.socket={remoteAddress:"127.0.0.1"};
        const response={status:null,headersSent:false,headers:{},body:"",setHeader(name,value){this.headers[name.toLowerCase()]=value;},
          writeHead(status,values={}){this.status=status;this.headersSent=true;for(const [k,v] of Object.entries(values))this.setHeader(k,v);},
          end(body){this.body=body||"";}};
        await backend.handler(request,response);
        for(const cookie of response.headers["set-cookie"]||[]){const [pair]=cookie.split(";");const [name,value]=pair.split("=");if(value)jar.set(name,value);else jar.delete(name);}
        if(response.headers["content-type"]?.includes("application/json")) response.data=JSON.parse(response.body);
        if(url==="/api/account" && method==="GET") csrf=response.data.csrfToken;
        return response;
      },
      async refresh(){return this.call("GET","/api/account");}
    };
  }
  const alice=browser(),bob=browser(),anonymous=browser();
  const suffix=crypto.randomBytes(6).toString("hex");
  const emailA=`alice${suffix}@gmail.com`,emailB=`bob${suffix}@gmail.com`;
  let userA,userB,hashA,job;
  try {
    await store.ready();
    await t.test("sessão obrigatória; Basic antigo não contorna contas",async()=>{
      const initial=await anonymous.refresh();assert.equal(initial.data.authenticated,false);
      assert.equal((await anonymous.call("GET","/api/history")).status,401);
      assert.equal((await anonymous.call("GET","/api/niches",undefined,{authorization:"Basic "+Buffer.from("admin:legacy-password-cannot-bypass").toString("base64")})).status,401);
      assert.equal((await anonymous.call("GET","/db/schema.sql")).status,404);
      assert.equal((await anonymous.call("GET","/privacy.html")).status,200);
    });
    await t.test("CSRF e origem barram cadastro antes de gerar e-mail",async()=>{
      assert.equal((await anonymous.call("POST","/api/auth/register",{email:emailA},{origin:"https://evil.example"})).status,403);
      assert.equal((await anonymous.call("POST","/api/auth/register",{email:emailA},{"x-csrf-token":"wrong"})).status,403);
      assert.equal(messages.length,0);
      assert.equal((await anonymous.call("POST","/api/auth/register",{email:"person@example.test"})).status,400);
    });
    await t.test("cadastro confirma e-mail antes de criar conta; tokens são de uso único",async()=>{
      await alice.refresh();await bob.refresh();
      for(const [client,email] of [[alice,emailA],[bob,emailB]]){
        assert.equal((await client.call("POST","/api/auth/register",{email})).status,202);
        assert.equal(await store.credentials(email),null);
        const value=new URL(messages.at(-1).link).hash.split("=")[1];
        assert.equal((await client.call("GET","/")).status,200);
        assert.equal((await client.call("POST","/api/auth/activate",{token:value,password:phrase})).status,200);
        const profile=(await client.refresh()).data;assert.equal(profile.authenticated,true);
        if(client===alice)userA=profile.user;else userB=profile.user;
        assert.equal((await client.call("POST","/api/auth/activate",{token:value,password:phrase})).status,400);
      }
      assert.notEqual(userA.id,userB.id);hashA=(await store.credentials(emailA)).password_hash;
    });
    await t.test("sessões têm hash no banco; perfis e links não ficam em texto aberto",async()=>{
      const {rows}=await sql.query("SELECT * FROM prospect_accounts WHERE id=ANY($1::uuid[])",[[userA.id,userB.id]]);
      const data=JSON.stringify(rows);
      for(const value of [emailA,emailB,phrase,alice.jar.get(service.sessionName)])assert.ok(!data.includes(value));
      const sessions=await sql.query("SELECT token_hash FROM prospect_sessions WHERE account_id=$1",[userA.id]);
      assert.equal(sessions.rows[0].token_hash,accounts.hash(alice.jar.get(service.sessionName)));
    });
    await t.test("duas confirmações concorrentes não reutilizam o mesmo token",async()=>{
      const value=random(),email=`race${suffix}@gmail.com`;
      await store.issueEmailToken("activate",email,value);
      const results=await Promise.all([store.consumeEmailToken("activate",value,hashA,random(),null),store.consumeEmailToken("activate",value,hashA,random(),null)]);
      assert.equal(results.filter(Boolean).length,1);
      await store.deleteAccount(results.find(Boolean).id,hashA);
    });
    await t.test("histórico, empresas e preferências ficam separados por dono",async()=>{
      job={id:crypto.randomUUID(),ownerId:userA.id,state:"done",city:"Local de fixture",niche:"Barber",rows:[{osmId:"node/fixture",name:"Empresa de fixture",status:"UNCERTAIN"}],done:1,total:1};
      const summary={city:job.city,niche:job.niche,total:1};
      await store.saveSearch(userA.id,job,summary);backend.jobs.set(job.id,job);
      assert.equal((await alice.call("GET","/api/jobs/"+job.id)).status,200);
      assert.equal((await bob.call("GET","/api/jobs/"+job.id)).status,404);
      assert.equal((await alice.call("GET","/api/history")).data.length,1);
      assert.equal((await bob.call("GET","/api/history")).data.length,0);
      assert.equal((await bob.call("POST","/api/ai",{action:"audit",jobId:job.id,osmId:"node/fixture"})).status,404);
      assert.equal((await alice.call("PATCH","/api/account/preferences",{seller:"Vendedor privado",offer:"Oferta privada",language:"Português"})).status,200);
      assert.equal((await bob.refresh()).data.user.preferences.offer,undefined);
      assert.equal((await bob.call("GET","/api/diagnostics/overpass")).status,404);
      const row=(await sql.query("SELECT * FROM prospect_searches WHERE id=$1",[job.id])).rows[0];
      assert.ok(!JSON.stringify(row).includes(job.city));assert.ok(!JSON.stringify(row).includes("Empresa de fixture"));
    });
    await t.test("ocupação não revela ID da pesquisa de outro usuário",async()=>{
      backend.activateJob(job);
      const blocked=await bob.call("POST","/api/search",{});assert.equal(blocked.status,409);assert.equal(blocked.data.jobId,undefined);
    });
    await t.test("dados e sessão persistem ao reabrir a conexão com o banco",async()=>{
      const reader=accounts.createStore({databaseUrl:config.databaseUrl,encryptionKey:config.encryptionKey,local:true});
      try{
        assert.equal((await reader.session(alice.jar.get(service.sessionName))).id,userA.id);
        assert.equal((await reader.history(userA.id)).length,1);
        assert.equal((await reader.search(userA.id,job.id)).rows[0].name,"Empresa de fixture");
        assert.equal(await reader.search(userB.id,job.id),null);
      }finally{await reader.close();}
    });
    await t.test("logout revoga só a sessão correspondente",async()=>{
      const old=alice.jar.get(service.sessionName);
      assert.equal((await alice.call("POST","/auth/logout",{})).status,200);
      assert.equal(await store.session(old),null);
      assert.equal((await bob.refresh()).data.authenticated,true);
    });
    await t.test("login inválido e usuário ausente dão a mesma resposta; cookie gira no login",async()=>{
      await alice.refresh();
      const bad=await alice.call("POST","/api/auth/login",{email:emailA,password:"Uma senha incorreta longa"});
      const absent=await alice.call("POST","/api/auth/login",{email:`absent${suffix}@gmail.com`,password:"Uma senha incorreta longa"});
      assert.equal(bad.status,401);assert.deepEqual(bad.data,absent.data);
      assert.equal((await alice.call("POST","/api/auth/login",{email:emailA,password:phrase})).status,200);
      await alice.refresh();
    });
    await t.test("recuperação muda a senha e revoga todas as sessões anteriores",async()=>{
      const old=alice.jar.get(service.sessionName);
      await anonymous.refresh();
      assert.equal((await anonymous.call("POST","/api/auth/forgot",{email:emailA})).status,202);
      const value=new URL(messages.at(-1).link).hash.split("=")[1];
      assert.equal((await anonymous.call("POST","/api/auth/reset",{token:value,password:"short"})).status,400);
      assert.equal((await anonymous.call("POST","/api/auth/reset",{token:value,password:phrase+" renovada"})).status,200);
      await anonymous.refresh();
      assert.equal(await store.session(old),null);
      assert.equal((await bob.refresh()).data.authenticated,true);
      assert.equal((await anonymous.call("POST","/api/auth/reset",{token:value,password:phrase})).status,400);
      assert.equal(await store.signIn(emailA,hashA,random(),null),null);
    });
    await t.test("tokens expirados não criam contas; limite de envio permanece no banco",async()=>{
      const expired=random(),email=`expired${suffix}@gmail.com`;
      await store.issueEmailToken("activate",email,expired);
      await sql.query("UPDATE prospect_email_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[accounts.hash(expired)]);
      assert.equal((await anonymous.call("POST","/api/auth/activate",{token:expired,password:phrase})).status,400);
      assert.equal(await store.credentials(email),null);
      const limited=`limit${suffix}@gmail.com`;
      for(let i=0;i<3;i++)assert.equal((await anonymous.call("POST","/api/auth/register",{email:limited})).status,202);
      assert.equal((await anonymous.call("POST","/api/auth/register",{email:limited})).status,429);
    });
    await t.test("retenção limita 20 buscas e ignora registros vencidos",async()=>{
      for(let i=0;i<22;i++){const id=crypto.randomUUID();await store.saveSearch(userB.id,{id,state:"done",rows:[]},{city:`Fixture ${i}`,niche:"Barber"});}
      assert.equal((await store.history(userB.id)).length,20);
      await sql.query("UPDATE prospect_searches SET expires_at=now()-interval '1 second' WHERE account_id=$1",[userB.id]);
      assert.equal((await store.history(userB.id)).length,0);
      const expired={...job,id:crypto.randomUUID(),createdAt:Date.now()-31*24*3600000};
      await store.saveSearch(userA.id,expired,{city:"Expirada",niche:"Barber"});backend.jobs.set(expired.id,expired);
      await sql.query("UPDATE prospect_searches SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.id]);
      assert.equal((await anonymous.call("GET","/api/jobs/"+expired.id)).status,404);
      assert.equal(backend.jobs.has(expired.id),false);
    });
    await t.test("exclusão exige senha e remove os dados e sessões da própria conta",async()=>{
      assert.equal((await anonymous.call("DELETE","/api/account",{confirmation:"EXCLUIR",password:"Senha incorreta longa"})).status,400);
      const old=anonymous.jar.get(service.sessionName);
      assert.equal((await anonymous.call("DELETE","/api/account",{confirmation:"EXCLUIR",password:phrase+" renovada"})).status,200);
      assert.equal(await store.credentials(emailA),null);assert.equal(await store.session(old),null);
      assert.equal((await store.history(userA.id)).length,0);
      assert.equal((await bob.refresh()).data.authenticated,true);
    });
  } finally {
    // Database is explicitly a test resource. No production records are removed.
    await sql.query("DELETE FROM prospect_accounts WHERE id=ANY($1::uuid[])",[[userA?.id,userB?.id].filter(Boolean)]);
    await store.close();await sql.end();
  }
});
