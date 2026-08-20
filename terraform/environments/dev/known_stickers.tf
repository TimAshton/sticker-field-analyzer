# --- Known-sticker reference catalog ---
# A separate, dedicated bucket + table for manually-added reference images of
# single, already-isolated stickers (as opposed to sticker_images, which holds
# raw field-photo uploads under stickers/ and their resized display/ copies).
# These are the "ground truth" images matched against once the pipeline can
# embed and compare stickers - see embedding/ and match_lambda.tf.

resource "aws_s3_bucket" "known_stickers" {
  bucket = "sticker-field-analyzer-known-stickers-${random_id.bucket_suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "known_stickers_privacy" {
  bucket = aws_s3_bucket.known_stickers.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "known_stickers_encryption" {
  bucket = aws_s3_bucket.known_stickers.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "known_stickers_cors" {
  bucket = aws_s3_bucket.known_stickers.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = [
      "http://localhost:3000",
      "https://${aws_cloudfront_distribution.cdn.domain_name}",
      "https://stickers.tashton.com",
    ]
    expose_headers = ["ETag"]
  }
}

# Flat catalog of known/reference stickers used for brute-force cosine-
# similarity matching (see embedding/match.py). Unlike sticker_pipeline,
# there's no parent/child relationship here - one item per known sticker -
# so this intentionally has no range key and no GSI. The match Lambda Scans
# the whole table, which is fine at "a handful of manually-added entries"
# scale. Revisit (add an index, or move off Scan/this table entirely) only
# if this catalog grows large.
#
# Item shape: sticker_id (PK, S), artist (S), design_name (S), image_key (S),
# status (S: pending_embedding|embedded|failed), embedding (List<N>, set only
# once status=embedded), created_at (S), updated_at (S).
resource "aws_dynamodb_table" "known_stickers" {
  name         = "sticker-field-analyzer-known-stickers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "sticker_id"

  attribute {
    name = "sticker_id"
    type = "S"
  }
}

output "known_stickers_bucket_name" {
  value       = aws_s3_bucket.known_stickers.id
  description = "S3 bucket holding reference images for the known-sticker catalog"
}

output "known_stickers_table_name" {
  value       = aws_dynamodb_table.known_stickers.name
  description = "DynamoDB table tracking the known-sticker catalog and its embeddings"
}
