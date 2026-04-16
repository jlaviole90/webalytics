// UMD / <script> entrypoint.
//
// Usage (no NPM install needed):
//
//   <script
//     src="https://cdn.example.com/tracker.umd.js"
//     data-site-id="wb_live_abcdef..."
//     data-host="https://ingest.example.com"
//     defer
//   ></script>
//
// The auto-init picks up data-* attributes on the script tag and calls
// init() once the DOM is ready. The initialized Tracker is attached at
// window.webalytics so ad-hoc track() calls work without bundler imports.

import { init } from "./core.js";
import type { InitConfig, Tracker } from "./types.js";

declare global {
  interface Window {
    webalytics?: Tracker & { init: typeof init };
  }
}

// Expose init even before the auto-init runs, so callers who opt out of
// data-* can still bootstrap manually.
const exportShape = { init } as unknown as Tracker & { init: typeof init };

function readConfigFromScript(): Partial<InitConfig> | null {
  if (typeof document === "undefined") return null;
  // document.currentScript is the classic recipe; fall back to searching by data-site-id.
  let s = document.currentScript as HTMLScriptElement | null;
  if (!s) {
    const all = document.getElementsByTagName("script");
    for (const candidate of Array.from(all)) {
      if (candidate.dataset?.siteId) {
        s = candidate as HTMLScriptElement;
        break;
      }
    }
  }
  if (!s || !s.dataset) return null;
  const d = s.dataset;
  if (!d.siteId || !d.host) return null;
  const cfg: Partial<InitConfig> = {
    siteId: d.siteId,
    host: d.host,
  };
  if (d.autoPageviews === "false") cfg.autoPageviews = false;
  if (d.autoWebVitals === "false") cfg.autoWebVitals = false;
  if (d.autoOutbound === "true") cfg.autoOutbound = true;
  if (d.respectDnt === "false") cfg.respectDNT = false;
  if (d.environment) cfg.environment = d.environment;
  if (d.release) cfg.release = d.release;
  if (d.debug === "true") cfg.debug = true;
  return cfg;
}

function autoInit() {
  if (typeof window === "undefined") return;
  const fromScript = readConfigFromScript();
  if (!fromScript || !fromScript.siteId || !fromScript.host) return;
  const tracker = init(fromScript as InitConfig);
  window.webalytics = Object.assign(exportShape, tracker);
}

if (typeof window !== "undefined") {
  window.webalytics = exportShape;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit, { once: true });
  } else {
    autoInit();
  }
}

export { init };
