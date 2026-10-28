"""Recover coarse-country-map false negatives using reviewed local polygons.

Source-country agreement and exact containment in an already reviewed requested
area are both required. No buffering, nearest city, address guessing or new
source download. Output remains a candidate delta until normal reconciliation
against every previous canonical country asset and the legacy catalog.
"""
import argparse,gzip,hashlib,importlib.util,json,math,time
from pathlib import Path
import duckdb,shapely

spec=importlib.util.spec_from_file_location('coastal_country',Path(__file__).with_name('catalog-country.py'));country=importlib.util.module_from_spec(spec);spec.loader.exec_module(country)

class ReviewedAreas:
 def __init__(self,areas,code):
  if not areas or any(a['country_code']!=code or a.get('license',{}).get('id')!='ODbL-1.0' for a in areas):raise ValueError('reviewed_country_areas_required')
  self.code=code;self.areas=areas;self.tree=shapely.STRtree([country.polygon(a['geometry']) for a in areas])
 def proof(self,row):
  lat=row.get('latitude');lon=row.get('longitude')
  if row.get('country_code')!=self.code or not isinstance(lat,(float,int)) or not isinstance(lon,(float,int)) or not math.isfinite(lat) or not math.isfinite(lon) or not -90<=lat<=90 or not -180<=lon<=180:return []
  return sorted(self.areas[int(i)]['id'] for i in self.tree.query(shapely.Point(lon,lat),predicate='covered_by'))

def main():
 p=argparse.ArgumentParser();p.add_argument('--candidate-database',required=True);p.add_argument('--normalized-reference',required=True);p.add_argument('--normalization-report',required=True);p.add_argument('--base-root',required=True);p.add_argument('--country',required=True);p.add_argument('--root',required=True);a=p.parse_args();root=Path(a.root);root.mkdir(parents=True,exist_ok=True);start=time.monotonic()
 base=Path(a.base_root);metadata=json.loads(Path(a.normalization_report).read_text());reference=Path(a.normalized_reference)
 if reference.stat().st_size!=metadata['bytes'] or hashlib.file_digest(reference.open('rb'),'sha256').hexdigest()!=metadata['sha256'] or metadata['source']['release']!='2026-10-21.0':raise ValueError('normalization_reference_integrity')
 areas=[json.loads(line) for line in (base/'admin-areas.ndjson').open()];index=ReviewedAreas(areas,a.country);db=duckdb.connect(a.candidate_database,read_only=True,config={'memory_limit':'256MB','threads':'1'});helper=country.helper()
 for name,fn,args,ret in [('normalized_name',helper.normalize,['VARCHAR'],'VARCHAR'),('public_phone',helper.phone,['VARCHAR[]'],'VARCHAR'),('public_website',helper.website,['VARCHAR[]'],'VARCHAR'),('is_profile',helper.profile,['VARCHAR'],'BOOLEAN')]:db.create_function(name,fn,args,ret,null_handling='special')
 rows=db.execute('SELECT c.source_id,c.country_code,c.name,c.coordinates.latitude,c.coordinates.longitude FROM candidates c ANTI JOIN normalized n USING(source_id) WHERE c.country_code=?',[a.country]).fetchall();accepted=[]
 with gzip.open(root/'recovery-evidence.ndjson.gz','wt') as evidence:
  for identity,code,name,lat,lon in rows:
   proof=index.proof({'country_code':code,'latitude':lat,'longitude':lon})
   if not proof:continue
   accepted.append(identity);evidence.write(json.dumps({'source':'overture','source_id':identity,'reviewedAreaIds':proof,'country':code,'countryConfirmed':True,'cityAssociationRequiresNormalReconciliation':True},separators=(',',':'))+'\n')
 stamp=db.execute('SELECT min(discovered_at) FROM normalized').fetchone()[0]
 query="""WITH recovered AS (SELECT CAST(source_id AS VARCHAR) AS source_id,name,normalized_name(name) AS normalized_name,active_niche AS category,primary_category,category_hierarchy,alternate_categories,basic_category,country_code,coalesce(state,'') AS state,coalesce(original_city,'') AS city,original_city,coalesce(address,'') AS address,coordinates.latitude AS latitude,coordinates.longitude AS longitude,public_phone(phones) AS phone,phones,public_website(websites) AS website,websites,confidence,operating_status,'overture' AS source,'2026-10-21.0' AS source_release,provenance,'ODbL-1.0 AND CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0' AS license_id,'active_niche' AS catalog_scope,? AS discovered_at,? AS last_seen_at,NULL::VARCHAR AS last_verified_at,'source_country_and_reviewed_requested_area_polygon' AS location_verification FROM candidates WHERE source_id=ANY(?) AND country_code=? QUALIFY row_number() OVER(PARTITION BY source_id ORDER BY confidence DESC NULLS LAST)=1)
 SELECT r.*,CASE WHEN website='' THEN 'insufficient_information' WHEN is_profile(website) THEN 'needs_verification' ELSE 'website_identified' END AS website_classification,CASE WHEN phone='' THEN 'not_listed' ELSE 'listed_unverified' END AS phone_verification FROM recovered r ORDER BY source_id"""
 output=root/'recovered-normalized.parquet';temporary=output.with_suffix('.partial.parquet');db.execute("COPY ("+query+") TO '"+str(temporary).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 10000)",[stamp,stamp,accepted,a.country])
 schema=db.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(temporary)]).fetchall();previous=db.execute('DESCRIBE SELECT * FROM read_parquet(?)',[str(reference)]).fetchall()
 if [(r[0],r[1]) for r in schema]!=[(r[0],r[1]) for r in previous]:raise ValueError('recovered_schema_mismatch')
 count=db.execute('SELECT count(*) FROM read_parquet(?)',[str(temporary)]).fetchone()[0];temporary.replace(output);db.close()
 result={'country':a.country,'rejectedByCoarseCountryMap':len(rows),'insideReviewedRequestedAreas':count,'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'sourceRelease':'2026-10-21.0','candidateCacheSourcePreviouslyValidated':True,'rawSourceSha256':metadata['source']['sha256'],'rawSourceRehashedThisRecovery':False,'normalizedReferenceSha256':metadata['sha256'],'areaFileSha256':hashlib.file_digest((base/'admin-areas.ndjson').open('rb'),'sha256').hexdigest(),'license':'ODbL-1.0 AND original per-record source licenses','attribution':'© OpenStreetMap contributors; Overture Maps Foundation; original per-record provenance retained','newNetworkBytes':0,'deduplicatedAgainstPreviousAssets':False,'contactsVerified':False,'elapsedMs':round((time.monotonic()-start)*1000)}
 (root/'recovery-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result))

if __name__=='__main__':main()
