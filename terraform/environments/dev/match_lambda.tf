# --- Match Lambda (embedding/match.py) ---
# Triggered by the same underlying S3 upload event as the ingest Lambda, but
# via EventBridge rather than a direct S3 notification - S3 rejects a second
# direct Lambda trigger on the same (event, prefix) as ingest's existing one
# (see the comment on aws_s3_bucket_notification.sticker_uploads in
# ingest_lambda.tf for why). Reads the raw upload directly (not ingest's
# display/ copy, since the two Lambdas run independently/in parallel and
# ingest may not have finished), embeds it with CLIP, and brute-force
# compares it against every embedded known sticker. A match above
# MATCH_SIMILARITY_THRESHOLD is logged to sticker_pipeline as a MATCH# item -
# nothing acts on it yet.

resource "aws_iam_role" "match_lambda" {
  name = "sticker-field-analyzer-match-role"

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

resource "aws_iam_role_policy_attachment" "match_logs" {
  role       = aws_iam_role.match_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Same prefix ingest reads, no write access needed.
resource "aws_iam_role_policy" "match_s3" {
  name = "match-s3-read"
  role = aws_iam_role.match_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/stickers/*"
      }
    ]
  })
}

resource "aws_iam_role_policy" "match_dynamodb" {
  name = "match-dynamodb-access"
  role = aws_iam_role.match_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = aws_dynamodb_table.known_stickers.arn
      },
      {
        # Table-wide PutItem, same as presign_api_dynamodb's convention for
        # a role that only ever creates new items (here, new MATCH# items -
        # never touches an image's existing METADATA item, avoiding a write
        # race with the ingest Lambda running in parallel).
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.sticker_pipeline.arn
      }
    ]
  })
}

resource "aws_lambda_function" "match" {
  function_name = "sticker-field-analyzer-match"
  role          = aws_iam_role.match_lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.embedding.repository_url}:${var.embedding_image_tag}"
  timeout       = 120
  memory_size   = 3008 # CLIP inference is CPU-bound, and Lambda CPU scales with memory

  image_config {
    command = ["match.handler"]
  }

  environment {
    variables = {
      KNOWN_STICKERS_TABLE_NAME = aws_dynamodb_table.known_stickers.name
      DYNAMODB_TABLE_NAME       = aws_dynamodb_table.sticker_pipeline.name
      # The single tunable location for the match threshold - change this
      # value and re-apply, no code change or image rebuild needed.
      MATCH_SIMILARITY_THRESHOLD = "0.90"
      # Force sentence-transformers/huggingface_hub to use the model weights
      # baked into the image (Dockerfile) instead of checking the Hub for
      # updates on every cold start - see embed_known_lambda.tf for how this
      # was found (a 60s handler timeout otherwise, with the model itself
      # loading fine).
      HF_HUB_OFFLINE       = "1"
      TRANSFORMERS_OFFLINE = "1"
    }
  }
}

# EventBridge fan-out (see the comment on aws_s3_bucket_notification.sticker_uploads
# in ingest_lambda.tf for why this can't be a direct S3 notification like
# ingest's). aws_s3_bucket_notification.sticker_uploads sets eventbridge = true,
# which sends every S3 event on this bucket to the account's default event
# bus in addition to firing ingest's direct Lambda trigger - this rule picks
# out just the stickers/ ObjectCreated ones for match.
resource "aws_cloudwatch_event_rule" "match_on_sticker_upload" {
  name = "sticker-field-analyzer-match-on-upload"

  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = {
        name = [aws_s3_bucket.sticker_images.id]
      }
      object = {
        key = [{ prefix = "stickers/" }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "match" {
  rule = aws_cloudwatch_event_rule.match_on_sticker_upload.name
  arn  = aws_lambda_function.match.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke_match" {
  statement_id  = "AllowEventBridgeInvokeMatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.match.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.match_on_sticker_upload.arn
}
