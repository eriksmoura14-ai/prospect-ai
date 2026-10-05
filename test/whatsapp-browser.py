"""Chromium + local Node/PostgreSQL using fictional account/company fixtures.
WhatsApp navigation is intercepted locally; no messages, provider lookups or
WhatsApp registration checks occur. Start prospects-browser-server.cjs first.
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
URL = "https://wa.me/5511912345678"
ARTIFACTS = Path(__file__).resolve().parents[1] / ".artifacts"
REPORT = {"scope": "Real local Chromium/Node/PostgreSQL; WhatsApp destination intercepted, no message or account verification", "devices": []}


async def check_device(browser, device, fixture):
    viewport = {"width": 1366, "height": 900} if device == "desktop" else {"width": 390, "height": 844}
    context = await browser.new_context(viewport=viewport, reduced_motion="reduce")
    requests = []

    async def whatsapp_destination(route):
        requests.append({"url": route.request.url, "headers": await route.request.all_headers()})
        await route.fulfill(status=200, content_type="text/html", body="<title>Local intercepted navigation</title><p>No message sent</p>")

    await context.route("https://wa.me/**", whatsapp_destination)
    page = await context.new_page()
    page.set_default_timeout(12000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    await page.goto(BASE, wait_until="domcontentloaded")
    await page.locator("#login-email").fill(fixture["alice"]["email"])
    await page.locator("#login-password").fill(fixture["password"])
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#history-list button")).to_have_count(1)
    await page.locator("#account-history>summary").click()
    await page.locator("#history-list button").click()
    await expect(page.locator("#cards article")).to_have_count(2)
    contact = page.locator("#cards a.whatsapp-contact")
    await expect(contact).to_have_count(1)
    await expect(contact).to_have_attribute("href", URL)
    await expect(page.locator("#cards .contact").filter(has_text="(11) 91234-5678")).to_have_count(1)
    await expect(page.locator("#cards article").filter(has_text="Oficina de exemplo").locator(".whatsapp-contact")).to_have_count(0)
    await expect(page.locator("#country")).to_be_enabled()
    await page.locator("#country").select_option("US")
    await expect(contact).to_have_attribute("href", URL)
    assert await contact.evaluate("element => element.getBoundingClientRect().height >= 44")

    async with page.expect_popup() as popup_event:
        await contact.click()
    popup = await popup_event.value
    await popup.wait_for_load_state("domcontentloaded")
    assert popup.url == URL
    assert await popup.evaluate("() => window.opener === null")
    assert requests and requests[0]["url"] == URL
    assert not any(key in requests[0]["headers"] for key in ["cookie", "authorization", "referer"])
    await popup.close()

    await page.locator(".save-to-list").first.click()
    await expect(page.locator("#list-save-submit")).to_be_enabled()
    await page.locator("#list-save-name").fill("Contatos WhatsApp")
    await page.locator("#list-save-submit").click()
    await expect(page.locator("#list-save-dialog")).not_to_be_visible()
    saved = page.locator("#list-companies a.whatsapp-contact")
    await expect(saved).to_have_count(1)
    await expect(saved).to_have_attribute("href", URL)
    await page.reload()
    await expect(page.locator("#lists-count")).to_have_text("1 lista")
    await page.locator("#lists-section>summary").click()
    await expect(saved).to_have_attribute("href", URL)
    async with page.expect_popup() as popup_event:
        await saved.click()
    popup = await popup_event.value
    await popup.wait_for_load_state("domcontentloaded")
    assert popup.url == URL
    await popup.close()
    assert len(requests) == 2
    assert not await page.evaluate("() => document.documentElement.scrollWidth > innerWidth")
    assert not errors, errors
    assert await page.evaluate("() => window.listXss || null") is None
    ARTIFACTS.mkdir(exist_ok=True)
    await page.screenshot(path=str(ARTIFACTS / f"whatsapp-{device}.png"))
    REPORT["devices"].append({"device": device, "passed": True, "href": URL, "navigationIntercepted": True,
        "checks": ["national-phone-country", "no-phone-no-link", "country-selection-does-not-change-recipient", "results-popup", "no-opener-no-auth-no-referrer", "saved-list-reload-popup", "touch-target", "no-overflow", "literal-source-text"]})
    print("PASS WhatsApp browser " + device, flush=True)
    await context.close()


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        api = await playwright.request.new_context()
        response = await api.get(BASE + "/__test/info")
        fixtures = await response.json()
        try:
            for device in ["desktop", "mobile"]:
                await check_device(browser, device, fixtures[device])
        finally:
            ARTIFACTS.mkdir(exist_ok=True)
            (ARTIFACTS / "whatsapp-browser.json").write_text(json.dumps(REPORT, indent=2))
            await api.dispose()
            await browser.close()


asyncio.run(main())
