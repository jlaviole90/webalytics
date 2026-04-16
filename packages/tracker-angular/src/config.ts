import { InjectionToken } from "@angular/core";
import type { InitConfig } from "@webalytics/tracker";

/** Extra Angular-specific knobs on top of the core tracker config. */
export interface WebalyticsAngularConfig extends InitConfig {
  /**
   * When true, subscribes to the Angular Router's NavigationEnd event
   * and fires a pageview on every navigation. Set `autoPageviews: false`
   * on the core config to avoid double-counting — the auto Router hook
   * is strictly more accurate for SPA apps.
   *
   * Default: true when @angular/router is installed.
   */
  trackRouterNavigation?: boolean;

  /**
   * If set, the tracker is not initialized at bootstrap — you must call
   * `WebalyticsService.init()` manually later (e.g. after consent).
   *
   * Default: false (init runs as soon as the app provider resolves).
   */
  manualInit?: boolean;
}

/** DI token for the provider-supplied config. */
export const WEBALYTICS_CONFIG = new InjectionToken<WebalyticsAngularConfig>(
  "WEBALYTICS_CONFIG",
);
