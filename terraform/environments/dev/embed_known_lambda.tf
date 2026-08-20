# --- Embedding image + Embed-Known Lambda (embedding/embed_known.py) ---
# Triggered by S3 whenever a new reference image lands under known/ in the
# known_stickers bucket. Computes a CLIP embedding and marks the catalog
# entry embedded, making it eligible for matching (see match_lambda.tf).
#
# Bundles CLIP + torch, which don't fit a standard zip Lambda (250MB limit) -
# this and the match Lambda are container-image Lambdas (10GB limit) and
# share one ECR repo/image, differing only by their image_config.command.

resource "aws_ecr_repository" "embedding" {
  name                 = "sticker-field-analyzer-embedding"
  image_tag_mutability = "MUTABLE"
}

resource "aws_iam_role" "embed_known_lambda" {
  name = "sticker-field-analyzer-embed-known-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "embed_known_logs" {
  role       = aws_iam_role.embed_known_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Only reads the reference image it was invoked for - no write access to S3.
resource "aws_iam_role_policy" "embed_known_s3" {
  name = "embed-known-s3-read"
  role = aws_iam_role.embed_known_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.known_stickers.arn}/known/*"
      }
    ]
  })
}

# Only UpdateItem - this Lambda never creates or deletes catalog entries, it
# only advances the status of ones the presign API already created (same
# convention as the ingest Lambda's relationship to sticker_pipeline).
resource "aws_iam_role_policy" "embed_known_dynamodb" {
  name = "embed-known-dynamodb-update"
  role = aws_iam_role.embed_known_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.known_stickers.arn
      }
    ]
  })
}

resource "aws_lambda_function" "embed_known" {
  function_name = "sticker-field-analyzer-embed-known"
  role          = aws_iam_role.embed_known_lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.embedding.repository_url}:${var.embedding_image_tag}"
  timeout       = 120
  memory_size   = 3008 # CLIP inference is CPU-bound, and Lambda CPU scales with memory

  image_config {
    command = ["embed_known.handler"]
  }

  environment {
    variables = {
      KNOWN_STICKERS_TABLE_NAME = aws_dynamodb_table.known_stickers.name
      # Force sentence-transformers/huggingface_hub to use the model weights
      # baked into the image (Dockerfile) instead of checking the Hub for
      # updates on every cold start - that network round-trip was the actual
      # cause of a 60s handler timeout with the model otherwise loading fine.
      HF_HUB_OFFLINE       = "1"
      TRANSFORMERS_OFFLINE = "1"
    }
  }
}

resource "aws_lambda_permission" "allow_s3_invoke_embed_known" {
  statement_id  = "AllowS3InvokeEmbedKnown"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.embed_known.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.known_stickers.arn
}

# Independent of sticker_images' aws_s3_bucket_notification.sticker_uploads -
# this is a different bucket, so it gets its own notification config without
# touching the one-per-bucket constraint documented on that resource.
resource "aws_s3_bucket_notification" "known_stickers_uploads" {
  bucket = aws_s3_bucket.known_stickers.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.embed_known.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "known/"
  }

  depends_on = [aws_lambda_permission.allow_s3_invoke_embed_known]
}
