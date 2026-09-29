import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";

export interface ShopTabItem {
  shopCode: string;
  shopName: string;
  count?: number;
  loaded?: boolean;
  loading?: boolean;
}

@Component({
  selector: "app-shop-tabs",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card mb-3" *ngIf="tabs && tabs.length > 0">
      <div class="card-header p-0">
        <ul class="nav nav-tabs card-header-tabs nav-fill w-100 m-0">
          <li class="nav-item" *ngFor="let tab of tabs; trackBy: trackByShopCode">
            <a
              href="javascript:void(0)"
              class="nav-link py-3"
              [class.active]="tab.shopCode === activeShopCode"
              (click)="onSelectShop(tab.shopCode)"
            >
              <i class="ti ti-building-store me-2" style="font-size: 1.15rem;"></i>
              <strong [attr.title]="tab.shopName">{{ tab.shopCode }}</strong>
              <span *ngIf="tab.count !== undefined" class="badge bg-blue-lt ms-2" style="font-size: 0.75rem;">
                {{ tab.count }}
              </span>
              <span *ngIf="tab.loading" class="spinner-border spinner-border-sm ms-2" role="status"></span>
            </a>
          </li>
        </ul>
      </div>
    </div>
  `,
})
export class ShopTabsComponent {
  @Input() tabs: ShopTabItem[] = [];
  @Input() activeShopCode = "";
  @Output() shopSelected = new EventEmitter<string>();

  onSelectShop(shopCode: string): void {
    if (shopCode !== this.activeShopCode) {
      this.shopSelected.emit(shopCode);
    }
  }

  trackByShopCode(_: number, item: ShopTabItem): string {
    return item.shopCode;
  }
}
