# SSH key handling.
#
# - If var.ssh_public_key is set we just use it.
# - Otherwise we generate an ed25519 pair locally and write both halves
#   under infra/terraform/keys/ (gitignored) so you can SSH in.
#
# Either way, the resulting public key is imported into Lightsail and
# baked into cloud-init as the admin authorized_key for the `ubuntu` user.

locals {
  generated_key = var.ssh_public_key == ""
  public_key    = local.generated_key ? tls_private_key.admin[0].public_key_openssh : var.ssh_public_key
}

resource "tls_private_key" "admin" {
  count     = local.generated_key ? 1 : 0
  algorithm = "ED25519"
}

resource "local_sensitive_file" "private_key" {
  count           = local.generated_key ? 1 : 0
  content         = tls_private_key.admin[0].private_key_openssh
  filename        = "${path.module}/keys/${var.project}_ed25519"
  file_permission = "0600"
}

resource "local_file" "public_key" {
  count           = local.generated_key ? 1 : 0
  content         = tls_private_key.admin[0].public_key_openssh
  filename        = "${path.module}/keys/${var.project}_ed25519.pub"
  file_permission = "0644"
}

resource "aws_lightsail_key_pair" "admin" {
  name       = "${var.project}-admin"
  public_key = local.public_key
}
