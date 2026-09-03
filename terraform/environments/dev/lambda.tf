# --- API Lambda (api/main.py) ---
# Started as just presigned-upload generation; now also serves the read
# side (GET /api/images, GET /api/known-stickers) and the admin delete
# route, so it's named for what it is - the general API - not just its
# original presign-only scope.

resource "aws_iam_role" "api_lambda" {
  name = "sticker-field-analyzer-api-role"

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

# Basic CloudWatch Logs permissions so the Lambda can actually log anything
resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Scoped tightly to just the stickers/ prefix this Lambda writes to -
# not full bucket access, and no delete/list permissions. Also reads
# display/ so it can generate presigned view URLs for GET /api/images -
# note the permission is required for the *presigned URL itself* to work
# when a browser later uses it, not just for generating it.
resource "aws_iam_role_policy" "api_s3" {
  name = "api-s3-access"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/stickers/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/display/*"
      }
    ]
  })
}

# PutItem creates the initial pipeline record; this Lambda never updates
# existing items (later pipeline stages own those writes). Query on the
# status-index GSI backs GET /api/images' "all display_ready images" list;
# Query on the base table backs that same route's per-image MATCH# lookup
# (Key(image_id) & sk begins_with "MATCH#") so the frontend can show
# whether an upload matched anything in the known-sticker catalog.
# DeleteItem backs the admin-only DELETE /api/images/{image_id} QA action -
# it removes an upload's DynamoDB records (never the S3 image itself, see
# api/main.py's delete_image) so it drops out of Sticker Book/the admin QA
# view.
resource "aws_iam_role_policy" "api_dynamodb" {
  name = "api-dynamodb-access"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.sticker_pipeline.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = [
          aws_dynamodb_table.sticker_pipeline.arn,
          "${aws_dynamodb_table.sticker_pipeline.arn}/index/status-index"
        ]
      }
    ]
  })
}

# Scoped to the known-stickers bucket's known/ prefix only. PutObject backs
# /api/get-known-presigned-url's write step; GetObject backs GET
# /api/known-stickers' presigned view URLs - same note as api_s3
# above, this permission is required for the *presigned URL itself* to
# work when a browser later uses it, not just for generating it. No
# delete/list.
resource "aws_iam_role_policy" "api_known_s3" {
  name = "api-known-s3-access"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.known_stickers.arn}/known/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.known_stickers.arn}/known/*"
      }
    ]
  })
}

# PutItem creates the initial known-sticker catalog record
# (/api/get-known-presigned-url) - this Lambda never updates existing items
# (the embed-known Lambda owns those writes once the reference image lands
# in S3). Scan backs GET /api/known-stickers' catalog listing - same
# brute-force-Scan choice known_stickers.tf documents for this table (no
# GSI, small manually-built catalog).
resource "aws_iam_role_policy" "api_known_dynamodb" {
  name = "api-known-dynamodb-access"
  role = aws_iam_role.api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.known_stickers.arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = aws_dynamodb_table.known_stickers.arn
      }
    ]
  })
}

resource "aws_lambda_function" "api" {
  function_name = "sticker-field-analyzer-api"
  role          = aws_iam_role.api_lambda.arn
  handler       = "main.handler"
  runtime       = "python3.12"
  timeout       = 10
  memory_size   = 256

  filename         = "${path.module}/lambda_package.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda_package.zip")

  environment {
    variables = {
      S3_BUCKET_NAME             = aws_s3_bucket.sticker_images.id
      ALLOWED_ORIGIN             = "https://${aws_cloudfront_distribution.cdn.domain_name}"
      DYNAMODB_TABLE_NAME        = aws_dynamodb_table.sticker_pipeline.name
      KNOWN_STICKERS_BUCKET_NAME = aws_s3_bucket.known_stickers.id
      KNOWN_STICKERS_TABLE_NAME  = aws_dynamodb_table.known_stickers.name
      COGNITO_USER_POOL_ID       = local.cognito_user_pool_id
      COGNITO_CLIENT_ID          = local.cognito_client_id
      COGNITO_REGION             = local.cognito_region
    }
  }
}

# Function URL gives us a plain HTTPS endpoint with no API Gateway needed -
# appropriate for a single low-traffic endpoint like this one.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [
      "http://localhost:3000",
      "https://${aws_cloudfront_distribution.cdn.domain_name}",
      "https://stickers.tashton.com",
    ]
    allow_methods     = ["POST", "GET", "DELETE"]
    allow_headers     = ["content-type", "authorization"]
    allow_credentials = false
    max_age           = 300
  }
}

output "api_url" {
  value       = aws_lambda_function_url.api.function_url
  description = "HTTPS endpoint the React app calls for presigned uploads and reads (images, known-stickers)"
}
