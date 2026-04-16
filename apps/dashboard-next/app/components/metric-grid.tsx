import type { ReactNode } from "react";

// Compact numeric tile used on multiple pages.
export function MetricTile({
  label,
  value,
  sublabel,
  testId,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        border: "1px solid #eee",
        borderRadius: 8,
        padding: "16px 20px",
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 12, color: "#666", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 4 }}>{value}</div>
      {sublabel && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{sublabel}</div>}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 24,
      }}
    >
      {children}
    </div>
  );
}

export function fmtInt(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat().format(Math.round(n));
}

export function fmtPct(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtMs(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${Math.round(n)}ms`;
}
