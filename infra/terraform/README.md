# infra/terraform

Provisions the Lightsail box that runs webalytics.

## What it creates

- `aws_lightsail_instance` — Ubuntu 22.04, `small_3_0` (2 GB / 2 vCPU / 60 GB SSD, ~$12/mo)
- `aws_lightsail_static_ip` + attachment — so the public IP survives restarts
- `aws_lightsail_instance_public_ports` — 22 (configurable CIDR) + 80/443 TCP + 443 UDP for HTTP/3
- `aws_lightsail_key_pair` — admin SSH key (generated if you don't supply one)
- Auto-snapshots at 06:00 UTC daily
- Cloud-init bootstrap that:
  - installs Docker + compose
  - clones this repo
  - generates prod secrets on first boot (`/opt/webalytics/.env.prod`)
  - starts the stack via a `webalytics.service` systemd unit
  - seeds a default site + token

## One-time setup

```bash
cd infra/terraform

# Fill in at least git_repo_url.
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# AWS creds from env or ~/.aws/credentials.
terraform init
terraform apply
```

At the end you'll get:

```
dashboard_url = "http://<ip>"
ingest_url    = "http://<ip>"
public_ip     = "..."
ssh_command   = "ssh -i keys/webalytics_ed25519 ubuntu@<ip>"
```

Cloud-init takes ~3-5 min; SSH in and `sudo journalctl -u cloud-final -f` if you want to watch.

## First-boot gotchas

- Dashboard won't show anything until the seed script runs (it creates the demo site + token). Watch `/opt/webalytics/deploy/.seeded.env` appear.
- Tracker SDKs should be configured with the output `ingest_url` + the seeded `wb_live_...` site ID. Grab it with:

  ```bash
  ssh ubuntu@<ip> 'cat /opt/webalytics/deploy/.seeded.env'
  ```

## Adding a domain later

1. Point an A record at `public_ip`.
2. Set `domain = "analytics.example.com"` in `terraform.tfvars`, run `terraform apply`. Cloud-init won't rerun, so:
3. SSH in and `sudo sed -i 's/^DOMAIN=.*/DOMAIN=analytics.example.com/' /opt/webalytics/.env.prod && sudo systemctl restart webalytics`.

Caddy picks up the new `DOMAIN` env and provisions a Let's Encrypt cert automatically.

## Tearing it down

```bash
terraform destroy
```

Snapshots are retained separately; delete them from the Lightsail console if you really want zero trace.
