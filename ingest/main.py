import os
import urllib.parse
from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO

import boto3
from PIL import Image, ImageOps, ExifTags

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
            gps = _create_display_copy(bucket, source_key, display_key)
            _update_status(image_id, display_key, status_value="display_ready", gps=gps)
        except Exception as e:
            # Log and mark this image as failed rather than raising, so a
            # single bad upload doesn't retry-loop or block other records
            # in a batch.
            print(f"Failed to process {source_key}: {e}")
            _update_status(image_id, display_key=None, status_value="failed", gps=None)

    return {"statusCode": 200}


def _create_display_copy(bucket: str, source_key: str, display_key: str) -> dict | None:
    raw = s3_client.get_object(Bucket=bucket, Key=source_key)["Body"].read()

    with Image.open(BytesIO(raw)) as img:
        # Extract GPS data BEFORE any resize/re-save - Pillow's save() drops
        # EXIF entirely unless explicitly re-attached, so this is the only
        # point where the original location metadata is still available.
        gps = _extract_gps(img)

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

    return gps


def _extract_gps(img: Image.Image) -> dict | None:
    """
    Reads GPSLatitude/GPSLongitude from EXIF if present. Most photos won't
    have this - screenshots, downloaded images, or photos taken with
    location services off - so returning None here is the normal case,
    not an error.
    """
    try:
        exif = img.getexif()
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)
        if not gps_ifd:
            return None

        lat_dms = gps_ifd.get(2)   # GPSLatitude
        lat_ref = gps_ifd.get(1)   # GPSLatitudeRef ('N' or 'S')
        lon_dms = gps_ifd.get(4)   # GPSLongitude
        lon_ref = gps_ifd.get(3)   # GPSLongitudeRef ('E' or 'W')

        if not (lat_dms and lon_dms and lat_ref and lon_ref):
            return None

        latitude = _dms_to_decimal(lat_dms, lat_ref)
        longitude = _dms_to_decimal(lon_dms, lon_ref)

        return {
            # DynamoDB's boto3 resource layer requires Decimal, not float
            "latitude": Decimal(str(round(latitude, 6))),
            "longitude": Decimal(str(round(longitude, 6))),
        }
    except (TypeError, ZeroDivisionError, KeyError, AttributeError):
        # Malformed GPS EXIF shouldn't fail the whole upload - just skip it
        return None


def _dms_to_decimal(dms, ref: str) -> float:
    degrees, minutes, seconds = dms
    decimal = float(degrees) + float(minutes) / 60 + float(seconds) / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def _update_status(
    image_id: str,
    display_key: str | None,
    status_value: str,
    gps: dict | None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()

    update_expr = "SET #status = :status, updated_at = :updated_at"
    expr_names = {"#status": "status"}
    expr_values = {":status": status_value, ":updated_at": now}

    if display_key is not None:
        update_expr += ", display_key = :display_key"
        expr_values[":display_key"] = display_key

    if gps is not None:
        update_expr += ", latitude = :latitude, longitude = :longitude"
        expr_values[":latitude"] = gps["latitude"]
        expr_values[":longitude"] = gps["longitude"]

    pipeline_table.update_item(
        Key={"image_id": image_id, "sk": "METADATA"},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )