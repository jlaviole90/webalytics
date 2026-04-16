import {
  APP_INITIALIZER,
  type EnvironmentProviders,
  type Provider,
  inject,
  makeEnvironmentProviders,
} from "@angular/core";
import { WEBALYTICS_CONFIG, type WebalyticsAngularConfig } from "./config.js";
import { WebalyticsService } from "./service.js";

/**
 * Application-level provider for the Webalytics tracker.
 *
 * Usage (Angular 17+ standalone bootstrap):
 *
 *   bootstrapApplication(AppComponent, {
 *     providers: [
 *       provideRouter(routes),
 *       provideWebalytics({
 *         siteId: "wb_live_xxxxxxxx",
 *         host:   "https://analytics.example.com",
 *       }),
 *     ],
 *   });
 *
 * The tracker is initialized during APP_INITIALIZER so the first
 * pageview is emitted before the first user-visible interaction.
 */
export function provideWebalytics(
  config: WebalyticsAngularConfig,
): EnvironmentProviders {
  const providers: Provider[] = [
    { provide: WEBALYTICS_CONFIG, useValue: config },
    WebalyticsService,
    // APP_INITIALIZER gives the DI tree a chance to wire up Router
    // before we subscribe to its events inside WebalyticsService.
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: () => {
        const svc = inject(WebalyticsService);
        // Touching the service is enough to trigger its constructor.
        // APP_INITIALIZER wants a function returning Promise | void.
        return () => (svc ? undefined : undefined);
      },
    },
  ];
  return makeEnvironmentProviders(providers);
}
