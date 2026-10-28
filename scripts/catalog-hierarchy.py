"""Conservative registry-subdivision identity and published ancestry proofs.
Names/types identify an administrative unit within a country; only its exact
published division ID can then authorize a city's selected subdivision.
"""
import hashlib,importlib.util,json,re
from pathlib import Path
import duckdb

spec=importlib.util.spec_from_file_location('hierarchy_country',Path(__file__).with_name('catalog-country.py'));base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
ADMIN_TYPES={'country','dependency','macroregion','region','macrocounty','county','localadmin'}
SOURCE_LICENSES={'openstreetmap':{'ODbL-1.0'},'geoboundaries':{'CC-BY-4.0','CC-BY-3.0','CC-BY-3.0-IGO'},'esri community maps':{'CC-BY-4.0'}}
GB_COUNTY_TYPES={'council area','district','london borough','metropolitan district','unitary authority','two tier county','city'}

def licensed(node):
 sources=node.get('sources') or []
 return bool(sources) and all(s.get('license') in SOURCE_LICENSES.get(str(s.get('dataset','')).lower(),set()) for s in sources)

def labels(node):
 data=node.get('names') or {};result={base.normalized(v) for v in [data.get('primary'),*(data.get('common') or {}).values()] if isinstance(v,str) and v.strip()}
 for rule in data.get('rules') or []:
  # Historical/conditional alternate names cannot identify a current state.
  if rule.get('variant') in ('common','short') and not rule.get('between') and not rule.get('perspectives') and not rule.get('side') and isinstance(rule.get('value'),str):result.add(base.normalized(rule['value']))
 return result

def gb_administrative_labels(values):
 result=set(values)
 for name in values:
  for prefix in ('city of ','county of ','county '):
   if name.startswith(prefix):result.add(name[len(prefix):])
  for suffix in (' city',' county'):
   if name.endswith(suffix):result.add(name[:-len(suffix)])
 return result

def registry_state_labels(state):
 result={base.normalized(state['name'])}
 if state['countryCode']=='GB' and base.normalized(state.get('type')) in GB_COUNTY_TYPES:result=gb_administrative_labels(result)
 return result

def state_labels(state,node):
 result=labels(node);kind=base.normalized(state.get('type'))
 if state['countryCode']=='GB' and node.get('subtype')=='county' and kind in GB_COUNTY_TYPES:
  # Source council areas can publish the formal "Aberdeen City" while the
  # pinned ISO registry displays "Aberdeen". The type/country remain mandatory.
  result=gb_administrative_labels(result)
 return result

def compatible(state,node):
 kind=base.normalized(state.get('type'));subtype=node.get('subtype')
 if subtype not in ADMIN_TYPES-{'country','dependency'}:return False
 if state['countryCode']=='GB' and kind in GB_COUNTY_TYPES:return subtype=='county'
 if state['countryCode']=='FR' and kind in ('metropolitan department','overseas department'):return subtype=='county'
 if state['countryCode']=='IT' and kind in ('province','metropolitan city','free municipal consortium'):return subtype=='county'
 return kind in {base.normalized(v) for v in (node.get('local_type') or {}).values() if isinstance(v,str)}

def resolve_state(state,nodes,country_nodes=None):
 candidates=[n for n in nodes if n.get('country')==state['countryCode'] and registry_state_labels(state).intersection(state_labels(state,n))]
 exact=[n for n in candidates if n.get('subtype') in ('region','macroregion') and n.get('region')==state.get('iso')]
 selected=exact if exact else [n for n in candidates if compatible(state,n)]
 if len(selected)!=1:return None,'subdivision_not_unique' if selected else 'subdivision_not_found'
 node=selected[0]
 if not licensed(node):return None,'subdivision_source_requires_review'
 country_nodes=nodes if country_nodes is None else country_nodes
 roots=[n['id'] for n in country_nodes if n.get('country')==state['countryCode'] and n.get('subtype')=='country' and licensed(n)];dependencies=[n['id'] for n in country_nodes if n.get('country')==state['countryCode'] and n.get('subtype')=='dependency' and licensed(n)]
 return {'stateCode':state['stateCode'],'registryId':state.get('id'),'registryName':state['name'],'registryType':state.get('type'),'registryISO':state.get('iso'),'divisionId':node['id'],'divisionName':node['names']['primary'],'divisionSubtype':node['subtype'],'divisionLocalType':node.get('local_type'),'method':'published_region_iso_and_name' if exact else 'published_subdivision_name_and_type','sources':node['sources'],'countryDivisionIds':roots,'dependencyDivisionIds':dependencies},None

def ancestry_proof(area,node,state,proof):
 if not node or not licensed(node) or area['country']!=state['countryCode'] or node.get('country')!=area['country'] or node.get('id')!=area['division_id'] or node.get('subtype')!=area['subtype'] or node.get('region')!=area.get('region'):return None
 chains=node.get('hierarchies') or []
 if not chains:return None
 paths=[]
 for i,chain in enumerate(chains):
  if not chain or chain[-1].get('division_id')!=node['id'] or chain[-1].get('subtype')!=node['subtype'] or chain[0].get('subtype')!='country':return None
  if i==0 and len(chain)>1 and node.get('parent_division_id')!=chain[-2].get('division_id'):return None
  ids=[v.get('division_id') for v in chain]
  if len(set(ids))!=len(ids) or proof['divisionId'] not in ids[:-1]:return None
  if ids[0] not in proof['countryDivisionIds'] and not set(ids[:-1]).intersection(proof['dependencyDivisionIds']):return None
  paths.append(ids)
 return {**proof,'cityDivisionId':node['id'],'sourceRegionISO':area.get('region'),'hierarchyPaths':paths,'citySources':node['sources'],'country':area['country']}

class HierarchyIndex:
 def __init__(self,path,country,registry,wanted):
  self.path=Path(path);report=json.loads(self.path.with_name(self.path.stem+'-report.json').read_text());self.country=country
  with self.path.open('rb') as file:sha=hashlib.file_digest(file,'sha256').hexdigest()
  source=report.get('transport',{}).get('source','')
  if report.get('country')!=country or report.get('release')!='2026-10-21.0' or report.get('license')!='ODbL-1.0' or report.get('completeCountryHierarchyExtract') is not True or report.get('geometryRead') is not False or self.path.stat().st_size!=report.get('bytes') or sha!=report.get('sha256') or not re.fullmatch(r'https://overturemaps-us-west-2\.s3\.us-west-2\.amazonaws\.com/release/2026-10-21\.0/theme=divisions/type=division/part-00000-[a-f0-9-]+\.zstd\.parquet',source):raise ValueError('hierarchy_extract_integrity')
  data=json.loads(Path(registry).read_text())
  if data.get('dataset')!='@countrystatecity/countries@1.0.9' or data.get('license')!='ODbL-1.0':raise ValueError('registry_version_requires_review')
  self.states={s['stateCode']:s for s in data['states'] if s['countryCode']==country and s['stateCode'] in wanted};self.proofs={};self.failures={};self.own={}
  db=duckdb.connect(config={'memory_limit':'256MB','threads':'1'});columns=['id','country','region','names','subtype','local_type','sources'];rows=db.execute('SELECT '+','.join(columns)+' FROM read_parquet(?) WHERE subtype=ANY(?)',[str(self.path),sorted(ADMIN_TYPES)]).fetchall()
  if len(rows)>100000:raise ValueError('hierarchy_state_index_budget')
  nodes=[dict(zip(columns,row)) for row in rows];db.close();by_name={};country_nodes=[n for n in nodes if n['subtype'] in ('country','dependency')]
  for node in nodes:
   possible=labels(node)
   if country=='GB' and node['subtype']=='county':possible=gb_administrative_labels(possible)
   for name in possible:by_name.setdefault(name,[]).append(node)
  for code,state in self.states.items():
   candidates={n['id']:n for name in registry_state_labels(state) for n in by_name.get(name,[])}
   proof,error=resolve_state(state,list(candidates.values()),country_nodes)
   if proof:self.proofs[code]=proof
   else:self.failures[code]=error
  self.identity={'file':str(self.path),'sha256':sha,'release':report['release'],'license':'ODbL-1.0','source':source,'statesVerified':len(self.proofs),'statesPending':self.failures}

 def preload(self,identities):
  identities=sorted(set(identities))
  if len(identities)>100000:raise ValueError('hierarchy_city_index_budget')
  db=duckdb.connect(config={'memory_limit':'256MB','threads':'1'});columns=['id','country','region','subtype','parent_division_id','hierarchies','sources'];cursor=db.execute('SELECT '+','.join(columns)+' FROM read_parquet(?) WHERE id=ANY(?)',[str(self.path),identities])
  while True:
   rows=cursor.fetchmany(1000)
   if not rows:break
   for row in rows:
    node=dict(zip(columns,row));self.own[node['id']]=node
  db.close()

 def for_area(self,area):
  node=self.own.get(area['division_id']);result={}
  if node is None:return result
  for code,proof in self.proofs.items():
   verified=ancestry_proof(area,node,self.states[code],proof)
   if verified:result[code]=verified
  return result
