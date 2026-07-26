import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { environment } from "../../environments/environment";
import {
  compareInventoryItems,
  ExpiryStatus,
  getColumnSearchText,
  InventoryItem,
  normalizeFilterText,
  normalizeInventoryRow,
  PRODUCT_NAME_COLLATOR,
} from "../inventory-utils";
import { STATIC_DATA } from "../static-data";
import { RemoteDatasets, ResourceResponse, ShopInfo, UpharmaService } from "../upharma.service";

type LayoutMode = "left" | "top";
type N8nWorkflowKey = "expiry" | "inventory" | "report";
type ExpiryCardKey = ExpiryStatus | "all";

interface ExpirySummary {
  expired: number;
  danger: number;
  warning: number;
  safe: number;
  normal: number;
}

interface ShopCard {
  shopCode: string;
  shopName: string;
  label: string;
  count: number;
}

interface N8nWorkflow {
  label: string;
  title: string;
  description: string;
  result: string;
  steps: [string, string, string][];
}

interface InventoryCacheRecord {
  cacheKey: string;
  data: ResourceResponse;
  savedAt: number;
}

@Component({
  selector: "app-inventory",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./inventory.component.html",
})
export class InventoryComponent implements OnInit {
  readonly renderBatchSize = 200;
  readonly searchDebounceMs = 500;
  readonly expiryCards: { key: ExpiryCardKey; label: string; countKey?: keyof ExpirySummary }[] = [
    { key: "all", label: "Tất cả" },
    { key: "expired", label: "Hết hạn", countKey: "expired" },
    { key: "danger", label: "3 Tháng", countKey: "danger" },
    { key: "warning", label: "6 Tháng", countKey: "warning" },
    { key: "safe", label: "1 Năm", countKey: "safe" },
    { key: "normal", label: "Hàng bình thường", countKey: "normal" },
  ];
  readonly n8nWorkflows: Record<N8nWorkflowKey, N8nWorkflow> = {
    expiry: {
      label: "QUY TRÌNH MẪU 01",
      title: "Cảnh báo thuốc sắp hết hạn",
      description: "Tự động kiểm tra hạn dùng tại tất cả nhà thuốc và cảnh báo các lô còn không quá 90 ngày.",
      result: "Kết quả: quản lý nhận danh sách theo nhà thuốc, mã sản phẩm, số lô và hạn dùng.",
      steps: [
        ["Kích hoạt", "07:00 mỗi ngày", "Schedule Trigger"],
        ["Lấy dữ liệu", "Gọi API 3 nhà thuốc", "HTTP Request"],
        ["Xử lý", "Lọc hạn dùng ≤ 90 ngày", "Filter / Code"],
        ["Thông báo", "Gửi Email hoặc Zalo", "Email / Webhook"],
      ],
    },
    inventory: {
      label: "QUY TRÌNH MẪU 02",
      title: "Đồng bộ tồn kho nhiều nhà thuốc",
      description: "Gom tồn kho của mọi ShopCode thành một nguồn dữ liệu chung để tra cứu và làm báo cáo.",
      result: "Kết quả: dữ liệu tồn kho hợp nhất được cập nhật định kỳ mà không cần tải từng cửa hàng.",
      steps: [
        ["Kích hoạt", "Mỗi 30 phút", "Schedule Trigger"],
        ["Lặp cửa hàng", "Đọc danh sách ShopCode", "Loop Over Items"],
        ["Đồng bộ", "Gọi API và chuẩn hóa", "HTTP Request / Edit Fields"],
        ["Lưu dữ liệu", "Database hoặc Google Sheets", "Postgres / Sheets"],
      ],
    },
    report: {
      label: "QUY TRÌNH MẪU 03",
      title: "Gửi báo cáo cuối ngày",
      description: "Tổng hợp đơn hàng, doanh thu và tồn kho vào cuối ca rồi gửi cho người quản lý.",
      result: "Kết quả: báo cáo cuối ngày được gửi đúng giờ, cùng một định dạng cho tất cả nhà thuốc.",
      steps: [
        ["Kích hoạt", "21:30 mỗi ngày", "Schedule Trigger"],
        ["Thu thập", "Đơn hàng và tồn kho", "HTTP Request"],
        ["Tổng hợp", "Tính chỉ số theo cửa hàng", "Aggregate / Code"],
        ["Gửi báo cáo", "Email cho quản lý", "Email"],
      ],
    },
  };

  layoutMode: LayoutMode = "left";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  filtersCollapsed = true;
  logoutConfirmOpen = false;
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: true,
    test: false,
    n8n: false,
  };
  loadingTitle = "";
  inventoryCacheStatus = "Đang chuẩn bị dữ liệu tồn kho...";
  inventoryRefreshProgress = 5;
  inventoryRefreshing = true;
  activeN8nWorkflowKey: N8nWorkflowKey = "expiry";
  n8nDialogOpen = false;
  userTitle = "Đang tải người dùng...";
  brandShopText = "ĐANG TẢI";
  shopList: ShopInfo[] = [];
  activeShopCode = "";
  normalizedRows: InventoryItem[] = [];
  filteredRows: InventoryItem[] = [];
  displayedRows: InventoryItem[] = [];
  visibleLimit = this.renderBatchSize;
  isAppendingRows = false;
  expirySummary: ExpirySummary = {
    expired: 0,
    danger: 0,
    warning: 0,
    safe: 0,
    normal: 0,
  };
  columnFilters: Record<string, string> = {
    productName: "",
    productCode: "",
    shop: "",
    price: "",
    lot: "",
    expiryStatus: "",
    quantity: "",
    unit: "",
    vat: "",
  };
  remoteDatasets: RemoteDatasets = {};

  private filterTimer: ReturnType<typeof setTimeout> | null = null;
  private loadingTasks = new Map<string, string>();

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.layoutMode = this.getStoredLayoutMode();
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";

    if (environment.apiEnabled) {
      void this.loadInventory();
    } else {
      this.loadStaticInventory();
    }
  }

  get appClasses(): Record<string, boolean> {
    return {
      "layout-left": this.layoutMode === "left",
      "layout-top": this.layoutMode === "top",
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get activeN8nWorkflow(): N8nWorkflow {
    return this.n8nWorkflows[this.activeN8nWorkflowKey];
  }

  get mobileFilterSummary(): string {
    const activeColumnFilters = Object.values(this.columnFilters).filter((value) => value.trim()).length;
    const activeFilterCount = activeColumnFilters + (this.activeShopCode ? 1 : 0);

    return activeFilterCount > 0 ? `${activeFilterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";
  }

  get loadingProgressPercent(): number {
    if (this.inventoryRefreshProgress > 0) {
      return this.inventoryRefreshProgress;
    }

    return this.isLoading ? 60 : 0;
  }

  get activeExpiryTotal(): number {
    return Object.values(this.expirySummary).reduce((sum, count) => sum + count, 0);
  }

  get shopCards(): ShopCard[] {
    const shopCounts = this.normalizedRows.reduce((counts, row) => {
      counts.set(row.shopCode, (counts.get(row.shopCode) || 0) + 1);
      return counts;
    }, new Map<string, number>());

    return [
      {
        shopCode: "",
        shopName: `${this.shopList.length} nhà thuốc`,
        label: "Tất cả nhà thuốc",
        count: this.normalizedRows.length,
      },
      ...this.shopList.map((shop) => ({
        shopCode: shop.ShopCode,
        shopName: shop.ShopName,
        label: shop.ShopCode,
        count: shopCounts.get(shop.ShopCode) || 0,
      })),
    ];
  }

  get isLoading(): boolean {
    return this.loadingTasks.size > 0;
  }

  async loadInventory(): Promise<void> {
    try {
      const sessionData = this.upharmaService.ensureLogin();
      this.shopList = this.upharmaService.getActiveShops();

      const cacheKey = this.getInventoryCacheKey(sessionData.UserInfo.uPharmaID);
      const cachedInventory = await this.readInventoryCache(cacheKey);

      if (cachedInventory) {
        this.applyInventoryData(cachedInventory.data);
        this.inventoryCacheStatus = `Đang hiển thị dữ liệu đã lưu lúc ${this.formatCacheTime(cachedInventory.savedAt)}. Hệ thống đang cập nhật dữ liệu mới...`;
        this.inventoryRefreshing = true;
        this.inventoryRefreshProgress = 30;
        void this.refreshInventoryFromApi(cacheKey, true);
        return;
      }

      await this.refreshInventoryFromApi(cacheKey, false);
    } catch (error) {
      console.error("Không thể tải dữ liệu tồn kho:", error);
      this.loadStaticInventory();
    }
  }

  setLayoutMode(mode: string): void {
    const nextMode: LayoutMode = mode === "top" ? "top" : "left";
    this.startLoading("layout", "Đang đổi layout");
    this.layoutMode = nextMode;
    localStorage.setItem("upharma_layout_mode", nextMode);
    window.setTimeout(() => this.stopLoading("layout"), 120);
  }

  toggleSidebar(): void {
    if (window.matchMedia("(max-width: 900px)").matches) {
      this.sidebarCollapsed = false;
      this.mobileMenuOpen = !this.mobileMenuOpen;
      return;
    }

    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem("upharma_sidebar_collapsed", String(this.sidebarCollapsed));
  }

  toggleMenuGroup(groupKey: string): void {
    this.menuGroups[groupKey] = !this.menuGroups[groupKey];
  }

  openLogoutConfirm(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.logoutConfirmOpen = true;
  }

  cancelLogout(): void {
    this.logoutConfirmOpen = false;
  }

  async confirmLogout(): Promise<void> {
    this.upharmaService.clearSession();
    await this.router.navigateByUrl("/login");
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  onColumnFilterInput(key: string): void {
    if (key === "shop" && this.activeShopCode) {
      this.activeShopCode = "";
      this.updateExpiryDashboard();
    }

    this.queueFilter(this.searchDebounceMs);
  }

  onExpirySelectChange(): void {
    this.queueFilter(0);
  }

  toggleExpiryFilter(expiryStatus: ExpiryCardKey): void {
    this.columnFilters["expiryStatus"] =
      expiryStatus === "all" || this.columnFilters["expiryStatus"] === expiryStatus ? "" : expiryStatus;
    this.recomputeFilteredRows();
  }

  applyShopFilter(shopCode: string): void {
    this.columnFilters["shop"] = "";
    this.activeShopCode = shopCode && shopCode === this.activeShopCode ? "" : shopCode;
    this.recomputeAll();
  }

  toggleRecord(row: InventoryItem): void {
    row.expanded = !row.expanded;
  }

  openN8nExample(workflowKey: N8nWorkflowKey, event?: Event): void {
    event?.preventDefault();
    this.activeN8nWorkflowKey = workflowKey;
    this.n8nDialogOpen = true;
  }

  closeN8nDialog(): void {
    this.n8nDialogOpen = false;
  }

  loadMoreRows(): void {
    if (this.isAppendingRows || this.displayedRows.length >= this.filteredRows.length) {
      return;
    }

    this.isAppendingRows = true;
    window.setTimeout(() => {
      this.visibleLimit += this.renderBatchSize;
      this.updateDisplayedRows();
      this.isAppendingRows = false;
    }, 1000);
  }

  onTableScroll(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    if (distanceToBottom < 120) {
      this.loadMoreRows();
    }
  }

  trackByInventory(_: number, row: InventoryItem): string {
    return row.rowKey;
  }

  trackByShop(_: number, shop: ShopCard): string {
    return shop.shopCode || "all";
  }

  private loadStaticInventory(): void {
    this.activeShopCode = "";
    this.shopList = STATIC_DATA.shops
      .filter((shop) => !environment.excludedShopCodes.includes(shop.ShopCode))
      .sort((firstShop, secondShop) => PRODUCT_NAME_COLLATOR.compare(firstShop.ShopCode, secondShop.ShopCode));
    const shopMap = new Map(this.shopList.map((shop) => [shop.ShopCode, shop]));
    const rawRows = STATIC_DATA.inventory
      .filter((item) => shopMap.has(item.ShopCode))
      .map((item) => ({
        ...item,
        __shopCode: item.ShopCode,
        __shopName: shopMap.get(item.ShopCode)?.ShopName || item.ShopCode,
      }));

    this.normalizedRows = rawRows.map((row, index) => normalizeInventoryRow(row, index)).sort(compareInventoryItems);
    this.userTitle = `${STATIC_DATA.user.FullName} (ID - ${STATIC_DATA.user.uPharmaID}) - ${this.shopList.length} nhà thuốc`;
    this.brandShopText = `${this.shopList.length} NHÀ THUỐC`;
    this.inventoryCacheStatus = "Đang hiển thị dữ liệu mẫu vì API chưa tải được.";
    this.inventoryRefreshing = false;
    this.inventoryRefreshProgress = 0;
    this.recomputeAll();
  }

  private async refreshInventoryFromApi(cacheKey: string, runInBackground: boolean): Promise<void> {
    if (runInBackground) {
      this.inventoryCacheStatus = this.inventoryCacheStatus || "Đang cập nhật dữ liệu tồn kho mới...";
      this.inventoryRefreshing = true;
      this.inventoryRefreshProgress = Math.max(this.inventoryRefreshProgress, 30);
    } else {
      this.startLoading("inventory", "Đang lấy dữ liệu tồn kho...");
      this.inventoryCacheStatus = "";
      this.inventoryRefreshing = true;
      this.inventoryRefreshProgress = 15;
    }

    try {
      this.inventoryRefreshProgress = Math.max(this.inventoryRefreshProgress, 65);
      const inventoryData = await this.upharmaService.loadInventoryResource({ forceRefresh: true });
      this.applyInventoryData(inventoryData);
      await this.writeInventoryCache({
        cacheKey,
        data: inventoryData,
        savedAt: Date.now(),
      });
      this.inventoryRefreshing = false;
      this.inventoryRefreshProgress = 100;
      this.inventoryCacheStatus = `Dữ liệu tồn kho đã cập nhật lúc ${this.formatCacheTime(Date.now())}.`;

      const failedShops = Object.values(this.remoteDatasets).flatMap((resource) => resource?.failedShops || []);
      if (failedShops.length) {
        console.warn("Một số API nhà thuốc tải thất bại:", failedShops);
      }
    } catch (error) {
      console.error("Không thể cập nhật dữ liệu tồn kho:", error);

      if (this.normalizedRows.length === 0) {
        this.loadStaticInventory();
        return;
      }

      this.inventoryRefreshing = false;
      this.inventoryRefreshProgress = 100;
      this.inventoryCacheStatus = "Chưa cập nhật được dữ liệu mới, vẫn đang hiển thị dữ liệu đã lưu.";
    } finally {
      if (!runInBackground) {
        this.stopLoading("inventory");
      }
    }
  }

  private applyInventoryData(inventoryData: ResourceResponse): void {
    this.remoteDatasets = {
      inventory: inventoryData,
    };

    const shopMap = new Map(this.shopList.map((shop) => [shop.ShopCode, shop]));
    const rawRows = (inventoryData.data || [])
      .filter((row) => shopMap.has(String(row["__shopCode"] || row["ShopCode"] || "")))
      .map((row) => {
        const shopCode = String(row["__shopCode"] || row["ShopCode"] || "");
        const shop = shopMap.get(shopCode);

        return {
          ...row,
          __shopCode: shopCode,
          __shopName: String(row["__shopName"] || shop?.ShopName || shopCode),
        };
      });

    this.normalizedRows = rawRows.map((row, index) => normalizeInventoryRow(row, index)).sort(compareInventoryItems);
    this.activeShopCode = this.shopList.some((shop) => shop.ShopCode === this.activeShopCode) ? this.activeShopCode : "";
    this.userTitle = `${inventoryData.user.FullName} (ID - ${inventoryData.user.uPharmaID}) - ${this.shopList.length} nhà thuốc`;
    this.brandShopText = `${this.shopList.length} NHÀ THUỐC`;
    this.recomputeAll();
  }

  private getInventoryCacheKey(userId: number): string {
    const shopCodes = this.shopList.map((shop) => shop.ShopCode).join(",");

    return `inventory:${userId}:${shopCodes}:v1`;
  }

  private async readInventoryCache(cacheKey: string): Promise<InventoryCacheRecord | null> {
    try {
      const db = await this.openInventoryCacheDb();

      return await new Promise<InventoryCacheRecord | null>((resolve, reject) => {
        const transaction = db.transaction("inventory", "readonly");
        const request = transaction.objectStore("inventory").get(cacheKey);

        request.onsuccess = () => resolve((request.result as InventoryCacheRecord | undefined) || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("Không đọc được cache tồn kho:", error);
      return null;
    }
  }

  private async writeInventoryCache(record: InventoryCacheRecord): Promise<void> {
    try {
      const db = await this.openInventoryCacheDb();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("inventory", "readwrite");
        const request = transaction.objectStore("inventory").put(record);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("Không lưu được cache tồn kho:", error);
    }
  }

  private openInventoryCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-cache", 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("inventory")) {
          db.createObjectStore("inventory", { keyPath: "cacheKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private formatCacheTime(timestamp: number): string {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(timestamp));
  }

  private recomputeAll(): void {
    this.updateExpiryDashboard();
    this.recomputeFilteredRows();
  }

  private updateExpiryDashboard(): void {
    const rowsForSummary = this.normalizedRows.filter((item) => !this.activeShopCode || item.shopCode === this.activeShopCode);
    this.expirySummary = rowsForSummary.reduce(
      (counts, item) => {
        counts[item.expiryStatus] += 1;
        return counts;
      },
      {
        expired: 0,
        danger: 0,
        warning: 0,
        safe: 0,
        normal: 0,
      },
    );
  }

  private recomputeFilteredRows(): void {
    const filters = Object.entries(this.columnFilters)
      .map(([key, value]) => [key, normalizeFilterText(value)] as const)
      .filter(([, value]) => value);

    this.visibleLimit = this.renderBatchSize;
    this.isAppendingRows = false;
    const hasActiveShop = Boolean(this.activeShopCode);
    const activeShopCode = this.activeShopCode;

    this.filteredRows = this.normalizedRows.filter((item) => {
      if (hasActiveShop && item.shopCode !== activeShopCode) {
        return false;
      }

      for (const [key, value] of filters) {
        if (!getColumnSearchText(item, key).includes(value)) {
          return false;
        }
      }

      return true;
    });
    this.updateDisplayedRows();
  }

  private updateDisplayedRows(): void {
    this.displayedRows = this.filteredRows.slice(0, this.visibleLimit);
  }

  private queueFilter(delay = this.searchDebounceMs): void {
    if (this.filterTimer) {
      clearTimeout(this.filterTimer);
    }

    this.filterTimer = setTimeout(() => {
      this.recomputeFilteredRows();
      this.filterTimer = null;
    }, delay);
  }

  private startLoading(taskId: string, title: string): void {
    this.loadingTasks.set(taskId, title);
    this.loadingTitle = title;
  }

  private stopLoading(taskId: string): void {
    this.loadingTasks.delete(taskId);
    const titles = Array.from(this.loadingTasks.values());
    this.loadingTitle = titles[titles.length - 1] || "";
  }

  private getStoredLayoutMode(): LayoutMode {
    return localStorage.getItem("upharma_layout_mode") === "top" ? "top" : "left";
  }
}
