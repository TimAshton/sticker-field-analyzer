import os
import uuid
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
import boto3
from botocore.exceptions import ClientError
from mangum import Mangum

app = FastAPI(title="Sticker Field Analyzer API")

# CORS is handled entirely by the Lambda Function URL's built-in CORS config
# (see terraform/environments/dev/lambda.tf). AWS intercepts OPTIONS preflight
# requests before they reach this app and adds the Access-Control-Allow-*
# headers to every response automatically. Adding FastAPI's CORSMiddleware
# here as well causes duplicate Access-Control-Allow-Origin headers, which
# browsers reject even when the values match - so we deliberately don't
# configure CORS at the application layer.

# Initialize S3 client (Uses IAM credentials configured in your environment)
s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-west-2"))
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "YOUR_TERRAFORM_COMPUTED_BUCKET_NAME")

# DynamoDB table tracking image/sticker pipeline status (see dynamodb.tf).
# Single-table design: PK=image_id, SK="METADATA" for the image record,
# SK="CROP#<id>" for each extracted sticker (written by later pipeline stages).
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))
TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
pipeline_table = dynamodb.Table(TABLE_NAME)

# Allowed image mime-types for the sticker field analyzer app
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

class PresignedUrlRequest(BaseModel):
    client_filename: str = Field(..., description="Original name of the file")
    content_type: str = Field(..., description="The mime-type of the image")

class PresignedUrlResponse(BaseModel):
    upload_url: str
    object_key: str
    image_id: str

@app.post(
    "/api/get-presigned-url", 
    response_model=PresignedUrlResponse, 
    status_code=status.HTTP_201_CREATED
)
async def generate_presigned_url(payload: PresignedUrlRequest):
    # 1. Enforce strict content-type validation on the server side
    if payload.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_TYPES)}"
        )

    # 2. Sanitize and generate a unique file name using a UUID4 hash string.
    # This same id doubles as the DynamoDB partition key for this image, so
    # the S3 key and the pipeline record are always linked.
    # This prevents directory traversal attacks and key collisions in S3.
    image_id = str(uuid.uuid4())
    file_extension = payload.client_filename.split(".")[-1].lower()
    unique_key = f"stickers/{image_id}.{file_extension}"

    try:
        # 3. Request a short-lived PUT URL from S3 (expires in 5 minutes)
        url = s3_client.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": unique_key,
                "ContentType": payload.content_type,
            },
            ExpiresIn=300, # 5 minutes execution window
        )

        # 4. Write the initial pipeline record. status="uploaded" means the
        # client has a URL but hasn't necessarily PUT the file to S3 yet -
        # later stages (ingest Lambda, triggered by the actual S3 upload
        # event) move this to display_ready / extracted / enrichment_complete.
        now = datetime.now(timezone.utc).isoformat()
        pipeline_table.put_item(
            Item={
                "image_id": image_id,
                "sk": "METADATA",
                "status": "uploaded",
                "source_key": unique_key,
                "created_at": now,
                "updated_at": now,
            }
        )

        return PresignedUrlResponse(upload_url=url, object_key=unique_key, image_id=image_id)

    except ClientError as e:
        # Avoid leaking internal AWS metadata; log it internally and send a generic 500
        print(f"AWS ClientError: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload credentials. Please try again."
        )


# Lambda entrypoint - Mangum adapts the ASGI app to the API Gateway/Function URL
# event format. This is only used when running in Lambda; running locally via
# `uvicorn main:app --reload` still works unaffected.
handler = Mangum(app)