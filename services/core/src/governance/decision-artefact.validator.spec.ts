import { validateArtefactShape } from './decision-artefact.validator';
import { budgetChangeFixture, launchFixture, stopFixture } from './__fixtures__/artefacts';

const ok = (candidate: unknown) => validateArtefactShape(candidate).length === 0;

describe('artefact shape validation (C-001 rules V1-V4, V9, V12)', () => {
  it('accepts each of the three artefact types', () => {
    expect(ok(launchFixture())).toBe(true);
    expect(ok(stopFixture())).toBe(true);
    expect(ok(budgetChangeFixture())).toBe(true);
  });

  describe('V1 — decisionType', () => {
    it('rejects an unknown decision type', () => {
      expect(ok({ ...launchFixture(), decisionType: 'experiment.pause' })).toBe(false);
    });
  });

  describe('V2 — fields not permitted for the type', () => {
    it('rejects a stop carrying plannedAction', () => {
      expect(ok({ ...stopFixture(), plannedAction: launchFixture().plannedAction })).toBe(false);
    });

    it('rejects a stop carrying hypothesis', () => {
      expect(ok({ ...stopFixture(), hypothesis: 'nothing is being proposed' })).toBe(false);
    });

    it('rejects any unknown field', () => {
      expect(ok({ ...launchFixture(), notes: 'freeform' })).toBe(false);
    });
  });

  describe('V3/V4 — blank is rejected, never defaulted', () => {
    it.each(['', '   ', '\t\n'])('rejects a stop reason of %j', (reason) => {
      expect(ok(stopFixture({ reason }))).toBe(false);
    });

    it('rejects a missing stop reason', () => {
      const { reason: _dropped, ...withoutReason } = stopFixture();
      expect(ok(withoutReason)).toBe(false);
    });

    it('rejects a blank hypothesis or rationale', () => {
      expect(ok(launchFixture({ hypothesis: '  ' }))).toBe(false);
      expect(ok(launchFixture({ rationale: '' }))).toBe(false);
    });

    it('rejects a blank budget-change reason', () => {
      expect(ok(budgetChangeFixture({ reason: ' ' }))).toBe(false);
    });
  });

  describe('V9 — timestamps are UTC with a Z suffix', () => {
    it('rejects an offset timestamp, because JCS would hash it differently', () => {
      expect(ok(launchFixture({ decidedAt: '2026-07-19T16:03:11+02:00' }))).toBe(false);
    });

    it('rejects fractional seconds', () => {
      expect(ok(launchFixture({ decidedAt: '2026-07-19T14:03:11.123Z' }))).toBe(false);
    });

    it('accepts a plain UTC timestamp', () => {
      expect(ok(launchFixture({ decidedAt: '2026-07-19T14:03:11Z' }))).toBe(true);
    });
  });

  describe('money', () => {
    it('rejects a numeric amount — cents are lost in IEEE-754', () => {
      expect(
        ok(
          launchFixture({
            plannedAction: {
              ...launchFixture().plannedAction,
              budgetCap: { value: 1000, currency: 'CZK' } as never,
            },
          }),
        ),
      ).toBe(false);
    });

    it('rejects a negative cap', () => {
      expect(
        ok(
          launchFixture({
            plannedAction: {
              ...launchFixture().plannedAction,
              budgetCap: { value: '-10', currency: 'CZK' },
            },
          }),
        ),
      ).toBe(false);
    });

    it('rejects a lower-case or malformed currency code', () => {
      expect(
        ok(
          launchFixture({
            plannedAction: {
              ...launchFixture().plannedAction,
              budgetCap: { value: '10', currency: 'czk' },
            },
          }),
        ),
      ).toBe(false);
    });
  });

  describe('V12 — decidedByType', () => {
    it('rejects a non-human decider at MS-002', () => {
      expect(ok({ ...launchFixture(), decidedByType: 'agent' })).toBe(false);
    });
  });

  describe('canonicalHash format', () => {
    it('accepts a well-formed lowercase hex hash', () => {
      expect(ok({ ...launchFixture(), canonicalHash: 'a'.repeat(64) })).toBe(true);
    });

    it('rejects uppercase or short hashes', () => {
      expect(ok({ ...launchFixture(), canonicalHash: 'A'.repeat(64) })).toBe(false);
      expect(ok({ ...launchFixture(), canonicalHash: 'abc' })).toBe(false);
    });
  });

  describe('evidence references', () => {
    it('accepts populated pointers', () => {
      expect(ok(launchFixture({ evidenceReferences: ['touchpoint:abc', 'touchpoint:def'] }))).toBe(true);
    });

    it('requires the field even when empty', () => {
      const { evidenceReferences: _dropped, ...without } = launchFixture();
      expect(ok(without)).toBe(false);
    });
  });
});
