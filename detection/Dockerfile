FROM public.ecr.aws/lambda/python:3.12

# Pin the HuggingFace cache to a fixed, image-baked path rather than the
# default (~/.cache/huggingface, resolved off $HOME) - the bake step below
# runs as root, but the Lambda runtime executes as a different, unprivileged
# user with a different $HOME, so without this the baked weights land
# somewhere the runtime can't see, and HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE
# don't prevent a (failing) network fallback since the cache just looks
# empty to it. Same fix embedding/Dockerfile applies via
# SENTENCE_TRANSFORMERS_HOME.
ENV HF_HOME=/opt/models

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake OWLv2 weights into the image at build time so cold starts never need
# network access to HuggingFace and stay fast/deterministic (same reasoning
# as embedding/Dockerfile's CLIP bake step).
RUN python -c "from transformers import Owlv2ForObjectDetection, Owlv2Processor; Owlv2Processor.from_pretrained('google/owlv2-base-patch16-ensemble'); Owlv2ForObjectDetection.from_pretrained('google/owlv2-base-patch16-ensemble')"

COPY detect.py ${LAMBDA_TASK_ROOT}/

CMD ["detect.handler"]
