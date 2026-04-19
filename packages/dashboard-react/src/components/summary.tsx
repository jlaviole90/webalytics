import type { CSSProperties, ReactNode } from "react";
import type { DashboardClient } from "../client.js";
import type { Filters, MetricName, WindowSpec } from "../types.js";
import { formatDuration, formatInt, formatPct } from "../format.js";
import { grid } from "../styles.js";
import { MetricCard } from "./metric-card.js";

export interface SummaryCardsProps {
  client: DashboardClient;
  window?: WindowSpec;
  siteId?: string;
  filters?: Filters;
  /** Show period-over-period delta badge beneath each metric. Default: true. */
  showDelta?: boolean;
  /** Show a mini sparkline inside each card. Default: true. */
  showSparkline?: boolean;
  className?: string;
  style?: CSSProperties;
}

type SparkPoints = Array<{ value: number }>;

/**
 * Four canonical metric tiles: visitors, pageviews, bounce, avg time.
 * Meant to sit across the top of a dashboard page.
 */
export async function SummaryCards({
  client,
  window = "7d",
  siteId,
  filters,
  showDelta = true,
  showSparkline = true,
  className,
  style,
}: SummaryCardsProps) {
  const sparkMetrics: MetricName[] = ["visitors", "pageviews", "sessions"];

  const [data, prevData, ...sparkData] = await Promise.all([
    client.summary(window, { siteId, filters }),
    showDelta
      ? client.summary(prevWindow(window), { siteId, filters }).catch(() => null)
      : Promise.resolve(null),
    ...(showSparkline
      ? sparkMetrics.map((m) =>
          client
            .timeseries(window, m, defaultSparkInterval(window), { siteId, filters })
            .then((d) => d.points)
            .catch(() => [] as SparkPoints),
        )
      : []),
  ]);

  const m = data.metrics;
  const pm = prevData?.metrics;
  const [visitorSpark, pageviewSpark, sessionSpark] = sparkData as [
    SparkPoints | undefined,
    SparkPoints | undefined,
    SparkPoints | undefined,
  ];

  return (
    <div
      data-wbx-part="summary"
      className={className}
      style={{ ...grid(4), ...style }}
    >
      <MetricCard
        label="Visitors"
        value={formatInt(m.visitors.value)}
        hint={buildHint(
          pm ? delta(m.visitors.value, pm.visitors.value) : undefined,
          visitorSpark,
        )}
      />
      <MetricCard
        label="Pageviews"
        value={formatInt(m.pageviews.value)}
        hint={buildHint(
          pm ? delta(m.pageviews.value, pm.pageviews.value) : undefined,
          pageviewSpark,
        )}
      />
      <MetricCard
        label="Bounce rate"
        value={formatPct(m.bounce_rate.value)}
        hint={buildHint(
          pm ? delta(m.bounce_rate.value, pm.bounce_rate.value, true) : undefined,
          undefined, // no timeseries for bounce_rate
        )}
      />
      <MetricCard
        label="Avg session"
        value={formatDuration(m.avg_session_s.value)}
        hint={buildHint(
          pm ? delta(m.avg_session_s.value, pm.avg_session_s.value) : undefined,
          sessionSpark,
        )}
      />
    </div>
  );
}

function buildHint(
  deltaNode: ReactNode | undefined,
  points: SparkPoints | undefined,
): ReactNode | undefined {
  const hasDelta = deltaNode != null;
  const hasSpark = points && points.length > 1;
  if (!hasDelta && !hasSpark) return undefined;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span>{hasDelta ? deltaNode : null}</span>
      {hasSpark && <Sparkline points={points!} />}
    </div>
  );
}

function Sparkline({ points }: { points: SparkPoints }) {
  const W = 80;
  const H = 32;
  const PAD = 2;
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const stepX = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const xOf = (i: number) => PAD + i * stepX;
  const yOf = (v: number) => PAD + (H - PAD * 2) * (1 - v / max);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`)
    .join(" ");
  const area =
    `M${xOf(0).toFixed(1)},${H - PAD} ` +
    points.map((p, i) => `L${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ") +
    ` L${xOf(n - 1).toFixed(1)},${H - PAD} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ width: W, height: H, flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="wbx-spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--wbx-accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--wbx-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#wbx-spark-grad)" />
      <path
        d={line}
        fill="none"
        stroke="var(--wbx-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function defaultSparkInterval(w: WindowSpec): "minute" | "hour" | "day" {
  if (w === "1h") return "minute";
  if (w === "24h") return "hour";
  return "day";
}

function prevWindow(w: WindowSpec): WindowSpec {
  if (typeof w === "object") {
    const from = new Date(w.from as string);
    const to = new Date(w.to as string);
    const duration = to.getTime() - from.getTime();
    return {
      from: new Date(from.getTime() - duration).toISOString(),
      to: from.toISOString(),
    };
  }
  const MS: Record<string, number> = {
    "1h": 3_600_000,
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "90d": 90 * 86_400_000,
  };
  const duration = MS[w] ?? 0;
  const prevTo = new Date(Date.now() - duration);
  const prevFrom = new Date(prevTo.getTime() - duration);
  return { from: prevFrom.toISOString(), to: prevTo.toISOString() };
}

function delta(current: number, previous: number, invertGood = false): ReactNode {
  if (!previous) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.05) return null;
  const rising = pct > 0;
  const good = invertGood ? !rising : rising;
  return (
    <span style={{ color: good ? "var(--wbx-good)" : "var(--wbx-bad)", fontWeight: 500 }}>
      {rising ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
