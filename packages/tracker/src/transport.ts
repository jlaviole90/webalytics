import type { CollectPayload, Transport } from "./types.js";

// Default transport. Uses navigator.sendBeacon on pagehide (keepalive across
// tab close) and fetch({ keepalive: true }) otherwise. Failures are swallowed
// — we never want the tracker to throw into application code.
export function createDefaultTransport(debug = false): Transport {
  const pending = new Set<Promise<void>>();

  function track<T>(p: Promise<T>): Promise<T> {
    const wrapped = p
      .then(() => {
        // no-op
      })
      .catch((err) => {
        if (debug) console.debug("[webalytics] transport error", err);
      });
    pending.add(wrapped);
    wrapped.finally(() => pending.delete(wrapped));
    return p;
  }

  function send(host: string, events: CollectPayload[], unload: boolean): void {
    if (events.length === 0) return;
    const url = `${host}/collect`;
    // The /collect endpoint accepts one event per request today, so we emit
    // one POST per event. This keeps the server contract simple; a bulk
    // variant can be added server-side later without breaking the wire.
    for (const ev of events) {
      const body = JSON.stringify(ev);
      if (unload && typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(url, blob);
          continue;
        } catch (err) {
          if (debug) console.debug("[webalytics] sendBeacon threw", err);
        }
      }
      if (typeof fetch !== "undefined") {
        track(
          fetch(url, {
            method: "POST",
            body,
            keepalive: true,
            mode: "cors",
            credentials: "omit",
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
  }

  async function flush(): Promise<void> {
    await Promise.all([...pending]);
  }

  return { send, flush };
}
