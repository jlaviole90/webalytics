// Pure formatters. No locale-sensitive output unless the caller asks;
// the Server Component render environment is often a different locale
// than the user's browser, which would cause hydration warnings.

export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(v);
}

export function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "0%";
  // API returns bounce_rate as 0..1; handle both "percent" and "ratio" inputs.
  const pct = n <= 1 && n >= 0 ? n * 100 : n;
  return pct.toFixed(digits) + "%";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0s";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

export function formatMs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1000) return (n / 1000).toFixed(2) + "s";
  return Math.round(n) + "ms";
}

/** Format CLS, which is unitless but small (0..1 typical, < 0.1 = good). */
export function formatCLS(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(3);
}

/**
 * Country-code -> flag emoji. Falls back to the raw string if the code
 * isn't two ASCII letters. Uses regional-indicator symbols (U+1F1E6..).
 */
export function countryFlag(cc?: string): string {
  if (!cc || cc.length !== 2) return "";
  const up = cc.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return "";
  const base = 0x1f1e6 - 0x41;
  return String.fromCodePoint(base + up.charCodeAt(0), base + up.charCodeAt(1));
}
