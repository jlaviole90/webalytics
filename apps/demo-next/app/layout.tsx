import type { ReactNode } from "react";
import { Webalytics } from "@jlaviole90/tracker-next";

export const metadata = {
  title: "Webalytics demo",
  description: "Dogfood app for the @jlaviole90/tracker-next adapter.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
          maxWidth: 720,
          margin: "40px auto",
          padding: "0 24px",
          color: "#111",
          lineHeight: 1.55,
        }}
      >
        {children}
        <Webalytics
          siteId={process.env.NEXT_PUBLIC_WEBALYTICS_SITE_ID}
          host={process.env.NEXT_PUBLIC_WEBALYTICS_HOST}
          debug
        />
      </body>
    </html>
  );
}
