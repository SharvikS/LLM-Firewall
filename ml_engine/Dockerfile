# syntax=docker/dockerfile:1

# Python 3.12-slim is the stable LTS target; 3.14 is fine locally but
# PyPI wheels for compiled deps (thinc, blis) are more reliable on 3.12.
FROM python:3.12-slim AS base

WORKDIR /ml_engine

# ── System deps ──────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# ── Python deps (cached layer) ───────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the spaCy model into the image at build time.
# If we defer this to runtime, the container dies offline or on first start.
RUN python -m spacy download en_core_web_sm

# ── Application code ─────────────────────────────────────────────────────────
COPY . .

ENV PYTHONPATH=/ml_engine
ENV GRPC_PORT=50051

EXPOSE 50051
CMD ["python", "-m", "analyzer.server"]
