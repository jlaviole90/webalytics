-- 0002_rls.up.sql
-- Row-Level Security as a second line of defense for tenant isolation.
--
-- The application always scopes queries by organization_id; RLS enforces it
-- again at the database layer. Every request sets a session GUC
-- `webalytics.org_id` via `SET LOCAL`; policies compare that to the row's
-- organization_id (resolved via sites for non-org-rooted tables).
--
-- The app's runtime role must NOT be a superuser and must NOT have the
-- BYPASSRLS attribute. A separate admin role is used for migrations and
-- out-of-band maintenance.

BEGIN;

-- ---------------------------------------------------------------------------
-- App role (create only if not already provisioned by infra)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webalytics_app') THEN
    CREATE ROLE webalytics_app LOGIN NOINHERIT;
  END IF;
END$$;

REVOKE ALL ON SCHEMA public FROM webalytics_app;
GRANT USAGE ON SCHEMA public TO webalytics_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO webalytics_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO webalytics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO webalytics_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO webalytics_app;

-- ---------------------------------------------------------------------------
-- Helper: current_org_id() reads the session variable set by the handler.
-- Returns NULL if unset; policies then fail closed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v TEXT := current_setting('webalytics.org_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites               ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains             ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_definitions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;

-- FORCE so even the table owner sees the policies (belt-and-suspenders)
ALTER TABLE sites               FORCE ROW LEVEL SECURITY;
ALTER TABLE domains             FORCE ROW LEVEL SECURITY;
ALTER TABLE event_definitions   FORCE ROW LEVEL SECURITY;
ALTER TABLE api_tokens          FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
CREATE POLICY organizations_tenant ON organizations
  USING (id = current_org_id())
  WITH CHECK (id = current_org_id());

CREATE POLICY memberships_tenant ON memberships
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY sites_tenant ON sites
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY domains_tenant ON domains
  USING (site_id IN (SELECT id FROM sites WHERE organization_id = current_org_id()))
  WITH CHECK (site_id IN (SELECT id FROM sites WHERE organization_id = current_org_id()));

CREATE POLICY event_definitions_tenant ON event_definitions
  USING (site_id IN (SELECT id FROM sites WHERE organization_id = current_org_id()))
  WITH CHECK (site_id IN (SELECT id FROM sites WHERE organization_id = current_org_id()));

CREATE POLICY api_tokens_tenant ON api_tokens
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

CREATE POLICY audit_log_tenant_select ON audit_log
  FOR SELECT
  USING (organization_id IS NULL OR organization_id = current_org_id());

CREATE POLICY audit_log_tenant_insert ON audit_log
  FOR INSERT
  WITH CHECK (organization_id IS NULL OR organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- Ingest path exception: the hot path looks up sites + domains by public
-- identifiers BEFORE it knows the org. A separate `webalytics_ingest` role
-- has read-only access to a narrow view that bypasses RLS safely.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'webalytics_ingest') THEN
    CREATE ROLE webalytics_ingest LOGIN NOINHERIT BYPASSRLS;
  END IF;
END$$;

CREATE OR REPLACE VIEW ingest_site_lookup AS
SELECT
  s.id                AS site_id,
  s.organization_id,
  s.public_site_id,
  s.timezone,
  s.retention_days,
  s.settings,
  d.hostname
FROM sites s
JOIN domains d ON d.site_id = s.id
WHERE s.deleted_at IS NULL;

REVOKE ALL ON ingest_site_lookup FROM PUBLIC;
GRANT SELECT ON ingest_site_lookup TO webalytics_ingest;

COMMIT;
