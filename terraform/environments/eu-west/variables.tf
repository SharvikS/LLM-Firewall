variable "region" {
  description = "AWS region (also used as the titan region tag)."
  type        = string
  default     = "eu-west-1"
}

variable "cluster_name" {
  description = "Name of the EKS cluster."
  type        = string
  default     = "titan-eu-west"
}

variable "cluster_version" {
  description = "Kubernetes control-plane version."
  type        = string
  default     = "1.30"
}

variable "node_instance_type" {
  description = "EC2 instance type for the managed node group."
  type        = string
  default     = "m5.large"
}

variable "node_min_size" {
  description = "Minimum number of worker nodes."
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "Maximum number of worker nodes."
  type        = number
  default     = 6
}

variable "node_desired_size" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 3
}

variable "release_name" {
  description = "Helm release name for this region."
  type        = string
  default     = "titan-eu"
}

variable "namespace" {
  description = "Kubernetes namespace to install the release into."
  type        = string
  default     = "titan"
}

variable "admin_token" {
  description = "Gateway admin token (prefer TF_VAR_admin_token or a secret manager)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "provider_api_key" {
  description = "Upstream LLM provider API key (prefer TF_VAR_provider_api_key)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "tags" {
  description = "Additional tags applied to all resources."
  type        = map(string)
  default     = {}
}
