# F-001 — Decision record and execution governance

**Slice:** S1 · **Milestone:** MS-002 (minimal part) / MS-004 (full) · **Gate:** ① DOC — **complete**
**Status:** S1a passed to ② CONTRACT · **Created:** 2026-07-19 · **Updated:** 2026-07-19
**Contract:** [C-001](../23_documentation_contracts/C-001-decision-record.md) · **Decisions:** [D-004](../07_decisions/D-004-decision-artefact-shape-and-hash.md)

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

When an experiment is launched — and again when it is stopped — a `DecisionArtefact` is written **once** and never updated:

```ts
interface DecisionArtefactBase {
  decisionArtefactId: string;
  workspaceId:        string;
  experimentId:       string;
  experimentVersion:  string;
  evidenceReferences: string[];        // pointers — NEVER inline personal data
  policyVersion:      string;
  decidedByType:      "human";         // always human at MS-002
  decidedById:        string;
  decidedAt:          string;
  canonicalHash:      string;          // SHA-256 of the canonicalised artefact
}

interface ExperimentLaunchDecision extends DecisionArtefactBase {
  decisionType:       "experiment.launch";
  hypothesis:         string;          // what we believe, in the owner's words
  rationale:          string;          // why now, why this budget, why this audience
  plannedAction: {
    platform:      "google_ads";
    budgetCap:     { value: string; currency: string };
    startAt:       string;
    endAt:         string;
  };
}

interface ExperimentStopDecision extends DecisionArtefactBase {
  decisionType:       "experiment.stop";
  reason:             string;          // REQUIRED — why this experiment is being killed
  stoppedAt:          string;          // when spend actually stops, not when the call was made
}

interface ExperimentBudgetChangeDecision extends DecisionArtefactBase {
  decisionType:         "experiment.budget_change";
  reason:               string;      // REQUIRED — why the cap is moving
  supersedesArtefactId: string;      // the artefact that set the cap being replaced
  previousBudgetCap:    { value: string; currency: string };
  newBudgetCap:         { value: string; currency: string };
  effectiveFrom:        string;
}

type DecisionArtefact =
  | ExperimentLaunchDecision
  | ExperimentStopDecision
  | ExperimentBudgetChangeDecision;
```

> Field-level authority is [C-001](../23_documentation_contracts/C-001-decision-record.md) and its
> JSON schema. The shapes here describe behaviour; where the two ever disagree, the contract wins.

**A mid-run budget change is a decision, not an adjustment** (D-004). The first experiment's budget
is set by hand, so raising it is a two-minute act in the Google Ads UI — and if the system does not
record it, the audit trail is missing precisely the moment money moved. `supersedesArtefactId`
chains each change to the artefact whose cap it replaces, so the effective cap at any time is
reconstructable rather than asserted.

**A stop without a `reason` is rejected, not defaulted.** The dataset that matters in six months is not why experiments were launched — every launch is optimistic and the reasons rhyme — but why they were killed. That signal only exists if it is captured at the moment of the kill, when the owner still remembers. An empty-string `reason` is a validation failure, not an empty field.

A stop artefact carries no `hypothesis` and no `plannedAction`: there is nothing being proposed. It points at the launch artefact through `experimentId` + `experimentVersion`, so the pair reads as one story.

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

## Open questions

**None. All four are resolved** — the DOC gate is closed and S1a has passed to ② CONTRACT.

### Resolved

- **Does stopping an experiment need an artefact?** — **Yes.** `experiment.stop` with a required `reason`, modelled above. A kill is as consequential as a launch, and the record of why experiments died is the more useful dataset of the two.
- **Does `DecisionArtefact` cover budget changes at MS-002?** — **Yes**, as `experiment.budget_change` ([D-004 §1](../07_decisions/D-004-decision-artefact-shape-and-hash.md)). Stop-and-relaunch was rejected: making a routine adjustment expensive guarantees it happens in the Ads UI and never reaches the record.
- **Where does `rationale` come from?** — **Free text** ([D-004 §2](../07_decisions/D-004-decision-artefact-shape-and-hash.md)), consistent with `reason`. Optional structure can be added at MS-004; a required field can never be added retroactively.
- **Canonicalisation rules for the hash** — **RFC 8785 (JCS)** ([D-004 §3](../07_decisions/D-004-decision-artefact-shape-and-hash.md)), pinned with its edge cases in [C-001 §3](../23_documentation_contracts/C-001-decision-record.md). An external standard is checkable against its own test vectors; prose rules are what two cold-starting agents diverge on.
- **Is `reason` free text or a category plus free text?** — **Free text** for MS-002. A category enum (`no_signal`, `cost_per_lead_too_high`, `budget_exhausted`, `hypothesis_disproved`, `external`) would make the kill dataset queryable, but the categories are guesses until roughly ten experiments have actually died, and a wrong taxonomy in immutable records cannot be corrected. Revisit at MS-004.

### Deferred to MS-004

Recorded so the revisit is not lost: optional category fields alongside the free text on `reason`,
and structured fields alongside `rationale`. Both are additive to artefacts already written; neither
is expressible retroactively as required.

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
| Stop requires reason | A `experiment.stop` artefact with a missing, empty or whitespace-only `reason` is rejected |
| Stop shape | A `experiment.stop` artefact carrying `plannedAction` or `hypothesis` is rejected |
| Stop references a launch | A `experiment.stop` artefact whose `experimentId` + `experimentVersion` has no prior `experiment.launch` artefact is rejected |
| Budget chain | A `budget_change` whose `previousBudgetCap` disagrees with the artefact it supersedes is rejected |
| Budget fork | Two changes superseding the same artefact — the second is rejected, so cap history cannot branch |
| Currency consistency | A `budget_change` in a different currency from the launch is rejected |

The executable list, including the JCS test vectors and the concurrency cases, is
[C-001 §8](../23_documentation_contracts/C-001-decision-record.md). The table above is the
behavioural intent those tests exist to protect.

### Owner manual check

1. Launch the first experiment; confirm an artefact is written with the hypothesis in your own words
2. Attempt to edit it; confirm refusal
3. Read it back three days later and confirm it explains *why* the experiment was launched without needing memory
4. Stop the experiment without typing a reason; confirm refusal
5. Raise the budget mid-run; confirm the change is recorded with your reason and that the effective cap is reconstructable from the chain
6. Stop it with a reason; confirm the launch, budget change and stop artefacts read back together as one story

---

## Dependencies

**Blocks:** nothing at MS-002 — S5 and S6 do not need it, though the experiment launched in MS-002 should be recorded by it.
**Blocked by:** nothing.

S1b blocks S9 (connector writes) and must be complete before any API mutation.
