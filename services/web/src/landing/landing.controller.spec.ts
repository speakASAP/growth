import { ConfigService } from '@nestjs/config';
import { LandingController } from './landing.controller';
import { TouchpointEmitter } from './touchpoint.emitter';
import { GSID_COOKIE } from './landing';

/**
 * The consent gate. EP-005 W2's stated evidence is that a refusal leaves no cookie — and the
 * stronger property behind it: a refusal leaves no record anywhere, because a touchpoint
 * collected without permission cannot be un-collected once it exists.
 */
const configWith = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const config = () =>
  configWith({
    GROWTH_GSID_HMAC_SECRET: 'test-secret',
    GROWTH_WORKSPACE_ID: 'bazos',
    GROWTH_EXPERIMENT_ID: 'exp-001',
    GROWTH_EXPERIMENT_VERSION: 'v1',
  });

const emitterStub = () =>
  ({ emit: jest.fn(async () => undefined) }) as unknown as TouchpointEmitter & { emit: jest.Mock };

function fakeResponse() {
  const headers: Record<string, string[]> = {};
  return {
    headers,
    setHeader: (name: string, value: string | string[]) => {
      headers[name.toLowerCase()] = Array.isArray(value) ? value : [value];
    },
    cookies: () => headers['set-cookie'] ?? [],
  };
}

const DECIDED_AT = '2026-07-22T09:00:00.000Z';
const granted = { consentRecordId: 'rec-1', version: 3, categories: { necessary: true, analytics: true }, decidedAt: DECIDED_AT };
const refused = { consentRecordId: 'rec-1', version: 3, categories: { necessary: true, analytics: false }, decidedAt: DECIDED_AT };

describe('consent granted', () => {
  it('sets the gsid cookie and records the touchpoint', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());
    const res = fakeResponse();

    await controller.consent({ decision: granted, landingVersionId: 'landing-a' }, {} as never, res as never);

    expect(res.cookies()[0]).toContain(`${GSID_COOKIE}=`);
    expect(emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('issues a different session to each visitor', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());
    const first = fakeResponse();
    const second = fakeResponse();

    await controller.consent({ decision: granted, landingVersionId: 'a' }, {} as never, first as never);
    await controller.consent({ decision: granted, landingVersionId: 'a' }, {} as never, second as never);

    expect(first.cookies()[0]).not.toBe(second.cookies()[0]);
  });

  it('passes the click id and utm parameters through from the landing url', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());

    await controller.consent(
      {
        decision: granted,
        landingVersionId: 'a',
        query: { gclid: 'CjwK', utm_source: 'google' },
        referrer: 'https://www.google.com/',
      },
      {} as never,
      fakeResponse() as never,
    );

    const envelope = emitter.emit.mock.calls[0][0];
    expect(envelope.payload.gclid).toBe('CjwK');
    expect(envelope.payload.utm).toEqual({ source: 'google' });
    expect(envelope.payload.referrer).toBe('https://www.google.com/');
  });
});

describe('consent refused', () => {
  it('leaves no cookie', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());
    const res = fakeResponse();

    await controller.consent({ decision: refused, landingVersionId: 'a' }, {} as never, res as never);

    expect(res.cookies()).toEqual([]);
  });

  it('records nothing at all', async () => {
    // Not merely "no cookie": no session is minted and no touchpoint is sent. Data gathered
    // without permission cannot be withdrawn after the fact.
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());

    await controller.consent({ decision: refused, landingVersionId: 'a' }, {} as never, fakeResponse() as never);

    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('treats a missing decision as a refusal, never as consent', async () => {
    // The safe default when something is malformed or absent is not to collect.
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());
    const res = fakeResponse();

    await controller.consent({ landingVersionId: 'a' } as never, {} as never, res as never);

    expect(res.cookies()).toEqual([]);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('treats an unknown-category decision as a refusal', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(emitter, config());
    const res = fakeResponse();

    await controller.consent(
      { decision: { consentRecordId: 'r', version: 1, categories: {}, decidedAt: DECIDED_AT }, landingVersionId: 'a' },
      {} as never,
      res as never,
    );

    expect(res.cookies()).toEqual([]);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('the visitor is never blocked by our own recording', () => {
  it('still answers when growth-core is unreachable', async () => {
    // The landing must render and work during an ingestion outage; the buffer exists so the
    // event can be late, and a visitor should never see an error because analytics was down.
    const emitter = emitterStub();
    emitter.emit.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const controller = new LandingController(emitter, config());

    await expect(
      controller.consent({ decision: granted, landingVersionId: 'a' }, {} as never, fakeResponse() as never),
    ).resolves.toBeUndefined();
  });
});


/**
 * S6d / F-007 — the landing must not run without knowing which experiment it serves.
 *
 * These two used to fall back to the literal string 'unknown'. Since a lead's experiment is now
 * derived from its touchpoint, that fallback stopped being cosmetic: 'unknown' joins, counts and
 * reports, so a real experiment's spend would be divided by leads credited to an experiment that
 * does not exist.
 */
describe('the experiment this deployment serves', () => {
  const withoutExperiment = (missing: string) =>
    configWith({
      GROWTH_GSID_HMAC_SECRET: 'test-secret',
      GROWTH_WORKSPACE_ID: 'bazos',
      GROWTH_EXPERIMENT_ID: 'exp-001',
      GROWTH_EXPERIMENT_VERSION: 'v1',
      [missing]: undefined,
    });

  it.each(['GROWTH_EXPERIMENT_ID', 'GROWTH_EXPERIMENT_VERSION'])(
    'refuses to construct without %s',
    (key) => {
      // Thrown from the constructor, so a deploy that forgot the ConfigMap fails the pod. Throwing
      // per request would instead break the page for a visitor, which is the trade this service
      // refuses everywhere else.
      expect(() => new LandingController(emitterStub(), withoutExperiment(key))).toThrow(
        new RegExp(`MISSING: ${key}`),
      );
    },
  );

  it('refuses a blank value as firmly as a missing one', () => {
    expect(
      () =>
        new LandingController(
          emitterStub(),
          configWith({
            GROWTH_GSID_HMAC_SECRET: 'test-secret',
            GROWTH_EXPERIMENT_ID: '   ',
            GROWTH_EXPERIMENT_VERSION: 'v1',
          }),
        ),
    ).toThrow(/MISSING: GROWTH_EXPERIMENT_ID/);
  });

  it('records the configured experiment on the touchpoint, never a default', async () => {
    const emitter = emitterStub();
    const controller = new LandingController(
      emitter,
      configWith({
        GROWTH_GSID_HMAC_SECRET: 'test-secret',
        GROWTH_WORKSPACE_ID: 'bazos',
        GROWTH_EXPERIMENT_ID: 'exp-002',
        GROWTH_EXPERIMENT_VERSION: 'v3',
      }),
    );

    await controller.consent(
      { decision: granted, landingVersionId: 'v1-cena' } as never,
      {} as never,
      fakeResponse() as never,
    );

    const envelope = emitter.emit.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(envelope.payload.experimentId).toBe('exp-002');
    expect(envelope.payload.experimentVersion).toBe('v3');
  });
});
