import { Injectable } from "@angular/core";
import { BehaviorSubject } from "rxjs";

export interface OpenTab {
  /** Router path, e.g. "/ton-kho" */
  path: string;
  /** Short display title, e.g. "Tồn kho" */
  title: string;
  /** Tabler icon class, e.g. "ti ti-box" */
  icon: string;
}

/**
 * Lightweight tab navigation state.
 *
 * Design: tabs are UI-level only (no RouteReuseStrategy). Switching tabs is a
 * normal router navigation; components rebuild from already-cached service
 * data (~100-200ms, no API refetch), so memory stays flat while the UX feels
 * like persistent tabs. Per-tab scroll position is saved/restored.
 */
@Injectable({ providedIn: "root" })
export class TabStateService {
  /** Maximum open tabs — oldest inactive tab is evicted (LRU). */
  readonly maxTabs = 10;

  private readonly tabsSubject = new BehaviorSubject<OpenTab[]>([]);
  readonly tabs$ = this.tabsSubject.asObservable();

  private readonly activePathSubject = new BehaviorSubject<string>("");
  readonly activePath$ = this.activePathSubject.asObservable();

  /** Scroll position per tab path. */
  private readonly scrollPositions = new Map<string, number>();

  private static readonly ICONS: Record<string, string> = {
    "/dashboard": "ti ti-home",
    "/xuat-bao-cao": "ti ti-file-export",
    "/ton-kho": "ti ti-box",
    "/ton-kho-new": "ti ti-box",
    "/fefo": "ti ti-calendar-time",
    "/profile": "ti ti-user",
    "/lay-bao-cao-don-hang": "ti ti-receipt",
    "/chi-tieu-nhan-vien": "ti ti-users",
    "/chi-tieu-nha-thuoc-trong-nam": "ti ti-building-store",
    "/out-of-stock": "ti ti-alert-triangle",
    "/hang-da-het": "ti ti-alert-triangle",
    "/hang-lap-tot": "ti ti-trending-up",
    "/hang-key": "ti ti-key",
    "/goi-y-chuyen-hang": "ti ti-arrows-exchange",
    "/ton-kho-toan-quoc": "ti ti-world",
    "/cronjob": "ti ti-refresh",
  };

  private static readonly TITLES: Record<string, string> = {
    "/dashboard": "Bảng điều khiển",
    "/xuat-bao-cao": "Báo cáo vận hành",
    "/ton-kho": "Tồn kho",
    "/ton-kho-new": "Tồn kho mới",
    "/fefo": "Kiểm tra FEFO",
    "/profile": "Thông tin cá nhân",
    "/lay-bao-cao-don-hang": "Báo cáo đơn hàng",
    "/chi-tieu-nhan-vien": "Chỉ tiêu nhân viên",
    "/chi-tieu-nha-thuoc-trong-nam": "Chỉ tiêu nhà thuốc",
    "/out-of-stock": "Hàng đã hết",
    "/hang-da-het": "Hàng đã hết",
    "/hang-lap-tot": "Hàng lặp tốt",
    "/hang-key": "Hàng key",
    "/goi-y-chuyen-hang": "Gợi ý chuyển hàng",
    "/ton-kho-toan-quoc": "Tồn kho toàn quốc",
    "/cronjob": "Đồng bộ dữ liệu",
  };

  /** Paths that should never become tabs (auth, errors). */
  private static readonly EXCLUDED = new Set(["/login"]);

  get tabs(): OpenTab[] {
    return this.tabsSubject.value;
  }

  get activePath(): string {
    return this.activePathSubject.value;
  }

  /** Normalize a URL to a tab path (strip query string / fragment). */
  static normalizePath(url: string): string {
    return (url || "/").split("?")[0].split("#")[0] || "/";
  }

  /** Register (or activate) a tab for the given URL. No-op for excluded paths. */
  openTab(url: string): void {
    const path = TabStateService.normalizePath(url);
    if (TabStateService.EXCLUDED.has(path) || path === "/") return;

    const tabs = [...this.tabsSubject.value];
    const existingIdx = tabs.findIndex((t) => t.path === path);
    if (existingIdx >= 0) {
      // Move to end (most recently used)
      const [existing] = tabs.splice(existingIdx, 1);
      tabs.push(existing);
    } else {
      tabs.push({
        path,
        title: TabStateService.TITLES[path] ?? this.titleFromPath(path),
        icon: TabStateService.ICONS[path] ?? "ti ti-file",
      });
      // LRU eviction
      while (tabs.length > this.maxTabs) tabs.shift();
    }
    this.tabsSubject.next(tabs);
    this.activePathSubject.next(path);
  }

  /** Mark a tab active without reordering (used on init). */
  setActive(path: string): void {
    this.activePathSubject.next(TabStateService.normalizePath(path));
  }

  /**
   * Close a tab. Returns the path to navigate to afterwards
   * (neighbor tab, or "/dashboard" when none remain).
   */
  closeTab(path: string): string {
    const tabs = this.tabsSubject.value.filter((t) => t.path !== path);
    this.scrollPositions.delete(path);
    this.tabsSubject.next(tabs);
    if (this.activePathSubject.value === path) {
      const fallback = tabs.length > 0 ? tabs[tabs.length - 1].path : "/dashboard";
      this.activePathSubject.next(fallback);
      return fallback;
    }
    return this.activePathSubject.value;
  }

  /** Close all tabs except the active one. */
  closeOthers(path: string): void {
    const keep = this.tabsSubject.value.find((t) => t.path === path);
    this.tabsSubject.next(keep ? [keep] : []);
  }

  /** Remember scroll position for a tab path. */
  saveScroll(path: string, y: number): void {
    this.scrollPositions.set(TabStateService.normalizePath(path), y);
  }

  /** Get saved scroll position for a tab path (0 when unknown). */
  getScroll(path: string): number {
    return this.scrollPositions.get(TabStateService.normalizePath(path)) ?? 0;
  }

  private titleFromPath(path: string): string {
    const seg = path.split("/").filter(Boolean).pop() ?? path;
    return seg.replace(/-/g, " ");
  }
}
