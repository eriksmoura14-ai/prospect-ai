import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import duckdb
import shapely

spec=importlib.util.spec_from_file_location('world_serving',Path(__file__).parents[1]/'scripts/catalog-world-serving.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ServingRegression(unittest.TestCase):
    def test_eight_existing_files_plus_new_data_are_repartitioned_without_record_loss(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'businesses').mkdir();index=m.w.Index(root/'index.sqlite')
            index.db.execute('INSERT INTO areas VALUES(?,?,?,?)',('town','US','{}',shapely.to_wkb(shapely.box(0,0,10,10))))
            db=duckdb.connect();old=[]
            for i in range(8):
                file=root/f'old-{i}.parquet'
                db.execute(f"COPY (SELECT 'source-{i}' AS source_id,'US' AS country_code,{i+1}.0 AS longitude,1.0 AS latitude,'Original label {i}' AS name) TO ? (FORMAT PARQUET)",[str(file)])
                digest=m.w.sha(file);file.rename(root/('serving-original-'+digest+'.parquet'))
                old.append({'id':'old-'+str(i),'url':m.w.ORIGIN+f'fixture/{i}','bytes':(root/('serving-original-'+digest+'.parquet')).stat().st_size,'records':1,'sha256':digest,'bounds':[i+1.,1.,i+1.,1.],'countries':['US']})
            file=root/'businesses'/'new.parquet'
            db.execute("COPY (SELECT 'new-company' AS source_id,'US' AS country_code,5.0 AS longitude,1.0 AS latitude,'New real label' AS name) TO ? (FORMAT PARQUET)",[str(file)])
            new=[{'id':'new','file':file.name,'bounds':[5.,1.,5.,1.],'countries':['US'],'records':1,'bytes':file.stat().st_size,'license':{'id':'fixture'}}]
            assets,report=m.repair(index,root,{'assets':old},new)
            self.assertEqual(sum(a['records'] for a in assets),9)
            self.assertEqual(len(report['retireAssetIds']),8)
            self.assertTrue(report['proofs'][0]['integrity']['allFieldsRetained'])
            self.assertTrue(report['countries'][0]['safe'])
            self.assertLessEqual(report['countries'][0]['maximumFilesAfter'],8)
            self.assertFalse(report['oldObjectsDeleted'])
            index.db.close();db.close()


if __name__=='__main__':unittest.main()
