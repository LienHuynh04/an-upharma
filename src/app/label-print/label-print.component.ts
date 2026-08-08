import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";

interface LabelItem {
  id: number;
  labelType: "normal" | "promotion";
  title: string;
  subTitle: string;
  oldPrice: string;
  price: string;
  productCode: string;
  startDate: string;
  endDate: string;
  discount: string;
}

@Component({
  selector: "app-label-print",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="page-inner label-page">
  <section class="label-hero">
    <div>
      <h1>In tem</h1>
      <p>Thêm dòng, sửa thông tin trên tem và xem preview bên phải trước khi in.</p>
    </div>
    <div class="label-actions">
      <button type="button" class="btn btn-secondary" (click)="addItem()">+ Thêm tem</button>
      <button type="button" class="btn btn-primary" (click)="addQuickPromotion()">+ Tem khuyến mãi</button>
    </div>
  </section>

  <section class="label-workspace">
    <aside class="label-editor">
      <div class="editor-header">
        <strong>Danh sách tem</strong>
        <small>{{ items.length }} tem</small>
      </div>

      <div class="editor-list">
        <article
          class="editor-card"
          *ngFor="let item of items"
          [class.is-active]="item.id === selectedItemId"
          (click)="selectItem(item.id)"
        >
          <div class="editor-card-top">
            <strong>{{ item.title }}</strong>
            <button type="button" class="icon-btn" (click)="duplicateItem(item); $event.stopPropagation()">⎘</button>
            <button type="button" class="icon-btn danger" (click)="removeItem(item.id); $event.stopPropagation()">×</button>
          </div>
          <small>{{ item.subTitle || 'Chưa có mô tả' }}</small>
          <div class="editor-mini">
            <span>{{ item.productCode }}</span>
            <span>{{ item.price }}</span>
          </div>
        </article>
      </div>

      <div class="editor-form" *ngIf="selectedItem as current">
        <label>
          Loại tem
          <select [(ngModel)]="current.labelType">
            <option value="normal">Tem thường</option>
            <option value="promotion">Tem khuyến mãi</option>
          </select>
        </label>
        <label>
          Tiêu đề
          <input [(ngModel)]="current.title" type="text" placeholder="Tên sản phẩm" />
        </label>
        <label>
          Mô tả
          <input [(ngModel)]="current.subTitle" type="text" placeholder="Khuyến mãi / mô tả" />
        </label>
        <label>
          Giá cũ
          <input [(ngModel)]="current.oldPrice" type="text" placeholder="89.000đ" />
        </label>
        <label>
          Giá mới
          <input [(ngModel)]="current.price" type="text" placeholder="69.000đ" />
        </label>
        <label>
          Mã SP
          <input [(ngModel)]="current.productCode" type="text" placeholder="SP002" />
        </label>
        <div class="two-cols">
          <label>
            Từ ngày
            <input [(ngModel)]="current.startDate" type="text" placeholder="01/08/2026" />
          </label>
          <label>
            Đến ngày
            <input [(ngModel)]="current.endDate" type="text" placeholder="31/08/2026" />
          </label>
        </div>
        <label>
          Giảm giá
          <input [(ngModel)]="current.discount" type="text" placeholder="-22%" />
        </label>
        <div class="switch-row">
          <label class="switch">
            <input type="checkbox" [(ngModel)]="showBrandName" />
            <span>Hiện tên UPHARMA</span>
          </label>
          <label class="switch">
            <input type="checkbox" [(ngModel)]="showCutLine" />
            <span>Đường cắt nét đứt</span>
          </label>
        </div>
      </div>
    </aside>

    <section class="label-preview">
      <div class="paper-toolbar">
        <span>Preview A4</span>
        <div class="paper-settings">
          <label>
            Lề trang (mm)
            <input type="number" [(ngModel)]="pageMargin" />
          </label>
          <label>
            Khoảng cách tem (mm)
            <input type="number" step="0.1" [(ngModel)]="gap" />
          </label>
        </div>
      </div>

      <div class="sheet" [style.padding.mm]="pageMargin">
        <div class="sheet-grid" [style.gap.mm]="gap">
          <article class="sheet-cell" *ngFor="let item of items">
            <div class="label-card" [class.promotion]="item.labelType === 'promotion'">
              <div class="label-top" [class.promotion]="item.labelType === 'promotion'">
                <strong>{{ item.subTitle || 'TEM' }}</strong>
                <span *ngIf="item.discount">{{ item.discount }}</span>
              </div>
              <div class="label-body">
                <div class="brand-line" *ngIf="showBrandName">UPHARMA</div>
                <div class="label-title">{{ item.title }}</div>
                <div class="price-row">
                  <del *ngIf="item.oldPrice">{{ item.oldPrice }}</del>
                  <strong>{{ item.price }}</strong>
                </div>
                <div class="footer-row">
                  <span>Mã SP: {{ item.productCode }}</span>
                  <span *ngIf="item.startDate || item.endDate">Áp dụng {{ item.startDate }} - {{ item.endDate }}</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  </section>
</div>
  `,
  styleUrls: ["./label-print.component.css"],
})
export class LabelPrintComponent implements OnInit {
  items: LabelItem[] = [];
  selectedItemId: number | null = null;
  showBrandName = true;
  showCutLine = true;
  pageMargin = 5;
  gap = 1.5;

  ngOnInit(): void {
    this.items = [
      {
        id: Date.now(),
        labelType: "promotion",
        title: "VITAMIN C SỦI 1000MG",
        subTitle: "KHUYẾN MÃI",
        oldPrice: "89.000",
        price: "69.000",
        productCode: "SP002",
        startDate: "01/08/2026",
        endDate: "31/08/2026",
        discount: "-22%",
      },
    ];
    this.selectedItemId = this.items[0]?.id ?? null;
  }

  get selectedItem(): LabelItem | undefined {
    return this.items.find((item) => item.id === this.selectedItemId) || this.items[0];
  }

  addItem(): void {
    const next: LabelItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      labelType: "normal",
      title: "TÊN SẢN PHẨM",
      subTitle: "Nội dung tem",
      oldPrice: "0",
      price: "0",
      productCode: "SP000",
      startDate: "",
      endDate: "",
      discount: "",
    };

    this.items = [next, ...this.items];
    this.selectedItemId = next.id;
  }

  duplicateItem(item: LabelItem): void {
    const copy: LabelItem = {
      ...item,
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: `${item.title} (copy)`,
    };
    this.items = [copy, ...this.items];
    this.selectedItemId = copy.id;
  }

  removeItem(itemId: number): void {
    this.items = this.items.filter((item) => item.id !== itemId);
    if (this.selectedItemId === itemId) {
      this.selectedItemId = this.items[0]?.id ?? null;
    }
  }

  selectItem(itemId: number): void {
    this.selectedItemId = itemId;
  }

  addQuickPromotion(): void {
    this.items.unshift({
      id: Date.now() + 999,
      labelType: "promotion",
      title: "TEM KHUYẾN MÃI",
      subTitle: "ÁP DỤNG TRONG THÁNG",
      oldPrice: "99.000",
      price: "79.000",
      productCode: "SP999",
      startDate: "01/08/2026",
      endDate: "31/08/2026",
      discount: "-20%",
    });
    this.selectedItemId = this.items[0]?.id ?? null;
  }
}
