# --- Presign API Lambda (api/main.py) ---
# Generates short-lived S3 upload URLs so the React app can PUT images
# directly to the sticker_images bucket without exposing AWS credentials
# to the browser.

resource "aws_iam_role" "presign_api_lambda" {
  name = "sticker-field-analyzer-presign-api-role"

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
resource "aws_iam_role_policy_attachment" "presign_api_logs" {
  role       = aws_iam_role.presign_api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Scoped tightly to just the stickers/ prefix this Lambda writes to -
# not full bucket access, and no delete/list permissions.
resource "aws_iam_role_policy" "presign_api_s3" {
  name = "presign-api-s3-put"
  role = aws_iam_role.presign_api_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.sticker_images.arn}/stickers/*"
      }
    ]
  })
}

resource "aws_lambda_function" "presign_api" {
  function_name = "sticker-field-analyzer-presign-api"
  role          = aws_iam_role.presign_api_lambda.arn
  handler       = "main.handler"
  runtime       = "python3.12"
  timeout       = 10
  memory_size   = 256

  filename         = "${path.module}/lambda_package.zip"
  source_code_hash = filebase64sha256("${path.module}/lambda_package.zip")

  environment {
    variables = {
      S3_BUCKET_NAME = aws_s3_bucket.sticker_images.id
      ALLOWED_ORIGIN = "https://${aws_cloudfront_distribution.cdn.domain_name}"
    }
  }
}

# Function URL gives us a plain HTTPS endpoint with no API Gateway needed -
# appropriate for a single low-traffic endpoint like this one.
resource "aws_lambda_function_url" "presign_api" {
  function_name      = aws_lambda_function.presign_api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins     = ["http://localhost:3000", "https://${aws_cloudfront_distribution.cdn.domain_name}"]
    allow_methods     = ["POST"]
    allow_headers     = ["content-type"]
    allow_credentials = false
    max_age           = 300
  }
}

output "presign_api_url" {
  value       = aws_lambda_function_url.presign_api.function_url
  description = "HTTPS endpoint the React app calls to request a presigned S3 upload URL"
}
