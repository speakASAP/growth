// ajv/dist/2020, not the default export: the contract schema declares
// $schema draft/2020-12, and the default Ajv build only understands draft-07.
import Ajv2020 from 'ajv/dist/2020';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import schema from './schemas/decision-artefact.v1.json';

/**
 * Shape validation for C-001 rules V1–V4, V9, V11(format), V12.
 *
 * The schema file is a byte-for-byte copy of the contract's published schema
 * (growth/docs/23_documentation_contracts/schemas/decision-artefact.v1.json), so the document
 * and the running service cannot drift apart. A schema retyped by hand would be a second
 * source of truth, which is how the two silently diverge.
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
