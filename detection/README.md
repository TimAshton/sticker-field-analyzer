# detection

Detection/cropping Lambda image, serving the `detect` Lambda defined in
`terraform/environments/dev/detect_lambda.tf`.

- `detect.py` — detects individual stickers in a newly-uploaded field photo
  (OWLv2 zero-shot detection + an OpenCV edge/contour pass to tighten each
  box to the sticker's die-cut outline, ported from `app/`'s local
  prototype), uploads each crop to S3 under `crops/<image_id>/<crop_id>.jpg`,
  and writes a `CROP#<crop_id>` item per crop (`status=pending`). Triggered
  on the same `stickers/` upload event `ingest` and `match` also react to.

Deliberately its own image/ECR repo, not folded into `embedding/` -
`embedding/` embeds with CLIP; this Lambda doesn't embed anything, it only
detects and crops. Matching crops against the known-sticker catalog is
separate, not-yet-wired work.

## First-time deploy (bootstrap order)

A container-image Lambda can't be created before its image exists in ECR, so
the very first deploy of this feature needs this order:

```
cd terraform/environments/dev
terraform apply -target=aws_ecr_repository.detection   # creates just the empty repo

cd ../../../detection
./build_and_push.sh                                     # builds + pushes the first real image, prints a tag

cd ../terraform/environments/dev
terraform apply -var="detection_image_tag=<tag printed above>"   # creates the Lambda + everything else
```

Every subsequent code change to `detection/` only repeats the last two
steps — no more `-target` needed once the ECR repo exists.

**Note:** `embedding_image_tag` defaults to `"latest"` — if you're applying
alongside other pending changes, pass `-var="embedding_image_tag=<currently-deployed tag>"`
too, or a bare apply will silently plan to redeploy `embed_known`/`match` to
whatever `:latest` resolves to in ECR.
