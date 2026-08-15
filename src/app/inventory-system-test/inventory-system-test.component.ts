import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

@Component({
  selector: "app-inventory-system-test",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-inner">

      <section class="api-test-header">
        <div>
          <span class="method-badge">POST</span>
          <h1>Test tồn kho LocalStore</h1>
          <p>So sánh và test 2 API tồn kho — chọn API phù hợp với loại kho bạn muốn kiểm tra.</p>
        </div>
        <button type="button" (click)="loginOnly()" [disabled]="loading">↺ Lấy lại phiên</button>
      </section>

      <!-- API selector -->
      <div class="api-selector">
        <button type="button"
          [class.active]="selectedApi === 'GetInventoryShop'"
          (click)="selectedApi = 'GetInventoryShop'; updatePreview()">
          🏪 GetInventoryShop
          <small>Nhà thuốc bán lẻ</small>
        </button>
        <button type="button"
          [class.active]="selectedApi === 'GetInventorySystem'"
          (click)="selectedApi = 'GetInventorySystem'; updatePreview()">
          🏭 GetInventorySystem
          <small>Kho tổng / Trung tâm</small>
        </button>
      </div>

      <!-- Explanation box -->
      <div class="explain-box" *ngIf="selectedApi === 'GetInventoryShop'">
        <strong>🏪 GetInventoryShop</strong> — Lấy tồn kho của <b>nhà thuốc bán lẻ</b> (DN, HN, HCM...).
        Để <code>ShopCode</code> trống → trả về tất cả shop của bạn trong 1 lần.
        Đây là API phù hợp cho Bước 3 điều chuyển.
      </div>
      <div class="explain-box explain-box--center" *ngIf="selectedApi === 'GetInventorySystem'">
        <strong>🏭 GetInventorySystem</strong> — Lấy tồn kho của <b>kho tổng / trung tâm phân phối</b>.<br/>
        Trong ảnh Fiddler của bạn, <code>GetExistProductLst</code> trả về <code>StoreType = "Kho tổng"</code>, <code>StoreCode = "DN"</code>.<br/>
        → Nhập <code>ShopCode = "DN"</code> (hoặc mã kho tổng khác) để lấy tồn kho kho đó.
        Để trống ShopCode = lấy tất cả kho tổng bạn có quyền.
      </div>

      <div class="user-info-bar" *ngIf="userTitle">
        <span>🔑 {{ userTitle }}</span>
      </div>

      <section class="api-test-grid">

        <form class="api-test-panel" (ngSubmit)="callApi()">
          <h2>Tham số — <code>{{ selectedApi }}</code></h2>

          <div class="api-test-shop-picker">
            <div class="api-test-shop-heading">
              <span>ShopCode</span>
              <small *ngIf="selectedApi === 'GetInventoryShop'">Để trống = tất cả nhà thuốc</small>
              <small *ngIf="selectedApi === 'GetInventorySystem'">Nhập mã kho tổng (VD: DN) hoặc để trống</small>
            </div>
            <label class="api-test-check api-test-check--empty">
              <input type="radio" name="shopCode" [checked]="shopCode === ''" (change)="shopCode = ''; updatePreview()" />
              <span>⬜ Để trống</span>
            </label>
            <label class="api-test-check" *ngFor="let shop of shops">
              <input type="radio" name="shopCode"
                [checked]="shopCode === shop.ShopCode"
                (change)="shopCode = shop.ShopCode; updatePreview()" />
              <span>{{ shop.ShopCode }} – {{ shop.ShopName }}</span>
            </label>
            <div *ngIf="selectedApi === 'GetInventorySystem'" class="center-hint">
              💡 Kho tổng thường có StoreType = "Kho tổng" trong kết quả <code>GetExistProductLst</code>.
              Nhập mã đó vào ô bên dưới:
            </div>
            <input [(ngModel)]="shopCode" name="shopCodeInput"
              [placeholder]="selectedApi === 'GetInventorySystem' ? 'VD: DN (StoreCode từ GetExistProductLst)' : 'hoặc nhập mã thủ công'"
              (ngModelChange)="updatePreview()" />
          </div>

          <label>
            ProductID
            <small>Để trống = lấy tất cả sản phẩm</small>
            <input [(ngModel)]="productID" name="productID" placeholder="VD: KH02725 hoặc để trống" (ngModelChange)="updatePreview()" />
          </label>

          <label>
            StoreType
            <small *ngIf="selectedApi === 'GetInventorySystem'">Thử: "Kho tổng"</small>
            <small *ngIf="selectedApi === 'GetInventoryShop'">Thử: "Kho chi nhánh"</small>
            <input [(ngModel)]="storeType" name="storeType" [placeholder]="selectedApi === 'GetInventorySystem' ? 'VD: Kho tổng' : 'Để trống'" (ngModelChange)="updatePreview()" />
          </label>

          <label>
            LotCode
            <input [(ngModel)]="lotCode" name="lotCode" placeholder="Để trống" (ngModelChange)="updatePreview()" />
          </label>

          <label>
            BranchLst
            <input [(ngModel)]="branchLst" name="branchLst" placeholder="Để trống" (ngModelChange)="updatePreview()" />
          </label>

          <button class="api-test-submit" type="submit" [disabled]="loading">
            {{ loading ? "Đang gọi..." : "▶ Gọi " + selectedApi }}
          </button>
        </form>

        <section class="api-test-panel">
          <h2>Request gửi đi</h2>
          <div class="endpoint-badge">POST LocalStore/{{ selectedApi }}</div>
          <pre>{{ requestPayload }}</pre>
        </section>

      </section>

      <!-- Response -->
      <section class="api-test-panel response-panel">
        <div class="response-header">
          <h2>Response</h2>
          <span class="result-count" *ngIf="resultCount !== null">
            {{ resultCount }} bản ghi trong LocalStoreLst
          </span>
          <span class="elapsed" *ngIf="elapsedMs !== null">⏱ {{ elapsedMs }} ms</span>
        </div>
        <p class="api-test-error" *ngIf="errorText">⚠ {{ errorText }}</p>
        <div *ngIf="responseText && !errorText">
          <div class="response-tabs">
            <button type="button" [class.active]="responseTab === 'summary'" (click)="responseTab = 'summary'">Tóm tắt</button>
            <button type="button" [class.active]="responseTab === 'raw'" (click)="responseTab = 'raw'">JSON thô {{ truncated ? "(rút gọn)" : "" }}</button>
          </div>
          <div *ngIf="responseTab === 'summary'" class="summary-grid">
            <div class="summary-card">
              <span>Tổng bản ghi</span>
              <strong>{{ resultCount }}</strong>
            </div>
            <div class="summary-card">
              <span>Số shop/kho khác nhau</span>
              <strong>{{ uniqueShops }}</strong>
            </div>
            <div class="summary-card">
              <span>Số sản phẩm khác nhau</span>
              <strong>{{ uniqueProducts }}</strong>
            </div>
            <div class="summary-card">
              <span>Thời gian phản hồi</span>
              <strong>{{ elapsedMs }} ms</strong>
            </div>
          </div>
          <pre *ngIf="responseTab === 'raw'" class="response-pre">{{ responseText }}</pre>
          <p *ngIf="responseTab === 'raw' && truncated" class="truncate-note">
            ⚠ Hiển thị 200 bản ghi đầu. Tổng thực tế: <strong>{{ resultCount }}</strong> bản ghi.
          </p>
        </div>
        <p *ngIf="!responseText && !errorText" class="empty-hint">Chưa có response. Nhấn <strong>Gọi API</strong> để bắt đầu.</p>
      </section>

    </div>

    <div class="loading-overlay" [class.is-visible]="loading" aria-live="polite">
      <div class="loading-box">
        <span class="loader" aria-hidden="true"></span>
        <strong>Đang gọi LocalStore/{{ selectedApi }}...</strong>
        <div class="loading-progress" aria-hidden="true">
          <i [style.width.%]="loadingProgress"></i>
        </div>
        <span class="loading-progress-percent">{{ loadingProgress }}%</span>
      </div>
    </div>
  `,
  styles: [`
    .method-badge { display:inline-block; background:#1d4ed8; color:#fff; font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px; letter-spacing:.08em; margin-bottom:8px; }
    .user-info-bar { background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:8px 14px; font-size:13px; color:#0369a1; }
    label small, .api-test-shop-heading small { display:block; color:#94a3b8; font-size:11px; font-weight:400; margin-bottom:4px; }
    .api-test-check--empty span { color:#64748b; font-style:italic; }
    .api-selector { display:flex; gap:10px; flex-wrap:wrap; }
    .api-selector button { flex:1; min-width:200px; padding:12px 16px; border:2px solid #dbe5f0; border-radius:12px; background:#f8fafc; cursor:pointer; font-size:14px; font-weight:700; color:#64748b; text-align:left; transition:all .15s; }
    .api-selector button small { display:block; font-size:11px; font-weight:400; margin-top:2px; color:#94a3b8; }
    .api-selector button.active { border-color:#17365d; background:#17365d; color:#fff; }
    .api-selector button.active small { color:#93c5fd; }
    .explain-box { background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:10px 14px; font-size:13px; color:#166534; }
    .explain-box--center { background:#fefce8; border-color:#fde047; color:#713f12; }
    .explain-box code, .explain-box--center code { background:rgba(0,0,0,.08); padding:1px 5px; border-radius:4px; font-size:12px; }
    .center-hint { background:#fffbeb; border:1px solid #fcd34d; border-radius:6px; padding:8px 10px; font-size:12px; color:#92400e; margin:6px 0; }
    .center-hint code { background:rgba(0,0,0,.08); padding:1px 4px; border-radius:3px; }
    .endpoint-badge { display:inline-block; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:4px 10px; font-size:12px; font-family:monospace; color:#334155; margin-bottom:10px; }
    .response-header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
    .response-header h2 { margin:0; }
    .result-count { background:#dcfce7; color:#166534; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; }
    .elapsed { color:#64748b; font-size:12px; }
    .response-tabs { display:flex; gap:6px; margin-bottom:12px; }
    .response-tabs button { border:1px solid #cbd5e1; background:#f8fafc; color:#64748b; padding:5px 14px; border-radius:6px; font-size:13px; cursor:pointer; }
    .response-tabs button.active { background:#17365d; color:#fff; border-color:#17365d; }
    .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; }
    .summary-card { background:#f7faff; border:1px solid #dbe5f0; border-radius:10px; padding:14px 16px; }
    .summary-card span { display:block; color:#64748b; font-size:12px; margin-bottom:4px; }
    .summary-card strong { font-size:24px; color:#17365d; font-weight:800; }
    .response-pre { max-height:500px; overflow:auto; }
    .truncate-note { color:#d97706; font-size:12px; margin-top:8px; }
    .empty-hint { color:#94a3b8; font-style:italic; }
  `]
})
export class InventorySystemTestComponent implements OnInit {
  shops: ShopInfo[] = [];
  selectedApi: "GetInventoryShop" | "GetInventorySystem" = "GetInventoryShop";
  shopCode = "";
  productID = "";
  lotCode = "";
  packageID = "";
  storeType = "";
  branchLst = "";

  requestPayload = "";
  responseText = "";
  errorText = "";
  loading = false;
  loadingProgress = 0;
  userTitle = "";

  resultCount: number | null = null;
  uniqueShops: number | null = null;
  uniqueProducts: number | null = null;
  elapsedMs: number | null = null;
  truncated = false;
  responseTab: "summary" | "raw" = "summary";

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loginOnly();
  }

  async loginOnly(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 20;
    this.errorText = "";
    try {
      const session = await this.upharmaService.ensureLogin();
      this.shops = this.upharmaService.getActiveShops();
      this.userTitle = `${session.UserInfo.FullName} (uPharmaID: ${session.UserInfo.uPharmaID}) — ${this.shops.length} nhà thuốc`;
      this.updatePreview();
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }

  updatePreview(): void {
    const session = this.upharmaService.getSession();
    if (!session) return;
    try {
      this.requestPayload = JSON.stringify(this.buildPayload(session.Token, session.UserInfo.uPharmaID), null, 2);
    } catch { /* ignore */ }
  }

  private buildPayload(token: string, uPharmaID: number): RawRecord {
    return {
      uPharmaID,
      Token: token,
      ShopCode: this.shopCode,
      BranchLst: this.branchLst,
      ProductID: this.productID,
      LotCode: this.lotCode,
      PackageID: this.packageID,
      StoreType: this.storeType,
    };
  }

  async callApi(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 10;
    this.errorText = "";
    this.responseText = "";
    this.resultCount = null;
    this.uniqueShops = null;
    this.uniqueProducts = null;
    this.elapsedMs = null;
    this.truncated = false;
    this.responseTab = "summary";

    try {
      const session = await this.upharmaService.ensureLogin();
      const payload = this.buildPayload(session.Token, session.UserInfo.uPharmaID);
      this.requestPayload = JSON.stringify(payload, null, 2);
      this.loadingProgress = 40;

      const t0 = performance.now();
      const response = await this.upharmaService.callEndpoint<any>(
        `/LocalStore/${this.selectedApi}`,
        payload,
        { cache: false }
      );
      this.elapsedMs = Math.round(performance.now() - t0);
      this.loadingProgress = 85;

      // Parse stats
      const list: any[] = Array.isArray(response?.LocalStoreLst) ? response.LocalStoreLst : [];
      this.resultCount = list.length;
      this.uniqueShops = new Set(list.map((r: any) => r.StoreCode || r.ShopCode || r.BranchCode)).size;
      this.uniqueProducts = new Set(list.map((r: any) => r.ProductID || r.ItemCode)).size;

      // Truncate display for large responses
      const DISPLAY_LIMIT = 200;
      if (list.length > DISPLAY_LIMIT) {
        this.truncated = true;
        const truncatedResponse = { ...response, LocalStoreLst: list.slice(0, DISPLAY_LIMIT) };
        this.responseText = JSON.stringify(truncatedResponse, null, 2);
      } else {
        this.responseText = JSON.stringify(response, null, 2);
      }

      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }
}
