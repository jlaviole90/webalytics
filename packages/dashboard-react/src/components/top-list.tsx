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
        <div style={subtle}>{formatInt(data.total)}</div>
      </div>
      {results.length === 0 ? (
        <div style={{ ...subtle, padding: "24px 0", textAlign: "center" }}>
          No data yet.
        </div>
      ) : (
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
                  <div style={barFill(r.share)} />
                </div>
                <span
                  style={{
                    position: "absolute",
                    // visually-hidden twin for screen readers
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
      )}
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
