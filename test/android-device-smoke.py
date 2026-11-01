"""Bounded Android emulator check. No account, email or business search mutations.
The only exported contact is an explicit fictional test fixture.
"""
import json,re,subprocess,time,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path
import websocket

OUT=Path('.artifacts/android-device');OUT.mkdir(parents=True,exist_ok=True)
APP='com.prospectai.android';ORIGIN='https://prospect-ai-eriksmoura.netlify.app'

def adb(*args):
 return subprocess.run(['adb',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20).stdout

def screenshot(name):
 (OUT/(name+'.png')).write_bytes(adb('exec-out','screencap','-p'))

def dump(name):
 adb('shell','uiautomator','dump','/sdcard/prospect-ui.xml')
 data=adb('shell','cat','/sdcard/prospect-ui.xml');(OUT/(name+'.xml')).write_bytes(data)
 return ET.fromstring(data)

started=time.monotonic();socket=None;counter=0
deadline=time.monotonic()+120
while time.monotonic()<deadline:
 try:
  pid=adb('shell','pidof',APP).decode().strip().split()[0]
  adb('forward','tcp:9222','localabstract:webview_devtools_remote_'+pid)
  with urllib.request.urlopen('http://127.0.0.1:9222/json',timeout=3) as r:pages=json.load(r)
  page=next(p for p in pages if p.get('type')=='page' and p.get('url','').startswith(ORIGIN+'/'))
  socket=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=10,suppress_origin=True);break
 except (subprocess.SubprocessError,OSError,ValueError,IndexError,StopIteration):time.sleep(2)
if socket is None:
 screenshot('startup-failure');dump('startup-failure');raise RuntimeError('webview_did_not_open_approved_origin')

def cdp(method,params=None):
 global counter
 counter+=1;identity=counter;socket.send(json.dumps({'id':identity,'method':method,'params':params or {}}))
 while True:
  data=json.loads(socket.recv())
  if data.get('id')==identity:
   if 'error' in data:raise RuntimeError('cdp_'+method+':'+data['error']['message'])
   return data.get('result',{})

def evaluate(expression):
 result=cdp('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True})
 if result.get('exceptionDetails'):raise RuntimeError('webview_script_failed')
 return result['result'].get('value')

deadline=time.monotonic()+100;state={}
while time.monotonic()<deadline:
 state=evaluate("({title:document.title,url:location.href,exporter:!!window.__prospectAndroidExports,login:!!document.querySelector('#login-panel')&&!document.querySelector('#login-panel').hidden})")
 if state['title']=='Prospect AI' and state['exporter'] and state['login']:break
 time.sleep(2)
else:
 screenshot('login-failure');dump('login-failure');raise RuntimeError('prospect_login_or_export_bridge_not_ready')
screenshot('prospect-login');dump('prospect-login')

filename='prospect-ai-1793560000000.csv';fixture='\ufeffnome,telefone\r\nEmpresa de teste,+5534998883900'
evaluate("(() => {const b=new Blob(["+json.dumps(fixture)+"],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='"+filename+"';document.body.append(a);a.click();a.remove();return true;})()")
deadline=time.monotonic()+25;save=None
while time.monotonic()<deadline:
 root=dump('export-picker')
 for node in root.iter('node'):
  if node.get('text','').casefold() in ('save','salvar') and node.get('enabled')=='true':save=node;break
 if save is not None:break
 time.sleep(1)
if save is None:raise RuntimeError('native_document_picker_not_opened')
screenshot('native-export-picker');numbers=list(map(int,re.findall(r'\d+',save.get('bounds',''))));assert len(numbers)==4
adb('shell','input','tap',str((numbers[0]+numbers[2])//2),str((numbers[1]+numbers[3])//2));time.sleep(2)
exported=adb('shell','cat','/sdcard/Download/'+filename)
if exported!=fixture.encode('utf-8'):raise RuntimeError('csv_bytes_or_phone_number_changed')

cdp('Network.enable');cdp('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0});cdp('Page.reload',{'ignoreCache':True})
deadline=time.monotonic()+20;offline=False
while time.monotonic()<deadline:
 root=dump('offline-screen')
 if any(n.get('text')=='Não foi possível abrir o Prospect' for n in root.iter('node')):offline=True;break
 time.sleep(1)
if not offline:raise RuntimeError('native_offline_screen_missing')
screenshot('offline-screen');socket.close()
report={'androidApi':adb('shell','getprop','ro.build.version.sdk').decode().strip(),'testBuild':'debug only; delivered APK separately uses release with WebView debugging disabled','approvedOrigin':ORIGIN,'currentSaasLoginVisible':True,'originScopedExportBridgeReady':True,'nativeDocumentPickerOpened':True,'csvBytesIdentical':True,'utf8BomRetained':True,'phoneDigitsRetained':True,'nativeOfflineScreenVisible':True,'fixtureIsNotARealBusinessRecord':True,'customerAccountUsed':False,'searchesOrEmailsSent':False,'elapsedMs':round((time.monotonic()-started)*1000)}
(OUT/'device-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
