variable "project" {
  description = "Resource name prefix; keeps multiple envs (staging/prod) from colliding."
  type        = string
  default     = "webalytics"
}

variable "aws_region" {
  description = "AWS region. Lightsail is regional."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "Lightsail AZ inside the region. Stick with a, b, or c."
  type        = string
  default     = "us-east-1a"
}

variable "bundle_id" {
  description = <<EOT
Lightsail plan. Current picks:
  micro_3_0   = 1 GB RAM / 2 vCPU / 40 GB SSD    / $7/mo  (too small for CH)
  small_3_0   = 2 GB RAM / 2 vCPU / 60 GB SSD    / $12/mo (recommended)
  medium_3_0  = 4 GB RAM / 2 vCPU / 80 GB SSD    / $24/mo
EOT
  type        = string
  default     = "small_3_0"
}

variable "blueprint_id" {
  description = "OS image. Ubuntu 22.04 LTS is the sanity default."
  type        = string
  default     = "ubuntu_22_04"
}

variable "allow_ssh_from_cidr" {
  description = <<EOT
Source CIDR allowed to SSH in. Keep this tight in practice
(your office IP / VPN). Default 0.0.0.0/0 is convenient but
not strictly necessary once GitHub Actions is deploying.
EOT
  type        = string
  default     = "0.0.0.0/0"
}

variable "ssh_public_key" {
  description = <<EOT
Public key content (ssh-ed25519 ...) of the admin key that should
have root-equivalent access to the instance. A matching private key
must live on your laptop and as a GitHub Actions secret.

Leave empty and Terraform will generate a fresh ed25519 keypair and
write both halves to infra/terraform/keys/ (gitignored).
EOT
  type        = string
  default     = ""
}

variable "git_repo_url" {
  description = "HTTPS URL of the repo the instance should pull from on boot."
  type        = string
}

variable "git_branch" {
  description = "Branch to track. Deploys always fast-forward to the head of this branch."
  type        = string
  default     = "main"
}

variable "domain" {
  description = <<EOT
Hostname the deploy should serve. Empty string = serve on the bare
IP over plain HTTP. Setting this (e.g. analytics.example.com) flips
Caddy into auto-Let's-Encrypt mode on the next redeploy; you still
have to point DNS at the static IP output by Terraform yourself.
EOT
  type        = string
  default     = ""
}

variable "snapshot_retention_days" {
  description = "How many automatic Lightsail snapshots to keep."
  type        = number
  default     = 7
}
