import type {
  BreakdownResponse,
  DimensionName,
  Filters,
  IntervalName,
  MetricName,
  RealtimeResponse,
  SummaryResponse,
  TimeWindow,
  TimeseriesResponse,
  WebVitalsResponse,
  WindowSpec,
} from "./types";

/**
 * Config for {@link createClient}. The bearer token is a secret and MUST
 * only live on the server. Never pass this client into a Client Component.
 */
export interface ClientConfig {
  /** Base URL of your Webalytics deployment, e.g. "https://analytics.example.com". */
  host: string;
  /** Server-side bearer token. Do not expose to the browser. */
  token: string;
  /** Site UUID (not the public wb_live_* id) this client queries by default. */
  siteId: string;
  /**
   * Custom fetch implementation. Useful for injecting Angular Universal's
   * server-only fetch, or a Node 18 fetch polyfill for older runtimes.
   */
  fetch?: typeof fetch;
}

export interface DashboardClient {
  readonly config: ClientConfig;
  realtime(opts?: { siteId?: string; signal?: AbortSignal }): Promise<RealtimeResponse>;
  summary(
    window: WindowSpec,
    opts?: { siteId?: string; filters?: Filters; signal?: AbortSignal },
  ): Promise<SummaryResponse>;
  timeseries(
    window: WindowSpec,
    metric: MetricName,
    interval: IntervalName,
    opts?: { siteId?: string; filters?: Filters; signal?: AbortSignal },
  ): Promise<TimeseriesResponse>;
  breakdown(
    window: WindowSpec,
    dimension: DimensionName,
    opts?: {
      siteId?: string;
      metric?: MetricName;
      filters?: Filters;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    },
  ): Promise<BreakdownResponse>;
  webVitals(
    window: WindowSpec,
    opts?: {
      siteId?: string;
      groupBy?: "none" | "path" | "device";
      filters?: Filters;
      signal?: AbortSignal;
    },
  ): Promise<WebVitalsResponse>;
}

export function createClient(config: ClientConfig): DashboardClient {
  const f = config.fetch ?? fetch;
  const base = config.host.replace(/\/+$/, "");

  const call = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const url = `${base}${path}`;
    const res = await f(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!res.ok) {
      // Try to surface the API's JSON error shape, but fall back
      // gracefully if the body isn't JSON.
      let detail = "";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        detail = body.error?.message ?? "";
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new Error(
        `webalytics: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""} (${url})`,
      );
    }
    return res.json() as Promise<T>;
  };

  const resolveSite = (override?: string) => override ?? config.siteId;

  return {
    config,
    realtime({ siteId, signal } = {}) {
      return call<RealtimeResponse>(`/v1/sites/${resolveSite(siteId)}/stats/realtime`, signal);
    },
    summary(window, { siteId, filters, signal } = {}) {
      const qs = toQS({ ...expandWindow(window), ...filtersToQS(filters) });
      return call<SummaryResponse>(
        `/v1/sites/${resolveSite(siteId)}/stats/summary?${qs}`,
        signal,
      );
    },
    timeseries(window, metric, interval, { siteId, filters, signal } = {}) {
      const qs = toQS({
        ...expandWindow(window),
        metric,
        interval,
        ...filtersToQS(filters),
      });
      return call<TimeseriesResponse>(
        `/v1/sites/${resolveSite(siteId)}/stats/timeseries?${qs}`,
        signal,
      );
    },
    breakdown(window, dimension, { siteId, metric, filters, limit, offset, signal } = {}) {
      const qs = toQS({
        ...expandWindow(window),
        dimension,
        metric,
        limit,
        offset,
        ...filtersToQS(filters),
      });
      return call<BreakdownResponse>(
        `/v1/sites/${resolveSite(siteId)}/stats/breakdown?${qs}`,
        signal,
      );
    },
    webVitals(window, { siteId, groupBy, filters, signal } = {}) {
      const qs = toQS({
        ...expandWindow(window),
        group_by: groupBy,
        ...filtersToQS(filters),
      });
      return call<WebVitalsResponse>(
        `/v1/sites/${resolveSite(siteId)}/stats/web-vitals?${qs}`,
        signal,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandWindow(spec: WindowSpec): TimeWindow {
  if (typeof spec === "object") {
    return {
      from: toISO(spec.from),
      to: toISO(spec.to),
    };
  }
  const to = new Date();
  const from = new Date(to);
  switch (spec) {
    case "1h":
      from.setHours(from.getHours() - 1);
      break;
    case "24h":
      from.setHours(from.getHours() - 24);
      break;
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    case "90d":
      from.setDate(from.getDate() - 90);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function toISO(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

function filtersToQS(f?: Filters): Record<string, string | undefined> {
  if (!f) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) && v.length > 0) out[k] = v.join(",");
  }
  return out;
}

function toQS(parts: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  return p.toString();
}

// Note: unlike the React package (which assumes Server Components),
// this client does NOT assert server-only. Angular apps may use it
// in a backend-for-frontend or Angular Universal context; it's the
// consumer's responsibility to keep the bearer token off the browser.
