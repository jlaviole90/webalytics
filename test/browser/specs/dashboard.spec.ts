import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Second-site dogfood: a real human (er, Chromium) opens the dashboard on
// :3001, which is a completely different Next.js app than the tracker
// demo. The dashboard's server components hit the Go API's /v1/stats/*
// endpoints with a bearer token that never leaves the container.
//
// This closes the full loop: tracker writes -> Go API -> ClickHouse ->
// dashboard reads -> browser renders numbers a human can see.

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:3001";
const TRACKER_URL = process.env.BASE_URL ?? "http://localhost:3000";

function hasSeed(): boolean {
  const p = path.resolve(__dirname, "../../../deploy/.seeded.env");
  return fs.existsSync(p);
}

async function fireSomeTraffic(page: Page) {
  // Load the writer app so tracker fires pageview + click.
  await page.goto(`${TRACKER_URL}/`, { waitUntil: "networkidle" });
  await page.getByTestId("emit-signup").click();
  await page.getByRole("link", { name: /about/i }).click();
  await page.waitForURL("**/about");
  // Let the 250ms batcher drain.
  await page.waitForTimeout(1200);
}

test.describe("dashboard dogfood", () => {
  test.skip(!hasSeed(), "needs `make seed` to have produced deploy/.seeded.env");

  test("renders realtime online count reflecting browser session", async ({ page }) => {
    await fireSomeTraffic(page);

    // Poll the dashboard until the realtime tile shows > 0. The dashboard
    // itself fetches fresh on every request (force-dynamic), so a reload
    // hits the API again.
    const deadline = Date.now() + 20_000;
    let rendered = "0";
    while (Date.now() < deadline) {
      await page.goto(`${DASHBOARD_URL}/`, { waitUntil: "networkidle" });
      const text = (await page.getByTestId("online-count").textContent())?.trim() ?? "0";
      rendered = text;
      const n = Number(text.replace(/,/g, ""));
      if (n > 0) break;
      await page.waitForTimeout(500);
    }
    expect(Number(rendered.replace(/,/g, "")), "dashboard online-count should reflect live session").toBeGreaterThan(0);
  });

  test("renders top-pages table populated from /v1/stats/breakdown", async ({ page }) => {
    await fireSomeTraffic(page);

    // Same poll pattern — the breakdown MV is eventually consistent.
    const deadline = Date.now() + 20_000;
    let rowCount = 0;
    while (Date.now() < deadline) {
      await page.goto(`${DASHBOARD_URL}/pages`, { waitUntil: "networkidle" });
      rowCount = await page.locator('[data-testid="top-pages-table"] tbody tr').count();
      const placeholder = await page
        .locator('[data-testid="top-pages-table"] tbody tr td[colspan="3"]')
        .count();
      if (rowCount > 0 && placeholder === 0) break;
      await page.waitForTimeout(500);
    }
    expect(rowCount, "top-pages table should have at least one row").toBeGreaterThan(0);
    // At least one of our tracked paths should show up.
    const html = (await page.locator('[data-testid="top-pages-table"]').innerHTML()) ?? "";
    expect(html).toMatch(/\/about|\/(?=<)/);
  });

  test("renders web vitals table with all five metrics", async ({ page }) => {
    await page.goto(`${DASHBOARD_URL}/vitals`, { waitUntil: "networkidle" });
    // We don't assert samples > 0 because vitals are best-effort in a
    // headless browser — but the structure should always render.
    for (const name of ["LCP", "INP", "CLS", "FCP", "TTFB"]) {
      await expect(page.locator(`tr[data-metric="${name}"]`)).toBeVisible();
    }
  });
});
