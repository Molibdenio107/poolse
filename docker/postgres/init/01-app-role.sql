-- The unprivileged application role.
--
-- The core-tenancy migration also creates poolse_app if it is missing, but
-- without a password — a migration has no business knowing one. It is set here
-- so that DATABASE_APP_URL can log in, and it must stay in step with .env.
--
-- This role must never own the tables: a table's owner bypasses every RLS policy
-- on it, which would disable tenant isolation with no visible symptom. The API
-- checks this at startup (assertRlsApplies) rather than trusting the setup.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'poolse_app') THEN
    CREATE ROLE poolse_app LOGIN PASSWORD 'change-me';
  END IF;
END
$$;
