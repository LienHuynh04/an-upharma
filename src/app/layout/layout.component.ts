import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { UpharmaService } from "../upharma.service";

@Component({
  selector: "app-layout",
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: "./layout.component.html",
})
export class LayoutComponent implements OnInit {
  appClasses = {
    "is-sidebar-open": false,
    "layout-top": false,
  };
  layoutMode: "left" | "top" = "left";
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: false,
    stats: false,
    test: false,
    n8n: false,
  };
  userTitle = "Đang tải...";
  brandShopText = "";
  darkMode = false;
  notificationsOpen = false;

  showLogoutConfirm = false;

  constructor(private upharma: UpharmaService, private router: Router) {}

  ngOnInit() {
    const savedDarkMode = localStorage.getItem("upharma_dark_mode");
    this.darkMode = savedDarkMode === null ? true : savedDarkMode === "true";
    if (savedDarkMode === null) {
      localStorage.setItem("upharma_dark_mode", "true");
    }
    this.checkSession();
    this.syncMenuState(this.router.url);
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncMenuState(event.urlAfterRedirects || event.url);
      }
    });
  }

  get userInitial(): string {
    return (this.userTitle.trim().split(/\s+/).at(-1) || "U").slice(0, 1).toUpperCase();
  }

  checkSession() {
    if (!this.upharma.isAuthenticated()) {
      this.router.navigate(["/login"]);
      return;
    }
    const session = this.upharma.getSession();
    if (session && session.UserInfo) {
      this.userTitle = session.UserInfo.FullName || "Admin";
      this.brandShopText = session.UserInfo.ShopLst?.[0]?.ShopCode || "";
    }
  }

  toggleSidebar() {
    this.appClasses["is-sidebar-open"] = !this.appClasses["is-sidebar-open"];
  }

  closeSidebar(): void {
    this.appClasses["is-sidebar-open"] = false;
  }

  get sidebarToggleLabel(): string {
    return this.appClasses["is-sidebar-open"] ? "Đóng menu" : "Mở menu";
  }

  get sidebarToggleIcon(): string {
    return this.appClasses["is-sidebar-open"] ? "×" : "☰";
  }

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem("upharma_dark_mode", String(this.darkMode));
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
  }

  setLayoutMode(mode: "left" | "top") {
    this.layoutMode = mode;
    this.appClasses["layout-top"] = mode === "top";
  }

  toggleMenuGroup(group: string) {
    this.menuGroups[group] = !this.menuGroups[group];
  }

  private syncMenuState(url: string): void {
    const isStatsRoute =
      url.includes("/chi-tieu-nhan-vien") || url.includes("/chi-tieu-nha-thuoc-trong-nam");
    const isGoodsRoute =
      url.includes("/ton-kho") ||
      url.includes("/ton-kho-new") ||
      url.includes("/hang-da-het") ||
      url.includes("/hang-lap-tot") ||
      url.includes("/hang-ban-cham") ||
      url.includes("/in-tem") ||
      url.includes("/lay-bao-cao-don-hang");
    this.menuGroups["stats"] = isStatsRoute;
    this.menuGroups["goods"] = isGoodsRoute;
  }

  openLogoutConfirm(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.showLogoutConfirm = true;
  }

  async confirmLogout() {
    this.showLogoutConfirm = false;
    this.upharma.clearSession();
    await this.router.navigateByUrl("/login", { replaceUrl: true });
  }

  cancelLogout() {
    this.showLogoutConfirm = false;
  }
}
