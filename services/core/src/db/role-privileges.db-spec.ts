import { Client } from 'pg';

/**
 * Requires the throwaway Postgres from scripts/test-db.sh.
 *
 * The append-only guarantee on `decision_artefact` is a trigger, and a table owner can
 * `ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER` whatever the trigger body says. While the
 * application connected as the owner, anyone holding the runtime password could switch off the
 * audit guarantee, rewrite the record of why money was spent, and switch it back on — and the
 * decision record would still look intact. Migration 003 splits the roles so that is no longer
 * possible.
 *
 * These specs assert the privilege boundary itself rather than the trigger. The trigger specs in
 * governance/decision.db-spec.ts prove the guard fires; these prove it cannot be removed.
 */
const RUNTIME_DATABASE_URL =
  process.env.TEST_RUNTIME_DATABASE_URL ??
  'postgresql://growth_core:testpw@127.0.0.1:55432/growth_core_test';

let runtime: Client;

beforeAll(async () => {
  runtime = new Client({ connectionString: RUNTIME_DATABASE_URL });
  await runtime.connect();
});

afterAll(async () => {
  await runtime.end();
});

/**
 * Runs a statement that must be refused, inside a transaction that is always rolled back.
 *
 * Without the rollback these specs are destructive in exactly the situation they exist to detect:
 * if the privilege split regresses, `DROP TABLE` succeeds and the spec deletes the table it was
 * checking. DDL is transactional in Postgres, so the assertion is unaffected and the damage is not
 * possible.
 */
const refused = async (sql: string): Promise<Error> => {
  await runtime.query('BEGIN');
  try {
    await runtime.query(sql);
    throw new Error(`expected "${sql.slice(0, 60)}…" to be refused, but it succeeded`);
  } catch (err) {
    return err as Error;
  } finally {
    await runtime.query('ROLLBACK');
  }
};

describe('runtime role privileges (migration 003)', () => {
  describe('cannot remove the immutability guarantee', () => {
    it('cannot disable the append-only trigger', async () => {
      const err = await refused(
        'ALTER TABLE governance.decision_artefact DISABLE TRIGGER decision_artefact_immutable',
      );
      expect(err.message).toMatch(/must be owner/i);
    });

    it('cannot drop the append-only trigger', async () => {
      const err = await refused(
        'DROP TRIGGER decision_artefact_immutable ON governance.decision_artefact',
      );
      expect(err.message).toMatch(/must be owner/i);
    });

    it('cannot replace the trigger function with one that permits mutation', async () => {
      const err = await refused(
        `CREATE OR REPLACE FUNCTION governance.reject_artefact_mutation()
         RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$`,
      );
      expect(err.message).toMatch(/permission denied|must be owner/i);
    });

    it('cannot drop the table outright', async () => {
      const err = await refused('DROP TABLE governance.decision_artefact');
      expect(err.message).toMatch(/must be owner/i);
    });

    it('cannot create objects of its own to work around the schema', async () => {
      const err = await refused('CREATE TABLE governance.shadow (x int)');
      expect(err.message).toMatch(/permission denied/i);
    });
  });

  describe('retains exactly the privileges the application needs', () => {
    it('can read decision artefacts', async () => {
      await expect(
        runtime.query('SELECT count(*) FROM governance.decision_artefact'),
      ).resolves.toBeDefined();
    });

    it('cannot UPDATE decision artefacts even before the trigger runs', async () => {
      // Defence in depth: the privilege is withheld as well as the mutation rejected, so an
      // attacker who did neutralise the trigger would still be refused at the grant.
      const err = await refused("UPDATE governance.decision_artefact SET workspace_id = 'x'");
      expect(err.message).toMatch(/permission denied/i);
    });

    it('cannot DELETE decision artefacts', async () => {
      const err = await refused('DELETE FROM governance.decision_artefact');
      expect(err.message).toMatch(/permission denied/i);
    });

    it('has full DML on the event buffer, which is working state rather than history', async () => {
      // The drain worker updates status/attempts and the retention sweep deletes published rows;
      // withholding these would break ingestion rather than protect anything.
      await expect(runtime.query('SELECT count(*) FROM ingest.event_buffer')).resolves.toBeDefined();
      await expect(
        runtime.query("UPDATE ingest.event_buffer SET attempts = attempts WHERE false"),
      ).resolves.toBeDefined();
      await expect(runtime.query('DELETE FROM ingest.event_buffer WHERE false')).resolves.toBeDefined();
    });

    it('cannot read the migration ledger, which only the owner touches', async () => {
      const err = await refused('SELECT * FROM public.schema_migration');
      expect(err.message).toMatch(/permission denied/i);
    });
  });
});
