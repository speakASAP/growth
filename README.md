# growth

> **Status: documentation phase — no code yet, by design.**
> Documentation → contracts → validation → coding, in that order.

AI Growth Experimentation Platform: takes a human-authored business hypothesis and runs it end-to-end as a measurable paid-acquisition experiment. Human-in-the-loop by default; no autonomous money spend.

## Document structure (IPS standard)

Follows the canonical Intent Preservation System layout used across the ecosystem (`intent-preservation-system`, `domain-research`, `aukro`, …).

| Dir | Contents | State |
|---|---|---|
| `docs/06_architecture/` | **`ARCHITECTURE.md` — the implementation baseline** | ✅ v7 |
| `docs/07_decisions/` | Decision records D1–D24 | ✅ |
| `docs/08_roadmap/` | Delivery model, gates, slice rules | ✅ |
| `docs/09_milestones/` | **MS-001…MS-004, MS-P** — synchronisation points | ✅ |
| `docs/10_features/` | F-001…F-013 — one per slice | ◷ |
| `docs/11_tasks/` | `TASK-NNN-*.md` — per feature | ◷ |
| `docs/12_validation/` | Validation reports, API access evidence | ◷ |
| `docs/13_context_packages/` | Context packages for AI worker agents | ◷ |
| `docs/14_prompts/` | Coding prompts | ◷ |
| `docs/16_operations/` | `PHASE0-ACCESS-TRACKER.md` | ✅ |
| `docs/21_execution_plans/` | Per-slice execution plans (allowed/forbidden files, merge order) | ◷ |
| `docs/23_documentation_contracts/` | Event JSON schemas — the executable contracts | ◷ |

## Reading order

1. `docs/06_architecture/ARCHITECTURE.md` — what is being built and why
2. `docs/09_milestones/MS-001-access-and-baseline.md` — **the active milestone**
3. `docs/08_roadmap/DELIVERY_PLAN.md` — how work is organised
4. `docs/16_operations/PHASE0-ACCESS-TRACKER.md` — what is blocked on external access

## Governing standards

- `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md` — agent roles, parallel-work rules
- `shared/AGENT_OPERATIONS.md` §Parallel Work
- `shared/docs/PROJECT_AGENT_DOCS_STANDARD.md`

## Current state

| | |
|---|---|
| Stage | Documentation |
| Active milestone | **MS-001 — Access and baseline** |
| Blocked on | First business selection · ad-platform decision · Google/Meta account registration |
| Code | None — deliberate |
| Market | Czechia only (stage 1), multiple businesses |
| Port | 4900 (reserved, not yet allocated) |

## Known blocking finding

Revenue for **speakasap, marathon, chytrakoupe and cliplot does not flow through `orders-microservice`** — verified in code. Attribution depends on it. Solved by the universal `revenue.recognised` contract (MS-003) with flipflop as first client. Until then, experiments must target businesses already on `orders`.
