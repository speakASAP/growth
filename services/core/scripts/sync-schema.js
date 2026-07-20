#!/usr/bin/env node
/**
 * Copies the decision-artefact JSON schema from the contract into the service source tree.
 *
 * The contract document owns the schema. This service must validate against exactly that
 * schema, not against a retyped approximation of it — a second hand-maintained copy is a
 * second source of truth, and the two diverge silently the first time only one is edited.
 *
 * The generated copy is gitignored and regenerated before every build and every test run,
 * so it cannot be committed in a divergent state. Edit the contract, never the copy.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.resolve(
  __dirname,
  '../../../docs/23_documentation_contracts/schemas/decision-artefact.v1.json',
);
const TARGET = path.resolve(__dirname, '../src/governance/schemas/decision-artefact.v1.json');

if (!fs.existsSync(SOURCE)) {
  console.error(`Contract schema not found: ${SOURCE}`);
  console.error('The service cannot be built without the schema it is contracted to enforce.');
  process.exit(1);
}

// Parse before copying: a malformed contract schema should fail here, with the contract
// path in the message, rather than inside Ajv with a stack trace pointing at the service.
try {
  JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
} catch (err) {
  console.error(`Contract schema is not valid JSON: ${SOURCE}`);
  console.error(err.message);
  process.exit(1);
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.copyFileSync(SOURCE, TARGET);
console.log(`schema synced from contract: ${path.relative(process.cwd(), SOURCE)}`);
