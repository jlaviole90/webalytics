import type { CollectPayload, InitConfig, Tracker, Transport } from "./types.js";
import { createDefaultTransport } from "./transport.js";
import { observeWebVitals } from "./vitals.js";

// Internal state shared by all methods on the returned Tracker.
interface State {
  config: Required<Omit<InitConfig, "release" | "route" | "transport" | "_location" | "excludePaths">> &
    Pick<InitConfig, "release" | "route" | "transport" | "_location" | "excludePaths">;
  transport: Transport;
  buf: CollectPayload[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  enabled: boolean;
  lastURL: string;
}

const DEFAULT_BATCH_MS = 250;

function pathOf(loc: Location | undefined): string {
  if (!loc) return "";
  return loc.pathname + loc.search;
}

function isExcluded(path: string, patterns: (string | RegExp)[] | undefined): boolean {
  if (!patterns) return false;
  for (const p of patterns) {
    if (typeof p === "string") {
      if (path.startsWith(p)) return true;
    } else if (p.test(path)) {
      return true;
    }
  }
  return false;
}

// Base envelope shared by every outgoing event. Kept small; callers merge in
// event-specific fields on top.
function baseEvent(state: State): CollectPayload {
  const loc = state.config._location ?? (typeof location !== "undefined" ? location : undefined);
  const doc = typeof document !== "undefined" ? document : undefined;
  const env = state.config.environment || "production";

  const out: CollectPayload = {
    site_id: state.config.siteId,
    event: "pageview", // overwritten by caller
    url: loc ? loc.href : "",
    referrer: doc?.referrer || "",
    title: doc?.title || "",
    environment: env,
    language: typeof navigator !== "undefined" ? navigator.language : "",
    ts_client: Date.now(),
  };
  if (state.config.release) out.release = state.config.release;
  const rt = state.config.route?.();
  if (rt) out.route = rt;
  if (typeof window !== "undefined") {
    out.screen = { w: window.screen?.width || 0, h: window.screen?.height || 0 };
    out.viewport = { w: window.innerWidth || 0, h: window.innerHeight || 0 };
  }
  return out;
}

function dntActive(config: InitConfig): boolean {
  if (config.respectDNT === false) return false;
  if (typeof navigator === "undefined") return false;
  // @ts-expect-error globalPrivacyControl is a proposed addition to Navigator.
  const gpc = navigator.globalPrivacyControl === true;
  const dnt = navigator.doNotTrack === "1" || (navigator as any).msDoNotTrack === "1";
  return gpc || dnt;
}

function scheduleFlush(state: State) {
  if (state.flushTimer !== null) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flushBuffer(state, false);
  }, DEFAULT_BATCH_MS);
}

function flushBuffer(state: State, unload: boolean) {
  if (state.buf.length === 0) return;
  const events = state.buf;
  state.buf = [];
  state.transport.send(state.config.host, events, unload);
}

export function init(config: InitConfig): Tracker {
  const cfg = {
    siteId: config.siteId,
    host: config.host.replace(/\/+$/, ""),
    autoPageviews: config.autoPageviews !== false,
    autoWebVitals: config.autoWebVitals !== false,
    autoOutbound: config.autoOutbound === true,
    respectDNT: config.respectDNT !== false,
    debug: config.debug === true,
    environment: config.environment ?? "production",
    release: config.release,
    route: config.route,
    transport: config.transport,
    _location: config._location,
    excludePaths: config.excludePaths,
  };

  const state: State = {
    config: cfg,
    transport: cfg.transport ?? createDefaultTransport(cfg.debug),
    buf: [],
    flushTimer: null,
    enabled: !dntActive(config),
    lastURL: pathOf(cfg._location ?? (typeof location !== "undefined" ? location : undefined)),
  };

  if (cfg.debug && !state.enabled) {
    console.debug("[webalytics] DNT/GPC detected — tracking disabled");
  }

  function emit(payload: CollectPayload) {
    if (!state.enabled) return;
    const loc = cfg._location ?? (typeof location !== "undefined" ? location : undefined);
    if (isExcluded(pathOf(loc), cfg.excludePaths)) {
      if (cfg.debug) console.debug("[webalytics] path excluded", pathOf(loc));
      return;
    }
    state.buf.push(payload);
    scheduleFlush(state);
  }

  const tracker: Tracker = {
    pageview(url?: string) {
      const ev = baseEvent(state);
      ev.event = "pageview";
      if (url) ev.url = url;
      emit(ev);
    },
    track(eventName: string, props?: Record<string, unknown>) {
      const ev = baseEvent(state);
      ev.event = eventName;
      if (props) ev.props = props;
      emit(ev);
    },
    identify(_traits: Record<string, unknown>) {
      // Cookieless default mode ignores identify. When a consented-mode
      // cookie is added (see ARCHITECTURE Phase 5+), this will promote
      // visitor_id. For now: no-op. We keep the method on the API surface
      // so framework adapters can call it unconditionally.
      if (cfg.debug) console.debug("[webalytics] identify() is a no-op in cookieless mode");
    },
    flush(): Promise<void> {
      flushBuffer(state, false);
      return state.transport.flush();
    },
    setEnabled(enabled: boolean) {
      state.enabled = enabled;
    },
  };

  // Auto page lifecycle hooks. We skip all this when running in node (SSR) —
  // the window/addEventListener guards suffice.
  if (typeof window !== "undefined") {
    if (cfg.autoPageviews) {
      // Fire the initial pageview on the next microtask so callers have a
      // chance to mutate config or setEnabled synchronously after init.
      queueMicrotask(() => tracker.pageview());

      // Patch history methods so SPAs fire pageviews automatically.
      // Framework adapters can disable this by passing autoPageviews: false.
      const originalPush = history.pushState.bind(history);
      const originalReplace = history.replaceState.bind(history);
      const dispatch = () => {
        const now = pathOf(location);
        if (now !== state.lastURL) {
          state.lastURL = now;
          tracker.pageview();
        }
      };
      history.pushState = function (...args: Parameters<typeof history.pushState>) {
        const r = originalPush(...args);
        dispatch();
        return r;
      };
      history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
        const r = originalReplace(...args);
        dispatch();
        return r;
      };
      window.addEventListener("popstate", dispatch);
    }

    if (cfg.autoWebVitals) {
      observeWebVitals((v) => {
        const ev = baseEvent(state);
        ev.event = "web_vital";
        ev.vital = { name: v.name, value: v.value, rating: v.rating, id: v.id, nav_type: v.navType };
        emit(ev);
      });
    }

    if (cfg.autoOutbound) {
      document.addEventListener(
        "click",
        (e) => {
          const target = (e.target as HTMLElement | null)?.closest("a");
          if (!target) return;
          const href = target.getAttribute("href");
          if (!href) return;
          try {
            const u = new URL(href, location.href);
            if (u.host !== location.host) {
              tracker.track("outbound_click", { href: u.href });
            }
          } catch {
            // malformed href — ignore
          }
        },
        { capture: true },
      );
    }

    // Flush on pagehide / visibilitychange → hidden via beacon.
    const unloadFlush = () => flushBuffer(state, true);
    window.addEventListener("pagehide", unloadFlush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") unloadFlush();
    });
  }

  return tracker;
}
