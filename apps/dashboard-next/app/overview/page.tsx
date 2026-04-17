// Dogfood page for @jlaviole90/dashboard-react. Drops in the prebuilt
// <Dashboard /> against our own seeded site, so any regressions in the
// library are caught by just opening http://localhost:3001/overview.
import "server-only";
import { createClient, Dashboard } from "@jlaviole90/dashboard-react";
import { env } from "../../lib/env";

// The dashboard needs fresh data on every render; Next's default
// caching would pin the first fetch.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function OverviewPage() {
  const client = createClient({
    host: env.apiHost(),
    token: env.apiToken(),
    siteId: env.siteUUID(),
  });
  return (
    <Dashboard
      client={client}
      window="7d"
      header={
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Overview</h1>
          <p style={{ color: "#666", fontSize: 14, marginTop: 4 }}>
            Rendered entirely by <code>@jlaviole90/dashboard-react</code> —
            same components you install into any React/Next app.
          </p>
        </div>
      }
    />
  );
}
