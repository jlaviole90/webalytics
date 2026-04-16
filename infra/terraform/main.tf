locals {
  user_data = templatefile("${path.module}/cloud-init.sh.tpl", {
    project      = var.project
    git_repo_url = var.git_repo_url
    git_branch   = var.git_branch
    domain       = var.domain
  })
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
}

# Lightsail firewall. SSH is locked down to var.allow_ssh_from_cidr;
# 80/443 stay open to the world so the ingest API + dashboard are
# reachable. The instance-level ufw rules are redundant belt+braces.
resource "aws_lightsail_instance_public_ports" "api" {
  instance_name = aws_lightsail_instance.api.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = [var.allow_ssh_from_cidr]
  }

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

resource "aws_lightsail_static_ip" "api" {
  name = "${var.project}-api-ip"
}

resource "aws_lightsail_static_ip_attachment" "api" {
  static_ip_name = aws_lightsail_static_ip.api.name
  instance_name  = aws_lightsail_instance.api.name
}
