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
| 1 | First business selected | **Bazos** — [D-001](../07_decisions/D-001-first-business-and-platform.md) | ✅ |
| 2 | Market confirmed as CZ | Architecture §1.2 | ✅ |
| 3 | First ad platform explicitly chosen | Decision recorded in `docs/07_decisions/` | ☐ |
| 4 | Legal entity + ad-account ownership confirmed | Owner statement | ☐ |
| 5 | Google Ads developer token — access level confirmed **by a real API call** | Response captured in `docs/12_validation/` | ☐ |
| 6 | Meta app + Business Verification status confirmed | Response captured | ☐ |
| 7 | Sklik API access assessed | Spike findings doc | ☐ |
| 8 | Czech consent baseline + privacy policy live | URL + counsel note | ☐ |
| 9 | Provider-side spend limits configured | Screenshot/export reference | ☐ |
| 10 | Durable edge-ingestion implementation selected | Decision recorded | ☐ |

## Resolved — first business and platform

**Bazos + Google Ads** ([D-001](../07_decisions/D-001-first-business-and-platform.md)). Option (a) taken: Sklik follows after the Google write/reconciliation path is proven, so slice names S8–S10 stay accurate.

Bazos is wired to `orders-microservice` (`bazos/shared/clients/order-client.service.ts`), unlike speakasap/marathon/chytrakoupe/cliplot — this avoids the revenue-visibility gap for stage 1.

⚠️ **Carried into MS-003:** that integration covers *marketplace* orders. Whether **subscription revenue for the Bazos service itself** flows the same way is unverified. MS-002 is unaffected — its outcome is a qualified lead.

## Verification method

Access is **not** confirmed by a dashboard screenshot. It is confirmed by a successful authenticated API call whose response is recorded in `docs/12_validation/`. Credentials live in Vault (`secret/prod/growth`); Claude reads them directly and runs the call.

Division of labour, stated accurately:

| Action | Who |
|---|---|
| Register accounts, complete business verification, click through consent UIs | **Owner** (browser-based, third-party accounts) |
| Store credentials in Vault | Either |
| Execute API call, capture response, record access tier and real quotas | **Claude** |
| Record the finding as a validation report | **Claude** |

## Blockers

- [MISSING: Google Ads account + developer token] — items 4–6
- [UNKNOWN: Bazos service-subscription billing path] — resolve before MS-003

## Next action

Owner registers/confirms Google Ads and Meta accounts. Report here as each is done; Claude verifies each by API call before the criterion is marked complete.
