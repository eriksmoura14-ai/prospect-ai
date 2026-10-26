"""Reproducible public expansion evidence. Explicit whitelist, no env/glob dump.
Original archive objects remain in their original immutable publications.
"""
import hashlib,json,zipfile
from pathlib import Path
def main():
 root=Path('.artifacts/catalog-audit-20261026');files=[]
 def add(path,archive):
  p=Path(path)
  if not p.is_file():return
  if any(s.startswith('.env') or 'signed' in s.lower() or s=='node_modules' for s in p.parts):raise ValueError('private_path_in_package')
  files.append((p,archive))
 for name in ['COBERTURA_GLOBAL_20261026.md','CATALOG_ATTRIBUTIONS.md','CITY_COVERAGE_RUNBOOK.md','GLOBAL_DISCOVERY.md']:add(name,name)
 for name in ['all-city-coverage.csv','all-city-coverage.ndjson.gz','global-audit.json','expansion-report.json','legacy-identity-verification.json','runtime-verification.json','csc-ODbL-LICENSE.txt']:add(root/name,'audit/'+name)
 for name in ['inventory.json','inventory-summary.json','coverage-report.json','overlap-aliases.ndjson.gz','legacy-snapshot.json']:add(Path('.artifacts/coverage-20261023')/name,'prior/'+name)
 roots=[('BR','.artifacts/city-coverage-50-20261023'),('MX','.artifacts/city-coverage-50-20261023/mexico'),('CO','.artifacts/city-coverage-50-20261023/colombia'),('GT','.artifacts/city-coverage-50-20261023/guatemala'),('ES','.artifacts/city-coverage-europe-20261026')]
 for cc,folder in roots:
  p=Path(folder)
  for name in ['new-country-businesses.parquet','country-report.json','boundary-match-report.json','mapped-inventory.ndjson','admin-areas.ndjson','coverage-updates.ndjson','coverage-cities.csv','overlap-aliases.ndjson.gz','published-asset.json','geometry-publication.json','geometry-upload-checkpoint.json','live-city-verification.json']:add(p/name,cc+'/'+name)
  # Restricted to public boundary metadata/geometries, never arbitrary root JSON.
  for f in sorted(p.glob('*metadata*.json')):add(f,cc+'/metadata/'+f.name)
  for f in sorted(p.glob('*.geojson')):add(f,cc+'/source-boundaries/'+f.name)
  for f in sorted(p.glob('*.html')):add(f,cc+'/source-terms/'+f.name)
  for f in sorted((p/'geometry').glob('*.json')):add(f,cc+'/geometry/'+f.name)
 for name in ['input-assets.json','input-checkpoint.json','serving-manifest.json','verification.json','activation-receipt.json','upload-checkpoint.json']:add(Path('.artifacts/catalog-serving-20261026')/name,'serving/'+name)
 for name in ['catalog-country.py','catalog-normalize.py','catalog-region.py','catalog-download.py','catalog-coverage.py','catalog-coverage-audit.py','catalog-ops.py','catalog-upload.py','catalog-geometry-upload.py','catalog-serving.py','catalog-serving-upload.py','catalog-serving-publish.py','catalog-smoke.py','catalog-package.py']:add(Path('scripts')/name,'scripts/'+name)
 for name in ['catalog_country_test.py','catalog_serving_test.py','catalog-archive.test.cjs','catalog-geometry.test.cjs']:add(Path('test')/name,'test/'+name)
 add('tools/catalog-requirements.txt','tools/catalog-requirements.txt')
 manifest=[{'path':arc,'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()} for p,arc in files]
 output=root/'city-coverage-expansion-v2.zip'
 with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as archive:
  for p,arc in files:archive.write(p,arc)
  archive.writestr('manifest.json',json.dumps({'files':manifest,'priceBRL':0,'containsAccountCredentials':False,'worldTargetComplete':False},indent=2))
 report={'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'files':len(files),'key':'archives/20261026/city-coverage-expansion-v2.zip'}
 (root/'package-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
if __name__=='__main__':main()
