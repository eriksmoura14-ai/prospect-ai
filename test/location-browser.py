"""Optional browser regression checks for cascading location selection.

Requirements: Python 3, pip install playwright, and a local Chromium executable.
Start Prospect AI locally without password authentication, then run:
  python test/location-browser.py
Use PROSPECT_UI_BASE_URL and CHROMIUM_PATH to override localhost:3041 and
/usr/bin/chromium. Business API responses are explicitly test fixtures; these
checks do not establish production business discovery availability.
"""
import asyncio, json, time, os
from pathlib import Path
from playwright.async_api import async_playwright

BASE=os.environ.get('PROSPECT_UI_BASE_URL','http://127.0.0.1:3041').rstrip('/')
REPORT={'scope':'Local Chromium UI test; real local country/state/city metadata; business creation and jobs intercepted as fixtures, not production discovery evidence.', 'checks':[], 'failures':[], 'consoleErrors':[], 'screenshots':[]}

async def check(name, fn):
    start=time.monotonic()
    try:
        evidence=await fn()
        REPORT['checks'].append({'name':name,'passed':True,'seconds':round(time.monotonic()-start,2),'evidence':evidence})
        print('PASS '+name,flush=True)
    except Exception as e:
        REPORT['checks'].append({'name':name,'passed':False,'seconds':round(time.monotonic()-start,2),'error':str(e)})
        REPORT['failures'].append(name+': '+str(e))
        print('FAIL '+name+': '+str(e),flush=True)

async def enabled(page, selector):
    await page.wait_for_function('(selector)=>!document.querySelector(selector).disabled', arg=selector)

async def selected(page, selector, value):
    await enabled(page,selector)
    await page.select_option(selector,value)

async def initialized(page):
    await page.goto(BASE,wait_until='networkidle')
    await enabled(page,'#country')

async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        # These checks exercise location/recovery logic, not animation timing.
        # Reduce decorative GPU work across concurrent headless pages; the
        # animated Earth is validated separately by earth-browser.py.
        context=await browser.new_context(viewport={'width':1440,'height':1000}, reduced_motion='reduce')
        page=await context.new_page()
        page.on('pageerror', lambda e: REPORT['consoleErrors'].append(str(e)))
        await initialized(page)
        submit=page.locator('#search button[type="submit"]')

        async def initial():
            assert await submit.is_disabled()
            assert await page.locator('#region').is_disabled()
            assert await page.locator('#city').is_disabled()
            assert not await page.locator('#manual-region').is_visible(), 'Hidden manual state input visible at initial load'
            assert not await page.locator('#manual-city').is_visible(), 'Hidden manual city input visible at initial load'
            n=await page.locator('#country option').count()
            assert n>200
            return {'countryOptions':n,'dependentControlsDisabled':True}
        await check('Initial worldwide options and dependent control gating',initial)

        async def brazil():
            await selected(page,'#country','BR')
            await selected(page,'#region','MG')
            await selected(page,'#city','15434')
            assert await page.locator('#city option:checked').inner_text()=='Uberlândia'
            assert await submit.is_enabled()
            return {'country':'BR','state':'MG','cityId':15434,'cityLabel':await page.locator('#city option:checked').inner_text()}
        await check('Brazil Minas Gerais Uberlândia with real metadata',brazil)
        await page.screenshot(path='/tmp/prospect-location-desktop.png',full_page=True)
        REPORT['screenshots'].append('/tmp/prospect-location-desktop.png')

        async def country_change():
            await page.select_option('#country','US')
            assert await page.locator('#region').input_value()==''
            assert await page.locator('#city').input_value()==''
            assert await submit.is_disabled()
            await selected(page,'#region','NY')
            await selected(page,'#city','122795')
            assert await page.locator('#city option:checked').inner_text()=='New York City'
            assert await submit.is_enabled()
            await page.select_option('#region','CA')
            assert await page.locator('#city').input_value()==''
            assert await submit.is_disabled()
            await enabled(page,'#city')
            assert await page.locator('#city option[value="122795"]').count()==0
            return {'countryReset':True,'stateReset':True,'NewYorkCityId':122795,'CaliforniaOptions':await page.locator('#city option').count()}
        await check('Country and state changes clear obsolete selections',country_change)

        async def manual():
            await selected(page,'#city','__manual__')
            assert await page.locator('#manual-city').is_visible()
            assert await submit.is_disabled()
            await page.fill('#manual-city','My Town')
            assert await submit.is_enabled()
            await selected(page,'#region','__manual__')
            assert await page.locator('#manual-region').is_visible()
            assert await page.locator('#manual-city').is_visible()
            assert await page.locator('#manual-city').input_value()==''
            assert await submit.is_disabled()
            await page.fill('#manual-region','My Region')
            await page.fill('#manual-city','My Town')
            assert await submit.is_enabled()
            return {'manualRegionAndCity':True,'requiredNamesGateSearch':True}
        await check('Explicit manual city and state fallback',manual)

        payloads=[]
        async def search_route(route):
            payloads.append(route.request.post_data_json)
            await route.fulfill(status=202,content_type='application/json',body=json.dumps({'jobId':'ui-fixture'}))
        async def job_route(route):
            await route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':'ui-fixture','state':'done','rows':[],'progress':'Teste de interface','stats':{'total':0}}))
        await page.route('**/api/search',search_route)
        await page.route('**/api/jobs/ui-fixture',job_route)

        async def manual_payload():
            await submit.click()
            await enabled(page,'#country')
            assert payloads[-1]['location']=={'countryCode':'US','stateCode':'__manual__','cityId':'__manual__','manualState':'My Region','manualCity':'My Town'}
            assert await page.locator('#country').input_value()=='US'
            assert await page.locator('#manual-region').input_value()=='My Region'
            assert await page.locator('#manual-city').input_value()=='My Town'
            return payloads[-1]
        await check('Search payload and selection persistence with business fixture',manual_payload)

        async def vatican():
            await selected(page,'#country','VA')
            await page.wait_for_function('()=>document.querySelector("#region").value === "__none__" && document.querySelector("#city").value === "__manual__"')
            assert await page.locator('#region option:checked').inner_text()=='Sem estado / província'
            assert await page.locator('#manual-city').is_visible()
            assert await submit.is_disabled()
            await page.fill('#manual-city','Vatican City')
            assert await submit.is_enabled()
            return {'country':'VA','stateCode':'__none__','cityMode':'__manual__'}
        await check('Country without subdivisions permits city entry',vatican)

        async def api_retry():
            attempts=0
            async def fail_once(route):
                nonlocal attempts
                attempts+=1
                if attempts==1:
                    await route.fulfill(status=503,content_type='application/json',body='{"error":"Falha controlada de teste"}')
                else: await route.continue_()
            await page.route('**/api/locations/cities?country=BR&state=MG',fail_once)
            await selected(page,'#country','BR')
            await selected(page,'#region','MG')
            await page.wait_for_selector('#location-retry:not([hidden])')
            assert await page.locator('#city').is_enabled()
            assert await submit.is_disabled()
            assert 'Falha controlada de teste' in await page.locator('#location-status').inner_text()
            await selected(page,'#city','__manual__')
            assert await page.locator('#manual-city').is_visible()
            assert await submit.is_disabled()
            await page.fill('#manual-city','Å')
            assert await submit.is_enabled(), 'One-character legal city name must be permitted'
            assert await page.locator('#manual-city').evaluate('(el)=>el.checkValidity()')
            await page.click('#location-retry')
            assert await page.locator('#manual-city').input_value()==''
            await selected(page,'#city','15434')
            assert await submit.is_enabled()
            assert not await page.locator('#location-retry').is_visible()
            await page.unroute('**/api/locations/cities?country=BR&state=MG',fail_once)
            return {'attempts':attempts,'retryRecovered':True,'explicitManualAvailableDuringFailure':True,'oneCharacterCityAllowed':True}
        await check('City metadata failure and retry recovery',api_retry)

        async def country_race():
            response=await context.request.get(BASE+'/api/locations/states?country=BR')
            old_body=await response.text()
            async def delayed(route):
                await asyncio.sleep(0.65)
                await route.fulfill(status=200,content_type='application/json',body=old_body)
            await page.route('**/api/locations/states?country=BR',delayed)
            await page.select_option('#country','')
            await page.select_option('#country','BR')
            await page.select_option('#country','US')
            await enabled(page,'#region')
            await page.wait_for_timeout(850)
            assert await page.locator('#region option[value="NY"]').count()==1
            assert await page.locator('#region option[value="MG"]').count()==0
            assert await page.locator('#country').input_value()=='US'
            await page.unroute('**/api/locations/states?country=BR',delayed)
            return {'lateBrazilStatesIgnored':True}
        await check('Delayed obsolete state response ignored after country change',country_race)

        async def state_race():
            response=await context.request.get(BASE+'/api/locations/cities?country=US&state=NY')
            old_body=await response.text()
            async def delayed(route):
                await asyncio.sleep(0.65)
                await route.fulfill(status=200,content_type='application/json',body=old_body)
            await page.route('**/api/locations/cities?country=US&state=NY',delayed)
            await selected(page,'#region','NY')
            await page.select_option('#region','CA')
            await enabled(page,'#city')
            await page.wait_for_timeout(850)
            assert await page.locator('#city option[value="122795"]').count()==0
            assert await page.locator('#region').input_value()=='CA'
            await page.unroute('**/api/locations/cities?country=US&state=NY',delayed)
            return {'lateNewYorkCitiesIgnored':True}
        await check('Delayed obsolete city response ignored after state change',state_race)

        async def regular_payload():
            await selected(page,'#region','NY')
            await selected(page,'#city','122795')
            await submit.click()
            await enabled(page,'#country')
            assert payloads[-1]['location']=={'countryCode':'US','stateCode':'NY','cityId':122795}
            return payloads[-1]
        await check('Catalog city search payload with business fixture',regular_payload)

        async def mobile():
            await page.set_viewport_size({'width':390,'height':844})
            await page.screenshot(path='/tmp/prospect-location-mobile.png',full_page=True)
            assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow on mobile'
            for selector in ['#country','#region','#city','#niche','#quantity']:
                bbox=await page.locator(selector).bounding_box()
                assert bbox and bbox['x']>=0 and bbox['x']+bbox['width']<=390
            assert await page.locator('#country option:checked').inner_text()=='Estados Unidos'
            assert await submit.is_enabled()
            REPORT['screenshots'].append('/tmp/prospect-location-mobile.png')
            return {'viewport':{'width':390,'height':844},'horizontalOverflow':False}
        await check('Mobile layout and selected values',mobile)
        async def recovery_case(country_mode):
            recovery_context=await browser.new_context(viewport={'width':1280,'height':900}, reduced_motion='reduce')
            await recovery_context.add_init_script("localStorage.setItem('prospect-ai-active-job', 'ui-resume-fixture')")
            rp=await recovery_context.new_page()
            rp.on('pageerror', lambda e: REPORT['consoleErrors'].append(str(e)))
            country_response=await context.request.get(BASE+'/api/locations/countries')
            country_body=await country_response.text()
            jobs=0
            new_searches=0
            country_completed_at=None
            first_job_at=None
            began=time.monotonic()
            async def country_fixture(route):
                nonlocal country_completed_at
                if country_mode=='failed':
                    await route.fulfill(status=503,content_type='application/json',body='{"error":"Catálogo indisponível no teste"}')
                else:
                    await asyncio.sleep(4)
                    await route.fulfill(status=200,content_type='application/json',body=country_body)
                country_completed_at=time.monotonic()-began
            async def recovery_jobs(route):
                nonlocal jobs,first_job_at
                jobs+=1
                if first_job_at is None: first_job_at=time.monotonic()-began
                if jobs<=3:
                    await route.fulfill(status=504,content_type='application/json',body='{"error":"Falha temporária de watch no teste"}')
                else:
                    await route.fulfill(status=200,content_type='application/json',body=json.dumps({'id':'ui-resume-fixture','state':'done','rows':[],'message':'Pesquisa reconectada no teste'}))
            async def prohibited_search(route):
                nonlocal new_searches
                new_searches+=1
                await route.fulfill(status=500,content_type='application/json',body='{"error":"Reconexão não pode criar pesquisa nova"}')
            await rp.route('**/api/locations/countries',country_fixture)
            await rp.route('**/api/jobs/ui-resume-fixture',recovery_jobs)
            await rp.route('**/api/search',prohibited_search)
            await rp.goto(BASE,wait_until='domcontentloaded')
            rb=rp.locator('#search button[type="submit"]')
            await rp.wait_for_function('()=>{const b=document.querySelector("#search button[type=submit]");return b && !b.disabled && b.textContent === "Reconectar pesquisa"}',timeout=12000)
            assert jobs==3
            assert await rp.locator('#country').input_value()==''
            assert await rp.locator('#region').input_value()==''
            assert await rp.locator('#city').input_value()==''
            assert await rb.evaluate('(el)=>el.formNoValidate'), 'Recovery submit must bypass required empty filters'
            if country_mode=='pending':
                assert first_job_at<country_completed_at, 'Country loading blocked automatic job watch'
                assert await rp.locator('#country').is_enabled()
                assert not await rp.locator('#country').evaluate('(el)=>el.checkValidity()'), 'Required empty country must be invalid, proving novalidate is necessary'
            else:
                assert await rp.locator('#location-retry').is_visible()
            await rb.click()
            await rp.wait_for_function('()=>localStorage.getItem("prospect-ai-active-job") === null',timeout=5000)
            assert jobs==4
            assert new_searches==0
            assert await rb.inner_text()=='Buscar empresas'
            assert await rb.is_disabled(), 'Incomplete filters must disable new search after terminal watch'
            seconds=time.monotonic()-began
            assert seconds<15, 'Recovery scenario exceeded bounded test budget'
            evidence={'catalog':country_mode,'watchAttempts':jobs,'newSearchRequests':new_searches,'emptyFilters':True,'firstWatchSeconds':round(first_job_at,2),'catalogFinishedSeconds':round(country_completed_at,2),'recoveredAfterReload':True}
            await recovery_context.close()
            return evidence
        await check('Stored job reconnect survives unavailable country catalog',lambda:recovery_case('failed'))
        await check('Pending catalog does not block watch; reconnect bypasses required filters',lambda:recovery_case('pending'))
        await browser.close()
    REPORT['passed']=not REPORT['failures'] and not REPORT['consoleErrors']
    Path('/tmp/prospect-location-browser.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))
    print(json.dumps(REPORT,ensure_ascii=False,indent=2))
    return 0 if REPORT['passed'] else 1

raise SystemExit(asyncio.run(main()))
