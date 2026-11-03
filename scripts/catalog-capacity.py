"""Offline publication budget: no credentials, quota changes, or network calls.

Usage is a freshly inspected provider snapshot scoped to one immutable plan.
Count uploads as well as verification reads conservatively, preserve a 50 MiB
application reserve, and account for known transfers not yet in provider usage.
The publisher still checks actual database size before each write.
"""
import argparse,hashlib,json,shutil,time
from pathlib import Path

PROJECT='polished-sky-36508370'
DATABASE_GUARD=220*1024*1024
TRANSFER_MAXIMUM=5_000_000_000
TRANSFER_RESERVE=50*1024*1024
DISK_RESERVE=32*1024*1024
SNAPSHOT_MAX_AGE=3600

def fingerprint(asset,geometry,coverage):
 return hashlib.sha256(json.dumps({'asset':asset,'geometry':geometry,'coverageSha256':hashlib.sha256(coverage).hexdigest()},sort_keys=True,separators=(',',':')).encode()).hexdigest()

def assess(root,usage,*,geography_only=False,now=None,free_bytes=None):
 root=Path(root).resolve();now=time.time() if now is None else now
 asset=json.loads((root/'publication-plan-asset.json').read_text());geometry=json.loads((root/'geometry-publication.json').read_text());plan=fingerprint(asset,geometry,(root/'coverage-updates.ndjson').read_bytes())
 if usage.get('projectId')!=PROJECT or usage.get('planFingerprint')!=plan:raise ValueError('capacity_project_or_plan_mismatch')
 for key in ('databaseBytes','dataTransferBytes','dataTransferQuotaBytes','unreportedTransferBytes','observedAtUnix'):
  if type(usage.get(key)) is not int or usage[key]<0:raise ValueError('capacity_snapshot_invalid')
 if not 0<usage['dataTransferQuotaBytes']<=TRANSFER_MAXIMUM:raise ValueError('capacity_quota_cannot_be_raised')
 age=now-usage['observedAtUnix']
 if not 0<=age<=SNAPSHOT_MAX_AGE:raise ValueError('capacity_snapshot_stale_or_future')
 checkpoint=root/('geography-publication-'+plan[:16]+'.json' if geography_only else 'publication-checkpoint.json')
 state=json.loads(checkpoint.read_text()) if checkpoint.exists() else {'fingerprint':plan,'completed':[]}
 if state.get('fingerprint')!=plan:raise ValueError('capacity_checkpoint_mismatch')
 completed=state['completed'];geo_checkpoint=root/'geometry-upload-checkpoint.json';verified=json.loads(geo_checkpoint.read_text()) if geo_checkpoint.exists() else {}
 upload=0 if geography_only or 'asset_uploaded' in completed else int(asset['bytes'])
 read=0 if 'asset_remote_sha256' in completed else int(asset['bytes'])
 geometry_bytes=sum(int(v['bytes']) for v in geometry['uploads'] if verified.get(v['key'])!=v['sha256']) if 'geometry_uploaded_and_verified' not in completed else 0
 # Keep allowance for control requests, publication receipts, and a small smoke
 # test. Full downloads or retries must be included in unreportedTransferBytes
 # before another publication; provider counters can lag behind actual I/O.
 control=2*1024*1024
 planned=upload+read+2*geometry_bytes+control
 available=usage['dataTransferQuotaBytes']-usage['dataTransferBytes']-usage['unreportedTransferBytes']-TRANSFER_RESERVE
 free=shutil.disk_usage(root).free if free_bytes is None else free_bytes
 blockers=[]
 if usage['databaseBytes']>=DATABASE_GUARD:blockers.append('operations_database_budget')
 if planned>available:blockers.append('transfer_budget_with_application_reserve')
 if free<DISK_RESERVE:blockers.append('local_disk_reserve')
 return {'version':1,'projectId':PROJECT,'planFingerprint':plan,'observedAtUnix':usage['observedAtUnix'],'allowed':not blockers,'blockers':blockers,'remainingPublicationTransferBytes':planned,'assetUploadBytes':upload,'assetVerificationBytes':read,'pendingGeometryDecodedBytes':geometry_bytes,'controlAndSmokeAllowanceBytes':control,'transferApplicationReserveBytes':TRANSFER_RESERVE,'unreportedTransferBytes':usage['unreportedTransferBytes'],'availableAfterReserveBytes':available,'databaseBytes':usage['databaseBytes'],'databaseGuardBytes':DATABASE_GUARD,'localFreeBytes':free,'localReserveBytes':DISK_RESERVE,'providerUsageMayLag':True,'quotasChanged':False,'backgroundProcessConfigured':False}

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--usage',required=True);p.add_argument('--output');p.add_argument('--geography-only',action='store_true');a=p.parse_args()
 report=assess(a.root,json.loads(Path(a.usage).read_text()),geography_only=a.geography_only)
 if a.output:Path(a.output).write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report));return 0 if report['allowed'] else 2

if __name__=='__main__':raise SystemExit(main())
