"""Read-only real-data smoke through the archive reader and production engine.
Metadata comes from the finite local manifest; no live ready flags are changed.
Reports local integration explicitly, never as a public deployment result.
"""
import argparse,importlib.util,json,os,subprocess,time
from pathlib import Path

def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
reader=module('de_smoke_reader','catalog-read.py')
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--strict-municipal',action='store_true');a=ap.parse_args();root=Path(a.root);areas={}
 for item in json.loads((root/'download-map.json').read_text()):
  if item['file'].endswith('.json'):
   for area in json.loads(Path(item['file']).read_text()).get('areas',[]):areas[area['city_key']]=area
 for area in json.loads((root/'new-municipal-areas.json').read_text()):areas[area['city_key']]=area
 if a.strict_municipal:areas={area['city_key']:area for area in json.loads((root/'audited-municipal-areas.json').read_text())}
 inv=json.loads((root/'inventory.json').read_text());groups=json.loads((root/'runtime-groups.json').read_text());old=[x['file'] for x in json.loads((root/'download-map.json').read_text()) if x['file'].endswith('.parquet')];new=str(root/'de-osm-new.parquet');reports=[]
 # Existing reader against real source records, then the JS row factory/engine.
 for name,state in [('Monschau','NW'),('Cochem','RP'),('Bernau bei Berlin','BB'),('Berlin','BE')]:
  city=next(x for x in inv if x['name']==name and x['state_code']==state);boundary=areas[city['city_key']]
  for niche in ('Restaurantes','Padarias'):
   spec={'countryCode':'DE','geometry':boundary['geometry'],'bounds':boundary['bounds'],'categories':groups[niche],'limit':3000};start=time.monotonic();before=reader.query(spec,old);after=reader.query(spec,old+[new]);inputfile=root/'smoke-input.json'
   area={'key':boundary['area_key'],'countryCode':'DE','city':name,'state':city['state_name'],'bounds':boundary['bounds'],'geometry':boundary['geometry']}
   inputfile.write_text(json.dumps({'area':area,'niche':niche,'before':before,'after':after},ensure_ascii=False,default=str));env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG')};env['DE_SMOKE_INPUT']=str(inputfile)
   code="""const fs=require('node:fs'),assert=require('node:assert/strict');const input=JSON.parse(fs.readFileSync(process.env.DE_SMOKE_INPUT));const {archiveRecord}=require('./discovery/catalog-archive.cjs'),{createEngine}=require('./discovery/engine.cjs'),records=require('./discovery/records.cjs');
   async function run(data){const converted=data.rows.map(r=>archiveRecord(r,input.area,input.niche)).filter(Boolean);assert.equal(converted.length,data.rows.length,'real source row rejected');if(!converted.length)return {rows:0,withPhone:0,withWebsite:0,withAddress:0,validLocation:0,archive:false,sources:[],newSourceRecords:0,examples:[],truncated:data.truncated,engineOutcome:'empty_archive_requires_source_fallback',absenceOfBusinessesConfirmed:false};const forbid=()=>{throw Error('unnecessary_provider_or_write')};const engine=createEngine({store:{query:async()=>({rows:converted,archive:true,truncated:data.truncated}),coverage:forbid,enqueue:forbid,upsert:forbid},providers:{},sources:[]});const result=await engine.search(input.area,input.niche,{desiredRows:1});return {rows:result.rows.length,withPhone:result.metrics.withPhone,withWebsite:result.metrics.withWebsite,withAddress:result.metrics.withAddress,validLocation:result.metrics.validLocation,archive:result.metrics.archive,sources:[...new Set(result.rows.map(r=>r.sourceKey))],newSourceRecords:result.rows.filter(r=>r.sourceKey==='qlever').length,examples:result.rows.filter(r=>r.sourceKey==='qlever').slice(0,3).map(r=>({id:r.osmId,name:r.name,phone:r.phone,url:r.sourceUrl})),truncated:result.truncated};}
   (async()=>console.log(JSON.stringify({before:await run(input.before),after:await run(input.after)})))().catch(e=>{console.error(e.message);process.exitCode=1});"""
   p=subprocess.run(['node','-e',code],env=env,text=True,capture_output=True,timeout=30)
   if p.returncode:raise RuntimeError('real_archive_engine_smoke_failed:'+p.stderr[:200])
   result=json.loads(p.stdout);reports.append({'city':name,'cityKey':city['city_key'],'niche':niche,'environment':'local read-only production reader and engine; staged real data','elapsedMs':round((time.monotonic()-start)*1000),**result});print(json.dumps(reports[-1],ensure_ascii=False),flush=True)
 (root/('real-data-smoke-strict.json' if a.strict_municipal else 'real-data-smoke.json')).write_text(json.dumps(reports,ensure_ascii=False,indent=2));inputfile.unlink()
if __name__=='__main__':main()
