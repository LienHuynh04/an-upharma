import { bootstrapApplication } from "@angular/platform-browser";
import { PreloadAllModules, provideRouter, Routes, withHashLocation, withPreloading } from "@angular/router";
import { authGuard } from "./app/auth.guard";
import { LayoutComponent } from "./app/layout/layout.component";
import { LoginComponent } from "./app/login/login.component";
import { RootComponent } from "./app/root.component";

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
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: "dashboard",
        loadComponent: () => import("./app/dashboard/dashboard.component").then((m) => m.DashboardComponent),
        title: "UPHARMA - Bảng điều khiển",
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
  providers: [provideRouter(routes, withPreloading(PreloadAllModules), withHashLocation())],
}).catch((error) => console.error(error));
