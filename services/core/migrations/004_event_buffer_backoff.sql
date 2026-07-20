-- 004_event_buffer_backoff.sql
-- Slice S5 / W6. Makes the C-005 §5 retry backoff real.
--
-- The backoff was computed and logged but never enforced: the drain claimed any row with
-- status IN ('pending','failed'), so a failed event was picked up again on the very next loop.
-- With the broker actually down, ten attempts burned in ten consecutive iterations and the event
-- reached `dead` within seconds — the buffer losing events during exactly the outage it exists to
-- survive, while the logs described an orderly exponential retreat.
--
-- NULL means "claimable now", which is what a freshly received event should be. Only a failure
-- sets a time.

ALTER TABLE ingest.event_buffer
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

-- The drain filters on this alongside status, so it belongs in the partial index the drain uses.
DROP INDEX IF EXISTS ingest.event_buffer_pending_idx;
CREATE INDEX IF NOT EXISTS event_buffer_pending_idx
  ON ingest.event_buffer (next_attempt_at NULLS FIRST, received_at)
  WHERE status IN ('pending', 'failed');

GRANT SELECT, INSERT, UPDATE, DELETE ON ingest.event_buffer TO growth_core;
