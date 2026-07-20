-- 001_decision_artefact.sql
-- Slice S1a. Implements C-001 section 6 (growth/docs/23_documentation_contracts/C-001-decision-record.md).
--
-- Append-only store of why an experiment was launched, stopped, or had its budget changed.
-- Immutability is enforced here rather than in the application: an ORM guarantee disappears the
-- moment a migration, a psql session, or the next service reaches this table.

CREATE SCHEMA IF NOT EXISTS governance;

CREATE TABLE IF NOT EXISTS governance.decision_artefact (
  decision_artefact_id uuid        PRIMARY KEY,
  workspace_id         text        NOT NULL,
  experiment_id        text        NOT NULL,
  experiment_version   text        NOT NULL,
  decision_type        text        NOT NULL
                         CHECK (decision_type IN
                           ('experiment.launch','experiment.stop','experiment.budget_change')),
  artefact_version     int         NOT NULL,
  body                 jsonb       NOT NULL,   -- full artefact, canonical_hash included
  canonical_hash       char(64)    NOT NULL,
  decided_by_id        text        NOT NULL,
  decided_at           timestamptz NOT NULL,
  supersedes_id        uuid        REFERENCES governance.decision_artefact(decision_artefact_id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- the read query behind GET /governance/decisions
CREATE INDEX IF NOT EXISTS decision_artefact_experiment_idx
  ON governance.decision_artefact (experiment_id, experiment_version, decided_at);

-- one launch per experiment version (rule V5). A genuinely new launch means a new version.
CREATE UNIQUE INDEX IF NOT EXISTS decision_artefact_one_launch_idx
  ON governance.decision_artefact (experiment_id, experiment_version)
  WHERE decision_type = 'experiment.launch';

-- a given cap is superseded at most once: no forked budget history (rules V6/V7).
-- Enforced as a constraint, not an application check, so two concurrent writers cannot both win.
CREATE UNIQUE INDEX IF NOT EXISTS decision_artefact_supersedes_idx
  ON governance.decision_artefact (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

-- Immutability: corrections create a new artefact, never an edit.
-- The record of a mistake is itself part of the audit trail.
CREATE OR REPLACE FUNCTION governance.reject_artefact_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'decision_artefact is append-only (attempted %)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS decision_artefact_immutable ON governance.decision_artefact;
CREATE TRIGGER decision_artefact_immutable
  BEFORE UPDATE OR DELETE ON governance.decision_artefact
  FOR EACH ROW EXECUTE FUNCTION governance.reject_artefact_mutation();
