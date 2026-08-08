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
