import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { BufferedEvent, GrowthEventEnvelope, IngestOutcome } from './envelope.types';
import { PG_UNIQUE_VIOLATION } from '../governance/decision.repository';

/** C-005 §5 — worker drain size, give-up threshold, and the ceiling on the retry backoff. */
export const DRAIN_BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 10;
export const MAX_BACKOFF_SECONDS = 300;

@Injectable()
export class IngestRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Commits one envelope to the buffer. Returns `duplicate` when the eventId is already present.
   *
   * Idempotency comes from the primary key, not from a preceding SELECT: two concurrent retries
   * of the same event would both pass a read-then-write check and both insert. Letting the
   * constraint decide removes that window entirely.
   */
  async insert(envelope: GrowthEventEnvelope): Promise<IngestOutcome> {
    try {
      await this.db.query(
        `INSERT INTO ingest.event_buffer
           (event_id, workspace_id, event_type, event_version, payload)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          envelope.eventId,
          envelope.workspaceId,
          envelope.eventType,
          envelope.eventVersion,
          JSON.stringify(envelope),
        ],
      );
      return 'accepted';
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) return 'duplicate';
      throw err;
    }
  }

  /**
   * Claims up to DRAIN_BATCH_SIZE unpublished rows for this worker.
   *
   * FOR UPDATE SKIP LOCKED is what allows more than one worker without double publishing: a row
   * another worker already holds is stepped over rather than waited on, so workers scale out
   * instead of serialising behind each other.
   *
   * Must be called inside a transaction — the locks live until it ends.
   */
  async claimPending(client: QueryRunner): Promise<BufferedEvent[]> {
    const { rows } = await client.query<BufferRow>(
      `SELECT event_id, workspace_id, event_type, event_version, payload, status, attempts
         FROM ingest.event_buffer
        WHERE status IN ('pending','failed')
          AND attempts < $1
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY received_at
          FOR UPDATE SKIP LOCKED
        LIMIT $2`,
      [MAX_ATTEMPTS, DRAIN_BATCH_SIZE],
    );
    return rows.map(toBufferedEvent);
  }

  async markPublished(client: QueryRunner, eventId: string): Promise<void> {
    await client.query(
      `UPDATE ingest.event_buffer
          SET status = 'published', published_at = now(), last_error = NULL
        WHERE event_id = $1`,
      [eventId],
    );
  }

  /**
   * Records a failed publish. The row goes to `dead` on the attempt that reaches MAX_ATTEMPTS
   * so it stops being claimed; `dead` rows are never deleted automatically (C-005 §5) — silent
   * loss here would defeat the buffer's entire purpose.
   *
   * `next_attempt_at` is what makes the backoff real rather than merely logged: until it passes,
   * claimPending steps over the row. The delay is computed from the row's own `attempts` in SQL,
   * in the same statement that increments it, so the value the backoff is based on cannot drift
   * from the value that was stored.
   */
  async markFailed(client: QueryRunner, eventId: string, error: string): Promise<void> {
    await client.query(
      `UPDATE ingest.event_buffer
          SET attempts = attempts + 1,
              last_error = $2,
              status = CASE WHEN attempts + 1 >= $3 THEN 'dead' ELSE 'failed' END,
              next_attempt_at = now()
                + LEAST(POWER(2, attempts + 1), $4) * interval '1 second'
        WHERE event_id = $1`,
      [eventId, error.slice(0, 2000), MAX_ATTEMPTS, MAX_BACKOFF_SECONDS],
    );
  }

  /** C-005 §6 — published rows older than the retention window. `dead` is never swept. */
  async deletePublishedOlderThan(days: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM ingest.event_buffer
        WHERE status = 'published'
          AND published_at < now() - ($1 || ' days')::interval`,
      [String(days)],
    );
    return rowCount ?? 0;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ status: string; count: string }>(
      'SELECT status, count(*)::text AS count FROM ingest.event_buffer GROUP BY status',
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  }
}

/** The subset of `pg`'s client surface the repository needs, so tests can supply a fake. */
export interface QueryRunner {
  query<T extends import('pg').QueryResultRow = import('pg').QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<import('pg').QueryResult<T>>;
}

interface BufferRow {
  event_id: string;
  workspace_id: string;
  event_type: string;
  event_version: number;
  payload: GrowthEventEnvelope;
  status: BufferedEvent['status'];
  attempts: number;
}

function toBufferedEvent(row: BufferRow): BufferedEvent {
  return {
    eventId: row.event_id,
    workspaceId: row.workspace_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
  };
}
