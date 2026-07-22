import { ExperimentReportService } from './experiment-report.service';

type Verdict = { leadId: string; verdict: 'qualified' | 'disqualified' | 'pending'; attributed: boolean };

function observation(amountValue: string, amountCurrency = 'CZK') {
  return {
    observationId: `obs-${amountValue}-${amountCurrency}`,
    experimentId: 'exp-001',
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
  spec.map(([verdict, attributed], i) => ({ leadId: `lead-${i}`, verdict, attributed }));

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
