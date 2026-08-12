import os
import urllib.parse
from datetime import datetime, timezone
from io import BytesIO

import boto3
from PIL import Image, ImageOps

s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-west-2"))
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))
TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
pipeline_table = dynamodb.Table(TABLE_NAME)

MAX_DIMENSION = 1600  # longest edge, in pixels
JPEG_QUALITY = 85


def handler(event, context):
    """
    Triggered by S3 ObjectCreated events on the stickers/ prefix (see the
    aws_s3_bucket_notification resource in ingest_lambda.tf). Runs
    independently and in parallel with the detection Lambda - both react to
    the same upload event, they don't call each other.
    """
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        # S3 event keys are URL-encoded (e.g. spaces become '+')
        source_key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        # source_key looks like "stickers/<image_id>.<ext>"
        filename = source_key.split("/")[-1]
        image_id = filename.rsplit(".", 1)[0]
        display_key = f"display/{image_id}.jpg"

        try:
            _create_display_copy(bucket, source_key, display_key)
            _update_status(image_id, display_key, status_value="display_ready")
        except Exception as e:
            # Log and mark this image as failed rather than raising, so a
            # single bad upload doesn't retry-loop or block other records
            # in a batch.
            print(f"Failed to process {source_key}: {e}")
            _update_status(image_id, display_key=None, status_value="failed")

    return {"statusCode": 200}


def _create_display_copy(bucket: str, source_key: str, display_key: str) -> None:
    raw = s3_client.get_object(Bucket=bucket, Key=source_key)["Body"].read()

    with Image.open(BytesIO(raw)) as img:
        # Respect EXIF orientation (phone photos are frequently rotated via
        # metadata rather than actual pixel data) before resizing.
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        buffer.seek(0)

    s3_client.put_object(
        Bucket=bucket,
        Key=display_key,
        Body=buffer,
        ContentType="image/jpeg",
    )


def _update_status(image_id: str, display_key: str | None, status_value: str) -> None:
    now = datetime.now(timezone.utc).isoformat()

    update_expr = "SET #status = :status, updated_at = :updated_at"
    expr_names = {"#status": "status"}
    expr_values = {":status": status_value, ":updated_at": now}

    if display_key is not None:
        update_expr += ", display_key = :display_key"
        expr_values[":display_key"] = display_key

    pipeline_table.update_item(
        Key={"image_id": image_id, "sk": "METADATA"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )