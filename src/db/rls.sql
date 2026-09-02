-- Row-level security: the real tenant boundary.
--
-- Every tenant-scoped table gets a policy keyed on the `app.tenant_id` GUC,
-- which the application sets per transaction. A query that forgets its
-- WHERE tenant_id = ... clause returns zero rows instead of leaking another
-- shop's orders.
--
-- FORCE ROW LEVEL SECURITY is essential: without it the table OWNER bypasses
-- every policy, so the protection silently does nothing whenever migrations
-- and the app share a role.

-- Helper: current tenant, or NULL when no context has been set.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'subscriptions', 'users', 'categories', 'products', 'orders', 'order_items'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    -- USING governs which rows are visible to SELECT/UPDATE/DELETE.
    -- WITH CHECK governs which rows may be written, and blocks a tenant from
    -- inserting a row stamped with somebody else's tenant_id.
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    $f$, t);
  END LOOP;
END $$;

-- `users` additionally holds platform admins with a NULL tenant_id. They are
-- deliberately invisible under tenant context: a shop owner must never be able
-- to enumerate, or worse update, platform staff accounts. Platform-side code
-- uses the bypass role below instead.

-- The application connects as this role. It owns nothing, so FORCE RLS applies
-- to it unconditionally.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crackers_app') THEN
    CREATE ROLE crackers_app LOGIN;
  END IF;
END $$;

-- Applied unconditionally, not only on creation: a role that already existed
-- with different attributes would otherwise keep them forever, and this script
-- would report success while the setup it describes was never true.
ALTER ROLE crackers_app WITH LOGIN NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO crackers_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crackers_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crackers_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crackers_app;

-- Platform administration (creating tenants, billing, support) needs to see
-- across all tenants. It gets a separate role that is exempt from RLS, so
-- cross-tenant access is an explicit, auditable choice of connection rather
-- than an accident of a missing WHERE clause.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crackers_platform') THEN
    CREATE ROLE crackers_platform LOGIN BYPASSRLS;
  END IF;
END $$;

-- Same reason, and it matters more here: a crackers_platform created earlier
-- WITHOUT BYPASSRLS leaves PLATFORM_DATABASE_URL correctly set and pointing at
-- a role that cannot do the one thing it exists for, so sign-in finds no user
-- and every login fails.
ALTER ROLE crackers_platform WITH LOGIN BYPASSRLS;

GRANT USAGE ON SCHEMA public TO crackers_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crackers_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crackers_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crackers_platform;
