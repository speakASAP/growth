# D-002 — Landing model, conversion signal, and durable buffer

**Status:** accepted · **Decided by:** owner · **Date:** 2026-07-19
**Affects:** MS-002, F-005, architecture §4.2, §4.4.1

---

## D-002a — Conversion is measured by **registration**, not by a lead form

The Bazos landing already has a registration flow:

```
Registrovat                    → /client?auth=register
Klientský panel                → /client
Přihlásit se nebo registrovat  → /client
```

**No lead-capture form is built.** The experiment's primary outcome is a **registration**.

### Why this is better than the previous model

The earlier design (D19) made the primary outcome a *manually qualified lead*: complete contact + detailed request + a reply on some channel, marked by hand after working the lead.

That carried a real risk, flagged in VR-001: offline conversion upload to Google is time-bounded from the click (~90 days), and manual qualification latency eats into that window. Registration removes the problem — it is immediate, automatic, and unambiguous.

### What happens to qualification

`LeadQualificationEvent` (D19) **is not withdrawn**. It moves from *primary experiment metric* to *post-hoc quality assessment*:

| Signal | Purpose | Timing |
|---|---|---|
| **Registration** | Conversion event for the ad platform; primary MS-002 outcome | immediate, automatic |
| **Qualification** | Business judgement of lead quality; feeds later decision rules | days later, manual |

Both are recorded. Only the first is uploaded to Google Ads as a conversion at MS-002.

---

## D-002b — Experiment landing is a **copy of the main page**

The experiment landing is a clone of `bazos.alfares.cz`, not a new design, carrying an immutable `landingVersionId`.

Rationale: the main page is already legally complete and Google-review-ready. Cloning preserves that; designing a new page from scratch would reopen compliance work for no measurement benefit.

Variants for A/B testing are versioned copies of the clone.

### Landing compliance state — verified 2026-07-19

The page carries a complete legal footer:

| Document | Path |
|---|---|
| Zásady ochrany osobních údajů | `/cs/legal/privacy-policy` |
| Zásady cookies | `/cs/legal/cookie-policy` |
| Soulad s GDPR | `/cs/legal/gdpr-compliance` |
| Obchodní podmínky | `/cs/legal/terms-of-service` |
| **Soulad s aktem EU o AI** | `/cs/legal/eu-ai-act-compliance` |
| Zásady vrácení peněz · Právní vyloučení · Právní dodatky | — |

Plus operator identity (Alfares s.r.o., IČ 27138038, DIČ CZ27138038, registered address) and an explicit disclaimer that the service is not affiliated with or endorsed by Bazoš.cz — which matters for Google ad review, since it removes the third-party-brand question.

This closes the AI Act item that the architecture (§7.10) left open as a legal question.

> ⚠️ Verified at a point in time. Re-check the live page immediately before submitting ads for review — an earlier check of the same URL showed only 9 links and no legal block, because the deploy had not yet landed.

---

## D-002c — Durable buffer is **Postgres on database-server**

Owner decision, taken over the CDN/edge alternative.

### Honest statement of what this does and does not protect

**Protects against** the common failures: `growth-core` pod restart, deploy window, RabbitMQ briefly unavailable, consumer lag. The event is written to Postgres synchronously and drained afterwards.

**Does not protect against** the scenario §4.2 of the architecture was written for: the k3s node itself going down. The buffer shares a failure domain with everything else. If the node dies, registrations are lost while the ads keep spending.

### Why it is still the right MVP call

Per-node outages are rarer than pod restarts, the first experiment runs with a manually capped budget under human observation, and adding an external dependency now costs money and a new operational surface for a benefit that only materialises in a rarer failure mode.

**The contract is unchanged by this choice.** `F-005` defines the ingestion interface so the storage behind it can be swapped for an edge queue later without touching producers or consumers. Revisit when experiments run unattended.
