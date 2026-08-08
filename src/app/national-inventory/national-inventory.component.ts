import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { normalizeFilterText, PRODUCT_NAME_COLLATOR } from "../inventory-utils";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

interface NationalInventoryRow {
  rowKey: string;
  shopCode: string;
  shopName: string;
  productCode: string;
  productName: string;
  quantity: number;
  quantityText: string;
  unit: string;
  sourceProducts: string[];
}

@Component({
  selector: "app-national-inventory",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <main class="national-inventory-page">
      <section class="inventory-header">
        <div>
          <p class="eyebrow">Tồn kho toàn quốc</p>
          <h1>Tồn kho theo sản phẩm và shop</h1>
          <p class="subcopy">Lấy danh sách mã tồn kho trước, rồi gọi tuần tự từng mã qua API tồn kho theo sản phẩm và theo shop.</p>
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" (click)="reload()" [disabled]="loading">Tải lại</button>
          <button type="button" class="btn btn-primary" (click)="toggleFilters()">
            {{ filtersOpen ? "Ẩn bộ lọc" : "Hiện bộ lọc" }}
          </button>
        </div>
      </section>

      <section class="inventory-cache-status" *ngIf="statusText || loading">
        <div class="inventory-cache-status-copy">
          <span>{{ loading ? "Đang tải" : "Trạng thái dữ liệu" }}</span>
          <strong>{{ statusText || "Đang dựng bảng tồn kho toàn quốc..." }}</strong>
        </div>
        <div class="inventory-cache-progress" [class.is-running]="loading" aria-hidden="true">
          <i [style.width.%]="progress"></i>
        </div>
      </section>

      <section class="table-card inventory-table-card" [class.filters-collapsed]="!filtersOpen">
        <div class="table-toolbar">
          <div>
            <h2>Xem trước</h2>
            <p>{{ filteredRows.length }} dòng · {{ loadedProductCodes.size }} mã đã đọc</p>
          </div>
          <input type="search" [(ngModel)]="searchText" (ngModelChange)="applyLocalFilter()" placeholder="Tìm theo tên hoặc mã SP" />
        </div>

        <div class="table-wrap">
          <table class="inventory-table">
            <thead>
              <tr>
                <th>STT</th>
                <th>NHÀ THUỐC</th>
                <th>MÃ SP</th>
                <th>TÊN SP</th>
                <th>TỒN</th>
                <th>ĐƠN VỊ</th>
                <th>MÃ NGUỒN</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRows; let i = index">
                <td>{{ i + 1 }}</td>
                <td><strong>{{ row.shopCode }}</strong><div class="muted">{{ row.shopName }}</div></td>
                <td><strong>{{ row.productCode }}</strong></td>
                <td>{{ row.productName }}</td>
                <td class="num">{{ row.quantityText }}</td>
                <td>{{ row.unit || "--" }}</td>
                <td>
                  <span class="source-chip" *ngFor="let code of row.sourceProducts">{{ code }}</span>
                </td>
              </tr>
              <tr *ngIf="!loading && filteredRows.length === 0">
                <td colspan="7" class="empty-state">Chưa có dữ liệu phù hợp.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  `,
  styles: [`
    .national-inventory-page { padding: 24px; display: grid; gap: 16px; }
    .inventory-header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
    .eyebrow { text-transform: uppercase; letter-spacing: .12em; color: #d39a2c; margin: 0 0 6px; font-weight: 700; }
    h1 { margin: 0; font-size: 28px; }
    .subcopy { margin: 8px 0 0; color: #b9aa92; max-width: 900px; }
    .actions { display:flex; gap: 10px; flex-wrap: wrap; }
    .table-card { background: rgba(28, 20, 12, .82); border: 1px solid rgba(255,255,255,.08); border-radius: 18px; padding: 16px; }
    .table-toolbar { display:flex; justify-content:space-between; gap: 12px; align-items:center; margin-bottom: 12px; }
    .table-toolbar h2 { margin:0; font-size: 18px; }
    .table-toolbar p { margin: 4px 0 0; color: #b8a990; }
    .table-toolbar input { min-width: 280px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.04); color: #fff; padding: 10px 12px; }
    .table-wrap { overflow:auto; }
    .inventory-table { width:100%; border-collapse: collapse; }
    .inventory-table th, .inventory-table td { padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,.06); vertical-align: top; text-align: left; }
    .inventory-table th { color: #d8c7aa; font-size: 12px; letter-spacing: .08em; }
    .num { text-align:right; font-weight: 700; }
    .muted { color: #a89272; font-size: 12px; margin-top: 4px; }
    .source-chip { display:inline-flex; margin: 0 6px 6px 0; padding: 4px 8px; border-radius: 999px; background: rgba(72, 102, 160, .22); color: #9eb8ff; font-size: 12px; }
    .empty-state { text-align:center; padding: 28px 0; color: #c8b79f; }
    .inventory-cache-status { background: rgba(18, 34, 25, .9); border-radius: 16px; padding: 14px 16px; }
    .inventory-cache-status-copy { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom: 10px; }
    .inventory-cache-progress { height: 10px; border-radius: 999px; background: rgba(255,255,255,.08); overflow:hidden; }
    .inventory-cache-progress i { display:block; height:100%; background: linear-gradient(90deg, #32d583, #73e2a3); width: 0; }
    .btn { border:none; border-radius: 12px; padding: 10px 14px; font-weight: 700; cursor:pointer; }
    .btn-primary { background:#d39a2c; color:#1f1308; }
    .btn-secondary { background: rgba(255,255,255,.08); color:#fff; }
    @media (max-width: 900px) {
      .inventory-header, .table-toolbar, .inventory-cache-status-copy { flex-direction: column; align-items: stretch; }
      .table-toolbar input { min-width: 0; width: 100%; }
    }
  `],
})
export class NationalInventoryComponent implements OnInit {
  rows: NationalInventoryRow[] = [];
  filteredRows: NationalInventoryRow[] = [];
  loading = false;
  progress = 0;
  statusText = "Đang chuẩn bị dữ liệu tồn kho toàn quốc...";
  filtersOpen = true;
  searchText = "";
  private shops: ShopInfo[] = [];
  loadedProductCodes = new Set<string>();

  constructor(private readonly upharmaService: UpharmaService, private readonly router: Router) {}

  ngOnInit(): void {
    void this.loadNationalInventory();
  }

  async reload(): Promise<void> {
    await this.loadNationalInventory(true);
  }

  toggleFilters(): void {
    this.filtersOpen = !this.filtersOpen;
  }

  applyLocalFilter(): void {
    const query = normalizeFilterText(this.searchText);
    this.filteredRows = this.rows.filter((row) => {
      if (!query) return true;
      return normalizeFilterText([row.productName, row.productCode, row.shopCode, row.shopName].join(" ")).includes(query);
    });
  }

  private async loadNationalInventory(force = false): Promise<void> {
    if (this.loading && !force) {
      return;
    }

    this.loading = true;
    this.progress = 10;
    this.statusText = "Đang lấy danh sách shop...";

    try {
      const session = this.upharmaService.ensureLogin();
      this.shops = this.upharmaService.getActiveShops();
      const collected: NationalInventoryRow[] = [];

      for (let shopIndex = 0; shopIndex < this.shops.length; shopIndex += 1) {
        const shop = this.shops[shopIndex];
        this.progress = Math.max(this.progress, 15 + Math.round((shopIndex / Math.max(this.shops.length, 1)) * 20));
        this.statusText = `Đang lấy mã tồn kho của ${shop.ShopCode}...`;

        const productIds = await this.fetchExistProductIds(shop);
        this.loadedProductCodes.add(`${shop.ShopCode}:${productIds.length}`);

        for (let i = 0; i < productIds.length; i += 1) {
          const productId = productIds[i];
          this.statusText = `Đang lấy tồn kho ${productId} ở ${shop.ShopCode}...`;
          this.progress = 35 + Math.round((i / Math.max(productIds.length, 1)) * 55);

          const detailRows = await this.fetchExistProductByShop(shop, productId);
          for (const detail of detailRows) {
            collected.push(detail);
          }
        }
      }

      collected.sort((a, b) => PRODUCT_NAME_COLLATOR.compare(a.productName, b.productName));
      this.rows = collected;
      this.applyLocalFilter();
      this.progress = 100;
      this.statusText = `Đã dựng xong bảng tồn kho toàn quốc cho ${session.UserInfo.FullName}.`;
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : String(error);
      this.rows = [];
      this.filteredRows = [];
      this.progress = 100;
    } finally {
      this.loading = false;
    }
  }

  private async fetchExistProductIds(shop: ShopInfo): Promise<string[]> {
    const session = this.upharmaService.ensureLogin();
    const response = await this.upharmaService.callEndpoint<unknown>("/Report/GetExistProductLst", {
      Token: session.Token,
      uPharmaID: session.UserInfo.uPharmaID,
      ShopCode: shop.ShopCode,
      ShopLst: shop.ShopCode,
      ProductID: "",
    });

    return this.extractRows(response)
      .map((row) => String(row["ProductID"] || row["ProductCode"] || row["Product_ID"] || row["MaSP"] || row["Code"] || "").trim())
      .filter(Boolean);
  }

  private async fetchExistProductByShop(shop: ShopInfo, productId: string): Promise<NationalInventoryRow[]> {
    const session = this.upharmaService.ensureLogin();
    const response = await this.upharmaService.callEndpoint<unknown>("/Report/GetExistProductByShop", {
      Token: session.Token,
      uPharmaID: session.UserInfo.uPharmaID,
      ShopCode: shop.ShopCode,
      ShopLst: shop.ShopCode,
      ProductID: productId,
    });

    return this.extractRows(response).map((row, index) => ({
      rowKey: [shop.ShopCode, productId, index].join("|"),
      shopCode: shop.ShopCode,
      shopName: shop.ShopName,
      productCode: String(row["ProductID"] || row["ProductCode"] || productId || "").trim(),
      productName: String(row["ProductName"] || row["Product_Name"] || row["Name"] || row["ItemName"] || productId).trim(),
      quantity: Number(row["Quantity"] ?? row["QuantityExist"] ?? row["ExistQuantity"] ?? 0),
      quantityText: String(row["Quantity"] ?? row["QuantityExist"] ?? row["ExistQuantity"] ?? 0),
      unit: String(row["UnitOfMeasure"] || row["UnitName"] || row["Unit"] || row["DonVi"] || row["DVT"] || ""),
      sourceProducts: [productId],
    }));
  }

  private extractRows(response: unknown): RawRecord[] {
    if (Array.isArray(response)) {
      return response as RawRecord[];
    }

    if (response && typeof response === "object") {
      const record = response as Record<string, unknown>;
      for (const key of ["data", "Data", "Rows", "Table", "ListData", "ExistProductLst", "ExistProductByShopLst"]) {
        const value = record[key];
        if (Array.isArray(value)) {
          return value as RawRecord[];
        }
      }
    }

    return [];
  }
}
