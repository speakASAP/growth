# AGENTS.md

## Required reading
- `intent-preservation-system/docs/24_onboarding/PROJECT_ADOPTION_STANDARD.md`
- `intent-preservation-system/docs/24_onboarding/PROJECT_DOCUMENT_SET.md`
- `intent-preservation-system/scripts/validate_adoption_profile.py`
- this repository's `SYSTEM.md`, `BUSINESS.md`, `TASKS.md`, and `STATE.json`

## Authority
This repository is operated under the shared Alfares control model. Agents may execute within the approved project scope, but they must not invent runtime contracts, user claims, or approval evidence.

## Intent preservation system
The Intent Preservation System lives in the central `intent-preservation-system` repository. This repo keeps project-specific intent in its local documentation, while central standards remain the source of truth for reusable templates and validators.

## Safety and operations
- do not fabricate ecosystem dependencies or service routes
- do not overwrite human-authored business or constitutional intent without explicit approval
- preserve traceability from goals to tasks to validation evidence
- prefer truthful `not-applicable` capability decisions over invented runtime dependencies

## Project-specific rules
- growth must remain honest about whether it is a runtime service, a hub, or an experimental repo.
- do not mark a capability as required unless the repository truly needs it in its project scope.
- when the repo has no runtime service, document the lack of runtime and set most capabilities to `not-applicable` with a concrete reason.

## Required final report
The final response must include: role performed, files changed, documents created, validation commands and results, validation debt created or used, active blockers, deviations from scope, and a final `Next step:` line.
