"""Streaming catalog reconciliation, geographic evidence and city coverage.
Never edits the immutable million or the legacy database. Outputs are resumable
local artifacts; catalog-ops publishes bounded operations and coverage metadata.
"""
import argparse,csv,gzip,hashlib,importlib.util,json,time
from collections import Counter,defaultdict
from pathlib import Path
import duckdb,numpy as np,shapely
from shapely.geometry import shape

def helper():
 spec=importlib.util.spec_from_file_location('normal',Path(__file__).with_name('catalog-normalize.py'));h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h);return h
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',default='.artifacts/coverage-20261023');p.add_argument('--baseline',default='.artifacts/catalog-million-20261023/prospect-businesses.parquet');p.add_argument('--extra-region',action='append',default=[]);p.add_argument('--output',default='new-businesses.parquet');p.add_argument('--exclude-published',action='append',default=[]);a=p.parse_args();root=Path(a.root);base=Path(a.baseline);start=time.monotonic();h=helper()
 extra=[Path(v) for v in a.extra_region];assert all(v.is_file() for v in extra)
 areas=[json.loads(l) for l in (root/'admin-areas.ndjson').open()];geoms=np.array([shape(r['geometry']) for r in areas]);tree=shapely.STRtree(geoms);area_ids=[r['id'] for r in areas];countries=[r['country_code'] for r in areas];groups=json.loads((root/'niches.json').read_text());categoryset={v for values in groups.values() for v in values}
 def locate(rows):
  points=shapely.points([r['longitude'] for r in rows],[r['latitude'] for r in rows]);matches=tree.query(points,predicate='covered_by');hits=defaultdict(list)
  for r,g in zip(*matches):
   if rows[r]['country_code']==countries[g]:hits[int(r)].append(int(g))
  return [area_ids[hits[i][0]] if len(hits[i])==1 else None for i in range(len(rows))]
 c=duckdb.connect(str(root/'coverage.duckdb'),config={'memory_limit':'512MB','threads':'1','preserve_insertion_order':'false','temp_directory':str(root/'spill'),'max_temp_directory_size':'2GB','autoinstall_known_extensions':'false','autoload_known_extensions':'false'})
 # Reuse the already downloaded part 2 and recover coastal points only when an
 # official city polygon confirms the source country. No nearest-city assignment.
 recovery=root/'region-00002-recovered.parquet'
 if not recovery.exists():
  old=base.parent/'offline.duckdb';c.execute("ATTACH '"+str(old).replace("'","''")+"' AS old (READ_ONLY)")
  candidate=c.execute("SELECT source_id,name,primary_category,category_hierarchy,alternate_categories,basic_category,country_code,state,original_city,address,coordinates.latitude AS latitude,coordinates.longitude AS longitude,phones,websites,confidence,operating_status,provenance,active_niche FROM old.candidates WHERE active_niche IS NOT NULL AND coordinates IS NOT NULL AND source_id NOT IN (SELECT source_id FROM read_parquet(?))",[str(base)])
  cols=[d[0] for d in candidate.description];kept=[]
  while True:
   batch=candidate.fetchmany(5000)
   if not batch:break
   rows=[dict(zip(cols,r)) for r in batch]
   for r,admin in zip(rows,locate(rows)):
    if not admin:continue
    r.update(normalized_name=h.normalize(r['name']),category=r.pop('active_niche'),city=r.get('original_city') or '',address=r.get('address') or '',state=r.get('state') or '',phone=h.phone(r['phones']),website=h.website(r['websites']),source='overture',source_release='2026-10-21.0',license_id='CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0',catalog_scope='active_niche',discovered_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),last_seen_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),last_verified_at=None,location_verification='official_city_polygon_and_source_country')
    r['website_classification']='insufficient_information' if not r['website'] else 'needs_verification' if h.profile(r['website']) else 'website_identified';r['phone_verification']='listed_unverified' if r['phone'] else 'not_listed';kept.append(r)
  staging=root/'recovered.ndjson';staging.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in kept))
  c.execute("COPY (SELECT * FROM read_json_auto(?,maximum_object_size=16777216)) TO '"+str(recovery).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD)",[str(staging)])
  c.execute('DETACH old');print(json.dumps({'stage':'coastal_recovery','records':len(kept)}),flush=True)
 # Dedup keys only in operator memory, streamed in small batches, never the browser.
 dedup=h.Deduplicator();counts=defaultdict(Counter);before=defaultdict(Counter);source_counts=defaultdict(Counter);categories=defaultdict(set);pending=Counter();country=defaultdict(Counter);aliases=[];new_ids=[];assignfile=root/'city-assignments.csv.gz';total=Counter()
 fields=['source_id','country_code','name','latitude','longitude','phone','address','category','catalog_scope','primary_category','category_hierarchy','alternate_categories','basic_category']
 def supported(r):return r.get('catalog_scope')=='active_niche' or bool(categoryset.intersection([r.get('primary_category'),r.get('basic_category'),*(r.get('category_hierarchy') or []),*(r.get('alternate_categories') or [])]))
 with gzip.open(assignfile,'wt',newline='') as af:
  writer=csv.writer(af);writer.writerow(['source','source_id','canonical_source_id','admin_id','supported','is_new','duplicate'])
  def consume(rows,source,new):
   admins=locate(rows)
   for r,admin in zip(rows,admins):
    cc=r['country_code'];identity=('osm/' if source in ('qlever','overpass','geofabrik') else source+'/')+r['source_id'];is_supported=supported(r);total['observations']+=1;country[cc]['source_observations']+=1;previous=dedup.accept(identity,cc,r['name'],r['latitude'],r['longitude'],r.get('phone'),r.get('address'));duplicate=bool(previous)
    if duplicate:aliases.append({'source':source,'source_id':r['source_id'],'canonical':previous,'country_code':cc,'reason':'same_identity_or_same_name_within_60m_and_shared_phone_or_nonconflicting_address'});total['overlaps']+=1;country[cc]['overlaps']+=1
    else:
     total['unique']+=1;country[cc]['unique']+=1
     if new:total['new_unique']+=1;country[cc]['new_unique']+=1
     if admin:
      counts[admin]['all']+=1;counts[admin]['supported']+=int(is_supported)
      if is_supported:
       for niche,values in groups.items():
        if r.get('category')==niche or set(values).intersection([r.get('primary_category'),r.get('basic_category'),*(r.get('category_hierarchy') or []),*(r.get('alternate_categories') or [])]):categories[admin].add(niche)
      if not new:before[admin]['all']+=1;before[admin]['supported']+=int(is_supported)
     else:pending['unassigned_unique']+=1
    if admin:counts[admin]['source_rows']+=1;source_counts[admin][source]+=1
    else:pending['unassigned_observations']+=1
    if new and not duplicate:new_ids.append(r['source_id'])
    writer.writerow([source,r['source_id'],previous or identity,admin or '',int(is_supported),int(new),int(duplicate)])
  def parquet(file,new):
   cur=c.execute('SELECT '+','.join('CAST(source_id AS VARCHAR) AS source_id' if f=='source_id' else f for f in fields)+' FROM read_parquet(?) ORDER BY country_code,source_id',[str(file)]);cols=[d[0] for d in cur.description]
   while True:
    batch=cur.fetchmany(10000)
    if not batch:break
    consume([dict(zip(cols,r)) for r in batch],'overture',new)
    if total['observations']%100000==0:print(json.dumps({'stage':'reconcile','processed':total['observations'],'unique':total['unique']}),flush=True)
  parquet(base,False)
  # Existing OSM provenance retained. Same OSM ID across transports counts once.
  old=json.loads((root/'legacy-snapshot.json').read_text());batch=[]
  for r in sorted(old['discovery_records'],key=lambda r:(r['source'],r['source_id'])):
   p=r['payload'];p2={**r,'latitude':p['latitude'],'longitude':p['longitude'],'catalog_scope':'active_niche'};batch.append(p2)
  # Preserve each source's observation while canonicalizing the OSM identity.
  for source in sorted({r['source'] for r in batch}):consume([r for r in batch if r['source']==source],source,False)
  parquet(recovery,True);parquet(root/'region-00003/normalized.parquet',True)
  for file in extra:parquet(file,True)
 aliasesfile=root/'overlap-aliases.ndjson.gz'
 with gzip.open(aliasesfile,'wt') as f:
  for r in aliases:f.write(json.dumps(r)+'\n')
 ids=root/'new-canonical-ids.csv'
 with ids.open('w') as f:
  w=csv.writer(f);w.writerow(['source_id']);w.writerows([x] for x in new_ids)
 output=root/a.output;inputfiles=[str(recovery),str(root/'region-00003/normalized.parquet'),*[str(v) for v in extra]]
 params=[inputfiles,str(ids)];exclude=''
 if a.exclude_published:exclude=' WHERE CAST(n.source_id AS VARCHAR) NOT IN (SELECT CAST(source_id AS VARCHAR) FROM read_parquet(?,union_by_name=true))';params.append(a.exclude_published)
 if output.exists() and output.stat().st_size==0:output.rename(output.with_suffix('.failed-empty'))
 if not output.exists():
  # The IDs were deduplicated in the streaming pass. A wide window/sort here
  # buffers provenance for an entire region; a membership join streams instead.
  temporary=output.with_suffix('.partial.parquet')
  c.execute("COPY (SELECT n.* REPLACE(CAST(n.source_id AS VARCHAR) AS source_id) FROM read_parquet(?,union_by_name=true) n JOIN read_csv(?,all_varchar=true) i ON CAST(n.source_id AS VARCHAR)=i.source_id"+exclude+") TO '"+str(temporary).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 20000)",params)
  duplicate_rows=c.execute('SELECT count(*)-count(DISTINCT source_id) FROM read_parquet(?)',[str(temporary)]).fetchone()[0]
  if duplicate_rows:raise RuntimeError('unexpected_partition_identity_overlap')
  temporary.replace(output)
 inventory=[json.loads(l) for l in (root/'mapped-inventory.ndjson').open()];summary=Counter();baseline=Counter();examples=[];area_by_id={v['id']:v for v in areas};footprint_metadata={};complement={}
 if (root/'complement/report.json').exists():complement={v['adminId']:v for v in json.loads((root/'complement/report.json').read_text())['results']}
 for part in ['00002','00003']+[v.parent.name.replace('region-','') for v in extra]:
  download=base.parent/'download-report.json' if part=='00002' else root/('region-'+part)/'download-report.json';footprint_metadata[part]=json.loads(download.read_text())['assetBounds']
 with (root/'coverage-updates.ndjson').open('w') as out,(root/'coverage-cities.csv').open('w') as cf:
  w=csv.writer(cf);w.writerow(['country','state','city','city_key','admin_id','before_supported','unique_supported','unique_all','source_rows','segments','status','reason'])
  for city in inventory:
   admin=city.get('admin_id');counter=counts[admin] if admin else None;b=before[admin] if admin else None;n=counter['supported'] if counter is not None else None
   status='location_pending' if admin is None else 'target_met' if n>=50 else 'partial';reason=city['association_status'] if admin is None else 'Finite processed Overture regional partitions and existing OSM observations; not an exhaustive source/city census. Official boundary vintage/scale limitations apply.'
   if n is not None and n<50 and admin in complement and complement[admin]['outcome']=='temporary_failure':status='temporary_failure';reason+=' OSM complement failed temporarily; available records retained, absence not inferred.'
   for threshold in (50,100,200):
    if n is not None and n>=threshold:summary['at_least_'+str(threshold)]+=1
    if b is not None and b['supported']>=threshold:baseline['at_least_'+str(threshold)]+=1
   summary[status]+=1
   if n and n>=50 and b['supported']<50:examples.append({'country':city['countryCode'],'state':city['stateCode'],'city':city['name'],'cityId':city['id'],'before':b['supported'],'after':n,'adminId':admin})
   consulted=[]
   if admin:
    south,north,west,east=area_by_id[admin]['bounds'];footprints=[]
    for part,(w0,s0,e0,n0) in footprint_metadata.items():
     if west<=e0 and east>=w0 and south<=n0 and north>=s0:footprints.append(part)
    if footprints:consulted.append({'source':'overture','partitions':footprints,'rows':source_counts[admin]['overture'],'scope':'regional_partial','outcome':'records_found' if source_counts[admin]['overture'] else 'no_matching_records_in_processed_partitions'})
    consulted.extend({'source':source,'rows':count,'scope':'previous_city_import'} for source,count in source_counts[admin].items() if source!='overture')
    if admin in complement:consulted.append(complement[admin])
   update={'city_key':city['key'],'unique_supported':n,'unique_all':counter['all'] if counter is not None else None,'source_rows':counter['source_rows'] if counter is not None else None,'category_count':len(categories[admin]) if admin else None,'sources':consulted,'limitations':[reason],'coverage_status':status,'next_action':city['next_action'] if not admin else 'complement_permitted_sources_then_round_100' if n>=50 else 'complement_permitted_sources_for_under_50'}
   out.write(json.dumps(update,separators=(',',':'))+'\n');w.writerow([city['countryCode'],city['stateCode'],city['name'],city['key'],admin or '',b['supported'] if b else '',n if n is not None else '',update['unique_all'],update['source_rows'],update['category_count'],status,reason])
 metrics=dict(zip(['records','phone','website','address','valid_location'],c.execute("SELECT count(*),count(*) FILTER(WHERE phone<>''),count(*) FILTER(WHERE website<>''),count(*) FILTER(WHERE address<>''),count(*) FILTER(WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180) FROM read_parquet(?)",[str(output)]).fetchone()))
 report={'inventoryDenominator':len(inventory),'mappedEntries':sum(bool(r.get('admin_id')) for r in inventory),'summary':dict(summary),'baselineCoverage':dict(baseline),'percentOfAllAppCities':{k:round(v/len(inventory)*100,4) for k,v in summary.items()},'counts':dict(total),'countries':{k:dict(v) for k,v in sorted(country.items())},'associationPending':dict(pending),'newAsset':{**metrics,'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'file':str(output)},'examplesImproved':sorted(examples,key=lambda r:r['after'])[:100],'elapsedMs':round((time.monotonic()-start)*1000),'rateObservationsPerSecond':round(total['observations']/(time.monotonic()-start),1),'limitations':['Source rows and businesses are different units. Duplicate observations and aliases retained separately.','Source-city labels do not enter confirmed city counts. Ambiguous/outside polygon points remain pending.','Baseline million remains byte-identical; additional commercial sectors retained but only supported categories enter goals.','Only US/CA official crosswalk processed this round; other countries are explicitly location_pending.','Below 50 after regional partial imports is partial, not evidence of fewer than 50 real businesses.','Conservative cross-source dedup may retain uncertain matches; separate branches with conflicting addresses remain distinct.']}
 (root/'coverage-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
