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
| `leads-microservice` | `LeadQualificationEvent` persistence + qualification surface |

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

### 2. Qualification

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
  pending                           6
  cost per qualified lead       2 143 CZK
```

**The attributed/unattributed split is not optional.** No consent means no `gsid` means no attribution ([D-003](../07_decisions/D-003-session-propagation-retention-buffer.md) §Q2). Measured conversions are structurally lower than actual, and a cost-per-registration read without that split will look worse than reality. Showing one number without the other invites a wrong kill decision.

---

## Open questions — resolve before CONTRACT

1. **Where does the owner qualify leads?** Existing `leads-microservice` admin surface, a new view in growth, or Telegram? Telegram fits the ecosystem's approval pattern and the owner's phone-first habit — but it needs a persistent callback store, and `goalkeeper`'s dispatcher is currently in-memory (architecture §2.8).
2. **Is `pending` allowed to be terminal?** A lead nobody ever works stays `pending` forever. Does it count against cost-per-qualified, or is it excluded? Affects whether the metric is honest.
3. **Spend granularity** — per day, or per campaign per day? Per-campaign is needed once more than one campaign runs per experiment; per-day is enough for the first run.
4. **Who may qualify?** Owner only at v1, or any authenticated operator? Affects whether `decidedById` needs an identity beyond "the owner".

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
