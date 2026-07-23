-- 007_touchpoint_and_campaign.sql
-- Slice S6d. Implements C-006 §4.3 and §2.5 (F-007).
--
-- Two changes ship together because they answer one question between them: what did this
-- experiment cost, and what did this campaign cost. Neither is answerable today — the report
-- divides one experiment's spend by every lead in the workspace, and a spend figure covering two
-- campaigns cannot be split after the fact.

-- ---------------------------------------------------------------------------------------------
-- 1. attribution.touchpoint — the landing view, stored at last.
--
-- `touchpoint.observed.v1` has carried experimentId since C-005, but nothing ever kept it: the
-- envelope passed through ingest.event_buffer onto growth.events, where no queue was bound, and
-- the buffer deletes published rows after 30 days. The experiment a lead came from was therefore
-- knowable for one month and unknowable afterwards.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attribution.touchpoint (
  -- The envelope's eventId, not a minted one. A redelivery from the broker is then an INSERT that
  -- collides rather than a second row inflating a session's history.
  touchpoint_id      text        PRIMARY KEY,
  session_id         text        NOT NULL,
  workspace_id       text        NOT NULL,
  -- NOT NULL on purpose, and growth-web now refuses to boot without the environment variable that
  -- fills it. The landing used to default this to the literal string 'unknown', which is a
  -- measurement that looks like data — it joins, it counts, and it means nothing.
  experiment_id      text        NOT NULL,
  experiment_version text        NOT NULL,
  landing_version_id text        NOT NULL,
  utm_campaign       text,
  gclid              text,
  -- From consentEvidence.statusAtEventTime. A lead attributed through a session that refused
  -- consent is a fact the report has to be able to see rather than infer from an absence.
  consent_status     text        NOT NULL,
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);

-- Every read is "which experiment was this session looking at", newest first.
CREATE INDEX IF NOT EXISTS touchpoint_session_idx
  ON attribution.touchpoint (session_id, occurred_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 2. spend.manual_observation.campaign_id — the dimension v2 adds (C-006 §2.5).
--
-- Nullable AND non-blank, so there are two states rather than three: recorded against a campaign,
-- or not split at all. A blank string would be a third that renders identically to the second.
-- NULL means "the owner did not split this figure" — it never means "belongs to no campaign", and
-- unassigned spend stays in the experiment total.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE spend.manual_observation
  ADD COLUMN IF NOT EXISTS campaign_id text;

DO $$
BEGIN
  ALTER TABLE spend.manual_observation
    ADD CONSTRAINT manual_observation_campaign_non_blank
    CHECK (campaign_id IS NULL OR length(btrim(campaign_id)) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS manual_observation_campaign_idx
  ON spend.manual_observation (experiment_id, campaign_id);

-- ---------------------------------------------------------------------------------------------
-- 3. Grants. Migration 003's rule: every new table names the runtime role explicitly, because a
-- blanket default privilege is how an append-only table quietly acquires UPDATE and DELETE.
--
-- A touchpoint is an observation of something that already happened. There is no correction path
-- and nothing downstream may rewrite one, so the runtime role gets no UPDATE and no DELETE — the
-- same privilege-held guarantee decision_artefact and lead_qualification carry.
-- ---------------------------------------------------------------------------------------------
GRANT SELECT, INSERT ON attribution.touchpoint TO growth_core;
