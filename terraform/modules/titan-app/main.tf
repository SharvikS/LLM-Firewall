resource "helm_release" "titan" {
  name             = var.release_name
  namespace        = var.namespace
  create_namespace = true

  # Local chart at helm/titan (path resolved by the caller relative to the
  # root module).
  chart = var.chart_path

  # Per-region overlay from helm/titan/regions/*.yaml.
  values = [file(var.values_file)]

  # Keep the region tag in sync with the deploying environment even if the
  # overlay drifts; the gateway exports this into audit events and Cedar.
  set {
    name  = "region"
    value = var.region
  }

  # Inject secrets out of band when provided, rather than baking them into the
  # values overlay committed to git.
  dynamic "set_sensitive" {
    for_each = var.admin_token != "" ? [var.admin_token] : []
    content {
      name  = "secrets.adminToken"
      value = set_sensitive.value
    }
  }

  dynamic "set_sensitive" {
    for_each = var.provider_api_key != "" ? [var.provider_api_key] : []
    content {
      name  = "secrets.providerAPIKey"
      value = set_sensitive.value
    }
  }

  wait    = true
  atomic  = var.atomic
  timeout = var.chart_timeout
}
