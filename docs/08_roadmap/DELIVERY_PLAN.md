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
| **S1a** | **Decision record** — `DecisionArtefact` + canonical hash | growth-core (`services/core/`) | M1 | ✅ **VERIFY gate closed 2026-08-01.** Five F-001 steps run by owner 2026-07-23 (launch 201, edit 409, stop-bare 422, budget 201, stop 201); step 3 — reading the chain after a delay — done 2026-08-01, nine days later instead of three: `exp-001/v1` holds exactly three artefacts, `launch → budget_change → stop` reads as one story and still explains **why** without relying on that day's memory. That is the whole feature · [F-001](../10_features/F-001-decision-record-and-governance.md) · [C-001](../23_documentation_contracts/C-001-decision-record.md) · [D-004](../07_decisions/D-004-decision-artefact-shape-and-hash.md) |
| **S1b** | Execution governance — `ApprovalGrant` + `approvedParametersHash`, `ExecutionAttempt` + `effectKey`, budget ceilings, fix in-memory idempotency, **authenticated owner surface** (login via `auth-microservice`) | goalkeeper · growth-core · **auth** | **M3** — not needed until the first API write | ◷ Blocks **S9** and **S6c**. Browser login was not in the original slice scope — added 2026-07-23, see "Found while planning the cabinet" |
| **S5** | Landing runtime, durable edge→core ingestion, consent evidence, UTM + click-ID, `AnonymousTouchpoint`, `IdentityLink` | growth-web · growth-core · **auth** · bazos · leads | M1 | ✅ **All workers in prod.** W1 (ingest + consumer), W6, W3, W4, then **W2** (landing on `bazos.alfares.cz/l`, cookie `gsid`, `AnonymousTouchpoint`) and **W5** (leads, `growth.lead.created_from_registration.v1`). Chain verified through real services 2026-07-22: landing click → consent → registration via auth → `IdentityLink` → `qualification.lead`. Ingress is **`bazos.alfares.cz/l`, not `growth.alfares.cz`**: cookie `gsid` scoped `Domain=bazos.alfares.cz`; on another host attribution is empty while health is green (D-005) · [EP-005](../21_execution_plans/EP-005-landing-and-ingestion.md) |
| **S6** | Qualification — `LeadQualificationEvent`, `criteriaVersion: v1-owner-manual`, manual marking surface, `ManualSpendObservation` | leads · growth-core | M1 | ✅ **Deployed and verified in prod 2026-07-22.** Migration 006 applied, Prisma transaction in leads applied. Verified on real services: lead reaches `qualification.lead` from queue `growth.lead-created` along the full chain from the landing; verdict from the `leads` admin panel reaches `qualification.lead_qualification`; the fix **adds** a row, and `UPDATE`/`DELETE` under the runtime role are rejected (`permission denied`); `POST /spend/observations` stores the observation and publishes it to `growth.events` · [F-006](../10_features/F-006-qualification-and-spend.md) · [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md) |
| **S6b** | Experiment showcase — read-API and owner screen | growth-core | M1 | ✅ **Deployed and verified in prod 2026-07-22.** `GET /experiments/:id/report` and screen `GET /experiments/:id` with spend-entry form. Cost per registration, cost per qualified lead, attributed/unattributed breakdown, derived `pending`. Money as decimal strings (BigInt, scale 4); division rounds half-up to 2 places; division by zero yields `—`, not 0/NaN. growth-core only, **no ingress**. **Fixed 2026-07-23:** current lead verdict is taken via the `supersedes` chain, not by "latest `decided_at`" — the old order silently substituted a cancelled verdict into `costPerQualifiedLead` under reordered delivery (C-006 §1.4, commit `181529b`, **rolled out with S6d 2026-07-23**; verified on the running container 2026-08-01: `grep -c 'WITH RECURSIVE' dist/qualification/qualification.repository.js` → 1) · [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md) §6 |
| **S6d** | **Per-experiment and per-campaign measurement** — `attribution.touchpoint` and its consumer, lead experiment derived from the touchpoint, `campaignId` in spend schema v2 | growth-core · growth-web | M1 | ✅ **Deployed and verified in prod 2026-07-23** (tag `350a2ba`). Migration 007 applied by the migrate container; queue `growth.touchpoints` bound to `growth.events`, 1 consumer, 0 messages; `GET /experiments/exp-001/report` returns the new shape — and that shape is unreachable without the join on `attribution.touchpoint` and the `campaign_id` column, so the response proves both DDL changes. Same rollout carried the C-006 §1.4 fix. First honest numbers: `registrations: 0`, `outOfScope.noTouchpoint: 4` — yesterday those four leads were counted as experiment registrations. Owner decisions 2026-07-23: 1b and 2a immediately, not twice · [F-007](../10_features/F-007-per-experiment-and-per-campaign-measurement.md) · [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md) §2.5/§4.3/§6.6 |
| **S6c** | **Owner cabinet** — record decisions from the GUI instead of `scripts/s1a-verify.sh`: hypothesis, budget, budget-change reason, stop reason, spend, report | growth-core · **auth** | **M3** — together with S1b | ⏸ **Blocked by S1b** (owner decision, 2026-07-23: wait for real login via `auth-microservice`, not a Basic password). Scope and findings — §10 |
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

### Found while preparing EP-005 — affects other slices

~~**`auth-microservice` emits no events.**~~ **Closed 2026-07-21 (W3).** `auth` emits
`auth.user.registered.v1` on `auth.events`. The event is intentionally generic and reusable: S6
(qualification), S10 (conversion upload), and MS-P subscribe to it with no changes in auth. Neither
`gsid`, nor `experimentId`, nor `workspaceId` may be added to it — enforced by tests on both sides.

**Still open from this finding:** auth has no outbox — a failed publish is lost (logged in full for
manual replay). The service has no migration mechanism, so there is nowhere to put an outbox table
yet. Details in `auth-microservice/TASKS.md`.

**What "registration" means.** A user is created in five places, and three of them prove nothing:
`register-contact` is a contact-capture form (`authenticated: false`), and `requestMagicLink`
creates a row for any address entered. The event is emitted only on confirmed identity, so measured
registrations will be **lower** than the row count in `users` — report both figures in MS-002.

### Found while implementing S6 — affects other slices

**The document described an endpoint that does not exist.** F-006 claimed that `leads.controller.ts`
has `PATCH /leads/:id → status` and that S6 reduces to making the existing status change emit an
event. That route does not exist, and `Lead.status` is written in exactly two places inside the
service — never by an operator. Implemented literally, the slice would have hung a correct,
test-covered event on a transition nothing can invoke, so it would never emit while looking done.
Fixed at the source; the original wording is quoted, not deleted.

**The contract schema accepted an empty `evidenceReference`.** The field had no `minLength`, so
`""` passed validation — and that is the entire provenance chain for a manually entered spend
amount. Repo rule: empty free text is rejected, not defaulted. Fixed (`minLength: 1` also on
`observationId`, `experimentId`, `enteredBy`).

**Both defects came from documents, not code** — the same pattern as D-005. A test written against
the contract before carefully reading the schema caught the second one.

**Experiment showcase built in S6b (2026-07-22).** The claimed F-006 §3 outcome is met: read-API
`GET /experiments/:id/report` and server screen `GET /experiments/:id` show both cost metrics and
the attributed/unattributed breakdown.

Two constraints are recorded, not hidden:

- **The screen lives only on growth-core, which has no ingress.** The owner opens it via
  `kubectl -n statex-apps port-forward deploy/growth-core 3376:3376`. It must not go on
  `growth-web`: that is public on `bazos.alfares.cz/l` and has no authentication. Publishing on a
  public host requires an authenticated surface (S1b) — **owner decision**, C-006 §6.8.
- **The report counts leads by workspace, not by experiment**: `qualification.lead` has no
  `experiment_id`. Correct while the workspace runs one experiment; wrong from the second — C-006 §6.6.

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
| Outbox | — | ✅ S6 | — | 🔨 S1 | — | 🔨 S1 | ✅ | 🔨 S7 | — |
| Touchpoint capture | — | 🔨 S5 | — | 🔨 S5 | 🔨 S5 | — | — | — | — |
| Consent evidence | ◷ | 🔨 S5 | ◷ | 🔨 S5 | 🔨 S5 | — | — | — | — |
| Qualification events | — | ✅ S6 | — | ✅ S6 | — | — | — | — | — |
| Lead → order attribution | — | 🔨 S7 | — | 🔨 S7 | — | — | ✅ **exists** | — | 🔨 S7 |
| `revenue.recognised` | — | — | — | 🔨 S7 | — | — | 🔨 S7 | 🔨 S7 | 🔨 S7 |
| Money reversal events | — | — | — | 🔨 S7 | — | — | 🔨 S7 | 🔨 S7 | — |
| Owner cabinet (GUI decision recording) | — | — | — | ◷ S6c | — | — | — | — | — |
| Per-experiment / per-campaign measurement | — | — | — | 🔨 S6d | 🔨 S6d | — | — | — | — |
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

---

## 10. S6c — owner cabinet (owner decision 2026-07-23)

**Owner requirement, verbatim:** "it's more convenient for me to manage this from a GUI, not the command line."
This is not convenience on top of a working process — it is the condition under which decisions get
recorded at all. A decision write that requires assembling JSON in bash competes with two minutes in
the Google Ads UI and loses; then `decision_artefact` goes empty and the platform no longer knows why
money was spent. Exactly this argument is already recorded in
[F-001](../10_features/F-001-decision-record-and-governance.md) as the reason budget change is a
separate artefact type rather than "stop and relaunch".

### First functionality (slice scope)

| Screen / action | What it writes | Already provided by |
|---|---|---|
| Experiment list | nothing | `DecisionRepository` — needs a new read method "distinct experimentId" |
| Launch experiment — hypothesis, rationale, budget, dates | `experiment.launch` | `DecisionService.record` |
| Budget change — reason + new ceiling | `experiment.budget_change` | same; `supersedesArtefactId` and `previousBudgetCap` filled by the server, not the human |
| Stop — reason | `experiment.stop` | same |
| Enter spend | `manual_observation` | `SpendService.record` (S6) |
| Report: spend, cost per registration, cost per qualified lead, attributed/unattributed, pending | nothing | `ExperimentReportService` (S6b) |
| Decision history for one experiment — "why" in sequence | nothing | `GET /governance/decisions` (S1a) |

No new tables and no migrations: the whole slice is screens on top of services that are already
written, deployed, and test-covered. The expensive part here is not code but DOC and CONTRACT
(`F-007`, `C-007`), written first per the §2 gates.

**Two screen requirements that must not be lost in implementation:**

1. **Rejections must be readable, not dumped as a JSON exception page.** An empty stop reason
   (422) and an attempt to overwrite an existing artefact (409) are behaviours the slice must show
   the owner in words. Without that, F-001 manual verification cannot be done through the cabinet.
2. **Artefact preview before write.** `decision_artefact` is append-only: a typo in the hypothesis
   stays forever, fixed only by a new artefact. CLI uses `DRY_RUN=1` for this; GUI must use a
   confirmation step.

### Found while planning the cabinet (2026-07-23)

**The plan had no interface for recording decisions — at all.** The only screen the plan provided
was the S6b showcase: report and spend form. Launch, budget change, and stop existed only as API
and `scripts/s1a-verify.sh`. The owner asked whether the cabinet was queued for implementation; the
honest answer was "no, nothing to wait for," and the slice was opened for that reason.
[ARCHITECTURE](../06_architecture/ARCHITECTURE.md) deferred this deliberately — "version-management
UI **may wait**" while the immutable launch snapshot is mandatory — i.e. the interface was deferred,
not the write; the cabinet closes that deferral and does not touch the snapshot.

**S1b did not include browser login, even though the whole repo refers to it as the
"authenticated surface".** S1b scope per F-001 is `ApprovalGrant`, `approvedParametersHash`,
`ExecutionAttempt`/`effectKey`, budget ceilings, and reconciliation: the machinery that authorises
**API calls**. Grants authorise execution; they do not log a human in. If the cabinet slice simply
"waited for S1b", it would wait for something S1b never wrote. So owner login
(`POST /auth/login` → session cookie → check via `POST /auth/validate` in `auth-microservice`,
which already supports this) was added to S1b scope as an explicit line, and S6c depends on it.

**The cost of the owner decision is stated plainly:** S1b sits on **M3**, so the cabinet appears at
M3, and until then decisions are written via `scripts/s1a-verify.sh`. Alternatives — publish behind a
Basic password from Vault, or a cabinet on `port-forward` with no ingress — were **rejected** by the
owner on 2026-07-23 in favour of real login. If waiting turns out more expensive than it looks,
accelerate login in S1b, not the cabinet: the rest of the slice scope does not depend on it.

**The cabinet does not manage Google Ads and does not pretend to.** There is no connector: metrics
read is S8, writes are S9, both ◷. Budget is still raised by hand in the Google Ads UI; the cabinet
records why the owner did it. A screen where "raise budget" looks like an action on the campaign
would be an interface lie — S6c copy must say "record decision".
