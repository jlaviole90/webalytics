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
} from "./types.js";

/**
 * Server-side config. The bearer `token` is secret and MUST NOT ship to
 * the browser. Pair this with React Server Components, a Next.js route
 * handler, or a BFF you control.
 *
 * If you want a browser-safe variant, use {@link PublicClientConfig}
 * and {@link createClient} below — it swaps the admin bearer for a
 * narrow read-only embed token and routes to `/public/v1`.
 */
export interface ServerClientConfig {
  kind?: "server";
  /** Base URL of your Webalytics deployment, e.g. "https://analytics.example.com". */
  host: string;
  /** Server-side admin bearer token (wb_pat_live_*). Do NOT expose to browser. */
  token: string;
  /** Site UUID (not the public wb_live_* id) this client queries by default. */
  siteId: string;
  /**
   * Custom fetch implementation. Next.js 14+ uses the patched global
   * fetch automatically for caching; pass a different one only if you
   * need to tag cache entries differently per request.
   */
  fetch?: typeof fetch;
  /**
   * Default revalidation hint (Next.js). 0 disables the RSC cache so
   * every render hits the API. Set to e.g. 30 for "refresh at most
   * every 30s" behavior on realtime tiles.
   */
  revalidateSeconds?: number;
}

/**
 * Browser-safe config. The `publicToken` is a narrow, read-only credential
 * scoped to exactly one site; see `@webalytics/dashboard-react` README and
 * `deploy/provision-public-token.sh` for how to mint one.
 *
 * Safe to import into Client Components. Routes to `/public/v1/...`.
 */
export interface PublicClientConfig {
  kind: "public";
  /** Base URL of your Webalytics deployment, e.g. "https://analytics.example.com". */
  host: string;
  /** Browser-safe embed token (wb_pub_live_*). Safe to ship to the browser. */
  publicToken: string;
  /** Site UUID this token is bound to. Mismatch is a 403. */
  siteId: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Next.js revalidation hint; ignored outside Next RSC context. */
  revalidateSeconds?: number;
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
  // Public tokens route under /public/v1; admin tokens under /v1.
  const basePath = isPublic ? "/public/v1" : "/v1";

  // Admin mode must never run in a browser — fail loudly. Public mode
  // is explicitly browser-safe.
  if (!isPublic) {
    assertServerOnly();
  }

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
      // next.revalidate is ignored by non-Next runtimes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(config.revalidateSeconds !== undefined
        ? { next: { revalidate: config.revalidateSeconds } as any }
        : {}),
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

/**
 * Guard against accidental shipping of the ADMIN bearer token to a browser.
 * Not fool-proof, but it fails loudly in the most common mistake case
 * (importing a server client into a "use client" module).
 *
 * Public clients (kind: "public") skip this check — they are explicitly
 * browser-safe.
 */
function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error(
      [
        "@webalytics/dashboard-react: createClient({ token }) must only be called on the server.",
        "You appear to be running it in a browser context, which would leak your",
        "admin bearer token. Either move the import into a Server Component / route",
        "handler, or switch to a public embed token: createClient({ kind: 'public',",
        "publicToken: 'wb_pub_live_...' }).",
      ].join(" "),
    );
  }
}
