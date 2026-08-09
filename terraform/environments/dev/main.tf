module "vpc_infrastructure" {
  source = "../../modules/app_infrastructure"
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "webapp" {
  bucket = "sticker-field-analyzer-webapp-${random_id.bucket_suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "webapp_privacy" {
  bucket = aws_s3_bucket.webapp.id

  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "webapp_encryption" {
  bucket = aws_s3_bucket.webapp.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "oac" {
  name  = "s3-react-oac"
  description = "OAC for React App S3 Bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior = "always"
  signing_protocol = "sigv4"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  origin {
    domain_name              = aws_s3_bucket.webapp.bucket_regional_domain_name
    origin_id                = "S3Origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3Origin"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# 3. Security IAM Policy and Bucket Attachment
data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "allow_cloudfront_oac" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      # FIX: Restored the missing 'cloudfront' prefix
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions = [
      "s3:GetObject"
    ]

    resources = [
      "${aws_s3_bucket.webapp.arn}/*"
    ]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.cdn.id}"]
    }
  }
}

resource "aws_s3_bucket_policy" "allow_cloudfront" {
  # Forces Terraform to wait until CloudFront is completely done creating globally
  depends_on = [aws_cloudfront_distribution.cdn]

  # FIX: Changed from web_app.id to webapp.id to match your resource definition
  bucket = aws_s3_bucket.webapp.id
  policy = data.aws_iam_policy_document.allow_cloudfront_oac.json
}

# 4. User Uploads / Sticker Images S3 Bucket
resource "aws_s3_bucket" "sticker_images" {
  bucket = "sticker-field-analyzer-uploads-${random_id.bucket_suffix.hex}" 
}

resource "aws_s3_bucket_cors_configuration" "app_cors" {
  bucket = aws_s3_bucket.sticker_images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"] 
    allowed_origins = [
      "http://localhost:3000",
      # FIX: Dynamically allows your deployed CloudFront URL to drop files into S3
      "https://${aws_cloudfront_distribution.cdn.domain_name}"
    ] 
    expose_headers  = ["ETag"]
  }
}

# Add this to the bottom of your main.tf file
output "webapp_bucket_name" {
  value       = aws_s3_bucket.webapp.id
  description = "The name of the S3 bucket for the React web app"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.cdn.id
  description = "The CloudFront Distribution ID to invalidate"
}

# Create the OIDC Provider for GitHub, since it doesn't exist yet in this account
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  # GitHub's OIDC thumbprint (current as of the token.actions.githubusercontent.com root CA)
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Create the IAM Role for the GitHub runner
resource "aws_iam_role" "github_cicd" {
  name = "sticker-field-analyzer-cicd-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }
        Action = [
          "sts:AssumeRoleWithWebIdentity",
          "sts:TagSession"
        ]
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            # Change this to match your actual GitHub username/repo string
            "token.actions.githubusercontent.com:sub" = "repo:TimAshton@*/sticker-field-analyzer@*:*"
          }
        }
      }
    ]
  })
}

# Attach permissions to the CI/CD Role
resource "aws_iam_role_policy" "cicd_permissions" {
  name = "cicd-s3-cloudfront-policy"
  role = aws_iam_role.github_cicd.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          aws_s3_bucket.webapp.arn,
          "${aws_s3_bucket.webapp.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "cloudfront:CreateInvalidation"
        ]
        Resource = aws_cloudfront_distribution.cdn.arn
      },
      {
        # Needed so `terraform init` / `terraform output` work inside GitHub Actions
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::sticker-field-analyzer-tfstate-251500384433",
          "arn:aws:s3:::sticker-field-analyzer-tfstate-251500384433/*"
        ]
      }
    ]
  })
}

output "cicd_role_arn" {
  value = aws_iam_role.github_cicd.arn
}

