#!/usr/bin/env bash
# Onboard a new client in a single pass: creates the org, site, domains,
# admin API token, AND a browser-safe public embed token.
#
# Usage (local, from repo root with docker running):
#   ORG_SLUG=acme ORG_NAME="Acme Corp" \
#     SITE_NAME="Acme Marketing" \
#     DOMAINS="acme.com,www.acme.com" \
#     bash deploy/onboard.sh
#
# Usage (remote, via Makefile — preferred):
#   make onboard-remote ORG_SLUG=acme ORG_NAME="Acme Corp" \
#     SITE_NAME="Acme Marketing" DOMAINS="acme.com,www.acme.com"
#
# ALLOWED_ORIGINS defaults to https:// expansions of DOMAINS if omitted.
# Re-running is safe: org/site/domains are upserted, tokens are rotated.

set -euo pipefail

: "${ORG_SLUG:?ORG_SLUG required (url-safe id, e.g. 'acme')}"
: "${ORG_NAME:?ORG_NAME required (display name, e.g. 'Acme Corp')}"
: "${SITE_NAME:?SITE_NAME required (e.g. 'Acme Marketing')}"
: "${DOMAINS:?DOMAINS required (comma-separated, e.g. 'acme.com,www.acme.com')}"

TOKEN_NAME="${TOKEN_NAME:-default}"
PUBLIC_TOKEN_NAME="${PUBLIC_TOKEN_NAME:-embed}"

# If ALLOWED_ORIGINS isn't set, derive from DOMAINS (https:// + www variants).
if [ -z "${ALLOWED_ORIGINS:-}" ]; then
  _origins=()
  IFS=',' read -ra _doms <<< "$DOMAINS"
  for d in "${_doms[@]}"; do
    d=$(echo "$d" | xargs | tr '[:upper:]' '[:lower:]')
    [ -z "$d" ] && continue
    if [[ "$d" == www.* ]]; then
      _origins+=("https://$d" "https://${d#www.}")
    else
      _origins+=("https://$d" "https://www.$d")
    fi
  done
  ALLOWED_ORIGINS=$(IFS=','; echo "${_origins[*]}")
fi

PUBLIC_SITE_ID="${PUBLIC_SITE_ID:-wb_live_$(printf "%s_%s" "$ORG_SLUG" "$SITE_NAME" | \
  openssl dgst -sha256 -binary | xxd -p -c 200 | head -c 20)}"

PSQL() {
  docker compose exec -T -e PGPASSWORD=postgres postgres \
    psql -U postgres -d webalytics -qtAX -v ON_ERROR_STOP=1 "$@"
}

# ── 1. Organization (upsert) ──────────────────────────────────────────
ORG_ID=$(PSQL -c "
  INSERT INTO organizations (slug, name)
  VALUES ('$ORG_SLUG', '$ORG_NAME')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id;
")

# ── 2. Site (upsert) ──────────────────────────────────────────────────
SITE_ID=$(PSQL -c "
  INSERT INTO sites (organization_id, public_site_id, name)
  VALUES ('$ORG_ID', '$PUBLIC_SITE_ID', '$SITE_NAME')
  ON CONFLICT (public_site_id) DO UPDATE SET name = EXCLUDED.name
  RETURNING id;
")

# ── 3. Domains ─────────────────────────────────────────────────────────
IFS=',' read -ra DOMAIN_LIST <<< "$DOMAINS"
PRIMARY=1
for d in "${DOMAIN_LIST[@]}"; do
  d=$(echo "$d" | xargs)
  if [ "$PRIMARY" = "1" ]; then
    PSQL -c "
      INSERT INTO domains (site_id, hostname, is_primary)
      VALUES ('$SITE_ID', '$d', TRUE)
      ON CONFLICT (site_id, hostname) DO UPDATE SET is_primary = TRUE;
    "
    PRIMARY=0
  else
    PSQL -c "
      INSERT INTO domains (site_id, hostname)
      VALUES ('$SITE_ID', '$d')
      ON CONFLICT (site_id, hostname) DO NOTHING;
    "
  fi
done

# ── 4. Admin API token (rotate on re-run) ─────────────────────────────
RAW_ADMIN_TOKEN="wb_pat_live_$(openssl rand -hex 16)"
ADMIN_HASH=$(printf "%s" "$RAW_ADMIN_TOKEN" | openssl dgst -sha256 -binary | xxd -p -c 200)
ADMIN_PREFIX=${RAW_ADMIN_TOKEN:0:20}

PSQL -c "
  DELETE FROM api_tokens WHERE organization_id = '$ORG_ID' AND name = '$TOKEN_NAME';
  INSERT INTO api_tokens (organization_id, name, token_hash, token_prefix, scopes)
  VALUES ('$ORG_ID', '$TOKEN_NAME', decode('$ADMIN_HASH', 'hex'), '$ADMIN_PREFIX',
          ARRAY['read:events','write:sites']::TEXT[]);
"

# ── 5. Public embed token (rotate on re-run) ──────────────────────────
origins_pg_array() {
  local raw="$1"
  if [ -z "$raw" ]; then echo "'{}'"; return 0; fi
  local out=()
  IFS=',' read -ra entries <<< "$raw"
  for e in "${entries[@]}"; do
    e=$(echo "$e" | xargs)
    [ -z "$e" ] && continue
    e=$(echo "$e" | tr '[:upper:]' '[:lower:]')
    if [[ "$e" == http://* || "$e" == https://* ]]; then
      out+=("$e")
    elif [[ "$e" == www.* ]]; then
      out+=("https://$e" "https://${e#www.}")
    else
      out+=("https://$e" "https://www.$e")
    fi
  done
  local joined=""
  for o in "${out[@]}"; do
    [ -z "$joined" ] && joined="'$o'" || joined="$joined, '$o'"
  done
  echo "ARRAY[$joined]::TEXT[]"
}
ORIGINS_SQL=$(origins_pg_array "$ALLOWED_ORIGINS")

RAW_PUBLIC_TOKEN="wb_pub_live_$(openssl rand -hex 16)"
PUB_HASH=$(printf "%s" "$RAW_PUBLIC_TOKEN" | openssl dgst -sha256 -binary | xxd -p -c 200)
PUB_PREFIX=${RAW_PUBLIC_TOKEN:0:20}

PSQL -c "
  INSERT INTO public_tokens
    (site_id, organization_id, name, token_hash, token_prefix, allowed_origins)
  VALUES
    ('$SITE_ID', '$ORG_ID', '$PUBLIC_TOKEN_NAME',
     decode('$PUB_HASH', 'hex'), '$PUB_PREFIX', $ORIGINS_SQL)
  ON CONFLICT (site_id, name) DO UPDATE SET
    token_hash      = EXCLUDED.token_hash,
    token_prefix    = EXCLUDED.token_prefix,
    allowed_origins = EXCLUDED.allowed_origins,
    revoked_at      = NULL;
"

# ── 6. Write credentials file ─────────────────────────────────────────
mkdir -p deploy/tenants
OUT="deploy/tenants/${ORG_SLUG}.env"
umask 077
cat > "$OUT" <<EOF
# Auto-generated by onboard.sh — contains secrets. Keep private.
WEBALYTICS_ORG_SLUG=$ORG_SLUG
WEBALYTICS_ORG_ID=$ORG_ID
WEBALYTICS_SITE_UUID=$SITE_ID
WEBALYTICS_PUBLIC_SITE_ID=$PUBLIC_SITE_ID
WEBALYTICS_TOKEN=$RAW_ADMIN_TOKEN
WEBALYTICS_PUBLIC_TOKEN=$RAW_PUBLIC_TOKEN
WEBALYTICS_PUBLIC_TOKEN_NAME=$PUBLIC_TOKEN_NAME
WEBALYTICS_PUBLIC_TOKEN_ORIGINS=$ALLOWED_ORIGINS
EOF
chmod 600 "$OUT"

# ── 7. Print client-ready output ──────────────────────────────────────
HOST_PLACEHOLDER="\${WEBALYTICS_HOST:-https://<your-deploy>}"

cat <<EOF

════════════════════════════════════════════════════════════════════════
  ONBOARDED: $ORG_NAME ($ORG_SLUG)
════════════════════════════════════════════════════════════════════════

  site_uuid:         $SITE_ID
  public_site_id:    $PUBLIC_SITE_ID
  domains:           $DOMAINS
  allowed_origins:   $ALLOWED_ORIGINS
  admin_token:       $RAW_ADMIN_TOKEN
  public_token:      $RAW_PUBLIC_TOKEN

  Credentials saved to: $OUT

────────────────────────────────────────────────────────────────────────
  SEND TO CLIENT — copy everything below this line
────────────────────────────────────────────────────────────────────────

## 1. Install packages (no auth required — public npm)

    npm install @jlaviole90/tracker           # every framework
    npm install @jlaviole90/dashboard-react   # React / Next.js dashboard
    npm install @jlaviole90/dashboard-angular # Angular dashboard

## 2. Add the tracker (picks up pageviews + web vitals automatically)

### Next.js (App Router) — app/layout.tsx:

    import { Webalytics } from "@jlaviole90/tracker-next";

    export default function RootLayout({ children }) {
      return (
        <html><body>
          {children}
          <Webalytics
            siteId="$PUBLIC_SITE_ID"
            host="$HOST_PLACEHOLDER"
          />
        </body></html>
      );
    }

### Angular — app.config.ts:

    import { provideWebalytics } from "@jlaviole90/tracker-angular";

    providers: [
      provideWebalytics({
        siteId: "$PUBLIC_SITE_ID",
        host:   "$HOST_PLACEHOLDER",
      }),
    ]

### Vanilla JS / any framework:

    import { init } from "@jlaviole90/tracker";
    init({ siteId: "$PUBLIC_SITE_ID", host: "$HOST_PLACEHOLDER" });

## 3. Add the dashboard (optional — shows analytics on your site)

    Use the same site ID ($PUBLIC_SITE_ID) for everything.
    The server resolves it automatically.

### React / Next.js:

    import { createClient, Dashboard } from "@jlaviole90/dashboard-react";

    const client = createClient({
      kind:        "public",
      host:        "$HOST_PLACEHOLDER",
      publicToken: "$RAW_PUBLIC_TOKEN",
      siteId:      "$PUBLIC_SITE_ID",
    });

    export default function AnalyticsPage() {
      return <Dashboard client={client} />;
    }

### Angular:

    import { provideWebalyticsDashboard } from "@jlaviole90/dashboard-angular";

    providers: [
      provideWebalyticsDashboard({
        kind:        "public",
        host:        "$HOST_PLACEHOLDER",
        publicToken: "$RAW_PUBLIC_TOKEN",
        siteId:      "$PUBLIC_SITE_ID",
      }),
    ]

    // In any template:  <wb-dashboard window="7d"></wb-dashboard>

## 4. Environment variables (Vercel / Netlify / CI)

    WEBALYTICS_HOST=$HOST_PLACEHOLDER
    WEBALYTICS_SITE_ID=$PUBLIC_SITE_ID
    WEBALYTICS_PUBLIC_TOKEN=$RAW_PUBLIC_TOKEN

## 5. Server-side dashboard (optional — keeps token off the browser)

    WEBALYTICS_API_HOST=$HOST_PLACEHOLDER
    WEBALYTICS_API_TOKEN=$RAW_ADMIN_TOKEN     # SECRET — server only
    WEBALYTICS_SITE_ID=$PUBLIC_SITE_ID

    createClient({
      host:   process.env.WEBALYTICS_API_HOST,
      token:  process.env.WEBALYTICS_API_TOKEN,
      siteId: process.env.WEBALYTICS_SITE_ID,
    });

════════════════════════════════════════════════════════════════════════
EOF
