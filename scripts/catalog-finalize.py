"""Finalize published finite regional stages and audit only the public catalog.
Operations DB connection arrives as JSON on stdin; no secret is written to logs.
Does not deploy application code, change auth, or mutate the legacy catalog.
"""
import argparse,json,sys,time
from pathlib import Path
from urllib.parse import urlsplit
import requests
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',default='.artifacts/coverage-20261023');p.add_argument('--baseline-root',default='.artifacts/catalog-million-20261023');a=p.parse_args();root=Path(a.root);base=Path(a.baseline_root);cfg=json.loads(sys.stdin.readline());url=cfg['url'];host=urlsplit(url).hostname;assert host.endswith('.neon.tech')
 def sql(query,params=None):
  r=requests.post('https://'+host+'/sql',headers={'Neon-Connection-String':url,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':params or []},timeout=(10,30),allow_redirects=False)
  if r.status_code!=200:raise RuntimeError('database_unavailable')
  d=r.json()
  if 'error' in d:raise RuntimeError('database_query_rejected')
  return d['rows']
 assets=sql("SELECT id,url,sha256,bytes,records,countries,source,release,license FROM catalog_assets WHERE state='ready' ORDER BY id");known={v['id']:v for v in assets}
 expected=json.loads((root/'published-assets.json').read_text())
 for v in expected:assert v['id'] in known and known[v['id']]['sha256']==v['sha256'] and int(known[v['id']]['records'])==v['records']
 assert 'baseline-million-20261023' in known
 for part in ['00000','00001','00002','00003','00005','00006']:
  directory=base if part=='00002' else root/('region-'+part);download=json.loads((directory/'download-report.json').read_text());normal=json.loads((directory/('collection-report.json' if part=='00002' else 'normalization-report.json')).read_text());count=1000000 if part=='00002' else normal['records']
  checkpoint={'stage':'published','inputSha256':download['sha256'],'inputBytes':download['bytes'],'eligibleRecords':count,'immutableAssets':list(known),'notACensus':True}
  sql("""INSERT INTO catalog_ingest_tasks(id,kind,region,state,checkpoint,budgets,outcome)
   VALUES($1,'overture_partition',$2,'done',$3::jsonb,'{"downloadBytes":943718400,"memory":"768MB","concurrency":2,"automaticWorldScan":false}'::jsonb,'{"result":"regional_stage_published","notACensus":true}'::jsonb)
   ON CONFLICT(id) DO UPDATE SET state='done',checkpoint=excluded.checkpoint,outcome=excluded.outcome,updated_at=now() WHERE catalog_ingest_tasks.state IN ('queued','done')""",['overture-2026-10-21.0-'+part,part,json.dumps(checkpoint)])
 audit={'assets':assets,'opsDatabase':sql('SELECT pg_database_size(current_database()) AS bytes'),'tables':sql("SELECT relname,pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC"),'indexes':sql("SELECT tablename,indexname,pg_relation_size(indexname::regclass) AS bytes FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),'coverage':sql("SELECT coverage_status,count(*) AS entries FROM catalog_city_inventory GROUP BY 1 ORDER BY 1"),'thresholds':sql("SELECT count(*) AS inventory,count(*) FILTER(WHERE unique_supported>=50) AS at_least_50,count(*) FILTER(WHERE unique_supported>=100) AS at_least_100,count(*) FILTER(WHERE unique_supported>=200) AS at_least_200 FROM catalog_city_inventory"),'queue':sql('SELECT kind,state,round,count(*) AS tasks FROM catalog_ingest_tasks GROUP BY 1,2,3 ORDER BY 1,2,3'),'readerPrivileges':sql("SELECT pg_has_role('catalog_readonly','neon_superuser','member') AS privileged,has_table_privilege('catalog_readonly','catalog_assets','SELECT') AS can_read,has_table_privilege('catalog_readonly','catalog_assets','INSERT,UPDATE,DELETE') AS can_write")}
 (root/'ops-audit.json').write_text(json.dumps(audit,indent=2));print(json.dumps({'finalizedRegions':6,'readyAssets':len(assets),'archiveRecords':sum(int(v['records']) for v in assets),'operationsDatabase':audit['opsDatabase'],'thresholds':audit['thresholds'],'queue':audit['queue'],'readerPrivileges':audit['readerPrivileges']}))
if __name__=='__main__':
 try:main()
 except Exception as e:print(json.dumps({'error':type(e).__name__,'detail':str(e) if isinstance(e,RuntimeError) else 'finalization_failed'}));sys.exit(1)
