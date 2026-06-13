variable "release_name" {
  description = "Helm release name. Becomes the chart fullname / resource prefix (e.g. titan-us)."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace to install the release into."
  type        = string
  default     = "titan"
}

variable "region" {
  description = "Region tag stamped on pods and exported to the gateway (audit events + Cedar context)."
  type        = string
}

variable "chart_path" {
  description = "Path to the titan Helm chart directory."
  type        = string
  default     = "../../../helm/titan"
}

variable "values_file" {
  description = "Path to the per-region Helm values overlay (e.g. helm/titan/regions/us-east.yaml)."
  type        = string
}

variable "admin_token" {
  description = "Gateway admin token. Overrides the chart default when non-empty."
  type        = string
  default     = ""
  sensitive   = true
}

variable "provider_api_key" {
  description = "Upstream LLM provider API key. Overrides the chart default when non-empty."
  type        = string
  default     = ""
  sensitive   = true
}

variable "chart_timeout" {
  description = "Seconds to wait for the release's resources to become ready."
  type        = number
  default     = 600
}

variable "atomic" {
  description = "Roll the release back automatically if the install/upgrade fails."
  type        = bool
  default     = true
}
