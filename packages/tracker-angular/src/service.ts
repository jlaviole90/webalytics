import { DestroyRef, Injectable, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs/operators";
import { init as coreInit, type Tracker } from "@jlaviole90/tracker";
import { WEBALYTICS_CONFIG, type WebalyticsAngularConfig } from "./config";

/**
 * Injectable wrapper around `@jlaviole90/tracker`. Provides a stable
 * surface for Angular apps to track pageviews and custom events
 * without having to manage the tracker singleton themselves.
 *
 * All dependencies are pulled via `inject()` (Angular 14+ functional
 * injection) instead of constructor params, which means this library
 * works fine without `emitDecoratorMetadata` at consumer-build time.
 */
@Injectable({ providedIn: "root" })
export class WebalyticsService {
  // Using inject() instead of constructor injection means we don't
  // need reflect-metadata or @swc-emitted decorator metadata in the
  // shipped JS. Better forward-compat with Angular's zoneless runtime.
  private readonly config = inject(WEBALYTICS_CONFIG);
  private readonly router = inject(Router, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private tracker: Tracker | null = null;

  constructor() {
    if (!this.config.manualInit) {
      this.init();
    }
  }

  /** Initialize the underlying tracker. Subsequent calls are no-ops. */
  init(overrides: Partial<WebalyticsAngularConfig> = {}): Tracker {
    if (this.tracker) return this.tracker;

    const merged: WebalyticsAngularConfig = { ...this.config, ...overrides };

    // If Angular Router is installed, disable the core's History API
    // hook; Router NavigationEnd is more accurate for SPAs (respects
    // guards, lazy routes, etc.)
    const trackRouter =
      merged.trackRouterNavigation !== false && this.router != null;
    if (trackRouter) {
      merged.autoPageviews = false;
    }

    this.tracker = coreInit(merged);

    if (trackRouter && this.router) {
      this.router.events
        .pipe(
          filter((e): e is NavigationEnd => e instanceof NavigationEnd),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => {
          this.tracker?.pageview();
        });
    }

    return this.tracker;
  }

  /** Fire a custom event. No-op if `init()` hasn't completed yet. */
  track(eventName: string, props?: Record<string, unknown>): void {
    this.tracker?.track(eventName, props);
  }

  /** Fire a pageview. Useful for manually-tracked virtual screens. */
  pageview(url?: string): void {
    this.tracker?.pageview(url);
  }

  /** Identify a user. Cookieless mode no-ops this; see tracker README. */
  identify(traits: Record<string, unknown>): void {
    this.tracker?.identify(traits);
  }

  /** Toggle tracking at runtime — wire this to your consent banner. */
  setEnabled(enabled: boolean): void {
    this.tracker?.setEnabled(enabled);
  }

  /** Force-flush pending events. Resolves when the network round-trip completes. */
  flush(): Promise<void> {
    return this.tracker ? this.tracker.flush() : Promise.resolve();
  }

  /** Low-level escape hatch to the raw Tracker. */
  raw(): Tracker | null {
    return this.tracker;
  }
}
