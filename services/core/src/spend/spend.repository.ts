import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

export interface ObservationRecord {
  observationId: string;
  experimentId: string;
  /** null = the owner did not split this figure by campaign (C-006 §2.5). Never blank. */
  campaignId: string | null;
  workspaceId: string;
  platform: string;
  periodStart: string;
  periodEnd: string;
  /** A decimal STRING all the way to the driver. Postgres casts it to NUMERIC. */
  amountValue: string;
  amountCurrency: string;
  evidenceReference: string;
  enteredBy: string;
  enteredAt: string;
}

export type InsertOutcome = 'inserted' | 'duplicate' | 'conflict';

/**
 * Storage for C-006 §4 — `spend.manual_observation`.
 *
 * The table is never updated by this service and never deleted from. A connector observation (S8)
 * supersedes a manual one by setting `superseded_by_observation_id`; the manual row itself stays
 * exactly as the owner typed it, so nothing downstream can present it as invoice-reconciled.
 */
@Injectable()
export class SpendRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Distinguishes "you sent this already" from "you sent something different under the same id".
   *
   * A silent `DO NOTHING` would swallow the second case, and the second case is the dangerous one:
   * the owner corrects a number, re-submits under the same observationId, gets a cheerful 200, and
   * the stored spend is still the old value. Cost per lead is then wrong and nothing said so.
   */
  async insert(record: ObservationRecord): Promise<InsertOutcome> {
    const { rowCount } = await this.db.query(
      `INSERT INTO spend.manual_observation
         (observation_id, experiment_id, workspace_id, platform, period_start, period_end,
          amount_value, amount_currency, evidence_reference, entered_by, entered_at, campaign_id)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::numeric,$8,$9,$10,$11,$12)
       ON CONFLICT (observation_id) DO NOTHING`,
      [
        record.observationId,
        record.experimentId,
        record.workspaceId,
        record.platform,
        record.periodStart,
        record.periodEnd,
        record.amountValue,
        record.amountCurrency,
        record.evidenceReference,
        record.enteredBy,
        record.enteredAt,
        record.campaignId,
      ],
    );

    if ((rowCount ?? 0) > 0) return 'inserted';

    // Nothing was inserted, so a row with this id already exists. Whether this is a harmless
    // replay or a changed body decides between 200 and 409.
    const existing = await this.findById(record.observationId, record.amountValue);
    // The row vanished between the insert and this read. Refusing is the safe answer: reporting a
    // duplicate would tell the caller a number is stored when none is.
    if (!existing) return 'conflict';

    const same =
      existing.experimentId === record.experimentId &&
      existing.platform === record.platform &&
      existing.periodStart === record.periodStart &&
      existing.periodEnd === record.periodEnd &&
      // Part of the identity comparison, not decoration: the same id resubmitted against a
      // different campaign is a changed body, and answering 200 to it would leave the stored
      // split disagreeing with what the owner believes he entered.
      existing.campaignId === record.campaignId &&
      // Compared as NUMERIC by the database rather than as text: '15000.00' and '15000.0000' are
      // the same amount of money, and a string comparison would call that a conflict.
      existing.amountEqualsChecked &&
      existing.amountCurrency === record.amountCurrency;

    return same ? 'duplicate' : 'conflict';
  }

  /**
   * Reads the stored observation, with the amount compared against a candidate **inside Postgres**
   * so the comparison is decimal, not textual, and never passes through a JS number.
   *
   * The candidate is a parameter rather than instance state: this is an injected singleton, and a
   * field holding "the amount we are currently comparing" would be read by whichever concurrent
   * request happened to look at the wrong moment.
   */
  async findById(
    observationId: string,
    compareAmountTo = '0',
  ): Promise<
    | (Omit<ObservationRecord, 'amountValue'> & { amountValue: string; amountEqualsChecked: boolean })
    | null
  > {
    const { rows } = await this.db.query<Record<string, string | boolean>>(
      `SELECT observation_id, experiment_id, workspace_id, platform,
              to_char(period_start, 'YYYY-MM-DD') AS period_start,
              to_char(period_end,   'YYYY-MM-DD') AS period_end,
              amount_value::text                  AS amount_value,
              amount_currency, evidence_reference, entered_by, entered_at, campaign_id,
              (amount_value = $2::numeric)        AS amount_equals
         FROM spend.manual_observation
        WHERE observation_id = $1`,
      [observationId, compareAmountTo],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      observationId: row.observation_id as string,
      experimentId: row.experiment_id as string,
      campaignId: (row.campaign_id as string | null) ?? null,
      workspaceId: row.workspace_id as string,
      platform: row.platform as string,
      periodStart: row.period_start as string,
      periodEnd: row.period_end as string,
      amountValue: row.amount_value as string,
      amountCurrency: row.amount_currency as string,
      evidenceReference: row.evidence_reference as string,
      enteredBy: row.entered_by as string,
      enteredAt: new Date(row.entered_at as string).toISOString(),
      amountEqualsChecked: row.amount_equals === true,
    };
  }

  /** Every observation for an experiment, amounts as decimal strings. */
  async listForExperiment(experimentId: string): Promise<ObservationRecord[]> {
    const { rows } = await this.db.query<Record<string, string>>(
      `SELECT observation_id, experiment_id, workspace_id, platform,
              to_char(period_start, 'YYYY-MM-DD') AS period_start,
              to_char(period_end,   'YYYY-MM-DD') AS period_end,
              amount_value::text                  AS amount_value,
              amount_currency, evidence_reference, entered_by, entered_at, campaign_id
         FROM spend.manual_observation
        WHERE experiment_id = $1
          AND superseded_by_observation_id IS NULL
        ORDER BY period_start`,
      [experimentId],
    );

    return rows.map((row) => ({
      observationId: row.observation_id,
      experimentId: row.experiment_id,
      campaignId: row.campaign_id ?? null,
      workspaceId: row.workspace_id,
      platform: row.platform,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountValue: row.amount_value,
      amountCurrency: row.amount_currency,
      evidenceReference: row.evidence_reference,
      enteredBy: row.entered_by,
      enteredAt: new Date(row.entered_at).toISOString(),
    }));
  }
}
