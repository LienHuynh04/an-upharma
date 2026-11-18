import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { parseNumericValue } from "../inventory-utils";
import { UpharmaService } from "../upharma.service";

/**
 * Trang "Hàng sản lượng": theo dõi một danh sách mã sản phẩm trọng điểm
 * (cấu hình lưu trên Firebase) so với SỐ KHOÁN của tháng hiện tại.
 *
 * Nguồn số liệu: node `sales_report` đã đồng bộ sẵn trên Firebase (đơn bán
 * hàng từ đầu tháng đến hiện tại, cập nhật hằng giờ) — đọc qua
 * GetReportSalesByShop với _useFirebaseCache giống hệt trang FEFO và bộ
 * báo cáo, KHÔNG gọi API trực tiếp nên không dính lỗi treo API.
 *
 * Cấu hình mã + khoán lưu ở `hidden_products/volume_products` — cây duy
 * nhất RTDB rules cho ghi công khai (cùng chỗ với shop_visibility).
 */

interface VolumeProductConfig {
  code: string;
  /** Số khoán mặc định cho mọi shop. */
  quota: number;
  /** Số khoán riêng theo shop (ưu tiên hơn khoán mặc định). */
  shopQuotas?: Record<string, number>;
  /** Đơn vị tính của số khoán (Hộp, Lọ…) — khớp với cột ĐVT target của bảng khoán. */
  unit?: string;
  /**
   * Quy đổi: bao nhiêu đơn vị bán lẻ trên hóa đơn (viên, ống) bằng 1 đơn vị
   * khoán. Hóa đơn bán lẻ theo viên/ống trong khi khoán tính theo hộp/lọ —
   * ví dụ H10x10 = 100, H2x7 = 14, L60 = 60. Để 1 nếu bán đúng đơn vị khoán.
   */
  packSize?: number;
}

interface VolumeConfig {
  items: VolumeProductConfig[];
  updatedAt?: number;
}

interface EmpAgg {
  /** Số lượng gộp theo từng đơn vị bán ghi trên hóa đơn (Viên/Ống/Lọ/Hộp…). */
  units: Map<string, number>;
  amount: number;
}

interface ShopAgg {
  units: Map<string, number>;
  amount: number;
  employees: Map<string, EmpAgg>;
}

function addUnit(map: Map<string, number>, unit: string, qty: number): void {
  map.set(unit, (map.get(unit) || 0) + qty);
}

interface EmpView {
  name: string;
  qty: number;
  amount: number;
  /** % số khoán của shop mà nhân viên này đã bán được. */
  pctQuota: number | null;
  /** % cơ cấu trong tổng bán của shop. */
  share: number;
}

interface ShopView {
  shopCode: string;
  shopName: string;
  qty: number;
  amount: number;
  quota: number;
  pct: number | null;
  remaining: number;
  over: number;
  employees: EmpView[];
}

interface EmployeeRow {
  product: ProductView;
  /** Ô của nhà thuốc đang chọn trong tab Nhân viên. */
  shop: ShopView;
  /** Thực đạt + tỉ trọng của từng nhân viên, khớp thứ tự với employeeNames. */
  cells: { qty: number; pctQuota: number | null }[];
}

interface ProductView {
  code: string;
  name: string;
  unit: string;
  totalQty: number;
  totalAmount: number;
  totalQuota: number;
  pct: number | null;
  remaining: number;
  over: number;
  status: "done" | "open" | "noquota";
  shops: ShopView[];
}

interface DraftItem {
  code: string;
  quota: number | null;
  shopQuotas: Record<string, number | null>;
  unit: string;
  packSize: number | null;
}

type RawRecord = Record<string, unknown>;

const CONFIG_URL = "https://an-upharma-default-rtdb.firebaseio.com/hidden_products/volume_products.json";
const CATALOG_URL = "https://an-upharma-default-rtdb.firebaseio.com/product_catalog.json";

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function pickField(row: RawRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

/** Bóc mảng dòng đơn hàng khỏi envelope trả về — cùng quy ước với report-generator. */
function extractRows(response: unknown): RawRecord[] {
  const preferredKeys = ["SalesInvoiceLst", "ReportSalesLst", "SalesReportLst", "Data", "data", "DataLst", "Rows", "rows", "Table", "result"];
  const findRows = (value: unknown): RawRecord[] => {
    if (Array.isArray(value)) {
      return value as RawRecord[];
    }
    if (!value || typeof value !== "object") {
      return [];
    }
    const record = value as RawRecord;
    for (const key of preferredKeys) {
      if (Array.isArray(record[key])) {
        return record[key] as RawRecord[];
      }
    }
    for (const child of Object.values(record)) {
      const rows = findRows(child);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  };
  return findRows(response);
}

@Component({
  selector: "app-sales-volume",
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container-xl py-3">
      <div class="d-flex flex-wrap align-items-center gap-2 mb-1">
        <h2 class="page-title mb-0">Hàng sản lượng</h2>
        <span class="badge bg-blue-lt text-blue">{{ monthLabel }}</span>
        <span class="text-secondary small">Đã qua {{ dayOfMonth }}/{{ daysInMonth }} ngày ({{ monthPct }}% tháng)</span>
        <div class="ms-auto d-flex gap-2">
          <button type="button" class="btn btn-outline-primary" (click)="loadData(true)" [disabled]="loading">
            <i class="ti ti-refresh me-1"></i>Tải lại
          </button>
          <button type="button" class="btn btn-primary" (click)="toggleSettings()" [disabled]="loading">
            <i class="ti ti-settings me-1"></i>Thiết lập mã &amp; khoán
          </button>
        </div>
      </div>
      <div class="text-secondary small mb-3">
        Nguồn: đơn bán hàng đồng bộ trên Firebase (từ đầu tháng đến hiện tại, cập nhật hằng giờ).
        <span *ngIf="loadedAtText">Dữ liệu lúc {{ loadedAtText }}.</span>
      </div>

      <div *ngIf="loading" class="alert alert-info d-flex align-items-center gap-2 py-2" role="alert">
        <span class="spinner-border spinner-border-sm"></span>
        <span>{{ progressText || "Đang tải dữ liệu bán hàng…" }}</span>
      </div>
      <div *ngIf="errorText" class="alert alert-danger py-2" role="alert">{{ errorText }}</div>
      <div *ngIf="!loading && failedShops.length" class="alert alert-warning py-2" role="alert">
        Chưa tải được dữ liệu của: <strong>{{ failedShops.join(", ") }}</strong> — tổng số bên dưới chưa gồm các shop này.
        <button type="button" class="btn btn-sm btn-outline-warning ms-2" (click)="loadData(true)">Thử lại</button>
      </div>

      <!-- Thiết lập -->
      <div *ngIf="settingsOpen" class="card mb-3">
        <div class="card-header">
          <h3 class="card-title">Thiết lập mã sản phẩm &amp; số khoán tháng này</h3>
        </div>
        <div class="card-body">
          <div class="row g-2 align-items-end mb-3">
            <div class="col-md-7">
              <label class="form-label">Thêm mã sản phẩm (mỗi mã một dòng, hoặc cách nhau bằng dấu phẩy)</label>
              <textarea class="form-control" rows="3" [(ngModel)]="newCodesText" placeholder="TP09890&#10;TC11682"></textarea>
            </div>
            <div class="col-md-3">
              <label class="form-label">Khoán mặc định / shop</label>
              <input type="number" class="form-control" min="0" [(ngModel)]="newQuotaDefault" />
            </div>
            <div class="col-md-2">
              <button type="button" class="btn btn-outline-primary w-100" (click)="addCodes()">Thêm mã</button>
            </div>
          </div>
          <div *ngIf="draftFeedback" class="text-secondary small mb-2">{{ draftFeedback }}</div>

          <div class="table-responsive" *ngIf="draftItems.length">
            <table class="table table-vcenter table-sm mb-0">
              <thead>
                <tr>
                  <th>Mã sản phẩm</th>
                  <th>Tên sản phẩm</th>
                  <th style="min-width: 110px">Khoán chung</th>
                  <th style="min-width: 90px">ĐVT khoán</th>
                  <th style="min-width: 110px">Quy đổi</th>
                  <th *ngFor="let shop of shops" style="min-width: 100px">{{ shop.ShopCode }}</th>
                  <th class="w-1"></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of draftItems">
                  <td class="fw-bold">{{ item.code }}</td>
                  <td class="text-secondary">{{ nameOf(item.code) || "—" }}</td>
                  <td><input type="number" class="form-control form-control-sm" min="0" [(ngModel)]="item.quota" /></td>
                  <td><input type="text" class="form-control form-control-sm" placeholder="Hộp" [(ngModel)]="item.unit" /></td>
                  <td><input type="number" class="form-control form-control-sm" min="1" [(ngModel)]="item.packSize" /></td>
                  <td *ngFor="let shop of shops">
                    <input
                      type="number"
                      class="form-control form-control-sm"
                      min="0"
                      [placeholder]="item.quota ?? 0"
                      [(ngModel)]="item.shopQuotas[shop.ShopCode]"
                    />
                  </td>
                  <td>
                    <button type="button" class="btn btn-icon btn-sm btn-outline-danger" title="Bỏ theo dõi mã này" (click)="removeDraftItem(item)">
                      <i class="ti ti-trash"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div *ngIf="!draftItems.length" class="text-secondary">Chưa có mã nào trong danh sách theo dõi.</div>

          <div class="d-flex flex-wrap align-items-center gap-2 mt-3">
            <button type="button" class="btn btn-primary" (click)="saveConfig()" [disabled]="savingConfig">
              <span *ngIf="savingConfig" class="spinner-border spinner-border-sm me-1"></span>Lưu thiết lập
            </button>
            <button type="button" class="btn btn-outline-secondary" (click)="cancelSettings()">Hủy thay đổi</button>
            <span *ngIf="configSavedText" class="text-success small">{{ configSavedText }}</span>
            <span class="text-secondary small ms-auto">Ô khoán theo shop để trống = dùng khoán chung. Khoán 0 = chưa đặt khoán. Quy đổi = số đơn vị bán lẻ (viên/ống) trong 1 ĐVT khoán — ví dụ H10x10 = 100, H2x7 = 14, L60 = 60; để 1 nếu bán đúng ĐVT khoán.</span>
          </div>
        </div>
      </div>

      <!-- Thống kê nhanh -->
      <div *ngIf="configLoaded && configItems.length" class="card mb-3">
        <div class="card-body py-2">
          <div class="d-flex flex-wrap gap-4">
            <div><span class="text-secondary small d-block">Mã đang theo dõi</span><strong class="fs-4">{{ stats.tracked }}</strong></div>
            <div><span class="text-secondary small d-block">Mã đã đạt khoán (toàn chuỗi)</span><strong class="fs-4 text-success">{{ stats.done }}</strong></div>
            <div><span class="text-secondary small d-block">Tổng đã bán</span><strong class="fs-4">{{ fmtQty(stats.totalQty) }}</strong></div>
            <div><span class="text-secondary small d-block">Tổng khoán</span><strong class="fs-4">{{ fmtQty(stats.totalQuota) }}</strong></div>
            <div><span class="text-secondary small d-block">Còn phải bán thêm</span><strong class="fs-4 text-danger">{{ fmtQty(stats.totalRemaining) }}</strong></div>
          </div>
        </div>
      </div>

      <!-- Bộ lọc -->
      <div *ngIf="configLoaded && configItems.length" class="row g-2 mb-3">
        <div class="col-md-6">
          <input type="text" class="form-control" placeholder="Tìm theo mã hoặc tên sản phẩm…" [(ngModel)]="searchText" (ngModelChange)="rebuildView()" />
        </div>
        <div class="col-md-6">
          <select class="form-select" [(ngModel)]="statusFilter" (ngModelChange)="rebuildView()">
            <option value="ALL">Tất cả trạng thái</option>
            <option value="OPEN">Chưa đạt khoán</option>
            <option value="DONE">Đã đạt khoán</option>
            <option value="NOQUOTA">Chưa đặt khoán</option>
          </select>
        </div>
      </div>

      <div *ngIf="configLoaded && !configItems.length && !loading" class="card">
        <div class="card-body text-center py-5">
          <div class="fs-3 mb-2">Chưa có mã sản phẩm nào được theo dõi</div>
          <p class="text-secondary">Bấm “Thiết lập mã &amp; khoán” để thêm các mã cần theo dõi sản lượng và đặt số khoán cho từng nhà thuốc.</p>
          <button type="button" class="btn btn-primary" (click)="toggleSettings()">Mở thiết lập</button>
        </div>
      </div>

      <!-- Hai tab: Nhà thuốc / Nhân viên, cùng một khung bảng như file Excel theo dõi khoán -->
      <ul *ngIf="configLoaded && configItems.length" class="nav nav-tabs mb-2">
        <li class="nav-item">
          <button type="button" class="nav-link" [class.active]="activeTab === 'shops'" (click)="setTab('shops')">Nhà thuốc</button>
        </li>
        <li class="nav-item">
          <button type="button" class="nav-link" [class.active]="activeTab === 'employees'" (click)="setTab('employees')">Nhân viên</button>
        </li>
      </ul>
      <p *ngIf="configLoaded && configItems.length" class="text-secondary small mb-3">
        Tỉ trọng = thực đạt ÷ số khoán. Ở tab Nhân viên, tỉ trọng của nhân viên tính trên số khoán của nhà thuốc.
      </p>

      <div
        *ngIf="configLoaded && configItems.length && !loading && ((activeTab === 'shops' && !products.length) || (activeTab === 'employees' && !employeeRows.length))"
        class="alert alert-secondary py-2"
      >
        Không có mã nào khớp bộ lọc hiện tại.
      </div>

      <!-- Tab Nhà thuốc: hàng = mã SP, mỗi nhà thuốc một cụm 3 cột Số khoán | Thực đạt | Tỉ trọng -->
      <div *ngIf="activeTab === 'shops' && products.length" class="card">
        <div class="table-responsive">
          <table class="table table-bordered table-sm align-middle mb-0">
            <thead>
              <tr>
                <th rowspan="2" style="min-width: 200px; position: sticky; left: 0; background: var(--upharma-card); z-index: 1">Mã SP</th>
                <th *ngFor="let shop of shops" colspan="3" class="text-center" style="background: rgba(128, 128, 128, 0.07)">
                  {{ shopLabel(shop.ShopCode) }}<span class="d-block small fw-normal text-secondary">{{ shop.ShopName }}</span>
                </th>
                <th colspan="3" class="text-center" style="background: rgba(128, 128, 128, 0.14)">Toàn chuỗi</th>
              </tr>
              <tr>
                <ng-container *ngFor="let shop of shops">
                  <th class="text-end">Số khoán</th>
                  <th class="text-end">Thực đạt</th>
                  <th class="text-end" style="min-width: 96px">Tỉ trọng</th>
                </ng-container>
                <th class="text-end">Số khoán</th>
                <th class="text-end">Thực đạt</th>
                <th class="text-end" style="min-width: 96px">Tỉ trọng</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let product of products">
                <td style="position: sticky; left: 0; background: var(--upharma-card); z-index: 1">
                  <span class="fw-bold">{{ product.code }}</span>
                  <span *ngIf="product.status === 'done'" class="badge bg-success ms-1">Đã đạt</span>
                  <span *ngIf="product.status === 'open'" class="badge bg-warning text-dark ms-1">Chưa đạt</span>
                  <span *ngIf="product.status === 'noquota'" class="badge bg-secondary ms-1">Chưa đặt khoán</span>
                  <span class="text-secondary d-block small">{{ product.name }}<span *ngIf="product.unit"> · ĐVT: {{ product.unit }}</span></span>
                </td>
                <ng-container *ngFor="let cell of product.shops">
                  <td class="text-end">{{ cell.quota > 0 ? fmtQty(cell.quota) : "—" }}</td>
                  <td class="text-end">
                    <strong>{{ fmtQty(cell.qty) }}</strong>
                    <span *ngIf="cell.remaining > 0" class="text-danger d-block small">còn thiếu {{ fmtQty(cell.remaining) }}</span>
                    <span *ngIf="cell.quota > 0 && cell.remaining === 0" class="text-success d-block small">đủ<span *ngIf="cell.over > 0"> (+{{ fmtQty(cell.over) }})</span></span>
                  </td>
                  <td class="text-end">
                    <strong>{{ fmtPct(cell.pct) }}</strong>
                    <div *ngIf="cell.pct !== null" class="progress mt-1" style="height: 4px">
                      <div
                        class="progress-bar"
                        [class.bg-success]="cell.pct >= 100"
                        [class.bg-warning]="cell.pct >= 50 && cell.pct < 100"
                        [class.bg-danger]="cell.pct < 50"
                        [style.width.%]="barWidth(cell.pct)"
                      ></div>
                    </div>
                  </td>
                </ng-container>
                <td class="text-end">{{ product.totalQuota > 0 ? fmtQty(product.totalQuota) : "—" }}</td>
                <td class="text-end">
                  <strong>{{ fmtQty(product.totalQty) }}</strong>
                  <span *ngIf="product.remaining > 0" class="text-danger d-block small">còn thiếu {{ fmtQty(product.remaining) }}</span>
                  <span *ngIf="product.totalQuota > 0 && product.remaining === 0" class="text-success d-block small">đủ<span *ngIf="product.over > 0"> (+{{ fmtQty(product.over) }})</span></span>
                </td>
                <td class="text-end">
                  <strong>{{ fmtPct(product.pct) }}</strong>
                  <div *ngIf="product.pct !== null" class="progress mt-1" style="height: 4px">
                    <div
                      class="progress-bar"
                      [class.bg-success]="product.pct >= 100"
                      [class.bg-warning]="product.pct >= 50 && product.pct < 100"
                      [class.bg-danger]="product.pct < 50"
                      [style.width.%]="barWidth(product.pct)"
                    ></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tab Nhân viên: chọn nhà thuốc, hàng = mã SP, mỗi nhân viên một cụm Thực đạt | Tỉ trọng -->
      <div *ngIf="activeTab === 'employees' && configLoaded && configItems.length">
        <div class="btn-group mb-3">
          <button
            *ngFor="let shop of shops"
            type="button"
            class="btn btn-sm"
            [class.btn-primary]="employeeShop === shop.ShopCode"
            [class.btn-outline-secondary]="employeeShop !== shop.ShopCode"
            (click)="setEmployeeShop(shop.ShopCode)"
          >
            {{ shopLabel(shop.ShopCode) }}
          </button>
        </div>
        <div *ngIf="employeeRows.length" class="card">
          <div class="table-responsive">
            <table class="table table-bordered table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th rowspan="2" style="min-width: 200px; position: sticky; left: 0; background: var(--upharma-card); z-index: 1">Mã SP</th>
                  <th colspan="3" class="text-center" style="background: rgba(128, 128, 128, 0.14)">Cả shop {{ shopLabel(employeeShop) }}</th>
                  <th *ngFor="let name of employeeNames" colspan="2" class="text-center" style="background: rgba(128, 128, 128, 0.07)">{{ name }}</th>
                </tr>
                <tr>
                  <th class="text-end">Số khoán</th>
                  <th class="text-end">Thực đạt</th>
                  <th class="text-end" style="min-width: 96px">Tỉ trọng</th>
                  <ng-container *ngFor="let name of employeeNames">
                    <th class="text-end">Thực đạt</th>
                    <th class="text-end" style="min-width: 84px">Tỉ trọng</th>
                  </ng-container>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of employeeRows">
                  <td style="position: sticky; left: 0; background: var(--upharma-card); z-index: 1">
                    <span class="fw-bold">{{ row.product.code }}</span>
                    <span class="text-secondary d-block small">{{ row.product.name }}<span *ngIf="row.product.unit"> · ĐVT: {{ row.product.unit }}</span></span>
                  </td>
                  <td class="text-end">{{ row.shop.quota > 0 ? fmtQty(row.shop.quota) : "—" }}</td>
                  <td class="text-end">
                    <strong>{{ fmtQty(row.shop.qty) }}</strong>
                    <span *ngIf="row.shop.remaining > 0" class="text-danger d-block small">còn thiếu {{ fmtQty(row.shop.remaining) }}</span>
                    <span *ngIf="row.shop.quota > 0 && row.shop.remaining === 0" class="text-success d-block small">đủ<span *ngIf="row.shop.over > 0"> (+{{ fmtQty(row.shop.over) }})</span></span>
                  </td>
                  <td class="text-end">
                    <strong>{{ fmtPct(row.shop.pct) }}</strong>
                    <div *ngIf="row.shop.pct !== null" class="progress mt-1" style="height: 4px">
                      <div
                        class="progress-bar"
                        [class.bg-success]="row.shop.pct >= 100"
                        [class.bg-warning]="row.shop.pct >= 50 && row.shop.pct < 100"
                        [class.bg-danger]="row.shop.pct < 50"
                        [style.width.%]="barWidth(row.shop.pct)"
                      ></div>
                    </div>
                  </td>
                  <ng-container *ngFor="let cell of row.cells">
                    <td class="text-end">{{ cell.qty > 0 ? fmtQty(cell.qty) : "—" }}</td>
                    <td class="text-end">{{ cell.pctQuota !== null ? fmtPct(cell.pctQuota) : "—" }}</td>
                  </ng-container>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SalesVolumeComponent implements OnInit, OnDestroy {
  private readonly upharmaService = inject(UpharmaService);
  private readonly cdr = inject(ChangeDetectorRef);

  shops: { ShopCode: string; ShopName: string }[] = [];
  loading = false;
  progressText = "";
  errorText = "";
  failedShops: string[] = [];
  loadedAtText = "";

  configLoaded = false;
  configItems: VolumeProductConfig[] = [];

  products: ProductView[] = [];
  stats = { tracked: 0, done: 0, totalQty: 0, totalQuota: 0, totalRemaining: 0 };

  searchText = "";
  statusFilter = "ALL";
  activeTab: "shops" | "employees" = "shops";
  employeeShop = "";
  employeeNames: string[] = [];
  employeeRows: EmployeeRow[] = [];

  settingsOpen = false;
  draftItems: DraftItem[] = [];
  newCodesText = "";
  newQuotaDefault: number | null = null;
  draftFeedback = "";
  savingConfig = false;
  configSavedText = "";

  monthLabel = "";
  dayOfMonth = 0;
  daysInMonth = 0;
  monthPct = 0;

  /** Tổng hợp bán hàng: code -> shopCode -> agg. Giữ riêng khỏi khoán để sửa khoán không cần tải lại. */
  private salesAgg = new Map<string, Map<string, ShopAgg>>();
  private productNames = new Map<string, string>();
  private hiddenAt = 0;
  private readonly onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
    } else if (this.hiddenAt && Date.now() - this.hiddenAt > 30 * 60 * 1000 && !this.loading) {
      void this.loadData(false);
    }
  };

  ngOnInit(): void {
    const vnNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    this.dayOfMonth = vnNow.getDate();
    this.daysInMonth = new Date(vnNow.getFullYear(), vnNow.getMonth() + 1, 0).getDate();
    this.monthPct = Math.round((this.dayOfMonth / this.daysInMonth) * 100);
    this.monthLabel = `Tháng ${vnNow.getMonth() + 1}/${vnNow.getFullYear()}`;
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.init();
  }

  ngOnDestroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private async init(): Promise<void> {
    try {
      this.upharmaService.ensureLogin();
      this.shops = this.upharmaService.getActiveShops().map((s) => ({ ShopCode: s.ShopCode, ShopName: s.ShopName }));
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.cdr.markForCheck();
      return;
    }
    await Promise.all([this.loadConfig(), this.loadData(false)]);
  }

  // ── Cấu hình ──────────────────────────────────────────────────────────

  private async loadConfig(): Promise<void> {
    try {
      const response = await fetch(CONFIG_URL);
      const data = (await response.json()) as VolumeConfig | null;
      const items = Array.isArray(data?.items) ? data!.items : [];
      this.configItems = items
        .map((item) => ({
          code: normalizeCode(item?.code),
          quota: Math.max(0, Math.round(Number(item?.quota) || 0)),
          shopQuotas: this.sanitizeShopQuotas(item?.shopQuotas),
          unit: String(item?.unit || "").trim(),
          packSize: Math.max(1, Math.round(Number(item?.packSize) || 1)),
        }))
        .filter((item) => item.code);
    } catch {
      this.configItems = [];
      this.errorText = "Chưa đọc được thiết lập mã & khoán trên Firebase — danh sách theo dõi đang trống.";
    } finally {
      this.configLoaded = true;
      this.rebuildView();
      this.cdr.markForCheck();
    }
  }

  private sanitizeShopQuotas(raw: Record<string, number> | undefined): Record<string, number> {
    const result: Record<string, number> = {};
    if (raw && typeof raw === "object") {
      for (const [shop, value] of Object.entries(raw)) {
        const num = Number(value);
        if (Number.isFinite(num) && num >= 0) {
          result[shop] = Math.round(num);
        }
      }
    }
    return result;
  }

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    if (this.settingsOpen) {
      this.openDraft();
    }
    this.cdr.markForCheck();
  }

  private openDraft(): void {
    this.draftItems = this.configItems.map((item) => ({
      code: item.code,
      quota: item.quota,
      shopQuotas: Object.fromEntries(this.shops.map((shop) => [shop.ShopCode, item.shopQuotas?.[shop.ShopCode] ?? null])),
      unit: item.unit || "",
      packSize: item.packSize ?? 1,
    }));
    this.draftFeedback = "";
    this.configSavedText = "";
    this.newCodesText = "";
    this.newQuotaDefault = null;
  }

  cancelSettings(): void {
    this.settingsOpen = false;
    this.cdr.markForCheck();
  }

  addCodes(): void {
    const codes = this.newCodesText
      .split(/[\s,;]+/)
      .map((code) => normalizeCode(code))
      .filter(Boolean);
    const existing = new Set(this.draftItems.map((item) => item.code));
    let added = 0;
    let skipped = 0;
    for (const code of codes) {
      if (existing.has(code)) {
        skipped++;
        continue;
      }
      existing.add(code);
      this.draftItems.push({
        code,
        quota: Math.max(0, Math.round(Number(this.newQuotaDefault) || 0)),
        shopQuotas: Object.fromEntries(this.shops.map((shop) => [shop.ShopCode, null])),
        unit: "",
        packSize: 1,
      });
      added++;
    }
    this.draftFeedback = codes.length
      ? `Đã thêm ${added} mã${skipped ? `, bỏ qua ${skipped} mã đã có trong danh sách` : ""}.`
      : "Chưa nhập mã nào.";
    this.newCodesText = "";
    this.cdr.markForCheck();
  }

  removeDraftItem(item: DraftItem): void {
    const wasSaved = this.configItems.some((saved) => saved.code === item.code);
    if (wasSaved && !window.confirm(`Bỏ theo dõi mã ${item.code}? Số khoán đã đặt cho mã này cũng sẽ bị xóa khi lưu.`)) {
      return;
    }
    this.draftItems = this.draftItems.filter((draft) => draft !== item);
    this.cdr.markForCheck();
  }

  async saveConfig(): Promise<void> {
    this.savingConfig = true;
    this.configSavedText = "";
    this.cdr.markForCheck();
    try {
      const items: VolumeProductConfig[] = this.draftItems.map((item) => ({
        code: item.code,
        unit: item.unit.trim(),
        packSize: Math.max(1, Math.round(Number(item.packSize) || 1)),
        quota: Math.max(0, Math.round(Number(item.quota) || 0)),
        shopQuotas: this.sanitizeShopQuotas(
          Object.fromEntries(Object.entries(item.shopQuotas).filter(([, v]) => v !== null && v !== undefined)) as Record<string, number>,
        ),
      }));
      const payload: VolumeConfig = { items, updatedAt: Date.now() };
      const response = await fetch(CONFIG_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`Firebase trả lỗi ${response.status}`);
      }
      this.configItems = items;
      const now = new Date();
      this.configSavedText = `Đã lưu thiết lập lúc ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}.`;
      this.rebuildView();
    } catch (error) {
      this.draftFeedback = `Lưu thất bại: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.savingConfig = false;
      this.cdr.markForCheck();
    }
  }

  nameOf(code: string): string {
    return this.productNames.get(code) || "";
  }

  // ── Dữ liệu bán hàng ─────────────────────────────────────────────────

  async loadData(forceRefresh: boolean): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    this.errorText = "";
    this.failedShops = [];
    this.progressText = "Đang tải dữ liệu bán hàng…";
    this.cdr.markForCheck();
    try {
      const session = this.upharmaService.ensureLogin();
      // Tổng hợp mọi mã (không lọc theo cấu hình) để khi sửa thiết lập thêm mã
      // mới, số liệu có sẵn ngay mà không phải tải lại dữ liệu bán hàng.
      const agg = new Map<string, Map<string, ShopAgg>>();
      const failed: string[] = [];
      let done = 0;
      const queue = [...this.shops];
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          const shop = queue.shift()!;
          try {
            const response = await this.upharmaService.callEndpoint<unknown>("/SalesInvoice/GetReportSalesByShop", {
              uPharmaID: session.UserInfo.uPharmaID,
              Token: session.Token,
              ShopCode: shop.ShopCode,
              _useFirebaseCache: true,
            }, { cache: true, forceRefresh });
            const rows = extractRows(response);
            for (const row of rows) {
              const code = normalizeCode(pickField(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "ItemCode", "Code"]));
              if (!code) {
                continue;
              }
              const name = String(pickField(row, ["ProductName", "Product_Name", "TenSP", "Name"]) || "").trim();
              if (name && !this.productNames.has(code)) {
                this.productNames.set(code, name);
              }
              const qty = parseNumericValue(pickField(row, ["Quantity", "Qty", "SL", "SoLuong", "AmountQty"]) || 0);
              const unitLabel = String(pickField(row, ["UnitOfMeasure", "Unit", "DonViTinh", "UnitName"]) || "").trim();
              const amount = parseNumericValue(
                pickField(row, ["AmountIncludingVAT", "AmountIncludingAdjust", "Amount", "TotalAmount", "ThanhTien"]) || 0,
              );
              const seller = String(pickField(row, ["SalesName", "EmployeeName", "StaffName", "SalesStaffName", "UserName", "FullName", "Employee", "EmpName", "SellerName"]) || "").trim() || "Không rõ người bán";
              let byShop = agg.get(code);
              if (!byShop) {
                byShop = new Map();
                agg.set(code, byShop);
              }
              let shopAgg = byShop.get(shop.ShopCode);
              if (!shopAgg) {
                shopAgg = { units: new Map(), amount: 0, employees: new Map() };
                byShop.set(shop.ShopCode, shopAgg);
              }
              addUnit(shopAgg.units, unitLabel, qty);
              shopAgg.amount += amount;
              const emp = shopAgg.employees.get(seller) || { units: new Map(), amount: 0 };
              addUnit(emp.units, unitLabel, qty);
              emp.amount += amount;
              shopAgg.employees.set(seller, emp);
            }
          } catch {
            failed.push(shop.ShopCode);
          } finally {
            done++;
            this.progressText = `Đang tải dữ liệu bán hàng… ${done}/${this.shops.length} nhà thuốc`;
            this.cdr.markForCheck();
          }
        }
      });
      await Promise.all(workers);
      this.salesAgg = agg;
      this.failedShops = failed;
      const now = new Date();
      this.loadedAtText = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      await this.fillMissingNames();
      this.rebuildView();
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.progressText = "";
      this.cdr.markForCheck();
    }
  }

  /** Mã chưa bán đơn nào sẽ không có tên trong dữ liệu bán hàng — tra bổ sung ở danh mục sản phẩm. */
  private async fillMissingNames(): Promise<void> {
    const missing = this.configItems.map((item) => item.code).filter((code) => !this.productNames.has(code));
    if (!missing.length) {
      return;
    }
    try {
      const response = await fetch(CATALOG_URL);
      const data = (await response.json()) as unknown;
      const rows: RawRecord[] = Array.isArray(data)
        ? (data as RawRecord[])
        : data && typeof data === "object"
          ? (Object.values(data as RawRecord).filter((v) => v && typeof v === "object") as RawRecord[])
          : [];
      const wanted = new Set(missing);
      for (const row of rows) {
        const code = normalizeCode(pickField(row, ["c", "code", "ProductID", "ProductCode"]));
        const name = String(pickField(row, ["n", "name", "ProductName"]) || "").trim();
        if (code && name && wanted.has(code) && !this.productNames.has(code)) {
          this.productNames.set(code, name);
        }
      }
    } catch {
      // Không tra được tên thì hiển thị mã — không chặn trang.
    }
  }

  // ── Dựng view ────────────────────────────────────────────────────────

  /**
   * Quy đổi số lượng theo từng đơn vị bán trên hóa đơn về đơn vị khoán:
   * dòng bán đúng đơn vị khoán (hoặc không ghi đơn vị) tính nguyên; dòng bán
   * lẻ (viên/ống) chia cho packSize. packSize <= 1 thì mọi dòng tính nguyên.
   */
  private convertedQty(units: Map<string, number>, item: VolumeProductConfig): number {
    const target = (item.unit || "").trim().toLowerCase();
    const pack = item.packSize && item.packSize > 1 ? item.packSize : 1;
    let total = 0;
    for (const [unit, qty] of units) {
      if (!unit || pack <= 1 || unit.trim().toLowerCase() === target) {
        total += qty;
      } else {
        total += qty / pack;
      }
    }
    return total;
  }

  rebuildView(): void {
    const search = this.searchText.trim().toLowerCase();
    if (!this.employeeShop || !this.shops.some((shop) => shop.ShopCode === this.employeeShop)) {
      this.employeeShop = this.shops[0]?.ShopCode || "";
    }
    const views: ProductView[] = [];
    for (const item of this.configItems) {
      const byShop = this.salesAgg.get(item.code);
      const shopViews: ShopView[] = [];
      for (const shop of this.shops) {
        const quota = item.shopQuotas?.[shop.ShopCode] ?? item.quota ?? 0;
        const shopAgg = byShop?.get(shop.ShopCode);
        const qty = shopAgg ? this.convertedQty(shopAgg.units, item) : 0;
        const employees: EmpView[] = [...(shopAgg?.employees.entries() || [])]
          .map(([name, emp]) => {
            const empQty = this.convertedQty(emp.units, item);
            return {
              name,
              qty: empQty,
              amount: emp.amount,
              pctQuota: quota > 0 ? (empQty / quota) * 100 : null,
              share: qty > 0 ? (empQty / qty) * 100 : 0,
            };
          })
          .sort((a, b) => b.qty - a.qty);
        shopViews.push({
          shopCode: shop.ShopCode,
          shopName: shop.ShopName,
          qty,
          amount: shopAgg?.amount || 0,
          quota,
          pct: quota > 0 ? (qty / quota) * 100 : null,
          remaining: Math.max(0, quota - qty),
          over: Math.max(0, qty - quota),
          employees,
        });
      }
      const totalQty = shopViews.reduce((sum, s) => sum + s.qty, 0);
      const totalAmount = shopViews.reduce((sum, s) => sum + s.amount, 0);
      const totalQuota = shopViews.reduce((sum, s) => sum + s.quota, 0);
      const status: ProductView["status"] = totalQuota <= 0 ? "noquota" : totalQty >= totalQuota ? "done" : "open";
      views.push({
        code: item.code,
        name: this.productNames.get(item.code) || "",
        unit: item.unit || "",
        totalQty,
        totalAmount,
        totalQuota,
        pct: totalQuota > 0 ? (totalQty / totalQuota) * 100 : null,
        remaining: Math.max(0, totalQuota - totalQty),
        over: Math.max(0, totalQty - totalQuota),
        status,
        shops: shopViews,
      });
    }
    const statusRank = { open: 0, noquota: 1, done: 2 } as const;
    views.sort((a, b) => statusRank[a.status] - statusRank[b.status] || (a.pct ?? 0) - (b.pct ?? 0) || b.remaining - a.remaining);
    this.stats = {
      tracked: views.length,
      done: views.filter((v) => v.status === "done").length,
      totalQty: views.reduce((sum, v) => sum + v.totalQty, 0),
      totalQuota: views.reduce((sum, v) => sum + v.totalQuota, 0),
      totalRemaining: views.reduce((sum, v) => sum + v.remaining, 0),
    };
    const statusWanted = this.statusFilter;
    const matchesCommon = (view: ProductView): boolean => {
      if (search && !view.code.toLowerCase().includes(search) && !view.name.toLowerCase().includes(search)) return false;
      return true;
    };
    this.products = views.filter((view) => {
      if (statusWanted === "OPEN" && view.status !== "open") return false;
      if (statusWanted === "DONE" && view.status !== "done") return false;
      if (statusWanted === "NOQUOTA" && view.status !== "noquota") return false;
      return matchesCommon(view);
    });

    // Tab Nhân viên: nhân viên của shop đang chọn, tổng hợp từ mọi mã theo dõi.
    const totals = new Map<string, number>();
    for (const view of views) {
      const cell = view.shops.find((shop) => shop.shopCode === this.employeeShop);
      for (const emp of cell?.employees || []) {
        totals.set(emp.name, (totals.get(emp.name) || 0) + emp.qty);
      }
    }
    this.employeeNames = [...totals.entries()]
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "vi"))
      .map(([name]) => name);
    const shopStatus = (cell: ShopView): ProductView["status"] => (cell.quota <= 0 ? "noquota" : cell.qty >= cell.quota ? "done" : "open");
    const rows: EmployeeRow[] = [];
    for (const view of views) {
      const cell = view.shops.find((shop) => shop.shopCode === this.employeeShop);
      if (!cell) {
        continue;
      }
      const status = shopStatus(cell);
      if (statusWanted === "OPEN" && status !== "open") continue;
      if (statusWanted === "DONE" && status !== "done") continue;
      if (statusWanted === "NOQUOTA" && status !== "noquota") continue;
      if (!matchesCommon(view)) {
        continue;
      }
      const byName = new Map(cell.employees.map((emp) => [emp.name, emp]));
      rows.push({
        product: view,
        shop: cell,
        cells: this.employeeNames.map((name) => {
          const emp = byName.get(name);
          return { qty: emp?.qty || 0, pctQuota: emp ? emp.pctQuota : cell.quota > 0 ? 0 : null };
        }),
      });
    }
    rows.sort(
      (a, b) =>
        statusRank[shopStatus(a.shop)] - statusRank[shopStatus(b.shop)] ||
        (a.shop.pct ?? 0) - (b.shop.pct ?? 0) ||
        b.shop.remaining - a.shop.remaining,
    );
    this.employeeRows = rows;
    this.cdr.markForCheck();
  }

  setTab(tab: "shops" | "employees"): void {
    this.activeTab = tab;
    this.cdr.markForCheck();
  }

  setEmployeeShop(shopCode: string): void {
    this.employeeShop = shopCode;
    this.rebuildView();
  }

  /** Nhãn ngắn kiểu NT25 / NT97 / NT144 như trong file Excel theo dõi khoán. */
  shopLabel(shopCode: string): string {
    const digits = shopCode.replace(/\D/g, "");
    return digits ? `NT${parseInt(digits, 10)}` : shopCode;
  }

  // ── Định dạng ────────────────────────────────────────────────────────

  fmtQty(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toLocaleString("vi-VN") : rounded.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
  }

  fmtPct(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return "—";
    }
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
  }

  fmtMoney(value: number): string {
    if (!value) {
      return "0đ";
    }
    if (Math.abs(value) >= 1_000_000) {
      const tr = Math.round((value / 1_000_000) * 10) / 10;
      return `${tr.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tr`;
    }
    return `${Math.round(value).toLocaleString("vi-VN")}đ`;
  }

  barWidth(pct: number | null): number {
    if (pct === null) {
      return 0;
    }
    return Math.max(0, Math.min(100, pct));
  }
}
