output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks_cluster.cluster_name
}

output "cluster_endpoint" {
  description = "EKS Kubernetes API endpoint."
  value       = module.eks_cluster.cluster_endpoint
}

output "kubeconfig_command" {
  description = "Run this to point kubectl/helm at the cluster."
  value       = module.eks_cluster.kubeconfig_command
}

output "oidc_provider_arn" {
  description = "IAM OIDC provider ARN for IRSA."
  value       = module.eks_cluster.oidc_provider_arn
}

output "helm_release_name" {
  description = "Installed titan Helm release name."
  value       = module.titan_app.release_name
}

output "helm_release_status" {
  description = "Status of the titan Helm release."
  value       = module.titan_app.release_status
}
