# F-005 — Experiment landing and durable ingestion

**Slice:** S5 · **Milestone:** MS-002 · **Gate:** ① DOC *(this document)*
**Status:** draft — contract not yet written · **Created:** 2026-07-19

> Gates: `SPIKE → **DOC** → CONTRACT → IMPL → VERIFY`. Nothing is implemented until the contract document exists.

---

## Outcome

A visitor clicks a Google ad, lands on an experiment page, registers — and that registration is traceable back to the exact ad, keyword and landing version that produced it, with consent recorded, **surviving a `growth-core` restart**.

**How we know it works:** kill the `growth-core` pod mid-registration; the registration still lands, attributed, once the pod returns.

---

## Scope

### Required owners

| Service | Change |
|---|---|
| `growth-web` | Experiment landing runtime — clone of `bazos.alfares.cz`, variant routing, click-ID + UTM capture, consent capture, event emission |
| `growth-core` | Ingestion worker, touchpoint store, identity link, attribution read model |
| `bazos-service` | Emit `RegistrationCompleted` on successful registration, carrying the signed `gsid` |
| `leads-microservice` | Create a `Lead` record from a registration ([D-003 Q3](../07_decisions/D-003-session-propagation-retention-buffer.md)) |

### Required consumers

`growth-core` (attribution) · `leads-microservice` (lead record).

### Optional future consumers

`marketing-microservice` — owned-channel journeys keyed on registration. **Not in this slice**, no consumer requirement yet.

### Explicitly excluded

- `notifications-microservice`, `marketing-microservice` — no consumer requirement yet
- Lead-capture form — **not built**, conversion is registration ([D-002a](../07_decisions/D-002-landing-conversion-and-buffer.md))
- Reply→lead linkage (S2–S4) — parallel track, not a dependency
- Google Ads API writes — S9
- Conversion upload to Google — S10

---

## Behaviour

### 1. Landing

The experiment landing is a **clone of the production Bazos page**, served under a distinct path/domain with an immutable `landingVersionId`. It inherits the existing legal footer — privacy, cookies, GDPR, terms, EU AI Act, operator identity, Bazoš disclaimer.

Variants are versioned clones. A variant is never edited in place; a change produces a new `landingVersionId`.

### 2. Touchpoint capture

On first view the page records an `AnonymousTouchpoint`:

- `gclid` (and `fbclid` when a second platform arrives)
- full UTM set
- `experimentId`, `landingVersionId`
- referrer, `occurredAt`
- **consent evidence reference** — never a raw consent copy ([architecture §5](../06_architecture/ARCHITECTURE.md))

A `sessionId` is issued and carried forward. **No contact details are stored at this stage** — the visitor is anonymous.

### 3. Session propagation and registration

Landing and registration are **same-origin** (both on `bazos.alfares.cz`), which makes a first-party cookie the reliable carrier. Full rationale in [D-003 Q2](../07_decisions/D-003-session-propagation-retention-buffer.md).

```
consent granted
  → growth-web sets  gsid = <sessionId>.<HMAC-SHA256(sessionId, secret)>
                     Domain=bazos.alfares.cz · Secure · SameSite=Lax · Max-Age=90d
  → registration CTA also carries ?gsid=<signed>   (fallback)
  → bazos-service reads cookie first, query second
  → emits RegistrationCompleted with the raw signed value
  → growth-core verifies HMAC, then creates IdentityLink
  → invalid signature: registration recorded, attribution dropped
```

Signing is not ceremony: an unsigned `gsid` would let anyone attach arbitrary attribution to a registration by editing a URL, corrupting the data that budget decisions are made from.

```
AnonymousTouchpoint(sessionId) ──IdentityLink──► registration ──► Lead
```

The `IdentityLink` is **erasable** — deleting it severs identity from the touchpoint without destroying the operational record (architecture §7.9).

**⚠️ No consent → no cookie → no attribution.** The registration still completes and is counted in aggregate, but cannot be traced to an ad. Measured conversions will therefore be *lower* than actual. This is correct behaviour, not a defect — but cost-per-registration must be read with it in mind, and the MS-002 report must state the attributed/unattributed split.

### 4. Durable ingestion

```
growth-web → ingestion endpoint → ingest.event_buffer  (synchronous commit)
                                        ↓
                            ingestion worker → RabbitMQ + read models
```

Buffer lives in its **own `ingest` schema in the `growth` database** ([D-003 Q5](../07_decisions/D-003-session-propagation-retention-buffer.md)) — `event_id` as primary key gives idempotency from the constraint rather than application logic; a partial index covers only unprocessed rows; failed rows go to `dead` status and are never deleted silently.

Rules:

- The endpoint acknowledges **only after the buffer row is committed**
- Every event carries an immutable `eventId`; browser retries reuse it
- The worker is idempotent on `eventId`
- Buffered rows are drained after an outage and never dropped
- Consent is evaluated **before** any transmission to an external vendor
- The buffer stores no unnecessary PII

**Known limitation, accepted:** the buffer shares a failure domain with `growth-core` ([D-002c](../07_decisions/D-002-landing-conversion-and-buffer.md)). It protects against pod restarts, deploys and RabbitMQ gaps — not against node loss. The interface is defined so the storage can be swapped for an edge queue later without touching producers or consumers.

### 5. Manual spend entry

No connector at this slice. The owner enters spend as `ManualSpendObservation` (architecture §4.5.1), always labelled manual, never presented as invoice-reconciled.

---

## Version identifiers — mandatory from the first event

Per architecture §8.1, version *fields* are cheap now and unrecoverable later:

```
experimentVersion · landingVersionId · policyVersion
attributionModelId · attributionModelVersion · decisionArtefactId
```

One attribution algorithm is implemented. The version fields are still required so historical decisions stay interpretable.

---

## Out of scope for the contract, but decided

- `workspaceId` on aggregate roots only, never `tenantId` (architecture §1.1)
- `causationId` optional — root events have none
- Currency explicit on every money field, even though stage 1 is CZK only

---

## Open questions — ✅ all closed by [D-003](../07_decisions/D-003-session-propagation-retention-buffer.md)

| # | Question | Resolution |
|---|---|---|
| 1 | Landing location | `bazos.alfares.cz` — same origin as registration |
| 2 | `sessionId` propagation | Signed first-party cookie, signed query fallback, HMAC verified |
| 3 | Registration → `Lead`? | **Yes** — `leads-microservice` joins the slice |
| 4 | Touchpoint retention | **14 months**, then hard delete. Aggregates indefinite |
| 5 | Buffer placement | `ingest` schema in the `growth` database |

### Retention — note on the reasoning

The period was chosen by **purpose**, not by what regulation permits. GDPR sets no maximum retention; Article 5(1)(e) requires data be kept no longer than necessary, so "the longest allowed" is not a meaningful target — keeping data beyond the purpose is itself the violation.

14 months covers the longest genuine need (year-over-year comparison of a seasonal experiment) with a month of margin.

---

## Validation plan

### Automated

| Test | Asserts |
|---|---|
| Schema conformance — producer | `growth-web` emits events valid against the published JSON schema |
| Schema conformance — consumer | `growth-core` parser accepts everything the schema permits |
| Idempotency | Same `eventId` twice produces one row |
| **Failure injection** | `growth-core` down during registration → event still lands after recovery |
| Consent gate | Event without valid consent evidence is never transmitted to a vendor |
| **Consent refusal path** | No consent → no `gsid` → registration completes, attribution absent, no error |
| **Signature verification** | Forged or edited `gsid` → attribution dropped, registration still recorded |
| Retention job | Touchpoints older than 14 months are deleted; aggregates survive |
| Attribution chain | touchpoint → identity link → registration resolves end to end |

### Owner manual check

1. Click a real ad → land on the experiment page
2. Register via `/client?auth=register`
3. Confirm the registration shows its touchpoint, `gclid` and consent record
4. Kill the `growth-core` pod mid-registration → confirm the event still arrives
5. Enter a day's spend manually
6. Confirm the experiment view shows spend, registrations, cost per registration

**A slice with passing tests but no owner check is not complete.**

---

## Dependencies

**Blocks:** F-006 (qualification), F-008 (connector read), F-010 (conversion upload)
**Blocked by:** nothing — S1 governance is not required, because this slice spends no money and issues no API writes

**Not blocked by** the OAuth *Testing* status risk: this slice makes no Google Ads API calls.

---

## Next gate

**CONTRACT** — ready to write, all questions closed. Deliverables in `docs/23_documentation_contracts/`:

- JSON schemas: `TouchpointObserved`, `RegistrationCompleted`, `LeadCreatedFromRegistration`, `ManualSpendObservation`
- `ingest.event_buffer` DDL + retention job
- Ingestion endpoint shape and failure semantics
- HMAC signing scheme for `gsid` (secret in Vault at `secret/prod/growth`)
- Retention job specification (14 months, hard delete)
