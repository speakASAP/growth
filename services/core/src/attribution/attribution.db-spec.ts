import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../db/database.service';
import { AttributionRepository } from './attribution.repository';
import { AttributionService } from './attribution.service';
import { mintGsid } from './gsid';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * C-005 §2.2 — the two halves of a registration meeting on `correlationId`. The cases that matter
 * are the awkward ones: either arrival order, a half that never gets its partner, a replayed
 * delivery, and a forged token. All four are normal traffic, and three of them would otherwise
 * corrupt attribution quietly rather than failing.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://testuser:testpw@127.0.0.1:55432/growth_core_test';

const SECRET = 'test-secret-not-the-production-one';
const config = {
  get: (key: string) =>
    key === 'DATABASE_URL' ? TEST_DATABASE_URL : key === 'GROWTH_GSID_HMAC_SECRET' ? SECRET : undefined,
};

let db: DatabaseService;
let repo: AttributionRepository;
let service: AttributionService;

beforeAll(async () => {
  db = new DatabaseService(config as unknown as ConfigService);
  db.onModuleInit();
  repo = new AttributionRepository(db);
  service = new AttributionService(repo, config as unknown as ConfigService);
});

afterAll(async () => {
  await db.onModuleDestroy();
});

beforeEach(async () => {
  await db.query(
    'TRUNCATE attribution.identity_link, attribution.auth_redirect, attribution.registration, attribution.touchpoint',
  );
});

const redirect = (over: Record<string, unknown> = {}) => ({
  eventId: 'aaaaaaaa-0000-4000-8000-000000000001',
  eventType: 'growth.auth_redirect.initiated.v1',
  eventVersion: 1,
  occurredAt: '2026-07-21T10:00:00.000Z',
  producer: 'bazos-service',
  workspaceId: 'bazos',
  correlationId: 'corr-1',
  dataClass: 'anonymous',
  payload: {
    correlationId: 'corr-1',
    gsid: mintGsid('session-1', SECRET),
    gsidSource: 'cookie',
    initiatedAt: '2026-07-21T10:00:00.000Z',
  },
  ...over,
});

const registration = (over: Record<string, unknown> = {}) => ({
  eventId: 'bbbbbbbb-0000-4000-8000-000000000001',
  eventType: 'auth.user.registered.v1',
  eventVersion: 1,
  occurredAt: '2026-07-21T10:05:00.000Z',
  producer: 'auth-microservice',
  correlationId: 'corr-1',
  dataClass: 'personal',
  payload: {
    userId: 'user-1',
    correlationId: 'corr-1',
    registrationMethod: 'password',
    applicationContext: 'bazos-service',
    registeredAt: '2026-07-21T10:05:00.000Z',
  },
  ...over,
});

const links = () =>
  db.query('SELECT user_id, session_id, correlation_id, workspace_id FROM attribution.identity_link');

describe('the join produces the same link in either arrival order', () => {
  it('click first, then registration', async () => {
    await service.onAuthRedirect(redirect());
    await service.onUserRegistered(registration());

    expect((await links()).rows).toEqual([
      { user_id: 'user-1', session_id: 'session-1', correlation_id: 'corr-1', workspace_id: 'bazos' },
    ]);
  });

  it('registration first, then click', async () => {
    // Not exotic: the two events travel different queues from different services, so nothing
    // orders them. A join that only worked one way would drop roughly the races it lost.
    await service.onUserRegistered(registration());
    await service.onAuthRedirect(redirect());

    expect((await links()).rows).toEqual([
      { user_id: 'user-1', session_id: 'session-1', correlation_id: 'corr-1', workspace_id: 'bazos' },
    ]);
  });
});

describe('half-open joins are normal, not errors', () => {
  it('a click with no registration links nothing and does not throw', async () => {
    // The visitor clicked through and abandoned the form. Nothing is wrong.
    await expect(service.onAuthRedirect(redirect())).resolves.toBeUndefined();
    expect((await links()).rows).toEqual([]);
  });

  it('a registration with no click links nothing and does not throw', async () => {
    await expect(service.onUserRegistered(registration())).resolves.toBeUndefined();
    expect((await links()).rows).toEqual([]);
  });

  it('a registration with no correlationId at all is recorded and links nothing', async () => {
    // A direct signup that never passed a landing page — the common case for the ecosystem's
    // other applications, which must not be treated as a fault.
    const direct = registration({
      correlationId: 'envelope-trace-id',
      payload: {
        userId: 'user-direct',
        registrationMethod: 'password',
        registeredAt: '2026-07-21T10:05:00.000Z',
      },
    });
    await expect(service.onUserRegistered(direct)).resolves.toBeUndefined();

    const stored = await db.query('SELECT correlation_id FROM attribution.registration WHERE user_id = $1', [
      'user-direct',
    ]);
    expect(stored.rows[0].correlation_id).toBeNull();
    expect((await links()).rows).toEqual([]);
  });
});

describe('gsid verification decides whether attribution happens (C-005 §4)', () => {
  it('drops attribution for a forged token but still records the registration', async () => {
    const forged = redirect({
      payload: { ...redirect().payload, gsid: mintGsid('session-1', 'a-different-secret') },
    });
    await service.onAuthRedirect(forged);
    await service.onUserRegistered(registration());

    expect((await links()).rows).toEqual([]);
    const stored = await db.query('SELECT gsid_status, session_id FROM attribution.auth_redirect');
    expect(stored.rows[0]).toEqual({ gsid_status: 'forged', session_id: null });
    // The registration itself survives — a forgery costs the attribution, not the conversion.
    const reg = await db.query('SELECT user_id FROM attribution.registration');
    expect(reg.rows).toHaveLength(1);
  });

  it('records an absent gsid as its own outcome and links nothing', async () => {
    const noGsid = redirect({
      payload: { correlationId: 'corr-1', initiatedAt: '2026-07-21T10:00:00.000Z' },
    });
    await service.onAuthRedirect(noGsid);
    await service.onUserRegistered(registration());

    expect((await links()).rows).toEqual([]);
    const stored = await db.query('SELECT gsid_status, session_id FROM attribution.auth_redirect');
    expect(stored.rows[0]).toEqual({ gsid_status: 'absent', session_id: null });
  });

  it('never stores the raw token, only the session it proved', async () => {
    // The gsid is a bearer token for an anonymous session. Keeping it would make a database leak
    // replayable as valid attribution.
    await service.onAuthRedirect(redirect());
    const stored = await db.query('SELECT * FROM attribution.auth_redirect');
    expect(JSON.stringify(stored.rows[0])).not.toContain(redirect().payload.gsid);
  });

  it('refuses to link a session that was stored despite failing verification', async () => {
    // Defence in depth, and not redundant the way it looks. Today a session id is only written
    // when the signature verified, so `session_id IS NOT NULL` alone would appear to be enough —
    // which is exactly why this is worth pinning: a future change that stores the session before
    // checking the signature would turn every forgery into attribution, and no other test here
    // would notice. The row below is built by hand because the service cannot produce it.
    await db.query(
      `INSERT INTO attribution.auth_redirect
         (correlation_id, workspace_id, session_id, gsid_status, initiated_at)
       VALUES ('corr-1', 'bazos', 'session-forged', 'forged', now())`,
    );
    await service.onUserRegistered(registration());

    expect((await links()).rows).toEqual([]);
  });

  it('counts forgeries in a way that cannot drift from the data', async () => {
    await service.onAuthRedirect(redirect({
      correlationId: 'c-forged',
      payload: { ...redirect().payload, correlationId: 'c-forged', gsid: mintGsid('s', 'wrong') },
    }));
    await service.onAuthRedirect(redirect());

    expect(await repo.countForgedGsids()).toBe(1);
  });
});

describe('replays', () => {
  it('a redelivered click does not duplicate or change what was recorded', async () => {
    // At-least-once delivery is the broker's contract; a consumer that is not idempotent turns
    // every redelivery into a second visitor.
    await service.onAuthRedirect(redirect());
    await service.onAuthRedirect(redirect());

    const stored = await db.query('SELECT count(*)::int AS c FROM attribution.auth_redirect');
    expect(stored.rows[0].c).toBe(1);
  });

  it('a redelivered registration does not duplicate the link', async () => {
    await service.onAuthRedirect(redirect());
    await service.onUserRegistered(registration());
    await service.onUserRegistered(registration());

    expect((await links()).rows).toHaveLength(1);
  });

  it('does not relink a user to a different session on a late duplicate click', async () => {
    // Two clicks can share a correlationId only if something upstream is wrong; the first link
    // stands rather than the record silently changing whose session a person was.
    await service.onAuthRedirect(redirect());
    await service.onUserRegistered(registration());
    await service.onAuthRedirect(
      redirect({ payload: { ...redirect().payload, gsid: mintGsid('session-other', SECRET) } }),
    );

    const rows = (await links()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('session-1');
  });
});


/**
 * C-006 §4.3 — the landing view, stored so a lead's experiment stays knowable.
 *
 * Before S6d these envelopes passed through the ingest buffer onto an exchange with nothing bound
 * to it, and the buffer deletes published rows after 30 days. The experiment a lead came from was
 * therefore knowable for a month and unknowable afterwards.
 */
describe('storing a touchpoint', () => {
  const touchpoint = (over: Record<string, unknown> = {}) => {
    const { payload: payloadOver, ...envelopeOver } = over;
    return {
      eventId: 'bbbbbbbb-0000-4000-8000-000000000001',
      eventType: 'growth.touchpoint.observed.v1',
      eventVersion: 1,
      occurredAt: '2026-07-22T09:00:00.000Z',
      producer: 'growth-web',
      workspaceId: 'bazos',
      correlationId: 'session-1',
      dataClass: 'anonymous',
      payload: {
        sessionId: 'session-1',
        experimentId: 'exp-001',
        experimentVersion: 'v1',
        landingVersionId: 'v1-cena',
        utm: { campaign: 'bazos-cz-search' },
        consentEvidence: {
          consentRecordId: 'consent-1',
          consentVersion: 1,
          applicablePurposes: ['analytics'],
          statusAtEventTime: 'granted',
          evaluatedAt: '2026-07-22T09:00:00.000Z',
        },
        ...(payloadOver as Record<string, unknown>),
        },
        ...envelopeOver,
    };
  };

  it('stores the experiment the session was looking at', async () => {
    await service.onTouchpoint(touchpoint() as never);

    const { rows } = await db.query('SELECT * FROM attribution.touchpoint');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      touchpoint_id: 'bbbbbbbb-0000-4000-8000-000000000001',
      session_id: 'session-1',
      experiment_id: 'exp-001',
      experiment_version: 'v1',
      landing_version_id: 'v1-cena',
      utm_campaign: 'bazos-cz-search',
      consent_status: 'granted',
    });
  });

  it('is idempotent — a redelivery does not add a second view', async () => {
    // Brokers deliver at least once, and a session's view history decides which experiment a lead
    // is credited to. A duplicated row would move that answer without anything looking wrong.
    await service.onTouchpoint(touchpoint() as never);
    await service.onTouchpoint(touchpoint() as never);

    const { rows } = await db.query('SELECT count(*)::text AS n FROM attribution.touchpoint');
    expect(rows[0].n).toBe('1');
  });

  it('keeps a session\'s separate views as separate rows', async () => {
    await service.onTouchpoint(touchpoint() as never);
    await service.onTouchpoint(
      touchpoint({
        eventId: 'bbbbbbbb-0000-4000-8000-000000000002',
        occurredAt: '2026-07-22T09:05:00.000Z',
        payload: { landingVersionId: 'v2-obnova' },
      }) as never,
    );

    const { rows } = await db.query('SELECT count(*)::text AS n FROM attribution.touchpoint');
    expect(rows[0].n).toBe('2');
  });

  it('stores a view with no utm campaign as null rather than an empty string', async () => {
    await service.onTouchpoint(touchpoint({ payload: { utm: undefined } }) as never);

    const { rows } = await db.query<{ utm_campaign: string | null }>(
      'SELECT utm_campaign FROM attribution.touchpoint',
    );
    expect(rows[0].utm_campaign).toBeNull();
  });

  it('refuses UPDATE and DELETE under the runtime role', async () => {
    // A touchpoint is an observation of something that already happened. There is no correction
    // path, and the guarantee is held as a privilege rather than as a convention.
    await service.onTouchpoint(touchpoint() as never);

    const runtime = new (require('pg').Client)({
      connectionString:
        process.env.TEST_RUNTIME_DATABASE_URL ??
        'postgresql://growth_core:testpw@127.0.0.1:55432/growth_core_test',
    });
    await runtime.connect();
    try {
      await expect(
        runtime.query("UPDATE attribution.touchpoint SET experiment_id = 'exp-999'"),
      ).rejects.toThrow(/permission denied/i);
      await expect(runtime.query('DELETE FROM attribution.touchpoint')).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await runtime.end();
    }
  });
});
