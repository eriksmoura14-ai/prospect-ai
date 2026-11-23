'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),mirror=require('../discovery/catalog-mirror.cjs');
test('dataset mirrors are restricted to the reviewed repository, release and immutable filenames',()=>{
 const file='a'.repeat(64)+'.parquet';assert(mirror.allowed(mirror.MIRROR+file));assert(mirror.allowed(mirror.ORIGIN+'snapshots/de.parquet'));
 for(const url of [mirror.MIRROR+'../'+file,mirror.MIRROR+file+'?token=private',mirror.MIRROR+file+'#fragment',mirror.MIRROR+'company.html',mirror.MIRROR.replace('eriksmoura14-ai','attacker')+file,mirror.MIRROR.replace('github.com','github.com.evil.test')+file,mirror.MIRROR.replace('https:','http:')+file])assert.equal(mirror.allowed(url),false);
});
