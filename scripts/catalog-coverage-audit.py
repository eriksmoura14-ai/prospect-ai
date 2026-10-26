"""Export every app locality with its explicit coverage state, using keysets.
Only the isolated public catalog is queried. Credential is accepted on stdin.
"""
import argparse,csv,gzip,json,sys,time,importlib.util
from pathlib import Path
from urllib.parse import urlsplit
import requests
_spec=importlib.util.spec_from_file_location('catalog_review_policy',Path(__file__).with_name('catalog-review.py'));_review=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_review)
ACTIVE_REVIEW=_review.ACTIVE_REVIEW
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
 cfg=json.loads(sys.stdin.readline());url=cfg['url'];host=urlsplit(url).hostname
 if not host or not host.endswith('.neon.tech'):raise ValueError('isolated_catalog_required')
 session=requests.Session();start=time.monotonic()
 def sql(query,params=()):
  response=session.post('https://'+host+'/sql',headers={'Neon-Connection-String':url,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':list(params)},timeout=(10,60),allow_redirects=False)
  if response.status_code!=200:raise RuntimeError('catalog_audit_http_'+str(response.status_code))
  data=response.json()
  if data.get('error'):raise RuntimeError('catalog_audit_rejected')
  return data['rows']
 identity=sql('SELECT current_database() AS name,pg_database_size(current_database()) AS bytes')[0]
 if identity['name']!='catalog_ops':raise ValueError('wrong_database')
 stats=sql("""SELECT count(*) AS inventory_cities,count(*) FILTER(WHERE unique_supported>=50) AS min50,
  count(*) FILTER(WHERE unique_supported>=100) AS min100,count(*) FILTER(WHERE unique_supported>=200) AS min200,
  count(*) FILTER(WHERE unique_supported>0) AS cities_with_confirmed_records,
  count(*) FILTER(WHERE coverage_status='location_pending') AS location_pending,
  count(*) FILTER(WHERE coverage_status='partial') AS partial,
  count(*) FILTER(WHERE coverage_status='temporary_failure') AS temporary_failure,
  count(*) FILTER(WHERE """+ACTIVE_REVIEW+""") AS audited_below_target
  FROM catalog_city_inventory c LEFT JOIN catalog_manifests v ON v.id='review-v1:'||c.city_key""")[0]
 stats={k:int(v) for k,v in stats.items()};stats['remaining_below_or_unconfirmed_50']=stats['inventory_cities']-stats['min50']
 stats['audited_cities']=stats['min50']+stats['audited_below_target'];stats['remaining_unaudited']=stats['inventory_cities']-stats['audited_cities'];stats['percent_audited']=round(stats['audited_cities']*100/stats['inventory_cities'],4)
 for n in (50,100,200):stats['percent_min'+str(n)]=round(stats['min'+str(n)]*100/stats['inventory_cities'],4)
 countries=sql("SELECT country_code,country_name,count(*) AS cities,count(*) FILTER(WHERE unique_supported>=50) AS min50,count(*) FILTER(WHERE unique_supported>=100) AS min100,count(*) FILTER(WHERE unique_supported>=200) AS min200,count(*) FILTER(WHERE coverage_status='location_pending') AS location_pending,count(*) FILTER(WHERE "+ACTIVE_REVIEW+") AS audited_below_target FROM catalog_city_inventory c LEFT JOIN catalog_manifests v ON v.id='review-v1:'||c.city_key GROUP BY 1,2 ORDER BY 1")
 assets=sql("SELECT id,url,sha256,bytes,records,countries,bounds,source,release,license,state FROM catalog_assets ORDER BY id")
 base_fields=['city_key','country_code','country_name','state_code','state_name','city_id','name','unique_supported','source_rows','category_count','association_status','coverage_status','sources','limitations','next_action','updated_at'];fields=base_fields+['audit_status','review_id','reviewed_at','revisit_after']
 count=0;last=''
 with (root/'all-city-coverage.csv').open('w',newline='') as out,gzip.open(root/'all-city-coverage.ndjson.gz','wt') as archive:
  writer=csv.DictWriter(out,fieldnames=fields);writer.writeheader()
  while True:
   rows=sql('SELECT '+','.join('c.'+f for f in base_fields)+",CASE WHEN c.unique_supported>=50 THEN 'target_met' WHEN "+ACTIVE_REVIEW+" THEN 'audited_below_target' ELSE 'pending' END AS audit_status,CASE WHEN "+ACTIVE_REVIEW+" THEN v.id END AS review_id,CASE WHEN "+ACTIVE_REVIEW+" THEN v.payload->>'reviewedAt' END AS reviewed_at,CASE WHEN "+ACTIVE_REVIEW+" THEN v.payload->>'revisitAfter' END AS revisit_after FROM catalog_city_inventory c LEFT JOIN catalog_manifests v ON v.id='review-v1:'||c.city_key WHERE c.city_key>$1 ORDER BY c.city_key LIMIT 5000",[last])
   if not rows:break
   for row in rows:
    archive.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n');writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in row.items()})
   count+=len(rows);last=rows[-1]['city_key']
 if count!=stats['inventory_cities']:raise RuntimeError('incomplete_inventory_export')
 report={'asOf':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'coverage':stats,'countries':countries,'assets':assets,'readyArchiveRecords':sum(int(r['records']) for r in assets if r['state']=='ready'),'databaseBytes':int(identity['bytes']),'exportedCities':count,'elapsedMs':round((time.monotonic()-start)*1000),'backgroundProcessConfigured':False,'verifiedContacts':False}
 (root/'global-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('assets','countries')}),flush=True)
if __name__=='__main__':main()
