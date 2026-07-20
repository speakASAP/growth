# EP-005 — Execution plan: landing and durable ingestion

**Slice:** S5 · **Gate:** ③ IMPL · **Feature:** [F-005](../10_features/F-005-landing-and-ingestion.md) · **Contract:** [C-005](../23_documentation_contracts/C-005-landing-and-ingestion.md)
**Standard:** `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md` §Parallel Work
**Integration owner:** Claude · **Validation owner:** Claude + owner manual check
**Date:** 2026-07-19

---

## Objective

A visitor clicks a Google ad → lands on the experiment page → registers → the registration is traceable to the exact ad, keyword and landing version, with consent recorded, surviving a `growth-core` restart.

---

## ⚠️ Read this before assigning any worker

Reading the code changed the shape of this slice twice. Both corrections are already in F-005; they are repeated here because a worker who starts from the original assumption will build the wrong thing.

**1. `bazos-service` does not own registration.** It redirects to `auth-microservice` ("Alfares Auth"). It has no registration backend.

**2. `auth-microservice` emits no events at all.** No RabbitMQ, no amqp, no publisher anywhere in `src/`. Registration currently produces a log line.

**So the conversion signal has no producer today.** W3 below is the largest task in the slice, not the trivial "add an emit" the contract first implied.

**3. TASK-001 (bazos aukro naming debt) is done** — `services/bazos-service/`, no `aukro` references remain in `src/`. Close it.

---

## Workers

Five bounded workstreams. No two touch the same file.

### W1 — `growth-core` ingestion and attribution

| | |
|---|---|
| **Role** | Worker agent |
| **Output** | Ingestion endpoint, buffer, drain worker, touchpoint store, identity link, attribution read model |
| **Allowed** | `growth/src/**` (new), `growth/migrations/**` (new), `growth/package.json`, `growth/k8s/**` |
| **Forbidden** | Every other repository. `growth/docs/**` — docs are integration-owner territory |
| **Depends on** | C-005 §1, §3, §5, §6 |
| **Evidence** | Idempotency test, ack-ordering test, failure-injection test, retention job test |

### W2 — `growth-web` landing runtime

| | |
|---|---|
| **Role** | Worker agent |
| **Output** | Clone of `bazos.alfares.cz` with variant routing, consent gate, `gsid` cookie, touchpoint emission |
| **Allowed** | `growth-web/**` (new repository) |
| **Forbidden** | `growth/src/**`, `bazos/**`, `leads-microservice/**` |
| **Depends on** | W1 endpoint deployed (contract is enough to start; deployment needed to verify) |
| **Evidence** | Producer schema-conformance test; consent-refusal path leaves no cookie |

### W3 — `auth-microservice` registration event ⚠️ largest task

| | |
|---|---|
| **Role** | Worker agent — **most senior, shared infrastructure** |
| **Output** | Emit a **generic** `auth.user.registered.v1` on successful registration |
| **Allowed** | `auth-microservice/src/auth/**`, `auth-microservice/src/events/**` (new), `auth-microservice/package.json` |
| **Forbidden** | `auth-microservice/src/{admin,roles,users,applications}/**` — unrelated blast radius |
| **Depends on** | Nothing — can start immediately |
| **Evidence** | Event emitted on register; **no regression in existing auth flows**; schema conformance |

> **Design constraint, non-negotiable.** `auth-microservice` is shared by the whole ecosystem. The event it emits must be **generic** — user id, timestamp, application/context, correlation id. It must **not** contain `gsid`, `experimentId`, or any growth concept.
>
> Growth correlates on its own side. Putting marketing attribution into the ecosystem's auth service would couple every future consumer to this experiment, and there is no way to undo that quietly later.
>
> `gsid` reaches growth through W4, not through auth.
>
> **Upheld 2026-07-20.** A draft of [D-005](../07_decisions/D-005-gsid-propagation-correction.md) §1
> would have put `gsid` in this event; the owner rejected that in favour of the two-event join, and
> D-005 §3 now records it. Contract: [C-005](../23_documentation_contracts/C-005-landing-and-ingestion.md)
> §2.2b, schema `schemas/user.registered.v1.json`. The C-005 §7 test *"Auth event genericity"*
> exists to keep this constraint from eroding — it asserts the payload carries no growth field.

### W4 — `bazos-service` gsid pass-through

| | |
|---|---|
| **Role** | Worker agent |
| **Output** | Read `gsid` (cookie first, query second), mint a `correlationId`, emit `growth.auth_redirect.initiated.v1` **at click time before navigating**, and pass `correlationId` to auth via `state` |
| **Allowed** | `bazos/services/bazos-service/src/ui/**` |
| **Forbidden** | `bazos/services/bazos-service/src/channel/**` — publishing logic, governed by `docs/BAZOS_COMPLIANCE.md`, untouched by this slice |
| **Depends on** | C-005 §4 signing scheme · C-005 §2.2a |
| **Evidence** | the event is emitted even when the visitor never returns from auth; `correlationId` survives the round trip; absent `gsid` does not break registration |

> **`gsid` must not be put on the URL to `auth.alfares.cz`.** Only `correlationId` crosses. This is
> what keeps the attribution token out of auth's access logs and `Referer` headers
> ([D-005](../07_decisions/D-005-gsid-propagation-correction.md) §3 consequences).
>
> Emission must not depend on the auth callback: a visitor who registers and closes the tab has
> registered. Emit server-side at the click, before `window.location.assign`.

### W5 — `leads-microservice` lead from registration

| | |
|---|---|
| **Role** | Worker agent |
| **Output** | Consume registration, create `Lead`, emit `growth.lead.created_from_registration.v1` |
| **Allowed** | `leads-microservice/src/leads/**`, `leads-microservice/prisma/schema.prisma`, `leads-microservice/prisma/migrations/**` |
| **Forbidden** | `leads-microservice/src/{auth,notifications}/**` |
| **Depends on** | W3 event contract |
| **Evidence** | Lead created; existing lead intake unaffected |

---

## Shared contracts — integration owner only

No worker edits these. Changes go through the integration owner, who updates the schema and notifies affected workers.

```
growth/docs/23_documentation_contracts/schemas/*.json
growth/docs/**
shared/ECOSYSTEM_MAP.md
```

---

## Merge order

Contracts first, then producers, then consumers, then read models — the standard's rule.

```
1. W3  auth.user.registered.v1          ← nothing else can be correlated without it
2. W1  growth-core ingestion + buffer   ← endpoint must exist before W2 can emit
3. W4  bazos gsid pass-through          ← needs the signing scheme live
4. W2  growth-web landing               ← needs W1 endpoint deployed
5. W5  leads from registration          ← needs W3 event flowing
```

W3 and W1 are independent and may run in parallel. W2 cannot be verified before W1 is deployed, though it can be built against the contract.

Each merges behind a feature flag as it completes. A finished service does not wait for its siblings.

---

## Blockers and risks

| | |
|---|---|
| **W3 touches shared infrastructure** | `auth-microservice` serves the whole ecosystem. A regression here breaks every application's login. Requires the fullest regression evidence of any worker and should not be the first task given to a cold agent |
| **No consent → no attribution** | Expected, not a defect. Measured conversions will be lower than actual; the MS-002 report must state the attributed/unattributed split |
| **Buffer shares a failure domain** | [D-002c](../07_decisions/D-002-landing-conversion-and-buffer.md) — protects against pod restarts, not node loss. Accepted for MVP |
| `growth` and `growth-web` do not exist | Both are new. W1/W2 include scaffolding per `shared/docs/CREATE_SERVICE.md` |
| **Not blocked by** | S1 governance (no money spent, no API writes) · OAuth *Testing* status (no Google Ads calls in this slice) |

---

## Validation

**Automated** — the eight tests in C-005 §7. Cross-service path exercised end to end, not per service in isolation.

**Owner manual check** — F-005: click a real ad, register, confirm attribution, kill the pod mid-registration, enter spend, confirm the experiment view.

**A slice with passing tests but no owner check is not complete.**

---

## Handoff notes

Facts a worker needs and would otherwise re-derive:

- ⚠️ ~~Landing and registration are **same-origin** on `bazos.alfares.cz` — first-party cookie works without cross-domain machinery~~ **False, corrected 2026-07-20.** Registration is on `auth.alfares.cz`, a sibling host: the cookie never arrives. The cookie stores `gsid` within the landing; a `correlationId` crosses the hop and the two events are joined. See [D-005](../07_decisions/D-005-gsid-propagation-correction.md)
- The live landing already carries the full legal footer: privacy, cookies, GDPR, terms, **EU AI Act**, operator identity, "not affiliated with Bazoš.cz". A clone inherits it — do not rebuild
- Money is a decimal **string**, never a float. The schema rejects floats; this is deliberate
- `causationId` is optional — root events have none
- `workspaceId`, never `tenantId`. `tenantId` is `marketing-microservice`'s legacy field; translate at the adapter
- Vault path is `secret/prod/growth`. `GROWTH_GSID_HMAC_SECRET` must be generated once and stored there before W2 or W4 run
- Three production outbox implementations exist — `catalog`, `warehouse`, `orders`. Copy the pattern, do not invent one
- Event envelope follows `leads.LeadLifecycleEvent` (`producer`), not `orders` (`source`). The inconsistency is known and deliberately not fixed here
