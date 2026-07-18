# Phase 0 — Access Tracker

> Live operational document for **MS-001**. Owner reports; Claude verifies by API call.
> Updated: 2026-07-18

## Verification rule

A dashboard screenshot is **not** confirmation. A criterion is confirmed only by a **successful authenticated API call** whose response is recorded in `docs/12_validation/`.

Credentials live in Vault at `secret/prod/growth`. Claude reads Vault directly — do not paste secrets into chat or into this file.

## Division of labour

| Action | Who | Why |
|---|---|---|
| Register accounts, business verification, consent UI | **Owner** | Browser-based actions in third-party accounts cannot be performed from here |
| Store credentials in Vault | Either | |
| Execute API call, capture response, record real access tier and quotas | **Claude** | |
| Record validation report | **Claude** | |

## Status

| # | Item | Owner action | Claude verification | Status |
|---|---|---|---|---|
| 1 | **First business selected** | ✅ **Bazos** (D-001) | — | ✅ |
| 2 | **Ad platform decided** (recommend Google Ads first) | Confirm | Record in `docs/07_decisions/` | ⬜ |
| 3 | Legal entity + ad-account ownership | Confirm | — | ⬜ |
| 4 | **Google Ads account** created | Register | — | ⬜ |
| 5 | Google Ads developer token | Apply | `customers:listAccessibleCustomers` → record tier + quota | ⬜ |
| 6 | Google Ads API — real call succeeds | Store creds in Vault | Execute, capture response | ⬜ |
| 7 | ~~Meta app~~ — **deferred**, second platform only | — | — | ◷ |
| 8 | ~~Meta Business Verification~~ — deferred | — | — | ◷ |
| 9 | ~~Meta access~~ — deferred | — | — | ◷ |
| 10 | ~~Sklik~~ — deferred to F-013 | — | — | ◷ |
| 11 | Privacy policy live | Publish | Fetch URL, confirm reachable | ⬜ |
| 12 | Czech consent baseline | Counsel review | Record note | ⬜ |
| 13 | Provider-side spend limits | Configure in each account | Read back via API where possible | ⬜ |
| 14 | Durable edge-ingestion target chosen | Decide | Record in `docs/07_decisions/` | ⬜ |

Legend: ⬜ not started · 🔄 owner done, awaiting verification · ✅ verified · ⚠️ blocked

## Facts to confirm against live vendor docs

Sourced from the external review (primary citations), but **re-confirm before committing to any timeline** — access tiers and cutoffs move:

- Google Ads tiers Test / Explorer / Basic / Standard; Explorer 2,880 and Basic 15,000 daily production operations. **Explorer or Basic is the realistic target — Standard is likely unnecessary.**
- **15 June 2026 restriction**: tokens without prior qualifying offline-conversion activity are routed to the **Data Manager API** rather than new `UploadClickConversions` integrations. **Affects the S10 adapter choice — confirm before building.**
- Meta: Standard Access with `ads_read` + `ads_management` is sufficient for the app owner's own ad account; Advanced Access only for third-party accounts. *(Cited to Meta's Postman namespace — worth one confirmation against Meta's own docs, since the internal-first decision rests on it.)*

## Reporting format

When something is done, report it in one line:

```
[item #] done — <what was created/approved> — creds in Vault key <KEY_NAME>
```

Claude then runs the verification call, records the response in `docs/12_validation/`, and flips the status.

## Blockers

- [MISSING: Google Ads account + developer token] — blocks items 4–6 and all of MS-002
- [UNKNOWN: Bazos service-subscription billing path] — does subscription revenue for the Bazos automation tool emit an order/payment event? Blocks MS-003 contracts, not MS-002

## Immediate next action (owner)

1. Create / confirm the **Google Ads account** for Bazos
2. Apply for a **developer token**
3. Store credentials in Vault under `secret/prod/growth`
4. Report here: `[item 4] done — <account id> — creds in Vault key <KEY_NAME>`

Claude then runs `customers:listAccessibleCustomers`, records the real access tier and quota in `docs/12_validation/`, and flips items 5–6.
