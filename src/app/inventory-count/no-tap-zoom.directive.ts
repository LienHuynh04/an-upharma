import { Directive, ElementRef, OnDestroy, OnInit } from "@angular/core";

/**
 * Kills double-tap zoom INSIDE a staff bottom sheet (code pad, quantity
 * form) without touching the rest of the app.
 *
 * Why sheet-scoped: iOS Safari decides double-tap zoom in its own
 * gesture layer. Cancelling the tap at touchend (what the global
 * handler in index.html does) cancels the click but NOT the zoom; the
 * tap must be swallowed at touchstart, before the gesture recogniser
 * ever sees a "second tap". A non-passive touchstart listener on the
 * whole document would delay every scroll start app-wide (the lag the
 * previous attempt caused), so the listener lives only on the sheet
 * element: the sheets are full-screen, non-page-scrolling surfaces, so
 * nothing outside them pays for it.
 *
 * A swallowed tap re-dispatches its click by hand, so rapid keypad
 * typing loses no keystroke. The internal match list keeps native
 * touch behaviour because touches starting there may be scrolls, and
 * the quantity input keeps native behaviour for text selection.
 * Pinch inside a sheet is blocked via gesturestart; pinch on the page
 * behind the sheet stays available as the way back from any zoom.
 */
@Directive({
  selector: "[appNoTapZoom]",
  standalone: true,
})
export class NoTapZoomDirective implements OnInit, OnDestroy {
  private lastTouchStartAt = 0;

  private readonly handleTouchStart = (event: TouchEvent): void => {
    if (event.touches.length > 1) {
      // Second finger down inside the sheet: a pinch starting — block it.
      event.preventDefault();
      return;
    }
    const raw = event.target as HTMLElement | null;
    if (!raw || typeof raw.closest !== "function") return;
    if (raw.closest(".staff-code-matches")) return;
    const target =
      raw.closest("button, a, input, select, textarea, label, [role='button']") || raw;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const now = event.timeStamp;
    const rapid = now - this.lastTouchStartAt < 500;
    this.lastTouchStartAt = now;
    if (rapid) {
      event.preventDefault();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  };

  private readonly handleGestureStart = (event: Event): void => {
    event.preventDefault();
  };

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    const el = this.host.nativeElement;
    el.addEventListener("touchstart", this.handleTouchStart, { passive: false });
    el.addEventListener("gesturestart", this.handleGestureStart);
  }

  ngOnDestroy(): void {
    const el = this.host.nativeElement;
    el.removeEventListener("touchstart", this.handleTouchStart);
    el.removeEventListener("gesturestart", this.handleGestureStart);
  }
}
