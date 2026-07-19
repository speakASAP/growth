# F-001 — Decision record and execution governance

**Slice:** S1 · **Milestone:** MS-002 (minimal part) / MS-004 (full) · **Gate:** ① DOC
**Status:** draft · **Created:** 2026-07-19

---

## Outcome

Every experiment that spends money carries an immutable record of **why it was launched and who approved it** — and, once the system starts acting on its own, no external side effect can occur that a human did not approve in exactly the form it executes.

---

## This slice splits in two — and only the first half is needed for MS-002

The architecture's scope cut line (§8.1) originally put the whole of S1 before first spend. **That conflated "first spend" with "first automated spend."** The first experiment uses manually created ads and a manually set budget; nothing in the system proposes or executes a spending action.

| Part | Contents | Needed by |
|---|---|---|
| **S1a — decision record** | `DecisionArtefact` + canonical hash | **MS-002** — cheap, and the rationale is unrecoverable if not captured at launch |
| **S1b — execution governance** | `ApprovalGrant`, `approvedParametersHash`, `ExecutionAttempt`, `effectKey`, reconciliation, budget ceilings | **MS-004**, before the first API write |

Building S1b now would be machinery with nothing to govern. Building S1a now is necessary, because you cannot reconstruct in three months why an experiment was launched with that hypothesis, that budget and that audience.

---

## S1a — decision record (MS-002)

### Required owners

`growth-core` only.

### Behaviour

When an experiment is launched, a `DecisionArtefact` is written **once** and never updated:

```ts
interface DecisionArtefact {
  decisionArtefactId: string;
  workspaceId:        string;
  experimentId:       string;
  experimentVersion:  string;
  decisionType:       "experiment.launch" | "experiment.stop" | "budget.change";
  hypothesis:         string;          // what we believe, in the owner's words
  rationale:          string;          // why now, why this budget, why this audience
  evidenceReferences: string[];        // pointers — NEVER inline personal data
  plannedAction: {
    platform:      "google_ads";
    budgetCap:     { value: string; currency: string };
    startAt:       string;
    endAt:         string;
  };
  policyVersion:      string;
  decidedByType:      "human";         // always human at MS-002
  decidedById:        string;
  decidedAt:          string;
  canonicalHash:      string;          // SHA-256 of the canonicalised artefact
}
```

**Canonical hash, not a signature.** A hash detects accidental mutation and costs nothing — no key management, no rotation. Signing defends against forgery by someone inside the trust boundary, who already holds the Vault credentials and could spend directly; it would guard the weaker door. Add signing when an executor crosses a trust boundary ([architecture §4.3](../06_architecture/ARCHITECTURE.md)).

**References, never inline PII.** Immutability and the right to erasure are in direct conflict. The artefact holds pointers to pseudonymous touchpoints; identity is reachable only through the erasable `IdentityLink` (architecture §7.9). A deletion request must never require destroying decision history.

**Corrections create a new version.** The artefact is never edited.

---

## S1b — execution governance (MS-004, documented now so the seam is right)

Not implemented in this slice. Recorded here so S1a does not paint it into a corner.

### The correction that shaped it

An earlier draft claimed a persisted grant with `consumedAt` set transactionally prevents double execution. **It does not.** A database transaction cannot span a Google API call:

```
1. worker sends create-campaign
2. provider creates the campaign
3. worker crashes before recording success
4. worker retries
5. a second campaign exists
```

Grants **authorise**. They do not **deduplicate**. Division of responsibility (architecture §4.3):

| Mechanism | Prevents |
|---|---|
| `ApprovalGrant` | replay, expired use, out-of-scope or over-amount execution |
| `approvedParametersHash` | the payload drifting from what the human reviewed |
| `ExecutionAttempt.effectKey` | duplicate execution intent |
| Provider idempotency key | duplicate provider requests, where supported |
| Reconciliation by resource lookup | resolving `ambiguous` outcomes |
| Budget ledger | aggregate exposure |

An `ambiguous` outcome is **never retried blind**.

---

## Open questions — resolve before CONTRACT

1. **Does `DecisionArtefact` cover budget changes at MS-002?** The first experiment has a fixed manual budget. If the owner raises it mid-run, is that a new artefact or an untracked manual act? Untracked means the audit trail has a hole exactly where money moved.
2. **Where does `rationale` come from?** Free text typed by the owner, or structured fields? Free text is honest and cheap; structure is queryable later. Cannot be retrofitted onto artefacts already written.
3. **Canonicalisation rules for the hash** — key ordering, whitespace, number formatting. Must be pinned in the contract, or two implementations produce different hashes for the same artefact.
4. **Does stopping an experiment need an artefact?** A kill decision is as consequential as a launch, and later analysis of why experiments died is the more useful dataset.

---

## Validation plan

### Automated

| Test | Asserts |
|---|---|
| Immutability | Update attempt on an existing artefact is rejected |
| Hash stability | Same artefact canonicalises to the same hash across runs and processes |
| Hash sensitivity | Any field change produces a different hash |
| No PII | Artefact contains no email, phone or name — only references |
| Erasure survival | Deleting an `IdentityLink` leaves the artefact intact and readable |

### Owner manual check

1. Launch the first experiment; confirm an artefact is written with the hypothesis in your own words
2. Attempt to edit it; confirm refusal
3. Read it back three days later and confirm it explains *why* the experiment was launched without needing memory

---

## Dependencies

**Blocks:** nothing at MS-002 — S5 and S6 do not need it, though the experiment launched in MS-002 should be recorded by it.
**Blocked by:** nothing.

S1b blocks S9 (connector writes) and must be complete before any API mutation.
