import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type {
  Filters,
  IntervalName,
  MetricName,
  WindowSpec,
} from "../types.js";
import { formatBucket, formatInt } from "../format.js";
import { card, cardTitle, subtle } from "../styles.js";
import { TimeseriesChartInteractive } from "./timeseries-interactive.js";

// Palette: first entry is --wbx-accent, extras use CSS variable fallbacks
// so consumers can override them via custom properties.
const METRIC_COLORS = [
  "var(--wbx-accent)",
  "var(--wbx-metric-1, #8b5cf6)",
  "var(--wbx-metric-2, #f59e0b)",
];

export interface TimeseriesChartProps {
  client: DashboardClient;
  window?: WindowSpec;
  /** Single metric (original API). Ignored when `metrics` is provided. */
  metric?: MetricName;
  /**
   * Multiple metrics rendered as overlaid lines. When provided, takes
   * precedence over `metric`. Single-metric behavior is unchanged.
   */
  metrics?: MetricName[];
  interval?: IntervalName;
  siteId?: string;
  filters?: Filters;
  /** Title shown above the chart. Defaults to the metric name(s). */
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
  metrics,
  interval,
  siteId,
  filters,
  title,
  height = 240,
  className,
  style,
}: TimeseriesChartProps) {
  const activeMetrics: MetricName[] = metrics && metrics.length > 0 ? metrics : [metric];
  const isMulti = activeMetrics.length > 1;
  const resolvedInterval: IntervalName = interval ?? defaultInterval(window);

  const allData = await Promise.all(
    activeMetrics.map((m) =>
      client.timeseries(window, m, resolvedInterval, { siteId, filters }),
    ),
  );

  const primaryPoints = allData[0]!.points;
  const labelTitle =
    title ?? (isMulti ? activeMetrics.map(titleForMetric).join(" / ") : titleForMetric(activeMetrics[0]!));

  if (primaryPoints.length === 0) {
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

  const total = primaryPoints.reduce((a, p) => a + p.value, 0);
  const max = Math.max(1, ...allData.flatMap((d) => d.points.map((p) => p.value)));

  // Chart area coordinates (viewBox units; resolution-independent).
  const W = 1000;
  const H = 300;
  const PAD_LEFT = 64; // space reserved for y-axis labels
  const PAD_RIGHT = 8;
  const PAD_Y = 12;
  const n = primaryPoints.length;
  const stepX = n > 1 ? (W - PAD_LEFT - PAD_RIGHT) / (n - 1) : 0;
  const xOf = (i: number) => PAD_LEFT + i * stepX;
  const yOf = (v: number) => PAD_Y + (H - PAD_Y * 2) * (1 - v / max);

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
        {!isMulti && (
          <div style={subtle}>
            Total: <strong style={{ color: "var(--wbx-fg)" }}>{formatInt(total)}</strong>
          </div>
        )}
      </div>

      <div style={{ position: "relative", marginTop: 12, height }}>
        <svg
          role="img"
          aria-label={`${labelTitle} over time`}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height, display: "block" }}
        >
          <defs>
            {!isMulti && (
              <linearGradient id={`wbx-grad-${activeMetrics[0]}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--wbx-accent)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="var(--wbx-accent)" stopOpacity="0" />
              </linearGradient>
            )}
          </defs>

          {/* Horizontal grid lines + y-axis value labels */}
          {[0.25, 0.5, 0.75].map((t) => {
            const gy = PAD_Y + (H - PAD_Y * 2) * t;
            return (
              <g key={t}>
                <line
                  x1={PAD_LEFT}
                  x2={W - PAD_RIGHT}
                  y1={gy}
                  y2={gy}
                  stroke="var(--wbx-border)"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={PAD_LEFT - 8}
                  y={gy}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={18}
                  fill="var(--wbx-fg-subtle)"
                >
                  {formatInt(max * (1 - t))}
                </text>
              </g>
            );
          })}

          {/* Series paths */}
          {allData.map((d, idx) => {
            const pts = d.points;
            const color = METRIC_COLORS[idx] ?? METRIC_COLORS[0]!;
            const line = pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(p.value)}`)
              .join(" ");
            const area =
              `M${xOf(0)},${H - PAD_Y} ` +
              pts.map((p, i) => `L${xOf(i)},${yOf(p.value)}`).join(" ") +
              ` L${xOf(pts.length - 1)},${H - PAD_Y} Z`;
            return (
              <g key={activeMetrics[idx]}>
                {!isMulti && (
                  <path d={area} fill={`url(#wbx-grad-${activeMetrics[0]})`} />
                )}
                <path
                  d={line}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {pts.length <= 31 &&
                  pts.map((p, i) => (
                    <circle
                      key={i}
                      cx={xOf(i)}
                      cy={yOf(p.value)}
                      r={3}
                      fill={color}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </g>
            );
          })}
        </svg>

        <TimeseriesChartInteractive
          points={primaryPoints}
          metric={activeMetrics[0]!}
          resolvedInterval={resolvedInterval}
          height={height}
          max={max}
        />
      </div>

      {/* Multi-metric legend */}
      {isMulti && (
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          {activeMetrics.map((m, idx) => (
            <span
              key={m}
              style={{ display: "flex", alignItems: "center", gap: 6, ...subtle, fontSize: 12 }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 2,
                  background: METRIC_COLORS[idx] ?? METRIC_COLORS[0],
                  borderRadius: 1,
                }}
              />
              {titleForMetric(m)}
            </span>
          ))}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          ...subtle,
          fontSize: 11,
        }}
      >
        <span>{formatBucket(primaryPoints[0]!.bucket, resolvedInterval)}</span>
        <span>{formatBucket(primaryPoints[primaryPoints.length - 1]!.bucket, resolvedInterval)}</span>
      </div>
    </div>
  );
}

export function titleForMetric(m: MetricName): string {
  return m === "visitors" ? "Visitors" : m === "pageviews" ? "Pageviews" : "Sessions";
}

function defaultInterval(w: WindowSpec): IntervalName {
  if (w === "1h") return "minute";
  if (w === "24h") return "hour";
  if (w === "7d" || w === "30d") return "day";
  return "day";
}
