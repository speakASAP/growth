# VR-001 — Google Ads API access

**Type:** validation_report · **Status:** ✅ complete — API access confirmed by a real call
**Milestone:** MS-001 · **Date:** 2026-07-19

---

## What was established

| Item | Value | How verified |
|---|---|---|
| Manager account (MCC) | Alfares `382-409-1750` | Read from Google Ads UI |
| MCC currency | **CZK** | UI (`0,00 CZK` in reporting) |
| MCC time zone | **GMT+02:00 Central European** | UI footer |
| Sub-accounts under MCC | **0** | Accounts grid, and confirmed via `customer_client` query |
| Developer token | issued | Present in API Center, stored in Vault |
| **Access level** | **Explorer** | API Center → «Уровень доступа: Доступ к Explorer» |
| Google Cloud project | `alfares-489917` / number `736358823451` | GCP console project card |
| Google Ads API in project | **Enabled** | API details page: `Status: Enabled`, «Disable API» present |
| OAuth client | Desktop app, created 2026-07-19 | GCP → Clients |
| OAuth publishing status | **In production** *(was Testing until 2026-07-19)* | Google Auth Platform → Audience |
| OAuth test user | `ssfskype@gmail.com` added | Audience → Test users |
| Basic access application | **submitted** | Owner confirmed |

## Credentials in Vault (`secret/prod/growth`)

```
GOOGLE_ADS_DEVELOPER_TOKEN      ✅
GOOGLE_ADS_CLIENT_ID            ✅  (Desktop app)
GOOGLE_ADS_CLIENT_SECRET        ✅
GOOGLE_ADS_LOGIN_CUSTOMER_ID    ✅  3824091750
GOOGLE_CLOUD_PROJECT_ID         ✅  alfares-489917
GOOGLE_CLOUD_PROJECT_NUMBER     ✅  736358823451
GOOGLE_ADS_REFRESH_TOKEN        ✅  reissued 2026-07-19 after publication (len 103)
```

**The first token was issued while the app was still *Testing*, which caps refresh-token life at
7 days.** Publishing to *In production* does not extend a token already issued under Testing, so the
token was reissued after publication and re-verified. The current token expires only on revocation.

The consent screen still shows «Google hasn't verified this app» — expected, since `adwords` is a
sensitive scope and verification was not pursued. Verification affects the warning and the 100-user
cap, neither of which binds a single-owner internal integration; it is not a prerequisite for
*In production*.

---

## ✅ API access confirmed

```
HTTP 200 — customers:listAccessibleCustomers
api version: v21
accessible customers: 3
  customers/2771381970
  customers/3753531144
  customers/3824091750
```

The developer token and OAuth credentials are valid and accepted by the API. This closes the gap between "the interface says Explorer" and "the API accepts our credentials".

## 🔴 Account hierarchy — contradicts what the UI showed

The MCC page reported **0 sub-accounts**. The API returned **3 accessible customers**. Queried each:

| Customer ID | Name | Type | Currency | Status | Linked to MCC 382-409-1750? |
|---|---|---|---|---|---|
| `3824091750` | Alfares | **manager** | CZK | ENABLED | — *(this is the MCC)* |
| `3753531144` | Alfares | **manager** | CZK | ENABLED | ❌ no — empty duplicate, see below |
| `2771381970` | **Alfares s.r.o.** | **ad account** | CZK | ENABLED | ✅ **linked 2026-07-19** |

Three findings:

1. **An enabled advertising account already exists** — `2771381970` "Alfares s.r.o.". The owner believed there were none, and the MCC showed zero because the account is simply not linked to it. Creating a new account was therefore unnecessary; the draft `248-704-9029` started during setup should be discarded rather than developed.

2. **There are two manager accounts**, not one. `3753531144` is a second MCC, also enabled, also CZK. Its origin is unknown. Which of the two should be canonical needs an explicit decision — the developer token is registered against `3824091750`.

3. **This affects the Basic access application.** Google requires *"link all active Google Ads accounts to the manager account"*. Two enabled accounts sit outside the MCC the token belongs to. The application has already been submitted; if a reviewer checks hierarchy, this is the discrepancy they will find.

### ✅ Resolved — hierarchy corrected 2026-07-19

Link request sent from the MCC, then accepted from inside the child account (`Администратор → Доступ и безопасность → Управляющие аккаунты`). Google required re-authentication for `CHILD_ACCOUNT_LINKING` — sending the request is not sufficient, the child owner must accept.

Verified by API, not by the interface:

```
=== HIERARCHY UNDER MCC 382-409-1750 ===
  3824091750 | Alfares        | manager=True  | level=0 | ENABLED
  2771381970 | Alfares s.r.o. | manager=False | level=1 | ENABLED

=== LINK STATUS ===
  customers/2771381970 → ACTIVE
  customers/2487049029 → ACTIVE
```

Google's requirement *"link all active Google Ads accounts to the manager account"* is now satisfied for the advertising account.

### Second MCC `3753531144` — verified empty, deliberately left in place

Checked before considering deletion:

| Check | Result |
|---|---|
| Campaigns | 0 |
| Client links (sub-accounts) | 0 |
| Manager links (parents) | 0 |
| Users | 1 — `ssfskype@gmail.com` (ADMIN) |
| Status | ENABLED, `testAccount=false`, Europe/Prague |

**Decision: leave it.** The Google Ads interface offers no way to close it — the "Закрыть аккаунт" button exists only inside a confirmation modal with no reachable trigger on the manager-settings page. Most likely Google does not permit closing a root manager account through self-service.

Forcing the hidden button via JavaScript was rejected: invoking a hidden control for an irreversible action bypasses unknown steps in the flow, and the cost of getting it wrong exceeds the cost of leaving an empty account in place.

Practical impact is limited: an empty MCC spends nothing and does not appear in the working hierarchy. It **is** visible in `listAccessibleCustomers`, so a Basic-access reviewer may see an enabled manager account outside the declared structure. If asked, the answer is one line: duplicate, created in error, empty.

Closing it would require a support request from within `375-353-1144`.

### Account `2487049029` — created accidentally, now linked and ACTIVE

Created when the campaign wizard was opened during setup. It is linked to the MCC and ACTIVE, but does **not** appear in `customer_client` — consistent with an account that exists but was never completed (no billing, no campaigns).

It is a candidate for the MS-002 Bazos campaigns, or should be closed. Decide during MS-002 planning; not blocking.

---

## ⚠️ Refresh tokens expire in 7 days

OAuth publishing status is **Testing**. In that state Google expires refresh tokens after 7 days, so any stored token will silently stop working within a week.

Consequences:

- Fine for **validating** access now
- **Not viable for production.** Before the platform runs unattended, publishing status must change to *In production*

Publishing an External app that uses the sensitive `adwords` scope may trigger Google's verification requirements. This has not been assessed and should be **before** MS-002 depends on unattended API access, not after.

The alternative — leaving it in Testing and refreshing the token weekly by hand — is acceptable only while a human is driving every experiment.

---

## Access level constraints (sourced, developers.google.com)

| Tier | Prod ops/day | Blocks |
|---|---|---|
| **Explorer** *(current)* | 2,880 | account creation, user management, **planning tools**, billing |
| Basic *(applied for)* | 15,000 | — |

**Explorer is sufficient for MS-002** — reading metrics and creating campaigns both work.

**Basic is required for F-012** — planning services (Keyword Planner) are blocked at Explorer, and keyword research is part of the AI generation slice. Review takes ~5 business days.

---

## Reproduce

```bash
export VAULT_ADDR=http://127.0.0.1:8200
python3 growth/scripts/get-refresh-token.py    # one-time, opens browser for consent
python3 growth/scripts/verify-api-access.py    # calls listAccessibleCustomers
```

Neither script prints secrets. Both read from and write to Vault directly.

## Next action

Run `get-refresh-token.py`, then `verify-api-access.py`. Record the HTTP response here — that closes the gap between "the UI says Explorer" and "the API accepts our credentials".
