-- 0001_init.down.sql
-- Full rollback of 0001_init.up.sql.

BEGIN;

DROP TRIGGER IF EXISTS event_definitions_touch   ON event_definitions;
DROP TRIGGER IF EXISTS sites_touch               ON sites;
DROP TRIGGER IF EXISTS users_touch               ON users;
DROP TRIGGER IF EXISTS organizations_touch       ON organizations;
DROP FUNCTION IF EXISTS touch_updated_at();

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
DROP FUNCTION IF EXISTS audit_log_immutable();

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS event_definitions;
DROP TABLE IF EXISTS domains;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS organizations;

-- Extensions are intentionally left installed; dropping them is rarely what you want.

COMMIT;
