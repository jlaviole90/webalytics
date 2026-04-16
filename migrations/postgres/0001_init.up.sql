-- 0001_init.up.sql
-- Initial control-plane schema for Webalytics.
-- Requires Postgres 14+ (for gen_random_uuid in pgcrypto and CITEXT).

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        CITEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- users + memberships
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT UNIQUE NOT NULL,
  password_hash  TEXT,                                       -- nullable for SSO-only
  name           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_id_idx ON memberships (user_id);

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
CREATE TABLE sites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  public_site_id  TEXT UNIQUE NOT NULL
    CHECK (public_site_id ~ '^wb_(live|test)_[A-Za-z0-9]{16,}$'),
  name            TEXT NOT NULL,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  retention_days  INTEGER NOT NULL DEFAULT 365
    CHECK (retention_days BETWEEN 1 AND 3650),
  settings        JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX sites_org_id_idx ON sites (organization_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- domains
-- ---------------------------------------------------------------------------
CREATE TABLE domains (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname     CITEXT NOT NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, hostname)
);

-- Hot path: ingest looks up "does this site own this hostname?" for every request.
CREATE INDEX domains_hostname_idx ON domains (hostname);

-- A site can have at most one primary domain.
CREATE UNIQUE INDEX domains_one_primary_per_site_idx
  ON domains (site_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- event_definitions
-- ---------------------------------------------------------------------------
CREATE TABLE event_definitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (name ~ '^[a-zA-Z0-9_.:-]{1,64}$'),
  description TEXT,
  schema      JSONB,
  is_goal     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);

-- Reserve the names the server handles specially.
ALTER TABLE event_definitions
  ADD CONSTRAINT event_definitions_no_reserved_names
  CHECK (name NOT IN ('pageview', 'web_vital'));

-- ---------------------------------------------------------------------------
-- api_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE api_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  token_hash      BYTEA NOT NULL,
  token_prefix    TEXT NOT NULL,        -- first 12 chars shown in UI for identification
  scopes          TEXT[] NOT NULL DEFAULT ARRAY['read:events']::TEXT[],
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens (token_hash);
CREATE INDEX api_tokens_org_idx ON api_tokens (organization_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- audit_log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_token_id  UUID REFERENCES api_tokens(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,           -- e.g. 'site.created', 'token.revoked'
  target_type     TEXT,
  target_id       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip              INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_created_idx ON audit_log (organization_id, created_at DESC);

-- Prevent mutation of audit rows.
CREATE FUNCTION audit_log_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- ---------------------------------------------------------------------------
-- updated_at touch triggers
-- ---------------------------------------------------------------------------
CREATE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch       BEFORE UPDATE ON organizations       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch               BEFORE UPDATE ON users               FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER sites_touch               BEFORE UPDATE ON sites               FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER event_definitions_touch   BEFORE UPDATE ON event_definitions   FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
