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
# change or image rebuild needed. Deliberately low right now (0.65) while
# still calibrating against real matches - two known-good pairs scored
# 0.7365 and 0.7357 against a clean reference, well under the old 0.90
# default that was tuned for whole-photo comparisons, not crops.
THRESHOLD = float(os.environ.get("MATCH_SIMILARITY_THRESHOLD", "0.65"))


def handler(event, context):
    """
    Triggered by an S3 Object Created event delivered via EventBridge (see
    aws_cloudwatch_event_rule.match_on_crop_upload in match_lambda.tf) on
    the crops/<image_id>/<crop_id>.jpg prefix the detect Lambda writes
    (detection/detect.py's die-cut crops) - runs after detect produces
    each crop, not off the original stickers/ upload event directly, so
    this compares isolated single-sticker crops against the known-sticker
    catalog instead of a whole multi-sticker field photo (which
    structurally could never score well against an isolated reference
    image - confirmed with real data before this was wired up). EventBridge
    delivers one event per invocation and detail.object.key is NOT
    url-encoded (unlike the classic S3->Lambda notification format
    ingest/main.py parses).

    Best-effort match-and-log only: never touches an image's METADATA or
    CROP# item (avoiding a write race with ingest/detect running in
    parallel off the same upload), and a failure here is logged, not
    retried or surfaced anywhere else.
    """
    detail = event.get("detail", {})
    bucket = detail.get("bucket", {}).get("name")
    crop_key = detail.get("object", {}).get("key")

    if not bucket or not crop_key:
        print(f"Ignoring event with no bucket/key: {event}")
        return {"statusCode": 200}

    # crop_key looks like "crops/<image_id>/<crop_id>.jpg"
    parts = crop_key.split("/")
    if len(parts) != 3:
        print(f"Ignoring unexpected crop key shape: {crop_key}")
        return {"statusCode": 200}
    image_id, crop_filename = parts[1], parts[2]
    crop_id = crop_filename.rsplit(".", 1)[0]

    try:
        raw = s3_client.get_object(Bucket=bucket, Key=crop_key)["Body"].read()
        query_vec = np.array(common.compute_embedding(raw), dtype=np.float32)

        best = _find_best_match(query_vec)
        if best is not None and best[3] >= THRESHOLD:
            _log_match(image_id, crop_id, *best)
    except Exception as e:
        print(f"Match check failed for {crop_key}: {e}")

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


def _log_match(image_id: str, crop_id: str, sticker_id: str, artist: str, design_name: str, similarity: float) -> None:
    now = datetime.now(timezone.utc).isoformat()
    # PutItem, not UpdateItem - SK is deterministic per (image, known
    # sticker) pair, so re-running match naturally overwrites rather than
    # duplicates. Different crops from the same image can each match a
    # different known sticker (legitimately - a field photo has many
    # stickers), producing multiple MATCH# items under one image_id; if
    # two crops both match the same known sticker, the later one just
    # overwrites - crop_id records which crop produced this result.
    pipeline_table.put_item(
        Item={
            "image_id": image_id,
            "sk": f"MATCH#{sticker_id}",
            "matched_sticker_id": sticker_id,
            "artist": artist,
            "design_name": design_name,
            "similarity": Decimal(str(round(similarity, 4))),
            "match_threshold": Decimal(str(THRESHOLD)),
            "crop_id": crop_id,
            "matched_at": now,
        }
    )
