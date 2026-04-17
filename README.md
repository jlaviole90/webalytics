# Webalytics

> A self-hosted, multi-tenant web analytics platform. Cookieless, GDPR-friendly,
> and designed for teams who want the shape of Vercel Analytics or Plausible
> without sending visitor data to a third party.

Webalytics is a **Go ingest + query service**, a family of **NPM tracker
packages** (vanilla, Next.js, Angular), a family of **NPM dashboard component
packages** (React, Angular), and **Terraform modules** that deploy the whole
thing to a single AWS Lightsail box with real HTTPS in one command. It is
designed so one operator can run one instance and comfortably host analytics
for many clients — each client isolated at the organization level, with their
own bearer token and their own dashboards.

- **Collect:** a ~3KB gzipped browser tracker that works in any framework,
  with official bindings for React/Next.js and Angular.
- **Store:** Postgres for the control plane (orgs, sites, tokens) and
  ClickHouse for the event plane (billions of events cheap to query).
- **Query:** a typed REST API at `/v1/stats/*` with 5 endpoints covering
  realtime, summary, timeseries, breakdowns, and Web Vitals.
- **Display:** drop-in server components for React (`<Dashboard />`) and
  standalone components for Angular (`<wb-dashboard>`) that take the API
  output and render a polished, Vercel-style UI.
- **Deploy:** `make tf-apply` stands up the whole thing on AWS Lightsail
  behind Caddy + Let's Encrypt. No DNS required; `.nip.io` works out of
  the box.

---

## Table of contents

1. [Who this is for](#who-this-is-for)
2. [Feature highlights](#feature-highlights)
3. [System architecture](#system-architecture)
4. [Repository layout](#repository-layout)
5. [Quickstart — local development](#quickstart--local-development)
6. [NPM packages](#npm-packages)
7. [API reference](#api-reference)
8. [Multi-tenancy](#multi-tenancy)
9. [Privacy posture](#privacy-posture)
10. [Production deployment](#production-deployment)
11. [Development workflow](#development-workflow)
12. [Configuration reference](#configuration-reference)
13. [Makefile targets](#makefile-targets)
14. [Technology choices](#technology-choices)
15. [Status and roadmap](#status-and-roadmap)
16. [License](#license)

---

## Who this is for

- **Solo operators & agencies** who want analytics for one or many sites
  without sending traffic to Google/Vercel/Plausible.
- **SEO-portfolio owners** who need domain-keyed rollups across a bunch of
  properties on one account.
- **Privacy-conscious product teams** who need GDPR-friendly analytics
  with no cookie banner by default.
- **Frontend engineers** who want drop-in React/Angular components to ship
  an analytics dashboard in their own product UI.

Not (yet) a Google Analytics replacement across every obscure feature; it
covers the 80% most people actually use. See [Status](#status-and-roadmap).

---

## Feature highlights

| Area | What you get |
| --- | --- |
| **Ingest** | `/collect` endpoint with bot filtering, DNT/GPC honoring, per-IP and per-site rate limits in Redis, batched writes to ClickHouse, silent-drop on unknown sites |
| **Session identity** | Cookieless by default. Sessions derived from `HMAC(ip, ua, daily_salt, site_id)`; salt rotates every 24h so identifiers are useless across days |
| **Enrichment** | Server-side IP→country/region/city via MaxMind (IP never persisted), UA parsing for browser/OS/device, bot detection |
| **Web Vitals** | LCP, INP, CLS, FCP, TTFB collected by the tracker, stored as first-class rows with good/needs-improvement/poor rating |
| **Query API** | Typed `/v1/stats/*` endpoints: realtime, summary, timeseries, breakdown (11 dimensions), web-vitals. Bearer auth |
| **Multi-tenancy** | Orgs → sites → domains → tokens, enforced three ways (API middleware, Postgres RLS, ClickHouse query builders) |
| **Dashboards** | Server-rendered React components (`@webalytics/dashboard-react`) and standalone Angular components (`@webalytics/dashboard-angular`), visually identical |
| **Tracker bindings** | Vanilla (`@webalytics/tracker`), Next.js (`@webalytics/tracker-next`), Angular (`@webalytics/tracker-angular`) |
| **Deployment** | Terraform → Lightsail, cloud-init bootstrap, Caddy auto-HTTPS, systemd-managed Docker Compose, GitHub Actions redeploy on green main |
| **Observability** | Structured JSON logs, `/healthz`, debug echo mode (`?debug=1`) for tracker troubleshooting |

---

## System architecture

```
Browser / SPA                       Single Lightsail box
+---------------------------+       +--------------------------------------+
| @webalytics/tracker       |       |        Caddy (auto Let's Encrypt)    |
|   (or -next / -angular)   | HTTPS |        :80 -> :443                   |
|                           +------>+         |                            |
| <script> / init()         |       |         v                            |
+---------------------------+       |   api:8080  (Go)                     |
                                    |    |                                 |
SSR dashboard (Next.js / Angular    |    +-- /collect    --> ClickHouse    |
Universal)                          |    +-- /v1/sites/* --> Postgres RLS  |
+---------------------------+       |    +-- /v1/stats/* --> ClickHouse    |
| @webalytics/dashboard-*   |       |    +-- /healthz                      |
|   createClient({ token })  | HTTPS |                                      |
|   <Dashboard />            +------>+   Redis (rate limit + realtime)      |
+---------------------------+       +--------------------------------------+
                                      (postgres + clickhouse + redis are
                                       never exposed publicly)
```

**Hot path (ingest):** browser → `/collect` (Caddy → api:8080) → validate
site + Origin/Referer → rate-limit in Redis → enrich (IP/UA/geo) → batch
→ flush to ClickHouse every 250ms or 500 rows.

**Cold path (query):** dashboard SSR → `/v1/stats/*` with bearer token →
resolve org from token → build ClickHouse query with mandatory tenant
predicate → return JSON.

Full architecture doc: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (~800 lines
covering data model, session derivation, MVs, funnels, retention, and more).

---

## Repository layout

```
webalytics/
├── api/                      Go HTTP handlers and middleware
├── cmd/webalytics/           Service entrypoint (main.go)
├── internal/                 Go service internals (not re-exported)
│   ├── api/v1/               /v1/* query handlers (stats, sites, tokens)
│   ├── auth/                 Bearer token hashing + org resolution
│   ├── config/               Env-var loading with sensible defaults
│   ├── domain/               Core types (Organization, Site, Event, ...)
│   ├── enrich/               MaxMind geo + UA parsing + bot detection
│   ├── ingest/               /collect pipeline: validate, enrich, batch
│   ├── logger/               slog setup (JSON/text)
│   ├── query/                ClickHouse query builders (5 endpoints)
│   ├── ratelimit/            Redis token-bucket per IP + per site
│   ├── server/               HTTP server + graceful shutdown
│   └── storage/              Postgres & ClickHouse clients
├── migrations/
│   ├── postgres/             0001_init, 0002_rls, 0003_auth (up + down)
│   └── clickhouse/           0001_events, 0002_materialized_views
│
├── packages/                 NPM workspace (published packages)
│   ├── tracker/              @webalytics/tracker          (vanilla, UMD+ESM+CJS)
│   ├── tracker-next/         @webalytics/tracker-next     (Next.js bindings)
│   ├── tracker-angular/      @webalytics/tracker-angular  (Angular bindings)
│   ├── dashboard-react/      @webalytics/dashboard-react  (RSC components)
│   └── dashboard-angular/    @webalytics/dashboard-angular (standalone components)
│
├── apps/                     NPM workspace (not published)
│   ├── demo-next/            Dogfood Next.js site that fires pageviews + events
│   └── dashboard-next/       Dogfood dashboard using @webalytics/dashboard-react
│
├── test/
│   ├── e2e/                  Go e2e tests (HTTP-level, against running stack)
│   ├── browser/              Playwright tests (tracker-in-browser + dashboard)
│   └── testdata/             Fixtures (GeoLite2 test DB, UA samples)
│
├── deploy/
│   ├── Caddyfile             Production reverse proxy + auto-HTTPS config
│   ├── Dockerfile            Multi-stage build → distroless static binary
│   ├── seed.sh               One-shot bootstrap: first org + site + token
│   ├── provision-site.sh     Provision additional tenants (multi-client)
│   ├── migrate.sh            Runs postgres + clickhouse migrations
│   └── postgres-init/        docker-entrypoint-initdb.d (RLS roles, grants)
│
├── infra/terraform/          Lightsail + static IP + firewall + SSH key
│   ├── main.tf, variables.tf, outputs.tf, ssh.tf, versions.tf
│   ├── cloud-init.sh.tpl     Bootstraps the box: Docker, repo clone, systemd
│   └── README.md             Terraform-specific notes
│
├── docs/
│   ├── ARCHITECTURE.md       Design doc (data model, privacy, APIs, scaling)
│   └── DEPLOY.md             Step-by-step Lightsail deployment guide
│
├── docker-compose.yml        Local dev (core stack + optional demo profile)
├── docker-compose.prod.yml   Production overlay (Caddy, no exposed DB ports)
├── Makefile                  Unified interface over Go / npm / terraform / ssh
├── .env.example              All supported env vars, documented inline
├── go.mod / go.sum           Go 1.22, standard library-first
└── package.json              npm workspaces root
```

---

## Quickstart — local development

Prerequisites: Docker, Go 1.22+, Node 20+, GNU Make.

```bash
# 1. Clone and install JS deps
git clone https://github.com/YOUR_ORG/webalytics.git
cd webalytics
cp .env.example .env
make js-install

# 2. Bring up the core stack (Postgres + ClickHouse + Redis + api)
make up

# 3. Seed the first tenant (org + site + bearer token)
make seed
# writes deploy/.seeded.env with WEBALYTICS_HOST, SITE_ID, TOKEN

# 4. (Optional) Bring up the full dogfood loop — demo site + dashboard
make up-demo
#   http://localhost:3000  — demo site firing events
#   http://localhost:3001  — dashboard reading /v1/stats/*
```

Tail the logs:

```bash
make logs               # api
make demo-logs          # demo site
make dashboard-logs     # dashboard
```

Reset just the event data (keeps seeded tokens):

```bash
make reset-data
```

Tear everything down (including volumes):

```bash
make down
```

### Verifying ingest works

```bash
source deploy/.seeded.env

curl -X POST "$WEBALYTICS_HOST/collect?debug=1" \
  -H 'Content-Type: application/json' \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"site_id\": \"$WEBALYTICS_SITE_ID\",
    \"event\": \"pageview\",
    \"url\": \"http://localhost:3000/\",
    \"ts_client\": $(date +%s%3N)
  }"
# => 204 with header "X-Webalytics-Debug: ok"
```

Then query back:

```bash
curl -H "Authorization: Bearer $WEBALYTICS_TOKEN" \
  "$WEBALYTICS_HOST/v1/sites/$WEBALYTICS_SITE_UUID/stats/realtime"
```

---

## NPM packages

All packages live under `packages/` as an npm workspace. Each is
publishable to npm under the `@webalytics/*` scope.

### `@webalytics/tracker` — vanilla browser tracker

Zero-dep, ~3KB gzipped UMD, cookieless by default. Ships ESM, CJS, and
UMD builds.

```html
<script
  async
  src="https://cdn.example.com/tracker.umd.js"
  data-site-id="wb_live_xxxxxxxxxxxxxxxx"
  data-host="https://analytics.example.com"
></script>
```

```ts
import { init } from "@webalytics/tracker";

const wa = init({
  siteId: "wb_live_xxxxxxxxxxxxxxxx",
  host:   "https://analytics.example.com",
  autoPageviews: true,
  autoWebVitals: true,
  respectDNT:    true,
});

wa.track("signup", { plan: "pro" });
```

Collects pageviews, SPA navigations (History API), Web Vitals (LCP/INP/
CLS/FCP/TTFB), and custom events. Honors DNT/GPC. Never throws. Full
docs: [`packages/tracker/README.md`](packages/tracker/README.md).

### `@webalytics/tracker-next` — Next.js bindings

App Router and Pages Router support. Auto-tracks Next's App Router
navigation via `usePathname`, falls back to `router.events` for Pages.

```tsx
// app/layout.tsx
import { Analytics } from "@webalytics/tracker-next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Analytics siteId="wb_live_..." host="https://analytics.example.com" />
      </body>
    </html>
  );
}
```

Full docs: [`packages/tracker-next/README.md`](packages/tracker-next/README.md).

### `@webalytics/tracker-angular` — Angular bindings

Standalone Angular 17+. Auto-tracks pageviews on Router `NavigationEnd`
(more accurate than History API hooks — respects guards, lazy routes,
and redirects). Uses the modern `inject()` pattern, no decorator
metadata required at consumer-build time.

```ts
// main.ts
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { provideWebalytics } from "@webalytics/tracker-angular";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";

bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(routes),
    provideWebalytics({
      siteId: "wb_live_xxxxxxxxxxxxxxxx",
      host:   "https://analytics.example.com",
    }),
  ],
});
```

```ts
@Component({ /* ... */ })
export class CheckoutPage {
  private wa = inject(WebalyticsService);
  submit() { this.wa.track("checkout", { plan: "pro", price: 19 }); }
}
```

Full docs: [`packages/tracker-angular/README.md`](packages/tracker-angular/README.md).

### `@webalytics/dashboard-react` — React Server Components

Drop-in components that render Webalytics data as a Vercel-style dashboard.
All components are RSC-native (async Server Components); bearer tokens
stay on the server. Zero chart dependencies — charts are inline SVG.

```tsx
// app/analytics/page.tsx
import { createClient, Dashboard } from "@webalytics/dashboard-react";

const client = createClient({
  host:   process.env.WEBALYTICS_API_HOST!,
  token:  process.env.WEBALYTICS_API_TOKEN!,
  siteId: process.env.WEBALYTICS_SITE_UUID!,
});

export default function AnalyticsPage() {
  return <Dashboard client={client} window="7d" />;
}
```

Composable primitives: `<SummaryCards />`, `<Realtime />`,
`<TimeseriesChart />`, `<TopList dimension="path" />`, `<WebVitalsCards />`.
Theming via CSS variables on `[data-wbx]`. Full docs:
[`packages/dashboard-react/README.md`](packages/dashboard-react/README.md).

### `@webalytics/dashboard-angular` — Angular standalone components

Mirror of the React package. Built with `ng-packagr` (Angular Package
Format, Ivy partial compilation). Use from Angular Universal SSR so the
bearer token stays server-side.

```ts
// main.server.ts
bootstrapApplication(AppComponent, {
  providers: [
    provideWebalyticsDashboard({
      host:   process.env["WEBALYTICS_API_HOST"]!,
      token:  process.env["WEBALYTICS_API_TOKEN"]!,
      siteId: process.env["WEBALYTICS_SITE_UUID"]!,
    }),
  ],
});
```

```ts
@Component({
  standalone: true,
  imports: [DashboardComponent],
  template: `<wb-dashboard window="7d" />`,
})
export class AnalyticsPage {}
```

Individual components: `<wb-summary-cards>`, `<wb-realtime>`,
`<wb-timeseries-chart>`, `<wb-top-list>`, `<wb-web-vitals-cards>`. Full
docs: [`packages/dashboard-angular/README.md`](packages/dashboard-angular/README.md).

---

## API reference

Two surfaces, same Go service, separated by path + middleware.

### Ingest — `POST /collect`

CORS-friendly, fire-and-forget. Accepts JSON from the tracker packages.
Always returns `204 No Content` to a real browser (use `?debug=1` to see
why an event was dropped via the `X-Webalytics-Debug` response header).

```json
{
  "site_id":   "wb_live_xxxxxxxxxxxxxxxx",
  "event":     "pageview",
  "url":       "https://example.com/blog/post-1?utm_source=reddit",
  "referrer":  "https://www.reddit.com/r/golang/",
  "title":     "Post 1",
  "screen":   { "w": 2560, "h": 1440 },
  "viewport": { "w": 1280, "h": 800 },
  "language":  "en-US",
  "props":    { "plan": "pro" },
  "ts_client": 1713270000123
}
```

### Query API — `GET /v1/*`

Bearer auth via `Authorization: Bearer wb_pat_live_...`. All `stats`
endpoints are nested under a site UUID and accept a common filter DSL:
`hostnames`, `paths`, `devices`, `countries`, `referrer_hosts`,
`utm_sources`, `environments`, `releases` (all comma-separated).

| Method | Path                                       | Returns                                                       |
| ------ | ------------------------------------------ | ------------------------------------------------------------- |
| GET    | `/v1/sites`                                | All sites the token can access                                |
| GET    | `/v1/sites/{id}`                           | A single site's metadata                                      |
| GET    | `/v1/sites/{id}/stats/realtime`            | Online visitors (last 5m), top pages, top hostnames, recents  |
| GET    | `/v1/sites/{id}/stats/summary?from&to`     | Visitors, pageviews, sessions, bounce rate, avg session sec   |
| GET    | `/v1/sites/{id}/stats/timeseries?metric&interval` | Metric over time (visitors/pageviews/sessions by minute/hour/day) |
| GET    | `/v1/sites/{id}/stats/breakdown?dimension` | Top N for any of 11 dimensions with share %                   |
| GET    | `/v1/sites/{id}/stats/web-vitals`          | p75/p95 for LCP/INP/CLS/FCP/TTFB + good/needs/poor histograms |
| GET    | `/healthz`                                 | Public health check                                           |

**Breakdown dimensions:** `path`, `hostname`, `referrer_host`, `country`,
`device`, `browser`, `os`, `utm_source`, `utm_medium`, `utm_campaign`,
`event_name`.

See [`packages/dashboard-react/src/client.ts`](packages/dashboard-react/src/client.ts)
for typed request/response shapes (those types are published as part of
the dashboard packages).

### Browser-safe query API — `GET /public/v1/*`

A parallel, read-only surface for embedding dashboards directly in a
browser. Uses a narrow **public embed token** (`wb_pub_live_*`) instead
of the full admin bearer. Unlike `/v1`, these endpoints:

- Are scoped to one site (the URL `{siteId}` must match the token's site
  or the request is a 403).
- Enforce an optional Origin allowlist on the token via CORS preflight
  *and* a server-side re-check.
- Expose only aggregate stats — no IPs, no UA strings, no session or
  visitor IDs reach the wire.
- Cannot reach admin surfaces; `/public/v1/tokens` etc. simply don't
  exist.

| Method | Path                                              | Auth                              |
| ------ | ------------------------------------------------- | --------------------------------- |
| GET    | `/public/v1/sites/{id}/stats/realtime`            | `Authorization: Bearer wb_pub_live_...` |
| GET    | `/public/v1/sites/{id}/stats/summary`             | same                              |
| GET    | `/public/v1/sites/{id}/stats/timeseries`          | same                              |
| GET    | `/public/v1/sites/{id}/stats/breakdown`           | same                              |
| GET    | `/public/v1/sites/{id}/stats/web-vitals`          | same                              |

Mint a token with `make public-token` (or `make prod-public-token` if
you're targeting a deployed instance); see
[`deploy/provision-public-token.sh`](deploy/provision-public-token.sh)
for the full contract.

---

## Multi-tenancy

One deployment can host many isolated tenants. The model is:

```
Organization
 ├── Site (public_site_id = wb_live_...)
 │    ├── Domain (primary)
 │    └── Domain (alias)
 ├── Site
 │    └── Domain
 └── API Token (wb_pat_live_...)  ← scoped to this organization
```

### Creating the first tenant

`make seed` (run once) creates a default `local` organization, one site,
one domain, and one API token. Use this for your own stack.

### Adding more tenants

For an agency/client setup, provision each client as their own
organization — that guarantees they get a separate bearer token and can
never see each other's data:

```bash
# Locally
make provision ORG_SLUG=acme ORG_NAME="Acme Corp" \
  SITE_NAME="Acme Marketing" DOMAINS="acme.com,www.acme.com"

# Or on the production box
ssh ubuntu@<ip>
cd /opt/webalytics && set -a && source .env.prod && set +a
ORG_SLUG=acme ORG_NAME="Acme Corp" \
  SITE_NAME="Acme Marketing" DOMAINS="acme.com" \
  bash deploy/provision-site.sh
```

The script prints the full set of credentials and writes them to
`deploy/tenants/<slug>.env` (mode 0600, gitignored). Re-running with the
same `ORG_SLUG` + `SITE_NAME` rotates the token but keeps the org and
site UUID stable, so install instructions you've already shared stay
valid.

### Isolation guarantees

Three independent layers enforce tenant isolation:

1. **API middleware.** Every `/v1` handler resolves the bearer token to
   an `organization_id`, then refuses to answer for any site not owned
   by that org.
2. **Postgres RLS.** Tenant-scoped tables (`sites`, `domains`,
   `event_definitions`, `api_tokens`) have row-level security policies
   keyed on a session variable set by the handler.
3. **ClickHouse query builders.** No code path constructs a ClickHouse
   query without a mandatory `site_id` predicate resolved via the token.

A bug in any one layer would not leak data — all three would have to
break simultaneously.

---

## Privacy posture

Webalytics is designed to keep operators out of cookie-banner territory by
default.

- **No cookies, no localStorage** for visitor identification. Sessions
  are derived from `HMAC(ip, user_agent, daily_salt, site_id)`; the salt
  rotates every 24h at UTC midnight so the value is useless for
  cross-day tracking. This is the same pattern Plausible and Fathom use.
- **IP addresses are never persisted.** The raw IP is used at request
  time for geo lookup (MaxMind) and session hashing, then dropped before
  the row is written.
- **Geo is lossy by design.** Country, region, and city are stored;
  latitude/longitude are not.
- **DNT and Global Privacy Control** are honored by the tracker by
  default.
- **Bot filtering** at ingest drops known bots before write based on UA
  blocklist and heuristic checks.
- **Data-subject-request posture:** because identifiers are daily hashes
  of an IP we never store, we cannot re-identify a user after the fact.
  This is intentional: it puts the system in a GDPR-friendly pseudonymous-
  or-anonymous posture out of the box.

An opt-in "consented mode" exists for operators who need stable
long-horizon IDs; it switches identification to a first-party cookie
after an explicit consent signal. Off by default.

Full legal/privacy discussion: `docs/ARCHITECTURE.md` §5.

---

## Production deployment

One-command deploy to AWS Lightsail:

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars        # set git_repo_url; acme_email optional
make -C ../.. tf-init
make -C ../.. tf-apply          # ~90s; then ~3-5 min cloud-init
```

Outputs a `<static_ip>.nip.io` hostname that's live on HTTPS within ~30s
of the first hit (Caddy completes the Let's Encrypt HTTP-01 challenge on
demand).

**What you get:**

- Ubuntu 22.04 on a 2GB Lightsail instance (≈ $10/mo)
- Static IP + firewall rules (80, 443, 22)
- Docker Compose stack managed by systemd: `webalytics.service`
- Caddy → api:8080, auto-renewing TLS, HSTS, HTTP/3
- GitHub Actions workflow that redeploys on every green `main`

**Public endpoints on the box:**

| Path          | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `/collect`    | Ingest (tracker posts events here)              |
| `/v1/*`       | Authenticated query API                         |
| `/healthz`    | Health probe                                    |
| anything else | Minimal JSON advertising what this service is   |

**DB ports are never exposed.** Postgres, ClickHouse, and Redis live on
the docker-compose network only.

**Swap to a real domain later** by updating `domain` in tfvars and
pointing an A record at the static IP — no other changes needed.

Full step-by-step walkthrough including common gotchas, cost breakdown,
CI/CD wiring, and operational cheat sheet: [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Development workflow

### Go

```bash
make build              # go build ./...
make test               # go test ./...
make test-race          # go test -race ./...
make vet                # go vet ./...
make tidy               # go mod tidy
make e2e                # HTTP-level tests against running stack + seed
```

### JavaScript / TypeScript

```bash
make js-install         # npm install across all workspaces
make js-build           # build tracker + tracker-next
make js-test            # vitest unit tests for @webalytics/tracker
make js-size            # gzip-size gate on the UMD bundle (fails if > 4 KB)

# Per-package:
npm run build -w @webalytics/tracker-angular
npm run build -w @webalytics/dashboard-react
npm run build -w @webalytics/dashboard-angular   # uses ng-packagr
```

### Browser e2e (Playwright)

```bash
make up-demo            # needs the full dogfood loop running
make browser-install    # first time: installs Playwright browsers
make browser-e2e
```

### CI

`.github/workflows/ci.yml` runs Go unit tests + npm workspace builds on
every push. `.github/workflows/deploy.yml` triggers on the CI workflow
completing successfully on `main`, SSHes into the Lightsail box, and
executes `git pull && systemctl restart webalytics.service`.

Manual redeploy from your laptop:

```bash
HOST=ubuntu@<ip> make deploy
```

---

## Configuration reference

All service configuration is via environment variables. See `.env.example`
for the full annotated list. Key vars:

| Var                    | Default              | Purpose                                        |
| ---------------------- | -------------------- | ---------------------------------------------- |
| `HTTP_ADDR`            | `:8080`              | Server bind address                            |
| `LOG_LEVEL`            | `info`               | `debug` \| `info` \| `warn` \| `error`         |
| `LOG_FORMAT`           | `json`               | `json` or `text` (text is dev-friendly)        |
| `POSTGRES_APP_DSN`     | —                    | App role DSN (RLS-enforced)                    |
| `POSTGRES_INGEST_DSN`  | —                    | Ingest role DSN (BYPASSRLS, read-only lookups) |
| `CLICKHOUSE_ADDR`      | `clickhouse:9000`    | ClickHouse native-protocol endpoint            |
| `CLICKHOUSE_DATABASE`  | `webalytics`         |                                                |
| `REDIS_ADDR`           | `redis:6379`         |                                                |
| `SESSION_SALT_BASE`    | —                    | HMAC seed for session IDs (required in prod)   |
| `INGEST_BATCH_MAX_ROWS`| `500`                | Flush batch when this many rows buffered       |
| `INGEST_BATCH_FLUSH_MS`| `250`                | Flush batch after this many ms                 |
| `INGEST_RATE_PER_IP`   | `50`                 | Per-IP req/sec limit on `/collect`             |
| `INGEST_RATE_PER_SITE` | `500`                | Per-site req/sec limit on `/collect`           |

Production values are set by `cloud-init.sh.tpl` during provisioning and
live in `/opt/webalytics/.env.prod` on the box.

---

## Makefile targets

```
Core stack
  make up                 start Postgres + ClickHouse + Redis + api
  make up-demo            everything above + demo site + dashboard
  make down               stop + wipe volumes (destructive)
  make restart            down + up
  make logs               tail api logs
  make demo-logs          tail demo-next logs
  make dashboard-logs     tail dashboard-next logs
  make ps                 list running containers
  make reset-data         truncate ClickHouse event tables (keeps seed)

Seed / tenancy
  make seed               create first org/site/token -> deploy/.seeded.env
  make provision ORG_SLUG=... ORG_NAME=... SITE_NAME=... DOMAINS=...
                          create additional org/site/token -> deploy/tenants/

Go
  make build              go build ./...
  make test               go test ./...
  make test-race          go test -race ./...
  make e2e                HTTP e2e tests (needs running stack + seed)
  make vet tidy fmt

JS
  make js-install         npm install across workspaces
  make js-build           build tracker packages
  make js-test            vitest for @webalytics/tracker
  make js-size            UMD bundle gzip-size gate

Browser
  make browser-install    install Playwright browsers
  make browser-e2e        Playwright suite (needs make up-demo + make seed)

Terraform
  make tf-init            terraform init
  make tf-plan            terraform plan
  make tf-apply           terraform apply (provisions Lightsail + DNS)
  make tf-destroy         terraform destroy
  make tf-output          show outputs (IP, hostname, URLs)

Production ops
  HOST=ubuntu@<ip> make deploy        pull main + restart on the box
  HOST=ubuntu@<ip> make prod-logs     tail the production api logs
  HOST=ubuntu@<ip> make prod-ssh      shell into the box
```

---

## Technology choices

| Layer | Choice | Why |
| --- | --- | --- |
| Service language | **Go 1.22** | Standard library-first HTTP, easy cross-compile, small distroless binary (~15MB), good observability primitives |
| Control plane | **PostgreSQL 16** | Transactional CRUD for orgs/users/tokens, RLS as a second-line isolation check, great ecosystem for migrations and auditing |
| Event plane | **ClickHouse 24.3** | Billions of events cheap to query; MergeTree + LowCardinality + MATERIALIZED VIEWs give sub-second breakdowns on commodity hardware |
| Rate limits | **Redis 7** | Token-bucket counters per IP and per site, also backs the 5-minute realtime visitor counter |
| Reverse proxy | **Caddy 2** | Auto Let's Encrypt via HTTP-01, HSTS + HTTP/3 in one line, JSON-style config that's trivially templated |
| Tracker (core) | **Vanilla TS, no deps** | Bundle-size sensitive; ships as ESM/CJS/UMD with a 4KB gzip budget |
| Tracker (React) | **React 18+** | `"use client"` boundary, plays nice with Next 13/14/15 App & Pages |
| Tracker (Angular) | **Angular 17+ standalone** | `inject()`-based, no NgModule, no `emitDecoratorMetadata` at consumer-build time |
| Dashboard (React) | **React Server Components + inline SVG** | Zero client JS for the dashboard itself, zero charting library dep |
| Dashboard (Angular) | **ng-packagr + standalone components** | Proper Angular Package Format, FESM2022, Ivy partial compilation |
| Infra as code | **Terraform + Lightsail** | Single-box deploy with static IP and simple firewall; cheap ($10-$20/mo), predictable, easy to graduate from later |
| CI/CD | **GitHub Actions** | Already wired; `workflow_run` triggers deploy on green main |

See `docs/ARCHITECTURE.md` §4 for the full database schema and §10 for
the scaling story when a single box stops being enough.

---

## Status and roadmap

**Current status: v0.1 — production-usable for small operators.** One
operator and two customer tenants have been running end-to-end: ingest,
query, and dashboard rendering via both React and Angular surfaces.

Done:

- ✅ Phase 1 — Architecture and data model
- ✅ Phase 2 — Go ingest + query service (`/collect`, `/v1/sites/*`,
  `/v1/stats/*`: realtime, summary, timeseries, breakdown, web-vitals)
- ✅ Phase 3 — NPM tracker packages (core + Next.js + Angular)
- ✅ Phase 4 — Terraform / Lightsail / Caddy deployment + CI/CD
- ✅ Phase 5a — Multi-tenancy provisioning helper
- ✅ Phase 5b — Dashboard components (React RSC + Angular standalone)

Next up:

- Funnel and retention endpoints (schema ready, handlers pending)
- Period-over-period comparison on every `/stats/*` response
- Audience CSV export for ad-platform upload
- Admin UI (CRUD on orgs/sites/domains/tokens)
- Goals and conversion rate on `event_definitions`

Not planned:

- Session replay, heatmaps
- Hosted/shared tier (the product is self-hosted by design)
- Being a 1:1 Google Analytics replacement

---

## License

MIT. See individual package `package.json` files for per-package license
declarations (all MIT).
