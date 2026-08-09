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

@Component({
  selector: "app-shop-plan-year",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="page-inner employee-plan-page">
  <section class="employee-plan-hero">
    <div class="hero-meta">
      <label>
        Năm
        <select [(ngModel)]="selectedYear" name="selectedYear">
          <option *ngFor="let year of yearOptions" [ngValue]="year">{{ year }}</option>
        </select>
      </label>
      <button class="view-button" type="button" (click)="loadAllShops()">Xem</button>
    </div>
  </section>

  <section class="employee-plan-tabs" *ngIf="tabs.length > 0">
    <button
      type="button"
      *ngFor="let tab of tabs"
      class="shop-tab"
      [class.is-active]="activeShopCode === tab.shopCode"
      (click)="activeShopCode = tab.shopCode"
    >
      <span class="tab-code">{{ tab.shopCode }}</span>
      <strong>{{ tab.shopName }}</strong>
      <small>{{ tab.items.length }} tháng</small>
    </button>
  </section>

  <section class="employee-plan-state" *ngIf="!activeTab">
    <div class="state-card">
      <strong>Không có dữ liệu</strong>
      <p>Chọn shop khác hoặc kiểm tra phiên đăng nhập.</p>
    </div>
  </section>

  <section class="employee-plan-panel" *ngIf="activeTab as currentTab">
    <div class="employee-plan-loading" *ngIf="currentTab.loading">
      <span class="loader" aria-hidden="true"></span>
      <strong>Đang tải {{ currentTab.shopCode }}...</strong>
    </div>
    <p class="api-test-error" *ngIf="currentTab.errorText">{{ currentTab.errorText }}</p>

    <div class="shop-plan-grid" *ngIf="!currentTab.loading && !currentTab.errorText">
      <article class="shop-plan-card" *ngFor="let item of currentTab.items">
        <div class="card-top">
          <span class="card-month">{{ formatMonthLabel(item.Month) }}</span>
          <div class="card-top-right">
            <span class="card-time"><i class="mdi mdi-clock-outline"></i>{{ formatDateTime(item.TimeModify || item.TimeCreate) }}</span>
            <i class="mdi mdi-percent card-icon"></i>
            <i class="mdi mdi-cog card-icon"></i>
          </div>
        </div>

        <div class="card-status">
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
      </article>
    </div>
  </section>
</div>
  `,
  styleUrls: ["./shop-plan-year.component.css"],
})
export class ShopPlanYearComponent implements OnInit {
  readonly endpoint = "/ShopPlan/GetShopPlanByTime";
  readonly yearOptions = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index);
  readonly customerLevels = [
    { key: "CusLevel1", label: "H1" },
    { key: "CusLevel2", label: "H2" },
    { key: "CusLevel3", label: "H3" },
    { key: "CusLevel4", label: "H4" },
    { key: "CusLevel5", label: "H5" },
    { key: "CusLevel6", label: "H6" },
  ] as const;
  selectedYear = new Date().getFullYear();
  tabs: ShopTab[] = [];
  activeShopCode = "";

  constructor(private readonly upharmaService: UpharmaService) {}

  ngOnInit(): void {
    this.initTabs();
    void this.loadAllShops();
  }

  get activeTab(): ShopTab | undefined {
    return this.tabs.find((tab) => tab.shopCode === this.activeShopCode);
  }

  private initTabs(): void {
    const shops = this.upharmaService.getActiveShops();
    this.tabs = shops.map((shop) => ({ shopCode: shop.ShopCode, shopName: shop.ShopName, loading: false, errorText: "", items: [] }));
    this.activeShopCode = this.tabs.find((tab) => tab.shopCode === this.activeShopCode)?.shopCode || this.tabs[0]?.shopCode || "";
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

  formatDateTime(value: string): string {
    return value ? value.slice(0, 16).replace("T", " ") : "";
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
