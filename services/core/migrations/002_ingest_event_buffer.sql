-- 002_ingest_event_buffer.sql
-- Slice S5. Implements C-005 section 5 (growth/docs/23_documentation_contracts/C-005-landing-and-ingestion.md).
--
-- Durable landing zone for events arriving from the edge. The endpoint commits here and only then
-- returns 202; publishing to the broker happens afterwards, from a worker. That ordering is the
-- whole point of the slice — acknowledging before the write is exactly the loss it exists to
-- prevent, and a broker outage must degrade to "published late", never to "lost".

CREATE SCHEMA IF NOT EXISTS ingest;

CREATE TABLE IF NOT EXISTS ingest.event_buffer (
  event_id      uuid        PRIMARY KEY,
  workspace_id  text        NOT NULL,
  event_type    text        NOT NULL,
  event_version int         NOT NULL,
  payload       jsonb       NOT NULL,           -- full envelope, exactly as received
  received_at   timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','published','failed','dead')),
  attempts      int         NOT NULL DEFAULT 0,
  last_error    text,
  published_at  timestamptz
);

-- event_id is the primary key rather than a surrogate: idempotency then comes from the database
-- constraint instead of application logic. A duplicate delivery loses the INSERT outright, so
-- there is no read-then-write window for two concurrent retries to slip through.

-- Drain query touches only unprocessed rows. Partial, so the index does not grow with the
-- published backlog the retention job is still working through.
CREATE INDEX IF NOT EXISTS event_buffer_pending_idx
  ON ingest.event_buffer (received_at)
  WHERE status IN ('pending','failed');

-- Retention sweep.
CREATE INDEX IF NOT EXISTS event_buffer_published_idx
  ON ingest.event_buffer (published_at)
  WHERE status = 'published';
