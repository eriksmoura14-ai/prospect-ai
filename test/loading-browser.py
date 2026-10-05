"""Local real Chromium loading/cache measurements. Run against the basic-mode
server on 3041; no email, business providers or production writes are used.
Results are saved under /tmp/prospect-performance-<PERFORMANCE_LABEL>.json.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get('PROSPECT_UI_BASE_URL', 'http://127.0.0.1:3041')
LABEL = os.environ.get('PERFORMANCE_LABEL', 'current')
REPORT = {'scope': 'Local real Node/Chromium, 150 ms latency, 1.6 Mbps download, CPU slowdown 4; reduced motion isolates loading from software GPU cost. No business search or email.', 'runs': []}

async def run(browser, device):
    viewport = {'width': 1366, 'height': 900} if device == 'desktop' else {'width': 390, 'height': 844}
    context = await browser.new_context(viewport=viewport, reduced_motion='reduce')
    page = await context.new_page()
    errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    cdp = await context.new_cdp_session(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency':150, 'downloadThroughput':200000, 'uploadThroughput':93750})
    await cdp.send('Emulation.setCPUThrottlingRate', {'rate':4})
    await page.add_init_script("""window.loadingTasks = []; new PerformanceObserver(list => {
      for (const item of list.getEntries()) loadingTasks.push({start:item.startTime,duration:item.duration});
    }).observe({type:'longtask',buffered:true});""")
    for cache in ['cold','reload']:
        await page.goto(BASE, wait_until='domcontentloaded', timeout=45000)
        await page.wait_for_function("() => window.prospectEarth?.graphics && ['day','clouds','night','specular'].every(k=>prospectEarth.graphics.textures[k].loaded)", timeout=45000)
        await page.wait_for_function("() => !document.querySelector('#country').disabled", timeout=20000)
        await page.wait_for_timeout(250)
        data = await page.evaluate("""() => {
          const nav=performance.getEntriesByType('navigation')[0];
          const resources=performance.getEntriesByType('resource');
          const staticFiles=resources.filter(r=>!new URL(r.name).pathname.startsWith('/api/'));
          const paints=Object.fromEntries(performance.getEntriesByType('paint').map(r=>[r.name,Math.round(r.startTime)]));
          return {domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),paints,
            staticTransferBytes:staticFiles.reduce((s,r)=>s+r.transferSize,0),
            totalTransferBytes:nav.transferSize+resources.reduce((s,r)=>s+r.transferSize,0),
            staticFiles:staticFiles.map(r=>({path:new URL(r.name).pathname,wire:r.transferSize,body:r.encodedBodySize,duration:Math.round(r.duration)})),
            longTasks:loadingTasks.length,longTaskMs:Math.round(loadingTasks.reduce((s,r)=>s+r.duration,0)),
            graphics:prospectEarth.graphics,
            overflow:document.documentElement.scrollWidth>innerWidth};
        }""")
        data.update({'device':device,'cache':cache,'pageErrors':errors.copy()})
        REPORT['runs'].append(data)
        print(json.dumps({k:data[k] for k in ['device','cache','domContentLoadedMs','paints','staticTransferBytes','totalTransferBytes','longTasks','longTaskMs','pageErrors','overflow']}),flush=True)
    await context.close()

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'])
        try:
            for device in ['desktop','mobile']: await run(browser,device)
        finally:
            Path('/tmp/prospect-performance-'+LABEL+'.json').write_text(json.dumps(REPORT,indent=2))
            await browser.close()

asyncio.run(main())
