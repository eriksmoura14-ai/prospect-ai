"""Conservative public-business normalization and deduplication helpers. No network."""
import csv,gzip,hashlib,ipaddress,json,math,re,struct,sys,time,unicodedata
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import duckdb,shapely
from shapely.geometry import shape

RELEASE='2026-10-21.0';
KNOWN=['alltheplaces','overture','birdeye','brightquery','dac','foursquare','krick','microsoft','opentravel','pinmeto','renderseo','uberall','meta','overture-signals']
LICENSES=['CDLA-Permissive-2.0','Apache-2.0','CC0-1.0']
PROFILES=['facebook.com','instagram.com','linkedin.com','youtube.com','tiktok.com','whatsapp.com','wa.me','linktr.ee','yelp.com','tripadvisor.com','maps.app.goo.gl','g.page','ifood.com.br','ubereats.com','doordash.com','booking.com','opentable.com','thefork.com','maps.apple.com']
def normalize(value):
 text=''.join(c for c in unicodedata.normalize('NFKD',value or '') if not unicodedata.category(c).startswith('M')).lower()
 return ' '.join(''.join(c if c.isalnum() else ' ' for c in text).split())
def point(binary):
 if not isinstance(binary,bytes) or len(binary)!=21 or binary[0] not in (0,1):return None
 endian='<' if binary[0] else '>'
 if struct.unpack(endian+'I',binary[1:5])[0]!=1:return None
 x,y=struct.unpack(endian+'dd',binary[5:])
 return {'longitude':x,'latitude':y} if math.isfinite(x) and math.isfinite(y) and -180<=x<=180 and -90<=y<=90 else None
def profile(url):
 h=(urlsplit(url).hostname or '').lower()
 return any(h==v or h.endswith('.'+v) for v in PROFILES) or bool(re.match(r'^(?:www\.)?google\.[a-z.]+$',h) and re.match(r'^/maps(?:/|$)',urlsplit(url).path)) or h.startswith('maps.google.')
def safe_url(value):
 if not isinstance(value,str) or not value.strip() or len(value)>2000:return ''
 value=value.strip()
 if re.match(r'^[a-z][a-z0-9+.-]*:',value,re.I) and not value.lower().startswith(('http://','https://')):return ''
 try:
  u=urlsplit(value if value.lower().startswith(('http://','https://')) else 'https://'+value)
  h=(u.hostname or '').lower()
  if u.scheme not in ('http','https') or u.username or u.password or '.' not in h or h.endswith(('.local','.localhost','.internal','.invalid','.test','.example')):return ''
  if u.port is not None and not 1<=u.port<=65535:return ''
  try:
   if not ipaddress.ip_address(h).is_global:return ''
  except ValueError:pass
  return urlunsplit(u)
 except ValueError:return ''
def website(values):
 urls=[u for u in (safe_url(v) for v in (values or [])[:10]) if u]
 return next((u for u in urls if not profile(u)),urls[0] if urls else '')
def phone(values):
 kept=[]
 for v in (values or [])[:5]:
  if not isinstance(v,str) or len(v)>200 or '@' in v or re.search(r'[\x00-\x1f]',v) or len(re.sub(r'\D','',v))<6:continue
  if v.strip() not in kept and len('; '.join(kept+[v.strip()]))<=200:kept.append(v.strip())
 return '; '.join(kept)
def phone_keys(value,country):
 result=set()
 for v in (value or '').split(';'):
  digits=re.sub(r'\D','',v)
  if country in ('US','CA') and len(digits)==10:digits='1'+digits
  if 7<=len(digits)<=18:result.add(digits)
 return result
def distance(a,b):
 return math.hypot((a[1]-b[1])*111195,(a[2]-b[2])*111195*math.cos((a[1]+b[1])/2*math.pi/180))
class Deduplicator:
 def __init__(self):self.cells={};self.identities=set()
 def accept(self,identity,country,name,lat,lon,telephone,address):
  if identity in self.identities:return identity
  self.identities.add(identity)
  x=math.floor(lon/.002);y=math.floor(lat/.002);prefix=(country,normalize(name));keys=phone_keys(telephone,country);addr=normalize(address)
  item=(identity,lat,lon,keys,addr)
  horizontal=max(1,math.ceil(60/(111195*.002*max(.01,math.cos(lat*math.pi/180)))))
  for dx in range(-horizontal,horizontal+1):
   for dy in (-1,0,1):
    for previous in self.cells.get((*prefix,x+dx,y+dy),()):
     if distance(item,previous)>60:continue
     if addr and previous[4] and addr!=previous[4]:continue
     if keys.intersection(previous[3]) or (addr and addr==previous[4]):return previous[0]
  self.cells.setdefault((*prefix,x,y),[]).append(item)
  return None
