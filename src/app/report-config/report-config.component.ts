import { CommonModule } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import {
  EmployeePlanItem,
  FefoSummaryItem,
  InventoryExpiryItem,
  OperationShopInput,
  ReportCustomInputs,
  ReportGeneratorService,
  ReportLiveMetrics,
  ShopKpiItem,
} from "../report-generator.service";
import { UpharmaService } from "../upharma.service";
import { environment } from "../../environments/environment";

@Component({
  selector: "app-report-config",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./report-config.component.html",
  styleUrls: ["./report-config.component.css"],
})
export class ReportConfigComponent implements OnInit {
  private upharmaService = inject(UpharmaService);
  private reportGenerator = inject(ReportGeneratorService);
  private readonly storageKey = "upharma_report_config_inputs";

  shops = this.upharmaService.getActiveShops();
  activeShopCode = "SHOP0025";
  exportLoading = false;
  downloadLoading = false;
  saveLoading = false;
  fetchDataLoading = false;
  isLoadingConfig = true;
  showDataForm = false;
  activeDataTab: "kpis" | "inventory" | "fefo" | "employees" = "kpis";
  
  exportStatusText = "";
  downloadStatusText = "";
  fetchDataStatusText = "";
  saveSuccessText = "";
  
  reportHtml: string | null = null;
  blobUrl: string | null = null;

  reportInputs: ReportCustomInputs = { shops: [] };

  private get firebaseDbUrl(): string {
    const url = (environment as any).firebaseDbUrl || "";
    return url.replace(/\/$/, "");
  }

  private get userConfigKey(): string {
    try {
      const session = this.upharmaService.getSession();
      return session?.UserInfo?.uPharmaID ? String(session.UserInfo.uPharmaID) : "default_user";
    } catch {
      return "default_user";
    }
  }

  async ngOnInit(): Promise<void> {
    if (this.shops.length > 0) {
      this.activeShopCode = this.shops[0].ShopCode;
    }
    this.isLoadingConfig = true;
    try {
      await this.loadSavedReportInputs();
    } finally {
      this.isLoadingConfig = false;
    }
  }

  async loadSavedReportInputs(): Promise<void> {
    const uPharmaID = this.userConfigKey;

    // Read directly from Firebase RTDB (Syncs across tabs & devices, 0 localStorage)
    if (this.firebaseDbUrl) {
      try {
        const url = `${this.firebaseDbUrl}/hidden_products/report_config_${uPharmaID}.json`;
        const response = await fetch(url);
        if (response.ok) {
          const remoteData = (await response.json()) as ReportCustomInputs;
          if (remoteData && Array.isArray(remoteData.shops) && remoteData.shops.length > 0) {
            this.reportInputs = remoteData;
            return;
          }
        }
      } catch (e) {
        console.warn("Lỗi đọc cấu hình báo cáo từ Firebase:", e);
      }
    }

    this.reportInputs = this.createDefaultReportInputs();
  }

  async saveReportInputs(): Promise<void> {
    const uPharmaID = this.userConfigKey;
    this.saveLoading = true;

    try {
      // Save directly to Firebase RTDB only (no localStorage)
      if (this.firebaseDbUrl) {
        const url = `${this.firebaseDbUrl}/hidden_products/report_config_${uPharmaID}.json`;
        const response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...this.reportInputs,
            updatedAt: new Date().toISOString(),
          }),
        });
        if (!response.ok) {
          throw new Error(`Firebase RTDB returned status ${response.status}`);
        }
      }

      // Cleanup legacy localStorage key if present
      localStorage.removeItem(this.storageKey);

      this.saveSuccessText = "Đã lưu cấu hình lên Firebase RTDB thành công (tự động đồng bộ các tab)!";
      setTimeout(() => {
        this.saveSuccessText = "";
      }, 4000);
    } catch (e) {
      alert("Lỗi khi lưu cấu hình lên Firebase: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      this.saveLoading = false;
    }
  }

  async resetReportInputs(): Promise<void> {
    const uPharmaID = this.userConfigKey;
    localStorage.removeItem(this.storageKey);
    this.reportInputs = this.createDefaultReportInputs();
    this.reportHtml = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }

    if (this.firebaseDbUrl) {
      try {
        const url = `${this.firebaseDbUrl}/hidden_products/report_config_${uPharmaID}.json`;
        await fetch(url, { method: "DELETE" });
      } catch (e) {
        console.warn("Lỗi xóa cấu hình Firebase:", e);
      }
    }

    this.saveSuccessText = "Đã khôi phục cấu hình mặc định trên Firebase!";
    setTimeout(() => {
      this.saveSuccessText = "";
    }, 3500);
  }

  createDefaultReportInputs(): ReportCustomInputs {
    return {
      shops: [
        {
          shopCode: "SHOP0025",
          shopName: "Nhà thuốc số 25 (Bồ Đề)",
          status: "Đang chạy",
          promoItemsText: "Mua 2 tặng 1 nhóm Hoạt huyết dưỡng não\nGiảm 10% TPCN cho khách hàng thân thiết\nTặng quà cho đơn hàng từ 500k",
          goodsNote: "Đã lọc và bổ sung 97% các mã hàng key. Thực hiện lọc hàng hết 2 lần mỗi tuần.",
          cskhNote: "Hướng dẫn nhân viên lọc danh sách khách hàng cần ưu tiên chăm sóc và các chỉ tiêu dễ thăng hạng trên POS.",
          nextWeekItemsText: "Kiểm tra và chỉnh sửa các đơn hàng sai FEFO.\nĐẩy hàng cận date.\nKiểm tra chăm sóc khách hàng của nhà 25 và bắt đầu bàn giao công việc của Lan Anh.",
        },
        {
          shopCode: "SHOP0097",
          shopName: "Nhà thuốc số 97 (Nguyễn Sơn)",
          status: "Nội bộ",
          promoItemsText: "Chương trình tích điểm nhân đôi cuối tuần\nGiảm 15% thực phẩm chức năng nhập khẩu\nCombo chăm sóc sức khỏe gia đình",
          goodsNote: "Đẩy mạnh luân chuyển hàng giữa các nhà thuốc. Kiểm soát chặt chẽ tồn kho cận date.",
          cskhNote: "Gọi điện chăm sóc lại danh sách khách hàng cũ, giới thiệu chương trình khách hàng thân thiết mới.",
          nextWeekItemsText: "Kiểm tra và chỉnh sửa các đơn hàng sai FEFO.\nĐẩy hàng cận date.\nThông báo luân chuyển nhân sự cho tháng 10.",
        },
        {
          shopCode: "SHOP0144",
          shopName: "Nhà thuốc số 144 (Vũ Trọng Phụng)",
          status: "Đang chạy",
          promoItemsText: "Tặng voucher 50k cho đơn hàng tiếp theo\nMiễn phí đo huyết áp & tư vấn sức khỏe\nChiết khấu 5% khi thanh toán VNPay",
          goodsNote: "Rà soát các mặt hàng bán chậm, chốt danh sách hàng cận date trước ngày 25.",
          cskhNote: "Tập trung tư vấn đơn hàng combo và hướng dẫn khách hàng thăng hạng VIP.",
          nextWeekItemsText: "Bàn giao công việc CHT cho Quỳnh.\nBàn giao công việc của Trà My cho nhân sự mới.",
        },
      ],
    };
  }

  getShopInput(shopCode: string): OperationShopInput {
    if (!this.reportInputs.shops) {
      this.reportInputs.shops = [];
    }
    let shop = this.reportInputs.shops.find((s) => s.shopCode === shopCode);
    if (!shop) {
      const matchShop = this.shops.find((s) => s.ShopCode === shopCode);
      shop = {
        shopCode,
        shopName: matchShop?.ShopName || shopCode,
        status: "Đang chạy",
        promoItemsText: "",
        goodsNote: "",
        cskhNote: "",
        nextWeekItemsText: "",
      };
      this.reportInputs.shops.push(shop);
    }
    return shop;
  }

  async fetchLiveReportData(): Promise<void> {
    if (this.fetchDataLoading) return;
    this.fetchDataLoading = true;
    this.fetchDataStatusText = "Bắt đầu lấy dữ liệu từ hệ thống...";

    try {
      const metrics = await this.reportGenerator.collectReportLiveMetrics((msg, pct) => {
        this.fetchDataStatusText = `${msg} (${pct}%)`;
      });
      this.reportInputs.liveMetrics = metrics;
      this.showDataForm = true;
      setTimeout(() => {
        const dataFormElem = document.getElementById("data-override-section");
        if (dataFormElem) {
          dataFormElem.scrollIntoView({ behavior: "smooth" });
        }
      }, 150);
    } catch (error) {
      console.error("Lỗi lấy dữ liệu báo cáo:", error);
      alert("Lỗi khi lấy dữ liệu: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.fetchDataLoading = false;
      this.fetchDataStatusText = "";
    }
  }

  clearLiveMetrics(): void {
    if (confirm("Bạn có chắc muốn xóa dữ liệu đã lấy này? Hệ thống sẽ thu thập lại từ đầu khi xuất báo cáo.")) {
      this.reportInputs.liveMetrics = undefined;
      this.showDataForm = false;
    }
  }

  getShopKpi(shopCode: string): ShopKpiItem {
    if (!this.reportInputs.liveMetrics) {
      this.reportInputs.liveMetrics = {
        collectedAt: new Date().toISOString(),
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        shopKpis: {},
        inventoryStats: {},
        fefoStats: {},
        employeePlans: {},
      };
    }
    if (!this.reportInputs.liveMetrics.shopKpis[shopCode]) {
      this.reportInputs.liveMetrics.shopKpis[shopCode] = {
        salesTarget: 0,
        salesActual: 0,
        salesPercent: 0,
        salesProjected: 0,
        hhsTarget: 0,
        hhsActual: 0,
        hhsPercent: 0,
        hhsProjected: 0,
        hhsRatio: 0,
      };
    }
    return this.reportInputs.liveMetrics.shopKpis[shopCode];
  }

  getInventoryStats(shopCode: string): InventoryExpiryItem {
    if (!this.reportInputs.liveMetrics) {
      this.getShopKpi(shopCode);
    }
    if (!this.reportInputs.liveMetrics!.inventoryStats[shopCode]) {
      this.reportInputs.liveMetrics!.inventoryStats[shopCode] = {
        totalQty: 0,
        totalVal: 0,
        expiredCount: 0,
        expiredVal: 0,
        m3Count: 0,
        m3Val: 0,
        m6Count: 0,
        m6Val: 0,
        y1Count: 0,
        y1Val: 0,
        normalCount: 0,
        normalVal: 0,
      };
    }
    return this.reportInputs.liveMetrics!.inventoryStats[shopCode];
  }

  getFefoStats(shopCode: string): FefoSummaryItem {
    if (!this.reportInputs.liveMetrics) {
      this.getShopKpi(shopCode);
    }
    if (!this.reportInputs.liveMetrics!.fefoStats[shopCode]) {
      this.reportInputs.liveMetrics!.fefoStats[shopCode] = {
        totalLines: 0,
        wrongCases: 0,
        errRate: "0,00%",
        affectedProds: 0,
        totalWrongQty: 0,
        empSummaries: [],
      };
    }
    return this.reportInputs.liveMetrics!.fefoStats[shopCode];
  }

  getEmployeePlans(shopCode: string): EmployeePlanItem[] {
    if (!this.reportInputs.liveMetrics) {
      this.getShopKpi(shopCode);
    }
    if (!this.reportInputs.liveMetrics!.employeePlans[shopCode]) {
      this.reportInputs.liveMetrics!.employeePlans[shopCode] = [];
    }
    return this.reportInputs.liveMetrics!.employeePlans[shopCode];
  }

  formatMoney(val: number): string {
    return new Intl.NumberFormat("vi-VN").format(Math.round(val || 0)) + " đ";
  }

  formatNumber(val: number): string {
    return new Intl.NumberFormat("vi-VN").format(Math.round(val || 0));
  }

  recalculateKpis(shopCode: string): void {
    const kpi = this.getShopKpi(shopCode);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const completedDays = Math.max(1, now.getDate() - 1);
    const totalDays = new Date(currentYear, currentMonth, 0).getDate();

    if (kpi.salesTarget > 0) {
      kpi.salesPercent = Math.round((kpi.salesActual / kpi.salesTarget) * 100);
    } else {
      kpi.salesPercent = 0;
    }

    if (kpi.hhsTarget > 0) {
      kpi.hhsPercent = Math.round((kpi.hhsActual / kpi.hhsTarget) * 100);
    } else {
      kpi.hhsPercent = 0;
    }

    if (completedDays > 0) {
      kpi.salesProjected = Math.round((kpi.salesActual / completedDays) * totalDays);
      kpi.hhsProjected = Math.round((kpi.hhsActual / completedDays) * totalDays);
    }

    if (kpi.salesActual > 0) {
      kpi.hhsRatio = Math.round(((kpi.hhsActual * 1000) / kpi.salesActual) * 100);
    } else {
      kpi.hhsRatio = 0;
    }
  }

  recalculateInventoryTotals(shopCode: string): void {
    const inv = this.getInventoryStats(shopCode);
    inv.totalVal = (inv.expiredVal || 0) + (inv.m3Val || 0) + (inv.m6Val || 0) + (inv.y1Val || 0) + (inv.normalVal || 0);
  }

  recalculateFefo(shopCode: string): void {
    const fefo = this.getFefoStats(shopCode);
    if (fefo.totalLines > 0) {
      const pct = (fefo.wrongCases / fefo.totalLines) * 100;
      fefo.errRate = pct.toFixed(2).replace(".", ",") + "%";
    } else {
      fefo.errRate = "0,00%";
    }
  }

  addEmployee(shopCode: string): void {
    const list = this.getEmployeePlans(shopCode);
    list.push({
      employeeCode: "",
      employeeName: "Dược sĩ mới",
      targetAmount: 0,
      actualAmount: 0,
      targetPoint: 0,
      actualPoint: 0,
      quantityCus: 0,
      quantityCusNew: 0,
      quantityInvoice: 0,
    });
  }

  removeEmployee(shopCode: string, index: number): void {
    const list = this.getEmployeePlans(shopCode);
    if (index >= 0 && index < list.length) {
      list.splice(index, 1);
    }
  }

  addFefoEmployee(shopCode: string): void {
    const fefo = this.getFefoStats(shopCode);
    if (!fefo.empSummaries) {
      fefo.empSummaries = [];
    }
    fefo.empSummaries.push({
      employeeName: "Dược sĩ",
      totalLines: 0,
      wrongCases: 0,
      errRate: "0,00%",
      affectedProds: 0,
      totalWrongQty: 0,
    });
  }

  removeFefoEmployee(shopCode: string, index: number): void {
    const fefo = this.getFefoStats(shopCode);
    if (fefo.empSummaries && index >= 0 && index < fefo.empSummaries.length) {
      fefo.empSummaries.splice(index, 1);
    }
  }

  async previewDirectly(): Promise<void> {
    await this.generateReport(false);
    setTimeout(() => {
      const previewElem = document.getElementById("live-preview-section");
      if (previewElem) {
        previewElem.scrollIntoView({ behavior: "smooth" });
      }
    }, 150);
  }

  async generateReport(openInNewTab: boolean = true): Promise<void> {
    if (this.exportLoading) return;
    this.exportLoading = true;
    this.exportStatusText = "Đang tổng hợp dữ liệu báo cáo...";

    try {
      const result = await this.reportGenerator.generateReportHtml(this.reportInputs, (msg) => {
        this.exportStatusText = msg;
      });

      this.reportHtml = result.html;

      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
      }
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      this.blobUrl = URL.createObjectURL(blob);

      if (openInNewTab) {
        const previewWindow = window.open(this.blobUrl, "_blank");
        if (!previewWindow) {
          alert("Trình duyệt đã chặn popup. Vui lòng cho phép popup để mở tab xem trước báo cáo.");
        }
      }
    } catch (error) {
      console.error("Lỗi xuất HTML báo cáo:", error);
      alert("Lỗi khi xuất HTML báo cáo: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.exportLoading = false;
      this.exportStatusText = "";
    }
  }

  async downloadReport(): Promise<void> {
    if (this.downloadLoading) return;
    this.downloadLoading = true;
    this.downloadStatusText = "Đang tổng hợp dữ liệu báo cáo...";

    try {
      const result = await this.reportGenerator.generateReportHtml(this.reportInputs, (msg) => {
        this.downloadStatusText = msg;
      });

      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Lỗi tải báo cáo:", error);
      alert("Lỗi khi tải báo cáo: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.downloadLoading = false;
      this.downloadStatusText = "";
    }
  }
}
