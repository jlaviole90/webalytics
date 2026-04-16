locals {
  # If you don't bring your own domain we fall back to nip.io, which
  # resolves <ip>.nip.io -> <ip> for free and lets Caddy get a real
  # Let's Encrypt certificate without any DNS setup on your side.
  effective_domain = var.domain != "" ? var.domain : "${aws_lightsail_static_ip.api.ip_address}.nip.io"

  user_data = templatefile("${path.module}/cloud-init.sh.tpl", {
    project      = var.project
    git_repo_url = var.git_repo_url
    git_branch   = var.git_branch
    domain       = local.effective_domain
    acme_email   = var.acme_email
  })
}

# Allocate the static IP FIRST, so we know its value before the instance
# boots. That lets cloud-init bake the correct DOMAIN into the env file
# on first boot instead of racing to detect it.
resource "aws_lightsail_static_ip" "api" {
  name = "${var.project}-api-ip"
}

resource "aws_lightsail_instance" "api" {
  name              = "${var.project}-api"
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  key_pair_name     = aws_lightsail_key_pair.admin.name
  user_data         = local.user_data

  add_on {
    type          = "AutoSnapshot"
    snapshot_time = "06:00"
    status        = "Enabled"
  }

  tags = {
    project = var.project
    role    = "api"
  }

  # Force the instance to be recreated if the static IP changes, so the
  # baked-in domain in cloud-init stays consistent with the attached IP.
  lifecycle {
    replace_triggered_by = [aws_lightsail_static_ip.api.ip_address]
  }
}

resource "aws_lightsail_static_ip_attachment" "api" {
  static_ip_name = aws_lightsail_static_ip.api.name
  instance_name  = aws_lightsail_instance.api.name
}

# Lightsail firewall. SSH is locked down to var.allow_ssh_from_cidr;
# 80/443 stay open to the world so Caddy can answer HTTP-01 challenges
# and serve the dashboard + ingest endpoints. Instance-level ufw rules
# are redundant belt+braces.
resource "aws_lightsail_instance_public_ports" "api" {
  instance_name = aws_lightsail_instance.api.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = [var.allow_ssh_from_cidr]
  }

  # Required open for ACME HTTP-01; Caddy also permanent-redirects to 443.
  port_info {
    protocol  = "tcp"
    from_port = 80
    to_port   = 80
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "tcp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }

  port_info {
    protocol  = "udp"
    from_port = 443
    to_port   = 443
    cidrs     = ["0.0.0.0/0"]
  }
}
