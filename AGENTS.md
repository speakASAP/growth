# AGENTS.md — growth-core

Central standard: `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`
Repo-specific rules and invariants: `CLAUDE.md` in this directory.

## Boundaries

- Contracts and slice planning live in the `growth` repo. Do not change behaviour here without
  first changing the contract there — `C-001` is the authority, this service is the implementation.
- `src/governance/schemas/decision-artefact.v1.json` is a copy of the contract's published schema.
  Editing it here alone silently forks the contract.
- Do not add an update or delete path for `decision_artefact`.

## Commands

```bash
npm run build
./scripts/test-db.sh up && npm test
npm run lint
```
