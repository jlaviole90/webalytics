-- 0004_public_tokens.down.sql
BEGIN;
DROP POLICY IF EXISTS public_tokens_tenant ON public_tokens;
DROP FUNCTION IF EXISTS touch_public_token(UUID);
DROP FUNCTION IF EXISTS resolve_public_token(BYTEA);
DROP TABLE IF EXISTS public_tokens;
COMMIT;
