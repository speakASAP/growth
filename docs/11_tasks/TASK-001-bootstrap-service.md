# TASK-001-bootstrap-service

completeness_level: complete

status: validated

## Objective
Create and validate the initial IPS onboarding profile for growth so the repository has truthful adoption artifacts, required governance documentation, and a valid capability review.

## Upstream links
- `../22_goal_impact/GOAL-IMPACT-TASK-001.md`
- `../21_execution_plans/EP-TASK-001-bootstrap-service.md`
- `../12_validation/VAL-TASK-001-bootstrap-service.md`

## Goal impact
The repository gains an explicit project boundary and truthful onboarding contract without inventing runtime behaviour or ecosystem dependencies.

## Project invariant impact
The project remains aligned with the overarching invariant that repository scope must be honest, reviewable, and traceable.

## Sensitive-data classification
No secret values or production credentials are introduced as part of the onboarding documentation. The profile is written to describe repo scope and operational boundaries without exposing secret material.

## Contract and schema impact
The adoption profile updates the local project contract and the shared IPS validation schema only at the repository adoption boundary. No runtime service contract is invented as part of the task.

## Replay and determinism impact
The bootstrap task is deterministic and repository-local: it creates or aligns the adoption profile with the actual project state and governance artifacts.

## Scope
- align adoption docs to the real lifecycle and runtime boundaries of growth
- create/minimize required IPS artifacts and local validation evidence
- ensure the repository meets the onboarding validator requirements at the planning phase

## Non-goals
- production rollout or deployment activity
- editing the shared IPS standard or rollout plan document
- inventing runtime or service dependencies not present in the repo reality

## Acceptance criteria
- all required sections exist in each required artifact
- no placeholder or fabricated evidence remains in the profile
- the validator exits successfully for `--phase planning`
- the project has a concrete, truthful adoption profile and repository state record

## Required context
- existing repository docs and code for actual service or hub scope
- central IPS adoption standard and validation rules

## Validation task
Run the repository-local validator and verify the profile is valid before committing the repository change.

## Required gates
- `python3 intent-preservation-system/scripts/validate_adoption_profile.py --root growth --phase planning`

## Parallel workstream context
This task touches only the repository adoption profile and governance docs. No runtime deploy work is included.
