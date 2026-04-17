import { type EnvironmentProviders, makeEnvironmentProviders } from "@angular/core";
import type { ClientConfig } from "./client";
import { WEBALYTICS_DASHBOARD_CONFIG, WebalyticsDashboardService } from "./service";

/**
 * Application-level provider for the dashboard client.
 *
 * Two modes:
 *
 * 1. Browser-safe (plain SPA, no SSR) — use a public embed token:
 *
 *    bootstrapApplication(AppComponent, {
 *      providers: [
 *        provideWebalyticsDashboard({
 *          kind:        "public",
 *          host:        "https://analytics.example.com",
 *          publicToken: "wb_pub_live_...",   // origin-bound, read-only
 *          siteId:      "<site-uuid>",
 *        }),
 *      ],
 *    });
 *
 * 2. Server-side (Angular Universal or BFF) — use an admin bearer:
 *
 *    // main.server.ts
 *    bootstrapApplication(AppComponent, {
 *      providers: [
 *        provideWebalyticsDashboard({
 *          host:   process.env["WEBALYTICS_API_HOST"]!,
 *          token:  process.env["WEBALYTICS_API_TOKEN"]!,   // MUST stay server-side
 *          siteId: process.env["WEBALYTICS_SITE_UUID"]!,
 *        }),
 *      ],
 *    });
 */
export function provideWebalyticsDashboard(
  config: ClientConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: WEBALYTICS_DASHBOARD_CONFIG, useValue: config },
    WebalyticsDashboardService,
  ]);
}
