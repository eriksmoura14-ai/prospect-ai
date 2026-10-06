"""Real Chromium + built static frontend + separate local Node/PostgreSQL.
External rewrite is reproduced locally; this does not prove Vercel deployment.
Companies/accounts are controlled fixtures. No email or external search runs.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://localhost:3162"


async def check(browser, fixture, device):
    context = await browser.new_context(viewport={"width": 1366 if device == "desktop" else 390, "height": 900}, reduced_motion="reduce")
    page = await context.new_page()
    page.set_default_timeout(12000)
    errors = []
    requests = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))
    await page.goto(BASE)
    await expect(page.locator("#login-panel")).to_be_visible()
    assert (await context.request.get(BASE + "/api/history")).status == 401
    for path in ["/server.cjs", "/auth.cjs", "/db/schema.sql", "/.env"]:
        assert (await context.request.get(BASE + path)).status == 404
    await page.locator("#login-email").fill(fixture["alice"]["email"])
    await page.locator("#login-password").fill(fixture["password"])
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#history-list button")).to_have_count(1)
    cookies = await context.cookies()
    assert any(cookie["name"] == "prospect_session" and cookie["domain"] == "localhost" and cookie["httpOnly"] and cookie["sameSite"] == "Lax" for cookie in cookies)
    await page.reload()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#history-list button")).to_have_count(1)
    response = await context.request.get(BASE + "/api/jobs/" + fixture["jobId"])
    assert response.status == 200
    assert "no-store" in response.headers["cache-control"]
    assert len((await response.json())["rows"]) == 2
    account = await (await context.request.get(BASE + "/api/account")).json()
    headers = {"Origin": "https://untrusted.vercel.app", "X-CSRF-Token": account["csrfToken"], "Sec-Fetch-Site": "same-origin"}
    assert (await context.request.patch(BASE + "/api/account/preferences", headers=headers, data={"seller": "Test", "offer": "Test", "language": "Português"})).status == 403
    headers["Origin"] = BASE
    assert (await context.request.patch(BASE + "/api/account/preferences", headers=headers, data={"seller": "Test", "offer": "Test", "language": "Português"})).status == 200
    assert (await context.request.post(BASE + "/api/auth/login", headers={"Origin": BASE}, data={})).status == 403
    for path in ["/api/search", "/api/ai"]:
        # Fixture server prohibits external operations; reaching the controlled
        # endpoint proves routing only, not business discovery in production.
        response = await context.request.post(BASE + path, headers=headers, data={})
        assert response.status == 403
        assert "External operations prohibited" in (await response.json())["error"]
    await page.locator("#account-controls > summary").click()
    await page.locator("#account-logout").click()
    await expect(page.locator("#login-panel")).to_be_visible()
    assert (await context.request.get(BASE + "/api/history")).status == 401
    await page.locator("#login-email").fill(fixture["bob"]["email"])
    await page.locator("#login-password").fill(fixture["password"])
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    assert (await context.request.get(BASE + "/api/jobs/" + fixture["jobId"])).status == 404
    assert await (await context.request.get(BASE + "/api/history")).json() == []
    assert not errors, errors
    assert not any(url.startswith("http://127.0.0.1:3161") for url in requests), "Browser bypassed same-origin proxy"
    await context.close()
    return {"device": device, "login_reload_logout": True, "owner_isolation": True, "csrf": True, "private_files": True, "same_origin_api": True}


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-dev-shm-usage"])
        client = await browser.new_context()
        fixtures = await (await client.request.get(BASE + "/__test/info")).json()
        await client.close()
        report = {"scope": "Local real Chromium/PostgreSQL, built static frontend and local proxy; no Vercel production verification", "devices": []}
        for device in ["desktop", "mobile"]:
            report["devices"].append(await check(browser, fixtures[device], device))
        Path(".artifacts").mkdir(exist_ok=True)
        Path(".artifacts/frontend-browser-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
        await browser.close()


asyncio.run(main())
