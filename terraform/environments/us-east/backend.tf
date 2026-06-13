# Remote state backend.
#
# By default Terraform keeps state locally (terraform.tfstate in this dir). For
# team use and to protect the state of a live cluster, enable the S3 backend
# with a DynamoDB lock table below. Create the bucket + table out of band (or
# with a separate bootstrap config) BEFORE running `terraform init`.
#
# terraform {
#   backend "s3" {
#     bucket         = "titan-gateway-tfstate"
#     key            = "environments/us-east/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "titan-gateway-tflock"
#     encrypt        = true
#   }
# }
