import { api, defaultWindow } from "../../lib/api";
import { env } from "../../lib/env";
import { fmtInt, fmtMs, fmtPct } from "../components/metric-grid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Core Web Vitals the tracker sends. If we have no data for one yet we still
// render the row so users know what to expect.
const METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

export default async function VitalsPage() {
  const site = env.siteUUID();
  const window = defaultWindow(24);
  const data = await api.webVitals(site, window, "none");
  const group = data.groups[0] ?? { key: "all", metrics: {} };

  return (
    <main>
      <h1 style={{ marginBottom: 4 }}>Web vitals</h1>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        Last 24h · p75 / p95 · rating share
      </p>

      <table
        data-testid="vitals-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #eee", color: "#444" }}>
            <th style={{ padding: "8px 4px" }}>Metric</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Samples</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>p75</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>p95</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Good</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Needs impr.</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Poor</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((name) => {
            const m = group.metrics[name];
            // CLS is dimensionless; the others are milliseconds.
            const fmt = name === "CLS" ? (v: number) => v.toFixed(3) : fmtMs;
            return (
              <tr key={name} style={{ borderBottom: "1px solid #f4f4f4" }} data-metric={name}>
                <td style={{ padding: "8px 4px", fontWeight: 500 }}>{name}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{fmtInt(m?.samples)}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{m ? fmt(m.p75) : "—"}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>{m ? fmt(m.p95) : "—"}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#2a7" }}>
                  {fmtPct(m?.rating_pct.good)}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#c80" }}>
                  {fmtPct(m?.rating_pct.needs_improvement)}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#c44" }}>
                  {fmtPct(m?.rating_pct.poor)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
