#!/usr/bin/env node
/**
 * Copies the JSON schemas this service enforces from the contract into the service source tree.
 *
 * The contract document owns the schemas. This service must validate against exactly those
 * schemas, not against a retyped approximation of them — a second hand-maintained copy is a
 * second source of truth, and the two diverge silently the first time only one is edited.
 *
 * The generated copies are gitignored and regenerated before every build and every test run,
 * so they cannot be committed in a divergent state. Edit the contract, never the copy.
 */
const fs = require('fs');
const path = require('path');

const CONTRACT_DIR = path.resolve(__dirname, '../../../docs/23_documentation_contracts/schemas');

/**
 * Explicit list rather than a glob over the contract directory. A schema appears here when this
 * service actually enforces it, so adding a contract for some other service's event does not
 * silently start shipping it inside growth-core.
 */
const SCHEMAS = [
  // S1a — decision record (C-001)
  { file: 'decision-artefact.v1.json', target: '../src/governance/schemas' },
  // S5 — ingestion (C-005). growth-core is the consumer of all of these.
  { file: 'touchpoint.observed.v1.json', target: '../src/ingest/schemas' },
  { file: 'auth_redirect.initiated.v1.json', target: '../src/ingest/schemas' },
  { file: 'user.registered.v1.json', target: '../src/ingest/schemas' },
  { file: 'lead.created_from_registration.v1.json', target: '../src/ingest/schemas' },
  { file: 'spend.observed_manual.v1.json', target: '../src/ingest/schemas' },
];

let synced = 0;

for (const { file, target } of SCHEMAS) {
  const source = path.join(CONTRACT_DIR, file);
  const destination = path.resolve(__dirname, target, file);

  if (!fs.existsSync(source)) {
    console.error(`Contract schema not found: ${source}`);
    console.error('The service cannot be built without the schema it is contracted to enforce.');
    process.exit(1);
  }

  // Parse before copying: a malformed contract schema should fail here, with the contract
  // path in the message, rather than inside Ajv with a stack trace pointing at the service.
  try {
    JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (err) {
    console.error(`Contract schema is not valid JSON: ${source}`);
    console.error(err.message);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  synced += 1;
}

console.log(`${synced} schemas synced from contract: ${path.relative(process.cwd(), CONTRACT_DIR)}`);
