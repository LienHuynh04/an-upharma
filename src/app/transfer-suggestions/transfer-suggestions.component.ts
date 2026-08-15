import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
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
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <main class="transfer-page">
      <!-- 1. Menu Ngang tương tự screenshot -->
      <div class="top-header-menu">
        <nav class="horizontal-menu">
          <span class="active-category">▥ Hàng Hoá</span>
          <a routerLink="/ton-kho">Chủ Nhật Này</a>
          <a routerLink="/ton-kho">Đặt Hàng</a>
          <a routerLink="/goi-y-chuyen-hang" class="active-subtab">📁 Điều Chuyển</a>
          <a routerLink="/hang-lap-tot">Hàng Thường Trực</a>
          <a routerLink="/hang-lap-tot">Hàng Lặp Tốt</a>
          <a routerLink="/hang-ban-cham">Phân Tích</a>
        </nav>
      </div>

      <!-- Khởi tạo dữ liệu nền (Step 1 & 2) -->
      <section class="init-data-bar">
        <div class="init-info">
          <strong>Chuẩn bị dữ liệu điều chuyển:</strong> 
          <span>Đã load {{ products.length }} sản phẩm danh mục & {{ expiringStock.length }} lô cận hạn &lt; 365 ngày của 3 nhà thuốc.</span>
        </div>
        <button type="button" class="btn-init-reload" (click)="loadSteps()" [disabled]="loading || loadingExpiringStock">
          {{ loading || loadingExpiringStock ? "Đang tải dữ liệu nguồn..." : "↺ Tải lại dữ liệu gốc" }}
        </button>
      </section>

      <!-- 2. DCS sub-tabs -->
      <div class="dcs-tabs">
        <button type="button" class="dcs-tab-btn active">
          ✔️ DCS Khẩn (Cận Date) <span class="badge">{{ totalSuggestedCount }}</span>
        </button>
        <button type="button" class="dcs-tab-btn disabled-tab">
          📁 DCS Cân Bằng Ngân Sách <span class="badge">165</span>
        </button>
      </div>

      <!-- 3. Nguyên tắc điều chuyển (Rule Box) -->
      <div class="rule-box">
        📢 <strong>Nguyên tắc:</strong> Nguồn chỉ giữ phần lẻ (số lượng không đủ 1 tem - không chuyển được), đẩy đi toàn bộ tem nguyên; đích nhận tối đa 1 tháng bán - ưu tiên khu vực (nội + ngoại tỉnh) rồi @ shop toàn quốc bán tốt; giữ lại nếu là &lt;1 tem hoặc không nhà nào bán.
      </div>

      <!-- Progress bar của bộ lọc toàn quốc (Firebase/API resolution) -->
      <section class="resolution-control-box">
        <div class="resolution-info">
          <h3>⚡ Kiểm tra tồn kho đối chứng toàn quốc</h3>
          <p>Cần chạy đối chiếu để biết các shop khác toàn quốc có nhu cầu nhận hay không trước khi tạo bảng đề xuất.</p>
        </div>
        <div class="resolution-actions">
          <button type="button" class="btn-resolve" (click)="runStep3(false)" [disabled]="loadingStep3 || expiringStock.length === 0">
            ⚡ Tra cứu tồn kho toàn quốc (Dùng cache)
          </button>
          <button type="button" class="btn-resolve btn-secondary" (click)="runStep3(true)" [disabled]="loadingStep3 || expiringStock.length === 0">
            🔄 Tải mới (Bypass cache)
          </button>
          <button type="button" class="btn-resolve btn-danger" (click)="clearCache()" [disabled]="loadingStep3">
            🗑 Xóa cache Firebase
          </button>
        </div>
      </section>

      <!-- Progress bar khi đang load đối chứng -->
      <div class="progress-container" *ngIf="loadingStep3 || progressPercent > 0">
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" [style.width.%]="progressPercent"></div>
        </div>
        <div class="progress-stats">
          <span>Đang đối chiếu: <b>{{ progressPercent }}%</b> ({{ progressFromCache + progressFromApi }}/{{ expiringProductCount }} SP)</span>
          <span>⚡ Cache: <b>{{ progressFromCache }}</b> | 🌐 API: <b>{{ progressFromApi }}</b></span>
        </div>
        <p class="progress-current" *ngIf="progressCurrentProduct">Đang kiểm tra: <code>{{ progressCurrentProduct }}</code></p>
      </div>

      <p class="step-note" *ngIf="step3StatusText">
        Trạng thái xử lý đối chiếu: <code>{{ step3StatusText }}</code>
      </p>

      <!-- 4. Summary & Export Bar -->
      <div class="summary-export-bar">
        <button type="button" class="btn-audit" (click)="exportAuditExcel()" [disabled]="expiringStock.length === 0">
          ⚙️ Xuất audit cận date ({{ expiringStock.length }})
        </button>
        
        <div class="stats-label">
          <span><b>{{ expiringStock.length }}</b> mã cận date</span>
          <span class="divider">→</span>
          <span class="highlight">Đề xuất chuyển: <b>{{ totalSuggestedCount }}</b></span>
          <span class="divider">|</span>
          <span>Lẻ &lt;1 tem: <b>{{ countFractional }}</b></span>
          <span class="divider">|</span>
          <span>Không nhà nào bán được: <b>{{ countNoBuyer }}</b></span>
        </div>

        <button type="button" class="btn-excel" (click)="exportSuggestedExcel()" [disabled]="filteredSuggestions.length === 0">
          📥 Xuất Excel
        </button>
      </div>

      <div class="sub-stats-label-bar">
        💡 chỉ nhóm <strong>Đề xuất chuyển</strong> mới cần điều chuyển; <b>{{ countFractional + countNoBuyer }}</b> mã còn lại không cần hoặc không thể chuyển.
      </div>

      <!-- 5. Filter Bar -->
      <div class="filter-bar">
        <div class="filter-item">
          <label>Mã / Tên sản phẩm</label>
          <input [(ngModel)]="filterProduct" placeholder="Lọc theo mã hoặc tên" />
        </div>
        <div class="filter-item">
          <label>Từ NT</label>
          <select [(ngModel)]="filterFromShop">
            <option value="">Tất cả shop nguồn ({{ uniqueFromShops.length }})</option>
            <option *ngFor="let s of uniqueFromShops" [value]="s">{{ s }}</option>
          </select>
        </div>
        <div class="filter-item">
          <label>Đến NT</label>
          <select [(ngModel)]="filterToShop">
            <option value="">Tất cả shop đích ({{ uniqueToShops.length }})</option>
            <option *ngFor="let s of uniqueToShops" [value]="s">{{ s }}</option>
          </select>
        </div>
        <button type="button" class="btn-clear-filters" (click)="clearFilters()">Xóa bộ lọc</button>
      </div>

      <!-- 6. Bảng Đề Xuất Điều Chuyển -->
      <section class="table-card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Từ NT</th>
                <th>Đến NT</th>
                <th class="number">SL đề xuất</th>
                <th>ĐV</th>
                <th class="number">HSD còn</th>
                <th>Ưu tiên</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredSuggestions">
                <td>
                  <strong>{{ row.productName }}</strong>
                  <small class="product-id-sub">{{ row.productCode }}</small>
                </td>
                <td>
                  <span class="shop-code-badge">{{ row.fromShopCode }}</span>
                  <small class="shop-name-sub">{{ row.fromShopName }}</small>
                </td>
                <td>
                  <span class="shop-code-badge dest">→ {{ row.toShopCode }}</span>
                  <small class="shop-name-sub">{{ row.toShopName }}</small>
                </td>
                <td class="number"><strong>{{ row.suggestedQty }}</strong></td>
                <td>{{ row.unit }}</td>
                <td class="number text-danger"><strong>{{ row.daysRemaining }}N HSD</strong></td>
                <td>
                  <span [class]="row.isSameProvince ? 'badge-priority local' : 'badge-priority regional'">
                    {{ row.isSameProvince ? '✓ Nội tỉnh' : 'Ngoại tỉnh' }}
                  </span>
                </td>
              </tr>
              <tr *ngIf="filteredSuggestions.length === 0">
                <td colspan="7" class="empty">
                  Chưa có đề xuất điều chuyển nào phù hợp bộ lọc.<br/>
                  <em>Nhấn <strong>"Tra cứu tồn kho toàn quốc"</strong> ở trên để cập nhật đề xuất!</em>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `,
  styles: [`
    .transfer-page { padding: 20px; display: flex; flex-direction: column; gap: 14px; color: #2d3748; font-family: system-ui, -apple-system, sans-serif; background: #fafafa; min-height: 100vh; }
    
    /* 1. Horizontal top menu */
    .top-header-menu { background: #17365d; border-radius: 10px; padding: 10px 16px; margin-bottom: 5px; }
    .horizontal-menu { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
    .horizontal-menu a, .horizontal-menu span { color: rgba(255,255,255,0.7); text-decoration: none; font-size: 13px; font-weight: 500; cursor: pointer; }
    .horizontal-menu a:hover { color: #fff; }
    .horizontal-menu .active-category { color: #fff; font-weight: 700; border-right: 1px solid rgba(255,255,255,0.3); padding-right: 18px; }
    .horizontal-menu .active-subtab { background: #059669; color: #fff !important; padding: 5px 12px; border-radius: 6px; font-weight: bold; }

    /* Initial Data Loader */
    .init-data-bar { display: flex; justify-content: space-between; align-items: center; background: #f1f5f9; padding: 10px 16px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 12px; }
    .init-info strong { color: #1e293b; }
    .btn-init-reload { border: 0; background: #334155; color: #fff; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; }
    .btn-init-reload:disabled { opacity: 0.6; }

    /* 2. DCS Sub Tabs */
    .dcs-tabs { display: flex; gap: 8px; }
    .dcs-tab-btn { border: 1px solid #cbd5e1; background: #fff; color: #475569; padding: 8px 16px; border-radius: 6px; font-weight: bold; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .dcs-tab-btn.active { border-color: #059669; color: #059669; background: #f0fdf4; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
    .dcs-tab-btn .badge { background: #e2e8f0; color: #475569; font-size: 11px; padding: 1px 6px; border-radius: 99px; }
    .dcs-tab-btn.active .badge { background: #059669; color: #fff; }
    .disabled-tab { opacity: 0.6; cursor: not-allowed; }

    /* 3. Rule box */
    .rule-box { background: #fff1f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #991b1b; line-height: 1.5; }
    .rule-box strong { color: #7f1d1d; }

    /* Resolution Controls */
    .resolution-control-box { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
    .resolution-info h3 { margin: 0 0 4px; font-size: 14px; color: #1e293b; }
    .resolution-info p { margin: 0; font-size: 12px; color: #64748b; }
    .resolution-actions { display: flex; gap: 8px; }
    .btn-resolve { border: 0; background: #059669; color: #fff; padding: 8px 14px; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; }
    .btn-resolve.btn-secondary { background: #475569; }
    .btn-resolve.btn-danger { background: #dc2626; }
    .btn-resolve:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Progress bar */
    .progress-container { padding: 14px 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; }
    .progress-bar-wrapper { height: 8px; background: #cbd5e1; border-radius: 4px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: #10b981; transition: width 0.2s ease-out; }
    .progress-stats { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: #475569; }
    .progress-current { font-size: 11px; margin: 4px 0 0; color: #64748b; }
    .step-note { margin: 0; font-size: 11px; color: #64748b; font-family: monospace; }

    /* 4. Summary & Export bar */
    .summary-export-bar { display: flex; align-items: center; justify-content: space-between; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); }
    .btn-audit { border: 1px solid #f97316; background: #fff8f5; color: #ea580c; padding: 8px 14px; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; }
    .btn-audit:hover { background: #ffedd5; }
    .btn-audit:disabled { opacity: 0.5; cursor: not-allowed; }
    .stats-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
    .stats-label b { color: #1e293b; }
    .stats-label .divider { color: #cbd5e1; }
    .stats-label .highlight { color: #059669; font-weight: bold; }
    .sub-stats-label-bar { font-size: 12px; color: #64748b; padding-left: 12px; margin-top: -8px; margin-bottom: 4px; }
    .btn-excel { border: 0; background: #16a34a; color: #fff; padding: 8px 16px; border-radius: 6px; font-weight: bold; font-size: 12px; cursor: pointer; }
    .btn-excel:hover { background: #15803d; }
    .btn-excel:disabled { opacity: 0.5; cursor: not-allowed; }

    /* 5. Filter Bar */
    .filter-bar { display: flex; gap: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; flex-wrap: wrap; align-items: flex-end; }
    .filter-item { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 150px; }
    .filter-item label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; }
    .filter-item select, .filter-item input { border: 1px solid #cbd5e1; padding: 6px 10px; border-radius: 6px; font-size: 13px; outline: 0; background: #fff; }
    .btn-clear-filters { border: 1px solid #cbd5e1; background: #f8fafc; color: #475569; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; height: 32px; font-weight: 500; }

    /* 6. Main Table & scrollable design */
    .table-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
    .table-wrap { max-height: 500px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 900px; }
    th, td { padding: 10px 14px; border-bottom: 1px solid #cbd5e1; text-align: left; vertical-align: middle; }
    th { position: sticky; top: 0; background: #f0fdf4; color: #166534; font-size: 11px; letter-spacing: .06em; font-weight: bold; text-transform: uppercase; z-index: 10; box-shadow: inset 0 -1px 0 #cbd5e1; }
    
    td strong { font-size: 13px; color: #1e293b; display: block; }
    .product-id-sub { display: block; font-size: 11px; color: #64748b; font-family: monospace; margin-top: 2px; }
    
    .shop-code-badge { background: #fecaca; color: #991b1b; font-size: 11px; font-weight: bold; padding: 3px 6px; border-radius: 4px; display: inline-block; }
    .shop-code-badge.dest { background: #dbeafe; color: #1e40af; }
    .shop-name-sub { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
    
    .number { text-align: right; }
    .text-danger { color: #dc2626; }
    
    .badge-priority { font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; display: inline-block; }
    .badge-priority.local { background: #dcfce7; color: #166534; }
    .badge-priority.regional { background: #fee2e2; color: #991b1b; }
    
    .empty { text-align: center; color: #64748b; padding: 40px; font-style: italic; line-height: 1.6; }

    @media (max-width: 768px) {
      .init-data-bar, .resolution-control-box, .summary-export-bar { flex-direction: column; align-items: stretch; gap: 10px; }
      .stats-label { flex-direction: column; align-items: flex-start; gap: 4px; }
      .stats-label .divider { display: none; }
    }
  `]
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
