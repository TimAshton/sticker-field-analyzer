# --- Metadata table for the upload -> processing -> enrichment pipeline ---
#
# Single-table design:
#   PK (image_id) + SK "METADATA"     -> one item per uploaded image
#     status: uploaded | display_ready | extracted | enrichment_complete | failed
#     source_key: S3 key of the raw uploaded photo
#     display_key: S3 key of the viewable copy (set by the ingest Lambda)
#
#   PK (image_id) + SK "CROP#<crop_id>" -> one item per extracted sticker
#     status: pending | enriched | failed
#     crop_key: S3 key of the cropped sticker image
#     bbox: bounding box from YOLO detection
#     info: enrichment result once the search step completes
#
# Query(image_id = X) returns the source image plus all its crops in one call.
# The status-index GSI supports "find everything stuck at status Y" queries.

resource "aws_dynamodb_table" "sticker_pipeline" {
  name         = "sticker-field-analyzer-pipeline"
  billing_mode = "PAY_PER_REQUEST" # no capacity planning needed at this traffic level
  hash_key     = "image_id"
  range_key    = "sk"

  attribute {
    name = "image_id"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "updated_at"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "updated_at"
    projection_type = "ALL"
  }
}

output "pipeline_table_name" {
  value       = aws_dynamodb_table.sticker_pipeline.name
  description = "DynamoDB table tracking image/sticker pipeline status"
}

output "pipeline_table_arn" {
  value       = aws_dynamodb_table.sticker_pipeline.arn
  description = "ARN for granting Lambda IAM roles read/write access"
}
