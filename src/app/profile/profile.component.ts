import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { RawRecord, ShopInfo, UpharmaService } from "../upharma.service";

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./profile.component.html",
})
export class ProfileComponent implements OnInit {
  userInfo: RawRecord = {};
  shopList: ShopInfo[] = [];
  userTitle = "Đang tải người dùng...";
  loading = false;
  loadingProgress = 0;
  errorText = "";
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  logoutConfirmOpen = false;
  menuGroups: Record<string, boolean> = {
    profile: true,
    goods: false,
    test: false,
  };

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.sidebarCollapsed = localStorage.getItem("upharma_sidebar_collapsed") === "true";
    void this.loadProfile();
  }

  get pageClasses(): Record<string, boolean> {
    return {
      "sidebar-collapsed": this.sidebarCollapsed,
      "mobile-menu-open": this.mobileMenuOpen,
    };
  }

  get displayName(): string {
    return this.getField(["FullName", "UserName", "Name", "EmployeeName"]) || "Người dùng UPHARMA";
  }

  get avatarInitial(): string {
    const nameParts = this.displayName.trim().split(/\s+/).filter(Boolean);
    const lastNamePart = nameParts.at(-1) || this.displayName;

    return lastNamePart.slice(0, 1).toUpperCase();
  }

  get userId(): string {
    return this.getField(["uPharmaID", "UPharmaID", "UserID", "ID"]) || "--";
  }

  get email(): string {
    return this.getField(["Email", "Mail"]) || "--";
  }

  get role(): string {
    return this.getField(["UTypeTxt", "RoleName", "EmRole", "Position", "Role"]) || "--";
  }

  get address(): string {
    return this.getField(["Address", "UserAddress", "ShopAddress"]) || "--";
  }

  get birthday(): string {
    const value = this.getField(["Birthday", "BirthDay", "DateOfBirth"]);

    return value ? value.slice(0, 10) : "--";
  }

  get accountType(): string {
    return this.getField(["UType", "UserType", "Type"]) || "--";
  }

  get profileDetails(): { label: string; value: string }[] {
    const labels: Record<string, string> = {
      FullName: "Họ tên",
      Email: "Email",
      Address: "Địa chỉ",
      Birthday: "Ngày tham gia",
      UTypeTxt: "Vai trò",
      UType: "Mã vai trò",
      uPharmaID: "Mã người dùng",
      PhoneNumber: "Số điện thoại",
      UserName: "Tên đăng nhập",
      EmployeeName: "Nhân viên",
    };
    const preferredOrder = Object.keys(labels);
    const hiddenKeys = new Set(["Token", "Password", "ShopLst", "GroupLst", "StoreLst"]);
    const entries = Object.entries(this.userInfo).filter(
      ([key, value]) => !hiddenKeys.has(key) && this.isDisplayValue(value),
    );

    return entries
      .sort(([firstKey], [secondKey]) => {
        const firstIndex = preferredOrder.indexOf(firstKey);
        const secondIndex = preferredOrder.indexOf(secondKey);

        if (firstIndex !== -1 || secondIndex !== -1) {
          return (firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex)
            - (secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex);
        }

        return firstKey.localeCompare(secondKey, "vi", { numeric: true });
      })
      .map(([key, value]) => ({
        label: labels[key] || key,
        value: this.formatProfileValue(value),
      }));
  }

  async loadProfile(): Promise<void> {
    this.loading = true;
    this.loadingProgress = 15;
    this.errorText = "";

    try {
      const session = this.upharmaService.ensureLogin();
      this.shopList = this.upharmaService.getActiveShops();
      this.userTitle = `${session.UserInfo.FullName} (ID - ${session.UserInfo.uPharmaID}) - ${this.shopList.length} nhà thuốc`;
      this.loadingProgress = 45;

      const response = await this.upharmaService.getUserInfoByID();
      this.loadingProgress = 82;
      this.userInfo = {
        ...session.UserInfo,
        ...response.user,
      };
      this.loadingProgress = 100;
    } catch (error) {
      this.errorText = error instanceof Error ? error.message : String(error);
      this.loadingProgress = 100;
    } finally {
      this.loading = false;
    }
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

  private getField(keys: string[]): string {
    for (const key of keys) {
      const value = this.userInfo[key];

      if (value !== undefined && value !== null && value !== "") {
        return String(value);
      }
    }

    return "";
  }

  private isDisplayValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== "" && !Array.isArray(value) && typeof value !== "object";
  }

  private formatProfileValue(value: unknown): string {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10);
    }

    return String(value);
  }
}
