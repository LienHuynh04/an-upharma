import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { normalizeFilterText, normalizeInventoryRow, parseNumericValue } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";
import { NationalInventoryService } from "../national-inventory.service";
import { FirebaseInventoryService } from "../firebase-inventory.service";

interface NationalProduct {
  key: string;
  productCode: string;
  productName: string;
  unit: string;
  productType: string;
  follower: string;
}

interface ExpiringStock {
  key: string;
  productCode: string;
  productName: string;
  shopCode: string;
  shopName: string;
  lot: string;
  expiryText: string;
  daysRemaining: number;
  quantity: number;
  unit: string;
}

interface SuggestionRow {
  productCode: string;
  productName: string;
  fromShopCode: string;
  fromShopName: string;
  toShopCode: string;
  toShopName: string;
  suggestedQty: number;
  unit: string;
  daysRemaining: number;
  isSameProvince: boolean;
}

@Component({
  selector: "app-transfer-suggestions",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-header d-print-none">
      <div class="container-xl">
        <div class="row g-2 align-items-center">
          <div class="col">
            <div class="page-pretitle">HÀNG HÓA</div>
            <h2 class="page-title">Gợi ý điều chuyển hàng cận hạn</h2>
          </div>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="container-xl">
        <div class="row row-cards">
          
          <!-- Khởi tạo dữ liệu nền -->
          <div class="col-12">
            <div class="card">
              <div class="card-body d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div>
                  <strong>Chuẩn bị dữ liệu điều chuyển:</strong> 
                  <span class="ms-1">Đã load {{ products.length }} sản phẩm danh mục & {{ expiringStock.length }} lô cận hạn &lt; 365 ngày của 3 nhà thuốc.</span>
                </div>
                <button type="button" class="btn btn-primary" (click)="loadSteps()" [disabled]="loading || loadingExpiringStock">
                  {{ loading || loadingExpiringStock ? "Đang tải dữ liệu nguồn..." : "↺ Tải lại dữ liệu gốc" }}
                </button>
              </div>
            </div>
          </div>

          <!-- DCS sub-tabs -->
          <div class="col-12">
            <div class="card">
              <div class="card-body">
                <div class="btn-group w-100">
                  <button type="button" class="btn btn-outline-success active">
                    ✔️ DCS Khẩn (Cận Date) <span class="badge bg-green text-green-fg ms-2">{{ totalSuggestedCount }}</span>
                  </button>
                  <button type="button" class="btn btn-outline-secondary disabled">
                    📁 DCS Cân Bằng Ngân Sách <span class="badge bg-secondary text-secondary-fg ms-2">165</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Nguyên tắc điều chuyển -->
          <div class="col-12">
            <div class="alert alert-info mb-0">
              📢 <strong>Nguyên tắc:</strong> Nguồn chỉ giữ phần lẻ (số lượng không đủ 1 tem - không chuyển được), đẩy đi toàn bộ tem nguyên; đích nhận tối đa 1 tháng bán - ưu tiên khu vực (nội + ngoại tỉnh) rồi @ shop toàn quốc bán tốt; giữ lại nếu là &lt;1 tem hoặc không nhà nào bán.
            </div>
          </div>

          <!-- Kiểm tra tồn kho đối chứng -->
          <div class="col-12">
            <div class="card">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-3">
                  <div>
                    <h3 class="card-title mb-1">⚡ Kiểm tra tồn kho đối chứng toàn quốc</h3>
                    <p class="text-secondary mb-0">Cần chạy đối chiếu để biết các shop khác toàn quốc có nhu cầu nhận hay không trước khi tạo bảng đề xuất.</p>
                  </div>
                  <div class="btn-list">
                    <button type="button" class="btn btn-success" (click)="runStep3(false)" [disabled]="loadingStep3 || expiringStock.length === 0">
                      ⚡ Tra cứu (Dùng cache)
                    </button>
                    <button type="button" class="btn btn-secondary" (click)="runStep3(true)" [disabled]="loadingStep3 || expiringStock.length === 0">
                      🔄 Tải mới
                    </button>
                    <button type="button" class="btn btn-danger" (click)="clearCache()" [disabled]="loadingStep3">
                      🗑 Xóa cache
                    </button>
                  </div>
                </div>

                <div *ngIf="loadingStep3 || progressPercent > 0" class="mt-4">
                  <div class="progress progress-sm">
                    <div class="progress-bar bg-green" [style.width.%]="progressPercent"></div>
                  </div>
                  <div class="d-flex justify-content-between mt-2 text-secondary fs-5">
                    <span>Đang đối chiếu: <b>{{ progressPercent }}%</b> ({{ progressFromCache + progressFromApi }}/{{ expiringProductCount }} SP)</span>
                    <span>⚡ Cache: <b>{{ progressFromCache }}</b> | 🌐 API: <b>{{ progressFromApi }}</b></span>
                  </div>
                  <p class="mt-1 text-secondary fs-5 mb-0" *ngIf="progressCurrentProduct">Đang kiểm tra: <code>{{ progressCurrentProduct }}</code></p>
                </div>

                <p class="mt-2 text-secondary fs-5 mb-0" *ngIf="step3StatusText">
                  Trạng thái xử lý: <code>{{ step3StatusText }}</code>
                </p>
              </div>
            </div>
          </div>

          <!-- Summary & Export Bar -->
          <div class="col-12">
            <div class="card">
              <div class="card-body d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3">
                <button type="button" class="btn btn-warning" (click)="exportAuditExcel()" [disabled]="expiringStock.length === 0">
                  ⚙️ Xuất audit cận date ({{ expiringStock.length }})
                </button>
                
                <div class="text-center">
                  <span><b>{{ expiringStock.length }}</b> mã cận date</span>
                  <span class="mx-2 text-secondary">→</span>
                  <span class="text-success">Đề xuất chuyển: <b>{{ totalSuggestedCount }}</b></span>
                  <span class="mx-2 text-secondary">|</span>
                  <span>Lẻ &lt;1 tem: <b>{{ countFractional }}</b></span>
                  <span class="mx-2 text-secondary">|</span>
                  <span>Không nhà nào bán được: <b>{{ countNoBuyer }}</b></span>
                  <div class="text-secondary fs-5 mt-1">
                    💡 chỉ nhóm <strong>Đề xuất chuyển</strong> mới cần điều chuyển; <b>{{ countFractional + countNoBuyer }}</b> mã còn lại không cần hoặc không thể chuyển.
                  </div>
                </div>

                <button type="button" class="btn btn-success" (click)="exportSuggestedExcel()" [disabled]="filteredSuggestions.length === 0">
                  📥 Xuất Excel
                </button>
              </div>
            </div>
          </div>

          <!-- Filter Bar -->
          <div class="col-12">
            <div class="card">
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-md-4">
                    <label class="form-label">Mã / Tên sản phẩm</label>
                    <input class="form-control" [(ngModel)]="filterProduct" placeholder="Lọc theo mã hoặc tên" />
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Từ NT</label>
                    <select class="form-select" [(ngModel)]="filterFromShop">
                      <option value="">Tất cả shop nguồn ({{ uniqueFromShops.length }})</option>
                      <option *ngFor="let s of uniqueFromShops" [value]="s">{{ s }}</option>
                    </select>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Đến NT</label>
                    <select class="form-select" [(ngModel)]="filterToShop">
                      <option value="">Tất cả shop đích ({{ uniqueToShops.length }})</option>
                      <option *ngFor="let s of uniqueToShops" [value]="s">{{ s }}</option>
                    </select>
                  </div>
                  <div class="col-md-2 d-flex align-items-end">
                    <button type="button" class="btn btn-light w-100" (click)="clearFilters()">Xóa bộ lọc</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Bảng Đề Xuất Điều Chuyển -->
          <div class="col-12">
            <div class="card">
              <div class="table-responsive">
                <table class="table table-vcenter card-table">
                  <thead>
                    <tr>
                      <th>Sản phẩm</th>
                      <th>Từ NT</th>
                      <th>Đến NT</th>
                      <th class="text-end">SL đề xuất</th>
                      <th>ĐV</th>
                      <th class="text-end">HSD còn</th>
                      <th>Ưu tiên</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let row of filteredSuggestions">
                      <td data-label="Sản phẩm">
                        <div class="font-weight-medium">{{ row.productName }}</div>
                        <div class="text-secondary mt-1">{{ row.productCode }}</div>
                      </td>
                      <td data-label="Từ NT">
                        <span class="badge bg-red-lt">{{ row.fromShopCode }}</span>
                        <div class="text-secondary mt-1">{{ row.fromShopName }}</div>
                      </td>
                      <td data-label="Đến NT">
                        <span class="badge bg-blue-lt">→ {{ row.toShopCode }}</span>
                        <div class="text-secondary mt-1">{{ row.toShopName }}</div>
                      </td>
                      <td class="text-end" data-label="SL đề xuất"><strong>{{ row.suggestedQty }}</strong></td>
                      <td data-label="ĐV">{{ row.unit }}</td>
                      <td class="text-end text-danger" data-label="HSD còn"><strong>{{ row.daysRemaining }}N HSD</strong></td>
                      <td data-label="Ưu tiên">
                        <span [class]="row.isSameProvince ? 'badge bg-green-lt' : 'badge bg-red-lt'">
                          {{ row.isSameProvince ? '✓ Nội tỉnh' : 'Ngoại tỉnh' }}
                        </span>
                      </td>
                    </tr>
                    <tr *ngIf="filteredSuggestions.length === 0">
                      <td colspan="7" class="text-center py-4 text-secondary">
                        Chưa có đề xuất điều chuyển nào phù hợp bộ lọc.<br/>
                        <em>Nhấn <strong>"Tra cứu"</strong> ở trên để cập nhật đề xuất!</em>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: []
})
export class TransferSuggestionsComponent implements OnInit {
  products: NationalProduct[] = [];
  expiringStock: ExpiringStock[] = [];
  selectedShops: ShopInfo[] = [];
  numberPage = 0;
  loading = false;
  loadingExpiringStock = false;
  statusText = "";
  errorText = "";
  fetchedAt = "";

  // Step 3 state
  loadingStep3 = false;
  step3StatusText = "";
  nationalStoreStockMap: { [productCode: string]: any[] } = {};

  // Step 3 progress state
  progressPercent = 0;
  progressFromCache = 0;
  progressFromApi = 0;
  progressCurrentProduct = "";

  // Filters
  filterProduct = "";
  filterFromShop = "";
  filterToShop = "";

  constructor(
    private readonly upharma: UpharmaService,
    private readonly nationalInventoryService: NationalInventoryService,
    private readonly firebaseInventoryService: FirebaseInventoryService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadSteps();
  }

  async loadSteps(): Promise<void> {
    await this.loadNationalProducts();
    await this.loadExpiringStock();
  }

  async loadNationalProducts(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.errorText = "";
    this.statusText = "Đang gọi Product/GetItemLstWithFollower...";

    try {
      const session = this.upharma.ensureLogin();
      const response = await this.upharma.callEndpoint<unknown>("/Product/GetItemLstWithFollower", {
        uPharmaID: session.UserInfo.uPharmaID,
        Token: session.Token,
        ShopCode: "",
        ProductType: "",
        Search: "",
        NumberRow: 0,
        PageNumber: 0,
      }, { cache: false, forceRefresh: true });
      const record = this.asRecord(response);
      const rows = this.extractProductRows(response);
      this.numberPage = Number(record["NumberPage"] ?? 0) || 0;
      this.products = rows.map((row, index) => this.toProduct(row, index));
      this.statusText = `Đã nhận ${this.products.length} sản phẩm từ ProductLst.`;
      this.fetchedAt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date());
    } catch (error) {
      this.products = [];
      this.numberPage = 0;
      this.errorText = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  private async loadExpiringStock(): Promise<void> {
    if (this.loadingExpiringStock) return;
    this.loadingExpiringStock = true;
    this.selectedShops = [];
    this.expiringStock = [];
    try {
      this.upharma.ensureLogin();
      this.selectedShops = this.upharma.getActiveShops().slice(0, 3);
      if (this.selectedShops.length === 0) throw new Error("Tài khoản chưa có nhà thuốc để lấy tồn kho.");
      const productIds = new Set(this.products.map((product) => product.productCode).filter(Boolean));
      const inventory = await this.upharma.loadInventoryNewDirect({
        forceRefresh: true,
        shopCodes: this.selectedShops.map((shop) => shop.ShopCode),
      });
      this.expiringStock = inventory.data
        .map((row, index) => normalizeInventoryRow(row, index))
        .filter((row) => row.productCode && (!productIds.size || productIds.has(row.productCode)) && row.expiryDaysRemaining !== null && row.expiryDaysRemaining >= 0 && row.expiryDaysRemaining <= 365 && parseNumericValue(row.quantity) > 0)
        .map((row) => ({
          key: row.rowKey,
          productCode: row.productCode,
          productName: row.productName,
          shopCode: row.shopCode,
          shopName: row.shopName,
          lot: row.lot,
          expiryText: row.expiryText,
          daysRemaining: row.expiryDaysRemaining!,
          quantity: parseNumericValue(row.quantity),
          unit: row.unit,
        }))
        .sort((first, second) => first.daysRemaining - second.daysRemaining || first.productName.localeCompare(second.productName, "vi"));
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
    } finally {
      this.loadingExpiringStock = false;
    }
  }

  async runStep3(forceRefresh = false): Promise<void> {
    if (this.loadingStep3) return;
    this.loadingStep3 = true;
    this.step3StatusText = "Bắt đầu kiểm tra tồn kho toàn quốc...";
    this.nationalStoreStockMap = {};
    this.progressPercent = 0;
    this.progressFromCache = 0;
    this.progressFromApi = 0;
    this.progressCurrentProduct = "";

    try {
      this.upharma.ensureLogin();
      const uniqueProductCodes = Array.from(new Set(this.expiringStock.map(item => item.productCode).filter(Boolean)));

      if (uniqueProductCodes.length === 0) {
        this.step3StatusText = "Không có sản phẩm cận hạn nào từ Bước 2 để kiểm tra.";
        this.loadingStep3 = false;
        return;
      }

      this.step3StatusText = `Đang kiểm tra tồn kho toàn quốc cho ${uniqueProductCodes.length} sản phẩm...`;

      const responseMap = await this.nationalInventoryService.resolve(uniqueProductCodes, {
        forceRefresh,
        onProgress: (p) => {
          this.progressPercent = Math.round((p.done / p.total) * 100);
          this.progressFromCache = p.fromCache;
          this.progressFromApi = p.fromApi;
          this.progressCurrentProduct = p.currentProduct;
          this.step3StatusText = `Đang xử lý: ${p.done}/${p.total} sản phẩm (${p.fromCache} từ cache, ${p.fromApi} từ API)...`;
        }
      });

      this.nationalStoreStockMap = responseMap;
      this.step3StatusText = `Đã hoàn thành đối chiếu toàn quốc. Đã xử lý ${uniqueProductCodes.length} sản phẩm (${this.progressFromCache} từ cache, ${this.progressFromApi} từ API).`;
    } catch (error) {
      this.step3StatusText = "Lỗi xảy ra trong quá trình kiểm tra: " + (error instanceof Error ? error.message : String(error));
    } finally {
      this.loadingStep3 = false;
    }
  }

  async clearCache(): Promise<void> {
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ bộ nhớ đệm tồn kho toàn quốc trên Firebase? Lần tra cứu tiếp theo sẽ phải gọi API trực tiếp và mất nhiều thời gian hơn.")) {
      this.loadingStep3 = true;
      this.step3StatusText = "Đang xóa bộ nhớ đệm trên Firebase...";
      try {
        await this.firebaseInventoryService.clearAllCache();
        this.step3StatusText = "Đã xóa toàn bộ bộ nhớ đệm thành công.";
        this.nationalStoreStockMap = {};
      } catch (error) {
        this.step3StatusText = "Lỗi khi xóa bộ nhớ đệm: " + (error instanceof Error ? error.message : String(error));
      } finally {
        this.loadingStep3 = false;
      }
    }
  }

  // logic xác định tỉnh thành từ tên shop
  private getProvince(name: string): string {
    const normalized = name.toLowerCase();
    if (normalized.includes("khánh hòa") || normalized.includes("khanh hoa")) return "Khánh Hòa";
    if (normalized.includes("gia lai")) return "Gia Lai";
    if (normalized.includes("đà nẵng") || normalized.includes("da nang")) return "Đà Nẵng";
    if (normalized.includes("hồ chí minh") || normalized.includes("hcm") || normalized.includes("tphcm")) return "Hồ Chí Minh";
    if (normalized.includes("hà nội") || normalized.includes("ha noi")) return "Hà Nội";
    
    const parts = name.trim().split(" ");
    return parts[parts.length - 1] || name;
  }

  get expiringProductCount(): number {
    return new Set(this.expiringStock.map((item) => item.productCode).filter(Boolean)).size;
  }

  // --- GETTERS CHO BẢNG ĐỀ XUẤT ĐIỀU CHUYỂN ---
  get suggestionRows(): SuggestionRow[] {
    const suggestions: SuggestionRow[] = [];
    for (const item of this.expiringStock) {
      if (!item.productCode) continue;

      // 1. Chỉ đẩy đi phần nguyên, lẻ < 1 không chuyển được
      if (item.quantity < 1) continue;

      const destList = this.nationalStoreStockMap[item.productCode];
      if (!destList || !Array.isArray(destList)) continue;

      // Loại bỏ chính shop nguồn
      const validDests = destList.filter((d: any) => d.StoreCode !== item.shopCode);
      if (validDests.length === 0) continue;

      // Lấy shop có QuantityAVG cao nhất
      const bestDest = validDests[0];
      
      const sourceProvince = this.getProvince(item.shopName);
      const destProvince = this.getProvince(bestDest.StoreName);
      const isSame = sourceProvince === destProvince;

      // Đề xuất tối đa là phần nguyên tồn nguồn và lượng bán trung bình 1 tháng của đích
      const qty = Math.max(1, Math.min(Math.floor(item.quantity), Math.round(bestDest.QuantityAVG || 1)));

      suggestions.push({
        productCode: item.productCode,
        productName: item.productName,
        fromShopCode: item.shopCode,
        fromShopName: item.shopName,
        toShopCode: bestDest.StoreCode,
        toShopName: bestDest.StoreName,
        suggestedQty: qty,
        unit: item.unit || "Hộp",
        daysRemaining: item.daysRemaining,
        isSameProvince: isSame,
      });
    }
    return suggestions;
  }

  get countFractional(): number {
    return this.expiringStock.filter(item => item.quantity < 1).length;
  }

  get countNoBuyer(): number {
    return this.expiringStock.filter(item => {
      if (item.quantity < 1) return false;
      const destList = this.nationalStoreStockMap[item.productCode];
      if (!destList || !Array.isArray(destList)) return true;
      const validDests = destList.filter((d: any) => d.StoreCode !== item.shopCode);
      return validDests.length === 0;
    }).length;
  }

  get totalSuggestedCount(): number {
    return this.suggestionRows.length;
  }

  // --- FILTERS & SELECT OPTIONS ---
  get filteredSuggestions(): SuggestionRow[] {
    return this.suggestionRows.filter(row => {
      const q = this.filterProduct.trim().toLowerCase();
      const matchProduct = !q || row.productCode.toLowerCase().includes(q) || row.productName.toLowerCase().includes(q);
      const matchFrom = !this.filterFromShop || row.fromShopCode === this.filterFromShop;
      const matchTo = !this.filterToShop || row.toShopCode === this.filterToShop;
      return matchProduct && matchFrom && matchTo;
    });
  }

  get uniqueProductsList(): string[] {
    const set = new Set(this.suggestionRows.map(r => `${r.productCode} - ${r.productName}`));
    return Array.from(set).sort();
  }

  get uniqueFromShops(): string[] {
    const set = new Set(this.suggestionRows.map(r => r.fromShopCode));
    return Array.from(set).sort();
  }

  get uniqueToShops(): string[] {
    const set = new Set(this.suggestionRows.map(r => r.toShopCode));
    return Array.from(set).sort();
  }

  clearFilters(): void {
    this.filterProduct = "";
    this.filterFromShop = "";
    this.filterToShop = "";
  }

  // --- EXPORTS EXCEL ---
  async exportSuggestedExcel(): Promise<void> {
    const rows = this.filteredSuggestions;
    if (rows.length === 0) return;

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheetRows = rows.map((row) => ({
      "Mã SP": row.productCode,
      "Tên SP": row.productName,
      "Từ Nhà Thuốc": `${row.fromShopCode} - ${row.fromShopName}`,
      "Đến Nhà Thuốc": `${row.toShopCode} - ${row.toShopName}`,
      "SL Đề Xuất": row.suggestedQty,
      "Đơn Vị": row.unit,
      "Hạn Dùng Còn (Ngày)": row.daysRemaining,
      "Khu Vực": row.isSameProvince ? "Nội tỉnh" : "Ngoại tỉnh",
    }));
    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "De xuat dieu chuyen");

    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `de-xuat-dieu-chuyen.xlsx`);
  }

  async exportAuditExcel(): Promise<void> {
    const rows = this.expiringStock;
    if (rows.length === 0) return;

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheetRows = rows.map((row) => ({
      "Nhà Thuốc": `${row.shopCode} - ${row.shopName}`,
      "Mã SP": row.productCode,
      "Tên SP": row.productName,
      "Số Lô": row.lot,
      "Hạn Dùng": row.expiryText,
      "Còn Lại (Ngày)": row.daysRemaining,
      "Số Lượng": row.quantity,
      "Đơn Vị": row.unit,
    }));
    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Audit can date");

    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `audit-can-date.xlsx`);
  }

  private downloadExcelBuffer(buffer: ArrayBuffer, fileName: string): void {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  formatNumber(value: number): string { 
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value); 
  }

  private toProduct(row: RawRecord, index: number): NationalProduct {
    const productCode = String(this.pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    return {
      key: `${productCode}|${index}`,
      productCode,
      productName: String(this.pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim(),
      unit: String(this.pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])).trim(),
      productType: String(this.pick(row, ["ProductType", "ProductTypeName", "LoaiSP", "NhomSP", "GroupName"])).trim(),
      follower: String(this.pick(row, ["FollowerName", "Follower", "EmployeeName", "NguoiTheoDoi"])).trim(),
    };
  }

  private extractProductRows(response: unknown): RawRecord[] {
    const value = this.asRecord(response)["ProductLst"];
    return Array.isArray(value) ? value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object") : [];
  }

  private asRecord(value: unknown): RawRecord { 
    return value && typeof value === "object" && !Array.isArray(value) ? value as RawRecord : {}; 
  }

  private pick(row: RawRecord, keys: string[]): unknown {
    const normalized = new Map(Object.keys(row).map((key) => [key.toLowerCase().replaceAll("_", ""), key]));
    for (const key of keys) {
      const direct = row[key];
      if (direct !== undefined && direct !== null && direct !== "") return direct;
      const match = normalized.get(key.toLowerCase().replaceAll("_", ""));
      if (match && row[match] !== undefined && row[match] !== null && row[match] !== "") return row[match];
    }
    return "";
  }
}
