# MS-002 — First experiment ready

**Status:** blocked by MS-001 · **Integration owner:** Claude
**Contains:** F-001 (S1), F-005 (S5), F-006 (S6)

## Objective

The thinnest complete acquisition loop, running for real money under a manual cap.

This is the milestone to protect. A real experiment with real attribution using manually created ads **is** a working business loop. Everything after it automates a proven process.

## Exit criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `DecisionArtefact` + canonical hash persisted | Validation report | ☐ |
| 2 | Persisted `ApprovalGrant` with `approvedParametersHash` | Validation report | ☐ |
| 3 | In-memory Telegram idempotency defect fixed (survives restart) | Test evidence | ☐ |
| 4 | Landing runtime serving variants by immutable version ID | Owner manual check | ☐ |
| 5 | **Durable edge→core ingestion** — event survives growth-core being down | Failure-injection test | ☐ |
| 6 | Consent evidence recorded on every tracking event | Schema test | ☐ |
| 7 | `AnonymousTouchpoint` → `IdentityLink` → `Lead` traceable end-to-end | Owner manual check | ☐ |
| 8 | `LeadQualificationEvent` with declared `criteriaVersion` | Contract test | ☐ |
| 9 | `ManualSpendObservation` accepts owner-entered spend | Owner manual check | ☐ |
| 10 | Provider-side lifetime + daily cap and end date set | Reference recorded | ☐ |
| 11 | **One capped experiment executed end to end** | Owner report + attribution rows | ☐ |

## Scope boundaries — deliberately excluded

Not in this milestone, and not needed for it:

- Ad-platform API writes → no `ExecutionAttempt` exercise yet (MS-004)
- Automated metrics ingestion → spend entered manually
- Order/payment correlation → primary outcome is **qualified lead**, not revenue
- Automated reply→lead linkage → owner qualifies manually from his own phone
- Any automated financial decision

**Traceability required before first spend is `touchpoint → lead` only.** The full `touchpoint → lead → order → payment → refund` chain is required before monetary optimisation (MS-003), not here.

## Owner manual check

1. Open the landing page from a real ad click
2. Submit the form with valid email + phone + detailed request
3. Confirm the lead appears with its touchpoint, click ID and consent record
4. Reply to the lead on any channel; mark it qualified manually
5. Enter the day's spend from the ad platform
6. Confirm the experiment view shows: spend, leads, qualified leads, and the attribution rows
