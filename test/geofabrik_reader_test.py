"""Fictional PBF integration; no public download or contributor metadata."""
import json,subprocess,sys,tempfile,unittest
from pathlib import Path
import osmium
SCRIPT=Path(__file__).resolve().parents[1]/'scripts/geofabrik-region.py'
class GeofabrikTests(unittest.TestCase):
    def test_nodes_ways_contacts_and_geographic_budget(self):
        with tempfile.TemporaryDirectory() as temp:
            file=Path(temp)/'fixture.osm.pbf'
            writer=osmium.SimpleWriter(str(file))
            writer.add_node(osmium.osm.mutable.Node(id=1,location=(1,1),tags={'name':'Fictional Cafe','amenity':'cafe','phone':'+12125550100','email':'unnecessary'}))
            for i,point in enumerate([(1,1),(1.2,1),(1.2,1.2),(1,1)],10):writer.add_node(osmium.osm.mutable.Node(id=i,location=point))
            writer.add_way(osmium.osm.mutable.Way(id=5,nodes=[10,11,12,13],tags={'name':'Fictional Restaurant','amenity':'restaurant'}))
            writer.close()
            result=subprocess.run([sys.executable,str(SCRIPT),str(file),'--bounds=0,2,0,2'],capture_output=True,text=True,timeout=15,check=True)
            rows=[json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(len(rows),2);self.assertEqual(rows[1]['locationMethod'],'geometry_bbox_center')
            self.assertNotIn('email',rows[0]['tags']);self.assertNotIn('uid',rows[0])
            result=subprocess.run([sys.executable,str(SCRIPT),str(file),'--bounds=0,2,0,2','--max-bytes=1'],capture_output=True,timeout=15)
            self.assertNotEqual(result.returncode,0)
if __name__=='__main__':unittest.main()
