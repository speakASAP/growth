# MS-003 — Revenue visible

**Status:** blocked by MS-002 · **Integration owner:** Claude
**Contains:** F-007 (S7 universal revenue adapter), F-008 (S8 connector read)

## Objective

Make revenue attributable to an experiment, through a scheme any business can adopt cheaply.

## Blocking finding (verified in code, 2026-07-18)

| App | Routes through `orders-microservice`? |
|---|---|
| flipflop | partially — has its own `flipflop/services/order-service` |
| **speakasap** | ❌ own `payment-service`, own Prisma schema |
| **marathon** | ❌ no |
| chytrakoupe, cliplot | ❌ no |

Attribution is built on `order.created` + `OrderLeadAttribution`. An experiment for speakasap or marathon would produce **revenue invisible to attribution**. This blocks the multi-business goal until solved.

## Decision: universal scheme, flipflop as first client

`revenue.recognised` is a canonical contract any payment path emits. flipflop is onboarded **through that universal scheme**, not as a special case.

Cost to add the next business: one publisher call + one schema test. **No growth-core change per business.**

## Exit criteria

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `revenue.recognised` schema published in shared package | Schema file | ☐ |
| 2 | Producer test: emitted events validate against schema | CI green | ☐ |
| 3 | Consumer test: growth-core parser accepts everything schema permits | CI green | ☐ |
| 4 | flipflop emits `revenue.recognised` via the universal scheme | Integration test | ☐ |
| 5 | `orders-microservice` adapter emits it from order+payment events | Integration test | ☐ |
| 6 | Money reversal events: `payment.refunded` (partial-capable), chargeback lifecycle | Contract tests | ☐ |
| 7 | Chargeback lifecycle NOT collapsed to a generic event | Schema review | ☐ |
| 8 | `workspaceId` resolution defined and persisted, never silently defaulted | Validation report | ☐ |
| 9 | Google Ads read-only metrics + `SpendObservation` reconciled against manual observations | Comparison report | ☐ |
| 10 | Net-revenue read model | Owner manual check | ☐ |

## Onboarding path for a further business

```
1. Business emits RevenueRecognised on its payment success/refund path
2. Publishes to RabbitMQ using the shared JSON schema
3. Producer test proves conformance
4. growth-core consumes — no change growth-side
5. Producer registered in the workspace resolution table
```
