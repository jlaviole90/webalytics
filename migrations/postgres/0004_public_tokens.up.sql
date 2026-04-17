-- 0004_public_tokens.up.sql
-- Browser-safe, read-only embed tokens.
--
-- Private `api_tokens` grant access to the full /v1 admin + stats surface
-- for an organization. They must never reach the browser. The table below
-- grants a narrower capability:
--
--   * Scoped to exactly one site (not the whole org)
--   * Read-only (handlers mounted under /public/v1 only include /stats/*)
--   * Optionally bound to a set of browser Origins; enforced via CORS
--     preflight and a server-side re-check
--   * Safe to embed in client-side JS
--
-- Tokens are hashed on insert the same way api_tokens are. Resolution goes
-- through a SECURITY DEFINER function so lookups work before we know the
-- org context (the token IS how we learn it).

BEGIN;

CREATE TABLE public_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT 'default',
  token_hash      BYTEA NOT NULL,
  token_prefix    TEXT NOT NULL,
  -- Empty array = accept any Origin (useful for public "stats pages" like
  -- Plausible's share links). Non-empty = CORS + server-side check against
  -- this exact set. Origins are stored with scheme+host (e.g.
  -- 'https://jlav.io'), matched literally, case-insensitively.
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  UNIQUE (site_id, name)
);
CREATE UNIQUE INDEX public_tokens_hash_idx ON public_tokens (token_hash);
CREATE INDEX public_tokens_site_idx ON public_tokens (site_id) WHERE revoked_at IS NULL;

-- Resolution function: see migrations/postgres/0003_auth.up.sql for the
-- same pattern on api_tokens.
CREATE OR REPLACE FUNCTION resolve_public_token(p_hash BYTEA)
RETURNS TABLE (
  id              UUID,
  site_id         UUID,
  organization_id UUID,
  name            TEXT,
  allowed_origins TEXT[],
  expires_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id, site_id, organization_id, name, allowed_origins, expires_at
  FROM public_tokens
  WHERE token_hash = p_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_public_token(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_token(BYTEA) TO webalytics_app;

CREATE OR REPLACE FUNCTION touch_public_token(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public_tokens SET last_used_at = now() WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION touch_public_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_public_token(UUID) TO webalytics_app;

-- RLS: tenant-scoped like api_tokens.
ALTER TABLE public_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY public_tokens_tenant ON public_tokens
  USING (organization_id = current_org_id())
  WITH CHECK (organization_id = current_org_id());

COMMIT;
