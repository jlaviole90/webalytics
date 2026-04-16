# @webalytics/tracker

Tiny JavaScript tracker for Webalytics — a self-hosted, cookieless web
analytics service. This package will be implemented in Phase 3; the file
you are reading is the **contract** for what that package is going to be.

- Size target: **< 2 KB gzipped** core, no runtime dependencies.
- ESM, CJS, and UMD builds.
- Cookieless by default. DNT / GPC honored.
- First-class custom events, Web Vitals, and multi-domain / multi-route
  support.

## Install

```bash
npm install @webalytics/tracker
# or
pnpm add @webalytics/tracker
```

## Quick start

```ts
import { init } from "@webalytics/tracker";

const tracker = init({
  siteId: "wb_live_7f2a3b4c5d6e7f80",
  host:   "https://analytics.example.com",
  environment: "production",
  release: process.env.GIT_SHA,
});

// Custom event
tracker.track("signup", { plan: "pro" });
```

### Script-tag install

For sites without a build step:

```html
<script
  src="https://analytics.example.com/tracker.js"
  data-site-id="wb_live_7f2a3b4c5d6e7f80"
  data-host="https://analytics.example.com"
  data-environment="production"
  defer
></script>
```

## Public API

See `src/types.ts` for the authoritative TypeScript types. In summary:

- `init(config)` — returns a `Tracker` and installs auto-handlers.
- `tracker.pageview(url?)` — fire a pageview manually.
- `tracker.track(name, props?)` — fire a custom event.
- `tracker.identify(traits)` — consented-mode only; no-op otherwise.
- `tracker.flush()` — drain the buffer.
- `tracker.setEnabled(bool)` — runtime on/off.

## Behavior

### Auto pageviews

On `init`, fires an immediate pageview and hooks `history.pushState` /
`replaceState` / `popstate` for SPA navigations. Framework adapters turn
this off and hook their router events instead to avoid double-fires.

### Web Vitals

When `autoWebVitals` is `true` (default), the tracker imports the
[`web-vitals`](https://github.com/GoogleChrome/web-vitals) library lazily
and reports LCP, INP, CLS, FCP, and TTFB as `event: "web_vital"` beacons.

### Normalized routes

Single-page apps should supply the `route` hook so `/blog/hello-world`
and `/blog/some-other-post` roll up under `/blog/[slug]`:

```ts
init({
  siteId: "...",
  host:   "...",
  route: () => router.currentRoute.value.matched[0]?.path ?? null,
});
```

### Batching & transport

`track()` calls are buffered briefly (250ms) and flushed together via
`fetch({ keepalive: true })`. On `pagehide` the buffer flushes via
`navigator.sendBeacon` so events aren't lost on unload.

### Failure mode

The tracker never throws into application code. Network failures are
swallowed; with `debug: true` they're logged to the console.

## Framework adapters

Planned separate entry points (Phase 3):

- `@webalytics/tracker/next`
- `@webalytics/tracker/remix`
- `@webalytics/tracker/astro`
- `@webalytics/tracker/sveltekit`

Each adapter disables the History API hook and wires into the framework's
native router events instead.

## Status

This README and the types in `src/types.ts` are a **contract**, not a
published package. Implementation lands in Phase 3 of the roadmap in
`docs/ARCHITECTURE.md`.
