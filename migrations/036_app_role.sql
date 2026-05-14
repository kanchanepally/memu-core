-- 036_app_role.sql
--
-- TD-01 — provision the NOSUPERUSER runtime role that the Hosted
-- (Hetzner) tier connects as.
--
-- Background. The Postgres image creates `POSTGRES_USER` (= `memu`)
-- with the SUPERUSER attribute by default. A SUPERUSER bypasses
-- Row-Level Security regardless of `FORCE ROW LEVEL SECURITY` on the
-- table — meaning the policies shipped in migration 028 do not actually
-- enforce tenant isolation when the application connects as the
-- entrypoint-created user. ARCH-02 shipped RLS scaffolding; this
-- migration gives the scaffolding teeth.
--
-- Approach. Create a second role `memu_app` LOGIN NOSUPERUSER
-- NOBYPASSRLS, grant it the CRUD privileges it needs on every
-- table in the public schema, plus DEFAULT PRIVILEGES so future
-- tables inherit. The application's runtime connection pool is then
-- pointed at this role (DATABASE_URL=postgresql://memu_app:...) while
-- the boot-time migration pool keeps the superuser URL
-- (MEMU_DB_MIGRATE_URL=postgresql://memu:...). RLS now enforces.
--
-- Why this is a migration and not a side-channel script. We want
-- the role to exist on every deployment after this migration runs —
-- standalone (Z2) and Hosted (Hetzner) alike. On the Z2, runtime can
-- continue to connect as the superuser until Hareesh flips DATABASE_URL
-- in `.env`; the role just sits there ready. On Hosted, the deploy
-- script sets MEMU_DB_MIGRATE_URL pointing at the superuser and
-- DATABASE_URL pointing at memu_app from day one.
--
-- Idempotency. The whole migration is wrapped in DO blocks so it
-- tolerates re-running. Role creation uses the EXCEPTION-on-duplicate
-- pattern (Postgres has no IF NOT EXISTS for CREATE ROLE).
--
-- Password sourcing. The migration runner sets the session GUC
-- `memu.app_password` from `process.env.MEMU_APP_DB_PASSWORD` BEFORE
-- this migration runs (see src/db/migrate.ts). If the env var is
-- unset, current_setting returns NULL and we skip role creation +
-- emit a NOTICE — the migration is still marked applied (idempotent
-- semantics preserved) so a later boot can re-run with the env var
-- set and re-create the missing role. The way to "re-run" this
-- migration after configuring the password is to DELETE the row from
-- `schema_migrations` first.

-- ---------------------------------------------------------------------------
-- 1. Create the role (or refresh its password if the operator changed it).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  app_password TEXT := current_setting('memu.app_password', true);
BEGIN
  IF app_password IS NULL OR app_password = '' THEN
    RAISE NOTICE 'memu_app role NOT created: MEMU_APP_DB_PASSWORD env var was empty when migration ran. Set it and re-apply (DELETE FROM schema_migrations WHERE filename = ''036_app_role.sql'').';
    RETURN;
  END IF;

  -- Create or refresh the role. CREATE ROLE has no IF NOT EXISTS form
  -- in any current Postgres release; catch duplicate_object and treat
  -- it as the refresh path (just update the password + attributes).
  BEGIN
    EXECUTE format(
      'CREATE ROLE memu_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB INHERIT PASSWORD %L',
      app_password
    );
    RAISE NOTICE 'memu_app role created.';
  EXCEPTION WHEN duplicate_object THEN
    -- Role exists — refresh attributes + password so a rotated env var
    -- propagates. Attribute set is explicit so a previous CREATE that
    -- left the role with the wrong attributes (e.g. accidental
    -- SUPERUSER from a manual migration test) gets corrected.
    EXECUTE format(
      'ALTER ROLE memu_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB INHERIT PASSWORD %L',
      app_password
    );
    RAISE NOTICE 'memu_app role refreshed (attributes + password).';
  END;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Grants — runtime needs CRUD on every existing table + sequence in
--    the public schema, and USAGE on the schema itself.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Only grant if the role exists. (It won't, if step 1 hit the empty-
  -- password skip path.) Avoid a noisy error in that case.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memu_app') THEN
    RAISE NOTICE 'memu_app role does not exist — skipping grants.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO memu_app';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO memu_app';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO memu_app';
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO memu_app';

  -- DEFAULT PRIVILEGES so future tables created by the migration role
  -- inherit the same grants without a manual GRANT after each migration.
  -- Scoped FOR ROLE memu (the entrypoint superuser) so it applies to
  -- objects that role creates — including tables added by future
  -- migrations running through the migration pool.
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE memu IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO memu_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE memu IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO memu_app';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE memu IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO memu_app';

  RAISE NOTICE 'memu_app grants applied.';
END $$;
