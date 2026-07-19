# D-004 — DecisionArtefact: scope, rationale format, canonical hash

**Date:** 2026-07-19 · **Decided by:** owner (Sergej) · **Status:** accepted
**Feature:** [F-001](../10_features/F-001-decision-record-and-governance.md) · **Contract:** [C-001](../23_documentation_contracts/C-001-decision-record.md)

Resolves open questions 1–3 in F-001, which gated the ② CONTRACT transition for S1a.

---

## 1. Budget changes get their own artefact

**Decision:** add `experiment.budget_change` as a third artefact type at MS-002.

The first experiment has a manually set budget. If the owner raises it mid-run and that act is
untracked, the audit trail has a hole exactly where money moved — the one place it must not.

Rejected alternatives:

- **Stop + relaunch as a new experiment version.** Fewer types, but it makes a routine adjustment
  expensive enough that in practice the budget gets changed in the Google Ads UI and never recorded.
  A governance rule that is inconvenient at the moment of the act is a rule that does not hold.
- **Leave it untracked until MS-004.** Cheapest now, but the reasoning behind a budget move is
  unrecoverable three months later, which is the entire premise of S1a.

Cost of the decision: one more member of an existing discriminated union. Adding it later is
impossible for artefacts already written.

## 2. `hypothesis`, `rationale` and `reason` are free text

**Decision:** free text, no structured fields, no category enum.

Consistent with the Q4 resolution already recorded in F-001 for `reason`. Any field set chosen now
is a guess, and a guess written into immutable records cannot be corrected. An *optional* structured
field can be added at MS-004 once ~10 experiments have run and the real dimensions are visible;
a *required* one can never be added retroactively.

Free text is also what the owner will actually write honestly at the moment of the decision, which
is the only moment the information exists.

## 3. Canonicalisation follows RFC 8785 (JCS)

**Decision:** JSON Canonicalization Scheme, RFC 8785.

The readers of this contract are multiple AI agents starting cold, in different models and
different sessions. Hand-rolled ordering, whitespace and number-formatting rules written in prose
are exactly the kind of thing two implementations diverge on — and a divergent hash silently
invalidates every artefact written by the other implementation.

JCS is an external, published standard: lexicographic key ordering by UTF-16 code unit, no
insignificant whitespace, ES6 number serialisation, UTF-8 output. Correctness is checkable against
the spec's own test vectors rather than against our description of our intent.

Rejected: hashing the stored database row — couples the hash to the Prisma/Postgres serialisation
and breaks on any storage change, which would invalidate history for a reason unrelated to the data.

Exact hash input, output encoding and the `canonicalHash` self-exclusion rule are pinned in
[C-001 §3](../23_documentation_contracts/C-001-decision-record.md).

---

## Consequences

- F-001 open questions 1–3 are closed; S1a moves to gate ② CONTRACT.
- `experiment.budget_change` joins the union in [C-001 §2](../23_documentation_contracts/C-001-decision-record.md).
- A JCS implementation becomes a dependency of `growth-core`.
- Revisit at MS-004: optional structured/category fields alongside the free text (never replacing it).
