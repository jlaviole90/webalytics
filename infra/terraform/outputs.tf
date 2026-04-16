output "public_ip" {
  description = "Static IP attached to the instance. Point DNS here, or just curl it."
  value       = aws_lightsail_static_ip.api.ip_address
}

output "ssh_command" {
  description = "Copy-paste SSH one-liner."
  value = local.generated_key ? (
    "ssh -i ${path.module}/keys/${var.project}_ed25519 ubuntu@${aws_lightsail_static_ip.api.ip_address}"
    ) : (
    "ssh ubuntu@${aws_lightsail_static_ip.api.ip_address}"
  )
}

output "dashboard_url" {
  description = "Where the dashboard will be reachable once cloud-init finishes."
  value       = var.domain == "" ? "http://${aws_lightsail_static_ip.api.ip_address}" : "https://${var.domain}"
}

output "ingest_url" {
  description = "URL the tracker SDK should POST to (set NEXT_PUBLIC_WEBALYTICS_HOST / init({ host })) to this."
  value       = var.domain == "" ? "http://${aws_lightsail_static_ip.api.ip_address}" : "https://${var.domain}"
}
