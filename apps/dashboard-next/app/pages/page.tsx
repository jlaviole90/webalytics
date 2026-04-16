import { api, defaultWindow } from "../../lib/api";
import { env } from "../../lib/env";
import { fmtInt, fmtPct } from "../components/metric-grid";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TopPagesPage() {
  const site = env.siteUUID();
  const window = defaultWindow(24);
  const data = await api.breakdown(site, window, "path", "visitors", 50);

  return (
    <main>
      <h1 style={{ marginBottom: 4 }}>Top pages</h1>
      <p style={{ color: "#666", marginTop: 0, fontSize: 14 }}>
        Last 24h · visitors · total {fmtInt(data.total)}
      </p>

      <table
        data-testid="top-pages-table"
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, marginTop: 16 }}
      >
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #eee", color: "#444" }}>
            <th style={{ padding: "8px 4px" }}>Path</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Visitors</th>
            <th style={{ padding: "8px 4px", textAlign: "right" }}>Share</th>
          </tr>
        </thead>
        <tbody>
          {data.results.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: 16, color: "#888" }}>
                No pages tracked in this window yet.
              </td>
            </tr>
          ) : (
            data.results.map((row) => (
              <tr key={row.key} style={{ borderBottom: "1px solid #f4f4f4" }}>
                <td style={{ padding: "8px 4px" }}>
                  <code>{row.key || "(empty)"}</code>
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmtInt(row.value)}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", color: "#666" }}>
                  {fmtPct(row.share)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </main>
  );
}
