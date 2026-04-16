// Inline styles keyed by CSS variables. Consumers can override the
// palette in a parent stylesheet by targeting [data-wbx] or the
// specific data-wbx-part selectors below. Keeps the package free of
// any CSS-in-JS runtime dependency and works identically in RSC,
// Vite, Webpack, etc.

import type { CSSProperties } from "react";

// Public: spread this onto the outermost container you render to apply
// the default palette. We keep it additive (no global reset) so it
// can't break host styling.
export const themeVars: CSSProperties = {
  // Palette chosen to feel at-home in a Vercel-ish dashboard: high
  // contrast, achromatic surfaces, a single brand accent that can be
  // overridden. Works in both light & dark host themes because the
  // defaults use neutral hues that inherit from whatever --wbx-fg
  // the host sets; users can swap them wholesale.
  ["--wbx-fg" as string]: "#0a0a0a",
  ["--wbx-fg-muted" as string]: "#6b7280",
  ["--wbx-fg-subtle" as string]: "#9ca3af",
  ["--wbx-bg" as string]: "#ffffff",
  ["--wbx-surface" as string]: "#fafafa",
  ["--wbx-border" as string]: "#e5e7eb",
  ["--wbx-accent" as string]: "#0070f3",
  ["--wbx-accent-soft" as string]: "rgba(0, 112, 243, 0.12)",
  ["--wbx-good" as string]: "#16a34a",
  ["--wbx-warn" as string]: "#d97706",
  ["--wbx-bad" as string]: "#dc2626",
  ["--wbx-radius" as string]: "8px",
  ["--wbx-font" as string]:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif',
  color: "var(--wbx-fg)",
  fontFamily: "var(--wbx-font)",
  fontFeatureSettings: '"tnum" 1, "cv11" 1',
};

export const card: CSSProperties = {
  background: "var(--wbx-bg)",
  border: "1px solid var(--wbx-border)",
  borderRadius: "var(--wbx-radius)",
  padding: 20,
};

export const cardTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--wbx-fg-muted)",
  margin: 0,
  letterSpacing: 0.1,
};

export const metricValue: CSSProperties = {
  fontSize: 34,
  fontWeight: 600,
  letterSpacing: -0.5,
  lineHeight: 1.1,
  marginTop: 8,
  color: "var(--wbx-fg)",
  fontVariantNumeric: "tabular-nums",
};

export const subtle: CSSProperties = {
  fontSize: 13,
  color: "var(--wbx-fg-muted)",
};

export const grid = (cols = 4): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fit, minmax(${Math.round(900 / cols)}px, 1fr))`,
  gap: 16,
});

export const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 0",
  borderBottom: "1px solid var(--wbx-border)",
  fontSize: 14,
};

export const rowLast: CSSProperties = { ...row, borderBottom: "none" };

export const barTrack: CSSProperties = {
  position: "relative",
  flex: 1,
  height: 20,
  background: "var(--wbx-surface)",
  borderRadius: 4,
  overflow: "hidden",
};

export const barFill = (share: number): CSSProperties => ({
  position: "absolute",
  inset: 0,
  width: `${Math.max(2, Math.min(100, share * 100))}%`,
  background: "var(--wbx-accent-soft)",
  borderLeft: "2px solid var(--wbx-accent)",
});

export const pulseDot: CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--wbx-good)",
  boxShadow: "0 0 0 0 rgba(22, 163, 74, 0.4)",
  // Animation keyframes are emitted via <style> in the Realtime component;
  // keeping them inline-only here.
};

export const badge = (kind: "good" | "warn" | "bad"): CSSProperties => ({
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  color: "#fff",
  background:
    kind === "good"
      ? "var(--wbx-good)"
      : kind === "warn"
        ? "var(--wbx-warn)"
        : "var(--wbx-bad)",
});
