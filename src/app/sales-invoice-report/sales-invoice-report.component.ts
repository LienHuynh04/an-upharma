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
<div class="page-inner sales-invoice-report-page">
  <section class="report-hero">
      <h1>Lấy báo cáo đơn hàng</h1>
  </section>

  <section class="report-controls">
    <label class="control-field">
      <span>Nhà thuốc</span>
      <select [(ngModel)]="selectedShopCode" name="selectedShopCode">
        <option *ngFor="let shop of shops" [ngValue]="shop.ShopCode">{{ shop.ShopCode }} - {{ shop.ShopName }}</option>
      </select>
    </label>

    <div class="range-field">
      <span>Khoảng lọc</span>
      <div class="range-options" aria-label="Lọc hạn khi bán">
        <button
          *ngFor="let option of rangeChoices"
          type="button"
          [class.is-active]="selectedRange === option.key"
          (click)="selectRange(option.key)"
        >
          <strong>{{ option.label }}</strong>
          <small>{{ getRangeItemCount(option.key) }} dòng</small>
        </button>
      </div>
    </div>

    <button class="view-button report-action-button" type="button" [disabled]="loading || !selectedShopCode" (click)="loadData(true)">
      {{ loading ? "Đang tải..." : "Làm mới" }}
    </button>
  </section>

  <div class="employee-plan-loading report-loading" *ngIf="loading">
    <span class="loader" aria-hidden="true"></span>
    <strong>Đang lấy báo cáo đơn hàng...</strong>
  </div>

  <div class="report-error" role="alert" *ngIf="errorText">
    <strong>Không thể lấy báo cáo</strong>
    <span>{{ errorText }}</span>
  </div>

  <section class="report-metrics" *ngIf="!loading && !errorText">
    <article class="summary-card summary-card--amount">
      <span>Tổng giá trị</span>
      <strong>{{ allEmployeeTotalAmount | number:'1.0-0' }} đ</strong>
      <small>{{ selectedRangeLabel }} · {{ selectedDateRangeLabel }}</small>
    </article>
    <article class="summary-card">
      <span>Số dòng</span>
      <strong>{{ allEmployeeRowCount }}</strong>
      <small>Đã lọc theo hạn bán</small>
    </article>
    <article class="summary-card">
      <span>Nhân viên</span>
      <strong>{{ employeeSummaries.length }}</strong>
      <small>Đang có dữ liệu</small>
    </article>
    <article class="summary-card">
      <span>Đang chọn</span>
      <strong>{{ selectedEmployeeName || "Tất cả" }}</strong>
      <small *ngIf="selectedEmployeeSummary; else allEmployeeState">{{ selectedEmployeeSummary.rowCount }} dòng · {{ selectedEmployeeSummary.totalAmount | number:'1.0-0' }} đ</small>
      <ng-template #allEmployeeState>
        <small>{{ filteredRowCount }} dòng · {{ filteredTotalAmount | number:'1.0-0' }} đ</small>
      </ng-template>
    </article>
  </section>

  <section class="shop-filter-section employee-summary-section" *ngIf="!loading && !errorText" aria-labelledby="employeeSummaryTitle">
    <div class="section-head">
      <div>
        <h2 id="employeeSummaryTitle">Tổng quan theo nhân viên</h2>
        <p>Chọn một nhân viên để làm nổi bật nhanh số dòng và tổng tiền.</p>
      </div>
      <strong>{{ employeeSummaries.length }} nhân viên</strong>
    </div>
    <div class="employee-summary-grid">
      <button
        class="shop-filter-card employee-summary-card"
        type="button"
        [class.is-active]="!selectedEmployeeName"
        (click)="selectEmployee('')"
      >
        <span class="shop-filter-copy">
          <b>Tất cả nhân viên</b>
          <small>{{ allEmployeeRowCount }} dòng</small>
        </span>
        <strong>{{ allEmployeeTotalAmount | number:'1.0-0' }} đ</strong>
      </button>
      <button
        *ngFor="let summary of employeeSummaries; trackBy: trackByEmployeeSummary"
        class="shop-filter-card employee-summary-card"
        type="button"
        [class.is-active]="selectedEmployeeName === summary.employeeName"
        [attr.title]="summary.employeeName"
        (click)="selectEmployee(summary.employeeName)"
      >
        <span class="shop-filter-copy">
          <b>{{ summary.employeeName }}</b>
          <small>{{ summary.rowCount }} dòng</small>
        </span>
        <strong>{{ summary.totalAmount | number:'1.0-0' }} đ</strong>
      </button>
    </div>
  </section>

  <section class="report-empty-state" *ngIf="!loading && !errorText && items.length === 0">
    <strong>Không có dữ liệu phù hợp bộ lọc</strong>
    <p>Thử đổi nhà thuốc, chọn lại khoảng hạn hoặc bấm Làm mới để lấy dữ liệu mới nhất.</p>
  </section>
</div>
  `,
  styles: [`
    .sales-invoice-report-page { display: grid; gap: 14px; color: #f4eadc; }
    .report-hero { display: flex; align-items: center; min-height: 76px; padding: 18px 20px; border: 1px solid rgba(255,255,255,.08); border-radius: 20px; background: linear-gradient(135deg, rgba(25, 18, 12, .96), rgba(53, 33, 17, .92)); box-shadow: 0 18px 40px rgba(0,0,0,.28); }
    .report-hero h1 { margin: 0; font-size: clamp(22px, 3vw, 32px); line-height: 1.08; color: #fff3e0; letter-spacing: .01em; }
    .report-controls { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr) auto; gap: 12px; align-items: end; padding: 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: linear-gradient(180deg, rgba(31, 23, 16, .96), rgba(20, 15, 10, .96)); box-shadow: 0 16px 32px rgba(0,0,0,.22); }
    .control-field, .range-field { display: grid; gap: 7px; color: #c9b9a8; font-size: 10px; font-weight: 800; }
    .control-field select { min-height: 42px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(255,255,255,.04); color: #f6ebde; padding: 0 12px; font: inherit; }
    .range-field { min-width: 0; }
    .range-field .range-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .range-field .range-options button { display: grid; gap: 2px; min-height: 42px; padding: 8px 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; color: #d2c2b3; background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02)); font: inherit; cursor: pointer; text-align: left; }
    .range-field .range-options button strong { font-size: 11px; color: #f4eadc; }
    .range-field .range-options button small { color: #b7a995; font-size: 9px; }
    .range-field .range-options button.is-active { border-color: rgba(236, 176, 96, .35); color: #ffe7c2; background: linear-gradient(135deg, rgba(84, 53, 23, .92), rgba(47, 29, 11, .92)); box-shadow: 0 10px 22px rgba(0,0,0,.28); }
    .view-button { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; border: 1px solid rgba(236, 176, 96, .48); border-radius: 12px; padding: 0 16px; color: #fff3e0; background: linear-gradient(135deg, #7c4d1e, #c98c1f); box-shadow: 0 12px 24px rgba(0,0,0,.24); font-size: 10px; font-weight: 900; cursor: pointer; }
    .view-button:not(:disabled):hover { transform: translateY(-1px); }
    .report-loading { min-height: 110px; border: 1px solid rgba(255,255,255,.08); border-radius: 16px; background: linear-gradient(180deg, rgba(31,23,16,.96), rgba(19,14,10,.96)); box-shadow: 0 16px 32px rgba(0,0,0,.22); color: #d8c7b3; }
    .report-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .summary-card { display: grid; gap: 5px; background: linear-gradient(180deg, rgba(31,23,16,.98), rgba(22,16,11,.98)); border: 1px solid rgba(255,255,255,.08); border-radius: 16px; padding: 14px; box-shadow: 0 16px 32px rgba(0,0,0,.22); }
    .summary-card span, .section-head p, .report-empty-state p { color: #c9b9a8; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .summary-card strong { font-size: 18px; color: #fff4e2; line-height: 1.1; }
    .summary-card small { color: #c1b09d; font-size: 10px; }
    .summary-card--amount { border-color: rgba(236, 176, 96, .24); background: linear-gradient(180deg, rgba(42,27,12,.98), rgba(24,15,9,.98)); }
    .summary-card--amount strong { color: #ffd08b; }
    .report-error { display: grid; gap: 4px; padding: 14px 16px; border: 1px solid rgba(255, 110, 110, .22); border-radius: 14px; color: #ffb3b3; background: rgba(130, 31, 31, .24); font-size: 11px; }
    .report-error strong { font-size: 12px; }
    .section-head { display: flex; align-items: end; justify-content: space-between; gap: 12px; padding: 0 4px; }
    .section-head h2 { margin: 0; font-size: 18px; color: #fff2df; }
    .section-head p { margin: 4px 0 0; text-transform: none; letter-spacing: 0; font-weight: 600; }
    .section-head strong { color: #ffd08b; font-size: 11px; font-weight: 900; white-space: nowrap; }
    .employee-summary-section { display: grid; gap: 12px; padding: 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: linear-gradient(180deg, rgba(30,22,16,.98), rgba(17,12,8,.98)); box-shadow: 0 16px 32px rgba(0,0,0,.22); }
    .employee-summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .employee-summary-card { min-height: 72px; align-items: center; }
    .employee-summary-card .shop-filter-copy b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .employee-summary-card > strong { max-width: 46%; color: #ffd08b; font-size: 12px; text-align: right; }
    .employee-summary-card.is-active { border-color: rgba(236, 176, 96, .28); background: linear-gradient(180deg, rgba(52,33,14,.98), rgba(31,21,11,.98)); }
    .report-empty-state { display: grid; gap: 6px; padding: 20px; border: 1px dashed rgba(255,255,255,.12); border-radius: 18px; background: linear-gradient(180deg, rgba(24,18,12,.96), rgba(16,12,8,.96)); text-align: center; }
    .report-empty-state strong { font-size: 14px; color: #fff3e0; }
    .report-empty-state p { margin: 0; }
    @media (max-width: 900px) {
      .report-hero, .report-controls, .report-metrics, .employee-summary-grid { grid-template-columns: 1fr; }
      .report-controls { align-items: stretch; }
      .range-field .range-options { grid-template-columns: 1fr; }
      .section-head { align-items: flex-start; flex-direction: column; }
      .view-button { width: 100%; }
    }
  `],
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
