"""Optional real Chromium/WebGL regression checks for the decorative Earth.

Requires Python 3, playwright, and Chromium. Start Prospect AI locally without
password authentication and run `python test/earth-browser.py`. Override the
default localhost:3041 address with PROSPECT_UI_BASE_URL and /usr/bin/chromium
with CHROMIUM_PATH. A local PostgreSQL fixture server at :3161 can also be used;
the test signs in only with its disposable fictional account. Geographic
metadata and WebGL rendering are real; business
searches are prohibited by the test and are not evidence of discovery uptime.
"""
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

BASE = os.environ.get("PROSPECT_UI_BASE_URL", "http://127.0.0.1:3041").rstrip("/")
REPORT = {
    "scope": "Real Chromium WebGL and local geographic metadata; no business searches or external provider requests.",
    "checks": [], "failures": [], "consoleErrors": [], "requests": [],
    "failedResponses": [], "screenshots": [], "performance": []
}
AUTH_STATE = None


async def check(name, fn):
    started = time.monotonic()
    try:
        result = await fn()
        REPORT["checks"].append({"name": name, "passed": True,
            "seconds": round(time.monotonic() - started, 2), "evidence": result})
        print("PASS " + name, flush=True)
    except Exception as error:
        REPORT["checks"].append({"name": name, "passed": False,
            "seconds": round(time.monotonic() - started, 2), "error": str(error)})
        REPORT["failures"].append(name + ": " + str(error))
        print("FAIL " + name + ": " + str(error), flush=True)


async def select(page, selector, value):
    await page.wait_for_function("selector => !document.querySelector(selector).disabled", arg=selector)
    await page.select_option(selector, value)


async def earth_state(page):
    return await page.evaluate("""() => ({
        ready: prospectEarth.ready, target: prospectEarth.target,
        frameCount: prospectEarth.frameCount, zoom: prospectEarth.zoom,
        mode: prospectEarth.renderMode, paused: prospectEarth.paused,
        reducedMotion: prospectEarth.reducedMotion, isAnimating: prospectEarth.isAnimating,
        graphics: prospectEarth.graphics
    })""")


async def settled(page, stage, label, scale):
    # The hero intentionally pauses GPU work offscreen. Return to the actual
    # canvas before asserting the completed visual journey.
    await page.locator("#earth-scene").scroll_into_view_if_needed()
    await page.wait_for_function("""([stage, label, scale]) =>
        prospectEarth.target?.stage === stage && prospectEarth.target?.label === label &&
        Math.abs(prospectEarth.zoom - scale) < 0.00001""", arg=[stage, label, scale])
    return await earth_state(page)


async def initialize(context, page=None, expected_ready=True, block_business=True):
    global AUTH_STATE
    page = page or await context.new_page()
    page.on("pageerror", lambda error: REPORT["consoleErrors"].append(str(error)))
    if expected_ready:
        page.on("console", lambda message: REPORT["consoleErrors"].append(message.text)
            if message.type == "error" and "404 (Not Found)" not in message.text else None)
    page.on("request", lambda request: REPORT["requests"].append(request.url))
    page.on("response", lambda response: REPORT["failedResponses"].append({
        "url": response.url, "status": response.status}) if response.status >= 400 else None)
    if block_business:
        await page.route("**/api/search", lambda route: route.abort("blockedbyclient"))
    await page.goto(BASE, wait_until="networkidle")
    await page.wait_for_function("""() => !document.querySelector('#country').disabled ||
        (document.querySelector('#login-panel') && !document.querySelector('#login-panel').hidden)""")
    if await page.locator("#login-panel").count() and await page.locator("#login-panel").is_visible():
        fixture_response = await context.request.get(BASE + "/__test/info")
        assert fixture_response.ok, "Authenticated Earth tests require the disposable loopback fixture server."
        fixture = (await fixture_response.json())["desktop"]
        await page.locator("#login-email").fill(fixture["alice"]["email"])
        await page.locator("#login-password").fill(fixture["password"])
        await page.locator("#account-login-form button[type=submit]").click()
        await page.wait_for_function("() => !document.querySelector('#workspace').hidden")
        AUTH_STATE = await context.storage_state()
    await page.wait_for_function("() => !document.querySelector('#country').disabled")
    await page.locator("#earth-scene").scroll_into_view_if_needed()
    if expected_ready:
        await page.wait_for_function("() => window.prospectEarth?.ready", timeout=15000)
    return page


async def graphics_loaded(page):
    await page.wait_for_function("""() => window.prospectEarth?.graphics &&
        ['day', 'night', 'clouds', 'specular'].every(kind =>
            prospectEarth.graphics.textures[kind]?.loaded)""", timeout=15000)


async def measure_graphics(page):
    return await page.evaluate("""async () => {
        const canvas = document.querySelector('.earth-canvas');
        const gl = canvas.getContext('webgl2');
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        const started = performance.now();
        const before = prospectEarth.frameCount;
        const cloudBefore = prospectEarth.graphics.cloudRotation;
        await new Promise(resolve => setTimeout(resolve, 1600));
        const elapsed = performance.now() - started;
        const frames = prospectEarth.frameCount - before;
        const textures = performance.getEntriesByType('resource')
            .filter(entry => new URL(entry.name).pathname.startsWith('/assets/') &&
                /\\.(jpg|png|webp)$/.test(new URL(entry.name).pathname))
            .map(entry => ({path: new URL(entry.name).pathname,
                encodedBytes: entry.encodedBodySize,
                decodedBodyBytes: entry.decodedBodySize,
                transferBytes: entry.transferSize,
                durationMs: Math.round(entry.duration)}));
        const unique = new Map();
        for (const texture of textures)
            unique.set(texture.path, Math.max(unique.get(texture.path) || 0, texture.encodedBytes));
        return {elapsedMs: Math.round(elapsed), renderedFrames: frames,
            measuredFramesPerSecond: Number((frames * 1000 / elapsed).toFixed(2)),
            renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER),
            canvas: {width: canvas.width, height: canvas.height},
            viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
            cloudBefore, cloudAfter: prospectEarth.graphics.cloudRotation,
            graphics: prospectEarth.graphics, textures,
            uniqueTextureBytes: [...unique.values()].reduce((sum, bytes) => sum + bytes, 0),
            textureWireBytes: textures.reduce((sum, texture) => sum + texture.transferBytes, 0),
            limitation: 'ANGLE SwiftShader software rendering; observations do not predict phone or hardware GPU frame rates'};
    }""")


async def capture_realism(page, kind):
    await select(page, "#country", "BR")
    await select(page, "#region", "MG")
    await select(page, "#city", "15434")
    await settled(page, "city", "Uberlândia", 1.16)
    if not (await earth_state(page))["paused"]:
        await page.click("#earth-motion")
    await page.wait_for_timeout(100)
    path = f"/tmp/earth-realism-after-{kind}.png"
    await page.screenshot(path=path)
    REPORT["screenshots"].append(path)
    if kind == "desktop":
        await page.locator(".hero-earth-slot").screenshot(path="/tmp/earth-realism-after-scene.png")
        REPORT["screenshots"].append("/tmp/earth-realism-after-scene.png")


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True, args=["--no-sandbox", "--enable-unsafe-swiftshader"])
        context = await browser.new_context(viewport={"width": 1440, "height": 1000})
        page = await initialize(context)
        console_messages = []
        page.on("console", lambda message: console_messages.append({
            "type": message.type, "text": message.text}))

        async def actual_canvas():
            before = await earth_state(page)
            await page.wait_for_timeout(550)
            after = await earth_state(page)
            assert before["ready"] and after["frameCount"] > before["frameCount"]
            assert after["isAnimating"] and after["target"] is None
            assert await page.locator("#earth-scene.webgl-ready canvas").count() == 1
            dimensions = await page.locator("#earth-scene canvas").evaluate("""canvas => ({
                width:canvas.width, height:canvas.height, hidden:canvas.getAttribute('aria-hidden'),
                tabindex:canvas.tabIndex, rect:canvas.getBoundingClientRect().toJSON(),
                host:canvas.parentElement.getBoundingClientRect().toJSON()
            })""")
            assert dimensions["host"]["width"] >= 300, dimensions
            assert abs(dimensions["host"]["width"] - dimensions["host"]["height"]) <= 1, dimensions
            assert abs(dimensions["width"] - dimensions["height"]) <= 1, dimensions
            assert abs(dimensions["rect"]["width"] - dimensions["rect"]["height"]) <= 1, dimensions
            assert dimensions["width"] >= dimensions["host"]["width"] - 1
            assert dimensions["height"] >= dimensions["host"]["height"] - 1
            assert dimensions["hidden"] == "true" and dimensions["tabindex"] == -1
            assert not [message for message in console_messages if message["type"] == "error"]
            return {"before": before, "after": after, "canvas": dimensions}
        await check("Real square WebGL canvas renders and rotates inside the hero before selection", actual_canvas)

        async def real_graphics():
            await graphics_loaded(page)
            graphics = (await earth_state(page))["graphics"]
            assert graphics["profile"] == "desktop"
            assert 1 <= graphics["fpsLimit"] <= 30
            for kind in ["day", "night", "clouds", "specular"]:
                texture = graphics["textures"][kind]
                assert texture["loaded"] and texture["width"] >= 2048
                assert texture["width"] == texture["height"] * 2, f"{kind} lost world projection"
                assert urlsplit(texture["path"]).path.startswith("/assets/")
                assert any(urlsplit(url).path == urlsplit(texture["path"]).path
                    for url in REPORT["requests"]), f"{kind} status without an actual asset request"
            assert graphics["textures"]["day"]["width"] == 4096
            assert graphics["stars"]["layers"] >= 2
            assert graphics["stars"]["count"] > 600
            assert graphics["stars"]["galacticCount"] > 0
            assert 4 <= graphics["gpuTextures"] <= 12
            assert 3 <= graphics["drawCalls"] <= 25
            assert 1000 <= graphics["triangles"] <= 250000
            return graphics
        await check("Decoded world maps and cloud layer render with a varied star field and bounded scene", real_graphics)

        async def brazil_journey():
            await select(page, "#country", "BR")
            country = await settled(page, "country", "Brasil", 1)
            await select(page, "#region", "MG")
            state = await settled(page, "state", "Minas Gerais", 1.08)
            await select(page, "#city", "15434")
            city = await settled(page, "city", "Uberlândia", 1.16)
            assert city["target"]["latitude"] == -19.02333
            assert city["target"]["longitude"] == -48.33477
            assert await page.locator(".earth-location").is_visible()
            assert "Uberlândia" in await page.locator(".earth-location").inner_text()
            await page.click("#earth-motion")
            await page.wait_for_timeout(100)
            await page.screenshot(path="/tmp/prospect-earth-desktop.png", full_page=True)
            REPORT["screenshots"].append("/tmp/prospect-earth-desktop.png")
            return {"country": country, "state": state, "city": city}
        await check("Country state city travel uses real Brazil coordinates and increasing zoom", brazil_journey)

        async def pause_and_resume():
            await page.wait_for_timeout(100)
            before = await earth_state(page)
            assert before["paused"] and not before["isAnimating"]
            assert await page.locator("#earth-motion").get_attribute("aria-pressed") == "true"
            await page.wait_for_timeout(350)
            stationary = await earth_state(page)
            assert stationary["frameCount"] == before["frameCount"]
            assert stationary["graphics"]["cloudRotation"] == before["graphics"]["cloudRotation"]
            await select(page, "#country", "US")
            assert (await earth_state(page))["target"]["label"] == "Estados Unidos"
            await select(page, "#region", "NY")
            await select(page, "#city", "122795")
            new_york = await settled(page, "city", "New York City", 1.16)
            assert new_york["paused"] and new_york["target"]["longitude"] < -70
            assert new_york["target"]["latitude"] > 40
            await page.click("#earth-motion")
            await page.wait_for_timeout(300)
            resumed = await earth_state(page)
            assert not resumed["paused"] and resumed["isAnimating"]
            assert resumed["frameCount"] > new_york["frameCount"]
            return {"pausedSelection": new_york, "resumed": resumed}
        await check("Pause stops animation while selection and resume remain functional", pause_and_resume)

        async def rapid_change():
            brazil_response = await context.request.get(BASE + "/api/locations/states?country=BR")
            brazil_body = await brazil_response.text()
            async def delayed(route):
                await asyncio.sleep(0.5)
                await route.fulfill(status=200, content_type="application/json", body=brazil_body)
            await page.route("**/api/locations/states?country=BR", delayed)
            await select(page, "#country", "BR")
            await select(page, "#country", "US")
            await page.wait_for_timeout(650)
            assert (await earth_state(page))["target"]["label"] == "Estados Unidos"
            assert await page.locator('#region option[value="MG"]').count() == 0
            assert await page.locator('#region option[value="NY"]').count() == 1
            await page.unroute("**/api/locations/states?country=BR", delayed)
            await select(page, "#region", "NY")
            await select(page, "#city", "122795")
            state = await settled(page, "city", "New York City", 1.16)
            await select(page, "#city", "__manual__")
            await page.fill("#manual-city", "Unlisted City")
            fallback = await earth_state(page)
            assert fallback["target"]["stage"] == "state", "Manual city must not retain a previous city marker"
            assert fallback["target"]["label"] == "New York"
            return {"newYork": state, "manualCityUsesKnownParent": fallback["target"]}
        await check("Rapid country changes ignore obsolete lists and manual city avoids misleading markers", rapid_change)

        async def manual_edit_after_job_point():
            await page.fill("#manual-city", "Old Town")
            # Decorative event fixture only: no business or geocoder request.
            await page.evaluate("""() => {
                window.prospectLocationTarget = {
                    latitude: 40.71427, longitude: -74.00597,
                    stage: 'city', label: 'Old Town', countryCode: 'US'
                };
                dispatchEvent(new CustomEvent('prospect:location', {
                    detail: window.prospectLocationTarget
                }));
            }""")
            await settled(page, "city", "Old Town", 1.16)
            await page.evaluate("""() => {
                window.__earthTestEvents = 0;
                window.addEventListener('prospect:location', () => window.__earthTestEvents++);
            }""")
            await page.fill("#manual-city", "New Town")
            city_edited = await earth_state(page)
            assert city_edited["target"]["stage"] == "state"
            assert city_edited["target"]["label"] == "New York"
            assert await page.evaluate("() => window.prospectLocationTarget.stage") == "state"
            events_after_edit = await page.evaluate("() => window.__earthTestEvents")
            assert events_after_edit == 1
            await page.fill("#manual-city", "Another Town")
            assert await page.evaluate("() => window.__earthTestEvents") == events_after_edit

            await select(page, "#region", "__manual__")
            await page.fill("#manual-region", "Old Region")
            await page.fill("#manual-city", "Old Town")
            await page.evaluate("""() => {
                window.prospectLocationTarget = {
                    latitude: 40.71427, longitude: -74.00597,
                    stage: 'city', label: 'Old Town', countryCode: 'US'
                };
                dispatchEvent(new CustomEvent('prospect:location', {
                    detail: window.prospectLocationTarget
                }));
            }""")
            await settled(page, "city", "Old Town", 1.16)
            await page.fill("#manual-region", "New Region")
            state_edited = await earth_state(page)
            assert state_edited["target"]["stage"] == "country"
            assert state_edited["target"]["label"] == "Estados Unidos"
            return {"cityEditedReturnsTo": city_edited["target"],
                "stateEditedReturnsTo": state_edited["target"],
                "additionalCityEditEvents": 0,
                "fixtureScope": "Decorative job-location event; no business request"}
        await check("Editing manual locations clears a resolved old city without repeated parent travel", manual_edit_after_job_point)

        async def offscreen_pause():
            await page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            await page.wait_for_function("""() =>
                document.querySelector('#earth-scene').getBoundingClientRect().bottom < -120 &&
                !prospectEarth.isAnimating""")
            await page.wait_for_timeout(100)
            before = await earth_state(page)
            await page.wait_for_timeout(350)
            after = await earth_state(page)
            assert after["frameCount"] == before["frameCount"], (before, after)
            assert after["graphics"]["cloudRotation"] == before["graphics"]["cloudRotation"]
            # Dispatch the real dropdown change while leaving the viewport at
            # the footer, so browser auto-scrolling cannot wake the canvas.
            await page.evaluate("""() => {
                const country=document.querySelector('#country');
                country.value='BR';country.dispatchEvent(new Event('change',{bubbles:true}));
            }""")
            await page.wait_for_function("() => prospectEarth.target?.label === 'Brasil'")
            selected = await earth_state(page)
            assert selected["frameCount"] == after["frameCount"]
            returned = await settled(page, "country", "Brasil", 1)
            assert returned["isAnimating"] and returned["frameCount"] > selected["frameCount"]
            return {"offscreenFramesAdded": 0, "offscreenSelection": selected["target"], "returned": returned}
        await check("Offscreen hero stops GPU frames and preserves location changes until return", offscreen_pause)

        async def mobile_layout():
            await page.set_viewport_size({"width": 390, "height": 844})
            await select(page, "#country", "BR")
            await select(page, "#region", "MG")
            await select(page, "#city", "15434")
            await settled(page, "city", "Uberlândia", 1.16)
            if not (await earth_state(page))["paused"]:
                await page.click("#earth-motion")
            await page.wait_for_timeout(150)
            assert await page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
            assert await page.locator("#earth-scene").evaluate(
                "element => getComputedStyle(element).pointerEvents") == "none"
            if await page.locator(".earth-location").is_visible():
                label_box = await page.locator(".earth-location").bounding_box()
                host_box = await page.locator("#earth-scene").bounding_box()
                assert label_box and host_box
                assert label_box["x"] >= host_box["x"] and label_box["x"] + label_box["width"] <= host_box["x"] + host_box["width"] + 1, (label_box, host_box)
                assert label_box["y"] >= host_box["y"] and label_box["y"] + label_box["height"] <= host_box["y"] + host_box["height"] + 1, (label_box, host_box)
                heading_box = await page.locator("h1").bounding_box()
                intersects = label_box and heading_box and (
                    label_box["x"] < heading_box["x"] + heading_box["width"] and
                    label_box["x"] + label_box["width"] > heading_box["x"] and
                    label_box["y"] < heading_box["y"] + heading_box["height"] and
                    label_box["y"] + label_box["height"] > heading_box["y"])
                assert not intersects, "Geographic label overlaps the mobile heading"
            for selector in ["#country", "#region", "#city", "#niche", "#quantity"]:
                box = await page.locator(selector).bounding_box()
                assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390
            for width in [320, 390, 768, 1024, 1366, 1920]:
                await page.set_viewport_size({"width": width, "height": 1000})
                await page.wait_for_timeout(100)
                assert await page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), width
                dimensions = await page.locator("#earth-scene canvas").evaluate("""canvas => ({
                    width:canvas.width,height:canvas.height,
                    rect:canvas.getBoundingClientRect().toJSON(),
                    host:canvas.parentElement.getBoundingClientRect().toJSON()
                })""")
                assert dimensions["host"]["width"] >= min(250, width - 48), (width, dimensions)
                assert abs(dimensions["host"]["width"] - dimensions["host"]["height"]) <= 1, (width, dimensions)
                assert abs(dimensions["width"] - dimensions["height"]) <= 1, (width, dimensions)
                assert abs(dimensions["rect"]["width"] - dimensions["rect"]["height"]) <= 1, (width, dimensions)
                assert dimensions["host"]["x"] >= 0 and dimensions["host"]["x"] + dimensions["host"]["width"] <= width + 1, (width, dimensions)
            await page.set_viewport_size({"width": 390, "height": 844})
            assert await page.locator('#search button[type="submit"]').is_enabled()
            await page.screenshot(path="/tmp/prospect-earth-mobile.png", full_page=True)
            REPORT["screenshots"].append("/tmp/prospect-earth-mobile.png")
            return {"horizontalOverflow": False, "pointerEvents": "none", "state": await earth_state(page)}
        await check("Mobile canvas remains decorative and controls fit the viewport", mobile_layout)

        async def reduced_motion():
            reduced_context = await browser.new_context(
                viewport={"width": 1200, "height": 900}, reduced_motion="reduce", storage_state=AUTH_STATE)
            reduced_page = await initialize(reduced_context)
            await reduced_page.wait_for_timeout(150)
            before = await earth_state(reduced_page)
            await reduced_page.wait_for_timeout(350)
            assert (await earth_state(reduced_page))["frameCount"] == before["frameCount"]
            assert before["ready"] and before["reducedMotion"] and not before["isAnimating"]
            assert not await reduced_page.locator("#earth-motion").is_visible()
            await select(reduced_page, "#country", "US")
            await select(reduced_page, "#region", "NY")
            await select(reduced_page, "#city", "122795")
            after = await settled(reduced_page, "city", "New York City", 1.16)
            assert after["mode"] == "reduced-motion"
            await reduced_page.wait_for_timeout(100)
            stable = await earth_state(reduced_page)
            await reduced_page.wait_for_timeout(350)
            assert (await earth_state(reduced_page))["frameCount"] == stable["frameCount"]
            await reduced_context.close()
            return {"before": before, "after": after, "idleStable": True}
        await check("Reduced motion renders real Earth once and updates selections without animation", reduced_motion)

        async def performance_profile(kind, viewport, dpr, budget):
            performance_context = await browser.new_context(viewport=viewport, device_scale_factor=dpr, storage_state=AUTH_STATE)
            # Playwright request routing disables HTTP caching. This separate
            # page performs no search action and preserves real browser cache
            # behavior so transferSize measures the actual asset download.
            performance_page = await initialize(performance_context, block_business=False)
            await graphics_loaded(performance_page)
            result = await measure_graphics(performance_page)
            assert result["graphics"]["profile"] == kind
            assert result["renderedFrames"] > 0
            assert result["cloudAfter"] != result["cloudBefore"], "Cloud layer does not drift while motion is enabled"
            assert result["uniqueTextureBytes"] > 300000
            assert result["uniqueTextureBytes"] <= budget
            assert result["textureWireBytes"] <= budget + 10000
            ratio_cap = 1.25 if kind == "mobile" else 1.5
            host = await performance_page.locator("#earth-scene").bounding_box()
            assert host and abs(host["width"] - host["height"]) <= 1, host
            assert abs(result["canvas"]["width"] - result["canvas"]["height"]) <= 1, result["canvas"]
            assert result["canvas"]["width"] <= host["width"] * ratio_cap + 1
            assert result["canvas"]["height"] <= host["height"] * ratio_cap + 1
            if kind == "mobile":
                assert result["graphics"]["textures"]["day"]["width"] == 2048
                assert not [item for item in result["textures"]
                    if "earth-day-desktop" in item["path"]], "Mobile downloads the desktop map"
            await capture_realism(performance_page, kind)
            REPORT["performance"].append({"profile": kind, **result})
            await performance_context.close()
            return result
        await check("Desktop textures stay below 2 MB with real measured software rendering",
            lambda: performance_profile("desktop", {"width": 1440, "height": 1000}, 1, 2000000))
        await check("Mobile avoids HD desktop downloads and stays below 900 KB",
            lambda: performance_profile("mobile", {"width": 390, "height": 844}, 2, 900000))

        async def lost_context():
            before = await earth_state(page)
            lost = await page.locator("#earth-scene canvas").evaluate("""canvas => {
                const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
                if (!extension) return false;
                extension.loseContext();
                return true;
            }""")
            assert lost, "Test renderer does not expose WEBGL_lose_context"
            await page.wait_for_function("() => prospectEarth.renderMode === 'fallback'")
            assert not await page.locator("#earth-motion").is_visible()
            assert not await page.locator(".earth-location").is_visible()
            await select(page, "#country", "US")
            await select(page, "#region", "NY")
            await select(page, "#city", "122795")
            assert await page.locator('#search button[type="submit"]').is_enabled()
            return {"before": before, "after": await earth_state(page), "searchControlsUsable": True}
        await check("WebGL context loss activates static fallback and preserves filters", lost_context)

        async def unavailable_webgl():
            fallback_browser = await playwright.chromium.launch(
                executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
                headless=True, args=["--no-sandbox", "--disable-webgl"])
            fallback_context = await fallback_browser.new_context(viewport={"width": 390, "height": 844}, storage_state=AUTH_STATE)
            fallback_page = await initialize(fallback_context, expected_ready=False)
            await fallback_page.wait_for_function("() => window.prospectEarth?.renderMode === 'fallback'")
            await select(fallback_page, "#country", "BR")
            await select(fallback_page, "#region", "MG")
            await select(fallback_page, "#city", "15434")
            assert await fallback_page.locator('#search button[type="submit"]').is_enabled()
            assert not await fallback_page.locator("#earth-motion").is_visible()
            state = await earth_state(fallback_page)
            assert not state["ready"] and state["frameCount"] == 0
            await fallback_page.screenshot(path="/tmp/prospect-earth-fallback.png", full_page=True)
            REPORT["screenshots"].append("/tmp/prospect-earth-fallback.png")
            await fallback_browser.close()
            return {"state": state, "filtersUsable": True}
        await check("No WebGL supports static Earth and fully usable cascading filters", unavailable_webgl)

        async def request_scope():
            base_origin = urlsplit(BASE).netloc
            external = [url for url in REPORT["requests"] if urlsplit(url).netloc != base_origin]
            business = [url for url in REPORT["requests"] if urlsplit(url).path == "/api/search"]
            failed = [response for response in REPORT["failedResponses"]
                if urlsplit(response["url"]).path != "/favicon.ico"]
            assert not external, "Earth made external requests: " + str(external)
            assert not business, "Browser test attempted a business discovery request"
            assert not failed, "Resources failed: " + str(failed)
            assert not REPORT["consoleErrors"], str(REPORT["consoleErrors"])
            return {"sameOriginRequestCount": len(REPORT["requests"]),
                "externalRequests": 0, "businessSearchRequests": 0, "resourceErrors": failed}
        await check("Static textures modules and metadata stay same origin without business queries", request_scope)
        await browser.close()

    REPORT["passed"] = not REPORT["failures"]
    report_path = "/tmp/prospect-earth-browser.json"
    Path(report_path).write_text(json.dumps(REPORT, ensure_ascii=False, indent=2))
    print(json.dumps({
        "passed": REPORT["passed"], "checks": len(REPORT["checks"]),
        "failures": REPORT["failures"], "consoleErrors": REPORT["consoleErrors"],
        "failedResponses": REPORT["failedResponses"], "report": report_path,
        "performance": [{key: result[key] for key in ["profile", "renderer",
            "measuredFramesPerSecond", "uniqueTextureBytes", "textureWireBytes",
            "limitation"]} for result in REPORT["performance"]],
        "screenshots": REPORT["screenshots"]
    }, ensure_ascii=False, indent=2))
    return 0 if REPORT["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
