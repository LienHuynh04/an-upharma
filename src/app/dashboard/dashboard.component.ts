import { CommonModule } from "@angular/common";
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import Chart from "chart.js/auto";
import { UpharmaService } from "../upharma.service";

interface PaymentMethodInfo {
  Cash: number;
  Card: number;
  VNPay: number;
  CK: number;
}

interface StatisticTopProduct {
  ProductID: string;
  ProductName: string;
  Amount: number;
}

interface StatisticSalesDay {
  Day: string;
  AM: number;
  PM: number;
}

interface StatisticCustomerSales {
  CustomerName?: string;
  CustomerPhone?: string;
  QuantityInvoice?: number;
}

interface StatisticsShopResponse {
  RespCode: number;
  RespText: string;
  PaymentMethodInfo?: PaymentMethodInfo;
  TopProductSalesLst?: StatisticTopProduct[];
  SalesDayLst?: StatisticSalesDay[];
  CustomerSalesLst?: StatisticCustomerSales[];
  CustomerInfoLst?: Array<{ Title?: string; Percent?: number; Value?: number }>;
}

interface CustomerNewItem {
  ShopCode: string;
  SalesID: number;
  QuantityCus: number;
  QuantityCusNew: number;
  EmployeeName: string;
  EmployeeCode: string;
}

interface CustomerNewResponse {
  RespCode: number;
  RespText: string;
  CustomerNewLst?: CustomerNewItem[];
}

@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./dashboard.component.html",
  styleUrls: ["./dashboard.component.css"],
})
export class DashboardComponent implements AfterViewInit, OnDestroy {
  readonly statisticsEndpoint = "/CancelProduct/GetStatisticsShop";
  readonly customerNewEndpoint = "/Buyer/GetCustomerNewLst";

  @ViewChild("salesChartCanvas") salesChartCanvas?: ElementRef<HTMLCanvasElement>;

  shops = this.upharmaService.getActiveShops();
  activeShopCode = "";
  selectedStartDate = "";
  selectedEndDate = "";
  dashboardLoading = false;
  chartLoading = false;
  dashboardErrorText = "";
  paymentMethodInfo: PaymentMethodInfo = { Cash: 0, Card: 0, VNPay: 0, CK: 0 };
  topProductSales: StatisticTopProduct[] = [];
  salesDayLst: StatisticSalesDay[] = [];
  customerSalesLst: StatisticCustomerSales[] = [];
  customerNewLst: CustomerNewItem[] = [];
  customerInfoLst: Array<{ title: string; percent: number; value: number }> = [];
  private salesChart: Chart | null = null;

  constructor(private readonly upharmaService: UpharmaService) {}

  ngAfterViewInit(): void {
    this.activeShopCode = this.shops[0]?.ShopCode || "";
    this.setDefaultDateRange();
    void this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.salesChart?.destroy();
    this.salesChart = null;
  }

  get activeShopName(): string {
    return this.shops.find((shop) => shop.ShopCode === this.activeShopCode)?.ShopName || this.activeShopCode;
  }

  async loadDashboard(): Promise<void> {
    const session = this.upharmaService.ensureLogin();

    if (!this.activeShopCode) {
      return;
    }

    this.dashboardLoading = true;
    this.chartLoading = true;
    this.dashboardErrorText = "";
    this.customerNewLst = [];

    try {
      const customerNew = await this.upharmaService.callEndpoint<CustomerNewResponse>(this.customerNewEndpoint, {
        Month: this.getEndMonth(),
        Year: this.getEndYear(),
        Token: session.Token,
        uPharmaID: String(session.UserInfo.uPharmaID),
        ShopCode: this.activeShopCode,
        _useFirebaseCache: this.isDefaultDateRange(),
      });

      this.customerNewLst = customerNew.CustomerNewLst || [];
      this.dashboardLoading = false;

      const statistics = await this.upharmaService.callEndpoint<StatisticsShopResponse>(this.statisticsEndpoint, {
        ShopCode: this.activeShopCode,
        TimeStart: this.getRangeStart(),
        TimeEnd: this.getRangeEnd(),
        Token: session.Token,
        uPharmaID: String(session.UserInfo.uPharmaID),
        _useFirebaseCache: this.isDefaultDateRange(),
      });

      this.paymentMethodInfo = statistics.PaymentMethodInfo || { Cash: 0, Card: 0, VNPay: 0, CK: 0 };
      this.topProductSales = (statistics.TopProductSalesLst || []).slice(0, 5);
      this.salesDayLst = statistics.SalesDayLst || [];
      this.customerSalesLst = statistics.CustomerSalesLst || [];
      this.customerInfoLst = (statistics.CustomerInfoLst || []).map((item) => ({
        title: item.Title || "",
        percent: Number(item.Percent || 0),
        value: Number(item.Value || 0),
      }));
      this.renderSalesChart();
    } catch (error) {
      if (!this.isInvalidTokenError(error)) {
        this.dashboardErrorText = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.dashboardLoading = false;
      this.chartLoading = false;
    }
  }

  async onFilterChange(): Promise<void> {
    await this.loadDashboard();
  }

  formatNumber(value: number): string {
    return new Intl.NumberFormat("vi-VN").format(value || 0);
  }

  formatMoney(value: number): string {
    return `${this.formatNumber(value)} VNĐ`;
  }

  getPaymentTotal(): number {
    return Object.values(this.paymentMethodInfo).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  getPaymentPercent(value: number): string {
    const total = this.getPaymentTotal();
    return total > 0 ? `${((Number(value || 0) / total) * 100).toFixed(2)}%` : "0%";
  }

  getTopProductRank(index: number): number {
    return index + 1;
  }

  getTopProductBg(index: number): string {
    if (index === 0) {
      return "#fff2f2";
    }

    if (index === 1) {
      return "#f2f2ff";
    }

    return "#f2f2f2";
  }

  getTopProductLabel(index: number): string {
    return `${index + 1}. ${this.topProductSales[index]?.ProductName || ""}`;
  }

  private setDefaultDateRange(): void {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    this.selectedStartDate = this.toDateInputValue(start);
    this.selectedEndDate = this.toDateInputValue(end);
  }

  private isDefaultDateRange(): boolean {
    const end = new Date();
    const start = new Date(end);
    start.setMonth(start.getMonth() - 1);
    
    return this.selectedStartDate === this.toDateInputValue(start) && 
           this.selectedEndDate === this.toDateInputValue(end);
  }

  private getRangeStart(): string {
    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    return this.upharmaService.formatUpharmaDateTime(start);
  }

  private getRangeEnd(): string {
    return this.upharmaService.formatUpharmaDateTime(new Date());
  }

  private getEndMonth(): number {
    return this.selectedEndDate ? Number(this.selectedEndDate.slice(5, 7)) : new Date().getMonth() + 1;
  }

  private getEndYear(): number {
    return this.selectedEndDate ? Number(this.selectedEndDate.slice(0, 4)) : new Date().getFullYear();
  }

  private toDateInputValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private renderSalesChart(): void {
    const canvas = this.salesChartCanvas?.nativeElement;
    if (!canvas) {
      return;
    }

    const isDark = document.documentElement.getAttribute("data-bs-theme") === "dark";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
    const textColor = isDark ? "#94a3b8" : "#64748b";

    const labels = this.salesDayLst.map((day) => this.formatDayLabel(day.Day));
    const amValues = this.salesDayLst.map((day) => Number(day.AM || 0) / 1000);
    const pmValues = this.salesDayLst.map((day) => Number(day.PM || 0) / 1000);

    this.salesChart?.destroy();
    this.salesChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Ca Sáng",
            data: amValues,
            backgroundColor: "#c98c1f",
            borderRadius: 4,
            barPercentage: 0.55,
            categoryPercentage: 0.75,
          },
          {
            label: "Ca Tối",
            data: pmValues,
            backgroundColor: "#3b82f6",
            borderRadius: 4,
            barPercentage: 0.55,
            categoryPercentage: 0.75,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              usePointStyle: true,
              pointStyle: "rectRounded",
              boxWidth: 12,
              color: textColor,
              font: {
                size: 12,
              },
            },
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${this.formatMoney((Number(context.raw || 0) * 1000))}`,
            },
          },
        },
        scales: {
          x: {
            grid: {
              display: false,
            },
            ticks: {
              color: textColor,
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: textColor,
              callback: (value) => this.formatMoney(Number(value) * 1000).replace(" VNĐ", ""),
            },
            grid: {
              color: gridColor,
            },
          },
        },
      },
    });
  }

  private formatDayLabel(value: string): string {
    if (!value) {
      return "--/--";
    }

    return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  }

  private isInvalidTokenError(error: unknown): boolean {
    return error instanceof Error && error.message.trim().toLowerCase() === "token không hợp lệ, vui lòng đăng nhập lại";
  }
}
