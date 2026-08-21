import os
import uuid
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field
import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
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

# Initialize S3 client (Uses IAM credentials configured in your environment).
# Force the regional endpoint + SigV4: boto3's default presigned-URL builder
# uses the legacy global `s3.amazonaws.com` host regardless of region_name,
# which makes S3 307-redirect every PUT to the regional endpoint. Desktop
# browsers mostly follow that redirect fine, but mobile Safari's fetch fails
# to resend a cross-origin PUT body after a redirect, surfacing as a generic
# "Load failed" with no useful status code.
AWS_REGION = os.getenv("AWS_REGION", "us-west-2")
s3_client = boto3.client(
    "s3",
    region_name=AWS_REGION,
    endpoint_url=f"https://s3.{AWS_REGION}.amazonaws.com",
    config=Config(signature_version="s3v4"),
)
BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "YOUR_TERRAFORM_COMPUTED_BUCKET_NAME")

# DynamoDB table tracking image/sticker pipeline status (see dynamodb.tf).
# Single-table design: PK=image_id, SK="METADATA" for the image record,
# SK="CROP#<id>" for each extracted sticker (written by later pipeline stages).
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))
TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
pipeline_table = dynamodb.Table(TABLE_NAME)

# Known-sticker reference catalog (see known_stickers.tf) - separate bucket
# and table from the pipeline above, since these are manually-added,
# already-isolated reference images rather than field-photo uploads.
KNOWN_BUCKET_NAME = os.getenv("KNOWN_STICKERS_BUCKET_NAME", "YOUR_TERRAFORM_COMPUTED_BUCKET_NAME")
KNOWN_TABLE_NAME = os.getenv("KNOWN_STICKERS_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
known_stickers_table = dynamodb.Table(KNOWN_TABLE_NAME)

# Allowed image mime-types for the sticker field analyzer app
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

class PresignedUrlRequest(BaseModel):
    client_filename: str = Field(..., description="Original name of the file")
    content_type: str = Field(..., description="The mime-type of the image")

class PresignedUrlResponse(BaseModel):
    upload_url: str
    object_key: str
    image_id: str

class MatchItem(BaseModel):
    sticker_id: str
    artist: str
    design_name: str
    similarity: float

class ImageListItem(BaseModel):
    image_id: str
    status: str
    display_url: str
    created_at: str
    matches: list[MatchItem]

class ImageListResponse(BaseModel):
    images: list[ImageListItem]

class KnownStickerListItem(BaseModel):
    sticker_id: str
    artist: str
    design_name: str
    status: str
    image_url: str
    created_at: str

class KnownStickerListResponse(BaseModel):
    known_stickers: list[KnownStickerListItem]

class KnownStickerPresignedUrlRequest(BaseModel):
    client_filename: str = Field(..., description="Original name of the file")
    content_type: str = Field(..., description="The mime-type of the image")
    artist: str = Field(..., min_length=1, description="Artist/creator of the sticker design")
    design_name: str = Field(..., min_length=1, description="Name of the sticker design")

class KnownStickerPresignedUrlResponse(BaseModel):
    upload_url: str
    object_key: str
    sticker_id: str

def _presign_put(bucket: str, key: str, content_type: str) -> str:
    # Shared by both presign endpoints below - request a short-lived PUT URL
    # from S3 (expires in 5 minutes).
    return s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=300, # 5 minutes execution window
    )

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
        # 3. Request a short-lived PUT URL from S3
        url = _presign_put(BUCKET_NAME, unique_key, payload.content_type)

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


@app.post(
    "/api/get-known-presigned-url",
    response_model=KnownStickerPresignedUrlResponse,
    status_code=status.HTTP_201_CREATED
)
async def generate_known_sticker_presigned_url(payload: KnownStickerPresignedUrlRequest):
    # 1. Enforce strict content-type validation on the server side
    if payload.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_TYPES)}"
        )

    # 2. Sanitize and generate a unique file name using a UUID4 hash string.
    # This same id doubles as the DynamoDB partition key for this catalog
    # entry, so the S3 key and the catalog record are always linked.
    sticker_id = str(uuid.uuid4())
    file_extension = payload.client_filename.split(".")[-1].lower()
    unique_key = f"known/{sticker_id}.{file_extension}"

    try:
        # 3. Request a short-lived PUT URL from S3
        url = _presign_put(KNOWN_BUCKET_NAME, unique_key, payload.content_type)

        # 4. Write the initial catalog record. status="pending_embedding"
        # means the client has a URL but hasn't necessarily PUT the file to
        # S3 yet - the embed-known Lambda (triggered by the actual S3
        # upload event) moves this to embedded / failed.
        now = datetime.now(timezone.utc).isoformat()
        known_stickers_table.put_item(
            Item={
                "sticker_id": sticker_id,
                "artist": payload.artist,
                "design_name": payload.design_name,
                "image_key": unique_key,
                "status": "pending_embedding",
                "created_at": now,
                "updated_at": now,
            }
        )

        return KnownStickerPresignedUrlResponse(upload_url=url, object_key=unique_key, sticker_id=sticker_id)

    except ClientError as e:
        # Avoid leaking internal AWS metadata; log it internally and send a generic 500
        print(f"AWS ClientError: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate upload credentials. Please try again."
        )


@app.get(
    "/api/images",
    response_model=ImageListResponse,
)
async def list_images():
    # Query the status-index GSI rather than scanning the whole table -
    # only images the ingest Lambda has finished resizing are worth
    # showing, so this naturally excludes still-processing or failed ones.
    # sk="METADATA" items use display_ready/uploaded/failed; CROP items use
    # a different status vocabulary (pending/enriched), so this query only
    # ever matches image records, not sticker crops.
    try:
        result = pipeline_table.query(
            IndexName="status-index",
            KeyConditionExpression=Key("status").eq("display_ready"),
            ScanIndexForward=False,  # most recently updated first
        )
    except ClientError as e:
        print(f"AWS ClientError: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load images. Please try again."
        )

    images = []
    for item in result.get("Items", []):
        display_key = item.get("display_key")
        if not display_key:
            continue

        # The bucket is private, so the frontend needs a temporary signed
        # URL to actually load each <img> - these last an hour, long enough
        # for a browsing session without leaving objects permanently public.
        view_url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": BUCKET_NAME, "Key": display_key},
            ExpiresIn=3600,
        )

        images.append(
            ImageListItem(
                image_id=item["image_id"],
                status=item["status"],
                display_url=view_url,
                created_at=item.get("created_at", ""),
                matches=_get_matches(item["image_id"]),
            )
        )

    return ImageListResponse(images=images)


def _get_matches(image_id: str) -> list[MatchItem]:
    # One Query per image (base table, not the GSI) for its logged MATCH#
    # items - see match_lambda.tf/embedding/match.py for how these get
    # written. Best-effort: a failure here shouldn't take down the whole
    # image list, just that image's match info.
    try:
        result = pipeline_table.query(
            KeyConditionExpression=Key("image_id").eq(image_id) & Key("sk").begins_with("MATCH#"),
        )
    except ClientError as e:
        print(f"AWS ClientError fetching matches for {image_id}: {e}")
        return []

    return [
        MatchItem(
            sticker_id=match["matched_sticker_id"],
            artist=match.get("artist", ""),
            design_name=match.get("design_name", ""),
            similarity=float(match["similarity"]),
        )
        for match in result.get("Items", [])
    ]


@app.delete(
    "/api/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_image(image_id: str):
    # Admin-only QA action (no auth on this route yet - see web-app's
    # /admin routes). Deletes every DynamoDB record for this upload
    # (METADATA plus any CROP#/MATCH# children) so it drops out of both
    # Sticker Book and the admin QA view - but never touches S3, the
    # actual image files are deliberately left in place.
    try:
        result = pipeline_table.query(
            KeyConditionExpression=Key("image_id").eq(image_id),
        )
        for item in result.get("Items", []):
            pipeline_table.delete_item(Key={"image_id": image_id, "sk": item["sk"]})
    except ClientError as e:
        print(f"AWS ClientError deleting {image_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete image record. Please try again."
        )


@app.get(
    "/api/known-stickers",
    response_model=KnownStickerListResponse,
)
async def list_known_stickers():
    # No status-index GSI on this table (see known_stickers.tf) - it's a
    # flat, manually-built catalog, so brute-force Scan is the deliberate
    # choice here too, same as embedding/match.py's _scan_embedded_known_stickers.
    # Unlike /api/images, this returns every status (not just a "ready"
    # one) - browsing your own reference catalog benefits from seeing
    # pending/failed entries too, not just fully embedded ones.
    try:
        items = []
        scan_kwargs = {}
        while True:
            result = known_stickers_table.scan(**scan_kwargs)
            items.extend(result.get("Items", []))
            if "LastEvaluatedKey" not in result:
                break
            scan_kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]
    except ClientError as e:
        print(f"AWS ClientError: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to load known stickers. Please try again."
        )

    known_stickers = []
    for item in items:
        image_key = item.get("image_key")
        if not image_key:
            continue

        # Same private-bucket + short-lived signed URL pattern as
        # /api/images - the known-stickers bucket is private too.
        view_url = s3_client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": KNOWN_BUCKET_NAME, "Key": image_key},
            ExpiresIn=3600,
        )

        known_stickers.append(
            KnownStickerListItem(
                sticker_id=item["sticker_id"],
                artist=item.get("artist", ""),
                design_name=item.get("design_name", ""),
                status=item.get("status", ""),
                image_url=view_url,
                created_at=item.get("created_at", ""),
            )
        )

    known_stickers.sort(key=lambda s: s.created_at, reverse=True)
    return KnownStickerListResponse(known_stickers=known_stickers)


# Lambda entrypoint - Mangum adapts the ASGI app to the API Gateway/Function URL
# event format. This is only used when running in Lambda; running locally via
# `uvicorn main:app --reload` still works unaffected.
handler = Mangum(app)