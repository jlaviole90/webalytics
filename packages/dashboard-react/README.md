# @jlaviole90/dashboard-react

Server-rendered React components for displaying your Webalytics data.
Ships zero runtime dependencies outside of React — all charts are
inline SVG, all styles are inline, and every component is async Server
Component-native.

```
npm install @jlaviole90/dashboard-react
```

## Two modes

### 1. Server-rendered (Next.js App Router, Remix, RSC) — admin token

The common path. The bearer token stays on the server; every render is
SSR, no auth leaks to the browser.

```tsx
// app/analytics/page.tsx — Next.js App Router
import { createClient, Dashboard } from "@jlaviole90/dashboard-react";

// IMPORTANT: this client holds a bearer token. Only import it into
// Server Components / route handlers, never into "use client" files.
const client = createClient({
  host: process.env.WEBALYTICS_API_HOST!,
  token: process.env.WEBALYTICS_API_TOKEN!,
  siteId: process.env.WEBALYTICS_SITE_UUID!,
  revalidateSeconds: 30, // Next.js RSC cache; omit for always-fresh
});

export default function AnalyticsPage() {
  return <Dashboard client={client} window="7d" />;
}
```

The client will throw loudly if you accidentally import it into a
`"use client"` module — the token staying server-side is enforced at
runtime, not just encouraged by documentation.

### 2. Browser-safe (plain React / CRA / Vite SPA) — public embed token

Use a **public embed token** (`wb_pub_live_*`) instead of the admin
bearer. These are narrow, read-only, scoped to one site, and
optionally bound to a set of browser Origins. Safe to ship in
client-side JS.

Mint one on your backend:

```bash
make public-token ORG_SLUG=jlav \
  ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io'
```

Then in your React app:

```tsx
"use client";
import { createClient, Dashboard } from "@jlaviole90/dashboard-react";

const client = createClient({
  kind:        "public",
  host:        "https://analytics.example.com",
  publicToken: "wb_pub_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  siteId:      "11111111-2222-3333-4444-555555555555",
});

export default function AnalyticsPage() {
  return <Dashboard client={client} window="7d" />;
}
```

Because components fetch inside `await`, you'll want to wrap them in a
Suspense boundary for browser-side use, or switch to React Query /
`useEffect`-based data fetching and feed the data into the primitives
manually (see "Compose the primitives" below).

That's it — you get summary cards, a realtime counter, a visitors
timeseries, four breakdown lists, and Core Web Vitals in the default
layout. Drop `window="24h"` or `window="30d"` to shift the range.

## Compose the primitives

For custom layouts, use the building blocks directly:

```tsx
import {
  createClient,
  SummaryCards,
  Realtime,
  TimeseriesChart,
  TopList,
  WebVitalsCards,
} from "@jlaviole90/dashboard-react";

const client = createClient({ /* ... */ });

export default function Page() {
  return (
    <div>
      <SummaryCards client={client} window="30d" />
      <TimeseriesChart client={client} metric="pageviews" window="30d" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <TopList client={client} dimension="path" limit={10} />
        <TopList client={client} dimension="utm_source" limit={5} />
      </div>
      <WebVitalsCards client={client} metrics={["LCP", "INP", "CLS"]} />
      <Realtime client={client} />
    </div>
  );
}
```

## Multi-tenant usage

`createClient()` accepts a `siteId` (site UUID) that every query uses by
default. To render multiple sites in one app, either create one client
per site or pass `siteId` override to any component:

```tsx
<SummaryCards client={client} siteId="<other-site-uuid>" window="7d" />
```

## Live-updating Realtime tile

All components are Server Components (they await on the server and then
render to HTML). To make the Realtime tile tick without a full page
refresh, wrap it in a tiny Client Component that calls
`router.refresh()` on an interval:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function Tick({ children, ms = 15000 }: { children: React.ReactNode; ms?: number }) {
  const r = useRouter();
  useEffect(() => {
    const i = setInterval(() => r.refresh(), ms);
    return () => clearInterval(i);
  }, [r, ms]);
  return <>{children}</>;
}
```

Then: `<Tick><Realtime client={client} /></Tick>`.

## Theming

Every component reads a small set of CSS variables. Override them in a
parent selector to restyle the whole dashboard:

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

Individual subtrees are tagged with `data-wbx-part="summary"`,
`"realtime"`, `"timeseries"`, `"top-list"`, `"web-vitals"` etc. for
fine-grained overrides.

## API

All components take `client: DashboardClient`, produced by
`createClient(config)`. All components accept `window`, `siteId`, and
`filters` overrides. See the TypeScript definitions (shipped in `dist/`)
for the full surface.

### Exported client methods

| Method | Endpoint |
| --- | --- |
| `client.realtime()` | `GET /v1/sites/:id/stats/realtime` |
| `client.summary(window)` | `GET /v1/sites/:id/stats/summary` |
| `client.timeseries(window, metric, interval)` | `GET /v1/sites/:id/stats/timeseries` |
| `client.breakdown(window, dimension)` | `GET /v1/sites/:id/stats/breakdown` |
| `client.webVitals(window)` | `GET /v1/sites/:id/stats/web-vitals` |
