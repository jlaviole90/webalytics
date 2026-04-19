"use client";

import { useState } from "react";
import { WindowPicker } from "@jlaviole90/dashboard-react";
import type { WindowSpec } from "@jlaviole90/dashboard-react";

export function WindowPickerDemo() {
  const [active, setActive] = useState<WindowSpec>("7d");
  const custom: WindowSpec = { from: "2025-01-01", to: "2025-01-31" };

  return (
    <div>
      <WindowPicker active={active} onChange={setActive} />
      <p style={{ fontSize: 12, color: "var(--wbx-fg-muted)", marginTop: 8 }}>
        Active: <code>{typeof active === "string" ? active : JSON.stringify(active)}</code>
      </p>
      <div style={{ marginTop: 16 }}>
        <WindowPicker active={custom} onChange={setActive} />
        <p style={{ fontSize: 12, color: "var(--wbx-fg-muted)", marginTop: 4 }}>
          ↑ custom range: no date label shown
        </p>
      </div>
    </div>
  );
}
