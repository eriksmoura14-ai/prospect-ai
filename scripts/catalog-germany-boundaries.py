"""Confirm only pending German city options against published municipal AGS.
Exact names/declared aliases, state codes and anchor containment are mandatory.
Districts with five-digit codes cannot masquerade as eight-digit municipalities.
"""
import argparse
import functools
import gzip
import hashlib
import json
import re
import time
import unicodedata
from pathlib import Path

import pyproj
import requests
import shapely
from shapely.geometry import Point, mapping
from shapely.ops import transform

STATES=dict(zip(['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16'],
               ['SH','HH','NI','HB','NW','HE','RP','BW','BY','SL','BE','BB','MV','SN','ST','TH']))


def german_name(value):
    value=value.casefold().replace('ä','ae').replace('ö','oe').replace('ü','ue')
    value=''.join(c for c in unicodedata.normalize('NFKD',value) if not unicodedata.category(c).startswith('M'))
    return ' '.join(''.join(c if c.isalnum() else ' ' for c in value).split())


def municipal(row):
    ags=row.get('ags',row.get('agsRef',{})).get('value','')
    level=str(row.get('level',{}).get('value',''))
    state=STATES.get(ags[:2]);name=row.get('name',{}).get('value','')
    if not re.fullmatch(r'[0-9]{8}',ags) or not state:return None
    if level=='4' and not (state in ('BE','HH') and name in ('Berlin','Hamburg')):return None
    if level=='6' and row.get('place',{}).get('value') not in ('city','town') and row.get('designation',{}).get('value') not in ('kreisfreie Stadt','Stadtkreis'):return None
    if level not in ('4','6','8'):return None
    return state,ags


def published_names(source):
    names=set()
    for field in ('name','english','alt','official'):
        for value in source.get(field,{}).get('value','').split(';'):
            if value.strip():names.add(german_name(value))
    return names


def match_plan(inventory,candidates,include_existing=False):
    lookup={}
    for source in candidates:
        identity=municipal(source)
        if identity is None:continue
        for name in published_names(source):
            lookup.setdefault((identity[0],name),{})[source['poi']['value']]=source
    result=[]
    for city in inventory:
        if city['country_code']!='DE' or not include_existing and city['unique_supported'] is not None:continue
        matches=lookup.get((city['state_code'],german_name(city['name'])),{})
        if len(matches)==1:result.append({'city':city,'source':next(iter(matches.values()))})
    return result


@functools.cache
def projections():
    return (pyproj.Transformer.from_crs(4326,3035,always_xy=True).transform,
            pyproj.Transformer.from_crs(3035,4326,always_xy=True).transform)


def simplify_bounded(geometry):
    if not geometry.is_valid or geometry.is_empty or geometry.geom_type not in ('Polygon','MultiPolygon'):raise ValueError('invalid_municipal_geometry')
    projected=None
    for tolerance in (0,1,2,5):
        if tolerance:
            forward,reverse=projections()
            projected=projected if projected is not None else transform(forward,geometry)
            simple=projected.simplify(tolerance,preserve_topology=True)
            if projected.hausdorff_distance(simple)>tolerance+.01:continue
            candidate=transform(reverse,simple)
        else:candidate=geometry
        size=len(json.dumps(mapping(candidate),separators=(',',':')).encode())
        if candidate.is_valid and shapely.get_num_coordinates(candidate)<=50000 and size<=1700000:return candidate,tolerance
    raise ValueError('municipal_geometry_exceeds_runtime_budget')


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--include-existing',action='store_true');ap.add_argument('--batch-size',type=int,default=5);ap.add_argument('--seconds',type=int,default=900);a=ap.parse_args();root=Path(a.root)
    if not 1<=a.batch_size<=20 or not 1<=a.seconds<=900:raise ValueError('municipal_operator_budget')
    deadline=time.monotonic()+a.seconds;network=0
    candidates=json.loads((root/'municipality-candidates-typed.json').read_text())
    candidates=candidates['results']['bindings'] if isinstance(candidates,dict) else candidates
    plan=match_plan(json.loads((root/'inventory.json').read_text()),candidates,a.include_existing)
    stem='audited' if a.include_existing else 'new'
    (root/(stem+'-municipality-match-plan.json')).write_text(json.dumps(plan,ensure_ascii=False))
    raw=root/'municipal-raw';raw.mkdir(exist_ok=True)
    urls=sorted({x['source']['poi']['value'] for x in plan});session=requests.Session();session.headers.update({'Accept':'application/sparql-results+json','User-Agent':'ProspectAI/1.0 finite DE licensed municipality audit'})
    failures=[]
    for offset in range(0,len(urls),a.batch_size):
        if time.monotonic()>deadline:break
        batch=urls[offset:offset+a.batch_size];pending=[u for u in batch if not (raw/(u.rsplit('/',1)[1]+'.json.gz')).exists()]
        if not pending:continue
        q='PREFIX geo:<http://www.opengis.net/ont/geosparql#> SELECT ?poi ?wkt WHERE { VALUES ?poi { '+' '.join('<'+u+'>' for u in pending)+' } ?poi geo:hasGeometry/geo:asWKT ?wkt . }'
        try:
            r=session.get('https://qlever.dev/api/osm-planet',params={'query':q},timeout=(8,45),allow_redirects=False)
            if r.status_code in (429,503):raise RuntimeError('source_cooldown_stop')
            network+=len(r.content)
            if network>128*1024*1024:raise RuntimeError('municipal_network_budget_stop_checkpoint_preserved')
            if r.status_code!=200 or len(r.content)>12*1024*1024:raise ValueError('municipal_source_budget_or_http')
            data=r.json();rows=data.get('results',{}).get('bindings')
            if not isinstance(rows,list) or data.get('exception'):raise ValueError('invalid_municipal_source_response')
            grouped={u:[] for u in pending}
            for row in rows:
                u=row.get('poi',{}).get('value');wkt=row.get('wkt',{}).get('value')
                if u in grouped and wkt and wkt not in grouped[u]:grouped[u].append(wkt)
            for u,geometries in grouped.items():
                payload={'uri':u,'geometries':geometries,'query':q,'collectedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'responseSha256':hashlib.sha256(r.content).hexdigest()}
                with gzip.open(raw/(u.rsplit('/',1)[1]+'.json.gz'),'wt') as out:json.dump(payload,out)
        except (requests.RequestException,ValueError) as e:failures.append({'offset':offset,'reason':'source_unavailable_or_invalid'});continue
        print(json.dumps({'municipalGeometryCandidatesProcessed':min(offset+a.batch_size,len(urls)),'total':len(urls),'networkBytes':network}),flush=True);time.sleep(.5)
    rows=[];rejected=[]
    for item in plan:
        city,source=item['city'],item['source'];uri=source['poi']['value'];file=raw/(uri.rsplit('/',1)[1]+'.json.gz')
        try:
            if municipal(source) is None or municipal(source)[0]!=city['state_code']:raise ValueError('municipal_identity_mismatch')
            if german_name(city['name']) not in published_names(source):raise ValueError('municipal_name_mismatch')
            if not file.exists():raise ValueError('municipal_geometry_unavailable')
            data=json.loads(gzip.open(file,'rt').read());shapes=[shapely.from_wkt(w) for w in data['geometries']]
            shapes=[s for s in shapes if s.geom_type in ('Polygon','MultiPolygon')]
            if not shapes or any(not s.equals(shapes[0]) for s in shapes[1:]):raise ValueError('municipal_geometry_ambiguous_or_missing')
            original=shapes[0];anchor=Point(float(city['longitude']),float(city['latitude']))
            if not original.covers(anchor):raise ValueError('municipal_anchor_outside')
            geometry,tolerance=simplify_bounded(original)
            if not geometry.covers(anchor):raise ValueError('municipal_anchor_changed_by_generalization')
            w,s,e,n=geometry.bounds
            if not (5<w<e<16 and 47<s<n<56 and n-s<=10 and e-w<=15):raise ValueError('municipal_bounds_invalid')
            geom=mapping(geometry);key=hashlib.sha256(json.dumps(['DE',uri,geom],sort_keys=True,separators=(',',':')).encode()).hexdigest()
            rows.append({'city_id':int(city['city_id']),'city_key':city['city_key'],'name':city['name'],'country_code':'DE','state_name':city['state_name'],
                'id':'OSM:'+uri.rsplit('/',2)[-2]+'/'+uri.rsplit('/',1)[-1],'kind':'municipality','source':'OpenStreetMap via QLever; published German AGS municipal identity',
                'vintage':data['collectedAt'][:10],'license':{'id':'ODbL-1.0','url':'https://opendatacommons.org/licenses/odbl/1-0/','attribution':'© OpenStreetMap contributors','shareAlike':True},
                'bounds':[s,n,w,e],'area_key':key,'geometry':geom,'source_metadata':{'uri':uri,'AGS':municipal(source)[1],'adminLevel':source['level']['value'],
                    'publishedName':source['name']['value'],'simplificationMeters':tolerance,'rawGeometryFile':file.name,'historicalCartographicNotCadastral':True}})
        except (ValueError,TypeError,shapely.errors.GEOSException) as error:rejected.append({'cityKey':city['city_key'],'reason':str(error)})
    (root/(stem+'-municipal-areas.json')).write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')))
    report={'nameStateCandidates':len(plan),'confirmedNewMunicipalScopes':len(rows),'rejected':rejected,'sourceFailures':failures,'fixedRadiusUsed':False,'maximumSimplificationMeters':5}
    (root/(stem+'-municipal-report.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('rejected','sourceFailures')}))


if __name__=='__main__':main()
