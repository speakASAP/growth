#!/usr/bin/env node
/**
 * Apply SQL migrations in filename order, once each, inside a transaction.
 *
 * Deliberately minimal: growth-core has one table and a trigger. A migration
 * framework would be more machinery than the thing it migrates.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'migrations');

function connectionConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

async function main() {
  const client = new Client(connectionConfig());
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migration (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query('SELECT filename FROM public.schema_migration');
  const applied = new Set(rows.map((r) => r.filename));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    // Each migration commits or rolls back as a unit — a half-applied trigger
    // is worse than no trigger, because it looks like protection.
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migration (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      count += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }

  console.log(count === 0 ? 'no pending migrations' : `${count} migration(s) applied`);
  await client.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
