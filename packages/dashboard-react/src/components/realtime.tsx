import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import { formatInt } from "../format.js";
import { card, cardTitle, pulseDot, row, rowLast, subtle } from "../styles.js";
import { LiveCount } from "./live-count.js";

export interface RealtimeProps {
  client: DashboardClient;
  /** Override the client's default site for this card. */
  siteId?: string;
  /** If set, restricts the top-pages list to the first N entries. */
  topPagesLimit?: number;
  /** Show the "recent events" feed below the counter. Default true. */
  showRecent?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Live-visitor tile + quick top pages. Rendered on the server; to make
 * it tick, wrap your page in a Next.js server component that sets
 * `revalidateSeconds: 15` on createClient(), or refresh with router
 * actions / a client-side setInterval that calls router.refresh().
 */
export async function Realtime({
  client,
  siteId,
  topPagesLimit = 5,
  showRecent = true,
  className,
  style,
}: RealtimeProps) {
  const data = await client.realtime({ siteId });
  const pages = data.top_pages.slice(0, topPagesLimit);
  return (
    <div
      data-wbx-part="realtime"
      className={className}
      style={{ ...card, ...style }}
    >
      {/* Keyframes have to be in-document; ship once per instance. It's
          tiny and idempotent thanks to data-wbx-kf. */}
      <style>{PULSE_KEYFRAMES}</style>
      <div style={cardTitle}>LIVE VISITORS</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            ...pulseDot,
            animation: "wbx-pulse 1.6s ease-out infinite",
            alignSelf: "center",
          }}
          aria-hidden
        />
        <LiveCount initialValue={data.online} />
        <span style={subtle}>online now</span>
      </div>

      {pages.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>ACTIVE PAGES</div>
          {pages.map((p, i) => (
            <div
              key={p.path}
              style={i === pages.length - 1 ? rowLast : row}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "70%",
                }}
                title={p.path}
              >
                {p.path || "/"}
              </span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatInt(p.visitors)}
              </strong>
            </div>
          ))}
        </div>
      )}

      {showRecent && data.recent.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ ...cardTitle, marginBottom: 8 }}>RECENT</div>
          {data.recent.slice(0, 8).map((r, i, arr) => (
            <div
              key={`${r.ts}-${i}`}
              style={i === arr.length - 1 ? rowLast : row}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "70%",
                }}
              >
                {r.path || "/"}
              </span>
              <span style={subtle}>
                {r.country_code ?? ""} {r.device ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PULSE_KEYFRAMES = `
@keyframes wbx-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); }
  70%  { box-shadow: 0 0 0 10px rgba(22, 163, 74, 0); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
}
`;
