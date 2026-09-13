import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { environment } from "../../environments/environment";
import {
  formatMoney,
  normalizeFilterText,
  normalizeInventoryRow,
  PRODUCT_NAME_COLLATOR,
  parseNumericValue,
  InventoryItem,
} from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

export type FefoStatus = "all" | "violation" | "compliant" | "in_stock" | "out_of_stock";

export interface FefoItem {
  rowKey: string;
  shopCode: string;
  shopName: string;
  productCode: string;
  productName: string;
  unit: string;

  // Sales order details
  soldLot: string;
  soldExpiryText: string;
  soldExpiryDays: number | null;
  saleDateText: string;
  saleQty: number;
  saleQtyText: string;
  saleAmount: number;
  saleAmountText: string;
  employeeName: string;

  // Inventory FEFO reference
  inStock: boolean;
  totalStockQty: number;
  fefoLot: string;
  fefoExpiryText: string;
  fefoExpiryDays: number | null;
  inventoryLotsCount: number;
  inventoryLots: InventoryItem[];

  // FEFO status & UI formatting
  fefoStatus: FefoStatus;
  fefoStatusLabel: string;
  badgeClass: string;

  searchText: string;
  columnSearchText: Record<string, string>;
  expanded: boolean;
}

export interface ShopFefoSummary {
  shopCode: string;
  shopName: string;
  totalSalesLines: number;
  fefoViolations: number;
  violationRate: number;
  violationRateText: string;
  affectedProductsCount: number;
  totalQtySoldWrongOrder: number;
  totalQtySoldWrongOrderText: string;
}

export interface EmployeeFefoSummary {
  shopCode: string;
  shopName: string;
  employeeName: string;
  totalSalesLines: number;
  fefoViolations: number;
  violationRate: number;
  violationRateText: string;
  affectedProductsCount: number;
  totalQtySoldWrongOrder: number;
  totalQtySoldWrongOrderText: string;
}

interface FefoSummary {
  all: number;
  violation: number;
  compliant: number;
  in_stock: number;
  out_of_stock: number;
}

@Component({
  selector: "app-fefo",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./fefo.component.html",
})
export class FefoComponent implements OnInit {
  readonly searchDebounceMs = 300;

  shops: ShopInfo[] = [];
  activeShopCode = "";
  loading = false;
  loadingProgress = 0;
  cacheStatus = "";
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  filtersCollapsed = true;

  activeTab: "detail" | "shop_summary" | "employee_summary" = "detail";
  startDate: string = "2026-09-01";
  endDate: string = "2026-09-07";

  selectedStatusFilter: FefoStatus = "all";
  columnFilters: Record<string, string> = {
    productName: "",
    productCode: "",
    employeeName: "",
  };

  rows: FefoItem[] = [];
  filteredRows: FefoItem[] = [];
  visibleCount = 50;

  selectedFefoItem: FefoItem | null = null;

  shopSummaries: ShopFefoSummary[] = [];
  employeeSummaries: EmployeeFefoSummary[] = [];

  summary: FefoSummary = {
    all: 0,
    violation: 0,
    compliant: 0,
    in_stock: 0,
    out_of_stock: 0,
  };

  private filterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";
    this.shops = this.upharmaService.getActiveShops();
    this.activeShopCode = this.getDefaultShopCode();
    void this.loadData();
  }

  get displayedRows(): FefoItem[] {
    return this.filteredRows.slice(0, this.visibleCount);
  }

  get employeeOptions(): string[] {
    const set = new Set<string>();
    const sourceRows = this.activeShopCode
      ? this.rows.filter((r) => r.shopCode === this.activeShopCode)
      : this.rows;
    for (const r of sourceRows) {
      if (r.employeeName && r.employeeName.trim()) {
        set.add(r.employeeName.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }

  get activeShopName(): string {
    const matched = this.shops.find((s) => s.ShopCode === this.activeShopCode);
    return matched ? matched.ShopName : this.activeShopCode;
  }

  get statusCards(): { key: FefoStatus; label: string; count: number; sublabel: string; statusBg: string }[] {
    return [
      { key: "all", label: "Tất cả đối soát", count: this.summary.all, sublabel: "Tổng mặt hàng/đơn", statusBg: "bg-primary" },
      { key: "violation", label: "Cảnh báo FEFO", count: this.summary.violation, sublabel: "Vi phạm/cận date", statusBg: "bg-danger" },
      { key: "compliant", label: "Đạt FEFO", count: this.summary.compliant, sublabel: "Bán chuẩn lô đát", statusBg: "bg-success" },
      { key: "in_stock", label: "Có trong Tồn kho", count: this.summary.in_stock, sublabel: "Khớp tồn kho", statusBg: "bg-info" },
      { key: "out_of_stock", label: "Hết tồn kho", count: this.summary.out_of_stock, sublabel: "Kho hiện bằng 0", statusBg: "bg-secondary" },
    ];
  }

  onTableScroll(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const threshold = 160;
    const reachedBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - threshold;
    if (reachedBottom && this.visibleCount < this.filteredRows.length) {
      this.visibleCount += 25;
    }
  }

  applyShopFilter(shopCode: string): void {
    this.activeShopCode = shopCode;
    this.recomputeFilteredRows();
  }

  setStatusFilter(status: FefoStatus): void {
    this.selectedStatusFilter = status;
    this.recomputeFilteredRows();
  }

  filterByEmployee(employeeName: string, shopCode?: string): void {
    if (shopCode) {
      this.activeShopCode = shopCode;
    }
    this.columnFilters["employeeName"] = employeeName;
    this.filtersCollapsed = false;
    this.activeTab = "detail";
    this.recomputeFilteredRows();
  }

  onSearchInput(): void {
    if (this.filterTimer) {
      clearTimeout(this.filterTimer);
    }
    this.filterTimer = setTimeout(() => {
      this.recomputeFilteredRows();
      this.filterTimer = null;
    }, this.searchDebounceMs);
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  toggleRecord(item: FefoItem): void {
    item.expanded = !item.expanded;
  }

  openFefoDetail(item: FefoItem): void {
    this.selectedFefoItem = item;
  }

  closeFefoDetail(): void {
    this.selectedFefoItem = null;
  }

  trackByFefo(_: number, item: FefoItem): string {
    return item.rowKey;
  }

  trackByShop(_: number, shop: ShopInfo): string {
    return shop.ShopCode;
  }

  async loadData(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 20;
    this.errorText = "";
    this.cacheStatus = "Đang tải dữ liệu tồn kho và đơn bán hàng của tất cả nhà thuốc...";

    try {
      // 1. Fetch inventory data for all active shops
      this.loadingProgress = 40;
      const allShopCodes = this.shops.map((s) => s.ShopCode);
      const inventoryRes = await this.upharmaService.loadInventoryResource({
        shopCodes: allShopCodes.length > 0 ? allShopCodes : undefined,
      });

      const rawInventory = inventoryRes.data || [];
      const inventoryItems = rawInventory.map((row, idx) => normalizeInventoryRow(row, idx));

      // Group inventory items by shopCode + productCode
      const inventoryByShopProduct = new Map<string, InventoryItem[]>();
      for (const item of inventoryItems) {
        const code = item.productCode.trim();
        const shop = item.shopCode.trim();
        if (!code) continue;
        const key = `${shop}|${code}`;
        const list = inventoryByShopProduct.get(key) || [];
        list.push(item);
        inventoryByShopProduct.set(key, list);
      }

      // Sort inventory items for each product by expiry date (earliest first - FEFO)
      for (const [, list] of inventoryByShopProduct.entries()) {
        list.sort((a, b) => {
          if (a.expiryDaysRemaining === null && b.expiryDaysRemaining === null) return 0;
          if (a.expiryDaysRemaining === null) return 1;
          if (b.expiryDaysRemaining === null) return -1;
          return a.expiryDaysRemaining - b.expiryDaysRemaining;
        });
      }

      // 2. Fetch sales order report data for ALL active shops in parallel
      this.loadingProgress = 70;
      const session = this.upharmaService.getSession();
      const shopSalesPromises = this.shops.map(async (shop) => {
        try {
          const salesRes = await this.upharmaService.callEndpoint<any>(
            "/SalesInvoice/GetReportSalesByShop",
            {
              uPharmaID: session?.UserInfo?.uPharmaID,
              Token: session?.Token,
              ShopCode: shop.ShopCode,
              _useFirebaseCache: true,
            },
            { cache: true }
          );
          const expanded = this.extractSalesArray(salesRes);
          return expanded.map((r) => ({
            ...r,
            ShopCode: r["ShopCode"] || shop.ShopCode,
            ShopName: r["ShopName"] || shop.ShopName,
          }));
        } catch (salesErr) {
          console.warn(`Không tải được đơn bán hàng cho nhà thuốc ${shop.ShopCode}:`, salesErr);
          return [];
        }
      });

      const salesPerShop = await Promise.all(shopSalesPromises);
      const salesData = salesPerShop.flat();

      this.loadingProgress = 90;
      this.rows = this.processFefoRows(salesData, inventoryByShopProduct);

      this.recomputeFilteredRows();
      this.cacheStatus = `Đã cập nhật đối soát FEFO cho tất cả ${this.shops.length} nhà thuốc (${this.rows.length} đơn/mặt hàng).`;
      this.loadingProgress = 100;
    } catch (err) {
      console.error("Lỗi tải dữ liệu FEFO:", err);
      this.errorText = err instanceof Error ? err.message : "Không thể tải dữ liệu kiểm tra FEFO.";
    } finally {
      this.loading = false;
    }
  }

  private processFefoRows(
    salesData: RawRecord[],
    inventoryByShopProduct: Map<string, InventoryItem[]>
  ): FefoItem[] {
    const result: FefoItem[] = [];

    if (salesData.length > 0) {
      // Process sales records
      salesData.forEach((row, index) => {
        const productCode = String(
          this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]) || ""
        ).trim();
        const productName = String(
          this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "Product_Name_Full", "TenSP", "TenSanPham", "Name", "ItemName"]) || productCode || "Sản phẩm"
        ).trim();

        if (
          productCode.toUpperCase().includes("VOUCHER") ||
          productName.toUpperCase().includes("VOUCHER") ||
          productCode.toUpperCase().startsWith("VC")
        ) {
          return;
        }
        const shopCode = String(
          this.pick(row, ["ShopCode", "__shopCode", "BranchCode", "StoreCode"]) || this.activeShopCode
        ).trim();
        const matchedShop = this.shops.find((s) => s.ShopCode === shopCode);
        const shopName = String(
          this.pick(row, ["ShopName", "__shopName", "BranchName", "StoreName"]) || (matchedShop ? matchedShop.ShopName : shopCode)
        ).trim();
        const unit = String(
          this.pick(row, ["UnitOfMeasure", "UnitName", "Unit_Name", "Unit", "UnitCode", "DonVi", "DonViTinh", "DVT"]) || ""
        ).trim();

        const soldLot = String(
          this.pick(row, ["LotCode", "LotNo", "Lo", "SoLo", "BatchNo", "BatchCode"]) || "-"
        ).trim();
        const soldExpiryRaw = this.pick(row, [
          "ExpirationDate", "ExpDate", "ExpireDate", "ExpiredDate", "ExpiryDate", "ExpDateTxt", "ExpDateText",
          "ExpireDateTxt", "ExpiredDateTxt", "HanDung", "HSD", "DateExp", "DateExpired",
          "DateExpire", "UseDate", "ValidDate", "ShelfLifeDate", "LotExpireDate", "NgayHetHan", "NgayHSD"
        ]);
        const soldExpiryText = soldExpiryRaw ? this.formatDisplayDateText(soldExpiryRaw) : "N/A";
        const saleQty = parseNumericValue(this.pick(row, ["Quantity", "Qty", "SL", "SoLuong", "AmountQty"]) || 1);
        const saleAmount = parseNumericValue(this.pick(row, ["AmountIncludingVAT", "Amount", "TotalAmount", "ThanhTien"]) || 0);
        const saleDateRaw = this.pick(row, [
          "OrderDate", "SaleDate", "InvoiceDate", "PostingDate", "DateCreate", "TimeCreate", "CreatedDate", "TimeInvoice", "NgayBan"
        ]);
        const saleDateText = saleDateRaw ? String(saleDateRaw).trim() : "";
        const employeeName = String(
          this.pick(row, ["SalesName", "EmployeeName", "StaffName", "SalesStaffName", "UserName", "FullName", "Employee", "EmpName", "SellerName", "NhanVien"]) || ""
        ).trim();

        // Cross-check with inventory for this specific shop + product
        const invKey = `${shopCode}|${productCode}`;
        const invList = inventoryByShopProduct.get(invKey) || inventoryByShopProduct.get(productCode) || [];
        const inStock = invList.length > 0;
        const totalStockQty = invList.reduce((sum, item) => sum + (parseNumericValue(item.quantity) || 0), 0);

        let fefoLot = "";
        let fefoExpiryText = "N/A";
        let fefoExpiryDays: number | null = null;
        let fefoStatus: FefoStatus = "out_of_stock";
        let fefoStatusLabel = "Hết tồn kho";
        let badgeClass = "badge bg-secondary-lt";

        if (inStock) {
          const earliestInvItem = invList[0]; // Sorted earliest first
          fefoLot = earliestInvItem.lot || "N/A";
          fefoExpiryText = earliestInvItem.expiryText || "N/A";
          fefoExpiryDays = earliestInvItem.expiryDaysRemaining;

          const soldDays = this.parseDaysFromText(soldExpiryText);

          if (soldDays !== null && fefoExpiryDays !== null && soldDays > fefoExpiryDays + 30) {
            // Sold a lot expiring later while earlier expiring lot exists in stock -> Violation!
            fefoStatus = "violation";
            fefoStatusLabel = "Cảnh báo Vi phạm FEFO";
            badgeClass = "badge bg-danger-lt fw-bold";
          } else if (soldDays !== null && fefoExpiryDays !== null && Math.abs(soldDays - fefoExpiryDays) <= 30) {
            fefoStatus = "compliant";
            fefoStatusLabel = "Đạt FEFO";
            badgeClass = "badge bg-success-lt";
          } else {
            fefoStatus = "in_stock";
            fefoStatusLabel = "Có trong tồn kho";
            badgeClass = "badge bg-info-lt";
          }
        }

        const fefoRow: FefoItem = {
          rowKey: `sales|${productCode}|${shopCode}|${index}`,
          shopCode,
          shopName,
          productCode,
          productName,
          unit,
          soldLot,
          soldExpiryText,
          soldExpiryDays: this.parseDaysFromText(soldExpiryText),
          saleDateText,
          saleQty,
          saleQtyText: formatMoney(saleQty),
          saleAmount,
          saleAmountText: formatMoney(saleAmount),
          employeeName,
          inStock,
          totalStockQty,
          fefoLot,
          fefoExpiryText,
          fefoExpiryDays,
          inventoryLotsCount: invList.length,
          inventoryLots: invList,
          fefoStatus,
          fefoStatusLabel,
          badgeClass,
          searchText: normalizeFilterText(`${productName} ${productCode} ${soldLot} ${employeeName}`),
          columnSearchText: {
            productName: normalizeFilterText(productName),
            productCode: normalizeFilterText(productCode),
            employeeName: normalizeFilterText(employeeName),
          },
          expanded: false,
        };

        result.push(fefoRow);
      });
    } else {
      // Fallback: If no sales invoice data loaded, inspect inventory lots to highlight multi-lot products needing FEFO priority
      let idx = 0;
      for (const [key, invList] of inventoryByShopProduct.entries()) {
        idx++;
        const first = invList[0];
        if (!first) continue;
        const code = key.includes("|") ? key.split("|")[1] : key;
        const itemShopCode = key.includes("|") ? key.split("|")[0] : this.activeShopCode;
        const matchedShop = this.shops.find((s) => s.ShopCode === itemShopCode);
        const itemShopName = matchedShop ? matchedShop.ShopName : itemShopCode;

        if (
          code.toUpperCase().includes("VOUCHER") ||
          first.productName.toUpperCase().includes("VOUCHER") ||
          code.toUpperCase().startsWith("VC")
        ) {
          continue;
        }
        const hasMultipleLots = invList.length > 1;
        const totalQty = invList.reduce((sum: number, i: InventoryItem) => sum + (parseNumericValue(i.quantity) || 0), 0);

        let fefoStatus: FefoStatus = "in_stock";
        let fefoStatusLabel = "Có trong tồn kho";
        let badgeClass = "badge bg-info-lt";

        if (hasMultipleLots) {
          const earliestDays = first.expiryDaysRemaining;
          if (earliestDays !== null && earliestDays <= 90) {
            fefoStatus = "violation";
            fefoStatusLabel = "Ưu tiên xuất trước (Cận date)";
            badgeClass = "badge bg-warning-lt fw-bold";
          } else {
            fefoStatus = "compliant";
            fefoStatusLabel = "Nhiều lô (Cần theo FEFO)";
            badgeClass = "badge bg-primary-lt";
          }
        }

        const fefoRow: FefoItem = {
          rowKey: `inv|${code}|${itemShopCode}|${idx}`,
          shopCode: itemShopCode,
          shopName: itemShopName,
          productCode: code,
          productName: first.productName,
          unit: first.unit,
          soldLot: first.lot || "-",
          soldExpiryText: first.expiryText || "-",
          soldExpiryDays: first.expiryDaysRemaining,
          saleDateText: "Trong tồn kho",
          saleQty: parseNumericValue(first.quantity),
          saleQtyText: formatMoney(first.quantity),
          saleAmount: first.stockValue,
          saleAmountText: first.stockValueText,
          employeeName: "Dữ liệu Tồn kho",
          inStock: true,
          totalStockQty: totalQty,
          fefoLot: first.lot || "-",
          fefoExpiryText: first.expiryText || "-",
          fefoExpiryDays: first.expiryDaysRemaining,
          inventoryLotsCount: invList.length,
          inventoryLots: invList,
          fefoStatus,
          fefoStatusLabel,
          badgeClass,
          searchText: normalizeFilterText(`${first.productName} ${code} ${first.lot}`),
          columnSearchText: {
            productName: normalizeFilterText(first.productName),
            productCode: normalizeFilterText(code),
            employeeName: normalizeFilterText("Dữ liệu Tồn kho"),
          },
          expanded: false,
        };

        result.push(fefoRow);
      }
    }

    return result.sort((a, b) => PRODUCT_NAME_COLLATOR.compare(a.productName, b.productName));
  }

  recomputeFilteredRows(): void {
    const statusFilter = this.selectedStatusFilter;
    const nameFilter = normalizeFilterText(this.columnFilters["productName"]);
    const codeFilter = normalizeFilterText(this.columnFilters["productCode"]);
    const empFilter = normalizeFilterText(this.columnFilters["employeeName"]);

    this.filteredRows = this.rows.filter((item) => {
      if (this.activeShopCode && item.shopCode !== this.activeShopCode) {
        return false;
      }
      if (statusFilter !== "all" && item.fefoStatus !== statusFilter) {
        return false;
      }
      if (nameFilter && !item.columnSearchText["productName"].includes(nameFilter)) {
        return false;
      }
      if (codeFilter && !item.columnSearchText["productCode"].includes(codeFilter)) {
        return false;
      }
      if (empFilter && !item.columnSearchText["employeeName"].includes(empFilter)) {
        return false;
      }
      return true;
    });

    this.visibleCount = 50;
    this.updateSummary();
  }

  resetDefaults(): void {
    this.selectedStatusFilter = "all";
    this.columnFilters = { productName: "", productCode: "", employeeName: "" };
    this.recomputeFilteredRows();
  }

  async exportToExcel(): Promise<void> {
    try {
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();

      let sheetRows: any[] = [];
      let sheetName = "Doi-soat-FEFO";

      if (this.activeTab === "shop_summary") {
        sheetName = "Tong-hop-Nha-thuoc";
        sheetRows = this.shopSummaries.map((s) => ({
          "Nhà thuốc": s.shopCode,
          "Tổng số dòng bán": s.totalSalesLines,
          "Số ca sai FEFO": s.fefoViolations,
          "Tỷ lệ % sai": s.violationRateText,
          "Số mã SP ảnh hưởng": s.affectedProductsCount,
          "Tổng SL bán sai thứ tự": s.totalQtySoldWrongOrderText,
        }));
      } else if (this.activeTab === "employee_summary") {
        sheetName = "Tong-hop-Nhan-vien";
        sheetRows = this.employeeSummaries.map((e) => ({
          "Nhà thuốc": e.shopCode,
          "Nhân viên": e.employeeName,
          "Tổng số dòng bán": e.totalSalesLines,
          "Số ca sai FEFO": e.fefoViolations,
          "Tỷ lệ % sai": e.violationRateText,
          "Số mã SP ảnh hưởng": e.affectedProductsCount,
          "Tổng SL bán sai thứ tự": e.totalQtySoldWrongOrderText,
        }));
      } else {
        sheetName = "Chi-tiet-FEFO";
        sheetRows = this.filteredRows.map((r) => ({
          "Nhà thuốc": r.shopCode,
          "Mã SP": r.productCode,
          "Tên sản phẩm": r.productName,
          "ĐVT": r.unit,
          "Lô xuất bán": r.soldLot,
          "HSD Lô bán": r.soldExpiryText,
          "SL xuất bán": r.saleQty,
          "Thành tiền": r.saleAmountText,
          "Nhân viên bán": r.employeeName,
          "Lô FEFO (HSD gần nhất)": r.fefoLot,
          "HSD Lô FEFO": r.fefoExpiryText,
          "Tổng tồn kho": r.totalStockQty,
          "Trạng thái FEFO": r.fefoStatusLabel,
        }));
      }

      if (sheetRows.length === 0) {
        return;
      }

      const worksheet = xlsx.utils.json_to_sheet(sheetRows);
      xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

      const buffer = xlsx.write(workbook, {
        bookType: "xlsx",
        type: "array",
      }) as ArrayBuffer;

      const dateStr = new Date().toISOString().slice(0, 10);
      const shopTag = this.activeShopCode ? this.activeShopCode : "Tat_ca";
      const tabTag = this.activeTab === "detail" ? "Chi_tiet" : (this.activeTab === "shop_summary" ? "Tong_hop_Nha" : "Tong_hop_NV");
      const filename = `Bao_cao_FEFO_${tabTag}_${shopTag}_${dateStr}.xlsx`;

      this.downloadExcelBuffer(buffer, filename);
    } catch (err) {
      console.error("Lỗi xuất file Excel:", err);
    }
  }

  private downloadExcelBuffer(buffer: ArrayBuffer, fileName: string): void {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private updateSummary(): void {
    const targetRows = this.activeShopCode
      ? this.rows.filter((r) => r.shopCode === this.activeShopCode)
      : this.rows;

    const counts: FefoSummary = {
      all: targetRows.length,
      violation: 0,
      compliant: 0,
      in_stock: 0,
      out_of_stock: 0,
    };

    for (const item of targetRows) {
      if (item.fefoStatus in counts) {
        counts[item.fefoStatus as keyof FefoSummary]++;
      }
    }
    this.summary = counts;

    // Calculate Shop-level summary
    const shopMap = new Map<string, {
      shopCode: string;
      shopName: string;
      total: number;
      violations: number;
      affectedProducts: Set<string>;
      wrongOrderQty: number;
    }>();

    // Calculate Employee-level summary
    const empMap = new Map<string, {
      shopCode: string;
      shopName: string;
      employeeName: string;
      total: number;
      violations: number;
      affectedProducts: Set<string>;
      wrongOrderQty: number;
    }>();

    for (const item of targetRows) {
      // 1. Shop grouping
      const sKey = item.shopCode;
      if (!shopMap.has(sKey)) {
        shopMap.set(sKey, {
          shopCode: sKey,
          shopName: item.shopName,
          total: 0,
          violations: 0,
          affectedProducts: new Set(),
          wrongOrderQty: 0,
        });
      }
      const sData = shopMap.get(sKey)!;
      sData.total++;
      if (item.fefoStatus === "violation") {
        sData.violations++;
        sData.affectedProducts.add(item.productCode);
        sData.wrongOrderQty += item.saleQty;
      }

      // 2. Employee grouping
      const empName = item.employeeName || "Dược sĩ / Thu ngân";
      const eKey = `${sKey}|${empName}`;
      if (!empMap.has(eKey)) {
        empMap.set(eKey, {
          shopCode: sKey,
          shopName: item.shopName,
          employeeName: empName,
          total: 0,
          violations: 0,
          affectedProducts: new Set(),
          wrongOrderQty: 0,
        });
      }
      const eData = empMap.get(eKey)!;
      eData.total++;
      if (item.fefoStatus === "violation") {
        eData.violations++;
        eData.affectedProducts.add(item.productCode);
        eData.wrongOrderQty += item.saleQty;
      }
    }

    this.shopSummaries = Array.from(shopMap.values()).map((s) => {
      const rate = s.total > 0 ? (s.violations / s.total) * 100 : 0;
      return {
        shopCode: s.shopCode,
        shopName: s.shopName,
        totalSalesLines: s.total,
        fefoViolations: s.violations,
        violationRate: rate,
        violationRateText: `${rate.toFixed(2)}%`,
        affectedProductsCount: s.affectedProducts.size,
        totalQtySoldWrongOrder: s.wrongOrderQty,
        totalQtySoldWrongOrderText: formatMoney(s.wrongOrderQty),
      };
    }).sort((a, b) => b.fefoViolations - a.fefoViolations);

    this.employeeSummaries = Array.from(empMap.values()).map((e) => {
      const rate = e.total > 0 ? (e.violations / e.total) * 100 : 0;
      return {
        shopCode: e.shopCode,
        shopName: e.shopName,
        employeeName: e.employeeName,
        totalSalesLines: e.total,
        fefoViolations: e.violations,
        violationRate: rate,
        violationRateText: `${rate.toFixed(2)}%`,
        affectedProductsCount: e.affectedProducts.size,
        totalQtySoldWrongOrder: e.wrongOrderQty,
        totalQtySoldWrongOrderText: formatMoney(e.wrongOrderQty),
      };
    }).sort((a, b) => b.fefoViolations - a.fefoViolations);
  }

  private extractSalesArray(res: any): RawRecord[] {
    if (!res) return [];
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

    let rawList: any[] = [];
    if (Array.isArray(res)) {
      rawList = res;
    } else if (typeof res === "object") {
      for (const key of preferredKeys) {
        if (Array.isArray(res[key])) {
          rawList = res[key];
          break;
        }
      }
      if (!rawList.length) {
        for (const value of Object.values(res)) {
          if (Array.isArray(value)) {
            rawList = value;
            break;
          }
        }
      }
    }

    return this.expandRows(rawList);
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

  private pick(row: RawRecord, keys: string[], fallback: unknown = ""): unknown {
    if (!row || typeof row !== "object") return fallback;
    const normalizedMap = new Map(
      Object.keys(row).map((key) => [key.toLowerCase().replaceAll("_", ""), key]),
    );

    for (const key of keys) {
      const directValue = row[key];
      if (directValue !== undefined && directValue !== null && directValue !== "") {
        return directValue;
      }
      const normalizedKey = key.toLowerCase().replaceAll("_", "");
      const matchedKey = normalizedMap.get(normalizedKey);
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
        return row[matchedKey];
      }
    }
    return fallback;
  }

  private getDefaultShopCode(): string {
    if (this.shops.some((s) => s.ShopCode === "SHOP0025")) {
      return "SHOP0025";
    }
    return this.shops[0]?.ShopCode || "";
  }

  private formatDisplayDateText(value: unknown): string {
    if (!value) return "N/A";
    const str = String(value).trim();
    const cleanDateStr = str.split(" ")[0]; // Take YYYY-MM-DD from YYYY-MM-DD HH:mm:ss
    const parts = cleanDateStr.split(/[/.-]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD -> DD/MM/YYYY
        return `${parts[2].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[0]}`;
      }
      if (parts[2].length === 4) {
        // DD/MM/YYYY
        return `${parts[0].padStart(2, "0")}/${parts[1].padStart(2, "0")}/${parts[2]}`;
      }
    }
    return str;
  }

  private parseDaysFromText(dateText: string): number | null {
    if (!dateText || dateText === "N/A" || dateText === "-") return null;
    const cleanStr = String(dateText).trim().split(" ")[0];
    const parts = cleanStr.split(/[/.-]/);
    if (parts.length === 3) {
      let day = 1;
      let month = 0;
      let year = 2026;

      if (parts[0].length === 4) {
        // YYYY-MM-DD
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day = parseInt(parts[2], 10);
      } else if (parts[2].length === 4) {
        // DD/MM/YYYY
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
      }

      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        const targetDate = new Date(year, month, day);
        const diffTime = targetDate.getTime() - Date.now();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }
    return null;
  }
}
