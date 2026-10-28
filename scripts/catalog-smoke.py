"""Real read/search smoke test against the existing isolated staging service.
Basic test credentials on stdin; never use a production customer's credentials.
"""
import argparse,hashlib,json,sys,time
from pathlib import Path
import requests
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--country',required=True);p.add_argument('--state',required=True);p.add_argument('--city-id',required=True,type=int);p.add_argument('--niches',required=True);p.add_argument('--expected-unique',type=int);p.add_argument('--expected-source-sha256');p.add_argument('--normal-search',action='store_true');a=p.parse_args();root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
 cfg=json.loads(sys.stdin.readline());base=cfg['url']
 if base!='https://prospect-global-staging-20261023.onrender.com':raise ValueError('existing_isolated_staging_only')
 session=requests.Session();session.auth=(cfg['user'],cfg['password']);start=time.monotonic();rows={};by_niche={};sources=set();scope=None
 for niche in json.loads(Path(a.niches).read_text()):
  response=session.get(base+'/api/catalog/page',params={'country':a.country,'state':a.state,'cityId':a.city_id,'niche':niche,'limit':250},timeout=(10,80),allow_redirects=False)
  if response.status_code!=200:raise RuntimeError('staging_catalog_http_'+str(response.status_code))
  data=response.json()
  if data.get('next'):raise RuntimeError('small_city_requires_another_page')
  by_niche[niche]=len(data['rows']);scope=data['scope']
  for row in data['rows']:rows[row['osmId']]=row
  sources.update(r['asset'] for r in data['sources'])
  print(json.dumps({'segment':niche,'rows':len(data['rows']),'combinedUnique':len(rows)}),flush=True)
 report={'environment':'existing free isolated Render staging','country':a.country,'state':a.state,'cityId':a.city_id,'unique':len(rows),'byNiche':by_niche,'sources':sorted(sources),'scope':scope,'withPhone':sum(bool(r.get('phone')) for r in rows.values()),'withWebsite':sum(bool(r.get('website')) for r in rows.values()),'withAddress':sum(bool(r.get('address')) for r in rows.values()),'examples':[{'name':r['name'],'id':k} for k,r in list(rows.items())[:3]],'elapsedMs':round((time.monotonic()-start)*1000),'contactsVerified':False}
 report['sourceIdentitySha256']=hashlib.sha256(json.dumps(sorted(rows),separators=(',',':')).encode()).hexdigest()
 report['expectedUnique']=a.expected_unique;report['expectedSourceIdentitySha256']=a.expected_source_sha256
 (root/'live-city-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 if a.expected_unique is not None and len(rows)!=a.expected_unique:raise RuntimeError('city_coverage_runtime_mismatch')
 if a.expected_source_sha256 and report['sourceIdentitySha256']!=a.expected_source_sha256:raise RuntimeError('city_source_identity_runtime_mismatch')
 if a.normal_search:
  response=session.post(base+'/api/search',headers={'Origin':base},json={'location':{'countryCode':a.country,'stateCode':a.state,'cityId':a.city_id},'niche':'Restaurantes','limit':10},timeout=(10,30),allow_redirects=False)
  if response.status_code!=202:raise RuntimeError('staging_search_http_'+str(response.status_code))
  job_id=response.json()['jobId'];deadline=time.monotonic()+100
  while time.monotonic()<deadline:
   response=session.get(base+'/api/jobs/'+job_id,timeout=(10,20),allow_redirects=False);response.raise_for_status();job=response.json()
   if job['state'] not in ('running','queued'):
    report['normalSearch']={k:job.get(k) for k in ['state','totalDiscovered','timings','discoveryMetrics','discoverySources','partial']};report['normalSearch']['rows']=len(job.get('rows',[]));break
   time.sleep(1)
  else:raise RuntimeError('staging_search_deadline')
  if report['normalSearch']['state']!='done' or report['normalSearch']['rows']!=10 or not report['normalSearch']['discoveryMetrics'].get('archive'):raise RuntimeError('staging_search_did_not_use_archive')
 (root/'live-city-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
