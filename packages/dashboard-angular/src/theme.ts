// CSS string applied once per component via `styles: [WBX_CSS]`. We
// opt for a single inline stylesheet rather than many :host {} blocks
// so that the palette CSS variables can be overridden by the host app
// just like in the React package ([data-wbx] { --wbx-accent: ...; }).
//
// View encapsulation is set to None on every component so these styles
// are global — but scoped to our [data-wbx-part] selectors to avoid
// polluting the host stylesheet.

export const WBX_CSS = `
[data-wbx] {
  --wbx-fg: #0a0a0a;
  --wbx-fg-muted: #6b7280;
  --wbx-fg-subtle: #9ca3af;
  --wbx-bg: #ffffff;
  --wbx-surface: #fafafa;
  --wbx-border: #e5e7eb;
  --wbx-accent: #0070f3;
  --wbx-accent-soft: rgba(0, 112, 243, 0.12);
  --wbx-good: #16a34a;
  --wbx-warn: #d97706;
  --wbx-bad: #dc2626;
  --wbx-radius: 8px;
  --wbx-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, "Helvetica Neue", Arial, sans-serif;
  color: var(--wbx-fg);
  font-family: var(--wbx-font);
  font-feature-settings: "tnum" 1, "cv11" 1;
}

[data-wbx-part] {
  background: var(--wbx-bg);
  border: 1px solid var(--wbx-border);
  border-radius: var(--wbx-radius);
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

[data-wbx-title] {
  font-size: 13px;
  font-weight: 500;
  color: var(--wbx-fg-muted);
  margin: 0;
  letter-spacing: 0.1px;
}

[data-wbx-value] {
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.1;
  margin-top: 8px;
  color: var(--wbx-fg);
  font-variant-numeric: tabular-nums;
}

[data-wbx-subtle] {
  font-size: 13px;
  color: var(--wbx-fg-muted);
}

[data-wbx-row] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--wbx-border);
  font-size: 14px;
}
[data-wbx-row]:last-child { border-bottom: none; }

[data-wbx-grid-4] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
  gap: 16px;
}
[data-wbx-grid-3] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}
[data-wbx-grid-2] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 16px;
}

[data-wbx-bar-track] {
  position: relative;
  flex: 1;
  height: 20px;
  background: var(--wbx-surface);
  border-radius: 4px;
  overflow: hidden;
}
[data-wbx-bar-fill] {
  position: absolute;
  inset: 0;
  background: var(--wbx-accent-soft);
  border-left: 2px solid var(--wbx-accent);
}

[data-wbx-pulse] {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--wbx-good);
  animation: wbx-pulse 1.6s ease-out infinite;
}
@keyframes wbx-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); }
  70%  { box-shadow: 0 0 0 10px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}

[data-wbx-badge] {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
}
[data-wbx-badge="good"] { background: var(--wbx-good); }
[data-wbx-badge="warn"] { background: var(--wbx-warn); }
[data-wbx-badge="bad"]  { background: var(--wbx-bad); }

[data-wbx-picker] {
  display: flex;
  gap: 4px;
  background: var(--wbx-surface);
  border: 1px solid var(--wbx-border);
  border-radius: var(--wbx-radius);
  padding: 4px;
}
[data-wbx-picker] button {
  all: unset;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: calc(var(--wbx-radius) - 2px);
  font-size: 13px;
  font-weight: 500;
  color: var(--wbx-fg-muted);
  font-family: var(--wbx-font);
  transition: background 0.15s, color 0.15s;
}
[data-wbx-picker] button:hover {
  color: var(--wbx-fg);
  background: var(--wbx-border);
}
[data-wbx-picker] button[data-active="true"] {
  background: var(--wbx-bg);
  color: var(--wbx-fg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

@media (max-width: 640px) {
  [data-wbx] { padding: 12px !important; }
  [data-wbx-value] { font-size: 26px; }
  [data-wbx-grid-4],
  [data-wbx-grid-3],
  [data-wbx-grid-2] {
    grid-template-columns: 1fr !important;
  }
  [data-wbx-top-row] {
    grid-template-columns: 1fr !important;
  }
}
`;
