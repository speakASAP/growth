# D-003 — Session propagation, retention, buffer placement

**Status:** accepted, **Q2 superseded** · **Date:** 2026-07-19 · **Closes:** F-005 open questions 1–5
**Decided by:** owner (Q1, Q3) · Claude, delegated (Q2, Q4, Q5)

> ⚠️ **Q2 is superseded by [D-005](D-005-gsid-propagation-correction.md) (2026-07-20).** Its premise —
> that landing and registration are same-origin — is false: registration happens on
> `auth.alfares.cz`, a sibling host, so the cookie never arrives. The signed query parameter is the
> carrier. Q1's *location* holds; only the same-origin consequence drawn from it is wrong.
> Q3–Q5 are unaffected.

---

## Q1 — Landing location: `bazos.alfares.cz` *(owner)*

The experiment landing lives on `bazos.alfares.cz`. *(Location confirmed; still current.)*

~~**Consequence that makes everything else simpler: landing and registration are same-origin.** A first-party cookie set on the landing is readable at registration without any cross-domain machinery.~~

⚠️ **False.** Verified in code 2026-07-20: `bazos-service` has no registration backend and redirects
to `https://auth.alfares.cz/register` (`ui.assets.ts:1665,1764`). `auth.alfares.cz` is a sibling of
`bazos.alfares.cz`, not a subdomain, so a cookie scoped `Domain=bazos.alfares.cz` is never sent
there. See [D-005](D-005-gsid-propagation-correction.md).

---

## Q2 — Session propagation: signed first-party cookie, with a signed query fallback

### Decision

```
1. Consent gate runs first. No consent → no session id issued at all.
2. With consent → growth-web sets a first-party cookie:

   gsid = <sessionId>.<HMAC-SHA256(sessionId, secret)>
   Domain=bazos.alfares.cz · Path=/ · Secure · SameSite=Lax · Max-Age=90d

3. The registration CTA additionally carries the same signed value:
   /client?auth=register&gsid=<signed>

4. bazos-service reads the cookie first, query parameter second,
   and includes the raw value in RegistrationCompleted.

5. growth-core verifies the HMAC before creating an IdentityLink.
   Invalid signature → registration recorded, attribution dropped.
```

### Why this shape

**Cookie as primary.** Same-origin makes it reliable across any navigation path inside the site, including redirects through the client panel that would strip a query parameter.

**Query parameter as fallback**, not as primary. It survives cookie clearing between landing and registration, but it is fragile: users share URLs, and referrers leak it. Belt and braces, with the cookie load-bearing.

**Signed, because attribution is a spending signal.** An unsigned `gsid` lets anyone attach arbitrary attribution to a registration by editing a URL. That corrupts the data the budget decisions are made from. HMAC verification costs nothing and closes it.

**`SameSite=Lax`, not `None`.** The whole flow is same-site; `None` would weaken it for no gain.

**90-day cookie lifetime** matches the offline-conversion upload window. Beyond that, an attribution link cannot be uploaded to Google anyway.

### Consent interaction — stated plainly

The `gsid` cookie is **not** strictly necessary for the service to function; it exists for marketing attribution. Under Czech ePrivacy rules that means **prior consent is required**.

Therefore: **no consent → no cookie → no attribution → registration still works.** The registration is counted in aggregate, but cannot be traced to an ad.

This will make measured conversions lower than actual. That is the correct behaviour, and the experiment's cost-per-registration must be read with it in mind — a point that belongs in the MS-002 report, not a bug to work around.

---

## Q3 — `leads-microservice` joins the slice *(owner)*

A registration also becomes a `Lead` record. Required owners for S5 become:

```
growth-web · growth-core · bazos-service · leads-microservice
```

This restores the anchor for `LeadQualificationEvent` (D19): qualification attaches to the lead created by registration, so the post-hoc quality assessment has something to hang on.

---

## Q4 — Retention: **14 months**, and a correction to the premise

### The premise was wrong

The request was for "the maximum period Czech law permits under GDPR." **No such maximum exists.** GDPR does not define upper limits for retention.

Article 5(1)(e) works the other way round: personal data must be kept **no longer than is necessary for the purpose**. There is no ceiling to reach for — the obligation is to justify the period you choose. Asking for "the maximum allowed" inverts the rule: under GDPR, keeping data longer than the purpose requires *is itself* the violation, whatever number a regulator has not prohibited.

Czech law adds no general maximum for marketing analytics either. It adds a *consent* requirement for non-essential tracking, which is a separate obligation.

### Decision: 14 months for `AnonymousTouchpoint`

Justified by purpose, not by what is permitted:

| Purpose | Period required |
|---|---|
| Offline conversion upload to Google Ads | ~90 days from click |
| Experiment analysis incl. conversion delay | 3–6 months |
| Year-over-year comparison of a seasonal experiment | 13 months |
| **Chosen** | **14 months** |

14 months covers the longest genuine need with a month of margin, and matches the ceiling GA4 applies to user-level data — a defensible industry reference if the period is ever questioned.

### Rules

- `AnonymousTouchpoint` and `IdentityLink`: **14 months**, then hard delete
- **Aggregated, non-personal** rollups (registrations per experiment per day, cost per registration): **indefinite** — aggregates are not personal data, and the historical series is what makes later experiments interpretable
- Deletion request from a data subject: `IdentityLink` severed immediately; the anonymous touchpoint survives without identity
- Retention is enforced by a scheduled job, not by manual cleanup

Anything longer than 14 months needs a documented purpose. "It might be useful" is not one.

---

## Q5 — Buffer table: own schema in the `growth` database

### Decision

```sql
-- database: growth   schema: ingest
CREATE TABLE ingest.event_buffer (
  event_id      uuid PRIMARY KEY,              -- idempotency key, supplied by the producer
  workspace_id  text        NOT NULL,
  event_type    text        NOT NULL,
  payload       jsonb       NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'pending',
                            -- pending | published | failed | dead
  attempts      int         NOT NULL DEFAULT 0,
  last_error    text,
  published_at  timestamptz
);

CREATE INDEX ON ingest.event_buffer (status, received_at)
  WHERE status IN ('pending','failed');
```

### Why a separate schema in growth's own database

**Own database, not shared with another service.** The buffer is growth's internal concern; no other service reads it. Putting it in a shared datastore would create coupling that the eventual swap to an edge queue has to unpick.

**Own schema, not mixed into growth's domain tables.** The buffer is infrastructure with a different lifecycle from domain data — it is truncated, drained and eventually replaced. Keeping it in `ingest.` makes "this table is disposable" visible in the name, and makes the future migration a schema-level operation rather than a hunt through domain tables.

**`event_id` as primary key** gives idempotency for free: a duplicate insert fails on the constraint rather than needing application logic.

**Partial index on unprocessed rows** keeps the drain query fast as the table grows, without indexing the published rows nobody scans.

**`dead` status, not deletion on failure.** A row that cannot be published must remain visible for inspection. Silent loss here is exactly the failure the buffer exists to prevent.

### Retention on the buffer itself

Published rows older than 30 days are deleted. The canonical record lives in the domain tables; the buffer is a transport, not an archive.
