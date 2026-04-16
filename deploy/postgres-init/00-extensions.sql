-- Ensures pgcrypto + citext are available before any migrations run.
-- The actual CREATE EXTENSION lives in 0001_init.up.sql too (IF NOT EXISTS);
-- this file just guarantees the superuser-gated extensions exist, which
-- matters when migrations run from a non-superuser.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
