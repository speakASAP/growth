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

> ⚠️ **Corrected 2026-07-22 — this section described an endpoint that does not exist.** The
> original text read:
>
> > `leads-microservice` already carries lead status:
> > `leads-microservice/src/leads/leads.controller.ts   PATCH /leads/:id  → status`
> > So the work is **not** "build qualification" — it is "make the existing status change emit a
> > versioned, immutable qualification event".
>
> There is **no `PATCH /leads/:id`** and no status-change endpoint of any kind. Verified against
> the source: the routes on `LeadsController` are `POST /leads/submit`, `GET /leads/confirm/:token`,
> `GET /leads/:id`, `GET /leads`, and a set of `internal/*` routes behind `InternalServiceGuard`.
> `Lead.status` is written in exactly two places inside `leads.service.ts` — `'new'` at creation and
> `'confirmed'` on token confirmation — and never by an operator.
>
> Had this been implemented as written, the slice would have hung a qualification event off a
> status transition that nothing can trigger, and the event would have been correct, tested, and
> never emitted. The plan is corrected below rather than around: qualification is a **new**
> surface, because there was never an existing one to decorate.

### Where the CRM actually is — F-006 open question resolved 2026-07-22

The "custom CRM in the client panel" is `leads-microservice`'s own admin panel, and it already
exists:

```
leads-microservice/public/admin.html + admin.js     lead list and detail view
leads-microservice/src/leads/admin-leads.controller.ts   GET /api/admin/leads[/:id|/summary]
leads-microservice/src/auth/admin-auth.guard.ts     bearer token validated against auth-microservice
```

It is authenticated, role-gated and workspace-scoped, and `GET /api/admin/leads` already returns
`id` per lead — so a lead can be marked from it without any new identity plumbing. `bazos-service`
does **not** join the required owners: its `/admin` and `/client` panels are a different surface,
and routing lead qualification through them would put lead data in a second place.

So the work is: **add a qualification write path to the CRM that already reads the leads.**

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

> ✅ **BUILT IN S6b (2026-07-22)** and verified against production. Contract:
> [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md) §6.
>
> - Read API — `GET /experiments/:experimentId/report` on `growth-core`
> - Screen — `GET /experiments/:experimentId` on `growth-core`, server-rendered, with a spend
>   entry form posting to `POST /experiments/:experimentId/spend`
> - Both cost metrics, the attributed/unattributed split, and a derived `pending`
>
> ⚠️ **Where it lives, and why.** The screen is on `growth-core`, which has **no ingress**. It is
> deliberately **not** on `growth-web`: that container is public on `bazos.alfares.cz/l` and has no
> authentication of any kind, so an owner-only screen showing spend and lead counts cannot go
> there. The owner reaches it with `kubectl port-forward` (§"Where the owner goes" below).
> Publishing it on a public hostname needs an authenticated surface (S1b) and is an **owner
> decision** — C-006 §6.8.
>
> ⚠️ **Scope caveat, unresolved.** `qualification.lead` has no `experiment_id`, so the report counts
> every lead in the *workspace* against the spend of the *named experiment*. Correct while one
> experiment runs per workspace; wrong the moment a second does — C-006 §6.6.

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

1. ✅ ~~Where does the owner qualify leads?~~ — the **`leads-microservice` admin panel**, the existing authenticated CRM. Corrected 2026-07-22: it is a **new write path**, not an existing status change (see above)
2. ✅ ~~Is `pending` terminal / does it count?~~ — **counts against cost per qualified lead**
3. ⚠️ **Spend granularity — still open, and now explicitly deferred.** `growth.spend.observed_manual.v1` carries `experimentId` but **no `campaignId`**, so S6 records per-experiment-per-period only. This is enough for the first run (one campaign per experiment) and wrong the moment a second campaign runs. Adding `campaignId` is a **v2 schema**, not a quiet field addition — flagged for the owner, not decided by the implementer
4. ✅ ~~Who may qualify?~~ — resolved 2026-07-22: **any principal `AdminAuthGuard` accepts**, and the event records *which* one in `decidedById` (the real auth user id, never the string `"owner"`). See [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md) §1.3

### Still to confirm

✅ Resolved 2026-07-22 — the CRM is the `leads-microservice` admin panel (`public/admin.html`),
not a `bazos-service` panel. `bazos-service` does **not** join the required owners.

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

### Where the owner goes

```bash
kubectl -n statex-apps port-forward deploy/growth-core 3376:3376
# then open http://localhost:3376/experiments/exp-001
```

The page shows the campaign parameters and the three numbers, and the form at the bottom records
spend. There is no public URL, by design (C-006 §6.7).

---

## Dependencies

**Blocked by:** F-005 — no registrations exist to qualify, and no experiment to attach spend to.
**Blocks:** the MS-002 experiment report. Not S8/S9 — the connector does not depend on this.

**Not blocked by** S1 governance: this slice spends no money and issues no API writes.
