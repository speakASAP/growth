import type { ExperimentReport } from './experiment-report.service';
import { renderExperimentScreen } from './render';

const base: ExperimentReport = {
  experimentId: 'exp-001',
  workspaceId: 'bazos',
  generatedAt: '2026-07-22T12:00:00.000Z',
  currency: 'CZK',
  spend: { total: '15000.0000', observations: 1, mixedCurrency: false },
  registrations: 24,
  attribution: { attributed: 19, unattributed: 5 },
  verdicts: { qualified: 7, disqualified: 11, pending: 6 },
  costPerRegistration: '625.00',
  costPerQualifiedLead: '2142.86',
};

const render = (overrides: Partial<ExperimentReport> = {}) =>
  renderExperimentScreen({ ...base, ...overrides });

describe('renderExperimentScreen', () => {
  it('shows both cost metrics', () => {
    const html = render();
    expect(html).toContain('625.00');
    expect(html).toContain('2142.86');
  });

  it('always shows the attributed/unattributed split (C-006 §6.5)', () => {
    // The split is the part most likely to be dropped as an afterthought, and it is the part that
    // prevents a wrong kill decision. A renderer without it is non-conforming.
    const html = render();
    expect(html).toMatch(/attributed/i);
    expect(html).toMatch(/unattributed/i);
    expect(html).toContain('>19<');
    expect(html).toContain('>5<');
  });

  it('states why unattributed conversions exist rather than leaving a bare number', () => {
    expect(render()).toMatch(/consent/i);
  });

  it('renders a null cost metric as an em dash, never as 0 or NaN', () => {
    const html = render({ costPerQualifiedLead: null, verdicts: { qualified: 0, disqualified: 0, pending: 24 } });
    expect(html).toContain('—');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('says why the cost metrics are absent when currencies are mixed (C-006 §6.4)', () => {
    const html = render({
      currency: null,
      spend: { total: null, observations: 2, mixedCurrency: true },
      costPerRegistration: null,
      costPerQualifiedLead: null,
    });
    expect(html).toMatch(/more than one currency/i);
  });

  it('shows pending and says it counts against cost', () => {
    const html = render();
    expect(html).toContain('>6<');
    expect(html).toMatch(/counted against cost|counts against cost/i);
  });

  it('names the workspace scope so the experiment/workspace gap is visible (C-006 §6.6)', () => {
    expect(render()).toContain('bazos');
  });

  it('offers a spend entry form posting to this experiment', () => {
    const html = render();
    expect(html).toContain('<form');
    expect(html).toContain('/experiments/exp-001/spend');
    expect(html).toContain('name="amountValue"');
    expect(html).toContain('name="evidenceReference"');
  });

  it('escapes values rather than interpolating them into the page', () => {
    const html = render({ experimentId: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not render money through a float', () => {
    // 0.1 + 0.2 style drift reaching the screen would mean a Number crept into the path.
    const html = render({ spend: { total: '0.3000', observations: 2, mixedCurrency: false } });
    expect(html).toContain('0.3000');
    expect(html).not.toContain('0.30000000000000004');
  });
});
