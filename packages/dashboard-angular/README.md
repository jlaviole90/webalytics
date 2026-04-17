# @jlaviole90/dashboard-angular

Standalone Angular 17+ components for displaying your Webalytics data.
Mirrors [`@jlaviole90/dashboard-react`](../dashboard-react) one-to-one —
same types, same theming hooks, same visual language.

```bash
npm install @jlaviole90/dashboard-angular
```

## Two modes

### 1. Browser-safe (plain SPA — recommended)

Use a **public embed token** (`wb_pub_live_*`). These are narrow,
read-only, site-scoped credentials, optionally bound to a set of
browser Origins. Safe to ship to the browser.

Mint one with the provisioning script on your backend:

```bash
make public-token ORG_SLUG=jlav \
  ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io'
```

Then in your Angular app:

```ts
// src/main.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideWebalyticsDashboard } from "@jlaviole90/dashboard-angular";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideWebalyticsDashboard({
      kind:        "public",
      host:        "https://analytics.example.com",
      publicToken: "wb_pub_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      siteId:      "11111111-2222-3333-4444-555555555555",
    }),
  ],
});
```

No SSR required. Token is restricted to your site's origins by the
server, and only exposes aggregate, PII-free stats.

### 2. Server-side (Angular Universal / BFF)

If you already run Angular Universal, you can use the full admin bearer
token instead — same components, full access to every query the admin
API exposes:

```ts
// src/main.server.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideWebalyticsDashboard } from "@jlaviole90/dashboard-angular";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideWebalyticsDashboard({
      host:   process.env["WEBALYTICS_API_HOST"]!,
      token:  process.env["WEBALYTICS_API_TOKEN"]!,     // wb_pat_live_*, server-side only
      siteId: process.env["WEBALYTICS_SITE_UUID"]!,
    }),
  ],
});
```

> **Never pass `token` (admin bearer) into a browser-rendered app.**
> It grants full org access. If you're not running Universal, use the
> browser-safe `publicToken` mode above.

## One-component demo

```ts
import { Component } from "@angular/core";
import { DashboardComponent } from "@jlaviole90/dashboard-angular";

@Component({
  selector: "app-analytics",
  standalone: true,
  imports: [DashboardComponent],
  template: `<wb-dashboard window="7d" />`,
})
export class AnalyticsPage {}
```

## Compose the primitives

For custom layouts, import the individual components and pass data via
`[data]` inputs. You control fetching:

```ts
import { Component, inject } from "@angular/core";
import {
  WebalyticsDashboardService,
  SummaryCardsComponent,
  TopListComponent,
  TimeseriesChartComponent,
  RealtimeComponent,
  WebVitalsCardsComponent,
} from "@jlaviole90/dashboard-angular";

@Component({
  standalone: true,
  imports: [SummaryCardsComponent, TopListComponent, TimeseriesChartComponent,
            RealtimeComponent, WebVitalsCardsComponent],
  template: `
    <wb-summary-cards *ngIf="summary | async as s" [data]="s" />
    <wb-timeseries-chart *ngIf="ts | async as t" [data]="t" />
    <wb-top-list *ngIf="pages | async as p" [data]="p" />
  `,
})
export class CustomDashboardPage {
  private svc = inject(WebalyticsDashboardService);
  summary = this.svc.client.summary("30d");
  ts      = this.svc.client.timeseries("30d", "visitors", "day");
  pages   = this.svc.client.breakdown("30d", "path");
}
```

## Theming

Override CSS variables on `[data-wbx]`:

```css
[data-wbx] {
  --wbx-accent: #8b5cf6;
  --wbx-accent-soft: rgba(139, 92, 246, 0.12);
  --wbx-bg: #0b0b0b;
  --wbx-surface: #171717;
  --wbx-fg: #fafafa;
  --wbx-fg-muted: #a1a1aa;
  --wbx-border: #27272a;
}
```

## Exports

| Symbol | Description |
| --- | --- |
| `provideWebalyticsDashboard(config)` | Providers for `bootstrapApplication`. |
| `WebalyticsDashboardService` | Injectable with `.client` (typed fetch). |
| `DashboardComponent` | `<wb-dashboard>` — opinionated full layout. |
| `SummaryCardsComponent` | `<wb-summary-cards [data]>` — 4 metric tiles. |
| `RealtimeComponent` | `<wb-realtime [data]>` — live counter. |
| `TimeseriesChartComponent` | `<wb-timeseries-chart [data]>` — area chart. |
| `TopListComponent` | `<wb-top-list [data]>` — breakdown list. |
| `WebVitalsCardsComponent` | `<wb-web-vitals-cards [data]>` — CWV tiles. |
| `createClient(config)` | Standalone client (no DI). |

See [`@jlaviole90/dashboard-react`](../dashboard-react) for conceptual
docs — both packages surface identical semantics.
