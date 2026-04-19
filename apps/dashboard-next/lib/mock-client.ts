import type {
  BreakdownResponse,
  DashboardClient,
  DimensionName,
  IntervalName,
  MetricName,
  RealtimeResponse,
  SummaryResponse,
  TimeseriesResponse,
  WebVitalsResponse,
  WindowSpec,
} from "@jlaviole90/dashboard-react";

// ---------------------------------------------------------------------------
// Deterministic pseudo-random helpers
// ---------------------------------------------------------------------------

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return Math.abs(s) / 0x7fffffff;
  };
}

function range(rng: () => number, lo: number, hi: number) {
  return Math.round(lo + rng() * (hi - lo));
}

// ---------------------------------------------------------------------------
// Timeseries generator
// ---------------------------------------------------------------------------

function makePoints(
  interval: IntervalName,
  count: number,
  baseMean: number,
  seed: number,
): Array<{ bucket: string; value: number }> {
  const rng = seeded(seed);
  const now = Date.now();
  const MS: Record<IntervalName, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
  };
  const step = MS[interval] ?? MS.day;
  const points: Array<{ bucket: string; value: number }> = [];
  for (let i = count - 1; i >= 0; i--) {
    const ts = now - i * step;
    const noise = 0.6 + rng() * 0.8;
    const trend = 1 + (count - i) / count * 0.3; // slight upward trend
    const value = Math.max(0, Math.round(baseMean * noise * trend));
    points.push({ bucket: new Date(ts).toISOString(), value });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Mock DashboardClient
// ---------------------------------------------------------------------------

export function createMockClient(): DashboardClient {
  return {
    config: {
      kind: "public",
      host: "http://localhost:3001",
      publicToken: "wb_pub_live_mock",
      siteId: "mock-site-id",
    },

    async realtime(): Promise<RealtimeResponse> {
      return {
        online: 47,
        top_pages: [
          { path: "/", visitors: 18 },
          { path: "/docs/getting-started", visitors: 11 },
          { path: "/pricing", visitors: 8 },
          { path: "/blog/release-v2", visitors: 6 },
          { path: "/contact", visitors: 4 },
        ],
        top_hostnames: [{ hostname: "example.com", visitors: 47 }],
        recent: [
          { ts: new Date().toISOString(), path: "/", hostname: "example.com", country_code: "US", device: "desktop" },
          { ts: new Date().toISOString(), path: "/pricing", hostname: "example.com", country_code: "DE", device: "mobile" },
          { ts: new Date().toISOString(), path: "/docs/getting-started", hostname: "example.com", country_code: "GB", device: "desktop" },
          { ts: new Date().toISOString(), path: "/blog/release-v2", hostname: "example.com", country_code: "FR", device: "tablet" },
          { ts: new Date().toISOString(), path: "/", hostname: "example.com", country_code: "CA", device: "desktop" },
          { ts: new Date().toISOString(), path: "/contact", hostname: "example.com", country_code: "AU", device: "mobile" },
        ],
      };
    },

    async summary(window: WindowSpec): Promise<SummaryResponse> {
      const isPrev = typeof window === "object"; // prev window passed as absolute range
      const mult = isPrev ? 0.88 : 1; // previous period ~12% lower
      const now = new Date().toISOString();
      return {
        window: { from: new Date(Date.now() - 7 * 86400000).toISOString(), to: now },
        metrics: {
          visitors: { value: Math.round(12_480 * mult) },
          pageviews: { value: Math.round(38_920 * mult) },
          sessions: { value: Math.round(14_310 * mult) },
          bounce_rate: { value: isPrev ? 0.44 : 0.38 },
          avg_session_s: { value: isPrev ? 148 : 175 },
        },
      };
    },

    async timeseries(
      _window: WindowSpec,
      metric: MetricName,
      interval: IntervalName,
    ): Promise<TimeseriesResponse> {
      const counts: Record<IntervalName, number> = {
        minute: 60,
        hour: 24,
        day: 7,
        week: 12,
        month: 6,
      };
      const bases: Record<MetricName, number> = {
        visitors: 1780,
        pageviews: 5560,
        sessions: 2040,
      };
      const seeds: Record<MetricName, number> = {
        visitors: 42,
        pageviews: 99,
        sessions: 77,
      };
      const count = counts[interval] ?? 7;
      const points = makePoints(interval, count, bases[metric], seeds[metric]);
      return {
        window: {
          from: points[0]!.bucket,
          to: points[points.length - 1]!.bucket,
        },
        metric,
        interval,
        points,
      };
    },

    async breakdown(
      _window: WindowSpec,
      dimension: DimensionName,
    ): Promise<BreakdownResponse> {
      const tables: Record<DimensionName, Array<{ key: string; value: number; share: number }>> = {
        path: [
          { key: "/", value: 4210, share: 0.337 },
          { key: "/docs/getting-started", value: 2880, share: 0.231 },
          { key: "/pricing", value: 1740, share: 0.139 },
          { key: "/blog/release-v2", value: 1120, share: 0.090 },
          { key: "/contact", value: 820, share: 0.066 },
          { key: "/docs/api", value: 590, share: 0.047 },
          { key: "/about", value: 440, share: 0.035 },
          { key: "/login", value: 320, share: 0.026 },
          { key: "/signup", value: 210, share: 0.017 },
          { key: "/changelog", value: 150, share: 0.012 },
        ],
        hostname: [
          { key: "example.com", value: 10900, share: 0.873 },
          { key: "app.example.com", value: 1580, share: 0.127 },
        ],
        referrer_host: [
          { key: "google.com", value: 3840, share: 0.308 },
          { key: "", value: 2910, share: 0.233 },
          { key: "twitter.com", value: 1650, share: 0.132 },
          { key: "github.com", value: 1240, share: 0.099 },
          { key: "reddit.com", value: 890, share: 0.071 },
          { key: "dev.to", value: 620, share: 0.050 },
          { key: "ycombinator.com", value: 410, share: 0.033 },
          { key: "linkedin.com", value: 320, share: 0.026 },
          { key: "producthunt.com", value: 280, share: 0.022 },
          { key: "hackernews.com", value: 320, share: 0.026 },
        ],
        country: [
          { key: "US", value: 4980, share: 0.399 },
          { key: "DE", value: 1740, share: 0.139 },
          { key: "GB", value: 1420, share: 0.114 },
          { key: "FR", value: 980, share: 0.079 },
          { key: "CA", value: 860, share: 0.069 },
          { key: "AU", value: 620, share: 0.050 },
          { key: "NL", value: 480, share: 0.038 },
          { key: "IN", value: 410, share: 0.033 },
          { key: "BR", value: 380, share: 0.030 },
          { key: "JP", value: 610, share: 0.049 },
        ],
        device: [
          { key: "desktop", value: 7490, share: 0.600 },
          { key: "mobile", value: 4120, share: 0.330 },
          { key: "tablet", value: 870, share: 0.070 },
        ],
        browser: [
          { key: "Chrome", value: 6230, share: 0.499 },
          { key: "Safari", value: 3110, share: 0.249 },
          { key: "Firefox", value: 1490, share: 0.119 },
          { key: "Edge", value: 990, share: 0.079 },
          { key: "Other", value: 660, share: 0.054 },
        ],
        os: [
          { key: "macOS", value: 4980, share: 0.399 },
          { key: "Windows", value: 3740, share: 0.299 },
          { key: "iOS", value: 2490, share: 0.199 },
          { key: "Android", value: 870, share: 0.070 },
          { key: "Linux", value: 400, share: 0.032 },
        ],
        utm_source: [
          { key: "newsletter", value: 1240, share: 0.099 },
          { key: "twitter", value: 890, share: 0.071 },
          { key: "google", value: 750, share: 0.060 },
        ],
        utm_medium: [
          { key: "email", value: 1240, share: 0.099 },
          { key: "social", value: 890, share: 0.071 },
          { key: "cpc", value: 750, share: 0.060 },
        ],
        utm_campaign: [
          { key: "launch-v2", value: 1640, share: 0.131 },
          { key: "blog-promo", value: 890, share: 0.071 },
          { key: "holiday-2024", value: 350, share: 0.028 },
        ],
        event_name: [
          { key: "signup", value: 420, share: 0.034 },
          { key: "upgrade", value: 180, share: 0.014 },
          { key: "download", value: 310, share: 0.025 },
        ],
      };

      const results = tables[dimension] ?? [];
      const total = results.reduce((s, r) => s + r.value, 0);
      return {
        window: {
          from: new Date(Date.now() - 7 * 86400000).toISOString(),
          to: new Date().toISOString(),
        },
        dimension,
        metric: "visitors",
        results,
        total,
        total_other: 0,
      };
    },

    async webVitals(): Promise<WebVitalsResponse> {
      return {
        window: {
          from: new Date(Date.now() - 7 * 86400000).toISOString(),
          to: new Date().toISOString(),
        },
        group_by: "none",
        groups: [
          {
            key: null,
            metrics: {
              LCP: { p75: 2100, p95: 3800, samples: 4820, good: 3410, needs_improvement: 980, poor: 430 },
              INP: { p75: 165, p95: 420, samples: 4820, good: 3960, needs_improvement: 620, poor: 240 },
              CLS: { p75: 0.08, p95: 0.22, samples: 4820, good: 4010, needs_improvement: 590, poor: 220 },
              FCP: { p75: 1400, p95: 2800, samples: 4820, good: 4120, needs_improvement: 490, poor: 210 },
              TTFB: { p75: 620, p95: 1400, samples: 4820, good: 3840, needs_improvement: 720, poor: 260 },
            },
          },
        ],
      };
    },
  };
}
