# Deploying webalytics to AWS Lightsail

End-to-end guide for standing up a production instance of the stack on a
single Lightsail box. Target profile: ≤ a few thousand visitors/month,
single tenant, one click + one `terraform apply`.

## Architecture on the box

```
                 internet
                    |
                 :80/:443
                    v
    +------------------------------+
    |         Caddy (reverse proxy)|
    |   HTTP-only OR auto-HTTPS    |
    +--+--------------+------------+
       |              |
       |              +--> dashboard-next:3001  (Next.js, server-side)
       +-------------------> api:8080            (/collect, /v1/*)

       api uses:
         - postgres:5432  (internal)
         - clickhouse:9000 (internal)
         - redis:6379    (internal)
```

Databases are **not** bound to the host; they live on the internal
docker network only.

## Prereqs

- AWS account + credentials in env (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or SSO).
- Terraform ≥ 1.6.
- A GitHub repo you can push to (cloud-init pulls from it on first boot).

## 1. Provision

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars      # set git_repo_url at minimum

make -C ../.. tf-init
make -C ../.. tf-apply        # or: terraform apply
```

Typical apply takes ~90s. Cloud-init then spends another 3–5 min
installing Docker, cloning the repo, and starting the stack.

Grab the outputs:

```bash
make -C ../.. tf-output
# dashboard_url = "http://<ip>"
# ingest_url    = "http://<ip>"
# ssh_command   = "ssh -i keys/webalytics_ed25519 ubuntu@<ip>"
```

## 2. First-boot sanity check

```bash
# What cloud-init is doing:
ssh ubuntu@<ip> 'sudo journalctl -u cloud-final -f'

# Once the systemd unit is up:
ssh ubuntu@<ip> 'sudo systemctl status webalytics.service'
curl http://<ip>/healthz    # => "ok"
curl http://<ip>/           # dashboard HTML
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

| Secret                 | Value                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `DEPLOY_SSH_KEY`       | contents of `infra/terraform/keys/webalytics_ed25519`              |
| `DEPLOY_HOST`          | Lightsail static IP                                                |
| `DEPLOY_PUBLIC_URL`    | `http://<ip>` (or `https://domain` once you add one) — optional    |

The `CI` workflow runs on every push + PR. The `Deploy` workflow
triggers after CI passes on `main` (and via manual dispatch), SSHes in,
`git pull`s, and `systemctl restart webalytics.service`. Smoke test
pings `/healthz` before declaring success.

## 4. Adding a domain + HTTPS later

1. Add an A record pointing `analytics.example.com` → the static IP.
2. Edit `terraform.tfvars`: `domain = "analytics.example.com"`, then `terraform apply` (only updates tags/outputs; no instance churn).
3. On the box:

   ```bash
   ssh ubuntu@<ip>
   sudo sed -i 's/^DOMAIN=.*/DOMAIN=analytics.example.com/' /opt/webalytics/.env.prod
   sudo systemctl restart webalytics.service
   ```

Caddy picks up `DOMAIN`, requests a Let's Encrypt cert, and starts
serving HTTPS on port 443 automatically. No code changes needed.

## 5. Pointing your tracker at the box

In whatever site you want tracked:

```js
import { init } from "@webalytics/tracker";

init({
  host: "http://<ip>",       // or https://analytics.example.com
  siteId: "wb_live_...",     // from deploy/.seeded.env
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
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs api
sudo systemctl restart webalytics.service
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

- **Dashboard shows zeros for 1–2 min after first events.** ClickHouse
  materialized views settle asynchronously; the `/realtime` endpoint
  catches up within 60s.
- **`make deploy` hangs on `git reset --hard`.** Someone edited files
  on the box. `ssh` in and `git status` — either commit or wipe. The
  systemd unit always rebuilds from a clean tree.
- **`SESSION_SALT_BASE` rotation invalidates all previous session ids.**
  Same-user activity across the rotation will look like two separate
  visitors. Only rotate if you're certain you want that.
