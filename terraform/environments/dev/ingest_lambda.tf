# --- Ingest & Display Lambda (ingest/main.py) ---
# Triggered by S3 whenever a new photo lands under stickers/. Creates a
# resized, EXIF-corrected JPEG under display/ for the Sticker Book app to
# show, and marks the pipeline record display_ready.
#
# Runs independently of the detection Lambda - both react to the same S3
# upload event in parallel, they don't call each other.

resource "aws_iam_role" "ingest_lambda" {
  name = "sticker-field-analyzer-ingest-role"

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

resource "aws_iam_role_policy_attachment" "ingest_logs" {
  role       = aws_iam_role.ingest_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Read the raw upload, write the resized display copy - nothing else
resource "aws_iam_role_policy" "ingest_s3" {
  name = "ingest-s3-read-write"
  role = aws_iam_role.ingest_lambda.id

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
        Resource = "${aws_s3_bucket.sticker_images.arn}/display/*"
      }
    ]
  })
}

# Only UpdateItem - this Lambda never creates or deletes pipeline records,
# it only advances the status of ones the presign API already created.
resource "aws_iam_role_policy" "ingest_dynamodb" {
  name = "ingest-dynamodb-update"
  role = aws_iam_role.ingest_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.sticker_pipeline.arn
      }
    ]
  })
}

resource "aws_lambda_function" "ingest" {
  function_name = "sticker-field-analyzer-ingest"
  role          = aws_iam_role.ingest_lambda.arn
  handler       = "main.handler"
  runtime       = "python3.12"
  timeout       = 30
  memory_size   = 512 # image resizing benefits from more CPU, which scales with memory in Lambda

  filename         = "${path.module}/ingest_package.zip"
  source_code_hash = filebase64sha256("${path.module}/ingest_package.zip")

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.sticker_pipeline.name
    }
  }
}

# Grants S3 (not just any caller) permission to invoke this specific
# function, scoped to this specific bucket only.
resource "aws_lambda_permission" "allow_s3_invoke_ingest" {
  statement_id  = "AllowS3InvokeIngest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.sticker_images.arn
}

# IMPORTANT: S3 only supports ONE notification configuration per bucket.
# When the detection Lambda is added later, its lambda_function block must
# be added to THIS resource, not a separate aws_s3_bucket_notification -
# a second one would silently overwrite this one instead of adding to it.
resource "aws_s3_bucket_notification" "sticker_uploads" {
  bucket = aws_s3_bucket.sticker_images.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.ingest.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "stickers/"
  }

  depends_on = [aws_lambda_permission.allow_s3_invoke_ingest]
}
