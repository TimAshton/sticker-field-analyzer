module "vpc_infrastructure" {
  source = "../../modules/app_infrastructure"
}

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "sticker_images" {
  bucket = "sticker-field-analyzer-uploads-${random_id.bucket_suffix.hex}" 
}

resource "aws_s3_bucket_cors_configuration" "app_cors" {
  bucket = aws_s3_bucket.sticker_images.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"] # React uses PUT for pre-signed URLs
    allowed_origins = ["http://localhost:3000"] # Your frontend URL
    expose_headers  = ["ETag"]
  }
}

