# F-006 — Lead qualification and manual spend entry

**Slice:** S6 · **Milestone:** MS-002 · **Gate:** ① DOC
**Status:** draft · **Created:** 2026-07-19 · **Depends on:** [F-005](F-005-landing-and-ingestion.md)

---

## Outcome

The owner can look at a running experiment and answer two questions: **what did it cost, and were the registrations any good?**

Concretely: enter the day's ad spend by hand, mark registered leads qualified or not after working them, and see cost per registration and cost per qualified lead side by side.

**How we know it works:** run a day of the experiment, enter spend, qualify three leads and disqualify two, and read both metrics off the experiment view.

---

## Scope reduced — read this first

An earlier design ([D19](../06_architecture/ARCHITECTURE.md)) made manual qualification the experiment's **primary metric**. [D-002a](../07_decisions/D-002-landing-conversion-and-buffer.md) replaced it: **registration is the conversion signal**, qualification became a post-hoc quality assessment.

That shrinks this slice considerably:

| Then | Now |
|---|---|
| Qualification gates the experiment result | Registration gates it; qualification annotates it |
| Needed before the first ad runs | Can arrive after the first ad runs |
| Blocked on reply-channel capture (S2–S4) | No channel dependency at all |

The slice is now **two small surfaces**, not a subsystem.

### Required owners

| Service | Change |
|---|---|
| `growth-core` | `ManualSpendObservation` intake; experiment view showing cost per registration and per qualified lead |
| `leads-microservice` | `LeadQualificationEvent` persistence on top of the **existing** status handling |
| CRM frontend (client panel) | Expose qualification in the custom CRM the owner already uses |

### Explicitly excluded

- Automated qualification — deferred until rule precision can be measured against human decisions ([D19](../06_architecture/ARCHITECTURE.md) §4.4.1)
- Reply-channel capture (S2–S4) — parallel track, not a dependency
- Any connector-sourced spend — S8
- Decision rules acting on these numbers — S11, and per [D-002](../07_decisions/D-002-landing-conversion-and-buffer.md) they stay advisory

---

## Behaviour

### 1. Manual spend entry

No connector exists at MS-002. The owner reads totals from the Google Ads interface and enters them.

Contract already written: `growth.spend.observed_manual.v1` ([C-005](../23_documentation_contracts/C-005-landing-and-ingestion.md) §2.4). This slice adds the **surface**, not the contract.

Rules carried from architecture §4.5.1:

- always labelled manual, never presented as invoice-reconciled
- `evidenceReference` points at the provider report or export the number came from
- connector observations later **supersede** manual ones — never overwrite, both remain visible

### 2. Qualification — in the existing CRM, not a new surface

**Owner decision 2026-07-19:** qualification happens in the **custom CRM in the client panel**, where the owner already changes statuses by hand wherever automation does not cover them. No separate qualification UI is built.

This shrinks the slice again. `leads-microservice` already carries lead status:

```
leads-microservice/src/leads/leads.controller.ts   PATCH /leads/:id  → status
leads-microservice/src/leads/integrations/lifecycle-event-router.service.ts
```

So the work is **not** "build qualification" — it is "make the existing status change emit a versioned, immutable qualification event, and show the two axes in the CRM."

The owner works a registered lead, then records a judgement. Criteria are `v1-owner-manual` ([D19](../06_architecture/ARCHITECTURE.md)):

```
qualified   = complete contact (phone AND email)
            + detailed request
            + replied on any channel
```

`decidedByType` is always `"human"` at v1. No rule-based qualification.

Two axes stay separate — mixing them makes both unreadable:

```ts
type QualificationStatus = "pending" | "qualified" | "disqualified";
type EngagementStatus    = "new" | "contacted" | "replied" | "unresponsive";
```

A status correction emits a **new event**. History is never mutated.

### 3. Experiment view

```
Experiment · Bazos · CZ · 2026-07-19

  spend (manual)            15 000 CZK
  registrations                    24     ← primary metric
  cost per registration           625 CZK

  attributed                       19  (79%)
  unattributed                      5  (21%)     ← consent refused / cookie cleared

  qualified                         7
  disqualified                     11
  pending                           6          ← counted against cost, not as qualified
  cost per qualified lead       2 143 CZK      ← 15 000 / 7
```

### Pending counts against cost — owner decision 2026-07-19

`cost per qualified lead = total spend / qualified count`. Registrations still `pending` are **not** excluded from the numerator.

This is the conservative reading and it is the honest one: you paid for those clicks whether or not the lead was ever worked. Excluding unworked leads would flatter the metric exactly when the owner is behind on working them — the moment the number most needs to be pessimistic.

Consequence to watch: a backlog of `pending` makes cost-per-qualified look worse than the experiment deserves. The `pending` count sits next to the metric so the cause is visible rather than inferred.

**The attributed/unattributed split is not optional.** No consent means no `gsid` means no attribution ([D-003](../07_decisions/D-003-session-propagation-retention-buffer.md) §Q2). Measured conversions are structurally lower than actual, and a cost-per-registration read without that split will look worse than reality. Showing one number without the other invites a wrong kill decision.

---

## Open questions — resolve before CONTRACT

1. ✅ ~~Where does the owner qualify leads?~~ — **custom CRM in the client panel**, existing surface, manual status change
2. ✅ ~~Is `pending` terminal / does it count?~~ — **counts against cost per qualified lead**
3. **Spend granularity** — per day, or per campaign per day? Per-campaign is needed once more than one campaign runs per experiment; per-day is enough for the first run
4. **Who may qualify?** Owner only at v1, or any authenticated operator? Affects whether `decidedById` needs an identity beyond "the owner"

### Still to confirm

Which frontend hosts the CRM. `bazos-service` serves `/admin` and `/client` (`ui.controller.ts`), and `leads-microservice` holds the lead data — so the CRM either reads leads over the API from the Bazos admin panel, or lives elsewhere. This decides whether `bazos-service` joins the required owners.

---

## Validation plan

### Automated

| Test | Asserts |
|---|---|
| Schema conformance | `LeadQualificationEvent` and `ManualSpendObservation` validate |
| Immutable history | Correcting a status appends an event, never updates |
| Axis separation | Setting engagement does not change qualification, and vice versa |
| Superseding | A later connector observation supersedes a manual one; both remain queryable |
| Attribution split | The view reports attributed and unattributed counts separately |
| Division safety | Zero qualified leads → cost per qualified renders as "—", not a division error |
| Pending accounting | Spend on `pending` leads stays in the numerator; changing a lead to qualified lowers cost-per-qualified |

### Owner manual check

1. Enter a day's spend from the Google Ads interface
2. Qualify three leads, disqualify two, leave one pending
3. Confirm cost per registration and cost per qualified lead
4. Confirm the attributed/unattributed split is visible
5. Correct one qualification; confirm history shows both decisions

---

## Dependencies

**Blocked by:** F-005 — no registrations exist to qualify, and no experiment to attach spend to.
**Blocks:** the MS-002 experiment report. Not S8/S9 — the connector does not depend on this.

**Not blocked by** S1 governance: this slice spends no money and issues no API writes.
