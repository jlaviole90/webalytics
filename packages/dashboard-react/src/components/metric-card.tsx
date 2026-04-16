import type { CSSProperties, ReactNode } from "react";
import { card, cardTitle, metricValue, subtle } from "../styles.js";

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Low-level card tile. Used by <SummaryCards /> and composable on its own. */
export function MetricCard({ label, value, hint, className, style }: MetricCardProps) {
  return (
    <div
      data-wbx-part="metric-card"
      className={className}
      style={{ ...card, ...style }}
    >
      <div style={cardTitle}>{label}</div>
      <div style={metricValue}>{value}</div>
      {hint != null ? <div style={{ ...subtle, marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}
