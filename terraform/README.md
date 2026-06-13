# TITAN Gateway — Terraform (AWS EKS)

Provisions a managed Kubernetes cluster (Amazon EKS) per region and deploys the
existing `helm/titan` chart onto it with the matching region overlay. This
closes the gap noted in `PROJECT_STATUS.md` ("Terraform for cluster
provisioning remains out of scope").

Each environment is a self-contained root module that wires two reusable
modules together:

```
terraform/
├── modules/
│   ├── eks-cluster/     # VPC + EKS cluster + managed node group + outputs
│   └── titan-app/       # helm_release for helm/titan with a region overlay
└── environments/
    ├── us-east/         # region us-east-1, release titan-us, regions/us-east.yaml
    └── eu-west/         # region eu-west-1, release titan-eu, regions/eu-west.yaml
```

## How the region overlay maps to the Helm chart

The `titan-app` module installs the chart at `helm/titan` and passes the
per-region overlay file via `values = [file(var.values_file)]`:

| Environment            | AWS region   | Helm release | Overlay file                       |
|------------------------|--------------|--------------|------------------------------------|
| `environments/us-east` | `us-east-1`  | `titan-us`   | `helm/titan/regions/us-east.yaml`  |
| `environments/eu-west` | `eu-west-1`  | `titan-eu`   | `helm/titan/regions/eu-west.yaml`  |

The overlay sets `region`, the gateway HPA min/max replicas and the regional
Redis / Kafka / CockroachDB / ClickHouse endpoints — exactly as documented in
the chart README for one-release-per-region multi-region. The module also
re-asserts `--set region=<region>` so the region tag (which flows into audit
events + Cedar context) always matches the environment.

## Prerequisites

- **awscli** v2, configured with credentials that can create VPC/EKS/IAM
  resources (`aws configure` / `aws sso login`).
- **terraform** >= 1.6
- **kubectl** (to inspect the cluster after apply)
- **helm** >= 3.x (the helm provider drives this; the CLI is handy for debugging)

Provider versions are pinned in each `versions.tf`:
`aws ~> 5.0`, `helm ~> 2.12`, `kubernetes ~> 2.24`.

## Usage

Work inside one environment directory at a time. Example for US East:

```bash
cd terraform/environments/us-east

# Optionally copy and edit the example tfvars (all values have sane defaults).
cp terraform.tfvars.example terraform.tfvars

terraform init
terraform plan
terraform apply
```

Secrets should not be committed. Pass them via environment variables instead:

```bash
export TF_VAR_admin_token="$(openssl rand -hex 24)"
export TF_VAR_provider_api_key="sk-..."
terraform apply
```

After apply, point your local tooling at the new cluster using the emitted
`kubeconfig_command` output:

```bash
$(terraform output -raw kubeconfig_command)
kubectl -n titan get pods
helm -n titan list
```

Repeat in `terraform/environments/eu-west` for the EU region. The two
environments are independent (separate state, separate cluster) and can be
applied in parallel.

### Remote state (recommended for teams)

State is local by default. For shared use, enable the S3 backend stub in each
environment's `backend.tf` (create the S3 bucket + DynamoDB lock table first),
then re-run `terraform init` to migrate state.

## Cost warning

This stack provisions **real, billable AWS infrastructure**: an EKS control
plane (~\$0.10/hr per cluster), EC2 worker nodes (default `m5.large` ×
desired-size, on-demand), a NAT gateway, EBS volumes and data transfer. A
single region left running 24/7 typically costs **well over \$200/month**, and
you are running two regions. Apply only what you need and **tear it down when
you are done** (see below). Consider `capacity_type = "SPOT"` and a smaller
`node_instance_type` / `node_desired_size` for demos.

## Teardown

Destroy each environment you applied. Run from the same directory:

```bash
cd terraform/environments/us-east
terraform destroy
```

```bash
cd terraform/environments/eu-west
terraform destroy
```

`terraform destroy` uninstalls the Helm release first, then deletes the node
group, EKS cluster, NAT gateway and VPC. If a destroy stalls on the helm
release (e.g. the cluster is already gone), remove it from state with
`terraform state rm module.titan_app.helm_release.titan` and re-run destroy.
Double-check the AWS console afterwards for any orphaned load balancers /
EBS volumes created by in-cluster workloads.
