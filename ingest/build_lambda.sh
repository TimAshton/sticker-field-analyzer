#!/bin/bash
# Packages ingest/main.py plus Pillow into a zip file that
# terraform/environments/dev/ingest_lambda.tf deploys to AWS Lambda.
#
# Run this from the ingest/ directory before `terraform apply` whenever
# main.py or requirements.txt changes:
#   cd ingest && ./build_lambda.sh

set -e

BUILD_DIR="build"
ZIP_FILE="$(cd .. && pwd)/terraform/environments/dev/ingest_package.zip"

rm -rf "$BUILD_DIR" "$ZIP_FILE"
mkdir -p "$BUILD_DIR"

pip install -r requirements.txt --target "$BUILD_DIR" --platform manylinux2014_x86_64 \
  --implementation cp --python-version 3.12 --only-binary=:all: --upgrade

cp main.py "$BUILD_DIR/"

cd "$BUILD_DIR"
zip -r "$ZIP_FILE" . -x "*.pyc" -x "__pycache__/*"
cd ..

echo "Built $ZIP_FILE"