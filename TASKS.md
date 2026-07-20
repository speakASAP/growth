# TASKS.md — growth-core

Backlog. Slice-level planning lives in `growth/docs/08_roadmap/DELIVERY_PLAN.md`.

## Open

- [ ] **S1a VERIFY** — owner manual check from F-001: launch an experiment, attempt an edit,
      raise the budget mid-run, stop without a reason, stop with one, read the story back.
- [ ] **First deploy** — not yet done. Requires `secret/prod/growth-core` DB_PASSWORD in Vault
      and the `growth_core` database to exist on the shared PostgreSQL.

- [ ] **Pin the init-container image to the build tag.** `deploy.config.sh` sets the image on the
      `app` container only, so the `migrate` init container keeps `:latest`. Both tags come from
      the same build, so a normal deploy is consistent — but a rollback to an older build tag would
      run new migrations against old application code. Needs a `deploy_post_manifests` hook.

## Later

- [ ] **S1b** — ApprovalGrant, approvedParametersHash, ExecutionAttempt/effectKey, budget ceilings.
      Blocks S9 (connector writes). Adds the first authenticated surface; revisit the
      no-ingress decision then.
