# FocVault – Production-Image (Next.js, Dauerprozess mit FOC-Worker und S3-API)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Native Module (bufferutil, utf-8-validate) brauchen Build-Tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* wird beim Build eingebacken
ARG NEXT_PUBLIC_REOWN_PROJECT_ID=
ENV NEXT_PUBLIC_REOWN_PROJECT_ID=$NEXT_PUBLIC_REOWN_PROJECT_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 DATA_DIR=/data
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000 9000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
