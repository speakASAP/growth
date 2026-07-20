// ajv/dist/2020, not the default export: the contract schemas declare
// $schema draft/2020-12, and the default Ajv build only understands draft-07.
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import touchpointObserved from './schemas/touchpoint.observed.v1.json';
import authRedirectInitiated from './schemas/auth_redirect.initiated.v1.json';
import userRegistered from './schemas/user.registered.v1.json';
import leadCreatedFromRegistration from './schemas/lead.created_from_registration.v1.json';
import spendObservedManual from './schemas/spend.observed_manual.v1.json';

/**
 * Envelope validation for C-005 §1–§2. Rejects at the door what the buffer would otherwise
 * store forever: a 400 here is cheap, a malformed row in an append-only buffer is not.
 *
 * ./schemas/ is generated, not authored — scripts/sync-schema.js copies the contract's published
 * schemas there before every build and test run, and the directory is gitignored. Edit the
 * contract. A copy committed alongside the code would be a second source of truth, which is how
 * a document and the service implementing it silently diverge.
 */

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

/**
 * Keyed by eventType. The schemas pin eventType with `const`, so a payload can only validate
 * against the schema it names — dispatching on the field is not a shortcut around validation.
 */
const VALIDATORS: Record<string, ValidateFunction> = {
  'growth.touchpoint.observed.v1': ajv.compile(touchpointObserved),
  'growth.auth_redirect.initiated.v1': ajv.compile(authRedirectInitiated),
  'auth.user.registered.v1': ajv.compile(userRegistered),
  'growth.lead.created_from_registration.v1': ajv.compile(leadCreatedFromRegistration),
  'growth.spend.observed_manual.v1': ajv.compile(spendObservedManual),
};

export const KNOWN_EVENT_TYPES = Object.keys(VALIDATORS);

export interface ValidationFailure {
  path: string;
  message: string;
}

export function validateEnvelope(candidate: unknown): ValidationFailure[] {
  if (typeof candidate !== 'object' || candidate === null) {
    return [{ path: '/', message: 'envelope must be an object' }];
  }

  const eventType = (candidate as { eventType?: unknown }).eventType;
  if (typeof eventType !== 'string') {
    return [{ path: '/eventType', message: 'required' }];
  }

  const validate = VALIDATORS[eventType];
  if (!validate) {
    // An unknown type is a 400, not a stored row. Buffering something no consumer can parse
    // would defer the failure to the worker, where it retries ten times and lands in `dead`
    // — the same rejection, reached slowly and with an alert attached.
    return [{ path: '/eventType', message: `unknown event type: ${eventType}` }];
  }

  if (validate(candidate)) return [];
  return (validate.errors ?? []).map(toFailure);
}

function toFailure(error: ErrorObject): ValidationFailure {
  return {
    path: error.instancePath || '/',
    message: error.message ?? 'invalid',
  };
}
