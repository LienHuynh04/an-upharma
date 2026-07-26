import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { environment } from "../environments/environment";
import {
  compareInventoryItems,
  ExpiryStatus,
  getColumnSearchText,
  InventoryItem,
  normalizeFilterText,
  normalizeInventoryRow,
  PRODUCT_NAME_COLLATOR,
} from "./inventory-utils";
import { STATIC_DATA } from "./static-data";
import { RemoteDatasets, ShopInfo, UpharmaService } from "./upharma.service";

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

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  readonly renderBatchSize = 200;
  readonly searchDebounceMs = 500;
  readonly expiryFilterLoadingMs = 3000;
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
    this.startLoading("inventory", "Đang lấy dữ liệu tồn kho...");

    try {
      this.upharmaService.ensureLogin();
      this.shopList = this.upharmaService.getActiveShops();
      this.applyDatasets(
        await this.upharmaService.loadAllResources({
          onFresh: (datasets) => {
            if (datasets.inventory) {
              this.applyDatasets(datasets);
            }
          },
        }),
      );
    } catch (error) {
      console.error("Không thể tải dữ liệu tồn kho:", error);
      this.loadStaticInventory();
    } finally {
      this.stopLoading("inventory");
    }
  }

  private applyDatasets(datasets: RemoteDatasets): void {
    const inventoryData = datasets.inventory;

    if (!inventoryData) {
      throw new Error("Không tải được API tồn kho");
    }

    this.remoteDatasets = datasets;

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

    const failedShops = Object.values(this.remoteDatasets).flatMap((resource) => resource?.failedShops || []);
    if (failedShops.length) {
      console.warn("Một số API nhà thuốc tải thất bại:", failedShops);
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
    this.startLoading("expiry-filter", "Đang lọc dữ liệu");
    this.columnFilters["expiryStatus"] =
      expiryStatus === "all" || this.columnFilters["expiryStatus"] === expiryStatus ? "" : expiryStatus;
    this.recomputeFilteredRows();
    window.setTimeout(() => this.stopLoading("expiry-filter"), this.expiryFilterLoadingMs);
  }

  applyShopFilter(shopCode: string): void {
    this.startLoading("shop-filter", "Đang lọc nhà thuốc");
    this.columnFilters["shop"] = "";
    this.activeShopCode = shopCode && shopCode === this.activeShopCode ? "" : shopCode;
    this.recomputeAll();
    window.setTimeout(() => this.stopLoading("shop-filter"), this.expiryFilterLoadingMs);
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
    this.visibleLimit += this.renderBatchSize;
    this.updateDisplayedRows();
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
    this.recomputeAll();
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
    const filters = Object.entries(this.columnFilters).map(([key, value]) => [key, normalizeFilterText(value)] as const);

    this.visibleLimit = this.renderBatchSize;
    this.filteredRows = this.normalizedRows.filter((item) => {
      if (this.activeShopCode && item.shopCode !== this.activeShopCode) {
        return false;
      }

      return filters.every(([key, value]) => {
        if (!value) {
          return true;
        }

        return getColumnSearchText(item, key).includes(value);
      });
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
