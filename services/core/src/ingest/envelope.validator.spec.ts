import { validateEnvelope, KNOWN_EVENT_TYPES } from './envelope.validator';

const validRedirect = () => ({
  eventId: '3f6c9d1e-1b2a-4c3d-8e5f-6a7b8c9d0e1f',
  eventType: 'growth.auth_redirect.initiated.v1',
  eventVersion: 1,
  occurredAt: '2026-07-20T10:00:00.000Z',
  producer: 'bazos-service',
  workspaceId: 'ws-1',
  correlationId: 'corr-1',
  dataClass: 'anonymous',
  payload: {
    correlationId: 'corr-1',
    gsid: 'c2Vzc2lvbg.c2ln',
    gsidSource: 'cookie',
    initiatedAt: '2026-07-20T10:00:00.000Z',
  },
});

// No `workspaceId`: this event comes from shared ecosystem infrastructure, which has no growth
// concepts in it. growth-core resolves the workspace when it consumes (C-005 §1).
const validRegistration = () => ({
  eventId: '4f6c9d1e-1b2a-4c3d-8e5f-6a7b8c9d0e2a',
  eventType: 'auth.user.registered.v1',
  eventVersion: 1,
  occurredAt: '2026-07-20T10:05:00.000Z',
  producer: 'auth-microservice',
  correlationId: 'corr-1',
  dataClass: 'personal',
  payload: {
    userId: 'user-1',
    correlationId: 'corr-1',
    email: 'someone@example.com',
    registrationMethod: 'password',
    registeredAt: '2026-07-20T10:05:00.000Z',
  },
});

describe('validateEnvelope', () => {
  it('accepts a well-formed redirect envelope', () => {
    expect(validateEnvelope(validRedirect())).toEqual([]);
  });

  it('accepts a well-formed registration envelope', () => {
    expect(validateEnvelope(validRegistration())).toEqual([]);
  });

  it('rejects an unknown event type rather than buffering it', () => {
    const envelope = { ...validRedirect(), eventType: 'growth.something.invented.v1' };
    expect(validateEnvelope(envelope)).toEqual([
      { path: '/eventType', message: 'unknown event type: growth.something.invented.v1' },
    ]);
  });

  it('rejects a non-object body', () => {
    expect(validateEnvelope('not an envelope')).toHaveLength(1);
    expect(validateEnvelope(null)).toHaveLength(1);
  });

  it('rejects an envelope missing eventType', () => {
    const { eventType, ...rest } = validRedirect();
    expect(validateEnvelope(rest)).toEqual([{ path: '/eventType', message: 'required' }]);
  });

  it('rejects an envelope whose producer contradicts its type', () => {
    // The schemas pin `producer` with const, so an event claiming to be from auth cannot be
    // submitted under bazos's name — this is what stops a compromised edge forging conversions.
    const envelope = { ...validRegistration(), producer: 'bazos-service' };
    expect(validateEnvelope(envelope).length).toBeGreaterThan(0);
  });

  describe('consumer tolerance (C-005 §7)', () => {
    it('accepts a registration with every optional field absent', () => {
      const envelope = validRegistration();
      delete (envelope.payload as Record<string, unknown>).correlationId;
      expect(validateEnvelope(envelope)).toEqual([]);
    });

    it('accepts a redirect with no gsid — consent refused is the expected path, not an error', () => {
      const envelope = validRedirect();
      delete (envelope.payload as Record<string, unknown>).gsid;
      delete (envelope.payload as Record<string, unknown>).gsidSource;
      expect(validateEnvelope(envelope)).toEqual([]);
    });
  });

  describe('EP-005 W3 — the auth event must stay generic', () => {
    // This is the executable half of a constraint that is otherwise only prose. If someone adds
    // gsid to auth's event to make an attribution bug go away, this fails rather than shipping
    // a growth concept into shared ecosystem infrastructure.
    it.each(['gsid', 'experimentId', 'gsidSource', 'landingVersionId', 'workspaceId'])(
      'rejects a registration payload carrying %s',
      (field) => {
        const envelope = validRegistration();
        (envelope.payload as Record<string, unknown>)[field] = 'x';
        expect(validateEnvelope(envelope).length).toBeGreaterThan(0);
      },
    );

    it('rejects workspaceId on the envelope, not only in the payload', () => {
      // workspaceId is a growth concept. Putting it on auth's event would make every future
      // consumer of shared infrastructure inherit growth's tenancy model, and there is no quiet
      // way to take that back later (C-005 §1, owner 2026-07-21).
      const envelope = { ...validRegistration(), workspaceId: 'ws-1' };
      expect(validateEnvelope(envelope).length).toBeGreaterThan(0);
    });

    it('still accepts the growth-produced events that do carry workspaceId', () => {
      // The rule is "auth's event has no workspaceId", not "workspaceId is gone" — growth's own
      // events are scoped by it and must keep validating.
      expect(validateEnvelope(validRedirect())).toEqual([]);
    });
  });

  it('knows exactly the event types the contract defines', () => {
    expect(KNOWN_EVENT_TYPES.sort()).toEqual(
      [
        'auth.user.registered.v1',
        'growth.auth_redirect.initiated.v1',
        'growth.lead.created_from_registration.v1',
        'growth.lead.qualification_recorded.v1',
        'growth.spend.observed_manual.v1',
        'growth.payment_intent.declared.v1',
        'growth.touchpoint.observed.v1',
      ].sort(),
    );
  });
});
