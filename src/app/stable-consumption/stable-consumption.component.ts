import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { normalizeFilterText, PRODUCT_NAME_COLLATOR } from "../inventory-utils";
import { getCompletedMonthRange, selectCompletedMonths } from "../sales-period-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface StableShopTab {
  shopCode: string;
  shopName: string;
  count: number;
  loaded: boolean;
  loading: boolean;
}

interface StableItem {
  rowKey: string;
  shopCode: string;
  productCode: string;
  productName: string;
  unit: string;
  quantityExistText: string;
  stableMonths: StableMonth[];
  totalQuantity: number;
  maxMonthQuantity: number;
  expanded: boolean;
}

interface StableMonth {
  key: string;
  sessionText: string;
  label: string;
  quantity: number;
  quantityText: string;
  date: Date;
}

interface StableConsumptionCacheEntry {
  cacheKey: string;
  rows: StableItem[];
  savedAt: number;
}

type StableTextFilterKey = "productName" | "productCode";
type StableMonthWindow = '1d' | '7d' | '3m' | '6m' | '9m';

@Component({
  selector: "app-stable-consumption",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./stable-consumption.component.html",
})
export class StableConsumptionComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetStableConsumptionCalculated";
  shopsSummary: any = null;
  shops: ShopInfo[] = [];
  activeShopCode = "";
  rows: StableItem[] = [];
  selectedMonthWindow: StableMonthWindow = '3m';
  timeStart = "";
  timeEnd = "";
  startDateInput = "";
  endDateInput = "";
  userTitle = "Đang tải người dùng...";
  loading = false;
  loadingProgress = 0;
  stableRefreshing = false;
  currentPage = 1;
  pageSize = 25;

  get visibleLimit(): number {
    return this.currentPage * this.pageSize;
  }

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
  }

  prevPage(): void {
    this.setPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.setPage(this.currentPage + 1);
  }

  isAppendingRows = false;
  stableCacheStatus = "";
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  selectedStableItem: StableItem | null = null;
  filtersCollapsed = true;
  textFilters: Record<StableTextFilterKey, string> = {
    productName: "",
    productCode: "",
  };
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: true,
    test: false,
  };
  private loadedShopKeys = new Set<string>();
  private loadingShopKeys = new Set<string>();

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";
    void this.loadStableConsumption();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get tabs(): StableShopTab[] {
    return this.shops.map((shop) => {
      const isLoaded = this.loadedShopKeys.has(this.getLoadedShopKey(shop.ShopCode));
      let count = 0;
      if (this.shopsSummary && this.shopsSummary[shop.ShopCode] !== undefined) {
        count = this.shopsSummary[shop.ShopCode].stableCount || 0;
      } else {
        count = this.rows.filter((row) => row.shopCode === shop.ShopCode).length;
      }

      return {
        shopCode: shop.ShopCode,
        shopName: shop.ShopName,
        count,
        loaded: isLoaded || (this.shopsSummary && this.shopsSummary[shop.ShopCode] !== undefined),
        loading: this.loadingShopKeys.has(this.getLoadedShopKey(shop.ShopCode)),
      };
    });
  }

  get activeShopName(): string {
    return this.shops.find((shop) => shop.ShopCode === this.activeShopCode)?.ShopName || this.activeShopCode;
  }

  get filteredRows(): StableItem[] {
    return this.rows.filter((row) => {
      if (row.shopCode !== this.activeShopCode) {
        return false;
      }

      return this.matchesColumnFilters(row);
    });
  }

  get displayedRows(): StableItem[] {
    return this.filteredRows.slice(0, this.visibleLimit);
  }

  get hasActiveShopLoaded(): boolean {
    return this.loadedShopKeys.has(this.getLoadedShopKey(this.activeShopCode));
  }

  get mobileFilterSummary(): string {
    const filterCount = Object.values(this.textFilters).filter((value) => value.trim()).length;

    return filterCount > 0 ? `${filterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";
  }

  async loadStableConsumption(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 10;
    this.errorText = "";
    let shouldLoadActiveShop = false;

    try {
      const session = this.upharmaService.ensureLogin();
      this.shops = this.upharmaService.getActiveShops();
      this.activeShopCode = this.activeShopCode || this.shops[0]?.ShopCode || "";
      this.userTitle = `${session.UserInfo.FullName} (ID - ${session.UserInfo.uPharmaID}) - ${this.shops.length} nhà thuốc`;
      this.setDefaultDateRange();

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
    this.currentPage = 1;
    this.clearTableFilters();

    if (!this.loadedShopKeys.has(this.getLoadedShopKey(shopCode))) {
      await this.loadActiveShop();
    }
  }

  async setMonthWindow(monthWindow: StableMonthWindow): Promise<void> {
    if (this.selectedMonthWindow === monthWindow) {
      return;
    }

    this.selectedMonthWindow = monthWindow;
    this.currentPage = 1;
    this.setDefaultDateRange(true);
    this.clearTableFilters();
    this.rows = [];
    this.loadedShopKeys.clear();
    this.stableCacheStatus = "";

    await this.loadActiveShop(true);
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
      "Tổng bán": row.totalQuantity,
    }));
    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Hang lap tot");

    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `hang-lap-tot-${this.activeShopCode || "shop"}.xlsx`);
  }

  async applyDateFilter(): Promise<void> {
    this.timeStart = this.toApiDateTime(this.startDateInput);
    this.timeEnd = this.toApiDateTime(this.endDateInput);
    this.currentPage = 1;
    this.clearTableFilters();
    this.rows = this.rows.filter((row) => row.shopCode !== this.activeShopCode);
    this.loadedShopKeys.delete(this.getLoadedShopKey(this.activeShopCode));

    await this.loadActiveShop(true);
  }

  onFilterChange(): void {
    this.resetVisibleRows();
  }

  trackByShop(_: number, shop: StableShopTab): string {
    return shop.shopCode;
  }

  trackByRow(_: number, row: StableItem): string {
    return row.rowKey;
  }

  openStableDetail(row: StableItem): void {
    this.selectedStableItem = row;
  }

  closeStableDetail(): void {
    this.selectedStableItem = null;
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  clearTableFilters(): void {
    this.textFilters = {
      productName: "",
      productCode: "",
    };
    this.resetVisibleRows();
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
    this.currentPage = 1;
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

    const loadedShopKey = this.getLoadedShopKey(shop.ShopCode);

    if (!forceReload && this.loadedShopKeys.has(loadedShopKey)) {
      return;
    }

    if (this.loadingShopKeys.has(loadedShopKey)) {
      this.stableCacheStatus = `Đang tải dữ liệu cho ${shop.ShopCode}. Web sẽ không gọi lặp API khi chị chuyển tab.`;
      return;
    }

    const cacheKey = this.getCacheKey(shop.ShopCode, session.UserInfo.uPharmaID);

    if (!forceReload) {
      const cachedData = await this.readStableConsumptionCache(cacheKey);

      if (cachedData) {
        this.applyShopRows(shop.ShopCode, cachedData.rows);
        this.loadedShopKeys.add(loadedShopKey);
        this.stableCacheStatus = `Đang hiển thị dữ liệu đã lưu lúc ${this.formatCacheTime(cachedData.savedAt)}. Hệ thống đang cập nhật dữ liệu mới...`;
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
    const loadedShopKey = this.getLoadedShopKey(shop.ShopCode);

    if (this.loadingShopKeys.has(loadedShopKey)) {
      return;
    }

    this.loadingShopKeys.add(loadedShopKey);

    if (runInBackground) {
      this.stableRefreshing = true;
      this.loadingProgress = Math.max(this.loadingProgress, 30);
    } else {
      this.stableRefreshing = true;
      this.loadingProgress = 15;
      this.stableCacheStatus = `Đang lấy dữ liệu Hàng lặp tốt ${this.selectedMonthWindow} tháng cho shop đang xem...`;
    }

    this.errorText = "";

    try {
      const payload = {
        uPharmaID: session.UserInfo.uPharmaID,
        Token: session.Token,
        TimeStart: this.timeStart,
        TimeEnd: this.timeEnd,
        ProductID: "",
        GetType: "Week",
        ViewCity: 0,
        ShopLst: shop.ShopCode,
      };
      this.loadingProgress = 45;
      const response = await this.upharmaService.callEndpoint<unknown>(this.endpoint, payload, {
        cache: true,
        forceRefresh,
      });
      this.loadingProgress = 75;
      const stableRows = (this.extractArray(response) as unknown as StableItem[]).sort((first, second) =>
        PRODUCT_NAME_COLLATOR.compare(first.productName, second.productName),
      );
      this.loadingProgress = 92;

      this.applyShopRows(shop.ShopCode, stableRows);
      this.loadedShopKeys.add(loadedShopKey);
      await this.writeStableConsumptionCache({
        cacheKey,
        rows: stableRows,
        savedAt: Date.now(),
      });
      this.stableCacheStatus = `Dữ liệu Hàng lặp tốt đã cập nhật lúc ${this.formatCacheTime(Date.now())}.`;
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      if (this.rows.some((row) => row.shopCode === shop.ShopCode)) {
        this.stableCacheStatus = "Chưa cập nhật được dữ liệu mới, vẫn đang hiển thị dữ liệu đã lưu.";
      }
      this.loadingProgress = 100;
    } finally {
      this.loadingShopKeys.delete(loadedShopKey);
      this.stableRefreshing = this.loadingShopKeys.size > 0;
    }
  }

  private applyShopRows(shopCode: string, shopRows: StableItem[]): void {
    this.rows = [
      ...this.rows.filter((row) => row.shopCode !== shopCode),
      ...shopRows,
    ];
  }

  private buildStableItems(rows: RawRecord[], shop: ShopInfo): StableItem[] {
    const groupedRows = new Map<string, RawRecord[]>();

    for (const row of rows) {
      const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();

      if (!productCode || productCode.toUpperCase().startsWith("Y")) {
        continue;
      }

      groupedRows.set(productCode, [...(groupedRows.get(productCode) || []), row]);
    }

    return Array.from(groupedRows.entries()).flatMap(([productCode, productRows]) => {
      const monthTotals = this.buildMonthTotals(productRows);
      const stableWindow = this.buildThreeMonthWindow(monthTotals);

      if (!stableWindow) {
        return [];
      }

      const isStable = stableWindow.every((month) => month.quantity >= 2);

      if (!isStable) {
        return [];
      }

      const firstRow = productRows[0];
      const productName = String(
        this.pick(firstRow, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"]),
      ).trim();
      const unit = String(this.pick(firstRow, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])) || "--";
      const quantityExist = this.pick(firstRow, ["QuantityExist", "ExistQuantity", "TonKho", "InventoryQuantity", "RemainQty"]);
      const totalQuantity = stableWindow.reduce((sum, month) => sum + month.quantity, 0);
      const maxMonthQuantity = Math.max(...stableWindow.map((month) => month.quantity));

      return [{
        rowKey: [shop.ShopCode, productCode].join("|"),
        shopCode: shop.ShopCode,
        productCode,
        productName,
        unit,
        quantityExistText: quantityExist === "" ? "--" : String(quantityExist),
        stableMonths: stableWindow.map((month) => ({
          ...month,
          quantityText: this.formatNumber(month.quantity),
        })),
        totalQuantity,
        maxMonthQuantity,
        expanded: false,
      }];
    });
  }

  private buildMonthTotals(rows: RawRecord[]): StableMonth[] {
    const monthMap = new Map<string, StableMonth>();

    for (const row of rows) {
      const date = this.getMonthDate(row);

      if (!date) {
        continue;
      }

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const current = monthMap.get(key) || {
        key,
        sessionText: String(this.pick(row, ["Session", "Ky", "Thang"])).trim() || `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`,
        label: String(this.pick(row, ["Session", "Ky", "Thang"])).trim() || `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`,
        quantity: 0,
        quantityText: "0",
        date,
      };

      current.quantity += this.toNumber(this.pick(row, ["Quantity", "Qty", "SL", "SoLuong", "QuantitySale", "TotalQuantity", "QtySale"]));
      monthMap.set(key, current);
    }

    return Array.from(monthMap.values()).sort((first, second) => first.date.getTime() - second.date.getTime());
  }

  private getMonthDate(row: RawRecord): Date | null {
    const parsedTime = this.parseDateTimeValue(this.pick(row, ["TimeBegin", "TimeStart", "BeginTime", "StartTime", "Date", "Ngay"]));

    if (parsedTime !== null) {
      const date = new Date(parsedTime);
      return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    const session = String(this.pick(row, ["Session", "Ky", "Thang"]));
    const match = session.match(/(\d{1,2}).*?(\d{4})/);

    if (!match) {
      return null;
    }

    return new Date(Number(match[2]), Number(match[1]) - 1, 1);
  }

  private buildThreeMonthWindow(months: StableMonth[]): StableMonth[] | null {
    return selectCompletedMonths(months, 3);
  }

  private setDefaultDateRange(force = false): void {
    if (!force && this.timeStart && this.timeEnd) {
      return;
    }

    const now = new Date();
    let start: Date;
    if (this.selectedMonthWindow === '1d') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (this.selectedMonthWindow === '7d') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
    } else {
      let m = 3;
      if (this.selectedMonthWindow === '6m') m = 6;
      if (this.selectedMonthWindow === '9m') m = 9;
      const completedRange = getCompletedMonthRange(m, now);
      start = completedRange.start;
    }
    const end = this.selectedMonthWindow === '1d' || this.selectedMonthWindow === '7d'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0)
      : getCompletedMonthRange(3, now).end;

    this.timeStart = this.upharmaService.formatUpharmaDateTime(start);
    this.timeEnd = this.upharmaService.formatUpharmaDateTime(end);
    this.startDateInput = this.toDateTimeLocalValue(start);
    this.endDateInput = this.toDateTimeLocalValue(end);
  }

  private getLoadedShopKey(shopCode: string): string {
    return `${shopCode}:${this.selectedMonthWindow}:${this.timeStart}:${this.timeEnd}`;
  }

  private getCacheKey(shopCode: string, uPharmaID: number): string {
    return [
      "stable-consumption",
      "v2",
      uPharmaID,
      shopCode,
      this.selectedMonthWindow,
      this.timeStart,
      this.timeEnd,
    ].join("|");
  }

  private async readStableConsumptionCache(cacheKey: string): Promise<StableConsumptionCacheEntry | null> {
    try {
      const db = await this.openStableConsumptionCacheDb();
      const cachedData = await new Promise<StableConsumptionCacheEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("stableConsumptionCache", "readonly");
        const request = transaction.objectStore("stableConsumptionCache").get(cacheKey);

        request.onsuccess = () => resolve(request.result as StableConsumptionCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return cachedData || null;
    } catch (error) {
      console.warn("Không đọc được cache Hàng lặp tốt:", error);
      return null;
    }
  }

  private async writeStableConsumptionCache(cacheEntry: StableConsumptionCacheEntry): Promise<void> {
    try {
      const db = await this.openStableConsumptionCacheDb();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("stableConsumptionCache", "readwrite");
        const request = transaction.objectStore("stableConsumptionCache").put(cacheEntry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.warn("Không lưu được cache Hàng lặp tốt:", error);
    }
  }

  private openStableConsumptionCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-stable-consumption-cache", 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("stableConsumptionCache")) {
          db.createObjectStore("stableConsumptionCache", { keyPath: "cacheKey" });
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

  private matchesColumnFilters(row: StableItem): boolean {
    const textTargets: Record<StableTextFilterKey, string> = {
      productName: row.productName,
      productCode: row.productCode,
    };

    for (const [key, filterValue] of Object.entries(this.textFilters) as [StableTextFilterKey, string][]) {
      const normalizedFilter = normalizeFilterText(filterValue);

      if (normalizedFilter && !normalizeFilterText(textTargets[key]).includes(normalizedFilter)) {
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
    const preferredKeys = ["SalesSpeedLst", "Data", "data", "DataLst", "ListData", "Rows", "Table"];

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

  private filterRowsBySelectedDateRange(rows: RawRecord[]): RawRecord[] {
    const rangeStart = this.parseDateTimeValue(this.timeStart);
    const rangeEnd = this.parseDateTimeValue(this.timeEnd);

    if (rangeStart === null || rangeEnd === null) {
      return rows;
    }

    return rows.filter((row) => {
      const rowRange = this.getRowSearchRange(row);

      if (!rowRange) {
        return true;
      }

      return rowRange.start <= rangeEnd && rowRange.end >= rangeStart;
    });
  }

  private getRowSearchRange(row: RawRecord): { start: number; end: number } | null {
    const rowStart = this.parseDateTimeValue(this.pick(row, ["TimeBegin", "TimeStart", "BeginTime", "StartTime", "FromDate", "DateFrom"]));
    const rowEnd = this.parseDateTimeValue(this.pick(row, ["TimeEnd", "EndTime", "FinishTime", "ToDate", "DateTo"]));

    if (rowStart !== null || rowEnd !== null) {
      const start = rowStart ?? rowEnd;
      const end = rowEnd ?? rowStart;

      if (start !== null && end !== null) {
        return { start, end };
      }
    }

    return null;
  }

  private pick(row: RawRecord, keys: string[]): unknown {
    const normalizedMap = new Map(Object.keys(row).map((key) => [key.toLowerCase().replaceAll("_", ""), key]));

    for (const key of keys) {
      const directValue = row[key];

      if (directValue !== undefined && directValue !== null && directValue !== "") {
        return directValue;
      }

      const matchedKey = normalizedMap.get(key.toLowerCase().replaceAll("_", ""));

      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
        return row[matchedKey];
      }
    }

    return "";
  }

  private toDateTimeLocalValue(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");

    return [
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    ].join("T");
  }

  private toApiDateTime(value: string): string {
    if (!value) {
      return "";
    }

    const normalizedValue = value.includes("T") ? value.replace("T", " ") : value;

    return normalizedValue.length === 16 ? `${normalizedValue}:00` : normalizedValue;
  }

  private parseDateTimeValue(value: unknown): number | null {
    if (!value) {
      return null;
    }

    const text = String(value).trim();
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    const viMatch = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);

    if (isoMatch) {
      return new Date(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3]),
        Number(isoMatch[4] || 0),
        Number(isoMatch[5] || 0),
        Number(isoMatch[6] || 0),
      ).getTime();
    }

    if (viMatch) {
      return new Date(
        Number(viMatch[3]),
        Number(viMatch[2]) - 1,
        Number(viMatch[1]),
        Number(viMatch[4] || 0),
        Number(viMatch[5] || 0),
        Number(viMatch[6] || 0),
      ).getTime();
    }

    const parsed = new Date(text).getTime();

    return Number.isNaN(parsed) ? null : parsed;
  }

  private toNumber(value: unknown): number {
    const numberValue = typeof value === "number" ? value : Number(String(value ?? "").replace(",", ".").trim());

    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
  }
}
