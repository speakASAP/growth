# SYSTEM.md — growth-core

## Identity
- Service: `growth-core`
- Port: **3376** (ClusterIP only, no public ingress)
- Namespace: `statex-apps`
- Reserved sibling: 3377 → `growth-web` (slice S5)

## Stack
NestJS 10 · TypeScript (strict) · PostgreSQL (`pg`, plain SQL migrations) · Node 24

## Storage
Database `growth_core` on the shared PostgreSQL (192.168.88.53:5432).
Schema `governance`, table `decision_artefact` — append-only, enforced by trigger.
Migrations run as a K8s init container, so a pod cannot serve writes against a schema
that lacks the immutability trigger.

## Environment variables
See `.env.example`. Non-secret config → ConfigMap; `DB_PASSWORD` → Vault via ExternalSecret.

## Deploy
`./scripts/deploy.sh` — shim into `shared/scripts/deploy.sh`, driven by `deploy.config.sh`.
Manifests: configmap, external-secret, deployment, service. No ingress.

## Health
`GET /health` → 200, body reports `database: up|down`.
