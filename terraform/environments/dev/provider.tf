terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

# Configure the AWS Provider
provider "aws" {
  region = "us-west-2"
}

# CloudFront ACM certificates must be requested in us-east-1, regardless of
# where the distribution's other resources live (see domain.tf).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}