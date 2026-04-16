import { test, expect, type Page, type Request } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// End-to-end browser test:
//   1. Loads the demo app in a real Chromium
//   2. Captures every POST /collect request the page fires
//   3. Navigates and clicks, asserting the tracker generated the right events
//   4. Queries the Go API's /v1/.../stats/realtime with the seeded bearer
//      token and verifies the "online" counter reflects the browser session.
//
// This exercises the full stack: tracker -> network -> /collect -> enrich ->
// ClickHouse -> MV -> realtime query.

const API_HOST = process.env.API_HOST ?? "http://localhost:8080";

type Seeded = { token: string; siteUUID: string; siteID: string };
function loadSeeded(): Seeded {
  if (process.env.WEBALYTICS_TOKEN && process.env.WEBALYTICS_ORG_SITE_UUID && process.env.WEBALYTICS_SITE_ID) {
    return {
      token: process.env.WEBALYTICS_TOKEN,
      siteUUID: process.env.WEBALYTICS_ORG_SITE_UUID,
      siteID: process.env.WEBALYTICS_SITE_ID,
    };
  }
  const p = path.resolve(__dirname, "../../../deploy/.seeded.env");
  if (!fs.existsSync(p)) {
    throw new Error(`No seeded env at ${p}. Run 'make seed' first.`);
  }
  const text = fs.readFileSync(p, "utf8");
  const m = Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.split("="))
      .filter((parts) => parts.length === 2),
  );
  return {
    token: m.WEBALYTICS_TOKEN,
    siteUUID: m.WEBALYTICS_ORG_SITE_UUID,
    siteID: m.WEBALYTICS_SITE_ID,
  };
}

function recordCollect(page: Page) {
  const requests: { url: string; body: unknown }[] = [];
  page.on("request", (req: Request) => {
    if (req.url().endsWith("/collect") && req.method() === "POST") {
      let body: unknown = null;
      try {
        body = JSON.parse(req.postData() ?? "null");
      } catch {
        /* ignore */
      }
      requests.push({ url: req.url(), body });
    }
  });
  return requests;
}

test.describe("tracker dogfood", () => {
  test("fires a pageview on load, a custom event on click, and another pageview on SPA nav", async ({ page }) => {
    const seeded = loadSeeded();
    const collected = recordCollect(page);

    await page.goto("/", { waitUntil: "networkidle" });

    // Emit a custom event via the demo button.
    await page.getByTestId("emit-signup").click();

    // SPA navigation to /about (Next's App Router).
    await page.getByRole("link", { name: /about/i }).click();
    await page.waitForURL("**/about");

    // Give the 250ms batch timer + sendBeacon a moment to drain.
    await page.waitForTimeout(1200);

    // We expect at least: pageview "/", signup, pageview "/about".
    const types = collected.map((r) => {
      const b = r.body as { event?: string; url?: string };
      return { event: b.event, url: b.url };
    });

    expect(types.some((t) => t.event === "pageview" && t.url && /\/$/.test(new URL(t.url).pathname))).toBe(true);
    expect(types.some((t) => t.event === "signup")).toBe(true);
    expect(types.some((t) => t.event === "pageview" && t.url && new URL(t.url).pathname === "/about")).toBe(true);

    // Now verify the server actually saw and counted the traffic.
    // The /collect -> ClickHouse MV pipeline is eventually consistent; poll
    // up to ~15s before giving up.
    const deadline = Date.now() + 15_000;
    let online = 0;
    let lastStatus = 0;
    while (Date.now() < deadline) {
      const res = await page.request.get(`${API_HOST}/v1/sites/${seeded.siteUUID}/stats/realtime`, {
        headers: { Authorization: `Bearer ${seeded.token}` },
      });
      lastStatus = res.status();
      if (res.ok()) {
        const json = await res.json();
        online = Number(json.online ?? 0);
        if (online > 0) break;
      }
      await page.waitForTimeout(500);
    }
    expect(lastStatus, "realtime endpoint must return 2xx").toBe(200);
    expect(online, "realtime.online should reflect the browser session").toBeGreaterThan(0);
  });
});
