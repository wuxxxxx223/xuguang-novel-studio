# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web ./web
COPY vite.config.mjs ./
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8790 \
    NOVEL_STUDIO_DATA_DIR=/var/lib/novel-studio \
    NOVEL_STUDIO_LIBRARY_ROOT=/library \
    NOVEL_STUDIO_LOG_FORMAT=json \
    NOVEL_STUDIO_NETWORK_BOUNDARY=loopback-published \
    NOVEL_STUDIO_SHUTDOWN_TIMEOUT_MS=30000
WORKDIR /app
RUN install -d -o node -g node -m 0700 /var/lib/novel-studio \
    && install -d -o node -g node -m 0750 /library
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node deploy/healthcheck.mjs ./deploy/healthcheck.mjs
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 8790
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "deploy/healthcheck.mjs"]
CMD ["node", "server/index.mjs"]
