"""Bounded, anonymous Overture Places GeoParquet reader. No planet download.

DuckDB reads selected columns/row groups through a loopback range gateway. Only
official STAC assets are registered; all outbound requests use Requests' inherited
proxy and verified TLS. The gateway enforces an aggregate byte budget even when
DuckDB prefetches. Install httpfs explicitly with setup-discovery.py first.
"""
import concurrent.futures,json,math,os,re,struct,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit
import duckdb,requests
from pathlib import Path

RELEASE="2026-10-21.0"
STAC=f"https://stac.overturemaps.org/{RELEASE}/places/place/collection.json"

class BudgetError(Exception):
    def __init__(self,message,http_status=None,retry_after=None):
        super().__init__(message);self.http_status=http_status;self.retry_after=retry_after

def polygon_filter(geometry,bounds):
    """Prepare a bounded ST_Covers-equivalent predicate for Overture Point WKB.

    Filtering after LIMIT lets a dense neighbour exhaust an irregular city's
    candidate budget. Run this predicate in DuckDB's WHERE before its LIMIT.
    No spatial extension, Shapely, network request or arbitrary code is needed.
    """
    if geometry is None:return None
    if not isinstance(geometry,dict) or geometry.get('type') not in ('Polygon','MultiPolygon'):raise ValueError('invalid_geometry')
    if len(json.dumps(geometry).encode())>2*1024*1024:raise ValueError('geometry_size')
    polygons=[geometry.get('coordinates')] if geometry['type']=='Polygon' else geometry.get('coordinates')
    if not isinstance(polygons,list) or not polygons:raise ValueError('invalid_geometry')
    south,north,west,east=bounds;vertices=0
    for polygon in polygons:
        if not isinstance(polygon,list) or not polygon:raise ValueError('invalid_geometry')
        for ring in polygon:
            if not isinstance(ring,list) or len(ring)<4 or ring[0]!=ring[-1]:raise ValueError('invalid_geometry')
            for point in ring:
                vertices+=1
                if vertices>50000 or not isinstance(point,(list,tuple)) or len(point)!=2 or not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in point):raise ValueError('invalid_geometry')
                x,y=point
                if not west-1e-6<=x<=east+1e-6 or not south-1e-6<=y<=north+1e-6:raise ValueError('geometry_bounds')
    def ring_position(x,y,ring):
        inside=False
        ax,ay=ring[-1]
        for bx,by in ring:
            cross=(x-ax)*(by-ay)-(y-ay)*(bx-ax)
            if abs(cross)<=1e-12 and min(ax,bx)<=x<=max(ax,bx) and min(ay,by)<=y<=max(ay,by):return 0
            if (ay>y)!=(by>y) and x<(bx-ax)*(y-ay)/(by-ay)+ax:inside=not inside
            ax,ay=bx,by
        return 1 if inside else -1
    def covers(binary):
        if not isinstance(binary,bytes) or len(binary)!=21 or binary[0] not in (0,1):raise BudgetError('non_point_geometry')
        endian='<' if binary[0] else '>'
        if struct.unpack(endian+'I',binary[1:5])[0]!=1:raise BudgetError('non_point_geometry')
        x,y=struct.unpack(endian+'dd',binary[5:21])
        if not math.isfinite(x) or not math.isfinite(y):raise BudgetError('invalid_point_geometry')
        return any(ring_position(x,y,polygon[0])>=0 and all(ring_position(x,y,hole)<=0 for hole in polygon[1:]) for polygon in polygons)
    return covers

def extract(spec):
    started=time.monotonic()
    bounds=spec["bounds"]
    if len(bounds)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in bounds):raise ValueError("invalid_bounds")
    south,north,west,east=bounds
    if not (-90<=south<north<=90 and -180<=west<east<=180 and north-south<=10 and east-west<=15):raise ValueError("invalid_bounds")
    maximum=min(int(spec.get("maxBytes",32*1024*1024)),128*1024*1024)
    limit=min(int(spec.get("maxRows",3000)),10000)
    deadline=started+min(int(spec.get("timeoutSeconds",60)),75)
    categories=spec.get("categories",[])
    if not categories or not all(isinstance(v,str) and re.fullmatch(r"[a-z_]{2,100}",v) for v in categories):raise ValueError("unsupported_category")
    covers=polygon_filter(spec.get('geometry'),bounds)
    metrics={"bytes":0,"requests":0,"files":0,"budgetBytes":maximum}
    reserved=0
    lock=threading.Lock()
    transport_errors=[]
    headers={"User-Agent":"ProspectAI-regional-reader/0.9 (+https://github.com/eriksmoura14-ai/prospect-ai)"}
    def request(url,range_header=None):
        if time.monotonic()>=deadline:raise BudgetError("deadline")
        r=requests.get(url,headers={**headers,**({"Range":range_header,"Accept-Encoding":"identity"} if range_header else {})},stream=True,timeout=(5,max(1,min(15,deadline-time.monotonic()))),allow_redirects=False)
        try:
            if range_header:
                if r.status_code!=206:raise BudgetError("range_http_"+str(r.status_code),r.status_code,r.headers.get("Retry-After"))
                first,last=map(int,range_header.removeprefix("bytes=").split("-"))
                if int(r.headers.get("Content-Length",0))!=last-first+1:raise BudgetError("invalid_range_length")
            elif r.status_code!=200:raise BudgetError("metadata_http_"+str(r.status_code),r.status_code,r.headers.get("Retry-After"))
            chunks=[]
            with lock:metrics["requests"]+=1
            for chunk in r.iter_content(65536):
                with lock:
                    if metrics["bytes"]+len(chunk)>maximum:raise BudgetError("byte_budget")
                    metrics["bytes"]+=len(chunk)
                if time.monotonic()>=deadline:raise BudgetError("deadline")
                chunks.append(chunk)
            return b"".join(chunks),r.headers
        finally:r.close()
    cache=Path(os.environ.get("OVERTURE_CACHE_DIR",str(Path(__file__).resolve().parents[1]/".cache/overture")))/f"{RELEASE}-places-stac.json"
    items=None
    try:
        if cache.stat().st_size<=1024*1024:items=json.loads(cache.read_text())
        if not isinstance(items,list) or len(items)>64:items=None
    except (OSError,ValueError):pass
    def item(url):
        if not url.startswith(f"https://stac.overturemaps.org/{RELEASE}/places/place/"):raise BudgetError("unapproved_catalog")
        return json.loads(request(url)[0])
    if items is None:
        collection=json.loads(request(STAC)[0])
        links=[v["href"] for v in collection["links"] if v.get("rel")=="item"]
        if len(links)>64:raise BudgetError("metadata_budget")
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:items=list(executor.map(item,links))
        try:
            cache.parent.mkdir(parents=True,exist_ok=True)
            temporary=cache.with_suffix(f".{os.getpid()}.tmp");temporary.write_text(json.dumps(items));temporary.replace(cache)
        except OSError:pass # Read-only filesystems still work within the network budget.
    assets=[]
    for data in items:
        w,s,e,n=data["bbox"]
        if e<west or w>east or n<south or s>north:continue
        asset=data["assets"]["aws"]
        url=asset["href"];parsed=urlsplit(url)
        if parsed.scheme!="https" or parsed.netloc!="overturemaps-us-west-2.s3.us-west-2.amazonaws.com" or not parsed.path.startswith(f"/release/{RELEASE}/theme=places/type=place/") or not parsed.path.endswith(".parquet") or parsed.query:raise BudgetError("unapproved_asset")
        assets.append({"url":url,"size":int(asset["file:size"])})
    metrics["files"]=len(assets)
    if not assets:return {"release":RELEASE,"rows":[],"truncated":False,"metrics":metrics}
    class Gateway(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_HEAD(self):
            try:asset=assets[int(self.path.removesuffix(".parquet").lstrip("/"))]
            except (IndexError,ValueError):self.send_error(404);return
            self.send_response(200);self.send_header("Content-Length",asset["size"]);self.send_header("Accept-Ranges","bytes");self.end_headers()
        def do_GET(self):
            nonlocal reserved
            allocation=0
            try:
                asset=assets[int(self.path.removesuffix(".parquet").lstrip("/"))]
                match=re.fullmatch(r"bytes=(\d*)-(\d*)",self.headers.get("Range",""))
                if not match:raise BudgetError("range_required")
                first,last=match.groups()
                start=int(first) if first else asset["size"]-int(last)
                end=int(last) if first and last else asset["size"]-1
                if start<0 or end<start or end>=asset["size"] or end-start+1>8*1024*1024:raise BudgetError("range_budget")
                with lock:
                    if metrics["bytes"]+reserved+end-start+1>maximum:raise BudgetError("byte_budget")
                    allocation=end-start+1;reserved+=allocation
                data,response_headers=request(asset["url"],f"bytes={start}-{end}")
                if len(data)!=end-start+1 or response_headers.get("Content-Range")!=f"bytes {start}-{end}/{asset['size']}":raise BudgetError("invalid_range")
                self.send_response(206);self.send_header("Content-Length",len(data));self.send_header("Content-Range",response_headers["Content-Range"]);self.send_header("Accept-Ranges","bytes");self.end_headers();self.wfile.write(data)
            except Exception as error:
                transport_errors.append(error);self.send_error(503,"Regional read stopped by source or budget")
            finally:
                with lock:reserved-=allocation
    gateway=ThreadingHTTPServer(("127.0.0.1",0),Gateway)
    threading.Thread(target=gateway.serve_forever,daemon=True).start()
    extension_config={"extension_directory":str(Path(os.environ["DUCKDB_EXTENSION_DIRECTORY"]).resolve())} if os.environ.get("DUCKDB_EXTENSION_DIRECTORY") else {}
    con=duckdb.connect(config={**extension_config,"memory_limit":"256MB","threads":"1","enable_external_access":"true","autoinstall_known_extensions":"false","autoload_known_extensions":"false"})
    timer=threading.Timer(max(1,deadline-time.monotonic()),con.interrupt);timer.start()
    try:
        con.execute("LOAD httpfs")
        con.execute("SET http_timeout=10; SET http_retries=0; SET enable_http_metadata_cache=true")
        if covers:con.create_function('inside_selected_area',covers,['BLOB'],'BOOLEAN')
        urls=[f"http://127.0.0.1:{gateway.server_port}/{i}.parquet" for i in range(len(assets))]
        sql="""SELECT to_json(struct_pack(id:=id,names:=names,bbox:=bbox,taxonomy:=taxonomy,basic_category:=basic_category,
          phones:=phones,websites:=websites,addresses:=addresses,confidence:=confidence,sources:=sources,operating_status:=operating_status,geometry_wkb:=hex(geometry)))
          FROM read_parquet(?,hive_partitioning=false) WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?
          AND (list_has_any(taxonomy.hierarchy,?) OR list_contains(?,taxonomy.primary) OR list_contains(?,basic_category))
          AND (operating_status IS NULL OR operating_status!='permanently_closed') AND (confidence IS NULL OR confidence>=0.5)"""
        if covers:sql+=' AND inside_selected_area(geometry)'
        sql+=' LIMIT ?'
        values=con.execute(sql,[urls,west,east,south,north,categories,categories,categories,limit+1]).fetchall()
        rows=[json.loads(v[0]) for v in values[:limit]]
        for row in rows:
            data=bytes.fromhex(row.pop("geometry_wkb"))
            endian="<" if data[0]==1 else ">"
            if len(data)!=21 or struct.unpack(endian+"I",data[1:5])[0]!=1:raise BudgetError("non_point_geometry")
            row["geometry"]={"type":"Point","coordinates":list(struct.unpack(endian+"dd",data[5:21]))}
        metrics.update({"raw":len(values),"elapsedMs":round((time.monotonic()-started)*1000)})
        return {"release":RELEASE,"rows":rows,"truncated":len(values)>limit,"metrics":metrics}
    except Exception:
        if transport_errors:raise transport_errors[0]
        raise
    finally:
        timer.cancel();con.close();gateway.shutdown();gateway.server_close()

if __name__=="__main__":
    try:print(json.dumps(extract(json.loads(sys.stdin.read(2*1024*1024))),ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error":"overture_budget_or_source","reason":type(error).__name__,"detail":str(error)[:500],"httpStatus":getattr(error,'http_status',None),"retryAfter":getattr(error,'retry_after',None)}))
        sys.exit(1)
