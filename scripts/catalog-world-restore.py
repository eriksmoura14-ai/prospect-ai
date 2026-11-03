"""Restore verified public SQLite checkpoint parts on a suitably sized runner."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil


class Reader(io.RawIOBase):
    def __init__(self,paths):self.paths=iter(paths);self.file=None
    def readable(self):return True
    def readinto(self,buffer):
        while True:
            if self.file is None:
                path=next(self.paths,None)
                if path is None:return 0
                self.file=path.open('rb')
            n=self.file.readinto(buffer)
            if n:return n
            self.file.close();self.file=None
    def close(self):
        if self.file:self.file.close()
        super().close()


def restore(root):
    root=Path(root);manifest=json.loads((root/'checkpoint-parts.json').read_text());paths=[];compressed=hashlib.sha256()
    for part in manifest['parts']:
        if Path(part['file']).name!=part['file']:raise ValueError('checkpoint_part_path')
        path=root/part['file'];sha=hashlib.sha256();n=0
        with path.open('rb') as inp:
            while block:=inp.read(1024*1024):sha.update(block);compressed.update(block);n+=len(block)
        if n!=part['bytes'] or sha.hexdigest()!=part['sha256']:raise ValueError('checkpoint_part_integrity')
        paths.append(path)
    if compressed.hexdigest()!=manifest['gzipSha256']:raise ValueError('checkpoint_compressed_stream_integrity')
    if shutil.disk_usage(root).free<manifest['sqliteBytes']+256*1024*1024:raise RuntimeError('checkpoint_restore_disk_budget')
    target=root/'ingest.sqlite';temp=target.with_suffix('.restore');digest=hashlib.sha256();count=0
    with Reader(paths) as raw,io.BufferedReader(raw) as buffered,gzip.GzipFile(fileobj=buffered) as inp,temp.open('wb') as out:
        while block:=inp.read(1024*1024):
            count+=len(block)
            if count>manifest['sqliteBytes']:raise ValueError('checkpoint_sqlite_size')
            digest.update(block);out.write(block)
    if count!=manifest['sqliteBytes'] or digest.hexdigest()!=manifest['sqliteSha256']:raise ValueError('checkpoint_sqlite_integrity')
    temp.replace(target)
    for path in paths:path.unlink()  # Generated local transfer parts; release originals stay immutable.
    return {'restoredBytes':count,'sha256':digest.hexdigest(),'releaseObjectsDeleted':False}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default='.artifacts/ci-world-ingest');a=p.parse_args()
    print(json.dumps(restore(a.root)))
