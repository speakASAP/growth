# D-005 — `gsid` propagation: query parameter as primary, corrected producer

**Status:** accepted · **Date:** 2026-07-20 · **Decided by:** owner
**Supersedes:** [D-003](D-003-session-propagation-retention-buffer.md) Q2
**Affects:** [F-005](../10_features/F-005-landing-and-ingestion.md) · [C-005](../23_documentation_contracts/C-005-landing-and-ingestion.md)

---

## What was wrong

D-003 Q2 chose a first-party cookie as the primary carrier of `gsid`, with a query parameter as
fallback. The reasoning was: *"Same-origin makes it reliable across any navigation path inside the
site."*

**That premise is false.** Registration does not happen on the landing's host. Verified in code
2026-07-20:

```js
// bazos/services/bazos-service/src/ui/ui.assets.ts:1665,1764
const authBaseUrl = 'https://auth.alfares.cz';
const url = new URL(action === 'register' ? '/register' : '/login', authBaseUrl);
window.location.assign(url.toString());
```

The landing is served from `bazos.alfares.cz`; registration is a hosted flow on
`auth.alfares.cz`. A cookie scoped `Domain=bazos.alfares.cz` is sent only to that host and its
subdomains — `auth.alfares.cz` is a sibling, not a subdomain, so the cookie never arrives.

The two hosts are same-*site* (registrable domain `alfares.cz`), which is why `SameSite=Lax` was
not the problem and would not have surfaced it. The failure is in the cookie's `Domain` scope.

**Why this mattered more than an ordinary bug:** the resulting behaviour is indistinguishable from
the contract's expected path. C-005 §4 lists *"`gsid` absent → registration recorded, attribution
absent — expected path, not an error."* Attribution would have been empty for every single
registration, and the system would have reported that as normal operation. The number that budget
decisions are made from would have been zero, silently.

---

## Decision

### 1. The query parameter is the primary carrier

A query parameter carries the attribution handle across the host hop. **What crosses is an opaque
`correlationId`, not `gsid`** — see §3.

```
https://auth.alfares.cz/register?client_id=…&return_url=…&state=<correlationId>
```

Verification of `gsid` stays in `growth-core` (C-005 §4), unchanged.

The cookie is **kept, with a narrowed role**: it carries `gsid` across navigation *within*
`bazos.alfares.cz`, so the value still exists when the visitor finally clicks through to
registration, possibly several pages later. It is the store, no longer the transport.

`gsidSource` in the payload therefore becomes `"query"` on the normal path. The `"cookie"` value
is retained in the enum for the case where a future registration surface is genuinely same-host.

### 2. The producer is `auth-microservice`, not `bazos-service`

C-005 §2.2 named `bazos-service` as producer of `growth.registration.completed.v1`.
`bazos-service` has no registration backend — no `@Post('register')` anywhere in it. The endpoint
is `auth-microservice/src/auth/auth.controller.ts`.

`auth-microservice` currently emits **no events at all** — no broker client, no publisher. Adding
its first event publisher is the largest single piece of work in slice S5, and it is a
prerequisite for the conversion signal existing at all.

### 3. The join is on `correlationId`; `gsid` never reaches auth

*(Added 2026-07-20 by owner decision, reconciling this record with [EP-005](../21_execution_plans/EP-005-landing-and-ingestion.md) W3.)*

An earlier draft of §1 had `auth-microservice` place `gsid` directly in its registration event. That
violates EP-005 W3, which holds — **non-negotiably** — that auth's event stay generic, because
`auth-microservice` is shared by the whole ecosystem and the delivery plan requires its first event
wiring to be reusable by S6, S10 and MS-P rather than shaped to this slice. Two events and a join
satisfy both constraints:

```
bazos   → growth.auth_redirect.initiated.v1 { gsid, correlationId }   emitted at click, server-side
auth    → auth.user.registered.v1           { userId, correlationId, applicationContext }
growth  → join on correlationId  →  IdentityLink
```

`auth-microservice` round-trips `correlationId` as an opaque handle through the existing `state`
parameter. That is generic infrastructure behaviour — no growth concept enters the auth service.

**This does not resurrect the rejected callback alternative.** The `bazos` event is emitted at the
moment of the click, *before* navigation, not on return. A visitor who registers and closes the tab
still produced both halves of the join.

---

## Rejected alternatives

### Cookie on the parent domain `.alfares.cz`

Would reach both hosts and require no change to `bazos-service`.

Rejected: it broadcasts the attribution token to **every** service in the ecosystem —
`payments`, `orders`, `auth`, and anything added later — none of which have any use for it. A
marketing identifier that arrives at the payment service is a privacy question we would have to
answer for no benefit. Widening a cookie's scope to route around one redirect is a poor trade.

### `bazos-service` emits the event on the auth callback

The visitor returns to `bazos` after registering, so `bazos` could emit the event there and keep
`auth-microservice` untouched.

Rejected: the callback is not guaranteed. A visitor who registers and closes the tab has
registered — the fact happened — but no event would be emitted. Conversion counts would
under-report by exactly the population that is hardest to notice. An event must be emitted by the
service that owns the fact, at the moment the fact becomes true.

---

## Consequences

- `auth-microservice` joins the slice as a required owner and needs an event publisher — generic,
  reusable, carrying no growth concepts.
- **`gsid` never crosses to `auth.alfares.cz`.** Only the opaque `correlationId` does. The privacy
  question an earlier draft had to answer — an attribution token landing in auth's access logs and
  `Referer` headers — does not arise. `correlationId` is a random per-journey handle with no
  standalone meaning.
- `growth-core` must tolerate the two halves of the join arriving in either order, and a
  `correlationId` that never gets its second half (visitor abandoned registration).
- Consent behaviour is unchanged: no consent → no `sessionId` → no `gsid` → registration
  completes, attribution absent. That path stays exactly as D-003 describes it.

