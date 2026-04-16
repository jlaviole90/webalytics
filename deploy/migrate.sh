#!/bin/sh
# Applies every migrations/postgres/*.up.sql exactly once, tracked in a
# `schema_migrations` table so the container is idempotent across restarts.
# Also provisions the webalytics_app / webalytics_ingest role passwords.
set -eu

apk add --no-cache postgresql-client >/dev/null 2>&1 || true

echo "ensuring schema_migrations table exists..."
psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      TEXT PRIMARY KEY,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# Backfill: if schema_migrations is empty but an `organizations` table already
# exists, this database predates the tracking table. Assume all migration
# files on disk are already applied and record them so we don't re-run them.
tracked=$(psql -qtAX -c "SELECT count(*) FROM schema_migrations")
existing=$(psql -qtAX -c "SELECT to_regclass('public.organizations') IS NOT NULL")
if [ "$tracked" = "0" ] && [ "$existing" = "t" ]; then
  echo "pre-existing schema detected; backfilling schema_migrations"
  for f in /migrations/*.up.sql; do
    version=$(basename "$f" .up.sql)
    psql -v ON_ERROR_STOP=1 \
      -c "INSERT INTO schema_migrations (version) VALUES ('$version') ON CONFLICT DO NOTHING;"
  done
fi

echo "running postgres migrations..."
for f in /migrations/*.up.sql; do
  version=$(basename "$f" .up.sql)
  # skip if already applied
  already=$(psql -qtAX -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")
  if [ "$already" = "1" ]; then
    echo "skip $version (already applied)"
    continue
  fi
  echo "applying $version"
  # Apply in a single transaction and record it on success. ON_ERROR_STOP
  # makes psql exit non-zero on the first failing statement, rolling back
  # the whole migration.
  psql -v ON_ERROR_STOP=1 --single-transaction \
    -f "$f" \
    -c "INSERT INTO schema_migrations (version) VALUES ('$version');"
done

echo "provisioning role passwords..."
psql -v ON_ERROR_STOP=1 <<'SQL'
ALTER ROLE webalytics_app    WITH PASSWORD 'app-password';
ALTER ROLE webalytics_ingest WITH PASSWORD 'ingest-password';
SQL

echo "migrations complete"
