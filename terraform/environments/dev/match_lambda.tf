# --- Match Lambda (embedding/match.py) ---
# Triggered by S3 writes under crops/ - the die-cut crops the detect Lambda
# produces (detection/detect.py) - via EventBridge, same delivery mechanism
# as detect's own trigger (see the comment on
# aws_s3_bucket_notification.sticker_uploads in ingest_lambda.tf for why
# EventBridge rather than a direct S3 notification). eventbridge = true on
# that notification resource routes ALL object-created events for the
# bucket to EventBridge, not just the stickers/-prefixed ones configured
# there for ingest - so detect's crops/ writes already arrive without any
# change to that resource, only this rule's prefix filter needed to change.
#
# Originally matched the whole raw field photo instead of a crop - kept
# missing real matches (confirmed with real data: a whole-photo match against
# a clean reference topped out around 0.73-0.74, comparing an entire
# multi-sticker wall photo against one isolated reference image can't score
# like a real match should). Matching per-crop instead is the fix; embeds
# each crop with CLIP and brute-force compares it against every embedded
# known sticker. A match above MATCH_SIMILARITY_THRESHOLD is logged to
# sticker_pipeline as a MATCH# item - nothing acts on it yet.

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

# Reads the crops detect produces, no write access needed.
resource "aws_iam_role_policy" "match_s3" {
  name = "match-s3-read"
  role = aws_iam_role.match_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/crops/*"
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
        # Table-wide PutItem, same as api_dynamodb's convention for
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
      # Deliberately low right now (0.65) for exploration while match-
      # per-crop is newly wired up and still being calibrated - real
      # known-good matches so far scored ~0.73-0.74, well under the old
      # 0.90 default that was tuned for whole-photo comparisons.
      MATCH_SIMILARITY_THRESHOLD = "0.65"
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
# bus - this rule picks out just the crops/ ObjectCreated ones (written by
# detect, see detect_lambda.tf) for match.
resource "aws_cloudwatch_event_rule" "match_on_crop_upload" {
  name = "sticker-field-analyzer-match-on-crop-upload"

  event_pattern = jsonencode({
    source        = ["aws.s3"]
    "detail-type" = ["Object Created"]
    detail = {
      bucket = {
        name = [aws_s3_bucket.sticker_images.id]
      }
      object = {
        key = [{ prefix = "crops/" }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "match" {
  rule = aws_cloudwatch_event_rule.match_on_crop_upload.name
  arn  = aws_lambda_function.match.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke_match" {
  statement_id  = "AllowEventBridgeInvokeMatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.match.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.match_on_crop_upload.arn
}
