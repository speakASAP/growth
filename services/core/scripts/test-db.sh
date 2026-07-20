#!/bin/bash
# Throwaway Postgres for the *.db-spec.ts suite.
#
# Local and disposable on purpose: the db-specs TRUNCATE between tests and prove a trigger
# that rejects UPDATE/DELETE, which is not something to point at a shared database.
set -euo pipefail

NAME="growth-core-testdb"
PORT="${TEST_DB_PORT:-55432}"
export DATABASE_URL="postgresql://testuser:testpw@127.0.0.1:${PORT}/growth_core_test"

case "${1:-up}" in
  up)
    if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
      echo "$NAME already running"
    else
      docker run -d --rm --name "$NAME" \
        -e POSTGRES_PASSWORD=testpw -e POSTGRES_USER=testuser -e POSTGRES_DB=growth_core_test \
        -p "${PORT}:5432" postgres:16-alpine >/dev/null
      echo "started $NAME on ${PORT}"
    fi
    for _ in $(seq 1 30); do
      docker exec "$NAME" pg_isready -U testuser -d growth_core_test >/dev/null 2>&1 && break
      sleep 1
    done
    node "$(dirname "$0")/migrate.js"
    ;;
  down)
    docker stop "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "$NAME not running"
    ;;
  *)
    echo "usage: $0 [up|down]" >&2
    exit 1
    ;;
esac
