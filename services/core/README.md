# growth-core

Core service of the growth platform. At present it implements **slice S1a — the decision record**:
an append-only account of why each advertising experiment was launched, why its budget moved, and
why it was killed.

The point is narrow and worth stating plainly: three months after an experiment dies, nobody
remembers why it was launched with that hypothesis, that budget and that audience. That reasoning
is unrecoverable unless it is captured at the moment of the decision. This service captures it and
then refuses to let anyone edit it.

## Contract

Behaviour is governed by the documents in `../../docs/`, not by this code:

- `docs/23_documentation_contracts/C-001-decision-record.md` — the contract
- `docs/10_features/F-001-decision-record-and-governance.md` — behaviour and intent
- `docs/07_decisions/D-004-decision-artefact-shape-and-hash.md` — why the shape is what it is

## API

```
POST /governance/decisions
  201 created · 200 duplicate (same id, identical content) · 409 conflict · 422 invalid

GET  /governance/decisions?experimentId=<id>[&experimentVersion=<v>]
  launch → budget changes → stop, in decided order

GET  /health
```

Three artefact types: `experiment.launch`, `experiment.stop`, `experiment.budget_change`.
`decisionArtefactId` is client-generated, which is what makes a retry safe rather than duplicating.

## Design notes

**Immutability is a database trigger.** An application-layer guarantee disappears the moment a
migration, a psql session, or the next service reaches the table.

**The canonical hash is RFC 8785 (JCS)**, computed over the artefact with `canonicalHash` removed —
deleted, not blanked, since a blanked key still contributes itself to the canonical form. The
standard is external so two implementations can be checked against its published test vectors
rather than against a prose description of our intent.

**The budget chain is verifiable.** A `budget_change` names the artefact whose cap it replaces and
restates that cap; the service rejects a claim that disagrees with the record, and a partial unique
index stops two changes from forking the history.

**No PII, ever.** Artefacts hold references to pseudonymous touchpoints. Immutability and the right
to erasure conflict directly; this is the seam that resolves them — a deletion request severs the
link and leaves the decision history readable.

**No event is published.** Nothing outside this service consumes decisions yet, and emitting one
now would be a speculative integration with no subscriber.

## Development

```bash
npm install
npm run build

./scripts/test-db.sh up     # throwaway Postgres on 55432, migrations applied
npm test                    # 63 tests
./scripts/test-db.sh down
```

Unit tests (`*.spec.ts`) need nothing. Storage tests (`*.db-spec.ts`) need the test database — they
prove the trigger and the unique indexes, which cannot be checked against a mock.

`src/governance/schemas/` is **generated, not authored**: `prebuild` and `pretest` run
`scripts/sync-schema.js`, which copies the schema from the contract. The directory is gitignored,
so a divergent copy cannot be committed. Edit the contract.

## Build context

The image builds from the **repository root**, not this directory — the build regenerates the
schema from `docs/`, so it needs both trees:

```bash
docker build -f services/core/Dockerfile -t localhost:5000/growth-core:latest .
```

Normally you do not run that by hand: `../../scripts/deploy.sh` builds every container in the
repository from `deploy.config.sh`.

## Status

**Not deployed.** Before a first deploy: create the `growth_core` database on the shared
PostgreSQL, and write `DB_PASSWORD` to `secret/prod/growth-core` in Vault.
