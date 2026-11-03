"""Publish one verified world-import bundle into the existing public catalog.

This operator runs locally: private SQL/presigned selectors are never committed
or sent to GitHub Actions. Original assets are not modified. A full remote hash
check precedes ready registration; interrupted bundles are safely resumable.
"""
import argparse
import concurrent.futures
import hashlib
import gzip
import importlib.util
import json
import os
import shutil
import time
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

import requests

spec=importlib.util.spec_from_file_location('world_import',Path(__file__).with_name('catalog-world-ingest.py'))
w=importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
DB_GUARD=220*1024*1024
DISK_RESERVE=32*1024*1024


def private(path):
    file=Path(path)
    if file.stat().st_mode & 0o077:
        raise ValueError('private_selector_requires_mode_0600')
    return json.loads(file.read_text())


class Database:
    def __init__(self,cfg):
        self.url=cfg['url']
        parsed=urlsplit(self.url)
        if parsed.path!='/catalog_ops' or parsed.username!='catalog_ops_owner' or not parsed.hostname.endswith('.neon.tech'):
            raise ValueError('isolated_public_catalog_required')
        self.host=parsed.hostname
        self.session=requests.Session()

    def sql(self,query,params=()):
        r=self.session.post('https://'+self.host+'/sql',headers={'Neon-Connection-String':self.url,
            'Neon-Raw-Text-Output':'false','Neon-Array-Mode':'false'},json={'query':query,'params':list(params)},
            timeout=(10,60),allow_redirects=False)
        if r.status_code!=200:
            raise RuntimeError('public_catalog_database_http_'+str(r.status_code))
        value=r.json()
        if 'error' in value:
            raise RuntimeError('public_catalog_database_statement_rejected')
        return value['rows']

    def room(self):
        size=int(self.sql('SELECT pg_database_size(current_database()) AS bytes')[0]['bytes'])
        if size>=DB_GUARD:
            raise RuntimeError('public_catalog_database_guard_checkpoint_preserved')
        return size


def checked_bundle(root,bundle,base):
    u=urlsplit(base)
    if u.scheme!='https' or u.netloc!='github.com' or not u.path.startswith('/eriksmoura14-ai/prospect-ai/releases/download/catalog-') or u.query:
        raise ValueError('reviewed_repository_release_required')
    name=bundle['file']
    if Path(name).name!=name or not name.endswith('.zip') or not 0<bundle['bytes']<=64*1024*1024:
        raise ValueError('bounded_release_bundle_required')
    path=root/name
    if path.exists() and path.stat().st_size==bundle['bytes'] and w.sha(path)==bundle['sha256']:
        return path
    if shutil.disk_usage(root).free<2*bundle['bytes']+DISK_RESERVE:
        raise RuntimeError('bundle_local_disk_budget')
    count,digest=0,hashlib.sha256()
    with requests.get(base.rstrip('/')+'/'+name,stream=True,timeout=(10,120)) as response:
        response.raise_for_status()
        if urlsplit(response.url).hostname not in ('github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'):
            raise ValueError('release_redirect_origin')
        with path.open('wb') as out:
            for block in response.iter_content(131072):
                count+=len(block)
                if count>bundle['bytes']:
                    raise ValueError('release_bundle_size')
                out.write(block);digest.update(block)
    if count!=bundle['bytes'] or digest.hexdigest()!=bundle['sha256']:
        raise ValueError('release_bundle_integrity')
    return path


def validate_item(item,kind):
    prefix='snapshots/20261103/world-v1/' if kind=='businesses' else 'geography/20261103/world-v1/'
    if item['url']!=w.ORIGIN+item['key'] or not item['key'].startswith(prefix):
        raise ValueError('world_asset_origin')
    if Path(item['file']).name!=item['file'] or not w.h.re.fullmatch('[a-f0-9]{64}',item['sha256']):
        raise ValueError('world_asset_identity')
    limit=(60 if item.get('id','').startswith('world-v1-serving-') else 32)*1024*1024 if kind=='businesses' else 2*1024*1024
    if not 0<item['bytes']<=limit:
        raise ValueError('world_asset_size_budget')
    if kind=='businesses' and (not item['id'].startswith('world-v1-') or len(item['countries'])!=1 or item['source']!='overture' or item['release']!=w.RELEASE):
        raise ValueError('world_business_identity')


def upload_and_verify(root,item,selector):
    file=root/item['file']
    if file.stat().st_size!=item['bytes'] or w.sha(file)!=item['sha256']:
        raise ValueError('extracted_item_integrity')
    expected=urlsplit(item['url']);signed=urlsplit(selector['url'])
    if (signed.scheme,signed.netloc,signed.path)!=(expected.scheme,expected.netloc,expected.path):
        raise ValueError('presigned_item_identity')
    head=requests.head(item['url'],timeout=(10,30),allow_redirects=False)
    if head.status_code==404:
        if item.get('contentEncoding')=='gzip':
            body=gzip.compress(file.read_bytes(),compresslevel=6,mtime=0)
            if len(body)!=item['storedBytes'] or hashlib.sha256(body).hexdigest()!=item['compressedSha256']:
                raise ValueError('compressed_geometry_integrity')
            r=requests.request(selector.get('method','PUT'),selector['url'],headers={**selector.get('headers',{}),'Content-Encoding':'gzip'},data=body,timeout=(10,120),allow_redirects=False)
        else:
            with file.open('rb') as body:
                r=requests.request(selector.get('method','PUT'),selector['url'],headers=selector.get('headers',{}),data=body,timeout=(10,120),allow_redirects=False)
        if r.status_code not in (200,201,204):
            raise RuntimeError('immutable_item_upload_http_'+str(r.status_code))
    elif head.status_code!=200:
        raise RuntimeError('immutable_item_head_http_'+str(head.status_code))
    digest,count=hashlib.sha256(),0
    with requests.get(item['url'],stream=True,timeout=(10,90),allow_redirects=False) as r:
        if r.status_code!=200:
            raise RuntimeError('remote_item_verification_http_'+str(r.status_code))
        for block in r.iter_content(131072):
            count+=len(block)
            if count>item['bytes']:
                raise ValueError('remote_item_size')
            digest.update(block)
    if count!=item['bytes'] or digest.hexdigest()!=item['sha256']:
        raise ValueError('remote_item_sha256')
    return item['key']


def register(db,items,state='ready'):
    db.room()
    data=json.dumps(items,ensure_ascii=False,separators=(',',':'))
    db.sql('''INSERT INTO catalog_assets(id,url,sha256,bytes,records,countries,bounds,source,release,license,state)
      SELECT id,url,sha256,bytes,records,countries,bounds,source,release,license,$2
      FROM jsonb_to_recordset($1::jsonb) AS r(id text,url text,sha256 text,bytes bigint,records bigint,
        countries text[],bounds jsonb,source text,release text,license jsonb) ON CONFLICT(id) DO NOTHING''',[data,state])
    rows=db.sql('''SELECT count(*) AS n FROM jsonb_to_recordset($1::jsonb) AS r(id text,url text,sha256 text,bytes bigint,records bigint)
      JOIN catalog_assets a ON a.id=r.id AND a.url=r.url AND a.sha256=r.sha256 AND a.bytes=r.bytes AND a.records=r.records AND a.state=$2 ''',[data,state])
    if int(rows[0]['n'])!=len(items):
        raise RuntimeError('registered_immutable_asset_conflict')


def baseline_preserved(db,root,manifest):
    path=root/'catalog-snapshot.json'
    if not path.exists():
        raise ValueError('original_catalog_snapshot_required')
    original=json.loads(path.read_text())['assets']
    fingerprint=hashlib.sha256(json.dumps([(v['id'],v['sha256'],v['records']) for v in original],sort_keys=True).encode()).hexdigest()
    if manifest.get('baselineFingerprint',fingerprint)!=fingerprint:
        raise ValueError('original_catalog_fingerprint_mismatch')
    rows=db.sql('''SELECT count(*) AS n FROM jsonb_to_recordset($1::jsonb) AS e(id text,sha256 text,records bigint)
      JOIN catalog_assets a ON a.id=e.id AND a.sha256=e.sha256 AND a.records=e.records AND a.state='ready' ''',
      [json.dumps([{'id':v['id'],'sha256':v['sha256'],'records':v['records']} for v in original])])
    if int(rows[0]['n'])!=len(original):
        raise RuntimeError('original_catalog_changed_publication_stopped')


def capacity(path,items):
    cfg=json.loads(Path(path).read_text())
    if cfg.get('projectId')!='polished-sky-36508370' or not 0<=time.time()-cfg['observedAtUnix']<=3600:
        raise ValueError('fresh_project_capacity_snapshot_required')
    if cfg.get('transferQuotaBytes')!=5000000000 or cfg.get('storageQuotaBytes')!=5000000000:
        raise ValueError('free_quotas_cannot_be_raised')
    planned=sum(item['bytes'] for item in items)
    stored=sum(item.get('storedBytes',item['bytes']) for item in items)
    if cfg['storageCommittedBytes']+stored+256*1024*1024>cfg['storageQuotaBytes']:
        raise RuntimeError('free_storage_budget')
    if cfg['transferCommittedBytes']+2*planned+50*1024*1024>cfg['transferQuotaBytes']:
        raise RuntimeError('free_transfer_budget')


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',required=True)
    p.add_argument('--manifest',required=True)
    p.add_argument('--kind',choices=['businesses','geography'],required=True)
    p.add_argument('--bundle-index',type=int,required=True)
    p.add_argument('--release-base',required=True)
    p.add_argument('--database-config',required=True)
    p.add_argument('--upload-config',required=True)
    p.add_argument('--capacity-config',required=True)
    a=p.parse_args()
    root=Path(a.root);root.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(Path(a.manifest).read_text())
    bundle=manifest['bundles'][a.bundle_index]
    items=bundle['assets' if a.kind=='businesses' else 'uploads']
    for item in items:validate_item(item,a.kind)
    capacity(a.capacity_config,items)
    cfg=private(a.upload_config)
    uploads={row['key']:row for row in cfg['uploads']}
    if set(uploads)!={row['key'] for row in items}:
        raise ValueError('signed_bundle_inventory_mismatch')
    db=Database(private(a.database_config));db.room()
    baseline_preserved(db,root,manifest)
    checkpoint=root/('published-'+a.kind+'.json')
    state=json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    path=checked_bundle(root,bundle,a.release_base)
    with zipfile.ZipFile(path) as source:
        if {row.filename for row in source.infolist()}!={row['file'] for row in items}:
            raise ValueError('bundle_entry_inventory_mismatch')
        for item in items:
            info=source.getinfo(item['file'])
            if info.file_size!=item['bytes']:
                raise ValueError('bundle_entry_size')
            if state.get(item['key'])==item['sha256']:
                continue
            with source.open(info) as inp,(root/item['file']).open('wb') as out:
                shutil.copyfileobj(inp,out,131072)
    pending=[item for item in items if state.get(item['key'])!=item['sha256']]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(upload_and_verify,root,item,uploads[item['key']]):item for item in pending}
        for future in concurrent.futures.as_completed(futures):
            key=future.result();item=futures[future]
            state[key]=item['sha256'];w.save(checkpoint,state)
            print(json.dumps({'remoteFullHashVerified':True,'key':key,'bytes':item['bytes']}),flush=True)
    if a.kind=='businesses':register(db,items,'staging' if manifest.get('allNewAssetsRequireAtomicActivation') else 'ready')
    for item in items:
        (root/item['file']).unlink(missing_ok=True)
    path.unlink()
    print(json.dumps({'publishedBundle':bundle['file'],'items':len(items),'businessRecords':sum(item.get('records',0) for item in items),
        'oldAssetsMutated':0,'paidServicesEnabled':False,'databaseBytes':db.room()}),flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:
        # Requests exceptions can embed signed query strings. Never emit them.
        print(json.dumps({'publicationComplete':False,'error':type(error).__name__,
            'detail':str(error) if isinstance(error,(ValueError,RuntimeError)) and w.h.re.fullmatch('[a-z0-9_:.-]{1,160}',str(error)) else 'publication_stopped_checkpoint_preserved'}),flush=True)
        raise SystemExit(1)
