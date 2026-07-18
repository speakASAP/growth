# MS-001 — Access and baseline

**Status:** active · **Owner:** Sergej · **Integration owner:** Claude
**Gate for:** all subsequent milestones
**Created:** 2026-07-18

## Objective

Establish everything that must exist before any code is written or any money is spent: platform access, legal baseline, and the selected scope.

No implementation work in this milestone. Spikes only.

## Exit criteria

| # | Criterion | Evidence required | Status |
|---|---|---|---|
| 1 | First business selected | Named in this document | ☐ |
| 2 | Market confirmed as CZ | Architecture §1.2 | ✅ |
| 3 | First ad platform explicitly chosen | Decision recorded in `07_decisions/` | ☐ |
| 4 | Legal entity + ad-account ownership confirmed | Owner statement | ☐ |
| 5 | Google Ads developer token — access level confirmed **by a real API call** | Response captured in `12_validation/` | ☐ |
| 6 | Meta app + Business Verification status confirmed | Response captured | ☐ |
| 7 | Sklik API access assessed | Spike findings doc | ☐ |
| 8 | Czech consent baseline + privacy policy live | URL + counsel note | ☐ |
| 9 | Provider-side spend limits configured | Screenshot/export reference | ☐ |
| 10 | Durable edge-ingestion implementation selected | Decision recorded | ☐ |

## Open decision — first ad platform

The delivery plan assumes Google Ads first (S8→S9→S10, Sklik at S13). Phase 0 nominally says "select one platform". **These contradict.** Resolve by recording one of:

- **(a)** Google Ads is the stage-1 platform; Sklik follows after the Google write/reconciliation path is proven → S8–S10 names stay accurate
- **(b)** Slices renamed to "selected-platform connector" and the choice made here

Recommendation: **(a)** — Google Ads has the larger surface to prove and better documented offline-conversion path; Sklik is a narrower follow-on.

## Verification method

Access is **not** confirmed by a dashboard screenshot. It is confirmed by a successful authenticated API call whose response is recorded in `12_validation/`. Credentials live in Vault (`secret/prod/growth-microservice`); Claude reads them directly and runs the call.

Division of labour, stated accurately:

| Action | Who |
|---|---|
| Register accounts, complete business verification, click through consent UIs | **Owner** (browser-based, third-party accounts) |
| Store credentials in Vault | Either |
| Execute API call, capture response, record access tier and real quotas | **Claude** |
| Record the finding as a validation report | **Claude** |

## Blockers

- [MISSING: selected first business]
- [MISSING: ad platform decision — see above]

## Next action

Owner registers/confirms Google Ads and Meta accounts. Report here as each is done; Claude verifies each by API call before the criterion is marked complete.
