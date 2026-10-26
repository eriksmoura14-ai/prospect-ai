"""Evidence-based below-target audits. Never change company counts or remove
localities. Temporary failures and absent website/phone fields are not evidence
that a city has no businesses. Private operations credential arrives on stdin.
"""
import argparse,datetime,hashlib,json,re,sys
from pathlib import Path
from urllib.parse import urlsplit
import requests

POLICY_ID='coverage-audit-policy-v2-20261026'
ACTIVE_REVIEW="""v.payload->>'decision'='audited_below_target'
 AND c.unique_supported<50 AND c.unique_supported=(v.payload->>'uniqueSupported')::int
 AND c.updated_at<=(v.payload->>'reviewedAt')::timestamptz
 AND now()<(v.payload->>'revisitAfter')::timestamptz
 AND CASE WHEN c.admin_id IS NOT NULL THEN EXISTS(SELECT 1 FROM catalog_admin_areas ga WHERE ga.id=c.admin_id AND ga.area_key=v.payload->>'areaVersion')
 ELSE EXISTS(SELECT 1 FROM catalog_manifests g WHERE g.id='geometry-v1:'||c.country_code||':'||c.state_code AND g.sha256=v.payload->>'areaVersion') END"""

def validate(review):
 if review.get('decision')!='audited_below_target' or review.get('sourcesExhausted') is not False:raise ValueError('not_a_target_met_or_exhaustiveness_claim')
 if not re.fullmatch(r'[A-Z]{2}:[A-Z0-9-]+:[0-9]+',review.get('cityKey','')):raise ValueError('city_identity')
 n=review.get('uniqueSupported')
 if type(n) is not int or not 0<=n<50:raise ValueError('below_target_count_required')
 sources=review.get('sources',[])
 if not 2<=len(sources)<=8:raise ValueError('independent_evidence_required')
 successful={}
 for s in sources:
  u=urlsplit(s['url'])
  if u.scheme!='https' or not u.hostname or u.username or u.password or u.fragment or not s.get('license'):raise ValueError('public_licensed_evidence_required')
  if s.get('outcome')=='success':successful[s['kind']]=s
 if 'official_business_registry' not in successful or 'business_catalog' not in successful:raise ValueError('failed_source_or_empty_catalog_alone_is_not_an_exception')
 if review.get('reason')=='uninhabited_locality_with_documented_sources':
  locality=successful.get('official_locality_registry',{});registry=successful['official_business_registry']
  if type(locality.get('population')) is not int or locality['population']!=0 or registry.get('measure')!='active_legal_units' or type(registry.get('count')) is not int or not 0<=registry['count']<50:raise ValueError('uninhabited_locality_evidence_required')
 elif review.get('reason')=='documented_establishment_register_below_target':
  registry=successful['official_business_registry']
  if registry.get('measure')!='active_establishments' or type(registry.get('count')) is not int or not 0<=registry['count']<50:raise ValueError('establishment_measure_required')
 else:raise ValueError('review_reason_requires_evidence_profile')
 if not review.get('limitations') or len(json.dumps(review).encode())>128*1024:raise ValueError('limitations_and_bounded_evidence_required')
 return review

def verification_sql():
 """Read-only fixtures: no catalog rows or company counts are modified."""
 return """WITH catalog_manifests(id,sha256) AS (VALUES('geometry-v1:FR:55',repeat('a',64))),
 catalog_admin_areas(id,area_key) AS (VALUES('native-fixture',repeat('a',64))),
 base AS (SELECT jsonb_build_object('decision','audited_below_target','uniqueSupported',0,'reviewedAt',now()-interval '10 minutes','revisitAfter',now()+interval '1 day','areaVersion',repeat('a',64)) AS p),
 scenarios(label,unique_supported,admin_id,updated_at,payload,expected) AS (
  SELECT 'active',0,NULL::text,now()-interval '1 hour',p,true FROM base UNION ALL
  SELECT 'expired',0,NULL,now()-interval '1 hour',p||jsonb_build_object('revisitAfter',now()-interval '1 second'),false FROM base UNION ALL
  SELECT 'count_changed',1,NULL,now()-interval '1 hour',p,false FROM base UNION ALL
  SELECT 'data_changed',0,NULL,now(),p,false FROM base UNION ALL
  SELECT 'boundary_changed',0,NULL,now()-interval '1 hour',p||jsonb_build_object('areaVersion',repeat('b',64)),false FROM base UNION ALL
  SELECT 'target_reached',50,NULL,now()-interval '1 hour',p,false FROM base UNION ALL
  SELECT 'native_active',0,'native-fixture',now()-interval '1 hour',p,true FROM base UNION ALL
  SELECT 'native_boundary_changed',0,'native-fixture',now()-interval '1 hour',p||jsonb_build_object('areaVersion',repeat('b',64)),false FROM base)
 SELECT label,expected,("""+ACTIVE_REVIEW+""") AS actual FROM scenarios s
 CROSS JOIN LATERAL(SELECT s.unique_supported,s.admin_id,s.updated_at,'FR'::text AS country_code,'55'::text AS state_code)c
 CROSS JOIN LATERAL(SELECT s.payload)v ORDER BY label"""

def main():
 p=argparse.ArgumentParser();p.add_argument('--root');p.add_argument('--verification-sql',action='store_true');a=p.parse_args()
 if a.verification_sql:print(verification_sql());return
 if not a.root:p.error('--root is required for publication')
 root=Path(a.root);cfg=json.loads(sys.stdin.readline());url=cfg['url'];host=urlsplit(url).hostname
 if not host or not host.endswith('.neon.tech'):raise ValueError('public_operations_database_required')
 reviews=cfg['reviews']
 if not 1<=len(reviews)<=12:raise ValueError('review_batch_budget')
 reviews=[validate(dict(r)) for r in reviews];session=requests.Session()
 if len({r['cityKey'] for r in reviews})!=len(reviews):raise ValueError('duplicate_city_review')
 def sql(query,params=()):
  r=session.post('https://'+host+'/sql',headers={'Neon-Connection-String':url,'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':list(params)},timeout=(10,60),allow_redirects=False)
  if r.status_code!=200:raise RuntimeError('review_database_http_'+str(r.status_code))
  d=r.json()
  if 'error' in d:raise RuntimeError('review_database_statement_rejected')
  return d['rows']
 identity=sql('SELECT current_database() AS name,pg_database_size(current_database()) AS bytes')[0]
 if identity['name']!='catalog_ops' or int(identity['bytes'])>220*1024*1024:raise ValueError('isolated_database_or_resource_budget')
 rows=sql("SELECT c.city_key,c.name,c.unique_supported,c.updated_at,c.admin_id,c.association_status,coalesce(a.area_key,g.sha256) AS area_version FROM catalog_city_inventory c LEFT JOIN catalog_admin_areas a ON a.id=c.admin_id LEFT JOIN catalog_manifests g ON g.id='geometry-v1:'||c.country_code||':'||c.state_code WHERE c.city_key=ANY($1::text[])",[[r['cityKey'] for r in reviews]]);cities={r['city_key']:r for r in rows};prepared=[]
 now=datetime.datetime.now(datetime.timezone.utc)
 for r in reviews:
  c=cities.get(r['cityKey'])
  if not c or c['name']!=r['name'] or c['unique_supported'] is None or int(c['unique_supported'])!=r['uniqueSupported'] or not c['area_version'] or not(c['admin_id'] or c['association_status']=='licensed_polygon_archive'):raise ValueError('review_snapshot_or_geographic_identity_changed')
  days=7 if any(s.get('outcome')!='success' for s in r['sources']) else 30
  r.update(policyId=POLICY_ID,reviewedAt=now.isoformat(),revisitAfter=(now+datetime.timedelta(days=days)).isoformat(),geographicAssociation=c['association_status'],areaVersion=c['area_version'],coverageUpdatedAt=c['updated_at'],target=50,targetMet=False)
  data=json.dumps(r,ensure_ascii=False,separators=(',',':'),sort_keys=True);prepared.append({'id':'review-v1:'+r['cityKey'],'payload':r,'sha256':hashlib.sha256(data.encode()).hexdigest(),'city_key':r['cityKey'],'expected_count':r['uniqueSupported'],'expected_updated_at':c['updated_at']})
 saved=sql("""WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,payload jsonb,sha256 text,city_key text,expected_count int,expected_updated_at timestamptz)),
  matched AS (SELECT r.* FROM expected r JOIN catalog_city_inventory c ON c.city_key=r.city_key AND c.unique_supported=r.expected_count AND c.updated_at=r.expected_updated_at),
  checked AS (SELECT count(*)=$2::int AS ok FROM matched),
  previous AS (INSERT INTO catalog_manifests(id,payload,sha256)
   SELECT 'review-history-v1:'||r.city_key||':'||p.sha256,p.payload,p.sha256 FROM matched r JOIN catalog_manifests p ON p.id=r.id
   WHERE (SELECT ok FROM checked) ON CONFLICT(id) DO NOTHING RETURNING id),
  history AS (INSERT INTO catalog_manifests(id,payload,sha256)
   SELECT 'review-history-v1:'||city_key||':'||sha256,payload,sha256 FROM matched WHERE (SELECT ok FROM checked)
   ON CONFLICT(id) DO NOTHING RETURNING id)
  INSERT INTO catalog_manifests(id,payload,sha256) SELECT id,payload,sha256 FROM matched WHERE (SELECT ok FROM checked)
  ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,sha256=excluded.sha256 RETURNING id""",[json.dumps(prepared),len(prepared)])
 if len(saved)!=len(prepared):raise RuntimeError('concurrent_review_snapshot_change')
 root.mkdir(parents=True,exist_ok=True);(root/'review-receipts.json').write_text(json.dumps(prepared,ensure_ascii=False,indent=2));print(json.dumps({'auditedBelowTarget':len(saved),'targetMetAdded':0,'inventoryRemoved':0,'revisitDays':[7 if any(s.get('outcome')!='success' for s in r['sources']) else 30 for r in reviews]}),flush=True)
if __name__=='__main__':main()
