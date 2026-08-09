import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UpharmaService } from "../upharma.service";

interface EmployeePlanItem {
  RowID: number;
  uPharmaID: number;
  EmployeeName: string;
  EmployeeCode: string;
  ShopCode: string;
  MonthS: number;
  YearS: number;
  Amount: number;
  QuantityInvoice: number;
  QuantityCusNew: number;
  QuantityCus: number;
  PointRatio: number;
  AmountR: number;
  QuantityInvoiceR: number;
  QuantityCusNewR: number;
  QuantityCusR: number;
  PointRatioR: number;
  TimeCreate: string;
  CreateID: number;
  TimeModify: string;
  ModifyID: number;
  TimeApprove: string;
  ApproveID: number;
  TimeApprove2: string;
  ApproveID2: number;
  Status: number;
}

interface EmployeePlanResponse {
  RespCode: number;
  RespText: string;
  EmployeePlanLst: EmployeePlanItem[];
}

interface ShopPlanTab {
  shopCode: string;
  shopName: string;
  loading: boolean;
  errorText: string;
  items: EmployeePlanItem[];
}

@Component({
  selector: "app-employee-plan",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./employee-plan.component.html",
  styleUrls: ["./employee-plan.component.css"],
})
export class EmployeePlanComponent implements OnInit {
  readonly endpoint = "/EmployeePlan/GetEmployeePlanLst";
  readonly monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
  readonly yearOptions = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index);
  selectedMonth = new Date().getMonth() + 1;
  selectedYear = new Date().getFullYear();
  tabs: ShopPlanTab[] = [];
  activeShopCode = "";

  constructor(private readonly upharmaService: UpharmaService) {}

  ngOnInit(): void {
    this.initTabs();
    void this.loadAllShops();
  }

  get activeTab(): ShopPlanTab | undefined {
    return this.tabs.find((tab) => tab.shopCode === this.activeShopCode);
  }

  private initTabs(): void {
    const shops = this.upharmaService.getActiveShops();
    this.tabs = shops.map((shop) => ({
      shopCode: shop.ShopCode,
      shopName: shop.ShopName,
      loading: false,
      errorText: "",
      items: [],
    }));

    if (!this.activeShopCode || !this.tabs.some((tab) => tab.shopCode === this.activeShopCode)) {
      this.activeShopCode = this.tabs[0]?.shopCode || "";
    }
  }

  async loadAllShops(): Promise<void> {
    const session = this.upharmaService.ensureLogin();
    const shops = this.upharmaService.getActiveShops();

    if (shops.length === 0) {
      this.initTabs();
      return;
    }

    this.initTabs();
    this.tabs.forEach((tab) => {
      tab.loading = true;
      tab.errorText = "";
      tab.items = [];
    });

    await Promise.all(
      shops.map(async (shop) => {
        const tab = this.tabs.find((entry) => entry.shopCode === shop.ShopCode);
        if (!tab) return;

        try {
          const response = await this.upharmaService.callEndpoint<EmployeePlanResponse>(this.endpoint, {
            Month: this.selectedMonth,
            Year: this.selectedYear,
            Token: session.Token,
            uPharmaID: String(session.UserInfo.uPharmaID),
            ShopCode: shop.ShopCode,
          });

          tab.items = Array.isArray(response.EmployeePlanLst) ? response.EmployeePlanLst : [];
          tab.errorText = "";
        } catch (error) {
          if (!this.isInvalidTokenError(error)) {
            tab.errorText = error instanceof Error ? error.message : String(error);
          }
          tab.items = [];
        } finally {
          tab.loading = false;
        }
      }),
    );
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(value || 0);
  }

  getProjectedValue(actualValue: number): number {
    const now = new Date();
    const isCurrentMonth = this.selectedYear === now.getFullYear() && this.selectedMonth === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return Number(actualValue) || 0;
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(this.selectedYear, this.selectedMonth, 0).getDate();
    return (Number(actualValue) || 0) / completedDays * totalDays;
  }

  buildProjectionHint(actualValue: number): string {
    const now = new Date();
    const isCurrentMonth = this.selectedYear === now.getFullYear() && this.selectedMonth === now.getMonth() + 1;
    if (!isCurrentMonth) {
      return `Giữ nguyên số thực tế ${this.formatNumber(actualValue)}.`;
    }

    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(this.selectedYear, this.selectedMonth, 0).getDate();
    return `${this.formatNumber(actualValue)} / ${completedDays} x ${totalDays} ngày.`;
  }

  getWeightedPointRatio(item: EmployeePlanItem): number {
    const numerator = (Number(item.PointRatioR) || 0) * 1000;
    const denominator = Number(item.AmountR) || 0;
    if (!denominator) {
      return 0;
    }

    return (numerator / denominator) * 100;
  }

  formatPercent(value: number): string {
    return `${Math.round(value)}%`;
  }

  private isInvalidTokenError(error: unknown): boolean {
    return error instanceof Error && error.message.trim().toLowerCase() === "token không hợp lệ, vui lòng đăng nhập lại";
  }
}
