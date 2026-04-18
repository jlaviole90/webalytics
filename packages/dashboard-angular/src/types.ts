// Types mirror the Go API responses under /v1/stats/*. Kept here rather
// than generated from OpenAPI so the package stays zero-dep.

export interface TimeWindow {
  from: string; // ISO 8601
  to: string;
}

/** Window specifier accepted by every query helper. A string literal
 * like "24h" / "7d" / "30d" / "90d" is expanded to now()-N, to=now(). */
export type WindowSpec =
  | { from: Date | string; to: Date | string }
  | "1h"
  | "24h"
  | "7d"
  | "30d"
  | "90d";

export interface Filters {
  hostnames?: string[];
  paths?: string[];
  devices?: string[];
  countries?: string[];
  referrer_hosts?: string[];
  utm_sources?: string[];
  environments?: string[];
  releases?: string[];
}

export type MetricName = "visitors" | "pageviews" | "sessions";
export type IntervalName = "minute" | "hour" | "day" | "week" | "month";

export type DimensionName =
  | "path"
  | "hostname"
  | "referrer_host"
  | "country"
  | "device"
  | "browser"
  | "os"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "event_name";

export interface RealtimeResponse {
  online: number;
  top_pages: Array<{ path: string; visitors: number }>;
  top_hostnames: Array<{ hostname: string; visitors: number }>;
  recent: Array<{
    ts: string;
    path: string;
    hostname: string;
    country_code?: string;
    device?: string;
  }>;
}

export interface SummaryResponse {
  window: TimeWindow;
  metrics: Record<
    "visitors" | "pageviews" | "sessions" | "bounce_rate" | "avg_session_s",
    { value: number }
  >;
}

export interface TimeseriesResponse {
  window: TimeWindow;
  metric: MetricName;
  interval: IntervalName;
  points: Array<{ bucket: string; value: number }>;
}

export interface BreakdownResponse {
  window: TimeWindow;
  dimension: DimensionName;
  metric: MetricName;
  results: Array<{ key: string; value: number; share: number }>;
  total: number;
  total_other: number;
}

export interface WebVitalsResponse {
  window: TimeWindow;
  group_by: "none" | "path" | "device";
  groups: Array<{
    key: string | null;
    metrics: Record<
      "LCP" | "INP" | "CLS" | "FCP" | "TTFB",
      {
        p75: number;
        p95: number;
        samples: number;
        good: number;
        needs_improvement: number;
        poor: number;
      }
    >;
  }>;
}

/** Override CSS custom properties on the dashboard root without writing CSS. */
export interface DashboardTheme {
  /** Primary accent color (default: #0070f3). */
  accent?: string;
  /** Card / container background (default: #ffffff). */
  background?: string;
  /** Subtle surface for inputs, tracks, etc. (default: #fafafa). */
  surface?: string;
  /** Primary text color (default: #0a0a0a). */
  foreground?: string;
  /** Border color (default: #e5e7eb). */
  border?: string;
  /** Border radius token, e.g. "12px" (default: 8px). */
  radius?: string;
  /** Font family stack (default: system sans-serif). */
  fontFamily?: string;
}
