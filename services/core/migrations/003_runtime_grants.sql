-- 003_runtime_grants.sql
-- Role split: growth_core_owner owns the schema, growth_core only runs against it.
--
-- Why this migration exists at all: `decision_artefact` is append-only, and that is enforced by a
-- trigger. A table owner may `ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER` no matter what the
-- trigger body says, so while the application connected as the table's owner it could switch off
-- its own audit guarantee, rewrite history, and switch it back on. The trigger stopped accidents,
-- not anyone holding the runtime password — precisely the threat the decision record exists to
-- survive.
--
-- From here: the migrate init container connects as growth_core_owner (DDL), the app container as
-- growth_core (DML only, no ownership, therefore no DDL).
--
-- Grants are written out per table on purpose. `ALTER DEFAULT PRIVILEGES ... GRANT ALL` would be
-- shorter and would quietly hand UPDATE and DELETE to every future append-only table — the exact
-- privilege this split exists to withhold. Forgetting a grant instead fails loudly with "permission
-- denied" on first use, which is the safe direction to fail in.

-- In production the role already exists and is created by hand, because growth_core_owner is
-- NOCREATEROLE and must stay that way. The guard is for the throwaway test database, whose
-- superuser can create it — so the db-specs exercise the same two-role arrangement as production
-- rather than a single all-powerful role that would pass tests the real deployment fails.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'growth_core') THEN
    CREATE ROLE growth_core LOGIN PASSWORD 'testpw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA governance TO growth_core;
GRANT USAGE ON SCHEMA ingest     TO growth_core;

-- Append-only: no UPDATE, no DELETE, no TRUNCATE. Corrections create a new artefact.
GRANT SELECT, INSERT ON governance.decision_artefact TO growth_core;

-- The buffer is working state, not history: the drain worker updates status/attempts and the
-- retention sweep deletes published rows, so full DML is correct here.
GRANT SELECT, INSERT, UPDATE, DELETE ON ingest.event_buffer TO growth_core;

-- public.schema_migration is deliberately not granted. Only the migrate container touches it,
-- and it runs as the owner.
REVOKE CREATE ON SCHEMA public FROM growth_core;
