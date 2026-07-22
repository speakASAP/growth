import { createHmac } from 'crypto';

/**
 * The landing runtime's pure decisions (EP-005 W2, C-005 §2.1 and §4).
 *
 * Kept free of I/O because the two things most easily got wrong here — the cookie's scope and
 * whether consent actually permits a recording — both fail silently. A cookie on the wrong host
 * produces empty attribution that reports healthy; a touchpoint emitted without consent produces
 * data that should never have existed and cannot be un-collected.
 */

export const GSID_COOKIE = 'gsid';

/**
 * The landing is served under `bazos.alfares.cz` (F-005 Q1) precisely so this cookie reaches
 * `bazos-service`, which reads it server-side when the visitor clicks through to registration.
 * Changing this host silently empties attribution — see D-005 for the last time that happened.
 */
export const GSID_COOKIE_DOMAIN = 'bazos.alfares.cz';

/** 90 days — the window in which a visit may still be credited for a registration (C-005 §4). */
export const GSID_COOKIE_MAX_AGE_SECONDS = 7_776_000;

/** Purposes that exist without asking. Consent to these is not consent to being measured. */
const NECESSARY_PURPOSE = 'necessary';

export interface ConsentDecision {
  consentRecordId: string;
  version: number;
  categories: Record<string, boolean>;
  decidedAt: string;
}

export interface ConsentEvidence {
  consentRecordId: string;
  consentVersion: number;
  applicablePurposes: string[];
  statusAtEventTime: 'granted' | 'denied' | 'withdrawn' | 'not_required';
  evaluatedAt: string;
}

export function mintGsid(sessionId: string, secret: string): string {
  if (!secret) throw new Error('[MISSING: GROWTH_GSID_HMAC_SECRET] — cannot mint gsid');
  const signature = createHmac('sha256', secret).update(sessionId).digest();
  return `${b64(sessionId)}.${b64(signature)}`;
}

export function buildGsidCookie(sessionId: string, secret: string): string {
  return [
    `${GSID_COOKIE}=${mintGsid(sessionId, secret)}`,
    `Domain=${GSID_COOKIE_DOMAIN}`,
    'Path=/',
    `Max-Age=${GSID_COOKIE_MAX_AGE_SECONDS}`,
    'Secure',
    'SameSite=Lax',
    // Nothing in the browser reads this; bazos-service takes it from the request header. Keeping
    // it out of script removes a whole class of theft from an XSS anywhere on the host.
    'HttpOnly',
  ].join('; ');
}

/**
 * Turns a stored decision into the reference C-005 §2.1 asks for — never a copy of the record.
 * Copying it would duplicate a legal artefact across thousands of events, every one of which
 * would then have to be corrected if the record ever were.
 */
export function consentEvidenceFrom(decision: ConsentDecision): ConsentEvidence {
  const granted = Object.entries(decision.categories)
    .filter(([, allowed]) => allowed)
    .map(([purpose]) => purpose);

  // Necessary-only is a refusal. Counting it as consent would let the strictly-necessary
  // exemption launder the analytics purpose the visitor actually declined.
  const beyondNecessary = granted.filter((purpose) => purpose !== NECESSARY_PURPOSE);

  return {
    consentRecordId: decision.consentRecordId,
    consentVersion: decision.version,
    applicablePurposes: granted,
    statusAtEventTime: beyondNecessary.length > 0 ? 'granted' : 'denied',
    evaluatedAt: decision.decidedAt,
  };
}

export interface TouchpointInput {
  sessionId: string;
  experimentId: string;
  experimentVersion: string;
  landingVersionId: string;
  workspaceId: string;
  query: Record<string, string | undefined>;
  referrer?: string;
  consent: ConsentDecision;
  now: Date;
  eventId: string;
}

export function buildTouchpointEnvelope(input: TouchpointInput) {
  if (!input.sessionId?.trim()) {
    // A session exists only after consent. Building without one would record a visit nobody
    // permitted to be recorded.
    throw new Error('cannot build a touchpoint without a sessionId');
  }

  const consentEvidence = consentEvidenceFrom(input.consent);
  if (consentEvidence.statusAtEventTime !== 'granted') {
    throw new Error('cannot build a touchpoint when consent was not granted');
  }

  const payload: Record<string, unknown> = {
    sessionId: input.sessionId,
    experimentId: input.experimentId,
    experimentVersion: input.experimentVersion,
    landingVersionId: input.landingVersionId,
    consentEvidence,
  };

  // Absent rather than empty or null: the schema forbids unknown shapes, and growth-core answers
  // 400 on anything it does not recognise — which would drop the touchpoint silently.
  const gclid = input.query.gclid?.trim();
  if (gclid) payload.gclid = gclid;

  const utm = compactUtm(input.query);
  if (utm) payload.utm = utm;

  const referrer = input.referrer?.trim();
  if (referrer) payload.referrer = referrer;

  return {
    eventId: input.eventId,
    eventType: 'growth.touchpoint.observed.v1',
    eventVersion: 1,
    occurredAt: input.now.toISOString(),
    producer: 'growth-web',
    workspaceId: input.workspaceId,
    // The session is the only handle an anonymous visitor has; it ties this touchpoint to the
    // click and the registration that may follow.
    correlationId: input.sessionId,
    dataClass: 'anonymous',
    payload,
  };
}

function compactUtm(query: Record<string, string | undefined>) {
  const utm: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content'] as const) {
    const value = query[`utm_${key}`]?.trim();
    if (value) utm[key] = value;
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

function b64(value: string | Buffer): string {
  return Buffer.from(value as never).toString('base64url');
}
