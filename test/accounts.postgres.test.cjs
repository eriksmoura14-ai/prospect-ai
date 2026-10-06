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
        request.headers={host:"127.0.0.1:3042",origin:config.origin,"sec-fetch-site":"same-origin","content-type":"application/json",
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
  let userA,userB,hashA,job,listA,listB,savedA;
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
      job={id:crypto.randomUUID(),ownerId:userA.id,state:"done",city:"Local de fixture",niche:"Barber",rows:[{osmId:"node/fixture",name:"Empresa de fixture",status:"UNCERTAIN",phone:"(212) 555-0100"}],done:1,total:1,
        discoveryDiagnostics:{geocode:{selected:{address:{country_code:"us"}}}}};
      const summary={city:job.city,niche:job.niche,total:1};
      await store.saveSearch(userA.id,job,summary);backend.jobs.set(job.id,job);
      assert.equal((await alice.call("GET","/api/jobs/"+job.id)).status,200);
      const restored=(await alice.call("GET","/api/jobs/"+job.id)).data.rows[0];
      assert.equal(restored.phone,"(212) 555-0100");assert.equal(restored.whatsappUrl,"https://wa.me/12125550100");
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
    await t.test("perfil de atendimento persiste cifrado, valida limites e não aparece para outra conta",async()=>{
      const profile={seller:"Vendedor privado",offer:"Oferta privada",language:"Español",tone:"Profissional",knowledge:"Condições privadas; sem desconto não autorizado."};
      assert.equal((await alice.call("PATCH","/api/account/preferences",profile)).status,200);
      assert.deepEqual((await alice.refresh()).data.user.preferences,profile);
      assert.equal((await bob.refresh()).data.user.preferences.knowledge,undefined);
      for(const patch of [{tone:"Inventar"},{knowledge:"x".repeat(1801)},{knowledge:null}])assert.equal((await alice.call("PATCH","/api/account/preferences",{...profile,...patch})).status,400);
      assert.deepEqual((await alice.refresh()).data.user.preferences,profile);
      const encrypted=(await sql.query("SELECT preferences_encrypted FROM prospect_accounts WHERE id=$1",[userA.id])).rows[0];
      assert.ok(!JSON.stringify(encrypted).includes(profile.knowledge));
      const wide={...profile,offer:"字".repeat(3000),knowledge:"字".repeat(1800)};
      assert.equal((await alice.call("PATCH","/api/account/preferences",wide)).status,200);
      assert.equal((await alice.call("PATCH","/api/account/preferences",profile)).status,200);
    });
    await t.test("listas exigem sessão, CSRF e nomes válidos",async()=>{
      assert.equal((await anonymous.call("GET","/api/lists")).status,401);
      assert.equal((await anonymous.call("POST","/api/lists",{name:"Lista proibida"})).status,401);
      assert.equal((await alice.call("POST","/api/lists",{name:"Lista proibida"},{origin:"https://evil.example"})).status,403);
      assert.equal((await alice.call("POST","/api/lists",{name:"Lista proibida"},{"x-csrf-token":"wrong"})).status,403);
      for(const name of ["", "x".repeat(81), "Nome\u0000", null]) assert.equal((await alice.call("POST","/api/lists",{name})).status,400);
      assert.equal((await alice.call("POST","/api/lists",null)).status,400);
      assert.equal((await alice.call("POST","/api/lists",{name:"x".repeat(17000)})).status,413);
      const created=await alice.call("POST","/api/lists",{name:"  Favoritos privados  "});
      assert.equal(created.status,201);listA=created.data;assert.equal(listA.name,"Favoritos privados");
      listB=(await bob.call("POST","/api/lists",{name:"Lista de Bob"})).data;
      assert.equal((await alice.call("GET","/api/lists")).data.length,1);
      assert.equal((await bob.call("GET","/api/lists")).data[0].id,listB.id);
    });
    await t.test("empresas salvas vêm dos resultados do dono e cliques repetidos não duplicam",async()=>{
      const forged={jobId:job.id,osmId:job.rows[0].osmId,company:{name:"Nome forjado",website:"https://forged.example"}};
      const response=await alice.call("POST",`/api/lists/${listA.id}/companies`,forged);
      assert.equal(response.status,201);savedA=response.data.item;
      assert.equal(savedA.company.countryCode,"US");assert.equal(savedA.company.whatsappUrl,"https://wa.me/12125550100");
      assert.equal(savedA.company.name,"Empresa de fixture");assert.equal(savedA.company.website,"");
      assert.equal(savedA.status,"new");assert.equal(savedA.note,"");
      const concurrent=await Promise.all([alice.call("POST",`/api/lists/${listA.id}/companies`,forged),alice.call("POST",`/api/lists/${listA.id}/companies`,forged)]);
      assert.ok(concurrent.every(value=>value.status===200 && value.data.item.id===savedA.id && value.data.created===false));
      assert.equal((await alice.call("GET",`/api/lists/${listA.id}/companies`)).data.length,1);
      assert.equal((await alice.call("GET",`/api/lists/${listA.id}/companies`)).data[0].company.whatsappUrl,"https://wa.me/12125550100");
      assert.equal((await alice.call("GET","/api/lists")).data[0].count,1);
      job.state="running";
      assert.equal((await alice.call("POST",`/api/lists/${listA.id}/companies`,forged)).status,409);
      job.state="done";
    });
    await t.test("outro usuário não lê, renomeia, exclui ou modifica as listas e notas",async()=>{
      for(const [method,path,input] of [["GET",`/api/lists/${listA.id}/companies`],
        ["PATCH",`/api/lists/${listA.id}`,{name:"Ataque"}],["DELETE",`/api/lists/${listA.id}`],
        ["PATCH",`/api/lists/${listA.id}/companies/${savedA.id}`,{note:"Ataque",status:"contacted"}],
        ["DELETE",`/api/lists/${listA.id}/companies/${savedA.id}`],
        ["POST",`/api/lists/${listB.id}/companies`,{jobId:job.id,osmId:job.rows[0].osmId}]]) {
        assert.equal((await bob.call(method,path,input)).status,404);
      }
      assert.equal((await alice.call("PATCH",`/api/lists/${listB.id}/companies/${savedA.id}`,{note:"Ataque",status:"contacted"})).status,404);
      assert.equal((await alice.call("GET","/api/lists/not-a-uuid/companies")).status,404);
      const illegal=sql.query("INSERT INTO prospect_list_companies(id,account_id,list_id,company_key,company_encrypted,details_encrypted) VALUES($1,$2,$3,$4,$5,$6)",
        [crypto.randomUUID(),userB.id,listA.id,"0".repeat(64),"invalid","invalid"]);
      await assert.rejects(illegal,error=>error.code==="23503");
    });
    await t.test("lista reabre celular antigo exigindo revisão do nono dígito e preserva o telefone original cifrado",async()=>{
      const oldPhone="(34) 9123-4567";
      const saved=await store.saveCompany(userA.id,listA.id,{osmId:"node/legacy-phone",name:"Empresa de fixture",phone:oldPhone,countryCode:"BR"});
      const restored=(await alice.call("GET",`/api/lists/${listA.id}/companies`)).data.find(item=>item.id===saved.item.id);
      assert.equal(restored.company.phone,oldPhone);
      assert.equal(restored.company.whatsappUrl,"");
      assert.equal(restored.company.whatsappStatus,"needs_review");
      assert.equal(restored.company.whatsappSuggestedUrl,"https://wa.me/5534991234567");
      assert.equal(restored.company.whatsappAdjustment,"br_ninth_digit");
      const row=(await sql.query("SELECT company_encrypted FROM prospect_list_companies WHERE id=$1",[saved.item.id])).rows[0];
      assert.ok(!JSON.stringify(row).includes(oldPhone));
      await store.deleteCompany(userA.id,listA.id,saved.item.id);
    });
    await t.test("qualidade e origem dos contatos persistem cifradas e divergência bloqueia WhatsApp ao reabrir",async()=>{
      const company={osmId:"node/contact-quality",name:"Empresa de fixture",phone:"(11) 3456-7890",countryCode:"BR",
        sitePhone:"+5511991234567",phoneSource:"OpenStreetMap · phone",phoneVerification:"conflict",
        website:"https://fixture.example/",websiteSource:"OpenStreetMap · website",websiteVerification:"compatible",websiteCheckedAt:new Date().toISOString()};
      const saved=await store.saveCompany(userA.id,listA.id,company);
      const result=await alice.call("GET",`/api/lists/${listA.id}/companies`);
      const restored=result.data.find(item=>item.id===saved.item.id).company;
      for(const key of ["phone","sitePhone","phoneSource","phoneVerification","websiteVerification","websiteCheckedAt"])assert.equal(restored[key],company[key]);
      assert.equal(restored.whatsappUrl,"");
      const raw=(await sql.query("SELECT company_encrypted FROM prospect_list_companies WHERE id=$1",[saved.item.id])).rows[0];
      for(const text of [company.phone,company.sitePhone,company.phoneSource])assert.ok(!JSON.stringify(raw).includes(text));
      assert.equal((await bob.call("GET",`/api/lists/${listA.id}/companies`)).status,404);
      await store.deleteCompany(userA.id,listA.id,saved.item.id);
    });
    await t.test("notas e status persistem cifrados e não são sobrescritos ao favoritar novamente",async()=>{
      const value={note:"Retornar na sexta-feira\n<script>texto privado</script>",status:"interested"};
      const update=await alice.call("PATCH",`/api/lists/${listA.id}/companies/${savedA.id}`,value);
      assert.equal(update.status,200);assert.equal(update.data.note,value.note);assert.equal(update.data.status,"interested");
      for(const invalid of [{note:"x",status:"invalid"},{note:"x".repeat(3001),status:"new"},{note:"x\u0000",status:"new"},{note:"x",status:"new",accountId:userB.id}])
        assert.equal((await alice.call("PATCH",`/api/lists/${listA.id}/companies/${savedA.id}`,invalid)).status,400);
      const again=await alice.call("POST",`/api/lists/${listA.id}/companies`,{jobId:job.id,osmId:job.rows[0].osmId});
      assert.equal(again.data.item.note,value.note);assert.equal(again.data.item.status,"interested");
      const raw=JSON.stringify((await sql.query("SELECT * FROM prospect_lists WHERE account_id=$1",[userA.id])).rows)+
        JSON.stringify((await sql.query("SELECT * FROM prospect_list_companies WHERE account_id=$1",[userA.id])).rows);
      for(const text of [listA.name,job.rows[0].name,job.rows[0].osmId,value.note,"interested"])assert.ok(!raw.includes(text));
      const encrypted=(await sql.query("SELECT details_encrypted FROM prospect_list_companies WHERE id=$1",[savedA.id])).rows[0].details_encrypted;
      assert.throws(()=>accounts.vault(config.encryptionKey).decrypt(encrypted,`company-details:${userB.id}:${listA.id}:${savedA.id}`));
      const reader=accounts.createStore({databaseUrl:config.databaseUrl,encryptionKey:config.encryptionKey,local:true});
      try{assert.equal((await reader.listCompanies(userA.id,listA.id))[0].note,value.note);assert.equal((await reader.lists(userA.id))[0].name,listA.name);}
      finally{await reader.close();}
    });
    await t.test("favoritos sobrevivem à expiração da busca sem alterar a classificação",async()=>{
      const source={...job,id:crypto.randomUUID(),rows:[{...job.rows[0],osmId:"way/saved-fixture",status:"WEBSITE_LISTED",website:"https://fixture.example"}]};
      await store.saveSearch(userA.id,source,{city:"Fonte temporária",total:1});
      const saved=await alice.call("POST",`/api/lists/${listA.id}/companies`,{jobId:source.id,osmId:source.rows[0].osmId});
      assert.equal(saved.status,201);
      await sql.query("UPDATE prospect_searches SET expires_at=now()-interval '1 second' WHERE id=$1",[source.id]);
      await store.maintain();
      assert.equal(await store.search(userA.id,source.id),null);
      const kept=(await store.listCompanies(userA.id,listA.id)).find(value=>value.id===saved.data.item.id);
      assert.equal(kept.company.status,"WEBSITE_LISTED");assert.equal(kept.company.website,"https://fixture.example");
      assert.equal((await alice.call("DELETE",`/api/lists/${listA.id}/companies/${kept.id}`)).status,200);
      assert.equal((await alice.call("DELETE",`/api/lists/${listA.id}/companies/${kept.id}`)).status,404);
    });
    await t.test("excluir uma lista remove suas empresas e mantém os dados de outra conta",async()=>{
      assert.equal((await alice.call("PATCH",`/api/lists/${listA.id}`,{name:"Lista renomeada"})).status,200);
      assert.equal((await store.lists(userA.id))[0].name,"Lista renomeada");
      const disposable=await store.createList(userA.id,"Lista para excluir");
      const saved=await store.saveCompany(userA.id,disposable.id,job.rows[0]);
      assert.equal((await alice.call("DELETE",`/api/lists/${disposable.id}`)).status,200);
      assert.equal((await sql.query("SELECT 1 FROM prospect_list_companies WHERE id=$1",[saved.item.id])).rowCount,0);
      assert.equal((await store.lists(userB.id))[0].id,listB.id);
    });
    await t.test("limite de listas permanece correto com duas criações concorrentes",async()=>{
      for(let i=0;i<18;i++)await store.createList(userA.id,`Limite ${i}`);
      const results=await Promise.allSettled([store.createList(userA.id,"Concorrente A"),store.createList(userA.id,"Concorrente B")]);
      assert.equal(results.filter(value=>value.status==="fulfilled").length,1);
      assert.equal(results.find(value=>value.status==="rejected").reason.status,409);
      assert.equal((await store.lists(userA.id)).length,20);
    });
    await t.test("limites de empresas rejeitam novas entradas, mas permitem salvar novamente uma existente",async()=>{
      const targets=[listB];
      for(let i=0;i<3;i++)targets.push(await store.createList(userB.id,`Empresas de limite ${i}`));
      const cipher=accounts.vault(config.encryptionKey), columns=[[],[],[],[],[],[]];
      for(let i=0;i<1000;i++){
        const id=crypto.randomUUID(),listId=targets[Math.floor(i/250)].id,company={osmId:`node/quota-${i}`,name:`Empresa de limite ${i}`,status:"UNCERTAIN"};
        const values=[id,userB.id,listId,cipher.mac("saved-company",`${userB.id}:${company.osmId}`),
          cipher.encrypt(company,`company:${userB.id}:${listId}:${id}`),cipher.encrypt({note:"",status:"new"},`company-details:${userB.id}:${listId}:${id}`)];
        values.forEach((value,index)=>columns[index].push(value));
      }
      await sql.query("INSERT INTO prospect_list_companies(id,account_id,list_id,company_key,company_encrypted,details_encrypted) SELECT * FROM unnest($1::uuid[],$2::uuid[],$3::uuid[],$4::text[],$5::text[],$6::text[])",columns);
      await assert.rejects(store.saveCompany(userB.id,listB.id,{osmId:"node/exceeds-list",name:"Extra"}),error=>error.status===409);
      const extra=await store.createList(userB.id,"Lista além da cota de empresas");
      await assert.rejects(store.saveCompany(userB.id,extra.id,{osmId:"node/exceeds-account",name:"Extra"}),error=>error.status===409);
      const again=await store.saveCompany(userB.id,listB.id,{osmId:"node/quota-0",name:"Outro nome"});
      assert.equal(again.created,false);assert.equal(again.item.company.name,"Empresa de limite 0");
      assert.equal((await store.listCompanies(userB.id,listB.id)).length,250);
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
      assert.equal((await sql.query("SELECT 1 FROM prospect_lists WHERE account_id=$1",[userA.id])).rowCount,0);
      assert.equal((await sql.query("SELECT 1 FROM prospect_list_companies WHERE account_id=$1",[userA.id])).rowCount,0);
      assert.equal((await bob.refresh()).data.authenticated,true);
    });
    await t.test("trocar cookies e Gmail não contorna orçamento persistente de trabalho de senha",async()=>{
      const encryptionKey=crypto.randomBytes(32).toString("base64"),box=accounts.vault(encryptionKey);
      const budgetStore=accounts.createStore({databaseUrl:config.databaseUrl,encryptionKey,local:true});
      const budgetConfig={...config,encryptionKey};
      const marker=new Error("Admitted before password computation");
      const emails=Array.from({length:121},(_,i)=>`rotated${suffix}${i}@gmail.com`);
      const client=auth.createService(budgetConfig,{store:{allow:rules=>budgetStore.allow(rules),credentials:async()=>{throw marker;}},mailer:async()=>{}});
      const request=()=>({headers:{cookie:"prospect_challenge="+random()},socket:{remoteAddress:"127.0.0.1"}});
      let reader;
      try{
        for(let i=0;i<120;i++)await assert.rejects(client.login(request(),{email:emails[i],password:phrase}),error=>error===marker);
        await assert.rejects(client.login(request(),{email:emails[120],password:phrase}),{status:429});
        reader=accounts.createStore({databaseUrl:config.databaseUrl,encryptionKey,local:true});
        const restarted=auth.createService(budgetConfig,{store:{allow:rules=>reader.allow(rules),credentials:async()=>{throw marker;}},mailer:async()=>{}});
        await assert.rejects(restarted.login(request(),{email:emails[120],password:phrase}),{status:429});
      }finally{
        const hashes=["password-work-total",...emails.map(email=>"login:"+email)].map(key=>box.mac("rate",key));
        await sql.query("DELETE FROM prospect_rate_limits WHERE key_hash=ANY($1::text[])",[hashes]);
        await budgetStore.close();if(reader)await reader.close();
      }
    });
  } finally {
    // Database is explicitly a test resource. No production records are removed.
    await sql.query("DELETE FROM prospect_accounts WHERE id=ANY($1::uuid[])",[[userA?.id,userB?.id].filter(Boolean)]);
    await store.close();await sql.end();
  }
});
