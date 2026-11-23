"use strict";
// Finite operator worker: one bounded batch in / one bounded batch out.
const readline=require('node:readline'),records=require('../discovery/records.cjs'),contacts=require('../contacts.cjs');
const area={countryCode:'DE',city:'',state:'',bounds:[47,56,5,16],geometry:{type:'Polygon',coordinates:[[[5,47],[16,47],[16,56],[5,56],[5,47]]]}};
function normalize(item){
 if(item.mode==='phone')return contacts.numbers(item.phone,'DE').join(';');
 const niches=Object.keys(records.groups).filter(n=>records.osmMatches(item.tags,n));
 if(!niches.length)return {rejected:'unsupported_or_inactive'};
 const match=/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/([1-9]\d*)$/.exec(item.uri);
 if(!match)return {rejected:'invalid_osm_identity'};
 const row=records.osm({type:match[1],id:match[2],tags:item.tags,lat:item.latitude,lon:item.longitude,locationMethod:item.locationMethod},area,niches[0],'qlever');
 if(!row)return {rejected:'invalid_record_or_location'};
 return {row,matchedNiches:niches,dedupPhone:contacts.numbers(row.phone,'DE').join(';')};
}
if(require.main===module){const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});input.on('line',line=>{try{const batch=JSON.parse(line);if(!Array.isArray(batch)||batch.length>500)throw Error('batch_limit');process.stdout.write(JSON.stringify(batch.map(normalize))+'\n');}catch{process.stderr.write('normalization_batch_failed\n');process.exitCode=1;input.close();}});}
module.exports={normalize};
