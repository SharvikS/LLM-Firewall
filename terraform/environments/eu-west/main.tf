module "eks_cluster" {
  source = "../../modules/eks-cluster"

  region       = var.region
  cluster_name = var.cluster_name

  cluster_version    = var.cluster_version
  node_instance_type = var.node_instance_type
  node_min_size      = var.node_min_size
  node_max_size      = var.node_max_size
  node_desired_size  = var.node_desired_size

  tags = var.tags
}

module "titan_app" {
  source = "../../modules/titan-app"

  release_name = var.release_name
  namespace    = var.namespace
  region       = var.region

  # Deploy the chart at helm/titan with the eu-west overlay.
  chart_path  = "${path.module}/../../../helm/titan"
  values_file = "${path.module}/../../../helm/titan/regions/eu-west.yaml"

  admin_token      = var.admin_token
  provider_api_key = var.provider_api_key

  # The node group must exist before the chart can schedule pods.
  depends_on = [module.eks_cluster]
}
