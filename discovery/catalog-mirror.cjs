'use strict';
const ORIGIN='https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/';
const MIRROR='https://github.com/eriksmoura14-ai/prospect-ai/releases/download/catalog-germany-20261123/';
function allowed(value){try{const u=new URL(value);return u.href===value&&!u.username&&!u.password&&!u.search&&!u.hash&&(value.startsWith(ORIGIN)||value.startsWith(MIRROR)&&/^[a-f0-9]{64}\.parquet$/.test(value.slice(MIRROR.length)));}catch{return false;}}
module.exports={ORIGIN,MIRROR,allowed};
