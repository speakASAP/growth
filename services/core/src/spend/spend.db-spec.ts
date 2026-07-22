import { Client } from 'pg';
import { DatabaseService } from '../db/database.service';
import { SpendRepository } from './spend.repository';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * Money is the reason this needs a real database. The duplicate-versus-conflict decision compares
 * amounts as NUMERIC inside Postgres, which no mock can honestly stand in for: '15000.00' and
 * '15000.0000' are the same money and different strings, and getting that backwards either rejects
 * a legitimate replay or silently accepts a changed figure.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';
const RUNTIME_DATABASE_URL =
  process.env.TEST_RUNTIME_DATABASE_URL ??
  'postgresql://growth_core:testpw@127.0.0.1:55432/growth_core_test';

let client: Client;
let runtime: Client;
let repository: SpendRepository;

beforeAll(async () => {
  client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  runtime = new Client({ connectionString: RUNTIME_DATABASE_URL });
  await runtime.connect();

  repository = new SpendRepository({
    query: (text: string, params?: unknown[]) => client.query(text, params as never),
  } as unknown as DatabaseService);
});

afterAll(async () => {
  await client.end();
  await runtime.end();
});

beforeEach(async () => {
  await client.query('TRUNCATE spend.manual_observation');
});

const observation = (overrides: Record<string, unknown> = {}) => ({
  observationId: 'obs-1',
  experimentId: 'exp-1',
  workspaceId: 'bazos',
  platform: 'google_ads',
  periodStart: '2026-07-21',
  periodEnd: '2026-07-21',
  amountValue: '15000.00',
  amountCurrency: 'CZK',
  evidenceReference: 'report-1',
  enteredBy: 'owner',
  enteredAt: '2026-07-22T08:00:00.000Z',
  ...overrides,
});

describe('storing an observation', () => {
  it('inserts and reads the amount back as an exact decimal string', async () => {
    expect(await repository.insert(observation())).toBe('inserted');

    const stored = await repository.findById('obs-1');
    expect(stored?.amountValue).toBe('15000.0000');
    expect(typeof stored?.amountValue).toBe('string');
  });

  it('keeps sub-unit precision that a float would round away', async () => {
    await repository.insert(observation({ amountValue: '0.0001' }));

    const stored = await repository.findById('obs-1');
    expect(stored?.amountValue).toBe('0.0001');
  });

  it('accepts a negative amount, which is a credit or a correction', async () => {
    expect(await repository.insert(observation({ amountValue: '-250.5' }))).toBe('inserted');
  });
});

describe('replay versus conflict', () => {
  it('reports an identical resubmission as a duplicate', async () => {
    await repository.insert(observation());
    expect(await repository.insert(observation())).toBe('duplicate');
  });

  // The comparison is decimal, not textual. Treating these as a conflict would reject a harmless
  // retry and make the owner think the figure did not land.
  it('treats 15000.00 and 15000.0000 as the same money', async () => {
    await repository.insert(observation({ amountValue: '15000.00' }));
    expect(await repository.insert(observation({ amountValue: '15000.0000' }))).toBe('duplicate');
  });

  // The dangerous case: the owner corrects a figure, reuses the id, and gets a cheerful success
  // while the stored spend is still the old value. Cost per lead would then be wrong silently.
  it('reports a changed amount under the same id as a conflict', async () => {
    await repository.insert(observation({ amountValue: '15000.00' }));
    expect(await repository.insert(observation({ amountValue: '16000.00' }))).toBe('conflict');
  });

  it('reports a changed period under the same id as a conflict', async () => {
    await repository.insert(observation());
    expect(await repository.insert(observation({ periodEnd: '2026-07-22' }))).toBe('conflict');
  });

  it('reports a changed currency under the same id as a conflict', async () => {
    await repository.insert(observation());
    expect(await repository.insert(observation({ amountCurrency: 'EUR' }))).toBe('conflict');
  });

  it('stores exactly one row however many times the same observation is submitted', async () => {
    await repository.insert(observation());
    await repository.insert(observation());
    await repository.insert(observation());

    const { rows } = await client.query('SELECT count(*)::int AS n FROM spend.manual_observation');
    expect(rows[0].n).toBe(1);
  });
});

describe('database-level guarantees', () => {
  it('refuses is_manual false — an owner-typed number is never invoice-reconciled', async () => {
    await expect(
      client.query(
        `INSERT INTO spend.manual_observation
           (observation_id, experiment_id, workspace_id, platform, period_start, period_end,
            amount_value, amount_currency, evidence_reference, entered_by, entered_at, is_manual)
         VALUES ('x','e','bazos','google_ads','2026-07-21','2026-07-21',1,'CZK','r','owner',now(),false)`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a period that ends before it starts', async () => {
    await expect(repository.insert(observation({ periodEnd: '2026-07-20' }))).rejects.toThrow();
  });

  it('refuses a blank evidence reference', async () => {
    await expect(repository.insert(observation({ evidenceReference: '  ' }))).rejects.toThrow();
  });

  it('refuses a currency that is not a three-letter code', async () => {
    await expect(repository.insert(observation({ amountCurrency: 'czk' }))).rejects.toThrow();
  });
});

describe('listing for an experiment', () => {
  it('omits observations a connector has superseded, keeping the row itself', async () => {
    await repository.insert(observation({ observationId: 'obs-1' }));
    await repository.insert(observation({ observationId: 'obs-2', periodStart: '2026-07-22', periodEnd: '2026-07-22' }));
    await client.query(
      `UPDATE spend.manual_observation SET superseded_by_observation_id = 'connector-1' WHERE observation_id = 'obs-1'`,
    );

    const items = await repository.listForExperiment('exp-1');
    expect(items.map((row) => row.observationId)).toEqual(['obs-2']);

    // Superseded, not deleted. Both remain visible to anyone who looks (C-006 §2.3).
    const { rows } = await client.query('SELECT count(*)::int AS n FROM spend.manual_observation');
    expect(rows[0].n).toBe(2);
  });

  it('returns amounts as decimal strings', async () => {
    await repository.insert(observation({ amountValue: '1234.5678' }));

    const items = await repository.listForExperiment('exp-1');
    expect(items[0].amountValue).toBe('1234.5678');
    expect(typeof items[0].amountValue).toBe('string');
  });
});

describe('the runtime role', () => {
  it('can insert and update — S8 must be able to mark an observation superseded', async () => {
    await expect(
      runtime.query(
        `INSERT INTO spend.manual_observation
           (observation_id, experiment_id, workspace_id, platform, period_start, period_end,
            amount_value, amount_currency, evidence_reference, entered_by, entered_at)
         VALUES ('rt-1','e','bazos','google_ads','2026-07-21','2026-07-21',1,'CZK','r','owner',now())`,
      ),
    ).resolves.toBeDefined();

    await expect(
      runtime.query(
        `UPDATE spend.manual_observation SET superseded_by_observation_id = 'c-1' WHERE observation_id = 'rt-1'`,
      ),
    ).resolves.toBeDefined();
  });
});
