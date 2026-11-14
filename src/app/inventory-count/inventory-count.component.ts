import { CommonModule } from "@angular/common";
import { Component, ElementRef, OnInit, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { normalizeFilterText, normalizeInventoryRow, parseNumericValue } from "../inventory-utils";
import { ExcelExportService } from "../shared/services/excel-export.service";
import { StaffAuthService } from "../staff-auth.service";
import {
  CountSubmission,
  FinalReview,
  ShopCatalogIndexEntry,
  StaffCountService,
  StaffEvaluation,
} from "../staff-count.service";
import { LoginResponse, RawRecord, ResourceResponse, ShopInfo, UpharmaService } from "../upharma.service";

interface CountProduct {
  code: string;
  name: string;
  unit: string;
  expectedQuantity: number;
  unitPrice: number;
  countedQuantity: number | null;
  /** Staff mode only: product found on the shelf but absent from the shop catalog. */
  outsideCatalog?: boolean;
}

export interface CalendarCell {
  dayNumber: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isInRange: boolean;
  isRangeStart: boolean;
  isRangeEnd: boolean;
  hasSubmissions: boolean;
  submissions: CountSubmission[];
}

/** One row of a single staff sheet in the manager review (manager mode only). */
interface SheetRow {
  code: string;
  name: string;
  unit: string;
  expectedQuantity: number | null;
  /** The count of the staff member whose sheet is being viewed. */
  countedQuantity: number;
  /** Same-day counts of the same product by OTHER staff, shown for reference. */
  otherCounts: { staffName: string; quantity: number }[];
}

interface CountSession {
  id: string;
  shopCode: string;
  shopName: string;
  status: "counting" | "completed";
  productSelection: "selected";
  createdAt: number;
  completedAt?: number;
  products: CountProduct[];
  /** Staff mode: when the finished sheet was submitted to the manager. */
  submittedAt?: number;
  /** Staff mode: finished but the submission has not reached the server yet. */
  submitPending?: boolean;
}

interface InventoryCacheRecord {
  cacheKey: string;
  data: ResourceResponse;
  savedAt?: number;
}

@Component({
  selector: "app-inventory-count",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./inventory-count.component.html",
  styleUrl: "./inventory-count.component.css",
})
export class InventoryCountComponent implements OnInit {
  @ViewChild("searchInput") private searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild("quantityInput") private quantityInput?: ElementRef<HTMLInputElement>;

  shops: ShopInfo[] = [];
  selectedShopCode = "";
  sessions: CountSession[] = [];
  currentSession: CountSession | null = null;
  editingCompletedSession = false;
  catalogProducts: CountProduct[] = [];
  products: CountProduct[] = [];
  activeProduct: CountProduct | null = null;
  searchText = "";
  codePadOpen = false;
  codePadError = "";
  countedQuantityInput = "";
  currentTab: "count" | "results" = "count";
  userName = "";
  userEmail = "";
  userId = 0;
  loading = false;
  saving = false;
  exporting = false;
  errorMessage = "";
  noticeMessage = "";
  catalogStatus = "";

  // Staff (inventory counter) mode: slim catalog, blind counting, submission.
  staffMode = false;
  private staffUid = "";
  private extraCatalogProducts: CountProduct[] = [];

  // Manager review of submitted staff counts (manager mode only).
  submissions: CountSubmission[] = [];
  submissionsLoading = false;
  submissionsError = "";
  reviewLoaded = false;
  /** Review is managed per day/range and per shop: one staff sheet at a time. */
  reviewDate: string = InventoryCountComponent.todayInputValue();
  reviewEndDate: string = InventoryCountComponent.todayInputValue();
  isDateRange = false;
  showCalendarPopup = false;
  calendarMode: "single" | "range" = "single";
  calendarYear = new Date().getFullYear();
  calendarMonth = new Date().getMonth() + 1;
  calendarCells: CalendarCell[] = [];
  calendarLoading = false;
  allShopSubmissions: CountSubmission[] = [];
  submissionsByDate: Record<string, CountSubmission[]> = {};
  recentCountDates: string[] = [];
  hoveredDate: string | null = null;
  hoveredQuickDate: string | null = null;
  rangeClickStep: 0 | 1 = 0;
  daySubmissions: CountSubmission[] = [];
  selectedSubmission: CountSubmission | null = null;
  sheetRows: SheetRow[] = [];
  /** Saved manager evaluations of the shop's sheets, keyed by submission id. */
  evaluationsBySubmission: Record<string, StaffEvaluation> = {};
  /** Products with stock that no sheet of the loaded day counted (computed once per load, never in a template getter). */
  uncountedProducts: { code: string; name: string; unit: string; expectedQuantity: number }[] = [];
  /** First rows of uncountedProducts actually rendered; the full list goes to the Excel export. */
  uncountedPreview: { code: string; name: string; unit: string; expectedQuantity: number }[] = [];
  /** Distinct product codes counted by any sheet of the loaded day. */
  countedCodeCount = 0;
  /** Verdicts being edited in the open sheet detail. */
  verdicts: Record<string, "correct" | "wrong"> = {};
  savingEvaluation = false;
  deletingSubmission = false;
  exportNotice = "";
  exportDialogOpen = false;
  exportChoices: { key: string; label: string; checked: boolean }[] = [];
  evaluationNotice = "";
  finalQuantities: Record<string, number | null> = {};
  savingReview = false;
  reviewNotice = "";

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly excelExportService: ExcelExportService,
    private readonly staffAuthService: StaffAuthService,
    private readonly staffCountService: StaffCountService,
  ) {}

  ngOnInit(): void {
    void this.initialize();
  }

  get shopName(): string {
    return this.shops.find((shop) => shop.ShopCode === this.selectedShopCode)?.ShopName || this.selectedShopCode;
  }

  get activeSession(): CountSession | null {
    return this.sessions.find(
      (session) => session.status === "counting" && session.shopCode === this.selectedShopCode,
    ) || null;
  }

  get canEditSession(): boolean {
    // Staff rule: once a count is completed it is final for the staff
    // member — the session opens as a view-only detail, never for editing.
    if (this.staffMode && this.currentSession?.status === "completed") return false;
    return this.currentSession?.status !== "completed" || this.editingCompletedSession;
  }

  get latestSessions(): CountSession[] {
    return this.sessions
      .filter((session) => session.shopCode === this.selectedShopCode)
      .sort((first, second) => second.createdAt - first.createdAt);
  }

  get completedCount(): number {
    return this.products.reduce((total, product) => total + (product.countedQuantity === null ? 0 : 1), 0);
  }

  get progressPercent(): number {
    return this.products.length ? Math.round((this.completedCount / this.products.length) * 100) : 0;
  }

  get countedProducts(): CountProduct[] {
    return this.products.filter((product) => product.countedQuantity !== null);
  }

  get pendingProducts(): CountProduct[] {
    return this.products.filter((product) => product.countedQuantity === null);
  }

  get discrepancyProducts(): CountProduct[] {
    return this.countedProducts.filter((product) => this.difference(product) !== 0);
  }

  get matchingProducts(): CountProduct[] {
    const query = normalizeFilterText(this.searchText);
    if (!query) return [];
    // Staff may also add a product found on the shelf that the shop catalog
    // does not list (system stock zero) — those come from the global catalog.
    const searchable = this.staffMode
      ? [...this.catalogProducts, ...this.extraCatalogProducts]
      : this.catalogProducts;
    const queryDigits = query.replace(/\D/g, "");
    return searchable
      .filter((product) => {
        if (normalizeFilterText(`${product.code} ${product.name}`).includes(query)) return true;
        // Staff often type only the number part of a code, or part of it:
        // compare digit-only forms with leading zeros stripped on both
        // sides, so "4787" and "84787" both surface code TH04787.
        if (queryDigits.length >= 2) {
          const codeDigits = product.code.replace(/\D/g, "").replace(/^0+/, "");
          const wanted = queryDigits.replace(/^0+/, "");
          if (codeDigits && wanted && (codeDigits.includes(wanted) || wanted.includes(codeDigits))) {
            return true;
          }
        }
        return false;
      })
      .slice(0, 8);
  }


  get countedTotalValue(): number {
    return this.countedProducts.reduce(
      (total, product) => total + (product.countedQuantity || 0) * product.unitPrice,
      0,
    );
  }

  get differenceTotalValue(): number {
    return this.countedProducts.reduce(
      (total, product) => total + this.difference(product) * product.unitPrice,
      0,
    );
  }

  async onShopChange(): Promise<void> {
    this.errorMessage = "";
    this.noticeMessage = "";
    this.reviewLoaded = false;
    this.submissions = [];
    this.daySubmissions = [];
    this.selectedSubmission = null;
    this.sheetRows = [];
    this.evaluationsBySubmission = {};
    this.verdicts = {};
    this.finalQuantities = {};
    this.submissionsError = "";
    this.reviewNotice = "";
    this.loadSavedSessions();
    await this.loadProductCatalog();
    if (!this.staffMode) {
      this.loadShopSubmissionsForCalendar();
    }
  }

  startSession(): void {
    if (!this.selectedShopCode || this.loading || this.catalogProducts.length === 0) return;
    const session: CountSession = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      shopCode: this.selectedShopCode,
      shopName: this.shopName,
      status: "counting",
      productSelection: "selected",
      createdAt: Date.now(),
      products: [],
    };
    const updatedSessions = [session, ...this.sessions];
    if (!this.saveSessions(updatedSessions)) return;
    this.sessions = updatedSessions;
    this.openSession(session);
  }

  openSession(session: CountSession, editCompleted = false): void {
    this.errorMessage = "";
    this.noticeMessage = "";
    this.currentSession = session;
    this.editingCompletedSession = session.status === "completed" && editCompleted;
    this.selectedShopCode = session.shopCode;
    this.products = session.products.map((product) => ({ ...product }));
    this.activeProduct = null;
    this.searchText = "";
    this.countedQuantityInput = "";
    this.currentTab = session.status === "completed" && !editCompleted ? "results" : "count";
  }

  editSession(session: CountSession): void {
    if (this.staffMode && session.status === "completed") {
      // Completed staff sessions are view-only; open the detail instead.
      this.openSession(session);
      return;
    }
    this.openSession(session, true);
  }

  editCurrentSession(): void {
    if (this.currentSession) this.editSession(this.currentSession);
  }

  deleteSession(session: CountSession): void {
    if (this.staffMode && session.status === "completed") {
      this.noticeMessage = "Phiên đã hoàn thành chỉ được xem lại chi tiết, không xóa được.";
      return;
    }
    const confirmation = session.status === "completed"
      ? `Xóa phiên kiểm kê ${session.shopCode} ngày ${new Intl.DateTimeFormat("vi-VN").format(new Date(session.createdAt))}? Kết quả của phiên sẽ bị xóa khỏi thiết bị này.`
      : `Xóa phiên kiểm kê ${session.shopCode} đang thực hiện? Các số đếm của phiên sẽ bị xóa khỏi thiết bị này.`;
    if (!window.confirm(confirmation)) return;

    const updatedSessions = this.sessions.filter((item) => item.id !== session.id);
    if (!this.saveSessions(updatedSessions)) return;
    this.sessions = updatedSessions;
    if (this.currentSession?.id === session.id) {
      this.currentSession = null;
      this.editingCompletedSession = false;
      this.activeProduct = null;
    }
    this.noticeMessage = "Đã xóa phiên kiểm kê khỏi thiết bị này.";
  }

  backToSessions(): void {
    this.currentSession = null;
    this.editingCompletedSession = false;
    this.activeProduct = null;
    this.loadSavedSessions();
  }

  selectProduct(product: CountProduct): void {
    const session = this.currentSession;
    if (!session || !this.canEditSession) return;

    let sessionProduct = this.products.find((item) => item.code === product.code);
    const addedToSession = !sessionProduct;
    if (!sessionProduct) {
      sessionProduct = { ...product, countedQuantity: null };
      this.products = [...this.products, sessionProduct];
      session.products = this.products.map((item) => ({ ...item }));
      if (!this.saveSessions()) {
        this.products = this.products.filter((item) => item.code !== product.code);
        session.products = this.products.map((item) => ({ ...item }));
        return;
      }
    }

    if (!sessionProduct.unit && product.unit) sessionProduct.unit = product.unit;
    this.activeProduct = sessionProduct;
    this.searchText = "";
    this.countedQuantityInput =
      sessionProduct.countedQuantity === null ? "" : String(sessionProduct.countedQuantity);
    this.errorMessage = "";
    this.noticeMessage = addedToSession ? `${product.code} đã được thêm vào phiên kiểm kê.` : "";
    setTimeout(() => this.quantityInput?.nativeElement.focus(), 0);
  }

  /**
   * Resolves the typed query to one product: an exact code match, an exact
   * digit-part match (leading zeros aside), or the single fuzzy match.
   * Shared by the Enter key and the numeric code pad's confirm button.
   */
  private resolveSearchTarget(): CountProduct | null {
    const query = normalizeFilterText(this.searchText);
    const exactMatch = this.catalogProducts.find((product) => normalizeFilterText(product.code) === query);
    // Typing the code's full number part (leading zeros aside) is an exact
    // match too, so Enter opens that product even when fragments of other
    // codes also match the typed digits.
    const queryDigits = query.replace(/\D/g, "").replace(/^0+/, "");
    const digitExactMatch = queryDigits
      ? this.catalogProducts.find(
          (product) => product.code.replace(/\D/g, "").replace(/^0+/, "") === queryDigits,
        )
      : undefined;
    return exactMatch || digitExactMatch || (this.matchingProducts.length === 1 ? this.matchingProducts[0] : null);
  }

  selectSearchResult(): void {
    const product = this.resolveSearchTarget();
    if (product) {
      this.selectProduct(product);
    } else if (this.matchingProducts.length === 0) {
      this.errorMessage = this.staffMode
        ? "Không tìm thấy mã hàng trong danh mục sản phẩm."
        : "Không tìm thấy mã hàng trong danh mục tồn kho đã lưu.";
    } else {
      this.noticeMessage = "Có nhiều sản phẩm phù hợp. Chọn đúng sản phẩm trong danh sách.";
    }
  }

  saveCount(): void {
    const product = this.activeProduct;
    const session = this.currentSession;
    const value = Number(this.countedQuantityInput);
    if (!product || !session || this.saving) return;
    if (!Number.isFinite(value) || value < 0) {
      this.errorMessage = "Nhập số lượng thực tế từ 0 trở lên.";
      return;
    }

    this.saving = true;
    this.errorMessage = "";
    const previousQuantity = product.countedQuantity;
    product.countedQuantity = value;
    session.products = this.products.map((item) => ({ ...item }));
    if (!this.saveSessions()) {
      product.countedQuantity = previousQuantity;
      session.products = this.products.map((item) => ({ ...item }));
      this.saving = false;
      return;
    }
    this.activeProduct = null;
    this.countedQuantityInput = "";
    this.searchText = "";
    this.saving = false;
    this.noticeMessage = `Đã lưu số đếm ${product.name}. Kết quả đối chiếu sẽ hiện sau khi hoàn thành phiên.`;
    if (this.staffMode) {
      // Counting flow: the pad reopens at once so the next code can be keyed in.
      this.codePadError = "";
      this.codePadOpen = true;
      this.scrollStaffViewToTop();
    } else {
      this.searchInput?.nativeElement.focus();
    }
  }

  /** Opens the numeric code pad (the staff search bar is only a tap target now). */
  openCodePad(): void {
    this.codePadError = "";
    this.codePadOpen = true;
    this.scrollStaffViewToTop();
  }

  /**
   * Counting flow: after each saved product (and whenever the code pad
   * opens) the staff view returns to the very top - the page behind the
   * sheet and the sheet's own scroll position - so the next code always
   * starts from the top instead of wherever the list happened to be
   * scrolled to, which left the sheet's head out of reach.
   */
  private scrollStaffViewToTop(): void {
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      document.querySelector(".staff-code-sheet")?.scrollTo(0, 0);
    });
  }

  closeCodePad(): void {
    this.codePadOpen = false;
  }

  /** Code pad match row: jump straight into the quantity sheet for that product. */
  pickFromPad(product: CountProduct): void {
    this.codePadOpen = false;
    this.selectProduct(product);
  }

  /** Code pad confirm: opens the resolved product, or explains why it cannot. */
  confirmCodePad(): void {
    const product = this.resolveSearchTarget();
    if (product) {
      this.codePadOpen = false;
      this.selectProduct(product);
      return;
    }
    this.codePadError = this.matchingProducts.length
      ? `Có ${this.matchingProducts.length} sản phẩm khớp — chạm vào đúng sản phẩm trong danh sách phía trên.`
      : "Không tìm thấy mã khớp — kiểm tra lại phần số đã bấm.";
  }

  /**
   * Digit pad of the code-entry sheet: builds the code query with big touch
   * keys - staff never type letters, matchingProducts resolves the typed
   * digits against the full codes (fragments included).
   */
  searchKeypadPress(key: string): void {
    this.codePadError = "";
    if (key === "clear") {
      this.searchText = "";
      return;
    }
    if (key === "back") {
      this.searchText = this.searchText.slice(0, -1);
      return;
    }
    if (key === "enter") {
      this.confirmCodePad();
      return;
    }
    if (/^\d$/.test(key)) {
      this.searchText += key;
    }
  }

  /** Staff app sheet: removes the active product from the session entirely. */
  removeActiveProduct(): void {
    const product = this.activeProduct;
    if (!product) return;
    if (product.countedQuantity !== null) {
      this.deleteCountedProduct(product);
    } else {
      this.removePendingProduct(product);
    }
    this.closeCountForm();
  }

  /** Stepper chips of the staff app sheet: quick +/- amounts on the quantity. */
  /** POS-style keypad of the staff app sheet: edits the quantity input as text. */
  keypadPress(key: string): void {
    const current = this.countedQuantityInput || "";
    if (key === "clear") {
      this.countedQuantityInput = "";
      return;
    }
    if (key === "back") {
      this.countedQuantityInput = current.slice(0, -1);
      return;
    }
    if (key === ".") {
      if (!current.includes(".")) this.countedQuantityInput = `${current || "0"}.`;
      return;
    }
    if (/^\d$/.test(key)) {
      this.countedQuantityInput = current === "0" ? key : current + key;
    }
  }

  adjustQuantity(delta: number): void {
    const current = Number(this.countedQuantityInput);
    const base = Number.isFinite(current) ? current : 0;
    const next = Math.max(0, Math.round((base + delta) * 1000) / 1000);
    this.countedQuantityInput = String(next);
  }

  closeCountForm(): void {
    this.activeProduct = null;
    this.countedQuantityInput = "";
    this.errorMessage = "";
    this.searchInput?.nativeElement.focus();
  }

  removePendingProduct(product: CountProduct): void {
    if (product.countedQuantity !== null) return;
    this.removeProductFromSession(product);
  }

  deleteCountedProduct(product: CountProduct): void {
    if (product.countedQuantity === null) return;
    if (!window.confirm(`Xóa ${product.code} khỏi kết quả kiểm kê?`)) return;
    this.removeProductFromSession(product);
  }

  private removeProductFromSession(product: CountProduct): void {
    const session = this.currentSession;
    if (!session) return;
    const originalProducts = this.products;
    this.products = this.products.filter((item) => item.code !== product.code);
    session.products = this.products.map((item) => ({ ...item }));
    if (!this.saveSessions()) {
      this.products = originalProducts;
      session.products = this.products.map((item) => ({ ...item }));
      return;
    }
    if (this.activeProduct?.code === product.code) {
      this.activeProduct = null;
      this.countedQuantityInput = "";
    }
  }

  difference(product: CountProduct): number {
    return product.countedQuantity === null ? 0 : product.countedQuantity - product.expectedQuantity;
  }

  differenceAmount(product: CountProduct): number {
    return this.difference(product) * product.unitPrice;
  }

  completeSession(): void {
    const session = this.currentSession;
    if (!session || this.saving) return;
    if (this.activeProduct) {
      this.errorMessage = "Hãy kiểm kê hoặc đóng sản phẩm đang nhập trước khi hoàn thành.";
      return;
    }
    if (this.countedProducts.length === 0) {
      this.errorMessage = "Hãy kiểm kê ít nhất một sản phẩm trước khi hoàn thành.";
      return;
    }
    if (this.products.some((product) => product.countedQuantity === null)) {
      this.errorMessage = "Còn mã đã thêm nhưng chưa đếm. Hãy đếm hoặc xóa các mã đó trước khi hoàn thành.";
      return;
    }

    const completedSession: CountSession = {
      ...session,
      status: "completed",
      completedAt: Date.now(),
      products: this.products.map((product) => ({ ...product })),
    };
    const updatedSessions = this.sessions.map((item) =>
      item.id === completedSession.id ? completedSession : item,
    );
    if (!this.saveSessions(updatedSessions)) return;
    this.sessions = updatedSessions;
    this.currentSession = completedSession;
    this.editingCompletedSession = false;
    this.activeProduct = null;
    this.currentTab = "results";
    this.errorMessage = "";
    this.noticeMessage = "Đã hoàn thành kiểm kê. Có thể xuất báo cáo Excel.";
    if (this.staffMode) {
      void this.submitSessionToServer(completedSession);
    }
  }

  /** Builds the server payload for one finished staff count sheet. */
  private buildSubmission(session: CountSession): CountSubmission {
    return {
      id: session.id,
      staffUid: this.staffUid,
      staffName: this.userName,
      shopCode: session.shopCode,
      shopName: session.shopName,
      createdAt: session.createdAt,
      completedAt: session.completedAt || Date.now(),
      items: session.products
        .filter((product) => product.countedQuantity !== null)
        .map((product) => ({
          code: product.code,
          name: product.name,
          unit: product.unit,
          countedQuantity: product.countedQuantity as number,
          ...(product.outsideCatalog ? { outsideCatalog: true } : {}),
        })),
    };
  }

  /**
   * Staff mode: pushes a finished sheet to the manager. The sheet counts are
   * blind — staff can write their own sheet but can never read anyone's.
   * Failures (e.g. no signal in the warehouse) keep the sheet on the device
   * flagged as pending and it is retried on the next visit.
   */
  private async submitSessionToServer(session: CountSession): Promise<void> {
    try {
      await this.staffCountService.submitCount(this.buildSubmission(session));
      session.submittedAt = Date.now();
      session.submitPending = false;
      this.sessions = this.sessions.map((item) => (item.id === session.id ? session : item));
      this.saveSessions();
      if (this.currentSession?.id === session.id) {
        this.noticeMessage = "Đã hoàn thành và nộp kết quả kiểm kê cho quản lý.";
      }
    } catch (error) {
      console.warn("Chưa nộp được kết quả kiểm kê, sẽ thử lại sau:", error);
      session.submitPending = true;
      this.sessions = this.sessions.map((item) => (item.id === session.id ? session : item));
      this.saveSessions();
      if (this.currentSession?.id === session.id) {
        this.noticeMessage =
          "Đã hoàn thành kiểm kê trên thiết bị này. Chưa nộp được kết quả (mất mạng?) — hệ thống sẽ tự nộp lại khi có mạng.";
      }
    }
  }

  private async retryPendingSubmissions(): Promise<void> {
    const pending = this.sessions.filter(
      (session) => session.status === "completed" && session.submitPending,
    );
    for (const session of pending) {
      await this.submitSessionToServer(session);
    }
  }

  async exportReport(): Promise<void> {
    if (!this.currentSession || this.countedProducts.length === 0 || this.exporting) return;
    this.exporting = true;
    this.errorMessage = "";
    try {
      const rows = this.countedProducts.map((product) => ({
        "Mã SP": product.code,
        "SL đếm": product.countedQuantity,
        "Tên SP": product.name,
        "SL tồn kho": product.expectedQuantity,
        "SL chênh lệch": this.difference(product),
        "Đơn giá": product.unitPrice,
        "Thành tiền": this.differenceAmount(product),
      }));
      const date = new Date(this.currentSession.createdAt).toISOString().slice(0, 10);
      await this.excelExportService.exportJsonToExcel(
        rows,
        `Kiem-ke-${this.currentSession.shopCode}-${date}.xlsx`,
        "Kết quả kiểm kê",
      );
    } catch (error) {
      this.errorMessage = `Không xuất được báo cáo Excel: ${this.errorText(error)}`;
    } finally {
      this.exporting = false;
    }
  }

  /** Local yyyy-MM-dd for the date input (avoids UTC shift of toISOString). */
  private static todayInputValue(): string {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /** Deterministic id of the saved final review for the selected day or date range. */
  private reviewIdForSelectedDay(): string {
    if (this.isDateRange && this.reviewDate !== this.reviewEndDate) {
      return `review-${this.reviewDate.replaceAll("-", "")}-${this.reviewEndDate.replaceAll("-", "")}`;
    }
    return `review-${this.reviewDate.replaceAll("-", "")}`;
  }

  formatDisplayDate(dateStr: string): string {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  get displayDateText(): string {
    if (this.isDateRange && this.reviewDate !== this.reviewEndDate) {
      return `${this.formatDisplayDate(this.reviewDate)} - ${this.formatDisplayDate(this.reviewEndDate)}`;
    }
    return this.formatDisplayDate(this.reviewDate);
  }

  toggleCalendarPopup(): void {
    this.showCalendarPopup = !this.showCalendarPopup;
    if (this.showCalendarPopup) {
      if (this.reviewDate) {
        const [y, m] = this.reviewDate.split("-").map(Number);
        if (y && m) {
          this.calendarYear = y;
          this.calendarMonth = m;
        }
      }
      this.generateCalendarCells();
      if (!this.allShopSubmissions.length) {
        this.loadShopSubmissionsForCalendar();
      }
    }
  }

  setCalendarMode(mode: "single" | "range"): void {
    this.calendarMode = mode;
    this.rangeClickStep = 0;
    if (mode === "single") {
      this.reviewEndDate = this.reviewDate;
      this.isDateRange = false;
    } else {
      this.isDateRange = true;
    }
    this.generateCalendarCells();
  }

  prevCalendarMonth(): void {
    if (this.calendarMonth === 1) {
      this.calendarMonth = 12;
      this.calendarYear--;
    } else {
      this.calendarMonth--;
    }
    this.generateCalendarCells();
  }

  nextCalendarMonth(): void {
    if (this.calendarMonth === 12) {
      this.calendarMonth = 1;
      this.calendarYear++;
    } else {
      this.calendarMonth++;
    }
    this.generateCalendarCells();
  }

  goToTodayCalendar(): void {
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth() + 1;
    this.generateCalendarCells();
  }

  onCalendarDayClick(cell: CalendarCell): void {
    if (this.calendarMode === "single") {
      this.reviewDate = cell.dateStr;
      this.reviewEndDate = cell.dateStr;
      this.isDateRange = false;
      this.showCalendarPopup = false;
      this.loadSubmissions();
    } else {
      if (this.rangeClickStep === 0) {
        this.reviewDate = cell.dateStr;
        this.reviewEndDate = cell.dateStr;
        this.rangeClickStep = 1;
        this.generateCalendarCells();
      } else {
        let start = this.reviewDate;
        let end = cell.dateStr;
        if (start > end) {
          [start, end] = [end, start];
        }
        this.reviewDate = start;
        this.reviewEndDate = end;
        this.isDateRange = true;
        this.rangeClickStep = 0;
        this.showCalendarPopup = false;
        this.loadSubmissions();
      }
    }
  }

  applyDateRange(): void {
    if (this.reviewDate > this.reviewEndDate) {
      const temp = this.reviewDate;
      this.reviewDate = this.reviewEndDate;
      this.reviewEndDate = temp;
    }
    this.isDateRange = this.reviewDate !== this.reviewEndDate;
    this.showCalendarPopup = false;
    this.loadSubmissions();
  }

  quickSelectDate(dateStr: string): void {
    this.reviewDate = dateStr;
    this.reviewEndDate = dateStr;
    this.isDateRange = false;
    this.loadSubmissions();
  }

  quickDateTooltip(dateStr: string): string {
    const list = this.submissionsByDate[dateStr] || [];
    if (!list.length) return `Ngày ${this.formatDisplayDate(dateStr)}: Chưa có phiếu`;
    const lines = list.map((s) => {
      const time = new Date(s.completedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      return `• ${s.staffName} (${time} - ${s.items.length} mã)`;
    });
    return `Phiếu kiểm kê ngày ${this.formatDisplayDate(dateStr)} (${list.length} phiếu):\n${lines.join("\n")}`;
  }

  async loadShopSubmissionsForCalendar(): Promise<void> {
    if (this.staffMode || !this.selectedShopCode) return;
    try {
      this.calendarLoading = true;
      const all = await this.staffCountService.listSubmissions(this.selectedShopCode);
      this.allShopSubmissions = all;
      this.indexSubmissionsByDate();
      this.generateCalendarCells();
    } catch {
      this.allShopSubmissions = [];
      this.submissionsByDate = {};
      this.generateCalendarCells();
    } finally {
      this.calendarLoading = false;
    }
  }

  private indexSubmissionsByDate(): void {
    const map: Record<string, CountSubmission[]> = {};
    for (const sub of this.allShopSubmissions) {
      if (!sub.completedAt) continue;
      const d = new Date(sub.completedAt);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${day}`;
      if (!map[key]) map[key] = [];
      map[key].push(sub);
    }
    this.submissionsByDate = map;
    this.recentCountDates = Object.keys(map)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 3);
  }

  generateCalendarCells(): void {
    const year = this.calendarYear;
    const month = this.calendarMonth;
    const firstDay = new Date(year, month - 1, 1);
    const startWeekday = (firstDay.getDay() + 6) % 7; // 0 for Mon, 6 for Sun
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
    const todayStr = InventoryCountComponent.todayInputValue();

    const cells: CalendarCell[] = [];

    // Previous month trailing days
    for (let i = startWeekday - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 2, dayNum);
      const dateStr = this.toDateInputValue(prevDate);
      const subs = this.submissionsByDate[dateStr] || [];
      cells.push({
        dayNumber: dayNum,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: this.isDateSelected(dateStr),
        isInRange: this.isDateInRange(dateStr),
        isRangeStart: dateStr === this.reviewDate,
        isRangeEnd: dateStr === this.reviewEndDate,
        hasSubmissions: subs.length > 0,
        submissions: subs,
      });
    }

    // Current month days
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const curDate = new Date(year, month - 1, dayNum);
      const dateStr = this.toDateInputValue(curDate);
      const subs = this.submissionsByDate[dateStr] || [];
      cells.push({
        dayNumber: dayNum,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        isSelected: this.isDateSelected(dateStr),
        isInRange: this.isDateInRange(dateStr),
        isRangeStart: dateStr === this.reviewDate,
        isRangeEnd: dateStr === this.reviewEndDate,
        hasSubmissions: subs.length > 0,
        submissions: subs,
      });
    }

    // Next month padding days to complete grid
    const remaining = (7 - (cells.length % 7)) % 7;
    const totalNeeded = cells.length + remaining < 35 ? 35 - cells.length : remaining;
    for (let dayNum = 1; dayNum <= totalNeeded; dayNum++) {
      const nextDate = new Date(year, month, dayNum);
      const dateStr = this.toDateInputValue(nextDate);
      const subs = this.submissionsByDate[dateStr] || [];
      cells.push({
        dayNumber: dayNum,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        isSelected: this.isDateSelected(dateStr),
        isInRange: this.isDateInRange(dateStr),
        isRangeStart: dateStr === this.reviewDate,
        isRangeEnd: dateStr === this.reviewEndDate,
        hasSubmissions: subs.length > 0,
        submissions: subs,
      });
    }

    this.calendarCells = cells;
  }

  private toDateInputValue(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  isDateSelected(dateStr: string): boolean {
    if (this.isDateRange && this.reviewDate !== this.reviewEndDate) {
      return dateStr === this.reviewDate || dateStr === this.reviewEndDate;
    }
    return dateStr === this.reviewDate;
  }

  isDateInRange(dateStr: string): boolean {
    if (!this.isDateRange || this.reviewDate === this.reviewEndDate) return false;
    let start = this.reviewDate;
    let end = this.reviewEndDate;
    if (start > end) [start, end] = [end, start];
    return dateStr >= start && dateStr <= end;
  }

  /**
   * Manager review, organised by day/range and shop: loads the sheets staff
   * submitted for the selected shop, keeps only the selected day or date range, and shows
   * ONE staff member's sheet at a time — sheets are never merged together.
   * The confirmed final quantity is still one number per product per day;
   * other staff counts of the same product appear only as a reference chip,
   * never summed and never auto-picked.
   */
  async loadSubmissions(): Promise<void> {
    if (this.staffMode || this.submissionsLoading) return;
    this.submissionsLoading = true;
    this.submissionsError = "";
    this.reviewNotice = "";
    try {
      const all = await this.staffCountService.listSubmissions(this.selectedShopCode);
      this.submissions = all;
      this.allShopSubmissions = all;
      this.indexSubmissionsByDate();
      this.generateCalendarCells();

      const isRange = this.isDateRange && this.reviewDate !== this.reviewEndDate;
      if (!isRange) {
        const [year, month, day] = this.reviewDate.split("-").map(Number);
        this.daySubmissions = all
          .filter((submission) => {
            const at = new Date(submission.completedAt);
            return at.getFullYear() === year && at.getMonth() + 1 === month && at.getDate() === day;
          })
          .sort((first, second) => first.completedAt - second.completedAt);
      } else {
        let startStr = this.reviewDate;
        let endStr = this.reviewEndDate;
        if (startStr > endStr) {
          [startStr, endStr] = [endStr, startStr];
          this.reviewDate = startStr;
          this.reviewEndDate = endStr;
        }
        const [sYear, sMonth, sDay] = startStr.split("-").map(Number);
        const [eYear, eMonth, eDay] = endStr.split("-").map(Number);
        const startTime = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0).getTime();
        const endTime = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999).getTime();
        this.daySubmissions = all
          .filter((submission) => {
            const at = submission.completedAt;
            return at >= startTime && at <= endTime;
          })
          .sort((first, second) => first.completedAt - second.completedAt);
      }

      this.selectedSubmission = null;
      this.sheetRows = [];
      this.verdicts = {};
      // The evaluations node may not be readable yet (rules merge pending):
      // treat that as "no evaluations yet" instead of failing the review.
      this.evaluationsBySubmission = await this.staffCountService
        .listEvaluations(this.selectedShopCode)
        .catch(() => ({}));
      await this.prepareFinalQuantities();
      this.reviewLoaded = true;
      this.computeUncountedProducts();
    } catch (error) {
      this.submissionsError = this.errorText(error);
    } finally {
      this.submissionsLoading = false;
    }
  }

  /** Opens the detail of one staff sheet: its products and the verdict form. */
  selectSubmission(submission: CountSubmission): void {
    this.selectedSubmission = submission;
    this.buildSheetRows();
    this.verdicts = { ...(this.evaluationsBySubmission[submission.id]?.verdicts || {}) };
    this.evaluationNotice = "";
    this.reviewNotice = "";
  }

  /** Manager-only: permanently deletes one submitted sheet of the day. */
  async deleteReviewSheet(submission: CountSubmission): Promise<void> {
    if (this.staffMode || this.deletingSubmission) return;
    const when = new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(submission.completedAt));
    if (
      !window.confirm(
        `Xóa phiếu của ${submission.staffName} (nộp lúc ${when}) khỏi dữ liệu đối chiếu của ${this.selectedShopCode}? Hành động này không hoàn tác được.`,
      )
    ) {
      return;
    }
    this.deletingSubmission = true;
    this.errorMessage = "";
    try {
      await this.staffCountService.deleteSubmission(this.selectedShopCode, submission.id);
      if (this.selectedSubmission?.id === submission.id) this.backToSheetList();
      await this.loadSubmissions();
    } catch (error) {
      this.errorMessage = `Không xóa được phiếu: ${this.errorText(error)}`;
    } finally {
      this.deletingSubmission = false;
    }
  }

  /** Back to the sheet list; product rows are only shown inside a detail. */
  backToSheetList(): void {
    this.selectedSubmission = null;
    this.sheetRows = [];
    this.verdicts = {};
    this.evaluationNotice = "";
  }

  /** Toggles one product verdict in the open detail; clicking again clears it. */
  setVerdict(code: string, verdict: "correct" | "wrong"): void {
    if (this.verdicts[code] === verdict) {
      delete this.verdicts[code];
    } else {
      this.verdicts[code] = verdict;
    }
  }

  /** Marks every product of the open sheet as counted correctly. */
  markAllCorrect(): void {
    for (const row of this.sheetRows) this.verdicts[row.code] = "correct";
  }

  /** Verdict tallies of the open detail. */
  get verdictSummary(): { correct: number; wrong: number; pending: number } {
    let correct = 0;
    let wrong = 0;
    for (const row of this.sheetRows) {
      if (this.verdicts[row.code] === "correct") correct += 1;
      else if (this.verdicts[row.code] === "wrong") wrong += 1;
    }
    return { correct, wrong, pending: this.sheetRows.length - correct - wrong };
  }

  /** Evaluation progress of one sheet, for the list badge. */
  evaluationState(submission: CountSubmission): { label: string; done: boolean; started: boolean } {
    const evaluation = this.evaluationsBySubmission[submission.id];
    const total = new Set(submission.items.map((item) => item.code)).size;
    if (!evaluation) return { label: "Chưa đánh giá", done: false, started: false };
    const values = evaluation.verdicts ? Object.values(evaluation.verdicts) : [];
    const correct = values.filter((value) => value === "correct").length;
    const wrong = values.length - correct;
    const done = values.length >= total && total > 0;
    return {
      label: done
        ? `Đã đánh giá xong · Đúng ${correct} · Sai ${wrong}`
        : `Đang đánh giá · Đúng ${correct} · Sai ${wrong} / ${total} mã`,
      done,
      started: true,
    };
  }

  async saveEvaluation(): Promise<void> {
    const submission = this.selectedSubmission;
    if (this.staffMode || this.savingEvaluation || !submission) return;
    this.savingEvaluation = true;
    this.evaluationNotice = "";
    this.submissionsError = "";
    try {
      const evaluation: StaffEvaluation = {
        id: submission.id,
        shopCode: this.selectedShopCode,
        staffUid: submission.staffUid,
        staffName: submission.staffName,
        evaluatedBy: this.userName,
        evaluatedAt: Date.now(),
        dateKey: this.reviewDate,
        verdicts: { ...this.verdicts },
      };
      await this.staffCountService.saveEvaluation(evaluation);
      this.evaluationsBySubmission[submission.id] = evaluation;
      this.evaluationNotice = `Đã lưu đánh giá phiếu của ${submission.staffName}.`;
    } catch (error) {
      this.submissionsError = this.errorText(error);
    } finally {
      this.savingEvaluation = false;
    }
  }

  private buildSheetRows(): void {
    const submission = this.selectedSubmission;
    if (!submission) {
      this.sheetRows = [];
      return;
    }
    const expectedByCode = new Map(this.catalogProducts.map((product) => [product.code, product]));
    const seenCodes = new Set<string>();
    const rows: SheetRow[] = [];
    for (const item of submission.items) {
      if (seenCodes.has(item.code)) continue;
      seenCodes.add(item.code);
      const expected = expectedByCode.get(item.code);
      rows.push({
        code: item.code,
        name: expected?.name || item.name,
        unit: expected?.unit || item.unit || "",
        expectedQuantity: expected ? expected.expectedQuantity : null,
        countedQuantity: item.countedQuantity,
        otherCounts: this.otherCountsFor(item.code, submission.staffUid),
      });
    }
    this.sheetRows = rows.sort((first, second) =>
      first.name.localeCompare(second.name, "vi", { sensitivity: "base" }),
    );
  }

  /** Latest same-day count of a product by every OTHER staff member. */
  private otherCountsFor(code: string, excludeUid: string): { staffName: string; quantity: number }[] {
    const latestByStaff = new Map<string, { staffName: string; quantity: number }>();
    // daySubmissions are chronological: overwriting means the LAST sheet of a
    // staff member that day is the one that counts.
    for (const submission of this.daySubmissions) {
      if (submission.staffUid === excludeUid) continue;
      const item = submission.items.find((entry) => entry.code === code);
      if (item) {
        latestByStaff.set(submission.staffUid, {
          staffName: submission.staffName,
          quantity: item.countedQuantity,
        });
      }
    }
    return Array.from(latestByStaff.values());
  }

  /** True when another staff member counted this product differently the same day. */
  sheetRowDisagrees(row: SheetRow): boolean {
    return row.otherCounts.some((count) => count.quantity !== row.countedQuantity);
  }

  /** True when the sheet holds at least one product others counted differently. */
  sheetHasDisagreement(submission: CountSubmission): boolean {
    const seenCodes = new Set<string>();
    for (const item of submission.items) {
      if (seenCodes.has(item.code)) continue;
      seenCodes.add(item.code);
      const others = this.otherCountsFor(item.code, submission.staffUid);
      if (others.some((count) => count.quantity !== item.countedQuantity)) return true;
    }
    return false;
  }

  /**
   * Final quantities are per product per day: prefilled from the saved review
   * of the day when one exists, otherwise from products where every staff
   * count of the day agrees (never from disagreeing counts).
   */
  private async prepareFinalQuantities(): Promise<void> {
    this.finalQuantities = {};
    const codes = new Set<string>();
    for (const submission of this.daySubmissions) {
      for (const item of submission.items) codes.add(item.code);
    }
    const saved = await this.staffCountService
      .getFinalReview(this.selectedShopCode, this.reviewIdForSelectedDay())
      .catch(() => null);
    if (saved) {
      for (const item of saved.items) this.finalQuantities[item.code] = item.finalQuantity;
    }
    for (const code of codes) {
      if (code in this.finalQuantities) continue;
      const latestByStaff = new Map<string, number>();
      for (const submission of this.daySubmissions) {
        const item = submission.items.find((entry) => entry.code === code);
        if (item) latestByStaff.set(submission.staffUid, item.countedQuantity);
      }
      const quantities = Array.from(latestByStaff.values());
      this.finalQuantities[code] =
        quantities.length > 0 && quantities.every((quantity) => quantity === quantities[0])
          ? quantities[0]
          : null;
    }
  }

  /**
   * Admin view: products that still have stock at the shop but NO staff
   * sheet of the selected day counted — the "kiểm kê sót" list. Computed
   * once per review/catalog load and stored: as a template getter it was
   * re-filtered and re-sorted on every change-detection cycle and froze
   * the page (Page Unresponsive) on shops with ~2,000 catalog rows.
   */
  private computeUncountedProducts(): void {
    if (!this.reviewLoaded) {
      this.uncountedProducts = [];
      this.uncountedPreview = [];
      return;
    }
    const countedCodes = new Set<string>();
    for (const submission of this.daySubmissions) {
      for (const item of submission.items) countedCodes.add(item.code);
    }
    this.countedCodeCount = countedCodes.size;
    this.uncountedProducts = this.catalogProducts
      .filter((product) => product.expectedQuantity > 0 && !countedCodes.has(product.code))
      .map((product) => ({
        code: product.code,
        name: product.name,
        unit: product.unit,
        expectedQuantity: product.expectedQuantity,
      }))
      .sort((first, second) => first.name.localeCompare(second.name, "vi", { sensitivity: "base" }));
    this.uncountedPreview = this.uncountedProducts.slice(0, 200);
  }

  /** Counted quantity minus system stock; null while the stock side is unknown. */
  countDifferenceValue(row: SheetRow): number | null {
    if (row.expectedQuantity === null) return null;
    return row.countedQuantity - row.expectedQuantity;
  }

  countDifferenceText(row: SheetRow): string {
    const value = this.countDifferenceValue(row);
    return value === null ? "—" : this.formatSigned(value);
  }

  async saveFinalReview(): Promise<void> {
    if (this.staffMode || this.savingReview || this.daySubmissions.length === 0) return;
    this.savingReview = true;
    this.reviewNotice = "";
    this.submissionsError = "";
    try {
      const codes = new Set<string>();
      for (const submission of this.daySubmissions) {
        for (const item of submission.items) codes.add(item.code);
      }
      const review: FinalReview = {
        id: this.reviewIdForSelectedDay(),
        shopCode: this.selectedShopCode,
        reviewedBy: this.userName,
        reviewedAt: Date.now(),
        dateKey: this.reviewDate,
        items: Array.from(codes).map((code) => ({
          code,
          finalQuantity: this.finalQuantities[code] ?? null,
        })),
      };
      await this.staffCountService.saveFinalReview(review);
      this.reviewNotice = this.isDateRange && this.reviewDate !== this.reviewEndDate
        ? `Đã lưu số chốt từ ngày ${this.formatDisplayDate(this.reviewDate)} đến ngày ${this.formatDisplayDate(this.reviewEndDate)} cho ${this.selectedShopCode}.`
        : `Đã lưu số chốt ngày ${this.formatDisplayDate(this.reviewDate)} cho ${this.selectedShopCode}.`;
    } catch (error) {
      this.submissionsError = this.errorText(error);
    } finally {
      this.savingReview = false;
    }
  }

  /** Opens the export popup: one checkbox per sheet the file can contain. */
  openExportDialog(): void {
    if (this.staffMode || this.exporting || !this.reviewLoaded) return;
    const choices: { key: string; label: string; checked: boolean }[] = [];
    if (this.daySubmissions.length) {
      choices.push({ key: "doi-chieu", label: "Đối chiếu kiểm kê (tổng hợp theo mã)", checked: true });
      choices.push({ key: "danh-sach", label: "Danh sách phiếu (thông tin các account)", checked: true });
      for (const submission of this.daySubmissions) {
        const time = new Intl.DateTimeFormat("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(submission.completedAt));
        const codes = new Set(submission.items.map((item) => item.code)).size;
        choices.push({
          key: `phieu:${submission.id}`,
          label: `Phiếu của ${submission.staffName} — nộp ${time} · ${codes} mã`,
          checked: true,
        });
      }
    }
    choices.push({
      key: "chua-kiem-ke",
      label: `Chưa kiểm kê (${this.uncountedProducts.length} mã)`,
      checked: true,
    });
    this.exportChoices = choices;
    this.exportNotice = "";
    this.exportDialogOpen = true;
  }

  get exportSelectionCount(): number {
    return this.exportChoices.filter((choice) => choice.checked).length;
  }

  async confirmExport(): Promise<void> {
    const selected = new Set(
      this.exportChoices.filter((choice) => choice.checked).map((choice) => choice.key),
    );
    this.exportDialogOpen = false;
    if (!selected.size) return;
    await this.runExport(selected);
  }

  private async runExport(selected: Set<string>): Promise<void> {
    if (this.staffMode || this.exporting || !this.reviewLoaded || !selected.size) return;
    this.exporting = true;
    this.errorMessage = "";
    try {
      const expectedByCode = new Map(this.catalogProducts.map((product) => [product.code, product]));
      const staffNames = Array.from(new Set(this.daySubmissions.map((entry) => entry.staffName)));
      const codes = new Set<string>();
      for (const submission of this.daySubmissions) {
        for (const item of submission.items) codes.add(item.code);
      }
      // Latest sheet per staff member (daySubmissions are chronological).
      const latestSubmissionByStaff = new Map<string, CountSubmission>();
      for (const submission of this.daySubmissions) {
        latestSubmissionByStaff.set(submission.staffName, submission);
      }
      const latestCount = (staffName: string, code: string): number | "" => {
        const item = latestSubmissionByStaff
          .get(staffName)
          ?.items.find((entry) => entry.code === code);
        return item ? item.countedQuantity : "";
      };
      const verdictFor = (staffName: string, code: string): string => {
        const submission = latestSubmissionByStaff.get(staffName);
        const verdict = submission
          ? this.evaluationsBySubmission[submission.id]?.verdicts?.[code]
          : undefined;
        return verdict === "correct" ? "Đúng" : verdict === "wrong" ? "Sai" : "";
      };
      const comparisonRows = Array.from(codes).map((code) => {
        const expected = expectedByCode.get(code);
        const anyItem = this.daySubmissions
          .flatMap((entry) => entry.items)
          .find((entry) => entry.code === code);
        const record: Record<string, unknown> = {
          "Mã SP": code,
          "Tên SP": expected?.name || anyItem?.name || "",
          "Đơn vị": expected?.unit || anyItem?.unit || "",
          "SL tồn kho": expected ? expected.expectedQuantity : "",
        };
        for (const staffName of staffNames) {
          record[`SL đếm - ${staffName}`] = latestCount(staffName, code);
        }
        for (const staffName of staffNames) {
          record[`Đánh giá - ${staffName}`] = verdictFor(staffName, code);
        }
        return record;
      });
      const sheetRows = this.daySubmissions.map((submission) => {
        const total = new Set(submission.items.map((item) => item.code)).size;
        const evaluation = this.evaluationsBySubmission[submission.id];
        const values = evaluation?.verdicts ? Object.values(evaluation.verdicts) : [];
        const correct = values.filter((value) => value === "correct").length;
        const wrong = values.length - correct;
        return {
          "Nhân viên": submission.staffName,
          "Tài khoản": submission.staffUid,
          "Giờ nộp": new Intl.DateTimeFormat("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }).format(new Date(submission.completedAt)),
          "Số mã đã đếm": total,
          "Đúng": correct,
          "Sai": wrong,
          "Chưa chấm": total - values.length,
          "Người đánh giá": evaluation?.evaluatedBy || "",
        };
      });
      const uncountedRows = this.uncountedProducts.map((product) => ({
        "Mã SP": product.code,
        "Tên SP": product.name,
        "Đơn vị": product.unit,
        "SL tồn kho": product.expectedQuantity,
      }));
      // One sheet per submitted sheet, named after its staff member, so
      // each person\'s counts and verdicts can be read on their own tab.
      const usedSheetNames = new Set<string>(["Đối chiếu kiểm kê", "Phiếu kiểm kê", "Chưa kiểm kê"]);
      const submissionSheets = this.daySubmissions.map((submission) => {
        const time = new Intl.DateTimeFormat("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(submission.completedAt)).replace(":", "h");
        let sheetName = `Phiếu ${submission.staffName} ${time}`.replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
        if (usedSheetNames.has(sheetName)) sheetName = `${sheetName.slice(0, 27)} (2)`;
        usedSheetNames.add(sheetName);
        const evaluation = this.evaluationsBySubmission[submission.id];
        const rowsByCode = new Map<string, Record<string, unknown>>();
        for (const item of submission.items) {
          const expected = expectedByCode.get(item.code);
          const verdict = evaluation?.verdicts?.[item.code];
          rowsByCode.set(item.code, {
            "Mã SP": item.code,
            "Tên sản phẩm": expected?.name || item.name || "",
            "Đơn vị": expected?.unit || item.unit || "",
            "SL tồn kho": expected ? expected.expectedQuantity : "",
            "SL đếm": item.countedQuantity,
            "Đánh giá": verdict === "correct" ? "Đúng" : verdict === "wrong" ? "Sai" : "",
            "Lệch (đếm - tồn)": expected ? item.countedQuantity - expected.expectedQuantity : "",
          });
        }
        return { key: submission.id, name: sheetName, data: Array.from(rowsByCode.values()) };
      });
      const sheets: { name: string; data: Record<string, any>[] }[] = [];
      if (selected.has("doi-chieu")) sheets.push({ name: "Đối chiếu kiểm kê", data: comparisonRows });
      if (selected.has("danh-sach")) sheets.push({ name: "Phiếu kiểm kê", data: sheetRows });
      for (const sheet of submissionSheets) {
        if (selected.has(`phieu:${sheet.key}`)) sheets.push({ name: sheet.name, data: sheet.data });
      }
      if (selected.has("chua-kiem-ke")) sheets.push({ name: "Chưa kiểm kê", data: uncountedRows });
      if (!sheets.length) return;
      const dateSuffix = this.isDateRange && this.reviewDate !== this.reviewEndDate
        ? `${this.reviewDate}_den_${this.reviewEndDate}`
        : this.reviewDate;
      await this.excelExportService.exportSheetsToExcel(
        sheets,
        `Doi-chieu-kiem-ke-${this.selectedShopCode}-${dateSuffix}.xlsx`,
      );
      this.exportNotice = `Đã xuất file Excel: ${sheets.length} trang (${sheets.map((sheet) => sheet.name).join(", ")}).`;
    } catch (error) {
      this.errorMessage = `Không xuất được báo cáo Excel: ${this.errorText(error)}`;
    } finally {
      this.exporting = false;
    }
  }

  formatSigned(value: number): string {
    return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("vi-VN", {
      maximumFractionDigits: 3,
    }).format(value)}`;
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value);
  }

  private async initialize(): Promise<void> {
    this.loading = true;
    try {
      const staffSession = this.staffAuthService.getSession();
      if (staffSession && !this.upharmaService.isAuthenticated()) {
        await this.initializeStaffMode(staffSession.uid, staffSession.displayName, staffSession.shops);
        return;
      }
      const login: LoginResponse = this.upharmaService.ensureLogin();
      this.userId = login.UserInfo.uPharmaID;
      this.userName = login.UserInfo.FullName || "";
      this.userEmail = login.UserInfo.Email || "";
      this.shops = this.upharmaService.getActiveShops();
      if (this.shops.length === 0) {
        throw new Error("Tài khoản chưa có nhà thuốc đang hoạt động.");
      }
      this.selectedShopCode = this.shops[0].ShopCode;
      this.loadSavedSessions();
      await this.loadProductCatalog();
      if (!this.staffMode) {
        this.loadShopSubmissionsForCalendar();
      }
    } catch (error) {
      this.errorMessage = this.errorText(error);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Staff mode entry point: the counter sees only their assigned shops and
   * the slim per-shop catalog (code + name + unit). System quantities and
   * prices are never fetched in this mode.
   */
  private async initializeStaffMode(uid: string, displayName: string, shopCodes: string[]): Promise<void> {
    this.staffMode = true;
    this.staffUid = uid;
    this.userName = displayName || "Nhân viên kiểm kê";
    const index = await this.staffCountService
      .getShopCatalogIndex()
      .catch((): Record<string, ShopCatalogIndexEntry> => ({}));
    this.shops = shopCodes.map((code) => ({
      ShopCode: code,
      ShopName: index[code]?.name || code,
    }));
    if (this.shops.length === 0) {
      throw new Error("Tài khoản chưa được phân shop kiểm kê nào. Liên hệ quản lý.");
    }
    this.selectedShopCode = this.shops[0].ShopCode;
    this.loadSavedSessions();
    await this.loadProductCatalog();
    await this.retryPendingSubmissions();
  }

  private async loadStaffCatalog(): Promise<void> {
    this.loading = true;
    this.errorMessage = "";
    this.catalogStatus = "";
    try {
      const catalog = await this.staffCountService.getShopCatalog(this.selectedShopCode);
      const items = catalog?.items || [];
      const globalItems = await this.staffCountService.getGlobalCatalog().catch(() => []);
      // Shop catalogs written by older sync runs may carry no unit at all;
      // the system-wide catalog has the real unit (Viên, Gói, Hộp...), so
      // fill any missing one from there by product code.
      const unitByCode = new Map(globalItems.map((item) => [item.c, item.u || ""]));
      this.catalogProducts = items.map((item) => ({
        code: item.c,
        name: item.n || item.c,
        unit: item.u || unitByCode.get(item.c) || "",
        expectedQuantity: 0,
        unitPrice: 0,
        countedQuantity: null,
      }));
      const inShopCodes = new Set(items.map((item) => item.c));
      this.extraCatalogProducts = globalItems
        .filter((item) => !inShopCodes.has(item.c))
        .map((item) => ({
          code: item.c,
          name: item.n || item.c,
          unit: item.u || "",
          expectedQuantity: 0,
          unitPrice: 0,
          countedQuantity: null,
          outsideCatalog: true,
        }));
      if (items.length === 0) {
        this.catalogStatus = `Chưa có danh mục sản phẩm cho ${this.selectedShopCode}. Danh mục được tạo ở lần đồng bộ kế tiếp.`;
      } else {
        const updatedText = catalog?.updatedAt
          ? ` · cập nhật ${new Intl.DateTimeFormat("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              day: "2-digit",
              month: "2-digit",
            }).format(new Date(catalog.updatedAt))}`
          : "";
        this.catalogStatus = `Danh mục gồm ${items.length} sản phẩm đang có hàng tại ${this.selectedShopCode}${updatedText}. Chỉ gồm mã và tên sản phẩm để kiểm kê.`;
      }
    } catch (error) {
      this.catalogProducts = [];
      this.extraCatalogProducts = [];
      this.errorMessage = this.errorText(error);
    } finally {
      this.loading = false;
    }
  }

  private async loadProductCatalog(): Promise<void> {
    if (this.staffMode) {
      await this.loadStaffCatalog();
      return;
    }
    const login = this.upharmaService.getSession();
    if (!login || !this.selectedShopCode) return;
    this.loading = true;
    this.errorMessage = "";
    this.catalogStatus = "";

    let cache: InventoryCacheRecord | null = null;
    try {
      cache = await this.readInventoryCache(login);
    } catch (error) {
      console.warn("Không đọc được cache tồn kho; sẽ tải dữ liệu mới:", error);
    }

    try {
      let rows = (cache?.data?.data || []).filter(
        (row) => String(row["__shopCode"] || row["ShopCode"] || row["StoreCode"] || "") === this.selectedShopCode,
      );
      let fetchedFromApi = false;
      let cacheWriteFailed = false;
      if (rows.length === 0) {
        this.catalogStatus = "Đang tải dữ liệu tồn kho để chuẩn bị kiểm kê...";
        const inventoryData = await this.upharmaService.loadInventoryResource({
          forceRefresh: true,
          shopCodes: this.shops.map((shop) => shop.ShopCode),
        });
        rows = (inventoryData.data || []).filter(
          (row) => String(row["__shopCode"] || row["ShopCode"] || row["StoreCode"] || "") === this.selectedShopCode,
        );
        const selectedShopFailure = inventoryData.failedShops?.find((failure) =>
          failure === this.selectedShopCode || failure.startsWith(`${this.selectedShopCode}:`),
        );
        if (rows.length === 0 && selectedShopFailure) {
          throw new Error(`Không tải được tồn kho của ${this.selectedShopCode}: ${selectedShopFailure}`);
        }

        if (inventoryData.data?.length) {
          try {
            await this.writeInventoryCache({
              cacheKey: this.inventoryCacheKey(login),
              data: inventoryData,
              savedAt: Date.now(),
            });
          } catch (error) {
            console.error("Đã tải được tồn kho nhưng không lưu được cache dùng chung:", error);
            cacheWriteFailed = true;
          }
        }
        fetchedFromApi = true;
      }

      this.catalogProducts = this.aggregateProducts(rows);
      // If the day's sheets were loaded before the catalog arrived, the
      // uncounted list can only be computed now that both sides exist.
      if (this.reviewLoaded) this.computeUncountedProducts();
      if (this.catalogProducts.length === 0) {
        this.catalogStatus = `Không có sản phẩm tồn kho để kiểm kê tại ${this.selectedShopCode}.`;
      } else if (fetchedFromApi) {
        this.catalogStatus = cacheWriteFailed
          ? `Đã tải ${this.catalogProducts.length} sản phẩm cho ${this.selectedShopCode}, nhưng không lưu được cache trên thiết bị.`
          : `Đã tải ${this.catalogProducts.length} sản phẩm tồn kho cho ${this.selectedShopCode}.`;
      } else if (cache?.savedAt) {
        this.catalogStatus = `Danh mục lấy từ dữ liệu tồn kho đã lưu lúc ${new Intl.DateTimeFormat("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
        }).format(new Date(cache.savedAt))}.`;
      } else {
        this.catalogStatus = "Danh mục lấy từ dữ liệu tồn kho đã lưu trên thiết bị.";
      }
    } catch (error) {
      this.catalogProducts = [];
      this.errorMessage = this.errorText(error);
    } finally {
      this.loading = false;
    }
  }

  private aggregateProducts(rows: RawRecord[]): CountProduct[] {
    const productsByCode = new Map<string, CountProduct>();
    for (const [index, rawRow] of rows.entries()) {
      const item = normalizeInventoryRow(rawRow, index);
      if (!item.productCode) continue;

      const quantity = parseNumericValue(item.quantity);
      const unitPrice = parseNumericValue(item.price);
      const existing = productsByCode.get(item.productCode);
      if (existing) {
        existing.expectedQuantity += quantity;
        if (existing.unitPrice === 0 && unitPrice > 0) existing.unitPrice = unitPrice;
      } else {
        productsByCode.set(item.productCode, {
          code: item.productCode,
          name: item.productName || item.productCode,
          unit: item.unit,
          expectedQuantity: quantity,
          unitPrice,
          countedQuantity: null,
        });
      }
    }
    return Array.from(productsByCode.values()).sort((first, second) =>
      first.name.localeCompare(second.name, "vi", { sensitivity: "base" }),
    );
  }

  private async readInventoryCache(login: LoginResponse): Promise<InventoryCacheRecord | null> {
    const cacheKey = this.inventoryCacheKey(login);
    const db = await this.openInventoryCacheDb();

    return new Promise<InventoryCacheRecord | null>((resolve, reject) => {
      if (!db.objectStoreNames.contains("inventory")) {
        db.close();
        resolve(null);
        return;
      }
      const transaction = db.transaction("inventory", "readonly");
      const request = transaction.objectStore("inventory").get(cacheKey);
      request.onsuccess = () => {
        db.close();
        resolve((request.result as InventoryCacheRecord | undefined) || null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  }

  private inventoryCacheKey(login: LoginResponse): string {
    const shopCodes = this.shops.map((shop) => shop.ShopCode).join(",");
    return `inventory_new:${login.UserInfo.uPharmaID}:${shopCodes}:v2`;
  }

  private async writeInventoryCache(record: InventoryCacheRecord): Promise<void> {
    if (!record.data?.data?.length) return;
    const db = await this.openInventoryCacheDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("inventory", "readwrite");
        const request = transaction.objectStore("inventory").put(record);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error("Không lưu được dữ liệu tồn kho."));
      });
    } finally {
      db.close();
    }
  }

  private openInventoryCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Đọc dữ liệu tồn kho đã lưu quá thời gian chờ.")), 3000);
      const request = indexedDB.open("upharma-cache", 1);
      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error("Bộ nhớ dữ liệu tồn kho đang được trình duyệt khóa."));
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("inventory")) {
          db.createObjectStore("inventory", { keyPath: "cacheKey" });
        }
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error || new Error("Không mở được bộ nhớ tồn kho trên thiết bị."));
      };
    });
  }

  /**
   * Where counting sessions persist on this device. Staff sessions use
   * sessionStorage by request: drafts survive a refresh but are gone when
   * the tab/browser closes, so nothing counting-related lingers on a shared
   * device. The manager's own sessions keep using localStorage.
   */
  private sessionsStore(): Storage {
    return this.staffMode ? sessionStorage : localStorage;
  }

  private loadSavedSessions(): void {
    const storageKey = this.sessionsStorageKey();
    try {
      // One-time move of staff drafts written by older builds to
      // localStorage, so an in-progress count is not lost on upgrade.
      if (this.staffMode && !sessionStorage.getItem(storageKey)) {
        const legacy = localStorage.getItem(storageKey);
        if (legacy) {
          sessionStorage.setItem(storageKey, legacy);
          localStorage.removeItem(storageKey);
        }
      }
      const rawSessions = this.sessionsStore().getItem(storageKey);
      const savedSessions = rawSessions ? (JSON.parse(rawSessions) as CountSession[]) : [];
      let migrated = false;
      this.sessions = savedSessions.map((session) => {
        if (session.productSelection === "selected") return session;
        migrated = true;
        return {
          ...session,
          productSelection: "selected",
          products: (session.products || []).filter((product) => product.countedQuantity !== null),
        };
      });
      if (migrated) this.saveSessions();
    } catch (error) {
      this.errorMessage = `Không đọc được phiên kiểm kê đã lưu: ${this.errorText(error)}`;
      this.sessions = [];
    }
  }

  private saveSessions(sessions = this.sessions): boolean {
    if (!this.selectedShopCode) return false;
    try {
      const sessionsForShop = sessions.filter((session) => session.shopCode === this.selectedShopCode);
      this.sessionsStore().setItem(this.sessionsStorageKey(), JSON.stringify(sessionsForShop));
      if (this.staffMode) localStorage.removeItem(this.sessionsStorageKey());
      return true;
    } catch (error) {
      this.errorMessage = `Không lưu được phiên kiểm kê trên thiết bị: ${this.errorText(error)}`;
      return false;
    }
  }

  private sessionsStorageKey(): string {
    const ownerKey = this.staffMode ? `staff-${this.staffUid}` : String(this.userId);
    return `upharma_inventory_count:${ownerKey}:${this.selectedShopCode}`;
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
