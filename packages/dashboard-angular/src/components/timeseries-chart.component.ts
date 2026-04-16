import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from "@angular/core";
import type { IntervalName, TimeseriesResponse } from "../types";
import { formatInt } from "../format";
import { WBX_CSS } from "../theme";

// Inline-SVG area chart. Mirrors the React package exactly — zero chart
// dep, viewBox-based so the rendering is perfectly responsive inside
// Angular change detection (no ResizeObserver chicanery).
@Component({
  selector: "wb-timeseries-chart",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-part="timeseries">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div data-wbx-title>{{ resolvedTitle }}</div>
        <div data-wbx-subtle>
          Total: <strong style="color: var(--wbx-fg);">{{ total }}</strong>
        </div>
      </div>
      <ng-container *ngIf="data.points.length === 0; else chart">
        <div data-wbx-subtle style="padding: 32px 0; text-align: center;">
          No data in this range.
        </div>
      </ng-container>
      <ng-template #chart>
        <svg
          role="img"
          [attr.aria-label]="resolvedTitle + ' over time'"
          [attr.viewBox]="'0 0 ' + W + ' ' + H"
          preserveAspectRatio="none"
          [style.width.%]="100"
          [style.height.px]="height"
          [style.marginTop.px]="12"
          style="display: block;"
        >
          <defs>
            <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--wbx-accent)" stop-opacity="0.35" />
              <stop offset="100%" stop-color="var(--wbx-accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line
            *ngFor="let t of [0.25, 0.5, 0.75]"
            [attr.x1]="PAD_X"
            [attr.x2]="W - PAD_X"
            [attr.y1]="PAD_Y + (H - PAD_Y * 2) * t"
            [attr.y2]="PAD_Y + (H - PAD_Y * 2) * t"
            stroke="var(--wbx-border)"
            stroke-width="1"
            stroke-dasharray="2 4"
            vector-effect="non-scaling-stroke"
          />
          <path [attr.d]="areaPath" [attr.fill]="'url(#' + gradientId + ')'" />
          <path
            [attr.d]="linePath"
            fill="none"
            stroke="var(--wbx-accent)"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <div
          data-wbx-subtle
          style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px;"
        >
          <span>{{ startLabel }}</span>
          <span>{{ endLabel }}</span>
        </div>
      </ng-template>
    </div>
  `,
})
export class TimeseriesChartComponent {
  /** Response from `client.timeseries(window, metric, interval)`. */
  @Input({ required: true }) data!: TimeseriesResponse;

  /** Pixel height of the chart surface. */
  @Input() height = 240;

  /** Override the card title; defaults to humanized metric name. */
  @Input() title?: string;

  // SVG viewBox units — resolution-independent.
  readonly W = 1000;
  readonly H = 300;
  readonly PAD_X = 8;
  readonly PAD_Y = 12;

  get gradientId() {
    return "wbx-grad-" + this.data.metric;
  }

  get total() {
    return formatInt(this.data.points.reduce((a, p) => a + p.value, 0));
  }

  get resolvedTitle() {
    if (this.title) return this.title.toUpperCase();
    const m = this.data.metric;
    return (m === "visitors" ? "VISITORS" : m === "pageviews" ? "PAGEVIEWS" : "SESSIONS");
  }

  get startLabel() {
    return this.formatBucket(this.data.points[0]!.bucket);
  }

  get endLabel() {
    return this.formatBucket(this.data.points[this.data.points.length - 1]!.bucket);
  }

  get max() {
    return Math.max(1, ...this.data.points.map((p) => p.value));
  }

  private xOf(i: number) {
    const n = this.data.points.length;
    const stepX = n > 1 ? (this.W - this.PAD_X * 2) / (n - 1) : 0;
    return this.PAD_X + i * stepX;
  }

  private yOf(v: number) {
    return this.PAD_Y + (this.H - this.PAD_Y * 2) * (1 - v / this.max);
  }

  get linePath() {
    return this.data.points
      .map((p, i) => `${i === 0 ? "M" : "L"}${this.xOf(i)},${this.yOf(p.value)}`)
      .join(" ");
  }

  get areaPath() {
    const pts = this.data.points;
    const n = pts.length;
    if (n === 0) return "";
    return (
      `M${this.xOf(0)},${this.yOf(0)} ` +
      pts.map((p, i) => `L${this.xOf(i)},${this.yOf(p.value)}`).join(" ") +
      ` L${this.xOf(n - 1)},${this.H - this.PAD_Y} Z`
    );
  }

  private formatBucket(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.valueOf())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    const interval = this.data.interval as IntervalName;
    if (interval === "minute" || interval === "hour") {
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
}
