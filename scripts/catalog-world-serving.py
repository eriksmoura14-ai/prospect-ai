"""Incrementally repair only serving-file regressions caused by a world import.

This is repartitioning, not new discovery. Every original column and source ID
must survive the same count/hash-sum/hash-xor proof as the existing serving tool.
Old objects remain stored; activation switches metadata atomically afterwards.
"""
import collections
import importlib.util
import json
from pathlib import Path

import duckdb
import numpy as np
import shapely

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

w=module('world_serving_import','catalog-world-ingest.py')
s=module('existing_serving_policy','catalog-serving.py')
READ_BUDGET=256*1024*1024
REWRITE_BUDGET=128*1024*1024


def occupancy(boxes,assets):
    counts=np.zeros(len(boxes),dtype=np.int16)
    for asset in assets:
        counts+=s.hits(boxes,asset['bounds']) if asset.get('bounds') else 1
    return counts


def repair(index,root,snapshot,assets):
    old=snapshot['assets']
    retire=[];proofs=[];downloaded=rewritten=0
    root=Path(root)
    by_country=collections.defaultdict(list)
    for asset in assets:
        by_country[asset['countries'][0]].append(asset)
    c=duckdb.connect(str(root/'incremental-serving.duckdb'),config={'memory_limit':'384MB','threads':'1',
        'temp_directory':str(root/'serving-spill'),'max_temp_directory_size':'2GB'})
    c.execute('CREATE OR REPLACE MACRO spread1(v) AS ((v | (v << 8)) & 16711935)')
    c.execute('CREATE OR REPLACE MACRO spread2(v) AS ((spread1(v) | (spread1(v) << 4)) & 252645135)')
    c.execute('CREATE OR REPLACE MACRO spread3(v) AS ((spread2(v) | (spread2(v) << 2)) & 858993459)')
    c.execute('CREATE OR REPLACE MACRO spread4(v) AS ((spread3(v) | (spread3(v) << 1)) & 1431655765)')
    report=[]
    mapped={row[0] for row in index.db.execute('SELECT area_id FROM city_areas')}
    if index.db.execute("SELECT 1 FROM sqlite_master WHERE name='new_city_areas'").fetchone():
        mapped.update(row[0] for row in index.db.execute('SELECT area_id FROM new_city_areas'))
    for cc,new in sorted(by_country.items()):
        rows=index.db.execute('SELECT id,geometry FROM areas WHERE country=?',(cc,)).fetchall()
        rows=[row for row in rows if row[0] in mapped]
        if not rows:
            continue
        boxes=np.asarray([shapely.from_wkb(binary).bounds for _,binary in rows],dtype=float).reshape((-1,4))
        prior=[asset for asset in old if cc in asset['countries']]
        before=occupancy(boxes,prior);after=before+occupancy(boxes,new)
        # Previously unservable huge regions are reported, not allowed to
        # prevent a safe repair of working city queries elsewhere.
        valid=before<=8
        preexisting=int(np.count_nonzero(~valid))
        rows=[row for row,keep in zip(rows,valid) if keep]
        boxes=boxes[valid];before=before[valid];after=after[valid]
        if not len(rows):
            report.append({'country':cc,'preexistingAreasOverFileBudget':preexisting,'safe':True})
            continue
        bad=np.where((before<=8)&(after>8))[0]
        record={'country':cc,'knownAreas':len(rows),'preexistingAreasOverFileBudget':preexisting,'maximumFilesBefore':int(before.max()),
            'maximumFilesWithNaiveAppend':int(after.max()),'regressionsBeforeRepair':len(bad)}
        if not len(bad):
            record['safe']=True;report.append(record);continue
        # Include every old shard intersecting affected areas, then extend the
        # selection only when the merged point envelope would introduce a new
        # conflict with an unchanged shard. No data outside the selected shards
        # is downloaded or rewritten.
        selected=set()
        for j,asset in enumerate(prior):
            if not asset.get('bounds') or np.any(s.hits(boxes[bad],asset['bounds'])):
                selected.add(j)
        while True:
            group=[prior[j] for j in sorted(selected)]+new
            bounds=[asset['bounds'] for asset in group if asset.get('bounds')]
            if any(not asset.get('bounds') for asset in group):
                envelope=[-180,-90,180,90]
            else:
                envelope=[min(v[0] for v in bounds),min(v[1] for v in bounds),max(v[2] for v in bounds),max(v[3] for v in bounds)]
            unchanged=[asset for j,asset in enumerate(prior) if j not in selected]
            occupied=occupancy(boxes,unchanged)
            extra=np.where(occupied+s.hits(boxes,envelope)>8)[0]
            added={j for j,asset in enumerate(prior) if j not in selected and (not asset.get('bounds') or np.any(s.hits(boxes[extra],asset['bounds'])))}
            if not added:
                break
            selected.update(added)
        chosen=[prior[j] for j in sorted(selected)]
        needed=sum(asset['bytes'] for asset in chosen)
        if downloaded+needed>READ_BUDGET:
            raise RuntimeError('incremental_serving_extra_read_budget')
        inputs=[]
        for asset in chosen:
            path=root/('serving-original-'+asset['sha256']+'.parquet')
            w.download(asset,path);inputs.append({**asset,'file':str(path)})
            downloaded+=asset['bytes']
        inputs.extend({**asset,'file':str(root/'businesses'/asset['file'])} for asset in new)
        files=[asset['file'] for asset in inputs]
        c.execute('CREATE OR REPLACE TABLE serving_data AS SELECT * REPLACE(CAST(source_id AS VARCHAR) AS source_id), '
            '(spread4(CAST(floor((longitude+180)/360*65535) AS UBIGINT)) | '
            '(spread4(CAST(floor((latitude+90)/180*65535) AS UBIGINT)) << 1)) AS __catalog_morton '
            'FROM read_parquet(?,union_by_name=true) ORDER BY __catalog_morton,source_id',[files])
        total,distinct=c.execute('SELECT count(*),count(DISTINCT source_id) FROM serving_data').fetchone()
        if total!=distinct or total!=sum(int(a['records']) for a in inputs):
            raise RuntimeError('incremental_serving_input_identity')
        arrays=[];cursor=c.execute('SELECT longitude,latitude,__catalog_morton FROM serving_data ORDER BY __catalog_morton,source_id')
        while batch:=cursor.fetchmany(25000):arrays.append(np.asarray(batch,dtype=float))
        coordinates=np.concatenate(arrays);del arrays
        leaves,metrics=s.plan(coordinates[:,:2],coordinates[:,2],boxes,target=25000,maximum=8,occupied=occupied)
        replacement=[]
        for num,leaf in enumerate(leaves):
            path=root/'businesses'/f'{cc}-serving-{num:04d}.parquet'
            path.unlink(missing_ok=True)
            target="'"+str(path).replace("'","''")+"'"
            low,high=int(coordinates[leaf['start'],2]),int(coordinates[leaf['end']-1,2])
            c.execute('COPY (SELECT * EXCLUDE(__catalog_morton) FROM serving_data WHERE __catalog_morton BETWEEN ? AND ? ORDER BY source_id) TO '+target+' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 5000)',[low,high])
            count=c.execute('SELECT count(*) FROM read_parquet(?)',[str(path)]).fetchone()[0]
            if count!=leaf['end']-leaf['start']:
                raise RuntimeError('incremental_serving_shard_count')
            size,digest=path.stat().st_size,w.sha(path)
            if size>60*1024*1024 or rewritten+size>REWRITE_BUDGET:
                raise RuntimeError('incremental_serving_rewrite_free_budget')
            key=f'snapshots/20261103/world-v1/{cc}-serving-{digest[:16]}.parquet'
            replacement.append({'id':'world-v1-serving-'+cc.lower()+'-'+digest[:24],'file':path.name,'key':key,
                'url':w.ORIGIN+key,'sha256':digest,'bytes':size,'records':count,'countries':[cc],'bounds':leaf['bounds'],
                'source':'overture','release':w.RELEASE,'license':new[0]['license']})
            rewritten+=size
        proof=s.verify(c,inputs,[{**asset,'file':str(root/'businesses'/asset['file'])} for asset in replacement])
        proofs.append({'country':cc,'retainedOriginalRows':sum(int(a['records']) for a in chosen),
            'newUniqueRows':sum(a['records'] for a in new),'integrity':proof,'sourceAssetIds':[a['id'] for a in chosen],
            'replacementAssetIds':[a['id'] for a in replacement]})
        removed={a['id'] for a in new}
        assets=[asset for asset in assets if asset['id'] not in removed]+replacement
        retire.extend(a['id'] for a in chosen)
        for asset in inputs:
            path=Path(asset['file'])
            if path.name.startswith('serving-original-'):path.unlink()
        del coordinates
        record.update(safe=True,maximumFilesAfter=metrics['maximumFilesPerKnownArea'],retiredServingShards=len(chosen),
            newServingShards=len(replacement),allOriginalFieldsRetained=True)
        report.append(record)
        print(json.dumps({'stage':'preserve_serving_file_budget',**record}),flush=True)
    c.close()
    result={'version':1,'countries':report,'retireAssetIds':retire,'proofs':proofs,
        'oldObjectsDeleted':False,'extraOldAssetReadBytes':downloaded,'servingRewriteBytes':rewritten,
        'allNewAssetsRequireAtomicActivation':True}
    w.save(root/'serving-safety.json',result)
    return assets,result
