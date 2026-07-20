# TASKS.md — growth

Backlog. Slice-level planning lives in `docs/08_roadmap/DELIVERY_PLAN.md`.

## Open

- [ ] **S1a VERIFY** — owner manual check from F-001: launch an experiment, attempt an edit,
      raise the budget mid-run, stop without a reason, stop with one, read the story back.
      **No longer blocked** — `growth-core` is deployed and healthy. This is the only thing
      standing between S1a and done, and it needs the owner, not an agent.

      `growth-core` is ClusterIP-only, so the checks run from inside the cluster:
      `kubectl -n statex-apps exec deploy/growth-core -c app -- node -e "..."` against
      `localhost:3376`, or a `kubectl port-forward svc/growth-core 3376:3376`.
      Note `POST /ingest/events` takes a bare JSON **array** of envelopes (or one envelope
      object), not a `{"events": [...]}` wrapper.

- [ ] **W6 — bind `PublisherWorker` to RabbitMQ.** Events reach the buffer in production and stay
      there: the worker is deliberately not registered in `IngestModule` because it needs an
      `EventPublisher`. Nothing is lost, but nothing is published either, so S5 is not end-to-end
      until this lands.

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

- [x] **2026-07-20 — first deploy, and the database role split that had to precede it.**
      `growth-core` runs in `statex-apps`, ClusterIP only, `/health` ok, migrations 001–003
      applied. `POST /ingest/events` verified against production: 202 on first delivery, 200 on
      replay of the same `eventId`.

      The security item above is closed. `growth_core_owner` owns the schema and is used only by
      the migrate init container (`DB_OWNER_PASSWORD`, a second Vault key and ExternalSecret
      entry); `growth_core` is the runtime role, holds DML grants only, and owns nothing. Verified
      on the live database: it is refused `DISABLE TRIGGER` (*must be owner*) and `UPDATE`
      (*permission denied*) on `decision_artefact`, while `SELECT`/`INSERT` and full DML on
      `ingest.event_buffer` still work.

      Grants are written per table in `003_runtime_grants.sql` rather than through
      `ALTER DEFAULT PRIVILEGES`: a blanket `GRANT ALL` would quietly hand `UPDATE`/`DELETE` to
      every future append-only table, whereas a forgotten grant fails loudly on first use.
      **Every migration that creates a table must add its own grant.**

      `src/db/role-privileges.db-spec.ts` asserts the boundary (110 tests, was 100). Falsified by
      handing ownership back to `growth_core`: five specs turn red. Its destructive statements run
      inside a rolled-back transaction — the first version of the spec `DROP TABLE`d the table it
      was checking, in exactly the regression it exists to catch.

      ⚠️ Changing a table's owner **drops** grants held by the incoming owner, and moving ownership
      back does not restore them. Re-run the grants after any ownership change.

- [x] **2026-07-20 — S5 IMPL, receiving side in `growth-core`.** `POST /ingest/events`
      (202 committed / 200 duplicate / 400 schema / 413 batch>50 / 503 buffer unwritable),
      `ingest.event_buffer` (migration `002`), envelope validation dispatched on `eventType`
      against the contract schemas, `PublisherWorker.drain()` with `FOR UPDATE SKIP LOCKED`,
      retry backoff `min(2^attempts,300)`, dead-lettering at 10 attempts, and the retention
      sweep. **100 tests pass** (was 63); build and `tsc --noEmit` clean.

      `sync-schema.js` now syncs all six contract schemas, not just the S1a artefact;
      `src/ingest/schemas/` added to `.gitignore` on the same generated-not-authored rule.

      Two guards were falsified to prove they bite, then restored: weakening
      `user.registered.v1.json` to `additionalProperties: true` turns the EP-005 W3 genericity
      test red, and removing `SKIP LOCKED` turns the two-worker claim test red.

      **`PublisherWorker` is deliberately not registered in `IngestModule`** — it needs an
      `EventPublisher` and the RabbitMQ binding is W6. A null publisher would drop events
      silently and a missing one would crash the pod on boot; the buffer simply holding events
      until there is somewhere to drain to is the correct interim state. Wire it in W6.

- [x] **2026-07-20 — S5 contract corrected: cross-host `gsid`, two-event join.** The contract's
      session-propagation design rested on a false premise — that landing and registration are
      same-origin. They are not: `bazos-service` has no registration backend and redirects to
      `auth.alfares.cz` (`ui.assets.ts:1665,1764`), a sibling host, so a cookie scoped
      `Domain=bazos.alfares.cz` never arrives. Attribution would have been empty for **every**
      registration while the contract described that exact state as the normal path
      (C-005 §4: "`gsid` absent → expected path, not an error"), so the failure would have
      reported itself as healthy and fed zeros into budget decisions.

      Recorded in [D-005](docs/07_decisions/D-005-gsid-propagation-correction.md), which supersedes
      D-003 Q2. Owner chose the **correlation-id join** over putting `gsid` in the auth event,
      which preserves EP-005 W3's non-negotiable constraint that `auth-microservice` — shared
      ecosystem infrastructure — emit a generic, reusable event: `bazos` emits
      `growth.auth_redirect.initiated.v1 {gsid, correlationId}` at click time (not on the callback,
      which is not guaranteed), `auth` emits `auth.user.registered.v1 {userId, correlationId}`,
      `growth-core` joins on `correlationId`. `gsid` never crosses to `auth.alfares.cz`.

      Updated: C-005 §2.2/§2.3/§4/§7, F-005 §3 + open questions, D-003 Q1–Q2 marked superseded at
      source, EP-005 W3/W4, DELIVERY_PLAN S5 owners. Schemas: `registration.completed.v1.json`
      deleted (it named a `registrationId` no service ever minted), replaced by
      `auth_redirect.initiated.v1.json` + `user.registered.v1.json`;
      `lead.created_from_registration.v1.json` moved to `userId`. All schemas parse; all 78
      relative doc links resolve. **Not yet committed.**

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
