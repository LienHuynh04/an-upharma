import { bootstrapApplication } from "@angular/platform-browser";
import {
  PreloadingStrategy,
  provideRouter,
  Route,
  RouteReuseStrategy,
  Routes,
  withHashLocation,
  withPreloading,
} from "@angular/router";
import { TabReuseStrategy } from "./app/tab-reuse.strategy";
import { Observable, of } from "rxjs";
import { authGuard } from "./app/auth.guard";
import { LoginComponent } from "./app/login/login.component";
import { RootComponent } from "./app/root.component";

/**
 * Chỉ preload các route được đánh dấu `data: { preload: true }`.
 *
 * FIX (2026-10-15): PreloadAllModules cũ tải ngầm TOÀN BỘ chunk (kể cả 3 trang
 * test) ngay sau lần tải đầu — user mở dashboard nhưng vẫn tải ~640KB JS thừa.
 */
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    return route.data?.["preload"] ? load() : of(null);
  }
}

const routes: Routes = [
  {
    path: "",
    redirectTo: "dashboard",
    pathMatch: "full",
  },
  {
    path: "login",
    component: LoginComponent,
    title: "UPHARMA - Đăng nhập",
  },
  {
    path: "",
    loadComponent: () =>
      import("./app/layout/layout.component").then((m) => m.LayoutComponent),
    canActivate: [authGuard],
    children: [
      {
        path: "dashboard",
        loadComponent: () => import("./app/dashboard/dashboard.component").then((m) => m.DashboardComponent),
        title: "UPHARMA - Bảng điều khiển",
        data: { preload: true },
      },
      {
        path: "xuat-bao-cao",
        loadComponent: () => import("./app/report-config/report-config.component").then((m) => m.ReportConfigComponent),
        title: "UPHARMA - Báo cáo vận hành",
      },
      {
        path: "ton-kho",
        loadComponent: () => import("./app/inventory-new/inventory-new.component").then((m) => m.InventoryNewComponent),
        title: "UPHARMA - Tồn kho",
      },
      {
        path: "fefo",
        loadComponent: () => import("./app/fefo/fefo.component").then((m) => m.FefoComponent),
        title: "UPHARMA - Kiểm tra FEFO",
      },
      {
        path: "ton-kho-new",
        redirectTo: "ton-kho",
        pathMatch: "full",
      },
      {
        path: "profile",
        loadComponent: () => import("./app/profile/profile.component").then((m) => m.ProfileComponent),
        title: "UPHARMA - Thông tin cá nhân",
      },
      {
        path: "check-inventory-test",
        loadComponent: () => import("./app/check-inventory-test/check-inventory-test.component").then((m) => m.CheckInventoryTestComponent),
        title: "UPHARMA - Test Kiểm kho",
      },
      {
        path: "inventory-system-test",
        loadComponent: () => import("./app/inventory-system-test/inventory-system-test.component").then((m) => m.InventorySystemTestComponent),
        title: "UPHARMA - Test Hệ thống tồn kho",
      },
      {
        path: "inventory-expiration-test",
        loadComponent: () => import("./app/inventory-expiration-test/inventory-expiration-test.component").then((m) => m.InventoryExpirationTestComponent),
        title: "UPHARMA - Test Hạn dùng",
      },
      {
        path: "lay-bao-cao-don-hang",
        loadComponent: () => import("./app/sales-invoice-report/sales-invoice-report.component").then((m) => m.SalesInvoiceReportComponent),
        title: "UPHARMA - Báo cáo đơn hàng",
      },
      {
        path: "chi-tieu-nhan-vien",
        loadComponent: () => import("./app/employee-plan/employee-plan.component").then((m) => m.EmployeePlanComponent),
        title: "UPHARMA - Chỉ tiêu nhân viên",
      },
      {
        path: "chi-tieu-nha-thuoc-trong-nam",
        loadComponent: () => import("./app/shop-plan-year/shop-plan-year.component").then((m) => m.ShopPlanYearComponent),
        title: "UPHARMA - Chỉ tiêu nhà thuốc",
      },
      {
        path: "out-of-stock",
        loadComponent: () => import("./app/out-of-stock/out-of-stock.component").then((m) => m.OutOfStockComponent),
        title: "UPHARMA - Hàng đã hết",
      },
      {
        path: "hang-lap-tot",
        loadComponent: () => import("./app/stable-consumption/stable-consumption.component").then((m) => m.StableConsumptionComponent),
        title: "UPHARMA - Hàng lặp tốt",
      },
      {
        path: "hang-da-het",
        loadComponent: () => import("./app/out-of-stock/out-of-stock.component").then((m) => m.OutOfStockComponent),
        title: "UPHARMA - Hàng đã hết",
      },
      {
        path: "hang-key",
        loadComponent: () => import("./app/key-products/key-products.component").then((m) => m.KeyProductsComponent),
        title: "UPHARMA - Hàng key",
      },
      {
        path: "goi-y-chuyen-hang",
        loadComponent: () => import("./app/transfer-suggestions/transfer-suggestions.component").then((m) => m.TransferSuggestionsComponent),
        title: "UPHARMA - Gợi ý chuyển hàng",
      },
      {
        path: "ton-kho-toan-quoc",
        loadComponent: () => import("./app/national-stock/national-stock.component").then((m) => m.NationalStockComponent),
        title: "UPHARMA - Tồn kho toàn quốc",
      },

      {
        path: "cronjob",
        loadComponent: () => import("./app/cronjob/cronjob.component").then((m) => m.CronjobComponent),
        title: "UPHARMA - Đồng bộ dữ liệu",
      },
    ],
  },
  {
    path: "**",
    redirectTo: "dashboard",
  },
];

bootstrapApplication(RootComponent, {
  providers: [
    provideRouter(routes, withPreloading(SelectivePreloadingStrategy), withHashLocation()),
    // Keep tab components alive so switching tabs preserves filters/scroll/data.
    // useExisting (not useClass): both tokens share ONE singleton, so
    // LayoutComponent can inject TabReuseStrategy directly to clear cache.
    TabReuseStrategy,
    { provide: RouteReuseStrategy, useExisting: TabReuseStrategy },
  ],
}).catch((error) => console.error(error));
