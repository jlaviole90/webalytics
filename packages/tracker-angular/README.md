# @jlaviole90/tracker-angular

Angular 17+ bindings for [`@jlaviole90/tracker`](../tracker). Ships an
injectable service, a `provideWebalytics()` helper for the
`bootstrapApplication` config, and automatic pageview tracking via
Angular Router events.

```bash
npm install @jlaviole90/tracker-angular @jlaviole90/tracker
```

## Setup

```ts
// main.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideWebalytics } from "@jlaviole90/tracker-angular";
import { AppComponent } from "./app.component";
import { routes } from "./app.routes";

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideWebalytics({
      siteId: "wb_live_xxxxxxxxxxxxxxxx",
      host:   "https://analytics.your-domain.com",
      // autoPageviews is ignored when @angular/router is installed;
      // Router NavigationEnd is used instead for accuracy.
      autoWebVitals: true,
      environment:   "production",
    }),
  ],
});
```

That's all you need for automatic pageview + Web Vitals tracking.

## Custom events

```ts
import { Component, inject } from "@angular/core";
import { WebalyticsService } from "@jlaviole90/tracker-angular";

@Component({
  standalone: true,
  selector: "app-checkout",
  template: `<button (click)="checkout()">Buy</button>`,
})
export class CheckoutComponent {
  private wa = inject(WebalyticsService);

  checkout() {
    this.wa.track("checkout", { plan: "pro", price: 19 });
  }
}
```

## Consent flow

Opt-in analytics? Delay init until the user accepts:

```ts
provideWebalytics({
  siteId:    "wb_live_...",
  host:      "https://analytics.example.com",
  manualInit: true,
});
```

```ts
const wa = inject(WebalyticsService);
onConsentGiven() {
  wa.init();              // boot the tracker
  wa.setEnabled(true);    // enable sends
}
```

## SSR (Angular Universal)

The tracker self-disables when `window` is missing, so no-op on the
server is automatic. Nothing special needs to happen.

## API

| Method | Description |
| --- | --- |
| `wa.track(name, props?)` | Fire a custom event. |
| `wa.pageview(url?)` | Manually record a pageview (virtual screens). |
| `wa.identify(traits)` | Identify a user (no-op in cookieless default mode). |
| `wa.setEnabled(b)` | Toggle tracking (wire to consent banner). |
| `wa.flush()` | Force-flush the buffer. Returns a promise. |

See [`@jlaviole90/tracker`](../tracker) for details about config options,
cookieless session logic, and the wire protocol.
