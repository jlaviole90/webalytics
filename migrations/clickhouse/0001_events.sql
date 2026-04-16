-- 0001_events.sql
-- Primary event table for the Webalytics event plane.
--
-- The CH docker entrypoint runs init scripts against the `default` database
-- even when CLICKHOUSE_DB is set, so we `USE` the right database explicitly.
USE webalytics;

-- ----------------------------------------------------------------------------
--
-- Design notes:
--   * Partition by month to keep each part a reasonable size and make
--     TTL-based retention cheap.
--   * ORDER BY prefixes the tenant keys so every query that filters by
--     (organization_id, site_id) hits a tight range of the primary index.
--   * LowCardinality on repeated string dims gives ~10x compression and
--     faster group-bys.
--   * Map(String, String) for `props` lets us accept arbitrary custom-event
--     properties without schema migrations; common ones can be promoted to
--     top-level columns later.
--   * A ReplicatedMergeTree engine should be used in production; the plain
--     MergeTree variant here works for single-node dev.

CREATE TABLE IF NOT EXISTS events
(
    ------------------------------------------------------------------
    -- Tenant keys (present on EVERY row)
    ------------------------------------------------------------------
    organization_id   UUID,
    site_id           UUID,

    ------------------------------------------------------------------
    -- Time
    ------------------------------------------------------------------
    ts                DateTime64(3, 'UTC'),
    date              Date MATERIALIZED toDate(ts),

    ------------------------------------------------------------------
    -- Identity (never PII)
    ------------------------------------------------------------------
    session_id        FixedString(16),     -- HMAC(ip, ua, daily_salt, site_id)
    visitor_id        FixedString(16),     -- HMAC(ip, ua, 28d_salt); all zero in cookieless mode
    is_new_session    UInt8,

    ------------------------------------------------------------------
    -- Request
    ------------------------------------------------------------------
    event_name        LowCardinality(String),         -- 'pageview'|'web_vital'|<custom>
    hostname          LowCardinality(String),          -- 'www.example.com'
    url_path          String,                          -- '/blog/hello-world'
    route             LowCardinality(String),          -- '/blog/[slug]' (optional)
    url_query         String,
    referrer_host     LowCardinality(String),
    referrer_path     String,

    ------------------------------------------------------------------
    -- Deployment context
    ------------------------------------------------------------------
    environment       LowCardinality(String),          -- 'production' default
    release           LowCardinality(String),

    ------------------------------------------------------------------
    -- UTM
    ------------------------------------------------------------------
    utm_source        LowCardinality(String),
    utm_medium        LowCardinality(String),
    utm_campaign      LowCardinality(String),
    utm_term          String,
    utm_content       String,

    ------------------------------------------------------------------
    -- Device / UA
    ------------------------------------------------------------------
    ua_browser        LowCardinality(String),
    ua_browser_ver    LowCardinality(String),
    ua_os             LowCardinality(String),
    ua_os_ver         LowCardinality(String),
    ua_device_type    LowCardinality(String),          -- 'desktop'|'mobile'|'tablet'|'bot'

    ------------------------------------------------------------------
    -- Geo (from IP, raw IP never stored)
    ------------------------------------------------------------------
    country_code      LowCardinality(FixedString(2)),  -- ISO 3166-1 alpha-2
    region            LowCardinality(String),
    city              LowCardinality(String),

    ------------------------------------------------------------------
    -- Page metadata
    ------------------------------------------------------------------
    page_title        String,
    screen_w          UInt16,
    screen_h          UInt16,
    viewport_w        UInt16,
    viewport_h        UInt16,
    language          LowCardinality(String),

    ------------------------------------------------------------------
    -- Custom props + revenue
    ------------------------------------------------------------------
    props             Map(String, String),
    revenue           Nullable(Decimal(18, 4)),
    revenue_currency  LowCardinality(String),

    ------------------------------------------------------------------
    -- Web Vitals (populated only when event_name = 'web_vital')
    ------------------------------------------------------------------
    metric_name       LowCardinality(String),          -- 'LCP'|'INP'|'CLS'|'FCP'|'TTFB'
    metric_value      Nullable(Float64),               -- ms (unitless for CLS)
    metric_rating     LowCardinality(String),          -- 'good'|'needs-improvement'|'poor'

    ------------------------------------------------------------------
    -- Navigation timing (pageview rows)
    ------------------------------------------------------------------
    load_time_ms      Nullable(UInt32),
    ttfb_ms           Nullable(UInt32)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (organization_id, site_id, event_name, hostname, ts)
TTL date + INTERVAL 400 DAY
SETTINGS index_granularity = 8192;

-- Skipping indexes to speed up common non-prefix filters.
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_url_path       url_path      TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_route          route         TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_referrer_host  referrer_host TYPE bloom_filter(0.01) GRANULARITY 4;
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_country        country_code  TYPE set(300)             GRANULARITY 1;
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_event_name     event_name    TYPE set(100)             GRANULARITY 1;
