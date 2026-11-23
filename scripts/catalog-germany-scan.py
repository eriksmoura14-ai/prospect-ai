"""Finite, resumable OSM collection for ALL Germany; no city-name geocoding.

Country membership comes from published OSM relation 51477. Constant predicate
groups avoid a planet-wide variable-predicate join. Details use bounded VALUES
queries, including a repeated VALUES inside the optional geometry pattern.
Only public commercial attributes are requested; contributor data is excluded.
"""
import argparse
import gzip
import hashlib
import json
import re
import shutil
import sqlite3
import time
from pathlib import Path

import requests

ENDPOINT='https://qlever.dev/api/osm-planet'
KEY='https://www.openstreetmap.org/wiki/Key:'
COUNTRY='<https://www.openstreetmap.org/relation/51477> <http://www.opengis.net/rdf#sfContains> ?poi .'
FIELDS=['shop','craft','office','amenity','service','hairdresser','cuisine','disused','abandoned',
 'phone','contact:phone','mobile','contact:mobile','whatsapp','contact:whatsapp','website','contact:website','url',
 'addr:full','addr:street','addr:housenumber','addr:unit','addr:postcode','addr:city','brand:wikidata','operator:wikidata']
MAX_NETWORK=512*1024*1024
URI=re.compile(r'^https://www\.openstreetmap\.org/(node|way|relation)/([1-9][0-9]*)$')


def groups(niches):
    result={}
    for niche in niches.values():
        for key,value in niche['tags']:result.setdefault(key,set()).add(value)
    # The UI intentionally classifies shop=hairdresser locally for barbers.
    result.setdefault('shop',set()).add('hairdresser')
    return [(key,sorted(values)) for key,values in sorted(result.items())]+[
        ('cuisine-regex',sorted({x for niche in niches.values() for x in niche.get('cuisines',[])}))]


def candidate_query(key,values):
    if key=='cuisine-regex':
        pattern=r'(^|;)\s*('+ '|'.join(re.escape(v) for v in values)+r')\s*(;|$)'
        selected=f'?poi <{KEY}cuisine> ?v . FILTER(REGEX(STR(?v),{json.dumps(pattern)},"i"))'
    else:
        if key not in FIELDS:raise ValueError('unreviewed_osm_key')
        selected=f'?poi <{KEY+key}> ?v . VALUES ?v {{ '+ ' '.join(json.dumps(x) for x in values)+' }'
    return f'SELECT DISTINCT ?poi ?name WHERE {{ {COUNTRY} {selected} ?poi <{KEY}name> ?name . }} LIMIT 500001'


def details_query(uris):
    if not 0<len(uris)<=500 or not all(URI.fullmatch(u) for u in uris):raise ValueError('bounded_osm_identities_required')
    values=' '.join('<'+u+'>' for u in uris)
    return 'PREFIX geo:<http://www.opengis.net/ont/geosparql#> SELECT ?poi '+ ' '.join('?f'+str(i) for i in range(len(FIELDS)))+' ?wkt WHERE { VALUES ?poi { '+values+' } '+ ' '.join(f'OPTIONAL {{ ?poi <{KEY+k}> ?f{i} . }}' for i,k in enumerate(FIELDS))+ ' OPTIONAL { VALUES ?poi { '+values+' } ?poi geo:hasGeometry/geo:asWKT ?wkt . } }'


class Collector:
    def __init__(self,root,seconds):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.db=sqlite3.connect(self.root/'germany.sqlite')
        self.db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768;
          CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,query_sha TEXT,rows INT,completed_at TEXT);
          CREATE TABLE IF NOT EXISTS candidates(uri TEXT PRIMARY KEY,name TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS observations(uri TEXT PRIMARY KEY,payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,rows INT,bytes INT,sha256 TEXT,collected_at TEXT);
          CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS failures(id INTEGER PRIMARY KEY,stage TEXT,reason TEXT,at TEXT);
        ''')
        self.deadline=time.monotonic()+seconds;self.last_request=0
        self.session=requests.Session();self.session.headers.update({'Accept':'application/sparql-results+json',
          'User-Agent':'ProspectAI/1.0 finite German public business catalog (+https://github.com/eriksmoura14-ai/prospect-ai)'})
        self.network=int(self.db.execute("SELECT value FROM state WHERE key='network_bytes'").fetchone()[0]) if self.db.execute("SELECT 1 FROM state WHERE key='network_bytes'").fetchone() else 0

    def request(self,query,stage,maximum):
        if shutil.disk_usage(self.root).free<256*1024*1024:raise RuntimeError('disk_reserve_checkpoint_preserved')
        if time.monotonic()>self.deadline:raise RuntimeError('execution_budget_checkpoint_preserved')
        blocked=self.db.execute("SELECT value FROM state WHERE key='blocked_until'").fetchone()
        if blocked and float(blocked[0])>time.time():raise RuntimeError('source_cooldown_checkpoint_preserved')
        pause=.8-(time.monotonic()-self.last_request)
        if pause>0:time.sleep(pause)
        self.last_request=time.monotonic();start=time.monotonic()
        use_get=len(requests.Request('GET',ENDPOINT,params={'query':query}).prepare().url)<6000
        count=0;body=[]
        try:
            with self.session.request('GET' if use_get else 'POST',ENDPOINT,
                  **({'params':{'query':query}} if use_get else {'data':{'query':query}}),
                  stream=True,timeout=(8,45),allow_redirects=False) as response:
                if response.status_code in (429,503):
                    after=response.headers.get('Retry-After','60')
                    seconds=float(after) if re.fullmatch(r'[0-9]+',after) else 60
                    self.db.execute("INSERT OR REPLACE INTO state VALUES('blocked_until',?)",(str(time.time()+max(60,seconds)),));self.db.commit()
                    raise RuntimeError('source_cooldown_checkpoint_preserved')
                if response.status_code!=200:raise RuntimeError('qlever_http_'+str(response.status_code))
                for block in response.iter_content(65536):
                    count+=len(block);self.network+=len(block)
                    if count>maximum or self.network>MAX_NETWORK or time.monotonic()-start>90:raise RuntimeError('source_response_budget_checkpoint_preserved')
                    body.append(block)
            raw=b''.join(body);data=json.loads(raw)
            if data.get('exception') or data.get('status')=='ERROR' or not isinstance(data.get('results',{}).get('bindings'),list):raise RuntimeError('source_incomplete_result')
            rows=data['results']['bindings'];total=data.get('meta',{}).get('result-size-total')
            if total is not None and int(total)!=len(rows):raise RuntimeError('source_truncated_result')
            key=hashlib.sha256(query.encode()).hexdigest()
            file=self.root/(stage+'-'+key[:16]+'.json.gz')
            with gzip.open(file,'wb') as out:out.write(raw)
            return rows,{'querySha256':key,'bytes':count,'sha256':hashlib.sha256(raw).hexdigest(),
                'collectedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'elapsedMs':round((time.monotonic()-start)*1000)}
        except (requests.RequestException,ValueError) as error:
            raise RuntimeError('source_transport_or_parse_checkpoint_preserved') from None
        finally:
            self.db.execute("INSERT OR REPLACE INTO state VALUES('network_bytes',?)",(str(self.network),));self.db.commit()

    def candidates(self,niches):
        for key,values in groups(niches):
            if not values:continue
            query=candidate_query(key,values);sha=hashlib.sha256(query.encode()).hexdigest()
            existing=self.db.execute('SELECT query_sha FROM groups WHERE id=?',(key,)).fetchone()
            if existing:
                if existing[0]!=sha:raise ValueError('source_selector_changed_use_new_root')
                continue
            rows,receipt=self.request(query,'candidates-'+key,64*1024*1024)
            if len(rows)>=500001:raise RuntimeError('candidate_group_limit_not_complete')
            with self.db:
                for row in rows:
                    uri,name=row.get('poi',{}),row.get('name',{})
                    if uri.get('type')!='uri' or not URI.fullmatch(uri.get('value','')) or name.get('type')!='literal' or not name.get('value','').strip():raise ValueError('invalid_candidate_identity')
                    self.db.execute('INSERT OR IGNORE INTO candidates VALUES(?,?)',(uri['value'],name['value']))
                if self.db.execute('SELECT count(*) FROM candidates').fetchone()[0]>500000:raise RuntimeError('country_identity_budget_checkpoint_preserved')
                self.db.execute('INSERT INTO groups VALUES(?,?,?,?)',(key,sha,len(rows),receipt['collectedAt']))
            (self.root/('receipt-candidates-'+key+'.json')).write_text(json.dumps(receipt,indent=2))
            print(json.dumps({'stage':'candidate_group','key':key,'sourceRows':len(rows),'distinctIds':self.db.execute('SELECT count(*) FROM candidates').fetchone()[0],**receipt}),flush=True)

    def details(self):
        while True:
            batch=self.db.execute('SELECT c.uri,c.name FROM candidates c LEFT JOIN observations o ON o.uri=c.uri WHERE o.uri IS NULL ORDER BY c.uri LIMIT 500').fetchall()
            if not batch:break
            query=details_query([x[0] for x in batch]);rows,receipt=self.request(query,'details',6*1024*1024)
            merged={u:{'uri':u,'name':name,'tags':{'name':name},'sourceValues':{},'geometries':[],'countryEvidence':'OSM relation/51477 ogc:sfContains',
                'source':'qlever','sourceFamily':'osm','license':{'id':'ODbL-1.0','attribution':'© OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright'},'collectedAt':receipt['collectedAt']} for u,name in batch}
            seen=set()
            for row in rows:
                u=row.get('poi',{}).get('value');item=merged.get(u)
                if item is None:raise ValueError('unrequested_source_identity')
                seen.add(u)
                for i,key in enumerate(FIELDS):
                    value=row.get('f'+str(i))
                    if value and value.get('type') in ('literal','uri'):
                        values=item['sourceValues'].setdefault(key,[])
                        if value['value'] not in values:values.append(value['value'])
                        item['tags'].setdefault(key,value['value'])
                wkt=row.get('wkt',{}).get('value')
                if wkt and wkt not in item['geometries']:item['geometries'].append(wkt)
            if seen!=set(merged):raise RuntimeError('source_missing_details_checkpoint_preserved')
            with self.db:
                for uri,item in merged.items():self.db.execute('INSERT INTO observations VALUES(?,?)',(uri,json.dumps(item,ensure_ascii=False,separators=(',',':'))))
                self.db.execute('INSERT INTO batches VALUES(?,?,?,?,?)',(receipt['querySha256'],len(batch),receipt['bytes'],receipt['sha256'],receipt['collectedAt']))
            count=self.db.execute('SELECT count(*) FROM observations').fetchone()[0]
            print(json.dumps({'stage':'full_osm_records','records':count,'totalCandidates':self.db.execute('SELECT count(*) FROM candidates').fetchone()[0],**receipt}),flush=True)

    def report(self,error=None):
        count=lambda table:self.db.execute('SELECT count(*) FROM '+table).fetchone()[0]
        report={'country':'DE','countryRelation':51477,'scope':'whole published Germany relation, all supported segments',
            'groupsCompleted':count('groups'),'candidateIdentities':count('candidates'),'fullSourceIdentities':count('observations'),
            'detailsBatches':count('batches'),'networkBytes':self.network,'complete':error is None and count('candidates')==count('observations'),
            'error':error,'sourceSnapshotsMayChange':True,'isBusinessCensus':False,'contactsVerified':False,'paidServicesEnabled':False}
        (self.root/'source-report.json').write_text(json.dumps(report,indent=2));return report


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--niches',required=True);p.add_argument('--seconds',type=int,default=3600)
    a=p.parse_args();c=Collector(a.root,min(a.seconds,7200))
    try:c.candidates(json.loads(Path(a.niches).read_text()));c.details()
    except (RuntimeError,ValueError) as error:
        c.db.execute('INSERT INTO failures(stage,reason,at) VALUES(?,?,?)',('collection',str(error),time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())));c.db.commit()
        print(json.dumps(c.report(str(error))),flush=True);return 1
    print(json.dumps(c.report()),flush=True);return 0


if __name__=='__main__':raise SystemExit(main())
