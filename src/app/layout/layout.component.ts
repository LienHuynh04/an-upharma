import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
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
    goods: true,
    test: false,
    n8n: false,
  };
  userTitle = "Đang tải...";
  brandShopText = "";

  showLogoutConfirm = false;

  constructor(private upharma: UpharmaService, private router: Router) {}

  ngOnInit() {
    this.checkSession();
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

  setLayoutMode(mode: "left" | "top") {
    this.layoutMode = mode;
    this.appClasses["layout-top"] = mode === "top";
  }

  toggleMenuGroup(group: string) {
    this.menuGroups[group] = !this.menuGroups[group];
  }

  openLogoutConfirm(e: Event) {
    e.preventDefault();
    this.showLogoutConfirm = true;
  }

  confirmLogout() {
    this.upharma.clearSession();
    this.router.navigate(["/login"]);
  }

  cancelLogout() {
    this.showLogoutConfirm = false;
  }
}
