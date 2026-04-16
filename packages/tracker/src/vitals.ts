// Minimal Core Web Vitals collector. Inlined here rather than pulling in the
// `web-vitals` npm package because our size budget is <2KB gzipped for the
// whole core. This covers LCP, FCP, CLS, TTFB, and INP with the same
// semantics as web-vitals for the fields our backend cares about (name,
// value, rating, id, nav_type).
//
// Notes:
//   - We only report final values (one callback per metric) to match the
//     backend rating model, which expects one row per vital per session.
//   - INP is approximated via the longest event duration observed across
//     event-timing entries, which matches the web-vitals library's approach.
//   - We silently no-op in environments that lack PerformanceObserver or
//     the relevant entry types; no throwing.

export type VitalName = "LCP" | "FCP" | "CLS" | "TTFB" | "INP";

export interface VitalSample {
  name: VitalName;
  value: number;
  id: string;
  navType?: string;
  rating?: "good" | "needs-improvement" | "poor";
}

export type VitalCallback = (v: VitalSample) => void;

// Simple stable id generator — just enough entropy for a browser session.
function rid(): string {
  return `v1-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function navType(): string | undefined {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    return nav?.type;
  } catch {
    return undefined;
  }
}

function rate(name: VitalName, value: number): VitalSample["rating"] {
  // Thresholds match internal/enrich/rating.go and Google's CWV 2024 guidance.
  switch (name) {
    case "LCP":
      return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
    case "FCP":
      return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
    case "CLS":
      return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
    case "TTFB":
      return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
    case "INP":
      return value <= 200 ? "good" : value <= 500 ? "needs-improvement" : "poor";
  }
}

function safeObserve(
  type: string,
  handler: (entries: PerformanceEntry[], obs: PerformanceObserver) => void,
  buffered = true,
): PerformanceObserver | null {
  try {
    const po = new PerformanceObserver((list, obs) => handler(list.getEntries(), obs));
    po.observe({ type, buffered } as PerformanceObserverInit);
    return po;
  } catch {
    return null;
  }
}

function report(name: VitalName, value: number, cb: VitalCallback) {
  cb({ name, value, id: rid(), navType: navType(), rating: rate(name, value) });
}

export function observeWebVitals(cb: VitalCallback): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};

  const toDispose: PerformanceObserver[] = [];
  const push = (o: PerformanceObserver | null) => o && toDispose.push(o);

  // TTFB — synchronous: read from the navigation entry.
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (nav && nav.responseStart > 0) {
      report("TTFB", nav.responseStart - nav.startTime, cb);
    }
  } catch {
    // ignore
  }

  // FCP — first 'first-contentful-paint' paint entry.
  push(
    safeObserve("paint", (entries, obs) => {
      for (const e of entries) {
        if (e.name === "first-contentful-paint") {
          report("FCP", e.startTime, cb);
          obs.disconnect();
          break;
        }
      }
    }),
  );

  // LCP — largest entry seen up to first user input or pagehide.
  let lcpValue = 0;
  let lcpReported = false;
  const lcpPo = safeObserve("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) lcpValue = (last as LargestContentfulPaint).startTime;
  });
  push(lcpPo);
  const finalizeLCP = () => {
    if (lcpReported) return;
    if (lcpPo) lcpPo.disconnect();
    if (lcpValue > 0) {
      lcpReported = true;
      report("LCP", lcpValue, cb);
    }
  };
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") finalizeLCP();
  });
  addEventListener("pagehide", finalizeLCP);

  // CLS — running sum of layout-shift values that aren't the result of user input.
  let clsValue = 0;
  let clsReported = false;
  const clsPo = safeObserve("layout-shift", (entries) => {
    for (const e of entries) {
      const ls = e as LayoutShift;
      if (!ls.hadRecentInput) clsValue += ls.value;
    }
  });
  push(clsPo);
  const finalizeCLS = () => {
    if (clsReported) return;
    if (clsPo) clsPo.disconnect();
    clsReported = true;
    report("CLS", clsValue, cb);
  };
  addEventListener("pagehide", finalizeCLS);

  // INP — longest interaction duration across event-timing entries.
  let inpValue = 0;
  let inpReported = false;
  const inpPo = safeObserve("event", (entries) => {
    for (const e of entries) {
      const dur = e.duration;
      if (dur > inpValue) inpValue = dur;
    }
  });
  push(inpPo);
  const finalizeINP = () => {
    if (inpReported) return;
    if (inpPo) inpPo.disconnect();
    if (inpValue > 0) {
      inpReported = true;
      report("INP", inpValue, cb);
    }
  };
  addEventListener("pagehide", finalizeINP);

  return () => {
    for (const o of toDispose) o.disconnect();
  };
}

// Local TS shims for entry shapes that aren't in the default DOM lib yet.
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface LargestContentfulPaint extends PerformanceEntry {
  renderTime: number;
  loadTime: number;
}
