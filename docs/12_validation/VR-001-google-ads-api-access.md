# VR-001 — Google Ads API access

**Type:** validation_report · **Status:** partial — credentials obtained, API call not yet made
**Milestone:** MS-001 · **Date:** 2026-07-19

---

## What was established

| Item | Value | How verified |
|---|---|---|
| Manager account (MCC) | Alfares `382-409-1750` | Read from Google Ads UI |
| MCC currency | **CZK** | UI (`0,00 CZK` in reporting) |
| MCC time zone | **GMT+02:00 Central European** | UI footer |
| Sub-accounts | **0** | Accounts grid: `Всего: 0 менеджеров, 0 аккаунтов` |
| Developer token | issued | Present in API Center, stored in Vault |
| **Access level** | **Explorer** | API Center → «Уровень доступа: Доступ к Explorer» |
| Google Cloud project | `alfares-489917` / number `736358823451` | GCP console project card |
| Google Ads API in project | **Enabled** | API details page: `Status: Enabled`, «Disable API» present |
| OAuth client | Desktop app, created 2026-07-19 | GCP → Clients |
| OAuth publishing status | **Testing** | Google Auth Platform → Audience |
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
GOOGLE_ADS_REFRESH_TOKEN        ❌  not yet obtained
```

---

## ⚠️ What is NOT verified

**No API call has been made.** "Explorer" is what the Google Ads interface displays — it has not been confirmed by a response from the API. Until `verify-api-access.py` returns HTTP 200, the access level remains an interface claim, not an established fact.

This distinction matters: the whole point of recording validation evidence is to separate what we read from what we proved.

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
