# Production image: Telegram bot + optional HTTP (healthz / future Web App).
# Playwright stays dev-only on Mac for `npm run server:auth`.

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    TZ=UTC \
    WEBAPP_HOST=0.0.0.0 \
    WEBAPP_PORT=8080 \
    PLAUD_DATA_DIR=/app/server/.data \
    PLAUD_EXPORT_ROOT=/app/exports

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        tini \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/

RUN npm ci --omit=dev --workspaces --ignore-scripts \
    && npm cache clean --force

COPY server/src server/src
COPY browser-extension/common browser-extension/common
COPY scripts/smoke_container.mjs scripts/smoke_container.mjs

RUN mkdir -p /app/server/.data /app/exports \
    && chown -R node:node /app/server/.data /app/exports

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f "http://127.0.0.1:${WEBAPP_PORT}/healthz" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/src/cli/index.js", "bot"]
