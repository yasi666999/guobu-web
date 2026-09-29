FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data \
    PYTHONIOENCODING=utf-8 \
    OCR_LANGUAGES=chi_sim+eng

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      python3 \
      python3-pip \
      poppler-utils \
      tesseract-ocr \
      tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY python/requirements-core.txt /tmp/requirements-core.txt
RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/requirements-core.txt

COPY package.json schema.sql ./
COPY src ./src
COPY public ./public
COPY python ./python
COPY scripts ./scripts
COPY data-packs ./data-packs
COPY view_database.py ./

RUN mkdir -p /app/data /app/exports \
    && chown -R node:node /app

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
