import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

export interface LeadRecord {
  leadId: string;
  userId: string;
  correlationId: string | null;
  workspaceId: string;
  sourceService: string;
  createdAt: string;
}

export interface QualificationRecord {
  qualificationId: string;
  leadId: string;
  workspaceId: string;
  criteriaVersion: string;
  qualificationStatus: 'qualified' | 'disqualified';
  decidedByType: string;
  decidedById: string;
  decidedAt: string;
  reason: string;
  supersedesQualificationId: string | null;
}

/**
 * Storage for C-006 §4 — the lead a judgement attaches to, and the judgement.
 *
 * Both writes are idempotent on the event's own identity. Brokers deliver at least once, and the
 * numbers built on these rows (registrations, qualified count, cost per qualified lead) are all
 * counts — a duplicate row is not a cosmetic problem, it is a wrong answer to the question the
 * whole slice exists to answer.
 */
@Injectable()
export class QualificationRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * `DO NOTHING`, not `DO UPDATE`: a redelivery of the creation event must not be able to rewrite
   * which user or which correlation a lead belonged to after judgements have already attached to it.
   */
  async saveLead(record: LeadRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO qualification.lead
         (lead_id, user_id, correlation_id, workspace_id, source_service, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (lead_id) DO NOTHING`,
      [
        record.leadId,
        record.userId,
        record.correlationId,
        record.workspaceId,
        record.sourceService,
        record.createdAt,
      ],
    );
  }

  /**
   * No foreign key to `qualification.lead` is relied on here, and none exists (C-006 §3.1). A
   * judgement may legitimately arrive before the lead it is about — two queues, two drain rates.
   * Storing it anyway keeps the scarcer fact, the one a human produced.
   *
   * `DO NOTHING` on the qualification id: the row is append-only and the runtime role holds no
   * UPDATE grant, so a redelivery could not rewrite it even if this said otherwise.
   */
  async saveQualification(record: QualificationRecord): Promise<number> {
    const { rowCount } = await this.db.query(
      `INSERT INTO qualification.lead_qualification
         (qualification_id, lead_id, workspace_id, criteria_version, qualification_status,
          decided_by_type, decided_by_id, decided_at, reason, supersedes_qualification_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (qualification_id) DO NOTHING`,
      [
        record.qualificationId,
        record.leadId,
        record.workspaceId,
        record.criteriaVersion,
        record.qualificationStatus,
        record.decidedByType,
        record.decidedById,
        record.decidedAt,
        record.reason,
        record.supersedesQualificationId,
      ],
    );
    return rowCount ?? 0;
  }

  /**
   * The current verdict per lead, with `pending` derived rather than stored (C-006 §1.1).
   *
   * "Current" is the latest judgement by `decided_at`, tie-broken by `received_at` — two
   * corrections recorded in the same second must still order deterministically, or the reported
   * verdict flips between reads.
   *
   * A lead with no judgement is `pending` and is still counted, because it is still a registration
   * the owner paid for. That is the whole reason cost-per-qualified keeps pending leads in the
   * numerator: excluding unworked leads would flatter the metric exactly when the owner is behind
   * on working them.
   */
  async currentVerdicts(workspaceId: string): Promise<
    Array<{ leadId: string; verdict: 'qualified' | 'disqualified' | 'pending'; attributed: boolean }>
  > {
    const { rows } = await this.db.query<{
      lead_id: string;
      verdict: 'qualified' | 'disqualified' | 'pending';
      attributed: boolean;
    }>(
      `SELECT l.lead_id,
              COALESCE(q.qualification_status, 'pending') AS verdict,
              (il.user_id IS NOT NULL)                    AS attributed
         FROM qualification.lead l
         LEFT JOIN LATERAL (
              SELECT qq.qualification_status
                FROM qualification.lead_qualification qq
               WHERE qq.lead_id = l.lead_id
               ORDER BY qq.decided_at DESC, qq.received_at DESC
               LIMIT 1
         ) q ON true
         LEFT JOIN attribution.identity_link il ON il.user_id = l.user_id
        WHERE l.workspace_id = $1`,
      [workspaceId],
    );

    return rows.map((row) => ({
      leadId: row.lead_id,
      verdict: row.verdict,
      attributed: row.attributed,
    }));
  }

  /** Every judgement for a lead, newest first — superseded ones included. */
  async history(leadId: string): Promise<QualificationRecord[]> {
    const { rows } = await this.db.query<Record<string, string | null>>(
      `SELECT qualification_id, lead_id, workspace_id, criteria_version, qualification_status,
              decided_by_type, decided_by_id, decided_at, reason, supersedes_qualification_id
         FROM qualification.lead_qualification
        WHERE lead_id = $1
        ORDER BY decided_at DESC, received_at DESC`,
      [leadId],
    );

    return rows.map((row) => ({
      qualificationId: row.qualification_id as string,
      leadId: row.lead_id as string,
      workspaceId: row.workspace_id as string,
      criteriaVersion: row.criteria_version as string,
      qualificationStatus: row.qualification_status as 'qualified' | 'disqualified',
      decidedByType: row.decided_by_type as string,
      decidedById: row.decided_by_id as string,
      decidedAt: new Date(row.decided_at as string).toISOString(),
      reason: row.reason as string,
      supersedesQualificationId: row.supersedes_qualification_id,
    }));
  }
}
