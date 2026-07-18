# Growth Platform Architecture v6 — Implementation Readiness Review

**Source reviewed:** `GROWTH_PLATFORM_ARCHITECTURE (1).md`  
**Review type:** final implementation-readiness check  
**Date:** 2026-07-18

## Verdict

The architecture is structurally ready for implementation, but the document is **not yet internally consistent enough to serve as the implementation contract without correction**.

No new architecture round is required. The remaining issues are specification defects:

1. Communication automation is incorrectly made a prerequisite for the first experiment.
2. The first-spend gate requires order/payment linkage that is scheduled after the first experiment.
3. Phase 0 says the first ad platform is selected later, while the delivery plan already assumes Google Ads.
4. The qualified-lead definition uses a `"warm"` state that does not exist in its contract.
5. Approval grants are not bound tightly enough to the exact approved mutation.
6. `workspaceId` cannot yet be resolved reliably across existing order/payment events.
7. The mandatory delivery gates do not allow technical discovery before contracts are fixed.
8. The coverage matrix marks capabilities as missing in services where they may not belong.

These should be corrected in v7 before `S1-approval-execution-governance.md` becomes authoritative.

---

# 1. Critical sequencing contradiction: S2–S4 do not gate the first experiment

The document says all of the following:

- Qualification is manually decided by the owner.
- The owner may know that a reply arrived without automated reply-to-lead linkage.
- Missing WhatsApp/email linkage is non-blocking at MVP.
- S2–S4 are mandatory prerequisites for S6 and the first capped experiment.

These positions cannot all be true.

The first experiment does not require automated inbound communication if the owner manually qualifies leads after observing replies in Telegram, WhatsApp or email.

## Recommended correction

Move S2–S4 off the critical path:

```text
S1 ──► S5 ──► S6 ──► FIRST CAPPED EXPERIMENT
                         │
                         ├──► S7 ──► connector and financial automation
                         │
S2 ──► S4 ───────────────┤
S3 ──► S4 ───────────────┘
```

S2–S4 become prerequisites for:

- Automatic reply-to-lead evidence
- Reliable conversion upload based on reply-qualified leads
- Multi-user lead handling
- Reduced manual qualification latency
- Communication analytics

They are **not prerequisites for manually marking a lead qualified**.

Keeping S2–S4 before the first experiment would expand the pre-revenue scope into WhatsApp webhooks, generic email ingestion, communication identity resolution and cross-service channel support. That directly conflicts with the stated goal of protecting the first measurable experiment.

## Correct first-experiment process

```text
1. Lead submits a valid form.
2. Lead is stored as pending qualification.
3. Owner communicates through any available channel.
4. Owner manually records qualified or disqualified.
5. Evidence may initially be a channel, timestamp and optional note/reference.
6. Automated message linkage is added later through S2–S4.
```

---

# 2. First-spend scope contradicts S7 sequencing

The scope-cut table says this must exist before first spend:

> Correlation touchpoint → lead → order → payment

But the first capped experiment is scheduled before S7, while S7 adds:

- Lead-to-order population
- Payment events
- Refund and chargeback handling
- Net-revenue read model

The first experiment uses qualified lead as its primary outcome. Therefore order/payment correlation is not a first-spend requirement.

## Replace the single requirement with two gates

### Before first spend

```text
touchpoint → lead
```

Required for acquisition traceability.

### Before monetary optimisation

```text
touchpoint → lead → order → payment → refund/chargeback
```

Required before:

- Net ROAS
- Revenue-valued conversion upload
- Revenue-based scaling
- Profitability policy training

The first experiment may display manually observed gross revenue as provisional, but it must not use it as an automated decision signal.

---

# 3. The first ad platform is not actually undecided

Phase 0 says:

> Select one business, one market and one ad platform.

The feature plan then defines:

- S8 — Google Ads read-only
- S9 — Google Ads writes
- S10 — conversion upload following Google integration
- S13 — Sklik only after S9

This means the implementation baseline already selects Google Ads first.

## Choose one explicit position

### Recommended

State:

> Stage 1 uses Google Ads as the first platform. Sklik follows after the Google execution and reconciliation path is proven.

This makes S8–S10 accurate.

### Alternative

Rename the slices:

```text
S8  Selected-platform connector — read-only
S9  Selected-platform connector — approved writes
S10 Selected-platform conversion upload
```

Then choose Google or Sklik in Phase 0.

Do not keep a nominal Phase 0 decision when the implementation plan has already made the decision.

---

# 4. Qualified-lead state is inconsistent

The contract permits:

```ts
status: "pending" | "qualified" | "disqualified";
```

The prose says:

> A form submission alone is never qualified. Such a lead is `"warm"`.

`"warm"` is not a qualification status.

## Recommended model

Keep qualification and engagement separate.

```ts
type QualificationStatus =
  | "pending"
  | "qualified"
  | "disqualified";

type EngagementStatus =
  | "new"
  | "contacted"
  | "replied"
  | "unresponsive";
```

A submitted lead may therefore be:

```text
qualificationStatus = pending
engagementStatus = new
```

After a reply:

```text
qualificationStatus = pending
engagementStatus = replied
```

After owner review:

```text
qualificationStatus = qualified | disqualified
```

Do not add `"warm"` to `QualificationStatus`; it mixes funnel engagement with qualification outcome.

## Contract addition for manual evidence

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

This supports the manual MVP without pretending automated reply linkage already exists.

---

# 5. Approval grants must bind the exact approved action

The current grant contains:

```text
permittedAction
resourceId
maximumAmount
decisionArtefactId
```

This may still allow execution against a changed resource or with parameters different from what the owner reviewed.

Example:

```text
Owner approves:
  campaign X
  daily budget 500 CZK
  targeting version 3

Before execution:
  campaign targeting changes
  worker submits a different payload
```

The grant is still technically valid unless execution verifies the exact approved payload.

## Add immutable action binding

```ts
interface ApprovalGrant {
  grantId: string;
  workspaceId: string;
  decisionArtefactId: string;
  permittedAction: string;
  resourceId: string;
  expectedResourceVersion?: string;
  approvedParametersHash: string;
  maximumAmount?: Money;
  validUntil: string;
  policyVersion: string;
  singleUse: boolean;
  issuedAt: string;
  consumedAt?: string;
}
```

Before execution, the worker must:

1. Canonicalise the actual outbound action.
2. Calculate its hash.
3. Match it to `approvedParametersHash`.
4. Check `expectedResourceVersion` where applicable.
5. Reject execution if either differs.

The `DecisionArtefact` hash protects the record from mutation. `approvedParametersHash` protects the side effect from drifting away from the reviewed action.

---

# 6. Define how existing events resolve `workspaceId`

Growth events use `workspaceId`, but existing `order.created` contains only:

```text
leadId
source
campaignId
```

Existing order and payment services may not know the Growth workspace.

The document must define resolution precedence.

## Recommended resolution contract

```text
1. Resolve from CampaignBinding by campaignId.
2. Otherwise resolve from Lead by leadId.
3. Otherwise resolve from Order attribution metadata.
4. If zero matches: UNRESOLVED_SCOPE.
5. If multiple matches: AMBIGUOUS_SCOPE.
6. Never assign a default workspace silently.
```

Persist the resolution result:

```ts
interface WorkspaceResolution {
  sourceEventId: string;
  workspaceId?: string;
  resolutionMethod:
    | "campaign_binding"
    | "lead"
    | "order_metadata"
    | "unresolved"
    | "ambiguous";
  resolvedAt: string;
}
```

Before SaaS, this may look unnecessary because one operator owns everything. It is still required because Stage 1 explicitly supports multiple businesses.

---

# 7. Add a discovery/spike exception to DOC → CONTRACT → IMPL → VERIFY

The four-gate model is good for deterministic domain work. It is too rigid for uncertain external integrations.

Examples:

- Google Ads access and idempotency behaviour
- Sklik API maturity
- WhatsApp inbound webhooks
- Edge durable queues
- Provider reconciliation capabilities

A contract written before testing these systems may encode assumptions rather than reality.

## Revised delivery gates

```text
0. SPIKE      — optional, time-boxed; no production implementation
1. DOC        — business behaviour and boundaries
2. CONTRACT   — types, APIs, schemas, failure semantics
3. IMPL       — implementation across required owners
4. VERIFY     — automated path plus owner check
```

Rules for `SPIKE`:

- It is allowed only when an external or unknown technical constraint blocks a reliable contract.
- It produces a short findings document.
- Spike code is disposable unless reviewed and promoted deliberately.
- No production side effect or real spend occurs.
- The contract is written after the spike resolves the unknown.

This is not an excuse to code before specification. It prevents specification from being based on guesses.

---

# 8. Vertical slices should cover required owners, not every adjacent service

The delivery principle currently says that adding WhatsApp means implementing it in notifications, marketing, leads and Growth in one slice.

That is too broad as a universal rule.

A capability should be implemented across **every service required for its first complete user journey**, not every service that might later consume it.

For inbound WhatsApp reply capture, the minimum path may be:

```text
WhatsApp provider
→ notifications
→ leads
→ manual qualification surface
```

Marketing and Growth need the event only when they have a defined requirement:

- Marketing: communication history or owned-channel journey
- Growth: qualification/conversion projection

Adding them pre-emptively creates coupling and expands the slice.

## Correct principle

> A vertical slice must be end-to-end complete for its declared user outcome. It must not create speculative integrations in services with no current ownership or consumer requirement.

Every slice document should list:

```text
Required owners
Required consumers
Optional future consumers
Explicitly excluded services
```

---

# 9. Coverage matrix corrections

The matrix is useful, but `❌` currently mixes three different meanings:

1. Missing and required
2. Missing but deferred
3. Not owned by the service

That makes the matrix look worse than the architecture and encourages unnecessary implementation.

## Use four states

```text
✅  implemented
🔨  required in current slice
◷  planned/deferred
—  not owned or not applicable
```

Examples:

### Outbox pattern

An outbox is not required in every service. It is required only when a service must atomically persist domain state and publish an event.

Therefore:

- `notifications`: `—` unless it publishes transactional domain events
- `leads`: `🔨` only when qualification/event publication requires atomicity
- `marketing`: `—` unless new facts are transactionally emitted
- `goalkeeper`: `🔨` for approval/grant events
- `payments`: `🔨` for money events

### Consent evidence

S5 currently touches Growth Web, Growth Core and Leads, but the matrix marks Notifications and Marketing as missing under S5.

Either:

- Add them to the S5 contract because they genuinely need consent evidence in that slice, or
- Mark them `◷` or `—`.

A coverage matrix must reflect slice ownership exactly.

---

# 10. Czech-only simplifications need narrower wording

The document says:

- One Czech counsel review covers all businesses.
- One consent regime applies uniformly.
- No FX normalisation is needed.

These are useful planning assumptions but too absolute.

## Corrected wording

### Legal

> Stage 1 uses one jurisdictional framework. Czech counsel establishes the common baseline, while regulated sectors, claims and audience use may require business-specific review.

A dental-service ad and a general software ad are not necessarily covered by the same final legal assessment.

### Consent

> Stage 1 uses one jurisdiction, but consent requirements remain purpose-, vendor-, channel- and processing-specific.

The architecture already models purpose and vendor. The summary should not imply a single universal consent decision.

### Currency

> Stage 1 targets CZK economics. Connector onboarding must verify the billing currency of each ad account. Currency remains explicit in all spend and revenue contracts.

Do not assume an owner-owned provider account is necessarily billed in CZK.

---

# 11. First experiment needs an explicit manual measurement path

The first capped experiment occurs before automated Google metrics and connector slices.

Define how its data enters the system.

## Minimum manual path

```text
Ad platform metrics
→ owner exports or enters spend/click/impression totals
→ ManualSpendObservation / ManualPlatformMetric
→ Growth read model
```

Example:

```ts
interface ManualSpendObservation {
  observationId: string;
  workspaceId: string;
  experimentId: string;
  platform: string;
  periodStart: string;
  periodEnd: string;
  amount: Money;
  evidenceReference: string;
  enteredBy: string;
  enteredAt: string;
}
```

Rules:

- Manual observations are labelled as manual.
- Evidence references the provider report or screenshot/export.
- They are never presented as invoice-reconciled.
- Automated connector observations later supersede rather than overwrite them.

Without this path, the document protects a first experiment but does not define how its paid-media metrics reach the decision record.

---

# 12. Editorial corrections

These do not change architecture but should be fixed before v7 is declared authoritative.

1. `D20` appears twice. Keep one D20 and mark the previous multi-market form as superseded in prose.
2. Section `8.1` is used for both Feature Slices and Scope Cut Line. Rename the latter to `8.4`.
3. The document header lists a v4 changelog but not a structured v5/v6 changelog. Consolidate the change history.
4. Section 2.3 says two outbox implementations, while later evidence identifies a third in Orders. Rename it to “multiple production outbox implementations” or list all three.
5. Section 2.8 still says in-memory callback idempotency “becomes a double-spend path.” Later text correctly narrows this. Use the later wording everywhere.
6. Section 7.1 still says “Google Ads Standard/Explorer are the targets,” while the same paragraph says Explorer or Basic is realistic and Standard likely unnecessary. Replace with “Explorer or Basic.”
7. Initial/root events may not have a `causationId`. Define it as optional rather than claiming every event always carries one.
8. The `ApprovalGrant` comment says `consumedAt` is set transactionally “at execution.” Clarify that it is transactional with local state only, not the provider side effect.
9. `payment.chargeback_lost` decreases recognised revenue only once. Add uniqueness/idempotency constraints to prevent duplicate application.
10. The companion document list should include the actual v6 implementation plan or remove stale round references if they are no longer operationally useful.

---

# 13. Corrected delivery order

## Parallel Phase 0

- Confirm legal entity and ad-account ownership.
- Select the first business.
- Confirm Google Ads as the first platform, or generalise S8–S10.
- Apply for API access.
- Establish the Czech legal and consent baseline.
- Run technical spikes where external behaviour is unknown.
- Select the durable edge-ingestion implementation.

## Critical path to first experiment

```text
S1  Approval and execution governance
S5  Landing, consent, touchpoints and durable ingestion
S6  Manual qualification contract and surface
FIRST MANUALLY CAPPED EXPERIMENT
```

Manual experiment requirements:

- Provider-side daily and lifetime budget
- Explicit campaign end date
- No automated scaling
- Manual ad creation
- Manual metric/spend ingestion
- Touchpoint-to-lead traceability
- Owner qualification
- Provisional gross revenue only

## Parallel/non-blocking communication path

```text
S2  WhatsApp inbound
S3  Generic inbound email
S4  Automated inbound reply → lead linkage
```

Complete before automatic reply-based qualification or before manual turnaround threatens conversion-upload deadlines.

## Post-experiment automation

```text
S7   Money lifecycle
S8   First connector read path
S9   Approved connector writes
S10  Conversion upload
S11  Decision recommendations
S12  AI generation
S13  Second platform connector
```

B1 remains independent backlog work after S1.

---

# Final acceptance conditions

`GROWTH_PLATFORM_ARCHITECTURE.md` may be promoted to v7 and used as the implementation baseline after these changes:

1. Remove S2–S4 from the first-experiment critical path.
2. Split pre-spend traceability from pre-monetary-automation correlation.
3. Resolve whether Google is definitively the first platform.
4. Separate engagement state from qualification state.
5. Bind ApprovalGrant to an exact action hash and resource version.
6. Define workspace resolution for existing events.
7. Add the optional SPIKE gate.
8. Limit vertical slices to necessary owners and consumers.
9. Correct the feature × service matrix semantics.
10. Define manual spend and platform-metric ingestion for the first experiment.
11. Narrow the Czech legal, consent and currency assumptions.
12. Apply the editorial consistency fixes.

After these corrections, implementation should begin with:

```text
shared/docs/growth/S1-approval-execution-governance.md
```

No further broad architecture review is justified unless implementation evidence invalidates a boundary or contract.
