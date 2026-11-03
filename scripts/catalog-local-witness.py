"""Predict exact archive source IDs with the application's real Parquet reader.
Uses only hash-verified local public assets; never downloads or modifies data.
Compare its sourceIdentitySha256 with catalog-smoke.py on isolated staging.
"""
import argparse,hashlib,importlib.util,json
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--city-id',required=True,type=int);p.add_argument('--asset-root',action='append',required=True);p.add_argument('--niches',required=True);a=p.parse_args();root=Path(a.root)
 cities=[json.loads(line) for line in (root/'mapped-inventory.ndjson').open()];selected=[r for r in cities if r['id']==a.city_id and r.get('admin_id')]
 if len(selected)!=1:raise ValueError('unique_reviewed_city_required')
 city=selected[0];areas=[json.loads(line) for line in (root/'admin-areas.ndjson').open()];area=next(r for r in areas if r['id']==city['admin_id']);files=[];identities=[]
 for folder in map(Path,a.asset_root):
  asset=json.loads((folder/'published-asset.json').read_text());file=Path(asset['file'])
  if file.stat().st_size!=asset['bytes'] or hashlib.file_digest(file.open('rb'),'sha256').hexdigest()!=asset['sha256']:raise ValueError('local_published_asset_integrity')
  files.append(str(file));identities.append({k:asset[k] for k in ('id','sha256','records')})
 spec=importlib.util.spec_from_file_location('real_archive_reader',Path(__file__).with_name('catalog-read.py'));reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader);union=set();counts={}
 for niche,categories in json.loads(Path(a.niches).read_text()).items():
  result=reader.query({'countryCode':city['countryCode'],'geometry':area['geometry'],'bounds':area['bounds'],'categories':categories,'limit':3000},files)
  if result['truncated']:raise ValueError('witness_city_requires_full_pagination')
  ids={'overture/'+row['source_id'] for row in result['rows']};counts[niche]=len(ids);union.update(ids)
 report={'country':city['countryCode'],'state':city['stateCode'],'cityId':a.city_id,'city':city['name'],'unique':len(union),'byNiche':counts,'sourceIdentitySha256':hashlib.sha256(json.dumps(sorted(union),separators=(',',':')).encode()).hexdigest(),'sourceIds':sorted(union),'assets':identities,'areaKey':area['area_key'],'newNetworkBytes':0,'license':'ODbL-1.0 and original per-record Overture licenses','attribution':'© OpenStreetMap contributors; Overture Maps Foundation; per-feature provenance retained','contactsVerified':False}
 (root/'local-city-witness.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('sourceIds','byNiche')}))

if __name__=='__main__':main()
