import type { CSSProperties } from "react";
import type { DashboardClient } from "../client.js";
import type { DashboardTheme, Filters, WindowSpec } from "../types.js";
import { grid, themeVars, RESPONSIVE_CSS } from "../styles.js";
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
  /** Override theme CSS variables without writing custom CSS. */
  theme?: DashboardTheme;
  className?: string;
  style?: CSSProperties;
}

function themeToVars(t?: DashboardTheme): CSSProperties {
  if (!t) return {};
  const v: Record<string, string> = {};
  if (t.accent) v["--wbx-accent"] = t.accent;
  if (t.background) v["--wbx-bg"] = t.background;
  if (t.surface) v["--wbx-surface"] = t.surface;
  if (t.foreground) v["--wbx-fg"] = t.foreground;
  if (t.border) v["--wbx-border"] = t.border;
  if (t.radius) v["--wbx-radius"] = t.radius;
  if (t.fontFamily) v["--wbx-font"] = t.fontFamily;
  return v as CSSProperties;
}

/**
 * Opinionated full-dashboard layout. Drop this into an RSC page and
 * you get a Vercel-style Analytics view without writing layout code.
 * For custom layouts, compose the primitives yourself.
 *
 * For interactive window picking, pair with the exported `WindowPicker`
 * client component and control `window` via state in a client wrapper.
 */
export function Dashboard({
  client,
  window = "7d",
  siteId,
  filters,
  header,
  theme,
  className,
  style,
}: DashboardProps) {
  return (
    <div
      data-wbx
      className={className}
      style={{
        ...themeVars,
        ...themeToVars(theme),
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        ...style,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: RESPONSIVE_CSS }} />
      {header}
      <div
        data-wbx-top-row
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

      <div data-wbx-grid-2 style={grid(2)}>
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="path"
          window={window}
          siteId={siteId}
          filters={filters}
          barScale="absolute"
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="referrer_host"
          window={window}
          siteId={siteId}
          filters={filters}
          barScale="absolute"
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="country"
          window={window}
          siteId={siteId}
          filters={filters}
          barScale="absolute"
        />
        {/* @ts-expect-error async Server Component */}
        <TopList
          client={client}
          dimension="device"
          window={window}
          siteId={siteId}
          filters={filters}
          barScale="absolute"
          variant="donut"
        />
      </div>

      {/* @ts-expect-error async Server Component */}
      <WebVitalsCards client={client} window={window} siteId={siteId} filters={filters} />
    </div>
  );
}
