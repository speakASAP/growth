/**
 * Types mirroring C-001 section 2. The JSON schema in ./schemas is the enforcing authority;
 * these exist so TypeScript callers get the same shape at compile time.
 */

export type ISODateTimeUtc = string; // RFC 3339, UTC, "Z" suffix — see C-001 section 3

export interface Money {
  value: string; // decimal STRING — a currency amount must never round-trip through a double
  currency: string; // ISO 4217, always explicit
}

export interface DecisionArtefactBase {
  artefactVersion: 1;
  decisionArtefactId: string;
  workspaceId: string;
  experimentId: string;
  experimentVersion: string;
  evidenceReferences: string[]; // pointers only — never inline personal data
  policyVersion: string;
  decidedByType: 'human';
  decidedById: string;
  decidedAt: ISODateTimeUtc;
  canonicalHash?: string; // optional on write; the server always computes its own
}

export interface ExperimentLaunchDecision extends DecisionArtefactBase {
  decisionType: 'experiment.launch';
  hypothesis: string;
  rationale: string;
  plannedAction: {
    platform: 'google_ads';
    budgetCap: Money;
    startAt: ISODateTimeUtc;
    endAt: ISODateTimeUtc;
  };
}

export interface ExperimentStopDecision extends DecisionArtefactBase {
  decisionType: 'experiment.stop';
  reason: string;
  stoppedAt: ISODateTimeUtc;
}

export interface ExperimentBudgetChangeDecision extends DecisionArtefactBase {
  decisionType: 'experiment.budget_change';
  reason: string;
  supersedesArtefactId: string;
  previousBudgetCap: Money;
  newBudgetCap: Money;
  effectiveFrom: ISODateTimeUtc;
}

export type DecisionArtefact =
  | ExperimentLaunchDecision
  | ExperimentStopDecision
  | ExperimentBudgetChangeDecision;

export type StoredArtefact = DecisionArtefact & { canonicalHash: string };

/** The cap an artefact establishes, or null if it establishes none (a stop). */
export function capEstablishedBy(artefact: DecisionArtefact): Money | null {
  if (artefact.decisionType === 'experiment.launch') return artefact.plannedAction.budgetCap;
  if (artefact.decisionType === 'experiment.budget_change') return artefact.newBudgetCap;
  return null;
}

export function sameMoney(a: Money, b: Money): boolean {
  // Compared as decimal strings after normalising trailing zeros: "1000" and "1000.00" are the
  // same amount, and rejecting one of them would be a false conflict. Never parsed as a float.
  return a.currency === b.currency && normaliseDecimal(a.value) === normaliseDecimal(b.value);
}

export function normaliseDecimal(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}
