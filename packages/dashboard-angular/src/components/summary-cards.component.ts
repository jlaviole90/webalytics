import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from "@angular/core";
import type { SummaryResponse } from "../types";
import { formatDuration, formatInt, formatPct } from "../format";
import { WBX_CSS } from "../theme";

/**
 * Four canonical metric tiles: visitors, pageviews, bounce, avg time.
 * Pass the output of `client.summary(window)` via [data].
 *
 * View encapsulation is None because the library's palette CSS lives
 * on [data-wbx] and needs to cascade into our template.
 */
@Component({
  selector: "wb-summary-cards",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-grid-4>
      <div data-wbx-part="metric-card">
        <div data-wbx-title>VISITORS</div>
        <div data-wbx-value>{{ visitors() }}</div>
      </div>
      <div data-wbx-part="metric-card">
        <div data-wbx-title>PAGEVIEWS</div>
        <div data-wbx-value>{{ pageviews() }}</div>
      </div>
      <div data-wbx-part="metric-card">
        <div data-wbx-title>BOUNCE RATE</div>
        <div data-wbx-value>{{ bounce() }}</div>
      </div>
      <div data-wbx-part="metric-card">
        <div data-wbx-title>AVG SESSION</div>
        <div data-wbx-value>{{ avgSession() }}</div>
      </div>
    </div>
  `,
})
export class SummaryCardsComponent {
  /** Response from `client.summary(window, { filters })`. */
  @Input({ required: true }) data!: SummaryResponse;

  visitors() {
    return formatInt(this.data.metrics.visitors.value);
  }
  pageviews() {
    return formatInt(this.data.metrics.pageviews.value);
  }
  bounce() {
    return formatPct(this.data.metrics.bounce_rate.value);
  }
  avgSession() {
    return formatDuration(this.data.metrics.avg_session_s.value);
  }
}
