# TASK-001 — Bazos naming debt (aukro-service leftovers)

**Status:** open · **Priority:** low — not blocking any milestone · **Owner:** unassigned
**Repo:** `bazos/` · **Raised by:** D-001 verification, 2026-07-18

## Problem

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
