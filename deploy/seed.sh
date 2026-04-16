#!/usr/bin/env bash
# Seeds a local webalytics stack with:
#   - one organization  (slug=local)
#   - one site          (name='Local Test Site', domain=localhost + example.com)
#   - one API token     (read:events scope)
#
# Writes the artifacts to stdout and to deploy/.seeded.env for the e2e suite.
# Safe to re-run: seeds are idempotent (keyed on organization slug).

set -euo pipefail

PSQL() {
  docker compose exec -T -e PGPASSWORD=postgres postgres \
    psql -U postgres -d webalytics -qtAX -v ON_ERROR_STOP=1 "$@"
}

# 1. Organization
ORG_ID=$(PSQL -c "
  INSERT INTO organizations (slug, name)
  VALUES ('local', 'Local Dev')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id;
")

# 2. Site (stable public_site_id so seeded events always land on the same row)
PUBLIC_SITE_ID="wb_live_seedseedseedseed"
SITE_ID=$(PSQL -c "
  INSERT INTO sites (organization_id, public_site_id, name)
  VALUES ('$ORG_ID', '$PUBLIC_SITE_ID', 'Local Test Site')
  ON CONFLICT (public_site_id) DO UPDATE SET name = EXCLUDED.name
  RETURNING id;
")

# 3. Domains
PSQL -c "
  INSERT INTO domains (site_id, hostname, is_primary)
  VALUES ('$SITE_ID', 'localhost', TRUE)
  ON CONFLICT (site_id, hostname) DO NOTHING;
"
PSQL -c "
  INSERT INTO domains (site_id, hostname)
  VALUES ('$SITE_ID', 'example.com')
  ON CONFLICT (site_id, hostname) DO NOTHING;
"

# 4. Token — we generate the raw value here so we can hand it to the caller.
RAW_TOKEN="wb_pat_live_$(openssl rand -hex 16)"
TOKEN_HASH=$(printf "%s" "$RAW_TOKEN" | openssl dgst -sha256 -binary | xxd -p -c 200)
TOKEN_PREFIX=${RAW_TOKEN:0:12}

PSQL -c "
  INSERT INTO api_tokens (organization_id, name, token_hash, token_prefix, scopes)
  VALUES ('$ORG_ID', 'dev-token', decode('$TOKEN_HASH', 'hex'), '$TOKEN_PREFIX',
          ARRAY['read:events','write:sites','admin:tokens','admin:export']::TEXT[])
  ON CONFLICT DO NOTHING;
"

cat <<EOF
SEEDED OK
  organization_id = $ORG_ID
  site_id         = $SITE_ID
  public_site_id  = $PUBLIC_SITE_ID
  api_token       = $RAW_TOKEN

Export for curl / e2e:
  export WEBALYTICS_HOST=http://localhost:8080
  export WEBALYTICS_SITE_ID=$PUBLIC_SITE_ID
  export WEBALYTICS_ORG_SITE_UUID=$SITE_ID
  export WEBALYTICS_TOKEN=$RAW_TOKEN
EOF

cat > deploy/.seeded.env <<EOF
WEBALYTICS_HOST=http://localhost:8080
WEBALYTICS_SITE_ID=$PUBLIC_SITE_ID
WEBALYTICS_ORG_SITE_UUID=$SITE_ID
WEBALYTICS_TOKEN=$RAW_TOKEN
EOF
