# TASKS.md — growth

Backlog. Slice-level planning lives in `docs/08_roadmap/DELIVERY_PLAN.md`.

## Open

- [ ] **S1a VERIFY** — owner manual check from F-001: launch an experiment, attempt an edit,
      raise the budget mid-run, stop without a reason, stop with one, read the story back.
      Blocked on the first deploy.
- [ ] **First deploy** — not yet done. Prerequisites are now all in place (database, Vault
      secret, remote); nothing external is blocking it.

- [ ] **Pin the migrate init container to the build tag.** The shared runner's `kubectl set image`
      targets the `app` container only, so the `migrate` init container keeps `:latest`. Both tags
      come from the same build, so a normal deploy is consistent — but a rollback to an older build
      tag would run new migrations against old application code. Needs a `deploy_post_manifests`
      hook in `deploy.config.sh` (stub is already there, commented).

## Later

- [ ] **S1b** — ApprovalGrant, approvedParametersHash, ExecutionAttempt/effectKey, budget ceilings.
      Blocks S9 (connector writes). Adds the first authenticated surface; revisit the
      no-ingress decision then.
- [ ] **S5 — `services/web/`** brings the first public surface. The ingress arrives with it and
      must route `growth.alfares.cz/` to `growth-web` only; `growth-core` stays off the public
      routing table. Pattern: `auth-microservice/k8s/ingress.yaml`.

## Done

- [x] **2026-07-20 — database, secret and remote provisioned.** Database `growth_core` on the
      in-cluster PostgreSQL, owned by a dedicated `growth_core` role (`NOSUPERUSER NOCREATEDB
      NOCREATEROLE`) rather than the shared `dbadmin` superuser — see SYSTEM.md for why the
      trigger-based immutability guarantee makes that deviation necessary. `DB_PASSWORD` in
      `secret/prod/growth-core`. Fixed `DB_HOST`, which the scaffold template had left as the
      old host IP `192.168.88.53` instead of the in-cluster `db-server-postgres`.

- [x] **2026-07-20 — folded `growth-core` back into this repository** as `services/core/`, one repo
      with several containers (auth-microservice pattern). The split had put the C-001 contract and
      the code enforcing it in different repositories, with nothing but a one-off `diff` keeping the
      JSON schema in step. The schema is now generated from the contract at build time and
      gitignored, so the two cannot diverge. The separate `growth-core` repo had no commits, which
      is why the move cost nothing.
