"""Match app locations to official US/CA areas using name, state AND anchor.
No Nominatim, radii, invented city assignments or company downloads.
"""
import argparse,hashlib,json,math,re,time,unicodedata
from collections import defaultdict,Counter
from pathlib import Path
import shapefile,shapely
from shapely.geometry import shape,mapping
from pyproj import Transformer

def normal(s):
 s=''.join(c for c in unicodedata.normalize('NFKD',s or '') if not unicodedata.category(c).startswith('M')).lower()
 return ' '.join(''.join(c if c.isalnum() else ' ' for c in s).split())
def aliases(name):
 value=normal(name);values={value}
 for prefix in ['city of ','town of ','village of ','municipality of ']:
  if value.startswith(prefix):values.add(value[len(prefix):])
 for suffix in [' city',' town',' village',' cdp']:
  if value.endswith(suffix):values.add(value[:-len(suffix)])
 return values|{re.sub(r'\bst\b','saint',v) for v in values}|{re.sub(r'\bste\b','sainte',v) for v in values}
def polygons(g):
 if not g.is_valid:g=shapely.make_valid(g)
 if g.geom_type=='Polygon':return shapely.MultiPolygon([g])
 if g.geom_type=='MultiPolygon':return g
 if g.geom_type=='GeometryCollection':return shapely.union_all([p for p in g.geoms if p.geom_type in ('Polygon','MultiPolygon')])
 return None
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--root',default='.artifacts/coverage-20261023');args=parser.parse_args();root=Path(args.root);start=time.monotonic()
 inventory=json.loads((root/'inventory.json').read_text());areas=[];lookup=defaultdict(list);stats=Counter();matched=[];used={}
 provinces={'10':'NL','11':'PE','12':'NS','13':'NB','24':'QC','35':'ON','46':'MB','47':'SK','48':'AB','59':'BC','60':'YT','61':'NT','62':'NU'}
 for country,folder in [('US','us-places'),('CA','ca-csd')]:
  file=next((root/folder).glob('*.shp'));encoding='utf-8'
  try:shapefile.Reader(str(file),encoding=encoding).records()
  except UnicodeDecodeError:encoding='latin-1'
  reader=shapefile.Reader(str(file),encoding=encoding);wkt=file.with_suffix('.prj').read_text();transformer=Transformer.from_crs(wkt,'EPSG:4326',always_xy=True)
  for record in reader.iterShapeRecords():
   row=record.record.as_dict();name=row['NAME'] if country=='US' else row['CSDNAME'];state=row['STUSPS'] if country=='US' else provinces[row['PRUID']];identity=row['GEOID'] if country=='US' else row['CSDUID'];vintage='2024' if country=='US' else '2021'
   g=polygons(shape(record.shape.__geo_interface__))
   if g is None:continue
   g=polygons(shapely.transform(g,transformer.transform,interleaved=False));shapely.prepare(g)
   if g is None or g.is_empty:continue
   area={'id':f'{country}:{vintage}:{identity}','country_code':country,'state_code':state,'name':name,'kind':row['NAMELSAD'] if country=='US' else row['CSDTYPE'],'source':'US Census Bureau' if country=='US' else 'Statistics Canada','vintage':vintage,'license':{'id':'US-Census-acknowledgement' if country=='US' else 'Statistics-Canada-Open-Licence','attribution':'U.S. Census Bureau, 2024 cartographic boundary files' if country=='US' else 'Statistics Canada, 2021 Census cartographic boundary files','sourceScale':'1:500000' if country=='US' else 'cartographic, census subdivision'},'geom':g}
   areas.append(area);index=len(areas)-1
   for key in aliases(name):lookup[(country,state,key)].append(index)
  stats[country+'_official_areas']=len(reader)
 for row in inventory['cities']:
  country=row['countryCode'];state=row['stateCode'];result={**row,'association_status':'not_processed_country','coverage_status':'location_pending','next_action':'obtain_official_country_boundaries'}
  if country in ('US','CA'):
   candidates={i for key in aliases(row['name']) for i in lookup[(country,state,key)]};lat=row.get('latitude');lon=row.get('longitude');hits=[]
   if isinstance(lat,(int,float)) and isinstance(lon,(int,float)) and math.isfinite(lat) and math.isfinite(lon):hits=[i for i in candidates if shapely.intersects_xy(areas[i]['geom'],lon,lat)]
   if len(hits)==1:
    a=areas[hits[0]];g=a['geom'];vertices=shapely.get_num_coordinates(g)
    if vertices>50000 or len(json.dumps(mapping(g),separators=(',',':')).encode())>2*1024*1024:
     result.update(association_status='boundary_exceeds_runtime_budget',next_action='review_high_resolution_area_budget')
    else:
     identity=a['id'];result.update(admin_id=identity,association_status='name_state_and_anchor_inside_official_area',coverage_status='partial',next_action='reuse_catalog_then_collect_gaps');used[identity]=a
   else:result.update(association_status='ambiguous_boundary' if len(hits)>1 else 'name_or_anchor_not_confirmed',next_action='review_official_location_crosswalk')
  matched.append(result);stats[result['association_status']]+=1
 with (root/'mapped-inventory.ndjson').open('w') as out:
  for row in matched:out.write(json.dumps(row,ensure_ascii=False)+'\n')
 wkb_bytes=0
 with (root/'admin-areas.ndjson').open('w') as out:
  for identity,a in sorted(used.items()):
   g=a['geom'];geometry=mapping(g);w,s,e,n=g.bounds;wkb_bytes+=len(g.wkb);key=hashlib.sha256((identity+json.dumps(geometry,separators=(',',':'))).encode()).hexdigest()
   out.write(json.dumps({**{k:v for k,v in a.items() if k!='geom'},'geometry':geometry,'bounds':[s,n,w,e],'area_key':key,'source_metadata':{'association':'Exact country/state/name alias plus app anchor inside official polygon','crs':'EPSG:4326','vintageWarning':'Cartographic boundaries; not a current cadastral survey'}},ensure_ascii=False,separators=(',',':'))+'\n')
 report={'inventoryCities':len(matched),'mappedEntries':sum(bool(r.get('admin_id')) for r in matched),'distinctOfficialAreas':len(used),'wkbBytes':wkb_bytes,'counts':dict(stats),'elapsedMs':round((time.monotonic()-start)*1000)};(root/'boundary-match-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()
