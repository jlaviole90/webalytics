# @jlaviole90/tracker

Tiny, cookieless browser tracker for a self-hosted [webalytics](../../) API.
Ships as ESM, CJS, and a ~3KB-gzip UMD bundle for script-tag installs.

## Install

```bash
npm install @jlaviole90/tracker
```

Or drop in via a script tag (auto-initializes from `data-*` attrs):

```html
<script
  async
  src="https://cdn.example.com/webalytics.umd.js"
  data-site-id="wb_live_xxxx"
  data-host="https://analytics.example.com"
  data-auto-pageviews="true"
></script>
```

## Programmatic usage

```ts
import { init } from "@jlaviole90/tracker";

const wa = init({
  siteId: "wb_live_xxxx",
  host: "https://analytics.example.com",
  autoPageviews: true,
  autoWebVitals: true,
  environment: "production",
  release: process.env.GIT_SHA,
});

wa.track("signup", { plan: "pro" });
wa.pageview({ url: "/virtual/onboarding/step-2" });
```

### `InitConfig`

| Option          | Default | What it does                                                              |
| --------------- | ------- | ------------------------------------------------------------------------- |
| `siteId`        | —       | Required. `wb_live_…` id from the dashboard.                              |
| `host`          | —       | Required. The API origin (no path).                                       |
| `autoPageviews` | `true`  | Fire a pageview on init + every History API nav.                          |
| `autoWebVitals` | `true`  | Collect LCP/FCP/CLS/TTFB/INP via PerformanceObserver.                     |
| `respectDNT`    | `true`  | Honor `navigator.doNotTrack` and Global Privacy Control.                  |
| `excludePaths`  | `[]`    | Array of paths or regexes to suppress.                                    |
| `environment`   | —       | Free-form tag, e.g. `production` / `staging`.                             |
| `release`       | —       | Git SHA or version, copied onto every event.                              |
| `route`         | —       | Custom route template (`/users/[id]`) when framework doesn't expose one.  |
| `debug`         | `false` | Log to console + add `?debug=1` on requests so the API echoes drop reason.|

### Tracker API

```ts
interface Tracker {
  pageview(fields?: Partial<PageviewFields>): void;
  track(event: string, props?: Record<string, unknown>, fields?: Partial<Fields>): void;
  identify(userId: string | null): void;  // no-op in the MVP (privacy-first)
  flush(): Promise<void>;
  setEnabled(on: boolean): void;
}
```

Events are batched (up to 10 or every 250ms), sent via `sendBeacon` on
`pagehide` / `fetch({ keepalive: true })` otherwise. Network errors are
swallowed silently — tracking never throws.

## Size budget

The UMD build is gated at **4 KB gzipped** via `npm run size`. CI fails if
the budget is exceeded.

## Testing

```bash
npm run test     # vitest against happy-dom
npm run build
npm run size
```
