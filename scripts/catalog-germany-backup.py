"""Create an explicit public-business-only Germany operator checkpoint.
No dotfiles, credentials, environment variables, customer tables or logs enter.
Original baseline inputs, source identities, aliases and SQLite checkpoints stay.
"""
import argparse,gzip,hashlib,io,json,shutil,sqlite3,tarfile
from pathlib import Path

def digest(path):
 with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--output',required=True);a=ap.parse_args();root=Path(a.root);output=Path(a.output)
 assert root.resolve() not in output.resolve().parents,'backup_must_be_outside_source_root'
 for name in ('germany.sqlite','reconcile.sqlite'):
  c=sqlite3.connect(root/name);r=c.execute('PRAGMA wal_checkpoint(FULL)').fetchone();c.close();assert r[0]==0,'checkpoint_busy'
 files=sorted({p for pattern in ('*.json','*.csv','*.parquet','*.sqlite','*.json.gz') for p in root.glob(pattern) if p.is_file() and not p.is_symlink()}|{p for p in (root/'municipal-raw').glob('*.json.gz') if p.is_file() and not p.is_symlink()})
 size=sum(p.stat().st_size for p in files)
 if shutil.disk_usage(output.parent).free<size+256*1024*1024:raise RuntimeError('backup_disk_reserve')
 manifest={'country':'DE','customerDataIncluded':False,'credentialsIncluded':False,'sourceFiles':len(files),'files':{str(p.relative_to(root)):{'bytes':p.stat().st_size,'sha256':digest(p)} for p in files}}
 temp=output.with_suffix('.partial')
 with temp.open('wb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',compresslevel=1,mtime=0) as compressed,tarfile.open(fileobj=compressed,mode='w|') as archive:
  data=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode();info=tarfile.TarInfo('checkpoint-manifest.json');info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
  for path in files:archive.add(path,arcname=str(path.relative_to(root)),recursive=False)
 temp.replace(output);receipt={'file':output.name,'bytes':output.stat().st_size,'sha256':digest(output),'sourceFiles':len(files),'uncompressedSourceBytes':size,'credentialsIncluded':False,'customerDataIncluded':False}
 (root/'backup-receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
if __name__=='__main__':main()
