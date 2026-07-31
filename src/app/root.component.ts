import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <router-outlet />

    <div class="cat-runner" aria-hidden="true">
      <span
        class="codex-bot"
        [class.is-dragging]="codexBotDragging"
        [style.left.px]="codexBotPosition.x"
        [style.top.px]="codexBotPosition.y"
        (pointerdown)="startCodexBotDrag($event)"
        (pointermove)="moveCodexBot($event)"
        (pointerup)="stopCodexBotDrag($event)"
        (pointercancel)="stopCodexBotDrag($event)"
      >
        <span class="codex-badge">{{ codexBotMessage }}</span>
        <img [src]="codexBotImage" alt="" (error)="($any($event.target)).src = 'assets/out-stock-cat.jpg'" />
      </span>
    </div>

    <div class="cat-rating-overlay" [class.is-visible]="ratingModalOpen" (click)="closeRatingModal()">
      <section class="cat-rating-modal" role="dialog" aria-modal="true" aria-labelledby="catRatingTitle" (click)="$event.stopPropagation()">
        <button class="cat-rating-close" type="button" aria-label="Đóng đánh giá" (click)="closeRatingModal()">×</button>
        <img class="cat-rating-avatar" [src]="codexBotImage" alt="" />
        <span class="cat-rating-kicker">Bug xin phép hỏi nhỏ</span>
        <h2 id="catRatingTitle">Bạn đánh giá cái này bao nhiêu sao nè?</h2>
        <div class="cat-rating-stars" aria-label="Chọn số sao đánh giá">
          <button
            *ngFor="let star of ratingStars"
            type="button"
            [class.is-active]="star <= selectedRating"
            [attr.aria-label]="'Đánh giá ' + star + ' sao'"
            (click)="selectRating(star)"
          >
            ★
          </button>
        </div>
        <p class="cat-rating-thanks" *ngIf="selectedRating > 0">{{ ratingThanksMessage }}</p>
      </section>
    </div>
  `,
})
export class RootComponent implements OnInit {
  codexBotDragging = false;
  ratingModalOpen = false;
  selectedRating = 0;
  readonly ratingStars = [1, 2, 3, 4, 5];
  codexBotPosition = {
    x: 1184.52,
    y: 535.43,
  };
  private codexBotDragOffset = {
    x: 0,
    y: 0,
  };
  private codexBotPointerStart = {
    x: 0,
    y: 0,
  };

  ngOnInit(): void {
    this.setDefaultCodexBotPosition();
  }

  get codexBotImage(): string {
    return this.codexBotDragging ? "assets/meomeo-happy.jpg" : "assets/meomeo-idle.jpg";
  }

  get codexBotMessage(): string {
    return this.codexBotDragging ? "Đụng là cắn nha" : "Xin chào, mình tên là Bug";
  }

  get ratingThanksMessage(): string {
    const messages: Record<number, string> = {
      1: "Cảm ơn nha, Bug hơi buồn xíu nhưng sẽ cố gắng dễ thương hơn.",
      2: "Cảm ơn bạn đã góp sao. Bug ghi nhận và đi chỉnh lại liền.",
      3: "Cảm ơn nè, 3 sao là đủ động lực để web ngoan hơn rồi.",
      4: "Cảm ơn nhiều nha, 4 sao làm Bug vui nguyên buổi.",
      5: "Ui 5 sao luôn, Bug xin nhận yêu thương và chạy nhanh hơn nữa.",
    };

    return messages[this.selectedRating] || "";
  }

  startCodexBotDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    this.codexBotDragging = true;
    this.codexBotPointerStart = {
      x: event.clientX,
      y: event.clientY,
    };
    this.codexBotDragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this.moveCodexBot(event);
  }

  moveCodexBot(event: PointerEvent): void {
    if (!this.codexBotDragging) {
      return;
    }

    const botSize = 52;
    const nextX = event.clientX - this.codexBotDragOffset.x;
    const nextY = event.clientY - this.codexBotDragOffset.y;

    this.codexBotPosition = {
      x: this.clamp(nextX, 8, window.innerWidth - botSize - 8),
      y: this.clamp(nextY, 56, window.innerHeight - botSize - 8),
    };
  }

  stopCodexBotDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    const movedDistance = Math.hypot(event.clientX - this.codexBotPointerStart.x, event.clientY - this.codexBotPointerStart.y);

    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }

    this.codexBotDragging = false;

    if (movedDistance < 6) {
      this.openRatingModal();
    }
  }

  openRatingModal(): void {
    this.ratingModalOpen = true;
  }

  closeRatingModal(): void {
    this.ratingModalOpen = false;
  }

  selectRating(rating: number): void {
    this.selectedRating = rating;
  }

  private setDefaultCodexBotPosition(): void {
    const botSize = 52;
    const viewportWidth = window.innerWidth || 1024;
    const viewportHeight = window.innerHeight || 768;

    this.codexBotPosition = {
      x: this.clamp(1057.52, 8, viewportWidth - botSize - 8),
      y: this.clamp(614.43, 56, viewportHeight - botSize - 8),
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }
}
