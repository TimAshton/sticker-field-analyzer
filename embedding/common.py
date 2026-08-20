from decimal import Decimal
from io import BytesIO

import numpy as np
from PIL import Image

# Imported and constructed lazily on first use, not at module scope - Lambda's
# INIT phase has a hard, non-configurable 10s timeout (separate from the
# function's own `timeout` setting, which only governs the handler
# invocation), and importing sentence_transformers/torch plus loading CLIP's
# weights takes longer than that on a cold start. Still cached in this
# module-level global, so it's loaded once per execution environment and
# reused across warm invocations - just during the (60s-budgeted) first
# invocation instead of the 10s-budgeted init phase.
_clip_model = None


def _get_model():
    global _clip_model
    if _clip_model is None:
        from sentence_transformers import SentenceTransformer
        _clip_model = SentenceTransformer("clip-ViT-B-32")
    return _clip_model


def compute_embedding(image_bytes: bytes) -> list[float]:
    with Image.open(BytesIO(image_bytes)) as img:
        img = img.convert("RGB")
        return _get_model().encode(img).tolist()


def to_decimal_list(vector: list[float]) -> list[Decimal]:
    # DynamoDB's boto3 resource layer requires Decimal, not float - same
    # pattern ingest/main.py uses for GPS coordinates. Rounding to 8 places
    # keeps each item well under DynamoDB's 400KB cap (512 floats is ~5KB).
    return [Decimal(str(round(float(x), 8))) for x in vector]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    # Normalize explicitly rather than assuming clip_model.encode() already
    # returns unit-normalized vectors - correctness shouldn't depend on that
    # sentence-transformers implementation detail.
    a_norm = a / np.linalg.norm(a)
    b_norm = b / np.linalg.norm(b)
    return float(np.dot(a_norm, b_norm))
