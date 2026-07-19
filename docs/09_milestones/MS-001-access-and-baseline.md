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
| 4 | Legal entity + ad-account ownership confirmed | Alfares s.r.o. | ✅ |
| 5 | Developer token — access level confirmed **by a real API call** | ✅ HTTP 200, v21, Explorer — [VR-001](../12_validation/VR-001-google-ads-api-access.md) | ✅ |
| 6 | ~~Meta app~~ — отложено, нужен только для второй платформы | — | ◷ |
| 7 | ~~Sklik~~ — отложено до F-013 | — | ◷ |
| 8 | Privacy policy live + юридически проверена | ✅ https://alfares.cz/legal/privacy-policy — HTTP 200, владелец подтвердил юрпроверку | ✅ |
| 9 | ~~Provider-side spend limits~~ — **перенесено в MS-002** | Невыполнимо в MS-001: нет кампаний и нет способа оплаты. См. ниже | ➡️ |
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

## Статус: основное закрыто

Доступ к Google Ads API получен и **подтверждён реальным вызовом**, не интерфейсом. Иерархия аккаунтов приведена в порядок. Заявка на Basic отправлена.

## Почему пункт 9 перенесён в MS-002

Проверено в аккаунте `277-138-1970` (2026-07-19): доступных средств `0,00 CZK`, платежей никогда не было, все месяцы по нулям, кампаний нет.

Провайдерские лимиты в Google Ads задаются **на уровне кампании** — дневной бюджет, общий бюджет, дата окончания. Настоящего «лимита трат аккаунта» для карточных аккаунтов не существует; он есть только при ежемесячном выставлении счетов.

Следовательно: **пока нет кампаний, лимитировать нечего.** Критерий был сформулирован неверно — он принадлежит моменту создания кампании, то есть MS-002.

Текущее состояние при этом **максимально безопасно**: аккаунт без способа оплаты физически не может потратить ничего. Это более сильная гарантия, чем любой настроенный лимит.

Требование §7.6 архитектуры («провайдерские лимиты — первая линия защиты») остаётся в силе и переносится в MS-002 как обязательное условие перед запуском первой кампании.

## Остаётся

- [TODO: consent baseline на лендинге] — политика опубликована, но механизм согласия на самом лендинге ещё не проверен (пункт 12)
- [TODO: выбрать реализацию durable edge-ingestion] — пункт 10
- [RISK: OAuth в статусе Testing] — refresh token живёт 7 дней; оценить переход в *In production* до MS-002
- [UNKNOWN: путь выручки Bazos] — подписка на сервис автоматизации не проходит через `orders`; блокирует MS-003, не MS-002 (см. [D-001](../07_decisions/D-001-first-business-and-platform.md))

## Next action

Owner registers/confirms Google Ads and Meta accounts. Report here as each is done; Claude verifies each by API call before the criterion is marked complete.
