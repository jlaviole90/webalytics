import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation, inject } from "@angular/core";
import { Observable, combineLatest, from, map } from "rxjs";
import type { Filters, WindowSpec } from "../types";
import { WebalyticsDashboardService } from "../service";
import { WBX_CSS } from "../theme";
import { RealtimeComponent } from "./realtime.component";
import { SummaryCardsComponent } from "./summary-cards.component";
import { TimeseriesChartComponent } from "./timeseries-chart.component";
import { TopListComponent } from "./top-list.component";
import { WebVitalsCardsComponent } from "./web-vitals-cards.component";

/**
 * Opinionated full-dashboard layout. Fetches all five queries in
 * parallel via the `WebalyticsDashboardService` and shows the result
 * once everything arrives.
 *
 * For SSR (Angular Universal), render this on the server so the bearer
 * token stays out of the browser. For custom layouts, compose the
 * <wb-*> primitives yourself and feed them data via inputs.
 */
@Component({
  selector: "wb-dashboard",
  standalone: true,
  imports: [
    CommonModule,
    SummaryCardsComponent,
    RealtimeComponent,
    TimeseriesChartComponent,
    TopListComponent,
    WebVitalsCardsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx style="padding: 24px; display: flex; flex-direction: column; gap: 20px;">
      <ng-content></ng-content>

      <ng-container *ngIf="view$ | async as v; else loading">
        <div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 16px;">
          <wb-summary-cards [data]="v.summary" />
          <wb-realtime [data]="v.realtime" />
        </div>

        <wb-timeseries-chart [data]="v.timeseries" />

        <div data-wbx-grid-2>
          <wb-top-list [data]="v.pages" />
          <wb-top-list [data]="v.referrers" />
          <wb-top-list [data]="v.countries" />
          <wb-top-list [data]="v.devices" />
        </div>

        <wb-web-vitals-cards [data]="v.vitals" />
      </ng-container>

      <ng-template #loading>
        <div data-wbx-subtle style="padding: 32px; text-align: center;">Loading analytics…</div>
      </ng-template>
    </div>
  `,
})
export class DashboardComponent {
  /** Time window for all queries. Defaults to 7d. */
  @Input() window: WindowSpec = "7d";

  /** Site UUID override; defaults to the one from provideWebalyticsDashboard. */
  @Input() siteId?: string;

  /** Optional dimension filters, applied to every query that supports them. */
  @Input() filters?: Filters;

  private readonly svc = inject(WebalyticsDashboardService);

  // Kick off all five fetches in parallel and join them. Rendered via
  // | async so the template handles loading/error declaratively; if any
  // query fails the user sees "Loading analytics…" indefinitely — for
  // that reason we recommend wrapping this in your own error boundary
  // (or calling the service methods yourself for finer-grained control).
  readonly view$: Observable<View> = combineLatest([
    from(this.svc.client.summary(this.window, { siteId: this.siteId, filters: this.filters })),
    from(this.svc.client.realtime({ siteId: this.siteId })),
    from(
      this.svc.client.timeseries(this.window, "visitors", this.defaultInterval(this.window), {
        siteId: this.siteId,
        filters: this.filters,
      }),
    ),
    from(
      this.svc.client.breakdown(this.window, "path", {
        siteId: this.siteId,
        filters: this.filters,
      }),
    ),
    from(
      this.svc.client.breakdown(this.window, "referrer_host", {
        siteId: this.siteId,
        filters: this.filters,
      }),
    ),
    from(
      this.svc.client.breakdown(this.window, "country", {
        siteId: this.siteId,
        filters: this.filters,
      }),
    ),
    from(
      this.svc.client.breakdown(this.window, "device", {
        siteId: this.siteId,
        filters: this.filters,
      }),
    ),
    from(this.svc.client.webVitals(this.window, { siteId: this.siteId, filters: this.filters })),
  ]).pipe(
    map(([summary, realtime, timeseries, pages, referrers, countries, devices, vitals]) => ({
      summary,
      realtime,
      timeseries,
      pages,
      referrers,
      countries,
      devices,
      vitals,
    })),
  );

  private defaultInterval(w: WindowSpec): "minute" | "hour" | "day" {
    if (w === "1h") return "minute";
    if (w === "24h") return "hour";
    return "day";
  }
}

interface View {
  summary: Awaited<ReturnType<WebalyticsDashboardService["client"]["summary"]>>;
  realtime: Awaited<ReturnType<WebalyticsDashboardService["client"]["realtime"]>>;
  timeseries: Awaited<ReturnType<WebalyticsDashboardService["client"]["timeseries"]>>;
  pages: Awaited<ReturnType<WebalyticsDashboardService["client"]["breakdown"]>>;
  referrers: Awaited<ReturnType<WebalyticsDashboardService["client"]["breakdown"]>>;
  countries: Awaited<ReturnType<WebalyticsDashboardService["client"]["breakdown"]>>;
  devices: Awaited<ReturnType<WebalyticsDashboardService["client"]["breakdown"]>>;
  vitals: Awaited<ReturnType<WebalyticsDashboardService["client"]["webVitals"]>>;
}
