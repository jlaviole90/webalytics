"use client";

import type { CSSProperties } from "react";
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

export function WindowPicker({ active, onChange, className, style }: WindowPickerProps) {
  return (
    <div data-wbx-picker className={className} style={{ ...pickerBar, ...style }}>
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
  );
}
