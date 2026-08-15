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
import { SlowSellingComponent } from "./app/slow-selling/slow-selling.component";
import { StableConsumptionComponent } from "./app/stable-consumption/stable-consumption.component";
import { LayoutComponent } from "./app/layout/layout.component";
import { HomeComponent } from "./app/home/home.component";

const routes: Routes = [
  {
    path: "",
    redirectTo: "chi-tieu-nhan-vien",
    pathMatch: "full",
  },
  {
    path: "login",
    component: LoginComponent,
  },
  {
    path: "",
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: "dashboard",
        component: DashboardComponent,
      },
      {
        path: "ton-kho",
        component: InventoryNewComponent,
      },
      {
        path: "ton-kho-new",
        redirectTo: "ton-kho",
        pathMatch: "full",
      },
      // Backup trang Tồn kho toàn quốc:
      // {
      //   path: "ton-kho-toan-quoc",
      //   component: NationalInventoryComponent,
      // },
      {
        path: "profile",
        component: ProfileComponent,
      },
      {
        path: "api-test",
        component: ApiTestComponent,
      },
      {
        path: "check-inventory-test",
        component: CheckInventoryTestComponent,
      },
      {
        path: "inventory-system-test",
        component: InventorySystemTestComponent,
      },
      {
        path: "inventory-expiration-test",
        component: InventoryExpirationTestComponent,
      },
      {
        path: "lay-bao-cao-don-hang",
        component: SalesInvoiceReportComponent,
      },
      {
        path: "chi-tieu-nhan-vien",
        component: EmployeePlanComponent,
      },
      {
        path: "chi-tieu-nha-thuoc-trong-nam",
        component: ShopPlanYearComponent,
      },
      {
        path: "out-of-stock",
        component: OutOfStockComponent,
      },
      {
        path: "hang-lap-tot",
        component: StableConsumptionComponent,
      },
      {
        path: "hang-da-het",
        component: OutOfStockComponent,
      },
      {
        path: "hang-ban-cham",
        component: SlowSellingComponent,
      },
      {
        path: "goi-y-chuyen-hang",
        component: TransferSuggestionsComponent,
      },
      {
        path: "in-tem",
        component: LabelPrintComponent,
      },
      {
        path: "cronjob",
        loadComponent: () => import("./app/cronjob/cronjob.component").then((m) => m.CronjobComponent),
      },
    ],
  },
  {
    path: "**",
    redirectTo: "chi-tieu-nhan-vien",
  },
];

bootstrapApplication(RootComponent, {
  providers: [provideRouter(routes, withHashLocation())],
}).catch((error) => console.error(error));
