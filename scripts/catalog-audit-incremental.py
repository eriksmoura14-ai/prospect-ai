"""Verify an incremental coverage mirror against small database fingerprints.

The previous complete export is immutable. Only prepared country updates are
overlaid, and every country's identity/count/status fingerprint must match the
live public inventory before a new snapshot is labelled verified. This avoids
re-exporting 153k unchanged records over a nearly exhausted free transfer quota.
No database writes, credentials, business downloads or background processes.
"""
import argparse,collections,csv,gzip,hashlib,json,time
from pathlib import Path

FIELDS=('city_key','unique_supported','source_rows','category_count','association_status','coverage_status')
PROOF_SQL="""SELECT jsonb_build_object(
 'database',current_database(),'asOf',clock_timestamp(),'databaseBytes',pg_database_size(current_database()),
 'countries',(SELECT jsonb_agg(to_jsonb(c) ORDER BY country_code) FROM (
   SELECT country_code,count(*) AS cities,
    count(*) FILTER(WHERE unique_supported>=50) AS min50,
    count(*) FILTER(WHERE unique_supported>=100) AS min100,
    count(*) FILTER(WHERE unique_supported>=200) AS min200,
    count(*) FILTER(WHERE unique_supported>0) AS cities_with_confirmed_records,
    count(*) FILTER(WHERE coverage_status='location_pending') AS location_pending,
    count(*) FILTER(WHERE coverage_status='partial') AS partial,
    count(*) FILTER(WHERE coverage_status='temporary_failure') AS temporary_failure,
    md5(string_agg(city_key||'|'||coalesce(unique_supported::text,'-')||'|'||coalesce(source_rows::text,'-')||'|'||coalesce(category_count::text,'-')||'|'||association_status||'|'||coverage_status||E'\\n','' ORDER BY city_key COLLATE "C")) AS fingerprint
   FROM catalog_city_inventory GROUP BY country_code) c),
 'assets',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM catalog_assets a),
 'servingManifests',(SELECT coalesce(jsonb_agg(payload ORDER BY id),'[]'::jsonb) FROM catalog_manifests WHERE id LIKE 'serving-v2:%'),
 'queue',(SELECT jsonb_agg(to_jsonb(q) ORDER BY kind,state,round) FROM (SELECT kind,state,round,count(*) AS tasks FROM catalog_ingest_tasks GROUP BY 1,2,3) q)
) AS proof"""

def canonical(row):
 values=[str(row.get(key)) if row.get(key) not in (None,'') else '-' for key in FIELDS]
 if any('|' in value or '\n' in value for value in values):raise ValueError('unsafe_coverage_fingerprint_field')
 return ('|'.join(values)+'\n').encode()

def verified(countries,proof):
 if proof.get('database')!='catalog_ops':raise ValueError('isolated_public_inventory_required')
 actual={r['country_code']:r for r in proof['countries']}
 if countries.keys()!=actual.keys():raise ValueError('inventory_country_identity_mismatch')
 for cc,row in countries.items():
  if row['fingerprint']!=actual[cc]['fingerprint'] or any(int(row[key])!=int(actual[cc][key]) for key in row if key!='fingerprint'):raise ValueError('live_inventory_fingerprint_mismatch:'+cc)

def published_asset(asset,proof):
 actual={v['id']:v for v in proof['assets']};record=actual.get(asset['id'])
 if not record or record['sha256']!=asset['sha256'] or int(record['records'])!=asset['records']:return False
 if record['state']=='ready':return True
 if record['state']!='retired':return False
 # A preserved source is still served after a verified spatial repartition.
 # Merely retaining a retired object is not proof that users can query it.
 for manifest in proof.get('servingManifests',[]):
  originals=manifest.get('sourceAssets',[]);leaves=manifest.get('servingAssets',[])
  if manifest.get('newBusinesses')!=0 or not manifest.get('integrity',{}).get('allFieldsRetained') or not originals or not leaves:continue
  if not any(v['id']==asset['id'] and v['sha256']==asset['sha256'] and int(v['records'])==asset['records'] for v in originals):continue
  if sum(int(v['records']) for v in originals)!=manifest.get('records') or sum(int(v['records']) for v in leaves)!=manifest.get('records'):continue
  if all(v['id'] in actual and actual[v['id']]['state']=='ready' and actual[v['id']]['sha256']==v['sha256'] and int(actual[v['id']]['records'])==int(v['records']) for v in leaves):return True
 return False

def main():
 p=argparse.ArgumentParser();p.add_argument('--baseline');p.add_argument('--country-root',action='append',default=[]);p.add_argument('--proof');p.add_argument('--root');p.add_argument('--print-proof-sql',action='store_true');a=p.parse_args()
 if a.print_proof_sql:print(PROOF_SQL);return
 if not all((a.baseline,a.proof,a.root)):raise ValueError('baseline_proof_and_output_required')
 root=Path(a.root);root.mkdir(parents=True,exist_ok=True);baseline=Path(a.baseline);proof=json.loads(Path(a.proof).read_text());patches={};countries_changed=set();inputs=[]
 for folder in map(Path,a.country_root):
  asset=json.loads((folder/'published-asset.json').read_text());cc=asset['countries'][0]
  if len(asset['countries'])!=1 or cc in countries_changed:raise ValueError('duplicate_country_patch')
  if not published_asset(asset,proof):raise ValueError('country_asset_not_published')
  source=folder/'coverage-updates.ndjson';count=0
  for line in source.open():
   row=json.loads(line);key=row['city_key']
   if not key.startswith(cc+':') or key in patches:raise ValueError('country_patch_identity_mismatch')
   if row['coverage_status']!='location_pending':
    n=row['unique_supported']
    if type(n) is not int or n<0 or (row['coverage_status']=='target_met')!=(n>=50):raise ValueError('country_patch_count_mismatch')
    row['association_status']='licensed_polygon_archive';row['limitations']=['regional_sources_partial','historical_cartographic_boundary']
   elif row['unique_supported'] is not None:raise ValueError('pending_is_not_zero')
   row['sources']=[{'source':r['source'],'rows':r.get('rows',0)} for r in row['sources']]
   patches[key]=row;count+=1
  expected=next(r['cities'] for r in proof['countries'] if r['country_code']==cc)
  if count!=int(expected):raise ValueError('country_patch_incomplete')
  countries_changed.add(cc);inputs.append({'country':cc,'file':str(source),'sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest(),'cities':count})
 stats={};hashes={};last='';seen=0;temporary=root/'all-city-coverage.unverified.csv';compressed=root/'all-city-coverage.unverified.ndjson.gz'
 with baseline.open() as source,temporary.open('w',newline='') as out,gzip.open(compressed,'wt') as archive:
  reader=csv.DictReader(source);writer=csv.DictWriter(out,fieldnames=reader.fieldnames);writer.writeheader()
  for original in reader:
   key=original['city_key'];cc=original['country_code']
   if key<=last:raise ValueError('complete_baseline_must_have_unique_sorted_keys')
   last=key;row={**original,**patches.pop(key,{})};row.pop('unique_all',None)
   if cc in countries_changed:
    row['updated_at']='';row['audit_status']='target_met' if row['coverage_status']=='target_met' else original['audit_status'] if original['audit_status']=='audited_below_target' else 'pending'
   n=None if row.get('unique_supported') in (None,'') else int(row['unique_supported'])
   s=stats.setdefault(cc,collections.Counter());s['cities']+=1
   for threshold in (50,100,200):s['min'+str(threshold)]+=int(n is not None and n>=threshold)
   s['cities_with_confirmed_records']+=int(n is not None and n>0)
   for status in ('location_pending','partial','temporary_failure'):s[status]+=int(row['coverage_status']==status)
   hashes.setdefault(cc,hashlib.md5()).update(canonical(row));archive.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
   writer.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()});seen+=1
 if patches:raise ValueError('country_patch_contains_unknown_city')
 summaries={cc:{**dict(values),'fingerprint':hashes[cc].hexdigest()} for cc,values in stats.items()};verified(summaries,proof)
 if seen!=152970:raise ValueError('full_app_inventory_denominator_changed')
 temporary.replace(root/'all-city-coverage.csv');compressed.replace(root/'all-city-coverage.ndjson.gz')
 totals={key:sum(v[key] for v in summaries.values()) for key in next(iter(stats.values()))}
 totals['inventory_cities']=totals.pop('cities')
 for threshold in (50,100,200):totals['percent_min'+str(threshold)]=round(100*totals['min'+str(threshold)]/seen,4)
 report={'asOf':proof['asOf'],'coverage':totals,'countries':[{'country_code':cc,**v} for cc,v in sorted(summaries.items())],'assets':proof['assets'],'readyArchiveRecords':sum(int(v['records']) for v in proof['assets'] if v['state']=='ready'),'databaseBytes':int(proof['databaseBytes']),'exportedCities':seen,'incrementalInputs':inputs,'baseline':{'file':str(baseline),'sha256':hashlib.file_digest(baseline.open('rb'),'sha256').hexdigest()},'databaseFingerprintVerifiedForEveryCountry':True,'changedCityTimestampsNotReexported':True,'backgroundProcessConfigured':False,'verifiedContacts':False}
 (root/'global-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('countries','assets','incrementalInputs')}))

if __name__=='__main__':main()
