"use client";

// Pages Router integration. Drop this into `pages/_app.tsx`:
//
//   import type { AppProps } from "next/app";
//   import { WebalyticsPages } from "@jlaviole90/tracker-next/pages";
//
//   export default function App({ Component, pageProps }: AppProps) {
//     return (
//       <>
//         <WebalyticsPages
//           siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID!}
//           host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST!}
//         />
//         <Component {...pageProps} />
//       </>
//     );
//   }

import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { init, type InitConfig, type Tracker } from "@jlaviole90/tracker";

export interface WebalyticsPagesProps extends Omit<InitConfig, "siteId" | "host"> {
  siteId?: string;
  host?: string;
}

export function WebalyticsPages(props: WebalyticsPagesProps): null {
  const { siteId: siteIdProp, host: hostProp, autoPageviews = true, ...rest } = props;
  const router = useRouter();
  const trackerRef = useRef<Tracker | null>(null);

  const siteId = siteIdProp ?? readEnv("NEXT_PUBLIC_WEBALYTICS_SITE_ID");
  const host = hostProp ?? readEnv("NEXT_PUBLIC_WEBALYTICS_HOST");

  useEffect(() => {
    if (!siteId || !host) return;
    if (trackerRef.current) return;
    const t = init({
      ...rest,
      siteId,
      host,
      autoPageviews: false,
    });
    trackerRef.current = t;
    if (autoPageviews) {
      // Fire the initial pageview once on mount.
      t.pageview();
      const onRouteChange = () => t.pageview();
      router.events.on("routeChangeComplete", onRouteChange);
      return () => {
        router.events.off("routeChangeComplete", onRouteChange);
        t.flush();
      };
    }
    return () => {
      t.flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
