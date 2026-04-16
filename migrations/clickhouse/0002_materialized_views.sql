-- 0002_materialized_views.sql
-- Pre-aggregated rollups so the dashboard's common questions don't scan raw
-- events. Each MV writes to a *target* AggregatingMergeTree table; readers
-- query the target with -Merge combinators.
--
-- Run against the webalytics database (not the docker default).
USE webalytics;

-- ============================================================================
-- Daily traffic rollup (one row per org/site/hostname/route/day)
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_traffic
(
    organization_id   UUID,
    site_id           UUID,
    date              Date,
    hostname          LowCardinality(String),
    route             LowCardinality(String),
    url_path          String,
    country_code      LowCardinality(FixedString(2)),
    device_type       LowCardinality(String),
    environment       LowCardinality(String),

    visitors          AggregateFunction(uniq, FixedString(16)),
    pageviews         AggregateFunction(count),
    sessions          AggregateFunction(uniq, FixedString(16))
    -- bounce rate is computed from the `sessions` MV (a bounce = session with
    -- pageviews = 1) because a bounce is only knowable once the session ends.
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (organization_id, site_id, date, hostname, route, url_path, country_code, device_type, environment)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_traffic
TO daily_traffic
AS
SELECT
    organization_id,
    site_id,
    toDate(ts)                                AS date,
    hostname,
    route,
    url_path,
    country_code,
    ua_device_type                            AS device_type,
    environment,
    uniqState(session_id)                     AS visitors,
    countState()                              AS pageviews,
    uniqState(session_id)                     AS sessions
FROM events
WHERE event_name = 'pageview'
GROUP BY organization_id, site_id, date, hostname, route, url_path, country_code, device_type, environment;

-- ============================================================================
-- Referrer rollup
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_referrers
(
    organization_id   UUID,
    site_id           UUID,
    date              Date,
    hostname          LowCardinality(String),
    referrer_host     LowCardinality(String),

    visitors          AggregateFunction(uniq, FixedString(16)),
    pageviews         AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (organization_id, site_id, date, hostname, referrer_host)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_referrers
TO daily_referrers
AS
SELECT
    organization_id,
    site_id,
    toDate(ts)               AS date,
    hostname,
    referrer_host,
    uniqState(session_id)    AS visitors,
    countState()             AS pageviews
FROM events
WHERE event_name = 'pageview' AND referrer_host != ''
GROUP BY organization_id, site_id, date, hostname, referrer_host;

-- ============================================================================
-- UTM rollup
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_utm
(
    organization_id   UUID,
    site_id           UUID,
    date              Date,
    hostname          LowCardinality(String),
    utm_source        LowCardinality(String),
    utm_medium        LowCardinality(String),
    utm_campaign      LowCardinality(String),

    visitors          AggregateFunction(uniq, FixedString(16)),
    pageviews         AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (organization_id, site_id, date, hostname, utm_source, utm_medium, utm_campaign)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_utm
TO daily_utm
AS
SELECT
    organization_id,
    site_id,
    toDate(ts)               AS date,
    hostname,
    utm_source,
    utm_medium,
    utm_campaign,
    uniqState(session_id)    AS visitors,
    countState()             AS pageviews
FROM events
WHERE event_name = 'pageview' AND (utm_source != '' OR utm_medium != '' OR utm_campaign != '')
GROUP BY organization_id, site_id, date, hostname, utm_source, utm_medium, utm_campaign;

-- ============================================================================
-- Session summary (one row per session; used for bounce + duration + funnels)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions
(
    organization_id   UUID,
    site_id           UUID,
    session_id        FixedString(16),
    first_ts          SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_ts           SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    pageviews         SimpleAggregateFunction(sum, UInt64),
    events_count      SimpleAggregateFunction(sum, UInt64),
    entry_path        SimpleAggregateFunction(any, String),
    exit_path         SimpleAggregateFunction(anyLast, String),
    hostname          SimpleAggregateFunction(any, LowCardinality(String)),
    referrer_host     SimpleAggregateFunction(any, LowCardinality(String)),
    utm_source        SimpleAggregateFunction(any, LowCardinality(String)),
    utm_medium        SimpleAggregateFunction(any, LowCardinality(String)),
    utm_campaign      SimpleAggregateFunction(any, LowCardinality(String)),
    country_code      SimpleAggregateFunction(any, LowCardinality(FixedString(2))),
    device_type       SimpleAggregateFunction(any, LowCardinality(String)),
    environment       SimpleAggregateFunction(any, LowCardinality(String)),
    -- ClickHouse widens sum(Decimal(P, S)) to Decimal(38, S) to avoid
    -- overflow on large rollups, so the storage column must match.
    revenue_sum       SimpleAggregateFunction(sum, Decimal(38, 4))
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(first_ts)
ORDER BY (organization_id, site_id, session_id)
TTL toDate(first_ts) + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_sessions
TO sessions
AS
SELECT
    organization_id,
    site_id,
    session_id,
    min(ts)                                       AS first_ts,
    max(ts)                                       AS last_ts,
    countIf(event_name = 'pageview')              AS pageviews,
    count()                                       AS events_count,
    argMin(url_path, ts)                          AS entry_path,
    argMax(url_path, ts)                          AS exit_path,
    any(hostname)                                 AS hostname,
    any(referrer_host)                            AS referrer_host,
    any(utm_source)                               AS utm_source,
    any(utm_medium)                               AS utm_medium,
    any(utm_campaign)                             AS utm_campaign,
    any(country_code)                             AS country_code,
    any(ua_device_type)                           AS device_type,
    any(environment)                              AS environment,
    sum(ifNull(revenue, toDecimal64(0, 4)))       AS revenue_sum
FROM events
WHERE event_name != 'web_vital'
GROUP BY organization_id, site_id, session_id;

-- ============================================================================
-- Web Vitals rollup (p75/p95 via quantiles state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_vitals
(
    organization_id   UUID,
    site_id           UUID,
    date              Date,
    hostname          LowCardinality(String),
    route             LowCardinality(String),
    metric_name       LowCardinality(String),

    samples           AggregateFunction(count),
    quantiles_state   AggregateFunction(quantilesTDigest(0.75, 0.95), Float64),
    good_count        AggregateFunction(countIf, UInt8),
    ni_count          AggregateFunction(countIf, UInt8),
    poor_count        AggregateFunction(countIf, UInt8)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(date)
ORDER BY (organization_id, site_id, date, hostname, route, metric_name)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_vitals
TO daily_vitals
AS
SELECT
    organization_id,
    site_id,
    toDate(ts)                                             AS date,
    hostname,
    route,
    metric_name,
    countState()                                           AS samples,
    -- assumeNotNull is safe here: the WHERE below filters metric_value IS NOT NULL.
    -- Without it the state type would be Nullable(Float64), which can't be
    -- written into the non-nullable Float64 column on the target table.
    quantilesTDigestState(0.75, 0.95)(assumeNotNull(metric_value)) AS quantiles_state,
    countIfState(metric_rating = 'good')                   AS good_count,
    countIfState(metric_rating = 'needs-improvement')      AS ni_count,
    countIfState(metric_rating = 'poor')                   AS poor_count
FROM events
WHERE event_name = 'web_vital' AND metric_value IS NOT NULL
GROUP BY organization_id, site_id, date, hostname, route, metric_name;

-- ============================================================================
-- Convenience views for reads (wrap -Merge so the app can issue simple SQL)
-- ============================================================================
CREATE VIEW IF NOT EXISTS v_daily_traffic AS
SELECT
    organization_id,
    site_id,
    date,
    hostname,
    route,
    url_path,
    country_code,
    device_type,
    environment,
    uniqMerge(visitors)           AS visitors,
    countMerge(pageviews)         AS pageviews,
    uniqMerge(sessions)           AS sessions
FROM daily_traffic
GROUP BY organization_id, site_id, date, hostname, route, url_path, country_code, device_type, environment;

-- Bounce rate per day (derived from sessions): a bounce is a session with
-- exactly 1 pageview. Use this view directly, or aggregate further.
CREATE VIEW IF NOT EXISTS v_daily_bounce AS
SELECT
    organization_id,
    site_id,
    toDate(first_ts)                                  AS date,
    hostname,
    environment,
    count()                                           AS sessions,
    countIf(pageviews = 1)                            AS bounces,
    countIf(pageviews = 1) / greatest(count(), 1)     AS bounce_rate,
    avg(toUnixTimestamp64Milli(last_ts) - toUnixTimestamp64Milli(first_ts)) / 1000 AS avg_session_s
FROM sessions
GROUP BY organization_id, site_id, date, hostname, environment;

CREATE VIEW IF NOT EXISTS v_daily_vitals AS
SELECT
    organization_id,
    site_id,
    date,
    hostname,
    route,
    metric_name,
    countMerge(samples)                                      AS samples,
    quantilesTDigestMerge(0.75, 0.95)(quantiles_state)       AS quantiles,
    countIfMerge(good_count)                                 AS good_count,
    countIfMerge(ni_count)                                   AS ni_count,
    countIfMerge(poor_count)                                 AS poor_count
FROM daily_vitals
GROUP BY organization_id, site_id, date, hostname, route, metric_name;
