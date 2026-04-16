import { Injectable, InjectionToken, inject } from "@angular/core";
import { createClient, type ClientConfig, type DashboardClient } from "./client";

/** DI token for the dashboard client config. */
export const WEBALYTICS_DASHBOARD_CONFIG = new InjectionToken<ClientConfig>(
  "WEBALYTICS_DASHBOARD_CONFIG",
);

/**
 * Angular-facing service for querying /v1/stats/*. Under the hood it's
 * the same client class shipped from {@link createClient}; this just
 * wraps it for DI so Angular components can acquire it via `inject()`.
 */
@Injectable({ providedIn: "root" })
export class WebalyticsDashboardService {
  private readonly config = inject(WEBALYTICS_DASHBOARD_CONFIG);
  readonly client: DashboardClient = createClient(this.config);
}
