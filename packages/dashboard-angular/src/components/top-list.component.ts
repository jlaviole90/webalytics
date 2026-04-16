import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input, ViewEncapsulation } from "@angular/core";
import type { BreakdownResponse, DimensionName } from "../types";
import { countryFlag, formatInt, formatPct } from "../format";
import { WBX_CSS } from "../theme";

@Component({
  selector: "wb-top-list",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-part="top-list" [attr.data-wbx-dimension]="data.dimension">
      <div style="display: flex; justify-content: space-between; align-items: baseline;">
        <div data-wbx-title>{{ resolvedTitle }}</div>
        <div data-wbx-subtle>{{ totalFmt }}</div>
      </div>
      <div *ngIf="data.results.length === 0; else list"
           data-wbx-subtle
           style="padding: 24px 0; text-align: center;">
        No data yet.
      </div>
      <ng-template #list>
        <div style="margin-top: 8px;">
          <div *ngFor="let r of data.results" data-wbx-row>
            <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
              <div data-wbx-bar-track aria-hidden="true">
                <div data-wbx-bar-fill [style.width.%]="pct(r.share)"></div>
              </div>
              <span
                [title]="r.key || '(unknown)'"
                style="margin-left: -8px; padding-left: 8px; position: relative; z-index: 1;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%;"
              >
                <span *ngIf="data.dimension === 'country'" aria-hidden="true" style="margin-right: 6px;">
                  {{ flag(r.key) }}
                </span>
                {{ r.key || labelFallback }}
              </span>
            </div>
            <div style="display: flex; gap: 10px; align-items: baseline; font-variant-numeric: tabular-nums;">
              <strong>{{ fmt(r.value) }}</strong>
              <span data-wbx-subtle>{{ fmtPct(r.share) }}</span>
            </div>
          </div>
        </div>
      </ng-template>
    </div>
  `,
})
export class TopListComponent {
  /** Response from `client.breakdown(window, dimension)`. */
  @Input({ required: true }) data!: BreakdownResponse;

  /** Override the card title; defaults to a nice label per dimension. */
  @Input() title?: string;

  readonly labelFallback = "(direct / unknown)";

  get resolvedTitle(): string {
    return (this.title ?? this.defaultTitle(this.data.dimension)).toUpperCase();
  }

  get totalFmt() {
    return formatInt(this.data.total);
  }

  pct(share: number) {
    return Math.max(2, Math.min(100, share * 100));
  }

  fmt(n: number) {
    return formatInt(n);
  }
  fmtPct(n: number) {
    return formatPct(n);
  }
  flag(cc: string) {
    return countryFlag(cc);
  }

  private defaultTitle(d: DimensionName): string {
    switch (d) {
      case "path":
        return "Top pages";
      case "hostname":
        return "Top hostnames";
      case "referrer_host":
        return "Top referrers";
      case "country":
        return "Top countries";
      case "device":
        return "Devices";
      case "browser":
        return "Browsers";
      case "os":
        return "Operating systems";
      case "utm_source":
        return "UTM sources";
      case "utm_medium":
        return "UTM mediums";
      case "utm_campaign":
        return "UTM campaigns";
      case "event_name":
        return "Top events";
    }
  }
}
