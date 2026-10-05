"""Real Chromium + local Node/PostgreSQL. Accounts and companies are fixtures;
no mail is sent, no business provider is queried, and no production data is used.
Start test/prospects-browser-server.cjs with a disposable local TEST_DATABASE_URL.
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
ARTIFACTS = Path(__file__).resolve().parents[1] / ".artifacts"
REPORT = {"scope": "Local real Chromium/Node/PostgreSQL with controlled company and account fixtures", "devices": []}


async def login(page, user, password):
    await page.locator("#login-email").fill(user["email"])
    await page.locator("#login-password").fill(password)
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#lists-section")).to_be_visible()


async def check_device(browser, device, fixture):
    viewport = {"width": 1366, "height": 900} if device == "desktop" else {"width": 390, "height": 844}
    context = await browser.new_context(viewport=viewport, reduced_motion="reduce")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(12000)
    await page.goto(BASE)
    await expect(page.locator("#login-panel")).to_be_visible()
    await expect(page.locator("#lists-section")).to_be_hidden()
    await login(page, fixture["alice"], fixture["password"])
    await expect(page.locator("#history-list button")).to_have_count(1)
    await page.locator("#account-history>summary").click()
    await page.locator("#history-list button").click()
    await expect(page.locator(".save-to-list")).to_have_count(2)

    await page.locator(".save-to-list").first.click()
    await expect(page.locator("#list-save-submit")).to_be_enabled()
    await page.locator("#list-save-name").fill("Campanha principal")
    await page.locator("#list-save-submit").click()
    await expect(page.locator("#list-save-dialog")).not_to_be_visible()
    await expect(page.locator("#list-companies article")).to_have_count(1)
    list_id = await page.locator("#list-select").input_value()
    company = page.locator("#list-companies article").first
    note = "Retornar na sexta-feira\n<img src=x onerror=window.listXss=1>"
    await company.locator("textarea").fill(note)
    await page.locator("#list-search").fill("Não encontrado")
    await expect(page.locator("#list-companies article")).to_have_count(0)
    await page.locator("#list-search").fill("")
    await expect(company.locator("textarea")).to_have_value(note)
    await company.locator("select").select_option("interested")
    await company.get_by_role("button", name="Salvar alterações").click()
    await expect(company.locator(".prospect-message")).to_have_text("Alterações salvas.")
    await expect(page.locator("#list-summary")).to_contain_text("Interessado: 1")
    assert await page.evaluate("window.listXss || null") is None

    await page.locator(".save-to-list").first.click()
    await expect(page.locator("#list-save-submit")).to_be_enabled()
    await page.locator("#list-save-submit").click()
    await expect(page.locator("#lists-status")).to_contain_text("já estava")
    await expect(page.locator("#list-companies article")).to_have_count(1)
    await expect(company.locator("textarea")).to_have_value(note)
    await expect(company.locator("select")).to_have_value("interested")

    await page.locator(".save-to-list").nth(1).click()
    await expect(page.locator("#list-save-submit")).to_be_enabled()
    await page.locator("#list-save-submit").click()
    await expect(page.locator("#list-companies article")).to_have_count(2)
    await page.locator("#list-status-filter").select_option("interested")
    await expect(page.locator("#list-companies article")).to_have_count(1)
    await page.locator("#list-status-filter").select_option("all")
    await page.reload()
    await expect(page.locator("#lists-count")).to_have_text("1 lista")
    await page.locator("#lists-section>summary").click()
    await expect(page.locator("#list-companies article")).to_have_count(2)
    saved = page.locator("#list-companies article").filter(has=page.locator(".prospect-contact-status.interested"))
    await expect(saved.locator("textarea")).to_have_value(note)
    await expect(saved.locator("select")).to_have_value("interested")
    assert await page.evaluate("window.listXss || null") is None

    await page.locator("#list-rename").click()
    await page.locator("#list-name").fill("Campanha renomeada")
    await page.locator("#list-name-submit").click()
    await expect(page.locator("#list-select option")).to_contain_text(["Campanha renomeada"])
    await page.locator("#list-create").click()
    await page.locator("#list-name").fill("Lista temporária")
    await page.locator("#list-name-submit").click()
    await expect(page.locator("#lists-count")).to_have_text("2 listas")
    page.once("dialog", lambda dialog: dialog.accept())
    await page.locator("#list-delete").click()
    await expect(page.locator("#lists-count")).to_have_text("1 lista")
    await expect(page.locator("#list-companies article")).to_have_count(2)

    overflow = await page.evaluate("document.documentElement.scrollWidth > innerWidth")
    assert not overflow
    ARTIFACTS.mkdir(exist_ok=True)
    await page.locator("#lists-section").scroll_into_view_if_needed()
    await page.screenshot(path=str(ARTIFACTS / f"prospect-lists-{device}.png"))
    await page.locator("#account-controls>summary").click()
    await page.locator("#account-logout").click()
    await expect(page.locator("#login-panel")).to_be_visible()
    await expect(page.locator("#list-companies article")).to_have_count(0)
    await login(page, fixture["bob"], fixture["password"])
    await page.locator("#lists-section>summary").click()
    await expect(page.locator("#lists-count")).to_have_text("0 listas")
    await expect(page.locator("#list-companies article")).to_have_count(0)
    response = await page.evaluate("id => fetch('/api/lists/'+id+'/companies').then(r=>r.status)", list_id)
    assert response == 404
    await page.locator("#list-create").click()
    await page.locator("#list-name").fill("Lista da segunda conta")
    await page.locator("#list-name-submit").click()
    await expect(page.locator("#lists-count")).to_have_text("1 lista")
    await page.evaluate("fetch('/__test/expire').then(r=>r.text())")
    await page.locator("#lists-refresh").click()
    await expect(page.locator("#login-panel")).to_be_visible()
    await expect(page.locator("#lists-section")).to_be_hidden()
    await expect(page.locator("#list-select option")).to_have_count(0)
    assert not errors, errors
    REPORT["devices"].append({"device": device, "passed": True, "overflow": overflow, "pageErrors": errors,
        "checks": ["save", "dedup", "notes", "draft-preservation", "contact-status", "filters", "reload-persistence", "literal-html", "rename", "create", "delete", "account-isolation", "session-expiry"]})
    print("PASS lists browser " + device, flush=True)
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
            (ARTIFACTS / "prospect-lists-browser.json").write_text(json.dumps(REPORT, indent=2))
            await api.dispose()
            await browser.close()


asyncio.run(main())
