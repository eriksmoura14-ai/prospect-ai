"""Country/state/name/anchor crosswalk to licensed Overture locality polygons.

This never assigns the nearest city or borrows a parent county. Existing
confirmed boundaries stay authoritative; this command prepares a new country
publication using source-native division identifiers and explicit ambiguity.
"""
import argparse,collections,csv,hashlib,importlib.util,json,re,time
from pathlib import Path
import duckdb,shapely
from shapely.geometry import mapping
spec=importlib.util.spec_from_file_location('country',Path(__file__).with_name('catalog-country.py'));country=importlib.util.module_from_spec(spec);spec.loader.exec_module(country)

def names(value):
 if not isinstance(value,dict):return set()
 return {country.normalized(v) for v in [value.get('primary'),*(value.get('common') or {}).values()] if isinstance(v,str) and v.strip()}

def candidates(city,lookup):
 if not isinstance(city.get('latitude'),(int,float)) or not isinstance(city.get('longitude'),(int,float)):return []
 point=shapely.Point(city['longitude'],city['latitude'])
 # ISO 3166-2 must identify the selected app subdivision, not an enclosing
 # macroregion. Countries whose registry uses a different level remain pending.
 return [a for a in lookup.get((city['countryCode']+'-'+city['stateCode'],country.normalized(city['name'])),[]) if a['geom'].covers(point)]

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--inventory',required=True);p.add_argument('--coverage-audit',required=True);p.add_argument('--country',required=True);p.add_argument('--region',action='append',required=True);a=p.parse_args();start=time.monotonic();root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
 if not re.fullmatch('[A-Z]{2}',a.country):raise ValueError('country_identity')
 inventory=[v for v in json.loads(Path(a.inventory).read_text())['cities'] if v['countryCode']==a.country]
 with Path(a.coverage_audit).open() as file:prior=[v for v in csv.DictReader(file) if v['country_code']==a.country]
 if {v['city_key'] for v in prior}!={v['key'] for v in inventory}:raise ValueError('coverage_inventory_mismatch')
 if any(v['coverage_status']!='location_pending' for v in prior):raise ValueError('existing_country_crosswalk_must_be_merged_explicitly')
 wanted={a.country+'-'+v['stateCode'] for v in inventory};lookup=collections.defaultdict(list);seen={};bad=[];source_files=[]
 db=duckdb.connect(config={'memory_limit':'256MB','threads':'1'});columns=['id','division_id','names','country','region','subtype','class','is_territorial','sources','geometry']
 for path in map(Path,a.region):
  report=json.loads(path.with_name(path.stem+'-report.json').read_text())
  if report['sourceRelease']!='2026-10-21.0' or report['license']!='ODbL-1.0' or report['country']!=a.country or path.stat().st_size!=report['bytes'] or hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=report['sha256']:raise ValueError('division_extract_integrity')
  source_files.append({'file':str(path),'sha256':report['sha256'],'source':report['transport']['source'],'records':report['records']})
  cursor=db.execute('SELECT '+','.join('"'+v+'"' for v in columns)+' FROM read_parquet(?)',[str(path)])
  while True:
   values=cursor.fetchmany(500)
   if not values:break
   for value in values:
    row=dict(zip(columns,value));identity='OVT:division_area:'+row['id'];sources=row['sources'] or []
    if row['country']!=a.country or row['region'] not in wanted or row['subtype'] not in ('locality','localadmin') or row['is_territorial'] is not True:continue
    if not sources or any(str(s.get('dataset','')).lower() not in ('openstreetmap','geoboundaries') or s.get('license') not in ('ODbL-1.0','CC-BY-4.0','CC-BY-3.0','CC-BY-3.0-IGO') for s in sources):
     bad.append({'id':identity,'reason':'source_license_requires_review'});continue
    try:g=country.polygon(mapping(shapely.force_2d(shapely.from_wkb(row['geometry']))))
    except (ValueError,TypeError,shapely.errors.GEOSException):
     bad.append({'id':identity,'reason':'source_polygon_invalid'});continue
    if shapely.get_num_coordinates(g)>50000 or len(json.dumps(mapping(g)).encode())>2*1024*1024:
     bad.append({'id':identity,'reason':'polygon_exceeds_runtime_budget'});continue
    if identity in seen:
     if not seen[identity]['geom'].equals(g):raise ValueError('conflicting_source_geometry')
     continue
    primary=row['names']['primary'];area={'id':identity,'country_code':a.country,'state_code':row['region'].split('-',1)[1],'name':primary,'kind':row['subtype'],'source':'Overture divisions / OpenStreetMap / geoBoundaries','vintage':'2026-10-21.0','geom':g,'license':{'id':'ODbL-1.0','url':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors; Overture Maps Foundation; geoBoundaries contributors as recorded per feature','shareAlike':True,'source':'https://docs.overturemaps.org/guides/divisions/'},'source_metadata':{'source_area_id':row['id'],'division_id':row['division_id'],'subtype':row['subtype'],'regionISO':row['region'],'territorial':True,'sources':sources,'association':'Exact published country, ISO subdivision, normalized primary/common name, and app anchor inside territorial polygon','notACurrentCadastralSurvey':True}}
    seen[identity]=area
    for name in names(row['names']):lookup[(row['region'],name)].append(area)
 db.close();used={};counts=collections.Counter();mapped=[]
 for city in inventory:
  row={**city,'association_status':'name_state_or_anchor_not_confirmed','coverage_status':'location_pending','next_action':'review_official_country_crosswalk'};hits=candidates(city,lookup)
  if len(hits)==1:
   row.update(admin_id=hits[0]['id'],association_status='source_iso_name_and_anchor_inside_territorial_polygon',coverage_status='partial',next_action='collect_supported_segments_until_50_or_document_source_limits');used[hits[0]['id']]=hits[0]
  elif len(hits)>1:row['association_status']='ambiguous_boundary'
  mapped.append(row);counts[row['association_status']]+=1
 with (root/'mapped-inventory.ndjson').open('w') as out:
  for row in mapped:out.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 with (root/'admin-areas.ndjson').open('w') as out:
  for area in sorted(used.values(),key=lambda v:v['id']):
   g=area['geom'];geometry=mapping(g);w,s,e,n=g.bounds;key=hashlib.sha256((area['id']+json.dumps(geometry,separators=(',',':'))).encode()).hexdigest()
   out.write(json.dumps({**{k:v for k,v in area.items() if k!='geom'},'geometry':geometry,'bounds':[s,n,w,e],'area_key':key},ensure_ascii=False,separators=(',',':'))+'\n')
 result={'country':a.country,'inventoryCities':len(inventory),'mappedEntries':sum(bool(v.get('admin_id')) for v in mapped),'distinctSourceAreas':len(used),'counts':dict(counts),'sourceFiles':source_files,'sourcePolygonsAcceptedByRules':len(seen),'sourceFailures':bad,'elapsedMs':round((time.monotonic()-start)*1000),'licenseReviewed':True,'sourcesExhausted':False}
 (root/'boundary-match-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('sourceFiles','sourceFailures')}),flush=True)
if __name__=='__main__':main()
