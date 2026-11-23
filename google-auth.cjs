'use strict';
const crypto=require('node:crypto');
const {OAuth2Client}=require('google-auth-library');
const random=()=>crypto.randomBytes(32).toString('base64url');
const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const failed=(status=401)=>Object.assign(new Error('Não foi possível concluir o acesso com Google. Tente novamente.'),{status});
function configuration(env){
 const clientId=(env.GOOGLE_CLIENT_ID||'').trim(),clientSecret=(env.GOOGLE_CLIENT_SECRET||'').trim();
 if(!clientId&&!clientSecret)return {enabled:false};
 if(!/^[A-Za-z0-9_-]{6,200}\.apps\.googleusercontent\.com$/.test(clientId)||clientSecret.length<12||clientSecret.length>512||/\s/.test(clientSecret))return {enabled:false,misconfigured:true};
 return {enabled:true,clientId,clientSecret};
}
function checkedClaims(claims,clientId,nonce,normalizeEmail,now=Date.now()){
 if(!valid(nonce)||!claims||!['https://accounts.google.com','accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||claims.azp&&claims.azp!==clientId||claims.nonce!==nonce||claims.email_verified!==true||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||/[\s\x00-\x1f]/.test(claims.sub)||!Number.isFinite(claims.exp)||claims.exp*1000<=now||!Number.isFinite(claims.iat)||claims.iat*1000>now+60000||claims.iat*1000<now-15*60000)throw failed();
 let email;try{email=normalizeEmail(claims.email);}catch{throw Object.assign(new Error('O Prospect AI aceita somente contas @gmail.com.'),{status:400});}
 return {subject:claims.sub,email};
}
function provider(config,{fetchImpl=fetch,client}={}){
 client ||= new OAuth2Client({clientId:config.clientId,transporterOptions:{timeout:10000,retry:false}});
 return {
  authorization({state,nonce,verifier,redirectUri}){
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}).toString();return url.href;
  },
  async claims(code,flow){
   try{
    const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,code_verifier:flow.verifier,redirect_uri:flow.redirectUri,grant_type:'authorization_code'}).toString()});
    if(!response.ok||!response.body)throw failed();let bytes=0;const chunks=[];
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>65536)throw failed();chunks.push(Buffer.from(chunk));}
    const data=JSON.parse(Buffer.concat(chunks));if(typeof data.id_token!=='string'||data.id_token.length>16384)throw failed();
    const pieces=data.id_token.split('.');if(pieces.length!==3||pieces[0].length>2048)throw failed();const header=JSON.parse(Buffer.from(pieces[0],'base64url'));if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>128||header.jku||header.x5u)throw failed();
    const ticket=await client.verifyIdToken({idToken:data.id_token,audience:config.clientId});return ticket.getPayload();
   }catch{throw failed();}
  }
 };
}
function createService(config,{store,normalizeEmail,cookieValue,sessionName,cookie,rate,providerImpl}={}){
 if(!config.google?.enabled)return null;
 const google=config.google,remote=providerImpl||provider(google),name=config.secure?'__Host-prospect_google':'prospect_google';
 const clear=()=>cookie(name,'',0);
 return {
  cookieName:name,
  async start(request,identity){
   await rate(request,'google-start',null);
   if(!(config.allowedOrigins||[config.origin]).includes(request.headers.origin))throw failed(403);
   const browser=cookieValue(request,name)||random(),state=random(),nonce=random(),verifier=random();
   const redirectUri=request.headers.origin+'/api/auth/google/callback';
   await store.issueGoogleFlow(state,browser,{nonce,verifier,redirectUri,accountId:identity?.user.id||null});
   return {url:remote.authorization({state,nonce,verifier,redirectUri}),cookies:[cookie(name,browser,600)]};
  },
  async complete(request,url){
   const state=url.searchParams.get('state'),browser=cookieValue(request,name);
   if(!valid(state)||!valid(browser)||url.searchParams.getAll('state').length!==1)throw failed();
   const flow=await store.consumeGoogleFlow(state,browser);if(!flow)throw failed();
   if(url.searchParams.has('error'))return {location:new URL(flow.redirectUri).origin+'/#google=cancelled',cookies:[clear()]};
   const code=url.searchParams.get('code');if(typeof code!=='string'||!code||code.length>2048||url.searchParams.getAll('code').length!==1)throw failed();
   const claims=await remote.claims(code,flow),identity=checkedClaims(claims,google.clientId,flow.nonce,normalizeEmail);
   const value=random();const user=await store.signInGoogle(identity.email,identity.subject,value,cookieValue(request,sessionName),flow.accountId);
   if(!user)throw failed();
   return {user,location:new URL(flow.redirectUri).origin+'/',cookies:[cookie(sessionName,value,7*86400),clear()]};
  },
  failure(){return {location:config.origin+'/#google=failed',cookies:[clear()]};}
 };
}
module.exports={configuration,provider,checkedClaims,createService};
