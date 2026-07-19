# MS-002 — First experiment ready

**Status:** blocked by MS-001 · **Integration owner:** Claude
**Contains:** F-001 (S1), F-005 (S5), F-006 (S6)

## Objective

The thinnest complete acquisition loop, running for real money under a manual cap.

**Primary outcome: registration** ([D-002a](../07_decisions/D-002-landing-conversion-and-buffer.md)). Not a manually qualified lead — the Bazos landing already has a registration flow, and registration is an immediate automatic signal that fits inside the offline-conversion upload window.

This is the milestone to protect. A real experiment with real attribution using manually created ads **is** a working business loop. Everything after it automates a proven process.

## Exit criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `DecisionArtefact` + canonical hash persisted | Validation report | ☐ |
| 2 | Persisted `ApprovalGrant` with `approvedParametersHash` | Validation report | ☐ |
| 3 | In-memory Telegram idempotency defect fixed (survives restart) | Test evidence | ☐ |
| 4 | Experiment landing = **clone of `bazos.alfares.cz`** with immutable `landingVersionId` ([D-002b](../07_decisions/D-002-landing-conversion-and-buffer.md)) | Owner manual check | ☐ |
| 5 | **Durable ingestion via Postgres on database-server** ([D-002c](../07_decisions/D-002-landing-conversion-and-buffer.md)) — event survives growth-core restart | Failure-injection test: kill pod mid-registration, event still lands | ☐ |
| 6 | Consent evidence recorded on every tracking event | Schema test | ☐ |
| 7 | `AnonymousTouchpoint` → `IdentityLink` → **registration** traceable end-to-end | Owner manual check | ☐ |
| 8 | **`RegistrationCompleted`** event as the conversion signal | Contract test | ☐ |
| 8a | `LeadQualificationEvent` — post-hoc quality assessment, **not** the primary metric | Contract test | ☐ |
| 9 | `ManualSpendObservation` accepts owner-entered spend | Owner manual check | ☐ |
| 10 | **Провайдерские лимиты** — дневной бюджет, общий бюджет, дата окончания кампании | Перенесено из MS-001: до создания кампании лимитировать нечего. Настраивается в момент создания, ДО запуска | ☐ |
| 11 | **One capped experiment executed end to end** | Owner report + attribution rows keyed on registration | ☐ |

## Scope boundaries — deliberately excluded

Not in this milestone, and not needed for it:

- Ad-platform API writes → no `ExecutionAttempt` exercise yet (MS-004)
- Automated metrics ingestion → spend entered manually
- Order/payment correlation → primary outcome is **qualified lead**, not revenue
- Automated reply→lead linkage → not needed: conversion is registration, not a reply
- Any automated financial decision

**Traceability required before first spend is `touchpoint → lead` only.** The full `touchpoint → lead → order → payment → refund` chain is required before monetary optimisation (MS-003), not here.

## Owner manual check

1. Open the experiment landing from a real ad click
2. Complete a **registration** via `/client?auth=register`
3. Confirm the registration appears linked to its touchpoint, `gclid` and consent record
4. Kill the `growth-core` pod mid-registration; confirm the event still lands from the Postgres buffer
5. Enter the day's spend manually (`ManualSpendObservation`)
6. Confirm the experiment view shows: spend, registrations, cost per registration, and the attribution rows

## Landing compliance — already satisfied

Verified 2026-07-19: `bazos.alfares.cz` carries privacy policy, cookie policy, GDPR, terms, **EU AI Act compliance**, operator identity (Alfares s.r.o., IČ 27138038) and an explicit "not affiliated with Bazoš.cz" disclaimer.

Since the experiment landing is a clone (D-002b), it inherits all of this. No separate compliance work is needed — but re-check the live page immediately before submitting ads for review.
