export { createClient } from "./client";
export type { ClientConfig, DashboardClient } from "./client";

export * from "./types";

export {
  formatInt,
  formatPct,
  formatDuration,
  formatMs,
  formatCLS,
  countryFlag,
} from "./format";

export { WBX_CSS } from "./theme";

export {
  WebalyticsDashboardService,
  WEBALYTICS_DASHBOARD_CONFIG,
} from "./service";
export { provideWebalyticsDashboard } from "./provider";

export { SummaryCardsComponent } from "./components/summary-cards.component";
export { RealtimeComponent } from "./components/realtime.component";
export { TimeseriesChartComponent } from "./components/timeseries-chart.component";
export { TopListComponent } from "./components/top-list.component";
export { WebVitalsCardsComponent } from "./components/web-vitals-cards.component";
export { DashboardComponent } from "./components/dashboard.component";
