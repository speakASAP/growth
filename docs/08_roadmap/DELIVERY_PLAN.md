# Growth Platform — Delivery Plan

> **v1** · 2026-07-18 · Owner: Sergej
> Companion to [`../06_architecture/ARCHITECTURE.md`](../06_architecture/ARCHITECTURE.md) (v7).
> Governed by [`/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`](/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md) and [`../../../shared/AGENT_OPERATIONS.md`](../../../shared/AGENT_OPERATIONS.md) §Parallel Work.

---

## 1. Governing standard

**Primary source:** `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`
**Repo-local:** `shared/AGENT_OPERATIONS.md` §"Parallel Work" (lines 34–44)

Mandatory chain, preserved by every slice:

```
Vision → Goal Impact → System → Feature → Task → Execution Plan → Coding Prompt → Code → Validation
```

Four agent roles (from the standard):

| Role | Responsibility |
|---|---|
| **Readiness scanner** | Classifies slices: ready now · dependency-gated · blocked · active elsewhere · complete · needs owner input |
| **Worker agent** | Implements **one bounded slice** with explicit allowed/forbidden files, validation evidence, handoff output |
| **Worker monitor** | Tracks active workers, extracts handoff facts, detects shared-file conflicts |
| **Integration validator** | Validates completed batches, separates current-task failures from validation debt, records integration evidence |

> ⚠️ **Gap found 2026-07-18:** the standard defines parallel-work rules, integration owners and merge order, but **does not define milestones**. This document adds them (§4) in the standard's vocabulary. Also: `shared/docs/ECOSYSTEM_REFACTOR_MASTER_PROMPT.md` is referenced from `shared/CLAUDE.md` Tier 2 but **does not exist** — broken reference, unrelated to this project but worth fixing.

Validation debt ledger for this project: `growth/docs/12_validation/VALIDATION_DEBT.md`.

---

## 2. Delivery gates (per slice)

```
0. SPIKE      — optional, time-boxed, disposable code, no production side effect, no real spend
1. DOC        — business behaviour and boundaries
2. CONTRACT   — types, events, API shapes, DB schema, failure semantics
3. IMPL       — implementation across required owners only
4. VERIFY     — automated path + owner manual check (BOTH required)
```

**DOC and CONTRACT stay separate documents.** Reason (owner, 2026-07-18): the readers are multiple AI agents — Codex, Claude Code, Copilot, different models — each starting cold. Explicit contracts prevent divergence between implementations. This is not solo-developer overhead.

**SPIKE exists because a contract written before touching an unknown external API encodes guesses.** Allowed only when an external/unknown constraint blocks a reliable contract. Produces a findings document. Spike code is disposable unless deliberately promoted.

**Coding is last.** Documentation → steps → contract validation → then code.

### Slice scope rule

> A vertical slice must be end-to-end complete for its declared user outcome. It must **not** create speculative integrations in services with no current consumer requirement.

Every slice document must list:

```
Required owners        — services that must change for the outcome to work
Required consumers     — services that must consume the new contract now
Optional future consumers
Explicitly excluded services
```

### Feature flags

Incomplete slices merge to the branch behind a flag. A service finished ahead of its siblings does not wait. The coverage matrix (§5) records what is done where; remaining work continues in later iterations.

---

## 3. Slices

Status legend: `✅` done · `🔨` active · `◷` planned · `⏸` blocked

| # | Slice | Required owners | Milestone | Status |
|---|---|---|---|---|
| **S1a** | **Decision record** — `DecisionArtefact` + canonical hash | growth-core (`services/core/`) | M1 | 🔨 **IMPL готов (63 теста), ждёт VERIFY** — блокирован первым деплоем · [F-001](../10_features/F-001-decision-record-and-governance.md) · [C-001](../23_documentation_contracts/C-001-decision-record.md) · [D-004](../07_decisions/D-004-decision-artefact-shape-and-hash.md) |
| **S1b** | Execution governance — `ApprovalGrant` + `approvedParametersHash`, `ExecutionAttempt` + `effectKey`, budget ceilings, fix in-memory idempotency | goalkeeper · growth-core | **M3** — не нужен до первой записи в API | ◷ |
| **S5** | Landing runtime, durable edge→core ingestion, consent evidence, UTM + click-ID, `AnonymousTouchpoint`, `IdentityLink` | growth-web · growth-core · **auth** · bazos · leads | M1 | ◷ |
| **S6** | Qualification — `LeadQualificationEvent`, `criteriaVersion: v1-owner-manual`, manual marking surface, `ManualSpendObservation` | leads · growth-core | M1 | ◷ |
| **S7** | **Universal revenue adapter** — canonical `revenue.recognised`, flipflop as first client (§6) | orders · payments · growth-core · flipflop | M2 | ◷ |
| **S8** | Google Ads connector — read-only metrics, `SpendObservation` + reconciliation | growth-core | M2 | ◷ |
| **S9** | Google Ads connector — approved writes, execution reconciliation, connector failure states | growth-core · goalkeeper | M3 | ◷ |
| **S10** | Conversion upload — internal ledger, `ConversionDestination`, consent filtering, dedup | growth-core · leads | M3 | ◷ |
| **S11** | Decision **analysis only** — no financial action (§7) | growth-core | M3 | ◷ |
| **S12** | AI generation — ad copy + landing text, deterministic claim checks, human review, lineage | runlayer · growth-core · prompts | M3 | ◷ |
| **S13** | Sklik connector (CZ) | growth-core | M4 | ◷ |
| **PARALLEL TRACK — communication channels** ||||
| **S2** | WhatsApp — inbound (outbound exists) | notifications · leads | P | ◷ |
| **S3** | Email as system-wide channel — re-scope existing inbound infra off `@speakasap.com` | notifications · leads | P | ◷ |
| **S4** | Inbound reply → `leadId` linkage, all channels | leads · notifications | P | ◷ |
| **BACKLOG** ||||
| **B1** | BPCP consolidation (D3) | bpcp · goalkeeper · catalog | — | ◷ |

### Найдено при подготовке EP-005 — влияет на другие срезы

**`auth-microservice` не эмитит никаких событий.** Ни RabbitMQ, ни amqp во всём `src/`. Регистрация пользователя порождает только строку в логе.

Это не только проблема S5. Любой срез, которому нужно знать о событиях пользователей — S6 (квалификация), S10 (загрузка конверсий), MS-P (каналы связи) — упрётся в то же самое. Первое подключение событий к auth стоит спроектировать как переиспользуемое, а не под нужды одного среза.

### Why S2–S4 are a parallel track, not a gate

The qualified-lead definition (§4.4.1 of the architecture) requires a reply on WhatsApp/Telegram/email. **Manual qualification does not require automated linkage** — the owner sees the reply on his phone and marks the lead. So S2–S4 do not block the first experiment.

They remain a genuine, independent owner requirement (a third communication channel is needed regardless of the growth project) and gate: automatic reply evidence · reply-qualified conversion upload · multi-user lead handling · reduced qualification latency vs the conversion-upload deadline.

---

## 4. Milestones (synchronisation points)

Parallel work runs freely **between** milestones. At each milestone all active workers stop, the integration validator runs, and the coverage matrix is reconciled.

| Milestone | Gate condition | Integration owner |
|---|---|---|
| **M0 — Access** | Phase 0 complete: business selected, ad account live, API access confirmed by a real call, consent baseline established. See `../16_operations/PHASE0-ACCESS-TRACKER.md` | owner + Claude |
| **M1 — First experiment ready** | S1 + S5 + S6 verified. Touchpoint→lead traceable end-to-end. Provider-side budget caps set. **Manual capped experiment runs here.** | Claude |
| **M2 — Revenue visible** | S7 + S8 verified. `revenue.recognised` flowing from flipflop. Spend observations reconciled | Claude |
| **M3 — Automation** | S9 + S10 + S11 + S12 verified. Writes reconciled, conversions uploaded, analysis producing recommendations | Claude |
| **M4 — Second platform** | S13 verified | Claude |
| **P — Channels** | S2 + S4 verified (S3 may trail). Merges at any milestone boundary | Claude |

**Merge order at a milestone:** contracts and schemas first → producers → consumers → read models → UI. No parallel edits to a shared contract, schema, migration, deployment file or status artefact without the integration owner resolving order (per the standard).

---

## 5. Coverage matrix

`✅` implemented · `🔨` required in current slice · `◷` planned/deferred · `—` not owned / not applicable

| Capability | notifications | leads | marketing | growth-core | growth-web | goalkeeper | orders | payments | flipflop |
|---|---|---|---|---|---|---|---|---|---|
| Telegram outbound | ✅ | — | ✅ | — | — | ✅ | — | — | — |
| Telegram inbound | ✅ | ◷ S4 | — | — | — | ✅ | — | — | — |
| Email outbound | ✅ | ✅ | ✅ | — | — | — | — | — | — |
| Email inbound | ✅ *(speakasap-scoped)* | ◷ S3/S4 | — | — | — | — | — | — | — |
| WhatsApp outbound | ✅ | ◷ S2 | ◷ | — | — | — | — | — | — |
| WhatsApp inbound | 🔨 S2 | 🔨 S2 | ◷ | — | — | — | — | — | — |
| Reply → `leadId` | 🔨 S4 | 🔨 S4 | ◷ | — | — | — | — | — | — |
| Persisted approvals + grants | — | — | — | 🔨 S1 | — | 🔨 S1 | — | — | — |
| `ExecutionAttempt` / `effectKey` | — | — | — | 🔨 S1 | — | — | — | — | — |
| Outbox | — | 🔨 S6 | — | 🔨 S1 | — | 🔨 S1 | ✅ | 🔨 S7 | — |
| Touchpoint capture | — | 🔨 S5 | — | 🔨 S5 | 🔨 S5 | — | — | — | — |
| Consent evidence | ◷ | 🔨 S5 | ◷ | 🔨 S5 | 🔨 S5 | — | — | — | — |
| Qualification events | — | 🔨 S6 | — | 🔨 S6 | — | — | — | — | — |
| Lead → order attribution | — | 🔨 S7 | — | 🔨 S7 | — | — | ✅ **exists** | — | 🔨 S7 |
| `revenue.recognised` | — | — | — | 🔨 S7 | — | — | 🔨 S7 | 🔨 S7 | 🔨 S7 |
| Money reversal events | — | — | — | 🔨 S7 | — | — | 🔨 S7 | 🔨 S7 | — |
| Ad connector | — | — | — | 🔨 S8/S9 | — | — | — | — | — |
| Conversion upload | — | 🔨 S10 | — | 🔨 S10 | — | — | — | — | — |

Verified corrections: **inbound email already exists** in notifications (`inbound-email.controller.ts`, `webhook-subscription.service.ts`, `s3-unprocessed-catchup.scheduler.ts`) — S3 re-scopes, not builds. **`OrderLeadAttribution` already exists** in orders. **Outbox already exists** in orders, catalog, warehouse — copy the pattern. **WhatsApp inbound is the only entirely absent channel.**

---

## 6. S7 — universal revenue adapter (blocking finding)

### The problem, verified in code

| App | Routes through `orders-microservice`? |
|---|---|
| flipflop | partially — has its **own** `flipflop/services/order-service` |
| **speakasap** | ❌ no — own `payment-service` with its own Prisma schema |
| **marathon** | ❌ no |
| chytrakoupe, cliplot | ❌ no |

Attribution is built on `order.created` + `OrderLeadAttribution`. **An experiment for speakasap or marathon would produce revenue invisible to attribution.** This blocks D20 (multiple businesses) unless solved.

### Decision (owner, 2026-07-18): (c) now + (b) as contract

Define a canonical revenue contract that **any** service can adopt cheaply. Implement the adapter for **flipflop first**, via that universal scheme. Other businesses connect on demand.

### Canonical contract

```ts
interface RevenueRecognised {
  eventId: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;              // "flipflop" | "speakasap" | "marathon" | "orders-microservice"
  workspaceId: string;           // resolved per §7 of the architecture doc
  externalOrderId: string;       // producer-local order identity
  externalPaymentId?: string;
  leadId?: string;               // attribution link when known
  amount: Money;                 // { value, currency } — currency ALWAYS explicit
  kind: "captured" | "refunded" | "chargeback_lost";
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;          // optional — root events have none
}
```

### Adoption path for a new business (the "quick and simple" requirement)

```
1. Business emits RevenueRecognised on its own payment success/refund path
2. Publishes to RabbitMQ with the shared JSON schema
3. Producer test: "what I emit validates against the schema"
4. growth-core consumes — no growth-side code change per business
5. Register the producer in the workspace resolution table
```

**Cost per additional business: one publisher call plus one schema test.** No changes in growth-core. That is the point of the universal scheme — flipflop is the first client of it, not a special case.

`orders-microservice` remains the canonical path for businesses that use it; its adapter emits `RevenueRecognised` from `order.created` + payment events, so nothing downstream distinguishes the two routes.

---

## 7. Financial automation is deferred (owner decision)

All money decisions stay with the owner at stage 1. He sets lead cost and budgets manually.

Therefore **S11 is analysis-only**: it computes and presents, it never acts. No automated budget changes, no automated scaling, no autonomous spend recommendations executed by the system.

Consequence: the approval machinery in S1 is needed for **execution safety** (S9 writes), not for financial decisions. Automated financial recommendation and management is out of scope until the owner has manual baselines to calibrate against.

---

## 8. Contract testing (lightweight — adopted)

Full Pact tooling with a broker is rejected as disproportionate. The idea is kept, the machinery dropped:

```
1. Canonical JSON schema per event, in a shared package
2. Producer test:  "what I emit validates against the schema"
3. Consumer test:  "my parser accepts everything the schema permits"
```

A breaking change fails CI before deploy. No broker, no versioning service, no can-i-deploy.

Rationale: a contract *document* never fails. An executable schema does. With 5 live consumers of `order.created` (invoices, notifications, aukro, heureka, marketing) this is cheap insurance.

**No expand/contract migration** (owner decision): there is no external consumer base to protect and the datastore is new. Change the schema directly and migrate all consumers in the same deploy — legitimate because one operator controls every service on one cluster.

---

## 9. Per-slice document template

Each slice gets `growth/docs/10_features/F-NNN-<name>.md`:

```markdown
# <ID> — <name>

## Outcome            (user-visible result; how we know it works)
## Required owners    (services that must change)
## Required consumers
## Optional future consumers
## Explicitly excluded
## Allowed files      (per worker)
## Forbidden files
## Dependencies / blockers
## SPIKE findings     (if a spike ran)
## Contract           (types, events, schema, failure semantics)
## Validation evidence (commands + expected output)
## Owner manual check (concrete steps the owner performs)
## Handoff notes
## Integration owner / merge order
```

Mirrors the standard's required execution-plan fields.
