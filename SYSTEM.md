# SYSTEM.md — growth

## Identity

AI Growth experimentation platform. One repository, several containers.

| Container | Source | Port | Exposure | State |
|---|---|---|---|---|
| `growth-core` | `services/core/` | 3376 | ClusterIP only, no ingress | code complete (S1a), not deployed |
| `growth-web` | `services/web/` | 3377 | public, `growth.alfares.cz` | not written yet (S5) |

Namespace: `statex-apps`.

## Stack

NestJS 10 · TypeScript (strict) · PostgreSQL (`pg`, plain SQL migrations) · Node 24

## Storage

Database `growth_core` on the shared PostgreSQL (`db-server-postgres:5432`, in-cluster).
Schema `governance`, table `decision_artefact` — append-only, enforced by trigger.
Migrations run as a K8s init container, so a pod cannot serve writes against a schema
that lacks the immutability trigger.

**Connects as the dedicated role `growth_core`, not the shared `dbadmin` superuser** — a
deliberate deviation from the ecosystem convention. The append-only guarantee is a trigger, and
a superuser can `ALTER TABLE ... DISABLE TRIGGER`; a service that can switch off its own audit
guarantee does not really have one. The role is `NOSUPERUSER NOCREATEDB NOCREATEROLE` and owns
only the `growth_core` database. It can still *connect* to other databases (PostgreSQL grants
`CONNECT` to `PUBLIC` by default) but has read access to zero tables in any of them — verified
across all 39 on 2026-07-20.

## Contract coupling

`services/core/src/governance/schemas/` is generated from
`docs/23_documentation_contracts/schemas/` before every build and test run, and is gitignored.
The contract document holds the only copy of the schema, and the build fails if it is missing or
malformed. This is the reason the code and the documents share a repository.

## Environment variables

See `services/core/.env.example`. Non-secret config → ConfigMap; `DB_PASSWORD` → Vault via
ExternalSecret (`secret/prod/growth-core`).

## Deploy

`./scripts/deploy.sh` — shim into `shared/scripts/deploy.sh`, driven by `deploy.config.sh` at the
repo root, which builds every container in the repository.
Manifests: configmap, external-secret, deployment, service. No ingress until S5.

## Health

`GET /health` → 200, body reports `database: up|down`.
