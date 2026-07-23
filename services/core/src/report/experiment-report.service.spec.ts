import { ExperimentReportService } from './experiment-report.service';

type Verdict = {
  leadId: string;
  verdict: 'qualified' | 'disqualified' | 'pending';
  attributed: boolean;
  experimentId: string | null;
};

function observation(amountValue: string, amountCurrency = 'CZK', campaignId: string | null = null) {
  return {
    observationId: `obs-${amountValue}-${amountCurrency}-${campaignId ?? 'none'}`,
    experimentId: 'exp-001',
    campaignId,
    workspaceId: 'bazos',
    platform: 'google_ads',
    periodStart: '2026-07-22',
    periodEnd: '2026-07-22',
    amountValue,
    amountCurrency,
    evidenceReference: 'google ads report',
    enteredBy: 'owner',
    enteredAt: '2026-07-22T00:00:00.000Z',
  };
}

function build(verdicts: Verdict[], observations: ReturnType<typeof observation>[]) {
  const qualification = { currentVerdicts: jest.fn().mockResolvedValue(verdicts) };
  const spend = { listForExperiment: jest.fn().mockResolvedValue(observations) };
  const config = { get: jest.fn().mockReturnValue('bazos') };

  const service = new ExperimentReportService(
    qualification as never,
    spend as never,
    config as never,
  );

  return { service, qualification, spend };
}

const verdicts = (spec: Array<[Verdict['verdict'], boolean]>): Verdict[] =>
  // Every lead in the base fixtures belongs to the experiment under test; the bucketing cases
  // below say otherwise explicitly, so a scoping bug cannot hide behind a default.
  spec.map(([verdict, attributed], i) => ({
    leadId: `lead-${i}`,
    verdict,
    attributed,
    experimentId: 'exp-001',
  }));

describe('ExperimentReportService', () => {
  it('reports the F-006 §3 worked example', async () => {
    // 24 registrations: 7 qualified, 11 disqualified, 6 pending. 19 attributed, 5 not.
    const spec: Array<[Verdict['verdict'], boolean]> = [];
    for (let i = 0; i < 7; i++) spec.push(['qualified', true]);
    for (let i = 0; i < 11; i++) spec.push(['disqualified', i < 10]);
    for (let i = 0; i < 6; i++) spec.push(['pending', i < 2]);

    const { service } = build(verdicts(spec), [observation('15000.0000')]);
    const report = await service.build('exp-001');

    expect(report.registrations).toBe(24);
    expect(report.verdicts).toEqual({ qualified: 7, disqualified: 11, pending: 6 });
    expect(report.attribution).toEqual({ attributed: 19, unattributed: 5 });
    expect(report.spend.total).toBe('15000.0000');
    expect(report.currency).toBe('CZK');
    expect(report.costPerRegistration).toBe('625.00');
    // 15000 / 7 — pending and disqualified leads stay in the numerator (C-006 §6.5)
    expect(report.costPerQualifiedLead).toBe('2142.86');
  });

  it('keeps pending leads in the numerator of cost per qualified', async () => {
    // 4 registrations, 1 qualified, 3 pending. Spend 1000. If pending were excluded the
    // denominator would still be 1 but the intent is that the FULL spend is charged to it.
    const { service } = build(
      verdicts([
        ['qualified', true],
        ['pending', true],
        ['pending', true],
        ['pending', true],
      ]),
      [observation('1000.0000')],
    );
    const report = await service.build('exp-001');

    expect(report.verdicts.pending).toBe(3);
    expect(report.costPerQualifiedLead).toBe('1000.00');
  });

  it('lowers cost per qualified when a pending lead becomes qualified', async () => {
    const before = await build(
      verdicts([['qualified', true], ['pending', true]]),
      [observation('1000.0000')],
    ).service.build('exp-001');

    const after = await build(
      verdicts([['qualified', true], ['qualified', true]]),
      [observation('1000.0000')],
    ).service.build('exp-001');

    expect(before.costPerQualifiedLead).toBe('1000.00');
    expect(after.costPerQualifiedLead).toBe('500.00');
  });

  it('renders no qualified leads as null, not a division error (C-006 §6.3)', async () => {
    const { service } = build(verdicts([['pending', true]]), [observation('1000.0000')]);
    const report = await service.build('exp-001');

    expect(report.costPerQualifiedLead).toBeNull();
    expect(report.costPerRegistration).toBe('1000.00');
  });

  it('renders no registrations as null rather than zero', async () => {
    const { service } = build([], [observation('1000.0000')]);
    const report = await service.build('exp-001');

    expect(report.registrations).toBe(0);
    expect(report.costPerRegistration).toBeNull();
    expect(report.costPerQualifiedLead).toBeNull();
  });

  it('reports an experiment with no spend without inventing a zero', async () => {
    const { service } = build(verdicts([['qualified', true]]), []);
    const report = await service.build('exp-001');

    expect(report.spend.total).toBeNull();
    expect(report.currency).toBeNull();
    expect(report.costPerRegistration).toBeNull();
    expect(report.costPerQualifiedLead).toBeNull();
  });

  it('always reports the attributed/unattributed split, including when all are unattributed', async () => {
    // Consent refusal makes conversions structurally unattributable. The split must still be
    // present and must not be silently dropped (C-006 §6.5).
    const { service } = build(
      verdicts([['qualified', false], ['pending', false]]),
      [observation('1000.0000')],
    );
    const report = await service.build('exp-001');

    expect(report.attribution).toEqual({ attributed: 0, unattributed: 2 });
    // The registrations count is NOT reduced to the attributed ones — we paid for all of them.
    expect(report.registrations).toBe(2);
    expect(report.costPerRegistration).toBe('500.00');
  });

  it('refuses to sum mixed currencies into one number (C-006 §6.4)', async () => {
    const { service } = build(verdicts([['qualified', true]]), [
      observation('1000.0000', 'CZK'),
      observation('40.0000', 'EUR'),
    ]);
    const report = await service.build('exp-001');

    expect(report.spend.mixedCurrency).toBe(true);
    expect(report.currency).toBeNull();
    expect(report.spend.total).toBeNull();
    expect(report.costPerRegistration).toBeNull();
    expect(report.costPerQualifiedLead).toBeNull();
  });

  it('sums several observations in the same currency exactly', async () => {
    const { service } = build(verdicts([['qualified', true], ['qualified', true]]), [
      observation('1000.5000'),
      observation('2000.5000'),
    ]);
    const report = await service.build('exp-001');

    expect(report.spend.total).toBe('3001.0000');
    expect(report.spend.observations).toBe(2);
    expect(report.costPerQualifiedLead).toBe('1500.50');
  });

  it('scopes verdicts to the configured workspace and spend to the experiment', async () => {
    const { service, qualification, spend } = build(verdicts([['qualified', true]]), [observation('1.0000')]);
    await service.build('exp-042');

    expect(qualification.currentVerdicts).toHaveBeenCalledWith('bazos');
    expect(spend.listForExperiment).toHaveBeenCalledWith('exp-042');
  });
});


describe('scoping to one experiment (C-006 §6.6)', () => {
  const lead = (id: string, experimentId: string | null): Verdict => ({
    leadId: id,
    verdict: 'qualified',
    attributed: true,
    experimentId,
  });

  it('counts only the leads whose touchpoint names this experiment', async () => {
    const { service } = build(
      [lead('a', 'exp-001'), lead('b', 'exp-002'), lead('c', null)],
      [observation('900.0000')],
    );

    const report = await service.build('exp-001');

    expect(report.registrations).toBe(1);
    expect(report.outOfScope).toEqual({ otherExperiments: 1, noTouchpoint: 1 });
    // 900 / 1, not 900 / 3. The other two leads belong to another experiment and to none.
    expect(report.costPerRegistration).toBe('900.00');
  });

  it('never hides the leads it does not count', async () => {
    // The honest cost of scoping: these registrations are real, and excluding them makes THIS
    // experiment read worse than reality. Silently dropping them would make it read better.
    const { service } = build([lead('a', 'exp-001'), ...Array.from({ length: 9 }, (_, i) => lead(`x${i}`, null))], [
      observation('1000.0000'),
    ]);

    const report = await service.build('exp-001');

    expect(report.registrations).toBe(1);
    expect(report.outOfScope.noTouchpoint).toBe(9);
    expect(report.costPerRegistration).toBe('1000.00');
  });

  it('reports zero rather than every workspace lead when nothing matches', async () => {
    const { service } = build([lead('a', 'exp-002'), lead('b', 'exp-003')], [observation('500.0000')]);

    const report = await service.build('exp-001');

    expect(report.registrations).toBe(0);
    expect(report.verdicts).toEqual({ qualified: 0, disqualified: 0, pending: 0 });
    // Nothing to divide by — null, never 0 and never Infinity (C-006 §6.3).
    expect(report.costPerRegistration).toBeNull();
    expect(report.outOfScope.otherExperiments).toBe(2);
  });
});

describe('spend by campaign (C-006 §2.5)', () => {
  it('splits the total per campaign and keeps unassigned spend as its own line', async () => {
    const { service } = build(verdicts([['qualified', true]]), [
      observation('1000.0000', 'CZK', 'search'),
      observation('250.5000', 'CZK', 'display'),
      observation('99.5000', 'CZK', null),
    ]);

    const report = await service.build('exp-001');

    expect(report.spend.byCampaign).toEqual([
      { campaignId: 'search', total: '1000.0000', observations: 1 },
      { campaignId: 'display', total: '250.5000', observations: 1 },
      { campaignId: null, total: '99.5000', observations: 1 },
    ]);
    // The total is the sum of every line, unassigned included: the money left the account.
    expect(report.spend.total).toBe('1350.0000');
    expect(report.costPerRegistration).toBe('1350.00');
  });

  it('sums several entries for the same campaign exactly', async () => {
    const { service } = build(verdicts([['qualified', true]]), [
      { ...observation('0.1000', 'CZK', 'search'), observationId: 'obs-a' },
      { ...observation('0.2000', 'CZK', 'search'), observationId: 'obs-b' },
    ]);

    const report = await service.build('exp-001');

    expect(report.spend.byCampaign).toEqual([
      { campaignId: 'search', total: '0.3000', observations: 2 },
    ]);
    expect(report.spend.byCampaign[0].total).not.toContain('0.30000000000000004');
  });

  it('orders campaigns by spend, comparing decimals rather than text', async () => {
    // '9' sorts after '10' as text. Ordered as money, the larger campaign comes first.
    const { service } = build(verdicts([['qualified', true]]), [
      observation('9.0000', 'CZK', 'small'),
      observation('10.0000', 'CZK', 'large'),
    ]);

    const report = await service.build('exp-001');

    expect(report.spend.byCampaign.map((row) => row.campaignId)).toEqual(['large', 'small']);
  });

  it('shows no campaign breakdown at all when currencies are mixed', async () => {
    // Same reason the total is suppressed: a per-campaign figure adding CZK to EUR is wrong and
    // looks completely fine (C-006 §6.4).
    const { service } = build(verdicts([['qualified', true]]), [
      observation('100.0000', 'CZK', 'search'),
      observation('100.0000', 'EUR', 'search'),
    ]);

    const report = await service.build('exp-001');

    expect(report.spend.mixedCurrency).toBe(true);
    expect(report.spend.byCampaign).toEqual([]);
    expect(report.spend.total).toBeNull();
  });
});
