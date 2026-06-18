# lemony terraform 골격 — flowstock-infra/terraform 패턴 참조 (provider/route53/cloudfront/s3 분리)
terraform { required_providers { aws = { source = "hashicorp/aws" } } }
provider "aws" { region = var.region }
# TODO: route53.tf / cloudfront.tf / s3.tf / variables.tf / outputs.tf 로 분리(flowstock 동일)
