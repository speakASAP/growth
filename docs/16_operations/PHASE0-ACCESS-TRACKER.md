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
| 3 | Legal entity | ✅ Alfares s.r.o. | — | ✅ |
| 4 | **MCC** Alfares `382-409-1750` | ✅ создан, CZK, Europe/Prague | Прочитано из UI | ✅ |
| 5 | Developer token | ✅ выдан | В Vault; уровень **Explorer** (по UI) | ✅ |
| 6 | **Реальный вызов API** | — | ✅ **HTTP 200**, v21, 3 аккаунта — см. [VR-001](../12_validation/VR-001-google-ads-api-access.md) | ✅ |
| 7 | ~~Meta app~~ — **deferred**, second platform only | — | — | ◷ |
| 8 | ~~Meta Business Verification~~ — deferred | — | — | ◷ |
| 9 | ~~Meta access~~ — deferred | — | — | ◷ |
| 10 | ~~Sklik~~ — deferred to F-013 | — | — | ◷ |
| 11 | Privacy policy live | Publish | Fetch URL, confirm reachable | ⬜ |
| 11a | GCP проект + Google Ads API | ✅ `alfares-489917` / `736358823451` | `Status: Enabled` подтверждён | ✅ |
| 11b | OAuth-клиент Desktop | ✅ создан | Client ID/secret в Vault | ✅ |
| 11c | OAuth test user | ✅ `ssfskype@gmail.com` | Audience → Test users | ✅ |
| 11d | **Refresh token** | ✅ получен 2026-07-19 | ✅ проверен вызовом API | ✅ |
| 11e | **Publishing status → In production** | ⚠️ сейчас *Testing* — токен живёт 7 дней | Требуется до автономной работы | ⬜ |
| 11f | Заявка на Basic access | ✅ отправлена 2026-07-19 | Ждём ~5 рабочих дней | 🔄 |
| 12 | Czech consent baseline | Counsel review | Record note | ⬜ |
| 13 | Provider-side spend limits | Настроить в аккаунте `277-138-1970` перед первой тратой | Прочитать через API | ⬜ |
| 14 | Durable edge-ingestion target chosen | Decide | Record in `docs/07_decisions/` | ⬜ |

Legend: ⬜ not started · 🔄 owner done, awaiting verification · ✅ verified · ⚠️ blocked

## Google Ads — verified against developers.google.com, 2026-07-18

**API Center: `https://ads.google.com/aw/apicenter`** — requires signing in with a **manager account (MCC)**. Not reachable from a plain Ads account.

| Tier | Prod ops/day | Review | Notes |
|---|---|---|---|
| Test | — (15k on test accounts) | automatic on sign-up | test accounts only |
| **Explorer** | **2,880** | may be auto-granted | ⚠️ **blocks account creation, user management, planning tools, billing** |
| **Basic** | **15,000** | ~5 business days | brand verification of GCP project recommended |
| Standard | unlimited | ~10 business days | large enterprises / multi-user tools |

⚠️ **Tiers are sequential** — each requires the previous one's approval. You cannot apply straight to Basic; expect Test → Explorer → Basic.

⚠️ **Explorer blocks planning tools = no Keyword Planner API.** If keyword research is to be automated (F-012 AI generation), **Basic is required, not optional**. Plan the ~5-day review into the schedule rather than discovering it at F-012.

Prerequisites before applying, per Google: verify current access level · keep API contact email current · **link all active Google Ads accounts to the manager account**.

## Other vendor facts — re-confirm before committing
- **15 June 2026 restriction**: tokens without prior qualifying offline-conversion activity are routed to the **Data Manager API** rather than new `UploadClickConversions` integrations. **Affects the S10 adapter choice — confirm before building.**
- Meta: Standard Access with `ads_read` + `ads_management` is sufficient for the app owner's own ad account; Advanced Access only for third-party accounts. *(Cited to Meta's Postman namespace — worth one confirmation against Meta's own docs, since the internal-first decision rests on it.)*

## Reporting format

When something is done, report it in one line:

```
[item #] done — <what was created/approved> — creds in Vault key <KEY_NAME>
```

Claude then runs the verification call, records the response in `docs/12_validation/`, and flips the status.

## Blockers

- ✅ ~~связать `2771381970` с MCC~~ — **выполнено 2026-07-19**, статус ACTIVE, подтверждено вызовом API
- [DECIDED: второй MCC `3753531144` оставлен как есть] — пуст (0 кампаний, 0 дочерних, 0 связей), интерфейс не даёт его закрыть; закрытие только через поддержку. Влияние: виден в `listAccessibleCustomers`, может вызвать вопрос при ревью Basic
- [OPEN: аккаунт `2487049029`] — создан случайно мастером кампании, связан и ACTIVE, но не достроен. Использовать под кампании Bazos в MS-002 или закрыть
- [RISK: OAuth publishing status = Testing] — refresh token протухает через 7 дней. Для автономной работы нужен *In production*, что может потребовать верификации приложения (sensitive scope `adwords`). Оценить до MS-002
- [RISK: OAuth publishing status = Testing] — refresh token протухает через 7 дней. Для автономной работы нужен *In production*, что может потребовать верификации приложения (sensitive scope `adwords`). Оценить до MS-002
- [UNKNOWN: Bazos service-subscription billing path] — does subscription revenue for the Bazos automation tool emit an order/payment event? Blocks MS-003 contracts, not MS-002

## Immediate next action (owner)

1. Create / confirm the **Google Ads account** for Bazos
2. Apply for a **developer token**
3. Store credentials in Vault under `secret/prod/growth`
4. Report here: `[item 4] done — <account id> — creds in Vault key <KEY_NAME>`

Claude then runs `customers:listAccessibleCustomers`, records the real access tier and quota in `docs/12_validation/`, and flips items 5–6.
