# --- Detect Lambda (detection/detect.py) ---
# Triggered by the same underlying S3 upload event as ingest and match, but
# via EventBridge like match - S3 rejects a second direct Lambda trigger on
# the same (event, prefix) as ingest's existing one (see the comment on
# aws_s3_bucket_notification.sticker_uploads in ingest_lambda.tf). Detects
# individual stickers in the raw field photo, die-cut-crops each one,
# uploads the crops to S3 under crops/<image_id>/, and writes one CROP#
# item per crop (status=pending). Never touches the image's METADATA item -
# same rationale as match, avoiding a write race with ingest running in
# parallel. Matching crops against the known-sticker catalog is separate,
# not-yet-wired work - this Lambda only detects and crops.

resource "aws_ecr_repository" "detection" {
  name                 = "sticker-field-analyzer-detection"
  image_tag_mutability = "MUTABLE"
}

resource "aws_iam_role" "detect_lambda" {
  name = "sticker-field-analyzer-detect-role"

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

resource "aws_iam_role_policy_attachment" "detect_logs" {
  role       = aws_iam_role.detect_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Read the raw upload, write crops - nothing else (same scoping style as
# ingest's read-write policy, which reads stickers/ and writes display/).
resource "aws_iam_role_policy" "detect_s3" {
  name = "detect-s3-read-write"
  role = aws_iam_role.detect_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/stickers/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/crops/*"
      }
    ]
  })
}

# Table-wide PutItem only - this Lambda only ever creates new CROP# child
# items, never touches an image's existing METADATA item (same convention
# match's policy documents for MATCH# items).
resource "aws_iam_role_policy" "detect_dynamodb" {
  name = "detect-dynamodb-write"
  role = aws_iam_role.detect_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.sticker_pipeline.arn
      }
    ]
  })
}

resource "aws_lambda_function" "detect" {
  function_name = "sticker-field-analyzer-detect"
  role          = aws_iam_role.detect_lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.detection.repository_url}:${var.detection_image_tag}"
  timeout       = 300 # OWLv2 detection + per-box OpenCV refinement on a multi-sticker photo is heavier than a single CLIP embedding call
  memory_size   = 3008 # inference is CPU-bound, and Lambda CPU scales with memory

  image_config {
    command = ["detect.handler"]
  }

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.sticker_pipeline.name
      # Force transformers/huggingface_hub to use the model weights baked
      # into the image (Dockerfile) instead of checking the Hub for updates
      # on every cold start - see embed_known_lambda.tf for how this was
      # found (a 60s handler timeout otherwise, with the model itself
      # loading fine).
      HF_HUB_OFFLINE       = "1"
      TRANSFORMERS_OFFLINE = "1"
      # Belt-and-suspenders alongside detect.py's torch.set_num_threads(1) -
      # stop the BLAS libraries underneath torch/numpy from also defaulting
      # their own thread pools to the host's full core count.
      OMP_NUM_THREADS = "1"
      MKL_NUM_THREADS = "1"
    }
  }
}

# EventBridge fan-out - aws_s3_bucket_notification.sticker_uploads (in
# ingest_lambda.tf) sets eventbridge = true, which sends every S3 event on
# this bucket to the account's default event bus in addition to firing
# ingest's direct Lambda trigger. This rule picks out just the stickers/
# ObjectCreated ones for detect - a third, independent consumer alongside
# match's identical rule in match_lambda.tf.
resource "aws_cloudwatch_event_rule" "detect_on_sticker_upload" {
  name = "sticker-field-analyzer-detect-on-upload"

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

resource "aws_cloudwatch_event_target" "detect" {
  rule = aws_cloudwatch_event_rule.detect_on_sticker_upload.name
  arn  = aws_lambda_function.detect.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke_detect" {
  statement_id  = "AllowEventBridgeInvokeDetect"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.detect.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.detect_on_sticker_upload.arn
}
