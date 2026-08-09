import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
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

@Component({
  selector: "app-shop-plan-year",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="page-inner employee-plan-page">
  <section class="employee-plan-hero">
    <div class="hero-meta">
      <label>
        Tháng
        <select [(ngModel)]="selectedMonth" name="selectedMonth">
          <option *ngFor="let month of monthOptions" [ngValue]="month">{{ month }}</option>
        </select>
      </label>
      <label>
        Năm
        <select [(ngModel)]="selectedYear" name="selectedYear">
          <option *ngFor="let year of yearOptions" [ngValue]="year">{{ year }}</option>
        </select>
      </label>
      <button class="view-button" type="button" (click)="loadAllShops()">Xem</button>
    </div>
  </section>

  <section class="employee-plan-state" *ngIf="visibleCards.length === 0 && !isAnyTabLoading">
    <div class="state-card">
      <strong>Không có dữ liệu</strong>
      <p>Không có chỉ tiêu của các nhà thuốc ở tháng {{ selectedMonth }}/{{ selectedYear }}.</p>
    </div>
  </section>

  <section class="employee-plan-panel">
    <div class="employee-plan-loading" *ngIf="isAnyTabLoading">
      <span class="loader" aria-hidden="true"></span>
      <strong>Đang tải dữ liệu nhà thuốc...</strong>
    </div>

    <div class="shop-plan-grid shop-plan-grid--three" *ngIf="!isAnyTabLoading">
      <article class="shop-plan-card" *ngFor="let card of visibleCards">
        <ng-container *ngIf="card.item as item; else emptyShopCard">
        <div class="card-top">
          <span class="card-month">{{ card.shopCode }} · {{ formatMonthLabel(item.Month) }}</span>
          <div class="card-top-right">
            <span class="card-time"><i class="mdi mdi-clock-outline"></i>{{ formatDateTime(item.TimeModify || item.TimeCreate) }}</span>
            <i class="mdi mdi-percent card-icon"></i>
            <i class="mdi mdi-cog card-icon"></i>
          </div>
        </div>

        <div class="card-status">
          <span class="chip chip--code">{{ card.shopName }}</span>
          <span class="chip chip--green">{{ getApproveLabel(item) }}</span>
        </div>

        <div class="metric-row">
          <div class="metric-icon-wrap"><i class="mdi mdi-chart-line"></i></div>
          <div class="metric-content">
            <div class="metric-lbl">DOANH SỐ</div>
            <div class="metric-val green">{{ formatNumber(item.AmountR) }}</div>
            <div class="metric-sub">{{ formatNumber(item.Amount) }}</div>
          </div>
          <div class="pct-circle" [ngClass]="getBadgeClass(item.AmountR, item.Amount)">{{ formatPercent(item.AmountR, item.Amount) }}</div>
        </div>

        <div class="metric-row">
          <div class="metric-icon-wrap"><i class="mdi mdi-cart-outline"></i></div>
          <div class="metric-content">
            <div class="metric-lbl">HHS</div>
            <div class="metric-val green">{{ formatNumber(item.PointSales01R) }}</div>
            <div class="metric-sub">{{ formatNumber(item.PointSales01) }}</div>
          </div>
          <div class="pct-circle" [ngClass]="getBadgeClass(item.PointSales01R, item.PointSales01)">{{ formatPercent(item.PointSales01R, item.PointSales01) }}</div>
          <div class="tthhs">
            <div class="tthhs-lbl">TT HHS</div>
            <div class="tthhs-val">{{ formatPercent(item.QuantityHHS, item.SKU) }}</div>
            <div class="tthhs-sub">SKU HHS: {{ formatNumber(item.QuantityHHS) }}</div>
          </div>
        </div>

        <div class="projection-grid">
          <div class="projection-card">
            <div class="projection-lbl">Tỉ trọng</div>
            <div class="projection-val">{{ formatRatio(getHhsDisplayValue(item), item.AmountR) }}</div>
          </div>
          <div class="projection-card">
            <div class="projection-lbl">Dự kiến doanh số</div>
            <div class="projection-val">{{ formatNumber(getProjectedValue(item.AmountR, item.Month)) }}</div>
          </div>
          <div class="projection-card">
            <div class="projection-lbl">Dự kiến hệ số</div>
            <div class="projection-val">{{ formatNumber(getProjectedValue(getHhsDisplayValue(item), item.Month)) }}</div>
          </div>
        </div>

        <div class="sec-lbl"><i class="mdi mdi-account-group"></i> Khách hàng</div>
        <div class="cus-grid">
          <div class="cus-box cus-box--light"><div class="cus-ttl">Tổng</div><div class="cus-num">{{ formatNumber(item.QuaCustomer) }}</div><div class="cus-real red">{{ formatNumber(item.QuaCustomerR) }}</div></div>
          <div class="cus-box cus-box--light"><div class="cus-ttl">Cũ</div><div class="cus-num">{{ formatNumber(item.QuaCustomerOld) }}</div><div class="cus-real red">{{ formatNumber(item.QuaCustomerOldR) }}</div></div>
          <div class="cus-box cus-box--dark"><div class="cus-ttl">Mới</div><div class="cus-num">{{ formatNumber(item.QuaCustomerNew) }}</div><div class="cus-real white">{{ formatNumber(item.QuaCustomerNewR) }}</div></div>
        </div>

        <div class="sec-lbl"><i class="mdi mdi-star-outline"></i> Khách đạt hạng</div>
        <div class="lv-grid">
          <div class="lv-cell" *ngFor="let level of customerLevels">
            <div class="lv-lbl">{{ level.label }}</div>
            <div class="lv-t">{{ formatNumber(getLevelValue(item, level.key)) }}</div>
            <div class="lv-r">{{ formatNumber(getLevelRealValue(item, level.key)) }}</div>
          </div>
        </div>

        <div class="bot-grid">
          <div class="bot-card"><i class="mdi mdi-shopping-outline bot-ico"></i><div class="bot-ttl">Đơn bán</div><div class="bot-real red">{{ formatNumber(item.QuaInvoiceR) }}</div><div class="bot-tgt">{{ formatNumber(item.QuaInvoice) }}</div><div class="bot-badge" [ngClass]="getBadgeClass(item.QuaInvoiceR, item.QuaInvoice)">{{ formatPercent(item.QuaInvoiceR, item.QuaInvoice) }}</div></div>
          <div class="bot-card"><i class="mdi mdi-receipt-text-outline bot-ico"></i><div class="bot-ttl">TB Bill</div><div class="bot-real red">{{ formatNumber(item.PointSales01R) }}</div><div class="bot-tgt">{{ formatNumber(item.PointSales01) }}</div><div class="bot-badge" [ngClass]="getBadgeClass(item.PointSales01R, item.PointSales01)">{{ formatPercent(item.PointSales01R, item.PointSales01) }}</div></div>
          <div class="bot-card"><i class="mdi mdi-package-variant-closed bot-ico"></i><div class="bot-ttl">Mặt hàng</div><div class="bot-real green">{{ formatNumber(item.SKUR) }}</div><div class="bot-tgt">{{ formatNumber(item.SKU) }}</div><div class="bot-badge" [ngClass]="getBadgeClass(item.SKUR, item.SKU)">{{ formatPercent(item.SKUR, item.SKU) }}</div></div>
          <div class="bot-card"><i class="mdi mdi-percent-outline bot-ico"></i><div class="bot-ttl">Hàng chậm</div><div class="bot-real green">{{ formatNumber(item.RatioSlowSalesR) }}%</div><div class="bot-tgt">{{ formatNumber(item.RatioSlowSales) }}%</div><div class="bot-badge" [ngClass]="getBadgeClass(item.RatioSlowSalesR, item.RatioSlowSales)">{{ item.RatioSlowSalesR > item.RatioSlowSales ? "Đạt" : "Chưa đạt" }}</div></div>
        </div>
        </ng-container>
        <ng-template #emptyShopCard>
          <div class="empty-shop-card">
            <div class="card-top">
              <span class="card-month">{{ card.shopCode }}</span>
            </div>
            <div class="card-status">
              <span class="chip chip--code">{{ card.shopName }}</span>
            </div>
            <p class="api-test-error" *ngIf="card.errorText">{{ card.errorText }}</p>
            <p class="empty-shop-copy" *ngIf="!card.errorText">Không có dữ liệu tháng {{ selectedMonth }}/{{ selectedYear }}.</p>
          </div>
        </ng-template>
      </article>
    </div>
  </section>
</div>
  `,
  styleUrls: ["./shop-plan-year.component.css"],
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
    return new Intl.NumberFormat("vi-VN").format(value || 0);
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
    return `${ratio.toFixed(ratio % 1 === 0 ? 0 : 2)}%`;
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
    return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
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
