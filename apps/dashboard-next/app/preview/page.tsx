import {
  Dashboard,
  SummaryCards,
  TimeseriesChart,
  TopList,
  WebVitalsCards,
  Realtime,
  themeVars,
} from "@jlaviole90/dashboard-react";
import { createMockClient } from "../../lib/mock-client";
import { WindowPickerDemo } from "./window-picker-demo";

export const dynamic = "force-dynamic";

const client = createMockClient();

export default function PreviewPage() {
  return (
    <div style={{ ...themeVars, background: "var(--wbx-surface)", minHeight: "100vh", padding: 32 }}>
      <h1 style={{ marginBottom: 4, fontSize: 22 }}>Component preview — mock data</h1>
      <p style={{ color: "var(--wbx-fg-muted)", marginBottom: 32, fontSize: 14 }}>
        All data is local; no API credentials required.
      </p>

      <Section title="Full Dashboard (default layout)">
        <Dashboard
          client={client}
          window="7d"
          header={
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>example.com</h2>
              <p style={{ color: "var(--wbx-fg-muted)", fontSize: 13, marginTop: 4 }}>Last 7 days</p>
            </div>
          }
        />
      </Section>

      <Section title="SummaryCards — delta + sparklines">
        <SummaryCards client={client} window="7d" showDelta showSparkline />
      </Section>

      <Section title="SummaryCards — delta only, no sparklines">
        <SummaryCards client={client} window="7d" showDelta showSparkline={false} />
      </Section>

      <Section title="TimeseriesChart — single metric (visitors, 7d daily)">
        <TimeseriesChart client={client} window="7d" metric="visitors" />
      </Section>

      <Section title="TimeseriesChart — multi-metric overlay (visitors + pageviews + sessions)">
        <TimeseriesChart client={client} window="7d" metrics={["visitors", "pageviews", "sessions"]} />
      </Section>

      <Section title="TimeseriesChart — intra-day (24h hourly — dense, markers suppressed)">
        <TimeseriesChart client={client} window="24h" metric="visitors" interval="hour" />
      </Section>

      <Section title="TopList — bar variant, absolute scale">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TopList client={client} dimension="path" window="7d" barScale="absolute" />
          <TopList client={client} dimension="referrer_host" window="7d" barScale="absolute" />
        </div>
      </Section>

      <Section title="TopList — donut variant (device + browser)">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <TopList client={client} dimension="device" window="7d" variant="donut" />
          <TopList client={client} dimension="browser" window="7d" variant="donut" />
        </div>
      </Section>

      <Section title="WebVitalsCards — larger bar + p95 + distribution text">
        <WebVitalsCards client={client} window="7d" metrics={["LCP", "INP", "CLS", "FCP", "TTFB"]} />
      </Section>

      <Section title="Realtime — LiveCount (animated on router.refresh())">
        <div style={{ maxWidth: 400 }}>
          <Realtime client={client} topPagesLimit={5} showRecent />
        </div>
      </Section>

      <Section title="WindowPicker — date range label">
        <WindowPickerDemo />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--wbx-fg-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}
