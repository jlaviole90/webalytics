"use client";

import { useState } from "react";
import { getTracker } from "@webalytics/tracker-next";

export function TrackButton() {
  const [n, setN] = useState(0);

  function emit() {
    const count = n + 1;
    setN(count);
    getTracker().track("signup", { plan: "pro", count });
  }

  return (
    <button
      onClick={emit}
      data-testid="emit-signup"
      style={{
        padding: "10px 16px",
        borderRadius: 8,
        border: "1px solid #111",
        background: "#111",
        color: "#fff",
        cursor: "pointer",
        fontSize: 14,
      }}
    >
      Fire signup event (sent {n})
    </button>
  );
}
