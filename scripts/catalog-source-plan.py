"""Enumerate every Places partition intersecting each selected country.
Planning uses the complete polygon, not only latitude or a capital's point.
Cached partitions are listed for reuse; this command downloads no businesses.
"""
import argparse,json
from pathlib import Path
import shapely
from shapely.geometry import shape,box

def required_parts(geometry,items):
 return [item for item in items if geometry.intersects(box(*item['bbox']))]

def main():
 p=argparse.ArgumentParser();p.add_argument('--countries',required=True);p.add_argument('--stac',required=True);p.add_argument('--country',action='append',required=True);p.add_argument('--root',required=True);a=p.parse_args();root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
 features=json.loads(Path(a.countries).read_text())['features'];items=json.loads(Path(a.stac).read_text());cache={}
 for metadata in Path('.artifacts').rglob('source-asset.json'):
  try:
   data=json.loads(metadata.read_text());url=data['assets']['aws']['href'];source=metadata.parent/'regional-source.parquet';receipt=metadata.parent/'download-report.json'
   if source.is_file() and receipt.is_file():
    r=json.loads(receipt.read_text())
    if r['url']==url and source.stat().st_size==r['bytes']:cache[url]=str(metadata.parent)
  except (KeyError,ValueError,OSError):continue
 results=[]
 for cc in a.country:
  polygons=[shape(f['geometry']) for f in features if (f['properties'].get('ISO_A2_EH') or f['properties'].get('ISO_A2'))==cc]
  if not polygons:results.append({'country':cc,'outcome':'country_boundary_requires_review'});continue
  geometry=shapely.union_all(polygons);matches=required_parts(geometry,items)
  parts=[{'id':v['id'],'bbox':v['bbox'],'url':v['assets']['aws']['href'],'bytes':v['assets']['aws']['file:size'],'cache':cache.get(v['assets']['aws']['href']),'verifyCachedSha256BeforeUse':True} for v in matches]
  results.append({'country':cc,'parts':parts,'completePartitionResponseDoesNotMeanCompleteBusinessCoverage':True})
 (root/'country-source-plan.json').write_text(json.dumps(results,indent=2));print(json.dumps([{'country':v['country'],'parts':[p['id'] for p in v.get('parts',[])],'uncached':[p['id'] for p in v.get('parts',[]) if not p['cache']]} for v in results]),flush=True)
if __name__=='__main__':main()
