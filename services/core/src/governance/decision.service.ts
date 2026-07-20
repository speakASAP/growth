import { Injectable } from '@nestjs/common';
import { canonicalHashOf } from './canonical-hash';
import { validateArtefactShape, ValidationFailure } from './decision-artefact.validator';
import { DecisionRepository, UniqueViolation } from './decision.repository';
import {
  DecisionArtefact,
  Money,
  StoredArtefact,
  capEstablishedBy,
  sameMoney,
} from './decision-artefact.types';

export type WriteOutcome =
  | { status: 'created'; artefact: StoredArtefact }
  | { status: 'duplicate'; artefact: StoredArtefact }
  | { status: 'conflict'; message: string }
  | { status: 'invalid'; failures: ValidationFailure[] };

@Injectable()
export class DecisionService {
  constructor(private readonly repo: DecisionRepository) {}

  async record(candidate: unknown): Promise<WriteOutcome> {
    const shapeFailures = validateArtefactShape(candidate);
    if (shapeFailures.length) return { status: 'invalid', failures: shapeFailures };

    const artefact = candidate as DecisionArtefact;

    const semanticFailures = await this.checkSemantics(artefact);
    if (semanticFailures.length) return { status: 'invalid', failures: semanticFailures };

    // The server always computes the hash. A supplied value that disagrees is not corrected
    // silently: that mismatch is the cross-implementation divergence check firing in
    // production, and swallowing it would hide the exact bug the contract exists to catch.
    const computed = canonicalHashOf(artefact as unknown as Record<string, unknown>);
    if (artefact.canonicalHash && artefact.canonicalHash !== computed) {
      return {
        status: 'invalid',
        failures: [
          {
            path: '/canonicalHash',
            message: 'supplied hash does not match the canonical hash computed by the server',
          },
        ],
      };
    }

    const stored: StoredArtefact = { ...artefact, canonicalHash: computed };

    const existing = await this.repo.findById(stored.decisionArtefactId);
    if (existing) return this.reconcileExisting(existing, stored);

    try {
      await this.repo.insert(stored);
    } catch (err) {
      if (err instanceof UniqueViolation) return this.explainUniqueViolation(err, stored);
      throw err;
    }
    return { status: 'created', artefact: stored };
  }

  async listForExperiment(experimentId: string, experimentVersion?: string): Promise<StoredArtefact[]> {
    return this.repo.findByExperiment(experimentId, experimentVersion);
  }

  /**
   * A resubmission of the identical artefact is success, not an error — that is what makes a
   * client-generated id safe to retry. A different body under the same id is a conflict, never
   * an overwrite (C-001 section 4).
   */
  private reconcileExisting(existing: StoredArtefact, incoming: StoredArtefact): WriteOutcome {
    if (existing.canonicalHash === incoming.canonicalHash) {
      return { status: 'duplicate', artefact: existing };
    }
    return {
      status: 'conflict',
      message: `decisionArtefactId ${incoming.decisionArtefactId} already exists with different content`,
    };
  }

  /** Rules V5–V8 and V10 — everything that needs stored history or a cross-field comparison. */
  private async checkSemantics(artefact: DecisionArtefact): Promise<ValidationFailure[]> {
    const failures: ValidationFailure[] = [];

    if (artefact.decisionType === 'experiment.launch') {
      // V10 — expressible only here: JSON Schema cannot compare two sibling values.
      if (artefact.plannedAction.endAt <= artefact.plannedAction.startAt) {
        failures.push({
          path: '/plannedAction/endAt',
          message: 'endAt must be strictly after startAt',
        });
      }
      return failures;
    }

    // V5 — a stop or a budget change with no launch is an orphan: it claims to end or amend
    // something the record has never seen begin.
    const launch = await this.repo.findLaunch(artefact.experimentId, artefact.experimentVersion);
    if (!launch) {
      failures.push({
        path: '/experimentId',
        message: `no experiment.launch artefact exists for ${artefact.experimentId} @ ${artefact.experimentVersion}`,
      });
      return failures;
    }

    if (artefact.decisionType === 'experiment.budget_change') {
      failures.push(...(await this.checkBudgetChange(artefact, launch)));
    }

    return failures;
  }

  private async checkBudgetChange(
    artefact: Extract<DecisionArtefact, { decisionType: 'experiment.budget_change' }>,
    launch: StoredArtefact,
  ): Promise<ValidationFailure[]> {
    const failures: ValidationFailure[] = [];

    const superseded = await this.repo.findById(artefact.supersedesArtefactId);
    if (!superseded) {
      failures.push({
        path: '/supersedesArtefactId',
        message: 'superseded artefact does not exist',
      });
      return failures;
    }

    // V6 — the chain must stay inside one experiment version, or "the current cap" stops
    // meaning anything.
    if (
      superseded.experimentId !== artefact.experimentId ||
      superseded.experimentVersion !== artefact.experimentVersion
    ) {
      failures.push({
        path: '/supersedesArtefactId',
        message: 'superseded artefact belongs to a different experiment or version',
      });
      return failures;
    }

    const supersededCap = capEstablishedBy(superseded);
    if (!supersededCap) {
      failures.push({
        path: '/supersedesArtefactId',
        message: 'superseded artefact establishes no budget cap',
      });
      return failures;
    }

    // V6 — superseding an artefact that has already been superseded would fork the history.
    // The partial unique index is the real guard against a concurrent writer; this check exists
    // to return a comprehensible 422 rather than a constraint name.
    if (await this.repo.isSuperseded(artefact.supersedesArtefactId)) {
      failures.push({
        path: '/supersedesArtefactId',
        message: 'superseded artefact no longer holds the current cap — it has already been superseded',
      });
    }

    // V7 — the whole point of the chain: a claimed previous cap that disagrees with the record
    // means the client is writing a history that did not happen.
    if (!sameMoney(artefact.previousBudgetCap, supersededCap)) {
      failures.push({
        path: '/previousBudgetCap',
        message: `previousBudgetCap does not match the cap established by ${artefact.supersedesArtefactId}`,
      });
    }

    // V8 — a cap in a different currency from the launch is not a change, it is a different
    // quantity wearing the same name.
    const launchCap = capEstablishedBy(launch) as Money;
    if (artefact.newBudgetCap.currency !== launchCap.currency) {
      failures.push({
        path: '/newBudgetCap/currency',
        message: `currency must match the launch currency ${launchCap.currency}`,
      });
    }

    return failures;
  }

  private explainUniqueViolation(err: UniqueViolation, artefact: StoredArtefact): WriteOutcome {
    if (err.constraint.includes('one_launch')) {
      return {
        status: 'conflict',
        message: `an experiment.launch already exists for ${artefact.experimentId} @ ${artefact.experimentVersion}`,
      };
    }
    if (err.constraint.includes('supersedes')) {
      return {
        status: 'conflict',
        message: 'that artefact has already been superseded by another budget change',
      };
    }
    return { status: 'conflict', message: 'artefact conflicts with an existing record' };
  }
}
