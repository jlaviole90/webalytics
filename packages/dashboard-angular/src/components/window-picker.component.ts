import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  ViewEncapsulation,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import type { WindowSpec } from "../types";
import { WBX_CSS } from "../theme";

const PRESETS: { label: string; value: WindowSpec }[] = [
  { label: "1H", value: "1h" },
  { label: "24H", value: "24h" },
  { label: "7D", value: "7d" },
  { label: "30D", value: "30d" },
  { label: "90D", value: "90d" },
];

@Component({
  selector: "wb-window-picker",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: [WBX_CSS],
  template: `
    <div data-wbx data-wbx-picker>
      <button
        *ngFor="let p of presets"
        type="button"
        [attr.data-active]="isActive(p.value)"
        (click)="pick(p.value)"
      >
        {{ p.label }}
      </button>
    </div>
  `,
})
export class WindowPickerComponent {
  @Input() active: WindowSpec = "7d";
  @Output() windowChange = new EventEmitter<WindowSpec>();

  readonly presets = PRESETS;

  isActive(v: WindowSpec): boolean {
    return v === this.active;
  }

  pick(v: WindowSpec): void {
    this.windowChange.emit(v);
  }
}
