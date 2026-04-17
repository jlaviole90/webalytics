"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { init, type InitConfig, type Tracker } from "@jlaviole90/tracker";

export interface WebalyticsProps extends Omit<InitConfig, "siteId" | "host"> {
  siteId?: string;
  host?: string;
}

/**
 * Drop-in App Router component. Place once near the root of `app/layout.tsx`:
 *
 * ```tsx
 * import { Webalytics } from "@jlaviole90/tracker-next";
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         {children}
 *         <Webalytics
 *           siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID!}
 *           host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST!}
 *         />
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 *
 * Reads siteId/host from props, falling back to `NEXT_PUBLIC_WEBALYTICS_SITE_ID`
 * and `NEXT_PUBLIC_WEBALYTICS_HOST` at runtime. Disables the History API
 * patching from core and instead fires pageviews via Next's own route events
 * — the two would otherwise double-fire.
 */
export function Webalytics(props: WebalyticsProps): JSX.Element {
  // useSearchParams bails out of static prerender unless it's inside a
  // <Suspense> boundary. We wrap ourselves so consumers don't have to.
  return (
    <Suspense fallback={null}>
      <WebalyticsInner {...props} />
    </Suspense>
  );
}

function WebalyticsInner(props: WebalyticsProps): null {
  const {
    siteId: siteIdProp,
    host: hostProp,
    autoPageviews = true,
    ...rest
  } = props;
  const trackerRef = useRef<Tracker | null>(null);
  const firedRef = useRef<string>("");

  const siteId = siteIdProp ?? readEnv("NEXT_PUBLIC_WEBALYTICS_SITE_ID");
  const host = hostProp ?? readEnv("NEXT_PUBLIC_WEBALYTICS_HOST");

  const pathname = usePathname();
  const searchParams = useSearchParams();

  // init once
  useEffect(() => {
    if (!siteId || !host) {
      if (rest.debug) console.debug("[webalytics] missing siteId or host; tracker not initialized");
      return;
    }
    if (trackerRef.current) return;
    const t = init({
      ...rest,
      siteId,
      host,
      // We take over pageview firing from core — let Next's navigation drive it.
      autoPageviews: false,
    });
    trackerRef.current = t;
    globalRef.current = t;
    return () => {
      trackerRef.current?.flush();
    };
    // siteId / host are stable in practice; no dep array cycling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire a pageview whenever the effective URL changes.
  useEffect(() => {
    if (!autoPageviews || !trackerRef.current) return;
    const qs = searchParams?.toString();
    const key = qs ? `${pathname}?${qs}` : pathname ?? "";
    if (key === firedRef.current) return;
    firedRef.current = key;
    trackerRef.current.pageview();
  }, [pathname, searchParams, autoPageviews]);

  return null;
}

/**
 * Returns the currently initialized tracker, or null if `<Webalytics />`
 * hasn't mounted yet. Useful for `track()` calls in deeply nested components.
 */
export function useWebalytics(): Tracker | null {
  // The tracker is a module-level singleton once init() returns; we expose
  // via a tiny module-scoped ref so calls don't need the component tree.
  return globalRef.current;
}

/**
 * Imperative helper for server-components or event handlers where a hook is
 * awkward. Returns the current Tracker after Webalytics has mounted; returns
 * a no-op stub before that.
 */
export function getTracker(): Tracker {
  return globalRef.current ?? noopTracker;
}

const globalRef: { current: Tracker | null } = { current: null };
const noopTracker: Tracker = {
  pageview() {},
  track() {},
  identify() {},
  flush: async () => {},
  setEnabled() {},
};

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// Export types for consumers.
export type { Tracker, InitConfig } from "@jlaviole90/tracker";

// Re-export raw init for callers who want to manage the tracker themselves.
export { init } from "@jlaviole90/tracker";
