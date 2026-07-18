# Google Ads API — Tool Design Document

**Applicant:** Alfares s.r.o.
**Website:** https://alfares.cz
**Google Ads manager account (MCC):** 382-409-1750
**Google Cloud project number:** 736358823451
**Contact:** ssfskype@gmail.com
**Date:** 2026-07-19
**Access level requested:** Basic

---

## 1. Summary

Alfares s.r.o. operates its own online products and services in the Czech Republic. We are building an **internal growth experimentation platform** used exclusively by our own staff to manage advertising for **advertising accounts that we own**.

We do not manage Google Ads accounts for other organisations. We do not resell, sublicense, or share API access. The tool has no external users and no public interface.

**Why Basic access:** Explorer level does not include planning services. Keyword research for our own campaigns requires `KeywordPlanIdeaService`, which is unavailable at Explorer.

---

## 2. Business model

We advertise our own products. Revenue comes from those products, not from advertising services.

A single operator (the company owner) runs the platform. There are no clients, no agency relationship, and no third-party accounts under management.

---

## 3. What the tool does

The platform takes a business hypothesis, runs it as a measurable paid-acquisition experiment, and reports the result.

```
Hypothesis
   ↓
Experiment definition (immutable, versioned)
   ↓
Landing page variant  ──►  visitor  ──►  lead form
   ↓                                        ↓
Google Ads campaign                    lead record
   ↓                                        ↓
performance metrics (read via API)     manual qualification by owner
   ↓                                        ↓
   └────────────►  attribution read model  ◄─┘
                          ↓
                  result presented to the owner
```

Every step that spends money passes through an explicit human approval gate before any API call is issued.

---

## 4. Google Ads API services used

| Service | Access | Purpose |
|---|---|---|
| `GoogleAdsService.SearchStream` | read | Campaign, ad group, ad and keyword metrics — impressions, clicks, cost, conversions — into our internal reporting database |
| `CampaignService` | read/write | Create and update our own search campaigns |
| `AdGroupService`, `AdGroupAdService`, `AdGroupCriterionService` | read/write | Manage our own ad groups, ads and keywords |
| `CampaignBudgetService` | read/write | Set and adjust budgets for our own campaigns |
| `ConversionUploadService` | write | Upload offline conversion events for leads generated on our own landing pages, matched by GCLID |
| `ConversionActionService` | read/write | Define conversion actions for our own accounts |
| `KeywordPlanIdeaService` | read | Keyword research for our own campaigns — **requires Basic** |

**Not used:** account creation, user management, billing services, and any service that would act on accounts we do not own.

---

## 5. Architecture

```
┌─────────────┐   proposes    ┌──────────────┐   requests    ┌─────────────┐
│  Planning   │ ────────────► │  growth-core │ ────────────► │  Approval   │
│  component  │               │              │               │  service    │
└─────────────┘               │  experiments │               │             │
                              │  spend       │◄──── grant ───│  (Telegram) │
                              │  decisions   │               └─────────────┘
                              └──────┬───────┘                      ▲
                                     │                              │
                                     ▼                       human approves
                              ┌──────────────┐                      │
                              │ growth-worker│──────────────────────┘
                              │              │
                              │ validates a  │
                              │ scoped grant │
                              │ before every │
                              │ external call│
                              └──────┬───────┘
                                     │
                                     ▼
                              Google Ads API
```

Components:

- **growth-core** — experiment definitions, campaign specifications, spend observations, attribution read models. Owns no credentials for outbound calls.
- **growth-worker** — the only component that calls the Google Ads API. Refuses to act without a valid, unconsumed approval grant.
- **Approval service** — evaluates policy, presents the proposed action to the human operator, issues a scoped grant.
- **Landing runtime** — serves our own landing pages, captures consent, UTM parameters and GCLID.

---

## 6. Human-in-the-loop controls

No autonomous spending. Specifically:

1. **Scoped approval grants.** Each approval produces a record bound to one action, one resource, a maximum amount, an expiry, and single-use semantics. The worker validates the grant immediately before the API call.
2. **Parameter binding.** The grant stores a hash of the exact approved payload. If the outbound request differs from what the human reviewed, execution is refused.
3. **Execution attempts.** Every outbound mutation is recorded with a deterministic idempotency key before submission. Ambiguous provider outcomes are reconciled by resource lookup, never retried blind.
4. **Budget ceilings.** Per-experiment, per-account and global daily limits. Provider-side campaign and account spending limits are configured independently, so a failure of our infrastructure cannot result in uncontrolled spend.
5. **Fail closed.** If metrics are stale or the approval path is unavailable, no scaling occurs.
6. **Kill switch.** A manual global pause procedure exists and is documented.

---

## 7. Data handling and privacy

Operating jurisdiction: Czech Republic (EU). GDPR and ePrivacy apply.

- Consent state is recorded against every tracking event, with purpose, vendor, policy version and timestamp. Consent is evaluated before any transmission to an advertising vendor.
- Click identifiers (GCLID) are treated as personal data and stored under the consent record that permits their use.
- Personal data is not placed in immutable decision records; those hold references to erasable identity links, so a deletion request can be honoured without destroying the operational audit trail.
- Retention limits and deletion propagation are implemented across services.
- No customer list upload or audience matching is in scope for this application.

---

## 8. Scale

| | |
|---|---|
| Accounts under management | small number, all owned by Alfares s.r.o., all linked to MCC 382-409-1750 |
| Expected API operations | well under 1,000 per day |
| Users of the tool | internal only — company staff |
| External access | none |

---

## 9. Access control

The developer token and OAuth credentials are stored in HashiCorp Vault and injected into the runtime as secrets. They are never committed to source control and never exposed to any external party.

Only the internal `growth-worker` component holds credentials capable of mutating Google Ads data, and only under a validated approval grant.

---

## 10. Compliance commitments

- The API is used solely for accounts owned by Alfares s.r.o.
- API access will not be resold, sublicensed, or shared.
- The tool will not be offered to third parties.
- Registration information will be kept accurate and up to date.
- Policy notices sent to the API contact address will be monitored and acted upon.
- Generated advertising content is reviewed by a human before publication; deterministic checks are applied for prohibited claims prior to review.
