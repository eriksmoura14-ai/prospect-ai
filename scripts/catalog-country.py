"""Finite country expansion: reviewed administrative polygons, reusable city
crosswalk and conservative streamed reconciliation. Never edits previous assets.
This is an operator command, not an unattended worldwide scanner.
"""
import argparse,csv,gzip,hashlib,importlib.util,json,time,unicodedata
from collections import Counter,defaultdict
from pathlib import Path
import duckdb,numpy as np,shapely
from shapely.geometry import shape,mapping

def normalized(value):
    value=''.join(c for c in unicodedata.normalize('NFKD',value or '') if not unicodedata.category(c).startswith('M'))
    return ' '.join(''.join(c.lower() if c.isalnum() else ' ' for c in value).split())

def polygon(geometry):
    g=shape(geometry)
    if not g.is_valid:g=shapely.make_valid(g)
    if g.geom_type=='Polygon':g=shapely.MultiPolygon([g])
    if g.geom_type!='MultiPolygon' or g.is_empty:raise ValueError('non_polygon_boundary')
    return g

def match_city(city,candidates,states):
    """Name, state and anchor must all agree. No nearest-city reassignment."""
    state=states.get(city['stateCode']);lat=city.get('latitude');lon=city.get('longitude')
    if state is None or not isinstance(lat,(float,int)) or not isinstance(lon,(float,int)):return []
    point=shapely.Point(lon,lat)
    if not state.covers(point):return []
    return [a for a in candidates if normalized(a['name']) in city_names(city) and a['geom'].covers(point) and state.covers(a['geom'].representative_point())]

def city_names(city):
    value=normalized(city['name']);names={value}
    if city.get('countryCode')=='GT':
        if value.endswith(' guatemala'):names.add(value[:-10])
        if value in ('guatemala city','ciudad de guatemala'):names.add('guatemala')
    return names

def state_code(country,properties,inventory=()):
    # Reviewed publisher metadata collision: this historical Distrito Federal
    # polygon was tagged MX-MEX, also used by Estado de Mexico. Current app ISO
    # subdivision CMX is independently confirmed against its city anchors below.
    if country=='MX' and properties['shapeID']=='31927357B79016588373767' and properties['shapeName']=='Distrito Federal' and properties['shapeISO']=='MX-MEX':return 'CMX'
    if country=='GT':
        # Current app registry uses numeric department codes; the reviewed 2017
        # source uses historical alphabetic ISO suffixes. Bridge only an exact,
        # unambiguous department name. City anchors are still checked in polygons.
        codes={r['stateCode'] for r in inventory if r['countryCode']==country and normalized(r['stateName'])==normalized(properties['shapeName'])}
        if len(codes)==1:return next(iter(codes))
    if country=='ES':
        # INE's province shapes publish no ISO code. Only these reviewed label
        # differences are bridged; all other names must match exactly.
        label=normalized(properties['shapeName'])
        aliases={'alava':'araba','balears illes':'islas baleares','coruna':'a coruna','rioja la':'la rioja','palmas las':'las palmas'}
        label=aliases.get(label,label)
        codes={r['stateCode'] for r in inventory if r['countryCode']=='ES' and normalized(r['stateName'])==label}
        if len(codes)==1:return next(iter(codes))
        # Ceuta/Melilla have no app locality entries; preserve their official ISO.
        if label in ('ceuta','melilla'):return {'ceuta':'CE','melilla':'ML'}[label]
    if country=='IT':
        # ISTAT/geoBoundaries ADM3 are provinces, the subdivision used by the
        # app. ADM1 are macroregions and must never stand in for these units.
        label=normalized(properties['shapeName'])
        aliases={'torino':'turin','genova':'genoa','milano':'milan','mantova':'mantua','bolzano':'south tyrol','trento':'trentino','venezia':'venice','padova':'padua','firenze':'florence','roma':'rome','napoli':'naples','aosta':'aosta valley','reggio nell emilia':'reggio emilia','reggio di calabria':'reggio calabria','pesaro e urbino':'pesaro and urbino','massa carrara':'massa and carrara','monza e della brianza':'monza and brianza','sud sardegna':'south sardinia'}
        label=aliases.get(label,label)
        codes={r['stateCode'] for r in inventory if r['countryCode']=='IT' and normalized(r['stateName'])==label}
        if len(codes)==1:return next(iter(codes))
    code=properties['shapeISO']
    return code.split('-',1)[1] if code.startswith(country+'-') else None

def boundaries(args):
    root=Path(args.root);country=args.country;begin=time.monotonic()
    inventory=json.loads(Path(args.inventory).read_text())['cities']
    state_meta=json.loads(Path(args.state_metadata).read_text());city_meta=json.loads(Path(args.city_metadata).read_text())
    reviewed={
        'BR':{'iso3':'BRA','canonical':'municipality','states':27,'cityLicense':'Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)','stateLicense':'Creative Commons Attribution 2.5 Generic','licenseId':'CC-BY-3.0-IGO','licenseUrl':'https://creativecommons.org/licenses/by/3.0/igo/','stateLicenseId':'CC-BY-2.5','attribution':'IBGE; OCHA ROLAC; geoBoundaries','source':'IBGE / OCHA ROLAC via geoBoundaries gbOpen','geometryField':'gjDownloadURL'},
        'MX':{'iso3':'MEX','canonical':'municipios','states':32,'cityLicense':'Creative Commons Attribution 4.0 (CC BY 4.0)','stateLicense':'Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)','licenseId':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','stateLicenseId':'CC-BY-3.0-IGO','attribution':'World Bank; INEGI; geoBoundaries','source':'World Bank / INEGI via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'},
        # HDX cod-ab-col explicitly identifies these 1,122 ADM2 units as
        # municipalities/districts; "Unknown" in gbOpen metadata is not treated
        # as authorization to use arbitrary ADM2 units in other countries.
        'CO':{'iso3':'COL','canonical':'Unknown','states':33,'cityLicense':'Creative Commons Attribution 4.0 International (CC BY 4.0)','stateLicense':'Open Data Commons Open Database License 1.0','licenseId':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','stateLicenseId':'ODbL-1.0','attribution':'DANE; geoBoundaries; state crosswalk © OpenStreetMap contributors / Wambacher','source':'DANE via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'},
        'GT':{'iso3':'GTM','canonical':'Municipio','states':22,'cityLicense':'Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)','stateLicense':'Open Data Commons Open Database License 1.0','licenseId':'CC-BY-3.0-IGO','licenseUrl':'https://creativecommons.org/licenses/by/3.0/igo/','stateLicenseId':'ODbL-1.0','attribution':'CONRED; OCHA FISS; geoBoundaries; state crosswalk © OpenStreetMap contributors / Wambacher','source':'CONRED / OCHA FISS via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'},
        # The reviewed Spanish municipal source is ADM3, not provinces (ADM2).
        'ES':{'iso3':'ESP','canonical':'MUNICIPIOS','cityLevel':'ADM3','stateLevel':'ADM2','states':52,'cityLicense':'Creative Commons Attribution 4.0 International (CC BY 4.0)','stateLicense':'National Institute of Statistics (INE) Data License','licenseId':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','stateLicenseId':'LicenseRef-INE-Reuse','attribution':'IGN Central Registry of Cartography; Open Data ESRI; geoBoundaries. Province crosswalk: elaboración propia con datos del INE, www.ine.es, 2018; no endorsement','source':'IGN / Open Data ESRI via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'},
        'RO':{'iso3':'ROU','canonical':'municipalities','states':42,'cityLicense':'Creative Commons Attribution 4.0 International (CC BY 4.0)','stateLicense':'Creative Commons Attribution 4.0 International (CC BY 4.0)','licenseId':'CC-BY-4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','stateLicenseId':'CC-BY-4.0','attribution':'ANCPI municipal units 2016; World Bank counties 2017; geoBoundaries. Original ANCPI source: OGL-ROU-1.0, data.gov.ro/dataset/unitati-administrative; not a current cadastral survey.','source':'ANCPI / World Bank via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'},
        # Reviewed against ISTAT's official administrative hierarchy: the
        # 7,901 ADM4 units are comuni; ADM3 are its 107 provinces. This explicit
        # country profile does not authorize generic "Unknown" ADM levels.
        'IT':{'iso3':'ITA','canonical':'Unknown','states':107,'cityLevel':'ADM4','stateLevel':'ADM3','cityLicense':'Creative Commons Attribution 3.0 License','stateLicense':'Creative Commons Attribution 3.0 License','licenseId':'CC-BY-3.0','licenseUrl':'https://creativecommons.org/licenses/by/3.0/','stateLicenseId':'CC-BY-3.0','attribution':'ISTAT, National Institute of Statistics; geoBoundaries. Comuni and provinces, 2023; not a current cadastral survey. Official hierarchy: https://www.istat.it/it/archivio/222527','source':'ISTAT via geoBoundaries gbOpen','geometryField':'simplifiedGeometryGeoJSON'}
    }.get(country)
    if not reviewed or city_meta['boundaryCanonical']!=reviewed['canonical'] or city_meta['boundaryISO']!=reviewed['iso3']:raise ValueError('country_hierarchy_requires_review')
    city_level=reviewed.get('cityLevel','ADM2')
    if state_meta['boundaryType']!=reviewed.get('stateLevel','ADM1') or city_meta['boundaryType']!=city_level or state_meta['boundaryISO']!=city_meta['boundaryISO']:raise ValueError('boundary_hierarchy_mismatch')
    # Explicit review of this source and license. A new country needs its own
    # documented hierarchy/license review, not a guessed ADM2 city equivalence.
    if city_meta['boundaryLicense']!=reviewed['cityLicense'] or state_meta['boundaryLicense']!=reviewed['stateLicense']:raise ValueError('unreviewed_boundary_license')
    states={}
    for feature in json.loads(Path(args.states).read_text())['features']:
        code=state_code(country,feature['properties'],inventory)
        if code:
            if code in states:raise ValueError('state_identifier_collision')
            g=polygon(feature['geometry'])
            if country=='MX' and code=='CMX':
                anchors=[r for r in inventory if r['countryCode']=='MX' and r['stateCode']=='CMX']
                if sum(g.covers(shapely.Point(r['longitude'],r['latitude'])) for r in anchors)<3 or not g.covers(shapely.Point(-99.1332,19.4326)):raise ValueError('state_correction_evidence_missing')
            states[code]=g
    if len(states)!=reviewed['states']:raise ValueError('state_crosswalk_incomplete')
    lookup=defaultdict(list);all_areas=[]
    for feature in json.loads(Path(args.cities).read_text())['features']:
        prop=feature['properties']
        if prop['shapeGroup']!=city_meta['boundaryISO'] or prop['shapeType']!=city_level:raise ValueError('wrong_boundary_country_or_level')
        g=polygon(feature['geometry'])
        area={'id':country+':gbOpen:'+prop['shapeID'],'country_code':country,'name':prop['shapeName'],'kind':'municipality','source':reviewed['source'],'vintage':city_meta['boundaryYearRepresented'],'license':{'id':reviewed['licenseId'],'url':reviewed['licenseUrl'],'attribution':reviewed['attribution'],'source':city_meta[reviewed['geometryField']],'stateCrosswalk':{'id':reviewed['stateLicenseId'],'attribution':state_meta['boundarySource'],'vintage':state_meta['boundaryYearRepresented']}},'geom':g}
        lookup[normalized(area['name'])].append(area);all_areas.append(area)
    rows=[];used={};counts=Counter()
    for city in inventory:
        if city['countryCode']!=country:continue
        row={**city,'association_status':'name_state_or_anchor_not_confirmed','coverage_status':'location_pending','next_action':'review_official_country_crosswalk'}
        candidates={a['id']:a for name in city_names(city) for a in lookup[name]}
        matches=match_city(city,list(candidates.values()),states)
        if len(matches)==1:
            a=matches[0];geometry=mapping(a['geom'])
            if shapely.get_num_coordinates(a['geom'])>50000 or len(json.dumps(geometry).encode())>2*1024*1024:
                row['association_status']='boundary_exceeds_runtime_budget'
            else:
                row.update(admin_id=a['id'],association_status='name_state_and_anchor_inside_official_area',coverage_status='partial',next_action='collect_supported_segments_until_50_or_document_source_limits')
                used[a['id']]={**a,'state_code':city['stateCode']}
        elif len(matches)>1:row['association_status']='ambiguous_boundary'
        rows.append(row);counts[row['association_status']]+=1
    root.mkdir(parents=True,exist_ok=True)
    with (root/'mapped-inventory.ndjson').open('w') as out:
        for row in rows:out.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
    wkb=0
    with (root/'admin-areas.ndjson').open('w') as out:
        for a in sorted(used.values(),key=lambda r:r['id']):
            g=a['geom'];geometry=mapping(g);w,s,e,n=g.bounds;wkb+=len(g.wkb)
            key=hashlib.sha256((a['id']+json.dumps(geometry,separators=(',',':'))).encode()).hexdigest()
            out.write(json.dumps({**{k:v for k,v in a.items() if k!='geom'},'geometry':geometry,'bounds':[s,n,w,e],'area_key':key,'source_metadata':{'association':'Country, exact normalized name, state polygon, and app anchor inside municipality','crs':'EPSG:4326','boundarySource':city_meta[reviewed['geometryField']],'boundaryVintage':city_meta['boundaryYearRepresented'],'stateVintage':state_meta['boundaryYearRepresented'],'sourcePublishedSimplification':reviewed['geometryField']=='simplifiedGeometryGeoJSON','limitations':'Historical cartographic boundaries; changes after source vintage require review; not a current cadastral survey'}},ensure_ascii=False,separators=(',',':'))+'\n')
    result={'country':country,'inventoryCities':len(rows),'mappedEntries':sum(bool(r.get('admin_id')) for r in rows),'distinctOfficialAreas':len(used),'wkbBytes':wkb,'counts':dict(counts),'elapsedMs':round((time.monotonic()-begin)*1000),'licenseReviewed':True}
    (root/'boundary-match-report.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)

def helper():
    s=importlib.util.spec_from_file_location('normal',Path(__file__).with_name('catalog-normalize.py'));h=importlib.util.module_from_spec(s);s.loader.exec_module(h);return h

def confirmed_admin_ids(candidates):
    """Explicit municipal parent/district membership can count for both app
    options, while a global business is still counted once. Overlapping peers
    or unreviewed geometric containment never authorize multiple assignments."""
    if len(candidates)==1:return [candidates[0]['id']]
    if len(candidates)!=2:return []
    for child,parent in (candidates,candidates[::-1]):
        meta=child.get('source_metadata',{})
        if child['country_code']==parent['country_code']=='FR' and child['kind'] in ('municipal_district','delegated_municipality') and parent['kind']=='municipality' and meta.get('authority')=='IGN ADMIN EXPRESS / DINUM 2026' and meta.get('parent_admin_id')==parent['id']:
            return [parent['id'],child['id']]
    return []

def geometry(args):
    """Content-addressed state chunks keep new full polygons out of the small
    operations DB. Native PostGIS areas already published are never removed."""
    root=Path(args.root);country=args.country
    with (root/'admin-areas.ndjson').open() as source:areas={r['id']:r for r in map(json.loads,source)}
    states=defaultdict(list);coordinate_conflicts=defaultdict(list)
    with (root/'mapped-inventory.ndjson').open() as inventory:
        for city in map(json.loads,inventory):
            if not city.get('admin_id'):continue
            a=areas[city['admin_id']]
            if country=='FR' and city.get('association_status')=='official_unique_name_department_registry_coordinate_conflict':coordinate_conflicts[city['stateCode']].append(city['id'])
            states[city['stateCode']].append({'city_id':city['id'],'city_key':city['key'],'name':city['name'],'country_code':country,'state_name':city['stateName'],**{k:a[k] for k in ['id','kind','source','vintage','license','bounds','area_key','geometry']}})
    folder=root/'geometry';folder.mkdir(exist_ok=True);uploads=[];manifests=[]
    for state,rows in sorted(states.items()):
        pieces=[];current=[];size=0
        for row in sorted(rows,key=lambda r:r['city_id']):
            n=len(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode())
            if n>1800*1024:raise RuntimeError('single_geometry_budget')
            if current and (size+n>1024*1024 or len(current)>=1000):pieces.append(current);current=[];size=0
            current.append(row);size+=n+1
        if current:pieces.append(current)
        parts=[]
        for index,rows in enumerate(pieces):
            body=json.dumps({'version':1,'countryCode':country,'stateCode':state,'areas':rows},ensure_ascii=False,separators=(',',':')).encode();assert len(body)<=2*1024*1024
            digest=hashlib.sha256(body).hexdigest();file=folder/(country+'-'+state+'-'+digest[:16]+'.json');file.write_bytes(body)
            key='geography/20261023/'+country+'/'+file.name;url='https://br-frosty-voice-b55arvzl.storage.c-7.us-east-2.aws.neon.tech/prospect-public-catalog/'+key
            part={'url':url,'sha256':digest,'bytes':len(body),'cityIds':[r['city_id'] for r in rows]};parts.append(part);uploads.append({**part,'file':str(file),'key':key,'contentType':'application/json'})
        payload={'version':1,'countryCode':country,'stateCode':state,'parts':parts,'boundaryIdentity':'Name, state and anchor confirmed against reviewed licensed administrative polygons','notACurrentCadastralSurvey':True}
        if country=='FR':
            payload['boundaryIdentity']='Reviewed official INSEE identity by exact name and department; original app-coordinate conflicts retained and identified explicitly'
            payload['registryCoordinateConflictCityIds']=sorted(coordinate_conflicts[state])
        manifests.append({'id':'geometry-v1:'+country+':'+state,'payload':payload})
    result={'country':country,'uploads':uploads,'manifests':manifests,'geometryBytes':sum(u['bytes'] for u in uploads),'files':len(uploads),'cities':sum(len(u['cityIds']) for u in uploads)}
    (root/'geometry-publication.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k not in ('uploads','manifests')}),flush=True)

def reconcile(args):
    root=Path(args.root);start=time.monotonic();country=args.country;h=helper()
    files=[Path(p) for p in args.region];assert files and all(p.is_file() for p in files)
    areas=[json.loads(line) for line in (root/'admin-areas.ndjson').open()]
    geoms=np.array([shape(a['geometry']) for a in areas]);tree=shapely.STRtree(geoms);ids=[a['id'] for a in areas]
    def locate(rows):
        pairs=tree.query(shapely.points([r['longitude'] for r in rows],[r['latitude'] for r in rows]),predicate='covered_by');hits=defaultdict(list)
        for i,j in zip(*pairs):hits[int(i)].append(int(j))
        return [confirmed_admin_ids([areas[j] for j in hits[i]]) for i in range(len(rows))]
    db=duckdb.connect(str(root/'country-reconcile.duckdb'),config={'memory_limit':'512MB','threads':'1','preserve_insertion_order':'false','temp_directory':str(root/'spill'),'max_temp_directory_size':'2GB'})
    groups=json.loads(Path(args.niches).read_text());cats={v for values in groups.values() for v in values}
    seen=h.Deduplicator();counts=defaultdict(Counter);before=defaultdict(Counter);sources=defaultdict(Counter);categories=defaultdict(set);totals=Counter();new_ids=[];aliases=[]
    def consume(rows,source,new):
        for r,admins in zip(rows,locate(rows)):
            if r['country_code']!=country:raise ValueError('wrong_business_country')
            identity=('osm/' if source in ('qlever','overpass','geofabrik') else source+'/')+str(r['source_id'])
            previous=seen.accept(identity,country,r['name'],r['latitude'],r['longitude'],r.get('phone'),r.get('address'))
            totals['observations']+=1
            if previous:
                aliases.append({'source':source,'source_id':str(r['source_id']),'canonical':previous,'country_code':country,'reason':'same_identity_or_same_name_within_60m_and_shared_phone_or_nonconflicting_address'});totals['overlaps']+=1
            else:
                totals['unique']+=1;totals['new_unique' if new else 'previous_unique']+=1
                if new:new_ids.append(str(r['source_id']))
                for admin in admins:
                    counts[admin]['unique']+=1
                    if not new:before[admin]['unique']+=1
                    for niche,values in groups.items():
                        if r.get('category')==niche or set(values).intersection([r.get('primary_category'),r.get('basic_category'),*(r.get('category_hierarchy') or []),*(r.get('alternate_categories') or [])]):categories[admin].add(niche)
            for admin in admins:counts[admin]['source_rows']+=1;sources[admin][source]+=1
            if not admins:totals['unassigned_observations']+=1
    old=json.loads(Path(args.legacy).read_text())
    for source in sorted({r['source'] for r in old['discovery_records'] if r['country_code']==country}):
        rows=[{**r,'source_id':str(r['source_id']),'latitude':r['payload']['latitude'],'longitude':r['payload']['longitude']} for r in old['discovery_records'] if r['source']==source and r['country_code']==country]
        consume(rows,source,False)
    fields=['source_id','country_code','name','latitude','longitude','phone','address','category','primary_category','category_hierarchy','alternate_categories','basic_category']
    cur=db.execute('SELECT '+','.join('CAST(source_id AS VARCHAR) AS source_id' if f=='source_id' else f for f in fields)+' FROM read_parquet(?,union_by_name=true) WHERE country_code=? ORDER BY source_id',[[str(p) for p in files],country])
    while True:
        batch=cur.fetchmany(5000)
        if not batch:break
        consume([dict(zip(fields,row)) for row in batch],'overture',True)
        if totals['observations']%100000<5000:print(json.dumps({'stage':'country_reconcile','processed':totals['observations'],'newUnique':totals['new_unique']}),flush=True)
    idsfile=root/'new-canonical-ids.csv'
    with idsfile.open('w') as out:
        writer=csv.writer(out);writer.writerow(['source_id']);writer.writerows([v] for v in new_ids)
    output=root/'new-country-businesses.parquet';part=output.with_suffix('.partial.parquet')
    db.execute("COPY (SELECT n.* REPLACE(CAST(n.source_id AS VARCHAR) AS source_id) FROM read_parquet(?,union_by_name=true) n JOIN read_csv(?,all_varchar=true) i ON CAST(n.source_id AS VARCHAR)=i.source_id WHERE n.country_code=?) TO '"+str(part).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 10000)",[[str(p) for p in files],str(idsfile),country])
    n,unique=db.execute('SELECT count(*),count(DISTINCT source_id) FROM read_parquet(?)',[str(part)]).fetchone()
    if n!=unique or n!=totals['new_unique']:raise RuntimeError('country_output_identity_mismatch')
    part.replace(output)
    with gzip.open(root/'overlap-aliases.ndjson.gz','wt') as out:
        for row in aliases:out.write(json.dumps(row)+'\n')
    summary=Counter();baseline=Counter();examples=[];inventory=[json.loads(line) for line in (root/'mapped-inventory.ndjson').open()]
    with (root/'coverage-updates.ndjson').open('w') as out,(root/'coverage-cities.csv').open('w') as csvout:
        writer=csv.writer(csvout);writer.writerow(['country','state','city','city_key','admin_id','previous_supported','unique_supported','segments','status'])
        for city in inventory:
            admin=city.get('admin_id');n=counts[admin]['unique'] if admin else None;prev=before[admin]['unique'] if admin else None
            status='location_pending' if n is None else 'target_met' if n>=50 else 'partial';summary[status]+=1
            for threshold in (50,100,200):
                if n is not None and n>=threshold:summary['at_least_'+str(threshold)]+=1
                if prev is not None and prev>=threshold:baseline['at_least_'+str(threshold)]+=1
            if n is not None and n>=50:examples.append({'country':country,'state':city['stateCode'],'city':city['name'],'cityId':city['id'],'before':prev,'after':n})
            consulted=[{'source':'overture','release':'2026-10-21.0','scope':'processed_country_regional_partitions','partitions':[p.parent.name.replace('region-','') for p in files],'rows':sources[admin]['overture']}] if admin else []
            if admin:consulted.extend({'source':s,'rows':v,'scope':'previous_city_import'} for s,v in sources[admin].items() if s!='overture')
            reason='Partial reviewed regional sources; unlisted companies and incomplete source coverage remain possible. Historical cartographic boundary vintage applies.' if admin else city['association_status']
            update={'city_key':city['key'],'association_status':city['association_status'],'unique_supported':n,'unique_all':n,'source_rows':counts[admin]['source_rows'] if admin else None,'category_count':len(categories[admin]) if admin else None,'sources':consulted,'limitations':[reason],'coverage_status':status,'next_action':'retain_city_data_and_prioritize_other_under_50_cities' if n is not None and n>=50 else 'complement_permitted_regional_sources_for_under_50' if admin else 'review_official_country_crosswalk'}
            out.write(json.dumps(update,separators=(',',':'))+'\n');writer.writerow([country,city['stateCode'],city['name'],city['key'],admin or '',prev,n,len(categories[admin]) if admin else '',status])
    quality=dict(zip(['records','phone','website','address','valid_location'],db.execute("SELECT count(*),count(*) FILTER(WHERE phone<>''),count(*) FILTER(WHERE website<>''),count(*) FILTER(WHERE address<>''),count(*) FILTER(WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180) FROM read_parquet(?)",[str(output)]).fetchone()))
    result={'country':country,'inventoryDenominator':152970,'countryInventoryCities':len(inventory),'counts':dict(totals),'countrySummary':dict(summary),'baselineCountrySummary':dict(baseline),'newAsset':{**quality,'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest()},'examples':sorted(examples,key=lambda r:r['after'])[:100],'elapsedMs':round((time.monotonic()-start)*1000),'backgroundProcessConfigured':False,'targetPerCity':50,'sourcesAreNotVerifiedBusinesses':True}
    (root/'country-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='examples'}),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['boundaries','reconcile','geometry']);parser.add_argument('--root',required=True);parser.add_argument('--country',required=True);parser.add_argument('--inventory');parser.add_argument('--state-metadata');parser.add_argument('--city-metadata');parser.add_argument('--states');parser.add_argument('--cities');parser.add_argument('--region',action='append');parser.add_argument('--legacy');parser.add_argument('--niches');args=parser.parse_args()
    if args.action=='boundaries':boundaries(args)
    elif args.action=='geometry':geometry(args)
    else:reconcile(args)
if __name__=='__main__':main()
