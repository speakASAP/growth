import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../db/database.service';
import { DecisionRepository } from './decision.repository';
import { DecisionService } from './decision.service';
import { canonicalHashOf } from './canonical-hash';
import { budgetChangeFixture, launchFixture, stopFixture } from './__fixtures__/artefacts';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 * These cover the C-001 section 8 rows that need real storage: the immutability trigger,
 * the partial unique indexes, and the cross-record budget-chain rules.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';

const config = { get: (key: string) => (key === 'DATABASE_URL' ? TEST_DATABASE_URL : undefined) };

let db: DatabaseService;
let repo: DecisionRepository;
let service: DecisionService;

beforeAll(async () => {
  db = new DatabaseService(config as unknown as ConfigService);
  db.onModuleInit();
  repo = new DecisionRepository(db);
  service = new DecisionService(repo);
});

afterAll(async () => {
  await db.onModuleDestroy();
});

beforeEach(async () => {
  // TRUNCATE, not DELETE: the trigger rejects row-level DELETE, which is the point.
  await db.query('TRUNCATE governance.decision_artefact');
});

/** uuid v4-shaped ids, distinct per call, so fixtures can be reused within one test. */
let counter = 0;
const nextId = () => `3f2504e0-4f89-11d3-9a0c-${String(++counter).padStart(12, '0')}`;

describe('decision record — storage rules (C-001 section 8)', () => {
  describe('immutability', () => {
    it('rejects a direct UPDATE at the database, not just in the application', async () => {
      const launch = launchFixture();
      await service.record(launch);
      await expect(repo.rawUpdateAttempt(launch.decisionArtefactId)).rejects.toThrow(/append-only/);
    });

    it('rejects a direct DELETE', async () => {
      const launch = launchFixture();
      await service.record(launch);
      await expect(repo.rawDeleteAttempt(launch.decisionArtefactId)).rejects.toThrow(/append-only/);
    });

    it('leaves the row unchanged after a rejected mutation', async () => {
      const launch = launchFixture();
      await service.record(launch);
      await repo.rawUpdateAttempt(launch.decisionArtefactId).catch(() => undefined);
      const stored = await repo.findById(launch.decisionArtefactId);
      expect(stored?.decidedById).toBe('ssf');
    });
  });

  describe('idempotency and conflict', () => {
    it('writes once and reports a duplicate on resubmission', async () => {
      const launch = launchFixture();
      expect((await service.record(launch)).status).toBe('created');
      expect((await service.record(launch)).status).toBe('duplicate');

      const { rows } = await db.query('SELECT count(*)::int AS n FROM governance.decision_artefact');
      expect(rows[0].n).toBe(1);
    });

    it('treats the same id with different content as a conflict, never an overwrite', async () => {
      const launch = launchFixture();
      await service.record(launch);
      const outcome = await service.record({ ...launch, rationale: 'rewritten after the fact' });
      expect(outcome.status).toBe('conflict');
    });

    it('stores the server-computed hash', async () => {
      const launch = launchFixture();
      await service.record(launch);
      const stored = await repo.findById(launch.decisionArtefactId);
      expect(stored?.canonicalHash).toBe(canonicalHashOf(launch));
    });

    it('rejects a supplied hash that disagrees with the computed one', async () => {
      const outcome = await service.record({ ...launchFixture(), canonicalHash: 'b'.repeat(64) });
      expect(outcome.status).toBe('invalid');
    });

    it('accepts a supplied hash that agrees', async () => {
      const launch = launchFixture();
      const outcome = await service.record({ ...launch, canonicalHash: canonicalHashOf(launch) });
      expect(outcome.status).toBe('created');
    });
  });

  describe('V5 — a stop or change must reference a launch', () => {
    it('rejects a stop with no prior launch', async () => {
      const outcome = await service.record(stopFixture());
      expect(outcome.status).toBe('invalid');
    });

    it('accepts a stop once the launch exists', async () => {
      await service.record(launchFixture());
      expect((await service.record(stopFixture())).status).toBe('created');
    });

    it('rejects a second launch for the same experiment version', async () => {
      await service.record(launchFixture());
      const outcome = await service.record(launchFixture({ decisionArtefactId: nextId() }));
      expect(outcome.status).toBe('conflict');
    });

    it('allows a launch for a different experiment version', async () => {
      await service.record(launchFixture());
      const outcome = await service.record(
        launchFixture({ decisionArtefactId: nextId(), experimentVersion: 'v2' }),
      );
      expect(outcome.status).toBe('created');
    });
  });

  describe('V10 — planned action window', () => {
    it('rejects endAt equal to or before startAt', async () => {
      const outcome = await service.record(
        launchFixture({
          plannedAction: {
            platform: 'google_ads',
            budgetCap: { value: '1000.00', currency: 'CZK' },
            startAt: '2026-07-27T00:00:00Z',
            endAt: '2026-07-20T00:00:00Z',
          },
        }),
      );
      expect(outcome.status).toBe('invalid');
    });
  });

  describe('V6/V7 — the budget chain is verifiable, not asserted', () => {
    beforeEach(async () => {
      await service.record(launchFixture());
    });

    it('accepts a change whose previousBudgetCap matches the launch', async () => {
      expect((await service.record(budgetChangeFixture())).status).toBe('created');
    });

    it('tolerates equivalent decimal spellings of the same amount', async () => {
      const outcome = await service.record(
        budgetChangeFixture({ previousBudgetCap: { value: '1000', currency: 'CZK' } }),
      );
      expect(outcome.status).toBe('created');
    });

    it('rejects a change whose previousBudgetCap disagrees with the record', async () => {
      const outcome = await service.record(
        budgetChangeFixture({ previousBudgetCap: { value: '9999.00', currency: 'CZK' } }),
      );
      expect(outcome.status).toBe('invalid');
    });

    it('rejects a change superseding an artefact that does not exist', async () => {
      const outcome = await service.record(budgetChangeFixture({ supersedesArtefactId: nextId() }));
      expect(outcome.status).toBe('invalid');
    });

    it('rejects a change superseding an artefact from another experiment', async () => {
      const other = launchFixture({ decisionArtefactId: nextId(), experimentId: 'exp-999' });
      await service.record(other);
      const outcome = await service.record(
        budgetChangeFixture({ supersedesArtefactId: other.decisionArtefactId }),
      );
      expect(outcome.status).toBe('invalid');
    });

    it('rejects superseding a stop, which establishes no cap', async () => {
      const stop = stopFixture();
      await service.record(stop);
      const outcome = await service.record(
        budgetChangeFixture({ supersedesArtefactId: stop.decisionArtefactId }),
      );
      expect(outcome.status).toBe('invalid');
    });

    it('chains a second change onto the first', async () => {
      const first = budgetChangeFixture();
      await service.record(first);
      const second = budgetChangeFixture({
        decisionArtefactId: nextId(),
        supersedesArtefactId: first.decisionArtefactId,
        previousBudgetCap: first.newBudgetCap,
        newBudgetCap: { value: '4000.00', currency: 'CZK' },
      });
      expect((await service.record(second)).status).toBe('created');
    });

    it('refuses to fork the chain — a cap is superseded at most once', async () => {
      await service.record(budgetChangeFixture());
      const fork = budgetChangeFixture({
        decisionArtefactId: nextId(),
        newBudgetCap: { value: '7000.00', currency: 'CZK' },
      });
      const outcome = await service.record(fork);
      expect(outcome.status).toBe('invalid');
    });

    it('V8 — rejects a cap in a different currency from the launch', async () => {
      const outcome = await service.record(
        budgetChangeFixture({ newBudgetCap: { value: '100.00', currency: 'EUR' } }),
      );
      expect(outcome.status).toBe('invalid');
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of two simultaneous launches win', async () => {
      const outcomes = await Promise.all([
        service.record(launchFixture({ decisionArtefactId: nextId() })),
        service.record(launchFixture({ decisionArtefactId: nextId() })),
      ]);
      expect(outcomes.filter((o) => o.status === 'created')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === 'conflict')).toHaveLength(1);
    });

    it('lets exactly one of two simultaneous changes supersede the same cap', async () => {
      await service.record(launchFixture());
      const outcomes = await Promise.all([
        service.record(budgetChangeFixture({ decisionArtefactId: nextId() })),
        service.record(
          budgetChangeFixture({
            decisionArtefactId: nextId(),
            newBudgetCap: { value: '3000.00', currency: 'CZK' },
          }),
        ),
      ]);
      expect(outcomes.filter((o) => o.status === 'created')).toHaveLength(1);
      expect(outcomes.filter((o) => o.status !== 'created')).toHaveLength(1);
    });
  });

  describe('reading the story back', () => {
    it('returns launch, change and stop in decided order', async () => {
      await service.record(launchFixture());
      await service.record(budgetChangeFixture());
      await service.record(stopFixture());

      const story = await service.listForExperiment('exp-001');
      expect(story.map((a) => a.decisionType)).toEqual([
        'experiment.launch',
        'experiment.budget_change',
        'experiment.stop',
      ]);
    });

    it('scopes to an experiment version when asked', async () => {
      await service.record(launchFixture());
      await service.record(launchFixture({ decisionArtefactId: nextId(), experimentVersion: 'v2' }));
      expect(await service.listForExperiment('exp-001', 'v2')).toHaveLength(1);
    });
  });

  describe('PII', () => {
    // Scans the operator-authored fields only. Timestamps, uuids and the hash are machine
    // generated and structurally cannot carry PII — including them just produced false
    // positives (an ISO date reads as a phone number to any digit-run pattern).
    const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
    const PHONE = /\+\d[\d\s()-]{7,}\d|\b\d{9,}\b/;

    const freeText = (artefact: Record<string, unknown>): string =>
      [artefact.hypothesis, artefact.rationale, artefact.reason, ...((artefact.evidenceReferences as string[]) ?? [])]
        .filter((v): v is string => typeof v === 'string')
        .join('\n');

    it('stores no email or phone in operator-authored fields', async () => {
      await service.record(launchFixture({ evidenceReferences: ['touchpoint:abc', 'touchpoint:def'] }));
      await service.record(stopFixture());

      const { rows } = await db.query<{ body: Record<string, unknown> }>(
        'SELECT body FROM governance.decision_artefact',
      );
      const authored = rows.map((r) => freeText(r.body)).join('\n');

      expect(authored).not.toMatch(EMAIL);
      expect(authored).not.toMatch(PHONE);
    });

    it('the scan would catch PII if it were there', async () => {
      // A guard that cannot fail proves nothing — this pins that the patterns actually bite.
      expect(freeText({ reason: 'owner asked at seller@example.com' })).toMatch(EMAIL);
      expect(freeText({ reason: 'called +420 777 123 456 to confirm' })).toMatch(PHONE);
    });
  });
});
