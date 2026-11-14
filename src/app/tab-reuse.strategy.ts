import { Injectable } from "@angular/core";
import {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  RouteReuseStrategy,
} from "@angular/router";

interface StoredHandle {
  handle: DetachedRouteHandle;
  lastUsed: number;
  /** When the tab was last detached (user navigated away from it). */
  detachedAt: number;
}

/** Away longer than this, a re-attached tab's data is considered stale. */
export const TAB_REATTACH_STALE_MS = 30 * 60 * 1000;

/**
 * Subscribes to "the user returned to this tab after a long absence".
 * The strategy dispatches a window event on re-attach when the tab was
 * away for more than TAB_REATTACH_STALE_MS; pages listen for their own
 * route path and soft-refresh, so retained tabs stop showing hours-old
 * data while short tab hops stay instant and fetch-free.
 * Returns the unsubscribe function (call it in ngOnDestroy).
 */
export function onTabReattach(path: string, callback: () => void): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ path?: string }>).detail;
    if (detail?.path === path) callback();
  };
  window.addEventListener("upharma:tab-reattach", handler);
  return () => window.removeEventListener("upharma:tab-reattach", handler);
}

/**
 * Keeps visited tab components alive instead of destroying them.
 *
 * Switching tabs re-attaches the cached component: instant (0ms), and all
 * UI state is preserved — filters, search text, pagination, scroll position.
 * Data is NOT refetched on re-attach (ngOnInit does not re-run); pages that
 * need fresh data already have their own refresh buttons / TTL logic.
 *
 * Memory is bounded: at most `maxTabs` detached components are kept, the
 * least-recently-used one is evicted. Tab order in the UI is unaffected.
 */
@Injectable()
export class TabReuseStrategy implements RouteReuseStrategy {
  /** Maximum cached tab components — oldest unused is evicted (LRU). */
  readonly maxTabs = 8;

  private readonly stored = new Map<string, StoredHandle>();

  /** Route paths (without leading slash) that must never be cached. */
  private static readonly EXCLUDED = new Set(["login"]);

  private keyOf(route: ActivatedRouteSnapshot): string {
    return route.pathFromRoot
      .map((s) => s.url.map((u) => u.path).join("/"))
      .filter(Boolean)
      .join("/");
  }

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    const key = this.keyOf(route);
    if (!key || TabReuseStrategy.EXCLUDED.has(key)) return false;
    return !!route.routeConfig;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = this.keyOf(route);
    if (!key || !handle) return;
    this.stored.set(key, { handle, lastUsed: Date.now(), detachedAt: Date.now() });
    while (this.stored.size > this.maxTabs) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      this.stored.forEach((v, k) => {
        if (v.lastUsed < oldest) {
          oldest = v.lastUsed;
          oldestKey = k;
        }
      });
      if (oldestKey === null) break;
      this.stored.delete(oldestKey);
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.keyOf(route);
    return !!key && this.stored.has(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.keyOf(route);
    const stored = key ? this.stored.get(key) : undefined;
    if (!stored) return null;
    stored.lastUsed = Date.now();
    if (Date.now() - stored.detachedAt > TAB_REATTACH_STALE_MS) {
      // Deferred so the component is attached before it reacts.
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("upharma:tab-reattach", { detail: { path: key } }),
        );
      }, 0);
    }
    return stored.handle;
  }

  shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    curr: ActivatedRouteSnapshot
  ): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  /** Drop the cached component for a tab path (call when the tab is closed). */
  clear(path: string): void {
    this.stored.delete(path.replace(/^\//, ""));
  }

  clearAll(): void {
    this.stored.clear();
  }
}
