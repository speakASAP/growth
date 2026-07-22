import { GSID_COOKIE, buildGsidCookie, buildTouchpointEnvelope, consentEvidenceFrom } from './landing';

/**
 * The landing's two jobs that are easy to get quietly wrong: what it writes to the visitor's
 * browser, and what it tells growth-core about the consent behind it.
 *
 * A cookie with the wrong `Domain` is the failure this slice has already been bitten by once
 * (D-005): everything reports healthy and attribution is empty forever, because the host that
 * reads the cookie is not the host that set it.
 */
const SECRET = 'test-secret-not-the-production-one';

describe('buildGsidCookie', () => {
  const cookie = () => buildGsidCookie('session-1', SECRET);

  it('is scoped to the host that reads it, not the host that sets it', () => {
    // bazos-service reads this cookie server-side when the visitor clicks through to auth. The
    // landing is served under bazos.alfares.cz for exactly this reason (F-005 Q1); a cookie on
    // any other host would never arrive and the gsid would be permanently absent.
    expect(cookie()).toContain('Domain=bazos.alfares.cz');
    expect(cookie()).toContain('Path=/');
  });

  it('carries the C-005 §4 attributes', () => {
    expect(cookie()).toContain('Secure');
    expect(cookie()).toContain('SameSite=Lax');
    // 90 days: the window in which a visit can still be credited for a registration.
    expect(cookie()).toContain('Max-Age=7776000');
  });

  it('is not readable from JavaScript', () => {
    // Nothing in the browser needs it: bazos reads it server-side from the request. Withholding
    // it from script removes a whole class of theft from an XSS on any page of the host.
    expect(cookie()).toContain('HttpOnly');
  });

  it('carries a signed value, never the bare session id', () => {
    const value = cookie().split(';')[0].slice(`${GSID_COOKIE}=`.length);
    expect(value).toContain('.');
    expect(value).not.toBe('session-1');
  });
});

describe('consentEvidenceFrom', () => {
  const decision = {
    consentRecordId: '5f1c2d3e-0000-4000-8000-000000000001',
    version: 3,
    categories: { necessary: true, analytics: true, marketing: false },
    decidedAt: '2026-07-22T09:00:00.000Z',
  };

  it('references the consent record rather than copying it', () => {
    // C-005 §2.1 is explicit: a reference, never a copied consent record. Copying it would
    // duplicate a legal artefact into thousands of events, each of which would then have to be
    // corrected if the record ever were.
    const evidence = consentEvidenceFrom(decision);
    expect(evidence.consentRecordId).toBe(decision.consentRecordId);
    expect(evidence).not.toHaveProperty('categories');
  });

  it('lists only the purposes the visitor actually granted', () => {
    expect(consentEvidenceFrom(decision).applicablePurposes).toEqual(['necessary', 'analytics']);
  });

  it('reports granted when an optional purpose was accepted', () => {
    expect(consentEvidenceFrom(decision).statusAtEventTime).toBe('granted');
  });

  it('reports denied when nothing beyond the necessary minimum was accepted', () => {
    // Necessary-only is not consent to being measured. Treating it as `granted` would let the
    // strictly-necessary exemption launder an analytics purpose the visitor refused.
    const necessaryOnly = { ...decision, categories: { necessary: true, analytics: false } };
    expect(consentEvidenceFrom(necessaryOnly).statusAtEventTime).toBe('denied');
  });

  it('carries the version as a number, so an ordering comparison means something', () => {
    expect(consentEvidenceFrom(decision).consentVersion).toBe(3);
  });
});

describe('buildTouchpointEnvelope', () => {
  const args = {
    sessionId: 'session-1',
    experimentId: 'exp-001',
    experimentVersion: 'v1',
    landingVersionId: 'landing-a-2026-07-22',
    workspaceId: 'bazos',
    query: { gclid: 'CjwK', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'furniture-praha' },
    referrer: 'https://www.google.com/',
    consent: {
      consentRecordId: '5f1c2d3e-0000-4000-8000-000000000001',
      version: 3,
      categories: { necessary: true, analytics: true },
      decidedAt: '2026-07-22T09:00:00.000Z',
    },
    now: new Date('2026-07-22T09:00:01.000Z'),
    eventId: '9f1c2d3e-0000-4000-8000-000000000002',
  };

  it('builds the envelope the contract pins', () => {
    const envelope = buildTouchpointEnvelope(args);
    expect(envelope).toMatchObject({
      eventType: 'growth.touchpoint.observed.v1',
      eventVersion: 1,
      producer: 'growth-web',
      workspaceId: 'bazos',
      dataClass: 'anonymous',
    });
    expect(envelope.correlationId).toBe('session-1');
  });

  it('carries the click id and utm parameters the ad platform supplied', () => {
    const { payload } = buildTouchpointEnvelope(args);
    expect(payload.gclid).toBe('CjwK');
    expect(payload.utm).toEqual({ source: 'google', medium: 'cpc', campaign: 'furniture-praha' });
  });

  it('omits utm entirely rather than sending an empty object', () => {
    const { payload } = buildTouchpointEnvelope({ ...args, query: {} });
    expect(payload).not.toHaveProperty('utm');
    expect(payload).not.toHaveProperty('gclid');
  });

  it('omits the referrer when the visitor arrived without one', () => {
    const { payload } = buildTouchpointEnvelope({ ...args, referrer: undefined });
    expect(payload).not.toHaveProperty('referrer');
  });

  it('carries no contact detail of any kind — the visitor is anonymous here', () => {
    const { payload } = buildTouchpointEnvelope(args);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'consentEvidence',
        'experimentId',
        'experimentVersion',
        'gclid',
        'landingVersionId',
        'referrer',
        'sessionId',
        'utm',
      ].sort(),
    );
  });

  it('refuses to build without a session, which only exists after consent', () => {
    // sessionId is issued only once the visitor has agreed to be measured. Building a touchpoint
    // without one would mean recording a visit that was never permitted to be recorded.
    expect(() => buildTouchpointEnvelope({ ...args, sessionId: '' })).toThrow(/session/i);
  });

  it('refuses to build when the consent behind it was denied', () => {
    const denied = { ...args.consent, categories: { necessary: true, analytics: false } };
    expect(() => buildTouchpointEnvelope({ ...args, consent: denied })).toThrow(/consent/i);
  });
});
