import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ShopInfo, ShopPlanApiItem, ShopPlanApiResponse, UpharmaService } from "../upharma.service";

interface ShopPlanMonthMetric {
  actual: number;
  target: number;
  percentage: number | null;
  evaluationType: "higher-is-better" | "lower-is-better";
  status: "success" | "warning" | "danger" | "neutral";
  statusText: string;
}

interface ShopPlanCustomerLevelViewModel {
  level: number;
  target: number;
  actual: number;
  percentage: number | null;
  status: "success" | "warning" | "danger" | "neutral";
}

interface ShopPlanMonthViewModel {
  rowId?: number;
  shopCode: string;
  year: number;
  month: number;
  hasData: boolean;
  status: number;
  statusLabel: string;
  createdAt?: string;
  modifiedAt?: string;
  approvedAt?: string;
  displayedTime?: string;
  approverName?: string;
  revenue?: ShopPlanMonthMetric;
  hhs?: ShopPlanMonthMetric;
  averageBill?: ShopPlanMonthMetric;
  customers?: {
    total: ShopPlanMonthMetric;
    newCustomer: ShopPlanMonthMetric;
    oldCustomer: ShopPlanMonthMetric;
  };
  invoice?: ShopPlanMonthMetric;
  sku?: ShopPlanMonthMetric;
  slowSales?: ShopPlanMonthMetric;
  quantityHhs?: number;
  hhsSkuRatio?: number | null;
  customerLevels?: ShopPlanCustomerLevelViewModel[];
  raw?: ShopPlanApiItem;
}

interface ShopPlanCacheEntry {
  loadedAt: number;
  months: ShopPlanMonthViewModel[];
}

const STATUS_LABELS: Record<number, string> = {
  1: "Mới tạo",
  3: "Đã duyệt",
};

@Component({
  selector: "app-shop-plan",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="page-inner employee-plan-page">
  <section class="employee-plan-hero">
    <div class="hero-meta">
      <label>
        Năm
        <select [(ngModel)]="year" name="selectedYear" (ngModelChange)="setYear($event)">
          <option *ngFor="let yearOption of yearOptions" [ngValue]="yearOption">{{ yearOption }}</option>
        </select>
      </label>
      <button class="view-button" type="button" (click)="reloadActiveShop()">Tải lại</button>
    </div>
  </section>

  <section class="employee-plan-tabs" *ngIf="tabs.length > 0">
    <button
      type="button"
      *ngFor="let tab of tabs"
      class="shop-tab"
      [class.is-active]="activeShopCode === tab.shopCode"
      (click)="setActiveShop(tab.shopCode)"
    >
      <span class="tab-code">{{ tab.shopCode }}</span>
      <strong>{{ tab.shopName }}</strong>
      <small>{{ tab.loaded ? "Đã tải" : tab.loading ? "Đang tải" : "Chưa tải" }}</small>
    </button>
  </section>

  <section class="employee-plan-state" *ngIf="!activeShopCode">
    <div class="state-card">
      <strong>Không có dữ liệu</strong>
      <p>Chưa có nhà thuốc nào trong phiên đăng nhập.</p>
    </div>
  </section>

  <section class="employee-plan-panel" *ngIf="activeMonth as currentMonth">
    <p class="api-test-error" *ngIf="errorText">{{ errorText }}</p>

    <div class="shop-plan-grid">
      <article class="shop-plan-card" *ngFor="let month of months; trackBy: trackByMonth" (click)="selectMonth(month)">
        <div class="card-top">
          <span class="card-month">Tháng {{ month.month }}</span>
          <div class="card-top-right">
            <span class="card-time">{{ month.displayedTime || "--" }}</span>
            <i class="mdi mdi-percent card-icon"></i>
            <i class="mdi mdi-cog card-icon"></i>
          </div>
        </div>

        <div class="card-status">
          <span class="chip chip--green">{{ month.statusLabel }}</span>
        </div>

        <div class="metric-row" *ngIf="month.revenue">
          <div class="metric-icon-wrap"><i class="mdi mdi-chart-line"></i></div>
          <div class="metric-content">
            <div class="metric-lbl">DOANH SỐ</div>
            <div class="metric-val green">{{ month.revenue.actual | number:'1.0-0' }}</div>
            <div class="metric-sub">{{ month.revenue.target | number:'1.0-0' }}</div>
          </div>
          <div class="pct-circle" [ngClass]="month.revenue.status">{{ month.revenue.statusText }}</div>
        </div>

        <div class="metric-row" *ngIf="month.hhs">
          <div class="metric-icon-wrap"><i class="mdi mdi-cart-outline"></i></div>
          <div class="metric-content">
            <div class="metric-lbl">HHS</div>
            <div class="metric-val green">{{ month.hhs.actual | number:'1.0-0' }}</div>
            <div class="metric-sub">{{ month.hhs.target | number:'1.0-0' }}</div>
          </div>
          <div class="pct-circle" [ngClass]="month.hhs.status">{{ month.hhs.statusText }}</div>
        </div>

        <div class="sec-lbl"><i class="mdi mdi-account-group"></i> Khách hàng</div>
        <div class="cus-grid" *ngIf="month.customers">
          <div class="cus-box cus-box--light"><div class="cus-ttl">Tổng</div><div class="cus-num">{{ month.customers.total.actual | number:'1.0-0' }}</div><div class="cus-real red">{{ month.customers.total.target | number:'1.0-0' }}</div></div>
          <div class="cus-box cus-box--light"><div class="cus-ttl">Cũ</div><div class="cus-num">{{ month.customers.oldCustomer.actual | number:'1.0-0' }}</div><div class="cus-real red">{{ month.customers.oldCustomer.target | number:'1.0-0' }}</div></div>
          <div class="cus-box cus-box--dark"><div class="cus-ttl">Mới</div><div class="cus-num">{{ month.customers.newCustomer.actual | number:'1.0-0' }}</div><div class="cus-real white">{{ month.customers.newCustomer.target | number:'1.0-0' }}</div></div>
        </div>

        <div class="bot-grid">
          <div class="bot-card" *ngIf="month.invoice">
            <div class="bot-ttl">Đơn bán</div>
            <div class="bot-real red">{{ month.invoice.actual | number:'1.0-0' }}</div>
            <div class="bot-tgt">{{ month.invoice.target | number:'1.0-0' }}</div>
            <div class="bot-badge" [ngClass]="month.invoice.status">{{ month.invoice.statusText }}</div>
          </div>
          <div class="bot-card" *ngIf="month.sku">
            <div class="bot-ttl">Mặt hàng</div>
            <div class="bot-real green">{{ month.sku.actual | number:'1.0-0' }}</div>
            <div class="bot-tgt">{{ month.sku.target | number:'1.0-0' }}</div>
            <div class="bot-badge" [ngClass]="month.sku.status">{{ month.sku.statusText }}</div>
          </div>
        </div>
      </article>
    </div>
  </section>
</div>
  `,
})
export class ShopPlanComponent implements OnInit {
  shops: ShopInfo[] = [];
  activeShopCode = "";
  year = new Date().getFullYear();
  loading = false;
  loadingProgress = 10;
  errorText = "";
  userTitle = "Đang tải...";
  selectedMonth = 1;
  detailMonth: ShopPlanMonthViewModel | null = null;
  private readonly cache = new Map<string, ShopPlanCacheEntry>();
  private readonly loadingKeys = new Set<string>();
  months: ShopPlanMonthViewModel[] = this.buildEmptyMonths(this.year, "");

  constructor(
    private readonly upharma: UpharmaService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    void this.bootstrap();
  }

  get tabs(): Array<{ shopCode: string; shopName: string; loaded: boolean; loading: boolean }> {
    return this.shops.map((shop) => ({
      shopCode: shop.ShopCode,
      shopName: shop.ShopName || this.makeShopNameFromCode(shop.ShopCode),
      loaded: this.cache.has(this.getCacheKey(shop.ShopCode, this.year)),
      loading: this.loadingKeys.has(this.getCacheKey(shop.ShopCode, this.year)),
    }));
  }

  get activeShopName(): string {
    const shop = this.shops.find((item) => item.ShopCode === this.activeShopCode);
    return shop?.ShopName || this.makeShopNameFromCode(this.activeShopCode);
  }

  get activeMonth(): ShopPlanMonthViewModel {
    return this.months.find((month) => month.month === this.selectedMonth) || this.months[0];
  }

  get yearOptions(): number[] {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }

  async bootstrap(): Promise<void> {
    this.loading = true;
    this.errorText = "";

    try {
      const session = this.upharma.ensureLogin();
      this.shops = this.upharma.getActiveShops();
      this.activeShopCode = this.shops[0]?.ShopCode || "";
      this.userTitle = `${session.UserInfo.FullName} (ID - ${session.UserInfo.uPharmaID}) - ${this.shops.length} nhà thuốc`;
      if (this.activeShopCode) {
        await this.loadShop(this.activeShopCode, this.year, true);
      } else {
        this.months = this.buildEmptyMonths(this.year, "");
      }
      this.cdr.detectChanges();
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async setActiveShop(shopCode: string): Promise<void> {
    this.activeShopCode = shopCode;
    await this.ensureLoaded(shopCode, this.year);
  }

  async setYear(year: number): Promise<void> {
    if (this.year === year) {
      return;
    }

    this.year = year;
    this.selectedMonth = 1;
    this.detailMonth = null;
    this.months = this.buildEmptyMonths(year, this.activeShopCode);
    await this.ensureLoaded(this.activeShopCode, year, true);
  }

  async reloadActiveShop(): Promise<void> {
    if (!this.activeShopCode) {
      return;
    }

    this.cache.delete(this.getCacheKey(this.activeShopCode, this.year));
    await this.loadShop(this.activeShopCode, this.year, true);
  }

  selectMonth(month: ShopPlanMonthViewModel): void {
    this.selectedMonth = month.month;
    this.detailMonth = month;
  }

  trackByMonth(_: number, month: ShopPlanMonthViewModel): string {
    return `${month.shopCode}_${month.year}_${month.month}`;
  }

  trackByLevel(_: number, level: ShopPlanCustomerLevelViewModel): string {
    return `H${level.level}`;
  }

  async ensureLoaded(shopCode: string, year: number, forceRefresh = false): Promise<void> {
    if (!shopCode) {
      return;
    }

    const cacheKey = this.getCacheKey(shopCode, year);
    if (!forceRefresh) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.months = cached.months;
        this.detailMonth = this.months.find((month) => month.month === this.selectedMonth) || this.months[0];
        return;
      }
    }

    await this.loadShop(shopCode, year, forceRefresh);
  }

  private async loadShop(shopCode: string, year: number, forceRefresh = false): Promise<void> {
    const cacheKey = this.getCacheKey(shopCode, year);
    this.loadingKeys.add(cacheKey);
    this.loadingProgress = 25;
    this.errorText = "";

    try {
      const session = this.upharma.ensureLogin();
      const range = this.buildYearRange(year);
      const response = await this.upharma.loadShopPlanByTime({
        TimeStart: range.timeStart,
        TimeEnd: range.timeEnd,
        Token: session.Token,
        uPharmaID: String(session.UserInfo.uPharmaID),
        ShopCode: shopCode,
      });

      const months = this.mapResponseToMonths(shopCode, year, response);
      this.cache.set(cacheKey, { loadedAt: Date.now(), months });
      this.months = months;
      this.syncSelectedMonth(months);
      this.cdr.detectChanges();
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.months = this.buildEmptyMonths(year, shopCode);
      this.syncSelectedMonth(this.months);
      if (forceRefresh) {
        this.cache.delete(cacheKey);
      }
    } finally {
      this.loadingKeys.delete(cacheKey);
      this.loadingProgress = 100;
      this.cdr.detectChanges();
    }
  }

  private mapResponseToMonths(
    shopCode: string,
    year: number,
    response: ShopPlanApiResponse,
  ): ShopPlanMonthViewModel[] {
    if (Number(response.RespCode) !== 0 || !Array.isArray(response.ShopPlanLst)) {
      throw new Error(response.RespText || "Dữ liệu chỉ tiêu không hợp lệ");
    }

    const monthMap = new Map<number, ShopPlanApiItem>();
    for (const item of response.ShopPlanLst) {
      if (item.ShopCode !== shopCode) {
        continue;
      }

      const month = this.getMonthNumber(item.Month);
      const itemYear = this.getYearNumber(item.Month);
      if (month < 1 || month > 12) {
        continue;
      }

      if (itemYear > 0 && itemYear !== year) {
        continue;
      }

      const existing = monthMap.get(month);
      if (!existing || this.isNewerPlan(item, existing)) {
        monthMap.set(month, item);
      }
    }

    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const item = monthMap.get(month);
      return item ? this.toMonthViewModel(shopCode, year, month, item) : this.buildEmptyMonth(shopCode, year, month);
    });
  }

  private toMonthViewModel(
    shopCode: string,
    year: number,
    month: number,
    item: ShopPlanApiItem,
  ): ShopPlanMonthViewModel {
    const averageBillActual = item.QuaInvoiceR > 0 ? item.AmountR / item.QuaInvoiceR : 0;
    const averageBillTarget = item.QuaInvoice > 0 ? item.Amount / item.QuaInvoice : 0;
    const hhsSkuRatio = item.SKUR > 0 ? (item.QuantityHHS / item.SKUR) * 100 : null;

    return {
      rowId: item.RowID,
      shopCode,
      year,
      month,
      hasData: true,
      status: item.Status,
      statusLabel: STATUS_LABELS[item.Status] || `Trạng thái ${item.Status}`,
      createdAt: item.TimeCreate || undefined,
      modifiedAt: item.TimeModify || undefined,
      approvedAt: item.TimeApprove || undefined,
      displayedTime: this.pickDisplayedTime(item.TimeModify, item.TimeApprove, item.TimeCreate),
      approverName: item.ApproveName || undefined,
      revenue: this.createHigherMetric(item.AmountR, item.Amount),
      hhs: this.createHigherMetric(item.PointSales01R, item.PointSales01),
      averageBill: this.createHigherMetric(averageBillActual, averageBillTarget),
      customers: {
        total: this.createHigherMetric(item.QuaCustomerR, item.QuaCustomer),
        newCustomer: this.createHigherMetric(item.QuaCustomerNewR, item.QuaCustomerNew),
        oldCustomer: this.createHigherMetric(item.QuaCustomerOldR, item.QuaCustomerOld),
      },
      invoice: this.createHigherMetric(item.QuaInvoiceR, item.QuaInvoice),
      sku: this.createHigherMetric(item.SKUR, item.SKU),
      slowSales: this.createLowerMetric(item.RatioSlowSalesR, item.RatioSlowSales),
      quantityHhs: item.QuantityHHS,
      hhsSkuRatio,
      customerLevels: [
        this.createCustomerLevel(1, item.CusLevel1R, item.CusLevel1),
        this.createCustomerLevel(2, item.CusLevel2R, item.CusLevel2),
        this.createCustomerLevel(3, item.CusLevel3R, item.CusLevel3),
        this.createCustomerLevel(4, item.CusLevel4R, item.CusLevel4),
        this.createCustomerLevel(5, item.CusLevel5R, item.CusLevel5),
        this.createCustomerLevel(6, item.CusLevel6R, item.CusLevel6),
      ],
      raw: item,
    };
  }

  private buildEmptyMonths(year: number, shopCode: string): ShopPlanMonthViewModel[] {
    return Array.from({ length: 12 }, (_, index) => this.buildEmptyMonth(shopCode, year, index + 1));
  }

  private syncSelectedMonth(months: ShopPlanMonthViewModel[]): void {
    const preferredMonth =
      months.find((month) => month.hasData && month.month === this.selectedMonth) ||
      months.find((month) => month.hasData) ||
      months[this.selectedMonth - 1] ||
      months[0];

    if (!preferredMonth) {
      this.detailMonth = null;
      return;
    }

    this.selectedMonth = preferredMonth.month;
    this.detailMonth = preferredMonth;
  }

  private buildEmptyMonth(shopCode: string, year: number, month: number): ShopPlanMonthViewModel {
    return {
      shopCode,
      year,
      month,
      hasData: false,
      status: 0,
      statusLabel: "Chưa có dữ liệu",
      quantityHhs: 0,
      hhsSkuRatio: null,
      customerLevels: [1, 2, 3, 4, 5, 6].map((level) => ({
        level,
        target: 0,
        actual: 0,
        percentage: null,
        status: "neutral",
      })),
    };
  }

  private createHigherMetric(actual: number, target: number): ShopPlanMonthMetric {
    const percentage = this.calculateHigherPercentage(actual, target);
    return {
      actual,
      target,
      percentage,
      evaluationType: "higher-is-better",
      status: this.resolveHigherStatus(percentage),
      statusText: this.getPercentText(percentage),
    };
  }

  private createLowerMetric(actual: number, target: number): ShopPlanMonthMetric {
    const percentage = this.calculateHigherPercentage(target, actual);
    const status = !Number.isFinite(actual) || !Number.isFinite(target) || target <= 0 ? "neutral" : actual <= target ? "success" : "danger";
    return {
      actual,
      target,
      percentage,
      evaluationType: "lower-is-better",
      status,
      statusText: actual <= target ? "Đạt" : "Chưa đạt",
    };
  }

  private createCustomerLevel(level: number, actual: number, target: number): ShopPlanCustomerLevelViewModel {
    const percentage = this.calculateHigherPercentage(actual, target);
    return {
      level,
      actual,
      target,
      percentage,
      status: this.resolveHigherStatus(percentage),
    };
  }

  private resolveHigherStatus(percentage: number | null): "success" | "warning" | "danger" | "neutral" {
    if (percentage === null) {
      return "neutral";
    }

    if (percentage >= 100) {
      return "success";
    }

    if (percentage >= 80) {
      return "warning";
    }

    return "danger";
  }

  private calculateHigherPercentage(actual: number, target: number): number | null {
    if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
      return null;
    }

    return (actual / target) * 100;
  }

  private getPercentText(percentage: number | null): string {
    return percentage === null ? "—" : `${percentage.toFixed(1)}%`;
  }

  private pickDisplayedTime(...values: Array<string | undefined>): string | undefined {
    for (const value of values) {
      const parsed = this.parseApiDate(value);
      if (parsed) {
        return this.formatDateTime(parsed);
      }
    }
    return undefined;
  }

  private parseApiDate(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!match) {
      return null;
    }

    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
  }

  private formatDateTime(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private getMonthNumber(monthValue: string): number {
    const normalized = String(monthValue || "").trim();
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
    if (dateMatch) {
      return Number(dateMatch[2]);
    }

    const monthMatch = /(?:^|[^0-9])([1-9]|1[0-2])(?:[^0-9]|$)/.exec(normalized);
    return monthMatch ? Number(monthMatch[1]) : 0;
  }

  private getYearNumber(monthValue: string): number {
    const normalized = String(monthValue || "").trim();
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalized);
    if (dateMatch) {
      return Number(dateMatch[1]);
    }

    const yearMatch = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(normalized);
    return yearMatch ? Number(yearMatch[1]) : 0;
  }

  private isNewerPlan(first: ShopPlanApiItem, second: ShopPlanApiItem): boolean {
    const firstTime = this.parseApiDate(first.TimeModify) || this.parseApiDate(first.TimeCreate) || new Date(0);
    const secondTime = this.parseApiDate(second.TimeModify) || this.parseApiDate(second.TimeCreate) || new Date(0);
    return firstTime.getTime() >= secondTime.getTime();
  }

  private buildYearRange(year: number): { timeStart: string; timeEnd: string } {
    return {
      timeStart: `${year}-01-01 00:00:00`,
      timeEnd: `${year}-12-31 23:59:59`,
    };
  }

  private getCacheKey(shopCode: string, year: number): string {
    return `${year}_${shopCode}`;
  }

  private makeShopNameFromCode(shopCode: string): string {
    const normalized = shopCode.replace(/^SHOP0*/i, "");
    return normalized ? `Nhà ${normalized}` : shopCode;
  }
}
