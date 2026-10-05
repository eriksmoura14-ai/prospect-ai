"""Real local Chromium/Node/PostgreSQL checks for the dashboard redesign.
Uses fictional company/account fixtures and real geographic metadata.
No discovery, emails, model calls or WhatsApp messages are performed.
Start test/prospects-browser-server.cjs with a disposable local database first.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
ARTIFACTS = Path(__file__).resolve().parents[1] / ".artifacts"
REPORT = {"scope": "Real local Chromium/Node/PostgreSQL and geographic metadata; external operations prohibited", "devices": []}


async def nav(page, target, mobile):
    if mobile:
        await page.locator("#menu-toggle").click()
        await expect(page.locator("#menu-toggle")).to_have_attribute("aria-expanded", "true")
        assert await page.locator(".app-content").evaluate("element => element.inert")
    await page.locator(target).click()
    if mobile:
        await expect(page.locator("#menu-toggle")).to_have_attribute("aria-expanded", "false")
        assert not await page.locator(".app-content").evaluate("element => element.inert")


async def device_check(browser, device, fixture):
    mobile = device == "mobile"
    viewport = {"width": 390, "height": 844} if mobile else {"width": 1440, "height": 1000}
    context = await browser.new_context(viewport=viewport, reduced_motion="reduce")
    page = await context.new_page(); errors = []; external = []; violations = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external.append(request.url) if not request.url.startswith(BASE) else None)
    page.set_default_timeout(12000)
    await page.add_init_script("window.dashboardCSP=[];document.addEventListener('securitypolicyviolation',event=>window.dashboardCSP.push(event.violatedDirective));")
    await page.goto(BASE, wait_until="domcontentloaded")
    await expect(page.locator("#login-panel")).to_be_visible()
    await expect(page.locator("#workspace")).to_be_hidden()
    await expect(page.locator("#nav-agent")).to_be_disabled()
    if mobile:
        await page.locator("#menu-toggle").click()
        await expect(page.locator("#app-sidebar")).to_be_visible()
        await page.locator("#menu-close").press("Shift+Tab")
        assert await page.evaluate("() => document.activeElement.matches('[data-nav-target=explore-section]')")
        await page.keyboard.press("Escape")
        await expect(page.locator("#menu-toggle")).to_be_focused()
        await expect(page.locator("#app-sidebar")).not_to_be_visible()
    await page.locator("#login-email").fill(fixture["alice"]["email"])
    await page.locator("#login-password").fill(fixture["password"])
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#country")).to_be_enabled()
    await expect(page.locator("#niche option")).to_have_count(24)
    await expect(page.locator("#results-count")).to_be_hidden()
    await expect(page.locator(".stats")).to_be_hidden()
    await nav(page, '[data-nav-target="account-history"]', mobile)
    await expect(page.locator("#account-history")).to_have_attribute("open", "")
    await page.locator("#history-list button").click()
    await expect(page.locator("#cards article")).to_have_count(2)
    await expect(page.locator("#results-count")).to_have_text("2 resultados")
    await expect(page.locator("#total")).to_have_text("2")
    await expect(page.locator("#cards a.whatsapp-contact")).to_have_attribute("href", "https://wa.me/5511912345678")
    await expect(page.locator("#cards .card-analysis").first).not_to_have_attribute("open", "")
    await page.locator("#cards .card-analysis > summary").first.click()
    await expect(page.locator("#cards .card-analysis").first).to_have_attribute("open", "")
    await expect(page.locator("#cards .card-analysis a").filter(has_text="Ver fonte").first).to_be_visible()
    await expect(page.locator("#cards .score").first).to_be_visible()
    await page.locator("#cards .card-analysis > summary").first.click()
    await page.locator('[data-filter="found"]').click()
    await expect(page.locator("#cards article")).to_have_count(1)
    await expect(page.locator("#cards article h3")).to_have_text("Oficina de exemplo")
    await page.locator('[data-filter="all"]').click()
    await expect(page.locator("#cards article")).to_have_count(2)
    await page.locator("#sort").select_option("name")
    async with page.expect_download() as download_event:
        await page.locator("#json").click()
    download = await download_event.value
    exported = json.loads(Path(await download.path()).read_text())
    assert len(exported["results"]) == 2 and exported["partial"] is False
    await nav(page, '[data-nav-target="lists-section"]', mobile)
    await expect(page.locator("#lists-section")).to_have_attribute("open", "")
    await expect(page.locator("#list-create")).to_be_visible()
    await nav(page, "#nav-agent", mobile)
    await expect(page.locator(".ai-dialog")).to_be_visible()
    await expect(page.get_by_role("heading", name="Seu agente de prospecção", exact=True)).to_be_visible()
    await expect(page.get_by_role("button", name="1. Revisar empresa", exact=True)).to_be_hidden()
    await page.get_by_label("Seu nome ou nome da sua empresa", exact=True).fill("Equipe de fixture do dashboard")
    await page.get_by_label("Sua oferta", exact=True).fill("Oferta de teste da interface.")
    await page.locator("#ai-tone").select_option("Profissional")
    async with page.expect_response(lambda response: response.url.endswith("/api/account/preferences") and response.request.method == "PATCH" and response.status == 200):
        await page.locator("#ai-knowledge").fill("Condições da conta local de teste.")
    await page.locator(".ai-dialog").get_by_role("button", name="Fechar", exact=True).click()
    if mobile: await expect(page.locator("#menu-toggle")).to_be_focused()
    await page.reload()
    await expect(page.locator("#workspace")).to_be_visible()
    await nav(page, "#nav-agent", mobile)
    await expect(page.locator("#ai-tone")).to_have_value("Profissional")
    await expect(page.locator("#ai-knowledge")).to_have_value("Condições da conta local de teste.")
    await page.locator(".ai-dialog").get_by_role("button", name="Fechar", exact=True).click()
    await nav(page, '[data-nav-target="account-history"]', mobile)
    await page.locator("#history-list button").click()
    await page.get_by_role("button", name="Abrir assistente de IA").first.click()
    await expect(page.get_by_role("button", name="1. Revisar empresa", exact=True)).to_be_visible()
    await expect(page.locator("#ai-knowledge")).to_have_value("Condições da conta local de teste.")
    await page.locator(".ai-dialog").get_by_role("button", name="Fechar", exact=True).click()
    await nav(page, "#nav-settings", mobile)
    await expect(page.locator("#account-logout")).to_be_visible()
    await page.locator("#account-controls > summary").click()
    await nav(page, '[data-nav-target="explore-section"]', mobile)
    await page.locator("#country").select_option("BR")
    await expect(page.locator("#region")).to_be_enabled()
    await page.locator("#region").select_option("SP")
    await expect(page.locator("#city")).to_be_enabled()
    sao_paulo = await page.locator("#city option").evaluate_all("options => options.find(option => option.text === 'São Paulo').value")
    await page.locator("#city").select_option(sao_paulo)
    await page.locator("#niche").select_option("Hamburguerias")
    await page.locator("#quantity").select_option("50")
    await expect(page.locator("#search button[type=submit]")).to_be_enabled()
    for attempt in range(40):
        ready = await page.evaluate("() => window.prospectEarth?.ready && ['day','clouds','night','specular'].every(key=>prospectEarth.graphics.textures[key].loaded)")
        if ready: break
        await page.wait_for_timeout(250)
    assert ready, "Actual Earth renderer/textures must load"
    assert await page.evaluate("() => prospectEarth.target.label") == "São Paulo"
    assert await page.evaluate("() => prospectEarth.zoom") == 1.16
    ARTIFACTS.mkdir(exist_ok=True)
    await page.screenshot(path=str(ARTIFACTS / f"dashboard-{device}.png"), full_page=True)
    await page.locator("#country").select_option("US")
    await expect(page.locator("#region")).to_be_enabled()
    await page.locator("#region").select_option("NY")
    await expect(page.locator("#city")).to_be_enabled()
    await page.locator("#city").select_option("122795")
    assert await page.evaluate("() => prospectEarth.target.label") == "New York City"
    for width in ([320, 390, 768] if mobile else [1024, 1366, 1920]):
        await page.set_viewport_size({"width": width, "height": 1000})
        assert not await page.evaluate("() => document.documentElement.scrollWidth > innerWidth"), width
        for selector in ["#country", "#region", "#city", "#niche", "#quantity"]:
            bounds = await page.locator(selector).bounding_box()
            assert bounds and bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= width, (width, selector)
    await page.set_viewport_size(viewport)
    await page.evaluate("() => accountUI.expire()")
    await expect(page.locator("#workspace")).to_be_hidden()
    await expect(page.locator("#nav-agent")).to_be_disabled()
    await expect(page.locator("#cards article")).to_have_count(0)
    await expect(page.locator(".ai-dialog")).to_have_count(0)
    violations = await page.evaluate("() => window.dashboardCSP")
    assert not errors, errors
    assert not violations, violations
    assert not external, external
    REPORT["devices"].append({"device":device,"passed":True,"checks":["login-and-private-navigation","mobile-focus-and-escape","history-and-results","expandable-evidence","status-filter","export","lists-navigation","agent-preferences-persist","company-assistant","account-menu","country-state-city-and-Earth","responsive-widths","session-expiry","no-CSP-violations"],"externalOperations":0})
    print("PASS dashboard browser " + device, flush=True)
    await context.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium",args=["--no-sandbox","--disable-dev-shm-usage","--enable-unsafe-swiftshader"])
        api = await p.request.new_context()
        fixtures = await (await api.get(BASE + "/__test/info")).json()
        try:
            for device in ["desktop","mobile"]: await device_check(browser,device,fixtures[device])
        finally:
            ARTIFACTS.mkdir(exist_ok=True)
            (ARTIFACTS / "dashboard-browser.json").write_text(json.dumps(REPORT,ensure_ascii=False,indent=2))
            await api.dispose();await browser.close()


asyncio.run(main())
