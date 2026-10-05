"""Local Chromium/Node/PostgreSQL profile persistence, isolation and UI checks.
The fixture server explicitly prohibits provider calls. This does not assess
model output quality; agent-evaluation.cjs calls the real provider separately.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
REPORT = {"scope": "Real local browser/backend/PostgreSQL; model calls prohibited", "checks": []}


async def login(page, user, password):
    await page.locator("#login-email").fill(user["email"])
    await page.locator("#login-password").fill(password)
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#country")).to_be_enabled()


async def open_panel(page, job_id):
    await page.evaluate("id => watch(id)", job_id)
    await page.get_by_role("button", name="Abrir assistente de IA").first.click()
    await expect(page.locator(".ai-dialog")).to_be_visible()


async def check(browser, device, fixture):
    viewport = {"width": 1366, "height": 900} if device == "desktop" else {"width": 390, "height": 844}
    context = await browser.new_context(viewport=viewport, reduced_motion="reduce")
    page = await context.new_page(); errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(12000)
    await page.goto(BASE)
    await expect(page.locator("#login-panel")).to_be_visible()
    await login(page, fixture["alice"], fixture["password"])
    await open_panel(page, fixture["jobId"])
    await expect(page.locator("#ai-tone")).to_have_value("Natural")
    await expect(page.locator("#ai-knowledge")).to_have_value("")
    knowledge = "Manutenção é separada; desconto só com autorização. <img src=x onerror=window.agentXss=1>"
    await page.get_by_label("Seu nome ou nome da sua empresa", exact=True).fill("Equipe de fixture")
    await page.get_by_label("Sua oferta", exact=True).fill("Oferta de fixture com orçamento por escopo.")
    await page.locator("#ai-tone").select_option("Profissional")
    async with page.expect_response(lambda response: response.url.endswith("/api/account/preferences") and response.request.method == "PATCH" and response.status == 200):
        await page.locator("#ai-knowledge").fill(knowledge)
    profile = await page.evaluate("() => fetch('/api/account').then(response=>response.json()).then(value=>value.user.preferences)")
    assert profile["knowledge"] == knowledge and profile["tone"] == "Profissional"
    await page.locator(".ai-dialog").get_by_role("button", name="Fechar", exact=True).click()
    await page.reload()
    await expect(page.locator("#workspace")).to_be_visible()
    await open_panel(page, fixture["jobId"])
    await expect(page.locator("#ai-tone")).to_have_value("Profissional")
    await expect(page.locator("#ai-knowledge")).to_have_value(knowledge)
    captured = []
    page.on("request", lambda request: captured.append(request.post_data_json) if request.url.endswith("/api/ai") else None)
    await page.get_by_label("Nova resposta do cliente", exact=True).fill("Quanto custa?")
    await page.get_by_role("button", name="3. Sugerir resposta", exact=True).click()
    await expect(page.locator(".ai-status")).to_contain_text("External operations prohibited")
    assert captured and captured[0]["tone"] == "Profissional" and captured[0]["knowledge"] == knowledge
    assert await page.evaluate("() => window.agentXss || null") is None
    assert not await page.evaluate("() => document.documentElement.scrollWidth > innerWidth")
    await page.evaluate("() => fetch('/__test/expire').then(response=>response.text())")
    await page.evaluate("() => accountUI.expire()")
    await expect(page.locator(".ai-dialog")).to_have_count(0)
    await login(page, fixture["bob"], fixture["password"])
    other = await page.evaluate("() => fetch('/api/account').then(response=>response.json()).then(value=>value.user.preferences)")
    assert "knowledge" not in other and "tone" not in other
    assert not errors, errors
    REPORT["checks"].append({"device": device, "passed": True, "persistedAfterReload": True,
        "isolatedFromOtherAccount": True, "literalHTML": True, "requestCarriesProfile": True,
        "privatePanelRemovedOnExpiry": True, "modelCalls": 0, "pageErrors": errors})
    print("PASS agent profile browser " + device, flush=True)
    await context.close()


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        client = await browser.new_context()
        fixtures = await (await client.request.get(BASE + "/__test/info")).json()
        await client.close()
        for device in ["desktop", "mobile"]:
            await check(browser, device, fixtures[device])
        await browser.close()
    artifacts = Path(__file__).resolve().parents[1] / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    (artifacts / "agent-profile-browser-report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
