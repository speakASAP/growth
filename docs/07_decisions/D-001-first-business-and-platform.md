# D-001 — First business and first ad platform

**Status:** accepted · **Decided by:** owner · **Date:** 2026-07-18
**Closes:** MS-001 items 1–2 · **Supersedes:** the nominal "platform selected later" wording in Phase 0

## Decision

**First business: Bazos.** **First ad platform: Google Ads.**

Sklik follows only after the Google write and reconciliation path is proven (F-013). Slice names S8–S10 are therefore accurate as written — no renaming to "selected-platform connector" is needed.

## What Bazos is

`bazos-service` — Bazos.cz classifieds automation: create/update ads, manage multiple verified accounts, handle renewal and expiration. It is a **tool sold to Czech sellers**, not a storefront.

So the hypothesis under test is lead generation for a **B2B/B2C SaaS offering**, and the conversion outcome is a qualified lead for that service — consistent with `criteriaVersion: v1-owner-manual`.

## Revenue path — RESOLVED, and it is worse than first read

An earlier draft recorded Bazos as "wired to `orders-microservice`" on the strength of `bazos/shared/clients/order-client.service.ts` and an orders URL in `k8s/configmap.yaml`.

**Owner correction, 2026-07-18: Bazos does not use orders at all yet.** The client and config are scaffolding — present but unused. Wiring ≠ usage, and I read the first as the second.

So Bazos has **no revenue rail today**:

| | |
|---|---|
| Orders from Bazos listings | bazos.cz is classifieds — buyers contact sellers directly, there is no checkout |
| Subscription revenue for the automation tool | no billing mechanism identified |
| Events reaching `growth` | **none** |

### Consequence for the plan

**MS-002 is unaffected** — its primary outcome is a qualified lead, revenue is shown as provisional gross entered manually. The first experiment can run exactly as designed.

**MS-003 changes shape for Bazos.** It is no longer "emit `revenue.recognised` from an existing path" — there is no path. Before Bazos revenue can be attributed, someone must first decide *how the Bazos automation service is sold and billed at all*. That is a product decision, not an integration task.

Options when MS-003 approaches:
- **(i)** Build billing for the Bazos service, then emit `revenue.recognised` from it
- **(ii)** Run MS-003 against a business that already has a live revenue path (flipflop), keeping Bazos as the MS-002 acquisition experiment only
- **(iii)** Keep Bazos on qualified-lead economics indefinitely and defer revenue attribution

**(ii) is the lower-risk sequencing** — it decouples proving the revenue contract from building a new billing system. Decide before MS-003 contracts are written.

These are different money:

| Money | Path | Attributable today? |
|---|---|---|
| Orders arising from Bazos listings | `orders-microservice` | likely yes |
| **Payment for the Bazos automation service** | unverified | **unknown** |

The growth experiment sells the *service*. If service revenue does not emit an order/payment event, MS-003 cannot attribute it, and `revenue.recognised` must be emitted from wherever that billing actually happens.

**Action:** verify the service-billing path before MS-003 contracts are written. Until then MS-002 stands unaffected — its primary outcome is a qualified lead, not revenue.

## Secondary finding — worth a separate look

`bazos/services/aukro-service/` — a directory named `aukro-service` inside the Bazos repository, containing `src/aukro/orders/`. Either Bazos was scaffolded from Aukro and never renamed, or it genuinely embeds Aukro code.

Not a blocker for this decision, but it makes "does Bazos have its own order path" harder to answer with confidence, and it should be clarified before that code is relied on for revenue attribution.

## Consequences

- MS-001 items 1–2 → complete
- Google Ads credentials become the priority for MS-001 items 4–6
- Meta (items 7–9) drops to secondary — needed only when a second platform is added
- Sklik (item 10) deferred to F-013
- `docs/12_validation/` receives the Google Ads API access evidence
