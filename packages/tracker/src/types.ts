/**
 * @webalytics/tracker — public types
 *
 * This file is the authoritative TypeScript surface of the NPM SDK.
 * It is hand-maintained to stay in lockstep with:
 *   - api/collect.schema.json   (ingest payload)
 *   - api/openapi.yaml          (query API)
 *
 * A generator will eventually derive these types from the JSON Schema; until
 * then, any additions here MUST be reflected in the schema and vice versa.
 */

// ---------------------------------------------------------------------------
// init() config
// ---------------------------------------------------------------------------

export interface TrackerConfig {
  /** Public site ID, e.g. `wb_live_7f2a3b4c5d6e7f80`. Not a secret. */
  siteId: string;

  /** Base URL of the self-hosted Webalytics service, without trailing slash. */
  host: string;

  /** Automatically track pageviews on init + History API navigations. Default: true. */
  autoPageviews?: boolean;

  /** Automatically report LCP / INP / CLS / FCP / TTFB via web-vitals. Default: true. */
  autoWebVitals?: boolean;

  /** Automatically track outbound link clicks and file downloads. Default: false. */
  autoOutbound?: boolean;

  /** Honor Do-Not-Track and Global Privacy Control headers. Default: true. */
  respectDNT?: boolean;

  /** Paths (exact strings or RegExp) for which pageviews should not be sent. */
  excludePaths?: (string | RegExp)[];

  /**
   * Deployment environment tag. Becomes a top-level dimension so dashboards
   * can filter e.g. 'production' vs 'preview'. Default: 'production'.
   */
  environment?: string;

  /** Release identifier (git SHA, semver, etc.) — enables release-over-release comparisons. */
  release?: string;

  /**
   * Optional hook returning the normalized route for the current page
   * (e.g. `/blog/[slug]`). Frameworks like Next.js / Remix can supply this
   * from their router; plain HTML sites can leave it undefined.
   */
  route?: () => string | null;

  /** Log diagnostic info to the console. Default: false. */
  debug?: boolean;
}

// ---------------------------------------------------------------------------
// Tracker public API
// ---------------------------------------------------------------------------

export interface Tracker {
  /** Manually fire a pageview. `url` defaults to `location.href`. */
  pageview(url?: string): void;

  /** Fire a named custom event with optional properties. */
  track(eventName: string, props?: EventProps): void;

  /**
   * Associate the current visitor with long-lived traits.
   * NO-OP unless the site is opted into consented mode.
   */
  identify(traits: Record<string, unknown>): void;

  /** Drain any buffered events immediately. Returns when the flush finishes. */
  flush(): Promise<void>;

  /** Enable or disable tracking at runtime. */
  setEnabled(enabled: boolean): void;
}

/** Scalar-valued custom event properties (nested objects/arrays are not allowed). */
export type EventProps = Record<string, string | number | boolean | null>;

// ---------------------------------------------------------------------------
// Wire types (sent to POST /collect — match api/collect.schema.json)
// ---------------------------------------------------------------------------

export interface CollectEvent {
  site_id: string;
  event: string;
  url: string;

  referrer?: string;
  title?: string;

  environment?: string;
  release?: string;
  route?: string;

  screen?: { w: number; h: number };
  viewport?: { w: number; h: number };
  language?: string;

  props?: EventProps;
  revenue?: { amount: number; currency: string };
  perf?: { ttfb_ms?: number; load_ms?: number };

  /** Present only when `event === 'web_vital'`. */
  vital?: {
    name: "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
    value: number;
    rating?: "good" | "needs-improvement" | "poor";
    id?: string;
    nav_type?:
      | "navigate"
      | "reload"
      | "back-forward"
      | "back-forward-cache"
      | "prerender"
      | "restore";
  };

  ts_client?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a Tracker instance. Also installs auto-handlers if enabled. */
export declare function init(config: TrackerConfig): Tracker;
