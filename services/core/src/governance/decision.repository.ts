import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { StoredArtefact } from './decision-artefact.types';

/** Postgres error codes we translate rather than leak. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export class UniqueViolation extends Error {
  constructor(readonly constraint: string) {
    super(`unique violation on ${constraint}`);
  }
}

@Injectable()
export class DecisionRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string): Promise<StoredArtefact | null> {
    const { rows } = await this.db.query<{ body: StoredArtefact }>(
      'SELECT body FROM governance.decision_artefact WHERE decision_artefact_id = $1',
      [id],
    );
    return rows.length ? rows[0].body : null;
  }

  async findByExperiment(experimentId: string, experimentVersion?: string): Promise<StoredArtefact[]> {
    const sql = experimentVersion
      ? `SELECT body FROM governance.decision_artefact
         WHERE experiment_id = $1 AND experiment_version = $2 ORDER BY decided_at ASC`
      : `SELECT body FROM governance.decision_artefact
         WHERE experiment_id = $1 ORDER BY decided_at ASC`;
    const params = experimentVersion ? [experimentId, experimentVersion] : [experimentId];
    const { rows } = await this.db.query<{ body: StoredArtefact }>(sql, params);
    return rows.map((r) => r.body);
  }

  async findLaunch(experimentId: string, experimentVersion: string): Promise<StoredArtefact | null> {
    const { rows } = await this.db.query<{ body: StoredArtefact }>(
      `SELECT body FROM governance.decision_artefact
       WHERE experiment_id = $1 AND experiment_version = $2
         AND decision_type = 'experiment.launch'`,
      [experimentId, experimentVersion],
    );
    return rows.length ? rows[0].body : null;
  }

  /** True when some artefact already supersedes this one — i.e. it no longer holds the cap. */
  async isSuperseded(artefactId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT 1 FROM governance.decision_artefact WHERE supersedes_id = $1 LIMIT 1',
      [artefactId],
    );
    return rows.length > 0;
  }

  async insert(artefact: StoredArtefact): Promise<void> {
    const supersedesId =
      artefact.decisionType === 'experiment.budget_change' ? artefact.supersedesArtefactId : null;
    try {
      await this.db.query(
        `INSERT INTO governance.decision_artefact
           (decision_artefact_id, workspace_id, experiment_id, experiment_version, decision_type,
            artefact_version, body, canonical_hash, decided_by_id, decided_at, supersedes_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          artefact.decisionArtefactId,
          artefact.workspaceId,
          artefact.experimentId,
          artefact.experimentVersion,
          artefact.decisionType,
          artefact.artefactVersion,
          JSON.stringify(artefact),
          artefact.canonicalHash,
          artefact.decidedById,
          artefact.decidedAt,
          supersedesId,
        ],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === PG_UNIQUE_VIOLATION) {
        // The partial unique indexes are the real enforcement of "one launch per version" and
        // "a cap is superseded once" — the service-layer checks that precede them lose to a
        // concurrent writer, so the constraint has to be translated, not just logged.
        throw new UniqueViolation((err as { constraint?: string }).constraint ?? 'unknown');
      }
      throw err;
    }
  }

  /** Only used by tests, which need to prove the trigger rejects mutation. */
  async rawUpdateAttempt(id: string): Promise<void> {
    await this.db.query(
      "UPDATE governance.decision_artefact SET decided_by_id = 'tampered' WHERE decision_artefact_id = $1",
      [id],
    );
  }

  async rawDeleteAttempt(id: string): Promise<void> {
    await this.db.query('DELETE FROM governance.decision_artefact WHERE decision_artefact_id = $1', [id]);
  }
}
