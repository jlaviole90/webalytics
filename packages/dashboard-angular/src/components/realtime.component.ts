import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from "@angular/core";
import type { RealtimeResponse } from "../types";
import { formatInt } from "../format";
import { WBX_CSS } from "../theme";

@Component({
  selector: "wb-realtime",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-part="realtime">
      <div data-wbx-title>LIVE VISITORS</div>
      <div style="display: flex; align-items: baseline; gap: 12px;">
        <span data-wbx-pulse aria-hidden="true"></span>
        <span data-wbx-value>{{ online }}</span>
        <span data-wbx-subtle>online now</span>
      </div>

      <div *ngIf="topPages.length > 0" style="margin-top: 20px;">
        <div data-wbx-title style="margin-bottom: 8px;">ACTIVE PAGES</div>
        <div *ngFor="let p of topPages" data-wbx-row>
          <span
            [title]="p.path"
            style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;"
          >
            {{ p.path || "/" }}
          </span>
          <strong style="font-variant-numeric: tabular-nums;">{{ fmt(p.visitors) }}</strong>
        </div>
      </div>

      <div *ngIf="showRecent && data.recent.length > 0" style="margin-top: 20px;">
        <div data-wbx-title style="margin-bottom: 8px;">RECENT</div>
        <div *ngFor="let r of data.recent | slice:0:8" data-wbx-row>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">
            {{ r.path || "/" }}
          </span>
          <span data-wbx-subtle>{{ r.country_code }} {{ r.device }}</span>
        </div>
      </div>
    </div>
  `,
})
export class RealtimeComponent {
  /** Response from `client.realtime()`. */
  @Input({ required: true }) data!: RealtimeResponse;

  /** Limit the "active pages" list (default 5). */
  @Input() topPagesLimit = 5;

  /** Show the scrolling recent feed below the counter. */
  @Input() showRecent = true;

  get online() {
    return formatInt(this.data.online);
  }

  get topPages() {
    return this.data.top_pages.slice(0, this.topPagesLimit);
  }

  fmt(n: number) {
    return formatInt(n);
  }
}
