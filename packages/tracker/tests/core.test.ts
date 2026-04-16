import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../src/core.js";
import type { CollectPayload, Transport } from "../src/types.js";

type Sent = { host: string; events: CollectPayload[]; unload: boolean };

function makeRecordingTransport(): { t: Transport; sent: Sent[] } {
  const sent: Sent[] = [];
  const t: Transport = {
    send(host, events, unload) {
      sent.push({ host, events: events.map((e) => ({ ...e })), unload });
    },
    async flush() {},
  };
  return { t, sent };
}

describe("tracker core", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/");
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("init fires an auto pageview", async () => {
    const { t, sent } = makeRecordingTransport();
    init({
      siteId: "wb_live_abcdefghij012345",
      host: "http://api.test",
      autoWebVitals: false,
      transport: t,
    });
    // auto pageview is enqueued in a microtask, then batched 250ms later.
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
    expect(sent[0].events[0].event).toBe("pageview");
    expect(sent[0].events[0].site_id).toBe("wb_live_abcdefghij012345");
  });

  it("track() batches events within the flush window", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "wb_live_site",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      transport: t,
    });
    tracker.track("signup", { plan: "pro" });
    tracker.track("click", { id: "cta" });
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
    expect(sent[0].events).toHaveLength(2);
    expect(sent[0].events[0].event).toBe("signup");
    expect(sent[0].events[0].props).toEqual({ plan: "pro" });
    expect(sent[0].events[1].event).toBe("click");
  });

  it("flush() drains the buffer synchronously on the transport", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      transport: t,
    });
    tracker.track("a");
    await tracker.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].events[0].event).toBe("a");
  });

  it("respects DNT when respectDNT is on (default)", async () => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoWebVitals: false,
      transport: t,
    });
    tracker.track("dropped");
    await Promise.resolve();
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(0);
  });

  it("ignores DNT when respectDNT is false", async () => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      respectDNT: false,
      transport: t,
    });
    tracker.track("kept");
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
  });

  it("excludePaths (string prefix + RegExp) suppresses events", async () => {
    // happy-dom's history.replaceState doesn't reliably update location
    // across all supported browser features, so we drive path via an
    // injected Location shim instead.
    let current = new URL("http://localhost/admin/foo");
    const locShim = {
      get pathname() {
        return current.pathname;
      },
      get search() {
        return current.search;
      },
      get href() {
        return current.href;
      },
      get host() {
        return current.host;
      },
    } as unknown as Location;

    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      excludePaths: ["/admin", /^\/debug/],
      transport: t,
      _location: locShim,
    });
    tracker.track("from-admin");
    current = new URL("http://localhost/debug/page");
    tracker.track("from-debug");
    current = new URL("http://localhost/ok");
    tracker.track("from-ok");
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
    expect(sent[0].events.map((e) => e.event)).toEqual(["from-ok"]);
  });

  it("setEnabled(false) suppresses events; true re-enables", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      transport: t,
    });
    tracker.setEnabled(false);
    tracker.track("dropped");
    tracker.setEnabled(true);
    tracker.track("kept");
    vi.advanceTimersByTime(300);
    expect(sent).toHaveLength(1);
    expect(sent[0].events[0].event).toBe("kept");
  });

  it("strips trailing slashes from host", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test///",
      autoPageviews: false,
      autoWebVitals: false,
      transport: t,
    });
    tracker.track("x");
    vi.advanceTimersByTime(300);
    expect(sent[0].host).toBe("http://api.test");
  });

  it("patches history.pushState with a wrapper that preserves the return value", async () => {
    const { t } = makeRecordingTransport();
    const original = history.pushState;
    init({
      siteId: "s",
      host: "http://api.test",
      autoWebVitals: false,
      transport: t,
    });
    // Patch must have replaced the function (the URL-change dispatch itself
    // is covered by the Playwright e2e — happy-dom doesn't update
    // location.pathname on pushState, so we can't test the effect here).
    expect(history.pushState).not.toBe(original);
    expect(() => history.pushState(null, "", "/new-page")).not.toThrow();
  });

  it("includes environment and release fields when configured", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      environment: "staging",
      release: "abc123",
      transport: t,
    });
    tracker.track("x");
    vi.advanceTimersByTime(300);
    expect(sent[0].events[0].environment).toBe("staging");
    expect(sent[0].events[0].release).toBe("abc123");
  });

  it("route hook result lands on the payload", async () => {
    const { t, sent } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      route: () => "/posts/[slug]",
      transport: t,
    });
    tracker.track("view");
    vi.advanceTimersByTime(300);
    expect(sent[0].events[0].route).toBe("/posts/[slug]");
  });

  it("identify is a safe no-op in cookieless mode", () => {
    const { t } = makeRecordingTransport();
    const tracker = init({
      siteId: "s",
      host: "http://api.test",
      autoPageviews: false,
      autoWebVitals: false,
      transport: t,
    });
    expect(() => tracker.identify({ email: "a@b.com" })).not.toThrow();
  });
});
