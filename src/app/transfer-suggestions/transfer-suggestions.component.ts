import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { normalizeFilterText, PRODUCT_NAME_COLLATOR } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface InventoryAggregate {
  shopCode: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
  nearestExpiry: Date | null;
}

interface SourceProduct {
  productCode: string;
  productName: string;
  unit: string;
  stock: number;
  raw: RawRecord;
}

interface ProductExistRow {
  shopCode: string;
  shopName: string;
  shopAddress: string;
  productCode: string;
  productName: string;
  stock: number;
  unit: string;
  raw: RawRecord;
}

interface TransferDestination {
  shopCode: string;
  shopName: string;
  shopAddress: string;
  stock: number;
  averageMonthlySales: number;
  coverageDays: number;
  neededQuantity: number;
  score: number;
}

interface TransferSuggestion {
  rowKey: string;
  productCode: string;
  productName: string;
  unit: string;
  sourceShopCode: string;
  sourceStock: number;
  sourceAverageMonthlySales: number;
  sourceKeepQuantity: number;
  transferableQuantity: number;
  expiryText: string;
  expiryDays: number | null;
  destinationShopCode: string;
  destinationShopName: string;
  destinationStock: number;
  destinationAverageMonthlySales: number;
  destinationCoverageDays: number;
  destinationNeededQuantity: number;
  proposedQuantity: number;
  priority: "high" | "medium";
  reason: string;
  destinations: TransferDestination[];
  selected: boolean;
}

@Component({
  selector: "app-transfer-suggestions",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./transfer-suggestions.component.html",
  styleUrls: ["./transfer-suggestions.component.css"],
})
export class TransferSuggestionsComponent implements OnInit {
  readonly quantityKeys = [
    "QuantityExist",
    "ExistQuantity",
    "Quantity",
    "Qty",
    "SL",
    "SoLuong",
    "TonKho",
    "InventoryQuantity",
    "StockQty",
    "Stock",
    "RemainQty",
    "Exist",
    "TotalExist",
    "QuantityTotal",
    "TotalQuantity",
  ];
  shops: ShopInfo[] = [];
  sourceShops: ShopInfo[] = [];
  sourceShopCode = "";
  targetCoverageDays = 30;
  searchText = "";
  priorityFilter: "all" | "high" | "selected" = "all";
  loading = false;
  progress = 0;
  statusText = "Đang chuẩn bị dữ liệu điều chuyển...";
  warningText = "";
  suggestions: TransferSuggestion[] = [];
  sourceProductCount = 0;
  transferableProductCount = 0;
  noDestinationCount = 0;
  salesMonthKeys: string[] = [];
  analyzedSalesShopCount = 0;
  destinationShopCount = 0;
  sourceProducts: SourceProduct[] = [];
  selectedProductCode = "";
  productExistRows: ProductExistRow[] = [];
  productLoading = false;
  existLoading = false;

  private inventoryRows: InventoryAggregate[] = [];
  private salesByShopProduct = new Map<string, number>();
  private sourceProductRows: RawRecord[] = [];

  constructor(private readonly upharmaService: UpharmaService) {}

  ngOnInit(): void {
    void this.loadData();
  }

  get sourceShop(): ShopInfo | undefined {
    return this.sourceShops.find((shop) => shop.ShopCode === this.sourceShopCode);
  }

  get filteredSuggestions(): TransferSuggestion[] {
    const query = normalizeFilterText(this.searchText);

    return this.suggestions.filter((row) => {
      if (this.priorityFilter === "high" && row.priority !== "high") {
        return false;
      }

      if (this.priorityFilter === "selected" && !row.selected) {
        return false;
      }

      if (!query) {
        return true;
      }

      return normalizeFilterText([
        row.productCode,
        row.productName,
        row.sourceShopCode,
        row.destinationShopCode,
        row.destinationShopName,
      ].join(" ")).includes(query);
    });
  }

  get selectedCount(): number {
    return this.suggestions.filter((row) => row.selected).length;
  }

  get proposedTotal(): number {
    return this.suggestions
      .filter((row) => row.selected)
      .reduce((total, row) => total + row.proposedQuantity, 0);
  }

  async reload(): Promise<void> {
    await this.loadData(true);
  }

  async onSourceShopChange(): Promise<void> {
    await this.loadData(true);
  }

  onCoverageDaysChange(): void {
    this.rebuildSuggestions();
  }

  async onSelectedProductChange(): Promise<void> {
    const rows = await this.loadSelectedProductExistRows();
    this.inventoryRows = this.aggregateInventory(this.mergeSourceAndExistRows(this.sourceProductRows, rows));
    this.shops = this.buildShopList(rows, []);
    this.destinationShopCount = this.shops.filter((shop) => shop.ShopCode !== this.sourceShopCode).length;
    this.resetSuggestions();
  }

  selectAllVisible(selected: boolean): void {
    for (const row of this.filteredSuggestions) {
      row.selected = selected;
    }
  }

  onDestinationChange(row: TransferSuggestion): void {
    const destination = row.destinations.find((item) => item.shopCode === row.destinationShopCode);
    if (!destination) {
      return;
    }

    this.applyDestination(row, destination);
  }

  clampProposedQuantity(row: TransferSuggestion): void {
    const maximum = Math.max(0, Math.min(row.transferableQuantity, row.destinationNeededQuantity));
    const value = Number(row.proposedQuantity);
    row.proposedQuantity = Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;
    row.selected = row.proposedQuantity > 0 && row.selected;
  }

  async exportExcel(): Promise<void> {
    const selectedRows = this.suggestions.filter((row) => row.selected && row.proposedQuantity > 0);
    if (selectedRows.length === 0) {
      return;
    }

    const xlsx = await import("xlsx");
    const worksheet = xlsx.utils.json_to_sheet(selectedRows.map((row) => ({
      "Mã SP": row.productCode,
      "Tên sản phẩm": row.productName,
      "Shop nguồn": row.sourceShopCode,
      "Tồn nguồn": row.sourceStock,
      "Bán TB/tháng nguồn": row.sourceAverageMonthlySales,
      "Giữ lại": row.sourceKeepQuantity,
      "Shop nhận": row.destinationShopCode,
      "Tồn shop nhận": row.destinationStock,
      "Bán TB/tháng shop nhận": row.destinationAverageMonthlySales,
      "Ngày đủ hàng": row.destinationCoverageDays,
      "SL đề xuất": row.proposedQuantity,
      "Đơn vị": row.unit,
      "HSD gần nhất": row.expiryText,
      "Ưu tiên": row.priority === "high" ? "Cao" : "Vừa",
      "Lý do": row.reason,
    })));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "De xuat dieu chuyen");
    xlsx.writeFile(workbook, `de-xuat-dieu-chuyen-${this.sourceShopCode || "shop"}.xlsx`);
  }

  trackBySuggestion(_: number, row: TransferSuggestion): string {
    return row.rowKey;
  }

  formatNumber(value: number, maximumFractionDigits = 1): string {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits }).format(value);
  }

  get selectedProduct(): SourceProduct | undefined {
    return this.sourceProducts.find((product) => product.productCode === this.selectedProductCode);
  }

  private async loadData(forceRefresh = false): Promise<void> {
    if (this.loading) {
      return;
    }

    this.loading = true;
    this.progress = 10;
    this.warningText = "";
    this.statusText = "Đang lấy danh sách nhà thuốc...";

    try {
      const session = this.upharmaService.ensureLogin();
      this.sourceShops = this.upharmaService.getActiveShops();
      this.shops = [];
      this.sourceShopCode = this.sourceShopCode || this.sourceShops[0]?.ShopCode || "";
      this.sourceProducts = [];
      this.productExistRows = [];

      if (this.sourceShops.length < 1) {
        throw new Error("Tài khoản chưa có nhà thuốc nguồn để tạo đề xuất điều chuyển.");
      }

      const sourceShopCodes = this.sourceShops.map((shop) => shop.ShopCode);
      this.progress = 25;
      this.statusText = "B1: Đang lấy danh sách sản phẩm của shop nguồn...";

      const sourceProductRows = await this.loadSourceProductRows(this.sourceShopCode);
      this.sourceProductRows = sourceProductRows;
      this.sourceProducts = this.buildSourceProducts(sourceProductRows);
      if (!this.selectedProductCode || !this.sourceProducts.some((product) => product.productCode === this.selectedProductCode)) {
        this.selectedProductCode = this.sourceProducts[0]?.productCode || "";
      }

      this.progress = 38;
      this.statusText = "B2: Đang lấy tồn kho toàn quốc của sản phẩm đang chọn...";
      const nationalInventoryRows = await this.loadSelectedProductExistRows();
      let inventoryData = this.mergeSourceAndExistRows(sourceProductRows, nationalInventoryRows);
      let hasNationalInventory = false;

      try {
        if (nationalInventoryRows.length === 0) {
          throw new Error("API không trả về dòng tồn kho toàn quốc nào cho các sản phẩm nguồn.");
        }
        const nationalShopCodes = new Set(nationalInventoryRows.map((row) => String(row["__shopCode"] || row["ShopCode"] || row["StoreCode"] || "")).filter(Boolean));
        const externalShopCount = Array.from(nationalShopCodes).filter((shopCode) => !sourceShopCodes.includes(shopCode)).length;
        if (externalShopCount <= 0) {
          throw new Error("API chỉ trả về shop tài khoản đang quản lý, chưa có shop nhận toàn quốc.");
        }
        this.shops = this.buildShopList(nationalInventoryRows, []);
        hasNationalInventory = true;
      } catch (error) {
        this.shops = [];
        this.warningText = `Chưa lấy được tồn kho toàn quốc để làm shop nhận: ${error instanceof Error ? error.message : String(error)}. Trang sẽ không đề xuất điều chuyển nội bộ theo các shop đang quản lý.`;
      }

      this.progress = 45;
      this.destinationShopCount = this.shops.filter((shop) => !sourceShopCodes.includes(shop.ShopCode)).length;
      this.statusText = hasNationalInventory
        ? `Đã lấy tồn toàn quốc của sản phẩm đang chọn: ${this.destinationShopCount} shop nhận.`
        : "Chưa có shop nhận toàn quốc cho sản phẩm đang chọn.";

      this.progress = 65;
      this.inventoryRows = this.aggregateInventory(inventoryData);
      this.salesMonthKeys = [];
      this.salesByShopProduct = new Map<string, number>();
      this.analyzedSalesShopCount = 0;

      this.progress = 85;
      this.resetSuggestions();
      this.progress = 100;
      this.statusText = `Đã xong B1+B2: ${this.sourceProducts.length} sản phẩm nguồn, ${this.productExistRows.length} shop có tồn sản phẩm đang chọn.`;
    } catch (error) {
      this.suggestions = [];
      this.statusText = error instanceof Error ? error.message : String(error);
      this.progress = 100;
    } finally {
      this.loading = false;
    }
  }

  private rebuildSuggestions(): void {
    const sourceRows = this.inventoryRows.filter((row) => row.shopCode === this.sourceShopCode && row.quantity > 0);
    const inventoryByShopProduct = new Map(this.inventoryRows.map((row) => [this.makeKey(row.shopCode, row.productCode), row]));
    const monthCount = Math.max(this.salesMonthKeys.length, 1);
    const suggestions: TransferSuggestion[] = [];
    let transferableProductCount = 0;
    let noDestinationCount = 0;

    for (const source of sourceRows) {
      if (!source.productCode || source.productCode.toUpperCase().startsWith("Y")) {
        continue;
      }

      if (source.nearestExpiry && source.nearestExpiry.getTime() <= Date.now()) {
        continue;
      }

      const sourceSalesTotal = this.salesByShopProduct.get(this.makeKey(source.shopCode, source.productCode)) || 0;
      const sourceAverageMonthlySales = sourceSalesTotal / monthCount;
      const sourceKeepQuantity = Math.max(1, Math.ceil(sourceAverageMonthlySales * (this.targetCoverageDays / 30)));
      const transferableQuantity = Math.max(0, Math.floor(source.quantity - sourceKeepQuantity));

      if (transferableQuantity <= 0) {
        continue;
      }

      transferableProductCount += 1;
      const destinations: TransferDestination[] = [];

      for (const shop of this.shops) {
        if (shop.ShopCode === source.shopCode) {
          continue;
        }

        const destinationInventory = inventoryByShopProduct.get(this.makeKey(shop.ShopCode, source.productCode));
        if (!destinationInventory) {
          continue;
        }

        const destinationSalesTotal = this.salesByShopProduct.get(this.makeKey(shop.ShopCode, source.productCode)) || 0;
        const averageMonthlySales = destinationSalesTotal / monthCount;
        if (averageMonthlySales <= 0 || averageMonthlySales <= sourceAverageMonthlySales) {
          continue;
        }

        const dailySales = averageMonthlySales / 30;
        const targetStock = Math.ceil(dailySales * this.targetCoverageDays);
        const neededQuantity = Math.max(0, targetStock - destinationInventory.quantity);
        if (neededQuantity <= 0) {
          continue;
        }

        const coverageDays = destinationInventory.quantity <= 0 ? 0 : destinationInventory.quantity / dailySales;
        const score = averageMonthlySales * 5 + Math.max(0, this.targetCoverageDays - coverageDays) * 2;
        destinations.push({
          shopCode: shop.ShopCode,
          shopName: shop.ShopName,
          shopAddress: shop.ShopAddress || "",
          stock: destinationInventory.quantity,
          averageMonthlySales,
          coverageDays,
          neededQuantity,
          score,
        });
      }

      destinations.sort((first, second) => second.score - first.score || first.coverageDays - second.coverageDays);
      const bestDestination = destinations[0];
      if (!bestDestination) {
        noDestinationCount += 1;
        continue;
      }

      const expiryDays = source.nearestExpiry
        ? Math.ceil((source.nearestExpiry.getTime() - Date.now()) / 86_400_000)
        : null;
      const row: TransferSuggestion = {
        rowKey: `${source.shopCode}|${source.productCode}`,
        productCode: source.productCode,
        productName: source.productName,
        unit: source.unit || "--",
        sourceShopCode: source.shopCode,
        sourceStock: source.quantity,
        sourceAverageMonthlySales,
        sourceKeepQuantity,
        transferableQuantity,
        expiryText: source.nearestExpiry ? this.formatDate(source.nearestExpiry) : "--",
        expiryDays,
        destinationShopCode: bestDestination.shopCode,
        destinationShopName: bestDestination.shopName,
        destinationStock: 0,
        destinationAverageMonthlySales: 0,
        destinationCoverageDays: 0,
        destinationNeededQuantity: 0,
        proposedQuantity: 0,
        priority: "medium",
        reason: "",
        destinations,
        selected: true,
      };
      this.applyDestination(row, bestDestination);
      suggestions.push(row);
    }

    suggestions.sort((first, second) => {
      if (first.priority !== second.priority) {
        return first.priority === "high" ? -1 : 1;
      }
      return PRODUCT_NAME_COLLATOR.compare(first.productName, second.productName);
    });

    this.sourceProductCount = sourceRows.length;
    this.transferableProductCount = transferableProductCount;
    this.noDestinationCount = noDestinationCount;
    this.suggestions = suggestions;
  }

  private resetSuggestions(): void {
    this.sourceProductCount = this.sourceProducts.length;
    this.transferableProductCount = 0;
    this.noDestinationCount = 0;
    this.suggestions = [];
  }

  private applyDestination(row: TransferSuggestion, destination: TransferDestination): void {
    row.destinationShopCode = destination.shopCode;
    row.destinationShopName = destination.shopName;
    row.destinationStock = destination.stock;
    row.destinationAverageMonthlySales = destination.averageMonthlySales;
    row.destinationCoverageDays = destination.coverageDays;
    row.destinationNeededQuantity = destination.neededQuantity;
    row.proposedQuantity = Math.max(0, Math.floor(Math.min(row.transferableQuantity, destination.neededQuantity)));
    row.priority = row.destinationCoverageDays <= 7 || (row.expiryDays !== null && row.expiryDays <= 180)
      ? "high"
      : "medium";
    row.reason = `${destination.shopCode} bán TB ${this.formatNumber(destination.averageMonthlySales)}/tháng, tồn ${this.formatNumber(destination.stock, 0)}, chỉ đủ khoảng ${this.formatNumber(destination.coverageDays, 0)} ngày.`;
    row.selected = row.proposedQuantity > 0;
  }

  private async loadSourceProductRows(shopCode: string): Promise<RawRecord[]> {
    const session = this.upharmaService.ensureLogin();
    this.productLoading = true;
    try {
      const rows: RawRecord[] = [];
      const pageSize = 5;
      const maxPages = 1;

      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
        const response = await this.upharmaService.callLiveEndpoint<unknown>("/Product/GetItemLstWithFollower", {
          uPharmaID: session.UserInfo.uPharmaID,
          Token: session.Token,
          ShopCode: shopCode,
          ProductType: "",
          Search: "",
          NumberRow: pageSize,
          PageNumber: pageNumber,
        });
        const pageRows = this.extractRows(response);
        rows.push(...pageRows);
        if (pageRows.length < pageSize) {
          break;
        }
      }

      return rows;
    } finally {
      this.productLoading = false;
    }
  }

  private async loadSelectedProductExistRows(): Promise<RawRecord[]> {
    const productCode = this.selectedProductCode;
    this.productExistRows = [];
    if (!productCode) {
      return [];
    }

    const session = this.upharmaService.ensureLogin();
    this.existLoading = true;
    try {
      const response = await this.upharmaService.callLiveEndpoint<unknown>("/Report/GetExistProductLst", {
        uPharmaID: session.UserInfo.uPharmaID,
        Token: session.Token,
        ProductID: productCode,
      });
      const rows = this.extractRows(response);
      this.productExistRows = this.buildProductExistRows(rows);
      return rows;
    } finally {
      this.existLoading = false;
    }
  }

  private buildSourceProducts(rows: RawRecord[]): SourceProduct[] {
    const productMap = new Map<string, SourceProduct>();

    for (const row of rows) {
      const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"])).trim();
      if (!productCode || productCode.toUpperCase().startsWith("Y")) {
        continue;
      }

      const quantity = this.toNumber(this.pick(row, this.quantityKeys));
      const current = productMap.get(productCode) || {
        productCode,
        productName: String(this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim() || productCode,
        unit: String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])).trim(),
        stock: 0,
        raw: row,
      };
      current.stock += quantity;
      productMap.set(productCode, current);
    }

    return Array.from(productMap.values()).sort((first, second) => PRODUCT_NAME_COLLATOR.compare(first.productName, second.productName));
  }

  private buildProductExistRows(rows: RawRecord[]): ProductExistRow[] {
    return rows
      .map((row) => {
        const shopCode = String(this.pick(row, ["ShopCode", "StoreCode", "__shopCode", "MaNhaThuoc", "CodeShop"])).trim();
        const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"])).trim() || this.selectedProductCode;
        return {
          shopCode,
          shopName: String(this.pick(row, ["ShopName", "StoreName", "__shopName", "TenNhaThuoc", "NameShop"])).trim() || shopCode,
          shopAddress: String(this.pick(row, ["ShopAddress", "Address", "DiaChi"])).trim(),
          productCode,
          productName: String(this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim() || this.selectedProduct?.productName || productCode,
          stock: this.toNumber(this.pick(row, this.quantityKeys)),
          unit: String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])).trim() || this.selectedProduct?.unit || "",
          raw: row,
        };
      })
      .filter((row) => row.shopCode && row.stock > 0)
      .sort((first, second) => second.stock - first.stock || first.shopCode.localeCompare(second.shopCode, "vi"));
  }

  private mergeSourceAndExistRows(sourceRows: RawRecord[], existRows: RawRecord[]): RawRecord[] {
    const selectedSourceRows = sourceRows
      .filter((row) => {
        const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"])).trim();
        return !this.selectedProductCode || productCode === this.selectedProductCode;
      })
      .map((row) => ({ ...row, __shopCode: this.sourceShopCode, __shopName: this.sourceShop?.ShopName || this.sourceShopCode }));

    return [
      ...selectedSourceRows,
      ...existRows.map((row) => ({
        ...row,
        ProductID: String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"])).trim() || this.selectedProductCode,
        ProductName: String(this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim() || this.selectedProduct?.productName || this.selectedProductCode,
        UnitName: String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])).trim() || this.selectedProduct?.unit || "",
        __shopCode: String(this.pick(row, ["ShopCode", "StoreCode", "__shopCode", "MaNhaThuoc", "CodeShop"])).trim(),
        __shopName: String(this.pick(row, ["ShopName", "StoreName", "__shopName", "TenNhaThuoc", "NameShop"])).trim(),
      })),
    ];
  }

  private buildShopList(rows: RawRecord[], fallbackShops: ShopInfo[]): ShopInfo[] {
    const shopMap = new Map(fallbackShops.map((shop) => [shop.ShopCode, shop]));

    for (const row of rows) {
      const shopCode = String(this.pick(row, ["__shopCode", "ShopCode", "StoreCode", "MaNhaThuoc", "CodeShop"])).trim();
      if (!shopCode) {
        continue;
      }

      const existing = shopMap.get(shopCode);
      shopMap.set(shopCode, {
        ShopCode: shopCode,
        ShopName: String(row["__shopName"] || row["ShopName"] || row["StoreName"] || existing?.ShopName || shopCode),
        ShopAddress: String(row["ShopAddress"] || row["Address"] || existing?.ShopAddress || ""),
      });
    }

    return Array.from(shopMap.values()).sort((first, second) => first.ShopCode.localeCompare(second.ShopCode, "vi"));
  }

  private aggregateInventory(rows: RawRecord[]): InventoryAggregate[] {
    const grouped = new Map<string, InventoryAggregate>();

    for (const row of rows) {
      const shopCode = String(this.pick(row, ["__shopCode", "ShopCode", "StoreCode", "MaNhaThuoc", "CodeShop"])).trim();
      const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"])).trim();
      if (!shopCode || !productCode) {
        continue;
      }

      const key = this.makeKey(shopCode, productCode);
      const quantity = this.toNumber(this.pick(row, this.quantityKeys));
      const expiry = this.parseDate(this.pick(row, ["ExpirationDate", "ExpiryDate", "ExpireDate", "ExpiredDate", "ExpDate", "HanDung", "HSD"]));
      const current = grouped.get(key) || {
        shopCode,
        productCode,
        productName: String(this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim() || productCode,
        quantity: 0,
        unit: String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])).trim(),
        nearestExpiry: null,
      };

      current.quantity += quantity;
      if (expiry && (!current.nearestExpiry || expiry.getTime() < current.nearestExpiry.getTime())) {
        current.nearestExpiry = expiry;
      }
      grouped.set(key, current);
    }

    return Array.from(grouped.values());
  }

  private extractRows(data: unknown): RawRecord[] {
    if (Array.isArray(data)) {
      return data.filter((row): row is RawRecord => Boolean(row) && typeof row === "object");
    }

    if (!data || typeof data !== "object") {
      return [];
    }

    const record = data as RawRecord;
    for (const key of ["data", "Data", "ItemLst", "ProductLst", "ProductList", "ExistProductLst", "SalesSpeedLst", "LocalStoreLst", "InventoryLst", "DataLst", "ListData", "Rows", "Table"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.filter((row): row is RawRecord => Boolean(row) && typeof row === "object");
      }
    }

    return [];
  }

  private pick(row: RawRecord, keys: string[]): unknown {
    const normalizedKeys = new Map(Object.keys(row).map((key) => [key.toLowerCase().replaceAll("_", ""), key]));
    for (const key of keys) {
      const direct = row[key];
      if (direct !== undefined && direct !== null && direct !== "") {
        return direct;
      }
      const matchedKey = normalizedKeys.get(key.toLowerCase().replaceAll("_", ""));
      if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
        return row[matchedKey];
      }
    }
    return "";
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    const normalized = String(value ?? "").replace(/\s/g, "").replace(/,/g, ".").replace(/[^\d.-]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  private parseDate(value: unknown): Date | null {
    const text = String(value ?? "").trim();
    if (!text) {
      return null;
    }
    const normalized = text.includes(" ") ? text.replace(" ", "T") : text;
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  private makeKey(shopCode: string, productCode: string): string {
    return `${shopCode}|${productCode}`;
  }
}
