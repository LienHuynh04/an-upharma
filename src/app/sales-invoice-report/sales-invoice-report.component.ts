import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  UNDER_12_MONTHS_DAYS,
  UNDER_3_MONTHS_DAYS,
  UNDER_6_MONTHS_DAYS,
} from "../inventory-utils";
import { ShopInfo, UpharmaService, RawRecord } from "../upharma.service";

type RangeKey = "3m" | "6m" | "12m";

interface SalesInvoiceReportItem {
  rowKey: string;
  employeeName: string;
  productCode: string;
  expiryDaysAtSale: number | null;
  expiryDateText: string;
  shopCode: string;
  saleDateText: string;
  amount: number;
  raw: RawRecord;
}

interface EmployeeReportSummary {
  employeeName: string;
  rowCount: number;
  totalAmount: number;
}

interface SalesInvoiceReportCacheEntry {
  savedAt: number;
  shopCode: string;
  dateKey: string;
  items: SalesInvoiceReportItem[];
}

@Component({
  selector: "app-sales-invoice-report",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="page-wrapper">
  <div class="page-header d-print-none">
    <div class="container-xl">
      <div class="row g-2 align-items-center">
        <div class="col">
          <div class="page-pretitle">BÁO CÁO</div>
          <h2 class="page-title">Báo cáo đơn hàng</h2>
        </div>
      </div>
    </div>
  </div>

  <div class="page-body">
    <div class="container-xl">
      <div class="card mb-3">
        <div class="card-body">
          <div class="row g-3 align-items-end">
            <div class="col-md-4">
              <label class="form-label">Nhà thuốc</label>
              <select class="form-select" [(ngModel)]="selectedShopCode" name="selectedShopCode">
                <option *ngFor="let shop of shops" [ngValue]="shop.ShopCode">{{ shop.ShopCode }} - {{ shop.ShopName }}</option>
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label">Khoảng lọc</label>
              <div class="btn-group w-100" role="group">
                <button
                  *ngFor="let option of rangeChoices"
                  type="button"
                  class="btn"
                  [class.btn-primary]="selectedRange === option.key"
                  [class.btn-outline-primary]="selectedRange !== option.key"
                  (click)="selectRange(option.key)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="col-md-2">
              <button class="btn btn-primary w-100" type="button" [disabled]="loading || !selectedShopCode" (click)="loadData(true)">
                {{ loading ? "Đang tải..." : "Làm mới" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="alert alert-info d-flex align-items-center" *ngIf="loading">
        <div class="spinner-border spinner-border-sm me-2" role="status"></div>
        <strong>Đang lấy báo cáo đơn hàng...</strong>
      </div>

      <div class="alert alert-danger" role="alert" *ngIf="errorText">
        <h4 class="alert-title">Không thể lấy báo cáo</h4>
        <div class="text-secondary">{{ errorText }}</div>
      </div>

      <ng-container *ngIf="!loading && !errorText">
        <div class="mb-3 d-flex align-items-end justify-content-between">
          <div>
            <h2 class="h3 mb-1" id="employeeSummaryTitle">Tổng quan theo nhân viên</h2>
            <p class="text-secondary mb-0">Chọn một nhân viên để làm nổi bật nhanh số lượng và tổng tiền.</p>
          </div>
          <span class="badge bg-primary-lt">{{ employeeSummaries.length }} nhân viên</span>
        </div>
        
        <div class="row row-deck row-cards mb-3">
          <div class="col-sm-6 col-lg-3">
            <div 
              class="card cursor-pointer" 
              style="cursor: pointer;"
              [class.bg-primary-lt]="!selectedEmployeeName"
              (click)="selectEmployee('')"
            >
              <div class="card-body">
                <div class="d-flex align-items-center">
                  <div class="subheader">Tất cả nhân viên</div>
                </div>
                <div class="h1 mb-3">{{ allEmployeeTotalAmount | number:'1.0-0' }} đ</div>
              </div>
            </div>
          </div>
          
          <div class="col-sm-6 col-lg-3" *ngFor="let summary of employeeSummaries; trackBy: trackByEmployeeSummary">
            <div 
              class="card cursor-pointer"
              style="cursor: pointer;"
              [class.bg-primary-lt]="selectedEmployeeName === summary.employeeName"
              [attr.title]="summary.employeeName"
              (click)="selectEmployee(summary.employeeName)"
            >
              <div class="card-body">
                <div class="d-flex align-items-center">
                  <div class="subheader text-truncate" [title]="summary.employeeName">{{ summary.employeeName }}</div>
                </div>
                <div class="h1 mb-3">{{ summary.totalAmount | number:'1.0-0' }} đ</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card" *ngIf="items.length === 0">
          <div class="card-body text-center py-5">
            <h3 class="card-title">Không có dữ liệu phù hợp bộ lọc</h3>
            <p class="text-secondary">Thử đổi nhà thuốc, chọn lại khoảng hạn hoặc bấm Làm mới để lấy dữ liệu mới nhất.</p>
          </div>
        </div>
      </ng-container>
    </div>
  </div>
</div>
  `,
  styles: [],
})
export class SalesInvoiceReportComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetReportSalesByShop";
  readonly rangeOptions: Record<RangeKey, number> = {
    "3m": 3,
    "6m": 6,
    "12m": 12,
  };
  readonly rangeChoices: { key: RangeKey; label: string }[] = [
    { key: "3m", label: "3 tháng" },
    { key: "6m", label: "6 tháng" },
    { key: "12m", label: "12 tháng" },
  ];
  readonly thresholdDays: Record<RangeKey, number> = {
    "3m": UNDER_3_MONTHS_DAYS,
    "6m": UNDER_6_MONTHS_DAYS,
    "12m": UNDER_12_MONTHS_DAYS,
  };
  shops: ShopInfo[] = [];
  selectedShopCode = "";
  selectedEmployeeName = "";
  selectedRange: RangeKey = "3m";
  loading = false;
  hasLoaded = false;
  errorText = "";
  reportCacheStatus = "";
  items: SalesInvoiceReportItem[] = [];
  private allItems: SalesInvoiceReportItem[] = [];
  private readonly cacheStorageKeyPrefix = "upharma_sales_invoice_report_cache_v1";
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000;

  constructor(private readonly upharmaService: UpharmaService) {}

  ngOnInit(): void {
    this.shops = this.upharmaService.getActiveShops();
    this.selectedShopCode = this.shops.find((shop) => shop.ShopCode === "SHOP0025")?.ShopCode || this.shops[0]?.ShopCode || "";
    void this.loadData();
  }

  get selectedRangeLabel(): string {
    return `${this.rangeOptions[this.selectedRange]} tháng`;
  }

  get selectedDateRangeLabel(): string {
    const { start, end } = this.getRangeDates();
    return `${this.formatDisplayDate(start)} đến ${this.formatDisplayDate(end)}`;
  }

  get employeeOptions(): string[] {
    return [...new Set(this.allItems.map((item) => item.employeeName).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, "vi"));
  }

  get filteredTotalAmount(): number {
    return this.items.reduce((total, item) => total + item.amount, 0);
  }

  get filteredRowCount(): number {
    return this.items.length;
  }

  get selectedEmployeeSummary(): EmployeeReportSummary | null {
    if (!this.selectedEmployeeName) {
      return null;
    }

    return this.employeeSummaries.find((summary) => summary.employeeName === this.selectedEmployeeName) || null;
  }

  get employeeSummaries(): EmployeeReportSummary[] {
    const summaries = new Map<string, EmployeeReportSummary>();

    for (const item of this.allItems) {
      if (!item.employeeName || !this.matchesExpiryRange(item, this.selectedRange)) {
        continue;
      }

      const current = summaries.get(item.employeeName) || {
        employeeName: item.employeeName,
        rowCount: 0,
        totalAmount: 0,
      };
      current.rowCount += 1;
      current.totalAmount += item.amount;
      summaries.set(item.employeeName, current);
    }

    return [...summaries.values()].sort((first, second) =>
      first.employeeName.localeCompare(second.employeeName, "vi"),
    );
  }

  get allEmployeeRowCount(): number {
    return this.employeeSummaries.reduce((total, summary) => total + summary.rowCount, 0);
  }

  get allEmployeeTotalAmount(): number {
    return this.employeeSummaries.reduce((total, summary) => total + summary.totalAmount, 0);
  }

  getRangeItemCount(range: RangeKey): number {
    return this.allItems.filter((item) => this.matchesFilters(item, range)).length;
  }

  selectRange(range: RangeKey): void {
    this.selectedRange = range;
    this.applyExpiryFilter();
  }

  onEmployeeFilterChange(): void {
    this.applyExpiryFilter();
  }

  selectEmployee(employeeName: string): void {
    this.selectedEmployeeName = employeeName;
    this.applyExpiryFilter();
  }

  trackByEmployeeSummary(_: number, summary: EmployeeReportSummary): string {
    return summary.employeeName;
  }

  trackByRow(_: number, item: SalesInvoiceReportItem): string {
    return item.rowKey;
  }

  async loadData(forceRefresh = false): Promise<void> {
    if (!this.selectedShopCode) {
      this.items = [];
      return;
    }

    this.loading = true;
    this.errorText = "";
    this.reportCacheStatus = "";

    try {
      const session = this.upharmaService.ensureLogin();
      const { start, end } = this.getRangeDates();
      const payload = {
        uPharmaID: session.UserInfo.uPharmaID,
        Token: session.Token,
        TimeStart: this.formatDateTime(start),
        TimeEnd: this.formatDateTime(end),
        ShopCode: this.selectedShopCode,
      };
      const cacheKey = this.getCacheKey(session.UserInfo.uPharmaID, this.selectedShopCode, end);
      const cachedEntry = forceRefresh ? null : this.readCache(cacheKey);

      if (cachedEntry) {
        this.applyCachedItems(cachedEntry.items);
        this.reportCacheStatus = `Đang hiển thị cache local lúc ${this.formatCacheTime(cachedEntry.savedAt)}.`;
        this.loading = false;
        return;
      }

      await this.refreshFromApi(payload, cacheKey, forceRefresh);
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.allItems = [];
      this.items = [];
      this.reportCacheStatus = "";
    } finally {
      this.loading = false;
      this.hasLoaded = true;
    }
  }

  private async refreshFromApi(payload: RawRecord, cacheKey: string, forceRefresh: boolean): Promise<void> {
    const response = await this.upharmaService.callEndpoint<RawRecord>(this.endpoint, payload, {
      cache: true,
      forceRefresh,
    });

    const rawRows = this.extractRows(response);
    const normalizedItems = rawRows
      .map((row, index) => this.normalizeRow(row, index))
      .filter((item) => Boolean(item.employeeName || item.productCode));

    this.applyCachedItems(normalizedItems);
    this.writeCache(cacheKey, normalizedItems);
    this.reportCacheStatus = `Đã cập nhật cache local lúc ${this.formatCacheTime(Date.now())}.`;
  }

  private normalizeRow(row: RawRecord, index: number): SalesInvoiceReportItem {
    const employeeName = this.pick(row, ["SalesName", "EmployeeName", "StaffName", "SalesStaffName", "UserName", "FullName", "Employee", "EmpName", "SellerName"]);
    const productCode = this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]);
    const expiryDate = this.pick(row, ["ExpirationDate", "ExpDate", "ExpiryDate", "ExpiredDate", "ExpireDate", "ExpDateTxt", "ExpDateText", "ExpiryDateText", "DateExpire", "DateExpired", "DateExp", "HSD", "HanDung", "LotExpireDate", "BatchExpDate"]);
    const saleDate = this.pick(row, ["OrderDate", "SaleDate", "InvoiceDate", "PostingDate", "DateCreate", "TimeCreate", "CreatedDate", "TimeInvoice"]);
    const amount = this.pick(row, ["AmountIncludingVAT", "AmountIncludingAdjust", "Amount", "TotalAmount", "ThanhTien"]);
    return {
      rowKey: `${productCode}|${employeeName}|${index}`,
      employeeName: String(employeeName || "").trim(),
      productCode: String(productCode || "").trim(),
      expiryDaysAtSale: this.calculateInclusiveDays(saleDate, expiryDate),
      expiryDateText: this.formatAnyDate(expiryDate),
      shopCode: this.selectedShopCode,
      saleDateText: this.formatAnyDate(saleDate),
      amount: this.parseNumber(amount),
      raw: row,
    };
  }

  private applyExpiryFilter(): void {
    this.items = this.allItems.filter((item) => this.matchesFilters(item, this.selectedRange));
  }

  private applyCachedItems(items: SalesInvoiceReportItem[]): void {
    this.allItems = items;
    if (!this.employeeOptions.includes(this.selectedEmployeeName)) {
      this.selectedEmployeeName = "";
    }
    this.applyExpiryFilter();
  }

  private matchesFilters(item: SalesInvoiceReportItem, range: RangeKey): boolean {
    if (this.selectedEmployeeName && item.employeeName !== this.selectedEmployeeName) {
      return false;
    }

    return this.matchesExpiryRange(item, range);
  }

  private matchesExpiryRange(item: SalesInvoiceReportItem, range: RangeKey): boolean {
    if (item.expiryDaysAtSale === null) {
      return false;
    }

    return item.expiryDaysAtSale >= 1
      && item.expiryDaysAtSale <= this.thresholdDays[range];
  }

  private parseNumber(value: unknown): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    const normalized = String(value ?? "")
      .replaceAll(" ", "")
      .replaceAll(",", "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private calculateInclusiveDays(saleValue: unknown, expiryValue: unknown): number | null {
    const saleDate = this.parseAnyDate(saleValue);
    const expiryDate = this.parseAnyDate(expiryValue);

    if (!saleDate || !expiryDate) {
      return null;
    }

    // Dùng UTC từ phần ngày để thời gian trong ngày và DST không làm sai lệch kết quả.
    const saleDay = Date.UTC(saleDate.getFullYear(), saleDate.getMonth(), saleDate.getDate());
    const expiryDay = Date.UTC(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
    const millisecondsPerDay = 24 * 60 * 60 * 1000;

    return Math.abs(Math.round((saleDay - expiryDay) / millisecondsPerDay)) + 1;
  }

  private extractRows(response: RawRecord): RawRecord[] {
    const preferredKeys = [
      "SalesInvoiceLst",
      "ReportSalesLst",
      "SalesReportLst",
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
      const value = response[key];
      if (Array.isArray(value)) {
        return this.expandRows(value);
      }
    }

    for (const value of Object.values(response)) {
      if (Array.isArray(value)) {
        return this.expandRows(value);
      }
    }

    return [];
  }

  private expandRows(value: unknown[]): RawRecord[] {
    const childKeys = ["SalesLineLst", "OrderLineLst", "ProductLst", "DetailLst", "Details", "Items", "items"];
    const expanded: RawRecord[] = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const parent = entry as RawRecord;
      const childList = childKeys
        .map((key) => parent[key])
        .find((candidate): candidate is unknown[] => Array.isArray(candidate));

      if (!childList?.length) {
        expanded.push(parent);
        continue;
      }

      for (const child of childList) {
        if (child && typeof child === "object" && !Array.isArray(child)) {
          expanded.push({ ...parent, ...(child as RawRecord) });
        }
      }
    }

    return expanded;
  }

  private pick(row: RawRecord, keys: string[]): unknown {
    const normalizedMap = new Map(
      Object.keys(row || {}).map((key) => [key.toLowerCase().replaceAll("_", ""), key]),
    );

    for (const key of keys) {
      const direct = row[key];
      if (direct !== undefined && direct !== null && direct !== "") {
        return direct;
      }

      const normalizedKey = key.toLowerCase().replaceAll("_", "");
      const matchedKey = normalizedMap.get(normalizedKey);
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
        return row[matchedKey];
      }
    }

    return "";
  }

  private formatAnyDate(value: unknown): string {
    const date = this.parseAnyDate(value);
    if (!date) return value ? String(value).trim() : "";

    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date).replaceAll("/", "-");
  }

  private parseAnyDate(value: unknown): Date | null {
    if (!value) return null;

    const text = String(value).trim();
    const aspNet = text.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//);
    const vietnameseDate = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    const date = aspNet
      ? new Date(Number(aspNet[1]))
      : vietnameseDate
        ? new Date(Number(vietnameseDate[3]), Number(vietnameseDate[2]) - 1, Number(vietnameseDate[1]))
        : new Date(text.replace(" ", "T"));

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private getRangeDates(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  private formatDisplayDate(date: Date): string {
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  private formatDateTime(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private getCacheKey(userId: number, shopCode: string, endDate: Date): string {
    const dateKey = [
      endDate.getFullYear(),
      String(endDate.getMonth() + 1).padStart(2, "0"),
      String(endDate.getDate()).padStart(2, "0"),
    ].join("-");

    return `${this.cacheStorageKeyPrefix}:${userId}:${shopCode}:${dateKey}`;
  }

  private readCache(cacheKey: string): SalesInvoiceReportCacheEntry | null {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) {
        return null;
      }

      const entry = JSON.parse(raw) as SalesInvoiceReportCacheEntry;
      if (!entry.savedAt || !Array.isArray(entry.items) || Date.now() - entry.savedAt > this.cacheTtlMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return entry;
    } catch {
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  private writeCache(cacheKey: string, items: SalesInvoiceReportItem[]): void {
    try {
      const entry: SalesInvoiceReportCacheEntry = {
        savedAt: Date.now(),
        shopCode: this.selectedShopCode,
        dateKey: this.getTodayKey(),
        items,
      };
      localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
      // Cache is optional; ignore storage failures.
    }
  }

  private getTodayKey(): string {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
  }

  private formatCacheTime(timestamp: number): string {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(timestamp));
  }
}
