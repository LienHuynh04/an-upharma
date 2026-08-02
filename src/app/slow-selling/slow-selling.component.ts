import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { normalizeFilterText, PRODUCT_NAME_COLLATOR } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface SlowSellingShopTab {
  shopCode: string;
  shopName: string;
  count: number;
  loaded: boolean;
  loading: boolean;
}

interface SlowSellingItem {
  rowKey: string;
  shopCode: string;
  productCode: string;
  productName: string;
  unit: string;
  quantityExistText: string;
  slowMonths: SlowSellingMonth[];
  totalQuantity: number;
  maxMonthQuantity: number;
  expanded: boolean;
}

interface SlowSellingMonth {
  key: string;
  sessionText: string;
  label: string;
  quantity: number;
  quantityText: string;
  date: Date;
}

interface SlowSellingCacheEntry {
  cacheKey: string;
  rows: SlowSellingItem[];
  savedAt: number;
}

type SlowSellingTextFilterKey = "productName" | "productCode";

@Component({
  selector: "app-slow-selling",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./slow-selling.component.html",
})
export class SlowSellingComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetReportSalesSpeed";
  readonly renderBatchSize = 200;
  selectedRange: '1d' | '7d' | '3m' = '3m';
  shops: ShopInfo[] = [];
  activeShopCode = "";
  rows: SlowSellingItem[] = [];
  timeStart = "";
  timeEnd = "";
  startDateInput = "";
  endDateInput = "";
  userTitle = "Đang tải người dùng...";
  loading = false;
  loadingProgress = 0;
  slowSellingRefreshing = false;
  visibleLimit = this.renderBatchSize;
  isAppendingRows = false;
  slowSellingCacheStatus = "";
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  selectedSlowSellingItem: SlowSellingItem | null = null;
  filtersCollapsed = true;
  textFilters: Record<SlowSellingTextFilterKey, string> = {
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
    void this.loadSlowSelling();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get tabs(): SlowSellingShopTab[] {
    return this.shops.map((shop) => ({
      shopCode: shop.ShopCode,
      shopName: shop.ShopName,
      count: this.rows.filter((row) => row.shopCode === shop.ShopCode).length,
      loaded: this.loadedShopKeys.has(this.getLoadedShopKey(shop.ShopCode)),
      loading: this.loadingShopKeys.has(this.getLoadedShopKey(shop.ShopCode)),
    }));
  }

  get activeShopName(): string {
    return this.shops.find((shop) => shop.ShopCode === this.activeShopCode)?.ShopName || this.activeShopCode;
  }

  get filteredRows(): SlowSellingItem[] {
    return this.rows.filter((row) => {
      if (row.shopCode !== this.activeShopCode) {
        return false;
      }

      return this.matchesColumnFilters(row);
    });
  }

  get displayedRows(): SlowSellingItem[] {
    return this.filteredRows.slice(0, this.visibleLimit);
  }

  get hasActiveShopLoaded(): boolean {
    return this.loadedShopKeys.has(this.getLoadedShopKey(this.activeShopCode));
  }

  get mobileFilterSummary(): string {
    const filterCount = Object.values(this.textFilters).filter((value) => value.trim()).length;

    return filterCount > 0 ? `${filterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";
  }

  async loadSlowSelling(): Promise<void> {
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
    this.clearTableFilters();

    if (!this.loadedShopKeys.has(this.getLoadedShopKey(shopCode))) {
      await this.loadActiveShop();
    }
  }

  async reloadActiveShop(): Promise<void> {
    if (!this.activeShopCode) {
      return;
    }

    await this.loadActiveShop(true);
  }

  async applyDateFilter(): Promise<void> {
    this.timeStart = this.toApiDateTime(this.startDateInput);
    this.timeEnd = this.toApiDateTime(this.endDateInput);
    this.clearTableFilters();
    this.rows = this.rows.filter((row) => row.shopCode !== this.activeShopCode);
    this.loadedShopKeys.delete(this.getLoadedShopKey(this.activeShopCode));

    await this.loadActiveShop(true);
  }

  onFilterChange(): void {
    this.resetVisibleRows();
  }

  loadMoreRows(): void {
    const filteredRows = this.filteredRows;

    if (this.isAppendingRows || this.visibleLimit >= filteredRows.length) {
      return;
    }

    this.isAppendingRows = true;
    window.setTimeout(() => {
      this.visibleLimit += this.renderBatchSize;
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

  trackByShop(_: number, shop: SlowSellingShopTab): string {
    return shop.shopCode;
  }

  trackByRow(_: number, row: SlowSellingItem): string {
    return row.rowKey;
  }

  openSlowSellingDetail(row: SlowSellingItem): void {
    this.selectedSlowSellingItem = row;
  }

  closeSlowSellingDetail(): void {
    this.selectedSlowSellingItem = null;
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

  private resetVisibleRows(): void {
    this.visibleLimit = this.renderBatchSize;
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
      this.slowSellingCacheStatus = `Đang tải dữ liệu cho ${shop.ShopCode}. Web sẽ không gọi lặp API khi chị chuyển tab.`;
      return;
    }

    const cacheKey = this.getCacheKey(shop.ShopCode, session.UserInfo.uPharmaID);

    if (!forceReload) {
      const cachedData = await this.readSlowSellingCache(cacheKey);

      if (cachedData) {
        this.applyShopRows(shop.ShopCode, cachedData.rows);
        this.loadedShopKeys.add(loadedShopKey);
        this.slowSellingCacheStatus = `Đang hiển thị dữ liệu đã lưu lúc ${this.formatCacheTime(cachedData.savedAt)}. Hệ thống đang cập nhật dữ liệu mới...`;
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
      this.slowSellingRefreshing = true;
      this.loadingProgress = Math.max(this.loadingProgress, 30);
    } else {
      this.slowSellingRefreshing = true;
      this.loadingProgress = 15;
      this.slowSellingCacheStatus = "Đang lấy dữ liệu Hàng bán chậm 3 tháng cho shop đang xem...";
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
      const rows = this.filterRowsBySelectedDateRange(this.extractArray(response));
      const slowSellingRows = this.buildSlowSellingItems(rows, shop).sort((first, second) =>
        PRODUCT_NAME_COLLATOR.compare(first.productName, second.productName),
      );
      this.loadingProgress = 92;

      this.applyShopRows(shop.ShopCode, slowSellingRows);
      this.loadedShopKeys.add(loadedShopKey);
      await this.writeSlowSellingCache({
        cacheKey,
        rows: slowSellingRows,
        savedAt: Date.now(),
      });
      this.slowSellingCacheStatus = `Dữ liệu Hàng bán chậm đã cập nhật lúc ${this.formatCacheTime(Date.now())}.`;
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      if (this.rows.some((row) => row.shopCode === shop.ShopCode)) {
        this.slowSellingCacheStatus = "Chưa cập nhật được dữ liệu mới, vẫn đang hiển thị dữ liệu đã lưu.";
      }
      this.loadingProgress = 100;
    } finally {
      this.loadingShopKeys.delete(loadedShopKey);
      this.slowSellingRefreshing = this.loadingShopKeys.size > 0;
    }
  }

  private applyShopRows(shopCode: string, shopRows: SlowSellingItem[]): void {
    this.rows = [
      ...this.rows.filter((row) => row.shopCode !== shopCode),
      ...shopRows,
    ];
  }

  private buildSlowSellingItems(rows: RawRecord[], shop: ShopInfo): SlowSellingItem[] {
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
      const slowWindow = this.buildThreeMonthWindow(monthTotals);
      if (!slowWindow) {
        return [];
      }
      const totalQuantity = slowWindow.reduce((sum, month) => sum + month.quantity, 0);

      const hasAtLeastOneMonthBelowTwo = slowWindow.some((month) => month.quantity < 2);
      const hasAtLeastOneSale = slowWindow.some((month) => month.quantity > 0);

      if (!hasAtLeastOneMonthBelowTwo || !hasAtLeastOneSale) {
        return [];
      }

      const firstRow = productRows[0];
      const productName = String(
        this.pick(firstRow, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"]),
      ).trim();
      const unit = String(this.pick(firstRow, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])) || "--";
      const quantityExist = this.pick(firstRow, ["QuantityExist", "ExistQuantity", "TonKho", "InventoryQuantity", "RemainQty"]);
      const maxMonthQuantity = Math.max(...slowWindow.map((month) => month.quantity));

      return [{
        rowKey: [shop.ShopCode, productCode].join("|"),
        shopCode: shop.ShopCode,
        productCode,
        productName,
        unit,
        quantityExistText: quantityExist === "" ? "--" : String(quantityExist),
        slowMonths: slowWindow.map((month) => ({
          ...month,
          quantityText: this.formatNumber(month.quantity),
        })),
        totalQuantity,
        maxMonthQuantity,
        expanded: false,
      }];
    });
  }

  private buildMonthTotals(rows: RawRecord[]): SlowSellingMonth[] {
    const monthMap = new Map<string, SlowSellingMonth>();

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

  private buildThreeMonthWindow(months: SlowSellingMonth[]): SlowSellingMonth[] | null {
    if (months.length < 3) {
      return null;
    }

    return months.slice(-3);
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

  setRange(range: '1d' | '7d' | '3m'): void {
    this.selectedRange = range;
    this.setDefaultDateRange(true);
    void this.applyDateFilter();
  }

  private setDefaultDateRange(force = false): void {
    if (!force && this.timeStart && this.timeEnd) {
      return;
    }

    const now = new Date();
    let start: Date;
    if (this.selectedRange === '1d') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    } else if (this.selectedRange === '7d') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0); // 3 months
    }
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);

    this.timeStart = this.upharmaService.formatUpharmaDateTime(start);
    this.timeEnd = this.upharmaService.formatUpharmaDateTime(end);
    this.startDateInput = this.toDateTimeLocalValue(start);
    this.endDateInput = this.toDateTimeLocalValue(end);
  }

  private getLoadedShopKey(shopCode: string): string {
    return `${shopCode}:${this.selectedRange}:${this.timeStart}:${this.timeEnd}`;
  }

  private getCacheKey(shopCode: string, uPharmaID: number): string {
    return [
      "slow-selling",
      "v1",
      uPharmaID,
      shopCode,
      this.selectedRange,
      this.timeStart,
      this.timeEnd,
    ].join("|");
  }

  private async readSlowSellingCache(cacheKey: string): Promise<SlowSellingCacheEntry | null> {
    try {
      const db = await this.openStableConsumptionCacheDb();
      const cachedData = await new Promise<SlowSellingCacheEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("slowSellingCache", "readonly");
        const request = transaction.objectStore("slowSellingCache").get(cacheKey);

        request.onsuccess = () => resolve(request.result as SlowSellingCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return cachedData || null;
    } catch (error) {
      console.warn("Không đọc được cache Hàng bán chậm:", error);
      return null;
    }
  }

  private async writeSlowSellingCache(cacheEntry: SlowSellingCacheEntry): Promise<void> {
    try {
      const db = await this.openStableConsumptionCacheDb();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("slowSellingCache", "readwrite");
        const request = transaction.objectStore("slowSellingCache").put(cacheEntry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.warn("Không lưu được cache Hàng bán chậm:", error);
    }
  }

  private openStableConsumptionCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-slow-selling-cache", 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("slowSellingCache")) {
          db.createObjectStore("slowSellingCache", { keyPath: "cacheKey" });
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

  private matchesColumnFilters(row: SlowSellingItem): boolean {
    const textTargets: Record<SlowSellingTextFilterKey, string> = {
      productName: row.productName,
      productCode: row.productCode,
    };

    for (const [key, filterValue] of Object.entries(this.textFilters) as [SlowSellingTextFilterKey, string][]) {
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
