"""Package explicit public evidence, referencing existing immutable data assets.
No directory traversal, credentials, source downloads or duplicate catalog copy.
"""
import hashlib,json,zipfile
from pathlib import Path

AUDIT=Path('.artifacts/catalog-audit-world-20261027')
WORLD=Path('.artifacts/world-boundaries-20261026')
COUNTRIES=['germany','netherlands-v2','belgium','switzerland','czechia','poland-v3','austria-v4']

def main():
 files=[Path(n) for n in ['COBERTURA_WORLD_20261027.md','CITY_COVERAGE_RUNBOOK.md','CATALOG_ATTRIBUTIONS.md','scripts/catalog-world-boundaries.py','scripts/catalog-division-read.py','scripts/catalog-source-plan.py','scripts/catalog-publish-country.py','scripts/catalog-smoke.py','test/catalog_world_test.py','test/catalog_publication_test.py']]
 files += [AUDIT/n for n in ['global-audit.json','world-progress.json','all-city-coverage.csv','all-city-coverage.ndjson.gz']]
 files += [WORLD/n for n in ['source-review-summary.json','prepared-global-identity-verification.json','original-million-preservation.json','pending-publication-plan.json','python-regressions.log','world-source-plan/country-source-plan.json','world-source-plan/summary.json']]
 optional=['live-city-verification.json','scope-overlap-explanation.json','draft-identity-preservation.json','publication-checkpoint.json','remote-integrity.json','mcp-coverage-receipt.json']
 for name in COUNTRIES:
  root=Path('.artifacts/city-coverage-'+name+'-20261026')
  files += [root/n for n in ['country-report.json','boundary-match-report.json','published-asset.json','geometry-publication.json','coverage-cities.csv','overlap-aliases.ndjson.gz']]
  files += [root/n for n in optional if (root/n).is_file()]
  files += list(root.glob('geography-publication-*.json'))
 for file in files:
  if not file.is_file() or any(v.startswith('.env') for v in file.parts):raise ValueError('missing_or_private_artifact')
  if file.suffix not in ('.md','.py','.json','.csv','.gz','.log'):raise ValueError('unreviewed_artifact_extension')
 target=AUDIT/'coverage-world-20261027-v1.zip';manifest=[]
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
  for file in files:
   data=file.read_bytes();archive.writestr(str(file),data);manifest.append({'path':str(file),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  archive.writestr('PUBLIC_CONTENTS.json',json.dumps(manifest,indent=2))
 result={'file':str(target),'bytes':target.stat().st_size,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest(),'files':len(files)+1,'credentialsIncluded':False,'businessAssetsReferencedNotDuplicated':True}
 (AUDIT/'evidence-package.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))

if __name__=='__main__':main()
