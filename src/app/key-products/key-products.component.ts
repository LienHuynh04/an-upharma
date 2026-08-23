import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { normalizeFilterText } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface KeyProductShopTab {
  shopCode: string;
  shopName: string;
  count: number;
  loaded: boolean;
  loading: boolean;
}

interface KeyProductItem {
  rowKey: string;
  shopCode: string;
  productCode: string;
  productName: string;
  amount: number;
  amountText: string;
  percentOfTotal: number;
  cumulativePercent: number;
  expanded: boolean;
  amountIncludingVAT: number;
  amountIncludingAdjust: number;
  quantity: number;
  totalAmount: number;
}

interface KeyProductsCacheEntry {
  cacheKey: string;
  rows: KeyProductItem[];
  savedAt: number;
}

type KeyProductsTextFilterKey = "productName" | "productCode" | "status";

@Component({
  selector: "app-key-products",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./key-products.component.html",
})
export class KeyProductsComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetReportSalesByShop";
  shopsSummary: any = null;
  shops: ShopInfo[] = [];
  activeShopCode = "";
  rows: KeyProductItem[] = [];
  userTitle = "Đang tải người dùng...";
  loading = false;
  loadingProgress = 0;
  keyProductsRefreshing = false;
  visibleCount = 50;

  isAppendingRows = false;
  cacheStatus = "";
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  filtersCollapsed = true;
  textFilters: Record<KeyProductsTextFilterKey, string> = {
    productName: "",
    productCode: "",
    status: "",
  };
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: true,
    test: false,
  };
  stableProductCodes = new Set<string>();
  private loadedShopKeys = new Set<string>();
  private loadingShopKeys = new Set<string>();

  isStableProduct(productCode: string): boolean {
    return this.stableProductCodes.has(productCode);
  }

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";
    void this.loadKeyProducts();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get tabs(): KeyProductShopTab[] {
    return this.shops.map((shop) => {
      const isLoaded = this.loadedShopKeys.has(shop.ShopCode);
      let count = 0;
      if (this.shopsSummary && this.shopsSummary[shop.ShopCode] !== undefined) {
        count = this.shopsSummary[shop.ShopCode].keyCount || 0;
      } else {
        count = this.rows.filter((row) => row.shopCode === shop.ShopCode).length;
      }

      return {
        shopCode: shop.ShopCode,
        shopName: shop.ShopName,
        count,
        loaded: isLoaded || (this.shopsSummary && this.shopsSummary[shop.ShopCode] !== undefined),
        loading: this.loadingShopKeys.has(shop.ShopCode),
      };
    });
  }

  get activeShopName(): string {
    return this.shops.find((shop) => shop.ShopCode === this.activeShopCode)?.ShopName || this.activeShopCode;
  }

  get filteredRows(): KeyProductItem[] {
    return this.rows.filter((row) => {
      if (row.shopCode !== this.activeShopCode) {
        return false;
      }

      return this.matchesColumnFilters(row);
    });
  }

  get displayedRows(): KeyProductItem[] {
    return this.filteredRows.slice(0, this.visibleCount);
  }

  // Toàn bộ rows của shop đang xem, không qua filter — dùng cho thống kê cố định
  get shopRows(): KeyProductItem[] {
    return this.rows.filter(row => row.shopCode === this.activeShopCode);
  }

  get totalKeyProductsCount(): number {
    return this.shopRows.length;
  }

  get totalKeyProductsAmount(): number {
    return this.shopRows.reduce((sum, r) => sum + r.totalAmount, 0);
  }

  get totalKeyProductsPercent(): number {
    const percent = this.shopRows.reduce((sum, r) => sum + r.percentOfTotal, 0);
    return Number(percent.toFixed(2));
  }

  get totalStableProductsCount(): number {
    return this.shopRows.filter(row => this.isStableProduct(row.productCode)).length;
  }

  get hasActiveShopLoaded(): boolean {
    return this.loadedShopKeys.has(this.activeShopCode);
  }

  get mobileFilterSummary(): string {
    const filterCount = Object.values(this.textFilters).filter((value) => value.trim()).length;

    return filterCount > 0 ? `${filterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";
  }

  async loadKeyProducts(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 10;
    this.errorText = "";
    let shouldLoadActiveShop = false;

    try {
      const session = this.upharmaService.ensureLogin();
      this.shops = this.upharmaService.getActiveShops();
      this.activeShopCode = this.activeShopCode || this.shops[0]?.ShopCode || "";
      this.userTitle = `${session.UserInfo.FullName} (ID - ${session.UserInfo.uPharmaID}) - ${this.shops.length} nhà thuốc`;

      try {
        const summary = await this.upharmaService.callEndpoint<any>("/SalesInvoice/GetShopsSummaryCalculated", {});
        if (summary && summary.data) {
          this.shopsSummary = summary.data;
        }
      } catch (err) {
        console.warn("Không tải được shops_summary:", err);
      }

      this.loadingProgress = 25;
      shouldLoadActiveShop = Boolean(this.activeShopCode);
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }

    if (shouldLoadActiveShop) {
      await this.loadActiveShop();
    }
  }

  async setActiveShop(shopCode: string): Promise<void> {
    this.activeShopCode = shopCode;
    this.visibleCount = 50;
    this.clearTableFilters();

    if (!this.loadedShopKeys.has(shopCode)) {
      await this.loadActiveShop();
    }
  }

  async reloadActiveShop(): Promise<void> {
    if (!this.activeShopCode) {
      return;
    }

    await this.loadActiveShop(true);
  }

  async exportExcel(): Promise<void> {
    const rows = this.filteredRows;

    if (rows.length === 0) {
      return;
    }

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheetRows = rows.map((row) => ({
      "Tên SP": row.productName,
      "Mã SP": row.productCode,
      "Doanh số": row.amount,
      "Tỷ trọng": `${row.percentOfTotal}%`,
    }));
    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "hang-key");

    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `hang-key-${this.activeShopCode || "shop"}.xlsx`);
  }

  onFilterChange(): void {
    this.resetVisibleRows();
  }

  onTableScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const threshold = 160;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - threshold;
    if (reachedBottom && this.visibleCount < this.filteredRows.length) {
      this.visibleCount += 25;
    }
  }

  trackByShop(_: number, shop: KeyProductShopTab): string {
    return shop.shopCode;
  }

  trackByRow(_: number, row: KeyProductItem): string {
    return row.rowKey;
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  clearTableFilters(): void {
    this.textFilters = {
      productName: "",
      productCode: "",
      status: "",
    };
    this.resetVisibleRows();
  }

  formatMoney(value: number): string {
    return value.toLocaleString('vi-VN');
  }

  private downloadExcelBuffer(buffer: ArrayBuffer, fileName: string): void {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private resetVisibleRows(): void {
    this.visibleCount = 50;
    this.isAppendingRows = false;
  }

  toggleMenuGroup(groupKey: string): void {
    this.menuGroups[groupKey] = !this.menuGroups[groupKey];
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

  private async loadActiveShop(forceReload = false): Promise<void> {
    const session = this.upharmaService.ensureLogin();
    const shop = this.shops.find((item) => item.ShopCode === this.activeShopCode);

    if (!shop) {
      return;
    }

    const loadedShopKey = shop.ShopCode;

    if (!forceReload && this.loadedShopKeys.has(loadedShopKey)) {
      return;
    }

    if (this.loadingShopKeys.has(loadedShopKey)) {
      this.cacheStatus = `Đang tải dữ liệu cho ${shop.ShopCode}. Web sẽ không gọi lặp API khi chị chuyển tab.`;
      return;
    }

    const cacheKey = this.getCacheKey(shop.ShopCode, session.UserInfo.uPharmaID);

    if (!forceReload) {
      const cachedData = await this.readCache(cacheKey);

      if (cachedData) {
        this.applyShopRows(shop.ShopCode, cachedData.rows);
        this.loadedShopKeys.add(loadedShopKey);
        this.cacheStatus = `Đang hiển thị dữ liệu đã lưu lúc ${this.formatCacheTime(cachedData.savedAt)}. Hệ thống đang cập nhật dữ liệu mới...`;
        void this.refreshActiveShopFromApi(shop, cacheKey, true);
        return;
      }
    }

    await this.refreshActiveShopFromApi(shop, cacheKey, false, forceReload);
  }

  private async refreshActiveShopFromApi(
    shop: ShopInfo,
    cacheKey: string,
    runInBackground: boolean,
    forceRefresh = false,
  ): Promise<void> {
    const session = this.upharmaService.ensureLogin();
    const loadedShopKey = shop.ShopCode;

    if (this.loadingShopKeys.has(loadedShopKey)) {
      return;
    }

    this.loadingShopKeys.add(loadedShopKey);

    if (runInBackground) {
      this.keyProductsRefreshing = true;
      this.loadingProgress = Math.max(this.loadingProgress, 30);
    } else {
      this.keyProductsRefreshing = true;
      this.loadingProgress = 15;
      this.cacheStatus = `Đang lấy dữ liệu Hàng key cho shop đang xem...`;
    }

    this.errorText = "";

    try {
      const now = new Date();
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const timeStart = `${oneMonthAgo.getFullYear()}-${pad(oneMonthAgo.getMonth() + 1)}-01 00:00:00`;
      const timeEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 23:59:59`;

      const payload = {
        uPharmaID: session.UserInfo.uPharmaID,
        Token: session.Token,
        ShopCode: shop.ShopCode,
        TimeStart: timeStart,
        TimeEnd: timeEnd,
        _useFirebaseKeyProducts: false,
      };
      this.loadingProgress = 45;
      const response = await this.upharmaService.callEndpoint<unknown>(this.endpoint, payload, {
        cache: true,
        forceRefresh,
      });
      // Tải danh sách hàng lặp tốt để đánh dấu "Hàng thường trực"
      try {
        const stablePayload = {
          uPharmaID: session.UserInfo.uPharmaID,
          Token: session.Token,
          ShopLst: shop.ShopCode,
        };
        const stableRes = await this.upharmaService.callEndpoint<unknown>("/SalesInvoice/GetStableConsumptionCalculated", stablePayload, {
          cache: true,
          forceRefresh,
        });
        const stableArray = this.extractArray(stableRes);
        const codes = stableArray.map(item => String(item["productCode"] || item["ProductCode"] || "").trim()).filter(Boolean);
        this.stableProductCodes = new Set(codes);
      } catch (err) {
        console.warn("Không tải được danh sách hàng lặp tốt:", err);
        this.stableProductCodes = new Set();
      }

      this.loadingProgress = 70;

      const rawArray = this.extractArray(response);

      const filteredRawArray = rawArray.filter((row) => {
        const pName = String(row["productName"] || row["ProductName"] || row["ItemName"] || "").toUpperCase();
        const pCode = String(row["productCode"] || row["ProductCode"] || row["ProductID"] || row["ItemCode"] || "").toUpperCase();
        
        // Exclude if name contains "VOUCHER" or code starts with "VC"
        if (pName.includes("VOUCHER") || pCode.startsWith("VC")) {
          return false;
        }
        return true;
      });

      const parsedRows = filteredRawArray.map((row, index) => {
        const amountIncludingVAT = Number(row["amountIncludingVAT"] || row["AmountIncludingVAT"] || row["amount"] || row["Amount"] || row["TotalAmount"] || row["ThanhTien"]) || 0;
        const amountIncludingAdjust = Number(row["amountIncludingAdjust"] || row["AmountIncludingAdjust"]) || 0;
        const quantity = Number(row["quantity"] || row["Quantity"]) || 0;
        const totalAmount = Number(row["totalAmount"] || row["TotalAmount"]) || amountIncludingVAT;
        
        return {
          rowKey: `${shop.ShopCode}|${index}`,
          shopCode: shop.ShopCode,
          productCode: String(row["productCode"] || row["ProductCode"] || row["ProductID"] || row["ItemCode"] || "").trim(),
          productName: String(row["productName"] || row["ProductName"] || row["ItemName"] || "").trim(),
          amount: totalAmount,
          amountText: "",
          percentOfTotal: 0,
          cumulativePercent: 0,
          expanded: false,
          amountIncludingVAT: amountIncludingVAT,
          amountIncludingAdjust: amountIncludingAdjust,
          quantity: quantity,
          totalAmount: totalAmount,
        };
      });
      
      // Group by ProductCode to combine duplicate products
      const grouped = new Map<string, KeyProductItem>();
      for (const row of parsedRows) {
        if (!row.productCode) continue;
        const existing = grouped.get(row.productCode);
        if (existing) {
          existing.quantity += row.quantity;
          existing.amountIncludingVAT += row.amountIncludingVAT;
          existing.amountIncludingAdjust += row.amountIncludingAdjust;
          existing.totalAmount = existing.amountIncludingVAT;
          existing.amount = existing.totalAmount;
        } else {
          grouped.set(row.productCode, { ...row });
        }
      }
      
      const keyRows = Array.from(grouped.values());
      
      // Sort by totalAmount descending
      keyRows.sort((first, second) => second.totalAmount - first.totalAmount);
      
      const totalAmountSum = keyRows.reduce((sum, r) => sum + r.totalAmount, 0);
      const minItemsCount = Math.max(1, Math.ceil(keyRows.length * 0.20));
      
      const finalKeyRows: KeyProductItem[] = [];
      let runningTotal = 0;
      for (const row of keyRows) {
        runningTotal += row.totalAmount;
        row.percentOfTotal = totalAmountSum > 0 ? Number(((row.totalAmount / totalAmountSum) * 100).toFixed(2)) : 0;
        row.cumulativePercent = totalAmountSum > 0 ? Number(((runningTotal / totalAmountSum) * 100).toFixed(2)) : 0;
        finalKeyRows.push(row);
        
        // Điều kiện dừng: đạt tối thiểu 20% số lượng mã hàng VÀ tổng tỷ trọng lũy kế đạt ít nhất 80%
        if (finalKeyRows.length >= minItemsCount && row.cumulativePercent >= 80) {
          break;
        }
      }

      this.loadingProgress = 90;

      this.applyShopRows(shop.ShopCode, finalKeyRows);
      this.loadedShopKeys.add(loadedShopKey);
      await this.writeCache({
        cacheKey,
        rows: finalKeyRows,
        savedAt: Date.now(),
      });
      this.cacheStatus = `Dữ liệu Hàng key đã cập nhật lúc ${this.formatCacheTime(Date.now())}.`;
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      if (this.rows.some((row) => row.shopCode === shop.ShopCode)) {
        this.cacheStatus = "Chưa cập nhật được dữ liệu mới, vẫn đang hiển thị dữ liệu đã lưu.";
      }
      this.loadingProgress = 100;
    } finally {
      this.loadingShopKeys.delete(loadedShopKey);
      this.keyProductsRefreshing = this.loadingShopKeys.size > 0;
    }
  }

  private applyShopRows(shopCode: string, shopRows: KeyProductItem[]): void {
    this.rows = [
      ...this.rows.filter((row) => row.shopCode !== shopCode),
      ...shopRows,
    ];
  }

  private getCacheKey(shopCode: string, uPharmaID: number): string {
    return [
      "key-products",
      "v1",
      uPharmaID,
      shopCode,
    ].join("|");
  }

  private async readCache(cacheKey: string): Promise<KeyProductsCacheEntry | null> {
    try {
      const db = await this.openCacheDb();
      const cachedData = await new Promise<KeyProductsCacheEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("keyProductsCache", "readonly");
        const request = transaction.objectStore("keyProductsCache").get(cacheKey);

        request.onsuccess = () => resolve(request.result as KeyProductsCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return cachedData || null;
    } catch (error) {
      console.warn("Không đọc được cache Hàng key:", error);
      return null;
    }
  }

  private async writeCache(cacheEntry: KeyProductsCacheEntry): Promise<void> {
    try {
      const db = await this.openCacheDb();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("keyProductsCache", "readwrite");
        const request = transaction.objectStore("keyProductsCache").put(cacheEntry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.warn("Không lưu được cache Hàng key:", error);
    }
  }

  private openCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-key-products-cache", 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("keyProductsCache")) {
          db.createObjectStore("keyProductsCache", { keyPath: "cacheKey" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private formatCacheTime(value: number): string {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, "0");

    return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}-${pad(date.getMonth() + 1)}`;
  }

  private matchesColumnFilters(row: KeyProductItem): boolean {
    const statusFilter = this.textFilters.status;
    if (statusFilter) {
      const isStable = this.isStableProduct(row.productCode);
      if (statusFilter === "Hàng thường trực" && !isStable) {
        return false;
      }
      if (statusFilter === "Hàng khác" && isStable) {
        return false;
      }
    }

    const textTargets: Record<"productName" | "productCode", string> = {
      productName: row.productName,
      productCode: row.productCode,
    };

    for (const [key, filterValue] of Object.entries(this.textFilters) as [KeyProductsTextFilterKey, string][]) {
      if (key === "status") continue;
      const normalizedFilter = normalizeFilterText(filterValue);

      if (normalizedFilter && !normalizeFilterText(textTargets[key as "productName" | "productCode"]).includes(normalizedFilter)) {
        return false;
      }
    }

    return true;
  }

  private extractArray(data: unknown): RawRecord[] {
    if (Array.isArray(data)) {
      return data.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
    }

    if (!data || typeof data !== "object") {
      return [];
    }

    const record = data as RawRecord;
    const preferredKeys = [
      "SalesInvoiceLst",
      "ReportSalesLst",
      "SalesReportLst",
      "SalesSpeedLst",
      "Data",
      "data",
      "DataLst",
      "ListData",
      "Rows",
      "rows",
      "Table",
      "result",
    ];

    for (const key of preferredKeys) {
      const value = record[key];

      if (Array.isArray(value)) {
        return value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
      }
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        return value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
      }
    }

    return [];
  }
}
