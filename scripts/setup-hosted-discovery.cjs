"use strict";
const {spawnSync}=require("node:child_process");

// Opt-in build preparation, not a startup migration or runtime downloader.
function setup({env=process.env,run=spawnSync,log=console.log}={}) {
  if(env.RENDER!=="true"||env.DISCOVERY_INSTALL_OVERTURE!=="true")return {installed:false};
  if(env.OVERTURE_PYTHON!==".venv-discovery/bin/python"||env.DUCKDB_EXTENSION_DIRECTORY!==".duckdb-extensions") {
    throw new Error("A instalação hospedada exige os caminhos .venv-discovery/bin/python e .duckdb-extensions.");
  }
  const allowed=["PATH","HOME","HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy",
    "SSL_CERT_FILE","REQUESTS_CA_BUNDLE","PIP_CERT","PIP_INDEX_URL","PIP_EXTRA_INDEX_URL","TMPDIR","DUCKDB_EXTENSION_DIRECTORY"];
  const childEnv=Object.fromEntries(allowed.filter(key=>env[key]).map(key=>[key,env[key]]));
  const commands=[
    ["python3",["-m","venv",".venv-discovery"]],
    [env.OVERTURE_PYTHON,["-m","pip","install","--disable-pip-version-check","--only-binary=:all:","duckdb==1.4.4","requests==2.32.5",...(env.DISCOVERY_INSTALL_ARCHIVE==="true"?["shapely==2.1.2"]:[])]],
    [env.OVERTURE_PYTHON,["scripts/setup-discovery.py"]]
  ];
  for(const [command,args] of commands) {
    const result=run(command,args,{env:childEnv,stdio:"inherit",shell:false,timeout:120000});
    if(result.error||result.status!==0)throw new Error("Não foi possível preparar o leitor Overture no build; a publicação foi interrompida.");
  }
  log("Optional Overture build preparation complete; signed extension retained in application artifact.");
  return {installed:true};
}
if(require.main===module)try{setup();}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={setup};
