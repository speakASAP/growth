import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QualificationRepository } from '../qualification/qualification.repository';
import { SpendRepository } from '../spend/spend.repository';
import { divideToScale2, sumDecimalStrings } from './money';

export interface ExperimentReport {
  experimentId: string;
  workspaceId: string;
  generatedAt: string;
  currency: string | null;
  spend: {
    total: string | null;
    observations: number;
    mixedCurrency: boolean;
  };
  registrations: number;
  attribution: {
    attributed: number;
    unattributed: number;
  };
  verdicts: {
    qualified: number;
    disqualified: number;
    pending: number;
  };
  costPerRegistration: string | null;
  costPerQualifiedLead: string | null;
}

/**
 * C-006 §6 — the experiment report.
 *
 * Derives every number from data that already exists and stores nothing of its own. That is the
 * point: a stored metric is a second copy of the truth that drifts from the first one, and
 * `pending` in particular is defined as the ABSENCE of a judgement, so it can only ever be
 * computed (C-006 §1.1).
 */
@Injectable()
export class ExperimentReportService {
  constructor(
    private readonly qualification: QualificationRepository,
    private readonly spend: SpendRepository,
    private readonly config: ConfigService,
  ) {}

  async build(experimentId: string): Promise<ExperimentReport> {
    const workspaceId = this.config.get<string>('GROWTH_WORKSPACE_ID') ?? 'bazos';

    // Verdicts are scoped by workspace and spend by experiment, because `qualification.lead` has
    // no experiment dimension. Correct while one experiment runs per workspace, wrong the moment
    // a second does — flagged in C-006 §6.6 rather than hidden.
    const [verdicts, observations] = await Promise.all([
      this.qualification.currentVerdicts(workspaceId),
      this.spend.listForExperiment(experimentId),
    ]);

    const currencies = new Set(observations.map((o) => o.amountCurrency));
    const mixedCurrency = currencies.size > 1;

    // Mixed currencies produce no total at all. A CZK+EUR sum is a number that is wrong and looks
    // completely fine, which is worse than an absent one (C-006 §6.4).
    const total = mixedCurrency ? null : sumDecimalStrings(observations.map((o) => o.amountValue));
    const currency = mixedCurrency || currencies.size === 0 ? null : [...currencies][0];

    const registrations = verdicts.length;
    const count = (v: 'qualified' | 'disqualified' | 'pending') =>
      verdicts.filter((row) => row.verdict === v).length;

    const attributed = verdicts.filter((row) => row.attributed).length;

    return {
      experimentId,
      workspaceId,
      generatedAt: new Date().toISOString(),
      currency,
      spend: {
        total,
        observations: observations.length,
        mixedCurrency,
      },
      registrations,
      attribution: {
        attributed,
        // Never derived by subtraction elsewhere and never omitted: consent refusal means these
        // conversions are genuinely unattributable, and hiding that makes cost-per-registration
        // look worse than reality (C-006 §6.5).
        unattributed: registrations - attributed,
      },
      verdicts: {
        qualified: count('qualified'),
        disqualified: count('disqualified'),
        pending: count('pending'),
      },
      // Both denominators may legitimately be zero; divideToScale2 answers null, which the screen
      // renders as "—".
      costPerRegistration: divideToScale2(total, registrations),
      costPerQualifiedLead: divideToScale2(total, count('qualified')),
    };
  }
}
