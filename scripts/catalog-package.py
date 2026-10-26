"""Package an explicit allowlist of public catalog data. Never package .env,
credential files, private account data, database working files or raw planet files.
"""
import argparse,hashlib,json,zipfile
from pathlib import Path
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',default='.artifacts/coverage-20261023');p.add_argument('--baseline-root',default='.artifacts/catalog-million-20261023');p.add_argument('--output',default='/workspace/prospect-coverage-20261023.zip');a=p.parse_args();root=Path(a.root);base=Path(a.baseline_root);output=Path(a.output);files=[]
 def add(file):
  file=Path(file)
  if file.is_file():
   assert not file.name.startswith('.env') and file.suffix not in ('.key','.pem','.duckdb');files.append(file)
 for name in ['inventory.json','inventory-summary.json','niches.json','mapped-inventory.ndjson','admin-areas.ndjson','legacy-snapshot.json','baseline-city-labels.csv','baseline-legacy-city-source-counts.csv','all-source-city-labels.csv','city-assignments.csv.gz','overlap-aliases.ndjson.gz','new-canonical-ids.csv','coverage-updates.ndjson','coverage-cities.csv','coverage-report.json','round1-report.json','round2-report.json','round3-report.json','coverage-extra-metrics.json','archive-quality-metrics.json','ops-audit.json','publication-manifest.json','published-assets.json','boundary-match-report.json','complement-sample.json','real-app-smoke.json','full-node-tests.log','final-full-node-tests.log','final-node-tests.log','final-python-tests.log','country-scope-smoke.log','ca-license.html','us-place-metadata.xml','neon-storage.txt','neon-pricing.txt','new-businesses.parquet','new-businesses-round2.parquet','new-businesses-round3.parquet','new-businesses-round4.parquet','region-00002-recovered.parquet']:add(root/name)
 for region in ['00000','00001','00003','00005','00006']:
  for name in ['source-asset.json','download-report.json','normalization-report.json','normalized.parquet']:add(root/('region-'+region)/name)
 for name in ['report.json','CA-2021-4802039.json','CA-2021-4806022.json']:add(root/'complement'/name)
 for name in ['prospect-businesses.parquet','download-report.json','collection-report.json','source-asset.json','countries-natural-earth.geojson','natural-earth-readme.md','duplicate-aliases.csv.gz','categories.json','license-boundary-manifest.json']:add(base/name)
 for f in (root/'licenses').glob('*'):add(f)
 for f in Path('scripts').glob('catalog-*'):add(f)
 for name in ['GLOBAL_CATALOG_COVERAGE_20261023.md','GLOBAL_CATALOG_COVERAGE_METRICS.json','tools/catalog-requirements.txt','db/catalog-archive.sql']:add(name)
 partial=output.with_suffix('.partial.zip')
 with zipfile.ZipFile(partial,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as archive:
  for file in sorted(set(files)):
   assert file.stat().st_size<256*1024*1024;archive.write(file,str(file))
 with zipfile.ZipFile(partial) as archive:
  bad=archive.testzip()
  if bad:raise RuntimeError('archive_crc_error')
  assert not any('.env' in Path(name).parts or Path(name).name.startswith('.env') for name in archive.namelist())
 if partial.stat().st_size>1024*1024*1024:raise RuntimeError('archive_budget')
 partial.replace(output);digest=hashlib.file_digest(output.open('rb'),'sha256').hexdigest();report={'file':str(output),'bytes':output.stat().st_size,'sha256':digest,'entries':len(set(files)),'crcVerified':True,'credentialsIncluded':False}
 (root/'package-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()
