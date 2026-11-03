"""Inspect/extract one country's published division hierarchy, without geometry.
This reads the reviewed public divisions table through the same bounded range
transport; it never queries Nominatim or reassigns an app city automatically.
"""
import argparse,bisect,hashlib,importlib.util,json,re,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import duckdb

spec=importlib.util.spec_from_file_location('division_reader',Path(__file__).with_name('catalog-division-read.py'));reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--assets',required=True);p.add_argument('--country',required=True);p.add_argument('--probe',action='store_true');p.add_argument('--metadata',action='store_true');p.add_argument('--country-rows-index',action='store_true');p.add_argument('--offline',action='store_true');p.add_argument('--first-row',type=int);p.add_argument('--last-row',type=int);a=p.parse_args()
 if not re.fullmatch('[A-Z]{2}',a.country):raise ValueError('country_identity')
 if (a.first_row is None)!=(a.last_row is None) or a.first_row is not None and not 0<=a.first_row<=a.last_row<100000000:raise ValueError('row_window')
 assets=[v for v in json.loads(Path(a.assets).read_text()) if v['theme']=='divisions-point-stac' and v['id']=='00000']
 if len(assets)!=1:raise ValueError('one_reviewed_hierarchy_asset_required')
 root=Path(a.root);root.mkdir(parents=True,exist_ok=True);source=reader.RangeSource(assets[0],root/'ranges-division-00000',offline=a.offline,layer='division');started=time.monotonic()
 class Gateway(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_HEAD(self):self.send_response(200);self.send_header('Content-Length',source.size);self.send_header('Accept-Ranges','bytes');self.end_headers()
  def do_GET(self):
   try:
    m=re.fullmatch(r'bytes=(\d*)-(\d*)',self.headers.get('Range',''))
    if not m:raise RuntimeError('range_required')
    first,last=m.groups();start=int(first) if first else source.size-int(last);end=int(last) if first and last else source.size-1;body=source.request(start,end)
    self.send_response(206);self.send_header('Content-Length',len(body));self.send_header('Content-Range',f'bytes {start}-{end}/{source.size}');self.end_headers();self.wfile.write(body)
   except Exception as error:source.errors.append(str(error));self.send_error(503,'Source or resource budget')
 server=ThreadingHTTPServer(('127.0.0.1',0),Gateway);threading.Thread(target=server.serve_forever,daemon=True).start();db=duckdb.connect(config={'memory_limit':'512MB','threads':'1','autoinstall_known_extensions':'false','autoload_known_extensions':'false'});timer=threading.Timer(180,db.interrupt);timer.start()
 try:
  db.execute('LOAD httpfs');db.execute('SET http_retries=0;SET http_timeout=35;SET enable_http_metadata_cache=true');url='http://127.0.0.1:'+str(server.server_address[1])+'/hierarchy.parquet'
  if a.probe:
   columns=db.execute('DESCRIBE SELECT * FROM read_parquet(?)',[url]).fetchall();report={'columns':columns,'transport':source.metrics(),'geometryRead':False};(root/'hierarchy-schema-probe.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
  elif a.country_rows_index:
   groups=db.execute("SELECT row_group_id,row_group_num_rows FROM parquet_metadata(?) WHERE path_in_schema='country' ORDER BY row_group_id",[url]).fetchall();boundaries=[];ends=[];total=0
   for identity,count in groups:boundaries.append({'rowGroup':identity,'firstRow':total,'lastRow':total+count-1,'rows':count,'countries':{},'seenRows':0});total+=count;ends.append(total)
   cursor=db.execute('SELECT file_row_number,country FROM read_parquet(?,file_row_number=true)',[url]);seen=0
   while True:
    batch=cursor.fetchmany(25000)
    if not batch:break
    for position,code in batch:
     group=boundaries[bisect.bisect_right(ends,position)];group['seenRows']+=1
     if code:group['countries'][code]=group['countries'].get(code,0)+1
    seen+=len(batch)
    plan={'release':reader.RELEASE,'source':source.url,'rowGroups':boundaries,'seenRows':seen,'expectedRows':total,'complete':False,'businessCoverage':False,'geometryRead':False};(root/'hierarchy-country-row-index.partial.json').write_text(json.dumps(plan,indent=2))
   if seen!=total:raise RuntimeError('incomplete_country_row_index')
   plan.update(complete=True,transport=source.metrics());(root/'hierarchy-country-row-index.json').write_text(json.dumps(plan,indent=2));print(json.dumps({'countryRowIndexComplete':True,'rowGroups':len(groups),'metadataRows':seen,'transport':source.metrics(),'businessCoverage':False}),flush=True)
  elif a.metadata:
   rows=db.execute("SELECT row_group_id,row_group_num_rows,path_in_schema,stats_min_value,stats_max_value,total_compressed_size FROM parquet_metadata(?) WHERE path_in_schema IN ('country','id','subtype')",[url]).fetchall();columns=[v[0] for v in db.description];(root/'hierarchy-row-groups.json').write_text(json.dumps([dict(zip(columns,v)) for v in rows],indent=2));print(json.dumps({'rowGroups':len({v[0] for v in rows}),'transport':source.metrics()}),flush=True)
  else:
   window='-rows'+str(a.first_row)+'-'+str(a.last_row) if a.first_row is not None else '';out=root/(a.country+window+'-division-hierarchy.parquet');tmp=out.with_suffix('.partial.parquet');predicate=' AND file_row_number BETWEEN ? AND ?' if a.first_row is not None else '';params=[url,a.country]+([a.first_row,a.last_row] if a.first_row is not None else [])
   db.execute("COPY (SELECT id,country,region,names,subtype,admin_level,parent_division_id,hierarchies,local_type,sources FROM read_parquet(?,file_row_number=true) WHERE country=?"+predicate+") TO '"+str(tmp).replace("'","''")+"' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 2048)",params);tmp.replace(out)
   count=db.execute('SELECT count(*) FROM read_parquet(?)',[str(out)]).fetchone()[0];report={'country':a.country,'records':count,'file':str(out),'bytes':out.stat().st_size,'sha256':hashlib.file_digest(out.open('rb'),'sha256').hexdigest(),'release':reader.RELEASE,'license':'ODbL-1.0','transport':source.metrics(),'elapsedMs':round((time.monotonic()-started)*1000),'geometryRead':False,'completeCountryHierarchyExtract':a.first_row is None,'businessCoverage':False,'automaticCityReassignment':False};out.with_name(out.stem+'-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
 except Exception:
  if source.errors:raise RuntimeError(source.errors[0])
  raise
 finally:timer.cancel();db.close();server.shutdown();server.server_close()

if __name__=='__main__':main()
