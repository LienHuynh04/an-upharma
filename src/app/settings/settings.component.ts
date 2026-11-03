import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { environment } from "../../environments/environment";
import { ShopInfo, UpharmaService } from "../upharma.service";
import {
  ShopVisibilityConfig,
  ShopVisibilityService,
  normalizeHiddenShopCodes,
} from "../shop-visibility.service";

/**
 * Trang Cài đặt → Ẩn/Hiện nhà thuốc.
 *
 * User chọn shop nào cần hiện, shop nào cần ẩn; cấu hình lưu vào Firebase
 * RTDB `settings/shop_visibility` và áp dụng cho CẢ HAI phía:
 * - App: UpharmaService.getActiveShops() lọc theo cấu hình này (mọi trang).
 * - Cronjob đồng bộ (scripts/fetch-upharma-data.js): chỉ gọi API lấy dữ liệu
 *   cho các shop đang hiện, từ lần chạy kế tiếp.
 *
 * Shop bị loại cứng trong code (environment.excludedShopCodes, vd kho tổng)
 * hiển thị ở đây để user hiểu vì sao không thấy, nhưng không bật lại được
 * từ trang này.
 */
@Component({
  selector: "app-settings",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
  <div class="page-header d-print-none">
    <div class="container-xl">
      <div class="row g-2 align-items-center">
        <div class="col">
          <div class="page-pretitle">HỆ THỐNG</div>
          <h2 class="page-title">Cài đặt</h2>
        </div>
      </div>
    </div>
  </div>

  <div class="page-body">
    <div class="container-xl">
      <div class="card mb-3">
        <div class="card-header">
          <h3 class="card-title"><i class="ti ti-building-store me-2"></i>Ẩn / Hiện nhà thuốc</h3>
          <div class="card-actions">
            <span class="badge bg-primary-lt">Đang hiện {{ visibleCount }} / {{ toggleableShops.length }} nhà thuốc</span>
          </div>
        </div>
        <div class="card-body">
          <div class="alert alert-info" role="alert">
            <h4 class="alert-title">Cấu hình này áp dụng cho cả app và cronjob đồng bộ</h4>
            <div class="text-secondary">
              <div>• <strong>Trong app:</strong> shop đã ẩn sẽ không còn xuất hiện ở Dashboard, Tồn kho, FEFO, Báo cáo và mọi trang khác.</div>
              <div>• <strong>Cronjob đồng bộ (mỗi giờ):</strong> chỉ gọi API lấy dữ liệu cho các shop đang hiện — ẩn shop không cần thiết giúp lần đồng bộ chạy nhanh hơn và đỡ tải API.</div>
              <div>• Dữ liệu cũ của shop đã ẩn trên Firebase <strong>vẫn được giữ nguyên</strong>; bật hiện lại là lần đồng bộ kế tiếp lấy dữ liệu tiếp như bình thường.</div>
              <div>• Shop mới trong tài khoản sẽ <strong>tự động hiện</strong> (chỉ các shop bạn tắt ở đây mới bị ẩn).</div>
            </div>
          </div>

          <div *ngIf="loading" class="d-flex align-items-center gap-2 text-secondary">
            <span class="spinner-border spinner-border-sm" role="status"></span>
            <span>Đang tải cấu hình từ Firebase...</span>
          </div>

          <div *ngIf="errorText" class="alert alert-danger" role="alert">{{ errorText }}</div>
          <div *ngIf="successText" class="alert alert-success" role="alert">
            <div>{{ successText }}</div>
            <button type="button" class="btn btn-sm btn-success mt-2" (click)="reloadPage()">
              <i class="ti ti-refresh me-1"></i>Tải lại trang để áp dụng ngay trong app
            </button>
          </div>

          <div class="row g-2 align-items-center mb-3" *ngIf="!loading">
            <div class="col-md-6">
              <div class="input-group">
                <span class="input-group-text"><i class="ti ti-search"></i></span>
                <input type="text" class="form-control" placeholder="Tìm theo mã, tên hoặc địa chỉ nhà thuốc..."
                  [(ngModel)]="searchText" name="searchText">
              </div>
            </div>
            <div class="col-md-6 text-md-end">
              <div class="btn-list justify-content-md-end">
                <button type="button" class="btn btn-outline-primary" (click)="setAllVisible(true)">
                  <i class="ti ti-eye me-1"></i>Hiện tất cả
                </button>
                <button type="button" class="btn btn-outline-secondary" (click)="setAllVisible(false)">
                  <i class="ti ti-eye-off me-1"></i>Ẩn tất cả
                </button>
              </div>
            </div>
          </div>

          <div class="table-responsive" *ngIf="!loading">
            <table class="table table-vcenter card-table table-hover">
              <thead>
                <tr>
                  <th style="width: 130px;">Mã nhà thuốc</th>
                  <th>Tên / Địa chỉ</th>
                  <th style="width: 170px;">Trạng thái</th>
                  <th style="width: 120px;" class="text-end">Hiển thị</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let shop of filteredShops; trackBy: trackByShopCode">
                  <td><code>{{ shop.ShopCode }}</code></td>
                  <td>
                    <div class="fw-semibold">{{ shop.ShopName }}</div>
                    <div class="text-secondary small" *ngIf="shop.ShopAddress">{{ shop.ShopAddress }}</div>
                  </td>
                  <td>
                    <span *ngIf="isHardExcluded(shop.ShopCode)" class="badge bg-dark-lt" title="Shop này bị loại cứng trong cấu hình hệ thống (environment.excludedShopCodes), không bật lại được tại đây">
                      <i class="ti ti-lock me-1"></i>Loại cứng (hệ thống)
                    </span>
                    <span *ngIf="!isHardExcluded(shop.ShopCode) && isVisible(shop.ShopCode)" class="badge bg-success-lt">
                      <i class="ti ti-eye me-1"></i>Đang hiện
                    </span>
                    <span *ngIf="!isHardExcluded(shop.ShopCode) && !isVisible(shop.ShopCode)" class="badge bg-danger-lt">
                      <i class="ti ti-eye-off me-1"></i>Đang ẩn
                    </span>
                  </td>
                  <td class="text-end">
                    <label class="form-check form-switch m-0 d-inline-block">
                      <input class="form-check-input" type="checkbox"
                        [checked]="isVisible(shop.ShopCode)"
                        [disabled]="isHardExcluded(shop.ShopCode)"
                        (change)="toggleShop(shop.ShopCode, $event)">
                    </label>
                  </td>
                </tr>
                <tr *ngIf="filteredShops.length === 0">
                  <td colspan="4" class="text-center text-secondary py-4">Không tìm thấy nhà thuốc nào khớp ô tìm kiếm.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div *ngIf="visibleCount === 0 && !loading" class="alert alert-warning mt-3" role="alert">
            <i class="ti ti-alert-triangle me-1"></i>
            Phải có <strong>ít nhất 1 nhà thuốc đang hiện</strong> mới lưu được — app và cronjob đều cần ít nhất 1 shop để hoạt động.
          </div>
        </div>
        <div class="card-footer d-flex flex-wrap align-items-center gap-2">
          <div class="text-secondary small me-auto">
            <span *ngIf="savedConfig?.updatedAt">
              Lần lưu gần nhất: {{ savedConfig?.updatedAt | date:'HH:mm:ss dd/MM/yyyy' }}
              <span *ngIf="savedConfig?.updatedBy">(user {{ savedConfig?.updatedBy }})</span>
            </span>
            <span *ngIf="!savedConfig?.updatedAt">Chưa từng lưu cấu hình — mặc định hiện tất cả nhà thuốc.</span>
            <span *ngIf="dirty" class="text-warning fw-semibold ms-2">• Có thay đổi chưa lưu</span>
          </div>
          <button type="button" class="btn btn-primary" (click)="save()" [disabled]="saving || loading || !dirty || visibleCount === 0">
            <span *ngIf="saving" class="spinner-border spinner-border-sm me-1" role="status"></span>
            <i *ngIf="!saving" class="ti ti-cloud-upload me-1"></i>
            {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
          </button>
        </div>
      </div>

      <p class="text-secondary small">
        <i class="ti ti-info-circle me-1"></i>
        Sau khi lưu: app áp dụng từ lần tải trang tiếp theo (hoặc bấm "Tải lại trang" ở thông báo thành công);
        cronjob áp dụng từ lần đồng bộ kế tiếp (chạy mỗi giờ). Nếu Firebase gặp sự cố không đọc được cấu hình,
        cả app và cronjob đều tự hiểu là "hiện tất cả" để không gián đoạn công việc.
      </p>
    </div>
  </div>
  `,
})
export class SettingsComponent implements OnInit {
  private cdr = inject(ChangeDetectorRef);
  private upharmaService = inject(UpharmaService);
  private shopVisibility = inject(ShopVisibilityService);

  private readonly hardExcluded = new Set<string>(environment.excludedShopCodes || []);

  shops: ShopInfo[] = [];
  hiddenShopCodes = new Set<string>();
  savedConfig: ShopVisibilityConfig | null = null;

  loading = true;
  saving = false;
  dirty = false;
  searchText = "";
  errorText = "";
  successText = "";

  async ngOnInit(): Promise<void> {
    this.shops = this.upharmaService.getAllSessionShops();
    try {
      const fresh = await this.shopVisibility.refreshFromFirebase();
      const config = fresh ?? {
        hiddenShopCodes: this.shopVisibility.getHiddenShopCodesSync(),
      };
      this.savedConfig = fresh;
      this.hiddenShopCodes = new Set(normalizeHiddenShopCodes(config.hiddenShopCodes));
    } catch (error) {
      this.errorText = "Không tải được cấu hình ẩn/hiện nhà thuốc: " + (error instanceof Error ? error.message : String(error));
      this.hiddenShopCodes = new Set(this.shopVisibility.getHiddenShopCodesSync());
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  get toggleableShops(): ShopInfo[] {
    return this.shops.filter((shop) => !this.hardExcluded.has(shop.ShopCode));
  }

  get filteredShops(): ShopInfo[] {
    const keyword = this.searchText.trim().toLowerCase();
    if (!keyword) return this.shops;
    return this.shops.filter((shop) =>
      [shop.ShopCode, shop.ShopName, shop.ShopAddress || ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }

  get visibleCount(): number {
    return this.toggleableShops.filter((shop) => !this.hiddenShopCodes.has(shop.ShopCode)).length;
  }

  isHardExcluded(shopCode: string): boolean {
    return this.hardExcluded.has(shopCode);
  }

  isVisible(shopCode: string): boolean {
    if (this.hardExcluded.has(shopCode)) return false;
    return !this.hiddenShopCodes.has(shopCode);
  }

  toggleShop(shopCode: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.hiddenShopCodes.delete(shopCode);
    } else {
      this.hiddenShopCodes.add(shopCode);
    }
    this.dirty = true;
    this.successText = "";
    this.cdr.markForCheck();
  }

  setAllVisible(visible: boolean): void {
    if (visible) {
      this.hiddenShopCodes.clear();
    } else {
      for (const shop of this.toggleableShops) {
        this.hiddenShopCodes.add(shop.ShopCode);
      }
    }
    this.dirty = true;
    this.successText = "";
    this.cdr.markForCheck();
  }

  async save(): Promise<void> {
    if (this.saving || this.visibleCount === 0) return;
    this.saving = true;
    this.errorText = "";
    this.successText = "";
    try {
      const session = this.upharmaService.getSession();
      const updatedBy = session?.UserInfo?.uPharmaID ? String(session.UserInfo.uPharmaID) : "unknown";
      const config = await this.shopVisibility.saveToFirebase([...this.hiddenShopCodes], updatedBy);
      this.savedConfig = config;
      this.hiddenShopCodes = new Set(config.hiddenShopCodes);
      this.dirty = false;
      this.successText =
        `Đã lưu cấu hình lên Firebase: đang hiện ${this.visibleCount} nhà thuốc, ẩn ${config.hiddenShopCodes.length} nhà thuốc. ` +
        "Cronjob sẽ chỉ lấy dữ liệu cho các shop đang hiện từ lần đồng bộ kế tiếp.";
    } catch (error) {
      this.errorText = "Lỗi khi lưu cấu hình: " + (error instanceof Error ? error.message : String(error));
    } finally {
      this.saving = false;
      this.cdr.markForCheck();
    }
  }

  reloadPage(): void {
    window.location.reload();
  }

  trackByShopCode(_: number, shop: ShopInfo): string {
    return shop.ShopCode;
  }
}
