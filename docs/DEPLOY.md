# Deploying webalytics to AWS Lightsail

End-to-end guide for standing up a production instance of the stack on a
single Lightsail box, with **real HTTPS out of the box** via Caddy +
Let's Encrypt. Target profile: ≤ a few thousand visitors/month, single
tenant, one click + one `terraform apply`.

## Architecture on the box

```
                     internet
                        |
                    :80 (redirect -> 443)
                    :443  (auto Let's Encrypt)
                        v
        +------------------------------+
        |         Caddy                |
        |   auto-HTTPS + HSTS          |
        +--+--------------+------------+
           |              |
           |              +--> dashboard-next:3001  (Next.js, server-side)
           +-------------------> api:8080            (/collect, /v1/*)

           api uses:
             - postgres:5432   (internal only)
             - clickhouse:9000 (internal only)
             - redis:6379      (internal only)
```

Databases are **not** bound to the host; they live on the internal
docker network only.

## Hostname strategy

HTTPS requires a hostname Let's Encrypt can validate. Two options:

1. **No DNS setup (default)** — Terraform outputs `<static_ip>.nip.io`.
   nip.io/sslip.io resolve `A.B.C.D.nip.io` → `A.B.C.D` for anyone, so
   LE treats it like a real domain and issues a trusted cert. This works
   today, no registrar, no DNS records.
2. **Bring your own domain** — set `domain = "analytics.example.com"` in
   tfvars, point an A record at `public_ip`, done. You can start on
   nip.io and swap later with one command.

## Prereqs

- AWS account + credentials in env (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or SSO).
- Terraform ≥ 1.6.
- A GitHub repo you can push to (cloud-init pulls from it on first boot).

## 1. Provision

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars          # set git_repo_url; acme_email recommended

make -C ../.. tf-init
make -C ../.. tf-apply
```

Typical apply takes ~90s. Cloud-init then spends another 3–5 min
installing Docker, cloning the repo, and starting the stack. Caddy
needs another ~30s after the api is reachable to complete the ACME
HTTP-01 challenge.

Grab the outputs:

```bash
make -C ../.. tf-output
# dashboard_url = "https://<ip>.nip.io"
# domain        = "<ip>.nip.io"
# ingest_url    = "https://<ip>.nip.io"
# public_ip     = "..."
# ssh_command   = "ssh -i keys/webalytics_ed25519 ubuntu@<ip>"
```

## 2. First-boot sanity check

```bash
# What cloud-init is doing:
ssh ubuntu@<ip> 'sudo journalctl -u cloud-final -f'

# Once the systemd unit is up:
ssh ubuntu@<ip> 'sudo systemctl status webalytics.service'

# Redirect to HTTPS:
curl -I http://<ip>.nip.io/healthz      # => 308 -> https://...

# Real cert + ok:
curl https://<ip>.nip.io/healthz         # => "ok"
curl https://<ip>.nip.io/                # => dashboard HTML
```

The seed script writes `/opt/webalytics/deploy/.seeded.env` on first
boot. That file contains the bearer token + site id you'll use to
point your tracker at this instance:

```bash
ssh ubuntu@<ip> 'cat /opt/webalytics/deploy/.seeded.env'
# WEBALYTICS_HOST=...
# WEBALYTICS_SITE_ID=wb_live_...
# WEBALYTICS_TOKEN=wb_pat_live_...
```

## 3. Wire up CI/CD

In GitHub → Settings → Environments → **production** (new), add:

| Secret               | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| `DEPLOY_SSH_KEY`     | contents of `infra/terraform/keys/webalytics_ed25519`     |
| `DEPLOY_HOST`        | Lightsail static IP                                       |
| `DEPLOY_PUBLIC_URL`  | `https://<ip>.nip.io` (or your own domain) — optional     |

The `CI` workflow runs on every push + PR. The `Deploy` workflow
triggers after CI passes on `main` (and via manual dispatch), SSHes in,
`git pull`s, and `systemctl restart webalytics.service`. Smoke test
pings `/healthz` before declaring success.

## 4. Swapping to your own domain later

1. Add an A record: `analytics.example.com` → static IP.
2. SSH in and flip the env:

   ```bash
   ssh ubuntu@<ip>
   sudo sed -i 's/^DOMAIN=.*/DOMAIN=analytics.example.com/' /opt/webalytics/.env.prod
   sudo systemctl restart webalytics.service
   ```

Caddy requests a fresh Let's Encrypt cert for the new hostname on the
next restart. Old nip.io cert keeps working for its 90 days; LE renewal
stops refreshing it, so you can ignore it. No Terraform recreate needed.

(Optional: also set `domain = "analytics.example.com"` in tfvars to
update `terraform output`.)

## 5. Pointing your tracker at the box

In whatever site you want tracked:

```js
import { init } from "@webalytics/tracker";

init({
  host: "https://<ip>.nip.io",    // or https://analytics.example.com
  siteId: "wb_live_...",           // from deploy/.seeded.env
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

## 6. Operational cheat sheet

```bash
HOST=ubuntu@<ip>

make prod-ssh  HOST=$HOST        # ssh in
make prod-logs HOST=$HOST        # tail all containers
make deploy    HOST=$HOST        # manual redeploy (CI normally does this)

# Inside the box:
cd /opt/webalytics
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs api caddy
sudo systemctl restart webalytics.service

# Caddy cert state:
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml exec caddy \
  ls -la /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/
```

## 7. Cost summary (us-east-1, as of 2026-04)

| Resource                | Monthly  |
| ----------------------- | -------- |
| Lightsail small_3_0     | $12.00   |
| Static IP (attached)    | free     |
| Auto-snapshots (~60 GB) | ~$3      |
| Data transfer (2 TB)    | included |
| **Total**               | **~$15** |

Snapshots are the only knob if you want to shave a couple of dollars;
set `snapshot_retention_days = 3` in tfvars.

## 8. Common gotchas

- **First HTTPS request 502s for ~30s.** Caddy is mid-ACME challenge.
  It'll clear on its own; nothing to do.
- **Dashboard shows zeros for 1–2 min after first events.** ClickHouse
  materialized views settle asynchronously; the `/realtime` endpoint
  catches up within 60s.
- **`make deploy` hangs on `git reset --hard`.** Someone edited files
  on the box. `ssh` in and `git status` — either commit or wipe. The
  systemd unit always rebuilds from a clean tree.
- **`SESSION_SALT_BASE` rotation invalidates all previous session ids.**
  Same-user activity across the rotation will look like two separate
  visitors. Only rotate if you're certain you want that.
- **LE rate limits.** If you `docker compose down -v` repeatedly during
  the same week you may hit the 5-duplicate-certs-per-week limit.
  Caddy keeps certs in the `caddy_data` volume; preserve it across
  restarts.
