import os
import uuid
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import boto3
from botocore.exceptions import ClientError

app = FastAPI(title="Sticker Field Analyzer API")

# Configure CORS so your React application can communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize S3 client (Uses IAM credentials configured in your environment)
s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "YOUR_TERRAFORM_COMPUTED_BUCKET_NAME")

# Allowed image mime-types for the sticker field analyzer app
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

class PresignedUrlRequest(BaseModel):
    client_filename: str = Field(..., description="Original name of the file")
    content_type: str = Field(..., description="The mime-type of the image")

class PresignedUrlResponse(BaseModel):
    upload_url: str
    object_key: str

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

    # 2. Sanitize and generate a unique file name using a UUID4 hash string
    # This prevents directory traversal attacks and key collisions in S3
    file_extension = payload.client_filename.split(".")[-1].lower()
    unique_key = f"stickers/{uuid.uuid4()}.{file_extension}"

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
        
        return PresignedUrlResponse(upload_url=url, object_key=unique_key)

    except ClientError as e:
        # Avoid leaking internal AWS metadata; log it internally and send a generic 500
        print(f"AWS ClientError: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload credentials. Please try again."
        )
