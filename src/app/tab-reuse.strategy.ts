import { Injectable } from "@angular/core";
import {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  RouteReuseStrategy,
} from "@angular/router";

interface StoredHandle {
  handle: DetachedRouteHandle;
  lastUsed: number;
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
    this.stored.set(key, { handle, lastUsed: Date.now() });
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
