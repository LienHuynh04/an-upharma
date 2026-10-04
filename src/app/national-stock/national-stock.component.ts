import { CommonModule } from "@angular/common";
import { Component, HostListener, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UpharmaService } from "../upharma.service";
import { FirebaseInventoryService } from "../firebase-inventory.service";

interface ProductItem {
  code: string;
  name: string;
  key: string;
}

interface StockRow {
  ProductID: string;
  ProductName: string;
  StoreCode: string;
  StoreName: string;
  StoreType: string;
  Quantity: number;
  QuantityAVG: number;
  UnitOfMeasure: string;
  isWarehouse: boolean;
}

interface StockGroup {
  type: string;
  qty: number;
  rows: (StockRow & { idx: number })[];
}

@Component({
  selector: "app-national-stock",
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    :host {
      --ns-bg: var(--tblr-bg-surface, #fff);
      --ns-bg-soft: var(--tblr-bg-surface-secondary, #f6f8fb);
      --ns-border: var(--tblr-border-color, #e6e7e9);
      --ns-text: var(--tblr-body-color, #1d273b);
      --ns-muted: var(--tblr-secondary, #667382);
      --ns-primary: var(--tblr-primary, #206bc4);
      --ns-primary-soft: rgba(var(--tblr-primary-rgb, 32,107,196), .1);
      --ns-hover: rgba(var(--tblr-primary-rgb, 32,107,196), .06);
      display: block;
      color: var(--ns-text);
    }

    .ns-head { display: flex; flex-wrap: wrap; align-items: end; gap: .5rem 1rem; margin-bottom: 1rem; }
    .ns-head h2 { margin: 0; font-size: 1.25rem; font-weight: 600; }
    .ns-head p { margin: 0; color: var(--ns-muted); font-size: .8125rem; }

    .ns-bar {
      display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: .5rem; align-items: center;
      background: var(--ns-bg); border: 1px solid var(--ns-border); border-radius: 8px; padding: .75rem;
      margin-bottom: 1rem;
    }
    .ns-field { display: flex; min-width: 0; }
    .ns-field input {
      flex: 1; min-width: 0; height: 38px; padding: 0 .75rem; font-size: .875rem;
      background: var(--ns-bg); color: var(--ns-text);
      border: 1px solid var(--ns-border); border-right: 0; border-radius: 6px 0 0 6px; outline: none;
    }
    .ns-field input:focus { border-color: var(--ns-primary); box-shadow: 0 0 0 3px var(--ns-primary-soft); }
    .ns-pick {
      width: 42px; height: 38px; display: grid; place-items: center; font-size: 1.1rem;
      background: var(--ns-bg-soft); color: var(--ns-text);
      border: 1px solid var(--ns-border); border-radius: 0 6px 6px 0; cursor: pointer;
    }
    .ns-pick:hover { color: var(--ns-primary); border-color: var(--ns-primary); }
    .ns-check { display: flex; align-items: center; gap: .375rem; font-size: .8125rem; color: var(--ns-muted); white-space: nowrap; cursor: pointer; margin: 0; }
    .ns-btn {
      height: 38px; padding: 0 1.25rem; border: 0; border-radius: 6px; font-weight: 600; font-size: .875rem;
      background: var(--ns-primary); color: #fff; cursor: pointer; white-space: nowrap;
    }
    .ns-btn:disabled { opacity: .55; cursor: not-allowed; }
    .ns-btn-ghost {
      height: 34px; padding: 0 .875rem; border-radius: 6px; font-size: .8125rem; cursor: pointer;
      background: transparent; color: var(--ns-text); border: 1px solid var(--ns-border); white-space: nowrap;
    }
    .ns-btn-ghost:hover { border-color: var(--ns-primary); color: var(--ns-primary); }

    .ns-selected { font-size: .8125rem; color: var(--ns-muted); margin: -.5rem 0 1rem; }
    .ns-selected b { color: var(--ns-text); }

    .ns-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem; margin-bottom: 1rem; }
    .ns-stat { background: var(--ns-bg); border: 1px solid var(--ns-border); border-radius: 8px; padding: .625rem .875rem; }
    .ns-stat span { display: block; font-size: .75rem; color: var(--ns-muted); }
    .ns-stat b { font-size: 1.25rem; font-variant-numeric: tabular-nums; }

    .ns-card { background: var(--ns-bg); border: 1px solid var(--ns-border); border-radius: 8px; overflow: hidden; }
    .ns-card-title { text-align: center; font-weight: 600; color: var(--ns-primary); padding: .5rem; border-bottom: 1px solid var(--ns-border); }
    .ns-scroll { max-height: 65vh; overflow: auto; }

    table.ns-table { width: 100%; border-collapse: collapse; font-size: .8125rem; }
    .ns-table th {
      position: sticky; top: 0; z-index: 2; background: var(--ns-bg-soft); color: var(--ns-muted);
      font-weight: 600; text-align: left; padding: .5rem .625rem; border-bottom: 1px solid var(--ns-border);
      white-space: nowrap; cursor: pointer; user-select: none;
    }
    .ns-table th.num, .ns-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .ns-table td { padding: .4375rem .625rem; border-bottom: 1px solid var(--ns-border); }
    .ns-table tbody tr.ns-row:hover td { background: var(--ns-hover); }
    .ns-table td.idx { color: var(--ns-muted); width: 44px; }
    .ns-table td.nowrap { white-space: nowrap; }
    .ns-table td.zero { color: var(--ns-muted); }
    .ns-table td.pos { font-weight: 600; }
    .ns-group td { background: var(--ns-bg-soft); font-weight: 600; position: sticky; top: 33px; z-index: 1; }
    .ns-group small { color: var(--ns-muted); font-weight: 400; margin-left: .5rem; }
    .ns-sort { font-size: .7rem; margin-left: .25rem; }

    .ns-foot { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .5rem .75rem; border-top: 1px solid var(--ns-border); }
    .ns-foot input {
      height: 32px; width: 260px; max-width: 100%; padding: 0 .625rem; font-size: .8125rem; border-radius: 6px;
      background: var(--ns-bg); color: var(--ns-text); border: 1px solid var(--ns-border); outline: none;
    }
    .ns-foot input:focus { border-color: var(--ns-primary); }
    .ns-foot span { margin-left: auto; color: var(--ns-muted); font-size: .8125rem; }
    .ns-empty { text-align: center; color: var(--ns-muted); padding: 2rem 1rem; }
    .ns-error { border: 1px solid var(--tblr-danger, #d63939); color: var(--tblr-danger, #d63939); border-radius: 8px; padding: .625rem .875rem; margin-bottom: 1rem; font-size: .875rem; }

    /* Mobile cards */
    .ns-cards { display: none; }
    .ns-mcard { padding: .625rem .875rem; border-bottom: 1px solid var(--ns-border); }
    .ns-mcard-top { display: flex; justify-content: space-between; gap: .75rem; }
    .ns-mcard-top b { font-size: .875rem; }
    .ns-mcard-qty { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ns-mcard-name { font-size: .8125rem; margin-top: .125rem; }
    .ns-mcard-meta { font-size: .75rem; color: var(--ns-muted); margin-top: .25rem; }
    .ns-mgroup { background: var(--ns-bg-soft); padding: .5rem .875rem; font-weight: 600; font-size: .8125rem; position: sticky; top: 0; border-bottom: 1px solid var(--ns-border); }

    /* Modal */
    .ns-overlay { position: fixed; inset: 0; z-index: 1055; background: rgba(15, 23, 42, .55); display: grid; place-items: center; padding: 1rem; }
    .ns-modal {
      width: min(760px, 100%); max-height: calc(100vh - 2rem); display: flex; flex-direction: column;
      background: var(--ns-bg); color: var(--ns-text); border: 1px solid var(--ns-border); border-radius: 10px;
      box-shadow: 0 20px 50px rgba(0,0,0,.25);
    }
    .ns-modal-head { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1rem; border-bottom: 1px solid var(--ns-border); }
    .ns-modal-head h3 { margin: 0; font-size: 1rem; font-weight: 600; }
    .ns-x { background: none; border: 0; color: var(--ns-muted); font-size: 1.5rem; line-height: 1; cursor: pointer; }
    .ns-x:hover { color: var(--ns-text); }
    .ns-modal-tools { display: flex; gap: .5rem; padding: .75rem 1rem; }
    .ns-modal-tools input {
      flex: 1; min-width: 0; height: 34px; padding: 0 .75rem; font-size: .875rem; border-radius: 6px;
      background: var(--ns-bg); color: var(--ns-text); border: 1px solid var(--ns-border); outline: none;
    }
    .ns-modal-tools input:focus { border-color: var(--ns-primary); box-shadow: 0 0 0 3px var(--ns-primary-soft); }
    .ns-modal-body { flex: 1; min-height: 0; overflow: auto; margin: 0 1rem; border: 1px solid var(--ns-border); border-radius: 6px; }
    .ns-modal-body table td { cursor: pointer; }
    .ns-modal-body tr.on td { background: var(--ns-primary-soft); }
    .ns-modal-body input[type=radio] { accent-color: var(--ns-primary); width: 16px; height: 16px; cursor: pointer; }
    .ns-modal-foot { display: flex; align-items: center; gap: .5rem; padding: .75rem 1rem; }
    .ns-modal-foot .info { margin-right: auto; color: var(--ns-muted); font-size: .8125rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ns-more { background: none; border: 0; color: var(--ns-primary); font-size: .8125rem; cursor: pointer; }

    @media (max-width: 767.98px) {
      .ns-bar { grid-template-columns: 1fr auto; }
      .ns-field { grid-column: 1 / -1; }
      .ns-btn { justify-self: end; }
      .ns-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ns-table-wrap { display: none; }
      .ns-cards { display: block; }
      .ns-scroll { max-height: none; }
      .ns-foot input { width: 100%; }
      .ns-foot span { margin-left: 0; }
      .ns-overlay { padding: 0; }
      .ns-modal { width: 100%; height: 100%; max-height: none; border-radius: 0; border: 0; }
      .ns-modal-body { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
      .ns-col-code { width: 96px; }
    }
  `],
  template: `
    <div class="container-xl py-3">
      <header class="ns-head">
        <div>
          <h2>Tồn kho toàn quốc</h2>
          <p>Chọn một sản phẩm để xem tồn tại tất cả kho và nhà thuốc.</p>
        </div>
      </header>

      <form class="ns-bar" (ngSubmit)="search()">
        <div class="ns-field">
          <input id="ns-product" name="productId" [(ngModel)]="productId" placeholder="Mã sản phẩm, VD: KH02666"
                 autocomplete="off" aria-label="Mã sản phẩm" />
          <button id="ns-pick" class="ns-pick" type="button" (click)="openPicker()" title="Chọn sản phẩm" aria-label="Chọn sản phẩm">⋯</button>
        </div>
        <label class="ns-check">
          <input type="checkbox" name="hideZero" [(ngModel)]="hideZero" /> Ẩn tồn = 0
        </label>
        <button id="ns-search" class="ns-btn" type="submit" [disabled]="loading || !productId.trim()">
          {{ loading ? 'Đang tải…' : 'Xem tồn' }}
        </button>
      </form>

      <div class="ns-selected" *ngIf="selectedName">Sản phẩm: <b>{{ productId }}</b> — {{ selectedName }}</div>

      <div class="ns-error" *ngIf="error">{{ error }}</div>

      <ng-container *ngIf="searched && !loading && !error">
        <section class="ns-stats">
          <div class="ns-stat"><span>Tổng tồn</span><b>{{ totalQty | number }}</b></div>
          <div class="ns-stat"><span>Tồn nhà thuốc</span><b>{{ storeQty | number }}</b></div>
          <div class="ns-stat"><span>Tồn kho tổng</span><b>{{ warehouseQty | number }}</b></div>
          <div class="ns-stat"><span>Số điểm có hàng</span><b>{{ inStockCount }}</b></div>
        </section>

        <section class="ns-card">
          <div class="ns-card-title">Danh sách kho</div>

          <div class="ns-scroll ns-table-wrap">
            <table class="ns-table">
              <thead>
                <tr>
                  <th style="cursor:default"></th>
                  <th (click)="sortBy('ProductID')">Mã sản phẩm<span class="ns-sort">{{ arrow('ProductID') }}</span></th>
                  <th (click)="sortBy('ProductName')">Tên sản phẩm<span class="ns-sort">{{ arrow('ProductName') }}</span></th>
                  <th class="num" (click)="sortBy('Quantity')">Số lượng<span class="ns-sort">{{ arrow('Quantity') }}</span></th>
                  <th class="num" (click)="sortBy('QuantityAVG')">TT/Tháng<span class="ns-sort">{{ arrow('QuantityAVG') }}</span></th>
                  <th style="cursor:default">Đơn vị</th>
                  <th (click)="sortBy('StoreCode')">Mã kho<span class="ns-sort">{{ arrow('StoreCode') }}</span></th>
                  <th (click)="sortBy('StoreName')">Tên kho<span class="ns-sort">{{ arrow('StoreName') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let g of groups; trackBy: trackGroup">
                  <tr class="ns-group"><td colspan="8">Loại kho: {{ g.type }}<small>{{ g.rows.length }} điểm · tồn {{ g.qty | number }}</small></td></tr>
                  <tr class="ns-row" *ngFor="let r of g.rows; trackBy: trackRow">
                    <td class="idx">{{ r.idx }}</td>
                    <td class="nowrap">{{ r.ProductID }}</td>
                    <td>{{ r.ProductName }}</td>
                    <td class="num" [class.pos]="r.Quantity > 0" [class.zero]="r.Quantity <= 0">{{ r.Quantity | number }}</td>
                    <td class="num">{{ r.QuantityAVG | number:'1.2-2' }}</td>
                    <td class="nowrap">{{ r.UnitOfMeasure }}</td>
                    <td class="nowrap">{{ r.StoreCode }}</td>
                    <td class="nowrap">{{ r.StoreName }}</td>
                  </tr>
                </ng-container>
              </tbody>
            </table>
            <div class="ns-empty" *ngIf="groups.length === 0">Không có dữ liệu tồn kho.</div>
          </div>

          <div class="ns-cards">
            <ng-container *ngFor="let g of groups; trackBy: trackGroup">
              <div class="ns-mgroup">Loại kho: {{ g.type }} · tồn {{ g.qty | number }}</div>
              <div class="ns-mcard" *ngFor="let r of g.rows; trackBy: trackRow">
                <div class="ns-mcard-top">
                  <b>{{ r.StoreCode }}</b>
                  <span class="ns-mcard-qty">{{ r.Quantity | number }} {{ r.UnitOfMeasure }}</span>
                </div>
                <div class="ns-mcard-name">{{ r.StoreName }}</div>
                <div class="ns-mcard-meta">TT/Tháng: {{ r.QuantityAVG | number:'1.2-2' }}</div>
              </div>
            </ng-container>
            <div class="ns-empty" *ngIf="groups.length === 0">Không có dữ liệu tồn kho.</div>
          </div>

          <div class="ns-foot">
            <input id="ns-filter" name="filter" [(ngModel)]="filter" placeholder="Lọc theo mã / tên kho" />
            <span>{{ view.length }} dòng · Tổng tồn <b>{{ totalQty | number }}</b></span>
          </div>
        </section>
      </ng-container>
    </div>

    <!-- Popup chọn 1 sản phẩm -->
    <div class="ns-overlay" *ngIf="pickerOpen" (click)="closePicker()">
      <div class="ns-modal" role="dialog" aria-modal="true" aria-labelledby="ns-picker-title" (click)="$event.stopPropagation()">
        <div class="ns-modal-head">
          <h3 id="ns-picker-title">Lựa chọn sản phẩm</h3>
          <button class="ns-x" type="button" (click)="closePicker()" aria-label="Đóng">×</button>
        </div>

        <div class="ns-modal-tools">
          <input id="ns-picker-search" [(ngModel)]="pickerSearch" (ngModelChange)="pickerLimit = 200"
                 placeholder="Tìm mã hoặc tên sản phẩm" autocomplete="off" />
          <button class="ns-btn-ghost" type="button" (click)="pickerSearch = ''">Xoá</button>
          <button class="ns-btn-ghost" type="button" (click)="loadProducts(true)" [disabled]="pickerLoading">Tải lại</button>
        </div>

        <div class="ns-error" style="margin: 0 1rem .75rem" *ngIf="pickerError">{{ pickerError }}</div>

        <div class="ns-modal-body">
          <div class="ns-empty" *ngIf="pickerLoading">Đang tải danh sách sản phẩm…</div>
          <table class="ns-table" *ngIf="!pickerLoading">
            <thead>
              <tr>
                <th style="width:40px;cursor:default"></th>
                <th class="ns-col-code" style="width:130px;cursor:default">Mã sản phẩm</th>
                <th style="cursor:default">Tên sản phẩm</th>
              </tr>
            </thead>
            <tbody>
              <tr class="ns-row" *ngFor="let p of pickerView; trackBy: trackProduct" [class.on]="picked === p.code"
                  (click)="picked = p.code" (dblclick)="pickOne(p.code)">
                <td><input type="radio" name="ns-product-radio" [checked]="picked === p.code" (change)="picked = p.code" [attr.aria-label]="p.code" /></td>
                <td class="nowrap">{{ p.code }}</td>
                <td>{{ p.name }}</td>
              </tr>
            </tbody>
          </table>
          <div class="ns-empty" *ngIf="!pickerLoading && pickerFiltered.length === 0">Không tìm thấy sản phẩm.</div>
          <div class="ns-empty" style="padding:.5rem" *ngIf="!pickerLoading && pickerFiltered.length > pickerLimit">
            <button class="ns-more" type="button" (click)="pickerLimit = pickerLimit + 200">Xem thêm ({{ pickerFiltered.length - pickerLimit }} còn lại)</button>
          </div>
        </div>

        <div class="ns-modal-foot">
          <span class="info">{{ picked ? ('Đã chọn: ' + picked) : (products.length + ' sản phẩm · nhấp đúp để chọn nhanh') }}</span>
          <button class="ns-btn-ghost" type="button" (click)="closePicker()">Đóng</button>
          <button id="ns-picker-ok" class="ns-btn" type="button" [disabled]="!picked" (click)="confirmPick()">Lựa chọn</button>
        </div>
      </div>
    </div>
  `,
})
export class NationalStockComponent {
  private readonly upharma = inject(UpharmaService);
  private readonly firebaseCache = inject(FirebaseInventoryService);

  productId = "";
  hideZero = false;
  filter = "";
  loading = false;
  searched = false;
  error = "";
  rows: StockRow[] = [];
  sortKey: keyof StockRow = "StoreCode";
  sortDesc = false;

  // Popup
  pickerOpen = false;
  pickerLoading = false;
  pickerError = "";
  pickerSearch = "";
  pickerLimit = 200;
  products: ProductItem[] = [];
  picked = "";

  @HostListener("document:keydown.escape")
  onEsc() {
    if (this.pickerOpen) this.closePicker();
  }

  // ===== Bảng =====
  get view(): StockRow[] {
    const f = this.filter.trim().toLowerCase();
    const list = this.rows.filter(
      (r) =>
        (!this.hideZero || r.Quantity > 0) &&
        (!f || r.StoreCode.toLowerCase().includes(f) || r.StoreName.toLowerCase().includes(f)),
    );
    const k = this.sortKey;
    const dir = this.sortDesc ? -1 : 1;
    return list.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
  }

  /** Nhóm theo Loại kho; "Kho tổng" luôn đứng đầu, các nhóm khác theo A-Z. */
  get groups(): StockGroup[] {
    const map = new Map<string, StockRow[]>();
    for (const r of this.view) {
      const t = r.StoreType || (r.isWarehouse ? "Kho tổng" : "Khác");
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(r);
    }
    const rank = (t: string) => (t.toLowerCase().includes("kho tổng") ? 0 : 1);
    let idx = 0;
    return [...map.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, "vi"))
      .map(([type, rows]) => ({
        type,
        qty: rows.reduce((s, r) => s + Math.max(0, r.Quantity), 0),
        rows: rows.map((r) => ({ ...r, idx: ++idx })),
      }));
  }

  get totalQty() { return this.rows.reduce((s, r) => s + Math.max(0, r.Quantity), 0); }
  get warehouseQty() { return this.rows.filter((r) => r.isWarehouse).reduce((s, r) => s + Math.max(0, r.Quantity), 0); }
  get storeQty() { return this.totalQty - this.warehouseQty; }
  get inStockCount() { return this.rows.filter((r) => r.Quantity > 0).length; }

  get selectedName(): string {
    const code = this.productId.trim();
    return this.products.find((p) => p.code === code)?.name || this.rows[0]?.ProductName || "";
  }

  sortBy(key: keyof StockRow) {
    if (this.sortKey === key) this.sortDesc = !this.sortDesc;
    else { this.sortKey = key; this.sortDesc = false; }
  }

  arrow(key: keyof StockRow): string {
    return this.sortKey === key ? (this.sortDesc ? "▼" : "▲") : "";
  }

  trackGroup = (_: number, g: StockGroup) => g.type;
  trackRow = (_: number, r: StockRow) => r.StoreCode;
  trackProduct = (_: number, p: ProductItem) => p.code;

  // ===== Popup chọn sản phẩm =====
  private static normalize(s: string): string {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  }

  get pickerFiltered(): ProductItem[] {
    const q = NationalStockComponent.normalize(this.pickerSearch.trim());
    return q ? this.products.filter((p) => p.key.includes(q)) : this.products;
  }

  get pickerView(): ProductItem[] {
    return this.pickerFiltered.slice(0, this.pickerLimit);
  }

  openPicker() {
    this.pickerOpen = true;
    this.pickerSearch = "";
    this.pickerLimit = 200;
    this.picked = ""; // không chọn sẵn
    if (!this.products.length) this.loadProducts();
  }

  closePicker() {
    this.pickerOpen = false;
  }

  private static isKmOrOff(code: string, name: string): boolean {
    const c = String(code || "").trim().toUpperCase();
    const n = String(name || "").trim().toUpperCase();
    if (!c && !n) return false;
    if (c.startsWith("KM") || n.startsWith("KM")) return true;
    if (/\bKM\b/i.test(c) || /\bKM\b/i.test(n)) return true;
    if (n.includes("HÀNG DỪNG") || n.includes("NGỪNG KINH DOANH") || n.includes("HANG DUNG") || n.includes("NGUNG KINH DOANH")) return true;
    return false;
  }

  async loadProducts(force = false) {
    this.pickerLoading = true;
    this.pickerError = "";
    try {
      // 1. Thử lấy danh mục sản phẩm từ Firebase Realtime Database (/product_catalog.json) nếu không bắt buộc forceRefresh
      if (!force) {
        const catalog = await this.firebaseCache.getProductCatalog();
        if (catalog && Array.isArray(catalog.items) && catalog.items.length > 0) {
          this.products = catalog.items
            .map((p: any) => {
              const code = String(p.c || p.code || p.ProductID || "").trim();
              const name = String(p.n || p.name || p.ProductName || "").trim();
              return { code, name, key: NationalStockComponent.normalize(`${code} ${name}`) };
            })
            .filter((p) => !NationalStockComponent.isKmOrOff(p.code, p.name));
          console.log(`[National Stock] Đã tải ${this.products.length} sản phẩm sạch từ Firebase product_catalog cache!`);
          return;
        }
      }

      // 2. Fallback hoặc khi bấm "Tải lại": gọi trực tiếp API UPharma
      const session: any = this.upharma.ensureLogin();
      const res: any = await this.upharma.callEndpoint(
        "/Product/GetItemLstWithFollower",
        {
          NumberRow: 0,
          PageNumber: 0,
          ProductType: "",
          Search: "",
          Token: session.Token,
          uPharmaID: String(session.UserInfo?.uPharmaID ?? ""),
          _bypassFirebase: true,
        },
        { cache: true, forceRefresh: force },
      );
      const raw: any[] = Array.isArray(res)
        ? res
        : res?.ItemLst || res?.ProductLst || res?.Data || res?.data || res?.DataLst ||
          (Object.values(res || {}).find((v) => Array.isArray(v)) as any[]) || [];

      const seen = new Set<string>();
      const list: ProductItem[] = [];
      for (const p of raw) {
        const code = String(p.ProductID ?? p.ProductCode ?? p.ItemID ?? p.Code ?? "").trim();
        const name = String(p.ProductName ?? p.ItemName ?? p.Name ?? "").trim();
        if (!code || seen.has(code) || NationalStockComponent.isKmOrOff(code, name)) continue;
        seen.add(code);
        list.push({ code, name, key: NationalStockComponent.normalize(`${code} ${name}`) });
      }
      this.products = list;
    } catch (e) {
      this.pickerError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pickerLoading = false;
    }
  }

  pickOne(code: string) {
    this.picked = code;
    this.confirmPick();
  }

  confirmPick() {
    if (!this.picked) return;
    this.productId = this.picked;
    this.pickerOpen = false;
    this.search();
  }

  // ===== Tra cứu tồn kho =====
  async search() {
    const code = this.productId.trim();
    if (!code) return;
    this.loading = true;
    this.error = "";
    this.rows = [];
    try {
      const session: any = this.upharma.ensureLogin();
      const res: any = await this.upharma.callEndpoint("/Report/GetExistProductLst", {
        Token: session.Token,
        uPharmaID: String(session.UserInfo?.uPharmaID ?? ""),
        ProductID: code,
      });
      const raw: any[] = Array.isArray(res)
        ? res
        : res?.InventoryLst || res?.ExistProductLst || res?.StoreLst || res?.Data || res?.data || res?.DataLst || [];
      const fallbackName = this.products.find((p) => p.code === code)?.name || "";

      this.rows = raw
        .map((s) => {
          const storeCode = String(s.StoreCode || s.ShopCode || "").trim();
          const storeType = String(s.StoreType || "").trim();
          return {
            ProductID: String(s.ProductID || code).trim(),
            ProductName: String(s.ProductName || s.ItemName || fallbackName).trim(),
            StoreCode: storeCode,
            StoreName: String(s.StoreName || s.ShopName || storeCode).trim(),
            StoreType: storeType,
            Quantity: Number(s.QuantityExist ?? s.Quantity ?? 0) || 0,
            QuantityAVG: Number(s.QuantityAVG ?? s.AVGQuantity ?? 0) || 0,
            UnitOfMeasure: String(s.UnitOfMeasure || s.Unit || ""),
            isWarehouse:
              storeType.toLowerCase().includes("kho") ||
              storeCode.toUpperCase().startsWith("KHO") ||
              ["DN", "HN", "HCM", "NGHEAN", "TMDT"].includes(storeCode.toUpperCase()),
          } as StockRow;
        })
        .filter((r) => r.StoreCode);
      this.searched = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }
}
