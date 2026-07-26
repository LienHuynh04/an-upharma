import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

@Component({
  selector: "app-api-test",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./api-test.component.html",
})
export class ApiTestComponent implements OnInit {
  readonly endpoint = "/SalesInvoice/GetReportSalesSpeed";
  shops: ShopInfo[] = [];
  selectedShopCode = "";
  timeStart = "";
  timeEnd = "";
  productID = "";
  getType = "";
  viewCity = 0;
  shopLst = "";
  requestPayload = "";
  responseText = "";
  errorText = "";
  loading = false;
  loadingProgress = 0;
  userTitle = "Chưa đăng nhập";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: false,
    test: true,
  };

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";
    this.timeStart = "2026-07-01 00:00:00";
    this.timeEnd = "2026-07-22 00:00:00";
    this.getType = "Week";
    this.viewCity = 0;

    await this.loginOnly();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  async loginOnly(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 15;
    this.errorText = "";

    try {
      const session = await this.upharmaService.ensureLogin();
      this.loadingProgress = 70;
      this.shops = this.upharmaService.getActiveShops();
      this.selectDefaultShops();
      this.userTitle = `${session.UserInfo.FullName} (ID - ${session.UserInfo.uPharmaID}) - ${this.shops.length} nhà thuốc`;
      this.updateRequestPreview();
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = this.getErrorMessage(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }

  async callSpeedApi(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 15;
    this.errorText = "";
    this.responseText = "";

    try {
      const session = await this.upharmaService.ensureLogin();
      const payload = this.buildPayload(session.Token, session.UserInfo.uPharmaID);

      this.requestPayload = JSON.stringify(payload, null, 2);
      this.loadingProgress = 45;
      const response = await this.upharmaService.callEndpoint<unknown>(this.endpoint, payload);
      this.loadingProgress = 85;
      this.responseText = JSON.stringify(response, null, 2);
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = this.getErrorMessage(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
  }

  updateRequestPreview(): void {
    const session = this.upharmaService.getSession();

    if (!session) {
      return;
    }

    try {
      this.requestPayload = JSON.stringify(
        this.buildPayload(session.Token, session.UserInfo.uPharmaID),
        null,
        2,
      );
      this.errorText = "";
    } catch (error) {
      this.errorText = this.getErrorMessage(error);
    }
  }

  selectShop(shopCode: string): void {
    this.selectedShopCode = shopCode;
    this.syncShopLstFromSelection();
    this.updateRequestPreview();
  }

  toggleMenuGroup(groupKey: string): void {
    this.menuGroups[groupKey] = !this.menuGroups[groupKey];
  }

  toggleSidebar(): void {
    if (window.matchMedia("(max-width: 900px)").matches) {
      this.sidebarCollapsed = false;
      this.mobileMenuOpen = !this.mobileMenuOpen;
      return;
    }

    this.sidebarCollapsed = !this.sidebarCollapsed;
    localStorage.setItem("upharma_sidebar_collapsed", String(this.sidebarCollapsed));
  }

  openLogoutConfirm(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.logoutConfirmOpen = true;
  }

  cancelLogout(): void {
    this.logoutConfirmOpen = false;
  }

  async confirmLogout(): Promise<void> {
    this.upharmaService.clearSession();
    await this.router.navigateByUrl("/login");
  }

  private buildPayload(token: string, uPharmaID: number): RawRecord {
    return {
      uPharmaID,
      Token: token,
      TimeStart: this.timeStart,
      TimeEnd: this.timeEnd,
      ProductID: this.productID,
      GetType: this.getType,
      ViewCity: Number(this.viewCity) || 0,
      ShopLst: this.shopLst,
    };
  }

  private selectDefaultShops(): void {
    const validShopCodes = new Set(this.shops.map((shop) => shop.ShopCode));

    if (!validShopCodes.has(this.selectedShopCode)) {
      this.selectedShopCode = this.shops[0]?.ShopCode || "";
    }

    this.syncShopLstFromSelection();
  }

  private syncShopLstFromSelection(): void {
    this.shopLst = this.selectedShopCode;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
