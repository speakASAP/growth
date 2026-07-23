import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QualificationRepository } from '../qualification/qualification.repository';
import { SpendRepository } from '../spend/spend.repository';
import type { ObservationRecord } from '../spend/spend.repository';
import { compareDecimalStrings, divideToScale2, sumDecimalStrings } from './money';

export interface CampaignSpend {
  /** null = the owner did not split this figure. Never merged into a named campaign (C-006 §2.5). */
  campaignId: string | null;
  total: string;
  observations: number;
}

export interface ExperimentReport {
  experimentId: string;
  workspaceId: string;
  generatedAt: string;
  currency: string | null;
  spend: {
    total: string | null;
    observations: number;
    mixedCurrency: boolean;
    byCampaign: CampaignSpend[];
  };
  registrations: number;
  outOfScope: {
    otherExperiments: number;
    noTouchpoint: number;
  };
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

    // Verdicts arrive scoped by workspace and carrying the experiment each lead came from, which
    // is derived at read time from the touchpoint the click walked back to (C-006 §6.6). Spend is
    // keyed by experiment directly.
    const [allVerdicts, observations] = await Promise.all([
      this.qualification.currentVerdicts(workspaceId),
      this.spend.listForExperiment(experimentId),
    ]);

    // Three buckets, and the two that are not counted are reported rather than dropped. Leads on
    // another experiment are somebody else's numerator; leads with no touchpoint are real
    // registrations whose origin cannot be established, and excluding them makes THIS experiment
    // read worse than reality — the same direction the unattributed split already reads (§6.6).
    const verdicts = allVerdicts.filter((row) => row.experimentId === experimentId);
    const otherExperiments = allVerdicts.filter(
      (row) => row.experimentId !== null && row.experimentId !== experimentId,
    ).length;
    const noTouchpoint = allVerdicts.filter((row) => row.experimentId === null).length;

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
        // Suppressed on mixed currency for the same reason the total is: a per-campaign figure
        // adding CZK to EUR is wrong and looks fine (§6.4).
        byCampaign: mixedCurrency ? [] : summariseCampaigns(observations),
      },
      registrations,
      outOfScope: { otherExperiments, noTouchpoint },
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

/**
 * Spend per campaign, with unassigned spend as its own line (C-006 §2.5).
 *
 * Unassigned is never folded into a named campaign and never dropped: the money left the account
 * whether or not the owner split the figure, and the experiment's total is the sum of every line
 * here. Ordered by size so the campaign that spent the most reads first, then by id so two equal
 * totals do not swap places between reads.
 */
function summariseCampaigns(observations: ObservationRecord[]): CampaignSpend[] {
  const groups = new Map<string, ObservationRecord[]>();

  for (const observation of observations) {
    // The empty string is not a possible campaignId — the schema and the column check both reject
    // a blank one — so it is safe as the key for "no campaign".
    const key = observation.campaignId ?? '';
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }

  return [...groups.entries()]
    .map(([key, rows]) => ({
      campaignId: key === '' ? null : key,
      total: sumDecimalStrings(rows.map((row) => row.amountValue)) as string,
      observations: rows.length,
    }))
    .sort(
      (a, b) =>
        compareDecimalStrings(b.total, a.total) ||
        (a.campaignId ?? '').localeCompare(b.campaignId ?? ''),
    );
}
