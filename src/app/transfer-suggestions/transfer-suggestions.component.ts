import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { isWarehouseStore, normalizeInventoryRow, parseNumericValue } from "../inventory-utils";
import { RawRecord, ResourceResponse, ShopInfo, UpharmaService } from "../upharma.service";
import { InventoryApiMode, NationalInventoryService, NationalStoreStock } from "../national-inventory.service";

export interface ExpiringStockItem {
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
  priceText?: string;
}

export interface ExpiringTransferSuggestion {
  key: string;
  productCode: string;
  productName: string;
  unit: string;
  lot: string;
  expiryText: string;
  daysRemaining: number;
  fromShopCode: string;
  fromShopName: string;
  toShopCode: string;
  toShopName: string;
  sourceQuantity: number;
  destAvgSales: number;
  suggestedQty: number;
  isSameProvince: boolean;
  rank: number;
}

export interface GroupedSuggestion {
  productCode: string;
  productName: string;
  fromShopCode: string;
  fromShopName: string;
  unit: string;
  lot: string;
  minDaysRemaining: number;
  minExpiryText: string;
  totalSourceQuantity: number;
  totalSuggestedQty: number;
  suggestionCount: number;
  sameProvinceCount: number;
  sourceShops: string[];
  items: ExpiringTransferSuggestion[];
}

export interface GroupedExpiringStock {
  productCode: string;
  productName: string;
  shopCode: string;
  shopName: string;
  unit: string;
  minExpiryText: string;
  minDaysRemaining: number;
  totalQuantity: number;
  shopCount: number;
  items: ExpiringStockItem[];
}

@Component({
  selector: "app-transfer-suggestions",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- PAGE HEADER -->
    <div class="page-header d-print-none pb-2">
      <div class="container-fluid">
        <div class="row align-items-center">
          <div class="col">
            <div class="page-pretitle text-uppercase fw-bold text-muted">QUẢN LÝ ĐIỀU CHUYỂN HÀNG HÓA</div>
            <h2 class="page-title text-primary d-flex align-items-center gap-2 fw-bold mb-0">
              Gợi ý Điều Chuyển Hàng Cận Date
            </h2>
          </div>
        </div>
      </div>
    </div>

    <div class="page-body">
      <div class="container-fluid">

        <!-- SHOP TABS NAVIGATION (CHÍNH XÁC THEO TỒN KHO VÀ CÁC TRANG KHÁC) -->
        <div class="card mb-3" *ngIf="userShops.length > 0">
          <div class="card-header p-0">
            <ul class="nav nav-tabs card-header-tabs nav-fill w-100 m-0">
              <li class="nav-item" *ngFor="let shop of userShops">
                <a
                  href="javascript:void(0)"
                  class="nav-link py-3"
                  [class.active]="selectedShopCode === shop.ShopCode"
                  (click)="selectShopTab(shop.ShopCode)"
                >
                  <i class="ti ti-building-store me-2" style="font-size: 1.15rem;"></i>
                  <strong>{{ shop.ShopCode }}</strong>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <!-- THANH TIẾN TRÌNH & THÔNG BÁO XỬ LÝ -->
        <div *ngIf="loadingStep1 || loadingStep2 || progressPercent > 0 || statusText || errorText" class="card shadow-sm border-0 mb-3">
          <div class="card-body py-2 px-3">
            <div *ngIf="loadingStep2 || progressPercent > 0">
              <div class="progress progress-sm rounded-pill overflow-hidden">
                <div class="progress-bar bg-primary progress-bar-striped progress-bar-animated" [style.width.%]="progressPercent"></div>
              </div>
              <div class="d-flex justify-content-between mt-1 text-secondary fs-5">
                <span>Đang phân tích nhu cầu tiêu thụ toàn quốc: <b>{{ progressPercent }}%</b> (Đã xử lý {{ progressDone }}/{{ uniqueProductCount }} sản phẩm)</span>
                <span>Hệ thống UPharma</span>
              </div>
              <div class="mt-1 text-secondary fs-5" *ngIf="progressCurrentProduct">Đang kiểm tra dữ liệu cho mã sản phẩm: <code class="fw-bold text-primary">{{ progressCurrentProduct }}</code></div>
            </div>

            <div *ngIf="statusText && (loadingStep1 || loadingStep2)" class="alert alert-info py-2 px-3 my-1 fs-5 border-0 bg-info-lt">
              ℹ️ {{ statusText }}
            </div>
            <div *ngIf="errorText" class="alert alert-danger py-2 px-3 my-1 fs-5 border-0 bg-danger-lt">
              ⚠️ {{ errorText }}
            </div>
          </div>
        </div>

        <!-- THỐNG KÊ HẠN DÙNG CARDS (100% GIỐNG TỒN KHO) -->
        <div class="row row-deck row-cards mb-3" aria-label="Thống kê hạn dùng" *ngIf="step1Done">
          <div class="col-sm-6 col-md-3">
            <div
              class="card all cursor-pointer"
              [class.is-active]="colFilterExpiry === ''"
              (click)="setExpiryFilter('')"
              style="cursor: pointer;"
              title="Click để xem tất cả mã SP luân chuyển"
            >
              <div class="card-status-start bg-primary"></div>
              <div class="card-body">
                <div class="text-secondary font-weight-medium">Tất cả</div>
                <div class="h2 mt-2 mb-1">{{ expiryBucketCounts.all }}</div>
                <div class="text-secondary mb-1"><small>SL đề xuất: {{ formatNumber(expiryBucketCounts.allQty) }}</small></div>
                <div class="text-secondary"><small class="expiry-rate">100,00%</small></div>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-md-3">
            <div
              class="card danger cursor-pointer"
              [class.is-active]="colFilterExpiry === 'danger'"
              (click)="setExpiryFilter('danger')"
              style="cursor: pointer;"
              title="Click để lọc HSD trong vòng 3 tháng"
            >
              <div class="card-status-start bg-danger"></div>
              <div class="card-body">
                <div class="text-secondary font-weight-medium">3 Tháng</div>
                <div class="h2 mt-2 mb-1">{{ expiryBucketCounts.danger }}</div>
                <div class="text-secondary mb-1"><small>SL đề xuất: {{ formatNumber(expiryBucketCounts.dangerQty) }}</small></div>
                <div class="text-secondary"><small class="expiry-rate">{{ expiryBucketCounts.dangerRate }}%</small></div>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-md-3">
            <div
              class="card warning cursor-pointer"
              [class.is-active]="colFilterExpiry === 'warning'"
              (click)="setExpiryFilter('warning')"
              style="cursor: pointer;"
              title="Click để lọc HSD từ 3 - 6 tháng"
            >
              <div class="card-status-start bg-warning"></div>
              <div class="card-body">
                <div class="text-secondary font-weight-medium">6 Tháng</div>
                <div class="h2 mt-2 mb-1">{{ expiryBucketCounts.warning }}</div>
                <div class="text-secondary mb-1"><small>SL đề xuất: {{ formatNumber(expiryBucketCounts.warningQty) }}</small></div>
                <div class="text-secondary"><small class="expiry-rate">{{ expiryBucketCounts.warningRate }}%</small></div>
              </div>
            </div>
          </div>

          <div class="col-sm-6 col-md-3">
            <div
              class="card safe cursor-pointer"
              [class.is-active]="colFilterExpiry === 'safe'"
              (click)="setExpiryFilter('safe')"
              style="cursor: pointer;"
              title="Click để lọc HSD đến 1 năm"
            >
              <div class="card-status-start bg-success"></div>
              <div class="card-body">
                <div class="text-secondary font-weight-medium">1 Năm</div>
                <div class="h2 mt-2 mb-1">{{ expiryBucketCounts.safe }}</div>
                <div class="text-secondary mb-1"><small>SL đề xuất: {{ formatNumber(expiryBucketCounts.safeQty) }}</small></div>
                <div class="text-secondary"><small class="expiry-rate">{{ expiryBucketCounts.safeRate }}%</small></div>
              </div>
            </div>
          </div>
        </div>

        <!-- BẢNG MAIN CONTAINER (100% GIỐNG TỒN KHO) -->
        <div class="card" [class.filters-collapsed]="filtersCollapsed" *ngIf="step1Done">
          <button class="mobile-filter-toggle" type="button" (click)="filtersCollapsed = !filtersCollapsed">
            <span>{{ filtersCollapsed ? 'Hiện bộ lọc' : 'Ẩn bộ lọc' }}</span>
            <i class="ti" [class.ti-filter]="filtersCollapsed" [class.ti-filter-off]="!filtersCollapsed"></i>
          </button>

          <div class="table-responsive" style="max-height: 75vh; overflow-y: auto;">
            <table class="table table-vcenter card-table table-striped table-hover" style="table-layout: fixed; width: 100%;">
              <thead>
                <tr>
                  <th class="text-center" style="width: 64px; min-width: 64px;">STT</th>
                  <th style="width: 35%;">Tên SP</th>
                  <th style="width: 12%;">Mã SP</th>
                  <th style="width: 10%;">Hạn dùng</th>
                  <th style="width: 18%;">NT nguồn ➔ NT đích</th>
                  <th class="text-end" style="width: 9%;">Tồn Nguồn</th>
                  <th class="text-end" style="width: 9%;">Tổng SL Đề xuất</th>
                  <th class="text-center" style="width: 7%;">Số tuyến</th>
                </tr>

              </thead>
              <tbody>
                <tr *ngIf="cachedGroupedSuggestions.length === 0">
                  <td colspan="8" class="text-center text-secondary py-4">
                    <div *ngIf="!step2Done">Chưa có đề xuất điều chuyển. Nhấn <strong>"🚀 TẠO GỢI Ý ĐIỀU CHUYỂN"</strong> để bắt đầu!</div>
                    <div *ngIf="step2Done">Không tìm thấy gợi ý điều chuyển nào phù hợp.</div>
                  </td>
                </tr>
                <tr *ngFor="let group of cachedGroupedSuggestions; let i = index; trackBy: trackByGroupKey" (click)="openDetailModal(group)" style="cursor: pointer;" title="Bấm vào dòng để xem chi tiết gợi ý điều chuyển">
                  <td data-label="STT" class="text-center font-monospace fw-bold" style="white-space: nowrap;">{{ i + 1 }}</td>
                  <td data-label="Tên SP">{{ group.productName }}</td>
                  <td data-label="Mã SP">{{ group.productCode }}</td>
                  <td data-label="Hạn dùng">
                    <span [class]="getExpiryMonthTag(group.minDaysRemaining).class">
                      {{ getExpiryMonthTag(group.minDaysRemaining).label }}
                    </span>
                  </td>
                  <td data-label="NT nguồn ➔ NT đích">
                    <div class="d-flex flex-column gap-1">
                      <div *ngFor="let item of getTopRoutes(group)" class="d-flex align-items-center gap-1 flex-wrap">
                        <span class="badge bg-secondary-lt font-monospace fs-5">{{ group.fromShopCode }}</span>
                        <span class="text-secondary small">➔</span>
                        <span class="badge bg-blue-lt text-blue font-monospace fs-5">{{ item.toShopCode }}</span>
                      </div>
                      <div *ngIf="group.items.length > 3">
                        <span class="badge bg-secondary-lt text-secondary fs-6">+{{ group.items.length - 3 }} tuyến khác</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Tồn Nguồn" class="text-end">{{ formatNumber(group.totalSourceQuantity) }} {{ group.unit }}</td>
                  <td data-label="Tổng SL Đề xuất" class="text-end fw-bold text-primary">{{ formatNumber(group.totalSuggestedQty) }} {{ group.unit }}</td>
                  <td data-label="Số tuyến" class="text-center">
                    <span class="badge bg-info-lt text-info">{{ group.suggestionCount }} tuyến</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- MODAL CHI TIẾT GỢI Ý ĐIỀU CHUYỂN -->
        <div class="modal modal-blur fade show d-block" *ngIf="selectedGroupForModal" tabindex="-1" role="dialog" style="background-color: rgba(0, 0, 0, 0.5); z-index: 1050;" (click)="closeDetailModal()">
          <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="document" (click)="$event.stopPropagation()">
            <div class="modal-content shadow-lg border">
              <div class="modal-header py-3">
                <div class="w-100 me-2">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <h3 class="modal-title fw-bold text-primary mb-0 d-flex align-items-center gap-2">
                      <i class="ti ti-arrows-exchange"></i> Chi Tiết Gợi Ý Điều Chuyển
                    </h3>
                  </div>
                  <div class="d-flex align-items-center gap-2 flex-wrap mt-2">
                    <span class="fs-3 fw-bold">{{ selectedGroupForModal.productName }}</span>
                    <span class="badge bg-primary-lt font-monospace fs-4">Mã: {{ selectedGroupForModal.productCode }}</span>
                  </div>
                </div>
                <button type="button" class="btn-close ms-auto align-self-start" (click)="closeDetailModal()"></button>
              </div>
              
              <div class="modal-body p-3">
                <!-- Summary stats bar inside Modal -->
                <div class="row g-2 mb-3 bg-body-tertiary p-3 rounded align-items-center border">
                  <div class="col-md-3">
                    <small class="text-secondary d-block font-weight-medium">HSD Gần nhất:</small>
                    <span [class]="getExpiryMonthTag(selectedGroupForModal.minDaysRemaining).class + ' fs-4'">
                      {{ getExpiryMonthTag(selectedGroupForModal.minDaysRemaining).label }}
                    </span>
                  </div>
                  <div class="col-md-3">
                    <small class="text-secondary d-block font-weight-medium">Tồn Kho Nguồn:</small>
                    <strong class="fs-4 font-monospace">{{ formatNumber(selectedGroupForModal.totalSourceQuantity) }}</strong>
                  </div>
                  <div class="col-md-3">
                    <small class="text-secondary d-block font-weight-medium">Tổng SL Đề Xuất:</small>
                    <strong class="text-primary fs-3 font-monospace">{{ formatNumber(selectedGroupForModal.totalSuggestedQty) }} {{ selectedGroupForModal.unit }}</strong>
                  </div>
                  <div class="col-md-3 text-end">
                    <small class="text-secondary d-block font-weight-medium">Phương án đề xuất:</small>
                    <span class="badge bg-info-lt text-info fs-4 px-3 py-1">📋 {{ selectedGroupForModal.suggestionCount }} gợi ý đích</span>
                  </div>
                </div>

                <!-- Table inside Modal -->
                <div class="table-responsive rounded border shadow-sm">
                  <table class="table table-vcenter table-striped table-hover align-middle mb-0 w-100">
                    <thead class="bg-body-tertiary">
                      <tr>
                        <th class="text-center" style="width: 60px;">#</th>
                        <th style="width: 28%;">NT nguồn ➔ NT đích</th>
                        <th style="width: 12%;">Hạn dùng</th>
                        <th style="width: 12%;" class="text-end">Tồn nguồn</th>
                        <th style="width: 15%;" class="text-end">Bán TB/Tháng</th>
                        <th style="width: 18%;" class="text-end">SL Đề xuất</th>
                        <th style="width: 12%;" class="text-center">Khu vực</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let item of selectedGroupForModal.items">
                        <td class="text-center">
                          <span [class]="item.rank === 1 ? 'badge bg-warning-lt text-warning fw-bold px-2 py-1 shadow-sm fs-5' : item.rank === 2 ? 'badge bg-primary-lt fw-bold px-2 py-1 fs-5' : item.rank === 3 ? 'badge bg-info-lt fw-bold px-2 py-1 fs-5' : 'badge bg-secondary-lt text-secondary px-2 py-1 fs-5'">
                            {{ item.rank === 1 ? '🏆 1' : item.rank }}
                          </span>
                        </td>
                        <td>
                          <span class="badge bg-red text-white font-monospace fs-5 me-1">{{ item.fromShopCode }}</span>
                          <span class="text-secondary fw-bold">➔</span>
                          <span class="badge bg-blue text-white font-monospace fs-5 ms-1">{{ item.toShopCode }}</span>
                        </td>
                        <td>
                          <span [class]="getExpiryMonthTag(item.daysRemaining).class + ' fs-5'">
                            {{ getExpiryMonthTag(item.daysRemaining).label }}
                          </span>
                        </td>
                        <td class="text-end font-monospace text-secondary fw-bold fs-4">{{ formatNumber(item.sourceQuantity) }}</td>
                        <td class="text-end font-monospace text-success fw-bold">
                          <span class="badge bg-success-lt px-2 py-1 fs-4">{{ formatNumber(item.destAvgSales) }}</span>
                        </td>
                        <td class="text-end">
                          <span class="badge bg-primary px-3 py-1 font-monospace fw-bold fs-4">
                            {{ formatNumber(item.suggestedQty) }} {{ item.unit }}
                          </span>
                        </td>
                        <td class="text-center">
                          <span [class]="item.isSameProvince ? 'badge bg-green-lt text-success fw-bold px-2 py-1 fs-5' : 'badge bg-orange-lt text-warning fw-bold px-2 py-1 fs-5'">
                            {{ item.isSameProvince ? '✓ Nội tỉnh' : 'Ngoại tỉnh' }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="modal-footer py-2">
                <button type="button" class="btn btn-secondary font-weight-bold px-4" (click)="closeDetailModal()">✕ Đóng lại</button>
              </div>
            </div>
          </div>
        </div>

        <!-- MODAL CHI TIẾT TỒN KHO CẬN DATE -->
        <div class="modal modal-blur fade show d-block" *ngIf="selectedAuditGroupForModal" tabindex="-1" role="dialog" style="background-color: rgba(0, 0, 0, 0.5); z-index: 1050;" (click)="closeAuditDetailModal()">
          <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document" (click)="$event.stopPropagation()">
            <div class="modal-content shadow-lg border">
              <div class="modal-header py-3">
                <div class="w-100 me-2">
                  <div class="d-flex align-items-center justify-content-between mb-1">
                    <h3 class="modal-title fw-bold text-secondary mb-0 d-flex align-items-center gap-2">
                      <i class="ti ti-box"></i> Chi Tiết Tồn Kho Cận Date
                    </h3>
                  </div>
                  <div class="d-flex align-items-center gap-2 flex-wrap mt-2">
                    <span class="fs-3 fw-bold">{{ selectedAuditGroupForModal.productName }}</span>
                    <span class="badge bg-secondary-lt font-monospace fs-4">Mã: {{ selectedAuditGroupForModal.productCode }}</span>
                  </div>
                </div>
                <button type="button" class="btn-close ms-auto align-self-start" (click)="closeAuditDetailModal()"></button>
              </div>
              
              <div class="modal-body p-3">
                <div class="table-responsive rounded border shadow-sm">
                  <table class="table table-vcenter table-striped align-middle mb-0 w-100">
                    <thead class="bg-body-tertiary">
                      <tr>
                        <th class="text-center" style="width: 60px;">#</th>
                        <th style="width: 35%;">NT Nguồn</th>
                        <th style="width: 25%;">Hạn dùng</th>
                        <th style="width: 25%;" class="text-end">SL Tồn</th>
                        <th style="width: 15%;">ĐVT</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let item of selectedAuditGroupForModal.items; let idx = index">
                        <td class="text-center text-muted font-monospace">{{ idx + 1 }}</td>
                        <td>
                          <span class="badge bg-red text-white font-monospace fs-5">{{ item.shopCode }}</span>
                        </td>
                        <td>
                          <span [class]="getExpiryMonthTag(item.daysRemaining).class + ' fs-5'">
                            {{ getExpiryMonthTag(item.daysRemaining).label }}
                          </span>
                        </td>
                        <td class="text-end font-monospace fw-bold fs-3">{{ formatNumber(item.quantity) }}</td>
                        <td class="text-secondary fw-medium fs-5">{{ item.unit }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="modal-footer py-2">
                <button type="button" class="btn btn-secondary font-weight-bold px-4" (click)="closeAuditDetailModal()">✕ Đóng lại</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .bg-purple-lt {
      background-color: rgba(110, 66, 193, 0.1) !important;
      color: #6e42c1 !important;
    }
    .text-purple {
      color: #6e42c1 !important;
    }
    .bg-purple {
      background-color: #6e42c1 !important;
    }
  `]
})
export class TransferSuggestionsComponent implements OnInit {
  userShops: ShopInfo[] = [];
  selectedShopCode = "ALL";
  expiryDaysThreshold = 3650;
  selectedApiMode: InventoryApiMode = "GetExistProductLst";
  filtersCollapsed = true;

  get expiryThresholdLabel(): string {
    if (this.expiryDaysThreshold <= 90) return "3 tháng";
    if (this.expiryDaysThreshold <= 180) return "6 tháng";
    if (this.expiryDaysThreshold <= 360) return "12 tháng";
    return "Tất cả";
  }

  getExpiryMonthTag(days: number): { label: string; class: string } {
    if (days <= 90) return { label: "3 tháng", class: "badge bg-danger text-white" };
    if (days <= 180) return { label: "6 tháng", class: "badge bg-warning-lt text-warning" };
    if (days <= 365) return { label: "12 tháng", class: "badge bg-info text-white" };
    return { label: "> 12 tháng", class: "badge bg-secondary text-white" };
  }

  formatMonthYear(dateText: string | undefined | null): string {
    if (!dateText) return "";
    const str = dateText.trim();
    const parts = str.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        return `${parts[1]}/${parts[2]}`;
      }
      if (parts[0].length === 4) {
        return `${parts[1]}/${parts[0]}`;
      }
    }
    return str;
  }

  get uniqueExpiringProductCount(): number {
    return new Set(this.expiringStockList.map((item) => item.productCode).filter(Boolean)).size;
  }

  step1Done = false;
  step2Done = false;

  loadingStep1 = false;
  loadingStep2 = false;

  statusText = "";
  errorText = "";

  // Dữ liệu Tồn kho chi tiết (chuẩn hóa từ Tồn Kho / inventoryResource)
  expiringStockList: ExpiringStockItem[] = [];

  // Dữ liệu Bước 2: Map Mã SP -> danh sách shop tồn kho toàn quốc
  nationalStoreStockMap: Record<string, NationalStoreStock[]> = {};

  // Progress Bước 2
  progressPercent = 0;
  progressDone = 0;
  uniqueProductCount = 0;
  progressCurrentProduct = "";

  // Tab & Filter
  activeTab: "suggestions" | "audit" = "suggestions";
  filterProduct = "";
  filterFromShop = "";
  filterToShop = "";

  // Column Filters (Tương tự như bảng tồn kho)
  colFilterName = "";
  colFilterCode = "";
  colFilterLot = "";
  colFilterExpiry = "";
  colFilterFromShop = "";
  colFilterToShop = "";
  colFilterProvince = "";

  setExpiryFilter(filterKey: string): void {
    this.colFilterExpiry = filterKey;
    this.updateDisplayGroups();
  }

  get expiryBucketCounts(): {
    all: number; allQty: number; allRate: string;
    danger: number; dangerQty: number; dangerRate: string;
    warning: number; warningQty: number; warningRate: string;
    safe: number; safeQty: number; safeRate: string;
  } {
    const raw = this.suggestionRows;
    const allKeys = new Set<string>();
    const dangerKeys = new Set<string>();
    const warningKeys = new Set<string>();
    const safeKeys = new Set<string>();

    let allQty = 0;
    let dangerQty = 0;
    let warningQty = 0;
    let safeQty = 0;

    for (const item of raw) {
      const key = `${item.fromShopCode}|${item.productCode}`;
      allKeys.add(key);
      allQty += item.suggestedQty;

      if (item.daysRemaining >= 0 && item.daysRemaining <= 90) {
        dangerKeys.add(key);
        dangerQty += item.suggestedQty;
      }
      if (item.daysRemaining > 90 && item.daysRemaining <= 180) {
        warningKeys.add(key);
        warningQty += item.suggestedQty;
      }
      if (item.daysRemaining >= 0 && item.daysRemaining <= 365) {
        safeKeys.add(key);
        safeQty += item.suggestedQty;
      }
    }

    const total = allKeys.size || 1;

    return {
      all: allKeys.size,
      allQty,
      allRate: "100,00",

      danger: dangerKeys.size,
      dangerQty,
      dangerRate: ((dangerKeys.size / total) * 100).toFixed(2).replace(".", ","),

      warning: warningKeys.size,
      warningQty,
      warningRate: ((warningKeys.size / total) * 100).toFixed(2).replace(".", ","),

      safe: safeKeys.size,
      safeQty,
      safeRate: ((safeKeys.size / total) * 100).toFixed(2).replace(".", ","),
    };
  }

  colFilterAuditName = "";
  colFilterAuditCode = "";
  colFilterAuditExpiry = "";

  selectedItemForModal: ExpiringTransferSuggestion | null = null;

  openSingleDetailModal(item: ExpiringTransferSuggestion): void {
    this.selectedItemForModal = item;
  }

  closeSingleDetailModal(): void {
    this.selectedItemForModal = null;
  }

  constructor(
    private readonly upharma: UpharmaService,
    private readonly nationalInventoryService: NationalInventoryService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.upharma.ensureLogin();
      this.userShops = this.upharma.getActiveShops().filter((s) => !isWarehouseStore(s));
      if (this.userShops.length > 0) {
        this.selectedShopCode = this.userShops[0].ShopCode;
      }
      await this.runFullProcess();
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    }
  }

  selectShopTab(shopCode: string): void {
    if (this.selectedShopCode === shopCode || this.loadingStep1 || this.loadingStep2) return;
    this.selectedShopCode = shopCode;
    void this.runFullProcess();
  }

  onShopChange(): void {
    this.runFullProcess();
  }

  onThresholdChange(): void {
    this.runFullProcess();
  }

  async runFullProcess(): Promise<void> {
    await this.runStep1(false);
    if (this.step1Done && this.expiringStockList.length > 0) {
      await this.runStep2();
    }
  }

  // ==========================================
  // BƯỚC 1: LẤY DỮ LIỆU CẬN DATE TỪ TỒN KHO (`ton-kho`)
  // ==========================================
  async runStep1(forceRefresh = false): Promise<void> {
    if (this.loadingStep1) return;
    this.loadingStep1 = true;
    this.statusText = "Đang đồng bộ dữ liệu từ phân hệ Tồn Kho (ton-kho)...";
    this.errorText = "";
    this.expiringStockList = [];
    this.step1Done = false;
    this.step2Done = false;

    try {
      this.upharma.ensureLogin();

      let targetShopCodes: string[] = [];
      if (this.selectedShopCode === "ALL") {
        targetShopCodes = this.userShops.map((s) => s.ShopCode);
      } else {
        targetShopCodes = [this.selectedShopCode];
      }

      if (targetShopCodes.length === 0) {
        throw new Error("Tài khoản chưa có nhà thuốc nào để kiểm tra.");
      }

      // Tải dữ liệu Tồn Kho chuẩn hóa
      const inventoryRes: ResourceResponse = await this.upharma.loadInventoryResource({
        forceRefresh,
        shopCodes: targetShopCodes,
      });

      const rawData = inventoryRes?.data || [];

      this.expiringStockList = rawData
        .map((row, index) => normalizeInventoryRow(row, index))
        .filter(
          (row) =>
            !isWarehouseStore(row) &&
            row.productCode &&
            row.expiryDaysRemaining !== null &&
            row.expiryDaysRemaining >= 0 &&
            row.expiryDaysRemaining <= this.expiryDaysThreshold &&
            parseNumericValue(row.quantity) > 0 &&
            (targetShopCodes.length === 0 || targetShopCodes.includes(row.shopCode))
        )
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
          unit: row.unit || "Hộp",
          priceText: row.priceText,
        }))
        .sort(
          (a, b) =>
            a.daysRemaining - b.daysRemaining || a.productName.localeCompare(b.productName, "vi")
        );

      this.step1Done = true;
      this.statusText = `Đã quét thấy ${this.expiringStockList.length} lô hàng cận date cần theo dõi.`;
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
      this.statusText = "Lỗi khi lấy dữ liệu từ phân hệ Tồn Kho.";
    } finally {
      this.loadingStep1 = false;
    }
  }

  // ==========================================
  // BƯỚC 2: TIÊU THỤ TOÀN QUỐC (ƯU TIÊN LẤY TỪ FIREBASE CACHE SIÊU NHANH)
  // ==========================================
  async runStep2(forceRefresh = false): Promise<void> {
    if (this.loadingStep2 || !this.step1Done) return;

    const uniqueProductCodes = Array.from(
      new Set(this.expiringStockList.map((item) => item.productCode).filter(Boolean))
    );

    this.uniqueProductCount = uniqueProductCodes.length;

    if (uniqueProductCodes.length === 0) {
      this.statusText = "Không có mã SP cận date nào để kiểm tra toàn quốc.";
      return;
    }

    this.loadingStep2 = true;
    this.statusText = `Đang tổng hợp dữ liệu tồn kho & sức bán cho ${uniqueProductCodes.length} sản phẩm từ Firebase Cache...`;
    this.errorText = "";
    this.progressPercent = 0;
    this.progressDone = 0;
    this.progressCurrentProduct = "";

    try {
      const responseMap = await this.nationalInventoryService.resolve(uniqueProductCodes, {
        mode: this.selectedApiMode,
        forceRefresh: forceRefresh,
        onProgress: (p) => {
          this.progressPercent = Math.round((p.done / p.total) * 100);
          this.progressDone = p.done;
          this.progressCurrentProduct = p.currentProduct;
          this.statusText = `Đang lấy dữ liệu nhu cầu toàn hệ thống: ${p.done}/${p.total} sản phẩm...`;
        },
      });

      this.nationalStoreStockMap = responseMap;
      this.step2Done = true;
      this.activeTab = "suggestions";
      this.updateDisplayGroups();
      this.statusText = `Hoàn tất phân tích cho ${uniqueProductCodes.length} sản phẩm. Đã lập ${this.cachedGroupedSuggestions.length} gợi ý luân chuyển tối ưu.`;
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
      this.statusText = "Lỗi xảy ra trong quá trình kiểm tra tiêu thụ toàn quốc.";
    } finally {
      this.loadingStep2 = false;
    }
  }

  topNDestinations = 5;

  cachedGroupedSuggestions: GroupedSuggestion[] = [];

  updateDisplayGroups(): void {
    this.cachedGroupedSuggestions = this.computeDisplayGroupedSuggestions();
  }

  trackByGroupKey(index: number, group: GroupedSuggestion): string {
    return `${group.fromShopCode}|${group.productCode}`;
  }

  getTopRoutes(group: GroupedSuggestion, max = 3): ExpiringTransferSuggestion[] {
    return group.items.slice(0, max);
  }

  computeDisplayGroupedSuggestions(): GroupedSuggestion[] {
    const raw = this.displaySuggestions;
    const map = new Map<string, ExpiringTransferSuggestion[]>();

    for (const item of raw) {
      const groupKey = `${item.fromShopCode}|${item.productCode}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)!.push(item);
    }

    const groups: GroupedSuggestion[] = [];
    map.forEach((items) => {
      if (items.length === 0) return;
      const first = items[0];

      let minDays = first.daysRemaining;
      let minExpiryText = first.expiryText;
      for (const item of items) {
        if (item.daysRemaining < minDays) {
          minDays = item.daysRemaining;
          minExpiryText = item.expiryText;
        }
      }

      const totalSuggestedQty = items.reduce((sum, i) => sum + i.suggestedQty, 0);
      const sameProvCount = items.filter((i) => i.isSameProvince).length;

      groups.push({
        productCode: first.productCode,
        productName: first.productName,
        fromShopCode: first.fromShopCode,
        fromShopName: first.fromShopName,
        unit: first.unit,
        lot: "",
        minDaysRemaining: minDays,
        minExpiryText: minExpiryText,
        totalSourceQuantity: first.sourceQuantity,
        totalSuggestedQty: totalSuggestedQty,
        suggestionCount: items.length,
        sameProvinceCount: sameProvCount,
        sourceShops: [`${first.fromShopCode} - ${first.fromShopName}`],
        items: items.sort((a, b) => a.rank - b.rank),
      });
    });

    return groups;
  }

  get displayGroupedSuggestions(): GroupedSuggestion[] {
    return this.cachedGroupedSuggestions;
  }

  // ==========================================
  // BƯỚC 3: THUẬT TOÁN GỢI Ý ĐIỀU CHUYỂN (HỖ TRỢ TOP N NHÀ THUỐC ĐÍCH)
  // ==========================================
  get suggestionRows(): ExpiringTransferSuggestion[] {
    if (!this.step2Done) return [];

    const suggestions: ExpiringTransferSuggestion[] = [];

    for (const item of this.expiringStockList) {
      if (!item.productCode || item.quantity < 1) continue;

      const destList = this.nationalStoreStockMap[item.productCode];
      if (!destList || !Array.isArray(destList) || destList.length === 0) continue;

      // Loại bỏ chính shop nguồn (shop cận date) và các Kho (Warehouse)
      const validDests = destList
        .filter((d: any) => d.StoreCode !== item.shopCode && !isWarehouseStore(d) && parseNumericValue(d.QuantityAVG) > 0)
        .sort((a, b) => parseNumericValue(b.QuantityAVG) - parseNumericValue(a.QuantityAVG));

      if (validDests.length === 0) continue;

      const sourceProvince = this.getProvince(item.shopName);

      // Phân loại shop nội tỉnh và ngoại tỉnh
      const sameProvinceDests = validDests.filter((d) => this.getProvince(d.StoreName) === sourceProvince);
      const otherProvinceDests = validDests.filter((d) => this.getProvince(d.StoreName) !== sourceProvince);

      // Lấy tối đa 5 nhà thuốc (Top N)
      const orderedDests = [...sameProvinceDests, ...otherProvinceDests].slice(0, this.topNDestinations);

      orderedDests.forEach((bestDest, index) => {
        const destProvince = this.getProvince(bestDest.StoreName);
        const isSame = sourceProvince === destProvince;

        const qty = Math.max(
          1,
          Math.min(Math.floor(item.quantity), Math.round(bestDest.QuantityAVG || 1))
        );

        suggestions.push({
          key: `${item.key}|${bestDest.StoreCode}|${index}`,
          productCode: item.productCode,
          productName: item.productName,
          unit: item.unit || "Hộp",
          lot: item.lot,
          expiryText: item.expiryText,
          daysRemaining: item.daysRemaining,
          fromShopCode: item.shopCode,
          fromShopName: item.shopName,
          toShopCode: bestDest.StoreCode,
          toShopName: bestDest.StoreName,
          sourceQuantity: item.quantity,
          destAvgSales: bestDest.QuantityAVG,
          suggestedQty: qty,
          isSameProvince: isSame,
          rank: index + 1,
        });
      });
    }

    return suggestions;
  }

  // ==========================================
  // FILTERS & GETTERS
  // ==========================================
  get filteredExpiringStock(): ExpiringStockItem[] {
    const q = this.filterProduct.trim().toLowerCase();
    if (!q) return this.expiringStockList;
    return this.expiringStockList.filter(
      (item) => item.productCode.toLowerCase().includes(q) || item.productName.toLowerCase().includes(q)
    );
  }

  get filteredSuggestions(): ExpiringTransferSuggestion[] {
    return this.suggestionRows.filter((row) => {
      const q = this.filterProduct.trim().toLowerCase();
      const matchProd = !q || row.productCode.toLowerCase().includes(q) || row.productName.toLowerCase().includes(q);
      const matchFrom = !this.filterFromShop || row.fromShopCode === this.filterFromShop;
      const matchTo = !this.filterToShop || row.toShopCode === this.filterToShop;
      return matchProd && matchFrom && matchTo;
    });
  }

  get evaluatedProductCount(): number {
    return Object.keys(this.nationalStoreStockMap).length;
  }

  get totalSuggestedCount(): number {
    return this.suggestionRows.length;
  }

  get sameProvinceCount(): number {
    return this.suggestionRows.filter((r) => r.isSameProvince).length;
  }

  get uniqueFromShops(): string[] {
    const set = new Set(this.suggestionRows.map((r) => r.fromShopCode));
    return Array.from(set).sort();
  }

  get uniqueToShops(): string[] {
    const set = new Set(this.suggestionRows.map((r) => r.toShopCode));
    return Array.from(set).sort();
  }

  selectedGroupForModal: GroupedSuggestion | null = null;
  selectedAuditGroupForModal: GroupedExpiringStock | null = null;

  openDetailModal(group: GroupedSuggestion): void {
    this.selectedGroupForModal = group;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  }

  closeDetailModal(): void {
    this.selectedGroupForModal = null;
    if (!this.selectedAuditGroupForModal) {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    }
  }

  openAuditDetailModal(group: GroupedExpiringStock): void {
    this.selectedAuditGroupForModal = group;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  }

  closeAuditDetailModal(): void {
    this.selectedAuditGroupForModal = null;
    if (!this.selectedGroupForModal) {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    }
  }

  get displaySuggestions(): ExpiringTransferSuggestion[] {
    const raw = this.suggestionRows;

    const qName = this.colFilterName.trim().toLowerCase();
    const qCode = this.colFilterCode.trim().toLowerCase();
    const qLot = this.colFilterLot.trim().toLowerCase();
    const qFrom = this.colFilterFromShop.trim().toLowerCase();
    const qTo = this.colFilterToShop.trim().toLowerCase();

    return raw.filter((item) => {
      if (qName && !item.productName.toLowerCase().includes(qName)) return false;
      if (qCode && !item.productCode.toLowerCase().includes(qCode)) return false;
      if (qLot && !item.lot.toLowerCase().includes(qLot)) return false;
      if (qFrom && !item.fromShopCode.toLowerCase().includes(qFrom) && !item.fromShopName.toLowerCase().includes(qFrom)) return false;
      if (qTo && !item.toShopCode.toLowerCase().includes(qTo) && !item.toShopName.toLowerCase().includes(qTo)) return false;

      if (this.colFilterExpiry) {
        if (this.colFilterExpiry === "expired" && item.daysRemaining >= 0) return false;
        if (this.colFilterExpiry === "danger" && (item.daysRemaining < 0 || item.daysRemaining > 90)) return false;
        if (this.colFilterExpiry === "warning" && (item.daysRemaining <= 90 || item.daysRemaining > 180)) return false;
        if (this.colFilterExpiry === "safe" && (item.daysRemaining < 0 || item.daysRemaining > 365)) return false;
      }

      if (this.colFilterProvince === "same" && !item.isSameProvince) return false;
      if (this.colFilterProvince === "other" && item.isSameProvince) return false;

      return true;
    });
  }

  get groupedExpiringStock(): GroupedExpiringStock[] {
    const raw = this.filteredExpiringStock;
    const map = new Map<string, ExpiringStockItem[]>();

    const qName = this.colFilterAuditName.trim().toLowerCase();
    const qCode = this.colFilterAuditCode.trim().toLowerCase();

    for (const item of raw) {
      if (qName && !item.productName.toLowerCase().includes(qName)) continue;
      if (qCode && !item.productCode.toLowerCase().includes(qCode)) continue;
      if (this.colFilterAuditExpiry) {
        const maxDays = Number(this.colFilterAuditExpiry) * 30;
        if (item.daysRemaining > maxDays) continue;
      }

      const groupKey = `${item.shopCode}|${item.productCode}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)!.push(item);
    }

    const groups: GroupedExpiringStock[] = [];
    map.forEach((items) => {
      if (items.length === 0) return;
      const first = items[0];

      let minDays = items[0].daysRemaining;
      let minExpiryText = items[0].expiryText;
      for (const item of items) {
        if (item.daysRemaining < minDays) {
          minDays = item.daysRemaining;
          minExpiryText = item.expiryText;
        }
      }

      const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);

      groups.push({
        productCode: first.productCode,
        productName: first.productName,
        shopCode: first.shopCode,
        shopName: first.shopName,
        unit: first.unit,
        minExpiryText,
        minDaysRemaining: minDays,
        totalQuantity: totalQty,
        shopCount: 1,
        items,
      });
    });

    return groups;
  }

  clearFilters(): void {
    this.filterProduct = "";
    this.filterFromShop = "";
    this.filterToShop = "";
  }

  // ==========================================
  // EXPORT EXCEL
  // ==========================================
  async exportSuggestedExcel(): Promise<void> {
    const rows = this.filteredSuggestions;
    if (rows.length === 0) return;

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheetRows = rows.map((row, idx) => ({
      "STT": idx + 1,
      "Xếp Hạng Gợi Ý": `Top ${row.rank}`,
      "Mã SP": row.productCode,
      "Tên SP": row.productName,
      "Số Lô": row.lot,
      "Hạn Dùng": this.formatMonthYear(row.expiryText),
      "HSD Còn (Ngày)": row.daysRemaining,
      "Từ NT Nguồn (Cận Date)": `${row.fromShopCode} - ${row.fromShopName}`,
      "Đến NT Đích (Nhu Cầu Cao)": `${row.toShopCode} - ${row.toShopName}`,
      "Tồn Nguồn": row.sourceQuantity,
      "Bán TB/Tháng (Đích)": row.destAvgSales,
      "SL Đề Xuất": row.suggestedQty,
      "Đơn Vị": row.unit,
      "Khu Vực": row.isSameProvince ? "Nội tỉnh" : "Ngoại tỉnh",
    }));

    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Goi y chuyen hang can date");
    const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `goi-y-dieu-chuyen-ton-kho-can-date.xlsx`);
  }

  async exportAuditExcel(): Promise<void> {
    const rows = this.filteredExpiringStock;
    if (rows.length === 0) return;

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheetRows = rows.map((row, idx) => ({
      "STT": idx + 1,
      "Nhà Thuốc": `${row.shopCode} - ${row.shopName}`,
      "Mã SP": row.productCode,
      "Tên SP": row.productName,
      "Số Lô": row.lot,
      "Hạn Dùng": this.formatMonthYear(row.expiryText),
      "HSD Còn (Ngày)": row.daysRemaining,
      "Số Lượng Tồn": row.quantity,
      "Đơn Vị": row.unit,
    }));

    const worksheet = xlsx.utils.json_to_sheet(sheetRows);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Audit ton kho can date");
    const buffer = xlsx.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    this.downloadExcelBuffer(buffer, `audit-ton-kho-can-date.xlsx`);
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

  formatNumber(val: number | undefined): string {
    if (val === undefined || val === null) return "0";
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(val);
  }

  private getProvince(name: string): string {
    if (!name) return "";
    const n = name.toLowerCase();
    if (n.includes("đà nẵng") || n.includes("da nang") || n.includes("đn")) return "Đà Nẵng";
    if (n.includes("khánh hòa") || n.includes("khanh hoa") || n.includes("nha trang")) return "Khánh Hòa";
    if (n.includes("gia lai") || n.includes("pleiku")) return "Gia Lai";
    if (n.includes("hồ chí minh") || n.includes("hcm") || n.includes("tphcm") || n.includes("sài gòn")) return "Hồ Chí Minh";
    if (n.includes("hà nội") || n.includes("ha noi")) return "Hà Nội";
    if (n.includes("bình định") || n.includes("binh dinh") || n.includes("quy nhơn")) return "Bình Định";
    if (n.includes("quảng nam") || n.includes("quang nam")) return "Quảng Nam";
    if (n.includes("quảng ngãi") || n.includes("quang ngai")) return "Quảng Ngãi";
    if (n.includes("thừa thiên huế") || n.includes("thua thien hue") || n.includes("huế")) return "Thừa Thiên Huế";
    if (n.includes("đắk lắk") || n.includes("dak lak") || n.includes("buôn ma thuột")) return "Đắk Lắk";
    if (n.includes("lâm đồng") || n.includes("lam dong") || n.includes("đà lạt")) return "Lâm Đồng";
    if (n.includes("cần thơ") || n.includes("can tho")) return "Cần Thơ";

    const parts = name.trim().split(/[-,-]/);
    const lastPart = parts[parts.length - 1]?.trim() || name;
    return lastPart;
  }
}
