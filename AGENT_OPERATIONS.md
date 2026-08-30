# Agent Operations: growth

This repository follows the company Cross-Agent Automation Standard and the IPS project adoption workflow.

## Roles
- Readiness scanner: classify repo status and blockers before implementation.
- Worker agent: complete one bounded change set and keep the work aligned with project documents.
- Worker monitor: track handoff facts and shared file conflicts.
- Integration validator: validate the final state and separate known debt from current-task regressions.

## Before work
- read the project runtime or hub status from the repo's docs before changing intent or validations
- confirm whether the repository owns a runtime service or is a hub/experimental repo
- keep the input contract and validation evidence honest rather than relying on generic placeholders

## Parallel work
- keep workstreams narrow and limited to one task or one bounded problem
- avoid parallel edits to the same project intent files without a single integration owner
- combine validation and documentation updates once the task is ready, then hand off clearly

## Validation debt
- record any known repo-wide or out-of-scope validation issues in the project validation debt ledger
- never treat an unowned validation failure as a success signal for the current task

## Handoff
- leave the repository in a state where the next worker can see the active task, blockers, and validation evidence clearly
- update `STATE.json` at handoff and deployment boundaries with current context and next steps

## Project-specific operations
- maintain the project's real runtime or hub scope in docs and adoption profiles
- prefer `not-applicable` decisions when the repo does not own the capability
- verify that all local bootstrap artifacts link back to the task, goal-impact, and validation doc chain
