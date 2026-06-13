output "release_name" {
  description = "Name of the installed Helm release."
  value       = helm_release.titan.name
}

output "release_namespace" {
  description = "Namespace the release is installed in."
  value       = helm_release.titan.namespace
}

output "release_status" {
  description = "Status of the Helm release (e.g. deployed)."
  value       = helm_release.titan.status
}

output "chart_version" {
  description = "Version of the deployed titan chart."
  value       = helm_release.titan.version
}
