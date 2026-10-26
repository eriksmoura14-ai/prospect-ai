"""Reviewed official INSEE commune identities with IGN ADMIN EXPRESS contours.
Uses one cached annual national extract; never Nominatim or per-city downloads.
COM geometries supplied from other sources are deliberately not attributed to IGN.
"""
import argparse,collections,gzip,hashlib,importlib.util,json,re,time
from pathlib import Path
import shapely
from shapely.geometry import mapping
spec=importlib.util.spec_from_file_location('country',Path(__file__).with_name('catalog-country.py'));country=importlib.util.module_from_spec(spec);spec.loader.exec_module(country)

def department(code):return '75' if code=='75C' else code

def eligible(properties):
 d=properties.get('departement','');code=properties.get('code','')
 return bool(re.fullmatch(r'(?:0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-4]|976)',d) and re.fullmatch('[0-9A-Z]{5}',code) and code.startswith(d))

def match(city,lookup):
 if city['countryCode']!='FR' or not isinstance(city.get('latitude'),(int,float)) or not isinstance(city.get('longitude'),(int,float)):return []
 point=shapely.Point(city['longitude'],city['latitude'])
 return [a for a in lookup.get((department(city['stateCode']),country.normalized(city['name'])),[]) if a['geom'].covers(point)]

def resolve(city,lookup,repair=False):
 matches=match(city,lookup)
 if matches or not repair:return matches,False
 # Selected name+official department identifies one INSEE unit, independently
 # of a faulty coordinate in the app registry. Never pick among homonyms.
 candidates=lookup.get((department(city['stateCode']),country.normalized(city['name'])),[])
 return (candidates,True) if len(candidates)==1 else ([],False)

def official_polygon(geometry):
 g=shapely.geometry.shape(geometry)
 if g.geom_type not in ('Polygon','MultiPolygon'):raise ValueError('non_polygon_boundary')
 if not g.is_valid:g=shapely.make_valid(g)
 if g.geom_type=='GeometryCollection':g=shapely.union_all([part for part in shapely.get_parts(g) if part.geom_type in ('Polygon','MultiPolygon')])
 return country.polygon(mapping(g))

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--inventory',required=True);p.add_argument('--repair-registry-coordinates',action='store_true');a=p.parse_args();root=Path(a.root);start=time.monotonic()
 source=root/'official-communes-100m.geojson.gz';receipt=json.loads((root/'official-source-download.json').read_text())
 if receipt['vintage']!='2026' or hashlib.file_digest(source.open('rb'),'sha256').hexdigest()!=receipt['sha256']:raise ValueError('official_source_integrity')
 inputs=json.loads((root/'official-registry-inputs.json').read_text())
 if {r['file'] for r in inputs}!={'official-communes-100m.geojson.gz','official-delegated-communes-100m.geojson.gz','official-COG-registry-6.0.0.json'}:raise ValueError('official_registry_input_set')
 for r in inputs:
  path=root/r['file']
  if path.stat().st_size!=r['bytes'] or hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=r['sha256']:raise ValueError('official_registry_input_integrity')
 evidence=json.loads((root/'data-gouv-license-evidence.json').read_text())['data']
 if not any(r.get('id')=='5808de39c751df1e0679df72' and r.get('license')=='lov2' for r in evidence):raise ValueError('official_license_review_required')
 data=json.load(gzip.open(source));registry=json.loads((root/'official-COG-registry-6.0.0.json').read_text());current=[r for r in registry if r['type']=='commune-actuelle'];current_names={(r['code'],country.normalized(r['nom'])) for r in current};registry_keys={(r['code'],r['type'],country.normalized(r['nom'])) for r in registry};parents=collections.defaultdict(set)
 for r in current:
  for code in [r['code'],*r.get('anciensCodes',[])]:parents[code].add(r['code'])
 delegated=json.load(gzip.open(root/'official-delegated-communes-100m.geojson.gz'))
 lookup=collections.defaultdict(list);used={};mapped=[];statuses=collections.Counter();names={};invalid=[]
 for feature in data['features']+delegated['features']:
  prop=feature['properties']
  if not eligible(prop):continue
  code=prop['code'];unit_type=prop.get('type') or ('arrondissement-municipal' if prop.get('commune') else 'commune-actuelle');parent=prop.get('commune')
  if (code,unit_type,country.normalized(prop['nom'])) not in registry_keys:continue
  is_delegated=unit_type in ('commune-deleguee','commune-associee')
  if is_delegated:
   if (code,country.normalized(prop['nom'])) in current_names:continue
   if len(parents[code])!=1:continue
   parent=next(iter(parents[code]))
  try:g=official_polygon(feature['geometry'])
  except ValueError:
   invalid.append({'code':code,'name':prop['nom'],'department':prop['departement'],'reason':'source_generalization_has_no_valid_polygon'});continue
  identity='FR:INSEE:2026:'+('delegated:' if is_delegated else '')+code
  item={'id':identity,'name':prop['nom'],'department':prop['departement'],'geom':g,'kind':'delegated_municipality' if is_delegated else 'municipal_district' if parent else 'municipality','source_metadata':{'authority':'IGN ADMIN EXPRESS / DINUM 2026','parent_admin_id':'FR:INSEE:2026:'+parent if parent else None,'association':'Exact INSEE code, official department and normalized name; coordinate conflicts retained explicitly','sourcePublishedGeneralizationMetres':100,'crs':'EPSG:4326'}}
  if identity in names:raise ValueError('duplicate_official_municipal_code')
  names[identity]=prop['nom'];lookup[(prop['departement'],country.normalized(prop['nom']))].append(item)
 for city in json.loads(Path(a.inventory).read_text())['cities']:
  if city['countryCode']!='FR':continue
  matches,coordinate_conflict=resolve(city,lookup,a.repair_registry_coordinates);row={**city,'association_status':'name_department_or_anchor_not_confirmed','coverage_status':'location_pending','next_action':'review_official_country_crosswalk'}
  if len(matches)==1:
   m=matches[0];g=m['geom']
   if shapely.get_num_coordinates(g)<=50000 and len(json.dumps(mapping(g)).encode())<=2*1024*1024:
    row.update(admin_id=m['id'],association_status='official_unique_name_department_registry_coordinate_conflict' if coordinate_conflict else 'official_department_name_and_anchor',coverage_status='partial',next_action='collect_supported_segments_until_50_or_document_source_limits');used[m['id']]={**m,'state_code':city['stateCode']}
   else:row['association_status']='boundary_exceeds_runtime_budget'
  elif len(matches)>1:row['association_status']='ambiguous_boundary'
  mapped.append(row);statuses[row['association_status']]+=1
 with (root/'mapped-inventory.ndjson').open('w') as out:
  for row in mapped:out.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 license={'id':'Etalab-2.0','url':'https://www.etalab.gouv.fr/licence-ouverte-open-licence/','attribution':'IGN ADMIN EXPRESS 2026; INSEE Code Officiel Géographique 2026; DINUM / Etalab; published100m generalization. No endorsement.','source':receipt['url'],'originalMunicipalCodesPreserved':True}
 with (root/'admin-areas.ndjson').open('w') as out:
  for m in sorted(used.values(),key=lambda r:r['id']):
   g=m['geom'];geometry=mapping(g);w,s,e,n=g.bounds;key=hashlib.sha256((m['id']+json.dumps(geometry,separators=(',',':'))).encode()).hexdigest()
   out.write(json.dumps({**{k:v for k,v in m.items() if k not in ('geom','department')},'country_code':'FR','source':'IGN ADMIN EXPRESS / DINUM','vintage':'2026','geometry':geometry,'bounds':[s,n,w,e],'area_key':key,'license':license},ensure_ascii=False,separators=(',',':'))+'\n')
 result={'country':'FR','inventoryCities':len(mapped),'mappedEntries':sum(bool(r.get('admin_id')) for r in mapped),'distinctOfficialAreas':len(used),'counts':dict(statuses),'sourceFeatures':len(data['features']),'elapsedMs':round((time.monotonic()-start)*1000),'unreviewedCOMExcluded':True,'license':license}
 (root/'boundary-source-errors.json').write_text(json.dumps(invalid,ensure_ascii=False,indent=2));result['sourceGeometryErrors']=len(invalid)
 (root/'boundary-match-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':main()
