'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const auth=require('../auth.cjs'),google=require('../google-auth.cjs'),{OAuth2Client}=require('google-auth-library');
const id='123456-fixture.apps.googleusercontent.com',secret='fixture-client-secret-only',random=()=>crypto.randomBytes(32).toString('base64url');
const claims=(nonce,extra={})=>({iss:'https://accounts.google.com',aud:id,sub:'123456789012345678901',email:'first.last+alias@gmail.com',email_verified:true,nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra});
test('Google is optional; incomplete configuration does not disable password authentication',()=>{
 assert.equal(google.configuration({}).enabled,false);assert.equal(google.configuration({GOOGLE_CLIENT_ID:id}).enabled,false);
 assert.equal(google.configuration({GOOGLE_CLIENT_ID:id,GOOGLE_CLIENT_SECRET:secret}).enabled,true);
 assert.equal(google.configuration({GOOGLE_CLIENT_ID:'attacker.example',GOOGLE_CLIENT_SECRET:secret}).enabled,false);
});
test('Google claims require the exact client, verified Gmail, nonce, issuer and fresh timestamps',()=>{
 const nonce=random();assert.deepEqual(google.checkedClaims(claims(nonce),id,nonce,auth.gmail),{subject:'123456789012345678901',email:'firstlast@gmail.com'});
 for(const bad of [{aud:'other-client'},{iss:'https://evil.example'},{azp:'other-client'},{email_verified:'true'},{email:'person@example.test'},{nonce:random()},{sub:''},{exp:1},{iat:1}])assert.throws(()=>google.checkedClaims(claims(nonce,bad),id,nonce,auth.gmail));
 assert.throws(()=>google.checkedClaims(claims(undefined),id,undefined,auth.gmail));
});
test('the official Google verifier checks real RSA signatures and ignores untrusted certificate URLs',async()=>{
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});const pem=publicKey.export({type:'spki',format:'pem'});const client=new OAuth2Client(id);client.getFederatedSignonCertsAsync=async()=>({certs:{fixture:pem},format:'PEM'});
 const sign=(payload,header={alg:'RS256',kid:'fixture'})=>{const a=Buffer.from(JSON.stringify(header)).toString('base64url'),b=Buffer.from(JSON.stringify(payload)).toString('base64url');return a+'.'+b+'.'+crypto.sign('RSA-SHA256',Buffer.from(a+'.'+b),privateKey).toString('base64url');};
 const nonce=random();let token=sign(claims(nonce)),calls=0;const provider=google.provider({clientId:id,clientSecret:secret},{client,fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://oauth2.googleapis.com/token');assert.equal(options.redirect,'error');const body=new URLSearchParams(options.body);assert.equal(body.get('code_verifier'),'private-pkce');assert.equal(body.get('client_secret'),secret);return new Response(JSON.stringify({id_token:token}));}});
 const flow={verifier:'private-pkce',redirectUri:'https://app.example/api/auth/google/callback'};assert.equal((await provider.claims('one-use-code',flow)).nonce,nonce);
 const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify(claims(nonce,{email:'attacker@gmail.com'}))).toString('base64url');token=parts.join('.');await assert.rejects(provider.claims('other',flow));
 token=sign(claims(nonce),{alg:'RS256',kid:'fixture',jku:'http://127.0.0.1/private'});await assert.rejects(provider.claims('other',flow));
 token=sign(claims(nonce),{alg:'HS256',kid:'fixture'});await assert.rejects(provider.claims('other',flow));assert.equal(calls,4);
});
test('OAuth state is browser-bound, one-use, PKCE-protected and never changes an already signed-in owner',async()=>{
 const box=require('../accounts.cjs').vault(crypto.randomBytes(32).toString('base64')),flows=new Map();let lastFlow,signIns=0;
 const store={csrf:x=>box.mac('csrf',x),allow:async()=>true,issueGoogleFlow:async(state,browser,flow)=>{flows.set(state,{browser,flow});lastFlow=flow;},consumeGoogleFlow:async(state,browser)=>{const v=flows.get(state);if(!v||v.browser!==browser)return null;flows.delete(state);return v.flow;},signInGoogle:async(email,sub,token,previous,expected)=>{signIns++;assert.equal(expected,'existing-owner');return {id:expected,email};}};
 const config={mode:'password',origin:'https://app.example',allowedOrigins:['https://app.example'],secure:true,google:{enabled:true,clientId:id,clientSecret:secret},email:{}};
 const provider={authorization:flow=>google.provider({clientId:id,clientSecret:secret}).authorization(flow),claims:async(code,flow)=>claims(flow.nonce)};
 const service=auth.createService(config,{store,mailer:async()=>{},googleProvider:provider});const challenge=service.account({headers:{}},null);const request={headers:{origin:config.origin,cookie:challenge.cookies[0].split(';')[0],'x-csrf-token':challenge.data.csrfToken},socket:{remoteAddress:'127.0.0.1'}};
 assert(service.checkMutation(request,null));const started=await service.google.start(request,{user:{id:'existing-owner'}}),url=new URL(started.url),state=url.searchParams.get('state');assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('scope'),'openid email');assert(!started.url.includes(lastFlow.verifier));assert(!started.url.includes(secret));assert.match(started.cookies[0],/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
 const callback=new URL(config.origin+'/api/auth/google/callback?state='+state+'&code=code');await assert.rejects(service.google.complete({headers:{}},callback));assert.equal(signIns,0);
 const browser={headers:{cookie:started.cookies[0].split(';')[0]}};const done=await service.google.complete(browser,callback);assert.equal(done.location,config.origin+'/');assert.equal(signIns,1);assert.match(done.cookies[0],/^__Host-prospect_session=/);
 await assert.rejects(service.google.complete(browser,callback));assert.equal(signIns,1);
});
test('token exchange failures never expose client secrets or authorization codes',async()=>{
 const provider=google.provider({clientId:id,clientSecret:secret},{fetchImpl:async()=>{throw Error(secret+' private-code');}});
 try{await provider.claims('private-code',{verifier:'private-verifier',redirectUri:'https://app.example/api/auth/google/callback'});assert.fail();}catch(e){assert.equal(e.status,401);assert(!e.message.includes(secret));assert(!e.message.includes('private-code'));}
});
