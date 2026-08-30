# growth

## Status
Status: active
Lifecycle: implementation
Repository focus: AI growth experimentation platform for measuring paid-acquisition experiments with human approval and governance.

## Documentation authority
This repository keeps its project intent and onboarding profile in the repo itself and follows the shared Alfares IPS standard in `intent-preservation-system` for cross-repository traceability.

## Capabilities
- auth: required — The service enforces access boundaries before work is accepted.
- postgres: required — The repository persists service state in the shared PostgreSQL platform.
- redis: not-applicable — No Redis runtime dependency is required for this repository.
- logging: required — Structured operation logs are emitted to the shared logging microservice.
- notifications: required — Operator alerts and user notifications are part of the supported workflow.
- ai: required — The project depends on the shared AI microservice for reasoning and automation support.
- payments: not-applicable — Payment processing is intentionally out of scope.
- catalog: not-applicable — Catalog ownership is not part of the repository responsibility.
- orders: not-applicable — No order-processing boundary is required here.
- warehouse: not-applicable — No warehouse responsibility is part of the repository.
- invoices: not-applicable — No invoice domain is owned by this project.
- object-storage: not-applicable — This repository intentionally does not own object storage.
- event-bus: not-applicable — No RabbitMQ event-streaming contract is owned in this repository scope.
- docs-rag: required — The repository must remain discoverable through the shared docs-RAG indexing pipeline.
- monitoring: required — The service exposes health and readiness evidence through the monitoring platform.
- backups: not-applicable — No backup regime is required for this repository.

## Interfaces
- Repository: https://github.com/speakASAP/growth
- Standard: https://github.com/speakASAP/intent-preservation-system
- Primary operator boundary: AI growth experimentation platform for measuring paid-acquisition experiments with human approval and governance.
- Runtime health contract: GET /health when a live service is present.

## Development
- Source of truth lives in repository-local docs and implementation files.
- Changes to runtime behaviour should be traced to the corresponding project documents before implementation.
- Validation runs from the repo root with the central IPS validator.

## Configuration
- Project-specific configuration is stored in the repository and environment files when live runtime configuration is required.
- Secrets remain outside the repository and are injected via the platform secret flow.

## Deployment
- This repository follows the Alfares deployment and validation conventions for the owning service or hub.
- Deploys are gated by the platform deployment flow and the central IPS validation workflow.

## Health and observability
- Structured logs are emitted when the repository owns a runtime flow.
- Health and readiness checks must remain truthful and project-specific rather than invented by automation.
- Operational evidence is captured in the repository validation records and state files.
