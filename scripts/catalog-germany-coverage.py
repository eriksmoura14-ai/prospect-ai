"""Strict DE coverage: verified municipal AGS, state/name and anchor evidence.
Existing cartographic locality scopes remain immutable but cannot establish a
municipal coverage claim when they include neighbouring municipalities.
"""
import argparse,collections,csv,json,sqlite3,time
from pathlib import Path
import numpy as np
import shapely
from shapely.geometry import shape

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);a=ap.parse_args();root=Path(a.root);started=time.monotonic()
 inv=json.loads((root/'inventory.json').read_text());areas=json.loads((root/'audited-municipal-areas.json').read_text());keys=[x['city_key'] for x in areas];assert len(set(keys))==len(keys)
 geoms=np.array([shape(x['geometry']) for x in areas],dtype=object);shapely.prepare(geoms);tree=shapely.STRtree(geoms);counts=collections.defaultdict(collections.Counter);sources=collections.defaultdict(collections.Counter);categories=collections.defaultdict(set)
 db=sqlite3.connect('file:'+str(root/'reconcile.sqlite')+'?mode=ro',uri=True);cur=db.execute('SELECT payload,baseline FROM businesses ORDER BY root');metrics=collections.Counter()
 while batch:=cur.fetchmany(2000):
  rows=[json.loads(p) for p,b in batch];points=shapely.points([r['longitude'] for r in rows],[r['latitude'] for r in rows]);pairs=tree.query(points);mask=shapely.intersects(geoms[pairs[1]],points[pairs[0]]);pairs=pairs[:,mask];assigned=set(int(i) for i in pairs[0])
  for i,j in zip(*pairs):
   row=rows[i];key=keys[j];v=counts[key];v['baseline']+=batch[i][1];v['new']+=not batch[i][1];v['all']+=1
   for field in ('phone','website','address'):v[field]+=bool(row.get(field))
   sources[key][row['source']]+=1;categories[key].add(row['category'])
  for i,(_,base) in enumerate(batch):
   if not base:metrics['new_assigned_to_verified_municipal_scope' if i in assigned else 'new_municipal_membership_pending']+=1
 old={}
 for item in json.loads((root/'download-map.json').read_text()):
  if item['file'].endswith('.json'):
   for area in json.loads(Path(item['file']).read_text()).get('areas',[]):old[area['city_key']]=area
 bykey={r['city_key']:r for r in areas};thresholds=collections.Counter();before_same=collections.Counter();outputs=[];mismatches=[]
 for city in inv:
  key=city['city_key'];area=bykey.get(key);v=counts[key];ratio=None;different=None
  if area and key in old:
   og=shape(old[key]['geometry']);ng=geoms[keys.index(key)];ratio=og.area/ng.area;different=og.symmetric_difference(ng).area/og.union(ng).area
   if different>.05:mismatches.append({'cityKey':key,'name':city['name'],'legacyAreaToMunicipalArea':round(ratio,6),'symmetricDifferenceOverUnion':round(different,6),'oldScopeRetained':True,'oldScopeUsedForStrictCounts':False})
  for n in (50,100,200):thresholds[str(n)]+=area is not None and v['all']>=n;before_same[str(n)]+=area is not None and v['baseline']>=n
  row={'city_key':key,'name':city['name'],'state_code':city['state_code'],'legacy_reported_count':city['unique_supported'],'baseline_same_verified_municipality':v['baseline'] if area else None,'new_unique_in_municipality':v['new'] if area else None,'total_with_staged_data':v['all'] if area else None,'phone':v['phone'] if area else None,'website':v['website'] if area else None,'address':v['address'] if area else None,'primary_segment_count':len(categories[key]) if area else None,'municipal_AGS':area['source_metadata']['AGS'] if area else None,'boundary_id':area['id'] if area else None,'legacy_to_municipal_area_ratio':round(ratio,6) if ratio is not None else None,'sources':dict(sources[key]),'status':'location_pending' if area is None else 'target_met_staged' if v['all']>=50 else 'sources_consulted_below_target','next_action':'verify_specific_district_or_locality_identity' if area is None else 'review_and_activate_staged_source_and_verified_boundaries' if v['all']>=50 else 'complement_licensed_sources_without_neighbour_filling','source_scope':'countrywide OSM/QLever 2026-11-23; existing Overture 2026-10-21.0 and legacy catalog','contacts_verified':False}
  outputs.append(row)
 (root/'strict-municipal-coverage.json').write_text(json.dumps(outputs,ensure_ascii=False,indent=2))
 with (root/'strict-municipal-coverage.csv').open('w') as out:
  wr=csv.DictWriter(out,fieldnames=list(outputs[0]));wr.writeheader();wr.writerows({**r,'sources':json.dumps(r['sources'])} for r in outputs)
 report={'inventoryDenominator':len(inv),'states':len({c['state_code'] for c in inv}),'municipalScopesConfirmed':len(areas),'localitiesRequiringSpecificScopeReview':len(inv)-len(areas),'thresholdsBaselineSameVerifiedMunicipalScope':dict(before_same),'thresholdsWithNewStagedData':dict(thresholds),'percentageOfFullInventory':{n:round(100*thresholds[str(n)]/len(inv),6) for n in (50,100,200)},'statusCounts':dict(collections.Counter(r['status'] for r in outputs)), 'legacyScopesDifferingOverFivePercent':len(mismatches),'mismatches':mismatches,'newBusinessMunicipalMembership':dict(metrics),'cityCountsAreNonAdditive':True,'businessesVerifiedIndividually':False,'stagedOnly':True,'productionChanged':False,'elapsedSeconds':round(time.monotonic()-started,3),'examples':[r for r in outputs if r['name'] in ('Cochem','Monschau','Berlin','Bernau bei Berlin','Hamburg')]}
 (root/'strict-scope-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('mismatches','examples')},ensure_ascii=False))
if __name__=='__main__':main()
