# D-001 — First business and first ad platform

**Status:** accepted · **Decided by:** owner · **Date:** 2026-07-18
**Closes:** MS-001 items 1–2 · **Supersedes:** the nominal "platform selected later" wording in Phase 0

## Decision

**First business: Bazos.** **First ad platform: Google Ads.**

Sklik follows only after the Google write and reconciliation path is proven (F-013). Slice names S8–S10 are therefore accurate as written — no renaming to "selected-platform connector" is needed.

## What Bazos is

`bazos-service` — Bazos.cz classifieds automation: create/update ads, manage multiple verified accounts, handle renewal and expiration. It is a **tool sold to Czech sellers**, not a storefront.

So the hypothesis under test is lead generation for a **B2B/B2C SaaS offering**, and the conversion outcome is a qualified lead for that service — consistent with `criteriaVersion: v1-owner-manual`.

## Revenue path — verified, with one open question

✅ Bazos **is** wired to `orders-microservice`:

```
bazos/shared/clients/order-client.service.ts
bazos/k8s/configmap.yaml            (orders service URL configured)
```

This is materially better than speakasap/marathon/chytrakoupe/cliplot, which have no `orders` integration at all. Choosing Bazos avoids the blocking revenue-visibility gap for stage 1.

⚠️ **Open question, must be resolved before MS-003:** the `orders` integration found in Bazos handles **marketplace orders** (orders arising from listings), under `bazos/services/aukro-service/src/aukro/orders/`. It is not established that **subscription/service revenue from customers of the Bazos automation tool itself** flows through the same path.

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
