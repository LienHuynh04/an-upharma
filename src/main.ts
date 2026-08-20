import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, Routes, withHashLocation } from "@angular/router";
import { ApiTestComponent } from "./app/api-test/api-test.component";
import { CheckInventoryTestComponent } from "./app/check-inventory-test/check-inventory-test.component";
import { InventorySystemTestComponent } from "./app/inventory-system-test/inventory-system-test.component";
import { InventoryExpirationTestComponent } from "./app/inventory-expiration-test/inventory-expiration-test.component";
import { authGuard } from "./app/auth.guard";
import { EmployeePlanComponent } from "./app/employee-plan/employee-plan.component";
import { InventoryNewComponent } from "./app/inventory-new/inventory-new.component";
import { LoginComponent } from "./app/login/login.component";
import { LabelPrintComponent } from "./app/label-print/label-print.component";
import { TransferSuggestionsComponent } from "./app/transfer-suggestions/transfer-suggestions.component";
// Backup trang Tồn kho toàn quốc:
// import { NationalInventoryComponent } from "./app/national-inventory/national-inventory.component";
import { OutOfStockComponent } from "./app/out-of-stock/out-of-stock.component";
import { ProfileComponent } from "./app/profile/profile.component";
import { DashboardComponent } from "./app/dashboard/dashboard.component";
import { SalesInvoiceReportComponent } from "./app/sales-invoice-report/sales-invoice-report.component";
import { ShopPlanYearComponent } from "./app/shop-plan-year/shop-plan-year.component";
import { RootComponent } from "./app/root.component";
// import { SlowSellingComponent } from "./app/slow-selling/slow-selling.component";
import { StableConsumptionComponent } from "./app/stable-consumption/stable-consumption.component";
import { KeyProductsComponent } from "./app/key-products/key-products.component";
import { LayoutComponent } from "./app/layout/layout.component";


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
        component: DashboardComponent,
        title: "UPHARMA - Bảng điều khiển",
      },
      {
        path: "ton-kho",
        component: InventoryNewComponent,
        title: "UPHARMA - Tồn kho",
      },
      {
        path: "ton-kho-new",
        redirectTo: "ton-kho",
        pathMatch: "full",
      },
      {
        path: "profile",
        component: ProfileComponent,
        title: "UPHARMA - Thông tin cá nhân",
      },
      {
        path: "api-test",
        component: ApiTestComponent,
        title: "UPHARMA - Test API",
      },
      {
        path: "check-inventory-test",
        component: CheckInventoryTestComponent,
        title: "UPHARMA - Test Kiểm kho",
      },
      {
        path: "inventory-system-test",
        component: InventorySystemTestComponent,
        title: "UPHARMA - Test Hệ thống tồn kho",
      },
      {
        path: "inventory-expiration-test",
        component: InventoryExpirationTestComponent,
        title: "UPHARMA - Test Hạn dùng",
      },
      {
        path: "lay-bao-cao-don-hang",
        component: SalesInvoiceReportComponent,
        title: "UPHARMA - Báo cáo đơn hàng",
      },
      {
        path: "chi-tieu-nhan-vien",
        component: EmployeePlanComponent,
        title: "UPHARMA - Chỉ tiêu nhân viên",
      },
      {
        path: "chi-tieu-nha-thuoc-trong-nam",
        component: ShopPlanYearComponent,
        title: "UPHARMA - Chỉ tiêu nhà thuốc",
      },
      {
        path: "out-of-stock",
        component: OutOfStockComponent,
        title: "UPHARMA - Hàng đã hết",
      },
      {
        path: "hang-lap-tot",
        component: StableConsumptionComponent,
        title: "UPHARMA - Hàng lặp tốt",
      },
      {
        path: "hang-da-het",
        component: OutOfStockComponent,
        title: "UPHARMA - Hàng đã hết",
      },
      {
        path: "hang-key",
        component: KeyProductsComponent,
        title: "UPHARMA - Hàng key",
      },
      // {
      //   path: "hang-ban-cham",
      //   component: SlowSellingComponent,
      //   title: "UPHARMA - Hàng bán chậm",
      // },
      {
        path: "goi-y-chuyen-hang",
        component: TransferSuggestionsComponent,
        title: "UPHARMA - Gợi ý chuyển hàng",
      },
      {
        path: "in-tem",
        component: LabelPrintComponent,
        title: "UPHARMA - In tem nhãn",
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
  providers: [provideRouter(routes, withHashLocation())],
}).catch((error) => console.error(error));
