"""Small finite OSM complement batch; never systematic Nominatim geocoding.
Queries are compiled by the application's reviewed niche selectors. One request
per endpoint/area, sequential, with a response/time budget and no hidden retries.
"""
import argparse,json,time
from pathlib import Path
import requests
def main():
 p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args();areas=json.loads(Path(a.input).read_text());assert len(areas)<=5;out=Path(a.output);out.mkdir(parents=True,exist_ok=True);results=[];start=time.monotonic()
 with requests.Session() as session:
  for area in areas:
   assert area['geometry']['type'] in ('Polygon','MultiPolygon') and area['query'].startswith('[out:json][timeout:20]')
   result={'adminId':area['id'],'source':'OpenStreetMap','license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','attempts':[],'outcome':'temporary_failure','records':None}
   for endpoint in ['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter']:
    if time.monotonic()-start>90:break
    began=time.monotonic();attempt={'endpoint':endpoint,'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    try:
     with session.post(endpoint,data={'data':area['query']},headers={'User-Agent':'ProspectAI/0.9 (+https://github.com/eriksmoura14-ai/prospect-ai)'},stream=True,timeout=(5,22),allow_redirects=False) as response:
      attempt['http']=response.status_code;attempt['retryAfter']=response.headers.get('Retry-After');response.raise_for_status();parts=[];size=0
      for chunk in response.iter_content(65536):
       size+=len(chunk)
       if size>8388608:raise ValueError('response_budget')
       parts.append(chunk)
      data=json.loads(b''.join(parts));assert isinstance(data.get('elements'),list) and not data.get('remark')
      (out/(area['id'].replace(':','-')+'.json')).write_text(json.dumps({'area':area,'data':data,'collectedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}))
      result.update(outcome='source_completed',records=len(data['elements']));attempt['outcome']='source_completed'
    except Exception as e:attempt['outcome']='response_budget_or_parse' if isinstance(e,(ValueError,AssertionError)) else 'source_timeout_or_network' if isinstance(e,requests.RequestException) else 'source_error'
    attempt['elapsedMs']=round((time.monotonic()-began)*1000);result['attempts'].append(attempt)
    if result['outcome']=='source_completed' or attempt.get('http')==429:break
   results.append(result);print(json.dumps(result),flush=True);(out/'report.json').write_text(json.dumps({'results':results,'elapsedMs':round((time.monotonic()-start)*1000)},indent=2))
if __name__=='__main__':main()
