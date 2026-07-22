import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { buildTouchpointEnvelope } from './landing';

/**
 * Delivery plan §8 — the producer half of the contract test: *what I emit validates against the
 * schema*. A contract document never fails; an executable schema does.
 *
 * The schema is read from `docs/` rather than copied here. A copy is a second source of truth
 * that drifts silently, and the drift only shows up as growth-core answering 400 and dropping
 * every touchpoint.
 */
const schema = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../docs/23_documentation_contracts/schemas/touchpoint.observed.v1.json'),
    'utf8',
  ),
);

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validate = ajv.compile(schema);

const base = {
  sessionId: '7f1c2d3e-0000-4000-8000-000000000001',
  experimentId: 'exp-001',
  experimentVersion: 'v1',
  landingVersionId: 'landing-a-2026-07-22',
  workspaceId: 'bazos',
  consent: {
    consentRecordId: '5f1c2d3e-0000-4000-8000-000000000002',
    version: 3,
    categories: { necessary: true, analytics: true },
    decidedAt: '2026-07-22T09:00:00.000Z',
  },
  now: new Date('2026-07-22T09:00:01.000Z'),
  eventId: '9f1c2d3e-0000-4000-8000-000000000003',
};

const check = (envelope: unknown) => {
  const ok = validate(envelope);
  if (!ok) throw new Error(JSON.stringify(validate.errors, null, 2));
  return ok;
};

describe('growth.touchpoint.observed.v1 — producer conformance', () => {
  it('validates a fully populated touchpoint', () => {
    expect(
      check(
        buildTouchpointEnvelope({
          ...base,
          query: { gclid: 'CjwK', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'c', utm_term: 't', utm_content: 'x' },
          referrer: 'https://www.google.com/',
        }),
      ),
    ).toBe(true);
  });

  it('validates a touchpoint with every optional field absent', () => {
    // Direct visit, no ad, no referrer. The schema permits it and the consumer must too.
    expect(check(buildTouchpointEnvelope({ ...base, query: {} }))).toBe(true);
  });

  it('validates with only some utm parameters present', () => {
    expect(check(buildTouchpointEnvelope({ ...base, query: { utm_source: 'google' } }))).toBe(true);
  });
});
