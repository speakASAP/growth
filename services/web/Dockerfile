# Build context is the REPOSITORY ROOT, not this directory.
#
# The producer conformance spec validates what this service emits against the schema published by
# the contract document in docs/, so the build needs both trees — the same reason services/core's
# Dockerfile does.
#
#   docker build -f services/web/Dockerfile -t localhost:5000/growth-web:latest .

FROM node:24-slim AS builder

WORKDIR /app/services/web

COPY services/web/package*.json ./
RUN npm ci

COPY services/web/ ./
COPY docs/23_documentation_contracts/schemas/ /app/docs/23_documentation_contracts/schemas/

RUN npm run build

FROM node:24-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

COPY services/web/package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/services/web/dist ./dist
COPY --from=builder /app/services/web/node_modules ./node_modules

EXPOSE ${PORT:-3377}

CMD ["node", "dist/main"]
