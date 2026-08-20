variable "embedding_image_tag" {
  description = <<-EOT
    Tag of the sticker-field-analyzer-embedding ECR image to deploy for the
    embed-known and match Lambdas. Container-image Lambdas have no
    source_code_hash-style mechanism - Terraform only redeploys when this
    value actually changes, so pass a content-addressed tag (e.g. the git
    short SHA build_and_push.sh prints) on every apply after a new image is
    pushed, not "latest".
  EOT
  type        = string
  default     = "latest"
}

variable "detection_image_tag" {
  description = <<-EOT
    Tag of the sticker-field-analyzer-detection ECR image to deploy for the
    detect Lambda. Same content-addressed-tag caveat as embedding_image_tag
    above - pass the tag detection/build_and_push.sh prints on every apply
    after a new image is pushed, not "latest".
  EOT
  type        = string
  default     = "latest"
}
