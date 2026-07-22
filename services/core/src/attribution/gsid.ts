import { createHmac, timingSafeEqual } from 'crypto';

/**
 * C-005 §4 — the signed anonymous-session token.
 *
 * ```
 * gsid = base64url(sessionId) + "." + base64url(HMAC-SHA256(sessionId, secret))
 * ```
 *
 * The signature is what separates a real touchpoint from one a visitor typed into their own URL.
 * An accepted forgery does not look like a bug: it looks like a conversion, and it flows into the
 * budget decisions this whole system exists to inform.
 */

export type GsidVerification =
  | { status: 'valid'; sessionId: string }
  /** Consent refused, cookie cleared, or a direct visit. Expected, not an error. */
  | { status: 'absent' }
  | { status: 'forged' };

export function mintGsid(sessionId: string, secret: string): string {
  requireSecret(secret);
  return `${b64(sessionId)}.${b64(sign(sessionId, secret))}`;
}

export function verifyGsid(gsid: string | undefined | null, secret: string): GsidVerification {
  requireSecret(secret);

  const raw = gsid?.trim();
  if (!raw) return { status: 'absent' };

  // Exactly two segments. Splitting loosely and taking the first two would let `a.b.c` verify as
  // `a.b`, so a forged token could carry anything it liked in a third segment.
  const parts = raw.split('.');
  if (parts.length !== 2) return { status: 'forged' };

  const [encodedSession, encodedSignature] = parts;
  let sessionId: string;
  let signature: Buffer;
  try {
    sessionId = Buffer.from(encodedSession, 'base64url').toString('utf8');
    signature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return { status: 'forged' };
  }

  // An empty session would link every unattributed visitor to the same identity.
  if (!sessionId) return { status: 'forged' };

  const expected = sign(sessionId, secret);
  // Length first: timingSafeEqual throws when the buffers differ in size, and a malformed token
  // must be rejected rather than crash the consumer handling the rest of the batch.
  if (signature.length !== expected.length) return { status: 'forged' };
  if (!timingSafeEqual(signature, expected)) return { status: 'forged' };

  return { status: 'valid', sessionId };
}

function sign(sessionId: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(sessionId).digest();
}

function b64(value: string | Buffer): string {
  return Buffer.from(value as never).toString('base64url');
}

function requireSecret(secret: string): void {
  // Never degrade to "no secret means everything verifies". A missing secret is an outage, and an
  // outage must not quietly become accepted forgeries.
  if (!secret) throw new Error('[MISSING: GROWTH_GSID_HMAC_SECRET] — cannot verify gsid');
}
