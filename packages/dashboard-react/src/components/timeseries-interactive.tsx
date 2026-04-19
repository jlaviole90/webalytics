"use client";

import { useState, useRef } from "react";
import type { IntervalName, MetricName } from "../types.js";
import { formatBucket, formatInt } from "../format.js";

// Must match the constants in timeseries.tsx.
const W = 1000;
const H = 300;
const PAD_LEFT = 64;
const PAD_RIGHT = 8;
const PAD_Y = 12;

const BUBBLE_W = 160;
const BUBBLE_H = 30;

export interface TimeseriesChartInteractiveProps {
  points: Array<{ bucket: string; value: number }>;
  metric: MetricName;
  resolvedInterval: IntervalName;
  height: number;
  max: number;
}

/**
 * Transparent SVG overlay on top of the static TimeseriesChart SVG.
 * Captures mouse events and renders a vertical rule + tooltip bubble.
 * No impact on SSR output — the base chart renders without this layer.
 */
export function TimeseriesChartInteractive({
  points,
  resolvedInterval,
  height,
  max,
}: TimeseriesChartInteractiveProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = points.length;
  const stepX = n > 1 ? (W - PAD_LEFT - PAD_RIGHT) / (n - 1) : 0;
  const xOf = (i: number) => PAD_LEFT + i * stepX;
  const yOf = (v: number) => PAD_Y + (H - PAD_Y * 2) * (1 - v / max);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = Math.abs(xOf(i) - svgX);
      if (dx < bestDist) { bestDist = dx; best = i; }
    }
    setHoverIdx(best);
  }

  const hp = hoverIdx !== null ? points[hoverIdx] : null;
  const hx = hoverIdx !== null ? xOf(hoverIdx) : 0;
  const hy = hoverIdx !== null && hp ? yOf(hp.value) : 0;
  const bubbleX = hx > W / 2 ? hx - BUBBLE_W - 10 : hx + 10;
  const bubbleY = Math.max(PAD_Y + 2, Math.min(H - PAD_Y - BUBBLE_H - 2, hy - BUBBLE_H / 2));

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height,
        display: "block",
        cursor: "crosshair",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      {/* Transparent hit area covering chart surface */}
      <rect
        x={PAD_LEFT}
        y={PAD_Y}
        width={W - PAD_LEFT - PAD_RIGHT}
        height={H - PAD_Y * 2}
        fill="transparent"
      />

      {hoverIdx !== null && hp && (
        <g>
          {/* Vertical rule */}
          <line
            x1={hx} y1={PAD_Y} x2={hx} y2={H - PAD_Y}
            stroke="var(--wbx-fg-subtle)"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
          {/* Highlighted dot */}
          <circle
            cx={hx} cy={hy} r={5}
            fill="var(--wbx-accent)"
            stroke="var(--wbx-bg)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {/* Tooltip bubble */}
          <rect
            x={bubbleX} y={bubbleY}
            width={BUBBLE_W} height={BUBBLE_H}
            rx={4}
            fill="var(--wbx-fg)"
            opacity={0.88}
          />
          <text
            x={bubbleX + BUBBLE_W / 2}
            y={bubbleY + BUBBLE_H / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={15}
            fill="var(--wbx-bg)"
            fontFamily="var(--wbx-font)"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatBucket(hp.bucket, resolvedInterval)} · {formatInt(hp.value)}
          </text>
        </g>
      )}
    </svg>
  );
}
