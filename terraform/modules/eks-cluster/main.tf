data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Spread the cluster across the first three AZs in the region.
  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  tags = merge(
    {
      terraform = "true"
      project   = "titan-gateway"
      cluster   = var.cluster_name
    },
    var.tags
  )
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.cluster_name}-vpc"
  cidr = var.vpc_cidr

  azs             = local.azs
  private_subnets = [for k, az in local.azs : cidrsubnet(var.vpc_cidr, 4, k)]
  public_subnets  = [for k, az in local.azs : cidrsubnet(var.vpc_cidr, 4, k + 8)]

  enable_nat_gateway   = true
  single_nat_gateway   = true
  enable_dns_hostnames = true

  # Subnet tags required for the AWS load balancer controller to discover
  # subnets for public / internal ELB placement.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = local.tags
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  # Public API endpoint so terraform (and kubectl/helm) can reach the cluster
  # from outside the VPC. Restrict cluster_endpoint_public_access_cidrs in
  # production.
  cluster_endpoint_public_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  # Grant the identity running terraform admin access via an EKS access entry
  # so the kubernetes/helm providers can authenticate immediately after create.
  enable_cluster_creator_admin_permissions = true

  eks_managed_node_group_defaults = {
    instance_types = [var.node_instance_type]
  }

  eks_managed_node_groups = {
    default = {
      instance_types = [var.node_instance_type]
      capacity_type  = var.capacity_type

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size
    }
  }

  tags = local.tags
}
