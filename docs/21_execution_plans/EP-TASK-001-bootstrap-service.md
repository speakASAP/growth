# EP-TASK-001-bootstrap-service

completeness_level: complete

status: closed

## Upstream traceability
- `../11_tasks/TASK-001-bootstrap-service.md`
- `../22_goal_impact/GOAL-IMPACT-TASK-001.md`
- `../12_validation/VAL-TASK-001-bootstrap-service.md`

## Scope
- align local docs to the repository’s real service or hub scope
- create or update the acceptance profile and adoption artifacts
- validate the repository against the central IPS profile rules

## Non-goals
- deploy a runtime service
- alter the shared IPS standard or master rollout plan
- claim runtime dependencies the repo does not own

## Project invariants
- honest ownership of runtime or hub responsibilities
- clear task-to-goal-to-validation traceability
- no fabricated secret, contract, or capability evidence

## Sensitive-data handling
No secret values are introduced. The repository adoption docs describe project boundaries and governance only.

## Contract validation plan
The repo’s integration contract is reviewed for required vs not-applicable capability decisions and must remain consistent with the actual service or hub scope.

## Replay and determinism plan
The task is deterministic and re-runnable because it is based on the repo’s actual docs and the central validation rules.

## Files to inspect
- README.md
- BUSINESS.md
- SYSTEM.md
- AGENTS.md
- TASKS.md
- STATE.json
- relevant docs directory files if they already exist

## Files to create
- `ips-adoption.json`
- `docs/00_constitution/CONSTITUTION.md`
- `docs/01_vision/VISION.md`
- `docs/06_architecture/INTEGRATION_CONTRACT.md`
- `docs/11_tasks/TASK-001-bootstrap-service.md`
- `docs/12_validation/VAL-TASK-001-bootstrap-service.md`
- `docs/17_governance/PROJECT_INVARIANTS.md`
- `docs/21_execution_plans/EP-TASK-001-bootstrap-service.md`
- `docs/22_goal_impact/GOAL-IMPACT-TASK-001.md`
- `docs/orchestrator/VALIDATION_DEBT.md`

## Files to modify
- repo-local root docs and state files that already exist

## Files that must not be modified
- `shared/config/ecosystem-repositories.json`
- the master rollout plan in the IPS repo

## Implementation steps
1. confirm the repo’s actual service, hub, or experimental boundary
2. run the scaffolder for the missing IPS adoption artifacts
3. rewrite required sections to match the repository reality and no placeholders
4. set the local capability review and state file fields
5. validate the repository with the central IPS profile checker

## Parallel execution
This is a single-repo onboarding task; no parallel service deployment work is included.

## Blockers
- project owner approval evidence must remain explicit and current
- if the repo is experimental or hub-only, the docs must be honest about that status

## Test plan
- run the IPS validator in planning phase
- ensure the repo passes all required-section and integration-review checks

## Validation plan
- `python3 intent-preservation-system/scripts/validate_adoption_profile.py --root growth --phase planning`

## Gate commands
- `python3 intent-preservation-system/scripts/validate_adoption_profile.py --root growth --phase planning`

## Documentation updates
- update the adopted repo docs and validation ledger to match actual project status

## Rollback plan
If validation fails, revert the repo-adoption files to the last clean commit and re-run the scaffolder after correcting only the root issue.

## Handoff
The repository is left with a valid onboarding profile and explicit next action notes in the state file.

## Completion checklist
- [x] repository scope is documented and truthful
- [x] required adoption artifacts are present
- [x] capability decisions are reviewable and concrete
- [x] validator passed in planning phase
- [x] traceability links exist across task, goal impact, execution plan, and validation docs
