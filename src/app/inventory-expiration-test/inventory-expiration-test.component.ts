import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";
import { normalizeInventoryRow } from "../inventory-utils";

@Component({
  selector: "app-inventory-expiration-test",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-inner">

      <section class="api-test-header">
        <div>
          <span class="method-badge">POST</span>
          <h1>LocalStore/GetInventoryExpiration</h1>
          <p>Lấy tồn kho <strong>hàng cận date</strong> trên nhiều nhà thuốc cùng lúc.</p>
          <div class="goal-box">
            🎯 <strong>Mục tiêu Bước 3:</strong> Nếu API này cho phép <code>ShopCode</code> trống
            → 1 lần gọi lấy hết hàng cận hạn toàn bộ nhà thuốc → không cần vòng lặp N sản phẩm nữa.
          </div>
        </div>
        <button type="button" (click)="loginOnly()" [disabled]="loading">↺ Lấy lại phiên</button>
      </section>

      <div class="user-info-bar" *ngIf="userTitle">
        🔑 {{ userTitle }}
      </div>

      <section class="api-test-grid">

        <!-- LEFT: Form -->
        <form class="api-test-panel" (ngSubmit)="callApi()">
          <h2>Tham số Payload</h2>

          <!-- ShopCode -->
          <div class="api-test-shop-picker">
            <div class="api-test-shop-heading">
              <span>ShopCode</span>
              <small>Để trống = thử lấy tất cả shop</small>
            </div>
            <label class="api-test-check api-test-check--all">
              <input type="radio" name="shopCode"
                [checked]="shopCode === ''"
                (change)="shopCode = ''; updatePreview()" />
              <span>⬜ Tất cả (để trống) — <em>thử xem API có hỗ trợ không</em></span>
            </label>
            <label class="api-test-check" *ngFor="let shop of shops">
              <input type="radio" name="shopCode"
                [checked]="shopCode === shop.ShopCode"
                (change)="shopCode = shop.ShopCode; updatePreview()" />
              <span>{{ shop.ShopCode }} – {{ shop.ShopName }}</span>
            </label>
            <input [(ngModel)]="shopCode" name="shopCodeInput"
              placeholder="hoặc nhập mã thủ công"
              (ngModelChange)="updatePreview()" />
          </div>

          <label>
            ProductID
            <small>Để trống = tất cả sản phẩm</small>
            <input [(ngModel)]="productID" name="productID"
              placeholder="VD: KH02725 hoặc để trống"
              (ngModelChange)="updatePreview()" />
          </label>

          <label>
            LotCode
            <input [(ngModel)]="lotCode" name="lotCode"
              placeholder="Để trống" (ngModelChange)="updatePreview()" />
          </label>

          <label>
            StoreType
            <input [(ngModel)]="storeType" name="storeType"
              placeholder="Để trống" (ngModelChange)="updatePreview()" />
          </label>

          <label>
            BranchLst
            <input [(ngModel)]="branchLst" name="branchLst"
              placeholder="Để trống" (ngModelChange)="updatePreview()" />
          </label>



          <button class="api-test-submit" type="submit" [disabled]="loading">
            {{ loading ? "Đang gọi..." : "▶ Gọi GetInventoryExpiration" }}
          </button>
        </form>

        <!-- RIGHT: Request preview -->
        <section class="api-test-panel">
          <h2>Request gửi đi</h2>
          <div class="endpoint-badge">POST LocalStore/GetInventoryExpiration</div>
          <pre>{{ requestPayload }}</pre>
        </section>

      </section>

      <!-- Response -->
      <section class="api-test-panel response-panel">
        <div class="response-header">
          <h2>Response</h2>
          <span class="badge-success" *ngIf="resultCount !== null && resultCount > 0">
            ✅ {{ resultCount }} bản ghi
          </span>
          <span class="badge-empty" *ngIf="resultCount === 0">
            ⚠ 0 bản ghi — API có thể cần ShopCode cụ thể
          </span>
          <span class="elapsed" *ngIf="elapsedMs !== null">⏱ {{ elapsedMs }} ms</span>
        </div>

        <p class="api-test-error" *ngIf="errorText">⚠ {{ errorText }}</p>

        <div *ngIf="responseText && !errorText">

          <!-- 2. Expiry Dashboard Stats -->
          <section aria-label="Thống kê hạn dùng" class="expiry-dashboard" style="margin-bottom: 20px;">
            <article *ngFor="let card of expiryCards" 
              [class]="card.key" 
              [class.is-active]="expiryFilter === card.key"
              (click)="toggleExpiryFilter(card.key)"
              style="cursor: pointer;">
              <span>{{ card.label }}</span>
              <strong>{{ expirySummary[card.key] }}</strong>
              <small>{{ formatMoneyValue(expiryValueSummary[card.key]) }} VNĐ</small>
              <small class="expiry-rate">{{ getExpiryRate(card.key) }}%</small>
            </article>
          </section>

          <!-- Verdict -->
          <div class="verdict-box verdict-success" *ngIf="resultCount !== null && resultCount > 0">
            {{ verdictText }}
          </div>
          <div class="verdict-box verdict-empty" *ngIf="resultCount === 0">
            ⚠ Trả về 0 bản ghi — thử chọn 1 ShopCode khác hoặc nới lỏng bộ lọc thời hạn dùng.
          </div>

          <div class="response-tabs">
            <button type="button" [class.active]="responseTab === 'summary'" (click)="responseTab = 'summary'">📊 Tóm tắt</button>
            <button type="button" [class.active]="responseTab === 'raw'" (click)="responseTab = 'raw'">
              📋 JSON thô {{ truncated ? "(rút gọn 200/" + resultCount + ")" : "" }}
            </button>
          </div>

          <!-- Summary -->
          <div *ngIf="responseTab === 'summary'" class="summary-grid">
            <div class="summary-card">
              <span>Tổng hàng cận hạn</span>
              <strong>{{ resultCount }}</strong>
            </div>
            <div class="summary-card">
              <span>Số shop</span>
              <strong>{{ uniqueShops }}</strong>
            </div>
            <div class="summary-card">
              <span>Số sản phẩm</span>
              <strong>{{ uniqueProducts }}</strong>
            </div>
            <div class="summary-card">
              <span>Thời gian phản hồi</span>
              <strong>{{ elapsedMs }} ms</strong>
            </div>
          </div>

          <!-- Raw JSON -->
          <pre *ngIf="responseTab === 'raw'" class="response-pre">{{ responseText }}</pre>
          <p *ngIf="responseTab === 'raw' && truncated" class="truncate-note">
            ⚠ Hiển thị 200 bản ghi đầu. Tổng: <strong>{{ resultCount }}</strong>.
          </p>
        </div>

        <p *ngIf="!responseText && !errorText" class="empty-hint">
          Chưa có response. Nhấn <strong>Gọi API</strong> để bắt đầu.<br/>
          <em>Gợi ý: Test với ShopCode trống trước để xem API trả về gì.</em>
        </p>
      </section>

    </div>

    <!-- Loading overlay -->
    <div class="loading-overlay" [class.is-visible]="loading" aria-live="polite">
      <div class="loading-box">
        <span class="loader" aria-hidden="true"></span>
        <strong>Đang gọi GetInventoryExpiration...</strong>
        <div class="loading-progress">
          <i [style.width.%]="loadingProgress"></i>
        </div>
        <span class="loading-progress-percent">{{ loadingProgress }}%</span>
      </div>
    </div>
  `,
  styles: [`
    .method-badge { display:inline-block; background:#059669; color:#fff; font-size:11px; font-weight:800; padding:3px 8px; border-radius:4px; letter-spacing:.08em; margin-bottom:8px; }
    .goal-box { background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:10px 14px; font-size:13px; color:#166534; margin-top:8px; }
    .goal-box code { background:rgba(0,0,0,.08); padding:1px 5px; border-radius:4px; font-size:12px; }
    .user-info-bar { background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:8px 14px; font-size:13px; color:#0369a1; }
    label small { display:block; color:#94a3b8; font-size:11px; font-weight:400; margin-bottom:4px; }
    .api-test-shop-heading small { display:block; color:#94a3b8; font-size:11px; font-weight:400; margin-bottom:4px; }
    .api-test-check--all span { color:#166534; font-weight:600; }
    .api-test-check--all em { font-weight:400; color:#64748b; }
    .endpoint-badge { display:inline-block; background:#f0fdf4; border:1px solid #86efac; border-radius:6px; padding:4px 10px; font-size:12px; font-family:monospace; color:#166534; margin-bottom:10px; }
    .response-header { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
    .response-header h2 { margin:0; }
    .badge-success { background:#dcfce7; color:#166534; padding:3px 12px; border-radius:999px; font-size:12px; font-weight:700; }
    .badge-empty { background:#fef9c3; color:#713f12; padding:3px 12px; border-radius:999px; font-size:12px; font-weight:700; }
    .elapsed { color:#64748b; font-size:12px; }
    .verdict-box { border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:12px; }
    .verdict-success { background:#f0fdf4; border:1px solid #86efac; color:#166534; }
    .verdict-empty { background:#fefce8; border:1px solid #fde047; color:#713f12; }
    .response-tabs { display:flex; gap:6px; margin-bottom:12px; }
    .response-tabs button { border:1px solid #cbd5e1; background:#f8fafc; color:#64748b; padding:5px 14px; border-radius:6px; font-size:13px; cursor:pointer; }
    .response-tabs button.active { background:#059669; color:#fff; border-color:#059669; }
    .summary-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
    .summary-card { background:#f7faff; border:1px solid #dbe5f0; border-radius:10px; padding:14px 16px; }
    .summary-card span { display:block; color:#64748b; font-size:12px; margin-bottom:4px; }
    .summary-card strong { font-size:24px; color:#059669; font-weight:800; }
    .response-pre { max-height:500px; overflow:auto; }
    .truncate-note { color:#d97706; font-size:12px; margin-top:8px; }
    .empty-hint { color:#94a3b8; font-style:italic; line-height:1.6; }
  `]
})
export class InventoryExpirationTestComponent implements OnInit {
  shops: ShopInfo[] = [];
  shopCode = "";
  productID = "";
  lotCode = "";
  storeType = "";
  branchLst = "";

  requestPayload = "";
  responseText = "";
  errorText = "";
  loading = false;
  loadingProgress = 0;
  userTitle = "";

  rawResponseData: any = null;
  filteredList: any[] = [];
  expiryFilter: "all" | "expired" | "danger" | "warning" | "safe" | "normal" = "all";

  readonly expiryCards = [
    { key: "all" as const, label: "Tất cả" },
    { key: "expired" as const, label: "Hết hạn" },
    { key: "danger" as const, label: "3 Tháng" },
    { key: "warning" as const, label: "6 Tháng" },
    { key: "safe" as const, label: "1 Năm" },
    { key: "normal" as const, label: "Hàng bình thường" },
  ];

  expirySummary = { expired: 0, danger: 0, warning: 0, safe: 0, normal: 0, all: 0 };
  expiryValueSummary = { expired: 0, danger: 0, warning: 0, safe: 0, normal: 0, all: 0 };

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
      this.userTitle = `${session.UserInfo.FullName} — ${this.shops.length} nhà thuốc`;
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
    this.requestPayload = JSON.stringify(this.buildPayload(session.Token, session.UserInfo.uPharmaID), null, 2);
  }

  private buildPayload(token: string, uPharmaID: number): RawRecord {
    return {
      uPharmaID,
      Token: token,
      ShopCode: this.shopCode,
      BranchLst: this.branchLst,
      ProductID: this.productID,
      LotCode: this.lotCode,
      PackageID: 0,
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
    this.rawResponseData = null;

    try {
      const session = await this.upharmaService.ensureLogin();
      const payload = this.buildPayload(session.Token, session.UserInfo.uPharmaID);
      this.requestPayload = JSON.stringify(payload, null, 2);
      this.loadingProgress = 40;

      const t0 = performance.now();
      const response = await this.upharmaService.callEndpoint<any>(
        "/LocalStore/GetInventoryExpiration",
        payload,
        { cache: false }
      );
      this.elapsedMs = Math.round(performance.now() - t0);
      this.loadingProgress = 85;

      this.rawResponseData = response;
      this.applyFiltering();

      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }

  applyFiltering(): void {
    if (!this.rawResponseData) return;

    const rawList: any[] = Array.isArray(this.rawResponseData?.LocalStoreLst) 
      ? this.rawResponseData.LocalStoreLst 
      : [];

    // 1. Lọc theo 3 shop của user
    const userShopCodes = new Set(this.shops.map(s => s.ShopCode));
    const shopList = rawList
      .filter((r: any) => {
        const code = r.StoreCode ?? r.ShopCode ?? r.BranchCode ?? "";
        return userShopCodes.has(code);
      })
      .map((r: any, index: number) => normalizeInventoryRow(r, index));

    // 2. Tính toán tổng số lượng và giá trị trị cho dashboard thống kê
    const counts = { expired: 0, danger: 0, warning: 0, safe: 0, normal: 0, all: 0 };
    const values = { expired: 0, danger: 0, warning: 0, safe: 0, normal: 0, all: 0 };

    for (const item of shopList) {
      const days = item.expiryDaysRemaining;
      const value = item.stockValue || 0;

      counts.all++;
      values.all += value;

      if (days === null) {
        counts.normal++;
        values.normal += value;
        continue;
      }

      if (days < 0) {
        counts.expired++;
        values.expired += value;
      } else if (days <= 90) {
        counts.danger++;
        values.danger += value;
      } else if (days <= 180) {
        counts.warning++;
        values.warning += value;
      } else if (days <= 365) {
        counts.safe++;
        values.safe += value;
      } else {
        counts.normal++;
        values.normal += value;
      }
    }

    this.expirySummary = counts;
    this.expiryValueSummary = values;

    // 3. Lọc danh sách hiển thị dựa trên tab đang chọn
    let list = shopList;
    if (this.expiryFilter !== "all") {
      list = shopList.filter((item: any) => {
        const days = item.expiryDaysRemaining;
        if (this.expiryFilter === "expired") return days !== null && days < 0;
        if (this.expiryFilter === "danger") return days !== null && days >= 0 && days <= 90;
        if (this.expiryFilter === "warning") return days !== null && days > 90 && days <= 180;
        if (this.expiryFilter === "safe") return days !== null && days > 180 && days <= 365;
        if (this.expiryFilter === "normal") return days === null || days > 365;
        return true;
      });
    }

    this.filteredList = list;
    this.resultCount = list.length;
    this.uniqueShops = new Set(list.map((r: any) => r.shopCode)).size;
    this.uniqueProducts = new Set(list.map((r: any) => r.productCode)).size;

    const LIMIT = 200;
    if (list.length > LIMIT) {
      this.truncated = true;
      this.responseText = JSON.stringify({ ...this.rawResponseData, LocalStoreLst: list.slice(0, LIMIT) }, null, 2);
    } else {
      this.truncated = false;
      this.responseText = JSON.stringify({ ...this.rawResponseData, LocalStoreLst: list }, null, 2);
    }
  }

  toggleExpiryFilter(key: "all" | "expired" | "danger" | "warning" | "safe" | "normal"): void {
    this.expiryFilter = key;
    this.applyFiltering();
  }

  getExpiryRate(key: "all" | "expired" | "danger" | "warning" | "safe" | "normal"): string {
    const total = this.expirySummary.all || 1;
    const count = this.expirySummary[key];
    const percentage = (count / total) * 100;
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(percentage);
  }

  formatMoneyValue(val: number): string {
    return new Intl.NumberFormat("vi-VN").format(val);
  }

  get verdictText(): string {
    if (this.resultCount === null || this.resultCount === 0) return "";

    const counts: Record<string, number> = {};
    for (const r of this.filteredList) {
      const code = r.shopCode || "";
      counts[code] = (counts[code] || 0) + 1;
    }

    const breakdown = Object.entries(counts)
      .map(([code, count]) => `Shop ${code} có ${count} mặt hàng cận hạn`)
      .join(", ");

    return `🎉 API hỗ trợ! Trả về ${this.resultCount} hàng cận date — ${breakdown}.`;
  }
}
