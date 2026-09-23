import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OperationShopInput, ReportCustomInputs, ReportGeneratorService } from "../report-generator.service";
import { UpharmaService } from "../upharma.service";

@Component({
  selector: "app-report-config",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./report-config.component.html",
  styleUrls: ["./report-config.component.css"],
})
export class ReportConfigComponent {
  private upharmaService = inject(UpharmaService);
  private reportGenerator = inject(ReportGeneratorService);

  shops = this.upharmaService.getActiveShops();
  activeShopCode = "SHOP0025";
  exportLoading = false;
  exportStatusText = "";
  
  reportHtml: string | null = null;
  blobUrl: string | null = null;

  reportInputs: ReportCustomInputs = this.createDefaultReportInputs();

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

  resetReportInputs(): void {
    this.reportInputs = this.createDefaultReportInputs();
    this.reportHtml = null;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
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
}
