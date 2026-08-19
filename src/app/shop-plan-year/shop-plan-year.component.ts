import { CommonModule } from "@angular/common";
import { Component, Input, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UpharmaService } from "../upharma.service";

interface ShopPlanItem {
  RowID: number;
  ShopCode: string;
  Month: string;
  TimeCreate: string;
  TimeModify: string;
  TimeApprove: string;
  ApproveID: number;
  ApproveName?: string;
  Amount: number;
  PointSales01: number;
  QuaCustomer: number;
  QuaCustomerNew: number;
  QuaCustomerOld: number;
  QuaInvoice: number;
  SKU: number;
  RatioSlowSales: number;
  AmountR: number;
  PointSales01R: number;
  QuaCustomerR: number;
  QuaCustomerNewR: number;
  QuaCustomerOldR: number;
  QuaInvoiceR: number;
  SKUR: number;
  RatioSlowSalesR: number;
  QuantityHHS: number;
  CusLevel1: number;
  CusLevel2: number;
  CusLevel3: number;
  CusLevel4: number;
  CusLevel5: number;
  CusLevel6: number;
  CusLevel1R: number;
  CusLevel2R: number;
  CusLevel3R: number;
  CusLevel4R: number;
  CusLevel5R: number;
  CusLevel6R: number;
}

interface ShopPlanResponse {
  RespCode: number;
  RespText: string;
  ShopPlanLst: ShopPlanItem[];
}

interface ShopTab {
  shopCode: string;
  shopName: string;
  loading: boolean;
  errorText: string;
  items: ShopPlanItem[];
}

interface ShopMonthCard {
  shopCode: string;
  shopName: string;
  loading: boolean;
  errorText: string;
  item: ShopPlanItem | null;
}

type ShopPlanIconName = "clock" | "percent" | "settings" | "chart" | "cart" | "users" | "star" | "bag" | "receipt" | "inventory";

@Component({
  selector: "app-shop-plan-icon",
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <ng-container [ngSwitch]="name">
        <g *ngSwitchCase="'clock'"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3.5 2"></path></g>
        <g *ngSwitchCase="'percent'"><path d="M7 17 17 7"></path><circle cx="7.5" cy="7.5" r="2.5"></circle><circle cx="16.5" cy="16.5" r="2.5"></circle></g>
        <g *ngSwitchCase="'settings'"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"></path></g>
        <g *ngSwitchCase="'chart'"><path d="M4 19V5M4 19h16"></path><path d="m7 15 4-4 3 2 5-6"></path></g>
        <g *ngSwitchCase="'cart'"><path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20 8H6"></path><circle cx="9" cy="20" r="1"></circle><circle cx="17" cy="20" r="1"></circle></g>
        <g *ngSwitchCase="'users'"><circle cx="9" cy="8" r="3"></circle><circle cx="17" cy="9" r="2.5"></circle><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M14 14c3.8-.4 6 1.3 6.5 5"></path></g>
        <g *ngSwitchCase="'star'"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></g>
        <g *ngSwitchCase="'bag'"><path d="M5 8h14l-1 12H6L5 8Z"></path><path d="M9 9V6a3 3 0 0 1 6 0v3"></path></g>
        <g *ngSwitchCase="'receipt'"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3Z"></path><path d="M9 8h6M9 12h6M9 16h4"></path></g>
        <g *ngSwitchCase="'inventory'"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M3 5h18V2H3v3ZM9 10h6"></path></g>
      </ng-container>
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; width: 1em; height: 1em; flex: 0 0 auto; }
    svg { display: block; width: 100%; height: 100%; }
  `],
})
export class ShopPlanIconComponent {
  @Input({ required: true }) name!: ShopPlanIconName;
}

@Component({
  selector: "app-shop-plan-year",
  standalone: true,
  imports: [CommonModule, FormsModule, ShopPlanIconComponent],
  template: `
  <div class="page-header d-print-none">
    <div class="container-xl">
      <div class="row g-2 align-items-center">
        <div class="col">
          <div class="page-pretitle">KẾ HOẠCH</div>
          <h2 class="page-title">Chỉ tiêu nhà thuốc trong năm</h2>
        </div>
        <div class="col-12 col-sm-auto ms-sm-auto mt-2 mt-sm-0 d-print-none">
          <div class="d-flex flex-wrap align-items-center gap-2" style="flex-wrap: wrap;">
            <div class="d-flex align-items-center gap-2">
              <label class="form-label mb-0">Tháng</label>
              <select class="form-select" [(ngModel)]="selectedMonth" name="selectedMonth">
                <option *ngFor="let month of monthOptions" [ngValue]="month">{{ month }}</option>
              </select>
            </div>
            <div class="d-flex align-items-center gap-2">
              <label class="form-label mb-0">Năm</label>
              <select class="form-select" [(ngModel)]="selectedYear" name="selectedYear">
                <option *ngFor="let year of yearOptions" [ngValue]="year">{{ year }}</option>
              </select>
            </div>
            <button class="btn btn-primary" type="button" (click)="loadAllShops()">Xem</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="page-body">
    <div class="container-xl">
      <div class="card mb-3" *ngIf="visibleCards.length === 0 && !isAnyTabLoading">
        <div class="card-body">
          <h3 class="card-title">Không có dữ liệu</h3>
          <p class="text-secondary mb-0">Không có chỉ tiêu của các nhà thuốc ở tháng {{ selectedMonth }}/{{ selectedYear }}.</p>
        </div>
      </div>

      <div class="d-flex align-items-center justify-content-center py-5" *ngIf="isAnyTabLoading">
        <div class="spinner-border text-primary me-2" role="status"></div>
        <span class="text-secondary">Đang tải dữ liệu nhà thuốc...</span>
      </div>

      <div class="row row-deck row-cards" *ngIf="!isAnyTabLoading">
        <div class="col-sm-6 col-lg-4" *ngFor="let card of visibleCards">
          <div class="card">
            <ng-container *ngIf="card.item as item; else emptyShopCard">
              <div class="card-header">
                <h3 class="card-title text-warning">{{ card.shopCode }} · {{ formatMonthLabel(item.Month) }}</h3>
                <div class="card-actions text-secondary small d-flex align-items-center gap-2">
                  <span><app-shop-plan-icon name="clock"></app-shop-plan-icon> {{ formatDateTime(item.TimeModify || item.TimeCreate) }}</span>
                  <app-shop-plan-icon name="percent"></app-shop-plan-icon>
                  <app-shop-plan-icon name="settings"></app-shop-plan-icon>
                </div>
              </div>
              <!-- Doanh số Card Item -->
              <div class="p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <div class="d-flex align-items-center gap-2">
                    <span class="avatar avatar-sm bg-success-lt text-success" style="width: 32px; height: 32px;">
                      <app-shop-plan-icon name="chart"></app-shop-plan-icon>
                    </span>
                    <div>
                      <div class="text-uppercase fw-bold text-secondary" style="font-size: 10px; letter-spacing: 0.5px;">Doanh số</div>
                      <div class="h3 mb-0 text-success fw-bold">{{ formatNumber(item.AmountR) }} đ</div>
                    </div>
                  </div>
                  <div class="text-end">
                    <span class="badge px-2 py-1 fw-bold" [ngClass]="item.AmountR >= item.Amount ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'">
                      {{ formatPercent(item.AmountR, item.Amount) }} đạt
                    </span>
                    <div class="text-secondary small mt-1">Mục tiêu: {{ formatNumber(item.Amount) }} đ</div>
                  </div>
                </div>
                <div class="progress progress-sm mt-2" style="height: 6px;">
                  <div class="progress-bar bg-success" [style.width.%]="getPercent(item.AmountR, item.Amount) > 100 ? 100 : getPercent(item.AmountR, item.Amount)"></div>
                </div>
              </div>

              <!-- HHS Card Item -->
              <div class="p-3 border-bottom">
                <div class="d-flex justify-content-between align-items-center mb-1">
                  <div class="d-flex align-items-center gap-2">
                    <span class="avatar avatar-sm bg-primary-lt text-primary" style="width: 32px; height: 32px;">
                      <app-shop-plan-icon name="cart"></app-shop-plan-icon>
                    </span>
                    <div>
                      <div class="text-uppercase fw-bold text-secondary" style="font-size: 10px; letter-spacing: 0.5px;">Điểm HHS</div>
                      <div class="h3 mb-0 text-primary fw-bold">{{ formatNumber(item.PointSales01R) }}</div>
                    </div>
                  </div>
                  <div class="text-end">
                    <span class="badge px-2 py-1 fw-bold" [ngClass]="item.PointSales01R >= item.PointSales01 ? 'bg-green-lt text-green' : 'bg-yellow-lt text-yellow'">
                      {{ formatPercent(item.PointSales01R, item.PointSales01) }} đạt
                    </span>
                    <div class="text-secondary small mt-1">Mục tiêu: {{ formatNumber(item.PointSales01) }}</div>
                  </div>
                </div>
                <div class="progress progress-sm mt-2 mb-2" style="height: 6px;">
                  <div class="progress-bar bg-primary" [style.width.%]="getPercent(item.PointSales01R, item.PointSales01) > 100 ? 100 : getPercent(item.PointSales01R, item.PointSales01)"></div>
                </div>
                <div class="d-flex justify-content-between text-secondary small pt-1 border-top border-dashed" style="font-size: 11px;">
                  <span>SKU HHS: <strong>{{ formatNumber(item.QuantityHHS) }}</strong></span>
                  <span>Tỉ trọng HHS: <strong class="text-success">{{ formatPercent(item.QuantityHHS, item.SKU) }}</strong></span>
                </div>
              </div>
              <div class="card-body">
                <div class="row g-2 text-center">
                  <div class="col-4">
                    <div class="text-secondary small fw-bold">Tỉ trọng</div>
                    <div class="h4 mb-0">{{ formatRatio(getHhsDisplayValue(item), item.AmountR) }}</div>
                  </div>
                  <div class="col-4">
                    <div class="text-secondary small fw-bold">Dự kiến DS</div>
                    <div class="h4 mb-0">{{ formatNumber(getProjectedValue(item.AmountR, item.Month)) }}</div>
                  </div>
                  <div class="col-4">
                    <div class="text-secondary small fw-bold">Dự kiến HS</div>
                    <div class="h4 mb-0">{{ formatNumber(getProjectedValue(getHhsDisplayValue(item), item.Month)) }}</div>
                  </div>
                </div>
              </div>
            </ng-container>
            <ng-template #emptyShopCard>
              <div class="card-header">
                <h3 class="card-title">{{ card.shopCode }}</h3>
              </div>
              <div class="card-body">
                <div class="mb-3">
                  <span class="badge bg-yellow-lt">{{ card.shopName }}</span>
                </div>
                <p class="text-danger mb-0" *ngIf="card.errorText">{{ card.errorText }}</p>
                <p class="text-secondary mb-0" *ngIf="!card.errorText">Không có dữ liệu tháng {{ selectedMonth }}/{{ selectedYear }}.</p>
              </div>
            </ng-template>
          </div>
        </div>
      </div>
    </div>
  </div>
  `,
  styles: [],
})
export class ShopPlanYearComponent implements OnInit {
  readonly endpoint = "/ShopPlan/GetShopPlanByTime";
  readonly monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
  readonly yearOptions = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index);
  readonly customerLevels = [
    { key: "CusLevel1", label: "H1" },
    { key: "CusLevel2", label: "H2" },
    { key: "CusLevel3", label: "H3" },
    { key: "CusLevel4", label: "H4" },
    { key: "CusLevel5", label: "H5" },
    { key: "CusLevel6", label: "H6" },
  ] as const;
  selectedMonth = new Date().getMonth() + 1;
  selectedYear = new Date().getFullYear();
  tabs: ShopTab[] = [];

  constructor(private readonly upharmaService: UpharmaService) {}

  ngOnInit(): void {
    this.initTabs();
    void this.loadAllShops();
  }

  get isAnyTabLoading(): boolean {
    return this.tabs.some((tab) => tab.loading);
  }

  get visibleCards(): ShopMonthCard[] {
    return this.tabs
      .map((tab) => ({
        shopCode: tab.shopCode,
        shopName: tab.shopName,
        loading: tab.loading,
        errorText: tab.errorText,
        item: this.findItemForMonth(tab.items, this.selectedMonth, this.selectedYear),
      }))
      .filter((card) => card.item || card.errorText);
  }

  private initTabs(): void {
    const shops = this.upharmaService.getActiveShops();
    this.tabs = shops.map((shop) => ({ shopCode: shop.ShopCode, shopName: shop.ShopName, loading: false, errorText: "", items: [] }));
  }

  async loadAllShops(): Promise<void> {
    const session = this.upharmaService.ensureLogin();
    const shops = this.upharmaService.getActiveShops();
    if (shops.length === 0) {
      this.initTabs();
      return;
    }
    this.initTabs();
    this.tabs.forEach((tab) => { tab.loading = true; tab.errorText = ""; tab.items = []; });
    const timeStart = `${this.selectedYear}-01-01 00:00:00`;
    const timeEnd = `${this.selectedYear}-12-31 23:59:59`;
    await Promise.all(shops.map(async (shop) => {
      const tab = this.tabs.find((entry) => entry.shopCode === shop.ShopCode);
      if (!tab) return;
      try {
        const response = await this.upharmaService.callEndpoint<ShopPlanResponse>(this.endpoint, { TimeStart: timeStart, TimeEnd: timeEnd, Token: session.Token, uPharmaID: String(session.UserInfo.uPharmaID), ShopCode: shop.ShopCode });
        tab.items = Array.isArray(response.ShopPlanLst) ? response.ShopPlanLst : [];
      } catch (error) {
        if (!this.isInvalidTokenError(error)) {
          tab.errorText = error instanceof Error ? error.message : String(error);
        }
        tab.items = [];
      } finally {
        tab.loading = false;
      }
    }));
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
    }).format(value || 0);
  }

  formatMonthLabel(value: string): string {
    const match = /^(\d{4})-(\d{2})-/.exec(value || "");
    return `THÁNG ${match ? Number(match[2]) : "-"}`;
  }

  private parseMonthParts(value: string): { year: number; month: number } | null {
    const match = /^(\d{4})-(\d{2})-/.exec(value || "");
    if (!match) {
      return null;
    }

    return {
      year: Number(match[1]),
      month: Number(match[2]),
    };
  }

  private findItemForMonth(items: ShopPlanItem[], month: number, year: number): ShopPlanItem | null {
    const monthText = String(month).padStart(2, "0");
    const yearText = String(year);
    return items.find((item) => {
      const match = /^(\d{4})-(\d{2})-/.exec(item.Month || "");
      return Boolean(match && match[1] === yearText && match[2] === monthText);
    }) || null;
  }

  formatDateTime(value: string): string {
    return value ? value.slice(0, 16).replace("T", " ") : "";
  }

  formatRatio(numerator: number, denominator: number): string {
    if (!denominator) {
      return "0%";
    }

    const ratio = (Number(numerator) / Number(denominator)) * 100;
    return `${Math.round(ratio)}%`;
  }

  getHhsDisplayValue(item: ShopPlanItem): number {
    return (Number(item.PointSales01R) || 0) * 1000;
  }

  getProjectedValue(actualValue: number, monthValue: string): number {
    const monthParts = this.parseMonthParts(monthValue);
    if (!monthParts) {
      return Number(actualValue) || 0;
    }

    const now = new Date();
    const isCurrentMonth = monthParts.year === now.getFullYear() && monthParts.month === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return Number(actualValue) || 0;
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(monthParts.year, monthParts.month, 0).getDate();
    return (Number(actualValue) || 0) / completedDays * totalDays;
  }

  buildProjectionHint(monthValue: string): string {
    const monthParts = this.parseMonthParts(monthValue);
    if (!monthParts) {
      return "Không xác định được tháng.";
    }

    const now = new Date();
    const isCurrentMonth = monthParts.year === now.getFullYear() && monthParts.month === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return "Tháng đã khép lại, giữ nguyên số thực hiện.";
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(monthParts.year, monthParts.month, 0).getDate();
    return `Thực hiện / ${completedDays} x ${totalDays} ngày.`;
  }

  buildProjectedSalesHint(item: ShopPlanItem): string {
    const monthParts = this.parseMonthParts(item.Month);
    if (!monthParts) {
      return "Không xác định được tháng.";
    }

    const now = new Date();
    const isCurrentMonth = monthParts.year === now.getFullYear() && monthParts.month === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return `Doanh số ${this.formatNumber(item.AmountR)}.`;
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(monthParts.year, monthParts.month, 0).getDate();
    return `${this.formatNumber(item.AmountR)} / ${completedDays} x ${totalDays} ngày.`;
  }

  buildProjectedHhsHint(item: ShopPlanItem): string {
    const monthParts = this.parseMonthParts(item.Month);
    const hhsValue = this.getHhsDisplayValue(item);
    if (!monthParts) {
      return "Không xác định được tháng.";
    }

    const now = new Date();
    const isCurrentMonth = monthParts.year === now.getFullYear() && monthParts.month === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return `Hệ số ${this.formatNumber(hhsValue)}.`;
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(monthParts.year, monthParts.month, 0).getDate();
    return `${this.formatNumber(hhsValue)} / ${completedDays} x ${totalDays} ngày.`;
  }

  getPercent(realValue: number, targetValue: number): number {
    return targetValue ? (Number(realValue) / Number(targetValue)) * 100 : 0;
  }

  formatPercent(realValue: number, targetValue: number): string {
    const percent = this.getPercent(realValue, targetValue);
    return `${Math.round(percent)}%`;
  }

  getBadgeClass(realValue: number, targetValue: number): string {
    return this.getPercent(realValue, targetValue) >= 100 ? "badge-ok" : "badge-warn";
  }

  private isInvalidTokenError(error: unknown): boolean {
    return error instanceof Error && error.message.trim().toLowerCase() === "token không hợp lệ, vui lòng đăng nhập lại";
  }

  getApproveLabel(item: ShopPlanItem): string {
    return item.TimeApprove ? `QLKV: ${item.ApproveName || item.ApproveID || "Đã duyệt"}` : "Chưa duyệt";
  }

  getLevelValue(item: ShopPlanItem, key: keyof Pick<ShopPlanItem, "CusLevel1" | "CusLevel2" | "CusLevel3" | "CusLevel4" | "CusLevel5" | "CusLevel6">): number {
    return Number(item[key]) || 0;
  }

  getLevelRealValue(
    item: ShopPlanItem,
    key: keyof Pick<ShopPlanItem, "CusLevel1" | "CusLevel2" | "CusLevel3" | "CusLevel4" | "CusLevel5" | "CusLevel6">,
  ): number {
    const realKey = `${String(key)}R` as keyof ShopPlanItem;
    return Number(item[realKey]) || 0;
  }
}
