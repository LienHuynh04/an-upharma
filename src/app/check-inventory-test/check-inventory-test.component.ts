import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

@Component({
  selector: "app-check-inventory-test",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-inner">
      <section class="api-test-header">
        <div>
          <span>POST</span>
          <h1>/WEB/CheckInventory</h1>
          <p>Trang thử nghiệm gọi API kiểm tra tồn kho hàng loạt theo danh sách mã sản phẩm và cửa hàng.</p>
        </div>
        <button type="button" (click)="loginOnly()" [disabled]="loading">Lấy lại phiên</button>
      </section>

      <section class="api-test-grid">
        <form class="api-test-panel" (ngSubmit)="callCheckInventory()">
          <h2>Tham số Payload</h2>

          <div class="api-test-shop-picker">
            <div class="api-test-shop-heading">
              <span>ShopCode (Cửa hàng)</span>
            </div>
            <label class="api-test-check" *ngFor="let shop of shops">
              <input
                type="radio"
                name="selectedShopCode"
                [checked]="shopCode === shop.ShopCode"
                (change)="selectShop(shop.ShopCode)"
              />
              <span>{{ shop.ShopCode }} - {{ shop.ShopName }}</span>
            </label>
            <input [(ngModel)]="shopCode" name="shopCode" (ngModelChange)="updateRequestPreview()" />
          </div>

          <label>
            City (Tỉnh/Thành phố)
            <input [(ngModel)]="city" name="city" placeholder="Ví dụ: Hà Nội" (ngModelChange)="updateRequestPreview()" />
          </label>

          <label>
            Ward (Quận/Huyện)
            <input [(ngModel)]="ward" name="ward" placeholder="Ví dụ: Hai Bà Trưng" (ngModelChange)="updateRequestPreview()" />
          </label>

          <label>
            Mã sản phẩm (Nhập cách nhau bằng dấu phẩy)
            <textarea
              [(ngModel)]="productIdsText"
              name="productIdsText"
              rows="4"
              placeholder="Ví dụ: KH02725, KH02726, KH02727"
              (ngModelChange)="updateRequestPreview()"
              style="width: 100%; border: 1px solid #ccd9e8; border-radius: 6px; padding: 8px; font-family: inherit; font-size: 13px;"
            ></textarea>
          </label>

          <button class="api-test-submit" type="submit" [disabled]="loading || !shopCode">
            {{ loading ? "Đang gọi..." : "Gọi API CheckInventory" }}
          </button>
        </form>

        <section class="api-test-panel">
          <h2>Request gửi đi</h2>
          <h3>WEB/CheckInventory</h3>
          <pre>{{ requestPayload }}</pre>
        </section>
      </section>

      <section class="api-test-panel response-panel">
        <h2>Response</h2>
        <p class="api-test-error" *ngIf="errorText">{{ errorText }}</p>
        <h3 *ngIf="responseText">WEB/CheckInventory</h3>
        <pre *ngIf="responseText">{{ responseText }}</pre>
        <p *ngIf="!responseText && !errorText">Chưa có response. Bấm gọi API để kiểm tra.</p>
      </section>
    </div>

    <div class="loading-overlay" [class.is-visible]="loading" aria-live="polite">
      <div class="loading-box">
        <span class="loader" aria-hidden="true"></span>
        <strong>{{ loading ? "Đang gọi API CheckInventory..." : "" }}</strong>
        <div class="loading-progress" aria-hidden="true">
          <i [style.width.%]="loadingProgress"></i>
        </div>
        <span class="loading-progress-percent">{{ loadingProgress }}%</span>
      </div>
    </div>
  `
})
export class CheckInventoryTestComponent implements OnInit {
  shops: ShopInfo[] = [];
  shopCode = "";
  city = "";
  ward = "";
  productIdsText = "KH02725";
  requestPayload = "";
  responseText = "";
  errorText = "";
  loading = false;
  loadingProgress = 0;

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loginOnly();
  }

  async loginOnly(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 15;
    this.errorText = "";

    try {
      const session = await this.upharmaService.ensureLogin();
      this.loadingProgress = 70;
      this.shops = this.upharmaService.getActiveShops();
      if (this.shops.length > 0) {
        this.shopCode = this.shops[0].ShopCode;
      }
      this.updateRequestPreview();
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }

  selectShop(code: string): void {
    this.shopCode = code;
    this.updateRequestPreview();
  }

  updateRequestPreview(): void {
    const session = this.upharmaService.getSession();
    if (!session) return;

    try {
      const payload = this.buildPayload(session.Token);
      this.requestPayload = JSON.stringify(payload, null, 2);
      this.errorText = "";
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
    }
  }

  private buildPayload(token: string): RawRecord {
    const pids = this.productIdsText
      .split(",")
      .map(p => p.trim())
      .filter(Boolean)
      .map(id => ({ ProductID: id }));

    return {
      Token: token,
      ShopCode: this.shopCode,
      City: this.city,
      Ward: this.ward,
      ProductIDLst: pids
    };
  }

  async callCheckInventory(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 20;
    this.errorText = "";
    this.responseText = "";

    try {
      const session = await this.upharmaService.ensureLogin();
      const payload = this.buildPayload(session.Token);

      this.requestPayload = JSON.stringify(payload, null, 2);
      this.loadingProgress = 50;

      const response = await this.upharmaService.callEndpoint<unknown>("/WEB/CheckInventory", payload, { cache: false });
      this.loadingProgress = 90;
      this.responseText = JSON.stringify(response, null, 2);
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }
}
