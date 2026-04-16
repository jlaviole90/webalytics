# @webalytics/dashboard-angular

Standalone Angular 17+ components for displaying your Webalytics data.
Mirrors [`@webalytics/dashboard-react`](../dashboard-react) one-to-one —
same types, same theming hooks, same visual language.

```bash
npm install @webalytics/dashboard-angular
```

> **Important**: these components make authenticated requests with a
> bearer token. Run them in an **Angular Universal SSR context** (or a
> BFF you control) so the token never reaches the browser.

## Setup

```ts
// main.server.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideWebalyticsDashboard } from "@webalytics/dashboard-angular";
import { AppComponent } from "./app.component";

bootstrapApplication(AppComponent, {
  providers: [
    provideWebalyticsDashboard({
      host:   process.env["WEBALYTICS_API_HOST"]!,
      token:  process.env["WEBALYTICS_API_TOKEN"]!,
      siteId: process.env["WEBALYTICS_SITE_UUID"]!,
    }),
  ],
});
```

## One-component demo

```ts
import { Component } from "@angular/core";
import { DashboardComponent } from "@webalytics/dashboard-angular";

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
} from "@webalytics/dashboard-angular";

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

See [`@webalytics/dashboard-react`](../dashboard-react) for conceptual
docs — both packages surface identical semantics.
