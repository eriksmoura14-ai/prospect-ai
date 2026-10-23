"use strict";
// Optional HTTPS read transport for environments without outbound PostgreSQL.
// Transactions and all mutations remain on the existing pg client.
function createRead(databaseUrl,fetchImpl=fetch) {
 const url=new URL(databaseUrl);
 if(!url.hostname.endsWith(".neon.tech"))throw new Error("O transporte HTTPS exige uma base Neon.");
 return async function(query,params=[]) {
  if(!/^SELECT\b/i.test(query))throw new Error("Transporte somente leitura.");
  const response=await fetchImpl("https://"+url.hostname+"/sql",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json","Neon-Connection-String":databaseUrl,"Neon-Raw-Text-Output":"false","Neon-Array-Mode":"false"},body:JSON.stringify({query,params})});
  if(!response.ok)throw new Error("Leitura do catálogo indisponível.");
  const data=await response.json();if(data.error||!Array.isArray(data.rows))throw new Error("Leitura do catálogo indisponível.");return {rows:data.rows,rowCount:data.rows.length};
 };
}
module.exports={createRead};
