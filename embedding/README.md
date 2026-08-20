# embedding

Shared CLIP-embedding Lambda container image, serving two Lambdas defined in
`terraform/environments/dev/`:

- `embed_known.py` — embeds a newly-added known sticker (triggered on uploads
  to the known-stickers bucket's `known/` prefix).
- `match.py` — embeds a newly-uploaded regular sticker and brute-force
  cosine-matches it against the known-sticker catalog (triggered on the same
  `stickers/` upload event as the ingest Lambda).

One image serves both; each Lambda's `image_config.command` in Terraform
picks the handler.

## First-time deploy (bootstrap order)

A container-image Lambda can't be created before its image exists in ECR, so
the very first deploy of this feature needs this order:

```
cd terraform/environments/dev
terraform apply -target=aws_ecr_repository.embedding   # creates just the empty repo

cd ../../../embedding
./build_and_push.sh                                     # builds + pushes the first real image, prints a tag

cd ../terraform/environments/dev
terraform apply -var="embedding_image_tag=<tag printed above>"   # creates the Lambdas + everything else
```

Every subsequent code change to `embedding/` only repeats the last two
steps — no more `-target` needed once the ECR repo exists.
