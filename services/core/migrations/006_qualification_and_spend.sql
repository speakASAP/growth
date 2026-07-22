-- 006_qualification_and_spend.sql
-- Slice S6. Implements C-006 §4.
--
-- Two unrelated things share one migration because they ship in one slice and neither is big
-- enough to justify its own: the lead a judgement attaches to, the judgement itself, and the ad
-- spend the owner types in by hand.

CREATE SCHEMA IF NOT EXISTS qualification;

-- The anchor. Produced by leads-microservice from a registration (C-005 §2.3) and consumed off
-- `growth.lead-created`, a queue that was declared and bound in S5 and had no consumer until now.
CREATE TABLE IF NOT EXISTS qualification.lead (
  lead_id        text        PRIMARY KEY,
  user_id        text        NOT NULL,
  -- Null when the registration did not come through a growth landing. Expected, not an error:
  -- this is the field that reaches back to the touchpoint, and a direct signup has no touchpoint.
  correlation_id text,
  workspace_id   text        NOT NULL,
  source_service text        NOT NULL,
  created_at     timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);

-- The path from a lead back to its click, and the one the attributed/unattributed split walks.
CREATE INDEX IF NOT EXISTS lead_correlation_idx
  ON qualification.lead (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- The judgement. Append-only: a correction is a new row that names the one it supersedes.
CREATE TABLE IF NOT EXISTS qualification.lead_qualification (
  qualification_id            text        PRIMARY KEY,
  -- Deliberately NO foreign key to qualification.lead (C-006 §3.1). Two queues drain at different
  -- rates, so a judgement can arrive before the lead it is about. A foreign key would nack it into
  -- a requeue spin against a row that has not been written yet, and the judgement — the scarcer
  -- fact, the one a human produced — would be the thing lost. Joined by lead_id at read time.
  lead_id                     text        NOT NULL,
  workspace_id                text        NOT NULL,
  -- Not a CHECK against a fixed list: the schema pins `v1-owner-manual` with a const, and a later
  -- criteria version is a new event version that this table must be able to hold alongside the old.
  criteria_version            text        NOT NULL,
  qualification_status        text        NOT NULL
                                CHECK (qualification_status IN ('qualified', 'disqualified')),
  -- `pending` is absent on purpose. It is the absence of a row, never a row.
  decided_by_type             text        NOT NULL,
  decided_by_id               text        NOT NULL,
  decided_at                  timestamptz NOT NULL,
  -- Blank free text is rejected, not defaulted: a defaulted reason looks complete and carries
  -- nothing. Whitespace-only counts as blank.
  reason                      text        NOT NULL
                                CHECK (length(btrim(reason)) > 0),
  supersedes_qualification_id text,
  received_at                 timestamptz NOT NULL DEFAULT now()
);

-- Every read is "the judgements for this lead, newest first".
CREATE INDEX IF NOT EXISTS lead_qualification_lead_idx
  ON qualification.lead_qualification (lead_id, decided_at DESC);

CREATE SCHEMA IF NOT EXISTS spend;

-- Owner-typed ad spend. No connector exists at MS-002 (C-005 §2.4).
CREATE TABLE IF NOT EXISTS spend.manual_observation (
  observation_id               text        PRIMARY KEY,
  experiment_id                text        NOT NULL,
  workspace_id                 text        NOT NULL,
  platform                     text        NOT NULL,
  period_start                 date        NOT NULL,
  period_end                   date        NOT NULL,
  -- NUMERIC, not double precision: exact decimal arithmetic. The event carries this as a decimal
  -- STRING and every API response casts it back to text — a currency amount that round-trips
  -- through an IEEE-754 double silently loses cents, and this is the number budget decisions
  -- divide by.
  amount_value                 numeric(20,4) NOT NULL,
  amount_currency              text        NOT NULL
                                 CHECK (amount_currency ~ '^[A-Z]{3}$'),
  evidence_reference           text        NOT NULL
                                 CHECK (length(btrim(evidence_reference)) > 0),
  entered_by                   text        NOT NULL,
  entered_at                   timestamptz NOT NULL,
  -- Enforced true, not defaulted true. Nothing downstream may ever present an owner-typed number
  -- as invoice-reconciled, and a CHECK is what stops a future writer setting it false.
  is_manual                    boolean     NOT NULL DEFAULT true
                                 CHECK (is_manual),
  -- Written by S8 when a connector observation supersedes this one. The manual row is never
  -- overwritten and never deleted — both stay visible. The column exists now so S8 does not have
  -- to migrate a table that by then holds production rows.
  superseded_by_observation_id text,
  recorded_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_observation_period_ordered CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS manual_observation_experiment_idx
  ON spend.manual_observation (experiment_id, period_start);

-- Migration 003's rule: every new table grants the runtime role explicitly. A blanket default
-- privilege would quietly hand UPDATE and DELETE to tables that must never have them.
GRANT USAGE ON SCHEMA qualification TO growth_core;
GRANT USAGE ON SCHEMA spend         TO growth_core;

-- A lead's facts come from an event that may legitimately be corrected upstream.
GRANT SELECT, INSERT, UPDATE ON qualification.lead TO growth_core;

-- No UPDATE and no DELETE. This is the append-only guarantee held as a privilege rather than as a
-- convention, the same way decision_artefact holds it: the runtime role owns nothing, so it cannot
-- grant itself the missing verb, and a correction has to become a new row naming what it supersedes.
GRANT SELECT, INSERT ON qualification.lead_qualification TO growth_core;

-- UPDATE is needed here for exactly one future writer: S8 setting superseded_by_observation_id.
GRANT SELECT, INSERT, UPDATE ON spend.manual_observation TO growth_core;
