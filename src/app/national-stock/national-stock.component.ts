import { CommonModule } from "@angular/common";
import { Component, HostListener, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UpharmaService } from "../upharma.service";
import { FirebaseInventoryService } from "../firebase-inventory.service";
import { NationalInventoryService } from "../national-inventory.service";

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
      --ns-bg: var(--tblr-bg-surface, #ffffff);
      --ns-bg-soft: var(--tblr-bg-surface-secondary, #f8fafc);
      --ns-border: var(--tblr-border-color, rgba(98, 105, 118, 0.16));
      --ns-text: var(--tblr-body-color, #1d273b);
      --ns-muted: var(--tblr-secondary, #667382);
      --ns-primary: var(--tblr-primary, #206bc4);
      --ns-primary-soft: rgba(32, 107, 196, 0.12);
      --ns-hover: rgba(32, 107, 196, 0.06);
      display: block;
      color: var(--ns-text);
      font-family: inherit;
    }

    .ns-container {
      padding: 1rem;
      max-width: 100%;
    }

    /* Top Bar - Form tra cứu */
    .ns-bar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: var(--ns-bg);
      border: 1px solid var(--ns-border);
      border-radius: 6px;
      padding: 0.625rem 0.875rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .ns-bar-label {
      font-weight: 500;
      font-size: 0.875rem;
      color: var(--ns-text);
      white-space: nowrap;
    }
    .ns-field {
      display: flex;
      align-items: center;
      width: 240px;
      max-width: 100%;
    }
    .ns-field input {
      flex: 1;
      min-width: 0;
      height: 34px;
      padding: 0 0.625rem;
      font-size: 0.875rem;
      background: var(--ns-bg);
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      border-right: 0;
      border-radius: 4px 0 0 4px;
      outline: none;
    }
    .ns-field input:focus {
      border-color: var(--ns-primary);
    }
    .ns-pick {
      width: 36px;
      height: 34px;
      display: grid;
      place-items: center;
      font-size: 1rem;
      background: var(--ns-bg-soft);
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      border-radius: 0 4px 4px 0;
      cursor: pointer;
    }
    .ns-pick:hover {
      color: var(--ns-primary);
      border-color: var(--ns-primary);
    }
    .ns-check {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.8125rem;
      color: var(--ns-muted);
      cursor: pointer;
      margin: 0 0 0 0.5rem;
    }
    .ns-btn {
      height: 34px;
      padding: 0 1rem;
      border: 0;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.875rem;
      background: var(--ns-primary);
      color: #ffffff;
      cursor: pointer;
      white-space: nowrap;
    }
    .ns-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .ns-selected {
      font-size: 0.8125rem;
      color: var(--ns-muted);
      margin: -0.5rem 0 0.75rem;
    }
    .ns-selected b {
      color: var(--ns-text);
    }

    /* Card Bảng dữ liệu chính */
    .ns-card {
      background: var(--ns-bg);
      border: 1px solid var(--ns-border);
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .ns-card-title {
      text-align: center;
      font-weight: 700;
      font-size: 1rem;
      color: var(--ns-primary);
      padding: 0.625rem 1rem;
      background: var(--ns-bg);
      border-bottom: 1px solid var(--ns-border);
    }
    .ns-scroll {
      max-height: 65vh;
      overflow: auto;
    }

    table.ns-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8125rem;
    }
    .ns-table th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--ns-bg-soft);
      color: var(--ns-text);
      font-weight: 600;
      text-align: left;
      padding: 0.5rem 0.625rem;
      border: 1px solid var(--ns-border);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    .ns-table th.num, .ns-table td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .ns-table td {
      padding: 0.4375rem 0.625rem;
      border: 1px solid var(--ns-border);
      color: var(--ns-text);
    }
    .ns-table tbody tr.ns-row:hover td {
      background: var(--ns-hover);
    }
    .ns-table td.idx {
      color: var(--ns-muted);
      width: 44px;
      text-align: center;
    }
    .ns-table td.nowrap {
      white-space: nowrap;
    }
    .ns-table td.zero {
      color: var(--ns-muted);
    }
    .ns-table td.pos {
      font-weight: 600;
      color: var(--ns-primary);
    }
    .ns-group td {
      background: var(--ns-bg-soft);
      color: var(--ns-text);
      font-weight: 600;
      position: sticky;
      top: 33px;
      z-index: 1;
      border: 1px solid var(--ns-border);
    }
    .ns-group small {
      color: var(--ns-muted);
      font-weight: 400;
      margin-left: 0.5rem;
    }
    .ns-sort {
      font-size: 0.7rem;
      margin-left: 0.25rem;
    }

    .ns-foot {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--ns-border);
      background: var(--ns-bg-soft);
    }
    .ns-foot input {
      height: 32px;
      width: 260px;
      max-width: 100%;
      padding: 0 0.625rem;
      font-size: 0.8125rem;
      border-radius: 4px;
      background: var(--ns-bg);
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      outline: none;
    }
    .ns-foot input:focus {
      border-color: var(--ns-primary);
    }
    .ns-foot span {
      margin-left: auto;
      color: var(--ns-muted);
      font-size: 0.8125rem;
    }
    .ns-empty {
      text-align: center;
      color: var(--ns-muted);
      padding: 2rem 1rem;
    }
    .ns-error {
      border: 1px solid var(--tblr-danger, #ef4444);
      color: var(--tblr-danger, #dc2626);
      border-radius: 6px;
      padding: 0.625rem 0.875rem;
      margin-bottom: 1rem;
      font-size: 0.875rem;
      background: rgba(239, 68, 68, 0.1);
    }

    /* Modal Chọn sản phẩm */
    .ns-overlay {
      position: fixed;
      inset: 0;
      z-index: 1055;
      background: rgba(15, 23, 42, 0.5);
      display: grid;
      place-items: center;
      padding: 1rem;
    }
    .ns-modal {
      width: min(760px, 100%);
      max-height: calc(100vh - 2rem);
      display: flex;
      flex-direction: column;
      background: var(--ns-bg);
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      border-radius: 8px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2);
    }
    .ns-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--ns-border);
    }
    .ns-modal-head h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }
    .ns-x {
      background: none;
      border: 0;
      color: var(--ns-muted);
      font-size: 1.5rem;
      line-height: 1;
      cursor: pointer;
    }
    .ns-x:hover {
      color: var(--ns-text);
    }
    .ns-modal-tools {
      display: flex;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
    }
    .ns-modal-tools input {
      flex: 1;
      min-width: 0;
      height: 34px;
      padding: 0 0.75rem;
      font-size: 0.875rem;
      border-radius: 4px;
      background: var(--ns-bg);
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      outline: none;
    }
    .ns-modal-tools input:focus {
      border-color: var(--ns-primary);
    }
    .ns-btn-ghost {
      height: 34px;
      padding: 0 0.875rem;
      border-radius: 4px;
      font-size: 0.8125rem;
      cursor: pointer;
      background: transparent;
      color: var(--ns-text);
      border: 1px solid var(--ns-border);
      white-space: nowrap;
    }
    .ns-btn-ghost:hover {
      border-color: var(--ns-primary);
      color: var(--ns-primary);
    }
    .ns-modal-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      margin: 0 1rem 0.75rem;
      border: 1px solid var(--ns-border);
      border-radius: 4px;
    }
    .ns-modal-body table td {
      cursor: pointer;
    }
    .ns-modal-body tr.on td {
      background: var(--ns-primary-soft);
    }
    .ns-modal-body input[type=radio] {
      accent-color: var(--ns-primary);
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
    .ns-modal-foot {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--ns-border);
    }
    .ns-modal-foot .info {
      margin-right: auto;
      color: var(--ns-muted);
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ns-more {
      background: none;
      border: 0;
      color: var(--ns-primary);
      font-size: 0.8125rem;
      cursor: pointer;
    }

    @media (max-width: 767.98px) {
      .ns-bar {
        flex-direction: column;
        align-items: stretch;
      }
      .ns-field {
        width: 100%;
      }
      .ns-overlay {
        padding: 0;
      }
      .ns-modal {
        width: 100%;
        height: 100%;
        max-height: none;
        border-radius: 0;
        border: 0;
      }
      .ns-modal-body {
        margin: 0;
        border-radius: 0;
        border-left: 0;
        border-right: 0;
      }
    }
  `],
  template: `
    <div class="ns-container">
      <!-- Top Bar: Tìm kiếm mã sản phẩm -->
      <form class="ns-bar" (ngSubmit)="search()">
        <span class="ns-bar-label">Mã sản phẩm</span>
        <div class="ns-field">
          <input
            id="ns-product"
            name="productId"
            [(ngModel)]="productId"
            placeholder="Nhập mã SP..."
            autocomplete="off"
            aria-label="Mã sản phẩm"
          />
          <button
            id="ns-pick"
            class="ns-pick"
            type="button"
            (click)="openPicker()"
            title="Chọn sản phẩm"
            aria-label="Chọn sản phẩm"
          >⋯</button>
        </div>



        <button
          id="ns-search"
          class="ns-btn"
          type="submit"
          [disabled]="loading || !productId.trim()"
        >
          {{ loading ? 'Đang tải…' : 'Xem tồn' }}
        </button>
      </form>

      <div class="ns-selected" *ngIf="selectedName">
        Sản phẩm: <b>{{ productId }}</b> — {{ selectedName }}
      </div>

      <div class="ns-error" *ngIf="error">{{ error }}</div>

      <!-- Main Table Card -->
      <section class="ns-card" *ngIf="searched && !loading && !error">
        <div class="ns-card-title">Danh sách kho</div>

        <div class="ns-foot">
          <input
            id="ns-filter"
            name="filter"
            [(ngModel)]="filter"
            placeholder="Lọc theo mã / tên kho..."
          />
          <span>{{ view.length }} điểm kho · Tổng tồn <b>{{ totalQty | number }}</b></span>
        </div>

        <div class="ns-scroll ns-table-wrap">
          <table class="ns-table">
            <thead>
              <tr>
                <th style="width: 40px; cursor: default"></th>
                <th (click)="sortBy('ProductID')">Mã sản phẩm<span class="ns-sort">{{ arrow('ProductID') }}</span></th>
                <th (click)="sortBy('ProductName')">Tên sản phẩm<span class="ns-sort">{{ arrow('ProductName') }}</span></th>
                <th class="num" (click)="sortBy('Quantity')">Số lượng<span class="ns-sort">{{ arrow('Quantity') }}</span></th>
                <th class="num" (click)="sortBy('QuantityAVG')">TT/Tháng<span class="ns-sort">{{ arrow('QuantityAVG') }}</span></th>
                <th style="cursor: default">Đơn vị</th>
                <th (click)="sortBy('StoreCode')">Mã kho<span class="ns-sort">{{ arrow('StoreCode') }}</span></th>
                <th (click)="sortBy('StoreName')">Tên kho<span class="ns-sort">{{ arrow('StoreName') }}</span></th>
                <th (click)="sortBy('StoreType')">Loại kho<span class="ns-sort">{{ arrow('StoreType') }}</span></th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngFor="let g of groups; trackBy: trackGroup">
                <tr class="ns-group">
                  <td colspan="9">
                    Loại kho: {{ g.type }}
                    <small>{{ g.rows.length }} điểm · tổng tồn {{ g.qty | number }}</small>
                  </td>
                </tr>
                <tr class="ns-row" *ngFor="let r of g.rows; trackBy: trackRow">
                  <td class="idx">{{ r.idx }}</td>
                  <td class="nowrap">{{ r.ProductID }}</td>
                  <td>{{ r.ProductName }}</td>
                  <td class="num" [class.pos]="r.Quantity > 0" [class.zero]="r.Quantity <= 0">
                    {{ r.Quantity | number }}
                  </td>
                  <td class="num">{{ r.QuantityAVG | number:'1.2-2' }}</td>
                  <td class="nowrap">{{ r.UnitOfMeasure }}</td>
                  <td class="nowrap">{{ r.StoreCode }}</td>
                  <td>{{ r.StoreName }}</td>
                  <td class="nowrap">{{ r.StoreType }}</td>
                </tr>
              </ng-container>
            </tbody>
          </table>
          <div class="ns-empty" *ngIf="groups.length === 0">Không có dữ liệu tồn kho.</div>
        </div>
      </section>
    </div>

    <!-- Modal chọn 1 sản phẩm -->
    <div class="ns-overlay" *ngIf="pickerOpen" (click)="closePicker()">
      <div
        class="ns-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ns-picker-title"
        (click)="$event.stopPropagation()"
      >
        <div class="ns-modal-head">
          <h3 id="ns-picker-title">Lựa chọn sản phẩm</h3>
          <button class="ns-x" type="button" (click)="closePicker()" aria-label="Đóng">×</button>
        </div>

        <div class="ns-modal-tools">
          <input
            id="ns-picker-search"
            [(ngModel)]="pickerSearch"
            (ngModelChange)="pickerLimit = 200"
            placeholder="Tìm mã hoặc tên sản phẩm..."
            autocomplete="off"
          />
          <button class="ns-btn-ghost" type="button" (click)="pickerSearch = ''">Xoá</button>
        </div>

        <div class="ns-error" style="margin: 0 1rem 0.75rem" *ngIf="pickerError">{{ pickerError }}</div>

        <div class="ns-modal-body">
          <div class="ns-empty" *ngIf="pickerLoading">Đang tải danh sách sản phẩm…</div>
          <table class="ns-table" *ngIf="!pickerLoading">
            <thead>
              <tr>
                <th style="width: 40px; cursor: default"></th>
                <th style="width: 140px; cursor: default">Mã sản phẩm</th>
                <th style="cursor: default">Tên sản phẩm</th>
              </tr>
            </thead>
            <tbody>
              <tr
                class="ns-row"
                *ngFor="let p of pickerView; trackBy: trackProduct"
                [class.on]="picked === p.code"
                (click)="picked = p.code"
                (dblclick)="pickOne(p.code)"
              >
                <td>
                  <input
                    type="radio"
                    name="ns-product-radio"
                    [checked]="picked === p.code"
                    (change)="picked = p.code"
                    [attr.aria-label]="p.code"
                  />
                </td>
                <td class="nowrap">{{ p.code }}</td>
                <td>{{ p.name }}</td>
              </tr>
            </tbody>
          </table>
          <div class="ns-empty" *ngIf="!pickerLoading && pickerFiltered.length === 0">Không tìm thấy sản phẩm.</div>
          <div
            class="ns-empty"
            style="padding: 0.5rem"
            *ngIf="!pickerLoading && pickerFiltered.length > pickerLimit"
          >
            <button class="ns-more" type="button" (click)="pickerLimit = pickerLimit + 200">
              Xem thêm ({{ pickerFiltered.length - pickerLimit }} còn lại)
            </button>
          </div>
        </div>

        <div class="ns-modal-foot">
          <div class="info" *ngIf="pickedObject">Đã chọn: <b>{{ pickedObject.code }}</b> — {{ pickedObject.name }}</div>
          <div class="info" *ngIf="!pickedObject">Chưa chọn sản phẩm nào.</div>
          <button class="ns-btn-ghost" type="button" (click)="closePicker()">Hủy</button>
          <button class="ns-btn" type="button" [disabled]="!picked" (click)="confirmPick()">Đồng ý</button>
        </div>
      </div>
    </div>
  `,
})
export class NationalStockComponent implements OnInit {
  private upharma = inject(UpharmaService);
  private firebaseCache = inject(FirebaseInventoryService);
  private nationalInventory = inject(NationalInventoryService);

  productId = "";
  selectedName = "";
  filter = "";
  loading = false;
  error = "";
  searched = false;

  sortField: keyof StockRow = "Quantity";
  sortAsc = false;

  rawRows: StockRow[] = [];
  products: ProductItem[] = [];

  pickerOpen = false;
  pickerLoading = false;
  pickerError = "";
  pickerSearch = "";
  picked = "";
  pickerLimit = 200;

  ngOnInit() {
    this.loadProducts(false);
  }

  static normalize(str: string): string {
    return (str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  }

  static isKmOrOff(code: string, name: string): boolean {
    const c = String(code || "").toUpperCase();
    const n = String(name || "").toUpperCase();
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
      if (!force) {
        const catalog = await this.firebaseCache.getProductCatalog();
        if (catalog && Array.isArray(catalog.items)) {
          this.products = catalog.items
            .map((p: any) => {
              const code = String(p.c || p.code || p.ProductID || "").trim();
              const name = String(p.n || p.name || p.ProductName || "").trim();
              return { code, name, key: NationalStockComponent.normalize(`${code} ${name}`) };
            })
            .filter((p) => !NationalStockComponent.isKmOrOff(p.code, p.name))
            .sort((a, b) => a.name.localeCompare(b.name, "vi"));
          return;
        }
        // Nếu Firebase trả về null và không bấm nút "Tải lại", không tự động gọi API Upharma
        return;
      }

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
      list.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      this.products = list;
    } catch (e) {
      this.pickerError = e instanceof Error ? e.message : String(e);
    } finally {
      this.pickerLoading = false;
    }
  }

  get pickerFiltered(): ProductItem[] {
    const q = NationalStockComponent.normalize(this.pickerSearch.trim());
    if (!q) return this.products;
    return this.products.filter((p) => p.key.includes(q));
  }

  get pickerView(): ProductItem[] {
    return this.pickerFiltered.slice(0, this.pickerLimit);
  }

  get pickedObject(): ProductItem | undefined {
    return this.products.find((p) => p.code === this.picked);
  }

  openPicker() {
    this.pickerOpen = true;
    this.picked = this.productId.trim();
    if (!this.products.length && !this.pickerLoading) {
      this.loadProducts(false);
    }
  }

  closePicker() {
    this.pickerOpen = false;
  }

  pickOne(code: string) {
    this.picked = code;
    this.confirmPick();
  }

  confirmPick() {
    if (!this.picked) return;
    this.productId = this.picked;
    const match = this.products.find((p) => p.code === this.picked);
    if (match) {
      this.selectedName = match.name;
    }
    this.closePicker();
    this.search();
  }

  async search() {
    const code = this.productId.trim();
    if (!code) return;

    this.loading = true;
    this.error = "";
    this.searched = true;
    this.rawRows = [];

    const matchedProd = this.products.find((p) => p.code.toLowerCase() === code.toLowerCase());
    if (matchedProd) {
      this.selectedName = matchedProd.name;
    }

    try {
      const session: any = this.upharma.ensureLogin();
      const res: any = await this.upharma.callEndpoint("/Report/GetExistProductLst", {
        ProductID: code,
        Token: session.Token,
        uPharmaID: String(session.UserInfo?.uPharmaID ?? ""),
        _bypassFirebase: true,
      });

      const rawStores: any[] = Array.isArray(res)
        ? res
        : res?.Data || res?.data || res?.ItemLst || (Object.values(res || {}).find((v) => Array.isArray(v)) as any[]) || [];

      this.rawRows = rawStores.map((s: any) => {
        const storeTypeStr = String(s.StoreType || s["StoreType"] || "").trim();
        const storeCodeStr = String(s.StoreCode || s["StoreCode"] || "").trim();
        const isWh = storeTypeStr.toLowerCase().includes("kho") || storeCodeStr.startsWith("KHO");

        return {
          ProductID: String(s.ProductID || s["ProductID"] || s.ProductCode || s["ProductCode"] || code).trim(),
          ProductName: String(s.ProductName || s["ProductName"] || this.selectedName || "").trim(),
          StoreCode: storeCodeStr,
          StoreName: String(s.StoreName || s["StoreName"] || "").trim(),
          StoreType: storeTypeStr || (isWh ? "Kho tổng" : "Nhà thuốc"),
          Quantity: Number(s.QuantityExist ?? s["QuantityExist"] ?? s.Quantity ?? s["Quantity"] ?? 0),
          QuantityAVG: Number(s.QuantityAVG ?? s["QuantityAVG"] ?? s.AVGQuantity ?? s["AVGQuantity"] ?? s.Quantity ?? 0),
          UnitOfMeasure: String(s.UnitOfMeasure || s["UnitOfMeasure"] || s.Unit || s["Unit"] || "Hộp"),
          isWarehouse: isWh,
        };
      });

      if (!this.selectedName && this.rawRows.length > 0 && this.rawRows[0].ProductName) {
        this.selectedName = this.rawRows[0].ProductName;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  get view(): StockRow[] {
    let list = this.rawRows;
    const f = NationalStockComponent.normalize(this.filter.trim());
    if (f) {
      list = list.filter(
        (r) =>
          NationalStockComponent.normalize(r.StoreCode).includes(f) ||
          NationalStockComponent.normalize(r.StoreName).includes(f) ||
          NationalStockComponent.normalize(r.StoreType).includes(f),
      );
    }

    const field = this.sortField;
    const mult = this.sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[field];
      const vb = b[field];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * mult;
      return String(va ?? "").localeCompare(String(vb ?? "")) * mult;
    });
  }

  get totalQty(): number {
    return this.view.reduce((sum, r) => sum + r.Quantity, 0);
  }

  get groups(): StockGroup[] {
    const map = new Map<string, StockRow[]>();
    for (const r of this.view) {
      const key = r.StoreType || (r.isWarehouse ? "Kho tổng" : "Nhà thuốc");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    const res: StockGroup[] = [];
    let globalIdx = 1;
    for (const [type, rows] of map.entries()) {
      const qty = rows.reduce((s, r) => s + r.Quantity, 0);
      const rowsWithIdx = rows.map((r) => ({ ...r, idx: globalIdx++ }));
      res.push({ type, qty, rows: rowsWithIdx });
    }
    return res;
  }

  sortBy(field: keyof StockRow) {
    if (this.sortField === field) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortField = field;
      this.sortAsc = field === "ProductID" || field === "ProductName" || field === "StoreCode" || field === "StoreName";
    }
  }

  arrow(field: keyof StockRow): string {
    if (this.sortField !== field) return "";
    return this.sortAsc ? " ▲" : " ▼";
  }

  trackGroup(_: number, g: StockGroup) {
    return g.type;
  }

  trackRow(_: number, r: StockRow & { idx: number }) {
    return `${r.StoreCode}-${r.ProductID}`;
  }

  trackProduct(_: number, p: ProductItem) {
    return p.code;
  }

  @HostListener("document:keydown.escape")
  onEsc() {
    if (this.pickerOpen) {
      this.closePicker();
    }
  }
}
