# TASKS.md — growth

Backlog. Slice-level planning lives in `docs/08_roadmap/DELIVERY_PLAN.md`.

## Open

- [ ] **S1a VERIFY** — owner manual check from F-001. **The only thing standing between S1a and
      done**, and it needs the owner, not an agent: steps 1, 5 and 6 are judgements about whether
      the record reads back as a decision in your own words.

      Run `./scripts/s1a-verify.sh` (add `DRY_RUN=1` first — `decision_artefact` is append-only,
      so a typo committed to production stays there):

      ```
      DRY_RUN=1 ./scripts/s1a-verify.sh launch "<hypothesis>" "<rationale>"
                ./scripts/s1a-verify.sh launch "<hypothesis>" "<rationale>"   # 1 → 201
                ./scripts/s1a-verify.sh edit                                  # 2 → 409 refused
                ./scripts/s1a-verify.sh budget "<reason>" 2500.00             # 5 → 201
                ./scripts/s1a-verify.sh stop-bare                             # 4 → 422 refused
                ./scripts/s1a-verify.sh stop "<reason>"                       # 6 → 201
                ./scripts/s1a-verify.sh story                                 # 3, 6 → read back
      ```

      Step 3 ("read it back three days later") is the one that cannot be scripted or hurried: come
      back to `story` after a few days and see whether it still explains *why*, without your memory
      of the day filling the gaps. That is the whole feature — everything else is plumbing.

- [ ] **`growth-core` does not consume `auth.events` yet.** W3 is emitting and the registrations
      are piling up in the durable queue `growth.auth-registrations` (bound to
      `auth.user.registered.v1`), so nothing is being lost — but nothing is joined either. This is
      the remaining half of W1: consume the queue, join to
      `growth.auth_redirect.initiated.v1` on `correlationId`, resolve the `workspaceId` growth
      owns, and build the `IdentityLink`. The queue has no consumer and grows unbounded; fine at
      first-experiment volume, worth watching.

- [ ] **S5 producers — W4, W2, W5.** Next in EP-005 merge order is **W4**. The auth half of the
      round trip is already done and verified live, so W4 is smaller than the plan implies: it only
      has to emit `growth.auth_redirect.initiated.v1` at click time carrying **the `state` value
      bazos already mints**.

      ⚠️ **`state` is already bazos's CSRF token** (`createState()` in `ui.assets.ts`, checked on
      callback). Reuse that value as the `correlationId` — do not mint a second one and do not add
      a second query parameter. Full note in [EP-005](docs/21_execution_plans/EP-005-landing-and-ingestion.md) §W4.

      `gsid` will be absent until W2 sets the cookie; that is the contract's expected path, not a
      defect. W5 (leads from registration) is unblocked now that W3 is flowing.

- [ ] **Vault `GROWTH_GSID_HMAC_SECRET` is stored but unused.** Generated 2026-07-21 at
      `secret/prod/growth` (32 random bytes) so W2 and W4 are not blocked on it. Nothing reads it
      yet: `gsid` signing arrives with the landing runtime. It is **not** yet wired into any
      ExternalSecret.

- [ ] **Consumers of `growth.events` are unbound.** A topic exchange discards a message with no
      matching binding. Nothing consumes growth's own events yet — the first consumer must declare
      its queue and binding before the producer it cares about goes live, or the events will look
      published and be gone. (`auth.events` is already covered by the queue above.)

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

- [x] **2026-07-21 — the `state` round trip is closed end to end.** The hosted auth page had
      `state` in scope for the token handoff but left it out of the register payload, so every
      password registration through the hosted flow would have arrived unattributable. One line in
      `web/public/index.html`, guarded by a test in `hosted-auth-web.spec.ts` — the symptom of this
      bug appears downstream as a join that never matches, so the search would have started in
      growth-core rather than in a form field.

      Verified live: `POST /auth/register` with `state` → `auth.user.registered.v1` carrying that
      value as both the envelope and payload `correlationId`.

- [x] **2026-07-21 — W3: `auth-microservice` emits `auth.user.registered.v1`.** The conversion
      signal the first experiment depends on now has a producer. Exchange `auth.events` (topic,
      durable), routing key = event type. Verified live: a registration returned 201 and the event
      arrived in `growth.auth-registrations` with the `correlationId` round-tripped from `state`.
      71 auth tests before, 92 after, none of the baseline lost — the changed paths had **no**
      coverage at all beforehand.

      Two contract defects surfaced and were decided by the owner:

      - **The schema required `workspaceId` while EP-005 W3 forbids growth concepts in auth** — the
        contract contradicted itself. `workspaceId` is growth's tenancy model; growth-core resolves
        it on consumption. Emitting a constant was rejected: a field that is always the same value
        reads as meaningful and is not.
      - **"On successful registration" was ambiguous.** auth creates a user row in five places and
        three of them prove nothing — `register-contact` is a contact form (`authenticated: false`),
        and `requestMagicLink` creates a row for whatever address was typed. The event fires on
        proven identity only. Measured registrations will be lower than the user-row count; MS-002
        states both.

      `verifyMagicLink` runs on every magic-link login, not only the first, so the event id is
      derived from the user id (uuidv5) and repeats collide with the buffer's primary key. That
      reuses the idempotency already in the contract instead of adding state, and avoids touching
      `isVerified`, which admin listings filter on.

      ⚠️ **No outbox in auth.** A failed publish is lost — logged with the complete envelope for
      manual replay, but not retried. The service has no migration runner, so the outbox table has
      nowhere to go until that is solved. RabbitMQ is a single-replica StatefulSet, so the loss
      window is real. Tracked in `auth-microservice/TASKS.md`.

      ⚠️ **Deploy trap, fixed:** `envsubst` in auth's `deploy.config.sh` uses an allow-list *and*
      reads the environment, so the `: "${VAR:=default}"` idiom used by neighbouring variables
      silently produced an empty `RABBITMQ_URL` — the surrounding defaults only work because `.env`
      already exported those names under `set -a`.

      A test user `w3-verify-*@example.invalid` remains in the `users` table from the live check.
      Not removed: `auth-microservice/CLAUDE.md` forbids agents writing to `users` directly.

- [x] **2026-07-20 — W6: the buffer drains to RabbitMQ.** `growth.events` (durable topic
      exchange, routing key = event type, the `catalog.events`/`orders.events` convention).
      Verified in production end to end: a queue bound to `growth.events`, an event posted to
      `POST /ingest/events`, and the envelope arrived in the queue byte for byte with routing key
      `growth.auth_redirect.initiated.v1`; both buffer rows reached `status=published`.

      The publisher uses a **confirm channel** and awaits `waitForConfirms()`. The drain marks a
      row published on `publish()` resolving and never looks at it again, so that signal must mean
      the broker durably holds the message — a plain channel returns once the bytes reach the
      socket, which would retire events a broker crash then loses.

      Two adjacent gaps closed, both of which had been reporting themselves as healthy:

      - **The retry backoff was never enforced.** `claimPending` had no time filter, so a failed
        row was re-claimed on the next tick; with the broker actually down, ten attempts burned in
        ten iterations and the event was `dead` within seconds — losing events during exactly the
        outage the buffer exists to survive, while the log described an orderly exponential
        retreat. Migration `004` adds `next_attempt_at`. `backoff-agreement.db-spec.ts` pins the
        SQL delay to `backoffSeconds()` at every attempt count so the logged wait and the enforced
        wait cannot drift.
      - **`RetentionService.sweep()` had no caller**, so C-005 §6 existed only on paper and the
        `dead`-row alert could never fire. `RetentionScheduler` runs it at 03:00 Europe/Prague,
        resolved via `Intl` — a fixed offset would have been an hour off for half the year, and a
        sweep at 02:00 looks exactly like one at 03:00.

      Schedulers use plain timers, not `@nestjs/schedule`: the drain wants "every few seconds",
      not a calendar expression, and `@Cron` depends on `reflect-metadata` emitting design-time
      types, which this ecosystem has already been bitten by on Node 22+.

      `ingest-module.db-spec.ts` builds the real Nest container, and earned itself immediately —
      it caught `RabbitMqEventPublisher`'s test seam being treated as an injectable dependency,
      which would otherwise have surfaced as a crash-looping pod after deploy.

      ⚠️ **`npm test` was not equivalent to `npm run test:db`.** The db-specs share one database
      and `TRUNCATE` between tests, but plain `jest` ran suites in parallel, so the two commands
      could disagree about whether the code worked. Jest now runs with `maxWorkers: 1`.

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
