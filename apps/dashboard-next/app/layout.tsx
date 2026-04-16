import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Webalytics dashboard",
  description: "Read-only stats dashboard for the webalytics service.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
          maxWidth: 1200,
          margin: "32px auto",
          padding: "0 24px",
          color: "#111",
          lineHeight: 1.55,
        }}
      >
        <header
          style={{
            display: "flex",
            gap: 24,
            alignItems: "baseline",
            borderBottom: "1px solid #eee",
            paddingBottom: 16,
            marginBottom: 24,
          }}
        >
          <strong style={{ fontSize: 18 }}>Webalytics</strong>
          <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
            <Link href="/">Realtime</Link>
            <Link href="/pages">Top pages</Link>
            <Link href="/vitals">Web vitals</Link>
            <Link href="/overview">Overview</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
