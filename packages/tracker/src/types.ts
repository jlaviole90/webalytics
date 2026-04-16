// Types used throughout the tracker. The ingest-wire shape lives in
// `CollectPayload` which mirrors api/collect.schema.json in the Go repo.

export interface InitConfig {
  /** Public site id, e.g. wb_live_abc123... */
  siteId: string;
  /** Base URL of the ingest service (no trailing slash). */
  host: string;
  /** Fire a pageview on init and on History API navigation. Default: true. */
  autoPageviews?: boolean;
  /** Collect LCP/INP/CLS/FCP/TTFB and send as web_vital events. Default: true. */
  autoWebVitals?: boolean;
  /** Track outbound link clicks as `outbound_click` events. Default: false. */
  autoOutbound?: boolean;
  /** Respect DNT / Sec-GPC headers (server also honors them). Default: true. */
  respectDNT?: boolean;
  /** URL paths (string-prefix or regex) that should never generate events. */
  excludePaths?: (string | RegExp)[];
  /** Environment tag stored on every event. Default: 'production'. */
  environment?: string;
  /** Release tag (e.g. git sha) stored on every event. */
  release?: string;
  /**
   * Returns the normalized route for the current URL (e.g. `/blog/[slug]`).
   * Used by frameworks with client-side routing.
   */
  route?: () => string | null;
  /** Log reject reasons and errors to console.debug. Default: false. */
  debug?: boolean;
  /** Override fetch/sendBeacon — exposed for tests. */
  transport?: Transport;
  /** Injectable for tests. Defaults to the global History/location. */
  readonly _location?: Location;
}

export interface Tracker {
  pageview(url?: string): void;
  track(eventName: string, props?: Record<string, unknown>): void;
  /** Promoted-identity API. No-op in cookieless default mode. */
  identify(traits: Record<string, unknown>): void;
  /** Flush any buffered events immediately. Resolves when writes complete. */
  flush(): Promise<void>;
  /** Temporarily disable/enable event collection. */
  setEnabled(enabled: boolean): void;
}

export interface CollectPayload {
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
  props?: Record<string, unknown>;
  revenue?: { amount: number; currency: string };
  perf?: { ttfb_ms?: number; load_ms?: number };
  vital?: { name: string; value: number; rating?: string; id?: string; nav_type?: string };
  ts_client?: number;
}

export interface Transport {
  /**
   * Send one or more events. Implementations must be non-blocking and must
   * never throw into caller code.
   * `unload` indicates we're on pagehide — transport should prefer sendBeacon.
   */
  send(host: string, events: CollectPayload[], unload: boolean): void;
  /** Flush any in-flight writes; resolves when settled. */
  flush(): Promise<void>;
}
