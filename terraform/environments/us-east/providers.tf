provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "titan-gateway"
      Environment = "us-east"
      ManagedBy   = "terraform"
    }
  }
}

# Auth for the cluster created by the eks-cluster module. depends_on defers the
# reads to apply time so the cluster exists before the kubernetes/helm
# providers are configured against it.
data "aws_eks_cluster" "this" {
  name       = module.eks_cluster.cluster_name
  depends_on = [module.eks_cluster]
}

data "aws_eks_cluster_auth" "this" {
  name       = module.eks_cluster.cluster_name
  depends_on = [module.eks_cluster]
}

provider "kubernetes" {
  host                   = data.aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

provider "helm" {
  kubernetes {
    host                   = data.aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(data.aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}
