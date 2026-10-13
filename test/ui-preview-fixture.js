"use strict";
// Disposable browser fixtures only. Never shipped with Prospect AI.
(() => {
const row = {osmId:"node/10001",name:"Studio Aurora · exemplo",category:"Barbearia",city:"São Paulo",address:"Rua de exemplo, 120",phone:"+55 11 91234-5678",phoneVerification:"listed",whatsappUrl:"https://wa.me/5511912345678",status:"LIKELY_NO_WEBSITE",websiteVerification:"not_identified",confidence:.65,prospectScore:80,latitude:-23.55,longitude:-46.63,source:"OpenStreetMap",reason:"Cadastro fictício para verificar a interface. Não representa uma empresa real."};
const other = {...row,osmId:"node/10002",name:"Oficina Horizonte · exemplo",category:"Oficina",status:"WEBSITE_FOUND",websiteVerification:"compatible",website:"https://example.test",prospectScore:15};
const conflict = {...row,osmId:"node/10003",name:"Café São José · exemplo",category:"Café",phoneVerification:"conflict",whatsappUrl:"",prospectScore:70};
const rows=[row,other,conflict];
let saved=[{id:"saved1",listId:"list1",company:row,status:"new",note:"Perguntar sobre agendamento."},{id:"saved2",listId:"list1",company:other,status:"proposal",note:"Revisar escopo antes de enviar."},{id:"saved3",listId:"list1",company:conflict,status:"won",note:"Dados de demonstração."}];
const key="prospect-ai-active-job:qa-only";
localStorage.setItem(key,"fixture-job");
window.fetch=async (input, options={})=>{
 const url=String(input), method=options.method||"GET"; let data,status=200;
 if(url==="/api/account") data={mode:"password",authenticated:true,user:{id:"qa-only",email:"demo@gmail.com",preferences:{seller:"Erik",offer:"",tone:"Natural",language:"Português",knowledge:""}},csrfToken:"fixture-only"};
 else if(url==="/api/history") data=[];
 else if(url==="/api/niches") data=["Barbearia","Café","Oficina"];
 else if(url.startsWith("/api/locations/countries")) data=[{code:"BR",name:"Brazil",labelpt:"Brasil"}];
 else if(url.startsWith("/api/locations/states")) data=[{code:"SP",name:"São Paulo"}];
 else if(url.startsWith("/api/locations/cities")) data=[{name:"São Paulo",latitude:-23.55,longitude:-46.63}];
 else if(url.startsWith("/api/jobs/")) data={id:"fixture-job",state:"done",city:"São Paulo",place:"São Paulo, Brasil",niche:"Barbearia",limit:30,total:3,totalDiscovered:3,completed:3,rows,message:"3 resultados de demonstração para testar a interface."};
 else if(url==="/api/lists") data=[{id:"list1",name:"Oportunidades · demonstração",count:saved.length}];
 else if(url==="/api/lists/list1/companies") data=saved;
 else if(url.startsWith("/api/lists/list1/companies/") && method==="PATCH") { const id=url.split("/").pop(), item=saved.find(x=>x.id===id); Object.assign(item,JSON.parse(options.body)); data=item; }
 else if(url==="/api/ai") data={text:"Resposta de demonstração: confirme as evidências e pergunte como a empresa recebe pedidos de orçamento. Combine o próximo passo conforme a resposta, sem prometer resultados."};
 else { status=403; data={error:"Operação externa bloqueada neste teste."}; }
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});
};
})();
