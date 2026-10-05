"""Real local Chromium checks for UI performance without business/email calls.

Start the local basic-mode server on 3041. Controlled result rows exercise DOM
updates; real textures, local geographic metadata and WebGL are used. Optional
PROSPECT_BASELINE_APP points to the prior app.js for the DOM timing comparison.
"""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = os.environ.get('PROSPECT_UI_BASE_URL', 'http://127.0.0.1:3041')
ROOT = Path(__file__).resolve().parents[1]
REPORT = {'scope': 'Local Chromium/Node, controlled result rows, real geographic metadata and WebGL; no discovery, email or production data.', 'checks': []}

async def cards(browser, baseline=None):
    context = await browser.new_context(viewport={'width':1366,'height':900}, reduced_motion='reduce')
    page = await context.new_page(); errors=[]
    page.on('pageerror', lambda error: errors.append(str(error)))
    if baseline:
        await page.route('**/app.js', lambda route: route.fulfill(status=200,content_type='text/javascript',body=baseline.read_text()))
    await page.goto(BASE)
    await page.wait_for_function("() => !document.querySelector('#country').disabled")
    await page.wait_for_function("() => window.prospectEarth?.ready")
    cdp = await context.new_cdp_session(page)
    await cdp.send('Emulation.setCPUThrottlingRate', {'rate':4})
    result = await page.evaluate("""() => {
      rows = Array.from({length:100}, (_,i)=>({osmId:'node/'+(i+1),name:'Empresa controlada '+i,
        category:'Barber',city:'Cidade de teste',address:'Endereço público de exemplo',phone:i%2?'':'123456789',
        status:'UNCERTAIN',confidence:0.4,prospectScore:30+i%10,
        verification:{candidatesChecked:1,candidatesTotal:3,evidence:[{domain:'example.test',reason:'Fixture'}]}}));
      lastJob={id:'fixture-performance-job',state:'done'};searched=true;busy=false;render();
      const previous=[...document.querySelectorAll('#cards article')];
      const observer=new MutationObserver(()=>{});observer.observe(document.querySelector('#cards'),{childList:true});
      const started=performance.now();for(let i=0;i<20;i++) render();
      const elapsed=performance.now()-started;
      const mutations=observer.takeRecords().length;observer.disconnect();
      const current=[...document.querySelectorAll('#cards article')];
      return {rows:current.length,repeatedUpdates:20,updateMs:Math.round(elapsed),
        unchangedCardsRetained:current.filter((card,i)=>card===previous[i]).length,mutations};
    }""")
    if not baseline:
        assert result['rows']==100 and result['unchangedCardsRetained']==100 and result['mutations']==0, result
        changes = await page.evaluate("""() => {
          const before=[...document.querySelectorAll('#cards article')];
          before[0].querySelector('details').open=true;
          // A missing/invalid WhatsApp number intentionally renders a disabled
          // contact button. Focus an available action to test focus retention.
          const focused=before[99].querySelector('button:not(:disabled)'); focused.focus();
          rows=rows.map(row=>({...row}));const first=rows.find(row=>row.osmId===before[0].querySelector('details').dataset.osmId);
          first.reason='Evidência atualizada';render();
          const after=[...document.querySelectorAll('#cards article')];
          return {retained:after.filter((node,i)=>node===before[i]).length,
            focusRetained:document.activeElement===focused,detailsOpen:after[0].querySelector('details').open};
        }""")
        assert changes=={'retained':99,'focusRetained':True,'detailsOpen':True}, changes
        result['oneChangedRow']=changes
        await page.locator('#phone-filter').select_option('yes')
        await expect(page.locator('#cards article')).to_have_count(50)
        await page.locator('#phone-filter').select_option('all')
        await expect(page.locator('#cards article')).to_have_count(100)
        await page.locator('#sort').select_option('name')
        await page.evaluate("lastJob.state='running';render()")
        ai_buttons=page.locator('#cards article').get_by_role('button',name='Abrir assistente de IA',exact=True)
        await expect(ai_buttons).to_have_count(100)
        assert await ai_buttons.evaluate_all('buttons=>buttons.every(button=>button.disabled)')
        await page.evaluate("lastJob.state='done';render()")
        await page.locator('#cards article').first.get_by_role('button',name='Abrir assistente de IA').click()
        await expect(page.locator('.ai-dialog')).to_be_visible()
        await page.evaluate("document.querySelector('.ai-dialog').close();window.dispatchEvent(new Event('prospect:session-expired'))")
        await expect(page.locator('#cards article')).to_have_count(0)
        assert await page.evaluate('resultCards.size')==0
    assert not errors, errors
    REPORT['checks'].append({'kind':'cards-before' if baseline else 'cards-after','evidence':result,'pageErrors':errors})
    print(json.dumps(REPORT['checks'][-1]),flush=True)
    await context.close()

async def globe(browser, device):
    mobile = device=='mobile'
    context=await browser.new_context(viewport={'width':390,'height':844} if mobile else {'width':1366,'height':900})
    page=await context.new_page(); errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    await page.goto(BASE)
    await page.wait_for_function("() => !document.querySelector('#country').disabled")
    await page.wait_for_function("() => window.prospectEarth?.ready")
    await page.select_option('#country','BR')
    await page.wait_for_function("() => !document.querySelector('#region').disabled")
    await page.select_option('#region','MG')
    await page.wait_for_function("() => !document.querySelector('#city').disabled")
    await page.select_option('#city','15434')
    await page.wait_for_function("() => prospectEarth.target?.label==='Uberlândia' && Math.abs(prospectEarth.zoom-1.16)<0.00001",timeout=20000)
    before=await page.evaluate('({frames:prospectEarth.frameCount,labels:prospectEarth.graphics.labelUpdates,clouds:prospectEarth.graphics.cloudRotation})')
    await page.wait_for_timeout(1200)
    after=await page.evaluate('({frames:prospectEarth.frameCount,labels:prospectEarth.graphics.labelUpdates,clouds:prospectEarth.graphics.cloudRotation})')
    assert after['frames']>before['frames'] and after['clouds']>before['clouds']
    assert after['labels']==before['labels'], {'before':before,'after':after}
    await expect(page.locator('.earth-location')).to_be_hidden() if mobile else await expect(page.locator('.earth-location')).to_be_visible()
    await page.locator('#earth-motion').click()
    await page.wait_for_timeout(150)
    stable=await page.evaluate('prospectEarth.frameCount')
    await page.wait_for_timeout(300)
    assert await page.evaluate('prospectEarth.frameCount')==stable
    assert not errors,errors
    REPORT['checks'].append({'kind':'globe-'+device,'before':before,'after':after,'pageErrors':errors})
    print(json.dumps(REPORT['checks'][-1]),flush=True)
    await context.close()

async def main():
    async with async_playwright() as playwright:
        browser=await playwright.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'])
        try:
            prior=os.environ.get('PROSPECT_BASELINE_APP')
            if prior: await cards(browser,Path(prior))
            await cards(browser)
            for device in ['desktop','mobile']: await globe(browser,device)
        finally:
            (ROOT/'.artifacts').mkdir(exist_ok=True)
            (ROOT/'.artifacts/performance-browser.json').write_text(json.dumps(REPORT,indent=2))
            await browser.close()

asyncio.run(main())
