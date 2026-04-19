"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { metricValue } from "../styles.js";

export interface LiveCountProps {
  initialValue: number;
  style?: CSSProperties;
}

/**
 * Animates a numeric counter whenever the value changes. Accepts the
 * server-rendered initialValue so the first paint is hydration-safe
 * (no mismatch). Respects prefers-reduced-motion.
 */
export function LiveCount({ initialValue, style }: LiveCountProps) {
  const [displayed, setDisplayed] = useState(initialValue);
  const prevRef = useRef(initialValue);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const target = initialValue;
    const start = prevRef.current;
    prevRef.current = target;
    if (start === target) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setDisplayed(target);
      return;
    }

    const DURATION = 400; // ms
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [initialValue]);

  return <span data-wbx-value style={{ ...metricValue, ...style }}>{displayed}</span>;
}
