"""Finite resumable regional normalization. Publisher input is downloaded once.
Credentials are not accepted. Only reviewed public commercial POIs are emitted.
The original baseline is immutable; this worker writes a separate staging asset.
"""
import argparse,hashlib,importlib.util,json,time,re
from pathlib import Path
import duckdb,shapely
from shapely.geometry import shape

def main():
 p=argparse.ArgumentParser();p.add_argument('--region',required=True);p.add_argument('--baseline',required=True);p.add_argument('--countries',required=True);p.add_argument('--niches',required=True);p.add_argument('--country-code',action='append');a=p.parse_args();selected=sorted(set(a.country_code or ['US','CA']));assert all(re.fullmatch('[A-Z]{2}',cc) for cc in selected);suffix='' if selected==['CA','US'] else '-'+('-'.join(selected))
 root=Path(a.region);source=root/'regional-source.parquet';report=json.loads((root/'download-report.json').read_text());start=time.monotonic()
 assert report['release']=='2026-10-21.0' and source.stat().st_size==report['bytes']<900*1024*1024
 assert hashlib.file_digest(source.open('rb'),'sha256').hexdigest()==report['sha256']
 spec=importlib.util.spec_from_file_location('norm',Path(__file__).with_name('catalog-normalize.py'));h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
 groups=json.loads(Path(a.niches).read_text());categories=sorted({v for values in groups.values() for v in values});boundaries={}
 for f in json.loads(Path(a.countries).read_text())['features']:
  cc=f['properties'].get('ISO_A2_EH') or f['properties'].get('ISO_A2');g=shape(f['geometry'])
  if cc not in selected:continue
  if not g.is_valid:g=shapely.make_valid(g)
  boundaries[cc]=shapely.union_all([boundaries[cc],g]) if cc in boundaries else g
 for g in boundaries.values():shapely.prepare(g)
 def covers(cc,lon,lat):return bool(cc in boundaries and shapely.intersects_xy(boundaries[cc],lon,lat))
 assert set(boundaries)==set(selected),'Country needs reviewed geographic boundary data before ingestion'
 c=duckdb.connect(str(root/('region'+suffix+'.duckdb')),config={'memory_limit':'768MB','threads':'1','temp_directory':str(root/'spill'),'max_temp_directory_size':'3GB','autoinstall_known_extensions':'false','autoload_known_extensions':'false'})
 for name,fn,args,ret in [('point_coordinates',h.point,['BLOB'],'STRUCT(longitude DOUBLE,latitude DOUBLE)'),('country_covers',covers,['VARCHAR','DOUBLE','DOUBLE'],'BOOLEAN'),('normalized_name',h.normalize,['VARCHAR'],'VARCHAR'),('public_phone',h.phone,['VARCHAR[]'],'VARCHAR'),('public_website',h.website,['VARCHAR[]'],'VARCHAR'),('is_profile',h.profile,['VARCHAR'],'BOOLEAN')]:c.create_function(name,fn,args,ret,null_handling='special')
 def exists(table):return c.execute('SELECT count(*) FROM information_schema.tables WHERE table_name=?',[table]).fetchone()[0]>0
 if not exists('candidates'):
  niche='CASE '+''.join('WHEN list_has_any(taxonomy.hierarchy,'+repr(values)+') OR list_contains('+repr(values)+',taxonomy.primary) OR list_has_any(taxonomy.alternates,'+repr(values)+') OR list_contains('+repr(values)+',basic_category) THEN '+"'"+key.replace("'","''")+"' " for key,values in groups.items())+' ELSE NULL END'
  c.execute("""CREATE TABLE candidates AS SELECT id AS source_id,names.primary AS name,taxonomy.primary AS primary_category,taxonomy.hierarchy AS category_hierarchy,taxonomy.alternates AS alternate_categories,basic_category,
   upper(addresses[1].country) AS country_code,addresses[1].region AS state,addresses[1].locality AS original_city,
   concat_ws(', ',nullif(addresses[1].freeform,''),nullif(addresses[1].postcode,'')) AS address,point_coordinates(geometry) AS coordinates,phones,websites,confidence,coalesce(operating_status,'unknown') AS operating_status,
   to_json(list_transform(sources,s -> struct_pack(dataset:=s.dataset,record_id:=s.record_id,license:=coalesce(nullif(s.license,''),CASE lower(s.dataset) WHEN 'foursquare' THEN 'Apache-2.0' WHEN 'alltheplaces' THEN 'CC0-1.0' ELSE 'CDLA-Permissive-2.0' END),property:=s.property))) AS provenance,
   NICHE AS active_niche FROM read_parquet(?) WHERE id IS NOT NULL AND length(trim(names.primary)) BETWEEN 1 AND 400
   AND upper(addresses[1].country)=ANY(?) AND (confidence IS NULL OR confidence BETWEEN 0.5 AND 1) AND coalesce(operating_status,'unknown')<>'permanently_closed'
   AND (list_has_any(taxonomy.hierarchy,?) OR list_contains(?,taxonomy.primary) OR list_has_any(taxonomy.alternates,?) OR list_contains(?,basic_category))
   AND len(sources)>0 AND len(list_filter(sources,s -> s.dataset IS NULL OR NOT list_contains(?,lower(s.dataset)) OR NOT list_contains(?,coalesce(nullif(s.license,''),CASE lower(s.dataset) WHEN 'foursquare' THEN 'Apache-2.0' WHEN 'alltheplaces' THEN 'CC0-1.0' ELSE 'CDLA-Permissive-2.0' END))))=0""".replace('NICHE',niche),[str(source),selected,categories,categories,categories,categories,h.KNOWN,h.LICENSES])
  print(json.dumps({'stage':'candidates','records':c.execute('SELECT count(*) FROM candidates').fetchone()[0]}),flush=True)
 if not exists('normalized'):
  now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
  c.execute("""CREATE TABLE normalized AS SELECT source_id,name,normalized_name(name) AS normalized_name,active_niche AS category,primary_category,category_hierarchy,alternate_categories,basic_category,country_code,coalesce(state,'') AS state,coalesce(original_city,'') AS city,original_city,coalesce(address,'') AS address,coordinates.latitude AS latitude,coordinates.longitude AS longitude,public_phone(phones) AS phone,phones,public_website(websites) AS website,websites,confidence,operating_status,'overture' AS source,? AS source_release,provenance,'CDLA-Permissive-2.0 AND Apache-2.0 AND CC0-1.0' AS license_id,'active_niche' AS catalog_scope,? AS discovered_at,? AS last_seen_at,NULL::VARCHAR AS last_verified_at,'source_country_and_natural_earth_10m' AS location_verification FROM candidates WHERE active_niche IS NOT NULL AND coordinates IS NOT NULL AND country_covers(country_code,coordinates.longitude,coordinates.latitude) QUALIFY row_number() OVER(PARTITION BY source_id ORDER BY confidence DESC NULLS LAST)=1""",['2026-10-21.0',now,now])
  print(json.dumps({'stage':'normalized','records':c.execute('SELECT count(*) FROM normalized').fetchone()[0]}),flush=True)
 output=root/('normalized'+suffix+'.parquet')
 if output.exists() and output.stat().st_size==0:output.rename(output.with_suffix('.failed-empty'))
 if not output.exists():
  temporary=output.with_suffix('.partial.parquet')
  c.execute("COPY (SELECT n.*,CASE WHEN website='' THEN 'insufficient_information' WHEN is_profile(website) THEN 'needs_verification' ELSE 'website_identified' END AS website_classification,CASE WHEN phone='' THEN 'not_listed' ELSE 'listed_unverified' END AS phone_verification FROM normalized n ORDER BY country_code,source_id) TO '"+str(temporary).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 20000)")
  temporary.replace(output)
 metrics={'records':c.execute('SELECT count(*) FROM normalized').fetchone()[0],'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'elapsedMs':round((time.monotonic()-start)*1000),'source':report,'stage':'normalized','deduplicated':False}
 (root/('normalization-report'+suffix+'.json')).write_text(json.dumps(metrics,indent=2));print(json.dumps(metrics),flush=True)
if __name__=='__main__':main()
