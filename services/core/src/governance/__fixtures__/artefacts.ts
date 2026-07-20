import {
  ExperimentBudgetChangeDecision,
  ExperimentLaunchDecision,
  ExperimentStopDecision,
} from '../decision-artefact.types';

export const LAUNCH_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
export const STOP_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3302';
export const CHANGE_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3303';

export function launchFixture(
  overrides: Partial<ExperimentLaunchDecision> = {},
): ExperimentLaunchDecision {
  return {
    artefactVersion: 1,
    decisionArtefactId: LAUNCH_ID,
    workspaceId: 'bazos',
    experimentId: 'exp-001',
    experimentVersion: 'v1',
    evidenceReferences: [],
    policyVersion: 'policy-v1',
    decidedByType: 'human',
    decidedById: 'ssf',
    decidedAt: '2026-07-19T14:03:11Z',
    decisionType: 'experiment.launch',
    hypothesis: 'Czech buyers searching for used furniture will register if the landing names the city.',
    rationale: 'Cheapest test of the city-specific angle; 1000 CZK is one week of coffee, not a bet.',
    plannedAction: {
      platform: 'google_ads',
      budgetCap: { value: '1000.00', currency: 'CZK' },
      startAt: '2026-07-20T00:00:00Z',
      endAt: '2026-07-27T00:00:00Z',
    },
    ...overrides,
  };
}

export function stopFixture(overrides: Partial<ExperimentStopDecision> = {}): ExperimentStopDecision {
  return {
    artefactVersion: 1,
    decisionArtefactId: STOP_ID,
    workspaceId: 'bazos',
    experimentId: 'exp-001',
    experimentVersion: 'v1',
    evidenceReferences: [],
    policyVersion: 'policy-v1',
    decidedByType: 'human',
    decidedById: 'ssf',
    decidedAt: '2026-07-26T09:00:00Z',
    decisionType: 'experiment.stop',
    reason: 'Cost per registration settled at 340 CZK against a 120 CZK ceiling.',
    stoppedAt: '2026-07-26T09:15:00Z',
    ...overrides,
  };
}

export function budgetChangeFixture(
  overrides: Partial<ExperimentBudgetChangeDecision> = {},
): ExperimentBudgetChangeDecision {
  return {
    artefactVersion: 1,
    decisionArtefactId: CHANGE_ID,
    workspaceId: 'bazos',
    experimentId: 'exp-001',
    experimentVersion: 'v1',
    evidenceReferences: [],
    policyVersion: 'policy-v1',
    decidedByType: 'human',
    decidedById: 'ssf',
    decidedAt: '2026-07-23T11:00:00Z',
    decisionType: 'experiment.budget_change',
    reason: 'Three registrations in two days at 90 CZK each — worth more room before judging it.',
    supersedesArtefactId: LAUNCH_ID,
    previousBudgetCap: { value: '1000.00', currency: 'CZK' },
    newBudgetCap: { value: '2500.00', currency: 'CZK' },
    effectiveFrom: '2026-07-23T12:00:00Z',
    ...overrides,
  };
}
