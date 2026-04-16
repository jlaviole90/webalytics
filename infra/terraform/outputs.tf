output "public_ip" {
  description = "Static IP attached to the instance. Point DNS at this if you bring your own domain."
  value       = aws_lightsail_static_ip.api.ip_address
}

output "domain" {
  description = "Hostname Caddy serves under. Defaults to <ip>.nip.io if no custom domain was provided."
  value       = local.effective_domain
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
  description = "Where the dashboard will be reachable once cloud-init finishes + Caddy provisions the cert."
  value       = "https://${local.effective_domain}"
}

output "ingest_url" {
  description = "URL tracker SDKs should POST to (set as NEXT_PUBLIC_WEBALYTICS_HOST or tracker init({ host })) to this."
  value       = "https://${local.effective_domain}"
}
