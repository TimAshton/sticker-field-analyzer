import os
from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO

import boto3

s3_client = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-west-2"))
dynamodb = boto3.resource("dynamodb", region_name=os.getenv("AWS_REGION", "us-west-2"))

PIPELINE_TABLE_NAME = os.getenv("DYNAMODB_TABLE_NAME", "YOUR_TERRAFORM_COMPUTED_TABLE_NAME")
pipeline_table = dynamodb.Table(PIPELINE_TABLE_NAME)

# Zero-shot detection prompt/threshold/padding, tuned against a real
# multi-sticker field photo (a laptop lid with ~19 stickers). Score alone
# doesn't cleanly separate good boxes from bad ones - e.g. a correct
# 551x447 single-sticker box scored 0.376 while a bad 1329x1030 box
# spanning three unrelated stickers scored 0.343, right next to it. But
# box *area as a fraction of the image* showed a sharp, natural gap: every
# legitimate single-sticker box on that test photo fell under ~8.5% of the
# image area, and every box that had merged multiple stickers together
# jumped straight to 11%-31%. MAX_BOX_AREA_FRACTION exploits that gap
# instead of trying to separate them by score - but only when detect_and_crop
# finds more than one box in the image: a merge is, by definition, a box
# that swallowed other stickers OWLv2 also detected nearby, so the signal
# only means anything relative to sibling boxes. A lone sticker photographed
# by itself (no field around it) legitimately fills most of the frame and
# is the single detection in the image - rejecting that on area alone would
# throw out the exact "player finds one sticker in the wild" case this
# catalog exists to support. DETECTION_THRESHOLD nudged
# up slightly to drop the single weakest, noisiest box in that test run;
# CROP_PADDING brought down since generous padding on a densely-packed
# photo pulls neighboring stickers' edges into the contour-refinement step
# below, which is also what caused a die-cut crop to end up truncated to
# half a sticker in testing (the largest contour found inside the padded
# region wasn't the target sticker's own outline).
DETECTION_TEXTS = [["a street sticker", "a label", "a vinyl decal"]]
DETECTION_THRESHOLD = 0.18
CROP_PADDING = 15
MAX_BOX_AREA_FRACTION = 0.10

# Imported and constructed lazily on first use, not at module scope - see
# embedding/common.py's _get_model() for why (Lambda's ~10s INIT-phase
# timeout is shorter than loading OWLv2's weights takes). Critically this
# also covers the `import torch`/`import cv2` themselves, not just model
# construction - those imports alone are slow enough to blow the INIT
# budget on their own, which is what an earlier version of this file hit
# (INIT_REPORT ... Status: timeout with model construction already lazy).
_owl_processor = None
_owl_model = None


def _get_owl():
    global _owl_processor, _owl_model
    if _owl_model is None:
        from transformers import Owlv2ForObjectDetection, Owlv2Processor
        _owl_processor = Owlv2Processor.from_pretrained("google/owlv2-base-patch16-ensemble")
        _owl_model = Owlv2ForObjectDetection.from_pretrained("google/owlv2-base-patch16-ensemble")
    return _owl_processor, _owl_model


def handler(event, context):
    """
    Triggered by an S3 Object Created event delivered via EventBridge (see
    aws_cloudwatch_event_rule.detect_on_sticker_upload in detect_lambda.tf)
    - a third, independent consumer of the same stickers/ upload event
    ingest and match also react to (see the comment on
    aws_s3_bucket_notification.sticker_uploads in ingest_lambda.tf for why
    this has to be EventBridge, not a direct S3 notification like ingest's).
    EventBridge delivers one event per invocation and detail.object.key is
    NOT url-encoded (unlike the classic S3->Lambda notification format
    ingest/main.py parses).

    Detects individual stickers in the raw field photo, die-cut-crops each
    one, uploads the crops to S3, and writes one CROP# item per crop.
    Deliberately never touches the image's METADATA item - same rationale
    match.py documents, avoiding a write race with ingest running in
    parallel off the same event. Matching crops against the known-sticker
    catalog is a separate, not-yet-wired step - every crop lands as
    status=pending.
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
        crops = detect_and_crop(raw)
        print(f"Detected {len(crops)} sticker(s) in {source_key}")
        for crop_id, crop in enumerate(crops):
            _store_crop(bucket, image_id, crop_id, crop)
    except Exception as e:
        print(f"Detection failed for {source_key}: {e}")

    return {"statusCode": 200}


def detect_and_crop(image_bytes: bytes) -> list[dict]:
    """
    Runs OWLv2 zero-shot detection over the field photo, then refines each
    detected box to the sticker's actual die-cut outline via an edge/contour
    pass. Returns a list of {"crop_bytes", "bbox", "score"} dicts - ported
    from app/src/main.py's scan_street_wall(), adapted to operate on
    in-memory bytes instead of local file paths (Lambda has no writable
    disk worth using here - the crop goes straight to S3).
    """
    import cv2
    import numpy as np
    import torch
    from PIL import Image, ImageOps

    # PyTorch defaults its thread pool to the underlying host's core count,
    # not this Lambda's throttled CPU allocation - in a constrained
    # container that causes thread-contention overhead severe enough to
    # blow a multi-minute timeout on a single forward pass. Pin it down;
    # this Lambda's memory_size (3008MB) maps to roughly 1-2 vCPUs.
    torch.set_num_threads(1)

    processor, model = _get_owl()

    # Apply EXIF orientation before anything else. ingest/main.py's display
    # copy (what the frontend actually renders) is EXIF-transposed too, and
    # the bbox this function stores needs to line up with that same
    # orientation or a match overlay drawn on the display copy would land
    # in the wrong place on a photo with EXIF rotation. cv2.imdecode ignores
    # EXIF entirely, so derive image_cv from the already-corrected PIL image
    # instead of decoding image_bytes a second, uncorrected way.
    image_pil = ImageOps.exif_transpose(Image.open(BytesIO(image_bytes)).convert("RGB"))
    image_cv = cv2.cvtColor(np.array(image_pil), cv2.COLOR_RGB2BGR)

    inputs = processor(text=DETECTION_TEXTS, images=image_pil, return_tensors="pt")
    with torch.no_grad():
        outputs = model(**inputs)

    target_sizes = torch.tensor([image_pil.size[::-1]])
    results = processor.post_process_object_detection(
        outputs, target_sizes=target_sizes, threshold=DETECTION_THRESHOLD
    )
    boxes = results[0]["boxes"]
    scores = results[0]["scores"]
    image_height, image_width = image_cv.shape[:2]
    image_area = image_height * image_width

    crops = []
    for box, score in zip(boxes, scores):
        x1, y1, x2, y2 = map(int, box.tolist())

        # Reject boxes that have merged multiple stickers together - see
        # MAX_BOX_AREA_FRACTION's comment above for why this is a more
        # reliable signal than the score for catching these. Only applies
        # when there's more than one box in the frame - a lone detection is
        # never a "merge", however much of the image it covers.
        box_area_fraction = ((x2 - x1) * (y2 - y1)) / image_area
        if len(boxes) > 1 and box_area_fraction > MAX_BOX_AREA_FRACTION:
            continue

        # Buffer the box safely so we don't truncate a jagged tail edge
        y1_pad = max(0, y1 - CROP_PADDING)
        y2_pad = min(image_cv.shape[0], y2 + CROP_PADDING)
        x1_pad = max(0, x1 - CROP_PADDING)
        x2_pad = min(image_cv.shape[1], x2 + CROP_PADDING)

        rough_crop = image_cv[y1_pad:y2_pad, x1_pad:x2_pad]
        if rough_crop.size == 0 or rough_crop.shape[0] < 50 or rough_crop.shape[1] < 50:
            continue

        # Die-cut masking: pull the sticker's actual outline out of the
        # rough box rather than keeping the rectangular OWLv2 box as-is.
        gray_crop = cv2.cvtColor(rough_crop, cv2.COLOR_BGR2GRAY)
        blurred_crop = cv2.GaussianBlur(gray_crop, (5, 5), 0)
        edges = cv2.Canny(blurred_crop, 30, 150)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        dilated_edges = cv2.dilate(edges, kernel, iterations=1)
        crop_contours, _ = cv2.findContours(dilated_edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if crop_contours:
            largest_contour = max(crop_contours, key=cv2.contourArea)
            cx, cy, cw, ch = cv2.boundingRect(largest_contour)
            if cw > 40 and ch > 40:
                sticker_crop = rough_crop[cy:cy + ch, cx:cx + cw]
            else:
                sticker_crop = image_cv[max(0, y1):min(image_cv.shape[0], y2), max(0, x1):min(image_cv.shape[1], x2)]
        else:
            sticker_crop = image_cv[max(0, y1):min(image_cv.shape[0], y2), max(0, x1):min(image_cv.shape[1], x2)]

        ok, encoded = cv2.imencode(".jpg", sticker_crop)
        if not ok:
            continue

        # Stored as fractions of the (EXIF-corrected) full photo, not raw
        # pixels - the display copy the frontend overlays this onto is a
        # different, resized copy of the same photo, and a fraction is the
        # only representation that lines up with both. This is the original
        # OWLv2 box (pre-padding, pre-contour-refinement), so it's an
        # approximation of the saved crop's extent, not an exact match.
        crops.append({
            "crop_bytes": encoded.tobytes(),
            "bbox": {
                "x1": x1 / image_width,
                "y1": y1 / image_height,
                "x2": x2 / image_width,
                "y2": y2 / image_height,
            },
            "score": float(score),
        })

    return crops


def _store_crop(bucket: str, image_id: str, crop_id: int, crop: dict) -> None:
    crop_key = f"crops/{image_id}/{crop_id}.jpg"
    s3_client.put_object(
        Bucket=bucket,
        Key=crop_key,
        Body=crop["crop_bytes"],
        ContentType="image/jpeg",
    )

    now = datetime.now(timezone.utc).isoformat()
    bbox = crop["bbox"]
    pipeline_table.put_item(
        Item={
            "image_id": image_id,
            "sk": f"CROP#{crop_id}",
            "status": "pending",
            "crop_key": crop_key,
            # 0-1 fractions of the full photo, not pixels - see the comment
            # where detect_and_crop builds this dict. round()+str() avoids
            # Decimal's binary-float-repr surprises on these floats, same as
            # the detection_score field just below.
            "bbox": {
                "x1": Decimal(str(round(bbox["x1"], 6))),
                "y1": Decimal(str(round(bbox["y1"], 6))),
                "x2": Decimal(str(round(bbox["x2"], 6))),
                "y2": Decimal(str(round(bbox["y2"], 6))),
            },
            "detection_score": Decimal(str(round(crop["score"], 4))),
            "created_at": now,
            "updated_at": now,
        }
    )
