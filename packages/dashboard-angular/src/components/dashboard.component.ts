import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Input,
  OnInit,
  ViewEncapsulation,
  inject,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  from,
  map,
  switchMap,
  timer,
  shareReplay,
} from "rxjs";
import type { DashboardTheme, Filters, WindowSpec } from "../types";
import { WebalyticsDashboardService } from "../service";
import { WBX_CSS } from "../theme";
import { RealtimeComponent } from "./realtime.component";
import { SummaryCardsComponent } from "./summary-cards.component";
import { TimeseriesChartComponent } from "./timeseries-chart.component";
import { TopListComponent } from "./top-list.component";
import { WebVitalsCardsComponent } from "./web-vitals-cards.component";
import { WindowPickerComponent } from "./window-picker.component";

const DEFAULT_REFRESH_MS = 30_000;

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
    WindowPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx [style]="rootStyle" style="padding: 24px; display: flex; flex-direction: column; gap: 20px;">
      <div *ngIf="showWindowPicker" style="display: flex; justify-content: space-between; align-items: center;">
        <ng-content></ng-content>
        <wb-window-picker [active]="activeWindow" (windowChange)="onWindowChange($event)" />
      </div>

      <ng-container *ngIf="view$ | async as v; else loading">
        <div data-wbx-top-row style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 16px;">
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
export class DashboardComponent implements OnInit {
  /** Time window for all queries. Defaults to 7d. */
  @Input() window: WindowSpec = "7d";

  /** Site UUID override; defaults to the one from provideWebalyticsDashboard. */
  @Input() siteId?: string;

  /** Optional dimension filters, applied to every query that supports them. */
  @Input() filters?: Filters;

  /** Auto-refresh interval in ms. Set to 0 to disable. */
  @Input() refreshMs = DEFAULT_REFRESH_MS;

  /** Show the window-preset picker bar at the top. */
  @Input() showWindowPicker = true;

  /** Override theme CSS variables. */
  @Input() theme?: DashboardTheme;

  private readonly svc = inject(WebalyticsDashboardService);
  private readonly destroyRef = inject(DestroyRef);

  private window$ = new BehaviorSubject<WindowSpec>("7d");
  activeWindow: WindowSpec = "7d";
  view$!: Observable<View>;

  get rootStyle(): Record<string, string> {
    const s: Record<string, string> = {};
    if (!this.theme) return s;
    if (this.theme.accent) s["--wbx-accent"] = this.theme.accent;
    if (this.theme.background) s["--wbx-bg"] = this.theme.background;
    if (this.theme.surface) s["--wbx-surface"] = this.theme.surface;
    if (this.theme.foreground) s["--wbx-fg"] = this.theme.foreground;
    if (this.theme.border) s["--wbx-border"] = this.theme.border;
    if (this.theme.radius) s["--wbx-radius"] = this.theme.radius;
    if (this.theme.fontFamily) s["--wbx-font"] = this.theme.fontFamily;
    return s;
  }

  ngOnInit(): void {
    this.activeWindow = this.window;
    this.window$.next(this.window);

    const tick$ = this.refreshMs > 0
      ? timer(0, this.refreshMs)
      : timer(0);

    this.view$ = combineLatest([this.window$, tick$]).pipe(
      switchMap(([w]) => this.fetchAll(w)),
      shareReplay(1),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  onWindowChange(w: WindowSpec): void {
    this.activeWindow = w;
    this.window$.next(w);
  }

  private fetchAll(w: WindowSpec): Observable<View> {
    return combineLatest([
      from(this.svc.client.summary(w, { siteId: this.siteId, filters: this.filters })),
      from(this.svc.client.realtime({ siteId: this.siteId })),
      from(this.svc.client.timeseries(w, "visitors", this.defaultInterval(w), {
        siteId: this.siteId,
        filters: this.filters,
      })),
      from(this.svc.client.breakdown(w, "path", {
        siteId: this.siteId,
        filters: this.filters,
      })),
      from(this.svc.client.breakdown(w, "referrer_host", {
        siteId: this.siteId,
        filters: this.filters,
      })),
      from(this.svc.client.breakdown(w, "country", {
        siteId: this.siteId,
        filters: this.filters,
      })),
      from(this.svc.client.breakdown(w, "device", {
        siteId: this.siteId,
        filters: this.filters,
      })),
      from(this.svc.client.webVitals(w, { siteId: this.siteId, filters: this.filters })),
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
  }

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
