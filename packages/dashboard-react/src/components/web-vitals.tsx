import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type { Filters, WindowSpec } from "../types.js";
import { formatCLS, formatInt, formatMs } from "../format.js";
import { badge, card, cardTitle, grid, subtle } from "../styles.js";

export interface WebVitalsCardsProps {
  client: DashboardClient;
  window?: WindowSpec;
  siteId?: string;
  filters?: Filters;
  /** Only show these metrics; defaults to the Core Web Vitals trio. */
  metrics?: Array<"LCP" | "INP" | "CLS" | "FCP" | "TTFB">;
  className?: string;
  style?: CSSProperties;
}

// Google's published CWV thresholds. We classify the p75 against these,
// matching what the PageSpeed Insights dashboard does.
const THRESHOLDS: Record<
  "LCP" | "INP" | "CLS" | "FCP" | "TTFB",
  { good: number; poor: number; format: (n: number) => string; label: string }
> = {
  LCP: { good: 2500, poor: 4000, format: formatMs, label: "Largest Contentful Paint" },
  INP: { good: 200, poor: 500, format: formatMs, label: "Interaction to Next Paint" },
  CLS: { good: 0.1, poor: 0.25, format: formatCLS, label: "Cumulative Layout Shift" },
  FCP: { good: 1800, poor: 3000, format: formatMs, label: "First Contentful Paint" },
  TTFB: { good: 800, poor: 1800, format: formatMs, label: "Time to First Byte" },
};

export async function WebVitalsCards({
  client,
  window = "7d",
  siteId,
  filters,
  metrics = ["LCP", "INP", "CLS"],
  className,
  style,
}: WebVitalsCardsProps) {
  const data = await client.webVitals(window, { siteId, filters, groupBy: "none" });
  const agg = data.groups[0]?.metrics;

  return (
    <div
      data-wbx-part="web-vitals"
      className={className}
      style={{ ...grid(metrics.length), ...style }}
    >
      {metrics.map((m) => {
        const row = agg?.[m];
        const t = THRESHOLDS[m];
        const p75 = row?.p75 ?? 0;
        const kind: "good" | "warn" | "bad" =
          !row || row.samples === 0
            ? "warn"
            : p75 <= t.good
              ? "good"
              : p75 <= t.poor
                ? "warn"
                : "bad";
        const total = row ? row.good + row.needs_improvement + row.poor : 0;
        return (
          <div
            key={m}
            style={card}
            data-wbx-part="web-vitals-card"
            data-wbx-metric={m}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={cardTitle}>{m}</div>
              <span style={badge(kind)}>
                {kind === "good" ? "Good" : kind === "warn" ? "Needs work" : "Poor"}
              </span>
            </div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: -0.5,
                marginTop: 8,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row ? t.format(p75) : "—"}
            </div>
            <div style={{ ...subtle, marginTop: 4 }}>
              p75 · {t.label}
            </div>
            {row && row.p95 > 0 && (
              <div style={{ ...subtle, marginTop: 2, fontSize: 11 }}>
                p95 {t.format(row.p95)}
              </div>
            )}
            {total > 0 && (
              <>
                <div
                  style={{
                    marginTop: 16,
                    display: "flex",
                    height: 24,
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "var(--wbx-surface)",
                  }}
                >
                  <div style={{ flex: row!.good / total, background: "var(--wbx-good)" }} />
                  <div
                    style={{ flex: row!.needs_improvement / total, background: "var(--wbx-warn)" }}
                  />
                  <div style={{ flex: row!.poor / total, background: "var(--wbx-bad)" }} />
                </div>
                <div style={{ ...subtle, marginTop: 6, fontSize: 11 }}>
                  {Math.round((row!.good / total) * 100)}% good
                  {" · "}
                  {Math.round((row!.needs_improvement / total) * 100)}% needs work
                  {" · "}
                  {Math.round((row!.poor / total) * 100)}% poor
                </div>
              </>
            )}
            <div style={{ ...subtle, marginTop: 6 }}>
              {row ? `${formatInt(row.samples)} samples` : "no samples"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
