"""Browser -> authenticated API -> PostGIS -> combined cards -> encrypted list.
Source transports and geocoder are explicit fictional fixtures, no public queries.
"""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright,expect
BASE="http://127.0.0.1:3161"
REPORT={"scope":"Fictional providers; real local Chromium, HTTP authentication, PostgreSQL/PostGIS and persistence","devices":[]}
async def login(page,fixture,who="alice"):
    await page.goto(BASE,wait_until="domcontentloaded")
    await page.locator('#login-email').fill(fixture[who]['email']);await page.locator('#login-password').fill(fixture['password'])
    await page.locator('#account-login-form button[type=submit]').click();await expect(page.locator('#workspace')).to_be_visible()
async def check(browser,device,fixture):
    context=await browser.new_context(viewport={"width":390,"height":844} if device=='mobile' else {"width":1366,"height":900},reduced_motion='reduce')
    blocked=[]
    async def route(request):
        if request.request.url.startswith(BASE):await request.continue_()
        else:blocked.append(request.request.url);await request.abort()
    await context.route('**/*',route)
    page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    await login(page,fixture)
    await page.evaluate("async()=>{const data=await accountUI.request('/api/search',{method:'POST',body:JSON.stringify({city:'Cidade global de fixture',niche:'Restaurantes',limit:10})});await watch(data.jobId);}")
    job=await page.evaluate('()=>lastJob')
    assert job['state']=='done',job
    assert job['discoveryProvider']=='global'
    await expect(page.locator('#cards article')).to_have_count(2)
    await expect(page.locator('#cards')).to_contain_text('Overture Maps')
    assert all(len(row.get('provenance',[]))>=1 for row in job['rows'])
    assert any(len(row['provenance'])==2 for row in job['rows'])
    await page.locator('.result-options > summary').click()
    async with page.expect_download() as download:
        await page.locator('#csv').click()
    csv=Path(await (await download.value).path()).read_text()
    for value in ['provenance','ODbL-1.0','CDLA-Permissive-2.0','meta']:assert value in csv,value
    async with page.expect_download() as download:
        await page.locator('#json').click()
    exported=json.loads(Path(await (await download.value).path()).read_text())
    assert exported['license']=='multiple'
    assert len(exported['licenses'])==2
    await page.locator('.save-to-list').first.click()
    await page.locator('#list-save-name').fill('Fontes globais de teste')
    await page.locator('#list-save-submit').click();await expect(page.locator('#list-save-dialog')).not_to_be_visible()
    await page.reload()
    nav='#mobile-nav' if device=='mobile' else '#app-sidebar'
    await page.locator(nav+' [data-nav-target="lists-section"]').click()
    await expect(page.locator('#list-companies')).to_contain_text('ODbL-1.0')
    await expect(page.locator('#list-companies')).to_contain_text('CDLA-Permissive-2.0')
    # Cached data survives another account, while private jobs/tasks do not.
    bob=await browser.new_context();bobpage=await bob.new_page();await login(bobpage,fixture,'bob')
    assert (await bob.request.get(BASE+'/api/jobs/'+job['id'])).status==404
    task=job['discoveryDiagnostics'].get('taskId')
    if task:assert (await bob.request.get(BASE+'/api/discovery/tasks/'+task)).status==404
    await bob.close()
    assert not errors,errors
    assert not await page.evaluate('()=>document.documentElement.scrollWidth>innerWidth')
    assert all(url.startswith('https://tile.openstreetmap.org/') for url in blocked),blocked
    REPORT['devices'].append({'device':device,'records':2,'mergedProvenance':True,'encryptedListReload':True,'csvLicenses':True,'crossAccountJobsBlocked':True,'browserErrors':errors,'blockedPublicMapRequests':len(blocked),'cacheHit':job['discoveryMetrics'].get('cacheHit',False)})
    await page.screenshot(path=str(Path(__file__).resolve().parents[1]/'.artifacts'/f'global-{device}.png'))
    await context.close()
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'])
        api=await p.request.new_context();fixtures=await (await api.get(BASE+'/__test/info')).json()
        for device in ['desktop','mobile']:await check(browser,device,fixtures[device])
        final=await (await api.get(BASE+'/__test/info')).json()
        calls=0 if REPORT['devices'][0]['cacheHit'] else 1
        assert final['globalProviderCalls']=={'qlever':calls,'overture':calls},final['globalProviderCalls']
        REPORT['providerCalls']=final['globalProviderCalls']
        await browser.close();await api.dispose()
    path=Path(__file__).resolve().parents[1]/'.artifacts'/'global-browser.json';path.write_text(json.dumps(REPORT,ensure_ascii=False,indent=2));print(json.dumps({'passed':True,**REPORT},ensure_ascii=False))
asyncio.run(main())
