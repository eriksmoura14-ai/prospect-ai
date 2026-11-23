'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Readable}=require('node:stream'),{createRequire}=require('node:module'),{Pool}=require('pg');
const accounts=require('../accounts.cjs'),auth=require('../auth.cjs'),passwords=require('../passwords.cjs');
const random=()=>crypto.randomBytes(32).toString('base64url');
test('Google account integration with disposable PostgreSQL and a fixture identity provider',{skip:!process.env.TEST_DATABASE_URL},async t=>{
 const databaseUrl=process.env.TEST_DATABASE_URL;assert(['127.0.0.1','localhost','[::1]'].includes(new URL(databaseUrl).hostname),'disposable loopback database required');
 const clientId='123456-fixture.apps.googleusercontent.com',origin='http://127.0.0.1:3042';
 const config=auth.configuration({AUTH_MODE:'password',DATABASE_URL:databaseUrl,DATA_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),BREVO_API_KEY:'fixture-only',EMAIL_FROM:'sender@example.test',GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:'fixture-client-secret-only'},{hosted:false,origin});
 const store=accounts.createStore({databaseUrl,encryptionKey:config.encryptionKey,local:true}),sql=new Pool(accounts.databaseOptions(databaseUrl,true));
 const suffix=crypto.randomBytes(8).toString('hex'),email='google'+suffix+'@gmail.com',subject='google-subject-'+suffix;let activeEmail=email,activeSubject=subject;const ids=new Set();
 const fixtureProvider={authorization:flow=>{const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.searchParams.set('state',flow.state);return u.href;},claims:async(code,flow)=>({iss:'https://accounts.google.com',aud:clientId,sub:activeSubject,email:activeEmail,email_verified:true,nonce:flow.nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})};
 const service=auth.createService(config,{store,mailer:async()=>assert.fail('Google sign-in must not send email'),googleProvider:fixtureProvider});
 const root=path.resolve(__dirname,'..'),localRequire=createRequire(path.join(root,'server.cjs'));const context={require:name=>name==='./auth.cjs'?{...auth,configuration:()=>config,createService:()=>service}:localRequire(name),module:{exports:{}},__dirname:root,process:{env:{APP_ORIGIN:origin,PORT:'3042',APP_PASSWORD:'fixture-only'}},console:{log(){},warn(){},error(){}},Buffer,URL,URLSearchParams,AbortSignal,structuredClone,setTimeout,clearTimeout,fetch};
 const source=fs.readFileSync(path.join(root,'server.cjs'),'utf8');vm.runInNewContext(source.slice(0,source.lastIndexOf('server.listen('))+"module.exports={handler:server.listeners('request')[0]};",context,{filename:path.join(root,'server.cjs')});
 function browser(){const jar=new Map();let csrf;return {jar,async call(method,url,input,overrides={}){const req=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);req.method=method;req.url=url;req.socket={remoteAddress:'127.0.0.1'};req.headers={host:'127.0.0.1:3042',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'x-csrf-token':csrf,...overrides};const res={status:null,headersSent:false,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(s,h={}){this.status=s;this.headersSent=true;for(const [k,v]of Object.entries(h))this.setHeader(k,v);},end(b){this.body=b||'';}};await context.module.exports.handler(req,res);for(const item of res.headers['set-cookie']||[]){const [k,v]=item.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}if(res.headers['content-type']?.includes('application/json'))res.data=JSON.parse(res.body);if(url==='/api/account'&&method==='GET')csrf=res.data.csrfToken;return res;}};}
 const a=browser(),b=browser();
 try{
  await store.ready();
  await t.test('CSRF rejection precedes creation of a Google authorization flow',async()=>{
   const profile=await a.call('GET','/api/account');assert.equal(profile.data.googleAvailable,true);
   assert.equal((await a.call('POST','/api/auth/google/start',{}, {'x-csrf-token':'invalid'})).status,403);
   assert.equal((await a.call('POST','/api/auth/google/start',{}, {origin:'https://evil.example'})).status,403);
  });
  await t.test('callbacks bind the browser, create an encrypted Google-only account and cannot be replayed',async()=>{
   const start=await a.call('POST','/api/auth/google/start',{});assert.equal(start.status,200);const state=new URL(start.data.url).searchParams.get('state'),callback='/api/auth/google/callback?state='+state+'&code=fixture-code';
   const raw=(await sql.query('SELECT * FROM prospect_google_flows WHERE state_hash=$1',[accounts.hash(state)])).rows[0];assert(raw);assert(!JSON.stringify(raw).includes(state));assert(!raw.payload_encrypted.includes('verifier'));
   const wrong=await b.call('GET',callback);assert.equal(wrong.status,303);assert.match(wrong.headers.location,/#google=failed$/);assert.equal(await store.credentials(email),null);
   assert.equal((await a.call('GET',callback)).status,303);const profile=(await a.call('GET','/api/account')).data;assert.equal(profile.authenticated,true);assert.equal(profile.user.email,email);assert.equal(profile.user.hasPassword,false);assert.equal(profile.user.authenticationMethod,undefined);ids.add(profile.user.id);
   const count=(await sql.query('SELECT count(*)::int AS n FROM prospect_sessions WHERE account_id=$1',[profile.user.id])).rows[0].n;
   await a.call('GET',callback);assert.equal((await a.call('GET','/api/account')).data.user.id,profile.user.id);assert.equal((await sql.query('SELECT count(*)::int AS n FROM prospect_sessions WHERE account_id=$1',[profile.user.id])).rows[0].n,count);
   const linked=(await sql.query('SELECT subject_hash FROM prospect_google_identities WHERE account_id=$1',[profile.user.id])).rows[0];assert(linked);assert.notEqual(linked.subject_hash,subject);
  });
  await t.test('linking a verified existing Gmail preserves ID, password, encrypted preferences and history',async()=>{
   const mail='existing'+suffix+'@gmail.com',activation=random(),session=random(),hash=await passwords.hashPassword('Fixture-only-password-2026');await store.issueEmailToken('activate',mail,activation);const old=await store.consumeEmailToken('activate',activation,hash,session);ids.add(old.id);await store.preferences(old.id,{knowledge:'private existing settings'});const job={id:crypto.randomUUID(),state:'done',rows:[]};await store.saveSearch(old.id,job,{city:'Fixture town'});
   const linked=await store.signInGoogle(mail,'existing-subject-'+suffix,random(),session,null);assert.equal(linked.id,old.id);assert.equal(linked.hasPassword,true);assert.equal(linked.preferences.knowledge,'private existing settings');assert.equal((await store.credentials(mail)).password_hash,hash);assert.equal((await store.history(old.id)).length,1);assert.equal(await store.session(session),null);
   assert.equal(await store.signInGoogle(mail,'another-subject-'+suffix,random(),null,null),null);
   assert.equal(await store.signInGoogle('wrong'+suffix+'@gmail.com','existing-subject-'+suffix,random(),null,null),null);
   assert.equal(await store.signInGoogle('unexpected'+suffix+'@gmail.com','new-subject-'+suffix,random(),null,old.id),null);assert.equal(await store.credentials('unexpected'+suffix+'@gmail.com'),null);
  });
  await t.test('Google-only deletion requires a recent Google session and revokes linked data',async()=>{
   const token=a.jar.get(service.sessionName),identity=await service.identity({headers:{cookie:service.sessionName+'='+token}});assert.equal(identity.authentication.method,'google');
   const request={headers:{cookie:service.sessionName+'='+token},socket:{remoteAddress:'127.0.0.1'}};
   await assert.rejects(service.confirmPassword(request,{...identity,authentication:{method:'google',at:new Date(Date.now()-6*60000)}},undefined),e=>e.status===403);
   const marker=await service.confirmPassword(request,identity,undefined);assert.match(marker,/^google-only\$/);assert.equal(await store.deleteAccount(identity.user.id,marker),true);ids.delete(identity.user.id);assert.equal(await store.session(token),null);
   assert.equal((await sql.query('SELECT count(*)::int AS n FROM prospect_google_identities WHERE account_id=$1',[identity.user.id])).rows[0].n,0);
  });
  await t.test('expired and cross-browser OAuth flows cannot be consumed',async()=>{
   const state=random(),browser=random(),data={verifier:random(),nonce:random(),redirectUri:origin+'/api/auth/google/callback'};await store.issueGoogleFlow(state,browser,data);assert.equal(await store.consumeGoogleFlow(state,random()),null);await sql.query("UPDATE prospect_google_flows SET expires_at=now()-interval '1 second' WHERE state_hash=$1",[accounts.hash(state)]);assert.equal(await store.consumeGoogleFlow(state,browser),null);
  });
 }finally{for(const id of ids){const row=(await sql.query('SELECT password_hash FROM prospect_accounts WHERE id=$1',[id])).rows[0];if(row)await store.deleteAccount(id,row.password_hash);}await store.close();await sql.end();}
});
