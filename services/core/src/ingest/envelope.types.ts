/** C-005 §1 — the envelope every producer sends and growth-core buffers verbatim. */
export interface GrowthEventEnvelope<TPayload extends object = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  workspaceId: string;
  correlationId: string;
  causationId?: string;
  dataClass: string;
  payload: TPayload;
}

/** C-005 §5 — buffer row states. */
export type BufferStatus = 'pending' | 'published' | 'failed' | 'dead';

export interface BufferedEvent {
  eventId: string;
  workspaceId: string;
  eventType: string;
  eventVersion: number;
  payload: GrowthEventEnvelope;
  status: BufferStatus;
  attempts: number;
}

/**
 * Per-envelope outcome of an ingest call. `duplicate` is a success: browser retries reuse the
 * same eventId, which is exactly what makes the primary-key collision safe to report as 200
 * rather than as an error (C-005 §3).
 */
export type IngestOutcome = 'accepted' | 'duplicate';
