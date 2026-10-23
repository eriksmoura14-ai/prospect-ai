"use strict";
// Enumerates the same finite versioned location lists served by the application.
const fs=require("node:fs"),path=require("node:path"),locations=require("../locations.cjs");
async function run(output) {
 const countries=await locations.listCountries(),states=[],cities=[];
 for(const country of countries)for(const state of await locations.listStates(country.code)) {
  states.push({countryCode:country.code,countryName:country.name,stateCode:state.code,stateName:state.name});
  for(const city of await locations.listCities(country.code,state.code))cities.push({key:`${country.code}:${state.code}:${city.id}`,countryCode:country.code,countryName:country.name,stateCode:state.code,stateName:state.name,...city});
 }
 if(cities.length>300000)throw Error("Review inventory budget before using a larger dataset release.");
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({attribution:locations.attribution,countries,states,cities}));
 console.log(JSON.stringify({countries:countries.length,states:states.length,cities:cities.length,manualLocations:"Not enumerable; excluded from the finite denominator"}));
}
if(require.main===module)run(process.argv[2]||".artifacts/coverage-20261023/inventory.json").catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
