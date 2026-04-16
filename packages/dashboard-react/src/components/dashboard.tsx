import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type { Filters, WindowSpec } from "../types.js";
import { grid, themeVars } from "../styles.js";
import { Realtime } from "./realtime.js";
import { SummaryCards } from "./summary.js";
import { TimeseriesChart } from "./timeseries.js";
import { TopList } from "./top-list.js";
import { WebVitalsCards } from "./web-vitals.js";

export interface DashboardProps {
  client: DashboardClient;
  window?: WindowSpec;
  siteId?: string;
  filters?: Filters;
  /** Optional heading / subtitle slot content. */
  header?: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Opinionated full-dashboard layout. Drop this into an RSC page and
 * you get a Vercel-style Analytics view without writing layout code.
 * For custom layouts, compose the primitives yourself.
 *
 * All sub-components run their fetches in parallel (React awaits the
 * server-component tree concurrently), so total render time is
 * dominated by the slowest single query.
 */
export function Dashboard({
  client,
  window = "7d",
  siteId,
  filters,
  header,
  className,
  style,
}: DashboardProps) {
  return (
    <div
      data-wbx
      className={className}
      style={{
        ...themeVars,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        ...style,
      }}
    >
      {header}
      {/* Top row: summary + realtime side-by-side. Two columns so the
          realtime card doesn't stretch edge-to-edge on wide screens. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
          gap: 16,
        }}
      >
        {/* @ts-expect-error async Server Component */}
        <SummaryCards client={client} window={window} siteId={siteId} filters={filters} />
        {/* @ts-expect-error async Server Component */}
        <Realtime client={client} siteId={siteId} />
      </div>

      {/* @ts-expect-error async Server Component */}
      <TimeseriesChart
        client={client}
        window={window}
        metric="visitors"
        siteId={siteId}
        filters={filters}
      />

      {/* 2x2 breakdown grid */}
      <div style={grid(2)}>
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="path"
          window={window}
          siteId={siteId}
          filters={filters}
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="referrer_host"
          window={window}
          siteId={siteId}
          filters={filters}
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="country"
          window={window}
          siteId={siteId}
          filters={filters}
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="device"
          window={window}
          siteId={siteId}
          filters={filters}
        />
      </div>

      {/* @ts-expect-error async Server Component */}
      <WebVitalsCards client={client} window={window} siteId={siteId} filters={filters} />
    </div>
  );
}
