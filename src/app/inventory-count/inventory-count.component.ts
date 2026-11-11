import { CommonModule } from "@angular/common";
import { Component, ElementRef, OnInit, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { normalizeFilterText, normalizeInventoryRow, parseNumericValue } from "../inventory-utils";
import { ExcelExportService } from "../shared/services/excel-export.service";
import { LoginResponse, RawRecord, ResourceResponse, ShopInfo, UpharmaService } from "../upharma.service";

interface CountProduct {
  code: string;
  name: string;
  unit: string;
  expectedQuantity: number;
  unitPrice: number;
  countedQuantity: number | null;
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

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly excelExportService: ExcelExportService,
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
    return this.catalogProducts
      .filter((product) => normalizeFilterText(`${product.code} ${product.name}`).includes(query))
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
    this.loadSavedSessions();
    await this.loadProductCatalog();
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
    this.openSession(session, true);
  }

  editCurrentSession(): void {
    if (this.currentSession) this.editSession(this.currentSession);
  }

  deleteSession(session: CountSession): void {
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

    this.activeProduct = sessionProduct;
    this.searchText = "";
    this.countedQuantityInput =
      sessionProduct.countedQuantity === null ? "" : String(sessionProduct.countedQuantity);
    this.errorMessage = "";
    this.noticeMessage = addedToSession ? `${product.code} đã được thêm vào phiên kiểm kê.` : "";
    setTimeout(() => this.quantityInput?.nativeElement.focus(), 0);
  }

  selectSearchResult(): void {
    const query = normalizeFilterText(this.searchText);
    const exactMatch = this.catalogProducts.find((product) => normalizeFilterText(product.code) === query);
    const product = exactMatch || (this.matchingProducts.length === 1 ? this.matchingProducts[0] : null);
    if (product) {
      this.selectProduct(product);
    } else if (this.matchingProducts.length === 0) {
      this.errorMessage = "Không tìm thấy mã hàng trong danh mục tồn kho đã lưu.";
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
    this.searchInput?.nativeElement.focus();
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
    } catch (error) {
      this.errorMessage = this.errorText(error);
    } finally {
      this.loading = false;
    }
  }

  private async loadProductCatalog(): Promise<void> {
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

  private loadSavedSessions(): void {
    const storageKey = this.sessionsStorageKey();
    try {
      const rawSessions = localStorage.getItem(storageKey);
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
      localStorage.setItem(this.sessionsStorageKey(), JSON.stringify(sessionsForShop));
      return true;
    } catch (error) {
      this.errorMessage = `Không lưu được phiên kiểm kê trên thiết bị: ${this.errorText(error)}`;
      return false;
    }
  }

  private sessionsStorageKey(): string {
    return `upharma_inventory_count:${this.userId}:${this.selectedShopCode}`;
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
