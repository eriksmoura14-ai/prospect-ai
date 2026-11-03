"""Finite, reproducible public coverage evidence. No directory/env dump."""
import argparse,hashlib,json,zipfile
from pathlib import Path

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();root=Path(a.root);files=[]
 def add(path,arc):
  path=Path(path)
  if not path.is_file():return
  if any(s.startswith('.env') or 'signed' in s.lower() or s=='node_modules' for s in path.parts):raise ValueError('private_path_in_package')
  files.append((path,arc))
 for n in ['COBERTURA_RO_IT_20261026.md','CATALOG_ATTRIBUTIONS.md','CITY_COVERAGE_RUNBOOK.md']:add(n,n)
 for n in ['global-audit.json','all-city-coverage.csv','all-city-coverage.ndjson.gz','round-report.json','csc-ODbL-LICENSE.txt']:add(root/n,'audit/'+n)
 names=['new-country-businesses.parquet','country-report.json','boundary-match-report.json','mapped-inventory.ndjson','admin-areas.ndjson','coverage-updates.ndjson','coverage-cities.csv','overlap-aliases.ndjson.gz','published-asset.json','geometry-publication.json','geometry-upload-checkpoint.json','live-city-verification.json','source-review.json','source-dataset-license.json','ops-asset-report.json','ops-geometry_manifest-report.json','ops-coverage-report.json','ops-queue-report.json']
 for code,folder in [('RO','romania'),('IT','italy')]:
  country=Path('.artifacts/city-coverage-'+folder+'-20261026')
  for n in names:add(country/n,code+'/'+n)
  for f in sorted((country/'geometry').glob('*.json')):add(f,code+'/geometry/'+f.name)
  for f in sorted(country.glob('*metadata.json')):add(f,code+'/metadata/'+f.name)
  for f in sorted(country.glob('*.geojson')):add(f,code+'/source-boundaries/'+f.name)
  for n in ['government-license.html','official-statistical-unit-source.html']:add(country/n,code+'/source-terms/'+n)
 for n in ['reviews.json','review-receipts.json']:add(Path('.artifacts/city-review-policy-20261026')/n,'reviews/'+n)
 for n in ['result.json','query.sparql']:add(Path('.artifacts/official-qlever-20261026')/n,'qlever/'+n)
 for n in ['catalog-review.py','catalog-country.py','catalog-coverage-audit.py','catalog-ops.py','catalog-round-package.py','catalog-smoke.py']:add(Path('scripts')/n,'scripts/'+n)
 for n in ['catalog_review_test.py','catalog_country_test.py','catalog-review-postgres.test.cjs','qlever.test.cjs','global-discovery.test.cjs','catalog-archive.test.cjs']:add(Path('test')/n,'test/'+n)
 for n in ['qlever.cjs','discovery/providers.cjs','tools/catalog-requirements.txt']:add(n,n)
 manifest=[{'path':arc,'bytes':f.stat().st_size,'sha256':hashlib.file_digest(f.open('rb'),'sha256').hexdigest()} for f,arc in files]
 if len({arc for _,arc in files})!=len(files):raise ValueError('duplicate_archive_path')
 output=root/'coverage-ro-it-review-v1.zip';root.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as archive:
  for f,arc in files:archive.write(f,arc)
  archive.writestr('manifest.json',json.dumps({'files':manifest,'priceBRL':0,'containsAccountCredentials':False,'worldTargetComplete':False},indent=2))
 result={'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'files':len(files),'key':'archives/20261026/coverage-ro-it-review-v1.zip'}
 (root/'package-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if __name__=='__main__':main()
