import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type {
  Filters,
  IntervalName,
  MetricName,
  WindowSpec,
} from "../types.js";
import { formatInt } from "../format.js";
import { card, cardTitle, subtle } from "../styles.js";

export interface TimeseriesChartProps {
  client: DashboardClient;
  window?: WindowSpec;
  metric?: MetricName;
  interval?: IntervalName;
  siteId?: string;
  filters?: Filters;
  /** Title shown above the chart. Defaults to the metric name. */
  title?: string;
  /** Pixel height of the chart surface (excludes padding/title). */
  height?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Area chart rendered as inline SVG — zero dep, SSR-safe, fixed aspect
 * ratio. The SVG uses a viewBox so it scales perfectly responsive;
 * we just set a fixed height on the wrapping <div>.
 */
export async function TimeseriesChart({
  client,
  window = "7d",
  metric = "visitors",
  interval,
  siteId,
  filters,
  title,
  height = 240,
  className,
  style,
}: TimeseriesChartProps) {
  const resolvedInterval: IntervalName = interval ?? defaultInterval(window);
  const data = await client.timeseries(window, metric, resolvedInterval, {
    siteId,
    filters,
  });
  const points = data.points;
  const labelTitle = title ?? titleForMetric(metric);

  if (points.length === 0) {
    return (
      <div
        data-wbx-part="timeseries"
        className={className}
        style={{ ...card, ...style }}
      >
        <div style={cardTitle}>{labelTitle.toUpperCase()}</div>
        <div style={{ ...subtle, padding: "32px 0", textAlign: "center" }}>
          No data in this range.
        </div>
      </div>
    );
  }

  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + p.value, 0);

  // Chart area coordinates (viewBox units; resolution-independent).
  const W = 1000;
  const H = 300;
  const PAD_X = 8;
  const PAD_Y = 12;
  const n = points.length;
  const stepX = n > 1 ? (W - PAD_X * 2) / (n - 1) : 0;
  const xOf = (i: number) => PAD_X + i * stepX;
  const yOf = (v: number) => PAD_Y + (H - PAD_Y * 2) * (1 - v / max);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.value)}`)
    .join(" ");
  const areaPath =
    `M${xOf(0)},${yOf(0)} ` +
    points.map((p, i) => `L${xOf(i)},${yOf(p.value)}`).join(" ") +
    ` L${xOf(n - 1)},${H - PAD_Y} Z`;

  return (
    <div
      data-wbx-part="timeseries"
      className={className}
      style={{ ...card, ...style }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div style={cardTitle}>{labelTitle.toUpperCase()}</div>
        <div style={subtle}>
          Total: <strong style={{ color: "var(--wbx-fg)" }}>{formatInt(total)}</strong>
        </div>
      </div>
      <svg
        role="img"
        aria-label={`${labelTitle} over time`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, marginTop: 12, display: "block" }}
      >
        <defs>
          <linearGradient id={`wbx-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wbx-accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--wbx-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Horizontal grid (4 evenly-spaced lines) */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={PAD_Y + (H - PAD_Y * 2) * t}
            y2={PAD_Y + (H - PAD_Y * 2) * t}
            stroke="var(--wbx-border)"
            strokeWidth={1}
            strokeDasharray="2 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={areaPath} fill={`url(#wbx-grad-${metric})`} />
        <path
          d={linePath}
          fill="none"
          stroke="var(--wbx-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          ...subtle,
          fontSize: 11,
        }}
      >
        <span>{formatBucket(points[0]!.bucket, resolvedInterval)}</span>
        <span>{formatBucket(points[points.length - 1]!.bucket, resolvedInterval)}</span>
      </div>
    </div>
  );
}

function titleForMetric(m: MetricName): string {
  return m === "visitors" ? "Visitors" : m === "pageviews" ? "Pageviews" : "Sessions";
}

function defaultInterval(w: WindowSpec): IntervalName {
  if (w === "1h") return "minute";
  if (w === "24h") return "hour";
  if (w === "7d" || w === "30d") return "day";
  return "day";
}

function formatBucket(iso: string, interval: IntervalName): string {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  // Fixed UTC formatting to avoid hydration mismatches when the
  // server and client locales disagree.
  const pad = (n: number) => String(n).padStart(2, "0");
  if (interval === "minute" || interval === "hour") {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
