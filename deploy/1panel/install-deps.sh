#!/bin/sh
set -eu
cd /opt/xiaoelong_web
test -f pnpm-lock.yaml
test -f apps/web/dist/index.html
# Install in Linux; never upload Windows node_modules.
docker run --rm \
  -v /opt/xiaoelong_web:/app -w /app \
  node:22.23.1-bookworm-slim \
  sh -ec 'corepack enable; corepack prepare pnpm@11.7.0 --activate; pnpm install --frozen-lockfile --prod'
