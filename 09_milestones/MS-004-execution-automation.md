# MS-004 — Execution automation

**Status:** blocked by MS-003 · **Integration owner:** Claude
**Contains:** F-009 (S9 writes), F-010 (S10 conversion upload), F-011 (S11 analysis), F-012 (S12 AI generation)

## Objective

The system acts on the ad platform — under scoped approval, with duplicate-effect protection.

This is the first milestone where the approval machinery is genuinely exercised. Before this, budgets were set by hand.

## Exit criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `ExecutionAttempt` + deterministic `effectKey` before every API write | Contract test | ☐ |
| 2 | Provider idempotency key used where supported | Integration test | ☐ |
| 3 | Deterministic resource naming + reconciliation where not supported | Integration test | ☐ |
| 4 | `ambiguous` outcome never retried blind — reconciliation first | Failure-injection test | ☐ |
| 5 | Worker verifies `approvedParametersHash` against the canonicalised outbound payload | Unit + integration test | ☐ |
| 6 | Connector failure states modelled; writes stop on `ACCOUNT_RESTRICTED` | Failure-injection test | ☐ |
| 7 | Conversion upload — qualified-lead first; value-based only after MS-003 | Upload diagnostics | ☐ |
| 8 | Consent filtering applied before any vendor transmission | Test evidence | ☐ |
| 9 | AI generation with deterministic claim checks + human review before publish | Owner manual check | ☐ |
| 10 | Full generation lineage: model, prompt version, source, edits, reviewer | Audit sample | ☐ |

## Financial automation is OUT of scope

Owner decision: all money decisions stay manual at stage 1.

**S11 is analysis-only.** It computes and presents; it never acts. No automated budget changes, no automated scaling, no autonomously executed spend recommendations. Automated financial recommendation and management is revisited only after the owner has manual baselines to calibrate against.

Approval machinery here serves **execution safety**, not financial decision-making.
