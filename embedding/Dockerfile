FROM public.ecr.aws/lambda/python:3.12

ENV SENTENCE_TRANSFORMERS_HOME=/opt/models

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake model weights into the image at build time so cold starts never need
# network access to HuggingFace and stay fast/deterministic.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('clip-ViT-B-32')"

COPY common.py embed_known.py match.py ${LAMBDA_TASK_ROOT}/

# CMD deliberately left unset - each aws_lambda_function in terraform sets
# its own image_config.command (embed_known.handler or match.handler), so
# this one image serves both Lambdas.
