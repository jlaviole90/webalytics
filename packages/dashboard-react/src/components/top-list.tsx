import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type {
  DimensionName,
  Filters,
  MetricName,
  WindowSpec,
} from "../types.js";
import { countryFlag, formatInt, formatPct } from "../format.js";
import { barFill, barTrack, card, cardTitle, row, rowLast, subtle } from "../styles.js";

// Palette for donut segments + multi-metric charts.
const SEGMENT_COLORS = [
  "var(--wbx-accent)",
  "var(--wbx-metric-1, #8b5cf6)",
  "var(--wbx-metric-2, #f59e0b)",
  "var(--wbx-metric-3, #ec4899)",
  "var(--wbx-metric-4, #14b8a6)",
  "var(--wbx-metric-5, #f97316)",
];

export interface TopListProps {
  client: DashboardClient;
  dimension: DimensionName;
  window?: WindowSpec;
  metric?: MetricName;
  siteId?: string;
  filters?: Filters;
  limit?: number;
  /** Override the header title. Defaults to a nice label per dimension. */
  title?: string;
  /** Optional cell formatter for the dimension key (e.g. humanize hosts). */
  renderKey?: (k: string, dimension: DimensionName) => React.ReactNode;
  /**
   * `"relative"` (default) scales bars so the top item fills the track.
   * `"absolute"` scales bars as a fraction of the total across all results,
   * giving an honest picture when values are close together.
   */
  barScale?: "relative" | "absolute";
  /**
   * `"bar"` (default) renders the horizontal bar list.
   * `"donut"` renders an SVG donut chart with a legend — best for small
   * categorical sets like device type or browser.
   */
  variant?: "bar" | "donut";
  className?: string;
  style?: CSSProperties;
}

/**
 * Horizontal-bar list view used for every breakdown dimension: top
 * pages, referrers, countries, devices, browsers, OSes, UTM params, etc.
 * Each row is a compact bar overlaid with label + count + share.
 */
export async function TopList({
  client,
  dimension,
  window = "7d",
  metric = "visitors",
  siteId,
  filters,
  limit = 10,
  title,
  renderKey,
  barScale = "relative",
  variant = "bar",
  className,
  style,
}: TopListProps) {
  const data = await client.breakdown(window, dimension, {
    siteId,
    metric,
    filters,
    limit,
  });
  const display = title ?? defaultTitle(dimension);
  const results = data.results;
  const render = renderKey ?? defaultRenderKey;

  return (
    <div
      data-wbx-part="top-list"
      data-wbx-dimension={dimension}
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
        <div style={cardTitle}>{display.toUpperCase()}</div>
        <div style={subtle}>
          {formatInt(data.total)}
          {variant === "bar" && barScale === "absolute" && (
            <span style={{ marginLeft: 6, fontSize: 11 }}>vs. total</span>
          )}
        </div>
      </div>
      {results.length === 0 ? (
        <div style={{ ...subtle, padding: "24px 0", textAlign: "center" }}>
          No data yet.
        </div>
      ) : variant === "donut" ? (
        <DonutChart results={results} total={data.total} render={render} dimension={dimension} />
      ) : (
        <BarList results={results} barScale={barScale} render={render} dimension={dimension} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar variant
// ---------------------------------------------------------------------------

interface BarListProps {
  results: Array<{ key: string; value: number; share: number }>;
  barScale: "relative" | "absolute";
  render: (k: string, d: DimensionName) => React.ReactNode;
  dimension: DimensionName;
}

function BarList({ results, barScale, render, dimension }: BarListProps) {
  const totalShare = results.reduce((sum, r) => sum + r.share, 0) || 1;
  const maxShare =
    barScale === "absolute" ? totalShare : Math.max(...results.map((r) => r.share)) || 1;

  return (
    <div style={{ marginTop: 8 }}>
      {results.map((r, i) => (
        <div
          key={`${r.key}-${i}`}
          style={i === results.length - 1 ? rowLast : row}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flex: 1,
              minWidth: 0,
            }}
          >
            <div style={barTrack} aria-hidden>
              <div style={barFill(r.share / maxShare)} />
            </div>
            <span
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
              }}
            >
              {Math.round(r.share * 100)}%
            </span>
            <span
              style={{
                marginLeft: -8,
                paddingLeft: 8,
                position: "relative",
                zIndex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "55%",
              }}
              title={r.key || "(unknown)"}
            >
              {render(r.key, dimension)}
            </span>
          </div>
          <div
            style={{
              fontVariantNumeric: "tabular-nums",
              display: "flex",
              gap: 10,
              alignItems: "baseline",
            }}
          >
            <strong>{formatInt(r.value)}</strong>
            <span style={subtle}>{formatPct(r.share)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut variant
// ---------------------------------------------------------------------------

const DONUT_R = 35;
const DONUT_STROKE = 18;
const DONUT_CIRC = 2 * Math.PI * DONUT_R;

interface DonutChartProps {
  results: Array<{ key: string; value: number; share: number }>;
  total: number;
  render: (k: string, d: DimensionName) => React.ReactNode;
  dimension: DimensionName;
}

function DonutChart({ results, total, render, dimension }: DonutChartProps) {
  // Build segments with cumulative offset.
  let cumOffset = 0;
  const segments = results.map((r, idx) => {
    const segLen = r.share * DONUT_CIRC;
    const offset = cumOffset;
    cumOffset += segLen;
    return { r, idx, segLen, offset };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 12 }}>
      {/* Donut SVG */}
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        style={{ width: 120, height: 120, flexShrink: 0 }}
      >
        {/* Background ring */}
        <circle
          cx={50} cy={50} r={DONUT_R}
          fill="none"
          stroke="var(--wbx-surface)"
          strokeWidth={DONUT_STROKE}
        />
        {segments.map(({ r: res, idx, segLen, offset }) => (
          <circle
            key={`${res.key}-${idx}`}
            cx={50} cy={50} r={DONUT_R}
            fill="none"
            stroke={SEGMENT_COLORS[idx % SEGMENT_COLORS.length]}
            strokeWidth={DONUT_STROKE}
            strokeDasharray={`${segLen} ${DONUT_CIRC}`}
            strokeDashoffset={-offset}
            style={{ transform: "rotate(-90deg)", transformOrigin: "50px 50px" }}
          />
        ))}
        {/* Center label */}
        <text
          x={50} y={47}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fontWeight={600}
          fill="var(--wbx-fg)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatInt(total)}
        </text>
        <text
          x={50} y={60}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={8}
          fill="var(--wbx-fg-muted)"
        >
          total
        </text>
      </svg>

      {/* Legend */}
      <div style={{ width: "100%", marginTop: 8 }}>
        {results.map((r, i) => (
          <div
            key={`${r.key}-${i}`}
            style={i === results.length - 1 ? rowLast : row}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                }}
                aria-hidden
              />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={r.key || "(unknown)"}
              >
                {render(r.key, dimension)}
              </span>
            </div>
            <div
              style={{
                fontVariantNumeric: "tabular-nums",
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                flexShrink: 0,
              }}
            >
              <strong>{formatInt(r.value)}</strong>
              <span style={subtle}>{formatPct(r.share)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function defaultTitle(d: DimensionName): string {
  switch (d) {
    case "path":
      return "Top pages";
    case "hostname":
      return "Top hostnames";
    case "referrer_host":
      return "Top referrers";
    case "country":
      return "Top countries";
    case "device":
      return "Devices";
    case "browser":
      return "Browsers";
    case "os":
      return "Operating systems";
    case "utm_source":
      return "UTM sources";
    case "utm_medium":
      return "UTM mediums";
    case "utm_campaign":
      return "UTM campaigns";
    case "event_name":
      return "Top events";
  }
}

function defaultRenderKey(k: string, d: DimensionName): React.ReactNode {
  const label = k && k !== "" ? k : "(direct / unknown)";
  if (d === "country") {
    return (
      <span>
        <span aria-hidden style={{ marginRight: 6 }}>
          {countryFlag(k)}
        </span>
        {label}
      </span>
    );
  }
  return label;
}
