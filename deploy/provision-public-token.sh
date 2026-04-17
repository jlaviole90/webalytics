#!/usr/bin/env bash
# Mint a public (browser-safe) embed token for an existing tenant.
#
# Public tokens grant READ-ONLY access to /public/v1/sites/<uuid>/stats/*
# and are scoped to exactly one site. They are safe to embed in client-side
# JS because:
#   * They cannot reach /v1 (admin API) — the router refuses them there.
#   * They only expose aggregate stats; no PII (no IPs, no UA strings,
#     no session/visitor IDs) is reachable.
#   * They can be bound to a specific set of browser Origins via
#     Access-Control-Allow-Origin + a server-side Origin re-check.
#
# Usage (local, from repo root):
#   ORG_SLUG=jlav \
#     ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io' \
#     bash deploy/provision-public-token.sh
#
# Usage (on the Lightsail box):
#   cd /opt/webalytics
#   sudo ORG_SLUG=jlav \
#     ALLOWED_ORIGINS='https://jlav.io,https://www.jlav.io' \
#     bash deploy/provision-public-token.sh
#
# Re-running ROTATES the token (delete-then-insert under the same name).
# The previously-distributed token stops working immediately.
#
# Notes:
#   * ALLOWED_ORIGINS accepts either full origins (scheme://host[:port])
#     or bare hostnames. Bare hostnames are expanded to https:// variants
#     with and without the "www." prefix so 99% of personal sites need no
#     further thought.
#   * Passing ALLOWED_ORIGINS='' (empty) creates an "unbound" public
#     token — any origin can use it (think "public stats share link"
#     like Plausible's share URLs). Use with care.
#   * PUBLIC_TOKEN_NAME lets you mint multiple tokens per site (e.g.
#     'embed-staging', 'embed-prod'). Default is 'embed'.

set -euo pipefail

: "${ORG_SLUG:?ORG_SLUG required (same slug used in provision-site.sh)}"
# ALLOWED_ORIGINS may be intentionally empty; handle that below.
ALLOWED_ORIGINS="${ALLOWED_ORIGINS-}"
PUBLIC_TOKEN_NAME="${PUBLIC_TOKEN_NAME:-embed}"
# Optional: bind to a specific site in the org by its UUID. If omitted
# we pick the most recently created site, which is the common case for
# single-site tenants like this runbook was designed for.
TARGET_SITE_UUID="${TARGET_SITE_UUID:-}"

PSQL() {
  docker compose exec -T -e PGPASSWORD=postgres postgres \
    psql -U postgres -d webalytics -qtAX -v ON_ERROR_STOP=1 "$@"
}

# Resolve org + site
ORG_ID=$(PSQL -c "SELECT id FROM organizations WHERE slug = '$ORG_SLUG';")
if [ -z "$ORG_ID" ]; then
  echo "error: no organization with slug '$ORG_SLUG'. Run deploy/provision-site.sh first." >&2
  exit 1
fi

if [ -n "$TARGET_SITE_UUID" ]; then
  SITE_ID="$TARGET_SITE_UUID"
  SITE_ROW=$(PSQL -c "SELECT id FROM sites WHERE id = '$SITE_ID' AND organization_id = '$ORG_ID';")
  if [ -z "$SITE_ROW" ]; then
    echo "error: site $SITE_ID does not belong to org $ORG_SLUG" >&2
    exit 1
  fi
else
  SITE_ID=$(PSQL -c "
    SELECT id FROM sites
    WHERE organization_id = '$ORG_ID' AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  ")
  if [ -z "$SITE_ID" ]; then
    echo "error: org $ORG_SLUG has no sites" >&2
    exit 1
  fi
fi

PUBLIC_SITE_ID=$(PSQL -c "SELECT public_site_id FROM sites WHERE id = '$SITE_ID';")

# Expand ALLOWED_ORIGINS into the Postgres array literal.
#
# For each comma-separated entry:
#   * if it already has a scheme (http:// or https://), keep as-is
#   * otherwise treat as a bare hostname and expand to https://host AND
#     https://www.host (or https://bare if it already starts with www.)
#
# Stored array is lowercase so server-side comparison is stable.
origins_pg_array() {
  local raw="$1"
  if [ -z "$raw" ]; then
    echo "'{}'"
    return 0
  fi
  local out=()
  IFS=',' read -ra entries <<< "$raw"
  for e in "${entries[@]}"; do
    e=$(echo "$e" | xargs)
    [ -z "$e" ] && continue
    # lower-case
    e=$(echo "$e" | tr '[:upper:]' '[:lower:]')
    if [[ "$e" == http://* || "$e" == https://* ]]; then
      out+=("$e")
    else
      if [[ "$e" == www.* ]]; then
        bare="${e#www.}"
        out+=("https://$e" "https://$bare")
      else
        out+=("https://$e" "https://www.$e")
      fi
    fi
  done
  # Build a Postgres array literal like ARRAY['a','b']::TEXT[].
  local joined=""
  for o in "${out[@]}"; do
    if [ -z "$joined" ]; then
      joined="'$o'"
    else
      joined="$joined, '$o'"
    fi
  done
  echo "ARRAY[$joined]::TEXT[]"
}
ORIGINS_SQL=$(origins_pg_array "$ALLOWED_ORIGINS")

# Mint the token
RAW_TOKEN="wb_pub_live_$(openssl rand -hex 16)"
TOKEN_HASH=$(printf "%s" "$RAW_TOKEN" | openssl dgst -sha256 -binary | xxd -p -c 200)
TOKEN_PREFIX=${RAW_TOKEN:0:20}

# Upsert: (site_id, name) is the unique key. Rotating on conflict matches
# the UX of provision-site.sh: re-running is idempotent except the secret
# is always new.
PSQL -c "
  INSERT INTO public_tokens
    (site_id, organization_id, name, token_hash, token_prefix, allowed_origins)
  VALUES
    ('$SITE_ID', '$ORG_ID', '$PUBLIC_TOKEN_NAME',
     decode('$TOKEN_HASH', 'hex'), '$TOKEN_PREFIX', $ORIGINS_SQL)
  ON CONFLICT (site_id, name) DO UPDATE SET
    token_hash      = EXCLUDED.token_hash,
    token_prefix    = EXCLUDED.token_prefix,
    allowed_origins = EXCLUDED.allowed_origins,
    revoked_at      = NULL;
"

if [ -n "$ALLOWED_ORIGINS" ]; then
  DISPLAY_ORIGINS="$ALLOWED_ORIGINS"
else
  DISPLAY_ORIGINS="(unbound — any origin can use this token)"
fi

cat <<EOF

PROVISIONED PUBLIC EMBED TOKEN
  org:               $ORG_SLUG
  site_uuid:         $SITE_ID
  public_site_id:    $PUBLIC_SITE_ID
  token_name:        $PUBLIC_TOKEN_NAME
  allowed_origins:   $DISPLAY_ORIGINS
  embed_token:       $RAW_TOKEN

Browser-safe install (React / Next / Angular / vanilla JS):
  host:         https://<your-deploy>
  siteUuid:     $SITE_ID
  publicToken:  $RAW_TOKEN

This token can safely be committed to a public repo or shipped to the
browser. It only grants read access to aggregate stats for this one site,
and (when allowed_origins is set) only from the listed origins.

EOF

# Append to the tenant's env file so the dashboard SDKs can source it.
# Keeps existing admin-token values intact; adds the new public-token
# values alongside.
mkdir -p deploy/tenants
OUT="deploy/tenants/${ORG_SLUG}.env"
touch "$OUT"
chmod 600 "$OUT"

# Remove any previous public-token lines (simple in-place filter) before
# appending the fresh ones, so re-runs don't stack duplicates.
if grep -q '^WEBALYTICS_PUBLIC_TOKEN' "$OUT" 2>/dev/null; then
  grep -v '^WEBALYTICS_PUBLIC_TOKEN' "$OUT" > "${OUT}.tmp"
  mv "${OUT}.tmp" "$OUT"
  chmod 600 "$OUT"
fi

cat >> "$OUT" <<EOF
# Auto-appended by provision-public-token.sh. Browser-safe.
WEBALYTICS_PUBLIC_TOKEN=$RAW_TOKEN
WEBALYTICS_PUBLIC_TOKEN_NAME=$PUBLIC_TOKEN_NAME
WEBALYTICS_PUBLIC_TOKEN_ORIGINS=$ALLOWED_ORIGINS
EOF

echo "Credentials merged into $OUT"
