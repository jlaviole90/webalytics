import { type EnvironmentProviders, makeEnvironmentProviders } from "@angular/core";
import type { ClientConfig } from "./client";
import { WEBALYTICS_DASHBOARD_CONFIG, WebalyticsDashboardService } from "./service";

/**
 * Application-level provider for the dashboard client. Provide this
 * at bootstrap (typically inside Angular Universal server code so
 * the bearer token never ships to the browser):
 *
 *   bootstrapApplication(AppComponent, {
 *     providers: [
 *       provideWebalyticsDashboard({
 *         host:   process.env["WEBALYTICS_API_HOST"]!,
 *         token:  process.env["WEBALYTICS_API_TOKEN"]!,
 *         siteId: process.env["WEBALYTICS_SITE_UUID"]!,
 *       }),
 *     ],
 *   });
 */
export function provideWebalyticsDashboard(
  config: ClientConfig,
): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: WEBALYTICS_DASHBOARD_CONFIG, useValue: config },
    WebalyticsDashboardService,
  ]);
}
