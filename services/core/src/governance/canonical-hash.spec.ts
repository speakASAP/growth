import canonicalize from 'canonicalize';
import { canonicalHashOf, hashInput } from './canonical-hash';
import { launchFixture, stopFixture } from './__fixtures__/artefacts';

describe('canonical hash (C-001 section 3)', () => {
  describe('JCS canonicalisation', () => {
    it('orders keys lexicographically', () => {
      expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    it('emits no insignificant whitespace', () => {
      expect(canonicalize({ a: [1, 2], b: { c: 3 } })).toBe('{"a":[1,2],"b":{"c":3}}');
    });

    it('orders nested keys too', () => {
      expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}');
    });

    it('uses ES6 number serialisation', () => {
      expect(canonicalize({ n: 1.0 })).toBe('{"n":1}');
      expect(canonicalize({ n: 1e30 })).toBe('{"n":1e+30}');
    });

    it('preserves array order — evidenceReferences is a list, not a set', () => {
      expect(canonicalize({ a: ['b', 'a'] })).toBe('{"a":["b","a"]}');
    });
  });

  describe('hash input', () => {
    it('removes canonicalHash entirely rather than blanking it', () => {
      const input = hashInput({ ...launchFixture(), canonicalHash: 'a'.repeat(64) });
      expect('canonicalHash' in input).toBe(false);
    });

    // The distinction that would silently split two implementations: a blanked key still
    // contributes itself to the canonical form, a deleted one does not.
    it('a blanked canonicalHash would produce a different hash than a removed one', () => {
      const artefact = launchFixture();
      const removed = canonicalize(hashInput(artefact));
      const blanked = canonicalize({ ...hashInput(artefact), canonicalHash: '' });
      expect(removed).not.toBe(blanked);
    });
  });

  describe('hash properties', () => {
    it('is stable across repeated runs', () => {
      const artefact = launchFixture();
      expect(canonicalHashOf(artefact)).toBe(canonicalHashOf(artefact));
    });

    it('is independent of key order in the input object', () => {
      const artefact = launchFixture();
      const reordered = Object.fromEntries(Object.entries(artefact).reverse());
      expect(canonicalHashOf(reordered)).toBe(canonicalHashOf(artefact));
    });

    it('ignores a pre-existing canonicalHash on the input', () => {
      const artefact = launchFixture();
      const bare = canonicalHashOf(artefact);
      expect(canonicalHashOf({ ...artefact, canonicalHash: 'f'.repeat(64) })).toBe(bare);
    });

    it('changes when any field changes', () => {
      const artefact = launchFixture();
      const base = canonicalHashOf(artefact);
      expect(canonicalHashOf({ ...artefact, rationale: 'something else' })).not.toBe(base);
      expect(canonicalHashOf({ ...artefact, decidedById: 'someone-else' })).not.toBe(base);
      expect(
        canonicalHashOf({
          ...artefact,
          plannedAction: { ...artefact.plannedAction, budgetCap: { value: '2000.00', currency: 'CZK' } },
        }),
      ).not.toBe(base);
    });

    it('distinguishes two artefact types that share their common fields', () => {
      expect(canonicalHashOf(launchFixture())).not.toBe(canonicalHashOf(stopFixture()));
    });

    it('produces 64 lowercase hex characters', () => {
      expect(canonicalHashOf(launchFixture())).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
