import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
  selector: "app-table-pagination",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card-footer d-flex align-items-center justify-content-between py-2 px-3 border-top" *ngIf="totalCount > 0">
      <div class="text-secondary small">
        Hiển thị <strong>1 - {{ displayedCount }}</strong> trên tổng số <strong>{{ totalCount }}</strong> mục
      </div>
      <div class="d-flex align-items-center gap-2" *ngIf="displayedCount < totalCount">
        <button
          type="button"
          class="btn btn-sm btn-outline-primary"
          [disabled]="loading"
          (click)="onLoadMore()"
        >
          <span *ngIf="loading" class="spinner-border spinner-border-sm me-1" role="status"></span>
          Tải thêm 25 dòng
        </button>
      </div>
    </div>
  `,
})
export class TablePaginationComponent {
  @Input() displayedCount = 0;
  @Input() totalCount = 0;
  @Input() loading = false;
  @Output() loadMore = new EventEmitter<void>();

  onLoadMore(): void {
    this.loadMore.emit();
  }
}
