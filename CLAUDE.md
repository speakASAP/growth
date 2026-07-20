# CLAUDE.md — growth

Shared rules: `/home/ssf/.claude/CLAUDE.md` · `/home/ssf/Documents/Github/CLAUDE.md` ·
`/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`

AI Growth experimentation platform. **One repository, several containers.** The contracts and
the code implementing them live together; splitting them across repositories is what lets a
document and its implementation drift apart unnoticed.

```
docs/            plan, decisions, contracts, validation — the authority for behaviour
services/core/   growth-core  :3376  ClusterIP only     (S1a — code complete, not deployed)
services/web/    growth-web   :3377  public via ingress (S5 — not written yet)
k8s/             manifests for every container
deploy.config.sh one deploy for the platform
```

## Read before changing behaviour

| Document | What it governs |
|---|---|
| `docs/08_roadmap/DELIVERY_PLAN.md` | Slice order, milestones, gates |
| `docs/23_documentation_contracts/C-001-decision-record.md` | The decision-record contract `services/core` implements |
| `docs/10_features/F-001-decision-record-and-governance.md` | Behaviour and validation intent |
| `docs/07_decisions/D-004-decision-artefact-shape-and-hash.md` | Why the artefact has the shape it has |

Documentation → contracts → validation → code, in that order. Gates per slice:
SPIKE → DOC → CONTRACT → IMPL → VERIFY.

## services/core — stack

NestJS 10, TypeScript (strict), PostgreSQL via `pg` with plain SQL migrations.

No ORM by choice: the contract requires an immutability trigger and two partial unique indexes,
which are written by hand under any ORM, and a mapping layer buys little for one append-only table.

## Exposure

`growth-core` is **ClusterIP only, no ingress**. `POST /governance/decisions` writes the record of
why money was spent and S1a ships no authentication; absence of a public route is the access
control until S1b adds an authenticated surface.

When S5 adds `growth-web`, the ingress arrives with it and routes `growth.alfares.cz/` to the web
container only. Sharing a repository does not put a container on the internet — only a path in an
ingress does that. See `auth-microservice/k8s/ingress.yaml` for the path-routing pattern.

## Endpoints (growth-core)

```
POST /governance/decisions          201 created · 200 duplicate · 409 conflict · 422 invalid
GET  /governance/decisions?experimentId=<id>[&experimentVersion=<v>]
GET  /health
```

## Commands

```bash
cd services/core
npm run build            # prebuild regenerates the schema from the contract
npm test                 # 149 tests; db-specs need the test database below
./scripts/test-db.sh up  # throwaway Postgres on 55432 + migrations
./scripts/test-db.sh down
npm run migrate          # apply migrations against DATABASE_URL / DB_* env

# from the repo root
./scripts/deploy.sh                             # builds every container
../shared/scripts/deploy.sh growth --dry-run    # prove config changes first
```

## Invariants that must not be softened

- **`decision_artefact` is append-only**, enforced by a Postgres trigger. Corrections create a new
  artefact. Do not add an update path.
- **The application never owns its own schema.** `growth_core_owner` owns everything and is used
  only by the migrate init container; `growth_core` is the runtime role and holds DML grants only.
  A table owner can `DISABLE TRIGGER` whatever the trigger body says, so an application connected
  as owner can switch off the append-only guarantee, rewrite history, and switch it back on.
  Every migration creating a table must grant the runtime role explicitly — grants are written per
  table rather than via `ALTER DEFAULT PRIVILEGES`, so a forgotten grant fails loudly instead of
  silently handing UPDATE/DELETE to an append-only table. Guarded by
  `src/db/role-privileges.db-spec.ts`.
- **The canonical hash is RFC 8785 (JCS)** over the artefact with `canonicalHash` removed. Do not
  hand-roll canonicalisation; do not blank the key instead of deleting it.
- **`services/core/src/governance/schemas/` is generated and gitignored.** `scripts/sync-schema.js`
  copies it from `docs/23_documentation_contracts/schemas/` before every build and test run. Edit
  the contract, never the copy — that is what makes drift impossible rather than merely unlikely.
- **Money is a decimal string**, never a number.
- **Blank free-text fields are rejected, not defaulted** — a defaulted `reason` looks complete and
  carries nothing.
- **No PII in artefacts** — references only, so an erasure request severs a link and leaves the
  decision history intact.

## Integrations

**RabbitMQ — `growth.events`** (topic, durable; routing key = event type). The ingest buffer
drains onto it every 5s. Publishing uses a confirm channel: the drain retires a row on `publish()`
resolving, so that must mean the broker durably has the message, never just that the bytes reached
the socket.

⚠️ A topic exchange discards a message with no matching binding. Nothing consumes `growth.events`
yet — the first consumer must declare its queue and binding **before** the producer it depends on
goes live, or events will be marked published and be gone.

S1a defines no event: nothing outside this service consumes decisions at MS-002, and adding one
before a consumer exists is the speculative integration the slice scope rule forbids.

## Health

`GET /health` → 200 while the process is up, with `database: up|down` in the body. Liveness must not
restart the pod because Postgres blipped.
