# @webalytics/tracker-next

Next.js adapter for [@webalytics/tracker](../tracker).

- **App Router** — drop `<Webalytics />` into `app/layout.tsx`.
- **Pages Router** — wrap `<Component />` in `_app.tsx` with `<WebalyticsPages />`.

The adapter listens for Next's native route changes (`usePathname` /
`useSearchParams` in App Router, `router.events` in Pages Router) so pageviews
never double-fire from the core tracker's History API patching.

## Install

```bash
npm install @webalytics/tracker @webalytics/tracker-next
```

## App Router

```tsx
// app/layout.tsx
import { Webalytics } from "@webalytics/tracker-next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Webalytics
          siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID!}
          host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST!}
        />
      </body>
    </html>
  );
}
```

`<Webalytics />` is already wrapped in a `<Suspense>` boundary internally, so
static prerender works without you adding one.

### Custom events

```tsx
"use client";
import { getTracker, useWebalytics } from "@webalytics/tracker-next";

export function SignupButton() {
  return <button onClick={() => getTracker().track("signup", { plan: "pro" })}>Sign up</button>;
}
```

`useWebalytics()` returns the same instance; useful inside deep component
subtrees.

## Pages Router

```tsx
// pages/_app.tsx
import { WebalyticsPages } from "@webalytics/tracker-next/pages";

export default function App({ Component, pageProps }) {
  return (
    <>
      <WebalyticsPages
        siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID!}
        host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST!}
      />
      <Component {...pageProps} />
    </>
  );
}
```

## Env

If `siteId` / `host` aren't passed as props, the adapter reads:

- `NEXT_PUBLIC_WEBALYTICS_SITE_ID`
- `NEXT_PUBLIC_WEBALYTICS_HOST`

These are inlined at build time by Next, so they must be available during
`next build`.
