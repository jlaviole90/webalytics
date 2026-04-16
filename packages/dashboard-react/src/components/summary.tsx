import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type { Filters, WindowSpec } from "../types.js";
import { formatDuration, formatInt, formatPct } from "../format.js";
import { grid } from "../styles.js";
import { MetricCard } from "./metric-card.js";

export interface SummaryCardsProps {
  client: DashboardClient;
  window?: WindowSpec;
  siteId?: string;
  filters?: Filters;
  className?: string;
  style?: CSSProperties;
}

/**
 * Four canonical metric tiles: visitors, pageviews, bounce, avg time.
 * Meant to sit across the top of a dashboard page.
 */
export async function SummaryCards({
  client,
  window = "7d",
  siteId,
  filters,
  className,
  style,
}: SummaryCardsProps) {
  const data = await client.summary(window, { siteId, filters });
  const m = data.metrics;
  return (
    <div
      data-wbx-part="summary"
      className={className}
      style={{ ...grid(4), ...style }}
    >
      <MetricCard label="Visitors" value={formatInt(m.visitors.value)} />
      <MetricCard label="Pageviews" value={formatInt(m.pageviews.value)} />
      <MetricCard label="Bounce rate" value={formatPct(m.bounce_rate.value)} />
      <MetricCard
        label="Avg session"
        value={formatDuration(m.avg_session_s.value)}
      />
    </div>
  );
}
