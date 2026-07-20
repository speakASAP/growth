import { createHash } from 'crypto';
import canonicalize from 'canonicalize';

/**
 * Canonical hash of a DecisionArtefact — C-001 section 3, decided in D-004 section 3.
 *
 * RFC 8785 (JCS) rather than hand-rolled ordering rules: the readers of this contract are
 * multiple agents starting cold, and a divergent canonicaliser silently invalidates every
 * artefact written by the other implementation. An external standard can be checked against
 * its own published test vectors; prose rules can only be checked against our description
 * of our intent.
 */

/**
 * `canonicalHash` is REMOVED from the hash input, not blanked.
 *
 * Blanking would still contribute the key itself to the canonical form, so an implementation
 * that blanked and one that deleted would disagree on every artefact — the exact class of
 * divergence this contract exists to prevent.
 */
export function hashInput<T extends object>(artefact: T): Omit<T, 'canonicalHash'> {
  const { canonicalHash: _omitted, ...rest } = artefact as T & { canonicalHash?: unknown };
  return rest as Omit<T, 'canonicalHash'>;
}

export function canonicalHashOf(artefact: object): string {
  const canonical = canonicalize(hashInput(artefact));
  if (canonical === undefined) {
    // canonicalize() returns undefined for values JSON cannot represent (a bare
    // undefined, a function). Reaching here means the artefact never passed schema
    // validation, so fail loudly rather than hashing a coerced shape.
    throw new Error('artefact is not canonicalisable');
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
