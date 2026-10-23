"""Real local Chromium/Node/PostgreSQL; fictional contact-quality UI records.
No external discovery, site visits, emails or WhatsApp messages are performed.
Backend verification and encrypted persistence are checked separately in Node.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
REPORT = {"scope": "Local browser regressions with explicit fictional data; not live-business proof", "devices": []}

async def check(browser, device, fixture):
    context = await browser.new_context(viewport={"width": 390, "height": 844} if device == "mobile" else {"width": 1366, "height": 900}, reduced_motion="reduce")
    page = await context.new_page(); errors = []; external = []; destinations = []
    async def intercept_whatsapp(route):
        destinations.append({"url": route.request.url, "headers": await route.request.all_headers()})
        await route.fulfill(status=200,content_type="text/html",body="<title>Destino interceptado localmente</title>")
    await context.route("https://wa.me/**",intercept_whatsapp)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: external.append(request.url) if not request.url.startswith(BASE) else None)
    page.set_default_timeout(12000)
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.locator("#login-email").fill(fixture["alice"]["email"])
    await page.locator("#login-password").fill(fixture["password"])
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#history-list button")).to_have_count(1)
    navigation = "#mobile-nav" if device == "mobile" else "#app-sidebar"
    await page.locator(navigation + ' [data-nav-target="account-history"]').click()
    async with page.expect_response(lambda response: "/api/jobs/" in response.url and response.request.method == "GET" and response.status == 200) as history_response:
        await page.locator("#history-list button").click()
    await (await history_response.value).body()
    await expect(page.locator("#cards article")).to_have_count(2)
    cases = [
        {"name": "Contato ausente", "phone": "", "website": "", "status": "UNCERTAIN", "phoneVerification": "not_listed", "websiteVerification": "not_identified"},
        {"name": "Site da fonte", "phone": "", "website": "https://fixture.example/", "status": "WEBSITE_LISTED", "websiteVerification": "inconclusive", "websiteSource": "OpenStreetMap · contact:website"},
        {"name": "Página compatível", "phone": "+5511991234567", "phoneFormat": "valid", "sitePhone": "+5511991234567", "phoneSource": "https://fixture.example/", "phoneVerification": "website_published", "whatsappStatus": "unverified", "whatsappNumber": "+5511991234567", "whatsappUrl": "https://wa.me/5511991234567", "website": "https://fixture.example/", "status": "WEBSITE_FOUND", "websiteVerification": "compatible"},
        {"name": "Contato divergente", "phone": "(11) 3456-7890", "sitePhone": "+5511991234567", "phoneSource": "OpenStreetMap · phone", "phoneVerification": "conflict", "whatsappUrl": "", "website": "https://fixture.example/", "status": "WEBSITE_FOUND", "websiteVerification": "compatible"},
        {"name": "Perfil social", "phone": "", "website": "https://instagram.com/fixture", "status": "WEBSITE_LISTED", "websiteVerification": "profile"},
        {"name": "Formato incompleto", "phone": "123", "phoneFormat": "needs_review", "phoneVerification": "listed", "website": "", "status": "UNCERTAIN", "websiteVerification": "not_identified"},
        {"name": "WhatsApp na fonte", "phone": "+5534998883900", "phoneFormat": "valid", "phoneVerification": "listed", "whatsappStatus": "listed", "whatsappNumber": "+5534998883900", "whatsappUrl": "https://wa.me/5534998883900", "whatsappSource": "OpenStreetMap · contact:whatsapp", "website": "", "status": "UNCERTAIN", "websiteVerification": "not_identified"},
    ]
    for index, item in enumerate(cases):
        item.update({"osmId": "node/" + str(2000 + index), "category": "Barber", "city": "Cidade de fixture", "countryCode": "BR", "confidence": 0.4, "prospectScore": 40-index})
    await page.evaluate("cases => { rows = cases; render(); }", cases)
    await expect(page.locator("#cards article")).to_have_count(7)
    def card(name): return page.locator("#cards article").filter(has=page.locator("h3", has_text=name))
    for name in [item["name"] for item in cases]:
        await card(name).locator(".card-analysis > summary").click()
    await expect(card("Contato ausente").locator(".whatsapp-contact")).to_have_count(0)
    await expect(card("Contato ausente")).to_contain_text("não comprova ausência de telefone")
    await expect(card("Contato ausente")).to_contain_text("não comprova ausência de site")
    await expect(card("Site da fonte").locator(".website-status")).to_have_text("Site na fonte")
    await expect(card("Site da fonte")).to_contain_text("identidade ou disponibilidade não confirmadas")
    await expect(card("Página compatível").locator(".website-status")).to_have_text("Site compatível")
    await expect(card("Página compatível").locator(".contact-information a")).to_have_attribute("href", "https://fixture.example/")
    await expect(card("Contato divergente").locator("button.whatsapp-contact")).to_be_disabled()
    await expect(card("Contato divergente")).to_contain_text("(11) 3456-7890")
    await expect(card("Contato divergente")).to_contain_text("+5511991234567")
    await expect(card("Perfil social").locator(".website-status")).to_have_text("Perfil na fonte")
    await expect(card("Formato incompleto").locator(".contact-status")).to_have_text("Formato a revisar")
    await expect(card("Formato incompleto").locator("button.whatsapp-contact")).to_be_disabled()
    await expect(card("WhatsApp na fonte").locator("a.whatsapp-contact")).to_have_attribute("href", "https://wa.me/5534998883900")
    await expect(card("WhatsApp na fonte").locator(".whatsapp-number").first).to_have_text("+5534998883900")
    await expect(card("WhatsApp na fonte")).to_contain_text("Conta WhatsApp não verificada")
    await expect(card("WhatsApp na fonte")).to_contain_text("OpenStreetMap · contact:whatsapp")
    async with page.expect_popup() as popup_event:
        await card("WhatsApp na fonte").locator("a.whatsapp-contact").click()
    popup=await popup_event.value
    await popup.wait_for_load_state("domcontentloaded")
    assert popup.url == "https://wa.me/5534998883900"
    assert await popup.evaluate("() => window.opener === null")
    assert len(destinations) == 1
    assert not any(name in destinations[0]["headers"] for name in ["cookie","authorization","referer"])
    await popup.close()
    await page.locator(".result-options > summary").click()
    await page.locator('[data-filter="found"]').click()
    await expect(page.locator("#cards article")).to_have_count(3)
    await expect(page.locator("#cards")).not_to_contain_text("Perfil social")
    await page.locator('[data-filter="prospect"]').click()
    await expect(page.locator("#cards article")).to_have_count(3)
    await expect(page.locator("#cards")).to_contain_text("Contato ausente")
    await page.locator('[data-filter="uncertain"]').click()
    await expect(page.locator("#cards article")).to_have_count(5)
    await page.locator('[data-filter="all"]').click()
    await page.locator("#phone-filter").select_option("no")
    await expect(page.locator("#cards article")).to_have_count(3)
    await page.locator("#phone-filter").select_option("all")
    await page.locator("#safe-contact").check()
    await expect(page.locator("#cards article")).to_have_count(2)
    await expect(page.locator("#cards")).not_to_contain_text("Formato incompleto")
    await expect(page.locator("#cards")).not_to_contain_text("Contato divergente")
    await page.locator("#safe-contact").uncheck()
    await page.locator("#phone-filter").select_option("whatsapp")
    await expect(page.locator("#cards article h3")).to_have_text("WhatsApp na fonte")
    await expect(page.locator("#cards")).not_to_contain_text("Página compatível")
    await page.locator("#phone-filter").select_option("all")
    assert "Sem telefone" not in await page.locator("#phone-filter").inner_text()
    async with page.expect_download() as download_event:
        await page.locator("#csv").click()
    downloaded = await download_event.value
    text = Path(await downloaded.path()).read_text()
    assert "phoneVerification" in text and "websiteVerification" in text and "conflict" in text
    for value in ["phoneFormat", "whatsappNumber", "whatsappStatus", "whatsappSource", "+5534998883900", "needs_review", "OpenStreetMap · contact:whatsapp"]:
        assert value in text, value
    assert not await page.evaluate("() => document.documentElement.scrollWidth > innerWidth")
    assert not errors, errors
    assert not external, external
    await page.screenshot(path=str(Path(__file__).resolve().parents[1] / ".artifacts" / f"contact-quality-{device}.png"))
    REPORT["devices"].append({"device": device, "cases": 12, "ambiguousDataLabeled": True, "conflictingContactDisabled": True, "invalidFormatExcluded": True, "publishedWhatsAppFilter": True, "destinationDigitsPreserved": True, "sourceRetained": True, "exportsRetainQuality": True, "pageErrors": errors, "externalRequests": external})
    await context.close()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        for device in ["desktop", "mobile"]:
            context = await browser.new_context()
            response = await context.request.get(BASE + "/__test/info")
            fixture = (await response.json())[device]
            await context.close()
            await check(browser, device, fixture)
        await browser.close()
    root = Path(__file__).resolve().parents[1] / ".artifacts"
    root.mkdir(exist_ok=True)
    (root / "contact-quality-browser.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2))
    print(json.dumps({"passed": True, "cases": 24, "devices": ["desktop", "mobile"], "scope": REPORT["scope"]}, ensure_ascii=False))

asyncio.run(main())
