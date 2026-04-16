import { api, defaultWindow } from "../lib/api";
import { env } from "../lib/env";
import { MetricGrid, MetricTile, fmtInt, fmtPct } from "./components/metric-grid";

// Disable prerender — this page is always dynamic.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// These aren't "custom" — they're tracker built-ins. We hide them from the
// custom events card so users only see the events their app explicitly
// emits via tracker.track(...).
const BUILTIN_EVENTS = new Set(["pageview", "web_vital"]);

export default async function RealtimePage() {
  const site = env.siteUUID();
  const window = defaultWindow(24);
  const [realtime, summary, events] = await Promise.all([
    api.realtime(site),
    api.summary(site, window),
    // "Visitors" per event_name = unique sessions that fired each event.
    // For custom events this is what most product dashboards want.
    api.breakdown(site, window, "event_name", "visitors", 50),
  ]);

  const customEvents = events.results.filter((row) => !BUILTIN_EVENTS.has(row.key));
  const siteInfo = await api.site(site);

  return (
    <main>
      <h1 style={{ marginBottom: 8 }}>Realtime</h1>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        Site: <code>{siteInfo.name}</code> ({siteInfo.public_site_id})
      </p>

      <MetricGrid>
        <MetricTile label="Online now" value={<span data-testid="online-count">{fmtInt(realtime.online)}</span>} />
        <MetricTile label="Visitors (24h)" value={fmtInt(summary.metrics.visitors?.value)} />
        <MetricTile label="Pageviews (24h)" value={fmtInt(summary.metrics.pageviews?.value)} />
        <MetricTile label="Sessions (24h)" value={fmtInt(summary.metrics.sessions?.value)} />
        <MetricTile label="Bounce rate (24h)" value={fmtPct(summary.metrics.bounce_rate?.value)} />
        <MetricTile
          label="Avg session"
          value={fmtInt(summary.metrics.avg_session_s?.value)}
          sublabel="seconds"
        />
      </MetricGrid>

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 16 }}>
        <TopList
          title="Top pages right now"
          testId="realtime-top-pages"
          items={realtime.top_pages.map((p) => ({ key: p.path, value: p.visitors }))}
        />
        <TopList
          title="Top hostnames right now"
          testId="realtime-top-hosts"
          items={realtime.top_hostnames.map((p) => ({ key: p.hostname, value: p.visitors }))}
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.4, color: "#444" }}>
          Custom events (24h)
        </h3>
        {customEvents.length === 0 ? (
          <p style={{ color: "#888", fontSize: 14 }}>
            No custom events yet. Fire one with{" "}
            <code>getTracker().track("event_name", &#123; …props &#125;)</code>.
          </p>
        ) : (
          <table data-testid="custom-events-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #eee", color: "#444" }}>
                <th style={{ padding: "8px 4px" }}>Event</th>
                <th style={{ padding: "8px 4px", textAlign: "right" }}>Visitors</th>
                <th style={{ padding: "8px 4px", textAlign: "right" }}>Share (of all events)</th>
              </tr>
            </thead>
            <tbody>
              {customEvents.map((row) => (
                <tr key={row.key} style={{ borderBottom: "1px solid #f4f4f4" }} data-event={row.key}>
                  <td style={{ padding: "8px 4px" }}>
                    <code>{row.key}</code>
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtInt(row.value)}
                  </td>
                  <td style={{ padding: "8px 4px", textAlign: "right", color: "#666" }}>
                    {fmtPct(row.share)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ fontSize: 12, color: "#888", marginTop: 32 }}>
        Data fetched via <code>/v1/stats/realtime</code>, <code>/v1/stats/summary</code>, and{" "}
        <code>/v1/stats/breakdown</code> with a server-side bearer token.
      </p>
    </main>
  );
}

function TopList({
  title,
  items,
  testId,
}: {
  title: string;
  items: { key: string; value: number }[];
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <h3 style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 0.4, color: "#444" }}>
        {title}
      </h3>
      {items.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>No traffic yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.slice(0, 10).map((it) => (
            <li
              key={it.key}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "6px 0",
                borderBottom: "1px solid #f4f4f4",
                fontSize: 14,
              }}
            >
              <span style={{ color: "#111" }}>{it.key || "(empty)"}</span>
              <span style={{ color: "#555", fontVariantNumeric: "tabular-nums" }}>{it.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
