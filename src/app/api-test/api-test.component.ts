import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

@Component({
  selector: "app-api-test",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./api-test.component.html",
})
export class ApiTestComponent implements OnInit {
  endpoint = "/SalesInvoice/GetReportSalesSpeed";
  shops: ShopInfo[] = [];
  selectedShopCode = "";
  timeStart = "";
  timeEnd = "";
  productID = "";
  getType = "month";
  viewCity = 0;
  shopLst = "";
  searchStr = "";
  pageNumber = 1;
  numberRow = 100;
  headerID = "";
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
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    this.timeStart = `${twoMonthsAgo.getFullYear()}-${pad(twoMonthsAgo.getMonth() + 1)}-01 00:00:00`;
    this.timeEnd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} 23:59:59`;

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
      const truncated = this.truncateResponse(response);
      this.responseText = JSON.stringify(truncated, null, 2);
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
    const basePayload: RawRecord = {
      uPharmaID,
      Token: token,
      _bypassFirebase: true,
    };

    if (this.endpoint.includes("GetSalesHeaderByID")) {
      basePayload["HeaderID"] = this.headerID;
    } else if (this.endpoint.includes("GetSalesHeaderByShop")) {
      basePayload["TimeStart"] = this.timeStart;
      basePayload["TimeEnd"] = this.timeEnd;
      basePayload["Search"] = this.searchStr;
      basePayload["ShopCode"] = this.selectedShopCode;
      basePayload["PageNumber"] = Number(this.pageNumber) || 1;
      basePayload["NumberRow"] = Number(this.numberRow) || 100;
    } else if (this.endpoint.includes("GetReportSalesByShop")) {
      basePayload["TimeStart"] = this.timeStart;
      basePayload["TimeEnd"] = this.timeEnd;
      basePayload["ShopCode"] = this.selectedShopCode;
    } else if (this.endpoint.includes("GetReportSalesSpeed")) {
      basePayload["TimeStart"] = this.timeStart;
      basePayload["TimeEnd"] = this.timeEnd;
      basePayload["ShopLst"] = this.selectedShopCode;
      basePayload["ProductID"] = this.productID;
      basePayload["GetType"] = this.getType;
      basePayload["ViewCity"] = Number(this.viewCity) || 0;
    } else {
      basePayload["TimeStart"] = this.timeStart;
      basePayload["TimeEnd"] = this.timeEnd;
      basePayload["ShopCode"] = this.selectedShopCode;
    }

    return basePayload;
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

  private truncateResponse(response: any): any {
    const limit = 10;
    if (Array.isArray(response)) {
      if (response.length > limit) {
        return [...response.slice(0, limit), `... và ${response.length - limit} mục khác đã được ẩn đi để tránh treo trình duyệt.`];
      }
      return response;
    }

    if (response && typeof response === "object") {
      const cloned = { ...response };
      for (const key of Object.keys(cloned)) {
        if (Array.isArray(cloned[key]) && cloned[key].length > limit) {
          cloned[key] = [
            ...cloned[key].slice(0, limit),
            `... và ${cloned[key].length - limit} mục khác đã được ẩn đi.`,
          ];
        }
      }
      return cloned;
    }

    return response;
  }
}
