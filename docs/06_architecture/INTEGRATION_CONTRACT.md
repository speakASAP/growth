# Integration Contract

## Purpose
This document records the repository-specific integration decisions for growth and keeps the project within the actual runtime and governance scope it owns.

## Capability decisions
- auth: required — The project requires identity validation before service operations are accepted.
- postgres: required — The project persists state in the ecosystem PostgreSQL service.
- redis: not-applicable — No Redis coordination dependency is required for this repository.
- logging: required — Structured logging is required for runtime governance.
- notifications: required — Operational and user notifications are part of the project flow.
- ai: required — AI reasoning is part of the project workflow.
- payments: not-applicable — Payment processing is intentionally out of scope.
- catalog: not-applicable — Catalog ownership is outside the repository responsibility.
- orders: not-applicable — Order-processing integration is not part of the project boundary.
- warehouse: not-applicable — Inventory management is not part of the repository scope.
- invoices: not-applicable — The repo does not own invoice generation or billing flows.
- object-storage: not-applicable — No object-storage relationship is required by this project.
- event-bus: not-applicable — No event-bus contract is part of this repository scope.
- docs-rag: required — The repository is discoverable and traceable through the docs-RAG platform.
- monitoring: required — Runtime health and rollout signals are part of the repo ownership model.
- backups: not-applicable — No dedicated backup contract is required for this repo.

## Data ownership
The repository owns the project-local intent and validation evidence it maintains. It does not claim ownership of unrelated platform data or service-level state unless that boundary is explicitly implemented and documented.

## Authentication and authorization
The project follows the ecosystem identity model when it owns a live runtime service. If it does not own a runtime boundary, it must document that the repository is a hub, tooling repo, or experimental project and not fabricate an identity layer.

## Synchronous dependencies
- central IPS repository for validator and template guidance
- shared ecosystem services only when the project genuinely owns the dependency

## Asynchronous dependencies
- event bus when the project genuinely emits or consumes shared messages
- documentation and validation records when the repository depends on the shared governance model

## Degraded operation
If a required dependency is unavailable, the repository must fail safely and surface the real operational condition in logs, validation records, or state rather than asserting false success.

## Validation
Validation checks are executed through the central IPS validator and must remain truthful to the project boundary.
