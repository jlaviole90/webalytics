-- 0002_rls.down.sql
-- Rollback of RLS policies and helper objects.

BEGIN;

DROP VIEW IF EXISTS ingest_site_lookup;

DROP POLICY IF EXISTS audit_log_tenant_insert     ON audit_log;
DROP POLICY IF EXISTS audit_log_tenant_select     ON audit_log;
DROP POLICY IF EXISTS api_tokens_tenant           ON api_tokens;
DROP POLICY IF EXISTS event_definitions_tenant    ON event_definitions;
DROP POLICY IF EXISTS domains_tenant              ON domains;
DROP POLICY IF EXISTS sites_tenant                ON sites;
DROP POLICY IF EXISTS memberships_tenant          ON memberships;
DROP POLICY IF EXISTS organizations_tenant        ON organizations;

ALTER TABLE audit_log           DISABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens          DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_definitions   DISABLE ROW LEVEL SECURITY;
ALTER TABLE domains             DISABLE ROW LEVEL SECURITY;
ALTER TABLE sites               DISABLE ROW LEVEL SECURITY;
ALTER TABLE memberships         DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations       DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS current_org_id();

-- Roles are intentionally not dropped; infra manages them.

COMMIT;
