// Thin server-only client for the /v1 API. All methods hit the Go API with
// the configured bearer token. We disable Next's data cache because stats
// update continuously; use `revalidate: N` per-page if you want caching.
import "server-only";
import { env } from "./env";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.apiHost()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.apiToken()}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`webalytics ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

// Convenient default window: last 24 hours, ISO-encoded.
export function defaultWindow(hours = 24) {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// --- Response shapes ------------------------------------------------------
//
// Kept loose — these mirror the Go handlers in internal/api/v1/stats.go.

export interface RealtimeResponse {
  online: number;
  top_pages: { path: string; visitors: number }[];
  top_hostnames: { hostname: string; visitors: number }[];
  recent: Record<string, unknown>[];
}

export interface SummaryResponse {
  window: { from: string; to: string };
  metrics: Record<string, { value: number; previous?: number; change_pct?: number }>;
}

export interface BreakdownResponse {
  window: { from: string; to: string };
  dimension: string;
  metric: string;
  results: { key: string; value: number; share: number }[];
  total: number;
  total_other: number;
}

export interface VitalsResponse {
  window: { from: string; to: string };
  group_by: string;
  groups: {
    key: string;
    metrics: Record<
      string,
      {
        samples: number;
        p75: number;
        p95: number;
        rating_pct: { good: number; needs_improvement: number; poor: number };
      }
    >;
  }[];
}

export interface SiteResponse {
  id: string;
  organization_id: string;
  public_site_id: string;
  name: string;
  timezone: string;
}

// --- Endpoints ------------------------------------------------------------

export const api = {
  site(id: string) {
    return call<SiteResponse>(`/v1/sites/${id}`);
  },
  realtime(id: string) {
    return call<RealtimeResponse>(`/v1/sites/${id}/stats/realtime`);
  },
  summary(id: string, window: { from: string; to: string }) {
    return call<SummaryResponse>(`/v1/sites/${id}/stats/summary${qs(window)}`);
  },
  breakdown(
    id: string,
    window: { from: string; to: string },
    dimension: string,
    metric = "visitors",
    limit = 20,
  ) {
    return call<BreakdownResponse>(
      `/v1/sites/${id}/stats/breakdown${qs({ ...window, dimension, metric, limit })}`,
    );
  },
  webVitals(id: string, window: { from: string; to: string }, groupBy = "none") {
    return call<VitalsResponse>(
      `/v1/sites/${id}/stats/web-vitals${qs({ ...window, group_by: groupBy })}`,
    );
  },
};
