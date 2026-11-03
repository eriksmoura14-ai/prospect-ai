"""Atomically activate verified world assets, then append geography and coverage.

Only the isolated public catalog is accepted. Existing source files and business
IDs remain intact. Operations are bounded, idempotent and checkpointed locally.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('world_publisher',Path(__file__).with_name('catalog-world-publish.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def assets(db,root,manifest):
    identity='world-import-active:'+p.w.sha(root/'publication.json')
    receipt=db.sql('SELECT payload FROM catalog_manifests WHERE id=$1',[identity])
    if receipt:
        return identity
    p.baseline_preserved(db,root,manifest)
    ready=json.loads((root/'published-businesses.json').read_text())
    new=[item for bundle in manifest['bundles'] for item in bundle['assets']]
    if len({a['id'] for a in new})!=len(new) or any(ready.get(a['key'])!=a['sha256'] for a in new):
        raise ValueError('full_business_upload_verification_required')
    old=json.loads((root/'catalog-snapshot.json').read_text())['assets']
    retire=manifest.get('retireAssetIds',[])
    if not set(retire).issubset(a['id'] for a in old):
        raise ValueError('original_serving_identity_mismatch')
    old_rows=sum(int(a['records']) for a in old)
    retired_rows=sum(int(a['records']) for a in old if a['id'] in retire)
    new_rows=sum(a['records'] for a in new)
    if old_rows-retired_rows+new_rows!=old_rows+manifest['report']['newUniqueBusinesses']:
        raise ValueError('canonical_record_budget_does_not_reconcile')
    if retire and not all(proof['integrity']['allFieldsRetained'] for proof in manifest['servingRepartitionProofs']):
        raise ValueError('original_record_fields_must_be_preserved')
    expected=[{k:a[k] for k in ('id','sha256','records')} for a in old+new]
    new_ids=[a['id'] for a in new]
    report={'version':1,'baselineFingerprint':manifest['baselineFingerprint'],
        'previousCanonicalRows':old_rows,'newUniqueBusinesses':manifest['report']['newUniqueBusinesses'],
        'finalCanonicalRows':old_rows-retired_rows+new_rows,'retiredServingAssetIds':retire,
        'originalObjectsDeleted':0,'originalBusinessIdsChanged':0,'newAssetIds':new_ids}
    db.room()
    result=db.sql('''WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,sha256 text,records bigint)),
      checked AS (SELECT count(*)=$2::int AS ok FROM expected e JOIN catalog_assets a
        ON a.id=e.id AND a.sha256=e.sha256 AND a.records=e.records
        AND a.state=CASE WHEN a.id=ANY($3::text[]) THEN 'staging' ELSE 'ready' END),
      changed AS (UPDATE catalog_assets SET state=CASE WHEN id=ANY($3::text[]) THEN 'ready' ELSE 'retired' END
        WHERE (id=ANY($3::text[]) OR id=ANY($4::text[])) AND (SELECT ok FROM checked) RETURNING id),
      saved AS (INSERT INTO catalog_manifests(id,payload,sha256) SELECT $5,$6::jsonb,$7 FROM checked WHERE ok
        ON CONFLICT(id) DO NOTHING RETURNING id)
      SELECT (SELECT ok FROM checked) AS verified,(SELECT count(*) FROM changed) AS switched''',
      [json.dumps(expected),len(expected),new_ids,retire,identity,json.dumps(report),digest(report)])
    if not result[0]['verified'] or int(result[0]['switched'])!=len(new_ids)+len(retire):
        raise RuntimeError('atomic_catalog_switch_rejected')
    p.w.save(root/'world-activation-receipt.json',report)
    return identity


def geography(db,root):
    plan=json.loads((root/'geometry-publication.json').read_text())
    verified=json.loads((root/'published-geography.json').read_text())
    if any(verified.get(item['key'])!=item['sha256'] for item in plan['uploads']):
        raise ValueError('full_geometry_remote_hash_verification_required')
    checkpoint=root/'registered-world-geometry.json'
    done=json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    for item in plan['manifests']:
        identity,payload=item['id'],item['payload']
        new_sha=digest(payload)
        if done.get(identity)==new_sha:
            continue
        current=db.sql('SELECT payload,sha256 FROM catalog_manifests WHERE id=$1',[identity])
        if current and digest(current[0]['payload'])==new_sha:
            done[identity]=new_sha;p.w.save(checkpoint,done);continue
        if current:
            if digest(current[0]['payload'])!=item['previousPayloadSha256']:
                raise RuntimeError('published_geometry_changed_retry_from_fresh_snapshot')
            # The exact existing parts must still be present, unchanged.
            if any(part not in payload['parts'] for part in current[0]['payload']['parts']):
                raise ValueError('existing_geography_must_be_retained')
        elif item['previousPayloadSha256'] is not None:
            raise ValueError('previous_geometry_manifest_missing')
        db.room()
        result=db.sql('''INSERT INTO catalog_manifests(id,payload,sha256) VALUES($1,$2::jsonb,$3)
          ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,sha256=excluded.sha256
          WHERE catalog_manifests.sha256=$4 RETURNING id''',[identity,json.dumps(payload),new_sha,current[0]['sha256'] if current else None])
        if not result:
            raise RuntimeError('geometry_compare_and_swap_rejected')
        done[identity]=new_sha;p.w.save(checkpoint,done)
    return len(done)


def coverage(db,root):
    checkpoint=root/'applied-world-coverage.json'
    done=json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    updates=[json.loads(line) for line in (root/'coverage-updates.ndjson').open()]
    count=0
    for offset in range(0,len(updates),100):
        batch=updates[offset:offset+100]
        identity=digest(batch)
        if done.get(identity):
            count+=len(batch);continue
        data=json.dumps(batch,ensure_ascii=False,separators=(',',':'))
        status=db.sql('''SELECT count(*) FILTER(WHERE c.unique_supported IS NOT DISTINCT FROM r.unique_supported) AS applied,
          count(*) FILTER(WHERE c.unique_supported IS NOT DISTINCT FROM r.previous_supported) AS before,
          count(*) AS matched FROM jsonb_to_recordset($1::jsonb) AS r(city_key text,unique_supported int,previous_supported int)
          JOIN catalog_city_inventory c ON c.city_key=r.city_key''',[data])[0]
        if int(status['matched'])!=len(batch):
            raise ValueError('coverage_inventory_identity_changed')
        if int(status['applied'])==len(batch):
            done[identity]=True;p.w.save(checkpoint,done);count+=len(batch);continue
        if int(status['before'])!=len(batch):
            raise RuntimeError('city_coverage_changed_retry_from_fresh_snapshot')
        db.room()
        changed=db.sql('''UPDATE catalog_city_inventory c SET unique_supported=r.unique_supported,
          unique_all=CASE WHEN r.previous_supported IS NOT NULL AND c.unique_all IS NOT NULL
            THEN c.unique_all+r.unique_supported-r.previous_supported ELSE r.unique_all END,
          source_rows=r.source_rows,category_count=coalesce(r.category_count,c.category_count),sources=r.sources,
          limitations=r.limitations,coverage_status=r.coverage_status,next_action=r.next_action,
          association_status=r.association_status,updated_at=now()
          FROM jsonb_to_recordset($1::jsonb) AS r(city_key text,previous_supported int,unique_supported int,unique_all int,
            source_rows int,category_count int,sources jsonb,limitations jsonb,coverage_status text,next_action text,association_status text)
          WHERE c.city_key=r.city_key AND c.unique_supported IS NOT DISTINCT FROM r.previous_supported RETURNING c.city_key''',[data])
        if len(changed)!=len(batch):
            raise RuntimeError('coverage_compare_and_swap_rejected')
        done[identity]=True;p.w.save(checkpoint,done);count+=len(batch)
        if count%1000==0:
            print(json.dumps({'coverageCitiesUpdated':count,'databaseBytes':db.room()}),flush=True)
            # Reuse dead pages within the same small free database. No FULL
            # vacuum, table rewrite, increased quota or customer database access.
            try:db.sql('VACUUM (ANALYZE) catalog_city_inventory')
            except RuntimeError:pass
    return count


def main():
    ap=argparse.ArgumentParser();ap.add_argument('phase',choices=['assets','geography','coverage','audit'])
    ap.add_argument('--root',required=True);ap.add_argument('--database-config',required=True)
    a=ap.parse_args();root=Path(a.root);db=p.Database(p.private(a.database_config))
    manifest=json.loads((root/'publication.json').read_text())
    activation_id='world-import-active:'+p.w.sha(root/'publication.json')
    if a.phase=='assets':
        print(json.dumps({'activationManifest':assets(db,root,manifest),'atomic':True}));return
    if not db.sql('SELECT id FROM catalog_manifests WHERE id=$1',[activation_id]):
        raise ValueError('business_assets_must_be_active_before_geography_or_coverage')
    if a.phase=='geography':
        print(json.dumps({'geometryManifestsRegistered':geography(db,root)}));return
    if a.phase=='coverage':
        plan=json.loads((root/'geometry-publication.json').read_text())
        registered=json.loads((root/'registered-world-geometry.json').read_text()) if (root/'registered-world-geometry.json').exists() else {}
        if any(registered.get(item['id'])!=digest(item['payload']) for item in plan['manifests']):
            raise ValueError('new_geography_must_be_registered_before_coverage')
        print(json.dumps({'coverageRowsApplied':coverage(db,root)}));return
    report=db.sql('''SELECT count(*) AS inventory,count(*) FILTER(WHERE unique_supported>=50) AS met50,
      count(*) FILTER(WHERE unique_supported>=100) AS met100,count(*) FILTER(WHERE unique_supported>=200) AS met200,
      count(*) FILTER(WHERE unique_supported IS NULL) AS location_pending,
      count(*) FILTER(WHERE unique_supported<50) AS confirmed_below_50,
      pg_database_size(current_database()) AS database_bytes,
      (SELECT sum(records) FROM catalog_assets WHERE state='ready') AS ready_archive_rows FROM catalog_city_inventory''')[0]
    report['percentAt50']=round(100*int(report['met50'])/int(report['inventory']),6)
    report['allCitiesAt50']=int(report['met50'])==int(report['inventory'])
    p.w.save(root/'published-world-audit.json',report);print(json.dumps(report))


if __name__=='__main__':
    try:main()
    except Exception as error:
        safe=str(error) if isinstance(error,(ValueError,RuntimeError)) and p.w.h.re.fullmatch('[a-z0-9_:.-]{1,160}',str(error)) else 'activation_stopped_checkpoint_preserved'
        print(json.dumps({'activationComplete':False,'error':type(error).__name__,'detail':safe}),flush=True)
        raise SystemExit(1)
