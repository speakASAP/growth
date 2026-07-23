# TASKS.md — growth

Backlog. Slice-level planning lives in `docs/08_roadmap/DELIVERY_PLAN.md`.

## Open

- [x] **S6 deployed and verified in production, 2026-07-22.** Migration 006 applied (via the
      migrate init container, as the owner role); the leads Prisma migration applied (`prisma
      migrate status` → "Database schema is up to date", 7 migrations). All four S6 paths were
      exercised against real services — see "S6 production verification" below.

- [x] **S6b — the experiment report (F-006 §3), deployed and verified 2026-07-22.** Read API
      `GET /experiments/:id/report`, screen `GET /experiments/:id`, spend form
      `POST /experiments/:id/spend`, all on growth-core. C-006 §6.

- [x] **2026-07-22 — production test data REMOVED on owner instruction.** `growth_core` is empty:
      every table listed below returned 0 rows afterwards. The owner's reason for deleting rather
      than posting compensating negative observations: the platform is pre-launch, no real user has
      ever been admitted, so there is no history worth preserving and `exp-001` had to start clean.

      Deleted **by exact id**, never by pattern — the earlier warning stands and is why the
      610 accounts matching `%@example.invalid` (created 2026-06-28..2026-07-20) were left alone.
      They predate S6 and belong to other smoke tests.

      | Where | Rows |
      |---|---|
      | `growth_core` `qualification.lead` / `lead_qualification` | 1 / 3 |
      | `growth_core` `spend.manual_observation` | 3 — the 1750.5000 CZK that skewed `exp-001`, plus one later verification row |
      | `growth_core` `attribution.auth_redirect` / `registration` / `identity_link` | 1 / 1 / 1 |
      | `growth_core` `ingest.event_buffer` | 5 |
      | `growth_core` `governance.decision_artefact` | 3 — the `exp-verify-001` S1a fixtures |
      | `leads` `Lead` / `LeadQualification` / `LeadContactMethod` | 1 / 3 / 1 |
      | `auth` `users` | 1 — `s6verify-8a9e3056@example.invalid` |

      **The immutability guarantee was bypassed, deliberately and once.**
      `governance.decision_artefact` is protected by the trigger `decision_artefact_immutable`
      (BEFORE DELETE OR UPDATE), not merely by grants, so the delete required
      `ALTER TABLE ... DISABLE TRIGGER` inside the same transaction that re-enabled it. The other
      append-only tables are protected by grants alone and were reachable as `dbadmin`.

      The trigger was then **proven to bite again**: an INSERT + DELETE probe inside a rolled-back
      transaction still failed with `decision_artefact is append-only (attempted DELETE)`. A
      re-enable that was never tested would be indistinguishable from one that silently failed.

- [x] **The read model ignored `supersedes_qualification_id` — FIXED, and the fix is now proven.**
      `QualificationRepository.currentVerdicts()` picked a lead's current verdict with
      `ORDER BY decided_at DESC, received_at DESC LIMIT 1` and never looked at the supersession
      chain that C-006 §1.2 defines corrections in terms of. The field was written, indexed and
      never read.

      It now resolves the chain in SQL: a recursive walk per judgement, then prefer the judgement
      **nothing supersedes**, then the longest chain, then time, then id — depth-capped at 64 so a
      cycle still answers instead of hanging. Four `qualification.db-spec.ts` cases cover exactly the
      shapes below (a later judgement that supersedes nothing, a correction tied on `decided_at`,
      two chains of different length); the suite is **18 green** as of 2026-07-23.

      This entry stayed open one commit too long — the note was written after the code was already
      corrected, so the backlog claimed a defect the repository no longer had. Verified by running
      the specs, not by reading the note.

      While deliveries arrive in decision order the answer is right, which is why the 2026-07-22
      verification passed. It goes wrong when they do not: a redelivered or late correction, two
      judgements sharing a `decided_at`, or a judgement that supersedes nothing arriving after a
      correction chain — all surface a superseded judgement as current.

      Found by exactly that shape during verification: a third judgement with
      `supersedesQualificationId` absent became "current" over a correction that had superseded
      the first. Wrong verdicts feed `costPerQualifiedLead` directly, and the error is silent.

      Fix is either resolving the chain (the judgement nothing supersedes) or stating in C-006
      that latest-by-time is the definition and `supersedes` is audit-only. It should not stay
      ambiguous — the contract and the code currently say different things.

- [ ] **Publishing the experiment screen on a public hostname — DECIDED by the owner 2026-07-23
      (C-006 §6.8).** The screen is on growth-core, which has **no ingress**, and the owner reaches
      it with `kubectl -n statex-apps port-forward deploy/growth-core 3376:3376`. It was **not** put
      on growth-web: that is public on `bazos.alfares.cz/l` and has no authentication at all, so an
      owner-only screen showing spend and lead counts cannot go there.

      **The decision: it gets published only behind a real login through `auth-microservice`, as
      part of S6c, after S1b.** Basic auth from Vault was offered and refused — one shared password
      in front of spend figures and lead counts is not the same thing as an authenticated surface,
      and the difference stops mattering to nobody except the person whose numbers they are. Until
      then `port-forward` remains the access control. Nothing here is an implementer's call to
      revisit.

- [ ] **The report counts leads per WORKSPACE, not per experiment (C-006 §6.6).**
      `qualification.lead` has no `experiment_id`; spend has no `campaignId` (below). So the report
      divides the named experiment's spend by every lead in the workspace. Correct while one
      experiment runs per workspace, wrong the moment a second does. Same defect class as the
      missing campaign dimension, and it needs the same v2 decision.

### S6 production verification, 2026-07-22

What was proven, and how:

1. **Lead reaches `qualification.lead` off `growth.lead-created`** — driven end to end from the
   real landing, not injected: `bazos.alfares.cz/l/v1-cena` → `POST /l/consent` (204, `gsid` cookie
   scoped `Domain=bazos.alfares.cz`) → `POST /l/intent` (204) → `POST /ui/auth-redirect` (204) →
   `POST /auth/register` carrying the same `state` → `attribution.auth_redirect`,
   `attribution.registration` and `attribution.identity_link` joined on `payload.correlationId` →
   `qualification.lead`.
2. **Judgement from the admin panel** — `POST https://leads.alfares.cz/api/admin/leads/<id>/qualification`
   → 201 → row in `qualification.lead_qualification`. `decided_by_id` is the real auth user id, not
   the literal string `"owner"`, as C-006 §1.3 requires.
3. **A correction appends** — a second POST with `supersedesQualificationId` produced a **second**
   row with the first untouched. Then **falsified**: `UPDATE` and `DELETE` on that table as the
   runtime role were both refused with `permission denied for table lead_qualification`. The
   append-only guarantee is enforced by the database, not merely documented.
4. **`POST /spend/observations`** — 201, stored `1500.0000` exactly as `NUMERIC(20,4)`, `is_manual`
   true, and the `ingest.event_buffer` row reached status `published`, which on a confirm channel
   means the broker durably has it.

Also observed: all four growth queues had 1 consumer and 0 messages after the deploy, so the
S5-era `growth.lead-created` backlog warning resolved with nothing stranded.

S6b was verified on the same production data: the live report returned `costPerRegistration`
`"1500.00"` and `costPerQualifiedLead` `null` (0 qualified → renders `—`), the screen rendered, and
the spend form wrote a row and summed `1500.0000 + 250.5000` to exactly `1750.5000`.

- [ ] **Spend has no campaign dimension — owner decision needed.**
      `growth.spend.observed_manual.v1` carries `experimentId` but no `campaignId`, so spend is
      recorded per experiment per period only. That is enough while one campaign runs per
      experiment and wrong the moment a second one does. Adding `campaignId` is a **v2 schema**,
      not a quiet field addition. Flagged, not decided (C-006 §2.4).

- [ ] **`LeadQualification` in leads-microservice is append-only by convention only.** growth-core
      holds the real guarantee — the runtime role has no UPDATE or DELETE grant on
      `qualification.lead_qualification`, asserted in `qualification.db-spec.ts`. leads connects to
      its database as the owning role through Prisma, where a trigger is a comment with extra
      steps, so the leads-side table is upheld by there being no update path in the code. growth-core
      is the system of record for judgements; the leads table is the weaker copy.

- [ ] **No dead-letter queue on the qualification consumer either.** Same shape as the attribution
      gap below: unparseable messages are dropped with the body logged, failed writes requeue
      forever.

- [ ] **S1a VERIFY — five of six steps run and passed by the owner, 2026-07-23. Only step 3
      (the three-day read-back, ≈2026-07-26) remains.** This line stays open until then; the gate,
      and with it M1, closes on step 3, not before.

      Run against `exp-001/v1` through the pod. Observed:

      | Step | Expected | Got |
      |---|---|---|
      | 1 launch     | 201 | **201** — hypothesis in the owner's own words |
      | 2 edit       | 409 | **409** — same id, different content, refused; original intact |
      | 4 stop-bare  | 422 | **422** — blank `reason` fails `must match pattern "\S"` |
      | 5 budget     | 201 | **201** — chain 1000 → 1100, `supersedesArtefactId` → launch |
      | 6 stop       | 201 | **201** — reason recorded |
      | story        | —   | reads back launch → budget_change → stop as one story |

      Step 3 ("read it back three days later") cannot be scripted or hurried: come back to `story`
      after a few days and see whether it still explains *why* without your memory of the day
      filling the gaps. That is the whole feature — everything else is plumbing.

      **What `exp-001/v1` now holds.** This run wrote a *verification* chain into the real first
      experiment's id: a stop reason of "нужно проверить все объявления до запуска" and a launch
      whose text carries a stray line break (`\n  `) from a multi-line shell paste. Owner decision
      2026-07-23: **leave v1 as the verify record; the real first experiment launches under
      `EXPERIMENT_VERSION=v2`**, composed carefully (not via a multi-line shell arg). Append-only,
      so v1 stays as written — not touched again.

      **Incident during this run (resolved).** `edit` (step 2) was executed before `launch`
      (step 1). Because the launch id is deterministic, `edit` became the *first* write of that id
      and stored its sentinel "EDITED — this text must never appear" as the canonical launch
      artefact; the real launch then hit 409. Fixed by deleting that one row via the documented
      trigger-bypass (`ALTER TABLE ... DISABLE TRIGGER decision_artefact_immutable` inside the
      delete transaction, re-enabled in the same statement, exactly as 2026-07-22). Trigger
      re-verified enabled afterwards: `pg_trigger.tgenabled = 'O'`.

- [ ] **`s1a-verify.sh` can poison the real experiment's launch slot — fix before it is run again.**
      Two root causes surfaced above. (a) The script defaults to `EXPERIMENT_ID=exp-001`, the real
      first experiment — a verification run should default to a throwaway id (`exp-verify-*`, as the
      2026-07-22 run used) so the real experiment's append-only history is never spent on a test.
      (b) The `edit` probe will silently *create* the launch artefact if run before `launch`,
      writing its sentinel text as canonical — the probe steps must refuse to be the first write of
      an id (e.g. require the launch to already exist, or use a `If-Match`/precondition). Either
      fix alone prevents a repeat; do both.

- [x] **Money format — resolved in `s1a-verify.sh`, contract deliberately left permissive
      (2026-07-23).** The chain had mixed `"1100"` and `"1000.00"`. Decision: **C-001 is not
      changed.** The schema already accepts an integer (`^\d+(\.\d{1,4})?$`) and the server compares
      amounts equal via `normaliseDecimal` (`"1100"` == `"1100.00"`), so the money layer works with
      whole numbers end to end and these artefacts never leave the ecosystem in this form (no Google
      Ads dependency on the string shape). Requiring `.00` in the contract would reject convenient
      input for no correctness gain. Instead the script's new `money()` helper pads to 2dp for
      presentation only — a whole number gains `.00`, a short fraction is padded, a 3–4dp value is
      untouched — so a chain never *displays* mixed scales. Whole numbers stay convenient to type.

- [x] **Line breaks from a multi-line shell paste — fixed in `s1a-verify.sh` (2026-07-23).** The
      new `jstr()` helper folds every whitespace run (newlines included) to a single space and trims
      before JSON-encoding, so a pasted continuation (`\n  `) can no longer land inside an
      append-only artefact mid-sentence. Verified by dry-run. (The already-stored `exp-001/v1`
      launch keeps its stray break — append-only, and the owner chose to leave v1 as the verify
      record; the real launch under v2 will be clean.)

- [ ] **`s1a-verify.sh` still defaults to the real `exp-001` and its `edit` probe can create the
      launch — the poisoning root cause is NOT yet fixed.** Separate from the two fixes above.
      (a) A verification run should default to a throwaway id (`exp-verify-*`) so the real
      experiment's append-only history is never spent on a test. (b) The `edit` probe must refuse to
      be the first write of an id (require the launch to already exist, or a precondition) so it
      cannot store its sentinel text as the canonical launch. Either fix alone prevents a repeat.

- [ ] **No dead-letter queue on the attribution consumer.** A message that cannot be parsed is
      dropped with its raw body logged; a message whose join fails is requeued and will retry
      forever. Neither is wrong at this volume, but a real DLQ is the follow-up — the same gap
      `auth-microservice` has on the producing side.

- [ ] **`gsid_orphan` is not implemented.** C-005 §4 distinguishes a verified session growth-core
      *knows* from one it does not, and only the former should link. Touchpoints — the thing that
      makes a session known — arrive with W2. Until then the click record itself is taken as
      evidence the session existed, which is documented in `AttributionService`. When W2 lands,
      the orphan check belongs there.

- [ ] **`growth-core` does not consume `leads.events` yet.** W5 announces
      `growth.lead.created_from_registration.v1`, and the durable queue `growth.lead-created` is
      already bound so nothing is lost — but the lead is not yet joined to its touchpoint. That
      belongs with **S6**, where qualification anchors on the lead.

- [ ] **`leads-microservice`'s orders consumer has never run.**
      `LEADS_ORDERS_EVENTS_CONSUMER_ENABLED=true` in the configmap, but
      `LEADS_ORDERS_EVENTS_RABBITMQ_URL` is set nowhere, so the adapter logs that it is disabled
      and returns. Pre-existing and unrelated to W5, which uses its own variable and is
      unaffected — found while adding the auth consumer. Worth deciding whether it is wanted.

- [ ] **`gsid_orphan` — now implementable.** W2 produces touchpoints, so growth-core can finally
      tell a verified session it *knows* from one it does not (C-005 §4). Until this lands, the
      click record is still taken as evidence the session existed — documented in
      `AttributionService`.

- [ ] **Have a native Czech speaker read the landing copy before the budget starts.** The four
      variants are idiomatic and grammatical to the best of my ability, but I am not a native
      speaker and this goes in front of paid traffic under Alfares's name. One read-through is
      cheap; a clumsy phrase in an ad people are paying to see is not.

- [ ] **Decide what a registration is worth before the first experiment.** The landing sells a
      49 Kč/month subscription, so a registration that never subscribes costs money and returns
      nothing. The qualified-lead definition (S6) is where that gets settled, and the number
      matters more than the copy does.

- [ ] **Consent records live only in the visitor's browser.** `consentEvidence.consentRecordId` is
      minted client-side and referenced in every touchpoint, but nothing resolves it: C-005 §2.1
      calls it a *reference*, and there is no store behind it. Good enough to gate collection,
      **not** good enough as evidence in a dispute. A server-side consent record is the follow-up,
      and it belongs with the Czech consent baseline review (M0 #12).

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
      Blocks S9 (connector writes) **and S6c (the owner's cabinet)**. Adds the first authenticated
      surface; revisit the no-ingress decision then.

      **Its scope grew on 2026-07-23 and the reason matters.** Every reference to S1b in this
      repository calls it "the authenticated surface", but what F-001 actually specifies is grant
      machinery: `ApprovalGrant`, `approvedParametersHash`, `ExecutionAttempt`/`effectKey`, budget
      ceilings, reconciliation. Grants authorise an API **call**; none of that logs a **human** in.
      S6c waiting on S1b as written would have waited for something S1b never produced. The owner's
      browser login — `POST /auth/login` → session cookie → `POST /auth/validate` against
      `auth-microservice`, all of which already exists there — is now an explicit S1b deliverable.
      If the cabinet is wanted sooner, this is the piece to pull forward; the rest of S6c depends on
      nothing else that is missing.

- [ ] **S6c — the owner's cabinet (GUI), blocked by S1b.** Owner decision 2026-07-23: decisions get
      recorded from a browser instead of `scripts/s1a-verify.sh` — hypothesis, budget, reason for a
      budget change, reason for a stop, spend, report. Not a convenience: a decision record that
      costs a hand-assembled JSON in bash loses to two minutes in the Google Ads UI, and then
      `decision_artefact` is empty and nothing knows why the money went. Scope, findings and the two
      non-negotiable screen requirements (refusals rendered legibly; artefact preview before an
      append-only write) are in `docs/08_roadmap/DELIVERY_PLAN.md` §10. No new table, no migration —
      `DecisionService`, `SpendService` and `ExperimentReportService` already carry every write and
      every number. DOC (`F-007`) and CONTRACT (`C-007`) come first, per the gates.

      The owner rejected both faster routes on 2026-07-23 — Basic auth from Vault behind an ingress,
      and cabinet-on-port-forward — in favour of a real login. Consequence, stated rather than
      discovered later: S1b sits at **M3**, so the cabinet arrives at M3 and the CLI stays the way
      decisions are written until then.
- [ ] **S5 — `services/web/`** brings the first public surface. The ingress arrives with it and
      must route `growth.alfares.cz/` to `growth-web` only; `growth-core` stays off the public
      routing table. Pattern: `auth-microservice/k8s/ingress.yaml`.

## Done

- [x] **2026-07-22 — S6 DOC + CONTRACT + IMPL (not deployed, not verified in production).**
      Qualification and manual spend, across `growth-core` and `leads-microservice`. Tests:
      growth-core **243** (was 187), leads **174** (was 137); no baseline test was lost or changed
      in meaning. Build and `tsc --noEmit` clean on both. **Nothing was deployed** — see Open.

      **A contract defect and a documentation defect were found and fixed at source, not worked
      around.**

      - **F-006 described an endpoint that does not exist.** It stated that
        `leads.controller.ts` carried `PATCH /leads/:id → status` and that S6 was therefore only a
        matter of making an existing status change emit an event. There is no such route, and
        `Lead.status` is written in exactly two places (`'new'` at creation, `'confirmed'` on token
        confirmation) — never by an operator. Implemented as written, the slice would have hung a
        correct, tested qualification event off a transition nothing can trigger, and it would have
        emitted nothing forever. Qualification is a **new** surface; F-006 now says so, with the
        original claim quoted rather than deleted.
      - **`spend.observed_manual.v1.json` accepted a blank `evidenceReference`.** No `minLength`,
        so `""` validated. That field is the entire provenance of a hand-typed spend figure, and
        the repository rule is that blank free text is rejected rather than defaulted. Caught by a
        test written against the contract before the schema was read closely. `minLength: 1` added
        there and on `observationId`, `experimentId` and `enteredBy`.

      **Where the owner marks a lead — F-006's open question, resolved.** The "custom CRM in the
      client panel" is `leads-microservice`'s own admin panel, which already exists and is already
      authenticated (`public/admin.html` + `admin.js`, `AdminLeadsController`, `AdminAuthGuard`
      validating against auth-microservice, workspace-scoped). `GET /api/admin/leads` already
      returns `id` per lead, so nothing new was needed to address a lead. The marking surface is
      therefore two buttons and a reason box inside the lead detail that was already on screen —
      not a new UI, and `bazos-service` does not join the required owners.

      **`growth.lead.qualification_recorded.v1`** (new contract [C-006](docs/23_documentation_contracts/C-006-qualification-and-spend.md),
      new schema, producer `leads-microservice`, consumer `growth-core`). Three things are pinned
      as `const` in the schema rather than left as convention, because each one is a decision that
      must cost a contract change to reverse: `criteriaVersion: "v1-owner-manual"`,
      `decidedByType: "human"`, and the absence of `pending` from the status enum.

      - **`pending` is not a value anywhere.** It is the absence of a judgement — derived by an
        outer join, never stored. Emitting it would record a non-decision as a decision and would
        make "not worked yet" indistinguishable from "looked, and deferred". It is also
        load-bearing for the cost metric: pending leads stay in the numerator of cost-per-qualified,
        and a derived `pending` cannot drift from that rule because there is nothing to set.
      - **`decidedById` is the authenticated admin user id, never the string `"owner"`**, and it is
        read from the auth guard, never from the request body — a body-supplied decider would let
        anyone reaching the endpoint attribute a judgement to somebody else. That answers F-006's
        fourth open question: any principal `AdminAuthGuard` accepts may qualify, and the event
        records which one.
      - **A correction appends.** `POST /admin/leads/:id/qualification` (POST, not PATCH — it adds
        a judgement, it does not edit one) with `supersedesQualificationId`. Both judgements stay
        readable; the panel shows the superseded one rather than only the current verdict.

      **The append-only guarantee is held as a privilege, not a convention.** Migration `006` grants
      the runtime role `SELECT, INSERT` on `qualification.lead_qualification` and no `UPDATE` or
      `DELETE`, the same shape as `decision_artefact`. `qualification.db-spec.ts` asserts the
      boundary against the real database; falsified by granting UPDATE and DELETE back, which turns
      two specs red.

      **`qualification.lead_qualification` deliberately has no foreign key to `qualification.lead`.**
      Two queues drain at different rates, so a judgement can arrive before the lead it is about. A
      foreign key would nack it into a requeue spin against a row not yet written, and the
      judgement — the scarcer fact, the one a human produced — would be the thing lost. Joined by
      `lead_id` at read time; a judgement with no lead is visible and countable rather than gone.

      **`growth.lead-created` now has a consumer.** It has been bound and unconsumed since S5, so
      it may hold a backlog that drains the moment this ships. `QualificationConsumer` declares
      **and binds** both queues on boot rather than assuming they exist, for the usual reason: a
      topic exchange discards a message with no matching binding, and an unbound queue looks
      perfectly healthy while receiving nothing.

      **Manual spend** — `POST /spend/observations` on growth-core (ClusterIP only, unauthenticated
      like every other surface here; absence of a public route is the access control). Two choices
      worth recording:

      - The endpoint takes the **payload**, not an envelope, and growth-core mints the envelope
        itself. An accepted envelope would let the caller claim to be a different producer.
      - The minted envelope is validated with **the same `validateEnvelope` the ingest edge uses**,
        before anything is stored. growth-core producing an event it would itself reject on ingest
        is exactly the drift a shared validator exists to prevent. It then publishes **through the
        ingest buffer**, so a broker outage delays the observation instead of losing it — reusing
        the durability that already exists rather than opening a second, worse path.
      - **Re-submitting the same `observationId` with a different amount is a 409, not a silent
        no-op.** A plain `ON CONFLICT DO NOTHING` would swallow the dangerous case: the owner
        corrects a figure, reuses the id, gets a cheerful success, and the stored spend is still the
        old value — every cost metric downstream then quietly wrong. Amounts are compared as
        `NUMERIC` inside Postgres, so `15000.00` and `15000.0000` are the same money rather than a
        false conflict. Money is a decimal string from the request to the driver and back; it never
        passes through a JS number.

      Guards falsified to prove they bite, then restored: `pending` accepted as a status (turns the
      parser spec red), the lead-visibility scope check removed (write path would accept a lead the
      operator cannot see), the blank-reason refusal in the panel, the runtime UPDATE/DELETE grants,
      and the spend amount comparison forced true. The typecheck itself was falsified too — the
      repository warns that `npx tsc` can silently pass, so `./node_modules/.bin/tsc` was confirmed
      to actually report an injected type error.

- [x] **2026-07-22 — priced button: the experiment measures willingness to pay, and takes no money.**
      Owner decision: this run tests whether the service is wanted at all, so nothing is charged.
      The button says **`Objednat za 49 Kč měsíčně`**; clicking it records
      `growth.payment_intent.declared.v1` and reveals the launch offer — three months at no cost,
      decide afterwards. Verified live: consent → touchpoint, click → intent carrying
      `statedPrice 49.00 CZK` and the variant id.

      **No payment details are collected.** There is no `<form>` and no `<input>` on the page, held
      by a test. That is the line worth naming: measuring willingness to pay is an interest test;
      collecting card details behind a button that charges nothing would be a different thing
      entirely, and is not what this does.

      `zdarma` is gone from every selling line — leading with "free" would measure appetite for a
      free thing, which is a different question with a useless answer. The word survives only in
      the offer revealed *after* someone has said yes to 49 Kč, where it is true.

      `growth.payment_intent.declared.v1` is a **new contract event**, deliberately separate from
      the registration event: a registration that follows a free offer is no evidence at all about
      willingness to pay. The session comes from the HttpOnly cookie, verified — never from the
      page, which could otherwise declare intents against somebody else's visit.

      ⚠️ **Consumer-protection framing.** The offer is stated as a launch offer rather than as a
      prize or an apology for a payment that never happened, because it is one and because the
      measurement is complete by the time anyone reads it. Worth a look during the M0 #12 consent
      review, together with the terms page, since the button names a price the visitor will not be
      asked to pay.

- [x] **2026-07-22 — landing copy: four Czech A/B variants, live.**
      `/l/v1-cena`, `/l/v2-obnova`, `/l/v3-cas`, `/l/v4-pravidla` — each a different argument for
      the same product, so a result says *which reason worked*, not merely *which page won*:

      | Variant | Angle |
      |---|---|
      | `v1-cena` | Price anchor — 49 Kč/month, led by how little it costs |
      | `v2-obnova` | Expiry and renewal — an expired ad is invisible, and so is the loss |
      | `v3-cas` | Time — aimed at sellers already posting by hand |
      | `v4-pravidla` | Fear of a ban — for sellers near the limits |

      ⚠️ **The placeholder had been aimed at the wrong audience** — it sold second-hand furniture
      to buyers. `bazos-service` is a **seller's tool**: autoposting and renewing ads on Bazoš.cz,
      49 Kč/month (`GOAL-06`).

      Two claims are held by tests rather than by good intentions, because this page carries paid
      traffic under Alfares's name:

      - **Bypassing may only ever be mentioned in order to deny it.** `GOAL-06` and `BUSINESS.md`
        are explicit that the service works *within* Bazoš's verification, limits and intervals.
        The test accepts `neobchází` and `ne obejít`, and rejects the bare verb as a promise.
      - **`zdarma` may appear only where 49 Kč appears too.** Registration genuinely is free and
        the subscription genuinely is 49 Kč; the word alone beside a paid service reads differently
        to a consumer-protection authority than to a marketer. A companion test proves that rule
        can fail rather than passing by accident.

      An unknown variant id **404s** rather than falling back to a default — serving other copy
      under a recorded id would have the experiment comparing pages nobody saw. Verified live: all
      four render, an unknown id 404s, `bazos.alfares.cz/` still 200, and a consent grant on
      `v3-cas` produced a touchpoint carrying `landingVersionId: v3-cas`.

- [x] **2026-07-22 — W2: the experiment landing.** `growth-web` (`services/web`, port 3377) serves
      the landing at **`bazos.alfares.cz/l/:landingVersionId`** — that host, not one of its own.
      Verified in production: refusal → 204 with no `Set-Cookie` and nothing recorded; grant → 204
      with a `Domain=bazos.alfares.cz; Secure; SameSite=Lax; HttpOnly; Max-Age=7776000` cookie, and
      the touchpoint reached growth-core's buffer and was published with its `gclid`, `utm` and
      `consentEvidence` intact. `bazos.alfares.cz/` kept answering 200 throughout.

      **The host is the whole point.** The cookie must be readable by `bazos-service` when the
      visitor clicks through to registration, so it is scoped `Domain=bazos.alfares.cz`. Serving
      the landing on `growth.alfares.cz` — which the repo docs had assumed — would have left
      attribution permanently empty while every check reported healthy. That is D-005 repeating
      itself, caught before it was built (owner decision, 2026-07-22).

      The route is a **separate Ingress object** for the same host rather than a path added to
      `bazos-service`'s manifest, so two repositories never own one file. Traefik merges rules and
      `/l` is more specific than `/`. No `tls` block — the certificate is owned by the bazos
      ingress, and a second claim on it would have two objects fighting over one secret.

      Consent gates the **recording, not the content**: the page works fully after a refusal. The
      session is minted server-side only once a grant arrives, so a refusal leaves no cookie *and*
      no touchpoint — data collected without permission cannot be un-collected. Absent, malformed
      and necessary-only decisions are all refusals; necessary-only deliberately so, since
      counting it would let the strictly-necessary exemption launder a purpose the visitor declined.

      ⚠️ **The first deploy hung every consent request until the edge returned 524.** A bare
      `@Res()` makes the handler responsible for ending the response, and this one sets a header
      and returns. All 27 unit tests passed — they call the controller directly with a fake
      response and never touch the HTTP layer. `landing.e2e.spec.ts` now drives the real stack.

      ⚠️ **A spec named `*.e2e-spec.ts` is collected by nothing** — the jest `testRegex` wants a dot
      before `spec`, so it ran zero tests and reported success. Renamed to `*.e2e.spec.ts`.

      33 tests, including the delivery-plan §8 producer conformance check, which validates against
      the contract schema read from `docs/` rather than a copy.

- [x] **2026-07-22 — W1 consumer: the join works end to end in production.** `growth-core`
      consumes both halves, declares and binds its own queues on boot, and matches on
      `correlationId`. **Verified through the real services, not fixtures:** a click on
      `bazos-service` carrying a signed `gsid` cookie, then a registration through
      `auth-microservice` with the same `state`, produced one `attribution.identity_link` row with
      the right session, correlation and workspace. Test data removed afterwards.

      This closes the gap that had been widening since W4: `growth.events` had no consumer bound,
      so **clicks were being discarded outright** by the topic exchange while registrations piled
      up in a queue. The consumer now declares and binds both queues itself — a queue that exists
      but is unbound looks healthy and receives nothing.

      Design points worth not undoing:

      - **The join key is the payload's `correlationId`, never the envelope's.** The envelope
        carries a tracing id auth mints for *every* registration including direct signups; joining
        on it would match registrations to clicks at random.
      - **Only the verified session is stored, never the `gsid`.** It is a bearer token for an
        anonymous session, and keeping it would make a database leak replayable as attribution.
      - **A forgery costs the attribution, not the conversion** — the registration is still
        recorded, and `gsid_forged` is logged as a warning.
      - **Either arrival order, and a lone half is normal.** The two events travel different
        queues from different services, so nothing orders them; both are stored on arrival and
        each asks whether its partner is already there.
      - The forged counter is a query over the facts, not a column, so it cannot drift from them.

      ⚠️ Falsifying the `gsid_status = 'valid'` guard revealed it was **redundant with the
      `session_id IS NOT NULL` check and therefore untested** — the forgery test had been passing
      for the wrong reason. A hand-built row now pins it, so a change that stores a session before
      verifying it turns the suite red rather than turning every forgery into attribution.

      187 tests (was 152). Migration `005`, `GROWTH_GSID_HMAC_SECRET` wired into the ExternalSecret
      from `secret/prod/growth` — shared with growth-web, which will mint the tokens this verifies.

- [x] **2026-07-21 — W4: `bazos-service` records the click through to registration.**
      `POST /ui/auth-redirect` (unauthenticated, always 204) forwards
      `growth.auth_redirect.initiated.v1` to growth-core's ingest endpoint. Verified live both
      ways: with a `gsid` cookie the event reached `growth.events` carrying `gsid` +
      `gsidSource: cookie`; without one it arrived with `correlationId` alone — the contract's
      expected path, not a defect.

      **The join key is the `state` bazos already mints.** `createState()` produces a unique opaque
      handle per attempt for CSRF and auth round-trips it untouched, so a second handle would
      either fight that check or leave auth echoing a value growth never saw.

      Emitted at the click with `keepalive`, before navigation and not awaited: a visitor who
      registers and closes the tab has registered, and attribution must never add latency to
      someone signing up. `gsid` is read server-side from the request cookie, never sent by the
      page, so it stays off any URL, access log or `Referer` bound for auth.

      ⚠️ **`bazos-service` had no working test runner.** A `jest.config.js` and an orphaned spec
      existed but neither jest nor ts-jest was installed, so nothing in that service had ever been
      run. Installed; the orphaned spec passes and the suite went 17 → 43.

      ⚠️ **The client script lives inside a TypeScript template literal**, so nothing type checks
      or executes it. A backtick in a comment ended the string and broke the build hundreds of
      lines away. `ui-assets-attribution.spec.ts` now asserts the emission exists, precedes the
      navigation, sends no `gsid`, and contains no backtick.

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
