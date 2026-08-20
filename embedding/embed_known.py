import os
import urllib.parse
from datetime import datetime, timezone

import boto3

import common

s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-west-2"))
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))
TABLE_NAME = os.getenv("KNOWN_STICKERS_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
known_stickers_table = dynamodb.Table(TABLE_NAME)


def handler(event, context):
    """
    Triggered by S3 ObjectCreated events on the known/ prefix of the
    known-stickers bucket (see aws_s3_bucket_notification.known_stickers_uploads
    in embed_known_lambda.tf). Computes a CLIP embedding for the newly-added
    reference sticker and marks the catalog entry embedded.
    """
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        # S3 event keys are URL-encoded (e.g. spaces become '+')
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        # key looks like "known/<sticker_id>.<ext>"
        filename = key.split("/")[-1]
        sticker_id = filename.rsplit(".", 1)[0]

        try:
            raw = s3_client.get_object(Bucket=bucket, Key=key)["Body"].read()
            embedding = common.to_decimal_list(common.compute_embedding(raw))
            _update_status(sticker_id, "embedded", embedding=embedding)
        except Exception as e:
            # Log and mark this entry failed rather than raising, so a
            # single bad reference image doesn't retry-loop or block other
            # records in a batch.
            print(f"Failed to embed known sticker {key}: {e}")
            _update_status(sticker_id, "failed")

    return {"statusCode": 200}


def _update_status(sticker_id: str, status_value: str, embedding: list | None = None) -> None:
    now = datetime.now(timezone.utc).isoformat()

    update_expr = "SET #status = :status, updated_at = :updated_at"
    expr_names = {"#status": "status"}
    expr_values = {":status": status_value, ":updated_at": now}

    if embedding is not None:
        update_expr += ", embedding = :embedding"
        expr_values[":embedding"] = embedding

    known_stickers_table.update_item(
        Key={"sticker_id": sticker_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
