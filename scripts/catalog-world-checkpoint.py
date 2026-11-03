"""Stream one public SQLite checkpoint into bounded immutable gzip parts.

No second full compressed copy or 512MiB in-memory block is required. Database
credentials are neither accepted nor inspected. Hash every compressed part and
the original SQLite stream so restoration can be checked independently.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3


class Parts:
    def __init__(self,root,maximum=512*1024*1024):
        self.root=Path(root);self.maximum=maximum;self.parts=[];self.file=None
        self.size=0;self.hasher=hashlib.sha256();self.whole=hashlib.sha256()

    def write(self,data):
        self.whole.update(data);length=len(data)
        while data:
            if shutil.disk_usage(self.root).free<32*1024*1024:
                raise RuntimeError('checkpoint_disk_reserve_original_preserved')
            if self.file is None:
                self.file=(self.root/('world-checkpoint.part'+str(len(self.parts)).zfill(3))).open('wb')
            block=data[:self.maximum-self.size]
            self.file.write(block);self.hasher.update(block);self.size+=len(block);data=data[len(block):]
            if self.size==self.maximum:self.finish_part()
        return length

    def flush(self):
        if self.file:self.file.flush()

    def finish_part(self):
        if self.file:
            name=Path(self.file.name).name;self.file.close();self.file=None
            self.parts.append({'file':name,'bytes':self.size,'sha256':self.hasher.hexdigest()})
            self.size=0;self.hasher=hashlib.sha256()


def compress(root):
    root=Path(root);source=root/'ingest.sqlite'
    db=sqlite3.connect(source);db.execute('PRAGMA wal_checkpoint(TRUNCATE)');db.close()
    for path in root.glob('world-checkpoint.part[0-9][0-9][0-9]'):path.unlink()
    parts=Parts(root);original=hashlib.sha256();count=0
    with source.open('rb') as inp,gzip.GzipFile(fileobj=parts,mode='wb',filename='',compresslevel=1,mtime=0) as out:
        while block:=inp.read(1024*1024):
            original.update(block);count+=len(block);out.write(block)
    parts.finish_part()
    manifest={'version':1,'parts':parts.parts,'gzipSha256':parts.whole.hexdigest(),
        'sqliteSha256':original.hexdigest(),'sqliteBytes':count,'containsCredentials':False}
    (root/'checkpoint-parts.json').write_text(json.dumps(manifest,indent=2))
    return manifest


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default='.artifacts/ci-world-ingest');a=p.parse_args()
    result=compress(a.root);print(json.dumps({'checkpointParts':len(result['parts']),'sqliteBytes':result['sqliteBytes'],
        'compressedBytes':sum(part['bytes'] for part in result['parts']),'credentialsIncluded':False}))
