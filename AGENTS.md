# AGENTS.md — growth

Central standard: `/home/ssf/.ai-agent-standards/CROSS_AGENT_AUTOMATION_STANDARD.md`
Repo-specific rules and invariants: `CLAUDE.md` in this directory.

## Boundaries

- **`docs/` is the authority, `services/` is the implementation.** Do not change behaviour in code
  without first changing the contract — `C-001` governs the decision record.
- **Do not edit `services/core/src/governance/schemas/`.** It is generated from
  `docs/23_documentation_contracts/schemas/` and gitignored; edits there are overwritten by the
  next build. Change the contract instead.
- Do not add an update or delete path for `decision_artefact`.
- Do not add an ingress path for `growth-core` — it is an unauthenticated audit-write surface.
  See `deploy.config.sh` for the full reasoning.

## Commands

```bash
cd services/core
npm run build
./scripts/test-db.sh up && npm test && ./scripts/test-db.sh down
npm run lint
```
