FROM node:24-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:24-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl wget \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Migrations ship with the image: the decision_artefact immutability trigger
# is part of the contract, not an ops step someone remembers to run.
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts/migrate.js ./scripts/migrate.js

EXPOSE ${PORT:-3376}

CMD ["node", "dist/main"]
