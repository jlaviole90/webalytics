# infra/terraform

Provisions the Lightsail box that runs webalytics, with real HTTPS out
of the box.

## What it creates

- `aws_lightsail_static_ip` — public IP that survives instance rebuilds
- `aws_lightsail_instance` — Ubuntu 22.04, `small_3_0` (2 GB / 2 vCPU / 60 GB SSD, ~$12/mo)
- `aws_lightsail_instance_public_ports` — 22 (configurable CIDR) + 80/443 TCP + 443 UDP for HTTP/3
- `aws_lightsail_key_pair` — admin SSH key (generated if you don't supply one)
- Auto-snapshots at 06:00 UTC daily
- Cloud-init bootstrap that:
  - installs Docker + compose
  - clones this repo
  - generates prod secrets on first boot (`/opt/webalytics/.env.prod`)
  - bakes `DOMAIN=<public_ip>.nip.io` (or your custom domain) into the env
  - starts the stack via a `webalytics.service` systemd unit
  - seeds a default site + token

Caddy then provisions a real Let's Encrypt cert for that domain the
first time traffic arrives (retries automatically until it succeeds).

## One-time setup

```bash
cd infra/terraform

# Fill in at least git_repo_url. acme_email is recommended.
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

# AWS creds from env or ~/.aws/credentials.
terraform init
terraform apply
```

At the end you'll get:

```
dashboard_url = "https://<ip>.nip.io"
domain        = "<ip>.nip.io"
ingest_url    = "https://<ip>.nip.io"
public_ip     = "..."
ssh_command   = "ssh -i keys/webalytics_ed25519 ubuntu@<ip>"
```

Cloud-init takes ~3–5 min. The first HTTPS hit can take an additional
~30s while Caddy completes the ACME HTTP-01 challenge.

## First-boot gotchas

- The dashboard won't show anything until the seed script runs (it
  creates the demo site + token). Watch for `/opt/webalytics/deploy/.seeded.env`.
- Tracker SDKs should be configured with the output `ingest_url` + the
  seeded `wb_live_...` site ID:

  ```bash
  ssh ubuntu@<ip> 'cat /opt/webalytics/deploy/.seeded.env'
  ```

## Swapping to your own domain later

1. Point an A record at `public_ip`.
2. SSH in and edit `/opt/webalytics/.env.prod`:

   ```bash
   ssh ubuntu@<ip>
   sudo sed -i 's/^DOMAIN=.*/DOMAIN=analytics.example.com/' /opt/webalytics/.env.prod
   sudo systemctl restart webalytics.service
   ```

3. Caddy automatically requests a new Let's Encrypt cert for the new
   hostname on the next restart. No Terraform change required.

   (Optional: also set `domain = "analytics.example.com"` in tfvars so
   `terraform output` reports the real URL.)

## Tearing it down

```bash
terraform destroy
```

Snapshots are retained separately; delete them from the Lightsail console if you really want zero trace.
