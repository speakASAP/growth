-- 005_attribution_join.sql
-- Slice S5 / W1 (consumer half). Implements C-005 §2.2 — the two-event join.
--
-- `bazos-service` records the click (2.2a) and `auth-microservice` records the registration that
-- may follow (2.2b). Neither knows about the other; they meet here, on `correlationId`.
--
-- The two halves may arrive in EITHER ORDER, and a half may never get its partner — a visitor who
-- clicked and abandoned registration, or one who registered without ever passing a landing page.
-- Both are normal. That is why each half is stored on arrival rather than one waiting in memory
-- for the other: a pod restart between them must not lose the join.

CREATE SCHEMA IF NOT EXISTS attribution;

-- 2.2a — the click through to auth.
CREATE TABLE IF NOT EXISTS attribution.auth_redirect (
  correlation_id text        PRIMARY KEY,
  workspace_id   text        NOT NULL,
  -- Only ever set from a gsid whose signature verified. An unverified session id is not evidence
  -- of anything, and storing it would let a forgery become attribution one refactor later.
  session_id     text,
  gsid_status    text        NOT NULL
                   CHECK (gsid_status IN ('valid', 'forged', 'absent')),
  initiated_at   timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);

-- The raw gsid is deliberately NOT stored. It is a bearer token for an anonymous session; keeping
-- the verified session id instead means a database leak cannot be replayed as valid attribution.

-- The forged counter C-005 §4 requires is this query, not a column that could drift from it:
--   SELECT count(*) FROM attribution.auth_redirect WHERE gsid_status = 'forged';
CREATE INDEX IF NOT EXISTS auth_redirect_forged_idx
  ON attribution.auth_redirect (received_at)
  WHERE gsid_status = 'forged';

-- 2.2b — the registration.
CREATE TABLE IF NOT EXISTS attribution.registration (
  user_id             text        PRIMARY KEY,
  -- Absent for anyone who did not arrive through a landing page. Expected, not an error.
  correlation_id      text,
  registration_method text        NOT NULL,
  application_context text,
  registered_at       timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_correlation_idx
  ON attribution.registration (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- The join result: this user was this anonymous session.
CREATE TABLE IF NOT EXISTS attribution.identity_link (
  user_id        text        PRIMARY KEY,
  session_id     text        NOT NULL,
  correlation_id text        NOT NULL,
  workspace_id   text        NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now()
);

-- Touchpoints attach by session, so this is the direction the read model will travel.
CREATE INDEX IF NOT EXISTS identity_link_session_idx
  ON attribution.identity_link (session_id);

-- Migration 003's rule: every new table grants the runtime role explicitly. A blanket default
-- privilege would quietly hand UPDATE and DELETE to tables that should never have them.
GRANT USAGE ON SCHEMA attribution TO growth_core;
GRANT SELECT, INSERT, UPDATE ON attribution.auth_redirect TO growth_core;
GRANT SELECT, INSERT, UPDATE ON attribution.registration  TO growth_core;
-- No UPDATE on the link: a person was or was not that session. A correction is a new fact
-- elsewhere, not a rewrite of this one.
GRANT SELECT, INSERT ON attribution.identity_link TO growth_core;
