terraform {
  backend "s3" {
    bucket       = "sticker-field-analyzer-tfstate-251500384433"
    key          = "sticker-field-analyzer/dev/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true # native S3 state locking (Terraform >= 1.10, no DynamoDB needed)
  }
}
