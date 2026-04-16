# Deploying webalytics to AWS Lightsail

End-to-end guide for standing up a production instance of the stack on a
single Lightsail box, with **real HTTPS out of the box** via Caddy +
Let's Encrypt. Target profile: ≤ a few thousand visitors/month, single
tenant, one click + one `terraform apply`.

## Architecture

The box is **API-only** — ingest + query service behind HTTPS. No UI.
Dashboards are UI-over-API and can run wherever (your laptop for now,
bundled helpers in the tracker package later, or any host you like).

```
                     internet
                        |
                    :80 (redirect -> 443)
                    :443  (auto Let's Encrypt)
                        v
        +------------------------------+
        |           Caddy              |
        |   auto-HTTPS + HSTS          |
        +--------------+---------------+
                       |
                   api:8080
                  (Go service)
                       |
          +------------+------------+
          |            |            |
    postgres:5432   clickhouse:9000   redis:6379
       (all internal only — never exposed)
```

Public endpoints:

| Path             | Purpose                                         |
| ---------------- | ----------------------------------------------- |
| `/collect`       | Tracker SDK POSTs events here                   |
| `/v1/*`          | Authenticated query API (bearer token)          |
| `/healthz`       | Health probe                                    |
| anything else    | returns a small JSON "what is this" 404         |

## Hostname strategy

HTTPS requires a hostname Let's Encrypt can validate. Two options:

1. **No DNS setup (default)** — Terraform outputs `<static_ip>.nip.io`.
   nip.io resolves `A.B.C.D.nip.io` → `A.B.C.D`, so LE treats it like a
   real domain and issues a trusted cert. Works today, no registrar.
2. **Bring your own domain** — set `domain = "analytics.example.com"` in
   tfvars, point an A record at `public_ip`, done. Start on nip.io and
   swap later with a one-liner on the box.

## Prereqs

- AWS account + credentials (`AmazonLightsailFullAccess` on the IAM user).
- OpenTofu or Terraform ≥ 1.6 (`brew install opentofu` works).
- A GitHub repo accessible to the box (public, or later via deploy key).

## 1. Provision

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars          # set git_repo_url; acme_email recommended

make -C ../.. tf-init
make -C ../.. tf-apply
```

Typical apply: ~90s. Cloud-init then spends ~3–5 min installing Docker,
cloning the repo, and starting the stack. Caddy needs another ~30s to
complete the ACME HTTP-01 challenge on first hit.

Grab the outputs:

```bash
make -C ../.. tf-output
# domain        = "<ip>.nip.io"
# ingest_url    = "https://<ip>.nip.io"
# public_ip     = "..."
# ssh_command   = "ssh -i keys/webalytics_ed25519 ubuntu@<ip>"
```

## 2. First-boot sanity check

```bash
# Watch cloud-init:
ssh -i infra/terraform/keys/webalytics_ed25519 ubuntu@<ip> \
  'sudo journalctl -u cloud-final -f'

# Once the systemd unit is up:
ssh -i infra/terraform/keys/webalytics_ed25519 ubuntu@<ip> \
  'sudo systemctl status webalytics.service'

# Verify HTTPS + health:
curl -I  http://<ip>.nip.io/healthz     # => 308 -> https://...
curl     https://<ip>.nip.io/healthz    # => "ok"
curl     https://<ip>.nip.io/           # => service JSON + 404
```

## 3. Seeded credentials

On first boot the stack seeds a site + bearer token, writing them to
`/opt/webalytics/deploy/.seeded.env`:

```bash
ssh ubuntu@<ip> 'cat /opt/webalytics/deploy/.seeded.env'
# WEBALYTICS_HOST=https://<ip>.nip.io
# WEBALYTICS_SITE_ID=wb_live_...       <- public id, paste into tracker
# WEBALYTICS_TOKEN=wb_pat_live_...     <- server-side bearer; keep secret
```

### 3a. Provisioning additional tenants (multiple clients)

The seed script creates one organization and one site. To host more
customers — or to add your own personal site alongside a client's —
use the `provision-site.sh` helper. Each tenant gets its own
organization, site, domains, and bearer token. Token scopes are
per-organization, so one tenant cannot ever query another's data.

```bash
ssh ubuntu@<ip>
cd /opt/webalytics
set -a && source .env.prod && set +a
ORG_SLUG=acme ORG_NAME="Acme Corp" \
  SITE_NAME="Acme Marketing" DOMAINS="acme.com,www.acme.com" \
  bash deploy/provision-site.sh
```

Or from your laptop against a local stack:

```bash
make provision ORG_SLUG=personal ORG_NAME="My Name" \
  SITE_NAME="Personal Site" DOMAINS="example.com"
```

The script prints the credentials and also writes them to
`deploy/tenants/<org_slug>.env` (mode 0600). Running it again with the
same `ORG_SLUG` + `SITE_NAME` rotates the token but keeps the org/site
stable, so the install instructions you've already shared stay valid.

Isolation guarantees:

- Tokens are tied to a single organization. A token issued for
  org A cannot read org B's data — the `/v1` middleware rejects any
  request whose resolved site is not owned by the token's org.
- Postgres RLS is scoped by `organization_id`, so direct DB reads
  through the app roles can only see their own rows.
- ClickHouse queries are keyed by `site_uuid`; the API layer always
  resolves the site against the token's organization before issuing
  the query.

## 4. Wire up CI/CD

In GitHub → Settings → Environments → **production** (new), add:

| Secret               | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | contents of `infra/terraform/keys/webalytics_ed25519`     |
| `DEPLOY_HOST`        | Lightsail static IP                                       |
| `DEPLOY_PUBLIC_URL`  | `https://<ip>.nip.io` (or custom domain) — optional       |

The `CI` workflow runs on every push + PR. The `Deploy` workflow
triggers after CI passes on `main` (or manual dispatch), SSHes in,
`git pull`s, and restarts `webalytics.service`. Smoke test pings
`/healthz` before declaring the deploy green.

## 5. Pointing a tracker at the box

Any site you want tracked installs `@webalytics/tracker`:

```js
import { init } from "@webalytics/tracker";

init({
  host: "https://<ip>.nip.io",      // or https://analytics.example.com
  siteId: "wb_live_...",             // from deploy/.seeded.env
});
```

Next.js:

```tsx
// app/layout.tsx
import { Webalytics } from "@webalytics/tracker-next";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Webalytics
          host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST!}
          siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID!}
        />
        {children}
      </body>
    </html>
  );
}
```

## 6. Viewing the data

The AWS box doesn't host a UI. A few options, ordered by friction:

- **Local dashboard** (good for now):

  ```bash
  # On your laptop, inside this repo:
  cd apps/dashboard-next
  WEBALYTICS_API_HOST=https://<ip>.nip.io \
    WEBALYTICS_API_TOKEN=wb_pat_live_... \
    WEBALYTICS_SITE_UUID=<uuid-from-seeded-env> \
    npm run dev
  # http://localhost:3001
  ```

- **Curl** — quick spot checks:

  ```bash
  curl -H "Authorization: Bearer $WEBALYTICS_TOKEN" \
    "https://<ip>.nip.io/v1/stats/realtime?site_id=<uuid>"
  ```

- **Deploy `apps/dashboard-next` to Vercel** whenever you want an
  always-on admin UI. It's a standard Next.js app; point its env vars
  at the public API and you're done. No coupling to the service box.

- **Coming later**: an optional `@webalytics/dashboard` package with
  turnkey widgets/React components you can drop into your own site.

## 7. Swapping to your own domain later

1. Add an A record: `analytics.example.com` → static IP.
2. On the box:

   ```bash
   ssh ubuntu@<ip>
   sudo sed -i 's/^DOMAIN=.*/DOMAIN=analytics.example.com/' /opt/webalytics/.env.prod
   sudo systemctl restart webalytics.service
   ```

Caddy requests a fresh Let's Encrypt cert for the new hostname on the
next restart. No Terraform changes required.

## 8. Operational cheat sheet

```bash
HOST=ubuntu@<ip>

make prod-ssh  HOST=$HOST        # ssh in
make prod-logs HOST=$HOST        # tail all containers
make deploy    HOST=$HOST        # manual redeploy (CI normally does this)

# On the box:
cd /opt/webalytics
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml --profile prod ps
sudo docker compose --env-file .env.prod \
  -f docker-compose.yml -f docker-compose.prod.yml --profile prod logs api caddy
sudo systemctl restart webalytics.service
```

## 9. Cost summary (us-east-1, as of 2026-04)

| Resource                | Monthly  |
| ----------------------- | -------- |
| Lightsail small_3_0     | $12.00   |
| Static IP (attached)    | free     |
| Auto-snapshots (~60 GB) | ~$3      |
| Data transfer (2 TB)    | included |
| **Total**               | **~$15** |

## 10. Common gotchas

- **First HTTPS request 502s for ~30s.** Caddy is mid-ACME challenge.
  It'll clear on its own.
- **Tracker data lags 1–2 min after first events.** ClickHouse
  materialized views settle asynchronously.
- **`make deploy` hangs on `git reset --hard`.** Someone edited files
  on the box. SSH in and check `git status` — the systemd unit always
  rebuilds from a clean tree.
- **`SESSION_SALT_BASE` rotation invalidates all previous session ids.**
  Same-user activity across the rotation looks like two visitors. Only
  rotate if you're certain you want that.
- **LE rate limits.** If you `docker compose down -v` repeatedly during
  the same week you may hit the 5-duplicate-certs/week limit. Caddy
  keeps certs in the `caddy_data` volume; preserve it across restarts.
