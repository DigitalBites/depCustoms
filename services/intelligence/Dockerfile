# syntax=docker/dockerfile:1.7

ARG PYTHON_BASE_IMAGE=python:3.11-slim
FROM ${PYTHON_BASE_IMAGE} AS builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build/services/intelligence

RUN python -m venv "$VIRTUAL_ENV"

COPY services/intelligence/requirements.txt ./
RUN --mount=type=secret,id=pip_conf,target=/etc/pip.conf,required=false \
  pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build/services/intelligence

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  wget \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

COPY services/intelligence/app ./app
COPY services/intelligence/sources ./sources
COPY services/intelligence/scripts ./scripts
COPY services/intelligence/migrations ./migrations
COPY services/intelligence/alembic.ini ./

RUN mkdir -p data

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
