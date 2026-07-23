import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

export interface RedirectRecord {
  correlationId: string;
  workspaceId: string;
  sessionId: string | null;
  gsidStatus: 'valid' | 'forged' | 'absent';
  initiatedAt: string;
}

export interface TouchpointRecord {
  touchpointId: string;
  sessionId: string;
  workspaceId: string;
  experimentId: string;
  experimentVersion: string;
  landingVersionId: string;
  utmCampaign: string | null;
  gclid: string | null;
  consentStatus: string;
  occurredAt: string;
}

export interface RegistrationRecord {
  userId: string;
  correlationId: string | null;
  registrationMethod: string;
  applicationContext: string | null;
  registeredAt: string;
}

/**
 * Storage for the C-005 §2.2 join.
 *
 * Both halves are written on arrival rather than one being held in memory waiting for the other:
 * they travel different queues from different services, so nothing orders them, and a pod restart
 * between them must not lose the join.
 */
@Injectable()
export class AttributionRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `DO NOTHING` rather than `DO UPDATE`: brokers deliver at least once, and a redelivery must not
   * be able to change which session a correlation belonged to after a link was already drawn.
   */
  async saveRedirect(record: RedirectRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO attribution.auth_redirect
         (correlation_id, workspace_id, session_id, gsid_status, initiated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (correlation_id) DO NOTHING`,
      [
        record.correlationId,
        record.workspaceId,
        record.sessionId,
        record.gsidStatus,
        record.initiatedAt,
      ],
    );
  }

  /**
   * C-006 §4.3 — the landing view, kept so a lead's experiment stays knowable.
   *
   * Keyed on the envelope's `eventId`, so a broker redelivery collides instead of adding a second
   * row: a session's touchpoint history decides which experiment a lead is credited to, and a
   * duplicated view would move that answer.
   */
  async saveTouchpoint(record: TouchpointRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO attribution.touchpoint
         (touchpoint_id, session_id, workspace_id, experiment_id, experiment_version,
          landing_version_id, utm_campaign, gclid, consent_status, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (touchpoint_id) DO NOTHING`,
      [
        record.touchpointId,
        record.sessionId,
        record.workspaceId,
        record.experimentId,
        record.experimentVersion,
        record.landingVersionId,
        record.utmCampaign,
        record.gclid,
        record.consentStatus,
        record.occurredAt,
      ],
    );
  }

  async saveRegistration(record: RegistrationRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO attribution.registration
         (user_id, correlation_id, registration_method, application_context, registered_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO NOTHING`,
      [
        record.userId,
        record.correlationId,
        record.registrationMethod,
        record.applicationContext,
        record.registeredAt,
      ],
    );
  }

  /**
   * Draws the link if — and only if — both halves are present and the click carried a session
   * whose signature verified.
   *
   * Done as one statement so the two halves are read and the link written without a window in
   * between: two consumers processing the partner events concurrently would otherwise both find
   * "the other half is here" and both insert. The primary key would catch that, but as an error
   * rather than as the no-op it should be.
   */
  async linkIfComplete(correlationId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `INSERT INTO attribution.identity_link (user_id, session_id, correlation_id, workspace_id)
       SELECT r.user_id, a.session_id, a.correlation_id, a.workspace_id
         FROM attribution.auth_redirect a
         JOIN attribution.registration r ON r.correlation_id = a.correlation_id
        WHERE a.correlation_id = $1
          AND a.gsid_status = 'valid'
          AND a.session_id IS NOT NULL
       ON CONFLICT (user_id) DO NOTHING`,
      [correlationId],
    );
    return rowCount ?? 0;
  }

  /**
   * C-005 §4 requires a visible `gsid_forged` counter. This is a query over the facts rather than
   * a counter column, so it cannot drift away from what actually happened.
   */
  async countForgedGsids(): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM attribution.auth_redirect WHERE gsid_status = 'forged'`,
    );
    return Number(rows[0].count);
  }
}
