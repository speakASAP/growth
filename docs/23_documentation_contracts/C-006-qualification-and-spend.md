# C-006 — Contract: qualification and manual spend

**Slice:** S6 · **Gate:** ② CONTRACT · **Feature:** [F-006](../10_features/F-006-qualification-and-spend.md)
**Decisions:** D19 (architecture §4.4.1) · [D-002](../07_decisions/D-002-landing-conversion-and-buffer.md) · [D-005](../07_decisions/D-005-gsid-propagation-correction.md)
**Status:** ready for IMPL · **Date:** 2026-07-22

Machine-readable schemas: [`schemas/`](schemas/)

Envelope: unchanged from [C-005](C-005-landing-and-ingestion.md) §1.

---

## 1. `growth.lead.qualification_recorded.v1`

Producer `leads-microservice` · consumer `growth-core` · `dataClass: "personal"`
Exchange `leads.events` · routing key = event type
Schema: [`schemas/lead.qualification_recorded.v1.json`](schemas/lead.qualification_recorded.v1.json)

```ts
interface LeadQualificationRecordedPayload {
  qualificationId:            string;
  leadId:                     string;
  criteriaVersion:            "v1-owner-manual";
  qualificationStatus:        "qualified" | "disqualified";
  decidedByType:              "human";
  decidedById:                string;   // authenticated admin user id
  decidedAt:                  string;
  reason:                     string;   // non-blank
  supersedesQualificationId?: string;
}
```

### 1.1 `pending` is not a value

`pending` is the **absence** of any qualification event for a lead, never an emitted one. Emitting
it would record a non-decision as a decision, and it would make "the owner has not worked this lead
yet" indistinguishable from "the owner looked and deferred". The read model derives `pending` by
outer-joining leads against judgements.

This matters for the cost metric ([F-006](../10_features/F-006-qualification-and-spend.md)): pending
leads stay in the numerator of cost-per-qualified. A derived `pending` cannot drift from that rule
because there is nothing to set.

### 1.2 Corrections append

A changed judgement emits a **new** event carrying `supersedesQualificationId`. Nothing is updated
or deleted. `criteriaVersion` and `decidedByType` are `const` in the schema on purpose: a later
criteria revision or a non-human decider is a **new event version**, so a judgement recorded under
v1 rules can never be silently re-read under different ones.

### 1.3 Who may qualify — resolved

`decidedById` is the authenticated admin user id taken from `AdminAuthGuard`
(`leads-microservice/src/auth/admin-auth.guard.ts`), which already validates against
`auth-microservice` and carries a real `user.id`. It is **not** the literal string `"owner"`.

F-006 open question 4 asked whether v1 is owner-only or any authenticated operator. Answer: the
guard's existing accepted-role set decides, and the event records **which** principal decided. This
costs nothing now and is the difference between an auditable history and an anonymous one once a
second operator exists.

### 1.4 The current verdict is the head of the chain — resolved 2026-07-23

A lead's current verdict is the judgement **no other judgement for that lead supersedes**. It is not
the latest `decided_at`. `supersedesQualificationId` is the producer's statement of what a
correction replaces; `decided_at` is a clock that agrees with that statement only while deliveries
arrive in decision order. The read model ranked by time until 2026-07-23 and was therefore wrong on
a redelivered or late correction, on two judgements sharing a `decided_at`, and on a first
judgement re-emitted after a correction chain — all of which surfaced a superseded judgement as
current and fed `costPerQualifiedLead` (§6) with no visible symptom.

Several judgements can be unsuperseded at once — two independent first judgements, or a correction
whose predecessor has not arrived. The order is made total so the same rows never yield two
answers:

1. not superseded by any other judgement for the lead;
2. longest supersession chain — a judgement carrying three corrections outranks one carrying two;
3. `decidedAt`, then `receivedAt`, then `qualificationId` descending.

Rules 2 and 3 rank shapes the data does not really answer; the point is that they answer the same
way on every read. The walk is depth-capped at 64: qualification ids come from the producer, so a
cycle is reachable by a broken one, and a report that answers arbitrarily beats a report that hangs.

`pending` is unaffected — it remains the absence of any judgement (§1.1).

---

## 2. `growth.spend.observed_manual.v1`

Producer `growth-core` (owner-entered) · `dataClass: "operational"`
Schema unchanged from [C-005](C-005-landing-and-ingestion.md) §2.4 —
[`schemas/spend.observed_manual.v1.json`](schemas/spend.observed_manual.v1.json).

This slice adds the **intake surface**, not the contract.

### 2.1 Intake endpoint

```
POST /spend/observations        (growth-core, ClusterIP only)
Content-Type: application/json
```

Body is the **payload**, not a full envelope — `growth-core` is the producer here, so it mints
`eventId`, `occurredAt`, `producer`, `correlationId` and `dataClass` itself. Accepting a
caller-supplied envelope would let the caller claim to be a different producer.

| Response | Meaning |
|---|---|
| `201` | observation stored and queued for publication |
| `200` | same `observationId` already stored — idempotent replay, body echoes the stored row |
| `400` | payload fails the contract schema |
| `409` | same `observationId` stored with a **different** body |
| `503` | datastore unwritable |

The built envelope is validated against the contract schema **before** it is stored, by the same
`validateEnvelope` the ingest edge uses. growth-core producing an event it would itself reject on
ingest is exactly the drift the shared validator exists to prevent.

Publication goes through the existing `ingest.event_buffer`, so a broker outage delays the
observation rather than losing it — the durability the buffer already provides, reused rather than
reimplemented.

### 2.2 Money

`amount.value` is a decimal **string** (`^-?\d+(\.\d{1,4})?$`), never a float, in the event and in
every API response. Stored as `NUMERIC(20,4)` — exact decimal in Postgres, not IEEE-754 — and cast
back to text on read. A negative value is permitted by the schema and is meaningful: a provider
credit or a correction.

### 2.3 Superseding, not overwriting

Connector observations (S8) later supersede manual ones. Both remain queryable. The manual row is
never updated and never deleted; `is_manual` stays `true` so nothing downstream can present an
owner-typed number as invoice-reconciled.

`supersededByObservationId` is **not implemented in S6** — no connector exists to write it. The
column exists so S8 does not need a migration on a table that already holds production rows.

### 2.4 Granularity — unresolved, deliberately

The schema keys an observation on `(experimentId, platform, periodStart, periodEnd)` with **no
campaign dimension**. Per-day per-experiment is sufficient while one campaign runs per experiment.

Per-campaign spend requires `campaignId` in the payload, which is a **v2 schema**, not a field
added quietly to v1. Flagged for the owner in [F-006](../10_features/F-006-qualification-and-spend.md);
not decided here.

---

## 3. `growth-core` consumption

| Queue | Exchange | Routing key | Written to |
|---|---|---|---|
| `growth.lead-created` | `leads.events` | `growth.lead.created_from_registration.v1` | `qualification.lead` |
| `growth.lead-qualification` | `leads.events` | `growth.lead.qualification_recorded.v1` | `qualification.lead_qualification` |

`growth.lead-created` was declared and bound during S5 and had no consumer until this slice. Both
queues are declared **and bound** by the consumer on boot, per the rule that a topic exchange
discards a message with no matching binding.

### 3.1 Ordering is not assumed

A qualification may arrive **before** the lead that it references — a redelivery, a replay, or
simply two queues draining at different rates. `qualification.lead_qualification` therefore carries
**no foreign key** to `qualification.lead`. Rejecting an early qualification would nack-requeue it
into a spin against a lead row that has not been written yet.

The join is by `lead_id` at read time. A qualification with no lead is visible and countable rather
than lost, which is the correct failure: the judgement is the scarcer fact.

### 3.2 Idempotency

Both consumers are idempotent on the event's own identity — `lead_id` for a lead,
`qualification_id` for a judgement. Brokers deliver at least once. Re-delivery is a no-op, not a
duplicate row and not an error.

---

## 4. Storage

Schema `qualification`:

```sql
qualification.lead
  lead_id            text primary key       -- from the event, not minted here
  user_id            text not null
  correlation_id     text                   -- null when the registration bypassed a growth landing
  workspace_id       text not null
  source_service     text not null
  created_at         timestamptz not null   -- when the lead was created, from the event
  received_at        timestamptz not null default now()

qualification.lead_qualification            -- append-only
  qualification_id            text primary key
  lead_id                     text not null   -- NO fk, see 3.1
  workspace_id                text not null
  criteria_version            text not null
  qualification_status        text not null check (in ('qualified','disqualified'))
  decided_by_type             text not null
  decided_by_id               text not null
  decided_at                  timestamptz not null
  reason                      text not null check (length(btrim(reason)) > 0)
  supersedes_qualification_id text
  received_at                 timestamptz not null default now()
```

Schema `spend`:

```sql
spend.manual_observation
  observation_id                 text primary key
  experiment_id                  text not null
  workspace_id                   text not null
  platform                       text not null
  period_start                   date not null
  period_end                     date not null
  amount_value                   numeric(20,4) not null
  amount_currency                text not null check (amount_currency ~ '^[A-Z]{3}$')
  evidence_reference             text not null
  entered_by                     text not null
  entered_at                     timestamptz not null
  is_manual                      boolean not null default true check (is_manual)
  superseded_by_observation_id   text                     -- S8, see 2.3
  recorded_at                    timestamptz not null default now()
  check (period_end >= period_start)
```

Every table grants the runtime role `growth_core` explicitly, per the repository invariant. The
runtime role gets `SELECT, INSERT` on `lead_qualification` and **no `UPDATE`/`DELETE`** — the
append-only guarantee enforced by privilege, matching `decision_artefact`.

`qualification.lead` and `spend.manual_observation` get full DML: a lead's facts come from an event
that may legitimately be corrected upstream, and S8 must be able to write
`superseded_by_observation_id`.

---

## 5. Failure semantics

| Case | Behaviour |
|---|---|
| Qualification for an unknown lead | Stored. Countable, joined at read time (§3.1) |
| Duplicate delivery | No-op, acked |
| Unparseable message | Dropped with the body logged, nacked without requeue |
| Database failure mid-consume | Nacked **with** requeue; the writes are idempotent so redelivery is safe |
| Broker down at boot | Logged; the pod does **not** crash-loop. Queues are durable, events wait |
| Broker down at spend intake | `201` still returned — the buffer holds the event and the drain retries |

---

## 6. The experiment report — read API (S6b, 2026-07-22)

`growth-core`, ClusterIP only, no ingress. Derives; stores nothing.

```
GET /experiments/:experimentId/report      200 always (an experiment with no data is 0, not 404)
```

### 6.1 Response

```ts
interface ExperimentReport {
  experimentId:   string;
  workspaceId:    string;
  generatedAt:    string;
  currency:       string | null;   // null when there is no spend yet
  spend: {
    total:        string | null;   // decimal STRING, 4dp, null when no observations
    observations: number;
    mixedCurrency: boolean;        // see 6.4
  };
  registrations:  number;          // = leads, the primary metric
  attribution: {
    attributed:   number;
    unattributed: number;          // consent refused / cookie cleared — NEVER hidden, see 6.5
  };
  verdicts: {
    qualified:    number;
    disqualified: number;
    pending:      number;          // DERIVED — absence of a judgement, never stored (§1.1)
  };
  costPerRegistration:   string | null;   // decimal STRING, 2dp, null => render "—"
  costPerQualifiedLead:  string | null;   // decimal STRING, 2dp, null => render "—"
}
```

### 6.2 Money is decimal end to end

Totals are summed as scaled integers (`BigInt`, scale 4) parsed from the stored `NUMERIC(20,4)`
text — never through `Number`, `parseFloat` or JSON's number type. A cost metric is a division, so
it is rounded **half-up to 2 decimal places** and returned as a string. `1500.0000 / 7` is
`214.29`, not `214.28571428571428`.

`Number.parseFloat` on a money string is the defect this clause exists to prevent, and
`money.spec.ts` fails if the sum path is routed through a float.

### 6.3 Division safety

Zero registrations → `costPerRegistration` is `null`. Zero qualified → `costPerQualifiedLead` is
`null`. Both render as `—`. Never `Infinity`, never `NaN`, never `0`.

`0` would be the dangerous answer: it reads as "this experiment is free" at exactly the moment it
has produced nothing.

### 6.4 One currency, or none

Cost metrics require a single currency across the experiment's observations. If observations carry
more than one, `mixedCurrency` is `true`, `currency` is `null` and **both cost metrics are `null`**.
Summing CZK and EUR into one number would produce a figure that is wrong and looks fine, which is
worse than no figure. The screen states the reason rather than showing a blank.

### 6.5 Pending counts, and the split is not optional

`costPerQualifiedLead = totalSpend / qualified`. Leads that are `pending` or `disqualified` stay in
the **numerator** — the owner paid for those clicks regardless (F-006, owner decision 2026-07-19).

`attribution.unattributed` is a required field, not an optional one. Consent refusal means some
conversions are structurally unattributable ([D-003](../07_decisions/D-003-session-propagation-retention-buffer.md)
§Q2), so measured conversions are **lower than actual**. A cost-per-registration read without that
split looks worse than reality and invites a wrong kill decision. A renderer that omits it is
non-conforming.

### 6.6 The leads/experiment dimension gap — owner decision needed

`qualification.lead` carries `workspace_id` but **no `experiment_id`**; spend is keyed by
`experimentId`. The report therefore counts **every lead in the workspace** against the spend of
the named experiment. While one experiment runs per workspace this is correct. It is wrong the
moment a second one does — the same defect class as §2.4's missing `campaignId`, and it is flagged,
not silently papered over. The response repeats this as `workspaceId` so the scope is visible.

### 6.7 The screen

Server-rendered HTML on `growth-core` at `GET /experiments/:experimentId` — campaign parameters,
the numbers above, and a form posting to the existing `POST /spend/observations`.

**It is deliberately NOT on `growth-web`.** `growth-web` is public on `bazos.alfares.cz/l` and has
no authentication of any kind; an owner-only screen showing spend and lead counts must not be
reachable there. `growth-core` has no ingress, so the screen inherits the same access control the
rest of this service already relies on: the owner reaches it with `kubectl port-forward`. Putting
it on a public host requires an authenticated surface (S1b) and is an **owner decision**, not an
implementer's — see §6.8.

### 6.8 Not decided here

Publishing the screen on a public hostname. It needs a real authenticated surface first; adding a
path to an ingress is what would expose it, and this slice adds none.

**Decided by the owner, 2026-07-23 — recorded here, still not done in this slice.** The screen, and
the decision-recording cabinet it grows into, are published only behind a login through
`auth-microservice`. That work is slice **S6c**, gated on **S1b**, and it does not change anything
this contract specifies: the endpoints, the numbers and their failure semantics stay as written
above, and until S6c ships `growth-core` has no ingress and `port-forward` remains the access
control. HTTP Basic behind an ingress was offered as the faster route and refused. See
`../08_roadmap/DELIVERY_PLAN.md` §10.

---

## 7. Not in this contract

- Connector-sourced spend and actual superseding — S8.
- Any automated, rule-based or AI qualification — excluded by D19 §4.4.1, and the `const`s in §1
  are what make adding one require a contract change rather than a code change.
