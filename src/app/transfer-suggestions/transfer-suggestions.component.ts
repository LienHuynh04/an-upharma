import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { isWarehouseStore, normalizeInventoryRow, parseNumericValue } from "../inventory-utils";
import { RawRecord, ResourceResponse, ShopInfo, UpharmaService } from "../upharma.service";
import { InventoryApiMode, NationalInventoryService, NationalStoreStock } from "../national-inventory.service";
import { FirebaseInventoryService } from "../firebase-inventory.service";
import { ExcelExportService } from "../shared/services/excel-export.service";

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

interface TransferCacheEntry {
  cacheKey: string;
  groupedSuggestions?: GroupedSuggestion[];
  suggestions?: ExpiringTransferSuggestion[];
  bucketCounts?: any;
  expiringStockList: ExpiringStockItem[];
  nationalStoreStockMap: Record<string, NationalStoreStock[]>;
  savedAt: number;
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
          <div class="col-auto ms-auto d-print-none">
            <button
              type="button"
              class="btn btn-primary d-flex align-items-center gap-2 px-3 py-2 shadow-sm"
              [disabled]="loadingStep1 || loadingStep2"
              (click)="runFullProcess(true)"
              title="Xóa bộ nhớ đệm và quét lại toàn bộ dữ liệu cận date & tiêu thụ toàn quốc"
            >
              <i class="ti ti-refresh" [class.ti-spin]="loadingStep1 || loadingStep2"></i>
              <span class="fw-bold">{{ (loadingStep1 || loadingStep2) ? 'Đang quét toàn quốc...' : 'Quét lại toàn quốc' }}</span>
            </button>
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
        <div class="row row-deck row-cards mb-3" aria-label="Thống kê hạn dùng">
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
        <div class="card" [class.filters-collapsed]="filtersCollapsed">
          <button class="mobile-filter-toggle" type="button" (click)="filtersCollapsed = !filtersCollapsed">
            <span>{{ filtersCollapsed ? 'Hiện bộ lọc' : 'Ẩn bộ lọc' }}</span>
            <i class="ti" [class.ti-filter]="filtersCollapsed" [class.ti-filter-off]="!filtersCollapsed"></i>
          </button>

          <div class="table-responsive" style="max-height: 75vh; overflow-y: auto;">
            <table class="table table-vcenter card-table table-striped table-hover" style="table-layout: fixed; width: 100%;">
              <thead>
                <tr>
                  <th class="text-center" style="width: 70px; min-width: 70px;">STT</th>
                  <th style="width: 25%;">Tên SP</th>
                  <th style="width: 10%;">Mã SP</th>
                  <th style="width: 9%;">Hạn dùng</th>
                  <th style="width: 27%;">NT nguồn ➔ NT đích</th>
                  <th class="text-end" style="width: 9%;">Tồn Nguồn</th>
                  <th class="text-end" style="width: 11%;">Tổng SL Đề xuất</th>
                  <th class="text-center" style="width: 7%;">Số tuyến</th>
                </tr>

              </thead>
              <tbody>
                <tr *ngIf="cachedGroupedSuggestions.length === 0 && (loadingStep1 || loadingStep2)">
                  <td colspan="8" class="text-center text-secondary py-5">
                    <div class="spinner-border spinner-border-sm text-primary me-2" role="status"></div>
                    <span>Đang tổng hợp nhu cầu & gợi ý điều chuyển cho <strong>{{ uniqueProductCount || 'tất cả' }}</strong> sản phẩm... ({{ progressPercent }}%)</span>
                    <div class="progress progress-sm rounded-pill overflow-hidden mt-3 mx-auto" style="max-width: 400px; height: 6px;">
                      <div class="progress-bar bg-primary progress-bar-striped progress-bar-animated" [style.width.%]="progressPercent"></div>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="cachedGroupedSuggestions.length === 0 && !loadingStep1 && !loadingStep2">
                  <td colspan="8" class="text-center text-secondary py-4">
                    <div>Chưa có gợi ý điều chuyển nào phù hợp.</div>
                  </td>
                </tr>
                <tr *ngFor="let group of cachedGroupedSuggestions; let i = index; trackBy: trackByGroupKey" (click)="openDetailModal(group)" style="cursor: pointer;" title="Bấm vào dòng để xem chi tiết gợi ý điều chuyển">
                  <td data-label="STT" class="text-center font-monospace fw-bold" style="white-space: nowrap;">{{ i + 1 }}</td>
                  <td data-label="Tên SP" class="font-weight-medium text-break" style="font-size: 0.92rem; line-height: 1.35;">{{ group.productName }}</td>
                  <td data-label="Mã SP"><code>{{ group.productCode }}</code></td>
                  <td data-label="Hạn dùng">
                    <span [class]="getExpiryMonthTag(group.minDaysRemaining).class">
                      {{ getExpiryMonthTag(group.minDaysRemaining).label }}
                    </span>
                  </td>
                  <td data-label="NT nguồn ➔ NT đích">
                    <div class="d-flex flex-column gap-1">
                      <div *ngFor="let item of getTopRoutes(group, 5)" class="d-flex align-items-center gap-1 flex-wrap">
                        <span class="badge bg-secondary-lt font-monospace fs-5">{{ group.fromShopCode }}</span>
                        <span class="text-secondary small">➔</span>
                        <span class="badge font-monospace fs-5" [ngClass]="item.isSameProvince ? 'bg-success text-white' : 'bg-blue-lt text-blue'" [title]="item.toShopName">{{ item.toShopCode }}</span>
                        <span class="badge bg-green-lt text-green fs-6 py-0 px-1" *ngIf="item.isSameProvince">Nội tỉnh</span>
                        <span class="badge bg-primary-lt text-primary font-monospace fs-6 px-1">{{ formatNumber(item.suggestedQty) }} {{ item.unit }}</span>
                      </div>
                      <div *ngIf="group.items.length > 5">
                        <span class="badge bg-secondary-lt text-secondary fs-6">+{{ group.items.length - 5 }} tuyến khác</span>
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
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransferSuggestionsComponent implements OnInit {
  private cdr = inject(ChangeDetectorRef);

  /**
   * Tham số nghiệp vụ cho thuật toán gợi ý điều chuyển (tune theo thực tế vận hành).
   * - SOURCE_SAFETY_STOCK_RATIO: tỷ lệ tồn cận date GIỮ LẠI ở shop nguồn (không gợi ý
   *   chuyển quá (1 - ratio)). Tránh rút cạn nguồn về 0 khi việc chuyển hàng bị trễ/hủy.
   * - DEST_COVERAGE_PERIODS: số kỳ bán hàng mục tiêu khi tính nhu cầu của shop đích.
   */
  private readonly SOURCE_SAFETY_STOCK_RATIO = 0.2;
  private readonly DEST_COVERAGE_PERIODS = 1;
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

  private cachedBucketCounts: {
    all: number; allQty: number; allRate: string;
    danger: number; dangerQty: number; dangerRate: string;
    warning: number; warningQty: number; warningRate: string;
    safe: number; safeQty: number; safeRate: string;
  } | null = null;

  get expiryBucketCounts(): {
    all: number; allQty: number; allRate: string;
    danger: number; dangerQty: number; dangerRate: string;
    warning: number; warningQty: number; warningRate: string;
    safe: number; safeQty: number; safeRate: string;
  } {
    if (this.cachedBucketCounts) {
      return this.cachedBucketCounts;
    }
    this.recomputeBucketCounts();
    return this.cachedBucketCounts!;
  }

  private recomputeBucketCounts(): void {
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

    this.cachedBucketCounts = {
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
    private readonly firebaseCache: FirebaseInventoryService,
    private readonly excelExportService: ExcelExportService,
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

  async runFullProcess(forceRefresh = false): Promise<void> {
    const session = this.upharma.getSession();
    const uPharmaID = session?.UserInfo?.uPharmaID || 0;
    const cacheKey = `transfer|${uPharmaID}|${this.selectedShopCode}|${this.expiryDaysThreshold}`;

    if (forceRefresh) {
      await this.deleteCache(cacheKey);
      this.expiringStockList = [];
      this.nationalStoreStockMap = {};
      this.cachedSuggestionRows = [];
      this.cachedGroupedSuggestions = [];
      this.cachedBucketCounts = null;
      this.step1Done = false;
      this.step2Done = false;
      this.statusText = "Đang quét lại toàn bộ dữ liệu tồn kho & tiêu thụ toàn quốc...";
      this.cdr.markForCheck();
    } else {
      // 1. TẢI TỨC THÌ TỪ INDEXEDDB CỦA TRÌNH DUYỆT (0ms)
      const cached = await this.readCache(cacheKey);
      if (
        cached &&
        Date.now() - cached.savedAt < 30 * 60 * 1000 &&
        ((cached.groupedSuggestions && cached.groupedSuggestions.length > 0) ||
          (cached.expiringStockList && cached.expiringStockList.length > 0))
      ) {
        this.cachedGroupedSuggestions = cached.groupedSuggestions || [];
        this.cachedSuggestionRows = cached.suggestions || [];
        this.cachedBucketCounts = cached.bucketCounts || null;
        this.expiringStockList = cached.expiringStockList || [];
        this.nationalStoreStockMap = cached.nationalStoreStockMap || {};
        this.step1Done = true;
        this.step2Done = true;
        this.activeTab = "suggestions";

        if (this.cachedGroupedSuggestions.length === 0 && this.cachedSuggestionRows.length === 0) {
          this.recomputeSuggestionRows();
        }
        this.updateDisplayGroups();

        this.statusText = `⚡ Hiển thị tức thì từ bộ nhớ máy lúc ${this.formatCacheTime(cached.savedAt)} (0ms).`;
        this.cdr.markForCheck();
        return;
      }

      // 2. NẠP DỮ LIỆU TÍNH SẴN TỪ FIREBASE SERVER (1 request siêu nhẹ ~30KB, mất 30ms)
      try {
        let serverCache: any = null;

        if (this.selectedShopCode === "ALL") {
          // Thử nạp trực tiếp cache ALL tính sẵn
          serverCache = await this.firebaseCache.getShopTransferSuggestions("ALL");

          // Nếu ALL chưa có hoặc rỗng, thử gộp từ các nhà thuốc thành viên
          if (!serverCache || (!serverCache.groupedSuggestions?.length && !serverCache.expiringStockList?.length)) {
            const targetShops = this.userShops.map((s) => s.ShopCode);
            const serverCaches = await Promise.all(
              targetShops.map((sCode) => this.firebaseCache.getShopTransferSuggestions(sCode))
            );
            const valid = serverCaches.filter(
              (c) =>
                c &&
                ((c.groupedSuggestions && c.groupedSuggestions.length > 0) ||
                  (c.expiringStockList && c.expiringStockList.length > 0))
            );

            if (valid.length > 0) {
              const combinedGroups: GroupedSuggestion[] = [];
              const combinedSuggestions: ExpiringTransferSuggestion[] = [];
              const combinedExpiring: ExpiringStockItem[] = [];
              const combinedMap: Record<string, NationalStoreStock[]> = {};

              for (const c of valid) {
                if (Array.isArray(c.groupedSuggestions)) combinedGroups.push(...c.groupedSuggestions);
                if (Array.isArray(c.suggestions)) combinedSuggestions.push(...c.suggestions);
                if (Array.isArray(c.expiringStockList)) combinedExpiring.push(...c.expiringStockList);
                if (c.nationalStoreStockMap) Object.assign(combinedMap, c.nationalStoreStockMap);
              }

              serverCache = {
                groupedSuggestions: combinedGroups,
                suggestions: combinedSuggestions,
                expiringStockList: combinedExpiring,
                nationalStoreStockMap: combinedMap,
                updatedAt: valid[0].updatedAt || Date.now(),
              };
            }
          }
        } else {
          serverCache = await this.firebaseCache.getShopTransferSuggestions(this.selectedShopCode);
        }

        if (
          serverCache &&
          ((serverCache.groupedSuggestions && serverCache.groupedSuggestions.length > 0) ||
            (serverCache.expiringStockList && serverCache.expiringStockList.length > 0))
        ) {
          this.cachedGroupedSuggestions = serverCache.groupedSuggestions || [];
          this.cachedSuggestionRows = serverCache.suggestions || [];
          this.cachedBucketCounts = serverCache.bucketCounts || null;
          this.expiringStockList = serverCache.expiringStockList || [];
          this.nationalStoreStockMap = serverCache.nationalStoreStockMap || {};
          this.step1Done = true;
          this.step2Done = true;
          this.activeTab = "suggestions";

          if (this.cachedGroupedSuggestions.length === 0 && this.cachedSuggestionRows.length === 0) {
            this.recomputeSuggestionRows();
          }
          this.updateDisplayGroups();

          // Lưu ngay vào IndexedDB để lần sau tải trong 0ms
          await this.writeCache({
            cacheKey,
            groupedSuggestions: this.cachedGroupedSuggestions,
            suggestions: this.cachedSuggestionRows,
            bucketCounts: this.cachedBucketCounts,
            expiringStockList: this.expiringStockList,
            nationalStoreStockMap: this.nationalStoreStockMap,
            savedAt: serverCache.updatedAt || Date.now(),
          });

          const labelText = this.selectedShopCode === "ALL" ? "Tất cả nhà thuốc" : `NT ${this.selectedShopCode}`;
          this.statusText = `⚡ Đã nạp xong gợi ý toàn quốc từ Firebase Server cho ${labelText} (30ms).`;
          this.cdr.markForCheck();
          return;
        }
      } catch (err) {
        console.warn("Không nạp được cache Firebase, fallback về tính toán cục bộ:", err);
      }
    }

    // 3. FALLBACK: NẾU CHƯA CÓ CACHE HOẶC BẤM QUÉT LẠI
    await this.runStep1(forceRefresh);
    if (this.step1Done && this.expiringStockList.length > 0) {
      await this.runStep2(forceRefresh);
      await this.writeCache({
        cacheKey,
        groupedSuggestions: this.cachedGroupedSuggestions,
        suggestions: this.cachedSuggestionRows,
        bucketCounts: this.cachedBucketCounts,
        expiringStockList: this.expiringStockList,
        nationalStoreStockMap: this.nationalStoreStockMap,
        savedAt: Date.now(),
      });
      // Lưu lại lên Firebase RTDB để các lần sau hoặc thiết bị khác tải ngay 30ms
      void this.firebaseCache.saveShopTransferSuggestions(this.selectedShopCode, {
        groupedSuggestions: this.cachedGroupedSuggestions,
        suggestions: this.cachedSuggestionRows,
        bucketCounts: this.cachedBucketCounts,
        expiringStockList: this.expiringStockList,
        nationalStoreStockMap: this.nationalStoreStockMap,
      });
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
    this.step2Done = true;
    this.activeTab = "suggestions";
    this.statusText = `Đang tổng hợp dữ liệu tồn kho & sức bán cho ${uniqueProductCodes.length} sản phẩm từ Firebase Cache...`;
    this.errorText = "";
    this.progressPercent = 0;
    this.progressDone = 0;
    this.progressCurrentProduct = "";

    const session = this.upharma.getSession();
    const uPharmaID = session?.UserInfo?.uPharmaID || 0;
    const cacheKey = `transfer|${uPharmaID}|${this.selectedShopCode}|${this.expiryDaysThreshold}`;

    try {
      let resolvedCount = 0;

      const responseMap = await this.nationalInventoryService.resolve(uniqueProductCodes, {
        mode: this.selectedApiMode,
        forceRefresh: forceRefresh,
        onProgress: (p) => {
          this.progressPercent = Math.round((p.done / p.total) * 100);
          this.progressDone = p.done;
          this.progressCurrentProduct = p.currentProduct;
          this.statusText = `Đang tải dữ liệu nhu cầu (Lazy Load): ${p.done}/${p.total} sản phẩm...`;
          this.cdr.markForCheck();
        },
        onItemResolved: (productCode, stores) => {
          this.nationalStoreStockMap[productCode] = stores;
          resolvedCount++;

          // Tối ưu CPU: Chỉ recompute lại bảng sau mỗi 50 mã thay vì 1.781 lần liên tục gây đơ trình duyệt
          if (resolvedCount % 50 === 0) {
            this.recomputeSuggestionRows();
            this.updateDisplayGroups();
            this.cdr.markForCheck();
          }

          if (resolvedCount % 100 === 0 || resolvedCount === uniqueProductCodes.length) {
            void this.writeCache({
              cacheKey,
              expiringStockList: this.expiringStockList,
              nationalStoreStockMap: this.nationalStoreStockMap,
              savedAt: Date.now(),
            });
          }
        },
      });

      this.nationalStoreStockMap = responseMap;
      this.recomputeSuggestionRows();
      this.updateDisplayGroups();

      await this.writeCache({
        cacheKey,
        expiringStockList: this.expiringStockList,
        nationalStoreStockMap: this.nationalStoreStockMap,
        savedAt: Date.now(),
      });

      this.statusText = `Hoàn tất phân tích cho ${uniqueProductCodes.length} sản phẩm. Đã hiển thị ${this.cachedGroupedSuggestions.length} gợi ý luân chuyển tối ưu.`;
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

  getTopRoutes(group: GroupedSuggestion, max = 5): ExpiringTransferSuggestion[] {
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
  // BƯỚC 3: THUẬT TOÁN GỢI Ý ĐIỀU CHUYỂN (BẮT BUỘC 5 NHÀ THUỐC ĐÍCH, ƯU TIÊN NỘI TỈNH)
  // ==========================================
  cachedSuggestionRows: ExpiringTransferSuggestion[] = [];
  cachedTotalSuggestedCount = 0;
  cachedSameProvinceCount = 0;
  cachedUniqueFromShops: string[] = [];
  cachedUniqueToShops: string[] = [];

  recomputeSuggestionRows(): void {
    if (!this.step2Done) {
      this.cachedSuggestionRows = [];
      this.cachedTotalSuggestedCount = 0;
      this.cachedSameProvinceCount = 0;
      this.cachedUniqueFromShops = [];
      this.cachedUniqueToShops = [];
      return;
    }

    const suggestions: ExpiringTransferSuggestion[] = [];

    for (const item of this.expiringStockList) {
      if (!item.productCode || item.quantity < 1) continue;

      const destList = this.nationalStoreStockMap[item.productCode];
      if (!destList || !Array.isArray(destList) || destList.length === 0) continue;

      // Loại bỏ chính shop nguồn và các kho
      const candidates = destList.filter(
        (d: any) => d.StoreCode !== item.shopCode && !isWarehouseStore(d)
      );
      if (candidates.length === 0) continue;

      const sourceProvince = this.getProvince(item.shopName);

      // Phân 4 cấp ưu tiên để luôn chọn đủ 5 nhà thuốc:
      // 1. Nội tỉnh có sức bán tốt (QuantityAVG > 0)
      const sameProvSales = candidates
        .filter((d: any) => this.getProvince(d.StoreName) === sourceProvince && parseNumericValue(d.QuantityAVG) > 0)
        .sort((a: any, b: any) => parseNumericValue(b.QuantityAVG) - parseNumericValue(a.QuantityAVG));

      // 2. Nội tỉnh khác (QuantityAVG <= 0, ưu tiên giữ hàng trong tỉnh)
      const sameProvOther = candidates
        .filter((d: any) => this.getProvince(d.StoreName) === sourceProvince && parseNumericValue(d.QuantityAVG) <= 0)
        .sort((a: any, b: any) => parseNumericValue(b.Quantity) - parseNumericValue(a.Quantity));

      // 3. Ngoại tỉnh có sức bán tốt (QuantityAVG > 0)
      const otherProvSales = candidates
        .filter((d: any) => this.getProvince(d.StoreName) !== sourceProvince && parseNumericValue(d.QuantityAVG) > 0)
        .sort((a: any, b: any) => parseNumericValue(b.QuantityAVG) - parseNumericValue(a.QuantityAVG));

      // 4. Ngoại tỉnh khác (QuantityAVG <= 0, dự phòng lấp đầy đủ 5 shop)
      const otherProvOther = candidates
        .filter((d: any) => this.getProvince(d.StoreName) !== sourceProvince && parseNumericValue(d.QuantityAVG) <= 0)
        .sort((a: any, b: any) => parseNumericValue(b.Quantity) - parseNumericValue(a.Quantity));

      // Ghép theo thứ tự ưu tiên và lấy đúng 5 nhà thuốc
      const orderedDests = [...sameProvSales, ...sameProvOther, ...otherProvSales, ...otherProvOther].slice(0, 5);

      // FIX (2026-10-15): công thức cũ `min(tồn nguồn, round(avg đích))` có 3 lỗi:
      //  1. Rút cạn shop nguồn về 0 (không trừ tồn an toàn).
      //  2. 5 tuyến mỗi tuyến đòi tới min(toàn bộ tồn nguồn) → cộng dồn vượt tồn thực.
      //  3. Không trừ tồn hiện tại của đích → dồn ứ hàng ở đích.
      // Cách sửa: giữ tồn an toàn ở nguồn, chia tuần tự theo thứ tự ưu tiên
      // (tuyến sau chỉ nhận phần còn lại → tổng 5 tuyến không vượt tồn nguồn),
      // và trừ tồn hiện tại của đích khỏi nhu cầu.
      const totalSourceQty = Math.floor(item.quantity);
      const safetyStock = Math.floor(totalSourceQty * this.SOURCE_SAFETY_STOCK_RATIO);
      let remainingQty = Math.max(0, totalSourceQty - safetyStock);

      orderedDests.forEach((bestDest: any, index: number) => {
        if (remainingQty < 1) return; // nguồn đã chia hết cho tuyến ưu tiên cao hơn
        const destProvince = this.getProvince(bestDest.StoreName);
        const isSame = sourceProvince === destProvince;
        const avg = parseNumericValue(bestDest.QuantityAVG);
        const destQty = parseNumericValue(bestDest.Quantity);

        const wantQty = avg > 0 ? Math.max(1, Math.round(avg * this.DEST_COVERAGE_PERIODS)) : 2;
        // Không dồn ứ: đích đã đủ/không thiếu hàng thì bỏ qua tuyến này
        const needQty = Math.max(0, wantQty - destQty);
        const qty = Math.min(needQty, remainingQty);
        if (qty < 1) return;
        remainingQty -= qty;

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
          destAvgSales: avg,
          suggestedQty: qty,
          isSameProvince: isSame,
          rank: index + 1,
        });
      });
    }

    this.cachedSuggestionRows = suggestions;
    this.cachedTotalSuggestedCount = suggestions.length;
    this.cachedSameProvinceCount = suggestions.filter((r) => r.isSameProvince).length;

    const fromSet = new Set(suggestions.map((r) => r.fromShopCode));
    this.cachedUniqueFromShops = Array.from(fromSet).sort();

    const toSet = new Set(suggestions.map((r) => r.toShopCode));
    this.cachedUniqueToShops = Array.from(toSet).sort();
    this.cachedBucketCounts = null;
  }

  get suggestionRows(): ExpiringTransferSuggestion[] {
    if (this.cachedSuggestionRows.length === 0 && this.step2Done) {
      this.recomputeSuggestionRows();
    }
    return this.cachedSuggestionRows;
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
    return this.cachedTotalSuggestedCount;
  }

  get sameProvinceCount(): number {
    return this.cachedSameProvinceCount;
  }

  get uniqueFromShops(): string[] {
    return this.cachedUniqueFromShops;
  }

  get uniqueToShops(): string[] {
    return this.cachedUniqueToShops;
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

    await this.excelExportService.exportJsonToExcel(sheetRows, "goi-y-dieu-chuyen-ton-kho-can-date.xlsx", "Goi y chuyen hang can date");
  }

  async exportAuditExcel(): Promise<void> {
    const rows = this.filteredExpiringStock;
    if (rows.length === 0) return;

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

    await this.excelExportService.exportJsonToExcel(sheetRows, "audit-ton-kho-can-date.xlsx", "Audit ton kho can date");
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

  private async readCache(cacheKey: string): Promise<TransferCacheEntry | null> {
    try {
      const db = await this.openCacheDb();
      const entry = await new Promise<TransferCacheEntry | undefined>((resolve, reject) => {
        const transaction = db.transaction("transferCache", "readonly");
        const request = transaction.objectStore("transferCache").get(cacheKey);
        request.onsuccess = () => resolve(request.result as TransferCacheEntry | undefined);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return entry || null;
    } catch {
      return null;
    }
  }

  private async writeCache(entry: TransferCacheEntry): Promise<void> {
    try {
      const db = await this.openCacheDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("transferCache", "readwrite");
        const request = transaction.objectStore("transferCache").put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch (err) {
      console.warn("Không lưu được cache luân chuyển:", err);
    }
  }

  private async deleteCache(cacheKey: string): Promise<void> {
    try {
      const db = await this.openCacheDb();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("transferCache", "readwrite");
        const request = transaction.objectStore("transferCache").delete(cacheKey);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      db.close();
    } catch {
      // ignore
    }
  }

  private openCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("upharma-transfer-cache", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("transferCache")) {
          db.createObjectStore("transferCache", { keyPath: "cacheKey" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private formatCacheTime(value: number): string {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}-${pad(date.getMonth() + 1)}`;
  }
}
