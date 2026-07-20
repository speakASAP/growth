# Build context is the REPOSITORY ROOT, not this directory.
#
# The service validates against the schema published by the contract document in docs/, and
# that schema is the single source of truth — so the build needs both trees. The build stage
# mirrors the repo layout purely so the sync script's relative path resolves the same way it
# does on a developer's machine.
#
#   docker build -f services/core/Dockerfile -t localhost:5000/growth-core:latest .

FROM node:24-slim AS builder

WORKDIR /app/services/core

COPY services/core/package*.json ./
RUN npm ci

COPY services/core/ ./
COPY docs/23_documentation_contracts/schemas/ /app/docs/23_documentation_contracts/schemas/

# prebuild runs sync-schema.js, which fails the build if the contract schema is missing or
# malformed. A service that cannot load the schema it is contracted to enforce must not ship.
RUN npm run build

# Production stage
FROM node:24-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl wget \
  && rm -rf /var/lib/apt/lists/*

COPY services/core/package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/services/core/dist ./dist
COPY --from=builder /app/services/core/node_modules ./node_modules
# Migrations ship with the image: the decision_artefact immutability trigger
# is part of the contract, not an ops step someone remembers to run.
COPY --from=builder /app/services/core/migrations ./migrations
COPY --from=builder /app/services/core/scripts/migrate.js ./scripts/migrate.js

EXPOSE ${PORT:-3376}

CMD ["node", "dist/main"]
