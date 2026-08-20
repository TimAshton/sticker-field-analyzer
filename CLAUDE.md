# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A system for cataloging street stickers: users upload photos of "sticker fields" (walls/posts covered in
stickers), the pipeline extracts individual stickers from the photo, and (eventually) matches them against
a vector-search catalog to identify known designs/artists. Two parts of that are live in AWS today (upload +
display); the detection/matching step is still a local prototype (`app/`), not deployed.

## Repo layout

- `web-app/` — React 19 + TypeScript + Vite frontend (upload UI, sticker book gallery). Deployed to S3 + CloudFront.
- `api/` — FastAPI Lambda (`main.py`) that issues presigned S3 upload URLs and lists display-ready images. Deployed via Function URL (no API Gateway).
- `ingest/` — S3-triggered Lambda (`main.py`) that creates a resized/EXIF-corrected display copy of each upload and extracts GPS from EXIF.
- `app/` — standalone local prototype (YOLO + OWLv2 + CLIP + Qdrant) for detecting and die-cut-cropping individual stickers out of a field photo, and matching crops against a vector catalog. Stays a local sandbox, untouched by the deployed pipeline — run it directly with `python app/src/main.py`, no lambda/terraform involved. `detection/` is the deployed counterpart of its detect-and-crop half (see below); its CLIP-matching half is still prototype-only.
- `detection/` — deployed detect/crop Lambda (Docker-image, like `embedding/`). Reacts to the same `stickers/` upload event as `ingest`/`match`, runs OWLv2 zero-shot detection + an OpenCV edge/contour pass to die-cut-crop each sticker out of the field photo (ported from `app/`'s prototype, YOLO/Qdrant/CLIP dropped — this stage only detects and crops), and writes the resulting crops to S3 plus one `CROP#<crop_id>` DynamoDB item per crop. Does not embed or match crops against the known-sticker catalog — that's still unwired. See `detection/README.md` for the deploy bootstrap order.
- `embedding/` — deployed CLIP-embedding service (Docker-image Lambdas, unlike `api/`/`ingest/`'s zip Lambdas). Serves the known-sticker catalog's "Add Known" embedding step and the brute-force match-on-upload check. See `embedding/README.md` for the deploy bootstrap order.
- `terraform/` — infra as code. `environments/dev` is the only environment actually built out (`prod`/`staging` are empty placeholders). `modules/app_infrastructure` currently only defines a bare VPC and isn't wired into `dev`.

## Commands

### Frontend (`web-app/`)
```
npm run dev       # local dev server
npm run build      # tsc -b && vite build
npm run lint        # eslint .
npm run preview     # preview production build
```
Requires `web-app/.env` with `VITE_PRESIGN_API_URL` pointing at the presign API's Lambda Function URL.

### Backend Lambdas (`api/`, `ingest/`)
No test suite or linter configured for either. Local run of the API:
```
cd api && uvicorn main:app --reload
```
Packaging for deployment (run before `terraform apply` whenever `main.py`/`requirements.txt` change):
```
cd api && ./build_lambda.sh       # -> terraform/environments/dev/lambda_package.zip
cd ingest && ./build_lambda.sh    # -> terraform/environments/dev/ingest_package.zip
```
Each script does a fresh `pip install --target build/ --platform manylinux2014_x86_64 --python-version 3.12 --only-binary=:all:` and zips `build/` + `main.py` — deliberately targeting Lambda's runtime, not the host platform, so don't replace this with a plain `pip install`.

### Embedding service (`embedding/`)
Docker-image Lambdas (`embed-known` and `match`) sharing one image — requires Docker running locally. Build + push before applying Terraform:
```
cd embedding && ./build_and_push.sh
```
Pushes under a content-addressed tag (git short SHA) and prints the `terraform apply -var="embedding_image_tag=..."` command to run next. **Pushing under an unchanged tag does not redeploy** — `image_uri` is what Terraform diffs, and container-image Lambdas have no `source_code_hash` equivalent, so re-pushing the same tag after a code change silently leaves the old code running. If you haven't committed since the last push, pass a manually distinguished tag (e.g. append `-fix1`) rather than relying on the git-SHA tag alone. First-ever deploy needs the bootstrap order in `embedding/README.md` (the ECR repo must exist before an image can be pushed to it, and the Lambdas can't be created before an image exists).

### Detection service (`detection/`)
Docker-image Lambda (`detect`), same pattern as `embedding/` but its own image/ECR repo — requires Docker running locally. Build + push before applying Terraform:
```
cd detection && ./build_and_push.sh
```
Same content-addressed-tag caveat as `embedding/`'s build script: pushing under an unchanged tag does not redeploy. First-ever deploy needs the bootstrap order in `detection/README.md`.

### Infra (`terraform/environments/dev`)
```
terraform init
terraform plan
terraform apply
```
Rebuild the lambda zips first (above) — `source_code_hash` is computed from the zip, so `apply` won't pick up code changes otherwise.

### Deploy
`.github/workflows/deploy.yml` builds and deploys **only the frontend** (`web-app/`) to S3/CloudFront on push to `main`, via GitHub OIDC (no long-lived AWS keys). It also runs `terraform init`/`output` (read-only) to resolve the target bucket/distribution — it does not `apply`. Lambda deploys are manual (`build_lambda.sh` + `terraform apply`).

## Architecture

### Upload → display pipeline
1. Frontend requests a presigned PUT URL from the presign API (`POST /api/get-presigned-url`), which also writes the initial DynamoDB pipeline record (`status=uploaded`) and returns an `image_id` (UUID4, doubles as the S3 key prefix and the DynamoDB partition key).
2. Frontend PUTs the file bytes straight to S3 (`stickers/<image_id>.<ext>`) — the API server never touches image bytes.
3. That S3 write fires an `ObjectCreated` event that invokes the ingest Lambda, which EXIF-transposes, resizes (≤1600px), re-encodes as JPEG, extracts GPS if present, writes `display/<image_id>.jpg`, and flips the pipeline record to `status=display_ready`.
4. Frontend's Sticker Book page (`GET /api/images`) queries DynamoDB's `status-index` GSI for `display_ready` items and gets back presigned GET URLs (1hr TTL) for each — the uploads bucket is private, nothing is ever public.

Detection/cropping — splitting a field photo into individual stickers, ported from `app/`'s prototype — is now wired up via the `detect` Lambda (`detection/detect.py`, see the constraints section below for how it hooks into the same upload event as `ingest`/`match`). It writes `CROP#` items and crop images to S3, but deliberately doesn't touch the image's `METADATA` status (avoiding a write race with `ingest`) and doesn't embed or match crops against the known-sticker catalog yet — matching against crops instead of whole field photos is the logical next step (today's `match` Lambda still only compares whole uploads, which is why match-on-upload rarely scores highly) but is separate, not-yet-wired work.

### Known-sticker catalog + match-on-upload logging
A separate, deployed pipeline for building a reference catalog and flagging matches — see `embedding/` for the code and `known_stickers.tf`/`embed_known_lambda.tf`/`match_lambda.tf` for the infra.

1. **Add Known**: the frontend's Add Known page → `POST /api/get-known-presigned-url` (same presign-Lambda as uploads, different bucket/table) → browser PUTs a single, pre-isolated reference sticker image to `known/<sticker_id>.<ext>` in a dedicated `known-stickers` bucket, plus a DynamoDB row (`status=pending_embedding`) in a dedicated, flat `known-stickers` table (PK `sticker_id` only — no SK/GSI, brute-force `Scan` was a deliberate choice over indexing since this catalog is manually built and stays small).
2. That S3 write directly triggers the `embed-known` Lambda (a normal S3→Lambda notification, since it's the *only* consumer of that bucket's events), which computes a CLIP embedding and flips the row to `status=embedded`.
3. Every regular `stickers/` upload *also* triggers the `match` Lambda (independently and in parallel with `ingest`, same as the two-consumers-per-event pattern above) — but via **EventBridge, not a direct S3 notification** (see the constraint below for why). `match` embeds the raw upload, brute-force cosine-compares it against every `embedded` known sticker, and if the best score clears `MATCH_SIMILARITY_THRESHOLD` (the one tunable env var on the `match` Lambda), logs a `PK=image_id, SK="MATCH#<sticker_id>"` item onto the *existing* pipeline table — nothing currently acts on a match, it's logging only.

### Custom domain
The web app is also reachable at `https://stickers.tashton.com` (Route 53 alias + ACM cert added to the *existing* CloudFront distribution in `domain.tf`/`provider.tf`). Deliberately a subdomain, not a path — DNS can't split traffic by path, and `tashton.com`'s root is owned by a separate repo (`tashton.com-aws`, a bare S3-website-hosted landing page with no CloudFront/HTTPS of its own). This project's Terraform only adds records inside the existing `tashton.com` Route 53 zone (via a `data` lookup); it never takes ownership of the zone or touches `tashton.com-aws`'s resources.

### DynamoDB single-table design (`sticker-field-analyzer-pipeline`)
- PK `image_id`, SK `METADATA` — one item per upload. `status`: `uploaded → display_ready → extracted → enrichment_complete` (or `failed`).
- PK `image_id`, SK `CROP#<crop_id>` — one item per extracted sticker (future; written by the not-yet-built detection stage). `status`: `pending | enriched | failed`.
- GSI `status-index` (hash `status`, range `updated_at`) — used to query "all images at status X", e.g. the API's `display_ready` list. Because METADATA and CROP items use disjoint status vocabularies, a query on an image-status value can never accidentally match a crop item.
- Each Lambda's IAM policy is scoped to the specific DynamoDB actions it needs (presign API: `PutItem` + `Query` on the GSI only; ingest: `UpdateItem` only) — preserve that scoping if you add new access patterns rather than widening an existing policy.

### S3 layout (`sticker-field-analyzer-uploads-*` bucket)
- `stickers/<image_id>.<ext>` — original upload (private).
- `display/<image_id>.jpg` — resized copy the frontend actually renders.
- `crops/<image_id>/<crop_id>.jpg` — individual die-cut sticker crops written by the `detect` Lambda.
Each Lambda's S3 IAM policy is scoped to only the prefix(es) it needs — keep new stages similarly scoped rather than granting bucket-wide access.

### Constraints worth knowing before touching infra
- **S3 supports only one bucket notification config**, AND **it can't route the same `(event type, prefix)` to two different direct Lambda targets** — `PutBucketNotificationConfiguration` rejects that outright as "ambiguously defined," even though the targets differ. `aws_s3_bucket_notification.sticker_uploads` in `ingest_lambda.tf` wires up `ingest` directly; a second consumer of the same `stickers/` `ObjectCreated` events (like `match`) can't get its own `lambda_function` block there. The working pattern (see `match_lambda.tf`): set `eventbridge = true` on that same notification resource, then add an `aws_cloudwatch_event_rule` + `aws_cloudwatch_event_target` per additional consumer. Both delivery mechanisms still fire independently off the same underlying S3 event — the consumers still don't call each other. Note EventBridge's event shape is different from a direct S3 notification's (`event["detail"]["bucket"]["name"]` / `event["detail"]["object"]["key"]`, one event per invocation, key is *not* URL-encoded) — don't reuse `ingest`'s Records-loop parsing code for an EventBridge-triggered handler.
- **Lambda's INIT phase has a hard, non-configurable ~10s timeout**, separate from the function's own `timeout` setting (which only covers the handler invocation). Loading a large model (e.g. CLIP via `sentence-transformers`) at module import time blows past that on cold start. Fix: do the heavy import + construction lazily, inside the handler's first call (behind a module-level cache so warm invocations still reuse it) — see `embedding/common.py`'s `_get_model()`. Even lazy-loaded, also set `HF_HUB_OFFLINE=1` / `TRANSFORMERS_OFFLINE=1` on any Lambda using `sentence-transformers` — without them, `huggingface_hub` tries a network round-trip to check for model updates before falling back to the image-baked cache, which was observed adding enough latency to blow through even a 60s function timeout.
- **CORS is handled entirely at the Lambda Function URL layer** (`cors {}` block in `lambda.tf`), not in FastAPI. Adding `CORSMiddleware` in `api/main.py` would produce duplicate `Access-Control-Allow-Origin` headers, which browsers reject even when the values match.
- The ingest, match, and detect Lambdas all react to the same S3 upload event independently and in parallel — they don't call each other or depend on each other's output. `detect` reaches its EventBridge rule the same way `match` does (see `detect_lambda.tf`/`match_lambda.tf`).
- **CloudFront custom-domain certs must be requested in `us-east-1`**, regardless of the distribution's own region — this is why `provider.tf` has a second, aliased `aws.us_east_1` provider block used only by `domain.tf`'s `aws_acm_certificate`/`aws_acm_certificate_validation`.
- `web-app/.env` and the built lambda zips are gitignored. Terraform state is remote (S3 backend with native S3 locking, `backend.tf`), so the tracked `*.tfstate*` files under `environments/dev/` (also gitignored) are stale local artifacts, not the source of truth.
