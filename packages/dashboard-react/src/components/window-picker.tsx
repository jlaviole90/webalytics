"use client";

import { useState, useEffect, type CSSProperties } from "react";
import type { WindowSpec } from "../types.js";

const PRESETS: { label: string; value: WindowSpec }[] = [
  { label: "1H", value: "1h" },
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
];

const pickerBar: CSSProperties = {
  display: "flex",
  gap: 4,
  background: "var(--wbx-surface)",
  border: "1px solid var(--wbx-border)",
  borderRadius: "var(--wbx-radius)",
  padding: 4,
};

const btnBase: CSSProperties = {
  all: "unset",
  cursor: "pointer",
  padding: "6px 14px",
  borderRadius: "calc(var(--wbx-radius) - 2px)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--wbx-fg-muted)",
  fontFamily: "var(--wbx-font)",
  transition: "background 0.15s, color 0.15s",
};

const btnActive: CSSProperties = {
  background: "var(--wbx-bg)",
  color: "var(--wbx-fg)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

export interface WindowPickerProps {
  active: WindowSpec;
  onChange: (w: WindowSpec) => void;
  className?: string;
  style?: CSSProperties;
}

function resolvedRange(w: WindowSpec): string | null {
  if (typeof w !== "string") return null;
  const now = new Date();
  const MS: Record<string, number> = {
    "1h": 3_600_000,
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "90d": 90 * 86_400_000,
  };
  const from = new Date(now.getTime() - (MS[w] ?? 0));
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmt = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${fmt(from)} – ${fmt(now)}`;
}

export function WindowPicker({ active, onChange, className, style }: WindowPickerProps) {
  const [range, setRange] = useState<string | null>(null);
  useEffect(() => { setRange(resolvedRange(active)); }, [active]);

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, ...style }}>
      <div data-wbx-picker style={pickerBar}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            style={p.value === active ? { ...btnBase, ...btnActive } : btnBase}
            onClick={() => onChange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {range && (
        <div style={{ fontSize: 11, color: "var(--wbx-fg-subtle)", fontFamily: "var(--wbx-font)" }}>
          {range}
        </div>
      )}
    </div>
  );
}
