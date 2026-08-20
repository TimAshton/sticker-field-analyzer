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
- `app/` — standalone local prototype (YOLO + OWLv2 + CLIP + Qdrant) for detecting and die-cut-cropping individual stickers out of a field photo, and matching crops against a vector catalog. Not yet wired into the deployed pipeline or the DynamoDB schema — run it directly with `python app/src/main.py`, no lambda/terraform involved.
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

Detection/cropping/matching (what `app/` prototypes) is the next pipeline stage but isn't hooked up yet — there's no Lambda, no S3 trigger, and no DynamoDB write path for `CROP#` items in the deployed code, even though the schema below already reserves space for it.

### DynamoDB single-table design (`sticker-field-analyzer-pipeline`)
- PK `image_id`, SK `METADATA` — one item per upload. `status`: `uploaded → display_ready → extracted → enrichment_complete` (or `failed`).
- PK `image_id`, SK `CROP#<crop_id>` — one item per extracted sticker (future; written by the not-yet-built detection stage). `status`: `pending | enriched | failed`.
- GSI `status-index` (hash `status`, range `updated_at`) — used to query "all images at status X", e.g. the API's `display_ready` list. Because METADATA and CROP items use disjoint status vocabularies, a query on an image-status value can never accidentally match a crop item.
- Each Lambda's IAM policy is scoped to the specific DynamoDB actions it needs (presign API: `PutItem` + `Query` on the GSI only; ingest: `UpdateItem` only) — preserve that scoping if you add new access patterns rather than widening an existing policy.

### S3 layout (`sticker-field-analyzer-uploads-*` bucket)
- `stickers/<image_id>.<ext>` — original upload (private).
- `display/<image_id>.jpg` — resized copy the frontend actually renders.
Each Lambda's S3 IAM policy is scoped to only the prefix(es) it needs — keep new stages similarly scoped rather than granting bucket-wide access.

### Constraints worth knowing before touching infra
- **S3 supports only one bucket notification config.** `aws_s3_bucket_notification.sticker_uploads` in `ingest_lambda.tf` currently only wires up the ingest Lambda. A future detection Lambda's trigger must be added as another `lambda_function` block inside *that same resource*, not a second `aws_s3_bucket_notification` — a second one silently replaces the first instead of adding to it.
- **CORS is handled entirely at the Lambda Function URL layer** (`cors {}` block in `lambda.tf`), not in FastAPI. Adding `CORSMiddleware` in `api/main.py` would produce duplicate `Access-Control-Allow-Origin` headers, which browsers reject even when the values match.
- The ingest Lambda and the (future) detection Lambda both react to the same S3 upload event independently and in parallel — they don't call each other or depend on each other's output.
- `web-app/.env` and the built lambda zips are gitignored. Terraform state is remote (S3 backend with native S3 locking, `backend.tf`), so the tracked `*.tfstate*` files under `environments/dev/` (also gitignored) are stale local artifacts, not the source of truth.
