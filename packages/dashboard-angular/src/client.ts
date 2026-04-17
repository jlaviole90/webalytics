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
 * Server-side config. The admin bearer `token` is a secret and MUST NOT
 * ship to the browser. Use this shape with Angular Universal or a
 * backend-for-frontend you control.
 */
export interface ServerClientConfig {
  kind?: "server";
  host: string;
  /** Server-side admin bearer (wb_pat_live_*). Do NOT expose to browser. */
  token: string;
  /** Site UUID this client queries by default. */
  siteId: string;
  fetch?: typeof fetch;
}

/**
 * Browser-safe config. `publicToken` is a narrow, read-only credential
 * scoped to exactly one site — safe to embed in a plain Angular SPA
 * (no SSR required). See the package README for how to mint one via
 * `deploy/provision-public-token.sh`.
 */
export interface PublicClientConfig {
  kind: "public";
  host: string;
  /** Browser-safe embed token (wb_pub_live_*). Safe to ship to browser. */
  publicToken: string;
  /** Site UUID this token is bound to. Mismatch is a 403. */
  siteId: string;
  fetch?: typeof fetch;
}

export type ClientConfig = ServerClientConfig | PublicClientConfig;

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
  const isPublic = config.kind === "public";
  const bearer = isPublic ? config.publicToken : config.token;
  const basePath = isPublic ? "/public/v1" : "/v1";

  const f = config.fetch ?? fetch;
  const base = config.host.replace(/\/+$/, "");

  const call = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const url = `${base}${path}`;
    const res = await f(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!res.ok) {
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
      return call<RealtimeResponse>(
        `${basePath}/sites/${resolveSite(siteId)}/stats/realtime`,
        signal,
      );
    },
    summary(window, { siteId, filters, signal } = {}) {
      const qs = toQS({ ...expandWindow(window), ...filtersToQS(filters) });
      return call<SummaryResponse>(
        `${basePath}/sites/${resolveSite(siteId)}/stats/summary?${qs}`,
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
        `${basePath}/sites/${resolveSite(siteId)}/stats/timeseries?${qs}`,
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
        `${basePath}/sites/${resolveSite(siteId)}/stats/breakdown?${qs}`,
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
        `${basePath}/sites/${resolveSite(siteId)}/stats/web-vitals?${qs}`,
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
