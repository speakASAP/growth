# CLAUDE.md — growth-core

Shared rules: `/home/ssf/.claude/CLAUDE.md` · `/home/ssf/Documents/Github/CLAUDE.md` ·
`/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`

**Planning and contracts live in the `growth` repo, not here.** Read those before changing behaviour:

| Document | What it governs |
|---|---|
| `growth/docs/08_roadmap/DELIVERY_PLAN.md` | Slice order, milestones, gates |
| `growth/docs/23_documentation_contracts/C-001-decision-record.md` | The decision-record contract this service implements |
| `growth/docs/10_features/F-001-decision-record-and-governance.md` | Behaviour and validation intent |
| `growth/docs/07_decisions/D-004-decision-artefact-shape-and-hash.md` | Why the artefact has the shape it has |

## Stack

NestJS 10, TypeScript (strict), PostgreSQL via `pg` with plain SQL migrations.

No ORM by choice: the contract requires an immutability trigger and two partial unique indexes,
which are written by hand under any ORM, and a mapping layer buys little for one append-only table.

## Port

3376 — **ClusterIP only, no ingress**. `POST /governance/decisions` writes the record of why money
was spent and S1a ships no authentication; absence of a public route is the access control until
S1b adds an authenticated surface. Reserved: 3377 for `growth-web` (slice S5).

## Endpoints

```
POST /governance/decisions          201 created · 200 duplicate · 409 conflict · 422 invalid
GET  /governance/decisions?experimentId=<id>[&experimentVersion=<v>]
GET  /health
```

## Commands

```bash
npm run build
npm test                 # 63 tests; db-specs need the test database below
./scripts/test-db.sh up  # throwaway Postgres on 55432 + migrations
./scripts/test-db.sh down
npm run migrate          # apply migrations against DATABASE_URL / DB_* env
./scripts/deploy.sh      # shim into shared/scripts/deploy.sh
```

## Invariants that must not be softened

- **`decision_artefact` is append-only**, enforced by a Postgres trigger. Corrections create a new
  artefact. Do not add an update path.
- **The canonical hash is RFC 8785 (JCS)** over the artefact with `canonicalHash` removed. Do not
  hand-roll canonicalisation; do not blank the key instead of deleting it.
- **The JSON schema in `src/governance/schemas/` is a copy of the contract's published schema.**
  If it changes here without changing there, the document and the service have diverged.
- **Money is a decimal string**, never a number.
- **Blank free-text fields are rejected, not defaulted** — a defaulted `reason` looks complete and
  carries nothing.
- **No PII in artefacts** — references only, so an erasure request severs a link and leaves the
  decision history intact.

## Integrations

None yet. S1a defines no event because nothing outside this service consumes decisions at MS-002;
adding one before a consumer exists is the speculative integration the slice scope rule forbids.

## Health

`GET /health` → 200 while the process is up, with `database: up|down` in the body. Liveness must not
restart the pod because Postgres blipped.
