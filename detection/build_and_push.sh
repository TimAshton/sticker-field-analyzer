#!/bin/bash
# Builds and pushes the detection image (detect.py) used by the detect
# Lambda.
#
# Run this from detection/, then re-apply Terraform with the printed tag:
#   cd detection && ./build_and_push.sh
#   cd ../terraform/environments/dev && terraform apply -var="detection_image_tag=<tag printed above>"
#
# Uses a content-addressed tag (git short SHA), not :latest - image_uri is
# what Terraform diffs to decide whether to update the Lambda (there's no
# source_code_hash equivalent for package_type = "Image"), so pushing under
# a mutable tag would leave image_uri unchanged and Terraform would see no
# diff, silently never deploying the new code.

set -e

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-west-2
REPO="sticker-field-analyzer-detection"
TAG=$(git rev-parse --short HEAD)
IMAGE="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO}:${TAG}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
# --provenance=false --sbom=false: Lambda's image parser rejects the
# multi-manifest OCI index Docker's default builder attaches (build
# attestations/SBOM) - without these flags CreateFunction fails with
# "image manifest ... media type ... is not supported".
docker build --platform linux/amd64 --provenance=false --sbom=false -t "$IMAGE" .
docker push "$IMAGE"

echo "Pushed $IMAGE"
echo "Apply with: terraform apply -var=\"detection_image_tag=${TAG}\""
