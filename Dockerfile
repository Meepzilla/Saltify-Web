# Multi-stage Dockerfile for 100% self-hosted Saltify Web PWA
# Includes self-hosted ONNX Runtime WASM (/ort/) and mounts optional
# self-hosted Whisper models at /srv/models (via docker-compose.yml).

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV SALTIFY_SELF_HOSTED_ORT=1
RUN npm run build

FROM caddy:2-alpine
COPY --from=builder /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# Optional mount point for self-hosted Whisper models downloaded with `npm run models:download`
RUN mkdir -p /srv/models

EXPOSE 80 443
