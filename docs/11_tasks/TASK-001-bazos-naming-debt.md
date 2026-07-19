# TASK-001 — Bazos naming debt (aukro-service leftovers)

**Status:** closed — resolved 2026-07-18 in `bazos@6e19f10` · **Priority:** low — not blocking any milestone
**Repo:** `bazos/` · **Raised by:** D-001 verification, 2026-07-18

## ✅ Resolved

Verified 2026-07-19:

```
bazos/services/bazos-service/     ← renamed
grep -ril "aukro" src/            ← no matches
```

The directory, module paths and source references are all clean. Closed without action on our side.

---

## Problem (historical)

`bazos-service` was scaffolded from `aukro-service` and the names were never changed. The **business logic is genuinely Bazos** (verified: 27 references to `bazos.cz` paths, zero to `aukro.cz`), but the directory, module and build names still say aukro.

This is not a dead directory — it is **live build configuration**. The deployed image builds from `services/aukro-service`.

## Sites to change

| File / path | Current | Target |
|---|---|---|
| `services/aukro-service/` | dir name | `services/bazos-service/` |
| `services/aukro-service/src/aukro/` | dir name | `src/bazos/` |
| `package.json` `description` | "Aukro.cz sales channel service - marketplace integration" | Bazos classifieds automation |
| `Dockerfile` | `COPY services/aukro-service ./services/aukro-service` + 3× `WORKDIR /app/services/aukro-service` | bazos paths |
| `scripts/verify-orders-lifecycle-ui.js` | references | update |

## Risk

The Dockerfile is on the critical build path. A rename that misses one `WORKDIR` produces an image that builds but ships nothing, or fails at runtime rather than at build time.

## Validation required

1. `docker build` succeeds
2. Image starts and `/health` responds
3. `verify-bazos-provider-proof-gate.js` and `verify-business-health-bazos-channel-contract.js` still pass
4. Deployed pod serves the same routes as before

**Do not treat this as a `git mv`.** It is a build change requiring a rebuild + smoke test.

## Why it matters beyond tidiness

Stale names cost real time: this exact ambiguity made "does Bazos have its own revenue path?" unanswerable at a glance during growth-platform planning, and produced a false suspicion that had to be disproved by reading the source.

## Resolution — 2026-07-18, commit `bazos@6e19f10`

Renamed across source, build config and documentation (101 files). Deployed to production as
`localhost:5000/bazos-service:6e19f10`; pod `bazos-service-6b66749c46-fkvtw` Ready 1/1, 0 restarts.

### Correction to "Sites to change"

The proposed target `src/aukro/` → `src/bazos/` **was wrong and would not compile**. `@bazos/shared`
already exports a `BazosModule`, and `AukroModule → BazosModule` collided with it —
`tsc` failed with `TS2300: Duplicate identifier 'BazosModule'` in `app.module.ts`.

These are two genuinely different modules: the shared one owns the real Bazos domain
(identity, ads, publisher, monitoring, catalog); the service-local scaffold owns
accounts/offers/orders. Resolved by naming the local one `ChannelModule` in `src/channel/`.

This is the concrete form the "do not treat this as a `git mv`" risk actually took — the
break surfaced at compile time, not at runtime.

### Validation performed

| Required | Result |
|---|---|
| `docker build` succeeds | pass |
| Image starts and `/health` responds | pass in production (local run blocked: Prisma needs cluster DNS `db-server-postgres:5432`) |
| `verify-bazos-provider-proof-gate.js`, `verify-business-health-bazos-channel-contract.js` | pass — all 6 repo verifiers pass |
| Deployed pod serves the same routes as before | pass — `/health` `/` `/client` `/ui/app.js` `/favicon.ico` 200; `/api/bazos/*` and `/ui/auth/me` 401 unauthenticated; `/bazos/business-health/channel-readback` 200 |

`npm test`: 131/132. The one failure (`shared/bazos/ad/bazos-ad.service.spec.ts`, managed-listing
refresh) pre-dates this work and is unrelated — no file under `shared/` was modified except the
`package.json` description.

### Deliberately left unchanged

13 references to Aukro remain in `bazos/` docs. They denote the **actual neighbouring marketplace**
and the sibling `aukro/` repository (e.g. "Keep Allegro, Aukro, and Bazos as operator/channel
publication surfaces"), not naming debt. Replacing them would have made the documents false.

One open item worth a look: `reports/validation/2026-07-03-goal24-bazos-order-affinity-replay-producer.md`
records `[MISSING: Marketing parser source allowlist for aukro-service/bazos-service]`. If Marketing
keys an allowlist on this service's directory or image name, the rename may affect it — not verifiable
from inside `bazos/`.

### Rollout note

The rollout stalled ~12 minutes on `FailedCreatePodSandBox: DeadlineExceeded`, then
`failed to reserve sandbox name`. Cause was node-wide, not this change: `catalog-contract-monitor`,
`cliplot-readiness-monitor`, `domain-research-*` and `warehouse-reservation-expiry` were stuck
simultaneously while node `alfares` stayed `Ready` with no resource pressure. containerd released the
reservation on its own. The same pattern is recorded for Goal 10 in `bazos/docs/IMPLEMENTATION_STATE.md:91`
— it recurs on this node. No outage: the old pod served until the new one was Ready.
