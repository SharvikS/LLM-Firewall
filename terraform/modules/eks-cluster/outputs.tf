output "region" {
  description = "AWS region the cluster runs in."
  value       = var.region
}

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Endpoint URL for the EKS Kubernetes API server."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded certificate-authority data for the cluster."
  value       = module.eks.cluster_certificate_authority_data
}

output "cluster_security_group_id" {
  description = "Security group ID attached to the EKS control plane."
  value       = module.eks.cluster_security_group_id
}

output "oidc_provider" {
  description = "OIDC provider URL (issuer without https:// scheme) for IRSA."
  value       = module.eks.oidc_provider
}

output "oidc_provider_arn" {
  description = "ARN of the IAM OIDC provider for IRSA (workload identity)."
  value       = module.eks.oidc_provider_arn
}

output "kubeconfig_command" {
  description = "awscli command to update the local kubeconfig for kubectl/helm."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}

output "vpc_id" {
  description = "ID of the VPC the cluster was created in."
  value       = module.vpc.vpc_id
}
