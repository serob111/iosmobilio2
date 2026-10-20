-- Run once, by the Postgres bootstrap superuser (POSTGRES_USER/PASSWORD from
-- docker-compose / CI services:), before any Drizzle-managed migration. Creates the
-- two least-privilege roles RLS depends on:
--   mobilio_migrator — owns the schema, runs DDL (table creation, RLS policies, grants).
--   mobilio_app      — runs app queries; NOBYPASSRLS, not a table owner, DML only.
-- Idempotent: safe to run against an already-bootstrapped database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobilio_migrator') THEN
    EXECUTE format('CREATE ROLE mobilio_migrator LOGIN PASSWORD %L', '__MOBILIO_MIGRATOR_PASSWORD__');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mobilio_app') THEN
    EXECUTE format('CREATE ROLE mobilio_app LOGIN NOBYPASSRLS PASSWORD %L', '__MOBILIO_APP_PASSWORD__');
  END IF;
END
$$;

-- CREATE ON DATABASE lets mobilio_migrator create its own "drizzle" tracking schema
-- (drizzle-orm's migrator does this automatically) in addition to owning "public".
GRANT CREATE ON DATABASE mobilio TO mobilio_migrator;
ALTER SCHEMA public OWNER TO mobilio_migrator;
GRANT ALL ON SCHEMA public TO mobilio_migrator;
GRANT USAGE ON SCHEMA public TO mobilio_app;

-- Every table mobilio_migrator creates from now on automatically grants mobilio_app
-- DML rights, so a future migration that adds a table doesn't also need a separate
-- "don't forget to grant it" step.
ALTER DEFAULT PRIVILEGES FOR ROLE mobilio_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mobilio_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mobilio_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO mobilio_app;
