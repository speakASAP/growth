import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { LandingModule } from './landing.module';
import { ConfigModule } from '@nestjs/config';
import { TouchpointEmitter } from './touchpoint.emitter';

/**
 * Against the real HTTP stack, because the unit specs call the controller directly with a fake
 * response object and therefore cannot see whether a response is ever actually sent.
 *
 * That is not hypothetical: the first deploy of this service hung every POST /l/consent until the
 * edge returned 524, because @Res() without `passthrough` makes the handler responsible for
 * ending the response. Every unit test passed.
 */
let app: INestApplication;
const emitted: unknown[] = [];

beforeAll(async () => {
  process.env.GROWTH_GSID_HMAC_SECRET = 'test-secret';
  process.env.GROWTH_WORKSPACE_ID = 'bazos';

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), LandingModule],
  })
    .overrideProvider(TouchpointEmitter)
    .useValue({ emit: async (e: unknown) => void emitted.push(e) })
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  emitted.length = 0;
});

const grant = {
  decision: {
    consentRecordId: 'rec-1',
    version: 3,
    categories: { necessary: true, analytics: true },
    decidedAt: '2026-07-22T09:00:00.000Z',
  },
  landingVersionId: 'v1-cena',
};

const refuse = {
  decision: { ...grant.decision, categories: { necessary: true, analytics: false } },
  landingVersionId: 'v1-cena',
};

describe('the landing responds at all', () => {
  it('serves a known variant', async () => {
    const res = await request(app.getHttpServer()).get('/l/v1-cena').expect(200);
    expect(res.text).toContain('v1-cena');
    expect(res.text).toMatch(/49\s*Kč/);
  });

  it('404s an unknown variant instead of quietly serving another', async () => {
    // A fallback would record touchpoints against copy the visitor never read. A broken ad URL
    // should be obviously broken.
    await request(app.getHttpServer()).get('/l/v9-does-not-exist').expect(404);
  });

  it('answers a consent grant instead of hanging', async () => {
    const res = await request(app.getHttpServer()).post('/l/consent').send(grant).expect(204);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('answers a consent refusal instead of hanging', async () => {
    await request(app.getHttpServer()).post('/l/consent').send(refuse).expect(204);
  });
});

describe('the consent gate, over real HTTP', () => {
  it('sets a scoped, HttpOnly cookie on a grant', async () => {
    const res = await request(app.getHttpServer()).post('/l/consent').send(grant).expect(204);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toContain('Domain=bazos.alfares.cz');
    expect(cookie).toContain('HttpOnly');
    expect(emitted).toHaveLength(1);
  });

  it('leaves no cookie and records nothing on a refusal', async () => {
    const res = await request(app.getHttpServer()).post('/l/consent').send(refuse).expect(204);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it('cannot be granted by a GET, which a browser may prefetch', async () => {
    // There is no GET route for consent; the path falls through to the variant lookup and 404s.
    await request(app.getHttpServer()).get('/l/consent').expect(404);
    expect(emitted).toHaveLength(0);
  });
});
