"""Extract commercial nodes/ways from a local, operator-chosen OSM PBF.
No downloads. Pipe NDJSON to the discovery import command. Way coordinates are
explicitly bounding-box centers, not verified entrances. No contributor metadata.
"""
import argparse,json,os,time
import osmium
import resource

def main():
    resource.setrlimit(resource.RLIMIT_AS,(1024*1024*1024,1024*1024*1024))
    parser=argparse.ArgumentParser();parser.add_argument("file");parser.add_argument("--bounds",required=True,help="south,north,west,east");parser.add_argument("--max-bytes",type=int,default=134217728);parser.add_argument("--max-records",type=int,default=5000)
    args=parser.parse_args()
    if not args.file.endswith(".osm.pbf") or os.path.getsize(args.file)>min(args.max_bytes,536870912):raise ValueError("PBF exceeds explicit input budget")
    south,north,west,east=map(float,args.bounds.split(","))
    if not (-90<=south<north<=90 and -180<=west<east<=180 and north-south<=10 and east-west<=15):raise ValueError("Invalid bounded region")
    deadline=time.monotonic()+60
    class Stop(Exception):pass
    class Handler(osmium.SimpleHandler):
        count=0
        def emit(self,obj,kind,lon,lat):
            if time.monotonic()>deadline:raise Stop("time_budget")
            if not west<=lon<=east or not south<=lat<=north:return
            tags={tag.k:tag.v for tag in obj.tags}
            if not tags.get("name") or not any(tags.get(k) for k in ["shop","craft","office","amenity","service"]):return
            allowed=["name","shop","craft","office","amenity","service","hairdresser","cuisine","disused","abandoned","phone","contact:phone","mobile","contact:mobile","whatsapp","contact:whatsapp","website","contact:website","url","addr:full","addr:street","addr:housenumber","addr:postcode","addr:city"]
            print(json.dumps({"type":kind,"id":str(obj.id),"lon":lon,"lat":lat,"locationMethod":"geometry_bbox_center" if kind=="way" else "source_point","tags":{k:v for k,v in tags.items() if k in allowed}},ensure_ascii=False),flush=True)
            self.count+=1
            if self.count>=min(args.max_records,10000):raise Stop("record_budget")
        def node(self,obj):
            if obj.location.valid():self.emit(obj,"node",obj.location.lon,obj.location.lat)
        def way(self,obj):
            if time.monotonic()>deadline:raise Stop("time_budget")
            if not obj.tags.get("name") or not any(obj.tags.get(k) for k in ["shop","craft","office","amenity","service"]):return
            points=[(n.lon,n.lat) for n in obj.nodes if n.location.valid()]
            if points:self.emit(obj,"way",(min(p[0] for p in points)+max(p[0] for p in points))/2,(min(p[1] for p in points)+max(p[1] for p in points))/2)
    handler=Handler()
    try:handler.apply_file(args.file,locations=True,idx="flex_mem")
    except Stop as error:
        print(json.dumps({"partial":True,"reason":str(error),"records":handler.count}),file=__import__("sys").stderr);return
    print(json.dumps({"partial":False,"records":handler.count}),file=__import__("sys").stderr)
if __name__=="__main__":main()
