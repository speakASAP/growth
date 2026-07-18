# Growth Platform Architecture

> **Version 7 — IMPLEMENTATION BASELINE** · **Review closed** · Owner: Sergej · 2026-07-18
>
> Accepted as the implementation contract after a **five-round adversarial review** (ChatGPT Enterprise) plus **four rounds of codebase verification**. Three v1 decisions and several v2–v6 details were overturned by evidence.
>
> **Scope of this document:** what is built and why. *How and when* live in [`../08_roadmap/DELIVERY_PLAN.md`](../08_roadmap/DELIVERY_PLAN.md) and [`../09_milestones/`](../09_milestones/).
>
> **Active milestone:** [MS-001 — Access and baseline](../09_milestones/MS-001-access-and-baseline.md). **Next action:** Google Ads account + credentials per [`../16_operations/PHASE0-ACCESS-TRACKER.md`](../16_operations/PHASE0-ACCESS-TRACKER.md).
>
> ### Change history
>
> | v | Change |
> |---|---|
> | v2 | External review incorporated; BPCP retirement, identity-consent boundary and cost-to-signal overturned |
> | v3 | Order→lead attribution and Marketing's non-allocation found in code; v1 "attribution conflict" withdrawn |
> | v4 | Seven consistency corrections: `workspaceId`, grant/dedup separation, chargeback lifecycle, consent evidence, durable ingestion, qualification contract, BPCP backlog |
> | v5 | Qualified-lead contract resolved (§4.4.1, D19); no historical data exists (§1.3, D21) |
> | v6 | Czech-only scope (§1.2, D20); vertical feature slices with gates (D22); coverage matrix (D24) |
> | **v7** | **Readiness review applied:** S2–S4 off the critical path (MS-P) · pre-spend vs pre-monetary traceability split · Google Ads confirmed first platform (D-001) · engagement/qualification states separated · `approvedParametersHash` · workspace resolution (§4.4.2) · `ManualSpendObservation` (§4.5.1) · SPIKE gate · slice scope limited to required owners · Czech legal/consent/currency assumptions narrowed · editorial fixes |

---

## 1. Purpose

Take a human-authored business hypothesis (e.g. *"AI customer support for Czech dental clinics"*) and run it end-to-end as a measurable paid-acquisition experiment: research → strategy → landing → ads → campaigns → analytics → leads → conversion analysis → decision.

**Human-in-the-loop by default. No autonomous money spend without an explicit, scoped approval.** Autonomy is granted per-action-class only after a measured track record.

## 1.1 Tenancy decision (settles the highest-leverage open question)

**Internal first, SaaS later.**

- All ad accounts are owner-owned at launch. Meta **Standard Access** suffices (Advanced Access governs managing *other businesses'* accounts).
- ⚠️ **Account ownership and Google Ads developer-token access level are independent axes.** v2 stated "owner-owned ⇒ Standard/Explorer"; that was an invalid inference. Per Google's documented four-tier model (Test / Explorer / Basic / Standard), **Explorer or Basic is the realistic MVP target** — Explorer allows 2,880 daily production operations, Basic 15,000. Standard is likely unnecessary. Basic and Standard also carry a separately assigned permissible-use category.
- Connector credentials are isolated per-platform in Vault from day one.
- Tenancy is **not enforced** (no RBAC, per-tenant billing, DPA or SLA) until commercialisation.

### Scoping mechanism — `workspaceId` on aggregate roots, not `tenantId` everywhere

v2 said "`tenantId` on every table." **Withdrawn.** A universal tenant column while tenancy is unenforced produces false confidence that the product is tenant-safe, repetitive composite indexes, inconsistent propagation, harder migrations, and rows whose tenant should derive from their aggregate root.

> **A column is not a tenancy architecture.**

Carry `workspaceId` on **aggregate roots only** — `Experiment`, `AdAccountConnection`, `ApprovalGrant`, `CampaignBinding`, `LandingSite`, `DecisionArtefact` — plus emitted events and credential references. Child entities inherit scope through foreign keys.

`marketing-microservice` keeps its existing `tenantId`/`appId`/`brandId`/`businessId` on `CampaignAttributionMetadata`. **Translate between `workspaceId` and Marketing's legacy scope fields at the adapter boundary** — do not import older terminology into the new domain for the sake of symmetry.

Commercialisation later adds: enforced tenant resolution · tenant-aware unique constraints · authorisation · query scoping · DB isolation strategy · cross-tenant security tests · audit and billing.

### 1.2 One market (Czechia), multiple businesses (owner decision, 2026-07-18)

**Stage 1 is Czech-only.** Hypotheses are tested for **different businesses on one market**. Other markets come only after the first stage is proven.

This is materially simpler than a multi-market design and the simplification is deliberate:

- **One jurisdictional framework** — Czech counsel establishes the common baseline, but regulated sectors, specific claims and audience use may still need business-specific review. A dental-services ad and a software ad are not automatically covered by the same assessment
- **CZK economics** — but connector onboarding must **verify the billing currency of each ad account**; do not assume an owner-owned account is billed in CZK. Currency stays explicit in every spend and revenue contract
- **Sklik is usable** — Seznam covers Czechia, so it is a valid stage-1 connector
- **One jurisdiction for consent** — but requirements remain purpose-, vendor-, channel- and processing-specific. There is no single universal consent decision

`workspaceId` still earns its place immediately: **one workspace = one business** (not business × market at this stage). The scoping mechanism is unchanged; only its cardinality is smaller.

Platform scope: offers run on **our own ecosystem and applications**.

> ✅ **Decided — [D-001](../07_decisions/D-001-first-business-and-platform.md): first business **Bazos**, market **Czechia**, first platform **Google Ads**.** Sklik follows only after the Google write/reconciliation path is proven, so slice names S8–S10 are accurate as written. Market fan-out is a post-stage-1 activity; when it happens, connectors, advertising law and ad accounts all become market-specific.
>
> ⚠️ **Open for Bazos:** its `orders` integration covers *marketplace* orders. Whether **subscription revenue for the Bazos automation service itself** flows through the same path is unverified — resolve before MS-003 contracts. MS-002 is unaffected (its outcome is a qualified lead, not revenue).

### 1.3 There is no historical data — thresholds come from measurement, not history

The system is being built; **no production traffic, lead, order or payment history exists** to calibrate against. Every earlier volume figure (including "10–40 leads/month") was an estimate and is withdrawn as a planning input.

Therefore: Phase 5 decision thresholds (§7.5) **cannot be set in advance**. They are derived from the first experiments' own measured baseline rate, conversion delay, margin and spend. Until then, Phase 2 runs on a fixed manually-approved lifetime budget with no automated scaling — which is what the plan already specifies.

---

## 2. Evidence base (direct code inspection, 2026-07-18)

Recorded so nobody re-derives it. **Items marked ⚠️ overturned a v1 recommendation.**

### 2.1 Three overlapping control planes

| Service | LOC | Contains | Runtime reality |
|---|---|---|---|
| `runlayer` | 19,645 | `common/policy`, `common/budget`, `escalations`, `goals`, `coordinator`, `cc-planner`, `self-healing` | Live. `project-coordinator.service.ts` = 37.6 KB |
| `goalkeeper` | 9,000 | IPS gates, `telegram/callbacks.ts`, `planning`, `lifecycle`, `intent-memory` | Only ecosystem/telegram/dashboard wired |
| `business-process-control-plane` | 4,567 | `policy-registry`, `workflow-registry` (15.5 KB), `process-registry`, `simulation` | ClusterIP only — **but see 2.2** |

### 2.2 ⚠️ BPCP has a live production consumer — do not retire

```
catalog-microservice/src/bpcp-events/bpcp-process-event-consumer.service.ts
catalog-microservice/src/bpcp-events/bpcp-process-event-projection.service.ts
catalog-microservice/k8s/configmap.yaml, external-secret.yaml
```

v1 recommended retirement, inferred from *ClusterIP + one documented pilot*. That was reasoning from deployment topology instead of usage, and it was wrong. BPCP is consumed in production by `catalog-microservice` with a projection service and wired secrets. **See D3 (revised).**

### 2.3 ⚠️ Multiple production outbox implementations already exist

```
catalog-microservice/src/product-events/product-event-outbox.entity.ts + publisher + migration + specs
warehouse-microservice/src/stock/stock-event-outbox.entity.ts + migration 1781300000000
```

Consequences: (a) there is a **proven in-house pattern to copy** rather than invent; (b) v1's "~300 LOC" estimate for a durable state machine was wrong — realistic figure with persistence, leases, optimistic locking, metrics and tests is **1,500–2,500 LOC**.

### 2.4 ⚠️ No money-reversal events exist anywhere

Grep across `orders-microservice/src` and `payments-microservice/src` yields only:
```
order.create · order.created · order.items · order.state
```
**No refund, cancellation, or chargeback events.** True ROAS is not computable today — only gross booked revenue. Scaling on gross revenue systematically over-scales refund-heavy segments.

→ Emitting money-reversal events is **Phase 2.5** (D13). It gates *monetary automation* — value-based conversion upload, net ROAS, auto-scaling, policy training on historical profitability — but **not** the first manually capped experiment, which uses qualified-lead as its outcome signal and reports revenue as provisional gross.

Additionally: `correlationId`/`causationId` exist in loggers and in `aukro`/`heureka`, but **not in the orders/payments/leads money path**.

### 2.5 `marketing-microservice` docs are wrong, and it already does attribution

- `SYSTEM.md` claims "NestJS + PostgreSQL". Reality: **Express**, flat layout, 10,480 LOC. → Fix the doc.
- Existing engine: `executor.ts` (`executeCampaign`, throttling), `scheduler.ts` (`runDueScheduledCampaigns`), `campaign-blueprints.ts`, `production-governance.ts`, `orders-events-consumer.ts`.
- Existing attribution model: `analytics.ts` exports `ExternalAttributionFact`, `CampaignAttributionMetadata`, `AnalyticsFactType = "delivered" | "converted" | "attributed_value"`.

### 2.6 `runlayer` budget is LLM tokens, not money

`common/budget/budget.service.ts` uses Redis `INCRBY` on `bo:budget:llm:<project>:<date>` with TTL. Not an auditable financial ledger; cannot be reused for ad spend. `common/policy/policy.service.ts` gates LLM model tier only (`free|cheap|smart|premium`) — not a general policy engine.

### 2.7 Approval capability and trigger live in different services

`runlayer/src/escalations/escalations.service.ts` → `notifications.escalate({...}).catch(...)` — fire-and-forget, **no approve/reject return path**.

`goalkeeper/src/modules/telegram/` → inline keyboards with `callbackData: approve_plan:${id}` / `reject_plan:${id}`, parsed in `callbacks.ts`.

### 2.8 Goalkeeper Telegram security — better than assumed, with one real defect

Present: webhook secret-token verification (`x-telegram-bot-api-secret-token`), user-ID allowlist (`authorizeTelegramUpdate(update, allowedUserIds)`), and `IdempotentTelegramCallbackDispatcher`.

**Defect:** the dispatcher is constructed in-process (`new IdempotentTelegramCallbackDispatcher()`). **Idempotency is in-memory only** — it does not survive a pod restart or a second replica. Survivable at one replica today. It is a **duplicate-approval-processing** path — it becomes double-spend only if the execution layer lacks persistent uniqueness and reconciliation (§4.3). → Persisted grants (§4.3) are the fix.

### 2.9 `leads-microservice` — no attribution, strong foundation

`Lead` has `sourceService`/`sourceUrl`/`sourceLabel` + consent fields; **no** experiment/campaign/ad/keyword fields. But `LeadLifecycleEvent` (unique `eventId`, `idempotencyKey`, `correlationId`, `dataClass`, `payload`) and `LeadMarketingApprovalEvidence` already exist — HITL approval evidence is a modelled concept here.

### 2.10 ⭐ Order → lead attribution ALREADY EXISTS in production

```ts
// orders-microservice/src/orders/order-event-contracts.ts
export interface OrderLeadAttribution { leadId?: string; source?: string; campaignId?: string }
export interface OrderCreatedEvent { ...; leadAttribution?: OrderLeadAttribution }
// create-order.dto.ts — validated with an explicit allow-list
const allowedKeys = new Set(['leadId', 'source', 'campaignId']);
```

`leadId`, `source` and `campaignId` are accepted at order creation, validated, and **already published on `order.created`**. The `lead → order` half of the attribution chain does not need building — only populating. Missing: the touchpoint end (session/click IDs) and payment linkage.

Also: `orders-microservice/src/orders/order-event-outbox.entity.ts` — a **third** production outbox. Emitting new payment/reversal events is additive work on existing infrastructure.

### 2.11 ⭐ Marketing performs NO attribution allocation — the v1 "conflict" is withdrawn

```ts
// marketing-microservice/src/analytics.ts
attributedValue: "externally_supplied_analytics_or_domain_fact"
sourceOwnership: {
  campaignFacts:   "marketing-microservice",
  conversionFacts: "external_analytics_required",
  valueFacts:      "external_analytics_required",
}
if (fact.factType === "attributed_value") attributedValue += Number(fact.value);   // the only computation
```

Marketing **receives** `ExternalAttributionFact { factType, sourceService, occurredAt, campaignId, runId, correlationId, count, value, currency }` and **sums** them. It runs no allocation model and explicitly declares conversion and value facts externally owned.

Therefore: **no double-allocation risk**, and the Growth↔Marketing seam **already exists in the direction required** — `sourceService` is the supplier field. Growth becomes a *supplier* of paid-channel facts into Marketing's existing dashboard, not a competitor.

v1 reported this as an unresolved conflict. That was an overstatement and is withdrawn.

### 2.12 Existing consumers of order events

`invoices-microservice`, `notifications-microservice`, `aukro`, `heureka`, `marketing`. New event *types* are safe additive work; changing existing payloads is not.

### 2.13 Existing rails and reuse candidates

`orders` publishes `order.created`; `marketing` already consumes it. `chytrakoupe` (Next 16.2.6) and `statex-ecosystem` (Next 16.2.2) are pattern references for `growth-web`.

---

## 3. Service boundary: Growth vs Marketing

**v1's rule was wrong and is withdrawn.** ("Does the recipient have identity + consent?" mis-routes retargeting of known customers via Meta — paid media to consented, identified people — into Marketing.)

**Boundary = channel, purpose, and external platform ownership. Consent is a policy input, not a boundary.**

| Context | Owner |
|---|---|
| Paid media, ad-platform campaigns, prospect acquisition experiments | **Growth** |
| Retargeting, suppression lists, ABM advertising (even to known customers) | **Growth** |
| Email, SMS, WhatsApp, first-party lifecycle journeys | **Marketing** |
| Identity, consent, lead lifecycle | **Leads** |
| Orders, revenue, refunds, chargebacks | **Orders / Payments** |
| Cross-domain attribution | **Growth read model** |

---

## 4. Target architecture

```
runlayer ──typed GrowthProposal──► growth-core ──requests──► goalkeeper
(agent substrate; proposes,        (experiments, spend,      (policy eval +
 analyses, explains — never         connectors, state         human approval →
 calls ad-platform write APIs)      machine, DecisionArtefact) scoped ApprovalGrant)
                                          │                          │
                                          ▼                          ▼
                                    growth-worker ◄──validates grant──┘
                                    (executes ONLY actions covered
                                     by a valid, unconsumed grant)
                                          │
                         ┌────────────────┼────────────────┐
                         ▼                ▼                ▼
                    growth-web         leads          ad platforms
                    (landing +      (identity +     (Google/Meta/Sklik)
                     touchpoints)    lifecycle)
```

**The canonical record of why an external action occurred is the `DecisionArtefact`** — not the experiment row, the approval row, or any workflow state.

### 4.1 Repository layout — modular, not micro

One repository, three deployables. Connectors are **modules behind ports**, not services.

```
growth-platform/
  apps/
    api/          → growth-core (experiments, decisions, read models)
    worker/       → growth-worker (grant-validated external execution)
    web/          → growth-web (landing runtime)
  packages/
    domain/       → experiment, decision, grant types
    workflow/     → state machine behind WorkflowPort
    attribution/  → touchpoint → allocation projections
    connectors-google-ads/
    connectors-meta/
    connectors-sklik/
```

Split a connector into its own service only when: independent scaling is needed, SDK/runtime deps conflict, credentials need a separate security boundary, connector incidents repeatedly destabilise growth-core, another product needs the same connector, or a second developer owns it. **For one developer, deployable boundaries are expensive.**

### 4.2 `growth-web` (Next.js, pattern-matched to `chytrakoupe`)

One multi-**workspace** landing runtime (real multi-tenancy is deferred — D11). Requirements:

- Domain-to-experiment routing with **custom domains** — `/{experiment}/{variant}` is an internal identifier, **not the permanent public URL** (trust, branding, ad-platform review all require real domains)
- Immutable landing-version IDs + snapshot of exact content shown
- Server-side event emission (no GTM)
- Consent capture attached to every event
- Fast rollback, CSP, static/CDN delivery where possible

**Availability note:** serve `growth-web` via static hosting/CDN or an independently recoverable edge deployment. It sits on the revenue path; the single k3s node must not be able to take conversion capture down while ads keep spending (§7).

#### ⚠️ CDN delivery solves page availability, NOT event capture

Serving pages from the edge leaves this failure open — and it is worse than an outage, because spend continues into a black hole while the page looks healthy:

```
1. Landing page loads from CDN                 ✅
2. Growth API or RabbitMQ unavailable          ❌
3. Visitor submits a lead / converts
4. Event cannot be persisted                   ← attribution lost, irrecoverably
5. Page still serving, ads still spending
```

A **durable ingestion boundary is mandatory in Phase 2**:

```
growth-web → edge/event collector → durable append-only buffer
           → growth ingestion worker → RabbitMQ + Growth read models
```

Requirements: the collector acknowledges **only after durable persistence** · every event carries an immutable `eventId` · browser retries reuse the same `eventId` · the ingestion worker is idempotent · buffered events replay after k3s recovery · consent is evaluated **before** any prohibited vendor transmission · the collector stores no unnecessary PII.

This need not be another microservice in the main cluster — an edge function with durable queue/storage, or any independently recoverable endpoint, satisfies it. **The implementation is open; the durability requirement is not.**

Provider-side conversion tracking remains an independent validation path. It must never substitute for the canonical internal event stream.

### 4.3 `goalkeeper` — policy + approval → **scoped grant**

Approval must produce a machine-verifiable, persisted grant. A Telegram callback stored as `approved = true` is insufficient.

```ts
interface ApprovalGrant {
  grantId: string;
  workspaceId: string;
  decisionArtefactId: string;
  permittedAction: string;      // e.g. "campaign.budget.increase"
  resourceId: string;
  expectedResourceVersion?: string;
  approvedParametersHash: string;   // canonical hash of the EXACT approved payload
  maximumAmount?: Money;
  validUntil: string;
  policyVersion: string;
  singleUse: boolean;
  issuedAt: string;
  consumedAt?: string;          // transactional with LOCAL state only — never with the provider side effect
}
```

`growth-worker` validates the grant **immediately before** each external side effect, and must:

1. Canonicalise the actual outbound action
2. Compute its hash
3. Match it against `approvedParametersHash`
4. Check `expectedResourceVersion` where applicable
5. **Reject execution if either differs**

Without this, a grant stays technically valid while the underlying resource drifts — owner approves campaign X at 500 CZK with targeting v3, targeting changes, the worker submits a different payload against the same `resourceId`. The `DecisionArtefact` hash protects the *record*; `approvedParametersHash` protects the *side effect*.

#### ⚠️ A grant alone does not prevent duplicate external execution

v2 claimed `consumedAt` set transactionally at execution prevents double execution. **That was wrong.** A database transaction cannot atomically include a Google or Meta API call:

```
1. Worker sends create-campaign request
2. Provider creates the campaign
3. Worker crashes before recording success
4. Worker retries
5. A second campaign is created
```

Grants authorise; they do not deduplicate. Durable execution attempts do:

```ts
interface ExecutionAttempt {
  attemptId: string;
  approvalGrantId: string;
  effectKey: string;          // deterministic — same intent ⇒ same key
  connector: string;
  action: string;
  status: "prepared" | "submitted" | "confirmed" | "ambiguous" | "reconciled" | "failed";
  providerResourceId?: string;
  providerRequestId?: string;
  submittedAt?: string;
  confirmedAt?: string;
}
```

Use provider-native idempotency keys where available. Otherwise use **deterministic resource naming plus reconciliation by provider resource lookup before any retry**. An `ambiguous` outcome must never be retried blind.

This also reframes §2.8: the in-memory Telegram dispatcher is a **duplicate-approval-processing** path. It becomes a double-spend path only if the execution layer lacks persistent uniqueness and effect reconciliation — which the above supplies.

#### Canonical hash, not a signature

Store a canonical SHA-256 hash of each `DecisionArtefact`. It detects accidental mutation, costs nothing, and requires no key management. Artefacts are immutable in application logic; corrections are new versions.

**Cryptographic signature deliberately omitted at MVP.** Goalkeeper and the worker share one cluster, namespace and trust domain; an attacker able to forge intra-cluster calls already holds the Vault ad credentials. Add signing when a second workspace crosses a trust boundary or an external executor exists.

#### Which mechanism prevents which failure

An earlier draft claimed a persisted grant "defeats double execution completely." **That is false and contradicted §4.3 above.** Grants authorise; they do not deduplicate. The division of responsibility:

| Mechanism | Prevents |
|---|---|
| `ApprovalGrant` (persisted, scoped) | Approval replay, expired use, out-of-scope or over-amount execution |
| Persistent callback uniqueness | Duplicate Telegram approval processing (fixes §2.8) |
| `ExecutionAttempt.effectKey` | Duplicate execution *intent* |
| Provider idempotency key | Duplicate provider *requests*, where supported |
| Deterministic resource naming | Detecting an already-created resource |
| Reconciliation | Resolving `ambiguous` provider outcomes |
| Budget ledger | Aggregate and per-experiment financial exposure |

> A persisted, scoped grant prevents approval replay, expired use and out-of-scope execution. `ExecutionAttempt`, provider idempotency and reconciliation prevent duplicate external effects.

Goalkeeper evaluates **business authorisation** ("is a 500 EUR increase permitted?"). It is **not** the authentication system — that stays in `auth-microservice`.

### 4.4 Attribution — touchpoints, not lead fields

**v1's immutable first-touch `LeadAttribution` is withdrawn.** A real journey is `Google ad → direct → Meta retargeting → email → order`; a single first-touch field cannot express it and must not be mutated on each new touch.

Entities:

```
AnonymousTouchpoint   (workspaceId, sessionId, experimentId, campaignId, adId, creativeId,
                       keyword, landingVersionId, gclid, fbclid, utm*, consentEvidence,
                       occurredAt, correlationId)
IdentityLink          (sessionId ↔ leadId, linkedAt, method)   — erasable
Lead                  (identity + lifecycle — unchanged, owned by leads-microservice)
Order / Payment / Refund   (owned by orders/payments)
SpendObservation      (workspaceId, campaignId, day, amount, currency, observedAt, source)
AttributionAllocation (computed; declares attributionModelId + attributionModelVersion)
```

⚠️ **Growth-domain contracts use `workspaceId` throughout** (D11). `marketing-microservice` keeps its existing `tenantId`; translate at the adapter boundary. Do not import legacy terminology into the new domain.

Cost, revenue and CLV remain **absent from the lead row** — they are time-varying aggregates owned elsewhere, and CLV is a projection. The read model computes first-touch, last-touch or any declared model without corrupting operational records.

### 4.4.1 Qualified-lead contract (required before Phase 2)

The *business definition* of a qualified lead is an owner decision. The *data contract* is architectural and must not stay implicit — **without it, the first experiment's primary outcome can change after launch and silently invalidate the comparison.**

```ts
interface LeadQualificationEvent {
  eventId: string;
  workspaceId: string;
  leadId: string;
  status: "pending" | "qualified" | "disqualified";
  criteriaVersion: string;
  reasonCodes: string[];
  decidedByType: "human" | "rule";
  decidedById?: string;
  replyChannel?: "email" | "telegram" | "whatsapp" | "other";
  replyObservedAt?: string;
  evidenceReferences: string[];
  occurredAt: string;
  correlationId: string;
  causationId?: string;
}
```

Rules: criteria are **versioned** · a status correction emits a **new event**, never a mutation · the first experiment **declares its `criteriaVersion` before launch** · results report both lead count *and* qualified-lead count · automated qualification is deferred until its precision is measured against human decisions.

Fits the existing `LeadLifecycleEvent` grain in `leads-microservice` (§2.9).

#### `criteriaVersion: "v1-owner-manual"` — owner decision, 2026-07-18

**Two distinct stages. Only the second is qualification.**

**Stage 1 — form validity (frontend, `growth-web`). Not qualification.**
Gates submission only:
- `email` — valid format
- `phone` — valid format (**international/E.164 — markets differ**, see §1.2)
- `message` — non-empty, describes the request

Explicitly **NOT** checked, by owner decision: whether the contact is a real/existing business · whether the company is verifiable · whether details are corporate rather than personal. A prospect may legitimately supply personal contact details.

**Stage 2 — qualified (manual, owner only).**
A lead is `qualified` when **all three** hold:
1. Complete contact information — phone **and** email both present
2. The request is described in detail
3. **The lead has replied to us on any channel** — WhatsApp, Telegram or email

Condition 3 makes qualification a two-way signal: a form submission alone is never qualified.

**Engagement and qualification are separate axes.** `"warm"` is not a qualification status and must not be added to one:

```ts
type QualificationStatus = "pending" | "qualified" | "disqualified";
type EngagementStatus    = "new" | "contacted" | "replied" | "unresponsive";
```

A submitted lead is `qualification=pending, engagement=new`; after a reply `qualification=pending, engagement=replied`; only owner review sets `qualified | disqualified`. Mixing funnel position into the qualification outcome makes both unreadable.

`decidedByType` is **always `"human"`** at v1. The owner marks qualified/disqualified **after working the lead**. No automated or rule-based qualification — v2 of the criteria may add it only after measuring rule precision against these human decisions.

Suggested `reasonCodes`: `COMPLETE_CONTACT` · `DETAILED_REQUEST` · `REPLIED_WHATSAPP` · `REPLIED_TELEGRAM` · `REPLIED_EMAIL` · `INCOMPLETE_CONTACT` · `VAGUE_REQUEST` · `NO_RESPONSE`

**Low qualified volume is acceptable** — explicit owner priority is lead *quality* over quantity. This is consistent with §7.5: decisions rest on economic guardrails and sequential inference, not on significance testing over qualified-lead counts.

> ⚠️ **Verified gap — non-blocking at MVP, blocking at Phase 4.** Condition 3 depends on capturing inbound replies. Today: `notifications-microservice` has a Telegram inbound webhook (`telegram-bot.controller.ts`); **WhatsApp inbound does not exist**; `agentic-email-processing-system` triages email but has **no link to `leadId`**; `leads-microservice` has **no reply/inbound concept at all**.
>
> This does not block Phase 2, because qualification is manual — the owner knows a reply arrived, having received it personally. It **does** matter by Phase 4: offline conversion upload to Google/Meta is time-bounded from the click (~90 days), so manual qualification latency must stay inside that window. Automating reply→lead linkage becomes worthwhile only when manual turnaround approaches that limit.

### 4.4.2 Resolving `workspaceId` for events that predate it

Existing `order.created` carries only `leadId`, `source`, `campaignId`. Orders and payments do not know the Growth workspace. Resolution precedence is explicit and **never silently defaults**:

```
1. CampaignBinding by campaignId
2. otherwise Lead by leadId
3. otherwise Order attribution metadata
4. zero matches     → UNRESOLVED_SCOPE
5. multiple matches → AMBIGUOUS_SCOPE
```

```ts
interface WorkspaceResolution {
  sourceEventId: string;
  workspaceId?: string;
  resolutionMethod: "campaign_binding" | "lead" | "order_metadata" | "unresolved" | "ambiguous";
  resolvedAt: string;
}
```

Required even before SaaS: stage 1 already runs **multiple businesses**, so a silent default would cross-attribute one business's revenue to another.

### 4.5 Three distinct claims — never conflate them

| Claim | Meaning | Buildable here? |
|---|---|---|
| **Traceability** | Which identifiers and events were observed | ✅ Phase 2 |
| **Accounting attribution** | Declared rules allocate revenue to an experiment | ✅ Phase 4 |
| **Causal incrementality** | Additional revenue *caused* by the experiment | ❌ Not at this volume |

The original goal — *"which exact experiment created this revenue?"* — is answerable only as **accounting attribution**. Reports must therefore read *"under attribution model v3, this revenue was allocated to experiment 123"*, never *"experiment 123 caused this revenue."*

Incrementality requires geo holdouts or PSA tests, which need far more traffic than this system will see. Platform-native lift tools are also out of reach at this scale. **Do not build holdout infrastructure.**

Revisit on a **calculated feasibility gate** — a power calculation from actual baseline rate, expected effect, spend and opportunity cost — not a fixed threshold. (v2 said "a few hundred conversions/month"; a computed gate is strictly better.)

A low-volume causal test can still be valid if treatment is randomised *before* exposure, hypothesis and outcome are fixed beforehand, exactly one primary outcome is used, the run covers the conversion-delay window, the result reports a wide interval or posterior, and **an inconclusive result is accepted**. It will detect only large effects; it will not separate a 10–20% improvement from noise.

Persist the seam now, build nothing behind it:

```ts
interface CausalEstimate {
  experimentId: string;
  design: "user_holdout" | "geo_holdout" | "switchback" | "platform_lift";
  assignmentUnit: string;
  treatmentCount: number; controlCount: number;
  effectEstimate: number; uncertaintyLower: number; uncertaintyUpper: number;
  status: "directional" | "conclusive" | "inconclusive";
}
```

Meanwhile: randomise landing/offer variants where *visitor and click* volume is adequate (they are the larger sample — §7.5), and use qualified-lead or booked-consultation outcomes where validated as revenue predictors — **without labelling them revenue incrementality**.

### 4.5.1 Manual metric ingestion for the first experiment

The first capped experiment runs before any connector. Its paid-media metrics still must reach the decision record:

```
Ad platform → owner exports/enters spend, clicks, impressions → ManualSpendObservation → Growth read model
```

```ts
interface ManualSpendObservation {
  observationId: string; workspaceId: string; experimentId: string;
  platform: string; periodStart: string; periodEnd: string;
  amount: Money; evidenceReference: string;   // provider report / export
  enteredBy: string; enteredAt: string;
}
```

Rules: always **labelled manual** · evidence references the provider report · **never presented as invoice-reconciled** · automated connector observations later **supersede rather than overwrite** them.

### 4.6 Money events are not final on arrival

Ad spend is delayed and revised (invalid-click adjustments, currency, tax, credits, billing-period reconciliation, timezone boundaries).

```
SpendObserved → SpendRevised → CreditApplied → InvoiceReconciled
```

**Platform API = operational spend observations. Provider invoice = final billed spend.** Never treat the first as the second.

Symmetrically, `orders`/`payments` must emit reversal events (§2.4) or ROAS is structurally wrong. **Ownership is split so the two services never publish competing revenue truth:**

| `orders-microservice` — commercial fulfilment state | `payments-microservice` — financial state |
|---|---|
| `order.created` · `order.cancelled` · `order.return_requested` · `order.returned` | `payment.authorized` · `payment.captured` · `payment.refunded` (**must support partial**) · `payment.chargeback_opened` / `_won` / `_lost` · `payment.failed` |

**Revenue is computed from payment events.** `order.cancelled` is operational evidence, not automatically a financial reversal.

Every such event carries: `eventId`, `eventVersion`, `occurredAt`, `producer`, `orderId`, `paymentId`, `currency`, `amount`, `correlationId`, `causationId`, `idempotencyKey`.

Both services already have outbox infrastructure (§2.3, §2.10), so this is additive.

### 4.7 `runlayer` — unchanged substrate, typed output

Runlayer proposes, analyses and explains. It **does not** own growth transactions, spend, approvals or campaign state, and **never calls ad-platform write APIs**.

```ts
interface GrowthProposal {
  proposalId: string;  workspaceId: string;  experimentId: string;
  proposedAction: ProposedAction;
  supportingEvidence: EvidenceReference[];
  assumptions: Assumption[];
  modelReference: ModelReference;    // provenance
  promptReference: PromptReference;  // provenance
  createdAt: string;
}
```

Its output is **untrusted input** to deterministic validation and policy evaluation. The "AI Chief Growth Officer" is a set of agents running *on* runlayer — a workload, not a component.

### 4.8 Experiment definitions are immutable and versioned

An experiment record carries: hypothesis, target audience, exclusions, channel, variants, primary metric, guardrail metrics, budget, time window, conversion-delay window, attribution policy, success criteria, maximum acceptable loss, policy version, landing versions, creative versions.

Changing any of these creates a **new version**; it never silently updates the active record.

**One campaign per experiment is an MVP convention, not a schema constraint:**
```
Experiment 1 ──* CampaignBinding *──1 ProviderCampaign
```

---

## 5. Events

| Event | Publisher | Consumers |
|---|---|---|
| `approval.requested` / `.granted` / `.denied` | goalkeeper | any (generic) |
| `experiment.created` / `.launched` / `.decided` | growth-core | leads, logging, notifications |
| `touchpoint.observed` | growth-web | growth-core |
| `lead.captured` | leads | growth-core |
| `spend.observed` / `.revised` | growth-core | monitoring |
| `order.created` | **orders (existing)** | **growth-core (new consumer)** |
| `order.cancelled` · `order.return_requested` · `order.returned` | **orders (NEW — §2.4)** | growth-core, invoices |
| `payment.authorized` · `payment.captured` · `payment.refunded` · `payment.chargeback_opened` · `payment.chargeback_won` · `payment.chargeback_lost` · `payment.failed` | **payments (NEW — §2.4)** | growth-core, invoices |
| `lead.qualification.recorded` | leads | growth-core |

**Never collapse chargeback lifecycle into a generic `payment.chargeback`** — an opened chargeback is not a reversal. Each event carries its own versioned payload schema, with these declared semantics:

```
payment.captured           increases captured revenue
payment.refunded           decreases captured revenue (partial-capable)
payment.chargeback_opened  records contingent exposure
payment.chargeback_won     closes exposure without revenue loss
payment.chargeback_lost    decreases recognised revenue — ONCE (unique on paymentId+kind)
```

Whether an *opened* chargeback immediately reduces operational ROAS is a **declared accounting-policy decision**, recorded in the attribution model version — not a rule hidden inside a consumer.

All Growth-domain events carry `workspaceId`, `correlationId`, `causationId` (**optional — root events have none**), and — where personal data is involved — a **consent evidence reference, not a copied consent record**:

```ts
interface ConsentEvidenceReference {
  consentRecordId: string;
  consentVersion: number;
  applicablePurposes: string[];
  statusAtEventTime: "granted" | "denied" | "withdrawn" | "not_required";
  evaluatedAt: string;
}
```

The canonical consent record stays in the identity/consent domain. Events store the minimum snapshot needed to explain why processing was permitted *at that time*. Anonymous touchpoints persist only identifiers required for the declared purpose; **no raw contact details in Growth events, DecisionArtefacts, or AI prompts** (§7.9).

Transport: RabbitMQ, using the outbox pattern already proven in `catalog`, `warehouse` and `orders` (§2.3, §2.10).

---

## 6. Workflow engine: no Temporal in the MVP, seam preserved

**v1 said "defer indefinitely." Revised: defer, with an explicit migration seam and complexity-based triggers.**

Corrections accepted: Elasticsearch is **not** mandatory (Postgres serves as persistence and visibility store); the adoption trigger is **workflow complexity, not experiment count** — ten complex workflows can justify Temporal where hundreds of simple transitions cannot.

Build one **deliberately narrow** state machine — not a general workflow engine:

```
DRAFT → AWAITING_APPROVAL → APPROVED → SCHEDULED → EXECUTING → VERIFYING → COMPLETED
Terminal: REJECTED · CANCELLED · FAILED · EXPIRED · REQUIRES_RECONCILIATION
```

Required: transactional outbox (copy `catalog`/`warehouse`), idempotency keys, worker leases with expiry, per-operation retry policy, scheduled-transition table, reconciler, dead-letter state, optimistic locking, immutable transition history.

Define an internal `WorkflowPort` so Temporal can replace the implementation without touching domain code.

**Realistic size: 1,500–2,500 LOC with tests** (§2.3), not the ~300 claimed in v1.

**Reconsider Temporal when:** more than one business domain needs long-lived workflows · compensation spans several external systems · workflow-version migration becomes necessary · timer/retry incidents become operationally significant · Temporal Cloud is commercially acceptable.

---

## 7. Connectors, analytics, and operational safety

### 7.1 Platform access — internal-only path

Per §1.1, accounts are owner-owned: **Google Ads Standard/Explorer** and **Meta Standard Access** are the targets. Meta Advanced Access is *not* required (it governs managing other businesses' accounts) — that changes only on commercialisation.

**Sourcing status (2026-07-18):** the external review supplied primary-source citations for the vendor facts below — Google for Developers, Google Help, Microsoft Learn, EUR-Lex, uoou.gov.cz. They are treated as verified, not asserted.

| Claim | Status |
|---|---|
| Google Ads tiers Test/Explorer/Basic/Standard; Explorer 2,880 and Basic 15,000 daily production ops; permissible-use category on Basic/Standard | ✅ Sourced (Google for Developers) |
| 15 June 2026 offline-conversion restriction → new integrations routed to **Data Manager API** instead of `UploadClickConversions` | ✅ Sourced (Google for Developers) — **affects Phase 4 adapter choice** |
| Clarity export: 10 requests/project/day, previous 1–3 days, 3 dimensions, 1,000 non-pageable rows; **URL is a supported dimension** | ✅ Sourced (Microsoft Learn) |
| AI Act general application 2 Aug 2026 incl. Article 50 framework | ✅ Sourced (EUR-Lex) — applicability to a *specific* ad remains legal interpretation |
| Czech DPA: prior consent for non-technical tracking storage/access; separate GDPR basis for the processing | ✅ Sourced (uoou.gov.cz) |
| Meta: Standard Access + `ads_read`/`ads_management` sufficient for owner-owned accounts; Advanced only for third-party accounts | ⚠️ Sourced to Postman (third-party directory) — **confirm against Meta's own docs**, since the internal-first decision (§1.1) rests on it |

> ⚠️ **Phase 0 re-check, narrowed:** re-confirm any figure with timeline or cost consequences immediately before committing — access tiers, quotas and API cutoffs change. This is staleness hygiene for a document that will be read months from now, not doubt about the sourcing above.

### 7.2 Clarity: constrained diagnostic source, never a decision source

Correction accepted: Clarity **does** support URL as a dimension — v1 overstated the limitation. It remains bounded to ~10 requests/project/day, the previous 1–3 days, three dimensions and 1,000 non-pageable rows.

Permitted: aggregate diagnostics (rage clicks, errors, engagement), manual session review. **Forbidden:** any attribution dependency; any automated budget change derived from Clarity.

### 7.3 GTM not used — but distinguish GTM from the Google tag

`growth-web` is owned and version-controlled, so events are emitted server-side. Note the distinction: Google currently recommends the **Google tag** for enhanced conversions for leads, though API-only paths exist. Confirm during Phase 4 implementation.

### 7.4 Conversion upload — with an internal ledger first

Conversion feedback outranks building dashboards. But a minimum **internal event ledger must exist first**, supporting deduplication, consent status, retraction/correction, upload diagnostics, reconciliation, replay and audit evidence.

```ts
interface ConversionDestination {
  upload(events: CanonicalConversionEvent[]): Promise<UploadResult>;
  reconcile(jobReference: string): Promise<ReconciliationResult>;
}
```

External systems (GA4 Data API, Meta Insights) remain **independent validation sources only** — never the primary metric store.

### 7.5 Decision policy — economic guardrails **plus** sequential inference

**v1's "cost-to-signal instead of statistical testing" is withdrawn as a false binary.** Correction accepted: **lead count is not the sample size.** Visitors, clicks and eligible impressions provide usable N even when leads do not — 40 leads from 200 visitors is a different experiment from 40 from 20,000.

Three layers:

1. **Economic guardrails** — maximum experiment loss · maximum spend without a qualified lead · global daily account limit · minimum contribution margin
2. **Sequential inference** — Bayesian posteriors or anytime-valid confidence sequences (valid under continuous monitoring). Bandits may reduce short-term loss but weaken power and complicate causal reading — not at MVP.
3. **Operational completeness** — minimum exposure · conversion-delay window elapsed · data freshness · fraud/bot filtering

```
Kill:    spend > maximum_learning_cost
         AND P(unit_economics_viable | evidence) < 10%

Scale:   minimum_exposure_reached
         AND conversion_window_complete
         AND P(target_margin_met | evidence) > 90%
         AND expected_downside < approved_loss_limit

Else:    continue within approved budget
```

**Thresholds cannot be chosen until traffic, conversion rates, margins and conversion delays are measured** — which is precisely why Phase 2 precedes Phase 5.

### 7.6 Global budget control

Per-experiment approval does not prevent aggregate overspend. Required: platform daily limit · account daily limit · brand/customer limit · experiment lifetime limit · currency-normalised exposure · pending-but-unreported spend allowance · **emergency kill switch** · **no scale on stale data**.

**Provider-side limits are the FIRST line of defence, not a backstop.** If the k3s node fails, local monitoring and the local kill switch fail with it — while provider campaigns keep spending. Before first spend, configure at the platform: campaign lifetime budget · daily provider budget · explicit end date · account spending limit where supported · conservative initial bids · no automated increase without approval.

Local budget controls are the second line.

### 7.7 Connector failure is a first-class business risk

Automation replicates one mistake at speed. Model explicitly:

```
CONNECTOR_DEGRADED · ACCOUNT_RESTRICTED · CREATIVE_REJECTED
CAMPAIGN_LIMITED · TOKEN_REVOKED · BILLING_FAILED
```

On `ACCOUNT_RESTRICTED`, the system must **stop issuing write attempts** rather than retry into a suspension.

### 7.8 Single-node k3s — fail closed

Control-plane co-tenancy is acceptable for MVP; revenue-path co-tenancy is not. One node means landing pages, conversion capture and metrics share a failure domain **while ads keep spending**.

Mitigations: `growth-web` on CDN/edge · Growth API and workers on k3s initially · platform-side spend limits · **fail closed on stale metrics** · never scale while approval or telemetry is unavailable · resource requests/limits + priority classes · off-server backups with a **tested** restore · documented manual global pause.

A second cluster is not required. A tested recovery path is.

### 7.9 Privacy cannot be retrofitted

Click IDs and cookies may constitute personal data under GDPR (online identifiers). Czech sites generally require active consent for non-technical marketing/analytics cookies; **server-side tracking does not remove GDPR/ePrivacy obligations.**

Required from Phase 2: consent state on every event · purpose-specific processing · retention limits · deletion propagation · identity-link separation · DSAR export · auditable conversion-upload eligibility · separate controls for audience matching.

**Consent is not a Boolean.** `consent = true` cannot decide whether an event may be used for analytics, audience matching or conversion upload. Persist at minimum:

```
status · purpose · vendor · policyVersion · capturedAt · withdrawnAt · jurisdiction · collectionMethod
```

**Immutable evidence must not contain PII.** Immutability and the right to erasure are in direct conflict. Never place raw lead PII inside a `DecisionArtefact` or an AI prompt. Use a reference chain:

```
DecisionArtefact → evidenceReference → pseudonymous touchpoint → erasable IdentityLink → Lead
```

Identity can then be deleted or unlinked without destroying the decision history. The immutable record retains only the minimum non-identifying facts needed to explain the decision.

### 7.10 AI content provenance and ad-claim validation

Preserve for every generated asset: model + version, prompt version, source material, generated output, human edits, reviewer, approval timestamp, provenance metadata where supported.

Deterministic (non-LLM) checks before publication: unsupported claims · guarantees · comparative claims · prices/conditions · trademarks · regulated products · health claims · financial claims · employment/housing/political targeting · required disclaimers.

> ⚠️ **An LLM review is not a compliance control.** AI Act Article 50 transparency obligations and Czech advertising law (including sector-specific health-advertising restrictions and a 2026 amendment under consideration) require **a Czech lawyer's review before any regulated-sector ad ships** — not model output, including the model output in this document.

---

## 8. Delivery model

> **The delivery model, feature slices, milestones and coverage matrix live in [`../08_roadmap/DELIVERY_PLAN.md`](../08_roadmap/DELIVERY_PLAN.md) and [`../09_milestones/`](../09_milestones/).**
> This section keeps only what is architectural: the scope cut line.

Summary of the governing decisions (detail in the delivery plan):

- Work is organised as **vertical feature slices**, gated **SPIKE (optional) → DOC → CONTRACT → IMPL → VERIFY**. Coding is last.
- **SPIKE** exists because a contract written before touching an unknown external API encodes guesses rather than reality. Time-boxed, disposable, no production side effect, no real spend.
- A slice covers **only the services required for its declared user outcome** — never every service that might later consume it. Each slice document lists required owners, required consumers, optional future consumers, and explicitly excluded services.
- DOC and CONTRACT stay **separate** documents: the readers are multiple AI agents starting cold, and explicit contracts prevent divergence between implementations.
- Parallel work follows `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md` — declared allowed/forbidden files, one integration owner, defined merge order. Milestones (`../09_milestones/`) are the synchronisation points.

### 8.1 Scope cut line (explicit, for one developer)

| Capability | Before first spend? | Note |
|---|---|---|
| Touchpoint stream | **Yes** | Events not instrumented cannot be reconstructed later |
| Minimal `DecisionArtefact` | **Yes** | Proposal, evidence refs, policy result, approval, planned action |
| Scoped persisted `ApprovalGrant` | **Yes** | Unsigned is fine at MVP |
| `ExecutionAttempt` + `effectKey` | **Yes, before any API write** | Grants authorise; only this deduplicates |
| Global budget ceiling | **Yes** | Internal **and** provider-side |
| Emergency kill switch | **Yes** | Cannot be the only protection — cluster may be down |
| Consent record on tracking events | **Yes** | Structured, not Boolean |
| Correlation **touchpoint → lead** | **Yes** | Acquisition traceability; cannot be reconstructed later |
| Correlation **lead → order → payment → refund** | **No** — MS-003 | Required before net ROAS, value-based upload, revenue scaling, profitability policy training. The first experiment's outcome is a qualified lead, not revenue |
| Version *identifiers* | **Yes** | `experimentVersion`, `landingVersion`, `creativeVersion`, `policyVersion`, `attributionModelId`/`Version`, `decisionArtefactId` — cheap now, unrecoverable later |
| Spend observations | **Yes, before metric ingestion** | Invoice reconciliation + credit modelling may follow |
| Connector execution journal | **Yes, before API writes** | Generic connector state-machine framework may wait |
| Immutable experiment launch snapshot | **Yes** | Version-management UI may wait |
| Refund / chargeback events | **No** — Phase 2.5 | Required before monetary conversion upload, net ROAS, auto-scaling, or training policy on historical profitability |
| AI content provenance | Before AI content **publication** | Not needed for manually written first ads |
| Multiple attribution algorithms | No | One algorithm; the *version field* is mandatory |
| Cryptographic grant signatures | No | Add at cross-trust-boundary execution or real multi-tenancy |
| Holdout / incrementality infrastructure | No | Gate on a power calculation (§4.5) |

---

## 9. Decision log

| # | v1 | v2 | Basis |
|---|---|---|---|
| D1 | Defer Temporal indefinitely | **Revised** — defer from MVP, preserve `WorkflowPort`, complexity-based triggers; ES not required; size 1,500–2,500 LOC | §2.3, §6 |
| D2 | Runlayer = substrate | **Unchanged**, hardened with typed `GrowthProposal` | §4.7 |
| D3 | Freeze BPCP + retire | **Overturned** — freeze features only; extract evaluator as versioned package; retire only after runtime verification | §2.2 |
| D4 | No cost/revenue/CLV on lead | **Upheld and extended** — full touchpoint stream, not first-touch fields | §4.4 |
| D5 | Boundary = identity + consent | **Overturned** — boundary = channel/purpose/platform ownership | §3 |
| D6 | Drop Clarity + GTM | **Upheld, corrected** — Clarity does support URL dimension; distinguish GTM from Google tag | §7.2–7.3 |
| D7 | Conversion upload before analytics | **Upheld**, with internal ledger as prerequisite | §7.4 |
| D8 | Cost-to-signal, not significance | **Overturned as a binary** — economic guardrails **+** sequential inference; lead count ≠ sample size | §7.5 |
| D9 | One `growth-web` | **Upheld**, plus custom domains and immutable landing versions | §4.2 |
| D10 | Goalkeeper = approval + policy | **Upheld**, extended to scoped `ApprovalGrant`; signature deferred | §4.3 |
| D11 | — | **NEW, revised in v3** — Tenancy internal-first; **`workspaceId` on aggregate roots**, not `tenantId` everywhere | §1.1 |
| D12 | — | **NEW** — Traceability / accounting attribution / causal incrementality are distinct; only the first two are buildable | §4.5 |
| D13 | — | **NEW, revised in v3** — Money-reversal events gate *monetary automation* (Phase 2.5), not the first experiment | §4.6, §8 |
| D14 | — | **NEW (v3)** — Grants authorise but do not deduplicate; `ExecutionAttempt` + `effectKey` + reconciliation are mandatory before API writes | §4.3 |
| D15 | — | **NEW (v3)** — Version *identifiers* are mandatory before first spend; version *management* is deferrable | §8.1 |
| D16 | — | **NEW (v3)** — Immutable artefacts hold references, never PII; consent is a structured record, not a Boolean | §7.9 |
| D17 | — | **NEW (v3)** — Provider-side spend limits are the first line of defence; local controls the second | §7.6 |
| D18 | — | **RESOLVED (v3)** — Marketing performs no allocation; Growth supplies paid-channel facts via the existing `ExternalAttributionFact.sourceService` seam. v1's "attribution conflict" withdrawn | §2.11 |
| D19 | — | **NEW (v5)** — Qualified lead = complete contact + detailed request + **replied on any channel**. Manual marking by owner only, after working the lead. Form validity is a separate frontend stage, not qualification. No business-existence check. Quality over volume | §4.4.1 |
| ~~D20 (v5)~~ | — | *Superseded:* multi-market form withdrawn — see the v6 D20 below | — |
| D21 | — | **NEW (v5)** — No historical data exists. All volume estimates withdrawn; Phase 5 thresholds derive from first-experiment measurement | §1.3 |
| D20 | *(v5 multi-market form superseded)* | **Stage 1 is Czech-only, multiple businesses.** One jurisdiction, one currency, Sklik usable. `workspaceId` = one business. Other markets only after stage 1 | §1.2 |
| D22 | — | **NEW (v6)** — Delivery is by **vertical feature slice across all services**, with four mandatory gates: DOC → CONTRACT → IMPL → VERIFY. Verification requires both automated tests **and** an owner manual check | §8.0 |
| D23 | — | **NEW (v6)** — Communication channels (WhatsApp inbound, system-wide email, reply→`leadId` linkage) are **prerequisites S2–S4**, not later refinements — the qualified-lead definition depends on them | §8.1–8.2 |
| D24 | — | **NEW (v6)** — Progress is tracked in a live feature × service coverage matrix | §8.3 |

---

## 10. Open questions

All architectural questions are closed. The remainder are operational, and none blocks Phase 1.

- **Vendor re-check (Phase 0 gate)** — vendor facts are primary-sourced as of 2026-07-18 (§7.1). Two residual items: confirm the **Meta** access boundary against Meta's own docs rather than the third-party citation, and re-confirm any figure carrying timeline or cost consequence immediately before committing.
- **Czech counsel review** — consent model, click-ID storage, health-sector restrictions, AI Act Article 50 applicability. Requires a lawyer, not model output.
- ~~**Qualified-lead definition**~~ — **RESOLVED 2026-07-18**, see §4.4.1 `criteriaVersion: "v1-owner-manual"`.
- ~~**Production measurements**~~ — **CLOSED**: no historical data exists (§1.3). Thresholds derive from first-experiment measurement, not history.
- **Inbound reply capture** (§4.4.1 warning) — WhatsApp inbound missing, email triage not linked to `leadId`. Non-blocking at MVP (qualification is manual); revisit at Phase 4 against the offline-conversion upload window.
- **Second market selection** — deferred until the first business × market loop is proven (§1.2).
- **Infrastructure checks** — RabbitMQ ack/retry/DLQ behaviour; service-to-service auth between goalkeeper and workers; node headroom; last successful restore test; Vault per-connector credential isolation; stale-metric and queue-backlog monitoring.
- **Sklik API maturity and quotas** — unverified; spike in Phase 3.
- **`growth-web` hosting** — which CDN/edge target, given the fail-closed requirement in §7.8.
