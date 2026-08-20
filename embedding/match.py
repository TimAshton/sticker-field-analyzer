import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
import numpy as np
from boto3.dynamodb.conditions import Attr

import common

s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-west-2"))
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))

KNOWN_TABLE_NAME = os.getenv("KNOWN_STICKERS_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
known_stickers_table = dynamodb.Table(KNOWN_TABLE_NAME)

PIPELINE_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
pipeline_table = dynamodb.Table(PIPELINE_TABLE_NAME)

# The single tunable location for this value is match_lambda.tf's
# environment.variables block - change it there and re-apply, no code
# change or image rebuild needed.
THRESHOLD = float(os.environ.get("MATCH_SIMILARITY_THRESHOLD", "0.90"))


def handler(event, context):
    """
    Triggered by an S3 Object Created event delivered via EventBridge (see
    aws_cloudwatch_event_rule.match_on_sticker_upload in match_lambda.tf),
    not a direct S3 notification like ingest - S3 rejects a second direct
    Lambda trigger on the same (event, prefix) as ingest's existing one.
    EventBridge delivers one event per invocation (no Records batch like
    direct S3 notifications), and detail.object.key is NOT url-encoded
    (unlike the classic S3->Lambda notification format ingest/main.py
    parses) - runs independently and in parallel with ingest, so this reads
    the raw stickers/ object directly rather than ingest's display/ copy,
    which may not exist yet.

    Best-effort match-and-log only: never touches an image's METADATA item
    (avoiding a write race with ingest on the same key), and a failure here
    is logged, not retried or surfaced anywhere else.
    """
    detail = event.get("detail", {})
    bucket = detail.get("bucket", {}).get("name")
    source_key = detail.get("object", {}).get("key")

    if not bucket or not source_key:
        print(f"Ignoring event with no bucket/key: {event}")
        return {"statusCode": 200}

    # source_key looks like "stickers/<image_id>.<ext>"
    filename = source_key.split("/")[-1]
    image_id = filename.rsplit(".", 1)[0]

    try:
        raw = s3_client.get_object(Bucket=bucket, Key=source_key)["Body"].read()
        query_vec = np.array(common.compute_embedding(raw), dtype=np.float32)

        best = _find_best_match(query_vec)
        if best is not None and best[3] >= THRESHOLD:
            _log_match(image_id, *best)
    except Exception as e:
        print(f"Match check failed for {source_key}: {e}")

    return {"statusCode": 200}


def _find_best_match(query_vec: np.ndarray):
    """Returns (sticker_id, artist, design_name, similarity) for the best
    match, or None if the catalog has no embedded entries yet."""
    best = None
    for item in _scan_embedded_known_stickers():
        candidate = np.array([float(x) for x in item["embedding"]], dtype=np.float32)
        similarity = common.cosine_similarity(query_vec, candidate)
        if best is None or similarity > best[3]:
            best = (item["sticker_id"], item["artist"], item["design_name"], similarity)
    return best


def _scan_embedded_known_stickers():
    kwargs = {"FilterExpression": Attr("status").eq("embedded")}
    while True:
        resp = known_stickers_table.scan(**kwargs)
        yield from resp.get("Items", [])
        if "LastEvaluatedKey" not in resp:
            return
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]


def _log_match(image_id: str, sticker_id: str, artist: str, design_name: str, similarity: float) -> None:
    now = datetime.now(timezone.utc).isoformat()
    # PutItem, not UpdateItem - SK is deterministic per (image, known
    # sticker) pair, so re-running match naturally overwrites rather than
    # duplicates.
    pipeline_table.put_item(
        Item={
            "image_id": image_id,
            "sk": f"MATCH#{sticker_id}",
            "matched_sticker_id": sticker_id,
            "artist": artist,
            "design_name": design_name,
            "similarity": Decimal(str(round(similarity, 4))),
            "match_threshold": Decimal(str(THRESHOLD)),
            "matched_at": now,
        }
    )
