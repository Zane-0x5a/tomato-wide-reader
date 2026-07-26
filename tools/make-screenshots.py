"""Regenerate the README screenshots from the current build, reproducibly.

The previous shots in docs/screenshots/ were captured by hand mid-development;
several showed a since-fixed bug where the rightmost glyph of every line was
sliced in half, and nothing recorded which build produced which file, so they
could not be re-made. This script exists so they can.

The extension only activates on https://fanqienovel.com/reader/*, so rather
than touching the network, the request is intercepted with Playwright's route
handler and fulfilled from tests/fixtures/fanqie-reader.html. (Do NOT try to
do this with --host-resolver-rules and a self-signed cert: the real site is
reachable and HSTS-pinned, so the browser cheerfully loads the live page
instead and the fixture never appears.) The fixture is the project's own
authored sample text, so no published work appears in any shipped screenshot.

    npm run build && python tools/make-screenshots.py

Requires playwright with chromium installed.
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / ".output" / "chrome-mv3"
FIXTURE = ROOT / "tests" / "fixtures" / "fanqie-reader.html"
OUT = ROOT / "docs" / "screenshots"

URL = "https://fanqienovel.com/reader/101"
WIDE = {"width": 1600, "height": 900}
NARROW = {"width": 860, "height": 900}


def main() -> int:
    if not EXT.exists():
        print(f"Build first: {EXT} not found (npm run build)")
        return 1

    html = FIXTURE.read_text(encoding="utf-8")
    profile = Path(tempfile.mkdtemp(prefix="tomato-shots-profile-"))
    OUT.mkdir(parents=True, exist_ok=True)

    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                user_data_dir=str(profile),
                headless=False,  # MV3 content scripts need a real browser
                viewport=WIDE,
                args=[
                    f"--disable-extensions-except={EXT}",
                    f"--load-extension={EXT}",
                ],
            )

            # Serve the fixture for the reader page; block everything else so
            # no request reaches the real site.
            ctx.route(
                "**/*",
                lambda route: route.fulfill(
                    status=200,
                    content_type="text/html; charset=utf-8",
                    body=html,
                )
                if "fanqienovel.com/reader/" in route.request.url
                else route.abort(),
            )

            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(URL, wait_until="domcontentloaded")
            page.wait_for_selector(".article", timeout=15000)
            page.wait_for_timeout(1800)  # settle pagination

            def shot(name: str) -> None:
                page.wait_for_timeout(600)
                page.screenshot(path=str(OUT / f"{name}.png"))
                print(f"  docs/screenshots/{name}.png")

            def reveal_controls() -> None:
                # Controls hide until the pointer enters the top edge sensor.
                page.mouse.move(WIDE["width"] // 2, 3)
                page.wait_for_timeout(500)

            # 1. the two-column spread, controls idle
            page.mouse.move(WIDE["width"] // 2, WIDE["height"] // 2)
            shot("reader-spread")

            # 2. directory drawer
            reveal_controls()
            page.click('[aria-label="目录"]')
            shot("directory")
            page.click('[aria-label="关闭目录"]')
            page.wait_for_timeout(400)

            # 3. typography / theme panel
            reveal_controls()
            page.click('[aria-label="显示设置"]')
            shot("settings")
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)

            # 4. dark theme, showing light/dark parity
            reveal_controls()
            page.click('[aria-label="切换深色"]')
            page.wait_for_timeout(700)
            page.mouse.move(WIDE["width"] // 2, WIDE["height"] // 2)
            shot("reader-dark")
            reveal_controls()
            page.click('[aria-label="切换浅色"]')
            page.wait_for_timeout(500)

            # 5. narrow viewport falls back to one column
            page.mouse.move(WIDE["width"] // 2, WIDE["height"] // 2)
            page.set_viewport_size(NARROW)
            page.wait_for_timeout(1600)
            shot("narrow-fallback")

            ctx.close()
    finally:
        shutil.rmtree(profile, ignore_errors=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
