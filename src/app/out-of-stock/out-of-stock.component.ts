import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { formatMoney, normalizeFilterText, PRODUCT_NAME_COLLATOR } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface OutOfStockShopTab {
  shopCode: string;
  shopName: string;
  count: number;
  loaded: boolean;
  loading: boolean;
}

interface OutOfStockItem {
  rowKey: string;
  shopCode: string;
  productName: string;
  productCode: string;
  quantityText: string;
  zeroStock: boolean;
  unit: string;
  searchText: string;
  expanded: boolean;
}

interface OutOfStockCacheEntry {
  cacheKey: string;
  rows: OutOfStockItem[];
  savedAt: number;
}

type OutStockTextFilterKey = "productName" | "productCode";
type OutStockMultiFilterKey = "quantityText" | "unit";

@Component({
  selector: "app-out-of-stock",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./out-of-stock.component.html",
})
export class OutOfStockComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetReportSalesSpeed";
  readonly renderBatchSize = 200;
  shops: ShopInfo[] = [];
  activeShopCode = "";
  rows: OutOfStockItem[] = [];
  quantityFilter = "";
  timeStart = "";
  timeEnd = "";
  startDateInput = "";
  endDateInput = "";
  userTitle = "Đang tải người dùng...";
  loading = false;
  loadingProgress = 0;
  outStockRefreshing = false;
  visibleLimit = this.renderBatchSize;
  isAppendingRows = false;
  outStockCacheStatus = "";
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  filtersCollapsed = true;
  textFilters: Record<OutStockTextFilterKey, string> = {
    productName: "",
    productCode: "",
  };
  multiFilters: Record<OutStockMultiFilterKey, string[]> = {
    quantityText: [],
    unit: [],
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
    void this.loadOutOfStock();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get tabs(): OutOfStockShopTab[] {
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

  get filteredRows(): OutOfStockItem[] {
    let activeIndex = 0;

    return this.rows.filter((row) => {
      if (row.shopCode !== this.activeShopCode) {
        return false;
      }

      activeIndex += 1;

      if (!this.quantityFilter) {
        return this.matchesColumnFilters(row, activeIndex);
      }

      return row.quantityText === this.quantityFilter && this.matchesColumnFilters(row, activeIndex);
    });
  }

  get displayedRows(): OutOfStockItem[] {
    return this.filteredRows.slice(0, this.visibleLimit);
  }

  get quantityOptions(): string[] {
    const quantities = this.rows
      .filter((row) => row.shopCode === this.activeShopCode)
      .map((row) => row.quantityText)
      .filter((quantity) => quantity && quantity !== "--");

    return Array.from(new Set(quantities)).sort((first, second) => {
      const firstNumber = Number(first.replaceAll(",", "."));
      const secondNumber = Number(second.replaceAll(",", "."));

      if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
        return firstNumber - secondNumber;
      }

      return first.localeCompare(second, "vi", { numeric: true });
    });
  }

  get hasActiveShopLoaded(): boolean {
    return this.loadedShopKeys.has(this.getLoadedShopKey(this.activeShopCode));
  }

  get mobileFilterSummary(): string {
    const textFilterCount = Object.values(this.textFilters).filter((value) => value.trim()).length;
    const multiFilterCount = Object.values(this.multiFilters).filter((values) => values.length > 0).length;
    const filterCount = textFilterCount + multiFilterCount + (this.quantityFilter ? 1 : 0);

    return filterCount > 0 ? `${filterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";
  }

  get quantityFilterOptions(): string[] {
    return this.getMultiFilterOptions("quantityText");
  }

  get unitFilterOptions(): string[] {
    return this.getMultiFilterOptions("unit");
  }

  async loadOutOfStock(): Promise<void> {
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
    this.quantityFilter = "";
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
    this.quantityFilter = "";
    this.clearTableFilters();
    this.rows = [];
    this.loadedShopKeys.clear();
    this.outStockCacheStatus = "";

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

  trackByShop(_: number, shop: OutOfStockShopTab): string {
    return shop.shopCode;
  }

  trackByRow(_: number, row: OutOfStockItem): string {
    return row.rowKey;
  }

  toggleRecord(row: OutOfStockItem): void {
    row.expanded = !row.expanded;
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  toggleMultiFilter(filterKey: OutStockMultiFilterKey, value: string): void {
    const currentValues = this.multiFilters[filterKey];

    this.multiFilters[filterKey] = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];
    this.resetVisibleRows();
  }

  isMultiFilterSelected(filterKey: OutStockMultiFilterKey, value: string): boolean {
    return this.multiFilters[filterKey].includes(value);
  }

  getMultiFilterLabel(filterKey: OutStockMultiFilterKey): string {
    const selectedCount = this.multiFilters[filterKey].length;

    return selectedCount > 0 ? `Đã chọn ${selectedCount}` : "Tất cả";
  }

  clearMultiFilter(filterKey: OutStockMultiFilterKey, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.multiFilters[filterKey] = [];
    this.resetVisibleRows();
  }

  clearTableFilters(): void {
    this.textFilters = {
      productName: "",
      productCode: "",
    };
    this.multiFilters = {
      quantityText: [],
      unit: [],
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
      this.outStockCacheStatus = `Đang tải dữ liệu cho ${shop.ShopCode}. Chị có thể chuyển tab, web sẽ không gọi lặp API.`;
      return;
    }

    const cacheKey = this.getCacheKey(shop.ShopCode, session.UserInfo.uPharmaID);

    if (!forceReload) {
      const cachedData = await this.readOutStockCache(cacheKey);

      if (cachedData) {
        this.applyShopRows(shop.ShopCode, cachedData.rows);
        this.loadedShopKeys.add(loadedShopKey);
        this.outStockCacheStatus = `Đang hiển thị dữ liệu đã lưu lúc ${this.formatCacheTime(cachedData.savedAt)}. Hệ thống đang cập nhật dữ liệu mới...`;
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
      this.outStockRefreshing = true;
      this.loadingProgress = Math.max(this.loadingProgress, 30);
    } else {
      this.outStockRefreshing = true;
      this.loadingProgress = 15;
      this.outStockCacheStatus = "Đang lấy dữ liệu hàng đã hết cho shop đang xem...";
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
      const shopRows = this.filterRowsBySelectedDateRange(this.extractArray(response))
        .map((row, index) => this.normalizeSalesSpeedRow(row, shop, index))
        .filter((row) => !row.productCode.trim().toUpperCase().startsWith("Y"))
        .sort((first, second) => PRODUCT_NAME_COLLATOR.compare(first.productName, second.productName));
      this.loadingProgress = 92;

      this.applyShopRows(shop.ShopCode, shopRows);
      this.loadedShopKeys.add(this.getLoadedShopKey(shop.ShopCode));
      await this.writeOutStockCache({
        cacheKey,
        rows: shopRows,
        savedAt: Date.now(),
      });
      this.outStockCacheStatus = `Dữ liệu hàng đã hết đã cập nhật lúc ${this.formatCacheTime(Date.now())}.`;
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      if (this.rows.some((row) => row.shopCode === shop.ShopCode)) {
        this.outStockCacheStatus = "Chưa cập nhật được dữ liệu mới, vẫn đang hiển thị dữ liệu đã lưu.";
      }
      this.loadingProgress = 100;
    } finally {
      this.loadingShopKeys.delete(loadedShopKey);
      this.outStockRefreshing = this.loadingShopKeys.size > 0;
    }
  }

  private applyShopRows(shopCode: string, shopRows: OutOfStockItem[]): void {
    this.rows = [
      ...this.rows.filter((row) => row.shopCode !== shopCode),
      ...shopRows,
    ];
  }

  private setDefaultDateRange(): void {
    if (this.timeStart && this.timeEnd) {
      return;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);

    this.timeStart = this.upharmaService.formatUpharmaDateTime(todayStart);
    this.timeEnd = this.upharmaService.formatUpharmaDateTime(todayEnd);
    this.startDateInput = this.toDateTimeLocalValue(todayStart);
    this.endDateInput = this.toDateTimeLocalValue(todayEnd);
  }

  private getLoadedShopKey(shopCode: string): string {
    return `${shopCode}:${this.timeStart}:${this.timeEnd}`;
  }

  private getCacheKey(shopCode: string, uPharmaID: number): string {
    return [
      "out-stock",
      "v2",
      uPharmaID,
      shopCode,
      this.timeStart,
      this.timeEnd,
    ].join("|");
  }

  private async readOutStockCache(cacheKey: string): Promise<OutOfStockCacheEntry | null> {
    try {
      const db = await this.openOutStockCacheDb();
      const cachedData = await new Promise<OutOfStockCacheEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("outStockCache", "readonly");
        const request = transaction.objectStore("outStockCache").get(cacheKey);

        request.onsuccess = () => resolve(request.result as OutOfStockCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });

      db.close();
      return cachedData || null;
    } catch (error) {
      console.warn("Không đọc được cache hàng hết kho:", error);
      return null;
    }
  }

  private async writeOutStockCache(cacheEntry: OutOfStockCacheEntry): Promise<void> {
    try {
      const db = await this.openOutStockCacheDb();

      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("outStockCache", "readwrite");
        const request = transaction.objectStore("outStockCache").put(cacheEntry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      db.close();
    } catch (error) {
      console.warn("Không lưu được cache hàng hết kho:", error);
    }
  }

  private openOutStockCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-out-stock-cache", 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("outStockCache")) {
          db.createObjectStore("outStockCache", { keyPath: "cacheKey" });
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

  private matchesColumnFilters(row: OutOfStockItem, activeIndex: number): boolean {
    const textTargets: Record<OutStockTextFilterKey, string> = {
      productName: row.productName,
      productCode: row.productCode,
    };

    for (const [key, filterValue] of Object.entries(this.textFilters) as [OutStockTextFilterKey, string][]) {
      const normalizedFilter = normalizeFilterText(filterValue);

      if (normalizedFilter && !normalizeFilterText(textTargets[key]).includes(normalizedFilter)) {
        return false;
      }
    }

    for (const [key, selectedValues] of Object.entries(this.multiFilters) as [OutStockMultiFilterKey, string[]][]) {
      if (selectedValues.length > 0 && !selectedValues.includes(String(row[key] || "--"))) {
        return false;
      }
    }

    return true;
  }

  private getMultiFilterOptions(filterKey: OutStockMultiFilterKey): string[] {
    const values = this.rows
      .filter((row) => row.shopCode === this.activeShopCode)
      .map((row) => String(row[filterKey] || "--"))
      .filter((value) => value.trim());

    return Array.from(new Set(values)).sort((first, second) => {
      const firstNumber = Number(first.replaceAll(",", "."));
      const secondNumber = Number(second.replaceAll(",", "."));

      if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
        return firstNumber - secondNumber;
      }

      return first.localeCompare(second, "vi", { numeric: true });
    });
  }

  private normalizeSalesSpeedRow(row: RawRecord, shop: ShopInfo, rowIndex: number): OutOfStockItem {
    const productName = String(
      this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"]),
    ).trim();
    const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]));
    const quantity = this.pick(row, [
      "QuantityExist",
      "ExistQuantity",
      "Quantity",
      "Qty",
      "SL",
      "SoLuong",
      "TonKho",
      "InventoryQuantity",
      "RemainQty",
    ]);
    const unit = String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"]));
    const quantityText = quantity === "" ? "--" : String(quantity);
    const zeroStock = this.toNumber(quantity) === 0;
    const item = {
      rowKey: [shop.ShopCode, productCode, productName, rowIndex].join("|"),
      shopCode: shop.ShopCode,
      productName,
      productCode,
      quantityText,
      zeroStock,
      unit,
      searchText: "",
      expanded: false,
    };

    item.searchText = normalizeFilterText(
      [
        item.shopCode,
        item.productName,
        item.productCode,
        item.quantityText,
        item.unit,
        formatMoney(this.pick(row, ["UnitPrice", "Price", "Gia", "GiaBan"])),
      ].join(" "),
    );

    return item;
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
    const rowStart = this.parseDateTimeValue(
      this.pick(row, ["TimeBegin", "TimeStart", "BeginTime", "StartTime", "FromDate", "DateFrom"]),
    );
    const rowEnd = this.parseDateTimeValue(
      this.pick(row, ["TimeEnd", "EndTime", "FinishTime", "ToDate", "DateTo"]),
    );

    if (rowStart !== null || rowEnd !== null) {
      const start = rowStart ?? rowEnd;
      const end = rowEnd ?? rowStart;

      if (start !== null && end !== null) {
        return {
          start,
          end,
        };
      }
    }

    const rowDate = this.parseDateTimeValue(this.pick(row, [
      "TimeStart",
      "TimeBegin",
      "LastSaleDate",
      "LastDate",
      "NgayBanCuoi",
      "DateSellLast",
      "InvoiceDate",
      "SaleDate",
      "CreateDate",
      "CreatedDate",
      "OrderDate",
      "Date",
      "Ngay",
    ]));

    return rowDate === null ? null : { start: rowDate, end: rowDate };
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

  private formatDisplayDate(value: unknown): string {
    if (!value) {
      return "--";
    }

    const text = String(value);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }

    return text;
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
    if (typeof value === "number") {
      return value;
    }

    const normalizedValue = String(value ?? "").replace(",", ".").trim();

    return Number(normalizedValue);
  }
}
