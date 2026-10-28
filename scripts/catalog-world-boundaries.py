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

def names(value,country_code=None):
 if not isinstance(value,dict):return set()
 labels=[v for v in [value.get('primary'),*(value.get('common') or {}).values()] if isinstance(v,str) and v.strip()]
 if country_code=='SI':
  # Published Slovenian settlement labels use the descriptive suffix
  # "(naselje)" and explicit Slovenian / Italian display variants. Preserve
  # the original name and accept only those literal variants, never fuzzy names.
  for label in list(labels):
   trimmed=label.removesuffix(' (naselje)')
   if trimmed!=label:labels.append(trimmed)
   if ' / ' in trimmed:labels.extend(v.strip() for v in trimmed.split(' / ') if v.strip())
 return {country.normalized(v) for v in labels}

def candidates(city,lookup):
 if not isinstance(city.get('latitude'),(int,float)) or not isinstance(city.get('longitude'),(int,float)):return []
 point=shapely.Point(city['longitude'],city['latitude'])
 # ISO 3166-2 must identify the selected app subdivision, not an enclosing
 # macroregion. Countries whose registry uses a different level remain pending.
 hits={a.get('id',id(a)):a for name in registry_names(city) for a in lookup.get((city['countryCode']+'-'+city['stateCode'],name),[])}
 return [a for a in hits.values() if a['geom'].covers(point) and scope_matches(city,a)]

def registry_names(city):
 name=country.normalized(city['name']);result={name}
 if city['countryCode'] in ('SK','CZ') and name.startswith('okres '):result.add(name[len('okres '):])
 return result

def scope_matches(city,area):
 # An explicitly selected administrative option is a separate requested scope.
 # A county must never be borrowed for an ordinary town of the same name.
 return area.get('kind')=='county' if requested_county_policy(city) else area.get('kind')!='county'

def requested_county_policy(city):
 name=country.normalized(city['name'])
 if city['countryCode'] in ('SK','CZ') and name.startswith('okres '):return 'explicit_registry_okres_district'
 # The Danish registry explicitly lists "Aarhus Kommune" separately from
 # "Aarhus". Overture represents the 98 municipalities as county/admin_level 2;
 # these are not the historical amter abolished in 2007. Only the explicit
 # Kommune option can use that reviewed source class.
 if city['countryCode']=='DK' and name.endswith(' kommune'):return 'explicit_registry_danish_municipality'
 return None

def contained_named_locality(city,hits):
 # Overture defines locality as a populated place and localadmin as an
 # administrative unit containing populated places. A unique named locality
 # wholly inside all matching localadmins resolves that scope distinction.
 # Never choose between competing localities or expand to an enclosing admin.
 if requested_county_policy(city) or len(hits)<2:return None
 localities=[a for a in hits if a['kind']=='locality'];admins=[a for a in hits if a['kind']=='localadmin']
 if len(localities)!=1 or len(admins)!=len(hits)-1:return None
 selected=localities[0]
 return selected if all(a['geom'].covers(selected['geom']) for a in admins) else None

def preserve_mapping(previous,old_areas,hits):
 """A reviewed published identity wins over newly introduced ambiguity only
 while that exact source polygon and all original location constraints agree.
 """
 identity=previous.get('admin_id')
 if not identity:return None
 old=old_areas.get(identity);matches=[a for a in hits if a['id']==identity]
 if old is None or len(matches)!=1:raise ValueError('published_mapping_not_reproduced')
 area=matches[0]
 if area['country_code']!=old['country_code'] or area['state_code']!=old['state_code'] or not area['geom'].equals(country.polygon(old['geometry'])):raise ValueError('published_polygon_identity_changed')
 return area

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--inventory',required=True);p.add_argument('--coverage-audit',required=True);p.add_argument('--country',required=True);p.add_argument('--region',action='append',required=True);p.add_argument('--merge-existing');p.add_argument('--hierarchy');p.add_argument('--state-registry');a=p.parse_args();start=time.monotonic();root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
 if not re.fullmatch('[A-Z]{2}',a.country):raise ValueError('country_identity')
 inventory=[v for v in json.loads(Path(a.inventory).read_text())['cities'] if v['countryCode']==a.country]
 with Path(a.coverage_audit).open() as file:prior=[v for v in csv.DictReader(file) if v['country_code']==a.country]
 if {v['city_key'] for v in prior}!={v['key'] for v in inventory}:raise ValueError('coverage_inventory_mismatch')
 previous={};old_areas={}
 if a.merge_existing:
  previous_root=Path(a.merge_existing)
  with (previous_root/'mapped-inventory.ndjson').open() as file:previous={v['key']:v for v in map(json.loads,file)}
  with (previous_root/'admin-areas.ndjson').open() as file:old_areas={v['id']:v for v in map(json.loads,file)}
  if previous.keys()!={v['key'] for v in inventory} or any(v['countryCode']!=a.country for v in previous.values()) or any(v['country_code']!=a.country for v in old_areas.values()):raise ValueError('existing_country_identity_mismatch')
  if any(v['coverage_status']!='location_pending' and not previous[v['city_key']].get('admin_id') for v in prior):raise ValueError('existing_confirmed_mapping_missing')
 elif any(v['coverage_status']!='location_pending' for v in prior):raise ValueError('existing_country_crosswalk_must_be_merged_explicitly')
 if bool(a.hierarchy)!=bool(a.state_registry):raise ValueError('hierarchy_and_registry_required_together')
 wanted={a.country+'-'+v['stateCode'] for v in inventory};lookup=collections.defaultdict(list);seen={};bad=[];source_files=[];hierarchy=None;source_names={}
 if a.hierarchy:
  spec=importlib.util.spec_from_file_location('published_hierarchy',Path(__file__).with_name('catalog-hierarchy.py'));hm=importlib.util.module_from_spec(spec);spec.loader.exec_module(hm);hierarchy=hm.HierarchyIndex(a.hierarchy,a.country,a.state_registry,{v['stateCode'] for v in inventory})
 district_entries=[v for v in inventory if requested_county_policy(v)]
 db=duckdb.connect(config={'memory_limit':'256MB','threads':'1'});columns=['id','division_id','names','country','region','subtype','class','is_territorial','sources','geometry','admin_level']
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
    if row['country']!=a.country or not hierarchy and row['region'] not in wanted or row['subtype'] not in ('locality','localadmin','county') or row['is_territorial'] is not True:continue
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
    source_state=row['region'].split('-',1)[1] if isinstance(row['region'],str) and row['region'].startswith(a.country+'-') else None
    primary=row['names']['primary'];area={'id':identity,'country_code':a.country,'state_code':source_state,'name':primary,'kind':row['subtype'],'source':'Overture divisions / OpenStreetMap / geoBoundaries','vintage':'2026-10-21.0','geom':g,'license':{'id':'ODbL-1.0','url':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors; Overture Maps Foundation; geoBoundaries contributors as recorded per feature','shareAlike':True,'source':'https://docs.overturemaps.org/guides/divisions/'},'source_metadata':{'source_area_id':row['id'],'division_id':row['division_id'],'subtype':row['subtype'],'regionISO':row['region'],'territorial':True,'sources':sources,'association':'Exact published country, ISO subdivision, normalized primary/common name, and app anchor inside territorial polygon','notACurrentCadastralSurvey':True}}
    if row['subtype']=='county':
     matching=[v for v in district_entries if registry_names(v).intersection(names(row['names']))];district_labels=sorted(country.normalized(v['name']) for v in matching)
     if not district_labels:continue
     policy=requested_county_policy(matching[0]);area['source_metadata']['scope_policy']=policy
     if policy=='explicit_registry_danish_municipality':
      if row['admin_level']!=2 or not country.normalized(primary).endswith(' kommune'):continue
      area['source_metadata'].update(verified_municipality_labels=district_labels,admin_level=2,hierarchyAuthority='https://www.dst.dk/en/Statistik/dokumentation/nomenklaturer/nuts',authorityDescription='98 municipalities within five regions; source geometry remains OSM, not Statistics Denmark')
     else:area['source_metadata']['verified_district_labels']=district_labels
    seen[identity]=area
    if a.country=='SI':area['source_metadata']['published_name_aliases']=sorted(names(row['names'],a.country))
    source_names[identity]=names(row['names'],a.country)
    for name in source_names[identity]:lookup[(row['region'],name)].append(area)
 if hierarchy:
  wanted_names=set().union(*(registry_names(city) for city in inventory));eligible=[area for key,area in seen.items() if wanted_names.intersection(source_names[key])];hierarchy.preload([v['source_metadata']['division_id'] for v in eligible])
  for area in eligible:
   meta=area['source_metadata'];proofs=hierarchy.for_area({'country':area['country_code'],'division_id':meta['division_id'],'subtype':area['kind'],'region':meta['regionISO']})
   if not proofs:continue
   meta['subdivision_hierarchy_proofs']=proofs;meta['association']='Published subdivision identity and consistent ancestry, exact normalized locality name, and app anchor inside territorial polygon';area['license']['attribution']+='; Esri Community Maps contributors where recorded in hierarchy provenance (CC BY 4.0)'
   for code in proofs:
    for name in source_names[area['id']]:lookup[(a.country+'-'+code,name)].append(area)
 db.close();used={};counts=collections.Counter();mapped=[]
 for city in inventory:
  row={**city,'association_status':'name_state_or_anchor_not_confirmed','coverage_status':'location_pending','next_action':'review_official_country_crosswalk'};hits=candidates(city,lookup)
  preserved=preserve_mapping(previous[city['key']],old_areas,hits) if city['key'] in previous else None
  if preserved:
   hits=[preserved];counts['previousConfirmedMappingsPreserved']+=1
  elif len(hits)>1:
   selected=contained_named_locality(city,hits)
   if selected:
    meta=selected['source_metadata'];alternatives={v['id']:v for v in meta.get('containing_homonymous_localadmins',[])}
    for other in hits:
     if other is selected:continue
     alternatives[other['id']]={'id':other['id'],'divisionId':other['source_metadata']['division_id'],'name':other['name'],'subtype':other['kind'],'relation':'fully_contains_selected_named_locality'}
    meta.update(scope_resolution='unique_named_locality_fully_contained_by_matching_localadmins',scope_definition='https://docs.overturemaps.org/schema/reference/divisions/types/division_subtype/',containing_homonymous_localadmins=sorted(alternatives.values(),key=lambda v:v['id']))
    row['scope_resolution']=meta['scope_resolution'];hits=[selected];counts['containedLocalityScopesResolved']+=1
  if len(hits)==1:
   row.update(admin_id=hits[0]['id'],association_status='source_iso_name_and_anchor_inside_territorial_polygon',coverage_status='partial',next_action='collect_supported_segments_until_50_or_document_source_limits');used[hits[0]['id']]=hits[0]
   if city['stateCode'] in hits[0]['source_metadata'].get('subdivision_hierarchy_proofs',{}):row['association_status']='published_subdivision_hierarchy_name_and_anchor_inside_territorial_polygon'
  elif len(hits)>1:row['association_status']='ambiguous_boundary'
  mapped.append(row);counts[row['association_status']]+=1
 with (root/'mapped-inventory.ndjson').open('w') as out:
  for row in mapped:out.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
 with (root/'admin-areas.ndjson').open('w') as out:
  for area in sorted(used.values(),key=lambda v:v['id']):
   g=area['geom'];geometry=mapping(g);w,s,e,n=g.bounds;key=hashlib.sha256((area['id']+json.dumps(geometry,separators=(',',':'))).encode()).hexdigest()
   out.write(json.dumps({**{k:v for k,v in area.items() if k!='geom'},'geometry':geometry,'bounds':[s,n,w,e],'area_key':key},ensure_ascii=False,separators=(',',':'))+'\n')
 result={'country':a.country,'inventoryCities':len(inventory),'mappedEntries':sum(bool(v.get('admin_id')) for v in mapped),'distinctSourceAreas':len(used),'counts':dict(counts),'sourceFiles':source_files,'sourcePolygonsAcceptedByRules':len(seen),'sourceFailures':bad,'elapsedMs':round((time.monotonic()-start)*1000),'licenseReviewed':True,'sourcesExhausted':False}
 if hierarchy:result['publishedHierarchy']=hierarchy.identity
 (root/'boundary-match-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('sourceFiles','sourceFailures')}),flush=True)
if __name__=='__main__':main()
