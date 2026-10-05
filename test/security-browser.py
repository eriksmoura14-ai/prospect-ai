"""Real local Chromium/Node/PostgreSQL security regressions.

Use test/prospects-browser-server.cjs and disposable local TEST_DATABASE_URL.
Delayed responses are actual authorized fixture responses, not fabricated data.
No production users, external company searches or emails are used.
"""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

BASE = "http://127.0.0.1:3161"
REPORT = {"scope": "Local real Chromium/Node/PostgreSQL; actual fixture responses delayed across session revocation", "checks": []}


async def login(page, user, password):
    await page.locator("#login-email").fill(user["email"])
    await page.locator("#login-password").fill(password)
    await page.locator("#account-login-form button[type=submit]").click()
    await expect(page.locator("#workspace")).to_be_visible()
    await expect(page.locator("#country")).to_be_enabled()


async def check(browser, device, kind, fixture):
    viewport = {"width": 1366, "height": 900} if device == "desktop" else {"width": 390, "height": 844}
    context = await browser.new_context(viewport=viewport, reduced_motion="reduce")
    page = await context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_default_timeout(12000)
    await page.goto(BASE)
    await expect(page.locator("#login-panel")).to_be_visible()
    await login(page, fixture["alice"], fixture["password"])
    await expect(page.locator("#history-list button")).to_have_count(1)
    if kind != "history":
        await page.evaluate("id => watch(id)", fixture["jobId"])
        await expect(page.locator(".save-to-list")).to_have_count(2)
    if kind == "search-error":
        await page.locator("#country").select_option("BR")
        await expect(page.locator("#region")).to_be_enabled()
        await page.locator("#region").select_option("MG")
        await expect(page.locator("#city")).to_be_enabled()
        await page.locator("#city").select_option("15434")
        await expect(page.locator("#search button[type=submit]")).to_be_enabled()

    captured = asyncio.Event()
    release = asyncio.Event()
    delivered = asyncio.Event()
    actual_status = []

    async def hold(route):
        response = await route.fetch()
        actual_status.append(response.status)
        captured.set()
        await release.wait()
        await route.fulfill(response=response)
        delivered.set()

    route_url = "**/api/history" if kind == "history" else "**/api/jobs/*" if kind == "job" else "**/api/search"
    await page.route(route_url, hold)
    if kind == "history":
        await page.evaluate("window.securityPending = accountUI.refreshHistory(); true")
    elif kind == "job":
        await page.evaluate("id => { window.securityPending = watch(id).catch(error => error.status); }", fixture["jobId"])
    else:
        await page.locator("#search button[type=submit]").click()
    await asyncio.wait_for(captured.wait(), 12)
    assert actual_status == ([403] if kind == "search-error" else [200])
    if kind == "history":
        await page.locator("#account-controls>summary").click()
        await page.locator("#account-delete-open").click()
        await page.locator("#account-delete-password").fill("Private local fixture password")

    await page.evaluate("fetch('/__test/expire').then(response => response.text())")
    assert await page.evaluate("fetch('/api/lists').then(response => response.status)") == 401
    await page.evaluate("accountUI.expire()")
    release.set()
    await asyncio.wait_for(delivered.wait(), 12)
    if kind == "search-error":
        await page.wait_for_function("!busy")
    else:
        await page.evaluate("window.securityPending")
    await expect(page.locator("#login-panel")).to_be_visible()
    await expect(page.locator("#workspace")).to_be_hidden()
    await expect(page.locator("#history-list button")).to_have_count(0)
    assert await page.evaluate("rows.length") == 0
    assert await page.evaluate("resultCards.size") == 0
    assert await page.evaluate("lastJob === null")
    await expect(page.locator(".save-to-list")).to_have_count(0)
    await expect(page.locator("#account-delete-dialog")).not_to_be_visible()
    await expect(page.locator("#account-delete-password")).to_have_value("")
    await page.unroute(route_url, hold)
    # Fresh anonymous CSRF renewal permits a new account login after expiry.
    await login(page, fixture["bob"], fixture["password"])
    await expect(page.locator("#history-list button")).to_have_count(0)
    await expect(page.locator("#list-companies article")).to_have_count(0)
    assert not errors, errors
    REPORT["checks"].append({"device": device, "case": kind, "passed": True,
        "actualDelayedStatus": actual_status[0], "sessionRevoked": True, "privateDataCleared": True,
        "nextAccountIsolated": True, "pageErrors": errors})
    print(f"PASS security browser {device} {kind}", flush=True)
    await context.close()


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            args=["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"])
        client = await browser.new_context()
        fixtures = await (await client.request.get(BASE + "/__test/info")).json()
        await client.close()
        for device in ["desktop", "mobile"]:
            for kind in ["history", "job", "search-error"]:
                await check(browser, device, kind, fixtures[device])
        await browser.close()
    artifacts = Path(__file__).resolve().parents[1] / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    (artifacts / "security-browser-report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
