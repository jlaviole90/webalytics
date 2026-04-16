-- 0003_auth.up.sql
-- Token resolution must work before the caller's org is known, so it cannot
-- go through the tenant RLS policy on api_tokens. We expose a narrow
-- SECURITY DEFINER function that only the app role can execute. It returns
-- the minimal fields needed to authenticate a request; it does NOT leak
-- cross-tenant data because the caller must already know the raw token.

BEGIN;

CREATE OR REPLACE FUNCTION resolve_api_token(p_hash BYTEA)
RETURNS TABLE (
  id              UUID,
  organization_id UUID,
  site_id         UUID,
  name            TEXT,
  scopes          TEXT[],
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id, organization_id, site_id, name, scopes, expires_at, created_at, revoked_at
  FROM api_tokens
  WHERE token_hash = p_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_api_token(BYTEA) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_api_token(BYTEA) TO webalytics_app;

-- Fire-and-forget last_used_at bump without RLS friction.
CREATE OR REPLACE FUNCTION touch_api_token(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE api_tokens SET last_used_at = now() WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION touch_api_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION touch_api_token(UUID) TO webalytics_app;

COMMIT;
