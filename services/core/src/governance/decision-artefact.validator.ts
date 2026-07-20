// ajv/dist/2020, not the default export: the contract schema declares
// $schema draft/2020-12, and the default Ajv build only understands draft-07.
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import schema from './schemas/decision-artefact.v1.json';

/**
 * Shape validation for C-001 rules V1–V4, V9, V11(format), V12.
 *
 * ./schemas/ is generated, not authored: scripts/sync-schema.js copies the contract's
 * published schema (docs/23_documentation_contracts/schemas/decision-artefact.v1.json) there
 * before every build and every test run, and the directory is gitignored. Edit the contract.
 * A copy committed alongside the code would be a second source of truth, which is how a
 * document and the service implementing it silently diverge.
 *
 * Cross-record rules (V5–V8) need the stored history and live in the service layer.
 */

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateFn: ValidateFunction = ajv.compile(schema);

export interface ValidationFailure {
  path: string;
  message: string;
}

export function validateArtefactShape(candidate: unknown): ValidationFailure[] {
  if (validateFn(candidate)) return [];
  return (validateFn.errors ?? []).map(toFailure);
}

function toFailure(error: ErrorObject): ValidationFailure {
  return {
    path: error.instancePath || '/',
    message: error.message ?? 'invalid',
  };
}
