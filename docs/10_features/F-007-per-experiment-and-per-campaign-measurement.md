# F-007 — Per-experiment and per-campaign measurement

**Slice:** S6d · **Gate:** ① DOC · **Contract:** [C-006](../23_documentation_contracts/C-006-qualification-and-spend.md)
§2.4/§2.5, §4.3, §6.1/§6.6 · **Date:** 2026-07-23

Closes the two measurement gaps S6/S6b recorded rather than fixed. Both were owner decisions; both
were taken on 2026-07-23, together, on the owner's reasoning: *«не вижу смысла откладывать что-то
на потом и переделывать дважды»*.

---

## Outcome

The experiment report answers for **one experiment** and, where the owner split the figure, for
**one campaign** — instead of dividing one experiment's spend by every lead in the workspace and
by an unsplittable spend total.

How we know it works:

- a lead that arrived through `exp-001` is not counted in `exp-002`'s report, and vice versa;
- a lead that cannot be tied to any experiment appears as its own count, not as zero and not
  silently inside the experiment's;
- spend entered against two campaigns reads back as two lines plus a total, and spend entered
  without a campaign reads back as `unassigned` rather than being folded into either.

## Why now rather than when a second experiment exists

**Spend already recorded cannot be split afterwards.** A summed figure is not a lossy
representation of two campaigns — it is the permanent absence of the split.

**The touchpoints that carry `experimentId` are being swept.** They pass through
`ingest.event_buffer` onto `growth.events`, where nothing is bound, and published rows are deleted
after 30 days (`PUBLISHED_RETENTION_DAYS`). Every day without `attribution.touchpoint` is a day of
leads whose experiment can never be established.

**The version bump is cheap exactly once.** Nothing consumes `growth.spend.observed_manual.*`
today, so v2 costs one producer. After S8 the connector is a second producer of the same event.

## Required owners

| Service | Change |
|---|---|
| `growth-core` | migration 007; `attribution.touchpoint` + its consumer; per-experiment read model; spend v2 with `campaignId`; report and screen |
| `growth-web` | stop defaulting `experimentId` to `"unknown"` — refuse to start without it |

**Required consumers:** none. **Optional future consumers:** S8 (connector spend, writes v2
directly). **Explicitly excluded:** `leads-microservice` (a lead's experiment is derived in
growth-core, never sent by leads), `auth-microservice`, `bazos-service`.

## Behaviour

### 1. A lead's experiment is derived, not stored

`lead.correlation_id` → `attribution.auth_redirect.session_id` → `attribution.touchpoint.experiment_id`.

Resolved at read time, for the reason `pending` is (C-006 §1.1): the three facts arrive on three
queues at three rates, so a value stamped at write time would record whatever had arrived by then
and could never be recomputed.

### 2. Three buckets, all visible

`registrations` counts only leads whose touchpoint names this experiment. Leads naming a different
experiment, and leads with no touchpoint at all, are counted separately and shown next to the
metric — never dropped. The second group is the honest cost of scoping: those registrations are
real, so excluding them makes this experiment's cost per registration read **worse** than reality,
the same direction as the unattributed split already reads (C-006 §6.5).

A report whose "no touchpoint" count dwarfs its `registrations` is not a bad experiment. It is a
broken measurement chain — `GROWTH_EXPERIMENT_ID` wrong on the landing, consent refused at scale,
or the touchpoint consumer down — and it has to look like one.

### 3. `campaignId` is optional and means "not split"

Absent is not "belongs to no campaign". Unassigned spend is its own line and stays in the
experiment's total: the money left the account whether or not the owner split the figure, and
dropping it from the denominator would flatter every campaign that was split.

Required was rejected: the field would be unfillable whenever the provider report is not split by
campaign, and a required field invites `"main"` or `"default"` — a placeholder that cannot be told
apart from a real campaign id.

### 4. One landing deployment serves one experiment

`growth-web` reads `GROWTH_EXPERIMENT_ID` / `GROWTH_EXPERIMENT_VERSION` from its ConfigMap, so
experiments are **sequential**: launching `exp-002` means updating the ConfigMap and rolling the
landing. That is sufficient and is not a limitation this slice removes — a variant-to-experiment
map would be speculative work for a second simultaneous experiment nobody has planned.

What this slice does remove is the `?? 'unknown'` fallback. A missing environment variable
currently produces touchpoints against the literal experiment `"unknown"`, which is a measurement
that looks like data. The landing now refuses to start.

## Explicitly excluded

- Backfilling `experiment_id` for leads that predate this slice. There is nothing to backfill
  from: production data was deleted 2026-07-22 and no touchpoint was ever stored. Those leads land
  in the "no touchpoint" bucket permanently, which is the truthful answer.
- A campaign dimension on **leads**. `utm_campaign` is stored on the touchpoint, so the join
  exists, but cost-per-lead per campaign needs a decision about what a lead's campaign *is* when
  the session saw two. Not needed until per-campaign spend has been in use for a while.
- Any change to `growth.lead.created_from_registration.v1`. `leads-microservice` does not know
  about experiments and must not learn.

## Validation

### Automated

| Test | Asserts |
|---|---|
| Touchpoint stored | A `growth.touchpoint.observed.v1` off `growth.events` produces exactly one row; redelivery of the same `eventId` produces no second row |
| Scope by experiment | Two leads on two experiments — each report counts one, and names the other in `outOfScope.otherExperiments` |
| No touchpoint | A lead with no `correlation_id`, and a lead whose session has no touchpoint, both land in `outOfScope.noTouchpoint` and in neither metric |
| Last touchpoint wins | A session with two touchpoints on two experiments resolves to the later `occurred_at`, deterministically |
| Campaign split | Two observations, two campaigns → two `byCampaign` lines; one without a campaign → an `unassigned` line; the total is the sum of all three |
| v2 schema | A v1 envelope carrying `campaignId` is **rejected**; a v2 envelope without one is accepted; both versions stay registered in the ingest validator |
| Blank campaign | `campaignId: ""` and `"  "` are rejected by schema and by the column check |
| Landing fails loud | `growth-web` with no `GROWTH_EXPERIMENT_ID` does not start |

### Owner manual check

1. Open the experiment screen; confirm the lead counts and the "not this experiment" / "no
   touchpoint" lines add up to what you expect for the workspace
2. Enter spend for two campaigns and once without a campaign; confirm three lines and a total that
   includes all three
3. Change `GROWTH_EXPERIMENT_ID` to `exp-002`, roll the landing, register through it, and confirm
   the new lead appears in `exp-002` and **not** in `exp-001`

## Dependencies

**Blocked by:** nothing. **Blocks:** nothing. S8 writes v2 when it lands; the cabinet (S6c) shows
whatever this produces.
