import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from "@angular/core";
import type { WebVitalsResponse } from "../types";
import { formatCLS, formatInt, formatMs } from "../format";
import { WBX_CSS } from "../theme";

type VitalKey = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";

// Google's published CWV thresholds. We classify the p75 against these,
// matching what PageSpeed Insights uses.
const THRESHOLDS: Record<
  VitalKey,
  { good: number; poor: number; label: string; formatter: (n: number) => string }
> = {
  LCP: { good: 2500, poor: 4000, label: "Largest Contentful Paint", formatter: formatMs },
  INP: { good: 200, poor: 500, label: "Interaction to Next Paint", formatter: formatMs },
  CLS: { good: 0.1, poor: 0.25, label: "Cumulative Layout Shift", formatter: formatCLS },
  FCP: { good: 1800, poor: 3000, label: "First Contentful Paint", formatter: formatMs },
  TTFB: { good: 800, poor: 1800, label: "Time to First Byte", formatter: formatMs },
};

interface VitalView {
  key: VitalKey;
  label: string;
  p75Display: string;
  kind: "good" | "warn" | "bad";
  kindLabel: string;
  samplesDisplay: string;
  hasSamples: boolean;
  goodPct: number;
  warnPct: number;
  badPct: number;
}

@Component({
  selector: "wb-web-vitals-cards",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-grid-3>
      <div *ngFor="let v of views" data-wbx-part="web-vitals-card" [attr.data-wbx-metric]="v.key">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div data-wbx-title>{{ v.key }}</div>
          <span data-wbx-badge [attr.data-wbx-badge]="v.kind">{{ v.kindLabel }}</span>
        </div>
        <div
          style="font-size: 30px; font-weight: 600; letter-spacing: -0.5px; margin-top: 8px;
                 font-variant-numeric: tabular-nums;"
        >
          {{ v.p75Display }}
        </div>
        <div data-wbx-subtle style="margin-top: 4px;">p75 · {{ v.label }}</div>
        <div
          *ngIf="v.hasSamples"
          style="margin-top: 16px; display: flex; height: 8px; border-radius: 4px;
                 overflow: hidden; background: var(--wbx-surface);"
        >
          <div [style.flex]="v.goodPct" style="background: var(--wbx-good);"></div>
          <div [style.flex]="v.warnPct" style="background: var(--wbx-warn);"></div>
          <div [style.flex]="v.badPct" style="background: var(--wbx-bad);"></div>
        </div>
        <div data-wbx-subtle style="margin-top: 6px;">{{ v.samplesDisplay }}</div>
      </div>
    </div>
  `,
})
export class WebVitalsCardsComponent {
  /** Response from `client.webVitals(window, { groupBy: 'none' })`. */
  @Input({ required: true }) data!: WebVitalsResponse;

  /** Which vitals to render. Defaults to the Core Web Vitals trio. */
  @Input() metrics: VitalKey[] = ["LCP", "INP", "CLS"];

  get views(): VitalView[] {
    const agg = this.data.groups[0]?.metrics;
    return this.metrics.map((k) => this.viewFor(k, agg?.[k]));
  }

  private viewFor(
    k: VitalKey,
    row?: { p75: number; samples: number; good: number; needs_improvement: number; poor: number },
  ): VitalView {
    const t = THRESHOLDS[k];
    const p75 = row?.p75 ?? 0;
    const kind: "good" | "warn" | "bad" =
      !row || row.samples === 0
        ? "warn"
        : p75 <= t.good
          ? "good"
          : p75 <= t.poor
            ? "warn"
            : "bad";
    const total = row ? row.good + row.needs_improvement + row.poor : 0;
    return {
      key: k,
      label: t.label,
      p75Display: row ? t.formatter(p75) : "—",
      kind,
      kindLabel: kind === "good" ? "Good" : kind === "warn" ? "Needs work" : "Poor",
      samplesDisplay: row ? `${formatInt(row.samples)} samples` : "no samples",
      hasSamples: total > 0,
      goodPct: row ? row.good / total : 0,
      warnPct: row ? row.needs_improvement / total : 0,
      badPct: row ? row.poor / total : 0,
    };
  }
}
