import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { environment } from "../../environments/environment";
import {
  compareInventoryItems,
  ExpiryStatus,
  getColumnSearchText,
  InventoryItem,
  formatMoney,
  normalizeFilterText,
  normalizeInventoryRow,
  PRODUCT_NAME_COLLATOR,
  UNDER_12_MONTHS_DAYS,
  UNDER_3_MONTHS_DAYS,
  UNDER_6_MONTHS_DAYS,
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

interface ExpiryValueSummary {
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
  selector: "app-inventory-new",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./inventory-new.component.html",
})
export class InventoryNewComponent implements OnInit {
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
  currentPage = 1;
  pageSize = 20;

  get totalPages(): number {
    return Math.ceil(this.filteredRows.length / this.pageSize) || 1;
  }

  get pageNumbers(): number[] {
    const total = this.totalPages;
    const current = this.currentPage;
    const maxVisible = 5;
    
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + maxVisible - 1);
    
    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }
    
    const pages = [];
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  setPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updateDisplayedRows();
  }

  prevPage(): void {
    this.setPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.setPage(this.currentPage + 1);
  }

  isAppendingRows = false;
  expirySummary: ExpirySummary = {
    expired: 0,
    danger: 0,
    warning: 0,
    safe: 0,
    normal: 0,
  };
  expiryValueSummary: ExpiryValueSummary = {
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
    expiryStatus: "",
    quantity: "",
    unit: "",
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
    return this.countUniqueProducts(this.getRowsForActiveShop());
  }

  get activeInventoryValueLabel(): string {
    const selectedStatus = this.columnFilters["expiryStatus"] as ExpiryStatus | "";

    if (!selectedStatus) {
      return "";
    }

    const totalValue = this.expiryValueSummary[selectedStatus] || 0;
    return formatMoney(totalValue);
  }

  get totalInventoryValueLabel(): string {
    return formatMoney(this.getTotalInventoryValue());
  }

  get filteredInventoryValueLabel(): string {
    const totalValue = this.filteredRows.reduce(
      (sum, item) => sum + (Number(item.stockValue) || 0),
      0,
    );
    return formatMoney(totalValue);
  }

  getInventoryValueLabel(cardKey: ExpiryCardKey): string {
    if (cardKey === "all") {
      return this.totalInventoryValueLabel;
    }

    return formatMoney(this.expiryValueSummary[cardKey] || 0);
  }

  getInventoryRateLabel(cardKey: ExpiryCardKey): string {
    const totalValue = this.getTotalInventoryValue();
    const cardValue = cardKey === "all" ? totalValue : this.expiryValueSummary[cardKey] || 0;
    const rate = totalValue > 0 ? (cardValue / totalValue) * 100 : 0;

    return new Intl.NumberFormat("vi-VN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rate);
  }

  get shopCards(): ShopCard[] {
    const shopProducts = this.normalizedRows.reduce((productsByShop, row) => {
      const productCodes = productsByShop.get(row.shopCode) || new Set<string>();
      productCodes.add(this.getProductKey(row));
      productsByShop.set(row.shopCode, productCodes);
      return productsByShop;
    }, new Map<string, Set<string>>());

    return this.shopList.map((shop) => ({
      shopCode: shop.ShopCode,
      shopName: shop.ShopName,
      label: shop.ShopCode,
      count: shopProducts.get(shop.ShopCode)?.size || 0,
    }));
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
    this.activeShopCode = shopCode || this.activeShopCode || this.getDefaultShopCode();
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



  trackByInventory(_: number, row: InventoryItem): string {
    return row.rowKey;
  }

  trackByShop(_: number, shop: ShopCard): string {
    return shop.shopCode || "all";
  }

  private loadStaticInventory(): void {
    this.shopList = STATIC_DATA.shops
      .filter((shop) => !environment.excludedShopCodes.includes(shop.ShopCode))
      .sort((firstShop, secondShop) => PRODUCT_NAME_COLLATOR.compare(firstShop.ShopCode, secondShop.ShopCode));
    this.activeShopCode = this.getDefaultShopCode();
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
    this.activeShopCode = this.getDefaultShopCode();
    this.userTitle = `${inventoryData.user.FullName} (ID - ${inventoryData.user.uPharmaID}) - ${this.shopList.length} nhà thuốc`;
    this.brandShopText = `${this.shopList.length} NHÀ THUỐC`;
    this.recomputeAll();
  }

  private getDefaultShopCode(): string {
    if (this.shopList.some((shop) => shop.ShopCode === "SHOP0025")) {
      return "SHOP0025";
    }

    return this.shopList[0]?.ShopCode || "";
  }

  private getInventoryCacheKey(userId: number): string {
    const shopCodes = this.shopList.map((shop) => shop.ShopCode).join(",");

    return `inventory_new:${userId}:${shopCodes}:v1`;
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
    const rowsForSummary = this.getRowsForActiveShop();
    const productCodes: Record<keyof ExpirySummary, Set<string>> = {
      expired: new Set<string>(),
      danger: new Set<string>(),
      warning: new Set<string>(),
      safe: new Set<string>(),
      normal: new Set<string>(),
    };

    for (const item of rowsForSummary) {
      const days = item.expiryDaysRemaining;
      const productKey = this.getProductKey(item);

      if (days === null) {
        productCodes.normal.add(productKey);
        continue;
      }

      if (days < 0) {
        productCodes.expired.add(productKey);
      }

      if (days >= 0 && days <= UNDER_3_MONTHS_DAYS) {
        productCodes.danger.add(productKey);
      }

      if (days > UNDER_3_MONTHS_DAYS && days <= UNDER_6_MONTHS_DAYS) {
        productCodes.warning.add(productKey);
      }

      if (days >= 0 && days <= UNDER_12_MONTHS_DAYS) {
        productCodes.safe.add(productKey);
      }

      if (days > UNDER_12_MONTHS_DAYS) {
        productCodes.normal.add(productKey);
      }
    }

    this.expirySummary = {
      expired: productCodes.expired.size,
      danger: productCodes.danger.size,
      warning: productCodes.warning.size,
      safe: productCodes.safe.size,
      normal: productCodes.normal.size,
    };
    this.expiryValueSummary = rowsForSummary.reduce(
      (counts, item) => {
        const value = Number(item.stockValue) || 0;
        const days = item.expiryDaysRemaining;

        if (days === null) {
          counts.normal += value;
          return counts;
        }

        if (days < 0) {
          counts.expired += value;
        }

        if (days >= 0 && days <= UNDER_3_MONTHS_DAYS) {
          counts.danger += value;
        }

        if (days > UNDER_3_MONTHS_DAYS && days <= UNDER_6_MONTHS_DAYS) {
          counts.warning += value;
        }

        if (days >= 0 && days <= UNDER_12_MONTHS_DAYS) {
          counts.safe += value;
        }

        if (days > UNDER_12_MONTHS_DAYS) {
          counts.normal += value;
        }

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

    this.currentPage = 1;
    this.isAppendingRows = false;
    const hasActiveShop = Boolean(this.activeShopCode);
    const activeShopCode = this.activeShopCode;

    this.filteredRows = this.normalizedRows.filter((item) => {
      if (hasActiveShop && item.shopCode !== activeShopCode) {
        return false;
      }

      for (const [key, value] of filters) {
        if (key === "expiryStatus") {
          if (!this.matchesExpiryRange(item, value)) {
            return false;
          }

          continue;
        }

        if (!getColumnSearchText(item, key).includes(value)) {
          return false;
        }
      }

      return true;
    });
    this.updateDisplayedRows();
  }

  private updateDisplayedRows(): void {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.displayedRows = this.filteredRows.slice(start, end);
  }

  private getRowsForActiveShop(): InventoryItem[] {
    return this.normalizedRows.filter((item) => !this.activeShopCode || item.shopCode === this.activeShopCode);
  }

  private getTotalInventoryValue(): number {
    return this.getRowsForActiveShop().reduce(
      (sum, item) => sum + (Number(item.stockValue) || 0),
      0,
    );
  }

  private countUniqueProducts(items: InventoryItem[]): number {
    return new Set(items.map((item) => this.getProductKey(item))).size;
  }

  private getProductKey(item: InventoryItem): string {
    return item.productCode.trim() || item.rowKey;
  }

  private matchesExpiryRange(item: InventoryItem, expiryFilter: string): boolean {
    const days = item.expiryDaysRemaining;

    if (days === null) {
      return expiryFilter === "normal";
    }

    if (expiryFilter === "expired") {
      return days < 0;
    }

    if (expiryFilter === "danger") {
      return days >= 0 && days <= UNDER_3_MONTHS_DAYS;
    }

    if (expiryFilter === "warning") {
      return days > UNDER_3_MONTHS_DAYS && days <= UNDER_6_MONTHS_DAYS;
    }

    if (expiryFilter === "safe") {
      return days >= 0 && days <= UNDER_12_MONTHS_DAYS;
    }

    if (expiryFilter === "normal") {
      return days > UNDER_12_MONTHS_DAYS;
    }

    return true;
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
